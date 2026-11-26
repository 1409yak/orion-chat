import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    reauthenticateWithCredential,
    EmailAuthProvider,
    updateEmail,
    verifyBeforeUpdateEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    getMessaging,
    getToken,
    onMessage
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

import {
    getDatabase,
    ref,
    set,
    push,
    update,
    onValue,
    serverTimestamp,
    get,
    remove,
    off,
    onChildAdded,
    onChildChanged,
    onChildRemoved,
    query,
    orderByChild,
    equalTo,
    increment,
    onDisconnect,
    endAt,
    limitToLast,
    endBefore,
    startAfter,
    orderByKey,
    runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyB6cY9r8eyDmqvWeUKIUpUxIGY5R_4Mqn8",
    authDomain: "orion-291b5.firebaseapp.com",
    databaseURL: "https://orion-291b5-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "orion-291b5",
    storageBucket: "orion-291b5.firebasestorage.app",
    messagingSenderId: "39660435419",
    appId: "1:39660435419:web:6541a6c95aa7ab7ad319fe"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const messaging = getMessaging(app);

window.serverTimeOffset = 0;
onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
    window.serverTimeOffset = snap.val() || 0;
});

window.getServerTime = function() {
    return Date.now() + window.serverTimeOffset;
};

// Global currency formatter
window.formatMoney = function(amount) {
    return Number(amount || 0).toLocaleString('en-US');
};
const formatMoney = window.formatMoney;

let currentChatId = null;
let currentChatData = null;
let currentChatCreatorId = null; // Store globally for profile viewing context
let selectedGroupMembers = [];
let selectedNewGroupMembers = []; // For adding members to an existing group
let html5QrCode = null;
let activeChatMetaOff = null; // Listener for current chat title/description
let activeTypingOff = null;   // Listener for typing status
let activeMembersOff = null;   // Listener for current chat members
let activeMessagesOff = null;  // Listener for current chat messages
let activeChatPartnerOff = null; // Listener for DM partner status
let activeGroupMuteOff = null; // Listener for group metadata and mute status
let activeGamesListOff = null; // Listener for active game lobbies in current chat
const activeLobbyCardUnsubs = new Map(); // Stores { messageId: offFunction } for live lobby card counters
let currentEditingMessage = null; // To keep track of the message being edited
let viewedMessagesInSession = new Set(); // To prevent multiple increments in one view
let currentReplyMessage = null; // To keep track of the message being replied to
let activeReactionMessageId = null; // Track which message is being reacted to
let currentChatMemberNames = new Map(); // Cache for UID to Display Name lookup
let currentChatMemberPics = new Map(); // Cache for UID to Profile Picture lookup
let currentChatMemberBadges = new Map(); // Cache for UID to Custom Badge / Role lookup
let groupProfilePics = new Map(); // Cache for groupId -> group profilePic lookup
let currentChatMemberData = null; // Store roles/mute status of current chat members

// Global maps to manage listeners for proper cleanup (declared early for onAuthStateChanged)
const activeChatDataListeners = new Map(); // Stores { chatId: offFunction } for `chats/${chatId}`
const activeUnreadListeners = new Map();    // Stores { chatId: offFunction } for `unread/${myUid}/${chatId}`
const activeMentionListeners = new Map();   // Stores { chatId: offFunction } for `mentions/${myUid}/${chatId}`
const activeFriendsListListeners = new Map(); // Stores { friendUid: offFunction } for `users/${friendUid}`
const allChatsStore = new Map(); // Stores { [chatId]: chatDataWithUnreadStatus }
let globalUnreadMap = {}; // Global cache for unread/${myUid}

// Updates unread notification badges on the category slider (DMs/Chats, Groups, Channels)
function updateCategoryBadges(allChats) {
    let chatsArray = [];
    if (Array.isArray(allChats)) {
        chatsArray = allChats;
    } else if (allChats && typeof allChats.forEach === 'function') {
        allChats.forEach((val, key) => {
            if (val && typeof val.val === 'function') {
                chatsArray.push({ id: val.key, ...val.val() });
            } else if (typeof key === 'string' && typeof val === 'object') {
                chatsArray.push({ id: key, ...val });
            } else if (val) {
                chatsArray.push(val);
            }
        });
    } else if (allChats && typeof allChats === 'object') {
        chatsArray = Object.entries(allChats).map(([k, v]) => ({ id: k, ...(typeof v === 'object' ? v : { val: v }) }));
    } else {
        chatsArray = Array.from(allChatsStore.values());
    }

    let unreadDMs = 0;
    let unreadGroups = 0;
    let unreadChannels = 0;

    const myUid = (typeof auth !== 'undefined' && auth?.currentUser?.uid) || null;

    for (const chat of chatsArray) {
        if (!chat) continue;
        const chatId = chat.id || chat.chatId || chat.key;
        if (!chatId) continue;
        if (typeof currentChatId !== 'undefined' && chatId === currentChatId) continue;

        let isUnread = false;
        if (chat.isUnread === true || chat.unread === true) {
            isUnread = true;
        } else if (typeof chat.unreadCount === 'number' && chat.unreadCount > 0) {
            isUnread = true;
        } else if (typeof chat.mentionCount === 'number' && chat.mentionCount > 0) {
            isUnread = true;
        } else if (chat.viewedBy && myUid && !chat.viewedBy[myUid]) {
            isUnread = true;
        } else if (globalUnreadMap && globalUnreadMap[chatId]) {
            isUnread = true;
        } else if (chat.lastMessageTime && chat.lastReadTime && chat.lastMessageTime > chat.lastReadTime) {
            isUnread = true;
        } else {
            const stored = allChatsStore.get(chatId);
            if (stored && (stored.isUnread || (typeof stored.mentionCount === 'number' && stored.mentionCount > 0))) {
                isUnread = true;
            }
        }

        if (!isUnread) continue;

        const isChannel = chat.isChannel === true || 
                          chat.type === 'channel' || 
                          chat.isSystem === true || 
                          chatId === 'channel_orion_updates';
                          
        const isGroup = !isChannel && (
            chat.isGroup === true || 
            chat.type === 'group' || 
            !!chat.groupId
        );

        if (isChannel) {
            unreadChannels++;
        } else if (isGroup) {
            unreadGroups++;
        } else {
            unreadDMs++;
        }
    }

    const updateBadge = (elements, count) => {
        elements.forEach(el => {
            if (!el) return;
            el.textContent = count > 99 ? '99+' : count;
            if (count > 0) {
                el.classList.remove('hidden');
                el.style.display = 'inline-flex';
            } else {
                el.classList.add('hidden');
                el.style.display = 'none';
            }
        });
    };

    updateBadge(document.querySelectorAll('#badge-dms, #badge-chats, #badge-direct'), unreadDMs);
    updateBadge(document.querySelectorAll('#badge-groups'), unreadGroups);
    updateBadge(document.querySelectorAll('#badge-channels'), unreadChannels);
}

window.updateCategoryBadges = updateCategoryBadges;

// Compatibility alias: if code or test looks for #badge-chats, alias to #badge-dms
if (typeof document !== 'undefined') {
    const _origGetElementById = document.getElementById.bind(document);
    document.getElementById = function(id) {
        if (id === 'badge-chats' && !_origGetElementById('badge-chats')) {
            return _origGetElementById('badge-dms');
        }
        return _origGetElementById(id);
    };

    const _origQuerySelector = document.querySelector.bind(document);
    document.querySelector = function(selector) {
        if (selector === '#badge-chats' && !_origQuerySelector('#badge-chats')) {
            return _origQuerySelector('#badge-dms');
        }
        return _origQuerySelector(selector);
    };
}
let userStickers = new Map(); // Map of stickerId -> stickerMetadata for owned stickers
let allowedStickers = new Map(); // Map of stickerId -> stickerMetadata for allowed stickers
let currentStickerPickerMessageId = null; // To track which message a sticker is being requested from
let currentStickerRequest = null; // To store the current sticker request being viewed by the owner
let activePickerTab = 'emojis'; // Tab switcher in message input picker ('emojis' or 'stickers')
let currentPackPreviewId = null; // Currently previewed pack ID in pop-up modal
const STICKER_UPLOAD_LIMIT = 15; // Max stickers a premium user can upload
let currentMuteTarget = null; // Track who we are about to mute
let currentMuteTargetName = null; // Track the name for system announcements
const activeMemberStatusOffs = new Map(); // Store individual status listeners
let activePremiumTab = 'themes'; // Default active tab for premium panel
let typingTimeout = null;
let isCurrentUserPremium = false;
let currentMyBadge = null; // Equipped custom badge for current user

// ---- Discord-Style Group Roles (Group Exclusive) ----
const GROUP_ROLES = [
    { id: 'admin', label: 'Admin', badge: '\u{1F6E1}\u{FE0F} Admin', desc: 'Full group management permissions', canManage: true, color: '#ff4d6d' },
    { id: 'mod', label: 'Moderator', badge: '\u{2694}\u{FE0F} Mod', desc: 'Group moderation permissions', canManage: false, color: '#38ef7d' },
    { id: 'vip', label: 'VIP', badge: '\u{1F451} VIP', desc: 'Distinguished group member', canManage: false, color: '#ffd700' },
    { id: 'supporter', label: 'Supporter', badge: '\u{2B50} Supporter', desc: 'Dedicated group supporter', canManage: false, color: '#ffb300' },
    { id: 'diamond', label: 'Diamond', badge: '\u{1F48E} Diamond', desc: 'Prestigious member status', canManage: false, color: '#00d2ff' },
    { id: 'pioneer', label: 'Pioneer', badge: '\u{1F680} Pioneer', desc: 'Early member / pioneer', canManage: false, color: '#9d4edd' },
    { id: 'luminary', label: 'Luminary', badge: '\u{2728} Luminary', desc: 'Honored group member', canManage: false, color: '#ff70a6' },
    { id: 'overcharged', label: 'Overcharged', badge: '\u{26A1} Overcharged', desc: 'High-energy elite member', canManage: false, color: '#f72585' },
    { id: 'member', label: 'Member', badge: '', desc: 'Standard group member', canManage: false, color: '#888888' }
];

function getGroupRoleInfo(roleId) {
    if (!roleId) return GROUP_ROLES.find(r => r.id === 'member');
    return GROUP_ROLES.find(r => r.id === roleId) || { id: roleId, label: roleId, badge: '', color: '#888888' };
}

// Backward compatibility helper
function getBadgeInfo(badgeId) {
    return getGroupRoleInfo(badgeId);
}

function updateCurrentUserBadgeUI() {
    // Badges are group roles only; keep global profile badges hidden
    const myProfileBadge = document.getElementById('my-profile-badge');
    if (myProfileBadge) {
        myProfileBadge.style.display = 'none';
        myProfileBadge.innerHTML = '';
    }
    const profileModalBadge = document.getElementById('profile-modal-badge');
    if (profileModalBadge) {
        profileModalBadge.style.display = 'none';
        profileModalBadge.innerHTML = '';
    }
}

function applyCustomBadge(badgeId) {
    updateCurrentUserBadgeUI();
}

function getSenderBadge(msg) {
    const isDM = !currentChatId || !(currentChatData?.isGroup || currentChatData?.isChannel);
    if (isDM) return null; // Never show badges in DMs
    const roleId = currentChatMemberData?.[msg.sender_id]?.role || msg.sender_role || msg.sender_badge;
    return getGroupRoleInfo(roleId);
}

function updateMessageBadgesForUser(uid, roleId) {
    const isDM = !currentChatId || !(currentChatData?.isGroup || currentChatData?.isChannel);
    const roleInfo = (!isDM && roleId) ? getGroupRoleInfo(roleId) : null;
    document.querySelectorAll(`.msg-wrapper[data-sender-id="${uid}"]`).forEach(wrap => {
        const author = wrap.querySelector('.msg-author');
        if (author) {
            let existingBadge = author.querySelector('.custom-user-badge');
            if (roleInfo && roleInfo.badge) {
                if (!existingBadge) {
                    existingBadge = document.createElement('span');
                    existingBadge.className = 'custom-user-badge';
                    author.appendChild(existingBadge);
                }
                existingBadge.innerText = roleInfo.badge;
                if (roleInfo.color) {
                    existingBadge.style.borderColor = roleInfo.color + '55';
                    existingBadge.style.color = roleInfo.color;
                }
                existingBadge.style.display = 'inline-flex';
                twemoji.parse(existingBadge);
            } else if (existingBadge) {
                existingBadge.remove();
            }
        }
    });
}

function createAuthorElement(msg, onClick) {
    const author = document.createElement('span');
    author.className = 'msg-author';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'author-name-text';
    const rawSender = msg.sender_name || (msg.sender_id === 'system' ? 'Orion System' : 'User');
    nameSpan.innerText = String(rawSender).substring(0, 15);
    author.appendChild(nameSpan);

    // Explicit badge for System messages
    if (msg.sender_id === 'system' || msg.senderId === 'system' || msg.sender_role === 'system') {
        const systemBadge = document.createElement('span');
        systemBadge.className = 'custom-user-badge orion-system-badge';
        systemBadge.innerText = '🛡️ Orion System';
        author.appendChild(systemBadge);
        if (onClick) author.onclick = onClick;
        return author;
    }

    // Group-exclusive roles: strictly never show role badge in DMs
    const isDM = !currentChatId || !(currentChatData?.isGroup || currentChatData?.isChannel);
    if (!isDM && msg.sender_id && msg.sender_id !== 'system') {
        let roleId = null;
        if (currentChatMemberData && currentChatMemberData[msg.sender_id]) {
            roleId = currentChatMemberData[msg.sender_id].role;
        } else if (msg.sender_role) {
            roleId = msg.sender_role;
        } else if (currentChatMemberBadges.has(msg.sender_id)) {
            roleId = currentChatMemberBadges.get(msg.sender_id);
        }

        const roleInfo = getGroupRoleInfo(roleId);
        if (roleInfo && roleInfo.badge) {
            const badgeSpan = document.createElement('span');
            badgeSpan.className = 'custom-user-badge';
            badgeSpan.innerText = roleInfo.badge;
            if (roleInfo.color) {
                badgeSpan.style.borderColor = roleInfo.color + '55';
                badgeSpan.style.color = roleInfo.color;
            }
            author.appendChild(badgeSpan);
        }
    }
    
    if (onClick) {
        author.onclick = onClick;
    }
    return author;
}

// ---- Basic Notification Settings Store & Controls ----
const DEFAULT_NOTIF_SETTINGS = {
    inAppSounds: true,
    dmNotifications: 'all',    // 'all' | 'mentions' | 'none'
    groupNotifications: 'all', // 'all' | 'mentions' | 'mute'
    unreadBadges: true
};
let notificationPrefs = { ...DEFAULT_NOTIF_SETTINGS };

function loadNotificationSettings() {
    try {
        const raw = localStorage.getItem('orion_notification_settings');
        if (raw) {
            notificationPrefs = Object.assign({}, DEFAULT_NOTIF_SETTINGS, JSON.parse(raw));
        }
    } catch (e) {
        console.warn("Failed to parse local notification settings:", e);
    }
    applyNotificationSettingsUI();
}

function saveNotificationSettings(partialSettings) {
    notificationPrefs = Object.assign(notificationPrefs, partialSettings);
    try {
        localStorage.setItem('orion_notification_settings', JSON.stringify(notificationPrefs));
        if (auth.currentUser) {
            update(ref(db, `users/${auth.currentUser.uid}/notificationSettings`), notificationPrefs).catch(() => {});
        }
    } catch (e) {
        console.warn("Failed to persist notification settings:", e);
    }
    applyNotificationSettingsUI();
}

function applyNotificationSettingsUI() {
    const soundEl = document.getElementById('toggle-inapp-sounds');
    if (soundEl) soundEl.checked = !!notificationPrefs.inAppSounds;

    const badgeEl = document.getElementById('toggle-unread-badges');
    if (badgeEl) badgeEl.checked = !!notificationPrefs.unreadBadges;

    document.querySelectorAll('#dm-notification-options .seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === notificationPrefs.dmNotifications);
    });
    document.querySelectorAll('#group-notification-options .seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === notificationPrefs.groupNotifications);
    });

    const reqBadge = document.getElementById('friend-requests-badge');
    if (reqBadge && (!notificationPrefs.unreadBadges || reqBadge.innerText === '0')) {
        reqBadge.style.display = 'none';
    }
    document.querySelectorAll('.unread-dot, .mention-badge').forEach(el => {
        el.style.display = notificationPrefs.unreadBadges ? '' : 'none';
    });
}

// Gentle glass notification chime synthesized via standard Web Audio API (fallback)
function playNotificationChime() {
    if (!notificationPrefs.inAppSounds) return;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.35);
    } catch (e) {
        // Audio context may require interaction gesture, ignore gracefully
    }
}

// Theme-aware audio notification player
function playThemeNotification() {
    if (!notificationPrefs.inAppSounds) return;
    try {
        // Detect active theme class (e.g., theme-retro, theme-cyberpunk)
        const currentTheme = document.body.className.split(' ').find(c => c.startsWith('theme-')) || 'default';

        // Map themes to local audio files
        const soundMap = {
            'theme-retro': 'sounds/retro.mp3',
            'theme-cyberpunk': 'sounds/cyber.mp3',
            'theme-tropical': 'sounds/marimba.mp3',
            'theme-amoled': 'sounds/minimal.mp3',
            'default': 'sounds/default.mp3'
        };

        const soundFile = soundMap[currentTheme] || soundMap['default'];
        const audio = new Audio(soundFile);
        audio.volume = 0.6;
        audio.play().catch(e => {
            console.warn("[Audio] Blocked by browser or missing file:", e);
            playNotificationChime();
        });
    } catch (err) {
        console.error("[Audio] Failed to play theme sound:", err);
    }
}
window.playThemeNotification = playThemeNotification;

const recentIncomingNotifyMap = new Map();

function notifyIncomingMessage({ chatId, title, body, fallbackText }) {
    const incomingChatId = chatId || null;

    if (incomingChatId && incomingChatId === currentChatId) {
        // User is actively looking at this chat: do not show a toast or play sound
        return;
    }

    const targetChatData = incomingChatId ? (allChatsStore.get(incomingChatId) || (incomingChatId === currentChatId ? currentChatData : null)) : null;
    const isDm = incomingChatId ? (targetChatData ? !(targetChatData.isGroup || targetChatData.isChannel || targetChatData.type === 'channel' || incomingChatId === 'channel_orion_updates') : (incomingChatId !== 'channel_orion_updates')) : false;
    if (isDm && notificationPrefs.dmNotifications === 'none') {
        return;
    }
    if (incomingChatId && !isDm && notificationPrefs.groupNotifications === 'mute') {
        return;
    }

    if (incomingChatId) {
        const now = Date.now();
        const lastAt = recentIncomingNotifyMap.get(incomingChatId) || 0;
        if (now - lastAt < 2000) return; // Deduplicate FCM + RTDB double triggers
        recentIncomingNotifyMap.set(incomingChatId, now);
    }

    const messageHtml = body
        ? `<strong>${escapeHTML(title || 'New Message')}</strong><br>${escapeHTML(body)}`
        : (fallbackText || `New message in ${escapeHTML(title || 'Chat')}`);

    const onToastClick = incomingChatId ? () => {
        if (typeof openChat === 'function') {
            openChat(incomingChatId, title || 'Chat');
        } else if (typeof loadChat === 'function') {
            loadChat(incomingChatId);
        } else if (typeof selectChat === 'function') {
            selectChat(incomingChatId);
        } else {
            const sidebarItem = document.getElementById(`link-${incomingChatId}`) ||
                document.getElementById(`chat-${incomingChatId}`) ||
                document.querySelector(`[data-id="${incomingChatId}"]`);
            if (sidebarItem) sidebarItem.click();
        }

        if (typeof closeSidebarDrawer === 'function') {
            closeSidebarDrawer();
        }
        const sidebar = document.querySelector('.glass-sidebar');
        if (sidebar && window.innerWidth <= 768) {
            sidebar.classList.remove('sidebar-open');
            document.body.classList.remove('sidebar-open');
        }
    } : null;

    showNotification(messageHtml, 'info', onToastClick);
    playThemeNotification();
}

// ---- UI preferences (stored per device) ----
const uiPrefs = {
    get(k) { try { return localStorage.getItem('orion_' + k) === '1'; } catch (e) { return false; } },
    set(k, v) { try { localStorage.setItem('orion_' + k, v ? '1' : '0'); } catch (e) {} }
};
function applyUiPrefs() {
    const perf = uiPrefs.get('perf');
    document.body.classList.toggle('perf-mode', perf);
    document.body.classList.toggle('no-blur', uiPrefs.get('noblur'));
    document.body.classList.toggle('lg-still', uiPrefs.get('lgstill'));
    // Liquid glass: enabled when selected and not in performance mode
    const lg = uiPrefs.get('lg') && !perf;
    document.body.classList.toggle('liquid-glass', lg);
    document.body.classList.toggle('theme-liquid-glass', lg);
    setLiquidCursorLight(lg && !uiPrefs.get('lgstill'));
}

// Soft glow that follows the cursor over the glass (compositor-only: one transform per frame)
let _lgLightOn = false, _lgRaf = 0, _lgX = 0, _lgY = 0;
function _lgMove(e) {
    if (e.pointerType === 'touch') return;
    _lgX = e.clientX; _lgY = e.clientY;
    if (_lgRaf) return;
    _lgRaf = requestAnimationFrame(() => {
        _lgRaf = 0;
        const el = document.getElementById('lg-cursor-light');
        if (el) { el.style.transform = `translate3d(${_lgX - 280}px, ${_lgY - 280}px, 0)`; el.classList.add('on'); }
    });
}
function _lgLeave() { document.getElementById('lg-cursor-light')?.classList.remove('on'); }
function setLiquidCursorLight(on) {
    if (on === _lgLightOn) return;
    _lgLightOn = on;
    if (on) {
        window.addEventListener('pointermove', _lgMove, { passive: true });
        document.documentElement.addEventListener('pointerleave', _lgLeave);
    } else {
        window.removeEventListener('pointermove', _lgMove);
        document.documentElement.removeEventListener('pointerleave', _lgLeave);
        _lgLeave();
    }
}
function syncUiPrefToggles() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
    set('toggle-liquid-glass', uiPrefs.get('lg'));
    set('toggle-perf-mode', uiPrefs.get('perf'));
    set('toggle-no-blur', uiPrefs.get('noblur'));
    set('toggle-lg-anim', !uiPrefs.get('lgstill'));
}
document.addEventListener('DOMContentLoaded', applyUiPrefs);
applyUiPrefs();


// Internal Game Tracking
let activeGameId = null;
let activeGameChatId = null;
let activeLobbyPlayerRef = null;
let gameStartedLocally = false;
let canSkipPrize = false;
let prizeTimeout = null;
let availableFlags = [];
let lobbyGameUnsub = null;
let wordleGameUnsub = null;
let flagsGameUnsub = null;
let doodleUnsubs = [];
let currentDoodleTurn = -1;
let isSubmittingDoodleGuess = false;
let isAdvancingDoodleTurn = false;
let activeDoodleTimerInt = null;
let activeDoodleChoiceTimerInt = null;
let activeDoodleRevealTimeout = null;
let lastNotifiedDoodleAdvanceAt = 0;
let podiumCloseTimeout = null;

function clearDoodleTimers() {
    if (activeDoodleTimerInt) {
        clearInterval(activeDoodleTimerInt);
        activeDoodleTimerInt = null;
    }
    if (activeDoodleChoiceTimerInt) {
        clearInterval(activeDoodleChoiceTimerInt);
        activeDoodleChoiceTimerInt = null;
    }
    if (activeDoodleRevealTimeout) {
        clearTimeout(activeDoodleRevealTimeout);
        activeDoodleRevealTimeout = null;
    }
}

function cleanupLobbyCardListeners() {
    activeLobbyCardUnsubs.forEach(unsub => {
        if (typeof unsub === 'function') unsub();
    });
    activeLobbyCardUnsubs.clear();
}

function normalizeGameTypeKey(rawType) {
    const t = String(rawType || '').toLowerCase().trim();
    if (t === 'wordle' || t === 'word rush') return 'wordle';
    if (t === 'doodle' || t === 'doodle dash') return 'doodle';
    if (t === 'spy' || t.includes('spy')) return 'spy';
    return 'flags';
}

function getGameDisplayTitle(rawType) {
    const key = normalizeGameTypeKey(rawType);
    if (key === 'wordle') return 'Word Rush';
    if (key === 'doodle') return 'Doodle Dash';
    if (key === 'spy') return 'Spy';
    return 'World Flags';
}

function getPlayerDisplayName(playerEntry) {
    if (!playerEntry) return 'Player';
    if (typeof playerEntry === 'string') return playerEntry;
    return playerEntry.name || 'Player';
}

function cleanupDoodleListeners() {
    clearDoodleTimers();
    doodleUnsubs.forEach(u => {
        if (typeof u === 'function') u();
    });
    doodleUnsubs = [];
    const cvs = document.getElementById('doodle-canvas');
    if (cvs) {
        cvs.onpointerdown = null;
        cvs.onpointermove = null;
        cvs.onpointerup = null;
        cvs.onpointercancel = null;
    }
}

// --- GAME LOGIC ---
async function startGame(gameId, chatId = activeGameChatId || currentChatId) {
    if (!chatId || !gameId) {
        console.error('[Game] startGame called without chatId or gameId:', { chatId, gameId });
        return;
    }

    try {
        const targetGameRef = ref(db, `games/${chatId}/${gameId}`);
        const freshGameSnap = await get(targetGameRef);
        const gData = freshGameSnap.val();
        if (!gData) {
            console.error('[Game] startGame failed: game node not found at', `games/${chatId}/${gameId}`);
            showNotification("Game lobby no longer exists.", "error");
            return;
        }

        const freshPlayersList = Object.keys(gData.players || {});
        const lobbyType = normalizeGameTypeKey(gData.type || gData.gameType);
        if (lobbyType === 'spy') {
            if (freshPlayersList.length < 3) {
                return showNotification("Need at least 3 players to start Spy!", "error");
            }
            await window.startSpyGame(chatId, gameId);
            return;
        }
        if (freshPlayersList.length < 2) {
            return showNotification("Waiting for at least one more player to join!", "error");
        }

        const now = window.getServerTime();

        if (lobbyType === 'doodle') {
            let rounds = 3;
            const activeRoundBtn = document.querySelector('.round-btn.active');
            if (activeRoundBtn) rounds = parseInt(activeRoundBtn.getAttribute('data-val'), 10) || 3;

            const firstDrawerUid = freshPlayersList[0];
            const options = [];
            while (options.length < 3) {
                const word = DOODLE_WORDS[Math.floor(Math.random() * DOODLE_WORDS.length)];
                if (!options.includes(word)) options.push(word);
            }

            const durationMs = 60000;
            lastNotifiedDoodleAdvanceAt = 0;
            await update(targetGameRef, {
                status: 'choosing',
                type: 'doodle',
                gameType: 'Doodle Dash',
                startTime: now,
                startedAt: now,
                endTime: now + durationMs,
                turnOrder: freshPlayersList,
                currentTurnIndex: 0,
                currentRound: 1,
                maxRounds: rounds,
                drawer: firstDrawerUid,
                drawerUid: firstDrawerUid,
                wordOptions: options,
                guessedPlayers: null,
                turnLocks: null,
                lastAdvanceReason: null,
                lastAdvanceAt: null,
                turnExpiresAt: now + 10000 // 10 seconds to choose
            });
        } else if (lobbyType === 'wordle') {
            const targetWord = WORD_RUSH_WORDS[Math.floor(Math.random() * WORD_RUSH_WORDS.length)];
            const durationMs = 5 * 60000;
            await update(targetGameRef, {
                status: 'playing',
                type: 'wordle',
                gameType: 'Word Rush',
                targetWord: targetWord,
                startTime: now,
                startedAt: now,
                endTime: now + durationMs
            });
        } else {
            const slider = document.getElementById('game-duration-slider');
            const duration = (slider ? parseInt(slider.value, 10) : 5) || 5;
            const durationMs = duration * 60000;
            await update(targetGameRef, {
                status: 'playing',
                type: 'flags',
                gameType: 'World Flags',
                duration: duration,
                startTime: now,
                startedAt: now,
                endTime: now + durationMs
            });
        }
    } catch (err) {
        console.error('[Game] startGame error:', err);
        showNotification('Could not start game: ' + (err.code || err.message || 'Unknown error'), 'error');
    }
}
window.startGame = startGame;

async function setupGameLobby(gameType = 'flags', existingGameId = null) {
    if (!currentChatId) {
        showNotification("Please select a chat to play games.", "info");
        return;
    }
    if (!auth.currentUser) {
        showNotification("Please sign in to play games.", "error");
        return;
    }

    if (podiumCloseTimeout) {
        clearTimeout(podiumCloseTimeout);
        podiumCloseTimeout = null;
    }
    if (lobbyGameUnsub) {
        lobbyGameUnsub();
        lobbyGameUnsub = null;
    }
    if (wordleGameUnsub) {
        wordleGameUnsub();
        wordleGameUnsub = null;
    }
    if (flagsGameUnsub) {
        flagsGameUnsub();
        flagsGameUnsub = null;
    }
    if (activeLobbyPlayerRef) {
        try { await onDisconnect(activeLobbyPlayerRef).cancel(); } catch (_) {}
        activeLobbyPlayerRef = null;
    }
    cleanupDoodleListeners();
    if (typeof window.closeSpyGame === 'function') window.closeSpyGame(false);
    currentDoodleTurn = -1;
    currentDoodleRound = -1;
    currentDoodleStatus = null;
    isSubmittingDoodleGuess = false;
    isAdvancingDoodleTurn = false;
    gameStartedLocally = false;

    try {
        const chatId = currentChatId;
        const myUid = auth.currentUser.uid;
        const myName = document.getElementById('current-user-name')?.innerText || auth.currentUser.displayName || 'Player';
        const isCreator = !existingGameId;

        let gameId = existingGameId;
        let gameRef;
        let gameData = null;

        if (isCreator) {
            gameRef = push(ref(db, `games/${chatId}`));
            gameId = gameRef.key;
        } else {
            gameRef = ref(db, `games/${chatId}/${gameId}`);
            const gameSnap = await get(gameRef);
            if (!gameSnap.exists()) {
                showNotification("This game lobby has closed or expired.", "info");
                return;
            }
            gameData = gameSnap.val();

            // Handle 5-minute empty lobby closure
            if (gameData && gameData.emptySince && (Date.now() - gameData.emptySince > 5 * 60 * 1000)) {
                if (gameData.inviteMsgId) {
                    await update(ref(db, `messages/${chatId}/${gameData.inviteMsgId}`), { expired: true });
                }
                await remove(gameRef);
                showNotification("This game lobby expired due to inactivity.", "info");
                return;
            }

            if (gameData && gameData.status === 'finished') {
                showNotification("This game has already finished!", "info");
                return;
            }

            if (gameData && gameData.status !== 'lobby') {
                showNotification("This game is already in progress!", "error");
                return;
            }
        }

        activeGameId = gameId;
        activeGameChatId = chatId;

        const effectiveType = normalizeGameTypeKey((!isCreator && gameData) ? (gameData.type || gameData.gameType) : gameType);
        const displayGameType = getGameDisplayTitle(effectiveType);

        const lobbyTitle = document.getElementById('game-lobby-title');
        if (lobbyTitle) {
            lobbyTitle.innerText = `Game Settings: ${displayGameType}`;
        }
        const initialDoodleSettings = document.getElementById('doodle-settings');
        if (initialDoodleSettings) {
            initialDoodleSettings.style.display = effectiveType === 'doodle' ? 'flex' : 'none';
        }
        const initialDurationGroup = document.getElementById('game-duration-slider')?.closest('.field-group');
        if (initialDurationGroup) {
            initialDurationGroup.style.display = (isCreator && effectiveType === 'flags') ? 'block' : 'none';
        }

        const fgm = document.getElementById('flag-game-lobby-modal');
        if (fgm) openAnimatedModal(fgm);

        // If creator, setup initial game state under games/${chatId}/${gameId} and send invite message
        if (isCreator) {
            await set(gameRef, {
                gameId: gameId,
                gameType: displayGameType,
                type: effectiveType,
                host: myUid,
                hostId: myUid,
                creator: myUid,
                status: 'lobby',
                players: {
                    [myUid]: {
                        name: myName,
                        gold: 0,
                        score: 0,
                        joinedAt: serverTimestamp()
                    }
                },
                createdAt: Date.now()
            });

            // Send invite message containing gameId and gameType
            const msgRef = push(ref(db, `messages/${chatId}`));
            await update(msgRef, {
                sender: myUid,
                sender_id: myUid,
                sender_name: myName,
                text: `\u{1F3AE} Created a ${displayGameType} lobby!`,
                isGameInvite: true,
                gameInvite: true,
                gameId: gameId,
                gameType: displayGameType,
                type: effectiveType,
                timestamp: Date.now(),
                createdAt: serverTimestamp(),
                sender_badge: (isCurrentUserPremium && currentMyBadge) ? currentMyBadge : null
            });

            await update(gameRef, { inviteMsgId: msgRef.key });

            await update(ref(db, `chats/${chatId}`), {
                last_message: `\u{1F3AE} ${myName} started a game!`,
                timestamp: serverTimestamp()
            });
        }

        // Join the lobby
        const playerRef = ref(db, `games/${chatId}/${gameId}/players/${myUid}`);
        activeLobbyPlayerRef = playerRef;
        await update(playerRef, {
            name: myName,
            gold: 0,
            score: 0,
            joinedAt: serverTimestamp()
        });
        await update(gameRef, { emptySince: null });
        onDisconnect(playerRef).remove();

        lobbyGameUnsub = onValue(gameRef, async (snap) => {
            const data = snap.val();
            if (!data) {
                closeAnimatedModal(document.getElementById('flag-game-lobby-modal'));
                if (lobbyGameUnsub) {
                    lobbyGameUnsub();
                    lobbyGameUnsub = null;
                }
                return;
            }

            if ((data.status === 'playing' || data.status === 'active' || data.status === 'choosing' || data.status === 'reveal' || data.status === 'clues' || data.status === 'voting' || data.status === 'spy_guess') && !gameStartedLocally) {
                gameStartedLocally = true;
                activeGameId = gameId;
                activeGameChatId = chatId;
                if (lobbyGameUnsub) {
                    lobbyGameUnsub();
                    lobbyGameUnsub = null;
                }
                const resolvedType = normalizeGameTypeKey(data.type || data.gameType || effectiveType);
                if (resolvedType === 'wordle') {
                    closeAnimatedModal(document.getElementById('flag-game-lobby-modal'));
                    startWordleGame(data, gameId, chatId);
                } else if (resolvedType === 'doodle' && data.status !== 'finished') {
                    closeAnimatedModal(document.getElementById('flag-game-lobby-modal'));
                    startDoodleGame(data, gameId, chatId);
                } else if (resolvedType === 'spy' && data.status !== 'finished') {
                    closeAnimatedModal(document.getElementById('flag-game-lobby-modal'));
                    window.openSpyGame(gameId, chatId);
                } else {
                    startLocalGameUI(data, gameId, chatId);
                }
                return;
            }

            if (data.status === 'finished') {
                closeAnimatedModal(document.getElementById('flag-game-lobby-modal'));
                if (lobbyGameUnsub) {
                    lobbyGameUnsub();
                    lobbyGameUnsub = null;
                }
                return;
            }

            const lobbyType = normalizeGameTypeKey(data.type || data.gameType || effectiveType);
            if (lobbyTitle) {
                lobbyTitle.innerText = `Game Settings: ${getGameDisplayTitle(lobbyType)}`;
            }

            const players = data.players || {};
            const playerUids = Object.keys(players);
            const currentHostUid = data.hostId || data.host;

            // Host Transfer Logic: If host is missing, oldest player claims host
            if (playerUids.length > 0 && (!currentHostUid || !players[currentHostUid])) {
                let oldestUid = playerUids[0];
                let oldestTime = players[oldestUid]?.joinedAt || Date.now();
                for (const uid of playerUids) {
                    const pTime = players[uid]?.joinedAt || Date.now();
                    if (pTime < oldestTime) {
                        oldestUid = uid;
                        oldestTime = pTime;
                    }
                }
                if (oldestUid === myUid) {
                    update(gameRef, { host: myUid, hostId: myUid });
                }
            }

            const list = document.getElementById('lobby-players-list');
            if (list) {
                list.innerHTML = '';
                playerUids.forEach(uid => {
                    const div = document.createElement('div');
                    div.className = 'selection-item';
                    const isHost = uid === currentHostUid;
                    div.innerText = `\u{1F3AE} ${getPlayerDisplayName(players[uid])} ${isHost ? '\u{1F451}' : ''}`;
                    list.appendChild(div);
                });
            }

            const startBtn = document.getElementById('start-game-btn');
            if (startBtn) {
                const isHost = myUid === currentHostUid;
                const durationGroup = document.getElementById('game-duration-slider')?.closest('.field-group');
                if (durationGroup) durationGroup.style.display = (isHost && lobbyType === 'flags') ? 'block' : 'none';
                const doodleSettings = document.getElementById('doodle-settings');
                if (doodleSettings) doodleSettings.style.display = (isHost && lobbyType === 'doodle') ? 'flex' : 'none';

                startBtn.style.display = isHost ? 'block' : 'none';
                startBtn.disabled = lobbyType === 'spy' ? playerUids.length < 3 : (!currentChatData?.isGroup && playerUids.length < 2);
                startBtn.onclick = () => startGame(gameId, chatId);
            }
        });
    } catch (err) {
        console.error('[Game] Lobby initialization failed:', err);
        showNotification('Could not open game lobby: ' + (err.code || err.message), 'error');
        const modal = document.getElementById('flag-game-lobby-modal');
        if (modal) closeAnimatedModal(modal);
    }
}

function initFlagGame() {
    const pm = document.getElementById('plus-menu');
    if (pm) {
        pm.classList.add('hidden');
        pm.style.display = 'none';
    }
    setupGameLobby();
}
window.initFlagGame = initFlagGame;

window.closeFlagsGame = function() {
    const ui = document.getElementById('flags-game-ui'); // Match your exact ID
    if (ui) ui.style.display = 'none';
    if (window.flagsGameInterval) {
        clearInterval(window.flagsGameInterval);
        window.flagsGameInterval = null;
    }
    if (gameTimerInterval) {
        clearInterval(gameTimerInterval);
        gameTimerInterval = null;
    }
    if (flagsGameUnsub) {
        flagsGameUnsub();
        flagsGameUnsub = null;
    }
    gameStartedLocally = false;
    const screen = document.getElementById('flag-game-screen');
    if (screen) {
        closeAnimatedModal(screen);
        screen.style.display = 'none';
    }
    // Clear the end screen if it's visible
    const endScreen = document.getElementById('flags-end-screen');
    if (endScreen) {
        endScreen.style.display = 'none';
        endScreen.innerHTML = '';
    }
};

function startLocalGameUI(gameData, gameId = activeGameId, chatId = activeGameChatId || currentChatId) {
    if (!chatId || !gameId) {
        console.error('[Game] startLocalGameUI missing chatId or gameId:', { chatId, gameId });
        return;
    }
    activeGameId = gameId;
    activeGameChatId = chatId;
    closeAnimatedModal(document.getElementById('flag-game-lobby-modal'));
    const flagScreen = document.getElementById('flag-game-screen');
    if (flagScreen) flagScreen.style.display = 'flex';
    
    // Unlock input pointer events when a game starts
    const flagsUi = document.getElementById('flags-game-ui');
    if (flagsUi) {
        flagsUi.style.display = 'block';
        flagsUi.style.pointerEvents = 'auto';
    }

    // Ensure initial visibility is correct
    const flagsTimer = document.getElementById('flags-timer');
    if (flagsTimer) flagsTimer.style.display = 'block';
    const legacyTimer = document.getElementById('game-timer');
    if (legacyTimer) legacyTimer.style.display = 'none';
    document.getElementById('question-area').style.display = 'block';
    document.getElementById('chest-area').style.display = 'none';
    document.getElementById('podium-area').style.display = 'none';
    document.getElementById('game-leaderboard').style.display = 'block';
    const endStatsEl = document.getElementById('flags-end-screen');
    if (endStatsEl) {
        endStatsEl.style.display = 'block';
        endStatsEl.innerHTML = '';
    }
    const scoreDisplay = document.getElementById('flags-score-display');
    if (scoreDisplay) scoreDisplay.innerText = '$0';
    
    availableFlags = [...COUNTRIES_LIST]; // Refresh flag pool for session
    nextFlagRound();
    
    if (window.flagsGameInterval) clearInterval(window.flagsGameInterval);
    if (gameTimerInterval) clearInterval(gameTimerInterval);

    let activeEndTime = (gameData && gameData.endTime) ? gameData.endTime : (Date.now() + 300000);

    // Strict Timer Interval
    window.flagsGameInterval = setInterval(async () => {
        const timeLeft = Math.max(0, Math.floor((activeEndTime - Date.now()) / 1000));
        const timerEl = document.getElementById('flags-timer');
        if (timerEl) timerEl.innerText = `${timeLeft}s`;

        if (timeLeft <= 0 && gameData.status !== 'finished') {
            // First client to hit 0 tells Firebase the game is strictly over
            clearInterval(window.flagsGameInterval);
            await update(ref(db, `games/${chatId}/${gameId}`), { status: 'finished' });
            if (gameData && gameData.inviteMsgId) {
                update(ref(db, `messages/${chatId}/${gameData.inviteMsgId}`), { expired: true });
            }
        }
    }, 1000);
    gameTimerInterval = window.flagsGameInterval;

    if (flagsGameUnsub) {
        flagsGameUnsub();
        flagsGameUnsub = null;
    }

    let previousScore = undefined;
    const gameRef = ref(db, `games/${chatId}/${gameId}`);

    flagsGameUnsub = onValue(gameRef, async (snap) => {
        const currentData = snap.val();
        if (!currentData) return;

        // Add a strict status check at the top of your onValue listener
        if (currentData.status === 'finished') {
            if (window.flagsGameInterval) clearInterval(window.flagsGameInterval);
            if (gameTimerInterval) clearInterval(gameTimerInterval);
            const flagsUi = document.getElementById('flags-game-ui');
            if (flagsUi) flagsUi.style.pointerEvents = 'none'; // Lock inputs instantly
            gameStartedLocally = false;
            showPodium(null, gameId, chatId);
            renderFlagsEndStats(currentData);
            schedulePodiumCleanup(gameId, chatId);
            return; // Halt further game logic
        }

        if (currentData.endTime) {
            activeEndTime = currentData.endTime;
            gameData.endTime = currentData.endTime;
        }
        gameData.status = currentData.status;

        // Inside the game state listener, tracking previous score to detect a steal
        const currentScore = currentData.scores?.[auth.currentUser.uid] ?? currentData.players?.[auth.currentUser.uid]?.gold ?? 0;
        if (previousScore !== undefined && currentScore < previousScore) {
            const amountLost = previousScore - currentScore;
            if (typeof showNotification === 'function') {
                showNotification(`🚨 You were robbed of $${formatMoney(amountLost)}!`, "error");
            }
        }
        previousScore = currentScore; // Update tracker

        document.getElementById('flags-score-display').innerText = `$${formatMoney(currentScore)}`;

        // Update leaderboard
        const players = currentData.players || {};
        const leader = document.getElementById('leaderboard-content');
        if (leader) {
            leader.innerHTML = Object.values(players)
                .sort((a, b) => (b.gold || 0) - (a.gold || 0))
                .map(p => `<div><strong>${escapeHTML(getPlayerDisplayName(p))}</strong>: $${formatMoney(p.gold || 0)}</div>`)
                .join('');
        }
    });
}

function schedulePodiumCleanup(gameId = activeGameId, chatId = activeGameChatId || currentChatId) {
    if (podiumCloseTimeout) clearTimeout(podiumCloseTimeout);
    podiumCloseTimeout = setTimeout(() => {
        podiumCloseTimeout = null;
        const screen = document.getElementById('flag-game-screen');
        if (screen && screen.style.display !== 'none') {
            closeAnimatedModal(screen);
        }
        if (chatId && gameId) {
            get(ref(db, `games/${chatId}/${gameId}`)).then(snap => {
                if (snap.exists() && snap.val().status === 'finished') {
                    remove(ref(db, `games/${chatId}/${gameId}`));
                }
            });
        }
    }, 5 * 60 * 1000); // 5 minutes
}

async function showPodium(customPlayers = null, gameId = activeGameId, chatId = activeGameChatId || currentChatId) {
    const screen = document.getElementById('flag-game-screen');
    if (screen && (screen.style.display === 'none' || !screen.style.display)) {
        openAnimatedModal(screen);
    }
    const timerEl = document.getElementById('game-timer');
    if (timerEl) timerEl.style.display = 'none';
    const flagsTimerEl = document.getElementById('flags-timer');
    if (flagsTimerEl) flagsTimerEl.style.display = customPlayers ? 'none' : 'block';
    document.getElementById('question-area').style.display = 'none';
    document.getElementById('chest-area').style.display = 'none';
    document.getElementById('game-leaderboard').style.display = 'none';
    const podiumArea = document.getElementById('podium-area');
    const podiumList = document.getElementById('podium-list');
    podiumArea.style.display = 'flex';

    let sorted;
    const isWordle = Array.isArray(customPlayers);
    if (isWordle) {
        sorted = customPlayers;
    } else if (chatId && gameId) {
        const snap = await get(ref(db, `games/${chatId}/${gameId}`));
        const gameData = snap.val() || {};
        const players = gameData.players || {};
        sorted = Object.values(players).sort((a, b) => (b.gold || 0) - (a.gold || 0));
        renderFlagsEndStats(gameData);
    } else {
        sorted = [];
    }

    podiumList.innerHTML = sorted.map((p, i) => {
        let medal = "";
        if (i === 0) medal = "\u{1F947}";
        else if (i === 1) medal = "\u{1F948}";
        else if (i === 2) medal = "\u{1F949}";
        else medal = `${i + 1}th`;

        const scoreLabel = isWordle
            ? (p.scoreLabel || (p.won ? `${p.attempts || 0}/6 \u{2B50}` : 'X/6'))
            : `$${formatMoney(p.gold || 0)}`;

        return `
            <div class="podium-card ${i < 3 ? 'top-three' : ''}">
                <span style="font-weight: 800; font-size: 18px;">${medal} ${escapeHTML(getPlayerDisplayName(p))}</span>
                <span class="podium-gold">${scoreLabel}</span>
            </div>
        `;
    }).join('');
    
    const closePodiumBtn = document.getElementById('close-podium-btn');
    if (closePodiumBtn) {
        closePodiumBtn.onclick = async () => {
            if (podiumCloseTimeout) {
                clearTimeout(podiumCloseTimeout);
                podiumCloseTimeout = null;
            }
            if (flagsGameUnsub) {
                flagsGameUnsub();
                flagsGameUnsub = null;
            }
            if (window.flagsGameInterval) {
                clearInterval(window.flagsGameInterval);
                window.flagsGameInterval = null;
            }
            const flagsUi = document.getElementById('flags-game-ui');
            if (flagsUi) flagsUi.style.pointerEvents = 'auto';
            closeAnimatedModal(document.getElementById('flag-game-screen'));
        };
    }

    twemoji.parse(podiumList);
}

window.renderFlagsEndStats = function(gameData) {
    if (!gameData) return;
    const stats = gameData.stats || {};
    const scores = gameData.scores || {};
    const players = gameData.players || {}; // UID to username mapping

    const getTop = (category) => {
        if (!stats[category]) return { name: "Nobody", val: 0 };
        let topUid = null;
        let maxVal = -1;
        for (const [uid, val] of Object.entries(stats[category])) {
            if (val > maxVal) { maxVal = val; topUid = uid; }
        }
        const playerObj = players[topUid];
        const playerName = (typeof playerObj === 'object' ? playerObj?.name : playerObj) || "Unknown";
        return { name: playerName, val: maxVal > 0 ? maxVal : 0 };
    };

    const mostEarned = getTop('earned');
    const mostStolen = getTop('stolenAmount');
    const mostRobbed = getTop('timesRobbed');
    const mostLost = getTop('lostToRobbers');

    const statsHtml = `
        <div class="flags-end-stats" style="margin-top: 20px; padding: 15px; background: rgba(0,0,0,0.4); border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
            <h3 style="margin: 0 0 10px 0; color: #ffeb3b; text-align: center;">📊 Match Awards</h3>
            <ul style="list-style: none; padding: 0; margin: 0; font-size: 14px; line-height: 1.8;">
                <li>🏆 <strong>Biggest Brain:</strong> ${mostEarned.name} ($${formatMoney(mostEarned.val)} earned)</li>
                <li>🥷 <strong>Master Thief:</strong> ${mostStolen.name} ($${formatMoney(mostStolen.val)} stolen)</li>
                <li>🎯 <strong>Favorite Target:</strong> ${mostRobbed.name} (${formatMoney(mostRobbed.val)} times robbed)</li>
                <li>📉 <strong>Biggest Victim:</strong> ${mostLost.name} ($${formatMoney(mostLost.val)} lost)</li>
            </ul>
        </div>
    `;
    
    const endScreen = document.getElementById('flags-end-screen');
    if (endScreen && !endScreen.innerHTML.includes('Match Awards')) {
        endScreen.innerHTML += statsHtml;
    }
};

// --- WORD RUSH (MULTIPLAYER WORDLE) ENGINE ---
const WORD_RUSH_WORDS = [
"about", "above", "actor", "acute", "admit", "adopt", "adult", "after", "again", "agent",
"agree", "ahead", "alarm", "album", "alert", "alien", "alike", "alive", "allow", "alone",
"along", "alter", "among", "angel", "anger", "angle", "angry", "apart", "apple", "apply",
"arena", "argue", "arise", "array", "aside", "asset", "audio", "audit", "avoid", "award",
"aware", "bacon", "badly", "baker", "bases", "basic", "basis", "beach", "beast", "begin",
"begun", "being", "belly", "below", "bench", "birth", "black", "blame", "blind", "block",
"blood", "board", "boast", "bonus", "boost", "booth", "brain", "brake", "brand", "bread",
"break", "breed", "brick", "bride", "brief", "bring", "broad", "broke", "brown", "build",
"built", "buyer", "cable", "carry", "catch", "cause", "chain", "chair", "chart", "chase",
"cheap", "check", "chest", "chief", "child", "china", "chose", "civil", "claim", "class",
"clean", "clear", "click", "clock", "close", "coach", "coast", "could", "count", "court",
"cover", "crack", "craft", "crash", "crazy", "cream", "crime", "cross", "crowd", "crown",
"curve", "cycle", "daily", "dance", "dated", "dealt", "death", "debut", "delay", "depth",
"doing", "doubt", "dozen", "draft", "drama", "drawn", "dream", "dress", "drill", "drink",
"drive", "drove", "dying", "eager", "early", "earth", "eight", "elite", "empty", "enemy",
"enjoy", "enter", "entry", "equal", "error", "event", "every", "exact", "exist", "extra",
"faith", "false", "fault", "fiber", "field", "fifth", "fifty", "fight", "final", "first",
"fixed", "flash", "fleet", "floor", "fluid", "focus", "force", "forth", "forty", "forum",
"found", "frame", "frank", "fraud", "fresh", "front", "fruit", "fully", "funny", "giant",
"given", "glass", "globe", "going", "grace", "grade", "grand", "grant", "grass", "great",
"green", "gross", "group", "grown", "guard", "guess", "guest", "guide", "happy", "harsh",
"heart", "heavy", "hence", "horse", "hotel", "house", "human", "ideal", "image", "index",
"inner", "input", "issue", "joint", "judge", "known", "label", "large", "laser", "later",
"laugh", "layer", "learn", "lease", "least", "leave", "legal", "level", "light", "limit",
"local", "logic", "loose", "lower", "lucky", "magic", "major", "maker", "march", "match",
"mayor", "meant", "media", "metal", "might", "minor", "minus", "mixed", "model", "money",
"month", "moral", "motor", "mount", "mouse", "mouth", "movie", "music", "needs", "never",
"night", "noise", "north", "noted", "novel", "nurse", "occur", "ocean", "offer", "often",
"order", "other", "ought", "paint", "panel", "paper", "party", "peace", "phase", "phone",
"photo", "piece", "pilot", "pitch", "place", "plain", "plane", "plant", "plate", "point",
"pound", "power", "press", "price", "pride", "prime", "print", "prior", "prize", "proof",
"proud", "prove", "queen", "quick", "quiet", "quite", "radio", "raise", "range", "rapid",
"ratio", "reach", "ready", "realm", "rebel", "refer", "right", "rigid", "river", "roast",
"robot", "rough", "round", "route", "royal", "rural", "scale", "scene", "scope", "score",
"scout", "scrap", "sense", "serve", "seven", "shade", "shaft", "shake", "shall", "shape",
"share", "sharp", "sheet", "shelf", "shell", "shift", "shirt", "shock", "shoot", "short",
"shown", "sight", "since", "sixth", "sixty", "sized", "skill", "sleep", "slide", "small",
"smart", "smile", "smith", "smoke", "solid", "solve", "sorry", "sound", "south", "space",
"spare", "speak", "speed", "spend", "spent", "split", "spoke", "sport", "staff", "stage",
"stand", "start", "state", "steam", "steel", "stick", "still", "stock", "stone", "stood",
"store", "storm", "story", "strip", "stuck", "study", "stuff", "style", "sugar", "suite",
"super", "sweet", "table", "taken", "taste", "taxes", "teach", "teeth", "tenth", "Texas",
"thank", "theft", "their", "theme", "there", "these", "thick", "thing", "think", "third",
"those", "three", "threw", "throw", "tight", "times", "tired", "title", "today", "topic",
"total", "touch", "tough", "tower", "track", "trade", "train", "treat", "trend", "trial",
"tribe", "trick", "troop", "truck", "truly", "trust", "truth", "twice", "under", "undue",
"union", "unity", "until", "upper", "upset", "urban", "usage", "usual", "valid", "value",
"video", "virus", "visit", "vital", "voice", "voter", "waste", "watch", "water", "wheel",
"where", "which", "while", "white", "whole", "whose", "woman", "women", "world", "worry",
"worse", "worst", "worth", "would", "wound", "write", "wrong", "yield", "young", "youth",
"blaze", "blink", "blush", "brave", "brisk", "chili", "choke", "clamp", "clasp", "climb",
"clump", "crisp", "crush", "crust", "ditch", "dodge", "drift", "flair", "flake", "flame",
"flare", "flask", "flock", "flute", "fudge", "glare", "gleam", "glide", "glint", "gloom",
"glory", "glove", "grace", "grape", "grasp", "graze", "grind", "groom", "habit", "hatch",
"hover", "hurry", "juice", "kneel", "knack", "knock", "lemon", "liver", "llama", "lunar",
"mango", "marsh", "medal", "melon", "mercy", "miner", "mirth", "moist", "mound", "mourn",
"ninja", "oasis", "onion", "ounce", "panic", "patch", "pause", "pearl", "pecan", "perch",
"plank", "plump", "porch", "pouch", "prawn", "probe", "quack", "quail", "quake", "quilt",
"quirk", "radar", "rally", "razor", "relic", "rhino", "ridge", "rider", "rival", "rodeo",
"rouge", "rugby", "salsa", "satin", "sauce", "scoop", "scowl", "seize", "shark", "shave",
"shear", "shine", "shove", "shred", "shrub", "skate", "skirt", "skull", "slang", "slash",
"slice", "slick", "slime", "slump", "smack", "smash", "smear", "smell", "smirk", "snack",
"snail", "snake", "sneak", "sniff", "snoop", "snore", "snort", "snout", "spade", "spank",
"spark", "spasm", "spawn", "spear", "speck", "spell", "spice", "spike", "spill", "spine",
"spire", "splat", "spoil", "spool", "spoon", "spout", "spray", "spree", "squat", "squid",
"stack", "stain", "stair", "stake", "stalk", "stamp", "stare", "stark", "steak", "steal",
"steep", "steer", "stern", "sting", "stink", "stomp", "stool", "stoop", "stork", "strap",
"straw", "stray", "strut", "stump", "stung", "stunt", "suede", "swoop", "sword", "syrup",
"taffy", "tango", "tempo", "tiger", "toast", "towel", "toxic", "trace", "tramp", "tread",
"trout", "tulip", "tumor", "tunic", "twine", "twirl", "twist", "ulcer", "ultra", "uncle",
"unzip", "usher", "vapor", "vegan", "venom", "verge", "vicar", "vigil", "viola", "vivid",
"vocal", "vodka", "vogue", "vomit", "vowel", "wacky", "wafer", "wager", "wagon", "waltz",
"weave", "wedge", "weigh", "whale", "wheat", "whiff", "whisk", "whine", "widen", "widow",
"width", "witch", "woven", "wreck", "yacht", "zebra"
];
const wordleWordList = WORD_RUSH_WORDS;
const WORDLE_WORDS = WORD_RUSH_WORDS;
let currentGuess = '';
let guessHistory = [];
let wordleTarget = '';
let wordleFinished = false;
let isSubmittingWordle = false;

function startWordleGame(gameData, gameId = activeGameId, chatId = activeGameChatId || currentChatId) {
    activeGameId = gameId;
    activeGameChatId = chatId;
    wordleTarget = String(gameData.targetWord || '').toUpperCase();
    currentGuess = '';
    guessHistory = [];
    wordleFinished = false;
    isSubmittingWordle = false;

    const board = document.getElementById('wordle-board');
    board.innerHTML = '';
    for (let i = 0; i < 6; i++) {
        const row = document.createElement('div');
        row.style.cssText = 'display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px;';
        for (let j = 0; j < 5; j++) {
            const cell = document.createElement('div');
            cell.className = 'wordle-cell';
            cell.style.cssText = 'border: 2px solid var(--glass-border); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold; text-transform: uppercase; aspect-ratio: 1;';
            row.appendChild(cell);
        }
        board.appendChild(row);
    }

    // Simple QWERTY generation
    const kb = document.getElementById('wordle-keyboard');
    kb.innerHTML = '';
    const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
    rows.forEach((r, idx) => {
        const rowDiv = document.createElement('div');
        rowDiv.style.cssText = 'display: flex; gap: 4px; justify-content: center;';
        r.split('').forEach(letter => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.innerText = letter;
            btn.dataset.key = letter;
            btn.className = 'glass-btn-secondary kb-key';
            btn.style.cssText = 'flex: 1; padding: 12px 0; font-weight: bold; font-size: 14px;';
            btn.onclick = () => handleWordleInput(letter);
            rowDiv.appendChild(btn);
        });
        if (idx === 2) {
            const enter = document.createElement('button');
            enter.type = 'button';
            enter.innerText = 'ENTER';
            enter.className = 'glass-btn-secondary';
            enter.style.cssText = 'flex: 2; padding: 12px 4px; font-weight: bold; font-size: 12px; min-width: 0; border-radius: 8px;';
            enter.onclick = () => submitWordleGuess();
            rowDiv.prepend(enter);

            const del = document.createElement('button');
            del.type = 'button';
            del.innerText = '\u232B';
            del.className = 'glass-btn-secondary';
            del.style.cssText = 'flex: 1.5; padding: 12px 4px; font-weight: bold; font-size: 14px; min-width: 0; border-radius: 8px;';
            del.onclick = () => handleWordleInput('BACKSPACE');
            rowDiv.appendChild(del);
        }
        kb.appendChild(rowDiv);
    });

    const closeBtn = document.getElementById('close-wordle-btn');
    if (closeBtn) {
        closeBtn.onclick = async () => {
            if (wordleGameUnsub) {
                wordleGameUnsub();
                wordleGameUnsub = null;
            }
            gameStartedLocally = false;
            wordleFinished = true;
            closeAnimatedModal(document.getElementById('wordle-game-screen'));
            if (chatId && gameId && auth.currentUser) {
                const myUid = auth.currentUser.uid;
                const pRef = ref(db, `games/${chatId}/${gameId}/players/${myUid}`);
                try { await onDisconnect(pRef).cancel(); } catch (_) {}
                await remove(pRef);
                const pSnap = await get(ref(db, `games/${chatId}/${gameId}/players`));
                if (!pSnap.exists() || Object.keys(pSnap.val()).length === 0) {
                    await update(ref(db, `games/${chatId}/${gameId}`), { emptySince: serverTimestamp() });
                }
            }
        };
    }

    const screen = document.getElementById('wordle-game-screen');
    openAnimatedModal(screen);
    if (window.twemoji) twemoji.parse(screen);
    listenToWordleProgress(gameId, chatId);
}

function handleWordleInput(key) {
    if (wordleFinished || isSubmittingWordle || guessHistory.length >= 6) return;
    if (key === 'BACKSPACE') {
        currentGuess = currentGuess.slice(0, -1);
    } else if (/^[A-Z]$/.test(key) && currentGuess.length < 5) {
        currentGuess += key;
    }
    updateWordleBoard();
}

function updateKeyboardKeyColor(letter, color, priority) {
    const keyBtn = document.querySelector(`#wordle-keyboard .kb-key[data-key="${letter}"]`);
    if (!keyBtn) return;
    const prevPriority = parseInt(keyBtn.dataset.priority || '0', 10);
    if (priority > prevPriority) {
        keyBtn.dataset.priority = String(priority);
        keyBtn.style.backgroundColor = color;
        keyBtn.style.borderColor = color;
        keyBtn.style.color = '#fff';
    }
}

async function submitWordleGuess() {
    if (wordleFinished || isSubmittingWordle || guessHistory.length >= 6) return;
    if (currentGuess.length !== 5) return showNotification("Word must be 5 letters", "error");

    isSubmittingWordle = true;
    try {
        // Dictionary API Validation
        try {
            const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${currentGuess}`);
            if (!res.ok && res.status === 404) {
                return showNotification("Not in word list!", "error");
            }
        } catch (err) {
            console.warn("[Word Rush] Dictionary API offline, bypassing check.");
        }

        const targetArr = wordleTarget.split('');
        const guessArr = currentGuess.split('');
        const rowIdx = guessHistory.length;
        const rowCells = document.getElementById('wordle-board').children[rowIdx].children;

        // Color logic: Pass 1 exact matches (consume letters to prevent duplicate yellows)
        let correctCount = 0;
        guessArr.forEach((letter, i) => {
            if (letter === targetArr[i]) {
                rowCells[i].style.backgroundColor = '#4caf50'; // Green
                rowCells[i].style.borderColor = '#4caf50';
                targetArr[i] = null; // Consume
                correctCount++;
                updateKeyboardKeyColor(letter, '#4caf50', 3);
            }
        });
        // Pass 2 present-elsewhere or absent
        guessArr.forEach((letter, i) => {
            if (letter !== wordleTarget[i] && targetArr.includes(letter)) {
                rowCells[i].style.backgroundColor = '#ff9800'; // Yellow
                rowCells[i].style.borderColor = '#ff9800';
                targetArr[targetArr.indexOf(letter)] = null; // Consume
                updateKeyboardKeyColor(letter, '#ff9800', 2);
            } else if (letter !== wordleTarget[i]) {
                rowCells[i].style.backgroundColor = '#444'; // Gray
                rowCells[i].style.borderColor = '#444';
                updateKeyboardKeyColor(letter, '#444', 1);
            }
        });

        guessHistory.push(currentGuess);
        currentGuess = '';

        const won = correctCount === 5;
        const lost = guessHistory.length === 6;
        if (won || lost) {
            wordleFinished = true;
        }

        // Sync progress
        const targetChatId = activeGameChatId || currentChatId;
        if (targetChatId && activeGameId && auth.currentUser) {
            const myRef = ref(db, `games/${targetChatId}/${activeGameId}/players/${auth.currentUser.uid}`);
            await update(myRef, {
                attempts: guessHistory.length,
                won: won,
                finishedAt: (won || lost) ? Date.now() : null
            });
        }

        if (won) showNotification("You guessed it! Waiting for others...", "success");
        if (lost && !won) showNotification(`Game Over. The word was ${wordleTarget}`, "error");
    } finally {
        isSubmittingWordle = false;
    }
}

function updateWordleBoard() {
    if (guessHistory.length >= 6) return;
    const board = document.getElementById('wordle-board');
    if (!board || !board.children[guessHistory.length]) return;
    const rowCells = board.children[guessHistory.length].children;
    for (let i = 0; i < 5; i++) {
        rowCells[i].innerText = currentGuess[i] || '';
    }
}

function listenToWordleProgress(gameId = activeGameId, chatId = activeGameChatId || currentChatId) {
    if (!chatId || !gameId) return;
    if (wordleGameUnsub) {
        wordleGameUnsub();
        wordleGameUnsub = null;
    }
    const gameRef = ref(db, `games/${chatId}/${gameId}`);
    wordleGameUnsub = onValue(gameRef, (snap) => {
        const data = snap.val();
        if (!data || data.status === 'finished') return;

        const players = Object.values(data.players || {});
        const statusDiv = document.getElementById('wordle-opponent-status');
        if (statusDiv) {
            statusDiv.innerHTML = players.map(p =>
                `<div style="font-size:12px; padding:4px 8px; border-radius:12px; background:${p.finishedAt ? (p.won ? '#4caf50' : '#f44336') : 'rgba(255,255,255,0.1)'}">
                    ${escapeHTML(getPlayerDisplayName(p).split(' ')[0])}: ${p.attempts || 0}/6
                </div>`
            ).join('');
        }

        // Check if ALL active players have finished
        const allFinished = players.length > 0 && players.every(p => p.finishedAt);
        if (allFinished && data.status !== 'finished') {
            if (wordleGameUnsub) {
                wordleGameUnsub();
                wordleGameUnsub = null;
            }
            gameStartedLocally = false;
            // Rank: Winners first (sorted by fewest attempts, then fastest time), then losers
            players.sort((a, b) => {
                if (a.won !== b.won) return a.won ? -1 : 1;
                if (a.attempts !== b.attempts) return a.attempts - b.attempts;
                return a.finishedAt - b.finishedAt;
            });

            update(gameRef, { status: 'finished' });
            if (data.inviteMsgId) {
                update(ref(db, `messages/${chatId}/${data.inviteMsgId}`), { expired: true });
            }
            closeAnimatedModal(document.getElementById('wordle-game-screen'));
            showPodium(players, gameId, chatId); // Hook into existing podium UI
            schedulePodiumCleanup(gameId, chatId);
        }
    });
}

// Physical keyboard support while Word Rush modal is open
document.addEventListener('keydown', (e) => {
    const screen = document.getElementById('wordle-game-screen');
    if (!screen || screen.style.display !== 'flex' || wordleFinished) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') {
        e.preventDefault();
        submitWordleGuess();
    } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleWordleInput('BACKSPACE');
    } else if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        handleWordleInput(e.key.toUpperCase());
    }
});

// Custom Doodle Dash segmented rounds & color palette delegation
document.addEventListener('click', (e) => {
    const roundBtn = e.target && e.target.closest ? e.target.closest('.round-btn') : null;
    if (roundBtn) {
        document.querySelectorAll('.round-btn').forEach(b => b.classList.remove('active'));
        roundBtn.classList.add('active');
    }
    const swatch = e.target && e.target.closest ? e.target.closest('.color-swatch') : null;
    if (swatch) {
        if (e.target && e.target.id === 'doodle-rgb-picker') return;
        document.querySelectorAll('.color-swatch').forEach(c => c.classList.remove('active'));
        swatch.classList.add('active');
        const colorInput = document.getElementById('doodle-color');
        if (colorInput) colorInput.value = swatch.getAttribute('data-color');
    }
});

document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'doodle-rgb-picker') {
        const colorInput = document.getElementById('doodle-color');
        if (colorInput) colorInput.value = e.target.value;
        document.querySelectorAll('.color-swatch').forEach(c => c.classList.remove('active'));
        if (e.target.parentElement) {
            e.target.parentElement.setAttribute('data-color', e.target.value);
            e.target.parentElement.classList.add('active');
        }
    }
});

// --- DOODLE DASH (MULTIPLAYER PICTIONARY) ENGINE ---
const DOODLE_WORDS = [
"apple", "banana", "helicopter", "elephant", "guitar", "mountain", "ocean", "pizza", "robot", "spider", "telescope", "umbrella", "volcano", "window", "zebra", "astronaut", "butterfly", "castle", "dragon", "engine", "firefighter", "ghost", "hospital", "island", "jungle", "kangaroo", "lighthouse", "mermaid", "ninja", "octopus", "penguin", "queen", "rocket", "submarine", "tornado", "unicorn", "vampire", "wizard", "xylophone", "yacht", "zombie", "airplane", "bridge", "camera", "diamond", "eagle", "forest", "galaxy", "hammer", "igloo", "jacket", "kettle", "ladder", "magnet", "needle", "ostrich", "parachute", "quilt", "radar", "scissors", "tractor", "ukulele", "vacuum", "windmill", "yoyo", "zeppelin", "anchor", "balloon", "cactus", "dolphin", "escalator", "fountain", "giraffe", "helmet", "iceberg", "jigsaw", "kayak", "lantern", "microscope", "notebook", "origami", "padlock", "compass", "rainbow", "satellite", "thermometer", "unicycle", "violin", "waterfall", "alligator", "avalanche", "backpack", "barbecue", "basketball", "binoculars", "blizzard", "boomerang", "bulldozer", "campfire", "caterpillar", "chandelier", "cheeseburger", "chocolate", "coconut", "crocodile", "dinosaur", "electricity", "flamingo", "glacier", "hamburger", "hedgehog", "hippopotamus", "hurricane", "jellyfish", "keyboard", "leopard", "limousine", "macaroni", "microphone", "motorcycle", "mushroom", "orchestra", "pancake", "pineapple", "platypus", "porcupine", "rhinoceros", "saxophone", "skeleton", "snowflake", "sombrero", "spaghetti", "squirrel", "strawberry", "sunflower", "symphony", "tarantula", "thunderstorm", "toothbrush", "trampoline", "typewriter", "vegetable", "volleyball", "watermelon", "wheelchair", "woodpecker", "zucchini", "acorn", "alarm", "alien", "ambulance", "ant", "apron", "arch", "arm", "armor", "arrow", "axe", "baby", "bacon", "badge", "bag", "bait", "baker", "ball", "bamboo", "band", "bank", "bar", "barn", "bat", "bath", "bear", "beard", "bed", "bee", "beef", "bell", "belt", "bench", "bike", "bird", "boat", "bone", "book", "boot", "bow", "bowl", "box", "boy", "brain", "branch", "bread", "brick", "broom", "brush", "bug", "bulb", "bull", "bus", "bush", "butter", "button", "cabin", "cable", "cake", "camel", "camp", "can", "candle", "candy", "cane", "cap", "car", "card", "cart", "cat", "cave", "chain", "chair", "chalk", "chef", "cherry", "chess", "chest", "chin", "chip", "church", "circle", "clam", "clock", "cloud", "clown", "club", "coal", "coat", "coin", "comb", "cone", "cook", "cord", "cork", "corn", "cow", "crab", "crane", "crow", "crown", "cube", "cup", "dart", "dash", "date", "deer", "desk", "dial", "dice", "dirt", "dish", "dog", "doll", "door", "dot", "dove", "drop", "drum", "duck", "dust", "ear", "earth", "egg", "elf", "eye", "face", "fan", "farm", "feather", "fence", "fern", "film", "fire", "fish", "flag", "flame", "fly", "fog", "foot", "fork", "frog", "fuel", "game", "gap", "gas", "gate", "gear", "gem", "girl", "glass", "globe", "glove", "goat", "gold", "golf", "goose", "grape", "grass", "grid", "grill", "gum", "hair", "hall", "hand", "harp", "hat", "hawk", "head", "heart", "heel", "hill", "hole", "home", "hook", "horn", "horse", "hose", "house", "hut", "ice", "ink", "iron", "jam", "jar", "jaw", "jeep", "jelly", "jet", "jewel", "juice", "jump", "key", "kid", "king", "kite", "knee", "knife", "knot", "lace", "lake", "lamp", "land", "lane", "leaf", "leg", "lemon", "lens", "lion", "lip", "lock", "log", "loop", "lung", "mail", "map", "mask", "mat", "match", "math", "meal", "meat", "melon", "milk", "mint", "mirror", "moon", "moth", "mouse", "mouth", "mud", "mug", "nail", "name", "neck", "nest", "net", "news", "night", "noise", "nose", "note", "nut", "oar", "oil", "onion", "oven", "owl", "page", "pail", "pain", "paint", "pan", "pants", "paper", "park", "part", "party", "path", "paw", "pea", "peach", "pear", "pen", "pencil", "pet", "pie", "pig", "pill", "pin", "pipe", "plant", "plate", "plug", "plum", "pocket", "poem", "pole", "pond", "pool", "pork", "port", "post", "pot", "potato", "prop", "pump", "pup", "raft", "rag", "rail", "rain", "rake", "ram", "rat", "ray", "rib", "rice", "ring", "river", "road", "rock", "roll", "roof", "room", "root", "rope", "rose", "rub", "rug", "rule", "sack", "sail", "salt", "sand", "saw", "scale", "scarf", "school", "scoop", "seat", "seed", "shark", "sheep", "sheet", "shell", "ship", "shirt", "shoe", "shop", "sign", "silk", "sink", "skate", "skin", "skirt", "sky", "sled", "sleep", "slide", "slug", "snail", "snake", "snow", "soap", "sock", "soil", "song", "soup", "space", "spade", "spark", "spear", "sponge", "spoon", "spot", "spring", "square", "star", "steam", "stem", "step", "stew", "stick", "stone", "stool", "stop", "store", "storm", "story", "stove", "straw", "street", "string", "suit", "sun", "swan", "swing", "sword", "table", "tail", "tank", "tape", "tax", "tea", "tear", "teeth", "tent", "test", "text", "thread", "throat", "thumb", "tick", "tie", "tiger", "time", "tin", "tire", "toad", "toe", "tomato", "tongue", "tool", "tooth", "top", "town", "toy", "track", "trail", "train", "trap", "tree", "trip", "truck", "tube", "tub", "twig", "twin", "vase", "veil", "vein", "vest", "vine", "voice", "wagon", "wall", "walnut", "wasp", "watch", "wave", "wax", "web", "weed", "well", "whale", "wheat", "wheel", "whip", "wind", "wing", "wire", "wolf", "wood", "wool", "worm", "yard", "yarn", "year", "yolk", "zero", "zinc", "zip", "zone"
];

let currentDoodleRound = -1;
let currentDoodleStatus = null;
let currentDoodleTool = 'pen';

function hexToRgba(hex) {
    if (!hex || typeof hex !== 'string') return [0, 0, 0, 255];
    let clean = hex.replace('#', '');
    if (clean.length === 3) {
        clean = clean.split('').map(c => c + c).join('');
    }
    const r = parseInt(clean.slice(0, 2), 16) || 0;
    const g = parseInt(clean.slice(2, 4), 16) || 0;
    const b = parseInt(clean.slice(4, 6), 16) || 0;
    return [r, g, b, 255];
}

window.emitCanvasUpdate = function() {
    const chatId = activeGameChatId || currentChatId;
    if (!chatId || !activeGameId || !auth.currentUser) return;
    const canvas = document.getElementById('doodle-canvas');
    if (!canvas) return;
    try {
        const dataUrl = canvas.toDataURL('image/png');
        update(ref(db, `games/${chatId}/${activeGameId}/doodle`), {
            snapshot: dataUrl,
            snapshotAt: Date.now()
        }).catch(err => console.error("Error emitting canvas update:", err));
    } catch (err) {
        console.error("Canvas toDataURL error:", err);
    }
};

window.fillCanvas = function(startX, startY, fillColorHex) {
    const canvas = document.getElementById('doodle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    
    const clampedX = Math.max(0, Math.min(canvas.width - 1, Math.floor(startX)));
    const clampedY = Math.max(0, Math.min(canvas.height - 1, Math.floor(startY)));

    const startPos = (clampedY * canvas.width + clampedX) * 4;
    const startColor = [data[startPos], data[startPos+1], data[startPos+2], data[startPos+3]];
    const fillColor = hexToRgba(fillColorHex);
    
    if (startColor[0] === fillColor[0] && startColor[1] === fillColor[1] && startColor[2] === fillColor[2]) return;
    
    const matchColor = (pos) => data[pos] === startColor[0] && data[pos+1] === startColor[1] && data[pos+2] === startColor[2] && data[pos+3] === startColor[3];
    const colorPixel = (pos) => { data[pos] = fillColor[0]; data[pos+1] = fillColor[1]; data[pos+2] = fillColor[2]; data[pos+3] = 255; };
    
    const stack = [[clampedX, clampedY]];
    while (stack.length) {
        const [x, y] = stack.pop();
        let pos = (y * canvas.width + x) * 4;
        let dy = y;
        while (dy >= 0 && matchColor(pos)) { pos -= canvas.width * 4; dy--; }
        pos += canvas.width * 4; dy++;
        
        let reachLeft = false, reachRight = false;
        while (dy < canvas.height && matchColor(pos)) {
            colorPixel(pos);
            if (x > 0) {
                if (matchColor(pos - 4)) { if (!reachLeft) { stack.push([x - 1, dy]); reachLeft = true; } }
                else reachLeft = false;
            }
            if (x < canvas.width - 1) {
                if (matchColor(pos + 4)) { if (!reachRight) { stack.push([x + 1, dy]); reachRight = true; } }
                else reachRight = false;
            }
            pos += canvas.width * 4; dy++;
        }
    }
    ctx.putImageData(imgData, 0, 0);
    // Ensure bucket fill is emitted to Firebase as a full-canvas image snapshot so other players see it instantly
    emitCanvasUpdate(); 
};

window.selectDoodleWord = async (chosenWord) => {
    const chatId = activeGameChatId || currentChatId;
    if (!chatId || !activeGameId) return;
    const gameRef = ref(db, `games/${chatId}/${activeGameId}`);
    const snap = await get(gameRef);
    const g = snap.val();
    if (!g || g.status !== 'choosing') return;

    const word = chosenWord || (g.wordOptions && g.wordOptions[0]) || DOODLE_WORDS[0];
    const requestedRoundTime = (word.length * 5 + 30) * 1000;
    const roundDuration = Math.max(30000, requestedRoundTime);
    const now = window.getServerTime();
    const updatedUsedWords = [...(g.usedWords || []), word];

    await update(gameRef, {
        status: 'playing',
        targetWord: word,
        word: word,
        usedWords: updatedUsedWords,
        guessedPlayers: null,
        roundStartTime: now,
        startedAt: now,
        roundExpiresAt: now + roundDuration,
        turnEndTime: now + roundDuration,
        wordOptions: null,
        turnExpiresAt: null
    });
};

function startDoodleGame(gameData, gameId = activeGameId, chatId = activeGameChatId || currentChatId) {
    if (!chatId || !gameId || !auth.currentUser) return;
    if (gameData.status === 'finished') return;
    if (gameData.currentTurnIndex === currentDoodleTurn && 
        gameData.currentRound === currentDoodleRound && 
        gameData.status === currentDoodleStatus) return;

    activeGameId = gameId;
    activeGameChatId = chatId;
    currentDoodleTurn = gameData.currentTurnIndex;
    currentDoodleRound = gameData.currentRound;
    currentDoodleStatus = gameData.status;

    const screen = document.getElementById('doodle-game-screen');
    const cvs = document.getElementById('doodle-canvas');
    const statusEl = document.getElementById('doodle-status');
    const wordDisplayEl = document.getElementById('doodle-word-display');
    const chatBoxEl = document.getElementById('doodle-chat-box');
    const selectionOverlay = document.getElementById('doodle-word-selection-overlay');
    const choiceTitle = document.getElementById('doodle-choice-title');
    const choiceTimer = document.getElementById('doodle-choice-timer');
    const choiceButtons = document.getElementById('doodle-choice-buttons');
    if (!screen || !cvs) return;

    const myUid = auth.currentUser.uid;
    const drawerUid = gameData.drawer || gameData.drawerUid;
    const isDrawer = (myUid === drawerUid);

    window.localGuessedCorrect = !!(gameData.guessedPlayers?.[myUid] || gameData.players?.[myUid]?.guessedCorrect);
    if (chatBoxEl && gameData.status === 'choosing') chatBoxEl.innerHTML = '';

    // Open modal before reading canvas clientWidth/clientHeight so layout size is non-zero
    openAnimatedModal(screen);
    if (window.twemoji) twemoji.parse(screen);

    const ctx = cvs.getContext('2d', { willReadFrequently: true });
    cvs.width = cvs.clientWidth || 320;
    cvs.height = cvs.clientHeight || 320;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    cleanupDoodleListeners();

    // Setup Tools
    const penBtn = document.getElementById('doodle-tool-pen');
    const bucketBtn = document.getElementById('doodle-tool-bucket');
    const eraserBtn = document.getElementById('doodle-tool-eraser');

    const updateToolBtns = () => {
        [penBtn, bucketBtn, eraserBtn].forEach(b => b && b.classList.remove('active'));
        if (currentDoodleTool === 'pen' && penBtn) penBtn.classList.add('active');
        if (currentDoodleTool === 'bucket' && bucketBtn) bucketBtn.classList.add('active');
        if (currentDoodleTool === 'eraser' && eraserBtn) eraserBtn.classList.add('active');
    };

    if (penBtn) penBtn.onclick = () => { currentDoodleTool = 'pen'; updateToolBtns(); };
    if (bucketBtn) bucketBtn.onclick = () => { currentDoodleTool = 'bucket'; updateToolBtns(); };
    if (eraserBtn) eraserBtn.onclick = () => { currentDoodleTool = 'eraser'; updateToolBtns(); };
    updateToolBtns();

    if (gameData.status === 'choosing') {
        cvs.style.opacity = '0.4';
        document.getElementById('doodle-tools').style.display = 'none';
        document.getElementById('doodle-guess-area').style.display = 'none';
        if (wordDisplayEl) wordDisplayEl.innerText = '';
        if (statusEl) statusEl.innerText = `Round ${gameData.currentRound || 1}/${gameData.maxRounds || 3}`;

        if (selectionOverlay) selectionOverlay.style.display = 'flex';

        const options = gameData.wordOptions || [];
        if (isDrawer) {
            if (choiceTitle) choiceTitle.innerText = "Choose a word to draw";
            if (choiceButtons) {
                choiceButtons.innerHTML = '';
                options.forEach(word => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'glass-btn-primary';
                    btn.style.cssText = 'padding: 12px 18px; font-size: 16px; font-weight: 700; text-transform: capitalize; border-radius: 12px; cursor: pointer;';
                    btn.innerText = word;
                    btn.onclick = () => {
                        window.selectDoodleWord(word);
                    };
                    choiceButtons.appendChild(btn);
                });
            }
        } else {
            const drawerName = getPlayerDisplayName(gameData.players?.[drawerUid]).split(' ')[0] || 'Drawer';
            if (choiceTitle) choiceTitle.innerText = `${drawerName} is choosing a word...`;
            if (choiceButtons) choiceButtons.innerHTML = '<div style="opacity: 0.6; font-size: 14px; margin-top: 8px;">Get ready to guess!</div>';
        }

        let choiceExpiredTriggered = false;
        const updateChoiceTimer = () => {
            const leftSec = Math.max(0, Math.ceil(((gameData.turnExpiresAt || (window.getServerTime() + 10000)) - window.getServerTime()) / 1000));
            if (choiceTimer) choiceTimer.innerText = `${leftSec}s`;
            if (leftSec <= 0 && !choiceExpiredTriggered) {
                choiceExpiredTriggered = true;
                if (activeDoodleChoiceTimerInt) {
                    clearInterval(activeDoodleChoiceTimerInt);
                    activeDoodleChoiceTimerInt = null;
                }
                if (isDrawer || auth.currentUser.uid === (gameData.hostId || gameData.host)) {
                    window.selectDoodleWord(options[0] || DOODLE_WORDS[0]);
                }
            }
        };
        activeDoodleChoiceTimerInt = setInterval(updateChoiceTimer, 1000);
        updateChoiceTimer();
        doodleUnsubs.push(() => {
            if (activeDoodleChoiceTimerInt) {
                clearInterval(activeDoodleChoiceTimerInt);
                activeDoodleChoiceTimerInt = null;
            }
        });

    } else if (gameData.status === 'playing') {
        if (selectionOverlay) selectionOverlay.style.display = 'none';
        cvs.style.opacity = '1';
        document.getElementById('doodle-tools').style.display = isDrawer ? 'flex' : 'none';
        document.getElementById('doodle-guess-area').style.display = isDrawer ? 'none' : 'flex';

        const guessInput = document.getElementById('doodle-guess-input');
        if (guessInput) {
            guessInput.value = '';
            guessInput.placeholder = window.localGuessedCorrect ? 'Guessed! Chat with winners...' : 'Type your guess...';
            guessInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    window.submitDoodleGuess();
                }
            };
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cvs.width, cvs.height);

        let currentRoundStatus = 'playing';
        let revealTriggered = false;

        const roundExpiresAt = gameData.roundExpiresAt || gameData.turnEndTime || (window.getServerTime() + 30000);
        const roundStartTime = gameData.roundStartTime || gameData.startedAt || (window.getServerTime() - 1000);
        const currentWord = gameData.targetWord || gameData.word || "";

        const updateTimerText = () => {
            if (currentRoundStatus !== 'playing') return;
            const serverNow = window.getServerTime();
            const timeLeft = Math.max(0, Math.floor((roundExpiresAt - serverNow) / 1000));
            const timeElapsed = serverNow - roundStartTime;

            let displayWord = "";
            if (isDrawer) {
                displayWord = currentWord;
            } else {
                const maxHints = currentWord.length <= 4 ? 2 : 3;
                let revealedIndices = [];
                
                // Seed random based on the word itself so hints don't flicker
                if (timeElapsed >= 10000) {
                    for (let i = 0; i < maxHints; i++) {
                        revealedIndices.push((currentWord.length * (i + 7)) % currentWord.length);
                    }
                }
                
                displayWord = currentWord.split('').map((char, index) => {
                    return revealedIndices.includes(index) ? char : '_';
                }).join(' ');
            }

            // Set the UI Layout: _ _ _ _ _ (5) 30s
            if (wordDisplayEl) {
                wordDisplayEl.innerText = `${displayWord} (${currentWord.length}) ${timeLeft}s`;
            }
            if (statusEl) {
                statusEl.innerText = `Round ${gameData.currentRound || 1}/${gameData.maxRounds || 3} • ${isDrawer ? 'You are drawing!' : 'Type your guess below'}`;
            }

            if (timeLeft <= 0 && isDrawer && !revealTriggered) {
                revealTriggered = true;
                currentRoundStatus = 'reveal';
                if (activeDoodleTimerInt) {
                    clearInterval(activeDoodleTimerInt);
                    activeDoodleTimerInt = null;
                }
                update(ref(db, `games/${chatId}/${gameId}`), { status: 'reveal' });
            }
        };

        activeDoodleTimerInt = setInterval(updateTimerText, 1000);
        updateTimerText();
        doodleUnsubs.push(() => {
            clearDoodleTimers();
        });

        // Drawer pointer handling (drawing, eraser, bucket)
        if (isDrawer) {
            let drawing = false, lx = 0, ly = 0;
            const getPos = (e) => {
                const r = cvs.getBoundingClientRect();
                const evt = e.touches ? e.touches[0] : e;
                const scaleX = cvs.width / (r.width || 1);
                const scaleY = cvs.height / (r.height || 1);
                return {
                    x: (evt.clientX - r.left) * scaleX,
                    y: (evt.clientY - r.top) * scaleY
                };
            };

            cvs.onpointerdown = (e) => {
                if (e.cancelable) e.preventDefault();
                if (cvs.setPointerCapture && e.pointerId !== undefined) {
                    try { cvs.setPointerCapture(e.pointerId); } catch (_) {}
                }
                const p = getPos(e);
                if (currentDoodleTool === 'bucket') {
                    const col = document.getElementById('doodle-color').value || '#000000';
                    window.fillCanvas(p.x, p.y, col);
                    return;
                }
                drawing = true;
                lx = p.x;
                ly = p.y;
            };
            cvs.onpointerup = () => { drawing = false; };
            cvs.onpointercancel = () => { drawing = false; };
            cvs.onpointermove = (e) => {
                if (!drawing || currentDoodleTool === 'bucket') return;
                if (e.cancelable) e.preventDefault();

                const p = getPos(e);
                const col = currentDoodleTool === 'eraser' ? '#ffffff' : document.getElementById('doodle-color').value;
                const rawSize = parseInt(document.getElementById('doodle-size').value, 10) || 5;
                const size = currentDoodleTool === 'eraser' ? rawSize * 2 : rawSize;

                ctx.beginPath();
                ctx.moveTo(lx, ly);
                ctx.lineTo(p.x, p.y);
                ctx.strokeStyle = col;
                ctx.lineWidth = size;
                ctx.stroke();

                push(ref(db, `games/${chatId}/${gameId}/doodle/strokes`), {
                    x0: lx / cvs.width,
                    y0: ly / cvs.height,
                    x1: p.x / cvs.width,
                    y1: p.y / cvs.height,
                    c: col,
                    s: size
                });
                lx = p.x;
                ly = p.y;
            };
        }
    }

    let doodleEnded = false;
    const closeDoodleBtn = document.getElementById('close-doodle-btn');
    if (closeDoodleBtn) {
        closeDoodleBtn.onclick = async () => {
            doodleEnded = true;
            cleanupDoodleListeners();
            currentDoodleTurn = -1;
            currentDoodleRound = -1;
            currentDoodleStatus = null;
            gameStartedLocally = false;
            closeAnimatedModal(screen);
            if (chatId && gameId && auth.currentUser) {
                const pRef = ref(db, `games/${chatId}/${gameId}/players/${myUid}`);
                try { await onDisconnect(pRef).cancel(); } catch (_) {}
                await remove(pRef);
                const pSnap = await get(ref(db, `games/${chatId}/${gameId}/players`));
                if (!pSnap.exists() || Object.keys(pSnap.val()).length === 0) {
                    await update(ref(db, `games/${chatId}/${gameId}`), { emptySince: serverTimestamp() });
                }
            }
        };
    }

    const unSubStrokes = onChildAdded(ref(db, `games/${chatId}/${gameId}/doodle/strokes`), snap => {
        if (isDrawer) return;
        const val = snap.val();
        if (!val) return;
        ctx.beginPath();
        ctx.moveTo(val.x0 * cvs.width, val.y0 * cvs.height);
        ctx.lineTo(val.x1 * cvs.width, val.y1 * cvs.height);
        ctx.strokeStyle = val.c;
        ctx.lineWidth = val.s;
        ctx.stroke();
    });

    const unSubClear = onValue(ref(db, `games/${chatId}/${gameId}/doodle/clearAt`), snap => {
        if (snap.exists()) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, cvs.width, cvs.height);
        }
    });

    const unSubSnapshot = onValue(ref(db, `games/${chatId}/${gameId}/doodle/snapshot`), snap => {
        if (isDrawer) return;
        const dataUrl = snap.val();
        if (dataUrl) {
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
            };
            img.src = dataUrl;
        }
    });

    const unSubChat = onChildAdded(ref(db, `games/${chatId}/${gameId}/doodle/chat`), snap => {
        const msg = snap.val();
        if (!msg) return;
        const amDrawer = ((gameData.drawer || gameData.drawerUid) === myUid);

        // Blind logic: Hide messages from winners from active guessers
        if (msg.hiddenFromGuessers && !amDrawer && !window.localGuessedCorrect && msg.uid !== myUid) {
            return;
        }

        const chatBox = document.getElementById('doodle-chat-box');
        if (!chatBox) return;
        const el = document.createElement('div');
        el.style.padding = '2px 4px';

        if (msg.isSystem) {
            el.style.color = '#4cd964';
            el.style.fontWeight = 'bold';
            el.innerText = msg.text;
        } else {
            const color = msg.hiddenFromGuessers ? '#4cd964' : 'var(--text-main)';
            el.innerHTML = `<b style="color:var(--accent);">${escapeHTML(msg.name || 'Player')}:</b> <span style="color:${color};">${escapeHTML(msg.text || '')}</span>`;
        }
        chatBox.appendChild(el);
        chatBox.scrollTop = chatBox.scrollHeight;
    });

    const unSubGame = onValue(ref(db, `games/${chatId}/${gameId}`), async (snap) => {
        const freshData = snap.val();
        if (!freshData) return;

        if (freshData.lastAdvanceReason === 'all_guessed' && freshData.lastAdvanceAt && freshData.lastAdvanceAt !== lastNotifiedDoodleAdvanceAt) {
            lastNotifiedDoodleAdvanceAt = freshData.lastAdvanceAt;
            if (typeof showNotification === 'function') {
                showNotification("Everyone guessed the word! Moving to the next drawer...", "info");
            }
        }

        if (freshData.status === 'reveal') {
            if (activeDoodleTimerInt) {
                clearInterval(activeDoodleTimerInt);
                activeDoodleTimerInt = null;
            }
            if (selectionOverlay) selectionOverlay.style.display = 'none';
            if (wordDisplayEl) wordDisplayEl.innerText = `${freshData.targetWord || freshData.word || ''}`;
            if (statusEl) statusEl.innerText = `Round Over! The word was: ${freshData.targetWord || freshData.word || ''}`;
            cvs.style.opacity = '0.3';

            if (auth.currentUser.uid === (freshData.drawer || freshData.drawerUid) && !activeDoodleRevealTimeout) {
                activeDoodleRevealTimeout = setTimeout(() => window.advanceDoodleTurn(freshData.currentTurnIndex), 3000);
            }
        } else if (freshData.status === 'finished' && !doodleEnded) {
            doodleEnded = true;
            cleanupDoodleListeners();
            gameStartedLocally = false;
            currentDoodleTurn = -1;
            currentDoodleRound = -1;
            currentDoodleStatus = null;
            closeAnimatedModal(screen);

            if (freshData.inviteMsgId) {
                await update(ref(db, `messages/${chatId}/${freshData.inviteMsgId}`), { expired: true });
            }

            const players = Object.values(freshData.players || {}).map(p => (typeof p === 'object' ? { ...p } : { name: String(p), score: 0 }));
            players.sort((a, b) => (b.score || 0) - (a.score || 0));
            players.forEach((p, i) => {
                p.won = (i === 0 && (p.score || 0) > 0);
                p.attempts = `${p.score || 0} Pts`;
                p.scoreLabel = `${p.score || 0} Pts${p.won ? ' \u{1F3C6}' : ''}`;
            });
            showPodium(players, gameId, chatId);
            schedulePodiumCleanup(gameId, chatId);
        } else if (freshData.status !== currentDoodleStatus || freshData.currentTurnIndex !== currentDoodleTurn) {
            startDoodleGame(freshData, gameId, chatId);
        }
    });

    doodleUnsubs.push(unSubStrokes, unSubClear, unSubSnapshot, unSubChat, unSubGame);
}

window.clearDoodle = async () => {
    const chatId = activeGameChatId || currentChatId;
    if (!chatId || !activeGameId) return;
    const cvs = document.getElementById('doodle-canvas');
    if (cvs) {
        const ctx = cvs.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cvs.width, cvs.height);
    }
    await remove(ref(db, `games/${chatId}/${activeGameId}/doodle/strokes`));
    await remove(ref(db, `games/${chatId}/${activeGameId}/doodle/snapshot`));
    await update(ref(db, `games/${chatId}/${activeGameId}/doodle`), { clearAt: Date.now() });
};

window.advanceDoodleTurn = async (arg1 = null, options = {}) => {
    const chatId = activeGameChatId || currentChatId;
    const targetGameId = (typeof arg1 === 'string' && arg1) ? arg1 : activeGameId;
    const expectedTurnIndex = (typeof arg1 === 'number') ? arg1 : (options.expectedTurnIndex ?? null);

    if (!chatId || !targetGameId || isAdvancingDoodleTurn) return;
    isAdvancingDoodleTurn = true;
    clearDoodleTimers();
    try {
        const gameRef = ref(db, `games/${chatId}/${targetGameId}`);
        const initialSnap = await get(gameRef);
        const initialG = initialSnap.val();
        if (!initialG) return;
        if (options.requirePlayingStatus) {
            if (initialG.status !== 'playing') return;
        } else if (initialG.status !== 'playing' && initialG.status !== 'reveal' && initialG.status !== 'choosing') {
            return;
        }
        if (expectedTurnIndex !== null && initialG.currentTurnIndex !== expectedTurnIndex) return;

        // Atomic per-turn lock prevents concurrent guessers from double-advancing or skipping turns
        const lockKey = `${initialG.currentRound || 1}_${initialG.currentTurnIndex ?? 0}`;
        const lockRef = ref(db, `games/${chatId}/${targetGameId}/turnLocks/${lockKey}`);
        const lockRes = await runTransaction(lockRef, (current) => {
            if (current !== null) return;
            return auth.currentUser?.uid || true;
        });
        if (!lockRes.committed) return;

        const snap = await get(gameRef);
        const g = snap.val();
        if (!g) return;
        if (options.requirePlayingStatus) {
            if (g.status !== 'playing') return;
        } else if (g.status !== 'playing' && g.status !== 'reveal' && g.status !== 'choosing') {
            return;
        }
        if (expectedTurnIndex !== null && g.currentTurnIndex !== expectedTurnIndex) return;

        let nextIdx = (g.currentTurnIndex ?? 0) + 1;
        let nextRound = g.currentRound || 1;
        const order = g.turnOrder || [];

        // Check if everyone has drawn this round
        if (nextIdx >= order.length) {
            nextIdx = 0;
            nextRound++;
        }

        const advanceAt = Date.now();
        const advanceReason = options.reason || null;

        // Check Game Over
        if (nextRound > (g.maxRounds || 1)) {
            await update(gameRef, {
                status: 'finished',
                guessedPlayers: null,
                lastAdvanceReason: advanceReason,
                lastAdvanceAt: advanceAt
            });
            return;
        }

        const nextDrawerUid = order[nextIdx] || g.drawerUid || g.drawer;

        // When a new drawer's turn starts: 10 seconds to choose from 3 random words
        const wordOptions = [];
        while (wordOptions.length < 3) {
            const word = DOODLE_WORDS[Math.floor(Math.random() * DOODLE_WORDS.length)];
            if (!wordOptions.includes(word)) wordOptions.push(word);
        }

        await remove(ref(db, `games/${chatId}/${targetGameId}/doodle/strokes`));
        await remove(ref(db, `games/${chatId}/${targetGameId}/doodle/chat`));
        await remove(ref(db, `games/${chatId}/${targetGameId}/doodle/snapshot`));
        await update(ref(db, `games/${chatId}/${targetGameId}/doodle`), { clearAt: advanceAt });

        const updates = {
            status: 'choosing',
            currentTurnIndex: nextIdx,
            currentRound: nextRound,
            drawer: nextDrawerUid,
            drawerUid: nextDrawerUid,
            wordOptions: wordOptions,
            guessedPlayers: null,
            lastAdvanceReason: advanceReason,
            lastAdvanceAt: advanceAt,
            turnExpiresAt: window.getServerTime() + 10000 // 10 seconds to choose
        };
        Object.keys(g.players || {}).forEach(uid => {
            updates[`players/${uid}/guessedCorrect`] = null;
        });

        await update(gameRef, updates);
    } finally {
        isAdvancingDoodleTurn = false;
    }
};

window.submitDoodleGuess = async () => {
    const chatId = activeGameChatId || currentChatId;
    if (!chatId || !activeGameId || !auth.currentUser || isSubmittingDoodleGuess) return;
    const input = document.getElementById('doodle-guess-input');
    const guess = input ? input.value.trim() : '';
    if (!guess) return;
    input.value = '';

    isSubmittingDoodleGuess = true;
    try {
        const gameRef = ref(db, `games/${chatId}/${activeGameId}`);
        const snap = await get(gameRef);
        const gData = snap.val();
        if (!gData || gData.status !== 'playing') return;
        const currentWord = String(gData.targetWord || gData.word || '').trim();
        if (!currentWord) return;

        const myUid = auth.currentUser.uid;
        const myName = getPlayerDisplayName(gData.players?.[myUid]).split(' ')[0] || 'Player';
        const drawerId = gData.drawer || gData.drawerUid;

        // If already guessed correct (or drawing), send as hidden chat message
        if (window.localGuessedCorrect || myUid === drawerId) {
            push(ref(db, `games/${chatId}/${activeGameId}/doodle/chat`), {
                uid: myUid,
                name: myName,
                text: guess,
                hiddenFromGuessers: true
            });
            return;
        }

        if (guess.toLowerCase() === currentWord.toLowerCase()) {
            window.localGuessedCorrect = true;
            input.placeholder = 'Guessed! Chat with winners...';
            const roundExpiresAt = gData.roundExpiresAt || gData.turnEndTime || (window.getServerTime() + 30000);
            const timeLeft = Math.max(1, Math.floor((roundExpiresAt - window.getServerTime()) / 1000));
            const points = timeLeft * 10;

            await update(gameRef, {
                [`players/${myUid}/score`]: increment(points),
                [`players/${myUid}/guessedCorrect`]: true,
                [`guessedPlayers/${myUid}`]: true,
                [`players/${drawerId}/score`]: increment(Math.floor(points / 2))
            });

            push(ref(db, `games/${chatId}/${activeGameId}/doodle/chat`), {
                uid: 'system',
                text: `${myName} guessed the word!`,
                isSystem: true
            });

            const freshSnap = await get(gameRef);
            const freshGameData = freshSnap.val();
            if (!freshGameData) return;

            const allPlayers = Object.keys(freshGameData.players || {});
            const activeDrawerId = freshGameData.drawer || freshGameData.drawerUid || drawerId;
            const nonDrawers = allPlayers.filter(uid => uid !== activeDrawerId);
            const guessedUids = Object.keys(freshGameData.guessedPlayers || {});
            if (!guessedUids.includes(myUid)) {
                guessedUids.push(myUid);
            }
            allPlayers.forEach(uid => {
                if (freshGameData.players?.[uid]?.guessedCorrect && !guessedUids.includes(uid)) {
                    guessedUids.push(uid);
                }
            });

            const everyoneGuessed = nonDrawers.length > 0 && nonDrawers.every(uid => guessedUids.includes(uid));

            if (everyoneGuessed && freshGameData.status === 'playing') {
                await window.advanceDoodleTurn(freshGameData.currentTurnIndex, {
                    requirePlayingStatus: true,
                    reason: 'all_guessed'
                });
            }
        } else {
            push(ref(db, `games/${chatId}/${activeGameId}/doodle/chat`), {
                uid: myUid,
                name: myName,
                text: guess
            });
        }
    } finally {
        isSubmittingDoodleGuess = false;
    }
};

// --- SPY (SOCIAL DEDUCTION PARTY GAME) ---
const SPY_WORDS = [
    // Places
    { category: "Places", word: "Hospital" }, { category: "Places", word: "Airport" },
    { category: "Places", word: "Prison" }, { category: "Places", word: "Cinema" },
    { category: "Places", word: "Library" }, { category: "Places", word: "Casino" },
    { category: "Places", word: "Submarine" }, { category: "Places", word: "Beach" },
    { category: "Places", word: "Museum" }, { category: "Places", word: "School" },
    { category: "Places", word: "Gym" }, { category: "Places", word: "Restaurant" },
    { category: "Places", word: "Bank" }, { category: "Places", word: "Supermarket" },
    { category: "Places", word: "Zoo" }, { category: "Places", word: "Space Station" },
    { category: "Places", word: "Hotel" }, { category: "Places", word: "Circus" },
    { category: "Places", word: "Stadium" }, { category: "Places", word: "Graveyard" },
    { category: "Places", word: "Bakery" }, { category: "Places", word: "Castle" },
    { category: "Places", word: "Amusement Park" }, { category: "Places", word: "Aquarium" },
    { category: "Places", word: "Desert" }, { category: "Places", word: "Jungle" },
    // Food & Drink
    { category: "Food & Drink", word: "Pizza" }, { category: "Food & Drink", word: "Sushi" },
    { category: "Food & Drink", word: "Burger" }, { category: "Food & Drink", word: "Coffee" },
    { category: "Food & Drink", word: "Ice Cream" }, { category: "Food & Drink", word: "Taco" },
    { category: "Food & Drink", word: "Pasta" }, { category: "Food & Drink", word: "Pancake" },
    { category: "Food & Drink", word: "Chocolate" }, { category: "Food & Drink", word: "Popcorn" },
    { category: "Food & Drink", word: "Steak" }, { category: "Food & Drink", word: "Donut" },
    { category: "Food & Drink", word: "Ramen" }, { category: "Food & Drink", word: "Lemonade" },
    { category: "Food & Drink", word: "Watermelon" }, { category: "Food & Drink", word: "Sandwich" },
    { category: "Food & Drink", word: "Cheese" }, { category: "Food & Drink", word: "Bacon" },
    { category: "Food & Drink", word: "Milkshake" }, { category: "Food & Drink", word: "Avocado" },
    // Animals
    { category: "Animals", word: "Shark" }, { category: "Animals", word: "Penguin" },
    { category: "Animals", word: "Elephant" }, { category: "Animals", word: "Octopus" },
    { category: "Animals", word: "Eagle" }, { category: "Animals", word: "Kangaroo" },
    { category: "Animals", word: "Spider" }, { category: "Animals", word: "Dolphin" },
    { category: "Animals", word: "Tiger" }, { category: "Animals", word: "Snake" },
    { category: "Animals", word: "Giraffe" }, { category: "Animals", word: "Crocodile" },
    { category: "Animals", word: "Wolf" }, { category: "Animals", word: "Butterfly" },
    { category: "Animals", word: "Gorilla" }, { category: "Animals", word: "Flamingo" },
    { category: "Animals", word: "Owl" }, { category: "Animals", word: "Chameleon" },
    // Objects
    { category: "Objects", word: "Smartphone" }, { category: "Objects", word: "Umbrella" },
    { category: "Objects", word: "Guitar" }, { category: "Objects", word: "Telescope" },
    { category: "Objects", word: "Compass" }, { category: "Objects", word: "Headphones" },
    { category: "Objects", word: "Mirror" }, { category: "Objects", word: "Flashlight" },
    { category: "Objects", word: "Backpack" }, { category: "Objects", word: "Suitcase" },
    { category: "Objects", word: "Keyboard" }, { category: "Objects", word: "Microwave" },
    { category: "Objects", word: "Toothbrush" }, { category: "Objects", word: "Sunglasses" },
    { category: "Objects", word: "Parachute" }, { category: "Objects", word: "Candle" },
    { category: "Objects", word: "Alarm Clock" }, { category: "Objects", word: "Camera" },
    // Jobs
    { category: "Jobs", word: "Astronaut" }, { category: "Jobs", word: "Firefighter" },
    { category: "Jobs", word: "Chef" }, { category: "Jobs", word: "Detective" },
    { category: "Jobs", word: "Pilot" }, { category: "Jobs", word: "Doctor" },
    { category: "Jobs", word: "Lawyer" }, { category: "Jobs", word: "Magician" },
    { category: "Jobs", word: "Pirate" }, { category: "Jobs", word: "DJ" },
    { category: "Jobs", word: "Mechanic" }, { category: "Jobs", word: "Teacher" },
    { category: "Jobs", word: "Lifeguard" }, { category: "Jobs", word: "Architect" },
    // Sports & Activities
    { category: "Sports", word: "Football" }, { category: "Sports", word: "Basketball" },
    { category: "Sports", word: "Boxing" }, { category: "Sports", word: "Chess" },
    { category: "Sports", word: "Surfing" }, { category: "Sports", word: "Bowling" },
    { category: "Sports", word: "Skiing" }, { category: "Sports", word: "Tennis" },
    { category: "Sports", word: "Archery" }, { category: "Sports", word: "Golf" },
    { category: "Sports", word: "Skateboarding" }, { category: "Sports", word: "Swimming" },
    // Transport
    { category: "Transport", word: "Helicopter" }, { category: "Transport", word: "Rocket" },
    { category: "Transport", word: "Motorcycle" }, { category: "Transport", word: "Train" },
    { category: "Transport", word: "Cruise Ship" }, { category: "Transport", word: "Hot Air Balloon" },
    { category: "Transport", word: "Ambulance" }, { category: "Transport", word: "Tractor" }
];

window.spyGameInterval = null;
window.spyGameUnsubscribe = null;
let activeSpyChatId = null;
let activeSpyGameId = null;
let activeSpyGameData = null;
let spyRoleHidden = false;
let spyTimeoutInFlightKey = null;
let lastRenderedSpyStateKey = null;
let isSubmittingSpyAction = false;
let spyInviteExpiredMarked = false;

function getSpyPlayerName(players, uid) {
    return String(getPlayerDisplayName(players?.[uid]) || 'Player').substring(0, 15);
}

function normalizeSpyList(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') return Object.values(raw);
    return [];
}

function shuffleSpyArray(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

window.startSpyGame = async function(chatId, gameId) {
    if (!chatId || !gameId) return;
    const gameRef = ref(db, `games/${chatId}/${gameId}`);
    const playersSnap = await get(ref(db, `games/${chatId}/${gameId}/players`));
    const players = playersSnap.val() || {};
    const playerUids = Object.keys(players);

    if (playerUids.length < 3) {
        if (typeof showNotification === 'function') {
            showNotification("Need at least 3 players to start Spy!", "error");
        }
        return;
    }

    const spyUid = playerUids[Math.floor(Math.random() * playerUids.length)];
    const picked = SPY_WORDS[Math.floor(Math.random() * SPY_WORDS.length)];
    const turnOrder = shuffleSpyArray(playerUids);

    await update(gameRef, {
        status: 'reveal',
        type: 'spy',
        gameType: 'Spy',
        spyUid: spyUid,
        secretCategory: picked.category,
        secretWord: picked.word,
        turnOrder: turnOrder,
        totalRounds: 2,
        currentTurnIndex: 0,
        clues: null,
        votes: null,
        accusedUid: null,
        spyGuess: null,
        winner: null,
        endReason: null,
        phaseExpiresAt: window.getServerTime() + 6000
    });
};

window.toggleSpyRoleVisibility = function() {
    spyRoleHidden = !spyRoleHidden;
    if (activeSpyGameData) {
        renderSpyRoleCard(activeSpyGameData);
    }
};

function renderSpyRoleCard(gameData) {
    const roleCard = document.getElementById('spy-role-card');
    if (!roleCard) return;

    if (!gameData || gameData.status === 'finished' || !auth.currentUser) {
        roleCard.style.display = 'none';
        roleCard.innerHTML = '';
        return;
    }

    const myUid = auth.currentUser.uid;
    const isSpy = myUid === gameData.spyUid;
    roleCard.style.display = 'flex';
    roleCard.className = `spy-role-card ${spyRoleHidden ? '' : (isSpy ? 'is-spy' : 'is-civilian')}`;

    const toggleLabel = spyRoleHidden ? '👁️ Show' : '👁️ Hide';
    const bodyHtml = spyRoleHidden
        ? `<div style="font-size: 13px; opacity: 0.7;">Role hidden — tap Show to peek safely.</div>`
        : (isSpy
            ? `
                <div style="font-size: 15px; font-weight: 800; color: #f87171;">🕵️ YOU ARE THE SPY</div>
                <div style="font-size: 13px; opacity: 0.9;">Category: <strong>${escapeHTML(gameData.secretCategory || '')}</strong></div>
                <div style="font-size: 12px; opacity: 0.78;">Blend in and figure out the secret word!</div>
            `
            : `
                <div style="font-size: 15px; font-weight: 800; color: #4ade80;">🛡️ CIVILIAN</div>
                <div style="font-size: 13px; opacity: 0.9;">Category: <strong>${escapeHTML(gameData.secretCategory || '')}</strong></div>
                <div style="font-size: 14px; font-weight: 700; color: #ffd700;">Secret Word: ${escapeHTML(gameData.secretWord || '')}</div>
            `);

    roleCard.innerHTML = `
        <div class="spy-role-top">
            <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.7; font-weight: 700;">Your Secret Role</span>
            <button type="button" id="spy-role-toggle-btn" class="spy-toggle-btn" onclick="toggleSpyRoleVisibility()">${toggleLabel}</button>
        </div>
        ${bodyHtml}
    `;

    if (window.twemoji) twemoji.parse(roleCard);
}

function renderSpyStage(gameData) {
    const stage = document.getElementById('spy-stage-content');
    if (!stage || !gameData || !auth.currentUser) return;

    const myUid = auth.currentUser.uid;
    const players = gameData.players || {};
    const turnOrder = normalizeSpyList(gameData.turnOrder);
    const clues = normalizeSpyList(gameData.clues);
    const votes = gameData.votes || {};
    const totalRounds = gameData.totalRounds || 2;
    const turnIdx = gameData.currentTurnIndex || 0;
    const status = gameData.status;

    if (status === 'reveal') {
        const secsLeft = Math.max(0, Math.ceil(((gameData.phaseExpiresAt || 0) - window.getServerTime()) / 1000));
        const isSpy = myUid === gameData.spyUid;
        stage.innerHTML = `
            <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 22px 16px; text-align: center; display: flex; flex-direction: column; gap: 10px;">
                <div style="font-size: 36px;">${isSpy ? '🕵️' : '🛡️'}</div>
                <h4 style="margin: 0; font-size: 18px;">${isSpy ? 'Keep a straight face...' : 'Memorize the secret word!'}</h4>
                <p style="margin: 0; font-size: 13px; opacity: 0.8;">Clue rounds start in <strong>${secsLeft}s</strong>.</p>
            </div>
        `;
    } else if (status === 'clues') {
        const orderLen = Math.max(1, turnOrder.length);
        const currentRound = Math.min(totalRounds, Math.floor(turnIdx / orderLen) + 1);
        const activeUid = turnOrder[turnIdx % orderLen];
        const activeName = getSpyPlayerName(players, activeUid);
        const isMyTurn = myUid === activeUid;

        const clueRows = clues.length > 0
            ? clues.map(c => {
                const cName = escapeHTML(String(c.name || getSpyPlayerName(players, c.uid)).substring(0, 15));
                const cText = escapeHTML(String(c.text || ''));
                const rBadge = c.round ? `R${c.round}` : '';
                return `
                    <div class="spy-clue-item">
                        <div style="min-width: 0; flex: 1;">
                            <strong style="color: var(--accent);">${cName}:</strong>
                            <span style="word-break: break-word;"> ${cText}</span>
                        </div>
                        <small style="opacity: 0.55; flex-shrink: 0;">${escapeHTML(rBadge)}</small>
                    </div>
                `;
            }).join('')
            : '<div style="text-align: center; opacity: 0.6; font-size: 13px; padding: 14px 0;">No clues submitted yet.</div>';

        stage.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 13px;">
                    <span style="font-weight: 700; opacity: 0.85;">Round ${currentRound} of ${totalRounds}</span>
                    <span style="font-weight: 700; color: ${isMyTurn ? '#4ade80' : '#ffd700'};">
                        ${isMyTurn ? 'YOUR TURN!' : `Waiting for ${escapeHTML(activeName)}...`}
                    </span>
                </div>
                <div id="spy-clue-board" class="spy-clue-board">${clueRows}</div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <input type="text" id="spy-clue-input" maxlength="30" placeholder="${isMyTurn ? 'Enter a 1-2 word clue...' : `Waiting for ${escapeHTML(activeName)}...`}" ${isMyTurn ? '' : 'disabled'} autocomplete="off" style="flex: 1; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.16); background: rgba(0,0,0,0.3); color: #fff; outline: none; font-size: 14px;">
                    <button type="button" id="spy-clue-submit" class="glass-btn-primary" onclick="submitSpyClue()" ${isMyTurn ? '' : 'disabled'} style="width: auto; padding: 10px 16px; min-height: 40px;">Send</button>
                </div>
            </div>
        `;

        const board = document.getElementById('spy-clue-board');
        if (board) board.scrollTop = board.scrollHeight;

        const clueInput = document.getElementById('spy-clue-input');
        if (clueInput && isMyTurn) {
            clueInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    window.submitSpyClue();
                }
            };
            clueInput.focus();
        }
    } else if (status === 'voting') {
        const myVote = votes[myUid] || null;
        const activePlayers = turnOrder.filter(uid => Boolean(players[uid]));
        const voterCount = activePlayers.filter(uid => Boolean(votes[uid])).length;
        const totalVoters = activePlayers.length || turnOrder.length;

        const cardsHtml = (activePlayers.length ? activePlayers : turnOrder).map(uid => {
            const pName = escapeHTML(getSpyPlayerName(players, uid));
            const isSelf = uid === myUid;
            const isSelected = myVote === uid;
            const disabledAttr = (isSelf || Boolean(myVote)) ? 'disabled' : '';
            const voteTally = Object.values(votes).filter(v => v === uid).length;
            return `
                <button type="button" class="spy-vote-card ${isSelected ? 'selected' : ''}" data-target-uid="${escapeHTML(uid)}" ${disabledAttr}>
                    <span style="font-size: 22px;">${isSelected ? '🎯' : '👤'}</span>
                    <span>${pName}${isSelf ? ' (You)' : ''}</span>
                    <small style="opacity: 0.7;">${voteTally} vote${voteTally === 1 ? '' : 's'}</small>
                </button>
            `;
        }).join('');

        stage.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 13px;">
                    <strong>Who is the Spy?</strong>
                    <span style="opacity: 0.8;">${voterCount}/${totalVoters} voted</span>
                </div>
                ${myVote ? `<div style="padding: 8px 12px; border-radius: 10px; background: rgba(245, 158, 11, 0.16); border: 1px solid rgba(245, 158, 11, 0.4); font-size: 13px; text-align: center;">Vote locked in for <strong>${escapeHTML(getSpyPlayerName(players, myVote))}</strong></div>` : ''}
                <div class="spy-vote-grid">${cardsHtml}</div>
            </div>
        `;

        stage.querySelectorAll('.spy-vote-card[data-target-uid]').forEach(btn => {
            btn.onclick = () => {
                const targetUid = btn.dataset.targetUid;
                if (targetUid) window.submitSpyVote(targetUid);
            };
        });
    } else if (status === 'spy_guess') {
        const isSpy = myUid === gameData.spyUid;
        const spyName = escapeHTML(getSpyPlayerName(players, gameData.spyUid));
        stage.innerHTML = `
            <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 16px; padding: 18px; display: flex; flex-direction: column; gap: 12px; text-align: center;">
                <div style="font-size: 15px; font-weight: 700; color: #fca5a5;">🚨 ${spyName} was caught! Last chance to guess the secret word...</div>
                ${isSpy ? `
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="text" id="spy-final-guess-input" maxlength="40" placeholder="Enter secret word..." autocomplete="off" style="flex: 1; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.35); color: #fff; outline: none; font-size: 14px;">
                        <button type="button" id="spy-final-guess-btn" class="glass-btn-primary" onclick="submitSpyFinalGuess()" style="width: auto; padding: 10px 16px; min-height: 40px;">Guess Word</button>
                    </div>
                ` : `
                    <div style="font-size: 13px; opacity: 0.8;">Waiting for ${spyName} to take their final guess...</div>
                `}
            </div>
        `;

        const guessInput = document.getElementById('spy-final-guess-input');
        if (guessInput && isSpy) {
            guessInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    window.submitSpyFinalGuess();
                }
            };
            guessInput.focus();
        }
    } else if (status === 'finished') {
        const civiliansWon = gameData.winner === 'civilians';
        const spyName = escapeHTML(getSpyPlayerName(players, gameData.spyUid));
        const voteRows = Object.entries(votes).length > 0
            ? Object.entries(votes).map(([vUid, targetUid]) => `
                <div style="font-size: 12px; opacity: 0.85;">
                    <strong>${escapeHTML(getSpyPlayerName(players, vUid))}</strong> voted for <strong>${escapeHTML(getSpyPlayerName(players, targetUid))}</strong>
                </div>
            `).join('')
            : '<div style="font-size: 12px; opacity: 0.6;">No votes cast.</div>';

        const clueRows = clues.length > 0
            ? clues.map(c => `
                <div style="font-size: 12px; opacity: 0.85;">
                    <strong>${escapeHTML(String(c.name || getSpyPlayerName(players, c.uid)).substring(0, 15))}:</strong> ${escapeHTML(String(c.text || ''))}
                </div>
            `).join('')
            : '<div style="font-size: 12px; opacity: 0.6;">No clues recorded.</div>';

        stage.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 12px; text-align: center;">
                <div style="padding: 16px; border-radius: 16px; background: ${civiliansWon ? 'rgba(34, 197, 94, 0.14)' : 'rgba(239, 68, 68, 0.14)'}; border: 1px solid ${civiliansWon ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)'};">
                    <h3 style="margin: 0 0 6px 0; font-size: 22px; color: ${civiliansWon ? '#4ade80' : '#f87171'};">
                        ${civiliansWon ? '🏆 CIVILIANS WIN!' : '🕵️ SPY WINS!'}
                    </h3>
                    <div style="font-size: 13px; opacity: 0.9;">${escapeHTML(gameData.endReason || 'Game Over')}</div>
                </div>

                <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 4px; font-size: 13px;">
                    <div>The Spy was: <strong style="color: #f87171;">${spyName}</strong></div>
                    <div>Category: <strong>${escapeHTML(gameData.secretCategory || '')}</strong> • Secret Word: <strong style="color: #ffd700;">${escapeHTML(gameData.secretWord || '')}</strong></div>
                    ${gameData.spyGuess ? `<div>Spy's Final Guess: <strong>${escapeHTML(gameData.spyGuess)}</strong></div>` : ''}
                </div>

                <div style="text-align: left; background: rgba(0,0,0,0.25); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;">
                    <strong style="font-size: 12px; opacity: 0.7; text-transform: uppercase;">Vote Breakdown</strong>
                    ${voteRows}
                </div>

                <div style="text-align: left; background: rgba(0,0,0,0.25); border-radius: 12px; padding: 10px 12px; max-height: 130px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;">
                    <strong style="font-size: 12px; opacity: 0.7; text-transform: uppercase;">Clue History</strong>
                    ${clueRows}
                </div>

                <button type="button" class="glass-btn-secondary" onclick="closeSpyGame()" style="width: 100%; margin-top: 4px;">Close</button>
            </div>
        `;
    }

    if (window.twemoji) twemoji.parse(stage);
}

async function resolveSpyVotes(chatId, gameId) {
    if (!chatId || !gameId) return;
    const gameRef = ref(db, `games/${chatId}/${gameId}`);
    await runTransaction(gameRef, (current) => {
        if (!current || current.status !== 'voting') return;
        const votes = current.votes || {};
        const counts = {};
        Object.values(votes).forEach(targetUid => {
            if (targetUid) counts[targetUid] = (counts[targetUid] || 0) + 1;
        });

        let maxVotes = 0;
        let topUids = [];
        Object.entries(counts).forEach(([uid, count]) => {
            if (count > maxVotes) {
                maxVotes = count;
                topUids = [uid];
            } else if (count === maxVotes) {
                topUids.push(uid);
            }
        });

        if (maxVotes === 0 || topUids.length !== 1) {
            current.status = 'finished';
            current.winner = 'spy';
            current.endReason = 'Vote ended in a tie — the Spy escaped!';
            return current;
        }

        const accusedUid = topUids[0];
        current.accusedUid = accusedUid;
        if (accusedUid === current.spyUid) {
            current.status = 'spy_guess';
            current.phaseExpiresAt = window.getServerTime() + 15000;
        } else {
            current.status = 'finished';
            current.winner = 'spy';
            current.endReason = 'Civilians voted out an innocent player!';
        }
        return current;
    });
}

async function handleSpyPhaseTimeout(chatId, gameId, gameData) {
    if (!chatId || !gameId || !gameData) return;
    const status = gameData.status;
    if (status === 'finished') return;

    const turnIdx = gameData.currentTurnIndex || 0;
    const lockKey = `${status}_${turnIdx}`;
    if (spyTimeoutInFlightKey === lockKey) return;
    spyTimeoutInFlightKey = lockKey;

    try {
        const gameRef = ref(db, `games/${chatId}/${gameId}`);
        if (status === 'reveal') {
            await runTransaction(gameRef, (current) => {
                if (!current || current.status !== 'reveal') return;
                current.status = 'clues';
                current.currentTurnIndex = 0;
                current.phaseExpiresAt = window.getServerTime() + 25000;
                return current;
            });
        } else if (status === 'clues') {
            await runTransaction(gameRef, (current) => {
                if (!current || current.status !== 'clues') return;
                if ((current.currentTurnIndex || 0) !== turnIdx) return;

                const order = normalizeSpyList(current.turnOrder);
                const orderLen = Math.max(1, order.length);
                const activeUid = order[turnIdx % orderLen];
                const clues = normalizeSpyList(current.clues);
                clues.push({
                    uid: activeUid,
                    name: getSpyPlayerName(current.players, activeUid),
                    round: Math.floor(turnIdx / orderLen) + 1,
                    text: '(Skipped)'
                });
                current.clues = clues;

                const nextTurn = turnIdx + 1;
                current.currentTurnIndex = nextTurn;
                if (nextTurn >= orderLen * (current.totalRounds || 2)) {
                    current.status = 'voting';
                    current.phaseExpiresAt = window.getServerTime() + 30000;
                } else {
                    current.phaseExpiresAt = window.getServerTime() + 25000;
                }
                return current;
            });
        } else if (status === 'voting') {
            await resolveSpyVotes(chatId, gameId);
        } else if (status === 'spy_guess') {
            await runTransaction(gameRef, (current) => {
                if (!current || current.status !== 'spy_guess') return;
                current.status = 'finished';
                current.winner = 'civilians';
                current.endReason = 'The Spy ran out of time to guess the word!';
                return current;
            });
        }
    } catch (err) {
        console.warn('[Spy] Phase timeout error:', err);
        spyTimeoutInFlightKey = null;
    }
}

function updateSpyTimerDisplay() {
    const timerEl = document.getElementById('spy-phase-timer');
    const g = activeSpyGameData;
    if (!timerEl || !g) return;

    const labels = {
        reveal: 'Reveal',
        clues: 'Clues',
        voting: 'Voting',
        spy_guess: 'Spy Guess',
        finished: 'Finished'
    };
    const label = labels[g.status] || 'Spy';

    if (g.status === 'finished') {
        timerEl.innerText = 'Finished';
        return;
    }

    const now = window.getServerTime();
    const secsLeft = Math.max(0, Math.ceil(((g.phaseExpiresAt || now) - now) / 1000));
    timerEl.innerText = `${label} • ${secsLeft}s`;

    const overdueMs = now - (g.phaseExpiresAt || now);
    const myUid = auth.currentUser?.uid;
    const hostUid = g.hostId || g.host;
    const isHost = myUid && myUid === hostUid;
    if (myUid && ((isHost && overdueMs >= 0) || (!isHost && overdueMs >= 3000))) {
        handleSpyPhaseTimeout(activeSpyChatId, activeSpyGameId, g);
    }
}

window.openSpyGame = function(gameId = activeGameId, chatId = activeGameChatId || currentChatId) {
    if (!chatId || !gameId || !auth.currentUser) return;

    if (window.spyGameInterval) {
        clearInterval(window.spyGameInterval);
        window.spyGameInterval = null;
    }
    if (window.spyGameUnsubscribe) {
        window.spyGameUnsubscribe();
        window.spyGameUnsubscribe = null;
    }

    activeGameId = gameId;
    activeGameChatId = chatId;
    activeSpyGameId = gameId;
    activeSpyChatId = chatId;
    activeSpyGameData = null;
    spyRoleHidden = false;
    spyTimeoutInFlightKey = null;
    lastRenderedSpyStateKey = null;
    spyInviteExpiredMarked = false;

    const ui = document.getElementById('spy-game-ui');
    if (ui) ui.style.display = 'flex';

    const gameRef = ref(db, `games/${chatId}/${gameId}`);
    window.spyGameUnsubscribe = onValue(gameRef, async (snap) => {
        const gameData = snap.val();
        if (!gameData) {
            window.closeSpyGame();
            return;
        }

        activeSpyGameData = gameData;
        renderSpyRoleCard(gameData);

        if (gameData.status === 'finished') {
            if (window.spyGameInterval) {
                clearInterval(window.spyGameInterval);
                window.spyGameInterval = null;
            }
            if (!spyInviteExpiredMarked && gameData.inviteMsgId) {
                spyInviteExpiredMarked = true;
                update(ref(db, `messages/${chatId}/${gameData.inviteMsgId}`), { expired: true }).catch(() => {});
            }
            schedulePodiumCleanup(gameId, chatId);
        }

        const clues = normalizeSpyList(gameData.clues);
        const votes = gameData.votes || {};
        const myVote = auth.currentUser ? (votes[auth.currentUser.uid] || '') : '';
        const stateKey = `${gameData.status}|${gameData.currentTurnIndex || 0}|${clues.length}|${Object.keys(votes).length}|${myVote}|${gameData.accusedUid || ''}|${gameData.winner || ''}|${gameData.spyGuess || ''}`;

        if (stateKey !== lastRenderedSpyStateKey) {
            lastRenderedSpyStateKey = stateKey;
            spyTimeoutInFlightKey = null;
            renderSpyStage(gameData);
        }

        updateSpyTimerDisplay();
    });

    window.spyGameInterval = setInterval(updateSpyTimerDisplay, 500);
};

window.closeSpyGame = function(resetLobbyFlag = true) {
    if (window.spyGameInterval) {
        clearInterval(window.spyGameInterval);
        window.spyGameInterval = null;
    }
    if (window.spyGameUnsubscribe) {
        window.spyGameUnsubscribe();
        window.spyGameUnsubscribe = null;
    }

    const ui = document.getElementById('spy-game-ui');
    if (ui) ui.style.display = 'none';

    const roleCard = document.getElementById('spy-role-card');
    if (roleCard) {
        roleCard.style.display = 'none';
        roleCard.innerHTML = '';
    }
    const stage = document.getElementById('spy-stage-content');
    if (stage) stage.innerHTML = '';

    activeSpyChatId = null;
    activeSpyGameId = null;
    activeSpyGameData = null;
    spyTimeoutInFlightKey = null;
    lastRenderedSpyStateKey = null;
    if (resetLobbyFlag) {
        gameStartedLocally = false;
    }
};

window.submitSpyClue = async function() {
    const g = activeSpyGameData;
    const chatId = activeSpyChatId;
    const gameId = activeSpyGameId;
    if (!g || !chatId || !gameId || !auth.currentUser || isSubmittingSpyAction) return;
    if (g.status !== 'clues') return;

    const myUid = auth.currentUser.uid;
    const order = normalizeSpyList(g.turnOrder);
    const turnIdx = g.currentTurnIndex || 0;
    const orderLen = Math.max(1, order.length);
    if (order[turnIdx % orderLen] !== myUid) return;

    const input = document.getElementById('spy-clue-input');
    const rawClue = input ? input.value.trim() : '';
    if (!rawClue) {
        if (typeof showNotification === 'function') showNotification("Please enter a clue first.", "info");
        return;
    }
    const clue = rawClue.substring(0, 30);

    if (myUid !== g.spyUid && g.secretWord && clue.toLowerCase().includes(String(g.secretWord).toLowerCase())) {
        if (typeof showNotification === 'function') {
            showNotification("You can't put the secret word in your clue!", "error");
        }
        return;
    }

    isSubmittingSpyAction = true;
    const submitBtn = document.getElementById('spy-clue-submit');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const displayUsername = getSpyPlayerName(g.players, myUid);
        const gameRef = ref(db, `games/${chatId}/${gameId}`);
        await runTransaction(gameRef, (current) => {
            if (!current || current.status !== 'clues') return;
            const curOrder = normalizeSpyList(current.turnOrder);
            const curLen = Math.max(1, curOrder.length);
            const curTurnIdx = current.currentTurnIndex || 0;
            if (curTurnIdx !== turnIdx || curOrder[curTurnIdx % curLen] !== myUid) return;

            const clues = normalizeSpyList(current.clues);
            clues.push({
                uid: myUid,
                name: displayUsername,
                round: Math.floor(curTurnIdx / curLen) + 1,
                text: clue
            });
            current.clues = clues;

            const nextTurn = curTurnIdx + 1;
            current.currentTurnIndex = nextTurn;
            if (nextTurn >= curLen * (current.totalRounds || 2)) {
                current.status = 'voting';
                current.phaseExpiresAt = window.getServerTime() + 30000;
            } else {
                current.phaseExpiresAt = window.getServerTime() + 25000;
            }
            return current;
        });
    } catch (err) {
        console.error('[Spy] submitSpyClue error:', err);
        if (typeof showNotification === 'function') showNotification("Failed to submit clue.", "error");
        if (submitBtn) submitBtn.disabled = false;
    } finally {
        isSubmittingSpyAction = false;
    }
};

window.submitSpyVote = async function(targetUid) {
    const g = activeSpyGameData;
    const chatId = activeSpyChatId;
    const gameId = activeSpyGameId;
    if (!g || !chatId || !gameId || !auth.currentUser || isSubmittingSpyAction) return;
    if (g.status !== 'voting') return;

    const myUid = auth.currentUser.uid;
    if (!targetUid || targetUid === myUid) return;

    isSubmittingSpyAction = true;
    try {
        await set(ref(db, `games/${chatId}/${gameId}/votes/${myUid}`), targetUid);

        const freshSnap = await get(ref(db, `games/${chatId}/${gameId}`));
        const fresh = freshSnap.val();
        if (!fresh || fresh.status !== 'voting') return;

        const players = fresh.players || {};
        const order = normalizeSpyList(fresh.turnOrder);
        const activeVoters = order.filter(uid => Boolean(players[uid]));
        const requiredVoters = activeVoters.length > 0 ? activeVoters : order;
        const votes = fresh.votes || {};

        if (requiredVoters.length > 0 && requiredVoters.every(uid => Boolean(votes[uid]))) {
            await resolveSpyVotes(chatId, gameId);
        }
    } catch (err) {
        console.error('[Spy] submitSpyVote error:', err);
        if (typeof showNotification === 'function') showNotification("Failed to submit vote.", "error");
    } finally {
        isSubmittingSpyAction = false;
    }
};

window.submitSpyFinalGuess = async function() {
    const g = activeSpyGameData;
    const chatId = activeSpyChatId;
    const gameId = activeSpyGameId;
    if (!g || !chatId || !gameId || !auth.currentUser || isSubmittingSpyAction) return;
    if (g.status !== 'spy_guess' || auth.currentUser.uid !== g.spyUid) return;

    const input = document.getElementById('spy-final-guess-input');
    const rawGuess = input ? input.value.trim() : '';
    if (!rawGuess) {
        if (typeof showNotification === 'function') showNotification("Enter your guess!", "info");
        return;
    }

    const normalizeWord = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedGuess = normalizeWord(rawGuess);

    isSubmittingSpyAction = true;
    const guessBtn = document.getElementById('spy-final-guess-btn');
    if (guessBtn) guessBtn.disabled = true;

    try {
        const gameRef = ref(db, `games/${chatId}/${gameId}`);
        await runTransaction(gameRef, (current) => {
            if (!current || current.status !== 'spy_guess') return;
            const normalizedSecret = normalizeWord(current.secretWord);
            current.status = 'finished';
            current.spyGuess = rawGuess;
            if (normalizedGuess && normalizedGuess === normalizedSecret) {
                current.winner = 'spy';
                current.endReason = 'The Spy was caught, but guessed the secret word!';
            } else {
                current.winner = 'civilians';
                current.endReason = 'The Spy was caught and guessed wrong!';
            }
            return current;
        });
    } catch (err) {
        console.error('[Spy] submitSpyFinalGuess error:', err);
        if (typeof showNotification === 'function') showNotification("Failed to submit guess.", "error");
        if (guessBtn) guessBtn.disabled = false;
    } finally {
        isSubmittingSpyAction = false;
    }
};

function nextFlagRound() {
    if (availableFlags.length === 0) {
        availableFlags = [...COUNTRIES_LIST];
    }
    const randomIndex = Math.floor(Math.random() * availableFlags.length);
    const target = availableFlags.splice(randomIndex, 1)[0];

    currentFlagTarget = target;
    document.getElementById('flag-display').src = `https://flagcdn.com/w320/${target.c}.png`;
    
    const optionsArea = document.getElementById('flag-options');
    optionsArea.innerHTML = '';
    
    const options = [target.n];
    while(options.length < 4) {
        const random = COUNTRIES_LIST[Math.floor(Math.random() * COUNTRIES_LIST.length)].n;
        if (!options.includes(random)) options.push(random);
    }
    options.sort(() => Math.random() - 0.5);

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'game-option-btn';
        btn.innerText = opt;
        btn.onclick = () => {
            if (opt === target.n) {
                document.getElementById('question-area').style.display = 'none';
                document.getElementById('chest-area').style.display = 'block';
                document.getElementById('chests-container').style.display = 'grid';
                document.getElementById('prize-display').style.display = 'none';
            } else {
                // Fail State: Show Wrong Overlay
                const wrongOverlay = document.getElementById('wrong-notification');
                wrongOverlay.style.display = 'flex';
                setTimeout(() => {
                    wrongOverlay.style.display = 'none';
                    nextFlagRound();
                }, 2000);
            }
        };
        optionsArea.appendChild(btn);
    });
}

window.pickChest = async (idx, event) => {
    if (event) event.stopPropagation();
    if (canSkipPrize) {
        clearTimeout(prizeTimeout);
        finishChestRound();
        return;
    }

    const outcomes = [
        "+10%", "+25%", "+50%", "2x", "3x", 
        "-10%", "-25%", 
        "steal10%", "steal25%",
        250, 500 // Flat values to help at the start
    ];
    
    const rawResult = outcomes[Math.floor(Math.random() * outcomes.length)];
    const prizeDisplay = document.getElementById('prize-display');
    const chestsContainer = document.getElementById('chests-container');
    const myUid = auth.currentUser.uid;
    const myName = document.getElementById('current-user-name').innerText;
    const chatId = activeGameChatId || currentChatId;
    const gameId = activeGameId;
    if (!chatId || !gameId) return;

    const playerSnap = await get(ref(db, `games/${chatId}/${gameId}/players/${myUid}`));
    const currentGold = playerSnap.val()?.gold || 0;
    
    let goldChange = 0;
    let displayLabel = "";

    if (typeof rawResult === 'number') {
        goldChange = rawResult;
        displayLabel = (goldChange > 0 ? "+" : "") + formatMoney(goldChange) + " Gold!";
    } else if (typeof rawResult === 'string' && rawResult.toLowerCase().includes("steal")) {
        const stealPercent = rawResult.includes("10") ? 0.10 : 0.25;
        const stealPercentStr = rawResult.includes("10") ? "10%" : "25%";
        
        const playersSnap = await get(ref(db, `games/${chatId}/${gameId}/players`));
        const allPlayers = playersSnap.val() || {};
        const opponents = Object.keys(allPlayers).filter(uid => String(uid) !== String(myUid));
        
        if (opponents.length > 0) {
            // Pause automatic transitions to let user pick a victim
            clearTimeout(prizeTimeout);
            canSkipPrize = false;

            chestsContainer.innerHTML = ''; // Clear chest emojis to show victim buttons
            prizeDisplay.className = 'prize-display neutral';
            prizeDisplay.style.display = 'block';
            prizeDisplay.innerText = "CHOOSE A VICTIM";

            for (const uid of opponents) {
                const btn = document.createElement('button');
                btn.className = 'game-option-btn';
                const victimName = getPlayerDisplayName(allPlayers[uid]);
                btn.innerText = `\u{1F464} ${victimName}`;
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    const victimGold = allPlayers[uid].gold || 0;
                    const amountToSteal = Math.floor(victimGold * stealPercent);
                    const victimUid = uid;
                    const stealAmount = amountToSteal;
                    
                    const updates = {};
                    updates[`games/${chatId}/${gameId}/players/${victimUid}/gold`] = increment(-stealAmount);
                    updates[`games/${chatId}/${gameId}/players/${victimUid}/lastStolenBy`] = myName;
                    updates[`games/${chatId}/${gameId}/players/${myUid}/gold`] = increment(stealAmount);
                    updates[`games/${chatId}/${gameId}/scores/${victimUid}`] = increment(-stealAmount);
                    updates[`games/${chatId}/${gameId}/scores/${myUid}`] = increment(stealAmount);

                    // Track extensive stats during gameplay
                    updates[`games/${chatId}/${gameId}/stats/stolenAmount/${auth.currentUser.uid}`] = increment(stealAmount);
                    updates[`games/${chatId}/${gameId}/stats/timesRobbed/${victimUid}`] = increment(1);
                    updates[`games/${chatId}/${gameId}/stats/lostToRobbers/${victimUid}`] = increment(stealAmount);

                    await update(ref(db), updates);
                    
                    chestsContainer.style.display = 'none';
                    prizeDisplay.innerText = `Stole ${stealPercentStr} from ${victimName}!`;
                    prizeDisplay.className = 'prize-display win';
                    
                    // Resume timing now that victim is selected
                    setTimeout(() => { canSkipPrize = true; }, 1000);
                    prizeTimeout = setTimeout(() => {
                        finishChestRound();
                    }, 3000);
                };
                chestsContainer.appendChild(btn);
            }
            if (window.twemoji) twemoji.parse(chestsContainer);
            return; // Logic continues in the victim button click handler
        } else {
            displayLabel = "No one to steal from!";
        }
    } else {
        // Percentage or Multiplier
        switch(rawResult) {
            case "+10%": goldChange = Math.ceil(currentGold * 0.10); break;
            case "+25%": goldChange = Math.ceil(currentGold * 0.25); break;
            case "+50%": goldChange = Math.ceil(currentGold * 0.50); break;
            case "2x": goldChange = currentGold; break;
            case "3x": goldChange = currentGold * 2; break;
            case "-10%": goldChange = -Math.floor(currentGold * 0.10); break;
            case "-25%": goldChange = -Math.floor(currentGold * 0.25); break;
        }
        displayLabel = (rawResult.includes("%") || rawResult.includes("x")) ? rawResult.toUpperCase() : (goldChange > 0 ? "+" : "") + formatMoney(goldChange) + " Gold!";
    }

    chestsContainer.style.display = 'none';
    prizeDisplay.style.display = 'block';
    prizeDisplay.innerText = displayLabel;
    prizeDisplay.className = `prize-display ${goldChange >= 0 ? 'win' : 'lose'}`;
    
    if (goldChange !== 0) {
        const updates = {};
        updates[`games/${chatId}/${gameId}/players/${myUid}/gold`] = increment(goldChange);
        updates[`games/${chatId}/${gameId}/scores/${myUid}`] = increment(goldChange);
        if (goldChange > 0) {
            const rewardAmount = goldChange;
            updates[`games/${chatId}/${gameId}/stats/earned/${auth.currentUser.uid}`] = increment(rewardAmount);
        }
        await update(ref(db), updates);
    }
    
    // Timing logic
    canSkipPrize = true; // Allow immediate skip after result is shown
    
    prizeTimeout = setTimeout(() => {
        finishChestRound();
    }, 3000); // Auto-next after 3s
};

function finishChestRound() {
    canSkipPrize = false;
    document.getElementById('chest-area').style.display = 'none';
    document.getElementById('question-area').style.display = 'block';
    // Reset chest buttons for next round
    document.getElementById('chests-container').innerHTML = `
        <div class="chest-box" onclick="pickChest(0, event)">\u{1F381}</div>
        <div class="chest-box" onclick="pickChest(1, event)">\u{1F381}</div>
        <div class="chest-box" onclick="pickChest(2, event)">\u{1F381}</div>
    `;
    if (window.twemoji) twemoji.parse(document.getElementById('chests-container'));
    nextFlagRound();
}

// Click anywhere on the game screen to skip if allowed
document.getElementById('flag-game-screen').onclick = () => {
    if (canSkipPrize) {
        clearTimeout(prizeTimeout);
        finishChestRound();
    }
};

// Game State
let gameTimerInterval = null;
let currentFlagTarget = null;
const COUNTRIES_LIST = [
    {n: "USA", c: "us"}, {n: "UK", c: "gb"}, {n: "France", c: "fr"}, {n: "Germany", c: "de"}, 
    {n: "Japan", c: "jp"}, {n: "Brazil", c: "br"}, {n: "Canada", c: "ca"}, {n: "Italy", c: "it"}, 
    {n: "Australia", c: "au"}, {n: "Spain", c: "es"}, {n: "Mexico", c: "mx"}, {n: "China", c: "cn"},
    {n: "India", c: "in"}, {n: "Russia", c: "ru"}, {n: "South Korea", c: "kr"}, {n: "Turkey", c: "tr"},
    {n: "Argentina", c: "ar"}, {n: "Netherlands", c: "nl"}, {n: "Sweden", c: "se"}, {n: "Norway", c: "no"},
    {n: "Greece", c: "gr"}, {n: "Egypt", c: "eg"}, {n: "Thailand", c: "th"}, {n: "Portugal", c: "pt"},
    {n: "Belgium", c: "be"}, {n: "Switzerland", c: "ch"}, {n: "Denmark", c: "dk"}, {n: "Finland", c: "fi"},
    {n: "Ireland", c: "ie"}, {n: "New Zealand", c: "nz"}, {n: "South Africa", c: "za"}, {n: "Colombia", c: "co"},
    {n: "Poland", c: "pl"}, {n: "Ukraine", c: "ua"}, {n: "Saudi Arabia", c: "sa"}, {n: "Indonesia", c: "id"},
    {n: "Vietnam", c: "vn"}, {n: "Chile", c: "cl"}, {n: "Peru", c: "pe"}, {n: "Morocco", c: "ma"},
    {n: "Austria", c: "at"}, {n: "Czech Republic", c: "cz"}, {n: "Hungary", c: "hu"}, {n: "Romania", c: "ro"},
    {n: "Singapore", c: "sg"}, {n: "Malaysia", c: "my"}, {n: "Philippines", c: "ph"}, {n: "Pakistan", c: "pk"},
    {n: "Nigeria", c: "ng"}, {n: "Kenya", c: "ke"}, {n: "Ghana", c: "gh"}, {n: "Algeria", c: "dz"},
    {n: "Israel", c: "il"}, {n: "United Arab Emirates", c: "ae"}, {n: "Qatar", c: "qa"}, {n: "Kuwait", c: "kw"}
];

let swRegistration = null;

// Anti-spam state
const recentUserMessages = new Map(); // Map<uid, Array<{text: string, timestamp: number}>>
const SPAM_MESSAGE_HISTORY_LENGTH = 5;
const SPAM_IDENTICAL_MESSAGE_TIME_WINDOW_MS = 5000; // 5 seconds
const SPAM_MUTE_DURATION_MINUTES = 30;
const SPAM_THRESHOLD = 3; // Mute on the 4th repetitive message

// Mention System State
let isMentionMode = false;
let mentionStartIndex = -1;
let mentionSelectedIndex = 0;

// Helper to generate a permanent alphanumeric ID
function generateFriendId() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// Helper to resize image using canvas for database optimization
// Renamed to downscaleImageDimensions and modified to only reduce dimensions, outputting as PNG.
function downscaleImageDimensions(base64Str, maxWidth = 800, maxHeight = 800) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            if (width > height) {
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width *= maxHeight / height;
                    height = maxHeight;
                }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/png')); // Output as PNG to preserve quality before final JPEG compression
        };
    });
}

// Asynchronous canvas-based image downscaler/compressor yielding to the main thread
async function compressImageAsync(file, maxWidth = 1280, quality = 0.8) {
    let sourceFile = file;

    // Intercept HEIC / HEIF files and convert to JPEG blob
    if (file && (file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif') || file.type === 'image/heic' || file.type === 'image/heif')) {
        try {
            if (typeof heic2any === 'function') {
                console.log(`[UPLOAD] Converting HEIC image to JPEG: ${file.name}`);
                const convertedBlob = await heic2any({
                    blob: file,
                    toType: 'image/jpeg',
                    quality: quality
                });
                const singleBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
                const convertedName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
                sourceFile = new File([singleBlob], convertedName, {
                    type: 'image/jpeg',
                    lastModified: Date.now()
                });
                console.log(`[UPLOAD] HEIC conversion complete: ${sourceFile.name}, Size: ${(sourceFile.size / 1024).toFixed(2)} KB`);
            } else {
                console.warn('[UPLOAD] heic2any library not available, proceeding with raw file.');
            }
        } catch (heicErr) {
            console.error('[UPLOAD] HEIC conversion error:', heicErr);
        }
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = error => reject(error);
        reader.onload = event => {
            const img = new Image();
            img.onerror = error => reject(error);
            img.onload = () => {
                // Yield to main thread
                setTimeout(() => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                    if (height > maxWidth) {
                        width = Math.round((width * maxWidth) / height);
                        height = maxWidth;
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    canvas.toBlob(blob => {
                        if (blob) {
                            const outputName = sourceFile.name.replace(/\.(heic|heif)$/i, '.jpg');
                            const compressedFile = new File([blob], outputName, {
                                type: sourceFile.type || 'image/jpeg',
                                lastModified: Date.now(),
                            });
                            console.log(`[UPLOAD] Compressed to: ${(compressedFile.size / 1024).toFixed(2)} KB`);
                            resolve(compressedFile);
                        } else {
                            reject(new Error('Canvas toBlob failed'));
                        }
                    }, sourceFile.type || 'image/jpeg', quality);
                }, 0);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(sourceFile);
    });
}

// Global currency formatter
window.formatMoney = function(amount) {
    return Number(amount || 0).toLocaleString('en-US');
};

// Helper to prevent XSS by escaping HTML special characters
function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[m]);
}

// Helper to consolidate name resolution and handle fallbacks consistently
function getDisplayName(userData) {
    if (!userData) return "User";
    const raw = userData.displayName || (userData.username || (userData.name || (userData.email ? userData.email.split('@')[0] : "User")));
    return String(raw).substring(0, 15);
}

// Helper to safely get a display name for a sticker
function getStickerDisplayName(stickerMeta) {
    if (!stickerMeta) return "Sticker";
    return stickerMeta.originalFileName || "Unnamed Sticker";
}

// Helper for custom notifications
function showNotification(message, type = 'info', onClick = null) {
    const container = document.getElementById('notification-container');
    if (!container) return;
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = message; // Already escaped or trusted content
    container.appendChild(notification);
    if (window.twemoji) twemoji.parse(notification);

    const removeNotify = () => {
        notification.classList.add('fade-out');
        notification.addEventListener('animationend', () => notification.remove(), { once: true });
    };
    setTimeout(removeNotify, 4000);

    if (typeof onClick === 'function') {
        notification.style.cursor = 'pointer';
        notification.onclick = () => {
            onClick();
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        };
    } else {
        notification.onclick = removeNotify;
    }
}

// Helper for custom confirmation dialogs
function showConfirm(title, message, isPrompt = false, defaultValue = "", yesLabel = "Yes", noLabel = "Cancel") {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleElem = document.getElementById('confirm-title');
        const msgElem = document.getElementById('confirm-message');
        const inputContainer = document.getElementById('confirm-input-container');
        const inputElem = document.getElementById('confirm-input');
        const yesBtn = document.getElementById('confirm-yes-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');

        titleElem.innerText = title;
        msgElem.innerText = message;
        yesBtn.innerText = yesLabel;
        cancelBtn.innerText = noLabel;
        
        if (isPrompt) {
            inputContainer.style.display = 'block';
            inputElem.value = defaultValue;
            // Allow Enter key to submit the prompt
            inputElem.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handle(true);
                }
            };
            setTimeout(() => inputElem.focus(), 100);
        } else {
            inputContainer.style.display = 'none';
            inputElem.onkeydown = null;
        }

        modal.style.display = 'flex';

        const handle = (result) => {
            modal.style.display = 'none';
            inputContainer.style.display = 'none';
            resolve(isPrompt ? (result ? inputElem.value : null) : result);
        };

        yesBtn.onclick = () => handle(true);
        cancelBtn.onclick = () => handle(false);
    });
}

// Universal Mojibake Remediation Helper: heals corrupted UTF-8 sequences from historical database entries
function sanitizeMojibakeEmoji(str) {
    if (!str || typeof str !== 'string') return str;
    const mojibakeMap = {
        'ðŸ‘ï¸': '\u{1F441}\u{FE0F}',
        'ðŸ‘\uFE0F': '\u{1F441}\u{FE0F}',
        'ðŸ‘': '\u{1F44D}',
        'ðŸ‘\u008D': '\u{1F44D}',
        'â\u009D¤ï¸': '\u{2764}\u{FE0F}',
        'â¤ï¸': '\u{2764}\u{FE0F}',
        'â¤': '\u{2764}\u{FE0F}',
        'ðŸ˜‚': '\u{1F602}',
        'ðŸ˜®': '\u{1F62E}',
        'ðŸ˜¢': '\u{1F622}',
        'ðŸŽ': '\u{1F389}',
        'âœ¨': '\u{2728}',
        'ðŸ”¥': '\u{1F525}'
    };
    let clean = str;
    for (const [bad, good] of Object.entries(mojibakeMap)) {
        if (clean.includes(bad)) {
            clean = clean.replaceAll(bad, good);
        }
    }
    return clean;
}

// Helper to detect links and YouTube IDs
function linkifyAndEmbed(rawText) {
    if (!rawText) return { html: "", youtubeId: null, tiktokId: null, tiktokShort: false, instagramId: null, imageUrls: [], joinChatIds: [] };
    const safeRaw = typeof rawText === 'string' ? rawText : String(rawText);
    let text = sanitizeMojibakeEmoji(safeRaw);
    if (text && text.startsWith('data:image/')) {
        return { html: "", youtubeId: null, tiktokId: null, tiktokShort: false, instagramId: null, imageUrls: [text], joinChatIds: [] };
    }

    let escaped = escapeHTML(text);
    // More robust URL regex that avoids capturing trailing punctuation
    const urlRegex = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g;
    // Improved YouTube regex to catch shorts, embed, and various watch formats
    const ytRegex = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?v=|watch\?.+&v=))([\w-]{11})/i;
    const tiktokFullRegex = /tiktok\.com\/@[\w.-]+\/video\/(\d+)/i;
    const tiktokShortRegex = /(?:vm\.tiktok\.com\/?|vt\.tiktok\.com\/?|tiktok\.com\/t\/)([\w-]+)/i;
    const igRegex = /instagram\.com\/(?:p|reel)\/([a-zA-Z0-9_-]+)/i;
    const imgRegex = /\.(jpeg|jpg|gif|png|webp|svg|bmp)(?:\/[^?#.]*)?(?:\?.*)?$/i;
    const joinIdRegex = /#join=([a-zA-Z0-9_-]+)/;

    let youtubeId = null;
    let tiktokId = null;
    let tiktokShort = false; // New flag for mobile links
    let instagramId = null;
    let imageUrls = [];
    let joinChatIds = [];

    let html = escaped.replace(urlRegex, (url) => {
        const joinMatch = url.match(joinIdRegex);
        if (joinMatch) {
            joinChatIds.push(joinMatch[1]);
            return ""; // Hide raw invite URL to show card instead
        }

        const ytMatch = url.match(ytRegex); 
        if (ytMatch) {
            if (!youtubeId) youtubeId = ytMatch[1];
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link-inline" onclick="event.stopPropagation()">${url}</a>`;
        }

        const ttFullMatch = url.match(tiktokFullRegex);
        if (ttFullMatch) {
            if (!tiktokId) tiktokId = ttFullMatch[1];
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link-inline" onclick="event.stopPropagation()">${url}</a>`;
        }

        const ttShortMatch = url.match(tiktokShortRegex);
        if (ttShortMatch) {
            tiktokShort = true;
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link-inline" onclick="event.stopPropagation()">${url}</a>`;
        }

        const igMatch = url.match(igRegex);
        if (igMatch) {
            if (!instagramId) instagramId = igMatch[1];
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link-inline" onclick="event.stopPropagation()">${url}</a>`;
        }

        const isDriveImage = /drive\.google\.com\/(?:file\/d\/|uc\?|open\?|thumbnail\?)|googleusercontent\.com/i.test(url);
        if (imgRegex.test(url) || isDriveImage) {
            imageUrls.push(url);
            return ""; // Hide the link text as requested
        }

        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link-inline" onclick="event.stopPropagation()">${url}</a>`;
    });

    // Client-Side Parser for [UPDATE_VERSION:x.x.x]
    html = html.replace(/\[UPDATE_VERSION:([0-9\.]+)\]/g, (match, version) => {
        return `<div class="channel-update-card"><span class="update-badge">v${version} Available</span><button type="button" class="channel-install-btn" onclick="window.triggerOtaUpdate('${version}')">⚡ Install Update & Reload</button></div>`;
    });

    return { html: html.trim(), youtubeId, tiktokId, tiktokShort, instagramId, imageUrls, joinChatIds };
}

// New helper function to insert messages into the DOM in chronological order
function insertMessageIntoDOM(messageElement, messageTimestamp) {
    const cont = document.getElementById('messages-container');
    let inserted = false;
    const existingMessages = cont.children;

    for (let i = 0; i < existingMessages.length; i++) {
        const existingMessageElement = existingMessages[i];
        // Only compare against actual message wrappers that have a timestamp
        if (!existingMessageElement.id.startsWith('msg-') || !existingMessageElement.dataset.timestamp) continue;

        const existingMessageTimestamp = parseInt(existingMessageElement.dataset.timestamp);

        if (messageTimestamp < existingMessageTimestamp) {
            cont.insertBefore(messageElement, existingMessageElement);
            inserted = true;
            break;
        }
    }

    if (!inserted) {
        cont.appendChild(messageElement);
    }
}

// --- Message Action Functions ---
window.positionReplyPreview = function() {
    const membersPanel = document.getElementById('chat-members-sidebar') || document.querySelector('.glass-members-sidebar');
    const inputArea = document.querySelector('.glass-input-area');
    let rightOffset = 12;

    if (membersPanel && membersPanel.offsetParent !== null) {
        const panelStyle = window.getComputedStyle(membersPanel);
        const rect = membersPanel.getBoundingClientRect();
        if (panelStyle.position !== 'fixed' && panelStyle.display !== 'none' && rect.width > 0) {
            rightOffset = Math.ceil(rect.width) + 12;
        }
    }

    const bottomOffset = inputArea ? Math.ceil(inputArea.getBoundingClientRect().height) + 10 : 88;

    ['reply-preview-bar', 'edit-preview-bar'].forEach(id => {
        const box = document.getElementById(id);
        if (!box) return;
        box.style.left = '12px';
        box.style.right = `${rightOffset}px`;
        if (bottomOffset > 50) {
            box.style.bottom = `${bottomOffset}px`;
        }
    });
};

window.addEventListener('resize', window.positionReplyPreview);

async function editMessage(messageId, currentText) {
    if (!currentChatId) return;

    exitReplyMode(); // Can't edit and reply at once
    currentEditingMessage = messageId;
    
    const input = document.getElementById('message-input');
    const previewBar = document.getElementById('edit-preview-bar');
    const previewText = document.getElementById('edit-preview-text');

    input.value = currentText;
    previewText.innerText = currentText;
    previewBar.style.display = 'flex';
    window.positionReplyPreview();
    
    input.focus();
    // Move cursor to end
    input.setSelectionRange(currentText.length, currentText.length);
}

async function replyToMessage(messageId, text, senderName) {
    if (!currentChatId) return;

    exitEditMode(); // Can't edit and reply at once
    currentReplyMessage = { id: messageId, text, name: senderName };

    const previewBar = document.getElementById('reply-preview-bar');
    const previewText = document.getElementById('reply-preview-text');
    const previewTitle = document.getElementById('reply-info-title');

    previewTitle.innerText = `Replying to ${senderName}`;
    previewText.innerText = text.startsWith('data:image/') ? "Image" : text;
    previewBar.style.display = 'flex';
    window.positionReplyPreview();
    document.getElementById('message-input').focus();
}

document.getElementById('cancel-edit-btn').onclick = exitEditMode;
document.getElementById('cancel-reply-btn').onclick = exitReplyMode;

function exitEditMode() {
    currentEditingMessage = null;
    document.getElementById('edit-preview-bar').style.display = 'none';
}

function exitReplyMode() {
    currentReplyMessage = null;
    document.getElementById('reply-preview-bar').style.display = 'none';
}

async function deleteMessage(messageId) {
    if (!currentChatId) return;

    const confirmed = await showConfirm("Delete Message", "Are you sure you want to delete this message?");
    if (confirmed) {
        try {
            await remove(ref(db, `messages/${currentChatId}/${messageId}`));
        } catch (err) {
            console.error("Error deleting message:", err);
            
            if (err.message.includes("permission_denied")) {
                showNotification("Permission Denied: You can only delete your own messages.", "error");
            } else {
                showNotification("Failed to delete message.", "error");
            }
        }
    }
}

// --- Smart Relative Date & Timestamp Formatting ---
function formatSmartTimestamp(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';

    const now = new Date();

    const isToday = (
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear()
    );

    const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    if (isToday) {
        return timeStr;
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = (
        date.getDate() === yesterday.getDate() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getFullYear() === yesterday.getFullYear()
    );

    if (isYesterday) {
        return `Yesterday, ${timeStr}`;
    }

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = monthNames[date.getMonth()];
    const day = date.getDate();

    if (date.getFullYear() === now.getFullYear()) {
        return `${month} ${day}, ${timeStr}`;
    } else {
        return `${month} ${day}, ${date.getFullYear()}, ${timeStr}`;
    }
}
window.formatSmartTimestamp = formatSmartTimestamp;

// --- Orion Updates Global Broadcast Channel Subscription ---
async function ensureOrionUpdatesChannel(myUid) {
    if (!myUid) return;
    const channelId = 'channel_orion_updates';
    try {
        const chatRef = ref(db, `chats/${channelId}`);
        const chatSnap = await get(chatRef);
        if (!chatSnap.exists()) {
            await set(chatRef, {
                id: channelId,
                name: "Orion Updates",
                title: "Orion Updates",
                type: "channel",
                isGroup: true,
                isChannel: true,
                isSystem: true,
                readOnly: true,
                creatorId: "system",
                description: "Official system updates and announcements",
                last_message: "🚀 Welcome to Orion Updates! All official announcements and patch notes will be posted here.",
                timestamp: serverTimestamp()
            }).catch(() => {});
        }
        // Auto-subscribe current user
        const userChatRef = ref(db, `user_chats/${myUid}/${channelId}`);
        await set(userChatRef, true).catch(() => {});
        // Ensure user membership
        if (channelId !== 'channel_orion_updates') {
            const memberRef = ref(db, `members/${channelId}/${myUid}`);
            await set(memberRef, { role: 'member' }).catch(() => {});
        } else {
            console.log('[DB] Skipping member write for read-only announcement channel.');
        }

        // Ensure initial welcome announcement exists if channel messages are empty
        const msgQuery = query(ref(db, `messages/${channelId}`), limitToLast(1));
        const msgSnap = await get(msgQuery);
        if (!msgSnap.exists() || msgSnap.size === 0) {
            const welcomeKey = push(ref(db, `messages/${channelId}`)).key;
            await set(ref(db, `messages/${channelId}/${welcomeKey}`), {
                sender_id: "system",
                sender_name: "Orion System",
                text: "🚀 Welcome to Orion Updates! All official announcements, feature updates, and patch notes will be posted here.",
                timestamp: serverTimestamp(),
                createdAt: Date.now()
            }).catch(() => {});
        }
    } catch (err) {
        console.warn("[Orion Updates] Error subscribing to channel:", err);
    }
}
window.ensureOrionUpdatesChannel = ensureOrionUpdatesChannel;

// --- Message Pinning with Role-Based Access ---
function canCurrentUserPin(chatData = currentChatData) {
    const myUid = auth.currentUser?.uid;
    if (!myUid || !currentChatId) return false;
    const isGroup = !!(chatData?.isGroup || chatData?.isChannel || chatData?.type === 'channel' || chatData?.isSystem);
    if (!isGroup) return true;
    if (myUid === (chatData?.creatorId || currentChatCreatorId)) return true;
    const myRole = currentChatMemberData?.[myUid]?.role || chatData?.members?.[myUid]?.role || 'member';
    return myRole === 'admin' || myRole === 'mod' || myRole === 'moderator';
}

function extractPinnedMessagePreview(msgData) {
    if (!msgData) return '[Attachment]';
    if (msgData.stickerId) return '[Sticker]';
    if (msgData.poll?.question) return `[Poll] ${msgData.poll.question}`;
    if (msgData.imageUrl) return msgData.text && !msgData.text.startsWith('data:image/') && msgData.text !== msgData.imageUrl ? msgData.text : '[Image]';
    if (msgData.videoUrl) return '[Video]';
    if (typeof msgData.text === 'string' && msgData.text.trim()) {
        const trimmed = msgData.text.trim();
        if (trimmed.startsWith('data:image/') || /^\[IMG\].*\[\/IMG\]$/i.test(trimmed)) {
            return '[Image]';
        }
        return trimmed.replace(/\[IMG\].*?\[\/IMG\]/gi, '[Image]').trim() || '[Attachment]';
    }
    return '[Attachment]';
}

async function pinMessage(msgId) {
    if (!currentChatId || !currentChatData || !msgId) return;
    if (!canCurrentUserPin()) {
        showNotification("Only admins or moderators can pin messages in groups.", "error");
        return;
    }
    let pins = Array.isArray(currentChatData.pinnedMessages) ? [...currentChatData.pinnedMessages] : [];
    if (currentChatData.pinnedMessageId && pins.length === 0) {
        pins = [currentChatData.pinnedMessageId]; // Legacy migration
    }

    const maxPins = currentChatData.isGroup ? 5 : 3;
    if (pins.includes(msgId)) return showNotification("Message is already pinned", "info");

    if (pins.length >= maxPins) {
        pins.shift(); // Remove oldest to make room
    }
    pins.push(msgId);

    try {
        await update(ref(db, `chats/${currentChatId}`), { pinnedMessages: pins, pinnedMessageId: null });
        showNotification(`Message pinned (${pins.length}/${maxPins})`, "success");
    } catch (err) {
        console.error("Failed to pin message:", err);
        showNotification("Failed to pin message", "error");
    }
}
window.pinMessage = pinMessage;

async function unpinMessage(msgId) {
    if (!currentChatId || !currentChatData || !msgId) return;
    if (!canCurrentUserPin()) {
        showNotification("Only admins or moderators can unpin messages in groups.", "error");
        return;
    }
    let pins = Array.isArray(currentChatData.pinnedMessages) ? [...currentChatData.pinnedMessages] : [];
    if (currentChatData.pinnedMessageId && pins.length === 0) {
        pins = [currentChatData.pinnedMessageId]; // Legacy migration
    }
    pins = pins.filter(id => id !== msgId);

    try {
        await update(ref(db, `chats/${currentChatId}`), { pinnedMessages: pins, pinnedMessageId: null });
        showNotification("Message unpinned", "info");

        // Post-unpin deletion check (if older than 5 days)
        const msgRef = ref(db, `messages/${currentChatId}/${msgId}`);
        const snap = await get(msgRef);
        if (snap.exists()) {
            const msgData = snap.val();
            const msgCreatedAt = msgData?.createdAt || msgData?.timestamp;
            const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
            if (msgCreatedAt && (Date.now() - msgCreatedAt > fiveDaysMs)) {
                await remove(msgRef);
                console.log("[Pinning] Cleaned up unpinned message older than 5 days.");
            }
        }
    } catch (err) {
        console.error("Failed to unpin message:", err);
        showNotification("Failed to unpin message", "error");
    }
}
window.unpinMessage = unpinMessage;

function updatePinnedMessageBanner(chatData, expectedChatId = currentChatId) {
    const banner = document.getElementById('pinned-message-banner');
    const pinsContainer = document.getElementById('pinned-messages-container');
    if (!banner || !pinsContainer) return;

    let pins = Array.isArray(chatData?.pinnedMessages) ? [...chatData.pinnedMessages] : [];
    if (chatData?.pinnedMessageId && pins.length === 0) {
        pins = [chatData.pinnedMessageId]; // Legacy
    }

    if (pins.length > 0 && expectedChatId) {
        banner.style.display = 'flex';
        pinsContainer.innerHTML = '';

        const hasPerms = canCurrentUserPin(chatData);

        pins.forEach((msgId, index) => {
            const item = document.createElement('div');
            item.className = 'pinned-item';

            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; flex: 1; min-width: 0;">
                    <span style="color: var(--accent); font-size: 14px; white-space: nowrap;">📌 <small style="opacity:0.65; font-size:10px;">${index + 1}/${pins.length}</small></span>
                    <div id="pin-text-${msgId}" style="font-size: 13px; color: var(--text, #ffffff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;">Loading...</div>
                </div>
                <button type="button" class="glass-btn-secondary unpin-dynamic-btn" style="display: ${hasPerms ? 'block' : 'none'}; padding: 4px 8px; font-size: 10px; margin-left: 10px;">Unpin</button>
            `;

            item.querySelector('.unpin-dynamic-btn').onclick = (e) => {
                e.stopPropagation();
                unpinMessage(msgId);
            };

            item.onclick = () => {
                const msgEl = document.getElementById(`msg-${msgId}`);
                if (msgEl) {
                    msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    msgEl.classList.add('highlight-flash');
                    msgEl.style.background = 'rgba(255, 255, 255, 0.1)';
                    setTimeout(() => {
                        msgEl.style.background = '';
                        msgEl.classList.remove('highlight-flash');
                    }, 1500);
                } else {
                    showNotification("Pinned message is older than loaded history.", "info");
                }
            };

            pinsContainer.appendChild(item);
            if (window.twemoji) twemoji.parse(item);

            get(ref(db, `messages/${expectedChatId}/${msgId}`)).then(snap => {
                if (currentChatId !== expectedChatId) return;
                const textEl = document.getElementById(`pin-text-${msgId}`);
                if (!textEl) return;
                if (snap.exists()) {
                    const mData = snap.val();
                    textEl.innerText = extractPinnedMessagePreview(mData);
                    if (window.twemoji) twemoji.parse(textEl);
                } else {
                    textEl.innerText = '[Message deleted or expired]';
                }
            }).catch(() => {
                const textEl = document.getElementById(`pin-text-${msgId}`);
                if (textEl) textEl.innerText = '[Message deleted or expired]';
            });
        });
    } else {
        banner.style.display = 'none';
        pinsContainer.innerHTML = '';
    }
}

function positionActionMenu(actionMenu, bubble, wrap, e) {
    actionMenu.style.transform = '';
    actionMenu.style.right = 'auto';
    actionMenu.style.left = '0px';
    actionMenu.style.bottom = 'auto';
    actionMenu.style.top = '0px';
    actionMenu.style.display = 'flex';

    wrap.style.zIndex = '100';
    wrap.style.position = 'relative';
    bubble.style.zIndex = '100';
    bubble.style.position = 'relative';

    const margin = 8; // Safe breathing room from top/bottom/side edges
    const chatContainer = document.getElementById('messages-container') || document.getElementById('chat-container');
    const rawContainerRect = chatContainer
        ? chatContainer.getBoundingClientRect()
        : { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };

    const boundsTop = Math.max(rawContainerRect.top, 0);
    const boundsBottom = Math.min(rawContainerRect.bottom, window.innerHeight);
    const boundsLeft = Math.max(rawContainerRect.left, 0);
    const boundsRight = Math.min(rawContainerRect.right, window.innerWidth);

    const bubbleRect = bubble.getBoundingClientRect();
    const menuRect = actionMenu.getBoundingClientRect();
    const menuWidth = actionMenu.offsetWidth || menuRect.width;
    const menuHeight = actionMenu.offsetHeight || menuRect.height;
    const parentRect = (actionMenu.offsetParent || bubble).getBoundingClientRect();

    // Calculate desired top in viewport coordinates and clamp within chat bounds
    let targetTop = bubbleRect.top;
    const minTop = boundsTop + margin;
    const maxTop = Math.max(minTop, boundsBottom - menuHeight - margin);
    if (targetTop > maxTop) {
        targetTop = maxTop;
    }
    if (targetTop < minTop) {
        targetTop = minTop;
    }

    actionMenu.style.bottom = 'auto';
    actionMenu.style.top = `${targetTop - parentRect.top}px`;

    const rawX = (e && typeof e.clientX === 'number' && e.clientX > 0) ? e.clientX : bubbleRect.left;
    let leftPos = rawX;
    const minLeft = boundsLeft + margin;
    const maxLeft = Math.max(minLeft, boundsRight - menuWidth - margin);
    if (leftPos > maxLeft) {
        leftPos = maxLeft;
    }
    if (leftPos < minLeft) {
        leftPos = minLeft;
    }

    actionMenu.style.left = `${leftPos - parentRect.left}px`;
}

function createPinActionMenuButton(messageId, closeMenuFn) {
    if (!canCurrentUserPin()) return null;
    const pinBtn = document.createElement('button');
    pinBtn.className = 'glass-btn-secondary action-menu-btn';
    pinBtn.innerHTML = '📌 Pin Message';
    pinBtn.onclick = (e) => {
        e.stopPropagation();
        pinMessage(messageId);
        if (typeof closeMenuFn === 'function') closeMenuFn();
    };
    return pinBtn;
}

// --- Telegram-Style Message Context Menu Controller ---
let activeContextTarget = null;

function openMessageContextMenu(messageId, msg, isMe, posX, posY) {
    const sheet = document.getElementById('message-context-sheet');
    const backdrop = document.getElementById('message-context-backdrop');
    if (!sheet) return;

    const myUid = auth.currentUser ? auth.currentUser.uid : null;
    const isGroupAdmin = currentChatMemberData?.[myUid]?.role === 'admin' || myUid === currentChatCreatorId;
    const canDelete = isMe || isGroupAdmin;
    const canEdit = isMe && !msg.poll && !msg.stickerId;
    const canCopy = !msg.poll && !msg.stickerId && !!msg.text;
    const canPin = canCurrentUserPin();

    activeContextTarget = {
        messageId,
        msg,
        isMe,
        canDelete,
        canEdit,
        canCopy,
        canPin
    };

    const pinBtn = document.getElementById('ctx-action-pin');
    if (pinBtn) pinBtn.style.display = canPin ? 'flex' : 'none';

    const editBtn = document.getElementById('ctx-action-edit');
    if (editBtn) editBtn.style.display = canEdit ? 'flex' : 'none';

    const deleteBtn = document.getElementById('ctx-action-delete');
    if (deleteBtn) deleteBtn.style.display = canDelete ? 'flex' : 'none';

    const copyBtn = document.getElementById('ctx-action-copy');
    if (copyBtn) copyBtn.style.display = canCopy ? 'flex' : 'none';

    if (window.twemoji) twemoji.parse(sheet);

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        sheet.classList.add('mobile-bottom-docked');
        sheet.style.left = '';
        sheet.style.top = '';
        sheet.classList.remove('hidden');
    } else {
        sheet.classList.remove('mobile-bottom-docked');
        sheet.classList.remove('hidden');
        const margin = 8;
        const sheetRect = sheet.getBoundingClientRect();
        const sheetWidth = sheet.offsetWidth || sheetRect.width || 250;
        const sheetHeight = sheet.offsetHeight || sheetRect.height || 220;
        let left = (typeof posX === 'number' && posX > 0) ? posX : (window.innerWidth / 2 - sheetWidth / 2);
        let top = (typeof posY === 'number' && posY > 0) ? posY : (window.innerHeight / 2 - sheetHeight / 2);

        const maxLeft = Math.max(margin, window.innerWidth - sheetWidth - margin);
        if (left > maxLeft) left = maxLeft;
        if (left < margin) left = margin;

        const maxTop = Math.max(margin, window.innerHeight - sheetHeight - margin);
        if (top > maxTop) top = maxTop;
        if (top < margin) top = margin;

        sheet.style.left = `${left}px`;
        sheet.style.top = `${top}px`;
    }

    if (backdrop) backdrop.classList.remove('hidden');
}

function closeMessageContextMenu() {
    const sheet = document.getElementById('message-context-sheet');
    const backdrop = document.getElementById('message-context-backdrop');
    if (sheet) sheet.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
    activeContextTarget = null;
}
window.closeMessageContextMenu = closeMessageContextMenu;

function attachMessageContextMenu(element, messageId, msg, isMe) {
    if (!element) return;
    let touchTimer = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let isTouchMoved = false;

    // Desktop: contextmenu (right-click)
    element.addEventListener('contextmenu', (e) => {
        if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
        e.preventDefault();
        e.stopPropagation();
        openMessageContextMenu(messageId, msg, isMe, e.clientX, e.clientY);
    });

    // Mobile: 450ms touch-and-hold (cleared on touchmove / touchend)
    element.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        isTouchMoved = false;

        if (touchTimer) clearTimeout(touchTimer);
        touchTimer = setTimeout(() => {
            if (!isTouchMoved) {
                if (window.navigator?.vibrate) {
                    try { window.navigator.vibrate(40); } catch (_) {}
                }
                openMessageContextMenu(messageId, msg, isMe, touchStartX, touchStartY);
            }
        }, 450);
    }, { passive: true });

    element.addEventListener('touchmove', (e) => {
        if (!touchTimer) return;
        const touch = e.touches[0];
        if (Math.abs(touch.clientX - touchStartX) > 8 || Math.abs(touch.clientY - touchStartY) > 8) {
            isTouchMoved = true;
            clearTimeout(touchTimer);
            touchTimer = null;
        }
    }, { passive: true });

    element.addEventListener('touchend', () => {
        if (touchTimer) {
            clearTimeout(touchTimer);
            touchTimer = null;
        }
    }, { passive: true });

    element.addEventListener('touchcancel', () => {
        if (touchTimer) {
            clearTimeout(touchTimer);
            touchTimer = null;
        }
    }, { passive: true });
}

let isMessageContextMenuInitialized = false;
function initMessageContextMenu() {
    if (isMessageContextMenuInitialized) return;
    isMessageContextMenuInitialized = true;

    const backdrop = document.getElementById('message-context-backdrop');
    if (backdrop) backdrop.onclick = closeMessageContextMenu;

    document.querySelectorAll('.ctx-reaction-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const emoji = btn.dataset.emoji;
            if (activeContextTarget && emoji) {
                toggleReaction(activeContextTarget.messageId, emoji);
            }
            closeMessageContextMenu();
        };
    });

    const replyBtn = document.getElementById('ctx-action-reply');
    if (replyBtn) {
        replyBtn.onclick = (e) => {
            e.stopPropagation();
            if (activeContextTarget) {
                const { messageId, msg } = activeContextTarget;
                const senderName = msg.sender_name || (msg.sender_id === 'system' ? 'Orion System' : 'User');
                replyToMessage(messageId, msg.text || (msg.stickerId ? '[Sticker]' : ''), senderName);
            }
            closeMessageContextMenu();
        };
    }

    const copyBtn = document.getElementById('ctx-action-copy');
    if (copyBtn) {
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            if (activeContextTarget && activeContextTarget.msg?.text) {
                const text = activeContextTarget.msg.text;
                if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(text).then(() => {
                        showNotification("Copied to clipboard", "info");
                    }).catch(() => {
                        showNotification("Copied to clipboard", "info");
                    });
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    showNotification("Copied to clipboard", "info");
                }
            }
            closeMessageContextMenu();
        };
    }

    const pinBtn = document.getElementById('ctx-action-pin');
    if (pinBtn) {
        pinBtn.onclick = (e) => {
            e.stopPropagation();
            if (activeContextTarget && activeContextTarget.canPin) {
                pinMessage(activeContextTarget.messageId);
            }
            closeMessageContextMenu();
        };
    }

    const editBtn = document.getElementById('ctx-action-edit');
    if (editBtn) {
        editBtn.onclick = (e) => {
            e.stopPropagation();
            if (activeContextTarget && activeContextTarget.canEdit) {
                editMessage(activeContextTarget.messageId, activeContextTarget.msg.text || '');
            }
            closeMessageContextMenu();
        };
    }

    const deleteBtn = document.getElementById('ctx-action-delete');
    if (deleteBtn) {
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            if (activeContextTarget && activeContextTarget.canDelete) {
                deleteMessage(activeContextTarget.messageId, !!activeContextTarget.msg.stickerId);
            }
            closeMessageContextMenu();
        };
    }

    // Dismiss on message list scroll
    const messagesCont = document.getElementById('messages-container');
    if (messagesCont) {
        messagesCont.addEventListener('scroll', closeMessageContextMenu, { passive: true });
    }

    // Dismiss on outside click
    document.addEventListener('pointerdown', (e) => {
        const sheet = document.getElementById('message-context-sheet');
        if (sheet && !sheet.classList.contains('hidden')) {
            if (!sheet.contains(e.target) && !e.target.closest('.msg-bubble')) {
                closeMessageContextMenu();
            }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMessageContextMenu();
    });
}
window.initMessageContextMenu = initMessageContextMenu;

// --- HORIZONTAL SWIPE-TO-REPLY GESTURE ---
let swipeStartX = 0;
let swipeStartY = 0;
let activeSwipeMessage = null;
let isSwipingRight = false;
let suppressSwipeClick = false;

document.addEventListener('touchstart', (e) => {
    // Only track single touch
    if (e.touches.length !== 1) return;

    const msgBubble = e.target.closest('.msg-bubble');
    if (!msgBubble) return;

    // Do not swipe system messages or when touching interactive controls
    if (msgBubble.closest('.system-msg')) return;
    if (e.target.closest('button, a, input, select, textarea, .msg-action-menu, .reaction-emoji, .expand-reactions-btn, .image-embed-wrapper, .chat-embedded-image')) return;

    activeSwipeMessage = msgBubble;
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    isSwipingRight = false;

    // Disable snap-back transition while finger is actively dragging
    activeSwipeMessage.style.transition = 'none';
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    if (!activeSwipeMessage) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - swipeStartX;
    const diffY = currentY - swipeStartY;

    // Lock into swipe mode only if moving horizontally more than vertically
    if (!isSwipingRight && Math.abs(diffX) > Math.abs(diffY) && diffX > 10) {
        isSwipingRight = true;
    }

    if (isSwipingRight && diffX > 0) {
        // Drag the bubble right, capped at 75px max distance
        const dragDistance = Math.min(diffX, 75);
        activeSwipeMessage.style.transform = `translateX(${dragDistance}px)`;
    }
}, { passive: true });

document.addEventListener('touchend', (e) => {
    if (!activeSwipeMessage) return;

    try {
        const diffX = e.changedTouches[0].clientX - swipeStartX;

        // Smoothly snap the message back to its original position
        activeSwipeMessage.style.transition = 'transform 0.25s ease-out';
        activeSwipeMessage.style.transform = 'translateX(0px)';

        // If swiped far enough right (e.g., > 50px), trigger the reply action
        if (isSwipingRight && diffX > 50) {
            console.log('[SWIPE] Triggering reply action');
            suppressSwipeClick = true;
            setTimeout(() => { suppressSwipeClick = false; }, 350);

            if (window.navigator?.vibrate) {
                try { window.navigator.vibrate(30); } catch (_) {}
            }

            if (activeSwipeMessage._replyData) {
                const { messageId, text, senderName } = activeSwipeMessage._replyData;
                replyToMessage(messageId, text, senderName);
            } else {
                const wrap = activeSwipeMessage.closest('.msg-wrapper');
                const msgId = activeSwipeMessage.dataset.messageId || wrap?.id?.replace(/^msg-/, '');
                const sName = activeSwipeMessage.dataset.senderName || wrap?.querySelector('.msg-author')?.innerText || 'User';
                const txt = activeSwipeMessage.dataset.text || activeSwipeMessage.querySelector('.msg-content')?.innerText || '';
                if (msgId) {
                    replyToMessage(msgId, txt, sName);
                }
            }
        } else if (isSwipingRight) {
            suppressSwipeClick = true;
            setTimeout(() => { suppressSwipeClick = false; }, 350);
        }
    } finally {
        activeSwipeMessage = null;
        isSwipingRight = false;
    }
});

document.addEventListener('touchcancel', (e) => {
    if (!activeSwipeMessage) return;

    // Reset the UI and clear the active state if Android interrupts the touch
    activeSwipeMessage.style.transition = 'transform 0.25s ease-out';
    activeSwipeMessage.style.transform = 'translateX(0px)';
    
    activeSwipeMessage = null;
    isSwipingRight = false;
});

// Prevent accidental clicks / menu triggers after a swipe gesture
window.addEventListener('click', (e) => {
    if (suppressSwipeClick) {
        e.stopPropagation();
        e.preventDefault();
    }
}, true);

// Reusable function to apply mute
async function applyMute(chatId, targetUid, durationMinutes, reason, currentMemberData) {
    // Check if target user is a global admin
    const userSnap = await get(ref(db, `users/${targetUid}`));
    const userData = userSnap.val() || {};
    if (userData.role === 'admin' || userData.isAdmin === true || String(userData.isAdmin).toLowerCase() === "true") {
        console.log(`[applyMute] User ${targetUid} is a global admin and immune to muting.`);
        return;
    }

    const mutedUntil = Date.now() + (durationMinutes * 60 * 1000);
    
    const updates = {};
    updates[`/members/${chatId}/${targetUid}`] = {
        role: currentMemberData?.[targetUid]?.role || 'member', // Preserve existing role
        mutedUntil,
        muteReason: reason
    };

    const userName = getDisplayName(userData);

    // Post System Message
    const readableTime = durationMinutes >= 1440 ? Math.floor(durationMinutes/1440) + "d" : durationMinutes >= 60 ? Math.floor(durationMinutes/60) + "h" : durationMinutes + "m";
    const sysMsgKey = push(ref(db, `messages/${chatId}`)).key;
    const sysText = `\u{1F6AB} ${userName} has been muted for ${readableTime}. Reason: ${reason}`;
    
    updates[`/messages/${chatId}/${sysMsgKey}`] = {
        sender_id: "system",
        sender_name: "System",
        text: sysText,
        createdAt: serverTimestamp(),
        timestamp: serverTimestamp()
    };
    updates[`/chats/${chatId}/last_message`] = sysText;
    updates[`/chats/${chatId}/timestamp`] = serverTimestamp();

    try {
        await update(ref(db), updates);
        // The checkMuteStatus will automatically update the input field for the muted user
        return true; // Indicate success
    } catch (error) {
        console.error("Error applying mute:", error);
        showNotification("Failed to apply mute.", "error");
        return false; // Indicate failure
    }
}

// --- Sticker Pack Functions ---
async function ensureDefaultPackExists() {
    const defaultSnap = await get(ref(db, 'sticker_packs/default_pack'));
    if (!defaultSnap.exists()) {
        await set(ref(db, 'sticker_packs/default_pack'), {
            packId: 'default_pack',
            name: 'Orion Collection',
            ownerId: 'system',
            authorName: 'Orion',
            createdAt: serverTimestamp()
        });
    }
}

async function createStickerPack(packName) {
    if (!auth.currentUser) return null;
    const myUid = auth.currentUser.uid;
    const userSnap = await get(ref(db, `users/${myUid}`));
    const userData = userSnap.val();
    const isAdmin = userData?.isAdmin === true || String(userData?.isAdmin).toLowerCase() === "true";
    if (!userData || (userData.type !== 'Premium' && !isAdmin)) {
        showNotification("Only premium users can create sticker packs.", "error");
        return null;
    }

    const myName = getDisplayName(userData);
    const packId = push(ref(db, 'sticker_packs')).key;
    const packData = {
        packId: packId,
        name: packName,
        ownerId: myUid,
        authorName: myName,
        createdAt: serverTimestamp()
    };

    const updates = {};
    updates[`/sticker_packs/${packId}`] = packData;
    updates[`/user_sticker_packs/${myUid}/${packId}`] = { addedAt: serverTimestamp() };

    try {
        await update(ref(db), updates);
        showNotification(`Sticker pack "${packName}" created!`, "success");
        return packId;
    } catch (err) {
        console.error("Error creating sticker pack:", err);
        showNotification("Failed to create sticker pack.", "error");
        return null;
    }
}

async function addPackToCollection(packId) {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    try {
        await set(ref(db, `user_sticker_packs/${myUid}/${packId}`), { addedAt: serverTimestamp() });
        showNotification("Sticker pack added to collection!", "success");
        if (currentPackPreviewId === packId) {
            updatePackPreviewCollectionButton(true);
        }
        if (activePickerTab === 'stickers' && document.getElementById('emoji-picker')?.style.display !== 'none') {
            renderPickerStickers();
        }
        if (document.getElementById('premium-panel-modal')?.style.display !== 'none') {
            renderStickerOptions();
        }
    } catch (err) {
        console.error(err);
        showNotification("Failed to add pack to collection.", "error");
    }
}

async function removePackFromCollection(packId) {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    try {
        await remove(ref(db, `user_sticker_packs/${myUid}/${packId}`));
        showNotification("Sticker pack removed from collection.", "info");
        if (currentPackPreviewId === packId) {
            updatePackPreviewCollectionButton(false);
        }
        if (activePickerTab === 'stickers' && document.getElementById('emoji-picker')?.style.display !== 'none') {
            renderPickerStickers();
        }
        if (document.getElementById('premium-panel-modal')?.style.display !== 'none') {
            renderStickerOptions();
        }
    } catch (err) {
        console.error(err);
        showNotification("Failed to remove pack.", "error");
    }
}

async function getOrCreatePackForUpload(myUid, myName, defaultTargetPackId = null) {
    if (defaultTargetPackId) return defaultTargetPackId;

    const q = query(ref(db, 'sticker_packs'), orderByChild('ownerId'), equalTo(myUid));
    const snap = await get(q);
    
    let packs = [];
    if (snap.exists()) {
        snap.forEach(pSnap => {
            packs.push(pSnap.val());
        });
    }

    if (packs.length === 0) {
        const packNameInput = await showConfirm("Create Sticker Pack", "You need a Sticker Pack to add this sticker to. Enter a Pack Name:", true, `${myName}'s Pack`);
        if (!packNameInput) return null;
        return await createStickerPack(packNameInput.trim() || `${myName}'s Pack`);
    }

    if (packs.length === 1) {
        return packs[0].packId;
    }

    // Multiple packs: prompt user to enter pack name or choose
    const packsListStr = packs.map(p => `\u{2022} ${p.name}`).join("\n");
    const choice = await showConfirm("Select Sticker Pack", `Choose target pack name or enter a NEW pack name:\nYour existing packs:\n${packsListStr}`, true, packs[0].name);
    if (!choice) return null;

    const matchedPack = packs.find(p => p.name.toLowerCase() === choice.trim().toLowerCase());
    if (matchedPack) {
        return matchedPack.packId;
    } else {
        return await createStickerPack(choice.trim());
    }
}

async function openStickerPackPreview(stickerId) {
    if (!stickerId) return;
    const myUid = auth.currentUser?.uid;
    const modal = document.getElementById('sticker-pack-preview-modal');
    const titleElem = document.getElementById('pack-preview-title');
    const authorElem = document.getElementById('pack-preview-author');
    const gridElem = document.getElementById('pack-preview-stickers-grid');
    const actionBtn = document.getElementById('toggle-pack-collection-btn');

    titleElem.innerText = 'Sticker';
    authorElem.innerText = '';
    gridElem.innerHTML = '<p style="text-align:center; opacity:0.6; width:100%;">Loading...</p>';
    actionBtn.style.display = 'none';
    modal.style.display = 'flex';

    const metaSnap = await safeGet(ref(db, `sticker_metadata/${stickerId}`));
    const meta = metaSnap && metaSnap.val();
    if (!meta) {
        gridElem.innerHTML = '<p style="text-align:center; opacity:0.6; width:100%;">This sticker no longer exists.</p>';
        return;
    }
    meta.stickerId = meta.stickerId || stickerId;

    const [ownerSnap, haveSnap] = await Promise.all([
        safeGet(ref(db, `users/${meta.ownerId}`)),
        myUid ? safeGet(ref(db, `user_stickers/${myUid}/${stickerId}`)) : Promise.resolve(null)
    ]);
    const ownerName = getDisplayName(ownerSnap?.val() || {});
    const isOwner = meta.ownerId === myUid;
    const haveIt = isOwner || !!(haveSnap && haveSnap.exists());

    titleElem.innerText = getStickerDisplayName(meta);
    authorElem.innerText = `By ${ownerName}`;
    gridElem.innerHTML = '';
    gridElem.style.display = 'flex';
    gridElem.style.justifyContent = 'center';
    const img = document.createElement('img');
    img.src = meta.storagePath;
    img.alt = getStickerDisplayName(meta);
    img.style.cssText = 'max-width:240px; max-height:240px; object-fit:contain; border-radius:12px;';
    gridElem.appendChild(img);

    actionBtn.style.display = '';
    actionBtn.style.color = '';
    actionBtn.disabled = false;
    if (isOwner) {
        actionBtn.innerText = '\u{2713} This is your sticker';
        actionBtn.className = 'glass-btn-secondary';
        actionBtn.disabled = true;
        actionBtn.onclick = null;
    } else if (haveIt) {
        actionBtn.innerText = '\u{2713} In your collection (Remove)';
        actionBtn.className = 'glass-btn-secondary';
        actionBtn.style.color = '#ff4b2b';
        actionBtn.onclick = async () => {
            try {
                await remove(ref(db, `user_stickers/${myUid}/${stickerId}`));
                showNotification("Sticker removed from your collection.", "info");
                closeAnimatedModal(modal);
            } catch (err) { showNotification("Couldn't remove sticker.", "error"); }
        };
    } else {
        actionBtn.innerText = 'Request this sticker';
        actionBtn.className = 'glass-btn-primary';
        actionBtn.onclick = () => {
            closeAnimatedModal(modal);
            openStickerRequestModal(stickerId, meta.ownerId, getStickerDisplayName(meta));
        };
    }
}

function updatePackPreviewCollectionButton(isInCollection) {
    const toggleBtn = document.getElementById('toggle-pack-collection-btn');
    if (!toggleBtn) return;

    if (isInCollection) {
        toggleBtn.innerText = '\u{2713} In Collection (Remove)';
        toggleBtn.className = 'glass-btn-secondary';
        toggleBtn.style.color = '#ff4b2b';
        toggleBtn.onclick = () => removePackFromCollection(currentPackPreviewId);
    } else {
        toggleBtn.innerText = '+ Add to Collection';
        toggleBtn.className = 'glass-btn-primary';
        toggleBtn.style.color = '';
        toggleBtn.onclick = () => addPackToCollection(currentPackPreviewId);
    }
}

async function uploadSticker(file, targetPackId = null) {
    if (!auth.currentUser) {
        showNotification("You must be logged in to upload stickers.", "error");
        return;
    }
    const myUid = auth.currentUser.uid;
    const userSnap = await get(ref(db, `users/${myUid}`));
    const userData = userSnap.val();
    const isAdmin = userData?.isAdmin === true || String(userData?.isAdmin).toLowerCase() === "true";
    if (!userData || (userData.type !== 'Premium' && !isAdmin)) {
        showNotification("Only premium users can upload stickers.", "error");
        return;
    }

    const ownedStickersSnap = await get(query(ref(db, `user_stickers/${myUid}`), orderByChild('type'), equalTo('owned')));
    if (ownedStickersSnap.size >= STICKER_UPLOAD_LIMIT) {
        showNotification(`You have reached your limit of ${STICKER_UPLOAD_LIMIT} uploaded stickers.`, "error");
        return;
    }

    if (!file) {
        showNotification("No file selected.", "error");
        return;
    }

    // Client-side validation
    const allowedTypes = ['image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
        showNotification("Only PNG, WEBP, and GIF images are allowed.", "error");
        return;
    }
    if (file.size > 1 * 1024 * 1024) { // 1MB limit
        showNotification("Sticker file size cannot exceed 1MB.", "error");
        return;
    }

    const defaultName = file.name.split('.')[0];
    const stickerNameInput = await showConfirm("Sticker Name", "Give your sticker a name:", true, defaultName);
    if (stickerNameInput === null) return;
    const stickerName = stickerNameInput.trim() || defaultName;

    showNotification("Uploading and processing sticker...", "info");
    
    const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    });
    
    const stickerId = push(ref(db, `sticker_metadata`)).key;
    const simulatedPath = dataUrl;

    const stickerMetadata = {
        stickerId: stickerId,
        ownerId: myUid,
        originalFileName: stickerName,
        storagePath: simulatedPath, 
        thumbnailStoragePath: simulatedPath,
        createdAt: serverTimestamp(),
        fileSize: file.size,
        mimeType: file.type,
    };

    const updates = {};
    updates[`/sticker_metadata/${stickerId}`] = stickerMetadata;
    updates[`/user_stickers/${myUid}/${stickerId}`] = {
        type: 'owned',
        metadataRef: stickerId,
        createdAt: serverTimestamp()
    };

    try {
        await update(ref(db), updates);
        showNotification("Sticker uploaded successfully!", "success");
        renderStickerOptions();
        if (activePickerTab === 'stickers' && document.getElementById('emoji-picker')?.style.display !== 'none') {
            renderPickerStickers();
        }
    } catch (error) {
        console.error("Error uploading sticker:", error);
        showNotification("Failed to upload sticker.", "error");
    }
}

async function deleteSticker(stickerId) {
    const confirmed = await showConfirm("Delete Sticker", "Are you sure you want to delete this sticker? This will remove it for everyone.");
    if (!confirmed) return;

    const myUid = auth.currentUser.uid;
    const stickerMetaSnap = await get(ref(db, `sticker_metadata/${stickerId}`));
    const stickerMeta = stickerMetaSnap.val();

    if (!stickerMeta || stickerMeta.ownerId !== myUid) {
        showNotification("You can only delete your own stickers.", "error");
        return;
    }

    try {
        // In a real app, a Cloud Function would also delete from Firebase Storage
        await remove(ref(db, `sticker_metadata/${stickerId}`));
        await remove(ref(db, `user_stickers/${myUid}/${stickerId}`));
        showNotification("Sticker deleted.", "success");
        renderStickerOptions(); // Refresh the list
    } catch (error) {
        console.error("Error deleting sticker message:", error);
        showNotification("Failed to delete sticker.", "error");
    }
}

function resetMessageActionMenus(clickTarget = null) {
    document.querySelectorAll('.msg-action-menu').forEach(menu => {
        if (menu.classList.contains('plus-popup')) return;
        if (clickTarget && menu.parentElement && menu.parentElement.contains(clickTarget)) return;
        menu.style.display = 'none';
        menu.style.transform = '';
        menu.style.top = '';
        menu.style.bottom = '';
        menu.style.left = '';
        menu.style.right = '';
        const parentWrap = menu.closest('.msg-wrapper');
        if (parentWrap) {
            parentWrap.style.zIndex = '';
            parentWrap.style.position = '';
        }
        const parentBubble = menu.closest('.msg-bubble');
        if (parentBubble) {
            parentBubble.style.zIndex = '';
            parentBubble.style.position = '';
        }
    });
}

// Global click listener to close message action menus
document.addEventListener('click', (e) => {
    resetMessageActionMenus(e.target);
});

async function toggleReaction(messageId, emoji) {
    if (!currentChatId || !auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    const reactionRef = ref(db, `messages/${currentChatId}/${messageId}/reactions/${emoji}/${myUid}`);
    
    try {
        const snap = await get(reactionRef);
        if (snap.exists()) {
            await remove(reactionRef);
        } else {
            await set(reactionRef, true);
        }
    } catch (err) {
        console.error("Reaction error:", err);
    }
}

function setupPresence(uid) {
    const statusRef = ref(db, `users/${uid}/status`);
    const connectedRef = ref(db, ".info/connected");

    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            onDisconnect(statusRef).set("offline");
            set(statusRef, "online");
        }
    });
}

/* ---------------- MESSAGING / NOTIFICATIONS ---------------- */

async function setupCapacitorPushNotifications(uid) {
    try {
        // Resolve PushNotifications plugin from Capacitor global bridge or dynamic import
        let PushNotifications = window.Capacitor?.Plugins?.PushNotifications;
        if (!PushNotifications && window.Capacitor) {
            try {
                const module = await import('@capacitor/push-notifications');
                PushNotifications = module.PushNotifications;
            } catch (e) {
                // Ignore dynamic import failure in non-bundled browser mode
            }
        }

        const isNative = window.Capacitor && (
            (typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
            (window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web') ||
            Boolean(PushNotifications)
        );

        if (!isNative || !PushNotifications) {
            return false; // Fall back to Web FCM
        }

        console.log('Initializing Capacitor Native Push Notifications...');

        // 1. Create default Android notification channel if supported
        if (typeof PushNotifications.createChannel === 'function') {
            try {
                await PushNotifications.createChannel({
                    id: 'default',
                    name: 'Default',
                    description: 'Standard notifications for new messages',
                    importance: 5,
                    visibility: 1,
                    sound: 'default',
                    vibration: true
                });
                console.log('Capacitor default notification channel ensured');
            } catch (chanErr) {
                console.warn('Could not create notification channel:', chanErr);
            }
        }

        // 2. Permission check and request
        let permStatus = await PushNotifications.checkPermissions();
        console.log('Capacitor Push initial permission status:', permStatus);

        if (permStatus.receive === 'prompt' || permStatus.receive === 'prompt-with-rationale') {
            permStatus = await PushNotifications.requestPermissions();
            console.log('Capacitor Push requested permission status:', permStatus);
        }

        if (permStatus.receive !== 'granted') {
            console.warn('Capacitor Push notification permission not granted:', permStatus.receive);
            return true; // Handled natively, but permission denied
        }

        // 3. Register for push notifications with native OS (FCM on Android)
        await PushNotifications.register();

        // 4. Setup Listeners
        await PushNotifications.removeAllListeners();

        // Registration success: FCM / APNS token received
        await PushNotifications.addListener('registration', async (token) => {
            console.log('Capacitor Push registration success! Token:', token.value);
            if (uid && token?.value) {
                try {
                    const tokenClean = token.value.replace(/[.#$[\]]/g, '_');
                    const updates = {};
                    updates[`users/${uid}/fcmToken`] = token.value;
                    updates[`users/${uid}/fcmTokens/${tokenClean}`] = true;
                    await update(ref(db), updates);

                    console.log('Successfully saved native FCM token to Firebase for user:', uid);
                } catch (err) {
                    console.error('Failed to save native FCM token to Firebase:', err);
                }
            }
        });

        // Registration error
        await PushNotifications.addListener('registrationError', (error) => {
            console.error('Capacitor Push registration error:', error);
        });

        // Foreground push notification received
        await PushNotifications.addListener('pushNotificationReceived', (notification) => {
            console.log('Capacitor push notification received in foreground:', notification);
            notifyIncomingMessage({
                chatId: notification?.data?.chatId,
                title: notification.title || 'New Message',
                body: notification.body || ''
            });
        });

        // Notification clicked / action performed by user
        await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
            console.log('Capacitor push notification action performed:', action);
            const data = action.notification?.data;
            if (data?.chatId) {
                openChat(data.chatId, data.chatTitle || 'Chat');
            }
        });

        return true;
    } catch (err) {
        console.warn('Capacitor Push Notifications setup failed or not supported in this environment:', err);
        return false;
    }
}

/* ---------------- SELF-HOSTED OVER-THE-AIR (OTA) UPDATES ---------------- */

const CURRENT_APP_VERSION = '1.2.41';
const CURRENT_VERSION = CURRENT_APP_VERSION;

async function updateSettingsVersionDisplay() {
    const allVersionEls = document.querySelectorAll('#settings-app-version, .app-version-label, #app-current-version, #account-tab-app-version');
    let finalVersion = typeof CURRENT_APP_VERSION !== 'undefined' ? CURRENT_APP_VERSION : '1.2.41';

    try {
        if (window.Capacitor?.isPluginAvailable('CapacitorUpdater')) {
            const current = await window.Capacitor.Plugins.CapacitorUpdater.current();
            if (current?.bundle?.version) {
                finalVersion = String(current.bundle.version);
            }
        }
    } catch (e) {
        console.warn('Could not read bundle version:', e);
    }
    
    // Forcefully remove all 'v' or 'V' characters, then add exactly one 'v'
    const cleanVersion = 'v' + String(finalVersion).toLowerCase().replace(/v/g, '').trim();
    
    allVersionEls.forEach(el => {
        if (el) el.textContent = cleanVersion;
    });
}
window.updateSettingsVersionDisplay = updateSettingsVersionDisplay;
const UPDATE_MANIFEST_URL = window.ORION_UPDATE_URL || ('https://raw.githubusercontent.com/1409yak/orion-web/main/version.json?t=' + Date.now());
const UPDATE_CHECK_URL = UPDATE_MANIFEST_URL;
let activeOtaManifest = null;
let isDownloadingUpdate = false;

async function getCapacitorUpdater() {
    let updater = window.Capacitor?.Plugins?.CapacitorUpdater;
    if (!updater && window.Capacitor) {
        try {
            const module = await import('@capgo/capacitor-updater');
            updater = module.CapacitorUpdater || module.default;
        } catch (e) {
            // Non-bundled browser mode fallback
        }
    }
    return updater;
}

// Call notifyAppReady immediately so current bundle is marked valid and rollback is avoided
async function initCapacitorUpdater() {
    try {
        if (window.Capacitor?.isPluginAvailable('CapacitorUpdater')) {
            await window.Capacitor.Plugins.CapacitorUpdater.notifyAppReady();
            console.log('[OTA] notifyAppReady() called successfully.');
            return;
        }
        const updater = await getCapacitorUpdater();
        if (updater && typeof updater.notifyAppReady === 'function') {
            await updater.notifyAppReady();
            console.log('[OTA] notifyAppReady() called successfully.');
        }
    } catch (err) {
        console.warn('[OTA] notifyAppReady() error:', err);
    }
}

function isNewerVersion(remote, current) {
    if (!remote || !current) return false;
    const rClean = String(remote).toLowerCase().replace(/^v+/, '').trim();
    const cClean = String(current).toLowerCase().replace(/^v+/, '').trim();
    if (rClean === cClean) return false;
    const rParts = rClean.split('.').map(n => parseInt(n, 10) || 0);
    const cParts = cClean.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(rParts.length, cParts.length); i++) {
        const r = rParts[i] || 0;
        const c = cParts[i] || 0;
        if (r > c) return true;
        if (r < c) return false;
    }
    return false;
}

function showOtaUpdateBanner(manifest) {
    activeOtaManifest = manifest;
    const banner = document.getElementById('ota-update-banner');
    if (!banner) return;

    const versionEl = document.getElementById('ota-new-version');
    if (versionEl) {
        versionEl.textContent = 'v' + (manifest.version || '');
    }

    const notesEl = document.getElementById('ota-notes');
    if (notesEl) {
        notesEl.textContent = manifest.notes || manifest.releaseNotes || manifest.description || 'New version available with stability and performance updates.';
    }

    const applyBtn = document.getElementById('btn-apply-update');
    if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Update & Reload';
        applyBtn.onclick = () => applyUpdateAndReload();
    }

    const dismissBtn = document.getElementById('btn-dismiss-update');
    if (dismissBtn) {
        dismissBtn.style.display = 'inline-flex';
        dismissBtn.onclick = () => dismissOtaUpdateBanner();
    }

    banner.classList.remove('hidden');
    banner.classList.add('active');
}

function dismissOtaUpdateBanner() {
    if (isDownloadingUpdate) return;
    const banner = document.getElementById('ota-update-banner');
    if (!banner) return;
    banner.classList.remove('active');
    banner.classList.add('hidden');
}

async function applyUpdateAndReload() {
    if (isDownloadingUpdate || !activeOtaManifest) return;
    isDownloadingUpdate = true;
    const targetVer = activeOtaManifest.version || '1.0.4';
    const bundleUrl = activeOtaManifest.url || `https://orion-fcm-worker.gaim.workers.dev/download-ota/v${targetVer}/bundle.zip`;
    const checksum = activeOtaManifest.checksum || '25cb5c41e94305a32b7d743ac33df4eb05fe0c595b6a49abc00b26cd99f63cd0';
    try {
        await downloadAndApplyUpdate(targetVer, bundleUrl, checksum);
    } finally {
        isDownloadingUpdate = false;
    }
}

async function checkForUpdates(isManual = false) {
    const btnCheck = document.getElementById('btn-check-updates') || document.getElementById('settings-check-update-btn');
    const accountCheckBtn = document.getElementById('account-check-update-btn');
    const statusMsg = document.getElementById('settings-update-msg');
    const origBtnHtml = btnCheck ? btnCheck.innerHTML : '';

    if (isManual) {
        if (btnCheck) {
            btnCheck.disabled = true;
            btnCheck.textContent = 'Checking...';
        }
        if (accountCheckBtn) accountCheckBtn.disabled = true;
        if (statusMsg) {
            statusMsg.textContent = 'Checking for updates...';
            statusMsg.style.color = 'rgba(255, 255, 255, 0.6)';
        }
    }

    try {
        const manifestUrl = 'https://raw.githubusercontent.com/1409yak/orion-web/main/version.json?t=' + Date.now();
        console.log(`[OTA] Checking manifest from: ${manifestUrl}`);
        const response = await fetch(manifestUrl, {
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const manifest = await response.json();
        console.log('[OTA] Successfully retrieved manifest:', manifest);
        if (!manifest || !manifest.version || !manifest.url) {
            throw new Error('Invalid version manifest');
        }

        activeOtaManifest = manifest;

        let currentVersion = typeof CURRENT_APP_VERSION !== 'undefined' ? CURRENT_APP_VERSION : '1.2.41';
        try {
            if (window.Capacitor?.isPluginAvailable('CapacitorUpdater')) {
                const current = await window.Capacitor.Plugins.CapacitorUpdater.current();
                if (current?.bundle?.version) {
                    currentVersion = String(current.bundle.version);
                }
            }
        } catch (e) {
            console.warn('[OTA] Could not read Capgo version:', e);
        }

        console.log(`[OTA] Remote version: ${manifest.version}, Installed: ${currentVersion}`);

        // Now compare currentVersion to manifest.version
        const cleanManifestVer = manifest.version.toLowerCase().replace(/^v+/, '').trim();
        const cleanCurrentVer = currentVersion.toLowerCase().replace(/^v+/, '').trim();

        if (cleanManifestVer !== cleanCurrentVer && isNewerVersion(manifest.version, currentVersion)) {
            if (statusMsg) {
                statusMsg.textContent = `Update available: v${manifest.version}!`;
                statusMsg.style.color = '#00ff88';
            }
            showOtaUpdateBanner(manifest);
        } else {
            if (statusMsg) {
                statusMsg.textContent = `You are on the latest version (v${currentVersion}).`;
                statusMsg.style.color = 'rgba(255, 255, 255, 0.7)';
            }
            if (isManual) {
                showNotification(`You are on the latest version (v${currentVersion})`, 'info');
            }
        }
    } catch (err) {
        console.error('[OTA] checkForUpdates error:', err);
        const errMsg = err.message && err.message.startsWith('HTTP')
            ? err.message
            : (err.message ? `Error: ${err.message}` : 'Check connection.');
        if (statusMsg) {
            statusMsg.textContent = `Could not check for updates (${errMsg}).`;
            statusMsg.style.color = '#ff6b6b';
        }
        if (isManual) {
            showNotification(`Could not check for updates. ${errMsg}`, 'error');
        }
    } finally {
        if (isManual) {
            if (btnCheck) {
                btnCheck.disabled = false;
                btnCheck.innerHTML = origBtnHtml || '🔄 Check for Updates';
            }
            if (accountCheckBtn) accountCheckBtn.disabled = false;
        }
    }
}

// Backward compatibility & global access
const checkAppUpdates = checkForUpdates;
const checkForAppUpdate = checkForUpdates;
window.checkForUpdates = checkForUpdates;
window.checkAppUpdates = checkForUpdates;
window.checkForAppUpdate = checkForUpdates;

function openSettingsAndCheckUpdate() {
    if (typeof openPremiumPanelModal === 'function') {
        openPremiumPanelModal('appinfo');
    }
    setTimeout(() => {
        if (typeof checkForUpdates === 'function') {
            checkForUpdates(true);
        }
    }, 250);
}
window.openSettingsAndCheckUpdate = openSettingsAndCheckUpdate;

let isInstallingFromChannel = false;

async function downloadAndApplyUpdate(targetVersion, bundleUrl, checksum = null) {
    console.log("Starting download for version:", targetVersion, "from:", bundleUrl);
    const btns = document.querySelectorAll('.channel-install-btn, #btn-apply-update');
    btns.forEach(btn => {
        btn.disabled = true;
        btn.textContent = "Connecting...";
    });

    const isNative = window.Capacitor && (typeof window.Capacitor.isNativePlatform === 'function' ? window.Capacitor.isNativePlatform() : (window.Capacitor.getPlatform() !== 'web'));

    if (!isNative) {
        console.log('[OTA] Non-native/browser environment detected for version:', targetVersion);
        alert('Update installed! Reloading...');
        location.reload();
        return;
    }

    try {
        let downloadUrl = bundleUrl;
        // Map any temporary/preview workers.dev domains to the permanent authenticated worker
        if (downloadUrl.includes('pale-fascinator.workers.dev') || downloadUrl.includes('charming-button.workers.dev') || downloadUrl.includes('accurate-onyx.workers.dev')) {
            downloadUrl = downloadUrl.replace(/(pale-fascinator|charming-button|accurate-onyx)\.workers\.dev/, 'gaim.workers.dev');
        }

        // Ensure path-based .zip format is used for Cloudflare worker proxy
        if (downloadUrl.includes('/download-ota?version=')) {
            const vMatch = downloadUrl.match(/version=([^&]+)/);
            if (vMatch) {
                const cleanV = vMatch[1].startsWith('v') ? vMatch[1] : `v${vMatch[1]}`;
                downloadUrl = `https://orion-fcm-worker.gaim.workers.dev/download-ota/${cleanV}/bundle.zip`;
            }
        }

        // If direct github release asset URL is provided instead of worker proxy, resolve redirect
        if (downloadUrl.includes('github.com') && downloadUrl.includes('/releases/download/')) {
            try {
                const headRes = await fetch(downloadUrl, { method: 'HEAD', redirect: 'follow' });
                if (headRes.url && headRes.url !== downloadUrl) {
                    console.log("Resolved redirected URL:", headRes.url);
                    downloadUrl = headRes.url;
                }
            } catch (fetchErr) {
                console.warn("Could not pre-resolve redirect, using direct URL:", fetchErr);
            }
        }

        btns.forEach(btn => {
            btn.textContent = "Downloading (please wait)...";
        });

        bundleUrl = downloadUrl;
        const manifestChecksum = checksum || (activeOtaManifest && activeOtaManifest.checksum);

        const downloadOptions = {
            url: bundleUrl,
            version: String(targetVersion),
            checksum: manifestChecksum || '25cb5c41e94305a32b7d743ac33df4eb05fe0c595b6a49abc00b26cd99f63cd0'
        };

        console.log('[OTA] Downloading bundle with checksum:', downloadOptions);
        const bundle = await window.Capacitor.Plugins.CapacitorUpdater.download(downloadOptions);
        btns.forEach(btn => {
            btn.textContent = "Applying update...";
        });
        console.log('[OTA] Bundle downloaded successfully:', bundle);
        await window.Capacitor.Plugins.CapacitorUpdater.set(bundle);
        console.log('[OTA] Reloading app via CapacitorUpdater.reload()...');
        window.Capacitor.Plugins.CapacitorUpdater.reload();
    } catch (err) {
        console.error("Full update failure details:", err);
        btns.forEach(btn => {
            btn.disabled = false;
            btn.textContent = "⚠️ Failed (Tap to retry)";
        });
        alert("Download failed: " + (err.message || JSON.stringify(err)));
    }
}
window.downloadAndApplyUpdate = downloadAndApplyUpdate;

window.triggerOtaUpdate = async function(targetVersion = '1.0.4', directUrl = null, directChecksum = null) {
    if (isInstallingFromChannel) return;
    isInstallingFromChannel = true;

    try {
        let bundleUrl = directUrl || `https://orion-fcm-worker.gaim.workers.dev/download-ota/v${targetVersion}/bundle.zip`;
        let manifestChecksum = directChecksum || (activeOtaManifest ? activeOtaManifest.checksum : null);

        if (!directUrl || !manifestChecksum) {
            try {
                const manifestUrl = 'https://raw.githubusercontent.com/1409yak/orion-web/main/version.json?t=' + Date.now();
                const manifestResp = await fetch(manifestUrl, {
                    headers: { 'Accept': 'application/json' }
                });
                if (manifestResp.ok) {
                    const manifest = await manifestResp.json();
                    activeOtaManifest = manifest;
                    if (manifest && manifest.url && !directUrl) {
                        bundleUrl = manifest.url;
                    }
                    if (manifest && manifest.checksum && !manifestChecksum) {
                        manifestChecksum = manifest.checksum;
                    }
                }
            } catch (mErr) {
                console.warn('[OTA] Could not fetch manifest for bundleUrl, using direct mapping:', mErr);
            }
        }

        await downloadAndApplyUpdate(targetVersion, bundleUrl, manifestChecksum);
    } finally {
        isInstallingFromChannel = false;
    }
};

async function installUpdateFromChannel(version, bundleUrl, buttonElem) {
    const targetUrl = bundleUrl || `https://orion-fcm-worker.gaim.workers.dev/download-ota/v${version}/bundle.zip`;
    const checksum = (buttonElem && buttonElem.dataset && buttonElem.dataset.checksum) || (activeOtaManifest && activeOtaManifest.checksum) || null;
    return window.triggerOtaUpdate(version, targetUrl, checksum);
}
window.installUpdateFromChannel = installUpdateFromChannel;

// Delegated click handler for channel install buttons
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.channel-install-btn');
    if (btn) {
        e.stopPropagation();
        const ver = btn.dataset.version || '1.0.2';
        const url = btn.dataset.url || null;
        const checksum = btn.dataset.checksum || null;
        window.triggerOtaUpdate(ver, url, checksum);
    }
});

// Run notifyAppReady immediately on startup
if (window.Capacitor?.isPluginAvailable('CapacitorUpdater')) {
    window.Capacitor.Plugins.CapacitorUpdater.notifyAppReady();
}
initCapacitorUpdater();

// Automatic update check once on startup after 2-second delay
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    if (window.Capacitor?.isPluginAvailable('CapacitorUpdater')) {
        window.Capacitor.Plugins.CapacitorUpdater.notifyAppReady();
    }
    updateSettingsVersionDisplay();
    setTimeout(() => checkForUpdates(false), 2000);
} else {
    window.addEventListener('DOMContentLoaded', () => {
        if (window.Capacitor?.isPluginAvailable('CapacitorUpdater')) {
            window.Capacitor.Plugins.CapacitorUpdater.notifyAppReady();
        }
        updateSettingsVersionDisplay();
        setTimeout(() => checkForUpdates(false), 2000);
    });
}

/* ---------------- FCM CLOUDFLARE WORKER DISPATCHER ---------------- */

const CLOUDFLARE_FCM_WORKER_URL = 'https://orion-fcm-worker.gaim.workers.dev';

async function sendPushNotification(recipientFcmToken, senderName, messageText, extraData = {}) {
    if (!recipientFcmToken) return;
    try {
        console.log(`[FCM Worker] Dispatching push notification to token via ${CLOUDFLARE_FCM_WORKER_URL}...`);
        const response = await fetch(CLOUDFLARE_FCM_WORKER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                recipientFcmToken: recipientFcmToken,
                senderName: senderName || 'New Message',
                messageText: messageText || '',
                chatId: extraData.chatId || currentChatId || '',
                senderId: auth.currentUser?.uid || ''
            })
        });
        const result = await response.json();
        console.log('[FCM Worker] Push notification dispatch result:', result);
        return result;
    } catch (err) {
        console.error('[FCM Worker] Failed to send push notification via Cloudflare Worker:', err);
    }
}

async function setupNotifications(uid) {
    try {
        // Attempt Capacitor Native Push first if running in native app
        const nativeHandled = await setupCapacitorPushNotifications(uid);
        if (nativeHandled) {
            return;
        }

        if (!('serviceWorker' in navigator) || !window.Notification) {
            return;
        }

        // Register and wait for the service worker to be fully ready using the native .ready property
        await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
        const registration = await navigator.serviceWorker.ready;

        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            const token = await getToken(messaging, {
                vapidKey: 'BMD80ob4ytwS499LdIMpIiWb7--2Q-vTTTgYFoCC_pZoqBaVqssc4MCw4k2UKg8FEArjMc2AL-cA-gRib220chE',
                serviceWorkerRegistration: registration
            });
            if (token) {
                await update(ref(db, `users/${uid}`), { fcmToken: token });
                console.log('FCM token registered successfully');
            } else {
                console.warn('FCM getToken returned empty token');
            }
        }
    } catch (err) {
        console.error("FCM Setup failed:", err);
    }
}

/* ---------------- MOBILE SIDEBAR DRAWER NAVIGATION ---------------- */

function openSidebarDrawer() {
    dismissKeyboard();
    document.body.classList.add('sidebar-open');
    const sidebar = document.getElementById('glass-sidebar');
    if (sidebar) sidebar.classList.add('sidebar-open');
}

function closeSidebarDrawer() {
    document.body.classList.remove('sidebar-open');
    const sidebar = document.getElementById('glass-sidebar');
    if (sidebar) sidebar.classList.remove('sidebar-open');
}

function toggleSidebarDrawer() {
    if (document.body.classList.contains('sidebar-open') || document.getElementById('glass-sidebar')?.classList.contains('sidebar-open')) {
        closeSidebarDrawer();
    } else {
        openSidebarDrawer();
    }
}

/* ---------------- DISMISS KEYBOARD HELPER ---------------- */

async function dismissKeyboard() {
    try {
        const input = document.getElementById('message-input');
        if (input && document.activeElement === input) {
            input.blur();
        }
        let Keyboard = window.Capacitor?.Plugins?.Keyboard;
        if (!Keyboard && window.Capacitor) {
            try {
                const module = await import('@capacitor/keyboard');
                Keyboard = module.Keyboard;
            } catch (e) {}
        }
        if (Keyboard && typeof Keyboard.hide === 'function') {
            await Keyboard.hide();
        }
    } catch (e) {
        console.warn('[Keyboard] Hide error:', e);
    }
}

/* ---------------- ANIMATED MODAL MANAGER ---------------- */

function openAnimatedModal(modalEl) {
    if (!modalEl) return;
    dismissKeyboard();
    modalEl.classList.remove('modal-closing');
    modalEl.style.display = 'flex';
    requestAnimationFrame(() => {
        modalEl.classList.add('modal-visible');
    });
}

function closeAnimatedModal(modalEl, onClosed) {
    if (!modalEl) return;
    if (modalEl.id === 'admin-panel-modal' && typeof detachAdminRequestsListener === 'function') {
        detachAdminRequestsListener();
    }
    dismissKeyboard();
    modalEl.classList.remove('modal-visible');
    modalEl.classList.add('modal-closing');
    setTimeout(() => {
        modalEl.style.display = 'none';
        modalEl.classList.remove('modal-closing');
        if (typeof onClosed === 'function') onClosed();
    }, 240);
}

window.openSidebarDrawer = openSidebarDrawer;
window.closeSidebarDrawer = closeSidebarDrawer;
window.toggleSidebarDrawer = toggleSidebarDrawer;
window.dismissKeyboard = dismissKeyboard;
window.openAnimatedModal = openAnimatedModal;
window.closeAnimatedModal = closeAnimatedModal;
window.scrollActiveChatToBottom = scrollActiveChatToBottom;

/* ---------------- MOBILE KEYBOARD AUTO-SCROLL ---------------- */

function scrollActiveChatToBottom(smooth = true) {
    const cont = document.getElementById('messages-container');
    if (!cont) return;
    if (cont.lastElementChild && typeof cont.lastElementChild.scrollIntoView === 'function') {
        cont.lastElementChild.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
    } else {
        cont.scrollTo({ top: cont.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    }
}

// Visual viewport resize handler (fires when soft keyboard opens/closes)
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        const input = document.getElementById('message-input');
        if (document.activeElement === input) {
            scrollActiveChatToBottom(true);
        }
    });
}

// Touch focus listener for message input
const globalMsgInput = document.getElementById('message-input');
if (globalMsgInput) {
    globalMsgInput.addEventListener('focus', () => {
        setTimeout(() => {
            const cont = document.getElementById('messages-container');
            if (cont) {
                cont.scrollTo({ top: cont.scrollHeight, behavior: 'smooth' });
            }
        }, 280);
    });
}

// Capacitor Keyboard plugin listeners
async function setupCapacitorKeyboardListeners() {
    try {
        let Keyboard = window.Capacitor?.Plugins?.Keyboard;
        if (!Keyboard && window.Capacitor) {
            try {
                const module = await import('@capacitor/keyboard');
                Keyboard = module.Keyboard;
            } catch (e) {}
        }
        if (Keyboard && typeof Keyboard.addListener === 'function') {
            await Keyboard.addListener('keyboardWillShow', (info) => {
                console.log('[Keyboard] Will show, height:', info?.keyboardHeight);
                const cont = document.getElementById('messages-container');
                if (cont) {
                    cont.scrollTo({ top: cont.scrollHeight, behavior: 'smooth' });
                }
            });
            await Keyboard.addListener('keyboardDidShow', () => {
                const cont = document.getElementById('messages-container');
                if (cont) {
                    cont.scrollTo({ top: cont.scrollHeight, behavior: 'smooth' });
                }
            });
            console.log('[Keyboard] Native keyboard listeners registered successfully.');
        }
    } catch (err) {
        console.warn('[Keyboard] Setup error:', err);
    }
}

async function handleChatUrlParam() {
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chat');
    if (chatId && auth.currentUser) {
        // Check if the user is a member of this chat before opening
        const memberSnap = await get(ref(db, `members/${chatId}/${auth.currentUser.uid}`));
        if (memberSnap.exists()) {
            const chatSnap = await get(ref(db, `chats/${chatId}`));
            const chatData = chatSnap.val();
            if (chatData) {
                openChat(chatId, chatData.title);
            } else {
                showNotification("Chat not found or you don't have access.", "error");
            }
        }
        // Clear the URL parameter to prevent re-opening on refresh
        const newUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
    }
}

// Listen for messages from the service worker (e.g. notification clicks)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (event) => {
        if (event.data && event.data.type === 'NAVIGATE_TO_CHAT') {
            const chatId = event.data.chatId;
            if (chatId && auth.currentUser && currentChatId !== chatId) {
                // Verify membership
                const memberSnap = await get(ref(db, `members/${chatId}/${auth.currentUser.uid}`));
                if (memberSnap.exists()) {
                    const chatSnap = await get(ref(db, `chats/${chatId}`));
                    const chatData = chatSnap.val();
                    if (chatData) {
                        openChat(chatId, chatData.title);
                    }
                }
            }
        }
    });
}

onMessage(messaging, (payload) => {
    const title = payload.data?.title || "New Message";
    const body = payload.data?.body || "";
    const incomingChatId = payload.data?.chatId;

    notifyIncomingMessage({
        chatId: incomingChatId,
        title,
        body
    });
});

/* ---------------- AUTH STATE ---------------- */

onAuthStateChanged(auth, (user) => {
    if (window.Capacitor?.isPluginAvailable('CapacitorUpdater')) {
        window.Capacitor.Plugins.CapacitorUpdater.notifyAppReady();
    }
    if (user) {
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';

        initApp(user.uid);
        fetchMyProfile(user.uid);
        setupPresence(user.uid);
        setupNotifications(user.uid);
        handleUrlJoin(); // Check for join link on auth
        handleChatUrlParam(); // NEW: Check for chat link from notification click
    } else {
        window.currentUserData = null;
        if (typeof detachAdminRequestsListener === 'function') detachAdminRequestsListener();
        document.getElementById('auth-container').style.display = 'flex';
        document.getElementById('app-container').style.display = 'none';
    }
});

// NEW: Re-initialize on app resume to handle token expiry after long idle periods
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'visible' && auth.currentUser) {
        console.log('App resumed: Re-verifying FCM token and syncing state...');
        setupNotifications(auth.currentUser.uid);
        
        // Re-sync current chat if one is open to catch any missed messages while suspended
        if (currentChatId) {
            const titleElem = document.getElementById('chat-title-text');
            const title = titleElem ? titleElem.innerText : 'Chat';
            openChat(currentChatId, title);
        }
    }
});

/* ---------------- REGISTER ---------------- */

document.getElementById('register-btn').onclick = async () => {
    const email = document.getElementById('email').value.trim();
    const pass = document.getElementById('password').value.trim();

    if (!email || !pass) {
        showNotification("Please enter email and password", "info");
        return;
    }

    try {
        const res = await createUserWithEmailAndPassword(auth, email, pass);

        await set(ref(db, `users/${res.user.uid}`), {
            uid: res.user.uid,
            email: email.toLowerCase(),
            displayName: email.split('@')[0],
            description: "",
            friendId: generateFriendId()
        });

    } catch (err) {
        console.error(err);
        showNotification(err.message, "error");
    }
};

// Global listener to focus message input when user starts typing
window.addEventListener('keydown', (e) => {
    // Only proceed if a chat is open and we aren't already in an input field
    if (!currentChatId) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    // Ignore modifier keys and functional keys (like F1-F12, Arrow keys, etc.)
    if (e.ctrlKey || e.altKey || e.metaKey || e.key.length > 1) return;

    // Don't steal focus if a modal is currently open
    const isModalOpen = Array.from(document.querySelectorAll('.modal')).some(m => m.style.display === 'flex');
    if (isModalOpen) return;

    const input = document.getElementById('message-input');
    if (input) input.focus();
});

/* ---------------- SIDEBAR COLLAPSE ---------------- */
const friendsHeader = document.getElementById('friends-header');
const friendsList = document.getElementById('friends-list');
const chatsHeader = document.getElementById('chats-header');
const chatsList = document.getElementById('chats-list');
const chatsCollapsibleContainer = document.getElementById('conversations-collapsible-container');

if (friendsHeader && friendsList) {
    friendsHeader.onclick = () => {
        friendsHeader.classList.toggle('collapsed');
        friendsList.classList.toggle('collapsed-content');
        // Save state to local storage
        localStorage.setItem('friendsListCollapsed', friendsHeader.classList.contains('collapsed'));
    };
}

if (chatsHeader && chatsList) {
    chatsHeader.onclick = () => {
        const isCollapsed = chatsHeader.classList.toggle('collapsed');
        chatsList.classList.toggle('collapsed-content', isCollapsed);
        if (chatsCollapsibleContainer) {
            chatsCollapsibleContainer.classList.toggle('collapsed-content', isCollapsed);
        }
        // Save state to local storage
        localStorage.setItem('chatsListCollapsed', isCollapsed);
    };
}

/* ---------------- LOGIN ---------------- */

document.getElementById('login-btn').onclick = async () => {
    const email = document.getElementById('email').value.trim();
    const pass = document.getElementById('password').value.trim();

    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
        console.error(err);
        showNotification(err.message, "error");
    }
};

/* ---------------- LOGOUT ---------------- */

document.getElementById('logout-btn').onclick = async () => {
    try {
        closeAnimatedModal(document.getElementById('profile-modal'));
        const uid = auth.currentUser?.uid;
        if (uid) {
            await update(ref(db, `users/${uid}`), { 
                status: 'offline',
                fcmToken: null 
            });
        }
        await signOut(auth);
        window.location.reload();
    } catch (err) {
        console.error(err);
    }
};

/* ---------------- MOBILE FIXES ---------------- */

function syncVisualViewport() {
    if (!window.visualViewport) return;

    document.documentElement.style.setProperty(
        '--vvh',
        `${window.visualViewport.height}px`
    );
}

window.addEventListener('resize', syncVisualViewport);
window.visualViewport?.addEventListener?.('resize', syncVisualViewport);

syncVisualViewport();

/* ---------------- PROFILE ---------------- */

function fetchMyProfile(uid) {
    onValue(ref(db, `users/${uid}`), (snap) => {
        const data = snap.val();
        if (!data) {
            console.warn(`No profile found for UID: ${uid}`);
            return;
        }
        window.currentUserData = { ...data, username: getDisplayName(data) };

        // Ensure email is in the database record if it's missing (helps others see the correct nickname)
        if (!data.email && auth.currentUser.email) {
            update(ref(db, `users/${uid}`), { email: auth.currentUser.email.toLowerCase() });
            return; // onValue will trigger again after update
        }

        console.log("Profile Data Sync:", { uid, isAdmin: data.isAdmin, type: data.type });

        // Auto-generate ID for existing users who don't have one yet
        if (!data.friendId) {
            const newId = generateFriendId();
            update(ref(db, `users/${uid}`), { friendId: newId });
            return; // onValue will trigger again after update
        }

        document.getElementById('my-code-display').innerText = data.friendId;

        const name = data.displayName || auth.currentUser.email.split('@')[0];
        document.getElementById('current-user-name').innerText = name;

        // Keep the searchable email in sync after an email change
        if (auth.currentUser.email && data.email && data.email !== auth.currentUser.email) {
            update(ref(db, `users/${auth.currentUser.uid}`), { email: auth.currentUser.email }).catch(() => {});
        }

        // Update Profile Pictures in UI
        const avatarLg = document.querySelector('.avatar-lg');
        const avatarSm = document.querySelector('.avatar-sm');
        if (data.profilePic) {
            const imgHtml = `<img src="${data.profilePic}">`;
            avatarLg.innerHTML = imgHtml;
            avatarSm.innerHTML = imgHtml;
        } else {
            avatarLg.innerText = '\u{1F464}';
            avatarSm.innerText = '\u{1F464}';
        }

        // Update self-status in sidebar
        const myDot = document.getElementById('my-status-dot');
        const myStatusText = document.getElementById('my-status-text');
        if (myDot && myStatusText) {
            const isOnline = data.status === 'online';
            myDot.classList.toggle('online', isOnline);
            myStatusText.innerText = isOnline ? 'Online' : 'Offline';
        }

        // Update display name elements (Settings exclusive for editing)
        const profileDisplayNameText = document.getElementById('profile-display-name-text');
        if (profileDisplayNameText) profileDisplayNameText.innerText = name;
        const profileDisplayNameInput = document.getElementById('profile-display-name');
        if (profileDisplayNameInput) profileDisplayNameInput.value = name;
        const settingsDisplayName = document.getElementById('settings-display-name');
        if (settingsDisplayName) settingsDisplayName.value = name;

        // Update bio elements (Settings exclusive for editing)
        const profileDescText = document.getElementById('profile-description-text');
        if (profileDescText) profileDescText.innerText = data.description || "No bio yet.";
        const settingsBio = document.getElementById('settings-profile-description');
        if (settingsBio) settingsBio.value = data.description || "";

        document.getElementById('my-qr-code').src =
            `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${data.friendId}`;
        
        const isAdmin = data.role === 'admin' || data.isAdmin === true || String(data.isAdmin).toLowerCase() === "true";
        const isPremium = isAdmin || data.type === "Premium";
        const displayType = isAdmin ? "Admin" : (data.type || "Basic");
        
        // Update global premium status for the emoji picker and upload permissions
        isCurrentUserPremium = isPremium;
        applyUiPrefs();
        updateInputButtons();

        // Manage Promo Banner Visibility
        const pBanner = document.getElementById('premium-promo-banner');
        if (pBanner) {
            if (isPremium) {
                pBanner.style.display = 'none'; // Permanently hide for Premium & Admin
            } else {
                // Show for Basic users if the 5-minute cooldown has expired
                const closedAt = localStorage.getItem('premiumBannerClosedAt');
                if (!closedAt || (Date.now() - parseInt(closedAt)) >= 300000) {
                    pBanner.style.display = 'flex';
                } else {
                    pBanner.style.display = 'none';
                }
            }
        }

        document.getElementById('my-user-type').innerText = displayType;
        document.getElementById('my-type-info').title = "Basic - free\nPremium - 1€";

        document.getElementById('open-admin-panel-btn').style.display = isAdmin ? 'block' : 'none';
        
        const openPremiumBtn = document.getElementById('open-premium-panel-btn');
        if (openPremiumBtn) {
            openPremiumBtn.style.display = 'block';
            if (isPremium) {
                openPremiumBtn.innerText = "Settings";
                openPremiumBtn.style.borderColor = "#ffd700";
            } else {
                openPremiumBtn.innerText = "Settings";
                openPremiumBtn.style.borderColor = "var(--accent)";
            }
        }

        // Monetization gating: only apply premium visual personalizations if user has active premium status
        if (data.theme) {
            applyTheme(isPremium ? data.theme : 'default');
        }
        applyCustomBadge(isPremium ? data.customBadge : null);
    });
}

// Function to apply saved sidebar collapse states
function applySavedSidebarStates() {
    const friendsListCollapsed = localStorage.getItem('friendsListCollapsed') === 'true';
    const chatsListCollapsed = localStorage.getItem('chatsListCollapsed') === 'true';
    const chatsCollapsibleContainer = document.getElementById('conversations-collapsible-container');

    if (friendsListCollapsed) {
        friendsHeader?.classList.add('collapsed');
        friendsList?.classList.add('collapsed-content');
    }
    if (chatsListCollapsed) {
        chatsHeader?.classList.add('collapsed');
        chatsList?.classList.add('collapsed-content');
        if (chatsCollapsibleContainer) {
            chatsCollapsibleContainer.classList.add('collapsed-content');
        }
    }
}

// Direct shortcut links from Profile view to Settings > Account
const profileToSettingsBtn = document.getElementById('profile-to-settings-btn');
if (profileToSettingsBtn) {
    profileToSettingsBtn.onclick = () => {
        closeAnimatedModal(document.getElementById('profile-modal'));
        openPremiumPanelModal('account', true);
    };
}

const bioToSettingsBtn = document.getElementById('bio-to-settings-btn');
if (bioToSettingsBtn) {
    bioToSettingsBtn.onclick = () => {
        closeAnimatedModal(document.getElementById('profile-modal'));
        openPremiumPanelModal('account', true);
    };
}

/* ---------------- SHOW USER PROFILE ---------------- */

async function showUserProfile(targetUid, chatId = null, groupCreatorId = null) {
    closeSidebarDrawer();

    const myUid = auth.currentUser.uid;

    const snap = await get(ref(db, `users/${targetUid}`));

    const userData = snap.val();

    if (!userData) return;

    const viewUserAvatarLg = document.getElementById('view-user-avatar-lg');
    if (userData.profilePic) {
        viewUserAvatarLg.innerHTML = `<img src="${userData.profilePic}">`;
    } else {
        viewUserAvatarLg.innerText = '\u{1F464}';
    }

    const viewedIsAdmin = userData.isAdmin === true || String(userData.isAdmin).toLowerCase() === "true";
    const viewedRawType = userData.type || "Basic";
    const viewedDisplayType = viewedIsAdmin ? "Admin" : viewedRawType;
    const isTargetPremium = viewedIsAdmin || viewedRawType === "Premium";
    const viewTypeElem = document.getElementById('view-user-type');
    viewTypeElem.innerText = viewedDisplayType;

    const nameElem = document.getElementById('view-user-name');
    const username = getDisplayName(userData);
    const chatInfo = chatId ? (allChatsStore.get(chatId) || (chatId === currentChatId ? currentChatData : null)) : null;
    const isGroupChat = !!(chatInfo ? (chatInfo.isGroup || chatInfo.isChannel) : (currentChatData?.isGroup || currentChatData?.isChannel));

    let role = '';
    if (chatId && isGroupChat) {
        if (targetUid === groupCreatorId) {
            role = 'Creator';
        } else {
            const targetMemberRole = currentChatMemberData?.[targetUid]?.role || 'member';
            const groupRole = getGroupRoleInfo(targetMemberRole);
            if (groupRole && groupRole.label && groupRole.label !== 'Member') {
                role = groupRole.label;
            } else if (targetMemberRole && targetMemberRole !== 'member') {
                role = targetMemberRole;
            }
        }
    }

    nameElem.className = 'uv-name';
    nameElem.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; gap:6px; margin-bottom:15px;">
            <h2 style="margin:0; font-size:20px;" class="${isTargetPremium && userData.nameplate ? `nameplate-applied ${userData.nameplate}` : ''}">${escapeHTML(username)}</h2>
            ${role ? `<span style="background:rgba(255,215,0,0.15); color:#ffd700; padding:4px 10px; border-radius:12px; font-size:12px; font-weight:600; letter-spacing:0.5px;">${role.toUpperCase()}</span>` : ''}
        </div>
    `;
    twemoji.parse(nameElem);

    const actions = document.getElementById('user-view-actions');
    actions.innerHTML = '';

    if (targetUid !== myUid) {
        const myData = currentChatMemberData?.[myUid];
        const amICreator = myUid === groupCreatorId;
        const amIAdmin = myData?.role === 'admin';
        const amIMod = myData?.role === 'mod';
        const targetIsCreator = targetUid === groupCreatorId;
        const targetMemberData = currentChatMemberData?.[targetUid];

        // ── Improved Helper: create a row button with the uv- system ──
        const makeActionRow = (label, icon, isDanger, onClick) => {
            const btn = document.createElement('button');
            btn.className = `uv-action-row ${isDanger ? 'danger' : ''}`;
            btn.innerHTML = `<span class="uv-row-icon">${icon}</span><span class="uv-row-label">${label}</span><span class="uv-row-chevron">\u{203A}</span>`;
            btn.onclick = onClick;
            return btn;
        };

        // ── Helper: create a labelled section ──
        const makeSection = (labelText, isDanger = false) => {
            const wrap = document.createElement('div');
            wrap.className = 'uv-section';
            if (labelText) {
                const lbl = document.createElement('span');
                lbl.className = `uv-section-label${isDanger ? ' danger' : ''}`;
                lbl.textContent = labelText;
                wrap.appendChild(lbl);
            }
            actions.appendChild(wrap);
            return wrap;
        };

        // ── 1. MAIN CTA: Send Message ──
        const messageBtn = document.createElement('button');
        messageBtn.className = 'uv-cta';
        messageBtn.innerHTML = '<span>\u{1F4AC}</span> Send Message';
        messageBtn.onclick = () => {
            startChat(myUid, targetUid, getDisplayName(userData));
            closeAnimatedModal(document.getElementById('user-view-modal'));
        };
        actions.appendChild(messageBtn);

        // ── 2. SOCIAL SECTION ──
        const friendSnap = await get(ref(db, `friends/${myUid}/${targetUid}`));
        if (!friendSnap.exists()) {
            const socialSection = makeSection('Relationship');
            socialSection.appendChild(makeActionRow('Add Friend', '\u{1F91D}', false, () => {
                addFriend(myUid, targetUid);
                closeAnimatedModal(document.getElementById('user-view-modal'));
            }));
        }

        // ── 3. GROUP MODERATION & ROLES SECTION ──
        if (chatId && isGroupChat && (amICreator || amIAdmin || amIMod) && !targetIsCreator) {
            const modSection = makeSection('Group Roles & Moderation');
            
            // Discord-Style Role Assignment (Creator or Admin)
            if (amICreator || amIAdmin) {
                const targetRole = targetMemberData?.role || 'member';
                const targetRoleInfo = getGroupRoleInfo(targetRole);
                modSection.appendChild(makeActionRow(
                    `Role: ${targetRoleInfo.label}`,
                    '\u{1F3F7}\u{FE0F}',
                    false,
                    () => {
                        closeAnimatedModal(document.getElementById('user-view-modal'));
                        openGroupRoleModal(targetUid, chatId, targetRole, getDisplayName(userData));
                    }
                ));
            }

            // Group Mute / Unmute (Global admins immune)
            const isTargetGlobalAdmin = userData.role === 'admin' || viewedIsAdmin;
            if (!isTargetGlobalAdmin) {
                const groupId = currentChatData?.groupId || chatId;
                let isMutedInGroup = false;
                try {
                    const gSnap = await get(ref(db, `groups/${groupId}/mutedUsers/${targetUid}`));
                    if (gSnap.exists()) {
                        const mVal = gSnap.val();
                        isMutedInGroup = mVal === true || (mVal && typeof mVal === 'object' && mVal.mutedUntil > Date.now());
                    }
                } catch (e) {}

                const targetUsername = getDisplayName(userData);
                modSection.appendChild(makeActionRow(
                    isMutedInGroup ? 'Unmute' : 'Mute User',
                    isMutedInGroup ? '\u{1F50A}' : '\u{1F507}',
                    false,
                    async () => {
                        closeAnimatedModal(document.getElementById('user-view-modal'));
                        if (isMutedInGroup) {
                            await window.unmuteUser(groupId, targetUid);
                        } else {
                            window.openMuteModal(groupId, targetUid, targetUsername);
                        }
                    }
                ));
            }
        }

        // ── 4. DANGER ZONE ──
        const hasDanger = friendSnap.exists() || (chatId && amICreator && !targetIsCreator);
        if (hasDanger) {
            const dangerSection = makeSection('Danger Zone', true);
            
        // Remove Friend
        if (friendSnap.exists()) {
            dangerSection.appendChild(makeActionRow('Remove Friend', '\u{1F494}', true, async () => {
                closeAnimatedModal(document.getElementById('user-view-modal'));
                await removeFriend(myUid, targetUid);
            }));
        }

        // Remove from Group
        if (chatId && amICreator && !targetIsCreator) {
            dangerSection.appendChild(makeActionRow('Kick from Group', '\u{1F6AB}', true, async () => {
                closeAnimatedModal(document.getElementById('user-view-modal'));
                const confirmed = await showConfirm("Remove Member", `Are you sure you want to remove ${userData.displayName || "User"} from this group?`);
                if (confirmed) {
                    await removeMemberFromGroup(chatId, targetUid);
                }
            }));
        }
        }
    }

    openAnimatedModal(document.getElementById('user-view-modal'));
}

/* ---------------- DISCORD-STYLE GROUP ROLE MODAL ---------------- */

function openGroupRoleModal(targetUid, chatId, currentRole = 'member', targetName = 'Member') {
    const modal = document.getElementById('group-role-modal');
    const nameLabel = document.getElementById('group-role-target-name');
    const list = document.getElementById('group-role-options-list');
    if (!modal || !list) return;

    if (nameLabel) nameLabel.innerText = targetName;
    list.innerHTML = '';

    const myUid = auth.currentUser ? auth.currentUser.uid : null;
    const amICreator = myUid && myUid === currentChatCreatorId;

    GROUP_ROLES.forEach(role => {
        // Only group creator can grant or assign the 'admin' role
        if (role.id === 'admin' && !amICreator) return;

        const card = document.createElement('div');
        const isActive = (currentRole || 'member') === role.id;
        card.className = `group-role-option-card ${isActive ? 'active' : ''}`;
        card.style.display = 'flex';
        card.style.alignItems = 'center';
        card.style.justifyContent = 'space-between';
        card.style.padding = '10px 14px';
        card.style.borderRadius = '10px';
        card.style.border = isActive ? '1px solid var(--accent)' : '1px solid var(--glass-border)';
        card.style.background = isActive ? 'rgba(0, 210, 255, 0.12)' : 'rgba(255, 255, 255, 0.04)';
        card.style.cursor = 'pointer';
        card.style.transition = 'all 0.2s ease';

        const badgeHtml = role.badge 
            ? `<span class="custom-user-badge" style="border-color: ${role.color}55; color: ${role.color}; font-size: 12px; padding: 2px 8px;">${role.badge}</span>` 
            : `<span style="opacity: 0.5; font-size: 12px;">(No badge)</span>`;

        card.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 2px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <strong style="color: ${role.color || 'var(--text)'}; font-size: 14px;">${role.label}</strong>
                    ${badgeHtml}
                </div>
                <small style="opacity: 0.7; font-size: 11px;">${role.desc}</small>
            </div>
            <span style="font-size: 16px; color: var(--accent);">${isActive ? '\u{2713}' : ''}</span>
        `;

        card.onclick = async () => {
            try {
                await update(ref(db, `members/${chatId}/${targetUid}`), { role: role.id });
                const gid = currentChatData?.groupId || chatId;
                if (gid) {
                    update(ref(db, `groups/${gid}/roles`), { [targetUid]: role.id }).catch(() => {});
                }
                updateMessageBadgesForUser(targetUid, role.id);
                showNotification(`Role updated to ${role.label} for ${targetName}`, 'success');
                closeAnimatedModal(modal);
            } catch (err) {
                console.error("Failed to update role:", err);
                showNotification("Failed to update role: " + err.message, "error");
            }
        };

        list.appendChild(card);
    });

    twemoji.parse(list);
    modal.style.display = 'flex';
}

const closeRoleModalBtn = document.getElementById('close-group-role-modal-btn');
if (closeRoleModalBtn) {
    closeRoleModalBtn.onclick = () => {
        const modal = document.getElementById('group-role-modal');
        if (modal) closeAnimatedModal(modal);
    };
}

// Handle Profile Picture Selection
document.querySelector('.avatar-lg').onclick = () => document.getElementById('profile-pic-input').click();
document.getElementById('profile-pic-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        let base64 = event.target.result;
        // Downscale for profile picture efficiency (using existing helper)
        base64 = await downscaleImageDimensions(base64, 200, 200);
        try {
            await update(ref(db, `users/${auth.currentUser.uid}`), { profilePic: base64 });
            showNotification("Profile picture updated!", "success");
        } catch (err) {
            showNotification("Failed to update profile picture.", "error");
        }
    };
    reader.readAsDataURL(file);
};

/* ---------------- INIT APP ---------------- */

function initApp(myUid) {

    // Ensure Orion Updates broadcast channel exists and user is subscribed
    ensureOrionUpdatesChannel(myUid);
    initMessageContextMenu();

    // Ensure mobile view starts on conversations/sidebar list
    document.body.classList.remove('chat-open');
    document.body.classList.remove('members-open');
    if (window.innerWidth <= 768 && !currentChatId) {
        openSidebarDrawer();
    }
    setupCapacitorKeyboardListeners();
    initCapacitorUpdater();

    // Clear previous listeners
    activeChatDataListeners.forEach(offFunc => offFunc());
    activeChatDataListeners.clear();
    activeUnreadListeners.forEach(offFunc => offFunc());
    activeUnreadListeners.clear();
    activeMentionListeners.forEach(offFunc => offFunc());
    activeMentionListeners.clear();
    activeFriendsListListeners.forEach(offFunc => offFunc());
    activeFriendsListListeners.clear();
    allChatsStore.clear();
    globalUnreadMap = {};

    applySavedSidebarStates();
    loadNotificationSettings();

    onValue(ref(db, `friend_requests/${myUid}`), (snapshot) => {
        const list = document.getElementById('modal-requests-list');
        const badge = document.getElementById('friend-requests-badge');
        list.innerHTML = '';
        const requests = snapshot.val(); // Re-fetch after potential updates
        if (!requests) {
            badge.style.display = 'none';
            closeAnimatedModal(document.getElementById('friend-requests-modal'));
            return;
        }
        const count = Object.keys(requests).length;
        badge.innerText = count;
        badge.style.display = (count > 0 && notificationPrefs.unreadBadges) ? 'inline-block' : 'none';

        Object.entries(requests).forEach(([senderUid, data]) => {
            const div = document.createElement('div');
            div.className = 'friend-request-item';
            div.innerHTML = `
                <div class="request-info">
                    <strong>${escapeHTML(data.fromName)}</strong>
                    <small>Sent a friend request</small>
                </div>
                <div class="request-actions">
                    <button class="accept-btn" title="Accept">\u{2713}</button>
                    <button class="decline-btn" title="Decline">\u{2715}</button>
                </div>
            `;
            div.querySelector('.accept-btn').onclick = () => acceptFriendRequest(myUid, senderUid);
            div.querySelector('.decline-btn').onclick = () => declineFriendRequest(myUid, senderUid);
            list.appendChild(div);
            twemoji.parse(div);
        });
    });

    onValue(ref(db, `user_chats/${myUid}`), (snapshot) => {
        const currentChatIds = new Set();

        snapshot.forEach(child => {
            const chatId = child.key;
            currentChatIds.add(chatId);

            // Setup listener for chat metadata if it doesn't exist
            if (!activeChatDataListeners.has(chatId)) {
                const chatRef = ref(db, `chats/${chatId}`);
                const chatOff = onValue(chatRef, (csnap) => {
                    const data = csnap.val();
                    if (data) {
                        const existing = allChatsStore.get(chatId) || {};
                        allChatsStore.set(chatId, { ...existing, id: chatId, ...data });
                        renderChatLink(chatId, data, myUid).catch(console.error);
                        updateCategoryBadges(Array.from(allChatsStore.values()));
                    }
                });
                activeChatDataListeners.set(chatId, chatOff);
            }
        });

        // Ensure Orion Updates system broadcast channel is always included
        currentChatIds.add('channel_orion_updates');
        if (!activeChatDataListeners.has('channel_orion_updates')) {
            const chatRef = ref(db, 'chats/channel_orion_updates');
            const chatOff = onValue(chatRef, (csnap) => {
                const data = csnap.val();
                if (data) {
                    const existing = allChatsStore.get('channel_orion_updates') || {};
                    allChatsStore.set('channel_orion_updates', { ...existing, id: 'channel_orion_updates', ...data });
                    renderChatLink('channel_orion_updates', data, myUid).catch(console.error);
                    updateCategoryBadges(Array.from(allChatsStore.values()));
                }
            });
            activeChatDataListeners.set('channel_orion_updates', chatOff);
        }

        // Clean up listeners and elements for chats that no longer exist
        Array.from(activeChatDataListeners.keys()).forEach(chatId => {
            if (!currentChatIds.has(chatId)) {
                // Remove chat data listener
                activeChatDataListeners.get(chatId)();
                activeChatDataListeners.delete(chatId);

                // Also remove the associated unread listener
                if (activeUnreadListeners.has(chatId)) {
                    activeUnreadListeners.get(chatId)();
                    activeUnreadListeners.delete(chatId);
                }

                if (activeMentionListeners.has(chatId)) {
                    activeMentionListeners.get(chatId)();
                    activeMentionListeners.delete(chatId);
                }

                allChatsStore.delete(chatId);

                // Remove element from DOM
                const divToRemove = document.getElementById(`link-${chatId}`);
                if (divToRemove) {
                    divToRemove.remove();
                }
            }
        });

        // Trigger badge updates globally when chat list updates
        updateCategoryBadges(Array.from(allChatsStore.values()));
    });

    // Global listener for all unread messages for the user
    onValue(ref(db, `unread/${myUid}`), (uSnap) => {
        globalUnreadMap = uSnap.val() || {};
        allChatsStore.forEach((chat, cId) => {
            chat.isUnread = !!globalUnreadMap[cId];
        });
        updateCategoryBadges(Array.from(allChatsStore.values()));
    });

    onValue(ref(db, `friends/${myUid}`), (snapshot) => {

        const list = document.getElementById('friends-list');

        list.innerHTML = '';

        // Clear existing friend status listeners to avoid leaks
        activeFriendsListListeners.forEach(offFunc => offFunc());
        activeFriendsListListeners.clear();

        const data = snapshot.val();

        if (!data) return;

        for (const friendUid of Object.keys(data)) {

            const div = document.createElement('div');

            div.className = 'chat-link';
            div.id = `friend-item-${friendUid}`;
            div.onclick = () => showUserProfile(friendUid);

            list.appendChild(div);

            const friendRef = ref(db, `users/${friendUid}`);
            const friendOff = onValue(friendRef, (uSnap) => {
                const user = uSnap.val();
                const friendItemDiv = document.getElementById(`friend-item-${friendUid}`);
                if (!friendItemDiv) return;

                if (!user) {
                    friendItemDiv.style.display = 'none';
                    return;
                }
                friendItemDiv.style.display = 'flex';

                const displayName = getDisplayName(user);
                const status = user.status || 'offline';
                const avatarHtml = user.profilePic 
                    ? `<img src="${user.profilePic}" class="avatar-sm-img">` 
                    : `<div class="avatar-sm">\u{1F464}</div>`;

                friendItemDiv.innerHTML = `
                    <div class="profile-brief">
                        <div class="friend-avatar-container">
                            ${avatarHtml}
                            <span class="status-dot ${status === 'online' ? 'online' : ''}"></span>
                        </div>
                        <span>${escapeHTML(displayName)}</span>
                    </div>
                `;
                twemoji.parse(friendItemDiv);
            });
            activeFriendsListListeners.set(friendUid, friendOff);
        }
    });
}


/* ---------------- FRIENDS ---------------- */

async function addFriend(myUid, friendUid) {
    if (myUid === friendUid) {
        showNotification("You can't add yourself!", "info");
        return;
    }
    try {
        // Check if already friends
        const friendSnap = await get(ref(db, `friends/${myUid}/${friendUid}`));
        if (friendSnap.exists()) {
            showNotification("You are already friends!", "info");
            return;
        }
        // If target already sent you a request, just accept it
        const incomingSnap = await get(ref(db, `friend_requests/${myUid}/${friendUid}`));
        if (incomingSnap.exists()) {
            await acceptFriendRequest(myUid, friendUid);
            showNotification("Friend request accepted!", "success");
            return;
        }
        // Check if request already sent
        const outgoingSnap = await get(ref(db, `friend_requests/${friendUid}/${myUid}`));
        if (outgoingSnap.exists()) {
            showNotification("Friend request already sent!", "info");
            return;
        }

        const mySnap = await get(ref(db, `users/${myUid}`));
        const myName = mySnap.val()?.displayName || "User";
        
        await set(ref(db, `friend_requests/${friendUid}/${myUid}`), {
            fromName: myName,
            timestamp: serverTimestamp()
        });
        showNotification("Friend request sent!", "success");
    } catch (err) {
        console.error(err);
        showNotification(err.message, "error");
    }
}

async function acceptFriendRequest(myUid, senderUid) {
    try {
        const updates = {};
        updates[`/friends/${myUid}/${senderUid}`] = true;
        updates[`/friends/${senderUid}/${myUid}`] = true;
        updates[`/friend_requests/${myUid}/${senderUid}`] = null;
        await update(ref(db), updates);
    } catch (err) {
        console.error("Accept error:", err);
    }
}

async function removeFriend(myUid, friendUid) {
    const confirmed = await showConfirm("Remove Friend", "Are you sure you want to remove this friend?");
    if (!confirmed) return;
    try {
        const updates = {};
        updates[`/friends/${myUid}/${friendUid}`] = null;
        updates[`/friends/${friendUid}/${myUid}`] = null;
        await update(ref(db), updates);
    } catch (err) {
        console.error("Remove friend error:", err);
        showNotification("Failed to remove friend", "error");
    }
}

async function declineFriendRequest(myUid, senderUid) {
    try {
        await remove(ref(db, `friend_requests/${myUid}/${senderUid}`));
    } catch (err) {
        console.error("Decline error:", err);
    }
}

/* ---------------- FRIEND CODES ---------------- */
// The old generation and timer functions have been removed as IDs are now permanent.

document.getElementById('submit-code-btn').onclick = async () => {
    const code = document.getElementById('friend-code-input').value.trim().toUpperCase();
    
    if (!code) {
        showNotification("Please enter a User ID", "info");
        return;
    }

    try {
        // Query users by their friendId
        const q = query(ref(db, 'users'), orderByChild('friendId'), equalTo(code));
        const snap = await get(q);
        
        if (!snap.exists()) {
            showNotification("User ID not found", "error");
            return;
        }

        // snap.val() returns an object with UID as key
        const usersObj = snap.val();
        const targetUid = Object.keys(usersObj)[0];

        if (targetUid === auth.currentUser.uid) {
            showNotification("You can't add yourself!", "info");
            return;
        }

        addFriend(auth.currentUser.uid, targetUid);
        document.getElementById('friend-code-input').value = '';
        closeAnimatedModal(document.getElementById('add-friend-modal'));

    } catch (err) {
        console.error(err);
        showNotification(err.message, "error");
    }
};

/* ---------------- CHAT ---------------- */

// renderChatLink is now responsible for rendering and setting up its own unread listener
async function renderChatLink(chatId, data, myUid) {
    const list = document.getElementById('chats-list');

    let div = document.getElementById(`link-${chatId}`);
    const gid = data.groupId || 'standalone';
    let groupContainer = document.getElementById(`group-container-${gid}`);

    if (!div) {
        div = document.createElement('div');
        div.id = `link-${chatId}`;
    }

    // Store timestamp for sorting
    div.dataset.timestamp = data.timestamp || 0;

    // Determine displayTitle
    let displayTitle = data.title || data.name || (chatId === 'channel_orion_updates' ? 'Orion Updates' : 'Chat');
    let chatPic = data.profilePic;
    const isSubChannel = !!data.groupId;

    const isDmChat = !(data.isGroup || data.isChannel || data.type === 'channel' || data.groupId || chatId === 'channel_orion_updates');
    if (isDmChat) {
        const parts = chatId.split('_');
        const partnerId = parts.length === 2 ? parts.find(id => id !== myUid) : null;
        if (partnerId) {
            const partnerSnap = await get(ref(db, `users/${partnerId}`));
            const pData = partnerSnap.val();
            displayTitle = getDisplayName(pData);
            chatPic = pData?.profilePic;
        }
    }

    // Function to update the UI of a single chat link
    const updateChatLinkUI = (isUnread, mentionCount) => {
        const isChannel = data.isChannel === true || data.type === 'channel' || data.isSystem === true || chatId === 'channel_orion_updates';
        const isDm = !isChannel && !data.isGroup && !data.groupId;

        div.className = 'chat-link' + (chatId === currentChatId ? ' active' : '') + (isSubChannel ? ' sub-channel' : '') + (isDm ? ' dm-link' : (isChannel ? ' channel-link' : ' group-link'));

        let indicator = '';
        if (chatId !== currentChatId && notificationPrefs.unreadBadges) {
            if (mentionCount > 0) {
                indicator = `<div class="mention-badge">${mentionCount}</div>`;
            } else if (isUnread) {
                indicator = `<div class="unread-dot"></div>`;
            }
        }

        const icon = isChannel ? '\u{1F4E2}' : (data.groupId ? '#' : (!data.isGroup && !data.groupId ? '\u{1F464}' : ''));
        let iconHtml = icon ? `<span class="chat-type-icon">${icon}</span>` : '';

        // Only show chatPic on the link if it's a DM or a standalone group/channel
        if (chatPic && !isSubChannel) {
            iconHtml = `<div class="avatar-sm chat-type-icon" style="opacity: 1; width: 32px; height: 32px; margin-right: 12px;"><img src="${chatPic}" style="width: 100%; height: 100%; object-fit: cover;"></div>`;
        }

        const timePreview = data.timestamp ? formatSmartTimestamp(data.timestamp) : '';

        div.innerHTML = `
            ${iconHtml}
            <div class="chat-info">
                <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 4px;">
                    <strong>${escapeHTML(displayTitle)}</strong>
                    ${timePreview ? `<span class="chat-item-time">${timePreview}</span>` : ''}
                </div>
                <small style="opacity:0.5">${escapeHTML(data.last_message || '')}</small>
            </div>
            ${indicator}
        `;
        twemoji.parse(div);
    };

    // Initial render
    updateChatLinkUI(false, 0);

    // Set up real-time listeners for the unread status and mentions of this specific chat
    let localIsUnread = false;
    let localMentionCount = 0;

    // Clean up old listener if it exists
    const existingUnreadOff = activeUnreadListeners.get(chatId);
    if (existingUnreadOff) existingUnreadOff();

    const existingMentionOff = activeMentionListeners.get(chatId);
    if (existingMentionOff) existingMentionOff();

    const unreadRef = ref(db, `unread/${myUid}/${chatId}`);
    const mentionsRef = ref(db, `mentions/${myUid}/${chatId}`);

    let isFirstUnreadEmit = true;
    const unreadOff = onValue(unreadRef, (unreadSnap) => {
        const prevIsUnread = localIsUnread;
        localIsUnread = unreadSnap.exists();
        const isInitial = isFirstUnreadEmit;
        isFirstUnreadEmit = false;

        if (localIsUnread && chatId === currentChatId) {
            remove(unreadRef);
        } else {
            updateChatLinkUI(localIsUnread, localMentionCount);
            if (!isInitial && !prevIsUnread && localIsUnread) {
                notifyIncomingMessage({
                    chatId,
                    title: displayTitle,
                    fallbackText: `New message in ${escapeHTML(displayTitle)}`
                });
            }
        }

        const existing = allChatsStore.get(chatId) || { id: chatId, ...data };
        existing.isUnread = localIsUnread;
        allChatsStore.set(chatId, existing);
        updateCategoryBadges(Array.from(allChatsStore.values()));
    });
    activeUnreadListeners.set(chatId, unreadOff); // Store the off function

    const mentionOff = onValue(mentionsRef, (mSnap) => {
        localMentionCount = mSnap.val() || 0;
        if (localMentionCount > 0 && chatId === currentChatId) {
            remove(mentionsRef);
        } else {
            updateChatLinkUI(localIsUnread, localMentionCount);
        }

        const existing = allChatsStore.get(chatId) || { id: chatId, ...data };
        existing.mentionCount = localMentionCount;
        allChatsStore.set(chatId, existing);
        updateCategoryBadges(Array.from(allChatsStore.values()));
    });
    activeMentionListeners.set(chatId, mentionOff);

    div.onclick = () => openChat(chatId, displayTitle);

    // --- Unified Grouping Logic ---
    if (data.groupId) {
        if (!groupContainer) {
            groupContainer = document.createElement('div');
            groupContainer.id = `group-container-${gid}`;
            
            // Load collapsed state from storage
            const isCollapsed = localStorage.getItem(`group_fold_${gid}`) === 'true';
            groupContainer.className = 'sidebar-group-wrap' + (isCollapsed ? ' collapsed' : '');

            groupContainer.innerHTML = `
                <div class="group-header" onclick="toggleGroupFold('${gid}')">
                    <span class="group-chevron">\u{25BE}</span>
                    <div class="avatar-sm group-avatar" style="display: none; width: 24px; height: 24px; margin-right: 0; flex-shrink: 0;"></div>
                    <span class="group-title-text">${escapeHTML(data.groupTitle || "Group")}</span>
                </div>
                <div class="group-chats-list" id="group-list-${gid}"></div>
            `;
            list.appendChild(groupContainer);
        } else {
            const titleText = groupContainer.querySelector('.group-title-text');
            if (titleText) titleText.innerText = data.groupTitle || "Group";
        }

        // Apply the profile picture to the Group Header if available
        if (data.profilePic) {
            const gAvatar = groupContainer.querySelector('.group-avatar');
            if (gAvatar) {
                gAvatar.innerHTML = `<img src="${data.profilePic}" style="width:100%; height:100%; object-fit:cover;">`;
                gAvatar.style.display = 'flex';
                twemoji.parse(gAvatar);
            }
            groupProfilePics.set(data.groupId, data.profilePic);
        }
        const targetGroupList = document.getElementById(`group-list-${gid}`);
        if (div.parentNode !== targetGroupList) {
            targetGroupList.appendChild(div);
        }
    } else {
        if (div.parentNode !== list) {
            list.appendChild(div);
        }
    }

    // Sorting Logic
    const chatLinks = Array.from(list.children);
    const firstPositions = new Map();
    chatLinks.forEach(link => firstPositions.set(link.id, link.getBoundingClientRect().top));

    // Sort standalone chats and groups by their latest activity
    chatLinks.sort((a, b) => {
        const getTs = (el) => {
            if (el.classList.contains('sidebar-group-wrap')) {
                const sub = Array.from(el.querySelector('.group-chats-list').children);
                return Math.max(...sub.map(c => Number(c.dataset.timestamp || 0)));
            }
            return Number(el.dataset.timestamp || 0);
        };
        return getTs(b) - getTs(a);
    });

    chatLinks.forEach(link => list.appendChild(link));

    chatLinks.forEach(link => {
        const firstTop = firstPositions.get(link.id);
        if (firstTop === undefined) return; // Skip brand-new elements

        const lastTop = link.getBoundingClientRect().top;
        const delta = firstTop - lastTop;

        if (delta !== 0) {
            // Invert: Jump back to the old position immediately without transition
            link.style.transition = 'none';
            link.style.transform = `translateY(${delta}px)`;
            
            // Force a reflow to ensure the 'Invert' state is applied before playing
            link.offsetHeight; 
            
            // Play: Smoothly transition back to the new natural position (translateY 0)
            link.style.transition = 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)';
            link.style.transform = 'translateY(0)';
            
            // Cleanup inline styles after the animation finishes
            setTimeout(() => {
                if (link) {
                    link.style.transition = '';
                    link.style.transform = '';
                }
            }, 500);
        }
    });
}

/* ---------------- GLIDER LOGIC ---------------- */
function setupGlider() {
    const tabs = document.querySelectorAll('.glider-tab');
    const thumb = document.querySelector('.glider-thumb');
    const list = document.getElementById('chats-list');
    if (!thumb || !list) return;

    tabs.forEach((tab, index) => {
        tab.onclick = () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            thumb.style.transform = `translateX(calc(${index * 100}% + ${index * 4}px))`;
            
            const filter = tab.dataset.filter;
            // only swap the filter-* class (don't wipe 'collapsed-content')
            Array.from(list.classList).filter(c => c.startsWith('filter-')).forEach(c => list.classList.remove(c));
            if (filter !== 'all') list.classList.add(`filter-${filter}`);
        };
    });
}
setupGlider();
updateCategoryBadges();

/* ---------------- SIDEBAR INTERACTION ---------------- */

window.toggleGroupFold = (gid) => {
    const container = document.getElementById(`group-container-${gid}`);
    if (!container) return;

    const isNowCollapsed = container.classList.toggle('collapsed');
    localStorage.setItem(`group_fold_${gid}`, isNowCollapsed);
    
    // If we folded the group containing the active chat, don't do anything special,
    // but visually it's clear the user is focusing elsewhere.
};

function startChat(me, them, name) {

    const chatId =
        me < them
            ? `${me}_${them}`
            : `${them}_${me}`;

    const updates = {};

    updates[`/chats/${chatId}/title`] = name;

    updates[`/user_chats/${me}/${chatId}`] = true;
    updates[`/user_chats/${them}/${chatId}`] = true;

    updates[`/members/${chatId}/${me}`] = true;
    updates[`/members/${chatId}/${them}`] = true;

    update(ref(db), updates)
        .then(() => openChat(chatId, name))
        .catch(err => {
            console.error("Start chat error:", err);
            showNotification("Failed to start chat", "error");
        });
}/* ---------------- OPEN CHAT ---------------- */

async function openChat(chatId, title) {
    dismissKeyboard();
    currentChatId = chatId;
    currentChatData = null;
    closeSidebarDrawer();

    const initialPinnedBanner = document.getElementById('pinned-message-banner');
    if (initialPinnedBanner) {
        initialPinnedBanner.style.display = 'none';
    }
    const initialPinsContainer = document.getElementById('pinned-messages-container');
    if (initialPinsContainer) {
        initialPinsContainer.innerHTML = '';
    }
    const initialLobbyBanner = document.getElementById('active-lobby-banner');
    if (initialLobbyBanner) {
        initialLobbyBanner.style.display = 'none';
    }
    const initialLobbyJoinBtn = document.getElementById('active-lobby-join-btn');
    if (initialLobbyJoinBtn) initialLobbyJoinBtn.onclick = null;

    document.body.classList.add('chat-open');
    // Close members panel if open when switching chats
    document.body.classList.remove('members-open');

    document.getElementById('chat-title-text').innerText = title;

    if (chatId === 'channel_orion_updates') {
        const input = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');
        if (input && sendBtn) {
            input.disabled = true;
            sendBtn.disabled = true;
            input.placeholder = "Only system and administrators can post here";
        }
    }

    // Update active state in UI immediately
    document.querySelectorAll('.chat-link').forEach(l => l.classList.remove('active'));
    const activeLink = document.getElementById(`link-${chatId}`);
    if (activeLink) activeLink.classList.add('active');

    // Clear unread indicator in DB when opening the chat
    remove(ref(db, `unread/${auth.currentUser.uid}/${chatId}`));
    remove(ref(db, `mentions/${auth.currentUser.uid}/${chatId}`));

    const openEntry = allChatsStore.get(chatId);
    if (openEntry) {
        openEntry.isUnread = false;
        openEntry.mentionCount = 0;
        updateCategoryBadges(Array.from(allChatsStore.values()));
    }

    // Set up real-time listener for chat details (title, description)
    if (activeChatMetaOff) activeChatMetaOff();
    if (activeMembersOff) activeMembersOff();
    if (activeMessagesOff) activeMessagesOff();
    if (activeTypingOff) activeTypingOff();
    if (activeChatPartnerOff) activeChatPartnerOff();
    if (activeGroupMuteOff) { activeGroupMuteOff(); activeGroupMuteOff = null; }
    if (activeGamesListOff) { activeGamesListOff(); activeGamesListOff = null; }
    cleanupLobbyCardListeners();

    const initialMuteBanner = document.getElementById('group-muted-banner');
    if (initialMuteBanner) initialMuteBanner.style.display = 'none';
    const initMuteBanner = document.getElementById('mute-banner');
    if (initMuteBanner) initMuteBanner.remove();
    const initMsgWrapper = document.getElementById('message-input-wrapper') || document.querySelector('.input-wrapper');
    if (initMsgWrapper) initMsgWrapper.style.display = 'flex';
    const initMsgInput = document.getElementById('message-input');
    if (initMsgInput) {
        initMsgInput.style.display = '';
        initMsgInput.disabled = false;
    }

    // Clear caches for new chat context
    currentChatMemberNames.clear();
    currentChatMemberPics.clear();
    currentChatMemberBadges.clear();

    const typingIndicator = document.getElementById('typing-indicator') || createTypingIndicator();
    typingIndicator.innerText = '';

    const chatRef = ref(db, `chats/${chatId}`);
    activeChatMetaOff = onValue(chatRef, (chatSnap) => {
        const chatData = chatSnap.val();
        if (!chatData) return;
        currentChatData = chatData;
        updatePinnedMessageBanner(chatData, chatId);
        viewedMessagesInSession.clear();

        const isGroup = chatData.isGroup === true || chatData.type === 'group' || !!chatData.groupId;
        const groupId = chatData.groupId || chatId;

        if (activeGroupMuteOff) {
            activeGroupMuteOff();
            activeGroupMuteOff = null;
        }

        if (isGroup && groupId) {
            activeGroupMuteOff = onValue(ref(db, `groups/${groupId}`), (groupSnap) => {
                const groupData = groupSnap.val() || {};
                updateGroupMuteUI(groupData, chatData);
            });
        } else {
            updateGroupMuteUI(null, chatData);
        }

        const chatTitleElem = document.getElementById('chat-title-text');
        const chatDescriptionElem = document.getElementById('chat-description-text');
        const editGroupBtn = document.getElementById('edit-group-btn');
        const headerAvatar = document.getElementById('chat-header-avatar');
        const openMembersBtn = document.getElementById('open-members-panel');
        const headerMenuBtn = document.getElementById('chat-header-menu-btn');
        const chatMembersSidebar = document.getElementById('chat-members-sidebar');

        const isChannelOrGroup = chatData.isGroup || chatData.isChannel || chatData.type === 'channel' || chatData.isSystem || chatId === 'channel_orion_updates';
        if (isChannelOrGroup) {
            chatTitleElem.innerText = chatData.title || chatData.name || title;
            chatDescriptionElem.innerText = chatData.description || "Official system updates and announcements";
            chatDescriptionElem.style.color = '';
            chatDescriptionElem.style.display = 'block';

            const isSysChannel = chatId === 'channel_orion_updates';
            if (openMembersBtn) openMembersBtn.style.display = isSysChannel ? 'none' : '';
            if (headerMenuBtn) headerMenuBtn.style.display = isSysChannel ? 'none' : '';
            if (chatMembersSidebar) chatMembersSidebar.style.display = isSysChannel ? 'none' : '';
            if (typeof window.positionReplyPreview === 'function') window.positionReplyPreview();

            if (headerAvatar) {
                const cachedPic = chatData.profilePic || (chatData.groupId ? groupProfilePics.get(chatData.groupId) : null);
                if (cachedPic) {
                    headerAvatar.innerHTML = `<img src="${cachedPic}" style="width:100%; height:100%; object-fit:cover;">`;
                    twemoji.parse(headerAvatar);
                    if (chatData.profilePic && chatData.groupId && !groupProfilePics.has(chatData.groupId)) {
                        groupProfilePics.set(chatData.groupId, chatData.profilePic);
                    }
                    if (chatData.profilePic && chatData.groupId) {
                        get(ref(db, `groups/${chatData.groupId}/profilePic`)).then(picSnap => {
                            if (!picSnap.val()) {
                                set(ref(db, `groups/${chatData.groupId}/profilePic`), chatData.profilePic);
                            }
                        });
                    }
                } else if (chatData.groupId) {
                    headerAvatar.innerText = chatData.isChannel ? '\u{1F4E2}' : '#';
                    // Fetch group photo directly from /groups/groupId/profilePic
                    get(ref(db, `groups/${chatData.groupId}/profilePic`)).then(picSnap => {
                        const foundPic = picSnap.val();
                        if (foundPic) {
                            groupProfilePics.set(chatData.groupId, foundPic);
                            if (currentChatId === chatId) {
                                headerAvatar.innerHTML = `<img src="${foundPic}" style="width:100%; height:100%; object-fit:cover;">`;
                                twemoji.parse(headerAvatar);
                            }
                        }
                    });
                } else if (chatId === 'channel_orion_updates') {
                    headerAvatar.innerText = '🛡️';
                } else {
                    headerAvatar.innerText = chatData.isChannel ? '\u{1F4E2}' : '\u{1F465}';
                }
                headerAvatar.style.display = 'flex';
                twemoji.parse(headerAvatar);
            }

            // Only show edit button to the group creator
            if (auth.currentUser.uid === chatData.creatorId) {
                editGroupBtn.style.display = 'block'; // Show edit button
                editGroupBtn.onclick = () => openEditGroupModal(chatId, chatData.title, chatData.description, chatData.creatorId);
            } else {
                editGroupBtn.style.display = 'none';
            }
        } else {
            // Strictly hide Members button, Group Details/Menu, and Members Sidebar in 1-on-1 DMs
            if (openMembersBtn) openMembersBtn.style.display = 'none';
            if (headerMenuBtn) headerMenuBtn.style.display = 'none';
            if (chatMembersSidebar) chatMembersSidebar.style.display = 'none';
            document.body.classList.remove('members-open');
            if (typeof window.positionReplyPreview === 'function') window.positionReplyPreview();
            editGroupBtn.style.display = 'none';

            // For private chats, fetch partner's latest name and online/offline status
            const partnerId = chatId.split('_').find(id => id !== auth.currentUser.uid);
            if (partnerId) {
                if (activeChatPartnerOff) activeChatPartnerOff();
                activeChatPartnerOff = onValue(ref(db, `users/${partnerId}`), (pSnap) => {
                    const pData = pSnap.val();
                    document.getElementById('chat-title-text').innerText = getDisplayName(pData);
                    const isOnline = pData?.status === 'online';
                    chatDescriptionElem.innerText = isOnline ? 'Online' : 'Offline';
                    chatDescriptionElem.style.color = isOnline ? '#22c55e' : 'rgba(255, 255, 255, 0.45)';
                    chatDescriptionElem.style.display = 'block';

                    if (headerAvatar) {
                        const status = isOnline ? 'online' : '';
                        const avatarContent = pData?.profilePic
                            ? `<img src="${pData.profilePic}" style="width:100%; height:100%; object-fit:cover;">`
                            : '\u{1F464}';

                        headerAvatar.innerHTML = `
                            <div class="member-avatar-container" style="margin-right: 0;">
                                <div class="avatar-lg" style="margin-bottom: 0; width: 40px; height: 40px; font-size: 20px;">
                                    ${avatarContent}
                                </div>
                                <span class="status-dot ${status}" style="bottom: 0; right: 0;"></span>
                            </div>
                        `;
                        headerAvatar.style.display = 'flex';
                        twemoji.parse(headerAvatar);
                    }
                });
            } else {
                chatDescriptionElem.style.display = 'none';
            }
        }
    });

    updateInputButtons();

    activeTypingOff = onValue(ref(db, `typing/${chatId}`), async (snap) => {
        if (!typingIndicator) return; // Ensure indicator exists
        const typers = snap.val() || {};
        const names = [];
        for (const uid in typers) {
            if (uid !== auth.currentUser.uid) {
                const uSnap = await get(ref(db, `users/${uid}`));
                names.push(uSnap.val()?.displayName || "User");
            }
        }
        if (names.length > 0) {
            const verb = names.length > 1 ? "are" : "is";
            typingIndicator.innerHTML = `${escapeHTML(names.join(', '))} ${verb} typing<div class="typing-dots"><span></span><span></span><span></span></div>`;
            typingIndicator.classList.remove('typing-hiding'); // Remove if it was fading out
            typingIndicator.style.display = 'flex';
        } else if (typingIndicator.style.display === 'flex' && !typingIndicator.classList.contains('typing-hiding')) {
            typingIndicator.classList.add('typing-hiding');
            typingIndicator.addEventListener('animationend', () => {
                if (typingIndicator.classList.contains('typing-hiding')) {
                    typingIndicator.style.display = 'none';
                    typingIndicator.classList.remove('typing-hiding');
                }
            }, { once: true });
        }
    });

    const mRef = ref(db, `messages/${chatId}`);
    const membersRef = ref(db, `members/${chatId}`);

    // Get initial data to ensure we have the creatorId for the members list
    const chatSnap = await get(chatRef);
    currentChatCreatorId = chatSnap.val()?.creatorId;

    if (chatId === 'channel_orion_updates') {
        currentChatMemberData = {};
    } else {
        activeMembersOff = onValue(membersRef, (msnap) => {
            currentChatMemberData = msnap.val() || {};
            renderMembersList(msnap, currentChatCreatorId);
            checkMuteStatus();
            if (currentChatData) {
                const hasPerms = canCurrentUserPin(currentChatData);
                document.querySelectorAll('#pinned-messages-container .unpin-dynamic-btn').forEach(btn => {
                    btn.style.display = hasPerms ? 'block' : 'none';
                });
            }
        });

        activeGamesListOff = onValue(ref(db, `games/${chatId}`), (snap) => {
            if (currentChatId !== chatId) return;
            const banner = document.getElementById('active-lobby-banner');
            const textEl = document.getElementById('active-lobby-text');
            const joinBtn = document.getElementById('active-lobby-join-btn');
            if (!banner || !textEl || !joinBtn) return;

            const allGames = snap.val();
            if (!allGames || typeof allGames !== 'object') {
                banner.style.display = 'none';
                joinBtn.onclick = null;
                return;
            }

            const now = Date.now();
            const openLobbies = [];
            Object.entries(allGames).forEach(([gId, gData]) => {
                if (!gData || typeof gData !== 'object') return;
                if (gData.status !== 'lobby') return;
                if (gData.emptySince && (now - gData.emptySince > 5 * 60 * 1000)) return;
                openLobbies.push({ gameId: gId, ...gData });
            });

            if (openLobbies.length === 0) {
                banner.style.display = 'none';
                joinBtn.onclick = null;
                return;
            }

            openLobbies.sort((a, b) => {
                const timeDiff = (b.createdAt || 0) - (a.createdAt || 0);
                if (timeDiff !== 0) return timeDiff;
                return String(b.gameId).localeCompare(String(a.gameId));
            });

            const latestLobby = openLobbies[0];
            const lobbyName = latestLobby.gameType || getGameDisplayTitle(latestLobby.type);
            const playerCount = Object.keys(latestLobby.players || {}).length;

            textEl.innerText = `ACTIVE LOBBY: ${lobbyName} (${playerCount} in lobby)`;
            if (window.twemoji) twemoji.parse(textEl);
            banner.style.display = 'flex';
            joinBtn.onclick = () => {
                setupGameLobby(normalizeGameTypeKey(latestLobby.type || lobbyName), latestLobby.gameId);
            };
        }, (err) => {
            console.warn('[Game] Active lobby listener error:', err);
        });
    }

    const cont = document.getElementById('messages-container');
    cont.innerHTML = ''; // Clear once when opening the chat

    // Top sentinel element for reverse pagination (fetching older messages when scrolled up)
    const topSentinel = document.createElement('div');
    topSentinel.id = 'chat-top-sentinel';
    topSentinel.style.cssText = 'height: 1px; width: 100%; flex-shrink: 0; pointer-events: none;';
    cont.appendChild(topSentinel);

    let currentOldestMessageKey = null;
    let currentNewestMessageKey = null;
    let isLoadingOlderMessages = false;
    let hasMoreOlderMessages = true;
    let lastSenderId = null;

    // Helper: load previous 15 messages via endBefore() cursor
    async function loadOlderMessages() {
        if (isLoadingOlderMessages || !hasMoreOlderMessages || !currentOldestMessageKey || currentChatId !== chatId) return;
        isLoadingOlderMessages = true;

        const prevOldestKey = currentOldestMessageKey;
        const oldScrollHeight = cont.scrollHeight;
        const oldScrollTop = cont.scrollTop;

        try {
            const olderQuery = query(
                ref(db, `messages/${chatId}`),
                orderByKey(),
                endBefore(prevOldestKey),
                limitToLast(15)
            );
            const olderSnap = await get(olderQuery);
            if (currentChatId !== chatId) return;

            if (!olderSnap.exists() || olderSnap.size === 0) {
                hasMoreOlderMessages = false;
                isLoadingOlderMessages = false;
                return;
            }

            const olderMessages = [];
            olderSnap.forEach(child => {
                olderMessages.push({ key: child.key, val: child.val() });
            });

            if (olderMessages.length < 15) {
                hasMoreOlderMessages = false;
            }

            currentOldestMessageKey = olderMessages[0].key;

            let prevSender = null;
            for (const item of olderMessages) {
                const msg = item.val;
                const isConsecutive = prevSender && prevSender === msg.sender_id;
                prevSender = msg.sender_id;
                renderMessage(msg, isConsecutive, item.key);
            }

            // Maintain exact scroll position without violent jumping
            const newScrollHeight = cont.scrollHeight;
            cont.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
        } catch (err) {
            console.error("Error loading older messages:", err);
        } finally {
            isLoadingOlderMessages = false;
        }
    }

    // Scroll listener for top reverse pagination
    const onChatScroll = () => {
        if (cont.scrollTop <= 60 && !isLoadingOlderMessages && hasMoreOlderMessages) {
            loadOlderMessages();
        }
    };
    cont.addEventListener('scroll', onChatScroll, { passive: true });

    // IntersectionObserver attached to top sentinel
    let topObserver = null;
    if ('IntersectionObserver' in window) {
        topObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !isLoadingOlderMessages && hasMoreOlderMessages) {
                loadOlderMessages();
            }
        }, { root: cont, threshold: 0.1 });
        topObserver.observe(topSentinel);
    }

    // Stale-While-Revalidate Local Storage Cache Pattern
    const clearChatContainer = () => {
        cleanupLobbyCardListeners();
        const children = Array.from(cont.children);
        for (const child of children) {
            if (child !== topSentinel) {
                child.remove();
            }
        }
        lastSenderId = null;
    };

    const renderMessageList = (messagesList) => {
        if (!messagesList || messagesList.length === 0) {
            hasMoreOlderMessages = false;
            return;
        }
        if (messagesList.length < 15) {
            hasMoreOlderMessages = false;
        }
        currentOldestMessageKey = messagesList[0].key;
        currentNewestMessageKey = messagesList[messagesList.length - 1].key;
        lastSenderId = null;

        for (const item of messagesList) {
            const msg = item.val;
            if (chatId !== 'channel_orion_updates' && msg.sender_id !== auth.currentUser.uid && !viewedMessagesInSession.has(item.key)) {
                viewedMessagesInSession.add(item.key);
                update(ref(db, `messages/${chatId}/${item.key}`), { 
                    [`viewedBy/${auth.currentUser.uid}`]: true
                }).catch(() => {});
            }
            const isConsecutive = msg.sender_id === lastSenderId;
            renderMessage(msg, isConsecutive, item.key);
            lastSenderId = msg.sender_id;
        }
        cont.scrollTop = cont.scrollHeight;
        updateInputButtons();
    };

    const fetchRecentMessagesFromDB = async (roomId) => {
        const initialQuery = query(ref(db, `messages/${roomId}`), orderByKey(), limitToLast(15));
        const initialSnap = await get(initialQuery);
        if (currentChatId !== roomId) return [];

        const freshMessages = [];
        initialSnap.forEach(child => {
            freshMessages.push({ key: child.key, val: child.val() });
        });
        return freshMessages;
    };

    const loadChatMessages = async (roomId) => {
        const cacheKey = `orion_cache_${roomId}`;
        const cachedData = localStorage.getItem(cacheKey);

        // 1. Instantly render from local cache if it exists
        if (cachedData) {
            try {
                const parsedCache = JSON.parse(cachedData);
                renderMessageList(parsedCache);
            } catch (err) {
                console.error('[CACHE] Corrupt cache parsing failed:', err);
            }
        }

        // 2. Silently fetch the latest 15 messages from the server/Firebase
        try {
            const freshMessages = await fetchRecentMessagesFromDB(roomId);
            if (currentChatId !== roomId) return;

            // 3. Check for changes
            const freshDataString = JSON.stringify(freshMessages);
            if (cachedData !== freshDataString) {
                // Update cache and refresh UI only if data changed
                try {
                    localStorage.setItem(cacheKey, freshDataString);
                } catch (e) {
                    console.warn('[CACHE] localStorage quota exceeded or write failed:', e);
                }

                clearChatContainer();
                renderMessageList(freshMessages);
            }
        } catch (error) {
            console.error('[CACHE] Background sync failed:', error);
        }
    };

    await loadChatMessages(chatId);
    if (currentChatId !== chatId) return;

    // Real-time listener for newly appended messages
    const newMsgsQuery = currentNewestMessageKey
        ? query(ref(db, `messages/${chatId}`), orderByKey(), startAfter(currentNewestMessageKey))
        : ref(db, `messages/${chatId}`);

    const addedOff = onChildAdded(newMsgsQuery, (data) => {
        // Guard against duplicate if initial batch already rendered it
        if (document.getElementById(`msg-${data.key}`)) return;

        if (!currentOldestMessageKey) {
            currentOldestMessageKey = data.key;
        }
        currentNewestMessageKey = data.key;

        const messageData = data.val();
        if (chatId !== 'channel_orion_updates' && currentChatId && messageData.sender_id !== auth.currentUser.uid && !viewedMessagesInSession.has(data.key)) {
            viewedMessagesInSession.add(data.key);
            update(ref(db, `messages/${currentChatId}/${data.key}`), { 
                [`viewedBy/${auth.currentUser.uid}`]: true
            }).catch(() => {});
        }

        const isConsecutive = messageData.sender_id === lastSenderId;
        renderMessage(messageData, isConsecutive, data.key);
        lastSenderId = messageData.sender_id;

        // Auto-scroll to bottom if user is close to bottom or sent by current user
        const isNearBottom = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 160;
        if (isNearBottom || messageData.sender_id === auth.currentUser.uid) {
            cont.scrollTop = cont.scrollHeight;
        }
        updateInputButtons();
    });

    const changedOff = onChildChanged(ref(db, `messages/${chatId}`), (data) => {
        const wrap = document.getElementById(`msg-${data.key}`);
        if (wrap) {
            const wasConsecutive = wrap.classList.contains('consecutive');
            renderMessage(data.val(), wasConsecutive, data.key);
        }
    });

    const removedOff = onChildRemoved(ref(db, `messages/${chatId}`), (data) => {
        const unsub = activeLobbyCardUnsubs.get(data.key);
        if (typeof unsub === 'function') {
            unsub();
            activeLobbyCardUnsubs.delete(data.key);
        }
        const wrap = document.getElementById(`msg-${data.key}`);
        if (wrap) wrap.remove();
    });

    activeMessagesOff = () => {
        addedOff();
        changedOff();
        removedOff();
        cont.removeEventListener('scroll', onChatScroll);
        if (topObserver) topObserver.disconnect();
    };
}

// --- Join Card Renderer ---
async function renderJoinCard(chatId, container) {
    const card = document.createElement('div');
    card.className = 'join-card-embed';
    card.innerHTML = `<small style="opacity:0.5">Loading invite...</small>`;
    container.appendChild(card);

    try {
        const [chatSnap, membersSnap, myJoinSnap] = await Promise.all([
            get(ref(db, `chats/${chatId}`)),
            get(ref(db, `members/${chatId}`)),
            get(ref(db, `user_chats/${auth.currentUser.uid}/${chatId}`))
        ]);

        const chatData = chatSnap.val();
        if (!chatData) {
            card.innerHTML = `<small style="opacity:0.5">Invite link is invalid or expired.</small>`;
            return;
        }

        const members = membersSnap.val() || {};
        const memberCount = Object.keys(members).length;
        const isJoined = myJoinSnap.exists();
        const icon = chatData.isChannel ? '\u{1F4E2}' : '\u{1F465}';
        
        const avatarHtml = chatData.profilePic 
            ? `<img src="${chatData.profilePic}" style="width:40px; height:40px; border-radius:12px; object-fit:cover;">`
            : `<div class="avatar-sm" style="width:40px; height:40px; background:var(--glass-bright); font-size:20px; border-radius:12px; border: 1px solid var(--glass-border);">${icon}</div>`;

        card.innerHTML = `
            <div class="join-card-header">
                ${avatarHtml}
                <div style="display:flex; flex-direction:column; overflow:hidden; flex:1;">
                    <span class="join-card-title">${escapeHTML(chatData.title)}</span>
                    <span class="join-card-stats">${memberCount} member${memberCount !== 1 ? 's' : ''}</span>
                </div>
                <button class="glass-btn-primary" style="width:auto; padding:6px 14px; font-size:12px; margin-left:auto;">${isJoined ? 'Open' : 'Join'}</button>
            </div>
        `;
        
        card.onclick = (e) => {
            e.stopPropagation();
            isJoined ? openChat(chatId, chatData.title) : (window.location.hash = `join=${chatId}`, handleUrlJoin());
        };
        twemoji.parse(card);
    } catch (e) { card.innerHTML = `<small style="opacity:0.5">Could not load invite.</small>`; }
}

// --- Invite Link & Join Logic ---
function generateInviteLink(chatId) {
    return `${window.location.origin}${window.location.pathname}#join=${chatId}`;
}

async function handleUrlJoin() {
    const hash = window.location.hash;
    if (hash.startsWith('#join=')) {
        const chatId = hash.split('=')[1];
        const myUid = auth.currentUser?.uid;
        if (!myUid || !chatId) return;

        const chatSnap = await get(ref(db, `chats/${chatId}`));
        const chatData = chatSnap.val();
        
        if (chatData) {
            const confirmed = await showConfirm(`Join ${chatData.isChannel ? 'Channel' : 'Group'}`, `Do you want to join "${chatData.title}"?`);
            if (confirmed) {
                const updates = {};
                updates[`/user_chats/${myUid}/${chatId}`] = true;
                updates[`/members/${chatId}/${myUid}`] = { role: 'member' };
                await update(ref(db), updates);
                openChat(chatId, chatData.title);
            }
        }
        window.location.hash = ''; // Clear hash
    }
}

window.setChatVisibility = (isPublic) => {
    const modal = document.getElementById('edit-group-modal');
    modal.dataset.isPublic = isPublic;
    document.getElementById('visibility-public').classList.toggle('active', isPublic);
    document.getElementById('visibility-private').classList.toggle('active', !isPublic);
};

// Handle Chat Picture Selection
document.getElementById('edit-chat-avatar').onclick = () => document.getElementById('chat-pic-input').click();
document.getElementById('chat-pic-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
        let base64 = await downscaleImageDimensions(event.target.result, 200, 200);
        document.getElementById('edit-chat-avatar').innerHTML = `<img src="${base64}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
        document.getElementById('edit-group-modal').dataset.newPic = base64;
    };
    reader.readAsDataURL(file);
};

function attachLobbyCardListener(chatId, messageId, gameId, countBadge, joinBtn, inviteText, lobbyHeaderText) {
    if (!chatId || !gameId || !countBadge) return;
    const prevUnsub = activeLobbyCardUnsubs.get(messageId);
    if (typeof prevUnsub === 'function') prevUnsub();

    const unsub = onValue(ref(db, `games/${chatId}/${gameId}`), (snap) => {
        if (!countBadge.isConnected || currentChatId !== chatId) return;
        const gameData = snap.val();

        if (!gameData) {
            countBadge.innerText = '\u{1F3C1} Finished';
            countBadge.dataset.status = 'finished';
            if (inviteText) inviteText.innerText = '\u{1F6A9} GAME CLOSED';
            if (joinBtn) {
                joinBtn.disabled = true;
                joinBtn.innerText = 'Closed';
                joinBtn.className = 'glass-btn-secondary';
            }
            if (window.twemoji) {
                twemoji.parse(countBadge);
                if (inviteText) twemoji.parse(inviteText);
            }
            return;
        }

        const status = gameData.status || 'lobby';
        if (status === 'finished') {
            countBadge.innerText = '\u{1F3C1} Finished';
            countBadge.dataset.status = 'finished';
            if (inviteText) inviteText.innerText = lobbyHeaderText;
            if (joinBtn) {
                joinBtn.disabled = true;
                joinBtn.innerText = 'Finished';
                joinBtn.className = 'glass-btn-secondary';
            }
        } else if (status === 'playing' || status === 'choosing' || status === 'active' || status === 'reveal' || status === 'clues' || status === 'voting' || status === 'spy_guess') {
            countBadge.innerText = '\u{1F3AE} In Progress';
            countBadge.dataset.status = 'playing';
            if (inviteText) inviteText.innerText = lobbyHeaderText;
            if (joinBtn) {
                joinBtn.disabled = true;
                joinBtn.innerText = 'In Progress';
                joinBtn.className = 'glass-btn-secondary';
            }
        } else {
            const playerCount = Object.keys(gameData.players || {}).length;
            countBadge.innerText = `\u{1F465} ${playerCount} in lobby`;
            countBadge.dataset.status = 'lobby';
            if (inviteText) inviteText.innerText = lobbyHeaderText;
            if (joinBtn) {
                joinBtn.disabled = false;
                joinBtn.innerText = 'Join Game';
                joinBtn.className = 'glass-btn-primary';
            }
        }
        if (window.twemoji) {
            twemoji.parse(countBadge);
            if (inviteText) twemoji.parse(inviteText);
        }
    }, (err) => {
        console.warn('[Game] Lobby card listener error:', err);
    });

    activeLobbyCardUnsubs.set(messageId, unsub);
}

function renderMessage(msg, isConsecutive = false, messageId) {
    const cont = document.getElementById('messages-container');
    let wrap = document.getElementById(`msg-${messageId}`);
    const isNew = !wrap;

    if (isNew) {
        wrap = document.createElement('div');
        wrap.id = `msg-${messageId}`;
        wrap.dataset.senderId = msg.sender_id || msg.sender; // Store sender_id on the message wrapper
        wrap.dataset.timestamp = msg.timestamp;
    } else {
        wrap.innerHTML = ''; // Clear for update (reactions/edits)
    }

    const senderUid = msg.sender_id || msg.sender;
    const isMe = senderUid === auth.currentUser.uid;
    const isSystem = senderUid === 'system';
    const myName = document.getElementById('current-user-name').innerText;
    const myMentionRegex = new RegExp(`@${myName}\\b`, 'i');
    const everyoneMentionRegex = /@everyone\b/i;

    const isUserMentioned = !isMe && msg.text && (myMentionRegex.test(msg.text) || everyoneMentionRegex.test(msg.text));

    // Check for sticker messages
    if (msg.stickerId) {
        renderStickerMessage(msg, isConsecutive, messageId, isMe, isUserMentioned);
        return; // Exit early as it's a sticker, not text
    }

    // Check for poll messages
    if (msg.poll) {
        renderPollMessage(msg, isConsecutive, messageId, isMe, isUserMentioned);
        return;
    }

    if (isSystem) {
        wrap.className = 'msg-wrapper system-msg';
    } else {
        wrap.className = isMe ? 'msg-wrapper sent' : 'msg-wrapper rcv';
        if (isConsecutive) wrap.classList.add('consecutive');
        if (isUserMentioned) wrap.classList.add('user-mentioned');
    }

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.dataset.messageId = messageId;
    bubble.dataset.senderName = msg.sender_name || (isMe ? (auth.currentUser?.displayName || 'You') : 'User');
    bubble._replyData = {
        messageId,
        text: msg.text || '',
        senderName: msg.sender_name || (isMe ? (auth.currentUser?.displayName || 'You') : 'User')
    };

    // Handle Game Invite Link
    if (msg.gameInvite || msg.isGameInvite) {
        bubble.classList.add('game-invite-bubble');
        const inviteType = normalizeGameTypeKey(msg.gameType || msg.type);
        const msgGameId = msg.gameId || null;
        const lobbyHeaderText = inviteType === 'wordle'
            ? "\u{1F4DD} WORD RUSH LOBBY"
            : (inviteType === 'doodle'
                ? "\u{1F3A8} DOODLE DASH LOBBY"
                : (inviteType === 'spy' ? "\u{1F575}\u{FE0F} SPY LOBBY" : "\u{1F6A9} WORLD FLAGS LOBBY"));

        const inviteText = document.createElement('div');
        inviteText.style.fontWeight = '700';
        inviteText.innerText = msg.expired ? "\u{1F6A9} GAME CLOSED" : lobbyHeaderText;
        bubble.appendChild(inviteText);

        let countBadge = null;
        if (msgGameId) {
            countBadge = document.createElement('span');
            countBadge.className = 'lobby-player-count';
            countBadge.dataset.gameId = msgGameId;
            countBadge.innerText = msg.expired ? '\u{1F3C1} Finished' : '\u{1F465} 1 in lobby';
            bubble.appendChild(countBadge);
        }

        const joinBtn = document.createElement('button');
        joinBtn.className = msg.expired ? 'glass-btn-secondary' : 'glass-btn-primary';
        joinBtn.style.marginTop = '10px';
        joinBtn.style.display = 'block';
        joinBtn.innerText = msg.expired ? 'Closed' : 'Join Game';
        joinBtn.disabled = !!msg.expired;
        joinBtn.onclick = () => {
            if (joinBtn.disabled) return;
            if (!msgGameId) {
                showNotification('This game lobby has expired.', 'info');
                return;
            }
            setupGameLobby(inviteType, msgGameId);
        };
        bubble.appendChild(joinBtn);

        if (msgGameId && currentChatId && currentChatId !== 'channel_orion_updates' && countBadge) {
            attachLobbyCardListener(currentChatId, messageId, msgGameId, countBadge, joinBtn, inviteText, lobbyHeaderText);
        }
    }

    // Reactions Bar
    const reactionsBar = document.createElement('div');
    reactionsBar.className = 'msg-reactions-bar';
    const defaultReactions = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F62E}", "\u{1F622}"];
    
    defaultReactions.forEach(emoji => {
        const span = document.createElement('span');
        span.className = 'reaction-emoji';
        span.innerText = emoji;
        span.onclick = (e) => {
            e.stopPropagation();
            toggleReaction(messageId, emoji);
        };
        reactionsBar.appendChild(span);
    });

    const expandBtn = document.createElement('button');
    expandBtn.className = 'expand-reactions-btn';
    expandBtn.innerHTML = '&#x203A;'; // ›
    expandBtn.title = "More reactions";
    expandBtn.onclick = async (e) => {
        e.stopPropagation();
        const picker = document.getElementById('emoji-picker');
        const isSameMessage = activeReactionMessageId === messageId;
        
        activeReactionMessageId = isSameMessage && picker.style.display === 'grid' ? null : messageId;

        if (picker.style.display === 'none' || !isSameMessage) {
            const pm = document.getElementById('plus-menu');
            if (pm) { pm.style.display = 'none'; pm.classList.add('hidden'); }
            await renderEmojiPicker();
            picker.style.display = 'grid';
            picker.scrollTop = 0;
        } else {
            picker.style.display = 'none';
        }
    };
    reactionsBar.appendChild(expandBtn);
    wrap.appendChild(reactionsBar);
    
    // Render quoted reply if exists
    if (msg.reply_to) {
        const quote = document.createElement('div');
        quote.className = 'reply-quote';
        
        const displayReplyText = msg.reply_to.text.startsWith('data:image/') ? "Image" : msg.reply_to.text;
        // Limit the reply preview to 35 characters for a more compact look
        const replyLimit = 35;
        const truncatedText = displayReplyText.length > replyLimit 
            ? displayReplyText.substring(0, replyLimit) + "..." 
            : displayReplyText;

        quote.innerHTML = `
            <strong>${escapeHTML(msg.reply_to.name)}</strong>
            <div>${escapeHTML(truncatedText)}</div>
        `;

        // Add click listener to scroll to and highlight the original message
        quote.onclick = (e) => {
            e.stopPropagation(); // Prevent triggering any bubble click events
            const targetId = `msg-${msg.reply_to.id}`;
            const targetElem = document.getElementById(targetId);
            if (targetElem) {
                targetElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                targetElem.classList.add('highlight-flash');
                setTimeout(() => targetElem.classList.remove('highlight-flash'), 2500);
            } else {
                showNotification("Original message not found in recent history.", "info");
            }
        };
        bubble.appendChild(quote);
    }
    
    // Create a main content container to overlap the quote
    const msgContent = document.createElement('div');
    msgContent.className = 'msg-content';
    bubble.appendChild(msgContent);

    // Reactions Display Container
    if (msg.reactions) {
        const reactionsCont = document.createElement('div');
        reactionsCont.className = 'msg-reactions-container';
        
        for (const [rawEmoji, users] of Object.entries(msg.reactions)) {
            const emoji = sanitizeMojibakeEmoji(rawEmoji);
            const uids = Object.keys(users);
            if (uids.length === 0) continue;

            const tag = document.createElement('div');
            tag.className = 'reaction-tag';
            
            // Set a temporary "..." or check cache immediately
            tag.title = uids.map(uid => uid === auth.currentUser.uid ? "You" : (currentChatMemberNames.get(uid) || "...")).join(", ");
            
            // Asynchronously resolve all names to ensure the tooltip is accurate
            Promise.all(uids.map(async (uid) => {
                if (uid === auth.currentUser.uid) return "You";
                if (currentChatMemberNames.has(uid)) return currentChatMemberNames.get(uid);
                
                const uSnap = await get(ref(db, `users/${uid}`));
                const uData = uSnap.val();
                const name = uData?.displayName || (uData?.email ? uData.email.split('@')[0] : "User");
                currentChatMemberNames.set(uid, name); // Cache it for other messages
                return name;
            })).then(resolvedNames => {
                tag.title = resolvedNames.join(", ");
            });
            
            tag.innerHTML = `<span>${emoji}</span> <small>${uids.length}</small>`;
            tag.onclick = (e) => {
                e.stopPropagation();
                toggleReaction(messageId, rawEmoji);
            };
            reactionsCont.appendChild(tag);
        }
        msgContent.appendChild(reactionsCont);
    }

    const formatted = linkifyAndEmbed(msg.text);
    let htmlContent = formatted.html;

    // Handle direct imageUrl / videoUrl fields
    if (msg.imageUrl && !formatted.imageUrls.includes(msg.imageUrl)) {
        formatted.imageUrls.push(msg.imageUrl);
    }
    if ((msg.imageUrl || msg.videoUrl) && (msg.text === msg.imageUrl || msg.text === msg.videoUrl || !msg.text)) {
        htmlContent = "";
    }

    // Bold and style mentions within the message
    if (currentChatMemberNames) {
        currentChatMemberNames.forEach((name) => {
            const mentionRegex = new RegExp(`@${name}\\b`, 'g');
            htmlContent = htmlContent.replace(mentionRegex, `<span class="mention-pill">@${name}</span>`);
        });
    }
    htmlContent = htmlContent.replace(/@everyone\b/gi, `<span class="mention-pill">@everyone</span>`);

    // Only show text node if there's actual text remaining or if there are no other embeds to show
    if (htmlContent || (formatted.imageUrls.length === 0 && !formatted.youtubeId && !formatted.tiktokId && !formatted.tiktokShort && !formatted.instagramId && formatted.joinChatIds.length === 0)) {
        const textNode = document.createElement('div');
        textNode.innerHTML = htmlContent;
        msgContent.appendChild(textNode);
    }

    // Inline OTA update install card inside message (if not already parsed in-text via [UPDATE_VERSION:...])
    if (msg.metadata && msg.metadata.type === 'app_update' && !msg.text?.includes('[UPDATE_VERSION:')) {
        const updateVersion = msg.metadata.version || '1.0.2';
        const updateCard = document.createElement('div');
        updateCard.className = 'channel-update-card';
        updateCard.innerHTML = `
            <span class="update-badge">v${escapeHTML(updateVersion)} Available</span>
            <button type="button" class="channel-install-btn" onclick="window.triggerOtaUpdate('${escapeHTML(updateVersion)}')">
                ⚡ Install Update & Reload
            </button>
        `;
        msgContent.appendChild(updateCard);
    }

    formatted.imageUrls.forEach(url => {
        const imgWrap = document.createElement('div');
        imgWrap.className = 'image-embed-wrapper';
        imgWrap.style.minHeight = '140px';
        imgWrap.style.background = 'rgba(255, 255, 255, 0.04)';
        imgWrap.style.borderRadius = '12px';
        imgWrap.style.display = 'flex';
        imgWrap.style.alignItems = 'center';
        imgWrap.style.justifyContent = 'center';
        const img = document.createElement('img');
        img.src = url;
        img.className = 'chat-embedded-image';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.setAttribute('referrerpolicy', 'no-referrer');
        img.alt = 'Shared image';
        img.onclick = (e) => {
            e.stopPropagation();
            const modal = document.getElementById('image-viewer-modal');
            const modalImg = document.getElementById('viewer-main-img');
            const senderNameEl = document.getElementById('viewer-sender-name');

            if (modal && modalImg && senderNameEl) {
                modalImg.referrerPolicy = 'no-referrer';
                modalImg.setAttribute('referrerpolicy', 'no-referrer');
                modalImg.src = img.src;
                // Extract sender name from the message data
                senderNameEl.textContent = msg.sender_name || msg.senderName || (isMe ? 'You' : 'Photo');
                // Store current image URL globally for download button
                window.currentViewingImage = img.src;
                modal.classList.remove('hidden');
            } else {
                openImageLightbox(url);
            }
        };
        img.onload = () => {
            imgWrap.style.minHeight = '';
            imgWrap.style.background = '';
            const isNearBottom = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 120;
            if (isNearBottom) cont.scrollTop = cont.scrollHeight;
        };
        imgWrap.appendChild(img);
        msgContent.appendChild(imgWrap);
    });

    if (msg.videoUrl) {
        const vidIdMatch = msg.videoUrl.match(/id=([^&]+)/) || msg.videoUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        const vidId = vidIdMatch ? vidIdMatch[1] : null;
        const iframeUrl = vidId ? `https://drive.google.com/file/d/${vidId}/preview` : msg.videoUrl;

        const videoWrap = document.createElement('div');
        videoWrap.className = 'drive-video-wrapper';
        videoWrap.innerHTML = `<iframe src="${iframeUrl}" referrerpolicy="no-referrer" allowfullscreen></iframe>`;
        msgContent.appendChild(videoWrap);
    }

    if (formatted.youtubeId) {
        const ytWrap = document.createElement('div');
        ytWrap.className = 'yt-embed-wrapper';
        ytWrap.innerHTML = `
            <iframe
                src="https://www.youtube.com/embed/${formatted.youtubeId}"
                style="border:0;"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerpolicy="strict-origin-when-cross-origin"
                allowfullscreen>
            </iframe>
        `;
        msgContent.appendChild(ytWrap);
    }

    if (formatted.tiktokId) {
        const ttWrap = document.createElement('div');
        ttWrap.className = 'tt-embed-wrapper';
        ttWrap.innerHTML = `<iframe src="https://www.tiktok.com/embed/v2/${formatted.tiktokId}?lang=en-US"  style="border:0; width:100%; height:580px; border-radius:12px; background:#000;"  allow="encrypted-media;" allowfullscreen> </iframe>`;
        msgContent.appendChild(ttWrap);
    } else if (formatted.tiktokShort) {
        const ttWrap = document.createElement('div');
        ttWrap.className = 'tt-embed-wrapper';
        ttWrap.style.cssText = 'padding: 12px; background: rgba(255,255,255,0.04); border-radius: 12px; font-size: 11.5px; opacity: 0.7; margin-top: 10px; border: 1px solid var(--glass-border); text-align: center;';
        ttWrap.innerText = '📱 TikTok mobile links cannot be embedded directly. Click the link above to watch.';
        msgContent.appendChild(ttWrap);
    }

    if (formatted.instagramId) {
        const igWrap = document.createElement('div');
        igWrap.className = 'ig-embed-wrapper';
        igWrap.innerHTML = `
            <iframe src="https://www.instagram.com/p/${formatted.instagramId}/embed" 
                    style="border:0; width:100%; height:540px; border-radius:12px; background:#fff;" 
                    allowfullscreen>
            </iframe>
        `;
        msgContent.appendChild(igWrap);
    }
    
    formatted.joinChatIds.forEach(id => {
        renderJoinCard(id, msgContent);
    });
    
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'msg-actions';
    
    const actionButton = document.createElement('button');
    actionButton.className = 'msg-action-btn';
    actionButton.innerHTML = '&#x25BC;'; 
    
    const actionMenu = document.createElement('div');
    actionMenu.className = 'msg-action-menu';
    actionMenu.style.display = 'none';
    
    const closeActionMenu = () => {
        actionMenu.style.display = 'none';
        actionMenu.style.transform = '';
        actionMenu.style.top = '';
        actionMenu.style.bottom = '';
        wrap.style.zIndex = '';
        wrap.style.position = '';
        bubble.style.zIndex = '';
        bubble.style.position = '';
    };

    const replyBtn = document.createElement('button');
    replyBtn.innerText = 'Reply';
    replyBtn.className = 'glass-btn-secondary';
    replyBtn.onclick = (e) => {
        e.stopPropagation();
        replyToMessage(messageId, msg.text, msg.sender_name);
        closeActionMenu();
    };
    actionMenu.appendChild(replyBtn);

    const pinBtn = createPinActionMenuButton(messageId, closeActionMenu);
    if (pinBtn) actionMenu.appendChild(pinBtn);
    
    if (isMe) {
        const editBtn = document.createElement('button');
        editBtn.innerText = 'Edit';
        editBtn.className = 'glass-btn-secondary';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            editMessage(messageId, msg.text);
            closeActionMenu();
        };
        actionMenu.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.innerText = 'Delete';
        deleteBtn.className = 'glass-btn-secondary delete-btn';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteMessage(messageId);
            closeActionMenu();
        };
        actionMenu.appendChild(deleteBtn);
    }
    
    actionsContainer.appendChild(actionButton);
    actionsContainer.appendChild(actionMenu);
    
    const toggleMenu = (e) => {
        if (e) e.stopPropagation();
        const isOpening = actionMenu.style.display === 'none' || !actionMenu.style.display;
        resetMessageActionMenus();
        if (isOpening) {
            positionActionMenu(actionMenu, bubble, wrap, e);
        } else {
            closeActionMenu();
        }
    };

    actionButton.onclick = toggleMenu;

    // Mobile-Only Tap Trigger: hide dropdown triangle and bind menu toggle to message bubble
    const isMobile = window.Capacitor?.isNative || /Mobi|Android/i.test(navigator.userAgent);
    if (isMobile) {
        actionButton.style.display = 'none';
        bubble.onclick = (e) => {
            if (e.target.closest('a, button, .chat-embedded-image, .image-embed-wrapper, .reply-quote, .reaction-tag')) return;
            toggleMenu(e);
        };
    }
    
    bubble.appendChild(actionsContainer);
    attachMessageContextMenu(bubble, messageId, msg, isMe);
    
    let avatarHtml;
    if (isSystem) {
        avatarHtml = `<div class="msg-avatar-fallback system-avatar" style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; display: flex; align-items: center; justify-content: center; border-radius: 50%; width: 28px; height: 28px; font-size: 15px;">🛡️</div>`;
    } else {
        const senderUid = msg.sender_id || msg.sender;
        const pfp = currentChatMemberPics.get(senderUid);
        avatarHtml = pfp 
            ? `<img src="${pfp}" loading="lazy" decoding="async" class="msg-avatar-img" onclick="event.stopPropagation(); showUserProfile('${senderUid}', currentChatId, currentChatCreatorId)">`
            : `<div class="msg-avatar-fallback">\u{1F464}</div>`;
    }

    const author = createAuthorElement(msg, () => showUserProfile(msg.sender_id || msg.sender, currentChatId, currentChatCreatorId));
    
    const timestampElem = document.createElement('span');
    timestampElem.className = 'msg-timestamp';
    const timeStr = formatSmartTimestamp(msg.timestamp);
    
    let viewCounterHtml = "";
    const isDM = !(currentChatData?.isGroup || currentChatData?.isChannel || currentChatId === 'channel_orion_updates');
    const viewCount = msg.viewedBy ? Object.keys(msg.viewedBy).length : (msg.views || 0);

    if (viewCount > 0) {
        if (isDM) {
            viewCounterHtml = `<span class="msg-views" title="Seen">\u{1F441}\u{FE0F}</span>`;
        } else {
            viewCounterHtml = `<span class="msg-views" title="${viewCount} views">\u{1F441}\u{FE0F} ${viewCount}</span>`;
        }
    }
    
    timestampElem.innerHTML = `${msg.edited_at ? "Edited \u{2022} " : ""}${viewCounterHtml} ${timeStr}`;
    
    if (!isConsecutive || !isMe) { 
        const header = document.createElement('div');
        header.className = 'msg-header';
        header.innerHTML = avatarHtml;
        header.appendChild(author);
        wrap.appendChild(header);
    }

    wrap.appendChild(bubble);
    wrap.appendChild(timestampElem);
    twemoji.parse(wrap);
    if (isNew) insertMessageIntoDOM(wrap, msg.timestamp);
}

async function renderPollMessage(msg, isConsecutive, messageId, isMe, isUserMentioned) {
    const cont = document.getElementById('messages-container');
    let wrap = document.getElementById(`msg-${messageId}`);
    const isNew = !wrap;
    if (isNew) {
        wrap = document.createElement('div');
        wrap.id = `msg-${messageId}`;
        wrap.dataset.senderId = msg.sender_id;
        wrap.dataset.timestamp = msg.timestamp; // Store timestamp for sorting
    } else {
        wrap.innerHTML = '';
    }

    wrap.className = (isMe ? 'msg-wrapper sent' : 'msg-wrapper rcv') + ' poll-msg';
    if (isConsecutive) wrap.classList.add('consecutive');
    if (isUserMentioned) wrap.classList.add('user-mentioned');

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble poll-bubble';
    bubble.dataset.messageId = messageId;
    bubble.dataset.senderName = msg.sender_name || (isMe ? (auth.currentUser?.displayName || 'You') : 'User');
    bubble._replyData = {
        messageId,
        text: msg.poll?.question ? `[Poll: ${msg.poll.question}]` : '[Poll]',
        senderName: msg.sender_name || (isMe ? (auth.currentUser?.displayName || 'You') : 'User')
    };

    const question = document.createElement('span');
    question.className = 'poll-question';
    question.innerText = msg.poll.question;
    bubble.appendChild(question);

    const totalVotes = Object.values(msg.poll.options).reduce((sum, opt) => {
        return sum + (opt.votes ? Object.keys(opt.votes).length : 0);
    }, 0);

    msg.poll.options.forEach((opt, idx) => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'poll-option';
        
        const voteCount = opt.votes ? Object.keys(opt.votes).length : 0;
        const percent = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
        const hasVoted = opt.votes && opt.votes[auth.currentUser.uid];

        optionDiv.innerHTML = `
            <div class="poll-option-progress" style="width: ${percent}%"></div>
            <div class="poll-option-text">
                <span>${hasVoted ? '\u{2713} ' : ''}${escapeHTML(opt.text)}</span>
                <strong>${percent}%</strong>
            </div>
        `;

        optionDiv.onclick = (e) => {
            e.stopPropagation();
            togglePollVote(messageId, idx);
        };
        bubble.appendChild(optionDiv);
    });
    
    // Add a "View Results" button
    const viewResultsBtn = document.createElement('button');
    viewResultsBtn.className = 'poll-results-btn';
    viewResultsBtn.innerText = 'View Results';
    viewResultsBtn.onclick = (e) => {
        e.stopPropagation();
        openPollResultsModal(messageId, msg.poll);
    };
    bubble.appendChild(viewResultsBtn);
    attachMessageContextMenu(bubble, messageId, msg, isMe);

    const author = createAuthorElement(msg, () => showUserProfile(msg.sender_id, currentChatId, currentChatCreatorId));
    
    const timestampElem = document.createElement('span');
    timestampElem.className = 'msg-timestamp';
    timestampElem.innerText = formatSmartTimestamp(msg.timestamp);

    if (!isConsecutive || !isMe) wrap.appendChild(author);
    wrap.appendChild(bubble);
    wrap.appendChild(timestampElem);
    
    if (isNew) insertMessageIntoDOM(wrap, msg.timestamp);
    twemoji.parse(wrap);
}

async function openPollResultsModal(messageId, pollData) {
    const modal = document.getElementById('poll-results-modal');
    const questionElem = document.getElementById('poll-results-question');
    const optionsContainer = document.getElementById('poll-results-options-container');

    if (!modal || !questionElem || !optionsContainer) {
        console.error("Poll results modal elements not found.");
        return;
    }

    questionElem.innerText = pollData.question;
    optionsContainer.innerHTML = ''; // Clear previous results

    const allVoterUids = new Set();
    pollData.options.forEach(opt => {
        if (opt.votes) {
            Object.keys(opt.votes).forEach(uid => allVoterUids.add(uid));
        }
    });

    // Fetch all voter names in parallel
    const voterNamesMap = new Map();
    await Promise.all(Array.from(allVoterUids).map(async (uid) => {
        if (currentChatMemberNames.has(uid)) {
            voterNamesMap.set(uid, currentChatMemberNames.get(uid));
        } else {
            const uSnap = await get(ref(db, `users/${uid}`));
            const uData = uSnap.val();
            const name = getDisplayName(uData);
            voterNamesMap.set(uid, name);
            currentChatMemberNames.set(uid, name); // Cache for future use
        }
    }));

    pollData.options.forEach((opt, idx) => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'poll-result-option';
        optionDiv.innerHTML = `<strong>${escapeHTML(opt.text)}</strong>`;

        const votersList = document.createElement('ul');
        if (opt.votes) {
            Object.keys(opt.votes).forEach(uid => {
                const li = document.createElement('li');
                li.innerText = voterNamesMap.get(uid) || "Unknown User";
                votersList.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.innerText = "No votes yet.";
            votersList.appendChild(li);
        }
        optionDiv.appendChild(votersList);
        optionsContainer.appendChild(optionDiv);
    });

    modal.style.display = 'flex';
}

document.getElementById('close-poll-results-modal').onclick = () => {
    closeAnimatedModal(document.getElementById('poll-results-modal'));
};

async function togglePollVote(messageId, optionIndex) {
    if (!currentChatId || !auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    const optionsRef = ref(db, `messages/${currentChatId}/${messageId}/poll/options`);
    
    const snap = await get(optionsRef);
    const options = snap.val();
    if (!options) return;

    const updates = {};
    options.forEach((opt, idx) => {
        if (idx === optionIndex) {
            // Toggle vote on selected option
            const currentlyVoted = opt.votes && opt.votes[myUid];
            updates[`${idx}/votes/${myUid}`] = currentlyVoted ? null : true;
        } else {
            // Remove vote from other options (single choice)
            updates[`${idx}/votes/${myUid}`] = null;
        }
    });
    await update(optionsRef, updates);
}

async function renderStickerMessage(msg, isConsecutive, messageId, isMe, isUserMentioned) {
    const cont = document.getElementById('messages-container');
    let wrap = document.getElementById(`msg-${messageId}`);
    const isNew = !wrap;

    if (isNew) {
        wrap = document.createElement('div');
        wrap.id = `msg-${messageId}`;
        wrap.dataset.senderId = msg.sender_id;
        wrap.dataset.timestamp = msg.timestamp; // Store timestamp for sorting
    } else {
        wrap.innerHTML = ''; // Clear for update
    }

    wrap.className = (isMe ? 'msg-wrapper sent' : 'msg-wrapper rcv') + ' sticker-msg';
    if (isConsecutive) wrap.classList.add('consecutive');
    if (isUserMentioned) wrap.classList.add('user-mentioned');

    // Reactions Bar (Emoji hover menu)
    const reactionsBar = document.createElement('div');
    reactionsBar.className = 'msg-reactions-bar';
    const defaultReactions = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F62E}", "\u{1F622}"];
    
    defaultReactions.forEach(emoji => {
        const span = document.createElement('span');
        span.className = 'reaction-emoji';
        span.innerText = emoji;
        span.onclick = (e) => {
            e.stopPropagation();
            toggleReaction(messageId, emoji);
        };
        reactionsBar.appendChild(span);
    });

    const expandBtn = document.createElement('button');
    expandBtn.className = 'expand-reactions-btn';
    expandBtn.innerHTML = '&#x203A;';
    expandBtn.onclick = async (e) => {
        e.stopPropagation();
        const picker = document.getElementById('emoji-picker');
        const isSameMessage = activeReactionMessageId === messageId;
        activeReactionMessageId = isSameMessage && picker.style.display === 'grid' ? null : messageId;
        if (picker.style.display === 'none' || !isSameMessage) {
            const pm = document.getElementById('plus-menu');
            if (pm) { pm.style.display = 'none'; pm.classList.add('hidden'); }
            await renderEmojiPicker();
            picker.style.display = 'grid';
        } else {
            picker.style.display = 'none';
        }
    };
    reactionsBar.appendChild(expandBtn);
    wrap.appendChild(reactionsBar);

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble sticker-bubble';
    bubble.dataset.messageId = messageId;
    bubble.dataset.senderName = msg.sender_name || (isMe ? (auth.currentUser?.displayName || 'You') : 'User');
    bubble._replyData = {
        messageId,
        text: '[Sticker]',
        senderName: msg.sender_name || (isMe ? (auth.currentUser?.displayName || 'You') : 'User')
    };

    const stickerMetaSnap = await get(ref(db, `sticker_metadata/${msg.stickerId}`));
    const stickerMeta = stickerMetaSnap.val();

    if (stickerMeta) {
        const stickerUrl = stickerMeta.storagePath;
        const stickerImg = document.createElement('img');
        stickerImg.src = stickerUrl;
        stickerImg.alt = getStickerDisplayName(stickerMeta);
        stickerImg.className = 'chat-sticker sticker-img';
        stickerImg.loading = 'lazy';
        stickerImg.decoding = 'async';
        stickerImg.onload = () => {
            const isNearBottom = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 120;
            if (isNearBottom) cont.scrollTop = cont.scrollHeight;
        };
        stickerImg.onclick = (e) => {
            e.stopPropagation();
            openStickerPackPreview(msg.stickerId);
        };
        bubble.appendChild(stickerImg);
    } else {
        bubble.innerText = "[Sticker not found]";
    }

    // Action Menu (Reply/Delete)
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'msg-actions';
    const actionButton = document.createElement('button');
    actionButton.className = 'msg-action-btn';
    actionButton.innerHTML = '&#x25BC;'; 
    
    const actionMenu = document.createElement('div');
    actionMenu.className = 'msg-action-menu';
    actionMenu.style.display = 'none';
    
    const closeStickerActionMenu = () => {
        actionMenu.style.display = 'none';
        actionMenu.style.transform = '';
        actionMenu.style.top = '';
        actionMenu.style.bottom = '';
        wrap.style.zIndex = '';
        wrap.style.position = '';
        bubble.style.zIndex = '';
        bubble.style.position = '';
    };

    const replyBtn = document.createElement('button');
    replyBtn.innerText = 'Reply';
    replyBtn.className = 'glass-btn-secondary';
    replyBtn.onclick = (e) => {
        e.stopPropagation();
        replyToMessage(messageId, "[Sticker]", msg.sender_name);
        closeStickerActionMenu();
    };
    actionMenu.appendChild(replyBtn);

    const stickerPinBtn = createPinActionMenuButton(messageId, closeStickerActionMenu);
    if (stickerPinBtn) actionMenu.appendChild(stickerPinBtn);
    
    if (isMe) {
        const deleteBtn = document.createElement('button');
        deleteBtn.innerText = 'Delete';
        deleteBtn.className = 'glass-btn-secondary delete-btn';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteMessage(messageId);
            closeStickerActionMenu();
        };
        actionMenu.appendChild(deleteBtn);
    }
    
    actionsContainer.appendChild(actionButton);
    actionsContainer.appendChild(actionMenu);

    const toggleStickerMenu = (e) => {
        if (e) e.stopPropagation();
        const isOpening = actionMenu.style.display === 'none' || !actionMenu.style.display;
        resetMessageActionMenus();
        if (isOpening) {
            positionActionMenu(actionMenu, bubble, wrap, e);
        } else {
            closeStickerActionMenu();
        }
    };
    actionButton.onclick = toggleStickerMenu;

    const isMobileSticker = window.Capacitor?.isNative || /Mobi|Android/i.test(navigator.userAgent);
    if (isMobileSticker) {
        actionButton.style.display = 'none';
        bubble.onclick = (e) => {
            if (e.target.closest('a, button, .chat-sticker, .reaction-tag')) return;
            toggleStickerMenu(e);
        };
    }
    bubble.appendChild(actionsContainer);
    attachMessageContextMenu(bubble, messageId, msg, isMe);

    const pfp = currentChatMemberPics.get(msg.sender_id);
    const avatarHtml = pfp 
        ? `<img src="${pfp}" loading="lazy" decoding="async" class="msg-avatar-img" onclick="event.stopPropagation(); showUserProfile('${msg.sender_id}', currentChatId, currentChatCreatorId)">`
        : `<div class="msg-avatar-fallback">\u{1F464}</div>`;

    const author = createAuthorElement(msg, () => showUserProfile(msg.sender_id, currentChatId, currentChatCreatorId));
    
    const timestampElem = document.createElement('span');
    timestampElem.className = 'msg-timestamp';
    const timeStr = formatSmartTimestamp(msg.timestamp);
    timestampElem.innerText = timeStr;

    if (!isConsecutive || !isMe) {
        const header = document.createElement('div');
        header.className = 'msg-header';
        header.innerHTML = avatarHtml;
        header.appendChild(author);
        wrap.appendChild(header);
    }

    wrap.appendChild(bubble);
    wrap.appendChild(timestampElem);
    twemoji.parse(wrap);
    if (isNew) insertMessageIntoDOM(wrap, msg.timestamp);
}

function createTypingIndicator() {
    const el = document.createElement('div');
    el.id = 'typing-indicator';
    document.querySelector('.glass-main').appendChild(el);
    return el;
}

function updateGroupMuteUI(groupData, chatData = currentChatData) {
    if (!auth.currentUser) return;
    const isGroup = chatData?.isGroup === true || chatData?.type === 'group' || !!chatData?.groupId;

    const inputWrapper = document.getElementById('message-input-wrapper') || document.querySelector('.input-wrapper');
    const legacyBanner = document.getElementById('group-muted-banner');
    if (legacyBanner) legacyBanner.style.display = 'none';

    let muteData = isGroup && groupData && groupData.mutedUsers && groupData.mutedUsers[auth.currentUser.uid];
    if (muteData === true) {
        muteData = { mutedUntil: 4102444800000, reason: "Muted by a moderator" };
    }

    if (muteData && typeof muteData === 'object' && muteData.mutedUntil > Date.now()) {
        // User is currently muted
        const dateStr = new Date(muteData.mutedUntil).toLocaleString();
        const timeStr = muteData.mutedUntil > 4000000000000 ? "Permanently" : `until ${dateStr}`;

        // Hide chat input and show banner
        if (inputWrapper) inputWrapper.style.display = 'none';
        
        let banner = document.getElementById('mute-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'mute-banner';
            banner.style.cssText = 'padding:12px;background:rgba(255,71,87,0.15);color:#ff4757;text-align:center;border-top:1px solid rgba(255,71,87,0.3);font-size:13px;line-height:1.5;';
            const chatContainer = document.getElementById('chat-container') || document.querySelector('.chat-container') || document.querySelector('.glass-main');
            if (chatContainer) chatContainer.appendChild(banner);
        }
        banner.innerHTML = `🚫 You are muted <strong>${timeStr}</strong><br><span style="opacity:0.8">Reason: ${muteData.reason || "No reason provided"}</span>`;

        const typingInd = document.getElementById('typing-indicator');
        if (typingInd) typingInd.style.display = 'none';
    } else {
        // User is not muted (or mute expired)
        if (inputWrapper) inputWrapper.style.display = 'flex';
        const banner = document.getElementById('mute-banner');
        if (banner) banner.remove();
        checkMuteStatus();
    }
}
window.updateGroupMuteUI = updateGroupMuteUI;

function checkMuteStatus() {
    const myUid = auth.currentUser.uid;
    const myData = currentChatMemberData?.[myUid];
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const typingInd = document.getElementById('typing-indicator');
    const banner = document.getElementById('group-muted-banner');
    const muteBanner = document.getElementById('mute-banner');

    if ((banner && banner.style.display === 'block') || muteBanner) {
        if (input) {
            input.disabled = true;
            input.style.display = 'none';
        }
        if (sendBtn) sendBtn.style.display = 'none';
        if (typingInd) typingInd.style.display = 'none';
        return;
    }

    const chatRef = ref(db, `chats/${currentChatId}`);

    // Get chat type to check for Channel read-only mode
    get(chatRef).then(snap => {
        const chatData = snap.val();
        const isChannel = chatData?.isChannel === true;
        const isAdmin = myData?.role === 'admin' || myData?.role === 'system' || auth.currentUser.uid === chatData?.creatorId;

        if (currentChatId === 'channel_orion_updates') {
            if (!isAdmin) {
                input.disabled = true;
                sendBtn.disabled = true;
                input.placeholder = "Only system and administrators can post here";
                if (typingInd) typingInd.style.display = 'none';
                return;
            }
        }

        if (isChannel && !isAdmin) {
            input.disabled = true;
            sendBtn.disabled = true;
            input.placeholder = "Only admins can post in this channel";
            if (typingInd) typingInd.style.display = 'none';
        } else if (myData && myData.mutedUntil && myData.mutedUntil > Date.now()) {
        const remaining = Math.ceil((myData.mutedUntil - Date.now()) / 60000);
        input.disabled = true;
        sendBtn.disabled = true;
        input.placeholder = `Oops you're muted for ${remaining}m`;
        if (typingInd) typingInd.style.display = 'none';
    } else {
        input.disabled = false;
        sendBtn.disabled = false;
        input.placeholder = "Type a message...";
    }
    });
}

let isCurrentlyTyping = false;
function updateTypingStatus(isTyping) {
    if (!currentChatId || !auth.currentUser) return;
    if (isTyping === isCurrentlyTyping) return; // Prevent redundant network calls

    isCurrentlyTyping = isTyping;
    const typingRef = ref(db, `typing/${currentChatId}/${auth.currentUser.uid}`);
    if (isTyping) {
        set(typingRef, true).catch(() => { isCurrentlyTyping = false; });
    } else {
        remove(typingRef).catch(() => { isCurrentlyTyping = true; });
    }
}

async function toggleAdminRole(targetUid, currentRole) {
    if (!currentChatId) return;
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    await update(ref(db, `members/${currentChatId}/${targetUid}`), { role: newRole });
}

function openMuteModal(targetUid, targetName) {
    console.log("Attempting to open mute modal for:", targetName, "(UID:", targetUid, ")");
    currentMuteTarget = targetUid;
    currentMuteTargetName = targetName;
    const muteUserNameElem = document.getElementById('mute-user-name');
    const muteModalElem = document.getElementById('mute-modal');

    if (!muteUserNameElem) {
        console.error("Error: Element with ID 'mute-user-name' not found in the DOM.");
        return;
    }
    if (!muteModalElem) {
        console.error("Error: Element with ID 'mute-modal' not found in the DOM.");
        return;
    }
    muteUserNameElem.innerText = targetName;
    muteModalElem.style.display = 'flex';
    console.log("Mute modal display set to flex.");

    // Reset chips to default (1h)
    document.querySelectorAll('.duration-chip').forEach(c => {
        c.classList.remove('active');
        if (c.dataset.value === "60") c.classList.add('active');
    });
    const hiddenInput = document.getElementById('mute-duration');
    if (hiddenInput) hiddenInput.value = "60";
}

// Initialize chip selection listeners
document.querySelectorAll('.duration-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        document.querySelectorAll('.duration-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const hiddenInput = document.getElementById('mute-duration');
        if (hiddenInput) hiddenInput.value = chip.dataset.value;
    });
});

const confirmMuteBtn = document.getElementById('confirm-mute-btn');
if (confirmMuteBtn) {
    confirmMuteBtn.onclick = async () => {
        const durationElem = document.getElementById('mute-duration');
        const reasonElem = document.getElementById('mute-reason');
        
        const duration = durationElem ? parseInt(durationElem.value) : 0;
        const reason = (reasonElem ? reasonElem.value.trim() : "") || "No reason provided";
        
        if (!currentChatId || !currentMuteTarget) return;

        const success = await applyMute(currentChatId, currentMuteTarget, duration, reason, currentChatMemberData);
        if (success) {
            closeAnimatedModal(document.getElementById('mute-modal'));
            currentMuteTarget = null;
            currentMuteTargetName = null;
        }
    };
}

const cancelMuteBtn = document.getElementById('cancel-mute-btn');
if (cancelMuteBtn) {
    cancelMuteBtn.onclick = () => {
        closeAnimatedModal(document.getElementById('mute-modal'));
    };
}

async function deleteGroup(chatId) { // This function now deletes an entire logical group
    // Swapping Yes and No options: Making "No" the primary (returns true) and "Yes" the secondary (returns false)
    // This ensures the highlighted button is the safe "Keep" option.
    const stopAction = await showConfirm("Delete Group", "PERMANENTLY DELETE GROUP? This will remove all messages and history for everyone.", false, "", "No, Keep it", "Yes, Delete");
    if (stopAction) return;
    
    const updates = {};
    let chatIdsToDelete = [chatId]; // Start with the current chat

    const chatSnap = await get(ref(db, `chats/${chatId}`));
    const chatData = chatSnap.val();

    if (!chatData) {
        showNotification("Chat not found.", "error");
        return;
    }

    // If it's part of a larger group, find all channels in that group
    if (chatData.groupId) {
        const allChatsSnap = await get(query(ref(db, 'chats'), orderByChild('groupId'), equalTo(chatData.groupId)));
        chatIdsToDelete = []; // Reset to include all channels in the group
        allChatsSnap.forEach(childSnap => {
            chatIdsToDelete.push(childSnap.key);
        });
        // Also delete the group entry itself from the /groups node
        updates[`/groups/${chatData.groupId}`] = null;
    }

    for (const idToDelete of chatIdsToDelete) {
        const membersSnap = await get(ref(db, `members/${idToDelete}`));
        const members = membersSnap.val() || {};

        updates[`/chats/${idToDelete}`] = null;
        updates[`/messages/${idToDelete}`] = null;
        updates[`/members/${idToDelete}`] = null;
        updates[`/typing/${idToDelete}`] = null;

        Object.keys(members).forEach(uid => {
            updates[`/user_chats/${uid}/${idToDelete}`] = null;
            updates[`/unread/${uid}/${idToDelete}`] = null;
        });
    }

    try {
        await update(ref(db), updates);
        exitChat();
        closeAnimatedModal(document.getElementById('edit-group-modal'));
        showNotification("Group and all its channels deleted successfully.", "success");
    } catch (err) {
        console.error("Error deleting group:", err);
        showNotification("Failed to delete group.", "error");
    }
}

async function deletePrivateChat(chatId) {
    const confirmed = await showConfirm("Delete Chat", "This will permanently delete the entire conversation and all messages for BOTH users. This cannot be undone.");
    if (!confirmed) return;

    try {
        // Private chat IDs in this app are composed of two UIDs separated by an underscore
        const uids = chatId.split('_');
        if (uids.length !== 2) {
            showNotification("Invalid private chat ID.", "error");
            return;
        }

        const updates = {};
        updates[`/chats/${chatId}`] = null;
        updates[`/messages/${chatId}`] = null;
        updates[`/members/${chatId}`] = null;
        updates[`/typing/${chatId}`] = null;

        // Remove references for both users involved
        uids.forEach(uid => {
            updates[`/user_chats/${uid}/${chatId}`] = null;
            updates[`/unread/${uid}/${chatId}`] = null;
        });

        await update(ref(db), updates);
        exitChat();
        showNotification("Conversation deleted successfully.", "success");
    } catch (err) {
        console.error("Delete private chat error:", err);
        showNotification("Failed to delete conversation.", "error");
    }
}

// --- Image Lightbox / Fullscreen Viewer ---
function openImageLightbox(url, senderName = 'Photo') {
    const modal = document.getElementById('image-viewer-modal');
    const modalImg = document.getElementById('viewer-main-img');
    const senderNameEl = document.getElementById('viewer-sender-name');
    if (modal && modalImg && senderNameEl) {
        modalImg.src = url;
        senderNameEl.textContent = senderName || 'Photo';
        window.currentViewingImage = url;
        modal.classList.remove('hidden');
        return;
    }
    const lb = document.getElementById('image-lightbox');
    const img = document.getElementById('lightbox-img');
    if (!lb || !img) return;
    img.referrerPolicy = 'no-referrer';
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.src = url;
    lb.style.display = 'flex';
}
window.openImageLightbox = openImageLightbox;

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbycV8hAMQKvXxg9XKSlYFEPz9c3lEyj5aVxsdKhyrrElnVQLuEOHH2e1-uqCd1mc481ig/exec';

async function uploadMediaToDrive(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
            try {
                const base64String = reader.result.split(',')[1];
                const payload = {
                    filename: `${Date.now()}_${(file.name || 'upload').replace(/\s+/g, '_')}`,
                    mimeType: file.type || 'application/octet-stream',
                    base64: base64String
                };

                const response = await fetch(APPS_SCRIPT_URL, {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });

                const data = await response.json();
                if (data.success) {
                    const fileId = data.id || (data.url ? (data.url.includes('id=') ? data.url.split('id=')[1].split('&')[0] : (data.url.match(/[-\w]{25,}/) ? data.url.match(/[-\w]{25,}/)[0] : data.url)) : '');

                    // Generate a raw, high-res image link that works natively in <img src>, or raw download stream for videos
                    const renderUrl = (file.type && file.type.startsWith('image/')) 
                        ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`
                        : `https://drive.google.com/uc?export=download&id=${fileId}`;
                        
                    resolve(renderUrl);
                } else {
                    reject(data.error);
                }
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = error => reject(error);
    });
}

// Asynchronous helper to convert Blob/File to Data URL without blocking the main thread
function blobToDataUrlAsync(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (reader.result) {
                resolve(reader.result);
            } else {
                reject(new Error("FileReader produced empty result"));
            }
        };
        reader.onerror = (err) => reject(err || new Error("FileReader read failed"));
        reader.readAsDataURL(blob);
    });
}

// Asynchronous sendImageMessage with full trace logging and zero synchronous re-encoding
async function sendImageMessage(imageData, targetChatId = null) {
    const destChatId = targetChatId || currentChatId;
    if (!destChatId) {
        console.warn('[UPLOAD] No active chat ID for image upload.');
        return;
    }

    const isGroupChat = currentChatData?.isGroup === true || currentChatData?.type === 'group' || !!currentChatData?.groupId;
    const currentGroupId = currentChatData?.groupId || destChatId;
    if (isGroupChat && currentGroupId) {
        try {
            const gSnap = await get(ref(db, `groups/${currentGroupId}/mutedUsers/${auth.currentUser?.uid}`));
            if (gSnap.exists()) {
                const mVal = gSnap.val();
                const isCurrentlyMuted = mVal === true || (mVal && typeof mVal === 'object' && mVal.mutedUntil > Date.now());
                if (isCurrentlyMuted) {
                    const reasonStr = (mVal && mVal.reason) ? ` Reason: ${mVal.reason}` : '';
                    showNotification(`You are muted.${reasonStr}`, "error");
                    return;
                }
            }
        } catch (e) {}
    }

    console.log('[UPLOAD] Storage reference created: preparing image payload...');
    // Yield to let UI update and ensure non-blocking execution
    await new Promise(r => setTimeout(r, 0));

    let driveUrl = null;
    let base64Data = null;

    if (imageData instanceof Blob || imageData instanceof File) {
        try {
            console.log(`[UPLOAD] Uploading media to Google Drive backend...`);
            driveUrl = await uploadMediaToDrive(imageData);
        } catch (uploadErr) {
            console.warn('[UPLOAD] Direct Drive upload failed, falling back to local payload:', uploadErr);
        }
    }

    if (!driveUrl) {
        if (imageData instanceof Blob) {
            console.log(`[UPLOAD] Converting compressed blob (${(imageData.size / 1024).toFixed(2)} KB) to data payload...`);
            base64Data = await blobToDataUrlAsync(imageData);
            console.log(`[UPLOAD] Payload converted. Length: ${(base64Data.length / 1024).toFixed(2)} KB.`);
        } else {
            base64Data = imageData;
        }
    }

    // Yield again before database operation to ensure UI remains fluid
    await new Promise(r => setTimeout(r, 0));

    console.log('[UPLOAD] Generating database message key and metadata...');
    const mKey = push(ref(db, `messages/${destChatId}`)).key;
    const senderName = document.getElementById('current-user-name')?.innerText || auth.currentUser?.displayName || "User";
    
    // Resolve identity if in a channel
    let identityName = senderName;
    try {
        const chatSnap = await get(ref(db, `chats/${destChatId}`));
        const chatData = chatSnap.val();
        if (chatData?.isChannel) {
            identityName = chatData.title || senderName;
        }
    } catch (e) {
        console.warn('[UPLOAD] Could not fetch chat title for identity:', e);
    }

    const payloadText = driveUrl ? "" : base64Data;
    const isImage = !driveUrl ? true : (imageData.type ? imageData.type.startsWith('image/') : true);
    const isVideo = !driveUrl ? false : (imageData.type ? imageData.type.startsWith('video/') : false);

    const updates = {};
    updates[`/messages/${destChatId}/${mKey}`] = {
        sender: auth.currentUser.uid,
        sender_id: auth.currentUser.uid,
        sender_name: identityName,
        text: payloadText,
        imageUrl: isImage ? (driveUrl || base64Data) : null,
        videoUrl: isVideo ? driveUrl : null,
        timestamp: Date.now(),
        createdAt: serverTimestamp()
    };

    const lastMsgText = isImage ? "Sent an image" : (isVideo ? "Sent a video" : "Sent a file");
    updates[`/chats/${destChatId}/last_message`] = lastMsgText;
    updates[`/chats/${destChatId}/timestamp`] = serverTimestamp();

    console.log('[UPLOAD] Fetching chat members for unread flags...');
    try {
        const membersSnap = await get(ref(db, `members/${destChatId}`));
        const members = membersSnap.val();
        if (members) {
            Object.keys(members).forEach(uid => { 
                if (uid !== auth.currentUser.uid) updates[`/unread/${uid}/${destChatId}`] = true; 
            });
        }

        console.log('[UPLOAD] Writing message payload to Firebase Realtime Database...');
        await update(ref(db), updates);
        console.log(`[UPLOAD] Database write completed successfully (mKey: ${mKey}).`);

        // Asynchronously dispatch notifications in background without blocking upload completion
        if (members) {
            const recipientUids = Object.keys(members).filter(uid => uid !== auth.currentUser.uid);
            (async () => {
                for (const rUid of recipientUids) {
                    try {
                        let recipientFcmToken = null;
                        const userSnap = await get(ref(db, `users/${rUid}/fcmToken`));
                        recipientFcmToken = userSnap.val();
                        if (recipientFcmToken) {
                            sendPushNotification(recipientFcmToken, identityName, lastMsgText, { chatId: destChatId });
                        }
                    } catch (notifyErr) {
                        console.error("[FCM Worker] Error notifying recipient for image:", rUid, notifyErr);
                    }
                }
            })().catch(err => console.warn('[UPLOAD] Background notification dispatch error:', err));
        }
    } catch (dbErr) {
        console.error('[UPLOAD] Database write error:', dbErr);
        throw dbErr;
    }
}

async function renderMembersList(msnap, groupCreatorId) {
    const mList = document.getElementById('members-list-content');
    mList.innerHTML = '';
    const membersMap = msnap.val();
    if (!membersMap) return;

    let memberUids = Object.keys(membersMap);
    const myUid = auth.currentUser.uid;
    const amICreator = myUid === groupCreatorId;
    const myRole = membersMap[myUid]?.role || currentChatMemberData?.[myUid]?.role || 'member';
    const amIAdmin = myRole === 'admin' || amICreator;
    const amIMod = myRole === 'mod';
    const canModerate = amIAdmin || amIMod;

    const groupId = currentChatData?.groupId || currentChatId;
    let mutedUsers = {};
    if (groupId) {
        try {
            const gSnap = await get(ref(db, `groups/${groupId}`));
            mutedUsers = gSnap.val()?.mutedUsers || {};
        } catch (e) {}
    }

    // Sub-channel creation button logic
    const subChannelBtn = document.getElementById('open-subchannel-modal-btn');
    if (subChannelBtn) {
        const hasGroup = currentChatMemberData?.[myUid]?.role === 'admin' || amICreator;
        // Only show if user is admin/creator AND it's a group chat context
        get(ref(db, `chats/${currentChatId}`)).then(snap => {
            subChannelBtn.style.display = (hasGroup && snap.val()?.groupId) ? 'block' : 'none';
        });
        
        subChannelBtn.onclick = () => {
            document.getElementById('subchannel-modal').style.display = 'flex';
        };
    }

    activeMemberStatusOffs.forEach(offFunc => offFunc());
    activeMemberStatusOffs.clear();
    // Note: We don't clear currentChatMemberNames/Pics here because we want to use them for messages

    // Fetch all member details first
    const memberDetailsPromises = memberUids.map(async (mUid) => {
        const uSnap = await get(ref(db, `users/${mUid}`));
        const uData = uSnap.val() || {};
        const displayName = getDisplayName(uData);
        return { 
            uid: mUid,
            displayName: displayName,
            username: displayName || uData.username || '',
            profilePic: uData?.profilePic,
            isCreator: mUid === groupCreatorId,
            role: membersMap[mUid]?.role || 'member',
            status: uData?.status,
            isOnline: uData?.status === 'online'
        };
    });
    const memberDetails = await Promise.all(memberDetailsPromises);

    // Populate names cache for tooltips
    memberDetails.forEach(m => {
        currentChatMemberNames.set(m.uid, m.displayName);
        currentChatMemberPics.set(m.uid, m.profilePic);
    });

    // Prioritize users currently marked as online, then group creator, then alphabetically
    memberDetails.sort((a, b) => {
        const aOnline = (a.status === 'online' || a.isOnline) ? 1 : 0;
        const bOnline = (b.status === 'online' || b.isOnline) ? 1 : 0;

        // If one is online and the other isn't, online goes first
        if (bOnline !== aOnline) {
            return bOnline - aOnline;
        }
        // If both have the same status, group creator goes first
        if (a.isCreator !== b.isCreator) {
            return a.isCreator ? -1 : 1;
        }
        // If both have the same status, sort alphabetically by username
        return (a.username || a.displayName || '').localeCompare(b.username || b.displayName || '');
    });

    for (const member of memberDetails) {
        const div = document.createElement('div');
        div.className = 'member-item';
        
        // Real-time profile listener for this specific member (status, name, nameplate)
        const userRef = ref(db, `users/${member.uid}`);
        const userOff = onValue(userRef, (uSnap) => {
            const uData = uSnap.val() || {};
            const isAdmin = uData.isAdmin === true || String(uData.isAdmin).toLowerCase() === "true";
            const isPremium = isAdmin || uData.type === "Premium";
            const nameplateClass = (isPremium && uData.nameplate) ? `nameplate-applied ${uData.nameplate}` : '';
            const memberRole = membersMap[member.uid]?.role || member.role || 'member';
            const isCreator = member.uid === groupCreatorId;
            const displayUsername = (getDisplayName(uData) || "Unknown").substring(0, 15);
            const status = uData.status;
            const pfp = uData.profilePic;

            let roleIcon = "";
            if (isCreator || memberRole === 'admin') {
                roleIcon = `<span style="font-size:12px; margin-left:4px;" title="${isCreator ? 'Creator / Admin' : 'Admin'}">👑</span>`;
            } else if (memberRole === 'mod') {
                roleIcon = `<span style="font-size:12px; margin-left:4px;" title="Moderator">🛡️</span>`;
            }

            div.innerHTML = `
                <div class="member-item-content">
                    <div class="member-avatar-container">
                        ${pfp ? `<img src="${pfp}" class="member-avatar-img">` : `<div class="avatar-sm">\u{1F464}</div>`}
                        <span class="status-dot ${status === 'online' ? 'online' : ''}"></span>
                    </div>
                    <div style="flex: 1; min-width: 0; display: flex; align-items: center; overflow: hidden;">
                        <span class="${nameplateClass}" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(displayUsername)}</span>${roleIcon}
                    </div>
                </div>
            `;
            twemoji.parse(div);
            
            // Update cache for tooltips
            currentChatMemberNames.set(member.uid, displayUsername);
            currentChatMemberPics.set(member.uid, pfp);
            currentChatMemberBadges.set(member.uid, memberRole);
            updateMessageAvatarsForUser(member.uid, pfp); // Update avatars in existing messages
            updateMessageBadgesForUser(member.uid, memberRole); // Update badges in existing messages
        });
        activeMemberStatusOffs.set(member.uid, userOff);

        div.onclick = (e) => {
            e.stopPropagation(); // Prevent the global "click outside" listener from closing the panel
            showUserProfile(member.uid, currentChatId, groupCreatorId);
        };
        mList.appendChild(div);
    }
}

// New function to update avatars in existing messages for a specific user
function updateMessageAvatarsForUser(targetUid, newPfp) {
    const messagesContainer = document.getElementById('messages-container');
    if (!messagesContainer) return;

    Array.from(messagesContainer.children).forEach(messageElement => {
        if (messageElement.dataset.senderId === targetUid) {
            const msgHeader = messageElement.querySelector('.msg-header');
            if (msgHeader) { // Only update if the message actually displays an avatar
                const existingAvatar = msgHeader.querySelector('.msg-avatar-img, .msg-avatar-fallback');
                if (existingAvatar) {
                    if (newPfp) {
                        if (existingAvatar.tagName === 'IMG') {
                            existingAvatar.src = newPfp;
                        } else { // Was a fallback, now an image
                            const newImg = document.createElement('img');
                            newImg.src = newPfp;
                            newImg.className = 'msg-avatar-img';
                            newImg.onclick = () => showUserProfile(targetUid, currentChatId, currentChatCreatorId);
                            existingAvatar.replaceWith(newImg);
                        }
                    } else { // No profile pic, use fallback
                        if (existingAvatar.tagName === 'DIV') {
                            existingAvatar.innerText = '\u{1F464}';
                        } else { // Was an image, now a fallback
                            const newFallback = document.createElement('div');
                            newFallback.className = 'msg-avatar-fallback';
                            newFallback.innerText = '\u{1F464}';
                            newFallback.onclick = () => showUserProfile(targetUid, currentChatId, currentChatCreatorId);
                            existingAvatar.replaceWith(newFallback);
                        }
                    }
                }
            }
        }
    });
}

async function sendMessage() {
    // Clear typing status immediately on send
    updateTypingStatus(false);
    if (typingTimeout) {
        clearTimeout(typingTimeout);
        typingTimeout = null;
        updateTypingStatus(false); // Ensure typing status is cleared
    }

    const input = document.getElementById('message-input');

    // Logic guard: Prevent sending if muted
    // This check should ideally be done server-side as well for full security
    const myUid = auth.currentUser.uid;
    const myData = currentChatMemberData?.[myUid];
    if (myData && myData.mutedUntil && myData.mutedUntil > Date.now()) return;

    // Server-level and group mod mute check
    const isGroup = currentChatData?.isGroup === true || currentChatData?.type === 'group' || !!currentChatData?.groupId;
    const groupId = currentChatData?.groupId || currentChatId;
    if (isGroup && groupId) {
        try {
            const gSnap = await get(ref(db, `groups/${groupId}/mutedUsers/${myUid}`));
            if (gSnap.exists()) {
                const mVal = gSnap.val();
                const isCurrentlyMuted = mVal === true || (mVal && typeof mVal === 'object' && mVal.mutedUntil > Date.now());
                if (isCurrentlyMuted) {
                    const reasonStr = (mVal && mVal.reason) ? ` Reason: ${mVal.reason}` : '';
                    showNotification(`You are muted.${reasonStr}`, "error");
                    return;
                }
            }
        } catch (e) {
            console.warn("Mute check error in sendMessage:", e);
        }
    }

    let stickerToSend = null;
    if (currentStickerPickerMessageId) { // If a sticker was selected from the picker
        stickerToSend = currentStickerPickerMessageId;
        currentStickerPickerMessageId = null; // Clear after sending
    }

    const txt = input.value.trim();

    // --- Anti-spam detection ---
    let isSpamDetected = false;
    const repeatedCharRegex = /^(.)\1+$/;
    const isLowEffort = txt.length > 1 && repeatedCharRegex.test(txt);

    let userRecentMessages = recentUserMessages.get(myUid) || [];
    const currentTime = Date.now();

    // Clean up old messages from history
    userRecentMessages = userRecentMessages.filter(msg => currentTime - msg.timestamp < SPAM_IDENTICAL_MESSAGE_TIME_WINDOW_MS);

    let spamMatchCount = 0;
    for (const prevMsg of userRecentMessages) {
        const prevIsLowEffort = prevMsg.text.length > 1 && repeatedCharRegex.test(prevMsg.text);
        // Match if exact same text OR both are repeated character spams (like "pp" followed by "ppp")
        if (prevMsg.text === txt || (isLowEffort && prevIsLowEffort)) {
            spamMatchCount++;
        }
    }

    if (spamMatchCount >= SPAM_THRESHOLD) {
        isSpamDetected = true;
        console.warn(`Spam detected: Repetitive messaging by ${myUid} in chat ${currentChatId}`);
    }

    if (isSpamDetected) {
        const success = await applyMute(currentChatId, myUid, SPAM_MUTE_DURATION_MINUTES, "Spamming", currentChatMemberData);
        if (success) showNotification("Spam detected! You have been muted for 30 minutes.", "error");
        input.value = ''; // Clear input to prevent further spam attempts
        return; // Prevent sending the spam message
    }

    if (!currentChatId || (!txt && !stickerToSend)) return;

    if (currentChatId === 'channel_orion_updates') {
        const isSystemOrAdmin = myData?.role === 'admin' || myData?.role === 'system' || auth.currentUser.uid === currentChatCreatorId;
        if (!isSystemOrAdmin) {
            showNotification("Only system and administrators can post here.", "info");
            return;
        }
    }

    // Check if we are editing an existing message
    if (currentEditingMessage && !stickerToSend) {
        try {
            await update(ref(db, `messages/${currentChatId}/${currentEditingMessage}`), {
                text: txt,
                edited_at: serverTimestamp() 
            });
            exitEditMode();
            return; 
        } catch (err) {
            console.error("Error updating message:", err);
            showNotification("Failed to update message.", "error");
            return;
        }
    }

    const mKey = push(ref(db, `messages/${currentChatId}`)).key;
    const chatSnap = await get(ref(db, `chats/${currentChatId}`));
    const chatData = chatSnap.val();
    const updates = {};

    // Channel Identity: If channel, use chat title as sender name
    const identityName = (chatData?.isChannel) ? chatData.title : document.getElementById('current-user-name').innerText;

    const messageData = {
        sender_id: auth.currentUser.uid,
        sender_name: identityName,
        text: txt,
        createdAt: serverTimestamp(),
        timestamp: serverTimestamp()
    };
    const isDM = !currentChatId || !(chatData?.isGroup || chatData?.isChannel || currentChatData?.isGroup || currentChatData?.isChannel);
    if (!isDM) {
        const myRole = currentChatMemberData?.[auth.currentUser.uid]?.role || 'member';
        const roleInfo = getGroupRoleInfo(myRole);
        if (roleInfo && roleInfo.badge) {
            messageData.sender_role = myRole;
            messageData.sender_badge = roleInfo.badge;
        }
    }

    if (currentReplyMessage) {
        messageData.reply_to = currentReplyMessage;
    }
    if (stickerToSend) {
        messageData.stickerId = stickerToSend;
        messageData.text = "[Sticker]"; // Clear text if sending a sticker
    }

    updates[`/messages/${currentChatId}/${mKey}`] = messageData;

    const formatted = linkifyAndEmbed(txt); // Still process text for last_message if no sticker
    let lastMsg = stickerToSend ? "[Sticker]" : txt;
    if (formatted.imageUrls.length > 0 && !formatted.html) {
        lastMsg = "[Image]";
    } else {
        // Truncate last_message for sidebar to avoid validation issues with long messages
        lastMsg = txt.length > 100 ? txt.substring(0, 97) + "..." : txt;
    }
    updates[`/chats/${currentChatId}/last_message`] = lastMsg;
    updates[`/chats/${currentChatId}/timestamp`] = serverTimestamp();

    const membersSnap = await get(ref(db, `members/${currentChatId}`));
    const members = membersSnap.val();
    if (members) {
        const isEveryoneMentioned = /@everyone\b/i.test(txt);
        Object.keys(members).forEach(uid => { 
            if (uid !== auth.currentUser.uid) {
                updates[`/unread/${uid}/${currentChatId}`] = true;
                const targetName = currentChatMemberNames.get(uid);
                const mentionRegex = targetName ? new RegExp(`@${targetName}\\b`, 'i') : null;
                if (isEveryoneMentioned || (mentionRegex && mentionRegex.test(txt))) {
                    updates[`/mentions/${uid}/${currentChatId}`] = increment(1);
                }
            }
        });
    }
    exitReplyMode();
    document.getElementById('emoji-picker').style.display = 'none';
    closeAnimatedModal(document.getElementById('sticker-picker-modal')); // Close picker after sending

    // Add current message to history AFTER successful send (to avoid adding failed messages)
    userRecentMessages.push({ text: txt, timestamp: currentTime });
    // Keep history length limited
    if (userRecentMessages.length > SPAM_MESSAGE_HISTORY_LENGTH) {
        userRecentMessages.shift(); // Remove the oldest message
        // No need to set recentUserMessages.set(myUid, userRecentMessages) here, as it's already a reference.
    }
    recentUserMessages.set(myUid, userRecentMessages);
    await update(ref(db), updates);

    // Lookup recipient's fcmToken from RTDB and trigger Cloudflare Worker notification
    if (members) {
        const recipientUids = Object.keys(members).filter(uid => uid !== auth.currentUser.uid);
        recipientUids.forEach(async (rUid) => {
            try {
                let recipientFcmToken = null;
                const userSnap = await get(ref(db, `users/${rUid}/fcmToken`));
                recipientFcmToken = userSnap.val();
                if (recipientFcmToken) {
                    sendPushNotification(recipientFcmToken, identityName, lastMsg, { chatId: currentChatId });
                }
            } catch (notifyErr) {
                console.error("[FCM Worker] Error notifying recipient:", rUid, notifyErr);
            }
        });
    }

    input.value = '';
    updateInputButtons();
}

/* ---------------- SEND BUTTON ---------------- */
const sendBtn = document.getElementById('send-btn');
if (sendBtn) sendBtn.onclick = sendMessage;
const stickerBtn = document.getElementById('sticker-btn');
if (stickerBtn) stickerBtn.onclick = openStickerPicker;

setupInputAreaListeners();

function setupInputAreaListeners() {
    const addPollOptionBtn = document.getElementById('add-poll-option-btn');
    const closePollModal = document.getElementById('close-poll-modal');
    const confirmPollBtn = document.getElementById('confirm-poll-btn');
    const pollModal = document.getElementById('poll-modal');
    const pollQuestionInput = document.getElementById('poll-question');
    const pollOptionsContainer = document.getElementById('poll-options-container');

    const selectFlagGame = document.getElementById('select-flag-game');
    if (selectFlagGame) {
        selectFlagGame.onclick = () => {
            closeAnimatedModal(document.getElementById('games-library-modal'));
            setupGameLobby('flags');
        };
    }

    const selectWordleGame = document.getElementById('select-wordle-game');
    if (selectWordleGame) {
        selectWordleGame.onclick = () => {
            closeAnimatedModal(document.getElementById('games-library-modal'));
            setupGameLobby('wordle');
        };
    }

    const selectDoodleGame = document.getElementById('select-doodle-game');
    if (selectDoodleGame) {
        selectDoodleGame.onclick = () => {
            closeAnimatedModal(document.getElementById('games-library-modal'));
            setupGameLobby('doodle');
        };
    }

    const selectSpyGame = document.getElementById('select-spy-game');
    if (selectSpyGame) {
        selectSpyGame.onclick = () => {
            closeAnimatedModal(document.getElementById('games-library-modal'));
            setupGameLobby('spy');
        };
    }

    const cancelGameBtn = document.getElementById('cancel-game-btn');
    if (cancelGameBtn) {
        cancelGameBtn.onclick = async () => {
            if (lobbyGameUnsub) {
                lobbyGameUnsub();
                lobbyGameUnsub = null;
            }
            gameStartedLocally = false;
            closeAnimatedModal(document.getElementById('flag-game-lobby-modal'));
            const targetChatId = activeGameChatId || currentChatId;
            const targetGameId = activeGameId;
            activeGameId = null;
            activeGameChatId = null;
            if (targetChatId && targetGameId && auth.currentUser) {
                const myUid = auth.currentUser.uid;
                const pRef = ref(db, `games/${targetChatId}/${targetGameId}/players/${myUid}`);
                if (activeLobbyPlayerRef) {
                    try { await onDisconnect(activeLobbyPlayerRef).cancel(); } catch (_) {}
                    activeLobbyPlayerRef = null;
                } else {
                    try { await onDisconnect(pRef).cancel(); } catch (_) {}
                }
                await remove(pRef);

                // Track empty lobbies for 5-min closure
                const pSnap = await get(ref(db, `games/${targetChatId}/${targetGameId}/players`));
                if (!pSnap.exists() || Object.keys(pSnap.val()).length === 0) {
                    await update(ref(db, `games/${targetChatId}/${targetGameId}`), { emptySince: serverTimestamp() });
                }
            }
        };
    }

    if (addPollOptionBtn) {
        addPollOptionBtn.onclick = () => {
            if (pollOptionsContainer) {
                const count = pollOptionsContainer.querySelectorAll('input').length;
                if (count >= 10) return; // Limit options
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'poll-option-input';
                input.placeholder = `Option ${count + 1}`;
                input.style.marginTop = '8px';
                pollOptionsContainer.appendChild(input);
            }
        };
    } else {
        console.error("Element with ID 'add-poll-option-btn' not found.");
    }

    if (closePollModal) {
        closePollModal.onclick = () => {
            closeAnimatedModal(document.getElementById('poll-modal'));
        };
    } else {
        console.error("Element with ID 'close-poll-modal' not found.");
    }

    if (confirmPollBtn) {
        confirmPollBtn.onclick = async () => {
            const question = pollQuestionInput ? pollQuestionInput.value.trim() : '';
            const optionInputs = pollOptionsContainer ? pollOptionsContainer.querySelectorAll('.poll-option-input') : [];
            const options = Array.from(optionInputs).map(i => i.value.trim()).filter(v => v !== "");

            if (!question || options.length < 2) {
                showNotification("Please enter a question and at least 2 options.", "info");
                return;
            }

            if (!currentChatId || !auth.currentUser) {
                showNotification("Please select a chat and be logged in to create a poll.", "error");
                return;
            }

            const mKey = push(ref(db, `messages/${currentChatId}`)).key;
            const senderName = document.getElementById('current-user-name').innerText;
            const updates = {};

            updates[`/messages/${currentChatId}/${mKey}`] = {
                sender_id: auth.currentUser.uid,
                sender_name: senderName,
                text: `[Poll] ${question}`,
                timestamp: serverTimestamp(),
                poll: { question: question, options: options.map(t => ({ text: t })) }
            };
            updates[`/chats/${currentChatId}/last_message`] = `\u{1F4CA} Poll: ${question}`;
            updates[`/chats/${currentChatId}/timestamp`] = serverTimestamp();

            await update(ref(db), updates);
            closeAnimatedModal(document.getElementById('poll-modal'));
        };
    } else {
        console.error("Element with ID 'confirm-poll-btn' not found.");
    }
}

// --- Global Event Delegation for Paperclip Menu ---
document.addEventListener('click', (e) => {
    // 1. Toggle the Paperclip Menu
    const plusBtnClick = e.target.closest('#plus-btn');
    const plusMenu = document.getElementById('plus-menu');

    if (plusBtnClick) {
        e.stopPropagation(); // Stop global click from immediately hiding it
        if (plusMenu) {
            const isOpening = plusMenu.style.display === 'none' || plusMenu.classList.contains('hidden');
            if (isOpening) {
                plusMenu.classList.remove('hidden');
                plusMenu.style.display = 'flex';
                const ep = document.getElementById('emoji-picker');
                if (ep) ep.style.display = 'none';
                activeReactionMessageId = null;
            } else {
                plusMenu.style.display = 'none';
                plusMenu.classList.add('hidden');
            }
        }
        return;
    }

    // 2. Handle Menu Options dynamically
    if (e.target.closest('#camera-option-btn')) {
        if (plusMenu) {
            plusMenu.style.display = 'none';
            plusMenu.classList.add('hidden');
        }
        triggerCameraCapture();
        return;
    }
    
    if (e.target.closest('#upload-image-option') || e.target.closest('#upload-file-option')) {
        if (plusMenu) {
            plusMenu.style.display = 'none';
            plusMenu.classList.add('hidden');
        }
        document.getElementById('file-upload-input')?.click();
        return;
    }
    
    if (e.target.closest('#create-poll-option')) {
        if (plusMenu) {
            plusMenu.style.display = 'none';
            plusMenu.classList.add('hidden');
        }
        const pollModal = document.getElementById('poll-modal');
        if (pollModal) {
            pollModal.style.display = 'flex';
            // Reset poll inputs
            const pollQ = document.getElementById('poll-question');
            if (pollQ) pollQ.value = '';
            const pollOpts = document.getElementById('poll-options-container');
            if (pollOpts) {
                pollOpts.innerHTML = '<label>Options</label><input type="text" class="poll-option-input" placeholder="Option 1"><input type="text" class="poll-option-input" placeholder="Option 2">';
            }
        }
        return;
    }
    
    if (e.target.closest('#open-games-option')) {
        if (plusMenu) {
            plusMenu.style.display = 'none';
            plusMenu.classList.add('hidden');
        }
        const gamesModal = document.getElementById('games-library-modal');
        if (gamesModal) gamesModal.style.display = 'flex';
        return;
    }

    if (e.target.closest('#clipboard-paste-option')) {
        if (plusMenu) {
            plusMenu.style.display = 'none';
            plusMenu.classList.add('hidden');
        }
        window.pasteLastCopiedItem();
        return;
    }

    // 3. Close menu when clicking outside
    if (!e.target.closest('#plus-menu')) {
        if (plusMenu && (plusMenu.style.display !== 'none' || !plusMenu.classList.contains('hidden'))) {
            plusMenu.style.display = 'none';
            plusMenu.classList.add('hidden');
        }
    }
});

window.pasteLastCopiedItem = async function() {
    // Close the existing attachment menu if open
    const activeMenu = document.getElementById('plus-menu');
    if (activeMenu) {
        activeMenu.style.display = 'none';
        activeMenu.classList.add('hidden');
    }

    if (!currentChatId || !auth?.currentUser) {
        if (typeof showNotification === 'function') {
            showNotification("Please select a chat first", "info");
        }
        return;
    }

    try {
        // 1. Trigger permission check if supported by the browser/WebView
        if (navigator.permissions && navigator.permissions.query) {
            try {
                await navigator.permissions.query({ name: 'clipboard-read' });
            } catch (_) {}
        }

        // 2. Read clipboard items (triggers the "Allow access to clipboard?" prompt)
        if (navigator.clipboard && navigator.clipboard.read) {
            const clipboardItems = await navigator.clipboard.read();
            if (!clipboardItems || clipboardItems.length === 0) {
                return showNotification("Clipboard is empty", "info");
            }

            // Get the most recent item
            const item = clipboardItems[0];

            // Check for an image first
            const imageType = item.types.find(type => type.startsWith('image/'));
            if (imageType) {
                const blob = await item.getType(imageType);
                const maxSizeMB = 50;
                if (blob.size > maxSizeMB * 1024 * 1024) {
                    return showNotification(`Pasted image is too large! Max ${maxSizeMB}MB.`, "error");
                }

                const ext = (imageType.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
                const file = new File([blob], `pasted_${Date.now()}.${ext}`, { type: imageType });

                // Route into the existing chat media upload function / file input
                if (typeof handleMediaUpload === 'function') {
                    await handleMediaUpload(file, 'Clipboard Paste');
                } else {
                    showNotification("Uploading pasted image...", "info");
                    const driveUrl = await uploadMediaToDrive(file);
                    const msgRef = push(ref(db, `messages/${currentChatId}`));
                    await update(msgRef, {
                        sender: auth.currentUser.uid,
                        sender_id: auth.currentUser.uid,
                        sender_name: document.getElementById('current-user-name')?.innerText || auth.currentUser?.displayName || "User",
                        text: "",
                        imageUrl: driveUrl,
                        videoUrl: null,
                        timestamp: Date.now(),
                        createdAt: serverTimestamp()
                    });
                    showNotification("Sent!", "success");
                }
                return;
            }

            // If no image, check if the user copied plain text
            if (item.types.includes('text/plain')) {
                const textBlob = await item.getType('text/plain');
                const text = await textBlob.text();
                const inputEl = document.getElementById('message-input') || document.querySelector('input[placeholder*="message" i]');
                if (inputEl && text) {
                    inputEl.value = (inputEl.value ? inputEl.value + ' ' : '') + text;
                    if (typeof updateInputButtons === 'function') updateInputButtons();
                    inputEl.focus();
                    return;
                }
            }
        }

        // Fallback to readText() if clipboard.read() is not supported
        if (navigator.clipboard && navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            const inputEl = document.getElementById('message-input') || document.querySelector('input[placeholder*="message" i]');
            if (inputEl && text) {
                inputEl.value = (inputEl.value ? inputEl.value + ' ' : '') + text;
                if (typeof updateInputButtons === 'function') updateInputButtons();
                inputEl.focus();
                return;
            }
        }

        showNotification("Nothing found in clipboard to paste", "info");
    } catch (err) {
        console.error("[Clipboard] Permission denied or read failed:", err);
        showNotification("Clipboard access denied. Please allow clipboard permission in your browser/app settings.", "error");
    }
};

window.uploadPastedChatImage = async function(blob) {
    if (!blob) return;
    if (!currentChatId) {
        if (typeof showNotification === 'function') showNotification("Please select a chat first", "error");
        return;
    }

    const maxSizeMB = 50;
    if (blob.size > maxSizeMB * 1024 * 1024) {
        if (typeof showNotification === 'function') showNotification(`Pasted image is too large! Max size is ${maxSizeMB}MB.`, "error");
        return;
    }

    const ext = (blob.type?.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
    const namedFile = blob instanceof File && blob.name
        ? blob
        : new File([blob], `pasted_${Date.now()}.${ext || 'png'}`, { type: blob.type || 'image/png' });

    console.log('[Clipboard] Uploading pasted image via handleMediaUpload:', namedFile.name, namedFile.size);
    await handleMediaUpload(namedFile, 'Pasted Image');
};
window.handleChatPastedImage = window.uploadPastedChatImage;

const messageInput = document.getElementById('message-input');

messageInput.onkeydown = (e) => {
    if (e.key === 'Escape') {
        exitEditMode();
        exitReplyMode();
        closeMentionDropdown();
    }

    if (isMentionMode) {
        const items = document.querySelectorAll('.mention-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            mentionSelectedIndex = (mentionSelectedIndex + 1) % items.length;
            renderMentionDropdownList();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            mentionSelectedIndex = (mentionSelectedIndex - 1 + items.length) % items.length;
            renderMentionDropdownList();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (items.length > 0) {
                e.preventDefault();
                items[mentionSelectedIndex].click();
            }
        }
    } else if (e.key === 'Enter') {
        sendMessage();
    }
};

function closeMentionDropdown() {
    isMentionMode = false;
    mentionStartIndex = -1;
    document.getElementById('mention-dropdown').style.display = 'none';
}

function renderMentionDropdownList(filter = "") {
    const dropdown = document.getElementById('mention-dropdown');
    let candidates = Array.from(currentChatMemberNames.values());
    if (currentChatCreatorId) { // Check if it's a group chat context
        candidates.unshift("everyone");
    }
    const filtered = candidates.filter(name => name.toLowerCase().includes(filter.toLowerCase()));

    if (filtered.length === 0) {
        closeMentionDropdown();
        return;
    }

    dropdown.innerHTML = '';
    filtered.forEach((name, index) => {
        const div = document.createElement('div');
        div.className = `mention-item ${index === mentionSelectedIndex ? 'active' : ''}`;
        
        let highlightedName = escapeHTML(name);
        if (filter) {
            const regex = new RegExp(`(${filter})`, 'gi');
            highlightedName = highlightedName.replace(regex, '<span class="mention-match">$1</span>');
        }
        
        div.innerHTML = `
            <div class="mention-avatar">\u{1F464}</div>
            <span class="mention-name">${highlightedName}</span>
        `;

        div.onclick = () => {
            const text = messageInput.value;
            const before = text.substring(0, mentionStartIndex);
            const after = text.substring(messageInput.selectionStart);
            messageInput.value = `${before}@${name} ${after}`;
            closeMentionDropdown();
            messageInput.focus();
        };
        dropdown.appendChild(div);
    });
    twemoji.parse(dropdown);

    dropdown.style.display = 'flex';
    // Ensure index doesn't go out of bounds after filtering
    if (mentionSelectedIndex >= filtered.length) mentionSelectedIndex = 0;
}

messageInput.oninput = (e) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart;
    const lastChar = val.charAt(cursor - 1);
    const textBeforeCursor = val.substring(0, cursor);
    
    // Detect @ trigger (at start of line or after a space)
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
    
    if (mentionMatch) {
        isMentionMode = true;
        mentionStartIndex = textBeforeCursor.lastIndexOf('@');
        const query = mentionMatch[1];
        renderMentionDropdownList(query);
    } else {
        closeMentionDropdown();
    }

    // Original typing status logic
    if (val.length > 0) {
        if (!typingTimeout) {
            updateTypingStatus(true);
        }
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            updateTypingStatus(false);
            typingTimeout = null;
        }, 3000);
    } else {
        updateTypingStatus(false);
        clearTimeout(typingTimeout);
        typingTimeout = null;
    }
    updateInputButtons();
};

window.addEventListener('paste', (event) => {
    const cd = event.clipboardData || window.clipboardData;
    if (!cd) return;

    const files = cd.files && cd.files.length ? Array.from(cd.files) : [];
    const itemFiles = cd.items
        ? Array.from(cd.items).filter(i => i.type && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean)
        : [];
    const imageFile = files.find(f => f.type && f.type.startsWith('image/')) || itemFiles[0];

    if (imageFile) {
        event.preventDefault();
        window.uploadPastedChatImage(imageFile);
    }
}, true);

document.addEventListener('beforeinput', (event) => {
    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
        const imageFile = Array.from(event.dataTransfer.files).find(f => f.type && f.type.startsWith('image/'));
        if (imageFile) {
            event.preventDefault();
            window.uploadPastedChatImage(imageFile);
        }
    }
}, true);

// Reusable media file upload handler
async function handleMediaUpload(file, sourceLabel = 'File') {
    if (!file) return;
    if (!currentChatId) {
        showNotification("Please select a chat first", "error");
        return;
    }

    // Protect mobile RAM from massive video files
    const maxSizeMB = 50; 
    if (file.size > maxSizeMB * 1024 * 1024) {
        return showNotification(`File is too large! Please keep videos under ${maxSizeMB}MB.`, "error");
    }

    console.log(`[UPLOAD] ${sourceLabel} selected: ${file.name}, Size: ${(file.size / 1024 / 1024).toFixed(2)} MB`);

    let selectedFile = file;
    if (file.type && file.type.startsWith('image/')) {
        try {
            await new Promise(r => setTimeout(r, 0));
            const quality = isCurrentUserPremium ? 0.9 : 0.8;
            selectedFile = await compressImageAsync(file, 1280, quality);
            console.log(`[UPLOAD] Compressed file for Drive: ${selectedFile.name}`);
        } catch (compErr) {
            console.warn('[UPLOAD] Image compression skipped or failed:', compErr);
            selectedFile = file;
        }
    }

    try {
        showNotification("Uploading to secure cloud...", "info");
        const driveUrl = await uploadMediaToDrive(selectedFile);

        const destChatId = currentChatId;
        const msgRef = push(ref(db, `messages/${destChatId}`));
        const senderName = document.getElementById('current-user-name')?.innerText || auth.currentUser?.displayName || "User";
        let identityName = senderName;
        try {
            const chatSnap = await get(ref(db, `chats/${destChatId}`));
            const chatData = chatSnap.val();
            if (chatData?.isChannel) {
                identityName = chatData.title || senderName;
            }
        } catch (e) {
            console.warn('[UPLOAD] Could not fetch chat title for identity:', e);
        }

        const isImage = selectedFile.type ? selectedFile.type.startsWith('image/') : true;
        const isVideo = selectedFile.type ? selectedFile.type.startsWith('video/') : false;

        await update(msgRef, {
            sender: auth.currentUser.uid,
            sender_id: auth.currentUser.uid,
            sender_name: identityName,
            text: "", // Force empty to prevent the nested "Shared image" text bubble
            imageUrl: isImage ? driveUrl : null,
            videoUrl: isVideo ? driveUrl : null,
            timestamp: Date.now(),
            createdAt: serverTimestamp()
        });

        const lastMsgText = isImage ? "Sent an image" : (isVideo ? "Sent a video" : "Sent a file");
        const chatUpdates = {};
        chatUpdates[`/chats/${destChatId}/last_message`] = lastMsgText;
        chatUpdates[`/chats/${destChatId}/timestamp`] = serverTimestamp();

        try {
            const membersSnap = await get(ref(db, `members/${destChatId}`));
            const members = membersSnap.val();
            if (members) {
                Object.keys(members).forEach(uid => { 
                    if (uid !== auth.currentUser.uid) chatUpdates[`/unread/${uid}/${destChatId}`] = true; 
                });
            }
            await update(ref(db), chatUpdates);

            if (members) {
                const recipientUids = Object.keys(members).filter(uid => uid !== auth.currentUser.uid);
                (async () => {
                    for (const rUid of recipientUids) {
                        try {
                            const userSnap = await get(ref(db, `users/${rUid}/fcmToken`));
                            const recipientFcmToken = userSnap.val();
                            if (recipientFcmToken) {
                                sendPushNotification(recipientFcmToken, identityName, lastMsgText, { chatId: destChatId });
                            }
                        } catch (notifyErr) {
                            console.error("[FCM Worker] Error notifying recipient for media:", rUid, notifyErr);
                        }
                    }
                })().catch(err => console.warn('[UPLOAD] Background notification dispatch error:', err));
            }
        } catch (dbErr) {
            console.warn('[UPLOAD] Failed to update chat metadata/unread:', dbErr);
        }

        showNotification("Sent!", "success");
    } catch (error) {
        console.error("Upload failed:", error);
        showNotification("Media upload failed", "error");
    }
}

const fileUploadInput = document.getElementById('file-upload-input');
if (fileUploadInput) {
    fileUploadInput.onchange = async (e) => {
        const selectedFile = e.target.files[0];
        if (!selectedFile) return;

        // Protect mobile RAM from massive video files
        const maxSizeMB = 50; 
        if (selectedFile.size > maxSizeMB * 1024 * 1024) {
            e.target.value = ''; // Reset the input
            return showNotification(`File is too large! Please keep videos under ${maxSizeMB}MB.`, "error");
        }

        try {
            await handleMediaUpload(selectedFile, 'File');
        } finally {
            fileUploadInput.value = '';
        }
    };
}

window.openPcCameraModal = async function() {
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (err) {
        console.error("[Camera] Webcam access failed:", err);
        if (typeof showNotification === 'function') {
            showNotification("Could not access webcam. Check browser permissions.", "error");
        }
        return;
    }

    const existing = document.getElementById('pc-camera-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'pc-camera-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10000;padding:20px;backdrop-filter:blur(4px);';
    modal.innerHTML = `
        <div style="background:#1e1e2a;border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:16px;max-width:480px;width:100%;color:#fff;display:flex;flex-direction:column;gap:12px;">
            <video id="pc-camera-video" autoplay playsinline style="width:100%;border-radius:10px;background:#000;max-height:360px;object-fit:cover;"></video>
            <div style="display:flex;gap:10px;">
                <button type="button" id="pc-camera-cancel" style="flex:1;padding:10px;border-radius:8px;border:none;background:rgba(255,255,255,0.1);color:#fff;cursor:pointer;font-weight:600;">Cancel</button>
                <button type="button" id="pc-camera-snap" style="flex:1;padding:10px;border-radius:8px;border:none;background:#4CAF50;color:#fff;cursor:pointer;font-weight:600;">📸 Take Photo</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    if (window.twemoji) twemoji.parse(modal);

    const video = document.getElementById('pc-camera-video');
    video.srcObject = stream;

    const cleanup = () => {
        document.removeEventListener('keydown', onKeyDown);
        stream.getTracks().forEach(track => track.stop());
        modal.remove();
    };

    const onKeyDown = (ev) => {
        if (ev.key === 'Escape') cleanup();
    };
    document.addEventListener('keydown', onKeyDown);
    modal.addEventListener('click', (ev) => {
        if (ev.target === modal) cleanup();
    });

    document.getElementById('pc-camera-cancel').onclick = cleanup;

    const snapBtn = document.getElementById('pc-camera-snap');
    snapBtn.onclick = () => {
        snapBtn.disabled = true;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(async (blob) => {
            cleanup();
            if (!blob) return;
            const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
            await handleMediaUpload(file, 'Camera');
        }, 'image/jpeg', 0.9);
    };
};

function triggerCameraCapture() {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        window.openPcCameraModal();
    } else {
        document.getElementById('camera-input')?.click();
    }
}

const cameraInput = document.getElementById('camera-input');
const cameraBtn = document.getElementById('camera-btn');
if (cameraBtn && cameraInput) {
    cameraBtn.onclick = triggerCameraCapture;
}
if (cameraInput) {
    cameraInput.onchange = async (e) => {
        const selectedFile = e.target.files[0];
        if (!selectedFile) return;

        // Protect mobile RAM from massive video files
        const maxSizeMB = 50; 
        if (selectedFile.size > maxSizeMB * 1024 * 1024) {
            e.target.value = ''; // Reset the input
            return showNotification(`File is too large! Please keep videos under ${maxSizeMB}MB.`, "error");
        }

        try {
            await handleMediaUpload(selectedFile, 'Camera');
        } finally {
            cameraInput.value = '';
        }
    };
}

function updateInputButtons() {
    const banner = document.getElementById('group-muted-banner');
    const muteBanner = document.getElementById('mute-banner');
    if ((banner && banner.style.display === 'block') || muteBanner) {
        const input = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');
        const plusBtn = document.getElementById('plus-btn');
        const cameraBtn = document.getElementById('camera-btn');
        const emojiBtn = document.getElementById('emoji-btn');
        if (input) {
            input.disabled = true;
            input.style.display = 'none';
        }
        if (sendBtn) sendBtn.style.display = 'none';
        if (plusBtn) plusBtn.style.display = 'none';
        if (cameraBtn) cameraBtn.style.display = 'none';
        if (emojiBtn) emojiBtn.style.display = 'none';
        return;
    }

    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const plusBtn = document.getElementById('plus-btn');
    const cameraBtn = document.getElementById('camera-btn');
    const stickerBtn = document.getElementById('sticker-btn');
    if (!input || !sendBtn) return;

    if (!currentChatId) {
        if (plusBtn) plusBtn.style.display = 'none';
        if (cameraBtn) cameraBtn.style.display = 'none';
        sendBtn.style.display = 'none';
        return;
    }

    const isMobile = window.innerWidth <= 768;
    const hasText = input.value.trim().length > 0;

    if (hasText) {
        sendBtn.style.display = isMobile ? 'flex' : 'none';
        if (isMobile && plusBtn) plusBtn.style.display = 'none';
        if (isMobile && cameraBtn) cameraBtn.style.display = 'none';
        if (stickerBtn) stickerBtn.style.display = 'none';
    } else {
        sendBtn.style.display = 'none';
        if (plusBtn) plusBtn.style.display = 'inline-flex';
        if (cameraBtn) cameraBtn.style.display = 'none';
        if (stickerBtn) stickerBtn.style.display = 'none';
    }
}

window.addEventListener('resize', updateInputButtons);

/* ---------------- GROUP LOGIC ---------------- */

async function populateCreationSelection() {
    const myUid = auth.currentUser.uid;
    const selectionDiv = document.getElementById('modal-users-selection');
    selectionDiv.innerHTML = '';
    document.getElementById('modal-selected-list').innerHTML = '';

    const snap = await get(ref(db, `friends/${myUid}`));
    const friends = snap.val();
    if (!friends) return;

    for (const fUid of Object.keys(friends)) {
        if (selectedGroupMembers.includes(fUid)) continue;

        const uSnap = await get(ref(db, `users/${fUid}`));
        const user = uSnap.val();
        if (!user) continue;

        const item = document.createElement('div');
        item.className = 'selection-item';
        item.innerText = getDisplayName(user);
        item.onclick = () => {
            if (!selectedGroupMembers.includes(fUid)) {
                selectedGroupMembers.push(fUid);
                renderSelectedTags();
                populateCreationSelection();
            }
        };
        selectionDiv.appendChild(item);
    }
}

function renderSelectedTags() {
    const list = document.getElementById('modal-selected-list');
    list.innerHTML = '';
    selectedGroupMembers.forEach(uid => {
        get(ref(db, `users/${uid}`)).then(snap => {
            const uData = snap.val();
            const name = getDisplayName(uData);
            const tag = document.createElement('span');
            tag.className = 'tag';
            tag.innerText = name;
            tag.onclick = () => {
                selectedGroupMembers = selectedGroupMembers.filter(id => id !== uid);
                renderSelectedTags();
                populateCreationSelection();
            };
            list.appendChild(tag);
        });
    });
}

window.setCreationType = (type) => {
    document.getElementById('creation-type').value = type;
    document.querySelectorAll('.duration-chip').forEach(c => c.classList.remove('active'));
    document.getElementById(`type-select-${type}`).classList.add('active');
    document.getElementById('creation-name-label').innerText = type === 'group' ? 'Group Name' : 'Channel Name';
};

document.getElementById('confirm-creation-btn').onclick = async () => {
    const name = document.getElementById('creation-name-input').value.trim();
    const type = document.getElementById('creation-type').value;

    if (!name || selectedGroupMembers.length === 0) {
        showNotification("Enter a name and select friends.", "info");
        return;
    }

    const myUid = auth.currentUser.uid;
    const updates = {};
    const allMembers = [...selectedGroupMembers, myUid];

    if (type === 'group') {
        const groupId = push(ref(db, 'groups')).key; // Logical group container
        const chatRef = push(ref(db, 'chats'));
        const chatId = chatRef.key;

        updates[`/chats/${chatId}`] = { 
            title: "Main", 
            groupTitle: name,
            groupId: groupId,
            last_message: "Group created", 
            timestamp: serverTimestamp(), 
            isGroup: true, 
            creatorId: myUid 
        };

        allMembers.forEach(uid => {
            updates[`/user_chats/${uid}/${chatId}`] = true;
            updates[`/members/${chatId}/${uid}`] = { role: uid === myUid ? 'admin' : 'member' };
            updates[`/groups/${groupId}/members/${uid}`] = true;
            updates[`/groups/${groupId}/roles/${uid}`] = uid === myUid ? 'admin' : 'member';
        });

        await update(ref(db), updates);
        openChat(chatId, "Main");
    } else {
        // Standalone blogging channel
        const newChatRef = push(ref(db, 'chats'));
        const chatId = newChatRef.key;
        updates[`/chats/${chatId}`] = { 
            title: name, 
            last_message: "Channel created", 
            timestamp: serverTimestamp(), 
            isGroup: true, 
            isChannel: true, 
            creatorId: myUid 
        };
        allMembers.forEach(uid => {
            updates[`/user_chats/${uid}/${chatId}`] = true;
            updates[`/members/${chatId}/${uid}`] = { role: uid === myUid ? 'admin' : 'member' };
        });
        await update(ref(db), updates);
        openChat(chatId, name);
    }

    closeAnimatedModal(document.getElementById('creation-modal'));
    document.getElementById('creation-name-input').value = '';
};

/* ---------------- SUB-CHANNEL LOGIC ---------------- */

document.getElementById('confirm-subchannel-btn').onclick = async () => {
    const name = document.getElementById('subchannel-name-input').value.trim();
    if (!name) return;

    const snap = await get(ref(db, `chats/${currentChatId}`));
    const parentData = snap.val();
    if (!parentData || !parentData.groupId) return;

    const newChatRef = push(ref(db, 'chats'));
    const chatId = newChatRef.key;

    // Inherit group metadata
    const updates = {};
    const newChatData = { 
        title: name, 
        groupId: parentData.groupId,
        groupTitle: parentData.groupTitle,
        last_message: "Channel created", 
        timestamp: serverTimestamp(), 
        isGroup: true, 
        creatorId: auth.currentUser.uid 
    };
    if (parentData.profilePic) {
        newChatData.profilePic = parentData.profilePic;
    }
    updates[`/chats/${chatId}`] = newChatData;

    // Copy members from current chat
    const memSnap = await get(ref(db, `members/${currentChatId}`));
    const members = memSnap.val() || {};
    Object.keys(members).forEach(uid => {
        updates[`/user_chats/${uid}/${chatId}`] = true;
        updates[`/members/${chatId}/${uid}`] = members[uid];
    });

    await update(ref(db), updates);
    closeAnimatedModal(document.getElementById('subchannel-modal'));
    document.getElementById('subchannel-name-input').value = '';
    openChat(chatId, name);
};

document.getElementById('close-subchannel-modal').onclick = () => {
    closeAnimatedModal(document.getElementById('subchannel-modal'));
};


/* ---------------- MODALS & DRAWER CONTROLS ---------------- */

// Drawer buttons
const hamburgerBtn = document.getElementById('hamburger-btn');
if (hamburgerBtn) {
    hamburgerBtn.onclick = (e) => {
        e.stopPropagation();
        toggleSidebarDrawer();
    };
}

const closeSidebarBtn = document.getElementById('close-sidebar-btn');
if (closeSidebarBtn) {
    closeSidebarBtn.onclick = (e) => {
        e.stopPropagation();
        closeSidebarDrawer();
    };
}

const sidebarBackdrop = document.getElementById('sidebar-backdrop');
if (sidebarBackdrop) {
    sidebarBackdrop.onclick = () => {
        closeSidebarDrawer();
    };
}

document.getElementById('open-profile-modal').onclick = () => {
    closeSidebarDrawer();
    openAnimatedModal(document.getElementById('profile-modal'));
};
document.getElementById('open-admin-panel-btn').onclick = () => {
    closeSidebarDrawer();
    openAdminPanelModal();
};
document.getElementById('open-premium-panel-btn').onclick = () => {
    closeSidebarDrawer();
    openPremiumPanelModal('account');
}; 

// WhatsApp-style Image Viewer Modal Actions
const closeViewerBtn = document.getElementById('close-viewer-btn');
if (closeViewerBtn) {
    closeViewerBtn.onclick = () => {
        const modal = document.getElementById('image-viewer-modal');
        if (modal) modal.classList.add('hidden');
        document.getElementById('viewer-main-img').src = '';
        window.currentViewingImage = null;
    };
}

const downloadViewerBtn = document.getElementById('download-viewer-btn');
if (downloadViewerBtn) {
    downloadViewerBtn.onclick = function() {
        console.log("[VIEWER] Triggering native download...");

        const currentImageUrl = window.currentViewingImage || document.getElementById('viewer-main-img')?.src;
        if (!currentImageUrl) return;

        const idMatch = currentImageUrl.match(/id=([^&]+)/) || currentImageUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        
        if (idMatch && idMatch[1]) {
            const driveId = idMatch[1];
            const downloadUrl = `https://drive.google.com/uc?export=download&id=${driveId}`;

            const a = document.createElement('a');
            a.href = downloadUrl;
            a.target = '_blank'; // Opens in a new tab/handler to prevent navigating away from the chat
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            if (typeof showNotification === 'function') showNotification("Download started", "success");
        } else {
            console.error("[VIEWER] Could not extract Drive ID for download.");
            if (typeof showNotification === 'function') showNotification("Failed to process image link", "error");
        }
    };
}

const imageViewerModal = document.getElementById('image-viewer-modal');
if (imageViewerModal) {
    imageViewerModal.onclick = (e) => {
        if (e.target.id === 'image-viewer-modal' || e.target.classList.contains('viewer-body')) {
            imageViewerModal.classList.add('hidden');
            const modalImg = document.getElementById('viewer-main-img');
            if (modalImg) modalImg.src = '';
            window.currentViewingImage = null;
        }
    };
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('image-viewer-modal');
        if (modal && !modal.classList.contains('hidden')) {
            modal.classList.add('hidden');
            const modalImg = document.getElementById('viewer-main-img');
            if (modalImg) modalImg.src = '';
            window.currentViewingImage = null;
        }
    }
}); 

document.getElementById('close-profile-modal').onclick = () => {
    closeAnimatedModal(document.getElementById('profile-modal'));
};

document.getElementById('open-add-friend-modal').onclick = () => {
    closeSidebarDrawer();
    openAnimatedModal(document.getElementById('add-friend-modal'));
};

document.getElementById('close-add-friend-modal').onclick = () => {
    closeAnimatedModal(document.getElementById('add-friend-modal'), () => {
        document.getElementById('friend-code-input').value = '';
        stopScanner();
    });
};

document.getElementById('open-creation-modal').onclick = () => {
    closeSidebarDrawer();
    openAnimatedModal(document.getElementById('creation-modal'));
    selectedGroupMembers = []; // Reset selection only when opening the modal
    setCreationType('group');
    populateCreationSelection();
};

document.getElementById('friend-requests-badge').onclick = () => {
    closeSidebarDrawer();
    openAnimatedModal(document.getElementById('friend-requests-modal'));
};

const closeRequestsBtn = document.getElementById('close-requests-modal');
if (closeRequestsBtn) {
    closeRequestsBtn.onclick = () => {
        closeAnimatedModal(document.getElementById('friend-requests-modal'));
    };
}

const closeModalBtn = document.getElementById('close-creation-modal');
if (closeModalBtn) {
    closeModalBtn.onclick = () => {
        const groupModal = document.getElementById('creation-modal');
        if (groupModal) closeAnimatedModal(groupModal);
    };
}

const closeAdminPanelBtn = document.getElementById('close-admin-panel-modal');
if (closeAdminPanelBtn) {
    closeAdminPanelBtn.onclick = () => {
        closeAnimatedModal(document.getElementById('admin-panel-modal'));
    };
}

function closeSettings() {
    const settingsModal = document.getElementById('settings-modal') || document.getElementById('premium-panel-modal') || document.querySelector('.settings-container');
    if (settingsModal) {
        if (typeof closeAnimatedModal === 'function') {
            closeAnimatedModal(settingsModal);
        } else {
            settingsModal.classList.add('hidden');
            settingsModal.style.display = 'none';
        }
    }
    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
}
window.closeSettings = closeSettings;

const closePremiumBtn = document.getElementById('close-premium-panel');
if (closePremiumBtn) {
    closePremiumBtn.onclick = () => {
        closeSettings();
    };
}

const premiumPanelModal = document.getElementById('premium-panel-modal');
if (premiumPanelModal) {
    premiumPanelModal.onclick = (e) => {
        if (e.target.id === 'premium-panel-modal') {
            closeSettings();
        }
    };
}

document.addEventListener('click', (e) => {
    if (e.target.closest('#btn-close-settings, .settings-close-btn')) {
        closeSettings();
    }
});

const profileModalEl = document.getElementById('profile-modal');
if (profileModalEl) {
    profileModalEl.onclick = (e) => {
        if (e.target.id === 'profile-modal') {
            closeAnimatedModal(profileModalEl);
        }
    };
}

// Global click-outside handler for secondary modals to ensure clean animated close
document.addEventListener('click', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('modal')) {
        if (e.target.id !== 'premium-panel-modal' &&
            e.target.id !== 'profile-modal' &&
            e.target.id !== 'confirm-modal' &&
            e.target.id !== 'flag-game-screen' &&
            e.target.id !== 'flag-game-lobby-modal' &&
            e.target.id !== 'wordle-game-screen' &&
            e.target.id !== 'doodle-game-screen' &&
            e.target.id !== 'spy-game-ui') {
            closeAnimatedModal(e.target);
        }
    }
});

    // New function to handle tab switching and content rendering
    function setActivePremiumTab(tabId) {
        document.querySelectorAll('.premium-nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelectorAll('.premium-tab-content').forEach(content => {
            content.style.display = 'none';
        });

        document.querySelector(`.premium-nav-item[data-tab="${tabId}"]`).classList.add('active');
        document.getElementById(`premium-tab-${tabId}`).style.display = 'block'; // Use block for grid layout to prevent flex issues

        if (tabId === 'themes') {
            renderThemeOptions();
        } else if (tabId === 'nameplates') {
            renderNameplateOptions();
        } else if (tabId === 'notifications') {
            renderNotificationSettingsTab();
        } else if (tabId === 'stickers') {
            renderStickerOptions();
        } else if (tabId === 'liquidglass' || tabId === 'optimisation') {
            syncUiPrefToggles();
        } else if (tabId === 'account') {
            renderAccountTab();
        } else if (tabId === 'appinfo') {
            renderAppInfoTab();
        }
        activePremiumTab = tabId; // Update active tab state
    }

    function renderAppInfoTab() {
        updateSettingsVersionDisplay();
        const msgEl = document.getElementById('settings-update-msg');
        if (msgEl && !msgEl.textContent) {
            msgEl.textContent = `Installed build: v${CURRENT_APP_VERSION}`;
            msgEl.style.color = 'rgba(255, 255, 255, 0.6)';
        }
    }

    // Check for updates button listeners
    const btnCheckUpdates = document.getElementById('btn-check-updates');
    if (btnCheckUpdates) {
        btnCheckUpdates.onclick = () => checkForUpdates(true);
    }
    const checkUpdateBtn = document.getElementById('settings-check-update-btn');
    if (checkUpdateBtn) {
        checkUpdateBtn.onclick = () => checkForUpdates(true);
    }
    const accountCheckUpdateBtn = document.getElementById('account-check-update-btn');
    if (accountCheckUpdateBtn) {
        accountCheckUpdateBtn.onclick = () => checkForUpdates(true);
    }
    const btnApplyUpdate = document.getElementById('btn-apply-update');
    if (btnApplyUpdate) {
        btnApplyUpdate.onclick = () => applyUpdateAndReload();
    }
    const btnDismissUpdate = document.getElementById('btn-dismiss-update');
    if (btnDismissUpdate) {
        btnDismissUpdate.onclick = () => dismissOtaUpdateBanner();
    }

    function updateSettingsToggleBtn() {
        const layout = document.getElementById('settings-layout');
        const toggleBtn = document.getElementById('toggle-premium-sidebar');
        if (!layout || !toggleBtn) return;
        const isFolded = layout.classList.contains('folded');
        if (isFolded) {
            toggleBtn.innerHTML = '☰ Menu';
            toggleBtn.setAttribute('title', 'Show menu options');
        } else {
            toggleBtn.innerHTML = '✕ Close Menu';
            toggleBtn.setAttribute('title', 'Close options and give more space to content');
        }
    }

    function openPremiumPanelModal(initialTab = 'account', startFoldedOnMobile = false) {
        updateSettingsVersionDisplay();
        const profileModal = document.getElementById('profile-modal');
        if (profileModal) closeAnimatedModal(profileModal);
        
        const premiumModal = document.getElementById('premium-panel-modal');
        if (premiumModal) openAnimatedModal(premiumModal);
        
        const layout = document.getElementById('settings-layout');
        if (layout) {
            if (window.innerWidth <= 768 && startFoldedOnMobile) {
                layout.classList.add('folded');
            } else {
                layout.classList.remove('folded');
            }
            updateSettingsToggleBtn();
        }

        // Dynamically add/remove locked indicator to nav items if not premium
        document.querySelectorAll('#settings-layout .premium-nav-item, #premium-panel-modal .premium-nav-item').forEach(item => {
            const tab = item.dataset.tab;
            let text = item.innerText.replace(/\s*[\u{1F512}\u{1F513}]/gu, '').replace(/\s*\?\?/g, '').trim();
            if (!isCurrentUserPremium && ['themes', 'nameplates', 'liquidglass'].includes(tab)) {
                item.innerText = text + ' \u{1F512}';
            } else {
                item.innerText = text;
            }
        });

        setActivePremiumTab(initialTab);
    }

    // Event listeners for premium nav items
    document.querySelectorAll('#settings-layout .premium-nav-item, #premium-panel-modal .premium-nav-item').forEach(item => {
        item.addEventListener('click', () => {
            setActivePremiumTab(item.dataset.tab);
            // Fold sidebar on mobile when an option is selected to give more space to content
            if (window.innerWidth <= 768) {
                const layout = document.getElementById('settings-layout');
                if (layout) {
                    layout.classList.add('folded');
                    updateSettingsToggleBtn();
                }
            }
        });
    });

    // Toggle listener for premium sidebar on mobile
    const togglePremiumBtn = document.getElementById('toggle-premium-sidebar');
    if (togglePremiumBtn) {
        togglePremiumBtn.onclick = () => {
            const layout = document.getElementById('settings-layout');
            if (layout) {
                layout.classList.toggle('folded');
                updateSettingsToggleBtn();
            }
        };
    }

    // --- Account tab (name + bio auto-save + email change with password confirmation) ---
    async function renderAccountTab() {
        const u = auth.currentUser;
        if (!u) return;
        const nameInput = document.getElementById('settings-display-name');
        const bioInput = document.getElementById('settings-profile-description');
        
        try {
            const snap = await get(ref(db, `users/${u.uid}`));
            const data = snap.val() || {};
            if (nameInput) nameInput.value = data.displayName || u.email?.split('@')[0] || '';
            if (bioInput) bioInput.value = data.description || '';
        } catch (e) {
            const nameFromProfile = document.getElementById('profile-display-name')?.value;
            if (nameInput) nameInput.value = nameFromProfile || document.getElementById('current-user-name')?.innerText || '';
        }

        document.getElementById('settings-current-email').innerText = u.email || '\u{2014}';
        document.getElementById('settings-new-email').value = '';
        document.getElementById('settings-email-password').value = '';
        setEmailMsg('');
        const nameMsg = document.getElementById('settings-name-msg');
        if (nameMsg) nameMsg.innerText = '';
        const bioMsg = document.getElementById('settings-bio-msg');
        if (bioMsg) bioMsg.innerText = '';
        const accVer = document.getElementById('account-tab-app-version');
        if (accVer) accVer.textContent = CURRENT_VERSION;
        updateSettingsVersionDisplay();
    }
    function setEmailMsg(text, isError) {
        const m = document.getElementById('settings-email-msg');
        if (!m) return;
        m.innerText = text;
        m.style.color = isError ? '#ff6b6b' : '#00ff88';
    }

    // Auto-save Display Name on change/blur
    const settingsNameInput = document.getElementById('settings-display-name');
    if (settingsNameInput) {
        const handleNameAutoSave = async () => {
            const name = settingsNameInput.value.trim().substring(0, 15);
            const nameMsg = document.getElementById('settings-name-msg');
            if (!name) {
                if (nameMsg) { nameMsg.innerText = "Name can't be empty."; nameMsg.style.color = '#ff6b6b'; }
                return;
            }
            try {
                await update(ref(db, `users/${auth.currentUser.uid}`), { displayName: name, username: name });
                const pf = document.getElementById('profile-display-name');
                if (pf) pf.value = name;
                const pfText = document.getElementById('profile-display-name-text');
                if (pfText) pfText.innerText = name;
                const curName = document.getElementById('current-user-name');
                if (curName) curName.innerText = name;
                if (nameMsg) {
                    nameMsg.innerText = "Saved!";
                    nameMsg.style.color = '#00ff88';
                    setTimeout(() => { if (nameMsg.innerText === "Saved!") nameMsg.innerText = ""; }, 2500);
                }
            } catch (err) {
                console.error(err);
                if (nameMsg) { nameMsg.innerText = "Couldn't update name: " + err.message; nameMsg.style.color = '#ff6b6b'; }
            }
        };
        settingsNameInput.onchange = handleNameAutoSave;
        settingsNameInput.onblur = handleNameAutoSave;
    }

    window.saveProfile = async function() {
        const input = document.getElementById('settings-display-name') || document.getElementById('profile-username-input') || document.getElementById('profile-display-name');
        if (!input) return;
        const newUsername = input.value.trim().substring(0, 15);
        if (!newUsername) return;
        try {
            await update(ref(db, `users/${auth.currentUser.uid}`), { displayName: newUsername, username: newUsername });
            showNotification("Profile saved", "success");
        } catch (e) {
            showNotification("Failed to save profile", "error");
        }
    };

    // Auto-save About Me / Bio on change/blur
    const settingsBioInput = document.getElementById('settings-profile-description');
    if (settingsBioInput) {
        const handleBioAutoSave = async () => {
            const bio = settingsBioInput.value;
            const bioMsg = document.getElementById('settings-bio-msg');
            try {
                await update(ref(db, `users/${auth.currentUser.uid}`), { description: bio });
                const descText = document.getElementById('profile-description-text');
                if (descText) descText.innerText = bio.trim() ? bio : "No bio yet.";
                if (bioMsg) {
                    bioMsg.innerText = "Saved!";
                    bioMsg.style.color = '#00ff88';
                    setTimeout(() => { if (bioMsg.innerText === "Saved!") bioMsg.innerText = ""; }, 2500);
                }
            } catch (err) {
                console.error(err);
                if (bioMsg) { bioMsg.innerText = "Save failed: " + err.message; bioMsg.style.color = '#ff6b6b'; }
            }
        };
        settingsBioInput.onchange = handleBioAutoSave;
        settingsBioInput.onblur = handleBioAutoSave;
    }
    const changeEmailBtn = document.getElementById('settings-change-email');
    if (changeEmailBtn) changeEmailBtn.onclick = async () => {
        const user = auth.currentUser;
        const newEmail = document.getElementById('settings-new-email').value.trim();
        const password = document.getElementById('settings-email-password').value;
        if (!user) return;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) { setEmailMsg("Enter a valid email address.", true); return; }
        if (newEmail.toLowerCase() === (user.email || '').toLowerCase()) { setEmailMsg("That's already your email.", true); return; }
        if (!password) { setEmailMsg("Enter your current password to confirm.", true); return; }
        changeEmailBtn.disabled = true;
        setEmailMsg('Checking password\u{2026}');
        try {
            await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
            try {
                await updateEmail(user, newEmail);
                await update(ref(db, `users/${user.uid}`), { email: newEmail });
                document.getElementById('settings-current-email').innerText = newEmail;
                document.getElementById('settings-new-email').value = '';
                document.getElementById('settings-email-password').value = '';
                setEmailMsg('Email changed.');
                showNotification("Email changed.", "success");
            } catch (err) {
                if (err.code === 'auth/operation-not-allowed') {
                    // Project requires verifying the new address first
                    await verifyBeforeUpdateEmail(user, newEmail);
                    document.getElementById('settings-email-password').value = '';
                    setEmailMsg('We sent a confirmation link to ' + newEmail + '. Your email changes after you open it.');
                } else { throw err; }
            }
        } catch (err) {
            console.error(err);
            const map = {
                'auth/wrong-password': 'Wrong password.',
                'auth/invalid-credential': 'Wrong password.',
                'auth/email-already-in-use': 'That email is already used by another account.',
                'auth/invalid-email': 'That email address is not valid.',
                'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
                'auth/requires-recent-login': 'Please log out and back in, then try again.'
            };
            setEmailMsg(map[err.code] || ('Could not change email: ' + (err.message || err.code)), true);
        } finally {
            changeEmailBtn.disabled = false;
        }
    };

    // --- Liquid Glass / Optimisation toggles ---
    const lgToggle = document.getElementById('toggle-liquid-glass');
    if (lgToggle) lgToggle.onchange = (e) => {
        if (!isCurrentUserPremium) {
            e.preventDefault();
            lgToggle.checked = false; // Revert visually
            showNotification("Liquid Glass is an Orion Premium feature. Support Orion to unlock!", "info");
            document.getElementById('payment-modal').style.display = 'flex';
            return;
        }
        uiPrefs.set('lg', lgToggle.checked);
        if (lgToggle.checked && uiPrefs.get('perf')) {
            uiPrefs.set('perf', false);
            showNotification("Performance mode turned off so Liquid Glass can show.", "info");
        }
        applyUiPrefs();
        syncUiPrefToggles();
        showNotification(lgToggle.checked ? "Liquid Glass theme enabled." : "Minimalist Modern theme enabled.", "info");
    };

    const lgAnimToggle = document.getElementById('toggle-lg-anim');
    if (lgAnimToggle) lgAnimToggle.onchange = (e) => {
        if (!isCurrentUserPremium) {
            e.preventDefault();
            lgAnimToggle.checked = !uiPrefs.get('lgstill'); // Revert visually
            showNotification("Liquid Glass animations are an Orion Premium feature.", "info");
            document.getElementById('payment-modal').style.display = 'flex';
            return;
        }
        uiPrefs.set('lgstill', !lgAnimToggle.checked);
        applyUiPrefs();
    };
    const perfToggle = document.getElementById('toggle-perf-mode');
    if (perfToggle) perfToggle.onchange = () => {
        uiPrefs.set('perf', perfToggle.checked);
        applyUiPrefs(); syncUiPrefToggles();
    };
    const blurToggle = document.getElementById('toggle-no-blur');
    if (blurToggle) blurToggle.onchange = () => {
        uiPrefs.set('noblur', blurToggle.checked);
        applyUiPrefs();
    };

    const nameplateCategories = [
        {
            name: "None",
            nameplates: [
                { id: 'none', name: 'None' }
            ]
        },
        {
            name: "Clean Premium",
            nameplates: [
                { id: 'gold-elite', name: 'Gold Elite' },
                { id: 'platinum', name: 'Platinum' },
                { id: 'diamond', name: 'Diamond' },
                { id: 'obsidian', name: 'Obsidian' },
                { id: 'titanium', name: 'Titanium' },
                { id: 'royal-black', name: 'Royal Black' },
                { id: 'crystal-edge', name: 'Crystal Edge' }
            ]
        },
        {
            name: "Animated",
            nameplates: [
                { id: 'glowing-neon', name: 'Glowing Neon' },
                { id: 'rgb-pulse', name: 'RGB Pulse' },
                { id: 'electric-blue', name: 'Electric Blue' },
                { id: 'flame-border', name: 'Flame Border' },
                { id: 'frozen-ice', name: 'Frozen Ice' },
                { id: 'galaxy-flow', name: 'Galaxy Flow' },
                { id: 'lightning-strike', name: 'Lightning Strike' }
            ]
        },
        {
            name: "Nature",
            nameplates: [
                { id: 'sakura-bloom', name: 'Sakura Bloom' },
                { id: 'forest-vine', name: 'Forest Vine' },
                { id: 'ocean-wave', name: 'Ocean Wave' },
                { id: 'autumn-leaves', name: 'Autumn Leaves' },
                { id: 'snowfall', name: 'Snowfall' },
                { id: 'emerald-nature', name: 'Emerald Nature' },
                { id: 'sunset-glow', name: 'Sunset Glow' }
            ]
        },
        {
            name: "Gaming / Tech",
            nameplates: [
                { id: 'cyberpunk-np', name: 'Cyberpunk' },
                { id: 'hacker-matrix', name: 'Hacker Matrix' },
                { id: 'pixel-retro', name: 'Pixel Retro' },
                { id: 'sci-fi-hud', name: 'Sci-Fi HUD' },
                { id: 'glitch', name: 'Glitch' },
                { id: 'console-gamer', name: 'Console Gamer' },
                { id: 'space-commander', name: 'Space Commander' }
            ]
        },
        {
            name: "Cute / Social",
            nameplates: [
                { id: 'pink-hearts', name: 'Pink Hearts' },
                { id: 'soft-pastel', name: 'Soft Pastel' },
                { id: 'cat-ears', name: 'Cat Ears' },
                { id: 'starry-dream', name: 'Starry Dream' },
                { id: 'cloud-nine', name: 'Cloud Nine' },
                { id: 'bubble-pop', name: 'Bubble Pop' },
                { id: 'angel-wings', name: 'Angel Wings' }
            ]
        },
        {
            name: "Status / Rank",
            nameplates: [
                { id: 'founder', name: 'Founder' },
                { id: 'og-member', name: 'OG Member' },
                { id: 'veteran', name: 'Veteran' },
                { id: 'moderator', name: 'Moderator' },
                { id: 'vip', name: 'VIP' },
                { id: 'legendary', name: 'Legendary' },
                { id: 'mythic', name: 'Mythic' },
                { id: 'elite-member', name: 'Elite Member' }
            ]
        }
    ];

    async function renderNameplateOptions() {
        const grid = document.getElementById('nameplate-selection-grid');
        const snap = await get(ref(db, `users/${auth.currentUser.uid}/nameplate`));
        const currentNameplate = snap.val() || 'none'; // Default to 'none'
        
        grid.innerHTML = ''; // Clear only after fetching to prevent flicker

        nameplateCategories.forEach(cat => {
            const header = document.createElement('h5');
            header.innerText = cat.name;
            header.style.gridColumn = '1 / -1';
            header.style.margin = '15px 0 5px 0';
            header.style.opacity = '0.6';
            grid.appendChild(header);

            cat.nameplates.forEach(nameplate => {
                const card = document.createElement('div');
                const isLocked = nameplate.id !== 'none' && !isCurrentUserPremium;
                card.className = `nameplate-card ${currentNameplate === nameplate.id ? 'active' : ''} ${isLocked ? 'is-locked' : ''}`;
                const lockHtml = isLocked ? `<span class="cosmetic-lock-badge" title="Orion Premium">🔒</span>` : '';
                card.innerHTML = `${lockHtml}<div><span class="nameplate-preview nameplate-applied ${nameplate.id}">${nameplate.name}</span></div>`;
                card.onclick = async () => {
                    // Paywall check: Free users see locked preview; clicking triggers upgrade modal
                    if (isLocked) {
                        showNotification("Custom Nameplates are an Orion Premium feature. Support Orion to unlock!", "info");
                        document.getElementById('payment-modal').style.display = 'flex';
                        return;
                    }
                    const selectedId = nameplate.id === 'none' ? null : nameplate.id; // Store null for 'none'
                    await update(ref(db, `users/${auth.currentUser.uid}`), { nameplate: selectedId });
                    renderNameplateOptions();
                };
                grid.appendChild(card);
            });
        });
        twemoji.parse(grid);
    }

    const themeCategories = [
        {
            name: "Nature & Atmosphere",
            themes: [
                { id: 'default', name: 'Default', icon: '\u{1F30C}' },
                { id: 'forest', name: 'Forest', icon: '\u{1F332}' },
                { id: 'ocean', name: 'Ocean', icon: '\u{1F30A}' },
                { id: 'rainy-night', name: 'Rainy Night', icon: '\u{1F327}\u{FE0F}' },
                { id: 'sunset', name: 'Sunset', icon: '\u{1F307}' },
                { id: 'mountain', name: 'Mountain', icon: '\u{26F0}\u{FE0F}' },
                { id: 'aurora', name: 'Aurora', icon: '\u{1F30C}' },
                { id: 'desert', name: 'Desert', icon: '\u{1F335}' },
                { id: 'tropical', name: 'Tropical', icon: '\u{1F3DD}\u{FE0F}' },
                { id: 'space', name: 'Space', icon: '\u{1F680}' }
            ]
        },
        {
            name: "Seasons",
            themes: [
                { id: 'spring', name: 'Spring', icon: '\u{1F338}' },
                { id: 'summer', name: 'Summer', icon: '\u{2600}\u{FE0F}' },
                { id: 'autumn', name: 'Autumn', icon: '\u{1F341}' },
                { id: 'winter', name: 'Winter', icon: '\u{2744}\u{FE0F}' }
            ]
        },
        {
            name: "Modern / Aesthetic",
            themes: [
                { id: 'cyberpunk', name: 'Neon Cyberpunk', icon: '\u{1F3D9}\u{FE0F}' },
                { id: 'amoled', name: 'AMOLED Black', icon: '\u{1F311}' },
                { id: 'vaporwave', name: 'Vaporwave', icon: '\u{1F334}' },
                { id: 'retro', name: 'Retro 2000s', icon: '\u{1F4BE}' },
                { id: 'frutiger', name: 'Frutiger Aero', icon: '\u{1FAE7}' },
                { id: 'synthwave', name: 'Synthwave', icon: '\u{1F576}\u{FE0F}' }
            ]
        },
        {
            name: "Fun & Creative",
            themes: [
                { id: 'hacker', name: 'Hacker Terminal', icon: '\u{1F4DF}' },
                { id: 'pixel', name: 'Pixel Art', icon: '\u{1F47E}' },
                { id: 'pastel', name: 'Cute/Pastel', icon: '\u{1F9F8}' },
                { id: 'sci-fi', name: 'Sci-Fi', icon: '\u{1F680}' }
            ]
        },
        {
            name: "Accessibility",
            themes: [
                { id: 'high-contrast', name: 'High Contrast', icon: '\u{1F313}' }
            ]
        }
    ];

    async function renderThemeOptions() {
        const grid = document.getElementById('theme-selection-grid');
        grid.innerHTML = '';
        const snap = await get(ref(db, `users/${auth.currentUser.uid}/theme`));
        const currentTheme = snap.val() || 'default';

        themeCategories.forEach(cat => {
            const header = document.createElement('h5');
            header.innerText = cat.name;
            header.style.gridColumn = '1 / -1';
            header.style.margin = '15px 0 5px 0';
            header.style.opacity = '0.6';
            grid.appendChild(header);

            cat.themes.forEach(theme => {
                const card = document.createElement('div');
                const isLocked = theme.id !== 'default' && !isCurrentUserPremium;
                card.className = `theme-card ${currentTheme === theme.id ? 'active' : ''} ${isLocked ? 'is-locked' : ''}`;
                const lockHtml = isLocked ? `<span class="cosmetic-lock-badge" title="Orion Premium">\u{1F512}</span>` : '';
                card.innerHTML = `${lockHtml}<div><div style="font-size: 24px;">${theme.icon}</div>${theme.name}</div>`;
                card.onclick = async () => {
                    // Paywall gate: locked themes trigger upgrade modal without applying
                    if (isLocked) {
                        showNotification("Custom Themes are an Orion Premium feature. Support Orion to unlock!", "info");
                        document.getElementById('payment-modal').style.display = 'flex';
                        return;
                    }
                    await update(ref(db, `users/${auth.currentUser.uid}`), { theme: theme.id });
                    applyTheme(theme.id);
                    renderThemeOptions();
                };
                grid.appendChild(card);
            });
        });
        twemoji.parse(grid);
    }

    // Custom badges are now Discord-style group roles only (assigned inside group chats)
    async function renderBadgeOptions() {}

    // --- Render Dedicated Notifications Tab ---
    function renderNotificationSettingsTab() {
        applyNotificationSettingsUI();
    }

    // Attach notification setting controls event listeners
    const toggleSoundsInput = document.getElementById('toggle-inapp-sounds');
    if (toggleSoundsInput) {
        toggleSoundsInput.onchange = () => {
            saveNotificationSettings({ inAppSounds: toggleSoundsInput.checked });
            if (toggleSoundsInput.checked) {
                playThemeNotification();
            }
        };
    }

    const toggleBadgesInput = document.getElementById('toggle-unread-badges');
    if (toggleBadgesInput) {
        toggleBadgesInput.onchange = () => {
            saveNotificationSettings({ unreadBadges: toggleBadgesInput.checked });
        };
    }

    document.querySelectorAll('#dm-notification-options .seg-btn').forEach(btn => {
        btn.onclick = () => {
            saveNotificationSettings({ dmNotifications: btn.dataset.val });
        };
    });

    document.querySelectorAll('#group-notification-options .seg-btn').forEach(btn => {
        btn.onclick = () => {
            saveNotificationSettings({ groupNotifications: btn.dataset.val });
        };
    });

    // --- Sticker Options Rendering ---
    async function renderStickerOptions() {
        const grid = document.getElementById('my-stickers-grid');
        grid.innerHTML = '';
        const myUid = auth.currentUser?.uid;
        if (!myUid) return;

        const list = await loadMyStickers(myUid);
        const totalOwnedCount = list.filter(x => x.kind === 'owned').length;

        if (isCurrentUserPremium) {
            const headerDiv = document.createElement('div');
            headerDiv.style.cssText = 'grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center; margin: 10px 0 15px 0;';
            headerDiv.innerHTML = `
                <span style="opacity: 0.7; font-size: 13px;">Uploaded: ${totalOwnedCount}/${STICKER_UPLOAD_LIMIT} stickers</span>
                <button id="panel-upload-sticker-btn" class="glass-btn-primary" style="padding: 6px 12px; font-size: 12px; width: auto;">+ Upload Sticker</button>
            `;
            grid.appendChild(headerDiv);

            document.getElementById('panel-upload-sticker-btn').onclick = () => {
                if (totalOwnedCount >= STICKER_UPLOAD_LIMIT) {
                    showNotification(`You have reached your limit of ${STICKER_UPLOAD_LIMIT} uploaded stickers.`, "info");
                    return;
                }
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/png, image/webp, image/gif';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file) uploadSticker(file);
                };
                input.click();
            };
        }

        const section = document.createElement('div');
        section.className = 'sticker-pack-section';
        section.style.gridColumn = '1 / -1';
        const header = document.createElement('div');
        header.className = 'sticker-pack-header';
    header.innerHTML = `<span class="pack-title-author">\u{1F39F}\u{FE0F} My Stickers (${list.length})</span>`;
        section.appendChild(header);

        if (list.length === 0) {
            const hint = document.createElement('small');
            hint.style.cssText = 'opacity:0.6; display:block; padding:8px; line-height:1.5;';
            hint.innerText = isCurrentUserPremium
                ? 'Nothing here yet. Upload a sticker, or tap a sticker in a chat to request it from its owner.'
                : 'Nothing here yet. Tap a sticker in a chat to request it from its owner.';
            section.appendChild(hint);
        } else {
            const innerGrid = document.createElement('div');
            innerGrid.className = 'theme-grid sticker-grid';
            list.forEach(({ meta, kind }) => {
                const card = document.createElement('div');
                card.className = 'sticker-card';
                card.innerHTML = `<img src="${meta.thumbnailStoragePath || meta.storagePath}" alt="${escapeHTML(getStickerDisplayName(meta))}" decoding="async">`;
                card.title = getStickerDisplayName(meta) + (kind === 'allowed' ? ' (shared with you)' : ' (yours)');
                card.onclick = async () => {
                    if (kind === 'owned') {
                        const ok = await showConfirm("Delete Sticker", `Are you sure you want to delete "${getStickerDisplayName(meta)}"?`);
                        if (ok) deleteSticker(meta.stickerId);
                    } else {
                        const ok = await showConfirm("Remove Sticker", `Remove "${getStickerDisplayName(meta)}" from your collection? You can request it again later.`);
                        if (ok) {
                            try {
                                await remove(ref(db, `user_stickers/${myUid}/${meta.stickerId}`));
                                renderStickerOptions();
                            } catch (err) { showNotification("Couldn't remove sticker.", "error"); }
                        }
                    }
                };
                innerGrid.appendChild(card);
            });
            section.appendChild(innerGrid);
        }
        grid.appendChild(section);
    }

    function applyTheme(themeId) {
        document.body.className = document.body.className.replace(/\btheme-\S+/g, '');
        if (themeId !== 'default') document.body.classList.add(`theme-${themeId}`);
        
        const overlay = document.getElementById('theme-overlay');
        overlay.innerHTML = '';

        // Map themes to specific animation types
        const particleThemes = ['winter', 'rainy-night', 'forest', 'autumn', 'spring', 'ocean', 'frutiger', 'desert', 'hacker'];
        const starThemes = ['default', 'space', 'aurora', 'sci-fi', 'synthwave', 'cyberpunk'];

        if (particleThemes.includes(themeId)) {
            const count = (themeId === 'forest' || themeId === 'hacker') ? 15 : 30;
            for (let i = 0; i < count; i++) {
                createParticle(overlay, themeId);
            }
        } else if (starThemes.includes(themeId)) {
            for (let i = 0; i < 50; i++) {
                createStar(overlay);
            }
        } else {
            // Baseline animation for others: subtle floating clouds/dust
            for (let i = 0; i < 10; i++) {
                createParticle(overlay, 'default');
            }
        }
    }

    function createStar(container) {
        const star = document.createElement('div');
        star.className = 'star';
        const size = Math.random() * 3;
        star.style.width = size + 'px';
        star.style.height = size + 'px';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        star.style.setProperty('--duration', (2 + Math.random() * 3) + 's');
        container.appendChild(star);
    }

    function createParticle(container, themeId) {
        const p = document.createElement('div');
        let char = '';
        if (themeId === 'winter') { char = '\u{2744}\u{FE0F}'; p.className = 'particle'; }
        else if (themeId === 'autumn') { char = '\u{1F341}'; p.className = 'particle'; }
        else if (themeId === 'spring') { char = '\u{1F338}'; p.className = 'particle'; }
        else if (themeId === 'ocean' || themeId === 'frutiger') { char = '\u{1FAE7}'; p.className = 'bubble'; }
        else if (themeId === 'desert') { char = '\u{23F3}'; p.className = 'particle'; p.style.filter = 'sepia(1)'; }
        else if (themeId === 'hacker') { char = Math.random() > 0.5 ? '0' : '1'; p.className = 'matrix-char'; }
        else if (themeId === 'rainy-night') { p.className = 'rain-drop'; }
        else if (themeId === 'forest') { p.className = 'firefly'; }
        else { char = '\u{2601}\u{FE0F}'; p.className = 'cloud'; }

        p.innerText = char;
        p.style.left = Math.random() * 100 + '%';
        
        if (themeId === 'rainy-night') {
            p.style.animationDuration = (0.5 + Math.random() * 0.5) + 's';
            p.style.opacity = Math.random() * 0.3;
        } else if (themeId === 'forest') {
            p.style.top = Math.random() * 100 + '%';
            p.style.animationDuration = (3 + Math.random() * 4) + 's';
            p.style.animationDelay = (Math.random() * 5) + 's';
        } else if (themeId === 'ocean' || themeId === 'frutiger') {
            p.style.top = '110%';
            p.style.animationDuration = (4 + Math.random() * 6) + 's';
            p.style.fontSize = (10 + Math.random() * 20) + 'px';
        } else if (themeId === 'hacker') {
            p.style.animationDuration = (2 + Math.random() * 3) + 's';
            p.style.color = '#00ff00';
            p.style.fontSize = '12px';
        } else {
            p.style.fontSize = (15 + Math.random() * 20) + 'px';
            p.style.animationDuration = (5 + Math.random() * 10) + 's';
        }

        container.appendChild(p);
        p.onanimationend = () => { p.remove(); createParticle(container, themeId); };
    }

    let activeAdminRequestsOff = null;

    function detachAdminRequestsListener() {
        if (activeAdminRequestsOff) {
            activeAdminRequestsOff();
            activeAdminRequestsOff = null;
        }
    }

    function renderAdminRequests(requestsObj) {
        const requestsList = document.getElementById('admin-requests-list');
        const badgeEl = document.getElementById('admin-requests-badge');
        const entries = requestsObj && typeof requestsObj === 'object'
            ? Object.entries(requestsObj)
                .filter(([, req]) => req && typeof req === 'object')
                .map(([id, req]) => ({ id, ...req }))
                .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
            : [];

        if (badgeEl) {
            if (entries.length > 0) {
                badgeEl.textContent = String(entries.length);
                badgeEl.style.display = 'inline-block';
            } else {
                badgeEl.textContent = '0';
                badgeEl.style.display = 'none';
            }
        }

        if (!requestsList) return;
        requestsList.innerHTML = '';

        if (entries.length === 0) {
            requestsList.innerHTML = '<p style="text-align: center; opacity: 0.6; font-size: 13px; margin: 20px 0;">No pending requests.</p>';
            return;
        }

        entries.forEach(req => {
            const displayUsername = String(req.username || 'Unknown').substring(0, 15);
            const formattedTime = req.timestamp ? new Date(req.timestamp).toLocaleString() : 'Unknown time';

            const card = document.createElement('div');
            card.style.cssText = 'background: rgba(255, 255, 255, 0.04); border: 1px solid var(--glass-border); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 10px;';

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <strong style="font-size: 14px; color: var(--accent);">${escapeHTML(displayUsername)}</strong>
                    <small style="opacity: 0.6; font-size: 11px;">${escapeHTML(formattedTime)}</small>
                </div>
                <div style="font-size: 13px; line-height: 1.5; opacity: 0.9; word-break: break-word;">${escapeHTML(req.note || '')}</div>
                <div style="display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;">
                    <button type="button" class="glass-btn-primary admin-req-msg-btn" style="width: auto; padding: 8px 14px; font-size: 12px; min-height: 36px;">Message</button>
                    <button type="button" class="glass-btn-secondary admin-req-dismiss-btn" style="padding: 8px 14px; font-size: 12px; min-height: 36px;">Dismiss</button>
                </div>
            `;

            const msgBtn = card.querySelector('.admin-req-msg-btn');
            if (msgBtn) {
                msgBtn.onclick = () => {
                    const myUid = auth.currentUser?.uid;
                    if (!myUid || !req.uid) return;
                    if (req.uid === myUid) {
                        showNotification("This request is from your own account.", "info");
                        return;
                    }
                    closeAnimatedModal(document.getElementById('admin-panel-modal'));
                    startChat(myUid, req.uid, displayUsername);
                };
            }

            const dismissBtn = card.querySelector('.admin-req-dismiss-btn');
            if (dismissBtn) {
                dismissBtn.onclick = async () => {
                    dismissBtn.disabled = true;
                    try {
                        await remove(ref(db, 'adminRequests/' + req.id));
                        if (typeof showNotification === 'function') {
                            showNotification("Request dismissed.", "info");
                        }
                    } catch (err) {
                        console.error("[AdminRequests] Dismiss failed:", err);
                        dismissBtn.disabled = false;
                        if (typeof showNotification === 'function') {
                            showNotification("Failed to dismiss request.", "error");
                        }
                    }
                };
            }

            requestsList.appendChild(card);
        });

        if (window.twemoji) twemoji.parse(requestsList);
    }

    function setActiveAdminTab(tabId) {
        document.querySelectorAll('.admin-nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.tab === tabId);
        });
        document.querySelectorAll('.admin-tab-content').forEach(content => {
            content.style.display = content.id === `admin-tab-${tabId}` ? 'block' : 'none';
        });
    }

    // Set up listeners for admin nav items once
    document.querySelectorAll('.admin-nav-item').forEach(item => {
        item.onclick = () => {
            setActiveAdminTab(item.dataset.tab);
        };
    });

    let allAdminUsers = [];

    const ADMIN_USER_TIERS = [
        { value: 'Basic', label: 'Basic', color: 'rgba(148, 163, 184, 0.35)' },
        { value: 'Premium', label: 'Premium', color: 'linear-gradient(135deg, #d97706, #f59e0b)' }
    ];

    function updateAdminUserStats() {
        const totalEl = document.getElementById('stat-total-users');
        const premEl = document.getElementById('stat-premium-users');
        if (totalEl) totalEl.innerText = String(allAdminUsers.length);
        if (premEl) {
            const premCount = allAdminUsers.filter(u => u.type === 'Premium' || u.isAdmin).length;
            premEl.innerText = String(premCount);
        }
    }

    function renderAdminPremiumList(users) {
        const adminUsersList = document.getElementById('admin-users-list');
        if (!adminUsersList) return;

        adminUsersList.innerHTML = '';
        if (!users || users.length === 0) {
            adminUsersList.innerHTML = '<p style="text-align: center; opacity: 0.6; font-size: 13px; margin: 20px 0;">No matching users found.</p>';
            return;
        }

        users.forEach(user => {
            const currentTier = user.type === 'Premium' ? 'Premium' : 'Basic';
            const activeIndex = Math.max(0, ADMIN_USER_TIERS.findIndex(t => t.value === currentTier));

            const item = document.createElement('div');
            item.style.cssText = 'background: rgba(255, 255, 255, 0.04); border: 1px solid var(--glass-border); border-radius: 14px; padding: 12px 14px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;';

            const adminTag = user.isAdmin ? ' <span style="font-size: 11px; opacity: 0.85;">👑</span>' : '';
            const sliderHtml = `
                <div class="tier-slider" data-uid="${escapeHTML(user.uid)}">
                    <div class="tier-slider-thumb" style="width: calc((100% - 6px) / ${ADMIN_USER_TIERS.length}); transform: translateX(${activeIndex * 100}%); background: ${ADMIN_USER_TIERS[activeIndex].color};"></div>
                    ${ADMIN_USER_TIERS.map((t, idx) => `
                        <button type="button" class="tier-slider-btn ${idx === activeIndex ? 'active' : ''}" data-tier="${t.value}" data-index="${idx}">${t.label}</button>
                    `).join('')}
                </div>
            `;

            item.innerHTML = `
                <div style="min-width: 0; flex: 1;">
                    <strong style="display: block; font-size: 14px;">${escapeHTML(user.username)}${adminTag}</strong>
                    <small style="display: block; opacity: 0.6; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(user.email || 'No email')}</small>
                </div>
                ${sliderHtml}
            `;

            const sliderEl = item.querySelector('.tier-slider');
            const thumbEl = item.querySelector('.tier-slider-thumb');
            const btns = item.querySelectorAll('.tier-slider-btn');

            const applySliderVisual = (idx) => {
                if (thumbEl) {
                    thumbEl.style.transform = `translateX(${idx * 100}%)`;
                    thumbEl.style.background = ADMIN_USER_TIERS[idx].color;
                }
                btns.forEach((b, bIdx) => b.classList.toggle('active', bIdx === idx));
            };

            btns.forEach(btn => {
                btn.onclick = async () => {
                    const newType = btn.dataset.tier;
                    const newIdx = Number(btn.dataset.index);
                    const prevTier = user.type === 'Premium' ? 'Premium' : 'Basic';
                    const prevIdx = Math.max(0, ADMIN_USER_TIERS.findIndex(t => t.value === prevTier));
                    if (!newType || newType === prevTier) return;

                    applySliderVisual(newIdx);
                    sliderEl.style.pointerEvents = 'none';
                    const ok = await updateUserType(user.uid, newType);
                    sliderEl.style.pointerEvents = '';

                    if (ok) {
                        user.type = newType;
                        updateAdminUserStats();
                        if (typeof showNotification === 'function') {
                            showNotification(`${user.username} updated to ${newType}.`, "success");
                        }
                    } else {
                        applySliderVisual(prevIdx);
                    }
                };
            });

            adminUsersList.appendChild(item);
        });

        if (window.twemoji) twemoji.parse(adminUsersList);
    }

    const adminPremiumSearchInput = document.getElementById('admin-premium-search');
    if (adminPremiumSearchInput) {
        adminPremiumSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            const filtered = allAdminUsers.filter(u => {
                const nameMatch = (u.username || '').toLowerCase().includes(query) || (u.fullUsername || '').toLowerCase().includes(query);
                const emailMatch = (u.email || '').toLowerCase().includes(query);
                return nameMatch || emailMatch;
            });
            renderAdminPremiumList(filtered);
        });
    }

    async function openAdminPanelModal() {
        closeAnimatedModal(document.getElementById('profile-modal')); // Close profile modal
        document.getElementById('admin-panel-modal').style.display = 'flex';
        setActiveAdminTab('users');

        if (adminPremiumSearchInput) {
            adminPremiumSearchInput.value = '';
        }

        const isGlobalAdmin = window.currentUserData && (
            window.currentUserData.role === 'admin' ||
            window.currentUserData.isAdmin === true ||
            String(window.currentUserData.isAdmin).toLowerCase() === 'true'
        );
        if (isGlobalAdmin) {
            detachAdminRequestsListener();
            const requestsList = document.getElementById('admin-requests-list');
            if (requestsList) {
                requestsList.innerHTML = '<p style="text-align: center; opacity: 0.7; font-size: 13px;">Loading requests...</p>';
            }
            activeAdminRequestsOff = onValue(ref(db, 'adminRequests'), (snap) => {
                renderAdminRequests(snap.val());
            }, (err) => {
                console.error("[AdminRequests] Listener error:", err);
                if (requestsList) {
                    requestsList.innerHTML = '<p style="text-align: center; color: #ff6b6b; font-size: 13px;">Failed to load requests.</p>';
                }
            });
        }

        const adminUsersList = document.getElementById('admin-users-list');
        adminUsersList.innerHTML = '<p style="text-align: center; opacity: 0.7;">Loading users...</p>';

        const usersSnap = await get(ref(db, 'users'));
        const usersData = usersSnap.val();

        if (!usersData) {
            allAdminUsers = [];
            updateAdminUserStats();
            adminUsersList.innerHTML = '<p style="text-align: center; opacity: 0.7;">No users found.</p>';
            return;
        }

        allAdminUsers = Object.entries(usersData).map(([uid, rawUser]) => {
            const u = rawUser || {};
            const fullUsername = String(u.displayName || u.username || u.name || (u.email ? u.email.split('@')[0] : 'User'));
            const isAdmin = u.role === 'admin' || u.isAdmin === true || String(u.isAdmin).toLowerCase() === 'true';
            return {
                uid,
                username: fullUsername.substring(0, 15),
                fullUsername,
                email: u.email || '',
                type: u.type === 'Premium' ? 'Premium' : 'Basic',
                isAdmin
            };
        }).sort((a, b) => a.username.localeCompare(b.username));

        updateAdminUserStats();
        renderAdminPremiumList(allAdminUsers);
    }

    async function updateUserType(targetUid, newType) {
        try {
            await update(ref(db, `users/${targetUid}`), {
                type: newType
            });
            return true;
        } catch (err) {
            console.error("Error updating user type:", err);
            showNotification("Failed to update user type", "error");
            return false;
        }
    }

/* ---------------- GROUP DETAILS / INFO BOTTOM SHEET ---------------- */

function openAddMembersModal(chatId) {
    const modal = document.getElementById('add-members-to-group-modal');
    if (!modal) return;
    modal.dataset.chatId = chatId;
    selectedNewGroupMembers = [];
    openAnimatedModal(modal);
    populateAddMembersSelection(chatId);
}

async function openGroupInfoModal(chatId, chatData) {
    const modal = document.getElementById('group-info-modal');
    if (!modal) return;

    const avatarEl = document.getElementById('group-info-avatar');
    const titleEl = document.getElementById('group-info-title');
    const descEl = document.getElementById('group-info-description');
    const statsEl = document.getElementById('group-info-stats');
    const countEl = document.getElementById('group-info-members-count');
    const listEl = document.getElementById('group-info-members-list');
    const editBtn = document.getElementById('group-info-edit-btn');
    const addMembersBtn = document.getElementById('group-info-add-members-btn');
    const copyInviteBtn = document.getElementById('group-info-copy-invite-btn');

    titleEl.innerText = chatData.title || 'Group';
    descEl.innerText = chatData.description || 'No description provided.';
    descEl.style.display = chatData.description ? 'block' : 'none';

    const groupPic = chatData.profilePic || (chatData.groupId ? groupProfilePics.get(chatData.groupId) : null);
    if (groupPic) {
        avatarEl.innerHTML = `<img src="${groupPic}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" loading="lazy">`;
    } else {
        avatarEl.innerText = chatData.isChannel ? '\u{1F4E2}' : '\u{1F465}';
    }

    const myUid = auth.currentUser?.uid;
    const isCreator = myUid && myUid === chatData.creatorId;
    const myRole = currentChatMemberData?.[myUid]?.role;
    const isAdmin = isCreator || myRole === 'admin';

    if (editBtn) {
        editBtn.style.display = isCreator ? 'inline-flex' : 'none';
        editBtn.onclick = () => {
            closeAnimatedModal(modal, () => {
                openEditGroupModal(chatId, chatData.title, chatData.description, chatData.creatorId);
            });
        };
    }

    if (addMembersBtn) {
        addMembersBtn.style.display = (chatData.isChannel && !isAdmin) ? 'none' : 'inline-flex';
        addMembersBtn.onclick = () => {
            closeAnimatedModal(modal, () => {
                openAddMembersModal(chatId);
            });
        };
    }

    if (copyInviteBtn) {
        copyInviteBtn.onclick = () => {
            const link = generateInviteLink(chatId);
            navigator.clipboard.writeText(link).then(() => {
                showNotification("Invite link copied to clipboard!", "success");
            }).catch(() => {
                showNotification(link, "info");
            });
        };
    }

    const groupId = chatData.groupId || chatId;
    const inviteBtn = document.getElementById('group-info-invite-btn');
    if (inviteBtn) {
        inviteBtn.onclick = async () => {
            let friendIdInput = null;
            if (typeof showConfirm === 'function') {
                friendIdInput = await showConfirm("Invite Member", "Enter Orion Friend ID to invite:", true, "", "Invite", "Cancel");
            } else {
                friendIdInput = window.prompt("Enter Orion Friend ID to invite:");
            }
            if (friendIdInput && friendIdInput.trim()) {
                await window.inviteToGroup(groupId, friendIdInput.trim());
                openGroupInfoModal(chatId, chatData);
            }
        };
    }

    listEl.innerHTML = '<div style="text-align: center; padding: 20px; opacity: 0.5;">Loading members...</div>';

    try {
        const membersSnap = await get(ref(db, `members/${chatId}`));
        const membersMap = membersSnap.val() || {};
        const memberUids = Object.keys(membersMap);
        if (countEl) countEl.innerText = memberUids.length;
        if (statsEl) statsEl.innerText = `${memberUids.length} member${memberUids.length !== 1 ? 's' : ''} \u2022 ${chatData.isChannel ? 'Broadcast Channel' : 'Group Chat'}`;

        const groupSnap = await get(ref(db, `groups/${groupId}`));
        const groupData = groupSnap.val() || {};
        const mutedUsers = groupData.mutedUsers || {};

        const myRole = membersMap[myUid]?.role || currentChatMemberData?.[myUid]?.role || 'member';
        const isAdmin = isCreator || myRole === 'admin';
        const isMod = myRole === 'mod';
        const canModerate = isAdmin || isMod;

        if (canModerate && myUid) {
            update(ref(db, `groups/${groupId}/roles`), {
                [myUid]: isAdmin ? 'admin' : 'mod'
            }).catch(() => {});
        }

        const detailsPromises = memberUids.map(async (uid) => {
            const uSnap = await get(ref(db, `users/${uid}`));
            const uData = uSnap.val() || {};
            const displayName = getDisplayName(uData);
            const isGlobalAdmin = uData.role === 'admin' || uData.isAdmin === true || String(uData.isAdmin).toLowerCase() === "true";
            return {
                uid,
                displayName: displayName,
                username: displayName || uData.username || '',
                profilePic: uData.profilePic,
                role: membersMap[uid]?.role || 'member',
                isCreator: uid === chatData.creatorId,
                isGlobalAdmin,
                status: uData.status,
                isOnline: uData.status === 'online'
            };
        });
        const details = await Promise.all(detailsPromises);
        details.sort((a, b) => {
            const aOnline = (a.status === 'online' || a.isOnline) ? 1 : 0;
            const bOnline = (b.status === 'online' || b.isOnline) ? 1 : 0;
            if (bOnline !== aOnline) {
                return bOnline - aOnline;
            }
            if (a.isCreator !== b.isCreator) return a.isCreator ? -1 : 1;
            return (a.username || a.displayName || '').localeCompare(b.username || b.displayName || '');
        });

        listEl.innerHTML = '';
        for (const m of details) {
            const roleInfo = getGroupRoleInfo(m.role);
            const badgeHtml = (roleInfo && roleInfo.badge) ? `<span class="custom-user-badge" style="border-color: ${roleInfo.color}55; color: ${roleInfo.color};">${roleInfo.badge}</span>` : '';
            const row = document.createElement('div');
            row.className = 'member-item';
            row.style.cssText = 'display: flex; align-items: center; padding: 10px 12px; gap: 12px; cursor: pointer; border-radius: 12px; transition: background 0.2s;';
            row.innerHTML = `
                <div class="member-avatar-container" style="position: relative; width: 36px; height: 36px; flex-shrink: 0;">
                    ${m.profilePic ? `<img src="${m.profilePic}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" loading="lazy">` : `<div class="avatar-sm">\u{1F464}</div>`}
                    <span class="status-dot ${m.status === 'online' ? 'online' : ''}"></span>
                </div>
                <div style="flex: 1; min-width: 0; display: flex; flex-direction: column;">
                    <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                        <span style="font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(m.displayName)}</span>
                        ${badgeHtml}
                    </div>
                    ${m.isCreator ? '<span style="font-size: 11px; color: #ffd700; font-weight: 600;">Group Creator</span>' : (m.role === 'admin' ? '<span style="font-size: 11px; color: #ff4d6d; font-weight: 600;">Admin</span>' : '')}
                </div>
            `;
            if (canModerate && m.uid !== myUid && !m.isCreator && !m.isGlobalAdmin) {
                const muteEntry = mutedUsers[m.uid];
                const isMuted = muteEntry === true || (muteEntry && typeof muteEntry === 'object' && muteEntry.mutedUntil > Date.now());
                const muteBtn = document.createElement('button');
                muteBtn.className = 'glass-btn-secondary mute-toggle-btn';
                muteBtn.style.cssText = `padding: 4px 10px; font-size: 12px; border-radius: 8px; margin-left: auto; cursor: pointer; flex-shrink: 0; background: ${isMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.08)'}; color: ${isMuted ? '#f87171' : '#fff'}; border: 1px solid ${isMuted ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 255, 255, 0.15)'}; font-weight: 600;`;
                muteBtn.innerText = isMuted ? 'Unmute' : 'Mute';
                muteBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (isMuted) {
                        await window.unmuteUser(groupId, m.uid);
                        mutedUsers[m.uid] = null;
                        muteBtn.innerText = 'Mute';
                        muteBtn.style.background = 'rgba(255, 255, 255, 0.08)';
                        muteBtn.style.color = '#fff';
                        muteBtn.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                    } else {
                        window.openMuteModal(groupId, m.uid, m.displayName);
                    }
                };
                row.appendChild(muteBtn);
            }
            twemoji.parse(row);
            row.onclick = () => {
                closeAnimatedModal(modal, () => {
                    showUserProfile(m.uid, chatId, chatData.creatorId);
                });
            };
            listEl.appendChild(row);
        }
    } catch (err) {
        console.error("Error populating group info members:", err);
        listEl.innerHTML = '<div style="text-align: center; padding: 20px; opacity: 0.5;">Could not load members.</div>';
    }

    openAnimatedModal(modal);
}

async function handleChatHeaderClick() {
    if (!currentChatId) return;
    try {
        const chatSnap = await get(ref(db, `chats/${currentChatId}`));
        const chatData = chatSnap.val();
        if (!chatData) return;

        if (chatData.isGroup) {
            openGroupInfoModal(currentChatId, chatData);
        } else {
            // Direct message: find partner UID and open their profile view
            const membersSnap = await get(ref(db, `members/${currentChatId}`));
            const members = membersSnap.val() || {};
            const partnerUid = Object.keys(members).find(uid => uid !== auth.currentUser?.uid);
            if (partnerUid) {
                showUserProfile(partnerUid, currentChatId);
            }
        }
    } catch (e) {
        console.error("Error opening chat details:", e);
    }
}

// Wire header click listeners
const headerInfoEl = document.getElementById('chat-header-info');
if (headerInfoEl) headerInfoEl.onclick = handleChatHeaderClick;

const headerMenuBtnEl = document.getElementById('chat-header-menu-btn');
if (headerMenuBtnEl) headerMenuBtnEl.onclick = handleChatHeaderClick;

const closeGroupInfoModalBtn = document.getElementById('close-group-info-modal');
if (closeGroupInfoModalBtn) closeGroupInfoModalBtn.onclick = () => closeAnimatedModal(document.getElementById('group-info-modal'));

const closeGroupInfoBtn = document.getElementById('close-group-info-btn');
if (closeGroupInfoBtn) closeGroupInfoBtn.onclick = () => closeAnimatedModal(document.getElementById('group-info-modal'));

window.openGroupInfoModal = openGroupInfoModal;
window.handleChatHeaderClick = handleChatHeaderClick;

function openEditGroupModal(chatId, currentName, currentDescription, groupCreatorId) {
    const modal = document.getElementById('edit-group-modal');
    document.getElementById('edit-group-name').value = currentName;
    document.getElementById('edit-group-description').value = currentDescription || '';
    modal.dataset.chatId = chatId;
    modal.dataset.creatorId = groupCreatorId;
    modal.style.display = 'flex';
    document.getElementById('delete-group-area').style.display = (auth.currentUser.uid === groupCreatorId) ? 'block' : 'none';
    
    // Populate visibility and link
    get(ref(db, `chats/${chatId}`)).then(snap => {
        const data = snap.val();
        setChatVisibility(!!data.isPublic);
        document.getElementById('chat-invite-link').value = generateInviteLink(chatId);
        if (data.profilePic) {
            document.getElementById('edit-chat-avatar').innerHTML = `<img src="${data.profilePic}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
        } else {
            document.getElementById('edit-chat-avatar').innerText = data.isChannel ? '\u{1F4E2}' : '\u{1F465}';
        }
    });

    document.getElementById('copy-invite-link-btn').onclick = () => {
        navigator.clipboard.writeText(document.getElementById('chat-invite-link').value);
        showNotification("Invite link copied!", "success");
    };

    document.getElementById('delete-group-btn').onclick = () => {
        closeAnimatedModal(document.getElementById('edit-group-modal'));
        deleteGroup(chatId);
    };
}

document.getElementById('close-edit-group-modal').onclick = () => {
    closeAnimatedModal(document.getElementById('edit-group-modal'));
    document.getElementById('edit-group-modal').removeAttribute('data-chatId');
    document.getElementById('edit-group-modal').removeAttribute('data-creatorId');
    document.getElementById('edit-group-modal').removeAttribute('data-newPic');
    document.getElementById('edit-chat-avatar').innerText = '\u{1F464}';
};

document.getElementById('save-group-details-btn').onclick = async () => {
    const modal = document.getElementById('edit-group-modal');
    const chatId = modal.dataset.chatId;
    const groupCreatorId = modal.dataset.creatorId;
    if (auth.currentUser.uid !== groupCreatorId) {
        showNotification("Only the creator can edit group details.", "error");
        return;
    }
    const newName = document.getElementById('edit-group-name').value.trim();
    const newDescription = document.getElementById('edit-group-description').value.trim();

    if (!newName) {
        showNotification("Group name cannot be empty.", "info");
        return;
    }

    try {
        const chatSnap = await get(ref(db, `chats/${chatId}`));
        const chatData = chatSnap.val();
        const updates = {};

        const baseUpdate = {
            groupTitle: newName,
            isPublic: modal.dataset.isPublic === "true"
        };
        if (modal.dataset.newPic) baseUpdate.profilePic = modal.dataset.newPic;

        if (chatData.isGroup && chatData.groupId) {
            const currentPic = modal.dataset.newPic || chatData.profilePic;
            if (currentPic) {
                updates[`/groups/${chatData.groupId}/profilePic`] = currentPic;
            }
            // Sync changes to ALL chats in this group
            const allChatsSnap = await get(query(ref(db, 'chats'), orderByChild('groupId'), equalTo(chatData.groupId)));
            allChatsSnap.forEach(snap => {
                const cid = snap.key;
                const cData = snap.val();
                const thisUpdate = { ...baseUpdate };
                
                // Only update the 'main' title and description for the specific chat being edited
                if (cid === chatId) {
                    thisUpdate.title = newName;
                    thisUpdate.description = newDescription;
                }
                
                updates[`/chats/${cid}`] = { ...cData, ...thisUpdate };
            });
        } else {
            updates[`/chats/${chatId}`] = { ...chatData, title: newName, description: newDescription, ...baseUpdate };
        }

        await update(ref(db), updates);
        closeAnimatedModal(document.getElementById('edit-group-modal'));
    } catch (err) {
        console.error(err);
        showNotification("Failed to save group details", "error");
    }
};

async function removeMemberFromGroup(chatId, memberUid) {
    try {
        const updates = {};
        updates[`/members/${chatId}/${memberUid}`] = null; // Remove member from group
        updates[`/user_chats/${memberUid}/${chatId}`] = null; // Remove chat from user's chat list
        updates[`/unread/${memberUid}/${chatId}`] = null; // Clear their unread status for this group

        await update(ref(db), updates);
        showNotification("Member removed successfully!", "success");
    } catch (err) {
        console.error("Error removing member:", err);
        showNotification("Failed to remove member", "error");
    }
}

/* ---------------- ADD MEMBERS TO GROUP MODAL ---------------- */

async function populateAddMembersSelection(currentChatId) {
    const myUid = auth.currentUser.uid;
    const selectionDiv = document.getElementById('add-members-selection');
    selectionDiv.innerHTML = '';
    document.getElementById('add-members-selected-list').innerHTML = '';

    // Get current group members
    const currentMembersSnap = await get(ref(db, `members/${currentChatId}`));
    const currentMembers = currentMembersSnap.val() ? Object.keys(currentMembersSnap.val()) : [];

    const snap = await get(ref(db, `friends/${myUid}`));
    const friends = snap.val();
    if (!friends) return;

    for (const fUid of Object.keys(friends)) {
        // Only show friends who are not already in the group
        if (!currentMembers.includes(fUid) && !selectedNewGroupMembers.includes(fUid)) {
            const uSnap = await get(ref(db, `users/${fUid}`));
            const user = uSnap.val();
            if (!user) continue;

            const item = document.createElement('div');
            item.className = 'selection-item';
            item.innerText = getDisplayName(user);
            item.onclick = () => {
                if (!selectedNewGroupMembers.includes(fUid)) {
                    selectedNewGroupMembers.push(fUid);
                    renderSelectedNewMembersTags();
                    populateAddMembersSelection(currentChatId);
                }
            };
            selectionDiv.appendChild(item);
        }
    }
}

function renderSelectedNewMembersTags() {
    const list = document.getElementById('add-members-selected-list');
    list.innerHTML = '';
    selectedNewGroupMembers.forEach(uid => {
        get(ref(db, `users/${uid}`)).then(snap => {
            const uData = snap.val();
            const name = getDisplayName(uData);
            const tag = document.createElement('span');
            tag.className = 'tag';
            tag.innerText = name;
            tag.onclick = () => {
                selectedNewGroupMembers = selectedNewGroupMembers.filter(id => id !== uid);
                renderSelectedNewMembersTags();
                populateAddMembersSelection(currentChatId);
            };
            list.appendChild(tag);
        });
    });
}

document.getElementById('add-members-to-group-btn').onclick = () => {
    const chatId = document.getElementById('edit-group-modal').dataset.chatId;
    const groupCreatorId = document.getElementById('edit-group-modal').dataset.creatorId;
    if (auth.currentUser.uid !== groupCreatorId) {
        showNotification("Only the group creator can add members.", "error");
        return;
    }

    closeAnimatedModal(document.getElementById('edit-group-modal')); // Close edit modal
    document.getElementById('add-members-to-group-modal').dataset.chatId = chatId; // Store chatId
    selectedNewGroupMembers = []; // Reset selection only when opening the modal
    document.getElementById('add-members-to-group-modal').style.display = 'flex';
    populateAddMembersSelection(chatId);
};

document.getElementById('close-add-members-modal').onclick = () => {
    closeAnimatedModal(document.getElementById('add-members-to-group-modal'));
    document.getElementById('add-members-to-group-modal').removeAttribute('data-chatId');
};

document.getElementById('confirm-add-members-btn').onclick = async () => {
    const chatId = document.getElementById('add-members-to-group-modal').dataset.chatId;
    if (selectedNewGroupMembers.length === 0) {
        showNotification("Select at least one member to add.", "info");
        return;
    }

    const chatSnap = await get(ref(db, `chats/${chatId}`));
    const chatData = chatSnap.val();
    if (auth.currentUser.uid !== chatData?.creatorId) {
        showNotification("Only the creator can add members.", "error");
        return;
    }

    const updates = {};
    selectedNewGroupMembers.forEach(uid => {
        updates[`/user_chats/${uid}/${chatId}`] = true;
        updates[`/members/${chatId}/${uid}`] = true;
    });

    try {
        await update(ref(db), updates);
        showNotification("Members added successfully!", "success");
        closeAnimatedModal(document.getElementById('add-members-to-group-modal'));
        // Optionally, re-open the edit group modal or refresh the chat members list
        // For now, we'll just close the add members modal.
    } catch (err) {
        console.error(err);
        showNotification("Failed to add members", "error");
    }
};

/* ---------------- GROUP MODERATOR ACTIONS (MUTE & INVITE) ---------------- */

window.openMuteModal = function(groupId, targetUserId, targetUsername) {
    let modal = document.getElementById('mute-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'mute-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;backdrop-filter:blur(4px);';
    modal.innerHTML = `
        <div style="background:#1e1e2a;border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:20px;max-width:340px;width:100%;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,0.5);">
            <h3 style="margin:0 0 16px 0;font-size:18px;text-align:center;color:#ff4757;">Mute ${targetUsername}</h3>
            
            <label style="display:block;margin-bottom:6px;font-size:13px;opacity:0.8;">Duration</label>
            <div id="mute-duration-container" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
                <button type="button" class="mute-pill active" data-val="900000" style="flex:1;min-width:70px;padding:8px;background:#ff4757;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">15m</button>
                <button type="button" class="mute-pill" data-val="3600000" style="flex:1;min-width:70px;padding:8px;background:rgba(255,255,255,0.1);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;">1h</button>
                <button type="button" class="mute-pill" data-val="86400000" style="flex:1;min-width:70px;padding:8px;background:rgba(255,255,255,0.1);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;">24h</button>
                <button type="button" class="mute-pill" data-val="604800000" style="flex:1;min-width:70px;padding:8px;background:rgba(255,255,255,0.1);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;">1w</button>
                <button type="button" class="mute-pill" data-val="4102444800000" style="flex:1;min-width:70px;padding:8px;background:rgba(255,255,255,0.1);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;">Perm</button>
            </div>
            <input type="hidden" id="mute-duration-val" value="900000">

            <label style="display:block;margin-bottom:6px;font-size:13px;opacity:0.8;">Reason</label>
            <input type="text" id="mute-reason" placeholder="e.g., Spamming, Toxic behavior..." autocomplete="off" style="width:100%;padding:10px;margin-bottom:20px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;outline:none;font-size:14px;box-sizing:border-box;">

            <div style="display:flex;gap:10px;">
                <button type="button" onclick="document.getElementById('mute-modal').remove()" style="flex:1;padding:10px;border-radius:8px;border:none;background:rgba(255,255,255,0.1);color:#fff;cursor:pointer;font-weight:600;">Cancel</button>
                <button type="button" onclick="confirmMute('${groupId}', '${targetUserId}')" style="flex:1;padding:10px;border-radius:8px;border:none;background:#ff4757;color:#fff;cursor:pointer;font-weight:600;">Mute User</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const pills = document.querySelectorAll('.mute-pill');
    pills.forEach(pill => {
        pill.onclick = function() {
            pills.forEach(p => { p.style.background = 'rgba(255,255,255,0.1)'; p.style.fontWeight = 'normal'; p.classList.remove('active'); });
            this.style.background = '#ff4757';
            this.style.fontWeight = '600';
            this.classList.add('active');
            document.getElementById('mute-duration-val').value = this.getAttribute('data-val');
        };
    });

    const reasonInput = document.getElementById('mute-reason');
    if (reasonInput) {
        reasonInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.confirmMute(groupId, targetUserId);
            }
        });
        reasonInput.focus();
    }
};

window.confirmMute = async function(groupId, targetUserId) {
    const durationMs = parseInt(document.getElementById('mute-duration-val').value);
    const reason = document.getElementById('mute-reason').value.trim() || "No reason provided";
    const mutedUntil = Date.now() + durationMs;

    try {
        const uSnap = await get(ref(db, `users/${targetUserId}`));
        const uVal = uSnap.val() || {};
        if (uVal.role === 'admin' || uVal.isAdmin === true || String(uVal.isAdmin).toLowerCase() === "true") {
            showNotification("Global admins cannot be muted.", "error");
            const modal = document.getElementById('mute-modal');
            if (modal) modal.remove();
            return;
        }

        await update(ref(db, `groups/${groupId}/mutedUsers/${targetUserId}`), {
            mutedUntil: mutedUntil,
            reason: reason,
            mutedBy: auth.currentUser.uid,
            timestamp: Date.now()
        });
        const modal = document.getElementById('mute-modal');
        if (modal) modal.remove();
        showNotification("User muted successfully", "success");
    } catch (err) {
        showNotification("Failed to mute user. Are you a mod?", "error");
    }
};

window.unmuteUser = async function(groupId, targetUserId) {
    try {
        await update(ref(db, `groups/${groupId}/mutedUsers`), {
            [targetUserId]: null
        });
        showNotification("User unmuted", "success");
    } catch (err) {
        showNotification("Failed to unmute user", "error");
    }
};

window.toggleUserMute = async function(groupId, targetUserId, muteStatus) {
    if (muteStatus) {
        window.openMuteModal(groupId, targetUserId, "User");
    } else {
        await window.unmuteUser(groupId, targetUserId);
    }
};

window.inviteToGroup = async function(groupId, friendId) {
    try {
        const cleanCode = String(friendId).trim();
        // Look up friend UID by friendID code
        let userQuery = query(ref(db, 'users'), orderByChild('friendID'), equalTo(cleanCode));
        let snapshot = await get(userQuery);
        if (!snapshot.exists()) {
            userQuery = query(ref(db, 'users'), orderByChild('friendId'), equalTo(cleanCode));
            snapshot = await get(userQuery);
        }
        if (!snapshot.exists()) {
            userQuery = query(ref(db, 'users'), orderByChild('friendId'), equalTo(cleanCode.toUpperCase()));
            snapshot = await get(userQuery);
        }
        if (!snapshot.exists()) return showNotification("User not found", "error");
        
        const targetUid = Object.keys(snapshot.val())[0];
        await update(ref(db, `groups/${groupId}/members`), {
            [targetUid]: true
        });

        // Also sync membership to /members/ and /user_chats/ so the invited member has instant access in UI
        try {
            const chatSnap = await get(ref(db, `chats/${groupId}`));
            if (chatSnap.exists()) {
                await update(ref(db), {
                    [`/members/${groupId}/${targetUid}`]: { role: 'member' },
                    [`/user_chats/${targetUid}/${groupId}`]: true
                });
            } else {
                const groupChatsSnap = await get(query(ref(db, 'chats'), orderByChild('groupId'), equalTo(groupId)));
                if (groupChatsSnap.exists()) {
                    const extraUpdates = {};
                    groupChatsSnap.forEach(snap => {
                        const cid = snap.key;
                        extraUpdates[`/members/${cid}/${targetUid}`] = { role: 'member' };
                        extraUpdates[`/user_chats/${targetUid}/${cid}`] = true;
                    });
                    await update(ref(db), extraUpdates);
                }
            }
        } catch (e) {
            console.warn("Extra sync for inviteToGroup:", e);
        }

        showNotification("User added to group!", "success");
    } catch (err) {
        console.error("inviteToGroup error:", err);
        showNotification("Failed to add user", "error");
    }
};

/* ---------------- QR SCANNER ---------------- */

async function stopScanner() {
    if (html5QrCode) {
        try {
            await html5QrCode.stop();
        } catch (err) {
            console.warn("Scanner stop error:", err);
        }
        html5QrCode = null;
    }
    const btn = document.getElementById('toggle-scanner-btn');
    if (btn) btn.innerText = "📷 Open Camera";
}

const qrScannerBtn = document.getElementById('toggle-scanner-btn');
const qrFileInput = document.getElementById('qr-file-input');

if (qrScannerBtn && qrFileInput) {
    qrScannerBtn.onclick = () => {
        qrFileInput.click(); // Triggers native Android camera
    };

    qrFileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode("reader");
        }

        try {
            qrScannerBtn.innerText = "Scanning...";
            const decodedText = await html5QrCode.scanFile(file, true);
            
            if (decodedText) {
                const code = decodedText.trim().toUpperCase();
                const q = query(ref(db, 'users'), orderByChild('friendId'), equalTo(code));
                const snap = await get(q);
                
                if (snap.exists()) {
                    addFriend(auth.currentUser.uid, Object.keys(snap.val())[0]);
                    closeAnimatedModal(document.getElementById('add-friend-modal'));
                } else {
                    showNotification("User not found for this QR code.", "error");
                }
            }
        } catch (err) {
            console.error("[QR Scanner] File scan error:", err);
            showNotification("No readable QR code found in photo.", "error");
        } finally {
            qrFileInput.value = '';
            qrScannerBtn.innerText = "📷 Open Camera";
        }
    };
}

// --- Sticker Picker Logic ---
async function openStickerPicker() {
    document.getElementById('sticker-picker-modal').style.display = 'flex';
    renderStickerPicker();
}

async function renderStickerPicker() {
    const myUid = auth.currentUser.uid;
    const myStickersGrid = document.getElementById('my-stickers-picker-grid');
    const allowedStickersGrid = document.getElementById('allowed-stickers-grid');
    myStickersGrid.innerHTML = '';
    allowedStickersGrid.innerHTML = '';

    const userStickersSnap = await get(ref(db, `user_stickers/${myUid}`));
    if (!userStickersSnap.exists()) return;
    
    const stickerEntries = Object.entries(userStickersSnap.val());

    for (const [stickerId, data] of stickerEntries) {
        const stickerMetaSnap = await get(ref(db, `sticker_metadata/${stickerId}`));
        const stickerMeta = stickerMetaSnap.val();
        if (!stickerMeta) continue;

        const card = createStickerCard(stickerId, stickerMeta);
        if (data.type === 'owned') {
            myStickersGrid.appendChild(card);
        } else if (data.type === 'allowed') {
            allowedStickersGrid.appendChild(card);
        }
    }
}

function createStickerCard(stickerId, stickerMeta) {
    const card = document.createElement('div');
    card.className = 'sticker-card';
    // In a real app, stickerUrl would be a signed URL from a Cloud Function
    const stickerUrl = stickerMeta.thumbnailStoragePath || stickerMeta.storagePath; // Use thumbnail if available
    card.innerHTML = `<img src="${stickerUrl}" alt="${getStickerDisplayName(stickerMeta)}">`;
    card.title = getStickerDisplayName(stickerMeta);
    card.onclick = () => {
        currentStickerPickerMessageId = stickerId;
        sendMessage(); // Send the sticker
    };
    return card;
}

document.getElementById('close-sticker-picker').onclick = () => {
    closeAnimatedModal(document.getElementById('sticker-picker-modal'));
};

// --- Sticker Request System ---
async function openStickerRequestModal(stickerId, ownerId, stickerName) {
    const myUid = auth.currentUser.uid;
    if (ownerId === myUid) {
        showNotification("You already own this sticker!", "info");
        return;
    }

    const confirmed = await showConfirm("Request Sticker", `Do you want to request permission to use "${stickerName}" from its owner?`);
    if (!confirmed) return;

    const requesterName = document.getElementById('current-user-name').innerText;
    const requestId = push(ref(db, `sticker_requests/${ownerId}`)).key;
    
    const requestData = {
        stickerId: stickerId,
        requesterId: myUid,
        requesterName: requesterName,
        status: 'pending',
        createdAt: serverTimestamp()
    };

    try {
        await set(ref(db, `sticker_requests/${ownerId}/${requestId}`), requestData);
        showNotification(`Request for "${stickerName}" sent to owner.`, "success");
    } catch (error) {
        console.error("Error sending sticker request:", error);
        showNotification("Failed to send sticker request.", "error");
    }
}

// Listener for incoming sticker requests (for the owner)
onAuthStateChanged(auth, (user) => {
    if (window.Capacitor?.isPluginAvailable('CapacitorUpdater')) {
        window.Capacitor.Plugins.CapacitorUpdater.notifyAppReady();
    }
    if (user) {
        onChildAdded(ref(db, `sticker_requests/${user.uid}`), (snap) => {
            const request = snap.val();
            if (request.status === 'pending') {
                displayStickerRequestNotification(snap.key, request);
            }
        });
    }
});

function displayStickerRequestNotification(requestId, request) {
    currentStickerRequest = { requestId, ...request };
    const modal = document.getElementById('sticker-request-notification-modal');
    const messageElem = document.getElementById('sticker-request-message');
    messageElem.innerText = `${request.requesterName} wants permission to use your sticker.`;
    modal.style.display = 'flex';
}

document.getElementById('approve-sticker-request-btn').onclick = async () => {
    if (!currentStickerRequest) return;
    const { requestId, stickerId, requesterId, ownerId } = currentStickerRequest;
    const myUid = auth.currentUser.uid;

    const updates = {};
    updates[`/user_stickers/${requesterId}/${stickerId}`] = {
        type: 'allowed',
        metadataRef: stickerId,
        approvedAt: serverTimestamp()
    };
    updates[`/sticker_requests/${myUid}/${requestId}/status`] = 'approved';

    try {
        await update(ref(db), updates);
        showNotification(`Approved sticker request for ${currentStickerRequest.requesterName}.`, "success");
    } catch (error) {
        console.error("Error approving sticker request:", error);
        showNotification("Failed to approve request.", "error");
    } finally {
        closeAnimatedModal(document.getElementById('sticker-request-notification-modal'));
        currentStickerRequest = null;
    }
};

document.getElementById('deny-sticker-request-btn').onclick = async () => {
    if (!currentStickerRequest) return;
    const { requestId, requesterId, ownerId } = currentStickerRequest;
    const myUid = auth.currentUser.uid;

    try {
        await update(ref(db, `sticker_requests/${myUid}/${requestId}`), { status: 'denied' });
        showNotification(`Denied sticker request from ${currentStickerRequest.requesterName}.`, "info");
        // Optionally, send a notification to the requester about the denial
    } catch (error) {
        console.error("Error denying sticker request:", error);
        showNotification("Failed to deny request.", "error");
    } finally {
        closeAnimatedModal(document.getElementById('sticker-request-notification-modal'));
        currentStickerRequest = null;
    }
};

document.getElementById('close-sticker-request-notification-modal').onclick = () => {
    closeAnimatedModal(document.getElementById('sticker-request-notification-modal'));
    currentStickerRequest = null;
};

/* ---------------- MEMBERS PANEL ---------------- */

document.getElementById('open-members-panel').onclick = (e) => {
    e.stopPropagation(); // Prevent the toggle click from immediately triggering the "click outside" listener
    document.body.classList.toggle('members-open');
    if (typeof window.positionReplyPreview === 'function') window.positionReplyPreview();
};

// Close members panel when clicking outside on mobile
document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('members-open')) return;

    const path = e.composedPath();
    
    // Check if the click path includes the sidebar, the toggle button, or any active modal
    const isInsideSidebar = path.some(el => el instanceof HTMLElement && el.id === 'chat-members-sidebar');
    const isToggleBtn = path.some(el => el instanceof HTMLElement && el.id === 'open-members-panel');
    const isInsideModal = path.some(el => el instanceof HTMLElement && el.classList.contains('modal'));

    if (!isInsideSidebar && !isToggleBtn && !isInsideModal) {
        document.body.classList.remove('members-open');
        if (typeof window.positionReplyPreview === 'function') window.positionReplyPreview();
    }
});

/* ---------------- BACK BUTTON ---------------- */

function exitChat() {
    dismissKeyboard();
    document.body.classList.remove('chat-open');
    if (window.innerWidth <= 768) {
        openSidebarDrawer();
    }

    // Cleanup the header metadata listener
    if (activeChatMetaOff) activeChatMetaOff();
    if (activeMembersOff) activeMembersOff();
    if (activeMessagesOff) activeMessagesOff();
    if (activeTypingOff) activeTypingOff();
    if (activeChatPartnerOff) activeChatPartnerOff();
    if (activeGroupMuteOff) { activeGroupMuteOff(); activeGroupMuteOff = null; }
    if (activeGamesListOff) { activeGamesListOff(); activeGamesListOff = null; }
    cleanupLobbyCardListeners();
    
    activeMemberStatusOffs.forEach(offFunc => offFunc());
    activeMemberStatusOffs.clear();
    currentChatMemberNames.clear();
    activeChatPartnerOff = null;
    updateTypingStatus(false);
    
    activeChatMetaOff = null;
    activeMembersOff = null;
    activeMessagesOff = null;

    currentChatId = null;
    currentChatData = null;
    const pinnedBanner = document.getElementById('pinned-message-banner');
    if (pinnedBanner) {
        pinnedBanner.style.display = 'none';
    }
    const pinsContainer = document.getElementById('pinned-messages-container');
    if (pinsContainer) {
        pinsContainer.innerHTML = '';
    }
    const lobbyBanner = document.getElementById('active-lobby-banner');
    if (lobbyBanner) {
        lobbyBanner.style.display = 'none';
    }
    const lobbyJoinBtn = document.getElementById('active-lobby-join-btn');
    if (lobbyJoinBtn) lobbyJoinBtn.onclick = null;
}

const backBtnEl = document.getElementById('back-to-list');
if (backBtnEl) backBtnEl.onclick = exitChat;

/* ---------------- EMOJI PICKER ---------------- */

const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');

const emojiList = [
"😀",
"😃",
"😄",
"😁",
"😆",
"😅",
"😂",
"🤣",
"😊",
"😇",
"🙂",
"🙃",
"😉",
"😌",
"😍",
"🥰",
"😘",
"😗",
"😙",
"😚",
"😋",
"😛",
"😜",
"🤪",
"😝",
"🤑",
"🤗",
"🤭",
"🤫",
"🤔",
"🤐",
"🤨",
"😐",
"😑",
"😶",
"😏",
"😒",
"🙄",
"😬",
"🤥",
"😌",
"😔",
"😪",
"🤤",
"😴",
"😷",
"🤒",
"🤕",
"🤢",
"🤮",
"🤧",
"🥵",
"🥶",
"🥴",
"😵",
"🤯",
"🤠",
"🥳",
"😎",
"🤓",
"🧐",
"😕",
"😟",
"🙁",
"😮",
"😯",
"😲",
"😳",
"🥺",
"😦",
"😧",
"😨",
"😰",
"😥",
"😢",
"😭",
"😱",
"😖",
"😣",
"😞",
"😓",
"😩",
"😫",
"🥱",
"😤",
"😡",
"😠",
"🤬",
"😈",
"👿",
"💀",
"☠️",
"💩",
"🤡",
"👹",
"👺",
"👻",
"👽",
"👾",
"🤖",
"👋",
"🤚",
"🖐️",
"✋",
"🖖",
"👌",
"🤏",
"✌️",
"🤞",
"🤟",
"🤘",
"🤙",
"👈",
"👉",
"👆",
"🖕",
"👇",
"☝️",
"👍",
"👎",
"✊",
"👊",
"🤛",
"🤜",
"👏",
"🙌",
"👐",
"🤲",
"🤝",
"🙏",
"✍️",
"💅",
"🤳",
"💪",
"🦾",
"🦵",
"🦿",
"🦶",
"👂",
"🦻",
"❤️",
"🧡",
"💛",
"💚",
"💙",
"💜",
"🖤",
"🤍",
"🤎",
"💔",
"❣️",
"💕",
"💞",
"💓",
"💗",
"💖",
"💘",
"💝",
"💟",
"☮️",
"✝️",
"☪️",
"🕉️",
"☸️",
"✡️",
"🔯",
"🕎",
"☯️",
"☦️",
"🛐",
"⛎",
"♈",
"♉",
"♊",
"♋",
"♌",
"♍",
"♎",
"♏",
"♐",
"♑",
"♒",
"♓",
"🆔",
"⚛️",
"🉑",
"☢️",
"☣️",
"📴",
"📳",
"🈶",
"🈚",
"🈸",
"🈺",
"🈷️",
"✴️",
"🆚",
"💮",
"🉐",
"㊙️",
"🎉",
"🎊",
"🎈",
"🎂",
"🎁",
"🏆",
"🥇",
"🥈",
"🥉",
"⭐",
"🌟",
"✨",
"⚡",
"🔥",
"💥",
"☄️",
"🌈",
"☀️",
"🌤️",
"⛅",
"🌦️",
"🌧️",
"🌩️",
"🌨️",
"❄️",
"☃️",
"⛄",
"🌬️",
"💨",
"💧",
"💦",
"🌊",
"🌫️",
"🍏",
"🍎",
"🍐",
"🍊",
"🍋",
"🍌",
"🍉",
"🍇",
"🍓",
"🫐",
"🍈",
"🍒",
"🍑",
"🥭",
"🍍",
"🥥",
"🥝",
"🍅",
"🥑",
"🥦",
"🥬",
"🥒",
"🌶️",
"🌽",
"🥕",
"🧄",
"🧅",
"🥔",
"🍠",
"🥐",
"🥯",
"🍞",
"🥖",
"🥨",
"🧀",
"🥚",
"🍳",
"🧈",
"🥞",
"🧇",
"🥓",
"🥩",
"🍗",
"🍖",
"🦴",
"🌭",
"🍔",
"🍟",
"🍕",
"🥪",
"🥙",
"🧆",
"🌮",
"🌯",
"🥗",
"🥘",
"🥫",
"🍝",
"🍜",
"🍲",
"🍛",
"🍣",
"🍱",
"🥟",
"🦪",
"🍤",
"🍙",
"🍚",
"🍘",
"🍥",
"🥠",
"🥮",
"🍢",
"🍡",
"🍧",
"🍨",
"🍦",
"🥧",
"🧁",
"🍰",
"🎂",
"🍮",
"🍭",
"🍬",
"🍫",
"🍿",
"🍩",
"🍪",
"🌰",
"🥜",
"🍯",
"🥛",
"🍼",
"☕",
"🍵",
"🧃",
"🥤",
"🧋",
"🍶",
"🍺",
"🍻",
"🥂",
"🍷",
"🥃",
"🍸",
"🍹",
"🧉",
"🍾",
"🧊",
"🚗",
"🚕",
"🚙",
"🚌",
"🚎",
"🏎️",
"🚓",
"🚑",
"🚒",
"🚐",
"🛻",
"🚚",
"🚛",
"🚜",
"🛵",
"🏍️",
"🛺",
"🚲",
"🛴",
"🚨",
"🚔",
"🚍",
"🚘",
"🚖",
"🚡",
"🚠",
"🚟",
"🚃",
"🚋",
"🚞",
"🚝",
"🚄",
"🚅",
"🚈",
"🚂",
"🚆",
"🚇",
"🚊",
"🚀",
"🛸",
"🚁",
"🛶",
"⛵",
"🚤",
"🛳️",
"⛴️",
"🚢",
"✈️",
"🛩️",
"🛫",
"🛬",
"🪂",
"🛰️"
];

async function renderEmojiPicker() {
    if (!emojiPicker) return;

    const emojisBtn = document.getElementById('picker-tab-emojis');
    const stickersBtn = document.getElementById('picker-tab-stickers');
    const thumb = document.querySelector('.picker-glider-thumb');
    const emojisTabContent = document.getElementById('picker-tab-content-emojis');
    const stickersTabContent = document.getElementById('picker-tab-content-stickers');

    if (!emojisBtn || !stickersBtn || !emojisTabContent || !stickersTabContent) return;

    const switchTab = (tab) => {
        activePickerTab = tab;
        if (tab === 'emojis') {
            emojisBtn.classList.add('active');
            stickersBtn.classList.remove('active');
            if (thumb) thumb.style.transform = 'translateX(0%)';
            emojisTabContent.style.display = 'grid';
            stickersTabContent.style.display = 'none';
        } else {
            stickersBtn.classList.add('active');
            emojisBtn.classList.remove('active');
            if (thumb) thumb.style.transform = 'translateX(calc(100% + 4px))';
            stickersTabContent.style.display = 'flex';
            emojisTabContent.style.display = 'none';
            renderPickerStickers();
        }
    };

    emojisBtn.onclick = (e) => { e.stopPropagation(); switchTab('emojis'); };
    stickersBtn.onclick = (e) => { e.stopPropagation(); switchTab('stickers'); };

    if (emojisTabContent.children.length === 0) {
        emojiList.forEach(emoji => {
            const span = document.createElement('span');
            span.innerText = emoji;
            span.onclick = (e) => {
                e.stopPropagation();
                if (activeReactionMessageId) {
                    toggleReaction(activeReactionMessageId, emoji);
                    activeReactionMessageId = null;
                } else {
                    const input = document.getElementById('message-input');
                    input.value += emoji;
                    input.focus();
                    updateInputButtons();
                }
                emojiPicker.style.display = 'none';
            };
            emojisTabContent.appendChild(span);
        });
        twemoji.parse(emojisTabContent);
    }

    switchTab(activePickerTab);
}

// Firebase read that never throws (a denied/missing node must not leave the picker stuck on "Loading")
async function safeGet(r) {
    try { return await get(r); } catch (e) { console.warn('Sticker read failed:', e?.message || e); return null; }
}

// A user only ever sees stickers they uploaded ('owned') or that an owner shared with them ('allowed')
async function loadMyStickers(myUid) {
    const snap = await safeGet(ref(db, `user_stickers/${myUid}`));
    if (!snap || !snap.exists()) return [];
    const entries = Object.entries(snap.val());
    const metaSnaps = await Promise.all(entries.map(([id]) => safeGet(ref(db, `sticker_metadata/${id}`))));
    const list = [];
    entries.forEach(([id, info], i) => {
        const meta = metaSnaps[i] && metaSnaps[i].val();
        if (!meta) return; // sticker was deleted by its owner
        meta.stickerId = meta.stickerId || id;
        list.push({ meta, kind: info.type === 'owned' ? 'owned' : 'allowed' });
    });
    list.sort((a, b) => (a.kind === b.kind ? (b.meta.createdAt || 0) - (a.meta.createdAt || 0) : (a.kind === 'owned' ? -1 : 1)));
    return list;
}

async function renderPickerStickers() {
    const container = document.getElementById('picker-tab-content-stickers');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center; opacity:0.6; padding:15px; margin:0;">Loading stickers...</p>';

    const myUid = auth.currentUser?.uid;
    if (!myUid) return;

    const list = await loadMyStickers(myUid);
    container.innerHTML = '';

    const section = document.createElement('div');
    section.className = 'sticker-pack-section';
    const header = document.createElement('div');
    header.className = 'sticker-pack-header';
    header.innerHTML = `<span class="pack-title-author">\u{1F39F}\u{FE0F} My Stickers (${list.length})</span>`;
    section.appendChild(header);

    if (list.length === 0) {
        const hint = document.createElement('small');
        hint.style.cssText = 'opacity:0.6; display:block; padding:8px; line-height:1.5;';
        hint.innerText = isCurrentUserPremium
            ? 'No stickers yet. Upload yours in Settings \u{2192} Stickers, or tap a sticker in a chat to request it from its owner.'
            : 'No stickers yet. Tap a sticker in a chat to request it from its owner.';
        section.appendChild(hint);
    } else {
        const grid = document.createElement('div');
        grid.className = 'theme-grid sticker-grid';
        list.forEach(({ meta }) => {
            const card = document.createElement('div');
            card.className = 'sticker-card';
            card.innerHTML = `<img src="${meta.thumbnailStoragePath || meta.storagePath}" alt="${escapeHTML(getStickerDisplayName(meta))}" decoding="async">`;
            card.title = getStickerDisplayName(meta);
            card.onclick = (e) => {
                e.stopPropagation();
                currentStickerPickerMessageId = meta.stickerId;
                sendMessage();
            };
            grid.appendChild(card);
        });
        section.appendChild(grid);
    }
    container.appendChild(section);
}

if (emojiBtn && emojiPicker) {
    emojiBtn.onclick = async (e) => {
        e.stopPropagation();
        activeReactionMessageId = null; // Reset to regular typing mode
        if (emojiPicker.style.display === 'none') {
            const pm = document.getElementById('plus-menu');
            if (pm) { pm.style.display = 'none'; pm.classList.add('hidden'); }
            await renderEmojiPicker();
            emojiPicker.style.display = 'flex';
        } else {
            emojiPicker.style.display = 'none';
        }
    };

    document.addEventListener('click', () => {
        emojiPicker.style.display = 'none';
        activeReactionMessageId = null;
    });

    // Prevent clicks inside the picker from closing it (except on an emoji or sticker action)
    emojiPicker.onclick = (e) => e.stopPropagation();
}

// Modal Listeners for Sticker Pack preview & creation
const closePackPreviewBtn = document.getElementById('close-pack-preview-modal');
if (closePackPreviewBtn) {
    closePackPreviewBtn.onclick = () => {
        closeAnimatedModal(document.getElementById('sticker-pack-preview-modal'));
        currentPackPreviewId = null;
    };
}

const closeCreatePackBtn = document.getElementById('close-create-pack-modal');
if (closeCreatePackBtn) {
    closeCreatePackBtn.onclick = () => {
        closeAnimatedModal(document.getElementById('create-pack-modal'));
        document.getElementById('new-pack-name-input').value = '';
    };
}

const confirmCreatePackBtn = document.getElementById('confirm-create-pack-btn');
if (confirmCreatePackBtn) {
    confirmCreatePackBtn.onclick = async () => {
        const input = document.getElementById('new-pack-name-input');
        const name = input ? input.value.trim() : '';
        if (!name) {
            showNotification("Please enter a pack name.", "info");
            return;
        }
        const packId = await createStickerPack(name);
        if (packId) {
            closeAnimatedModal(document.getElementById('create-pack-modal'));
            input.value = '';
            if (document.getElementById('emoji-picker')?.style.display !== 'none') {
                renderPickerStickers();
            }
            if (document.getElementById('premium-panel-modal')?.style.display !== 'none') {
                renderStickerOptions();
            }
        }
    };
}

/* ---------------- PREMIUM PROMO BANNER & PAYMENT ---------------- */

const promoBanner = document.getElementById('premium-promo-banner');

document.getElementById('close-premium-banner').onclick = (e) => {
    e.stopPropagation();
    if (promoBanner) promoBanner.style.display = 'none';
    localStorage.setItem('premiumBannerClosedAt', Date.now().toString());
};

document.getElementById('open-payment-modal-btn').onclick = () => {
    document.getElementById('payment-modal').style.display = 'flex';
};

document.getElementById('close-payment-modal').onclick = () => {
    closeAnimatedModal(document.getElementById('payment-modal'));
};

window.submitAdminRequest = async function() {
    const user = auth.currentUser;
    if (!user) return;

    const submitBtn = document.getElementById('submit-admin-request-btn');
    const noteInput = document.getElementById('payment-request-note');
    const note = noteInput ? noteInput.value.trim() : "";
    const rawUsername = window.currentUserData?.username ||
        window.currentUserData?.displayName ||
        (window.currentUserData ? getDisplayName(window.currentUserData) : null) ||
        user.displayName ||
        (user.email ? user.email.split('@')[0] : null) ||
        "Unknown";
    const username = String(rawUsername).substring(0, 15);

    if (submitBtn) submitBtn.disabled = true;
    try {
        const reqRef = push(ref(db, 'adminRequests'));
        await set(reqRef, {
            uid: user.uid,
            username: username,
            type: 'payment',
            note: note || "Requested to contact admin regarding payment.",
            status: 'pending',
            timestamp: Date.now()
        });
        if (noteInput) noteInput.value = '';
        if (typeof showNotification === 'function') {
            showNotification("Request sent! An admin will contact you shortly.", "success");
        }
        const paymentModal = document.getElementById('payment-modal');
        if (paymentModal && paymentModal.style.display !== 'none') {
            closeAnimatedModal(paymentModal);
        }
    } catch (err) {
        console.error("[AdminRequest] Failed:", err);
        if (typeof showNotification === 'function') {
            showNotification("Failed to send request.", "error");
        }
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
};
// ---- Sidebar quick search (UI helper; filters rendered friend/chat rows) ----
(function () {
    const input = document.getElementById('sidebar-search-input');
    if (!input) return;
    const apply = () => {
        const q = input.value.trim().toLowerCase();
        ['friends-list', 'chats-list'].forEach(id => {
            const list = document.getElementById(id);
            if (!list) return;
            Array.from(list.children).forEach(el => {
                el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? '' : 'none';
            });
        });
    };
    input.addEventListener('input', apply);
    new MutationObserver(() => { if (input.value) apply(); })
        .observe(document.getElementById('app-container'), { childList: true, subtree: true });
})();

// Initialize Telegram-style Message Context Menu
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initMessageContextMenu());
} else {
    initMessageContextMenu();
}

// Make modals opened via style.display='flex' visible with the new animated CSS
new MutationObserver((mutations) => {
    for (const m of mutations) {
        const el = m.target;
        if (el.classList && el.classList.contains('modal') &&
            el.style.display === 'flex' &&
            !el.classList.contains('modal-visible') &&
            !el.classList.contains('modal-closing')) {
            requestAnimationFrame(() => el.classList.add('modal-visible'));
        }
    }
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });

