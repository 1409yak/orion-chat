/**
 * Firebase Cloud Functions (2nd Gen) for Orion Messenger
 * Automatically triggers FCM push notifications on new chat messages
 * Supports both Firebase Realtime Database and Cloud Firestore triggers
 */

const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { getDatabase } = require("firebase-admin/database");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onValueCreated } = require("firebase-functions/v2/database");
const logger = require("firebase-functions/logger");

// Initialize Firebase Admin SDK
initializeApp();

/**
 * Common push notification sender and cleanup logic
 * @param {Object} params
 * @param {string} params.chatId
 * @param {string} params.senderId
 * @param {string} params.senderName
 * @param {string} params.messageText
 * @param {Array<string>} params.recipientIds
 * @param {'database'|'firestore'} params.sourceType
 */
async function sendNotificationToRecipients({
    chatId,
    senderId,
    senderName,
    messageText,
    recipientIds,
    sourceType = 'database'
}) {
    if (!recipientIds || recipientIds.length === 0) {
        logger.info(`[FCM] No recipients to notify for chat ${chatId}`);
        return;
    }

    const isDm = chatId && chatId.includes('_');
    const tokenEntries = []; // Array of { token, uid, source }

    // 1. Retrieve tokens and notification settings for each recipient
    for (const uid of recipientIds) {
        if (!uid || uid === senderId) continue;

        try {
            if (sourceType === 'database') {
                const db = getDatabase();
                const [userSnap, settingsSnap] = await Promise.all([
                    db.ref(`users/${uid}`).get(),
                    db.ref(`users/${uid}/notificationSettings`).get()
                ]);

                const userData = userSnap.val() || {};
                const settings = settingsSnap.val() || {};

                // Respect user notification preferences
                if (isDm && settings.dmNotifications === 'none') {
                    logger.info(`[FCM] Skipping DM notification for UID ${uid} (preference: none)`);
                    continue;
                }
                if (!isDm && settings.groupNotifications === 'mute') {
                    logger.info(`[FCM] Skipping group notification for UID ${uid} (preference: mute)`);
                    continue;
                }

                // Collect tokens (string or map of tokens)
                if (userData.fcmToken && typeof userData.fcmToken === 'string') {
                    tokenEntries.push({ token: userData.fcmToken, uid, source: 'database' });
                }
                if (userData.fcmTokens && typeof userData.fcmTokens === 'object') {
                    Object.keys(userData.fcmTokens).forEach(t => {
                        if (t && typeof t === 'string') {
                            tokenEntries.push({ token: t, uid, source: 'database' });
                        }
                    });
                }
            } else {
                // Firestore source
                const firestore = getFirestore();
                const userDoc = await firestore.collection('users').doc(uid).get();
                if (userDoc.exists) {
                    const data = userDoc.data() || {};
                    const settings = data.notificationSettings || {};

                    if (isDm && settings.dmNotifications === 'none') continue;
                    if (!isDm && settings.groupNotifications === 'mute') continue;

                    if (data.fcmToken && typeof data.fcmToken === 'string') {
                        tokenEntries.push({ token: data.fcmToken, uid, source: 'firestore' });
                    }
                    if (Array.isArray(data.fcmTokens)) {
                        data.fcmTokens.forEach(t => {
                            if (t && typeof t === 'string') tokenEntries.push({ token: t, uid, source: 'firestore' });
                        });
                    }
                }
            }
        } catch (err) {
            logger.error(`[FCM] Error reading tokens for user ${uid}:`, err);
        }
    }

    if (tokenEntries.length === 0) {
        logger.info(`[FCM] No registered tokens found for recipients in chat ${chatId}`);
        return;
    }

    // Deduplicate tokens
    const uniqueTokensMap = new Map();
    tokenEntries.forEach(entry => {
        if (!uniqueTokensMap.has(entry.token)) {
            uniqueTokensMap.set(entry.token, entry);
        }
    });

    const tokensToSend = Array.from(uniqueTokensMap.keys());
    logger.info(`[FCM] Sending push notification for chat ${chatId} to ${tokensToSend.length} device tokens`);

    // 2. Prepare multicast payload
    const multicastPayload = {
        tokens: tokensToSend,
        notification: {
            title: senderName || "New Message",
            body: String(messageText || "New message received")
        },
        data: {
            chatId: String(chatId || ""),
            senderId: String(senderId || ""),
            type: "chat_message",
            url: `/?chat=${chatId}`
        },
        android: {
            priority: "high",
            notification: {
                sound: "default",
                channelId: "default"
            }
        }
    };

    try {
        const response = await getMessaging().sendEachForMulticast(multicastPayload);
        logger.info(`[FCM] Successfully delivered: ${response.successCount}, Failures: ${response.failureCount}`);

        // 3. Cleanup logic for stale / invalid tokens
        if (response.failureCount > 0) {
            const cleanupPromises = [];

            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const error = resp.error;
                    const failedToken = tokensToSend[idx];
                    const entry = uniqueTokensMap.get(failedToken);

                    logger.warn(`[FCM] Delivery failed for token: ${failedToken}`, error?.code || error?.message);

                    const isInvalidToken =
                        error?.code === 'messaging/invalid-registration-token' ||
                        error?.code === 'messaging/registration-token-not-registered' ||
                        (error?.message && error.message.includes('not a valid FCM registration token'));

                    if (isInvalidToken && entry) {
                        logger.info(`[FCM] Cleaning up invalid token for user ${entry.uid}: ${failedToken}`);
                        if (entry.source === 'database') {
                            const db = getDatabase();
                            // If user.fcmToken matches, remove it
                            cleanupPromises.push(
                                db.ref(`users/${entry.uid}/fcmToken`).transaction(current => {
                                    return current === failedToken ? null : current;
                                })
                            );
                            cleanupPromises.push(
                                db.ref(`users/${entry.uid}/fcmTokens/${failedToken.replace(/[.#$[\]]/g, '_')}`).remove()
                            );
                        } else {
                            const firestore = getFirestore();
                            cleanupPromises.push(
                                firestore.collection('users').doc(entry.uid).update({
                                    fcmTokens: FieldValue.arrayRemove(failedToken)
                                }).catch(() => null)
                            );
                        }
                    }
                }
            });

            await Promise.all(cleanupPromises);
        }
    } catch (sendErr) {
        logger.error(`[FCM] Error dispatching multicast notification:`, sendErr);
    }
}

