const admin = require('../functions/node_modules/firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, '../orion-291b5-firebase-adminsdk-fbsvc-1607f47283.json'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://orion-291b5-default-rtdb.europe-west1.firebasedatabase.app"
    });
}

const db = admin.database();

async function postAnnouncement(version, summary) {
    const channelId = 'channel_orion_updates';
    const messageText = `🚀 Orion Chat v${version} is now available!\n\n${summary}\n\n[UPDATE_VERSION:${version}]\n\nGo to Settings -> Check for Updates to install.`;
    
    const msgRef = db.ref(`messages/${channelId}`).push();
    const now = Date.now();
    
    await msgRef.set({
        sender_id: 'system',
        sender_name: 'Orion Updates',
        text: messageText,
        metadata: {
            type: 'app_update',
            version: version
        },
        timestamp: now,
        createdAt: now
    });
    
    await db.ref(`chats/${channelId}`).update({
        last_message: `🚀 Version v${version} released!`,
        timestamp: now
    });
    
    console.log(`Successfully posted v${version} announcement to ${channelId} (ID: ${msgRef.key})`);
    process.exit(0);
}

const version = process.argv[2] || '1.0.4';
const summary = process.argv[3] || 'Fixed version display duplication bug and improved settings UI.';

postAnnouncement(version, summary).catch(err => {
    console.error("Failed to post announcement:", err);
    process.exit(1);
});