/**
 * 1. Firebase Realtime Database Trigger:
 * Triggers automatically when a new message is created at /messages/{chatId}/{messageId}
 */
exports.onMessageCreatedDatabase = onValueCreated(
    {
        ref: "/messages/{chatId}/{messageId}",
        region: "europe-west1"
    },
    async (event) => {
        const messageData = event.data.val();
        if (!messageData) {
            logger.info("No message data found in event");
            return;
        }

        const { chatId, messageId } = event.params;
        const senderId = messageData.sender_id || messageData.senderId || "";
        const senderName = messageData.sender_name || messageData.senderName || "New Message";
        let messageText = messageData.text || "";

        if (messageData.stickerId) {
            messageText = "[Sticker]";
        } else if (messageText && messageText.startsWith("data:image/")) {
            messageText = "Sent an image";
        }

        logger.info(`[DB Trigger] New message in chat: ${chatId} (${messageId}) from ${senderName} (${senderId})`);

        // Fetch chat members
        const db = getDatabase();
        let recipientIds = [];

        try {
            const membersSnap = await db.ref(`members/${chatId}`).get();
            if (membersSnap.exists()) {
                const membersObj = membersSnap.val() || {};
                recipientIds = Object.keys(membersObj).filter(uid => uid !== senderId);
            } else if (chatId && chatId.includes('_')) {
                // Fallback for direct 1-to-1 chats: chatId format uid1_uid2
                recipientIds = chatId.split('_').filter(uid => uid !== senderId);
            }
        } catch (err) {
            logger.error(`[DB Trigger] Failed to fetch members for chat ${chatId}:`, err);
            if (chatId && chatId.includes('_')) {
                recipientIds = chatId.split('_').filter(uid => uid !== senderId);
            }
        }

        await sendNotificationToRecipients({
            chatId,
            senderId,
            senderName,
            messageText,
            recipientIds,
            sourceType: 'database'
        });
    }
);

/**
 * 2. Cloud Firestore Trigger:
 * Triggers automatically when a new message document is created in Firestore at chats/{chatId}/messages/{messageId}
 */
exports.onMessageCreatedFirestore = onDocumentCreated(
    "chats/{chatId}/messages/{messageId}",
    async (event) => {
        const snap = event.data;
        if (!snap) return;

        const messageData = snap.data();
        const { chatId, messageId } = event.params;
        const senderId = messageData.sender_id || messageData.senderId || messageData.from || "";
        const senderName = messageData.sender_name || messageData.senderName || "New Message";
        const messageText = messageData.text || messageData.body || messageData.message || "";

        logger.info(`[Firestore Trigger] New message in chat: ${chatId} (${messageId}) from ${senderName}`);

        // Retrieve recipients: check chat document or direct message ID
        let recipientIds = [];
        try {
            const firestore = getFirestore();
            const chatDoc = await firestore.collection('chats').doc(chatId).get();
            if (chatDoc.exists) {
                const chatData = chatDoc.data() || {};
                const members = chatData.members || [];
                if (Array.isArray(members)) {
                    recipientIds = members.filter(uid => uid !== senderId);
                } else if (typeof members === 'object') {
                    recipientIds = Object.keys(members).filter(uid => uid !== senderId);
                }
            } else if (messageData.recipientId) {
                recipientIds = [messageData.recipientId];
            } else if (chatId.includes('_')) {
                recipientIds = chatId.split('_').filter(uid => uid !== senderId);
            }
        } catch (err) {
            logger.error(`[Firestore Trigger] Failed to resolve recipients for chat ${chatId}:`, err);
            if (messageData.recipientId) recipientIds = [messageData.recipientId];
        }

        await sendNotificationToRecipients({
            chatId,
            senderId,
            senderName,
            messageText,
            recipientIds,
            sourceType: 'firestore'
        });
    }
);
