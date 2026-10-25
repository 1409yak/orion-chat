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
    orderByKey
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import {
    getFirestore,
    doc,
    setDoc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
const firestore = getFirestore(app);
const messaging = getMessaging(app);

let currentChatId = null;
let currentChatCreatorId = null; // Store globally for profile viewing context
let selectedGroupMembers = [];
let selectedNewGroupMembers = []; // For adding members to an existing group
let html5QrCode = null;
let activeChatMetaOff = null; // Listener for current chat title/description
let activeTypingOff = null;   // Listener for typing status
let activeMembersOff = null;   // Listener for current chat members
let activeMessagesOff = null;  // Listener for current chat messages
let activeChatPartnerOff = null; // Listener for DM partner status
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
    const isDM = !currentChatId || currentChatId.includes('_');
    if (isDM) return null; // Never show badges in DMs
    const roleId = currentChatMemberData?.[msg.sender_id]?.role || msg.sender_role || msg.sender_badge;
    return getGroupRoleInfo(roleId);
}

function updateMessageBadgesForUser(uid, roleId) {
    const isDM = !currentChatId || currentChatId.includes('_');
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
    nameSpan.innerText = msg.sender_name || (msg.sender_id === 'system' ? 'Orion System' : 'User');
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
    const isDM = !currentChatId || currentChatId.includes('_');
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

// Gentle glass notification chime synthesized via standard Web Audio API
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
let gameStartedLocally = false;
let canSkipPrize = false;
let prizeTimeout = null;
let availableFlags = [];

// --- GAME LOGIC ---
async function setupGameLobby() {
    if (!currentChatId) return;
    const gameRef = ref(db, `games/${currentChatId}`);
    
    const gameSnap = await get(gameRef);
    const isCreator = !gameSnap.exists();

    // If creator, send the invite link to the chat automatically
    if (isCreator) {
        const mKey = push(ref(db, `messages/${currentChatId}`)).key;
        const myName = document.getElementById('current-user-name').innerText;
        await set(ref(db, `messages/${currentChatId}/${mKey}`), {
            sender_id: auth.currentUser.uid,
            sender_name: myName,
            text: "is hosting a game of World Flags!",
            gameInvite: true,
            createdAt: serverTimestamp(),
            timestamp: serverTimestamp(),
            sender_badge: (isCurrentUserPremium && currentMyBadge) ? currentMyBadge : null
        });

        // Initialize game record with the invite message ID
        await set(gameRef, {
            inviteMsgId: mKey,
            status: 'lobby'
        });

        // Update chat metadata
        await update(ref(db, `chats/${currentChatId}`), {
            last_message: `${myName} started a game!`,
            hostId: auth.currentUser.uid, // Explicitly track host
            timestamp: serverTimestamp()
        });
    }

    // Join the lobby
    const playerInfo = {
        name: document.getElementById('current-user-name').innerText,
        gold: 0,
        joinedAt: serverTimestamp()
    };
    await update(ref(db, `games/${currentChatId}/players/${auth.currentUser.uid}`), playerInfo);
    
    onValue(gameRef, async (snap) => {
        const data = snap.val();
        if (!data) return;
        
        if (data.status === 'active' && !gameStartedLocally) {
            gameStartedLocally = true;
            startLocalGameUI(data);
            return;
        }

        const players = data.players || {};
        const list = document.getElementById('lobby-players-list');
        if (list) {
            list.innerHTML = '';
            Object.values(players).forEach(p => {
                const div = document.createElement('div');
                div.className = 'selection-item';
                div.innerText = `\u{1F3AE} ${p.name}`;
                list.appendChild(div);
            });
        }

        const startBtn = document.getElementById('start-game-btn');
        if (startBtn) {
            // Strictly check against creator/host
            const chatSnap = await get(ref(db, `chats/${currentChatId}`));
            const hostId = chatSnap.val()?.hostId;
            const isHost = auth.currentUser.uid === hostId;
            
            const durationGroup = document.getElementById('game-duration-slider').closest('.field-group');
            if (durationGroup) durationGroup.style.display = isHost ? 'block' : 'none';
            
            startBtn.style.display = isHost ? 'block' : 'none';
            startBtn.disabled = Object.keys(players).length < 2;
            startBtn.onclick = () => {
                const duration = parseInt(document.getElementById('game-duration-slider').value);
                update(gameRef, {
                    status: 'active',
                    duration: duration,
                    endTime: Date.now() + (duration * 60000)
                });
            };
        }
    });
}

function startLocalGameUI(gameData) {
    document.getElementById('flag-game-lobby-modal').style.display = 'none';
    document.getElementById('flag-game-screen').style.display = 'flex';
    
    // Ensure initial visibility is correct
    document.getElementById('question-area').style.display = 'block';
    document.getElementById('chest-area').style.display = 'none';
    document.getElementById('podium-area').style.display = 'none';
    document.getElementById('game-leaderboard').style.display = 'block';
    
    availableFlags = [...COUNTRIES_LIST]; // Refresh flag pool for session
    nextFlagRound();
    
    if (gameTimerInterval) clearInterval(gameTimerInterval);
    gameTimerInterval = setInterval(() => {
        const remaining = Math.max(0, gameData.endTime - Date.now());
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        document.getElementById('game-timer').innerText = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        
        if (remaining <= 0 && gameStartedLocally) {
            clearInterval(gameTimerInterval);
            gameStartedLocally = false;
            
            showPodium();
            
            showNotification("Game Over!", "info");
            setTimeout(() => {
                document.getElementById('flag-game-screen').style.display = 'none';
                if (currentChatId) remove(ref(db, `games/${currentChatId}`));
            }, 5000);
        }
    }, 1000);

    // Listener for being stolen from
    const myStolenRef = ref(db, `games/${currentChatId}/players/${auth.currentUser.uid}/lastStolenBy`);
    onValue(myStolenRef, (snap) => {
        const stealer = snap.val();
        if (stealer) {
            document.getElementById('stealer-name').innerText = stealer;
            document.getElementById('steal-notification').style.display = 'flex';
            setTimeout(() => {
                document.getElementById('steal-notification').style.display = 'none';
                remove(myStolenRef);
            }, 1000);
        }
    });

    onValue(ref(db, `games/${currentChatId}/players`), (snap) => {
        const players = snap.val() || {};
        const leader = document.getElementById('leaderboard-content');
        if (leader) {
            leader.innerHTML = Object.values(players)
                .sort((a, b) => b.gold - a.gold)
                .map(p => `<div><strong>${p.name}</strong>: ${p.gold} Gold</div>`)
                .join('');
        }
    });
}

async function showPodium() {
    document.getElementById('question-area').style.display = 'none';
    document.getElementById('chest-area').style.display = 'none';
    document.getElementById('game-leaderboard').style.display = 'none';
    const podiumArea = document.getElementById('podium-area');
    const podiumList = document.getElementById('podium-list');
    podiumArea.style.display = 'flex';

    const snap = await get(ref(db, `games/${currentChatId}/players`));
    const players = snap.val() || {};
    const sorted = Object.values(players).sort((a, b) => b.gold - a.gold);

    podiumList.innerHTML = sorted.map((p, i) => {
        let medal = "";
        if (i === 0) medal = "\u{1F947}";
        else if (i === 1) medal = "\u{1F948}";
        else if (i === 2) medal = "\u{1F949}";
        else medal = `${i + 1}th`;

        return `
            <div class="podium-card ${i < 3 ? 'top-three' : ''}">
                <span style="font-weight: 800; font-size: 18px;">${medal} ${escapeHTML(p.name)}</span>
                <span class="podium-gold">${p.gold} Gold</span>
            </div>
        `;
    }).join('');
    
    twemoji.parse(podiumList);
}

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

    const playerSnap = await get(ref(db, `games/${currentChatId}/players/${myUid}`));
    const currentGold = playerSnap.val()?.gold || 0;
    
    let goldChange = 0;
    let displayLabel = "";

    if (typeof rawResult === 'number') {
        goldChange = rawResult;
        displayLabel = (goldChange > 0 ? "+" : "") + goldChange + " Gold!";
    } else if (typeof rawResult === 'string' && rawResult.toLowerCase().includes("steal")) {
        const stealPercent = rawResult.includes("10") ? 0.10 : 0.25;
        const stealPercentStr = rawResult.includes("10") ? "10%" : "25%";
        
        const playersSnap = await get(ref(db, `games/${currentChatId}/players`));
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
                btn.innerText = `\u{1F464} ${allPlayers[uid].name || "Player"}`;
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    const victimGold = allPlayers[uid].gold || 0;
                    const amountToSteal = Math.floor(victimGold * stealPercent);
                    
                    await update(ref(db, `games/${currentChatId}/players/${uid}`), {
                        gold: increment(-amountToSteal),
                        lastStolenBy: myName
                    });
                    await update(ref(db, `games/${currentChatId}/players/${myUid}`), { gold: increment(amountToSteal) });
                    
                    chestsContainer.style.display = 'none';
                    prizeDisplay.innerText = `Stole ${stealPercentStr} from ${allPlayers[uid].name}!`;
                    prizeDisplay.className = 'prize-display win';
                    
                    // Resume timing now that victim is selected
                    setTimeout(() => { canSkipPrize = true; }, 1000);
                    prizeTimeout = setTimeout(() => {
                        finishChestRound();
                    }, 3000);
                };
                chestsContainer.appendChild(btn);
            }
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
        displayLabel = (rawResult.includes("%") || rawResult.includes("x")) ? rawResult.toUpperCase() : (goldChange > 0 ? "+" : "") + goldChange + " Gold!";
    }

    chestsContainer.style.display = 'none';
    prizeDisplay.style.display = 'block';
    prizeDisplay.innerText = displayLabel;
    prizeDisplay.className = `prize-display ${goldChange >= 0 ? 'win' : 'lose'}`;
    
    if (goldChange !== 0) {
        await update(ref(db, `games/${currentChatId}/players/${myUid}`), { gold: increment(goldChange) });
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
let activeGameId = null;
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
    return userData.displayName || (userData.email ? userData.email.split('@')[0] : "User");
}

// Helper to safely get a display name for a sticker
function getStickerDisplayName(stickerMeta) {
    if (!stickerMeta) return "Sticker";
    return stickerMeta.originalFileName || "Unnamed Sticker";
}

// Helper for custom notifications
function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    if (!container) return;
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = message; // Already escaped or trusted content
    container.appendChild(notification);
    if (window.twemoji) twemoji.parse(notification);

    const removeNotify = () => {
        notification.classList.add('fade-out');
        notification.addEventListener('animationend', () => notification.remove());
    };
    setTimeout(removeNotify, 4000);
    notification.onclick = removeNotify;
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
    const text = sanitizeMojibakeEmoji(rawText);
    if (text && text.startsWith('data:image/')) {
        return { html: "", youtubeId: null, imageUrls: [text], joinChatIds: [] };
    }

    const escaped = escapeHTML(text);
    // More robust URL regex that avoids capturing trailing punctuation
    const urlRegex = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g;
    // Improved YouTube regex to catch shorts, embed, and various watch formats
    const ytRegex = /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const imgRegex = /\.(jpeg|jpg|gif|png|webp|svg|bmp)(?:\/[^?#.]*)?(?:\?.*)?$/i;
    const joinIdRegex = /#join=([a-zA-Z0-9_-]+)/;

    let youtubeId = null;
    let imageUrls = [];
    let joinChatIds = [];

    const html = escaped.replace(urlRegex, (url) => {
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

        if (imgRegex.test(url)) {
            imageUrls.push(url);
            return ""; // Hide the link text as requested
        }

        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link-inline" onclick="event.stopPropagation()">${url}</a>`;
    });

    // Client-Side Parser for [UPDATE_VERSION:x.x.x]
    html = html.replace(/\[UPDATE_VERSION:([0-9\.]+)\]/g, (match, version) => {
        return `<div class="channel-update-card"><span class="update-badge">v${version} Available</span><button type="button" class="channel-install-btn" onclick="window.triggerOtaUpdate('${version}')">⚡ Install Update & Reload</button></div>`;
    });

    return { html: html.trim(), youtubeId, imageUrls, joinChatIds };
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

async function deleteMessage(messageId, isSticker = false) {
    if (!currentChatId) return;

    const confirmed = await showConfirm("Delete Message", "Are you sure you want to delete this message?");
    if (confirmed) {
        try {
            await remove(ref(db, `messages/${currentChatId}/${messageId}`));
        } catch (err) {
            if (isSticker) {
                console.error("Error deleting sticker message:", err);
            } else {
                console.error("Error deleting message:", err);
            }
            
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
            });
        }
        // Auto-subscribe current user
        const userChatRef = ref(db, `user_chats/${myUid}/${channelId}`);
        const userChatSnap = await get(userChatRef);
        if (!userChatSnap.exists() || !userChatSnap.val()) {
            await set(userChatRef, true);
        }
        // Ensure user membership
        const memberRef = ref(db, `members/${channelId}/${myUid}`);
        const memberSnap = await get(memberRef);
        if (!memberSnap.exists()) {
            await set(memberRef, { role: 'member' });
        }
    } catch (err) {
        console.warn("[Orion Updates] Error subscribing to channel:", err);
    }
}
window.ensureOrionUpdatesChannel = ensureOrionUpdatesChannel;

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

    activeContextTarget = {
        messageId,
        msg,
        isMe,
        canDelete,
        canEdit,
        canCopy
    };

    const editBtn = document.getElementById('ctx-action-edit');
    if (editBtn) editBtn.style.display = canEdit ? 'flex' : 'none';

    const deleteBtn = document.getElementById('ctx-action-delete');
    if (deleteBtn) deleteBtn.style.display = canDelete ? 'flex' : 'none';

    const copyBtn = document.getElementById('ctx-action-copy');
    if (copyBtn) copyBtn.style.display = canCopy ? 'flex' : 'none';

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        sheet.classList.add('mobile-bottom-docked');
        sheet.style.left = '';
        sheet.style.top = '';
    } else {
        sheet.classList.remove('mobile-bottom-docked');
        const sheetWidth = 250;
        const sheetHeight = 220;
        let left = posX || (window.innerWidth / 2 - 125);
        let top = posY || (window.innerHeight / 2 - 110);

        if (left + sheetWidth > window.innerWidth - 16) {
            left = window.innerWidth - sheetWidth - 16;
        }
        if (left < 16) left = 16;

        if (top + sheetHeight > window.innerHeight - 16) {
            top = window.innerHeight - sheetHeight - 16;
        }
        if (top < 16) top = 16;

        sheet.style.left = `${left}px`;
        sheet.style.top = `${top}px`;
    }

    if (window.twemoji) twemoji.parse(sheet);
    sheet.classList.remove('hidden');
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

// Reusable function to apply mute
async function applyMute(chatId, targetUid, durationMinutes, reason, currentMemberData) {
    const mutedUntil = Date.now() + (durationMinutes * 60 * 1000);
    
    const updates = {};
    updates[`/members/${chatId}/${targetUid}`] = {
        role: currentMemberData?.[targetUid]?.role || 'member', // Preserve existing role
        mutedUntil,
        muteReason: reason
    };

    // Fetch user's display name for the system message
    const userSnap = await get(ref(db, `users/${targetUid}`));
    const userData = userSnap.val();
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
                modal.style.display = 'none';
            } catch (err) { showNotification("Couldn't remove sticker.", "error"); }
        };
    } else {
        actionBtn.innerText = 'Request this sticker';
        actionBtn.className = 'glass-btn-primary';
        actionBtn.onclick = () => {
            modal.style.display = 'none';
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

// Global click listener to close message action menus
document.addEventListener('click', (e) => {
    document.querySelectorAll('.msg-action-menu').forEach(menu => {
        if (!menu.parentElement.contains(e.target)) {
            menu.style.display = 'none';
        }
    });
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

/**
 * Automatically prunes messages older than 5 days across all chats.
 * Threshold: evaluates message expiration after 5 days from creation timestamp (createdAt + 5 days, or legacy timestamp).
 * Requires the caller to have Admin privileges in Firebase Rules.
 */
async function cleanupOldMessages() {
    const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - FIVE_DAYS_MS;
    
    try {
        // Fetch all chat IDs to iterate through them
        const chatsSnap = await get(ref(db, 'chats'));
        const chats = chatsSnap.val();
        if (!chats) return;

        const chatIds = Object.keys(chats);
        console.log(`[Maintenance] Checking ${chatIds.length} chats for messages older than 5 days (cutoff: ${new Date(cutoff).toISOString()})...`);

        for (const chatId of chatIds) {
            // Query messages in this chat older than the cutoff using indexed timestamp
            const oldMsgsQuery = query(ref(db, `messages/${chatId}`), orderByChild('timestamp'), endAt(cutoff));
            const oldMsgsSnap = await get(oldMsgsQuery);
            
            if (oldMsgsSnap.exists()) {
                const updates = {};
                let count = 0;
                oldMsgsSnap.forEach(msgSnap => {
                    const msg = msgSnap.val();
                    const msgCreatedAt = msg?.createdAt || msg?.timestamp;
                    if (msgCreatedAt && msgCreatedAt <= cutoff) {
                        updates[msgSnap.key] = null; // Mark for deletion
                        count++;
                    }
                });
                if (count > 0) {
                    await update(ref(db, `messages/${chatId}`), updates);
                    console.log(`[Maintenance] Purged ${count} expired (>5 days) messages from chat: ${chatId}`);
                }
            }
        }
    } catch (e) {
        console.error("[Maintenance] 5-day message cleanup failed:", e);
    }
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

                    // Save token into Firestore under users/{userId}/fcmToken
                    try {
                        await setDoc(doc(firestore, "users", uid), { fcmToken: token.value }, { merge: true });
                        console.log('Successfully saved native FCM token to Firestore for user:', uid);
                    } catch (fsErr) {
                        console.warn('Could not save FCM token to Firestore:', fsErr);
                    }

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
            playNotificationChime();
            const title = notification.title || 'New Message';
            const body = notification.body || '';
            showNotification(`<strong>${escapeHTML(title)}</strong><br>${escapeHTML(body)}`, 'info');
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

const CURRENT_APP_VERSION = '1.0.1';
const CURRENT_VERSION = CURRENT_APP_VERSION;
const UPDATE_MANIFEST_URL = window.ORION_UPDATE_URL || 'https://raw.githubusercontent.com/1409yak/orion-chat/main/version.json';
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
    if (remote === current) return false;
    const rParts = remote.split('.').map(n => parseInt(n, 10) || 0);
    const cParts = current.split('.').map(n => parseInt(n, 10) || 0);
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
    const targetVer = activeOtaManifest.version || '1.0.2';
    const bundleUrl = activeOtaManifest.url || `https://github.com/1409yak/orion-chat/releases/download/v${targetVer}/bundle.zip`;
    try {
        await downloadAndApplyUpdate(targetVer, bundleUrl);
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
        let manifestUrl = UPDATE_MANIFEST_URL;
        if (!manifestUrl.startsWith('http://') && !manifestUrl.startsWith('https://')) {
            try {
                manifestUrl = new URL(manifestUrl, window.location.href).href;
            } catch (_) {}
        }
        console.log(`[OTA] Checking manifest from: ${manifestUrl} (Current: ${CURRENT_APP_VERSION}, Manual: ${isManual})`);
        const response = await fetch(manifestUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Server returned HTTP ${response.status}`);
        }

        const manifest = await response.json();
        if (!manifest || !manifest.version || !manifest.url) {
            throw new Error('Invalid version manifest');
        }

        console.log(`[OTA] Remote version: ${manifest.version}, Installed: ${CURRENT_APP_VERSION}`);

        if (isNewerVersion(manifest.version, CURRENT_APP_VERSION)) {
            if (statusMsg) {
                statusMsg.textContent = `Update available: v${manifest.version}!`;
                statusMsg.style.color = '#00ff88';
            }
            showOtaUpdateBanner(manifest);
        } else {
            if (statusMsg) {
                statusMsg.textContent = `You are on the latest version (v${CURRENT_APP_VERSION}).`;
                statusMsg.style.color = 'rgba(255, 255, 255, 0.7)';
            }
            if (isManual) {
                showNotification(`You are on the latest version (v${CURRENT_APP_VERSION})`, 'info');
            }
        }
    } catch (err) {
        console.error('Update check failed:', err.message, err);
        const errMsg = err.message && err.message.startsWith('Server returned HTTP')
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

async function downloadAndApplyUpdate(targetVersion, bundleUrl) {
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
        // Map any temporary/preview workers.dev domains to the active deployed worker
        if (downloadUrl.includes('pale-fascinator.workers.dev') || downloadUrl.includes('charming-button.workers.dev')) {
            downloadUrl = downloadUrl.replace(/(pale-fascinator|charming-button)\.workers\.dev/, 'accurate-onyx.workers.dev');
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

        const updater = (await getCapacitorUpdater()) || window.Capacitor?.Plugins?.CapacitorUpdater;
        if (!updater) {
            throw new Error("CapacitorUpdater plugin not found");
        }

        console.log(`[OTA] CapacitorUpdater.download starting from: ${downloadUrl}`);
        const bundle = await updater.download({
            url: downloadUrl,
            version: targetVersion
        });

        btns.forEach(btn => {
            btn.textContent = "Applying update...";
        });

        console.log('[OTA] Bundle downloaded successfully:', bundle);
        await updater.set(bundle);

        console.log('[OTA] Reloading app via CapacitorUpdater.reload()...');
        if (typeof updater.reload === 'function') {
            await updater.reload();
        } else {
            window.location.reload();
        }
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

window.triggerOtaUpdate = async function(targetVersion = '1.0.2', directUrl = null) {
    if (isInstallingFromChannel) return;
    isInstallingFromChannel = true;

    try {
        let bundleUrl = directUrl || `https://orion-fcm-worker.pale-fascinator.workers.dev/download-ota?version=v${targetVersion}`;

        if (!directUrl) {
            try {
                const manifestResp = await fetch(UPDATE_CHECK_URL, { cache: 'no-store' });
                if (manifestResp.ok) {
                    const manifest = await manifestResp.json();
                    if (manifest && manifest.url) {
                        bundleUrl = manifest.url;
                    }
                }
            } catch (mErr) {
                console.warn('[OTA] Could not fetch manifest for bundleUrl, using direct mapping:', mErr);
            }
        }

        await downloadAndApplyUpdate(targetVersion, bundleUrl);
    } finally {
        isInstallingFromChannel = false;
    }
};

async function installUpdateFromChannel(version, bundleUrl, buttonElem) {
    return window.triggerOtaUpdate(version, bundleUrl);
}
window.installUpdateFromChannel = installUpdateFromChannel;

// Delegated click handler for channel install buttons
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.channel-install-btn');
    if (btn) {
        e.stopPropagation();
        const ver = btn.dataset.version || '1.0.2';
        window.triggerOtaUpdate(ver);
    }
});

// Run notifyAppReady immediately on startup
initCapacitorUpdater();

// Automatic update check once on startup after 2-second delay
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(() => checkForUpdates(false), 2000);
} else {
    window.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => checkForUpdates(false), 2000);
    });
}

/* ---------------- FCM CLOUDFLARE WORKER DISPATCHER ---------------- */

const CLOUDFLARE_FCM_WORKER_URL = 'https://orion-fcm-worker.accurate-onyx.workers.dev';

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
                try {
                    await setDoc(doc(firestore, "users", uid), { fcmToken: token }, { merge: true });
                } catch (fsErr) {
                    console.warn('Could not save web FCM token to Firestore:', fsErr);
                }
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
    const chatId = payload.data?.chatId;
    const isDm = chatId && chatId.includes('_');

    // Filter notification delivery according to user notification settings
    if (isDm && notificationPrefs.dmNotifications === 'none') {
        return;
    }
    if (!isDm && notificationPrefs.groupNotifications === 'mute') {
        return;
    }

    playNotificationChime();
    showNotification(`<strong>${escapeHTML(title)}</strong><br>${escapeHTML(body)}`, 'info');
});

/* ---------------- AUTH STATE ---------------- */

onAuthStateChanged(auth, (user) => {
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
        document.getElementById('profile-modal').style.display = 'none';
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
        
        const isAdmin = data.isAdmin === true || String(data.isAdmin).toLowerCase() === "true";
        const isPremium = isAdmin || data.type === "Premium";
        const displayType = isAdmin ? "Admin" : (data.type || "Basic");
        
        // Update global premium status for the emoji picker and upload permissions
        isCurrentUserPremium = isPremium;
        applyUiPrefs();
        updateInputButtons();

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

        // Automatic Cleanup Trigger: Runs once per session if the user is an Admin
        if (isAdmin && !window._cleanupPerformed) {
            window._cleanupPerformed = true;
            cleanupOldMessages();
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
        document.getElementById('profile-modal').style.display = 'none';
        openPremiumPanelModal('account', true);
    };
}

const bioToSettingsBtn = document.getElementById('bio-to-settings-btn');
if (bioToSettingsBtn) {
    bioToSettingsBtn.onclick = () => {
        document.getElementById('profile-modal').style.display = 'none';
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
    nameElem.className = 'uv-name' + (isTargetPremium && userData.nameplate ? ` nameplate-applied ${userData.nameplate}` : '');
    nameElem.innerText = getDisplayName(userData);
    
    // Group-exclusive role badge: strictly only shown in groups
    if (chatId && !chatId.includes('_')) {
        const targetMemberRole = currentChatMemberData?.[targetUid]?.role || 'member';
        const groupRole = getGroupRoleInfo(targetMemberRole);
        if (groupRole && groupRole.badge) {
            const roleBadgeSpan = document.createElement('span');
            roleBadgeSpan.className = 'custom-user-badge uv-group-role';
            roleBadgeSpan.innerText = groupRole.badge;
            if (groupRole.color) {
                roleBadgeSpan.style.borderColor = groupRole.color + '55';
                roleBadgeSpan.style.color = groupRole.color;
            }
            nameElem.appendChild(roleBadgeSpan);
        }
    }
    twemoji.parse(nameElem);

    const actions = document.getElementById('user-view-actions');
    actions.innerHTML = '';

    if (targetUid !== myUid) {
        const myData = currentChatMemberData?.[myUid];
        const amICreator = myUid === groupCreatorId;
        const amIAdmin = myData?.role === 'admin';
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
            document.getElementById('user-view-modal').style.display = 'none';
        };
        actions.appendChild(messageBtn);

        // ── 2. SOCIAL SECTION ──
        const friendSnap = await get(ref(db, `friends/${myUid}/${targetUid}`));
        if (!friendSnap.exists()) {
            const socialSection = makeSection('Relationship');
            socialSection.appendChild(makeActionRow('Add Friend', '\u{1F91D}', false, () => {
                addFriend(myUid, targetUid);
                document.getElementById('user-view-modal').style.display = 'none';
            }));
        }

        // ── 3. GROUP MODERATION & ROLES SECTION ──
        if (chatId && !chatId.includes('_') && (amICreator || amIAdmin) && !targetIsCreator) {
            const modSection = makeSection('Group Roles & Moderation');
            
            // Discord-Style Role Assignment (Creator or Admin)
            const targetRole = targetMemberData?.role || 'member';
            const targetRoleInfo = getGroupRoleInfo(targetRole);
            modSection.appendChild(makeActionRow(
                `Role: ${targetRoleInfo.label}`,
                '\u{1F3F7}\u{FE0F}',
                false,
                () => {
                    document.getElementById('user-view-modal').style.display = 'none';
                    openGroupRoleModal(targetUid, chatId, targetRole, getDisplayName(userData));
                }
            ));

            // Mute / Unmute
            const isMuted = targetMemberData?.mutedUntil && targetMemberData.mutedUntil > Date.now();
            if (isMuted) {
                modSection.appendChild(makeActionRow('Unmute User', '\u{1F50A}', false, async () => {
                    try {
                        await update(ref(db, `members/${currentChatId}/${targetUid}`), {
                            mutedUntil: null,
                            muteReason: null
                        });
                        document.getElementById('user-view-modal').style.display = 'none';
                    } catch (err) {
                        console.error("Error unmuting user:", err);
                        showNotification("Failed to unmute user: " + err.message, "error");
                    }
                }));
            } else {
                modSection.appendChild(makeActionRow('Mute User', '\u{1F507}', false, () => {
                    openMuteModal(targetUid, userData.displayName || (userData.email ? userData.email.split('@')[0] : "User"));
                }));
            }
        }

        // ── 4. DANGER ZONE ──
        const hasDanger = friendSnap.exists() || (chatId && amICreator && !targetIsCreator);
        if (hasDanger) {
            const dangerSection = makeSection('Danger Zone', true);
            
        // Remove Friend
        if (friendSnap.exists()) {
            dangerSection.appendChild(makeActionRow('Remove Friend', '\u{1F494}', true, async () => {
                document.getElementById('user-view-modal').style.display = 'none';
                await removeFriend(myUid, targetUid);
            }));
        }

        // Remove from Group
        if (chatId && amICreator && !targetIsCreator) {
            dangerSection.appendChild(makeActionRow('Kick from Group', '\u{1F6AB}', true, async () => {
                document.getElementById('user-view-modal').style.display = 'none';
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
                updateMessageBadgesForUser(targetUid, role.id);
                showNotification(`Role updated to ${role.label} for ${targetName}`, 'success');
                modal.style.display = 'none';
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
        if (modal) modal.style.display = 'none';
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

    applySavedSidebarStates();
    loadNotificationSettings();

    onValue(ref(db, `friend_requests/${myUid}`), (snapshot) => {
        const list = document.getElementById('modal-requests-list');
        const badge = document.getElementById('friend-requests-badge');
        list.innerHTML = '';
        const requests = snapshot.val(); // Re-fetch after potential updates
        if (!requests) {
            badge.style.display = 'none';
            document.getElementById('friend-requests-modal').style.display = 'none';
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
                    if (data) renderChatLink(chatId, data, myUid).catch(console.error);
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
                if (data) renderChatLink('channel_orion_updates', data, myUid).catch(console.error);
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

                // Remove element from DOM
                const divToRemove = document.getElementById(`link-${chatId}`);
                if (divToRemove) {
                    divToRemove.remove();
                }
            }
        });
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
        document.getElementById('add-friend-modal').style.display = 'none';

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

    if (!data.isGroup && chatId.includes('_')) {
        const partnerId = chatId.split('_').find(id => id !== myUid);
        const partnerSnap = await get(ref(db, `users/${partnerId}`));
        const pData = partnerSnap.val();
        displayTitle = getDisplayName(pData);
        chatPic = pData?.profilePic;
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

    const unreadOff = onValue(unreadRef, (unreadSnap) => {
        localIsUnread = unreadSnap.exists();
        
        if (localIsUnread && chatId === currentChatId) {
            remove(unreadRef);
        } else {
            updateChatLinkUI(localIsUnread, localMentionCount);
        }
    });
    activeUnreadListeners.set(chatId, unreadOff); // Store the off function

    const mentionOff = onValue(mentionsRef, (mSnap) => {
        localMentionCount = mSnap.val() || 0;
        if (localMentionCount > 0 && chatId === currentChatId) {
            remove(mentionsRef);
        } else {
            updateChatLinkUI(localIsUnread, localMentionCount);
        }
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
    closeSidebarDrawer();

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

    // Set up real-time listener for chat details (title, description)
    if (activeChatMetaOff) activeChatMetaOff();
    if (activeMembersOff) activeMembersOff();
    if (activeMessagesOff) activeMessagesOff();
    if (activeTypingOff) activeTypingOff();
    if (activeChatPartnerOff) activeChatPartnerOff();

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
        viewedMessagesInSession.clear();

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

    activeMembersOff = onValue(membersRef, (msnap) => {
        currentChatMemberData = msnap.val() || {};
        renderMembersList(msnap, currentChatCreatorId);
        checkMuteStatus();
    });

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

    // Fetch initial newest 15 messages (limitToLast(15))
    const initialQuery = query(ref(db, `messages/${chatId}`), orderByKey(), limitToLast(15));
    const initialSnap = await get(initialQuery);
    if (currentChatId !== chatId) return;

    const initialMessages = [];
    initialSnap.forEach(child => {
        initialMessages.push({ key: child.key, val: child.val() });
    });

    if (initialMessages.length < 15) {
        hasMoreOlderMessages = false;
    }

    if (initialMessages.length > 0) {
        currentOldestMessageKey = initialMessages[0].key;
        currentNewestMessageKey = initialMessages[initialMessages.length - 1].key;

        for (const item of initialMessages) {
            const msg = item.val;
            if (msg.sender_id !== auth.currentUser.uid && !viewedMessagesInSession.has(item.key)) {
                viewedMessagesInSession.add(item.key);
                update(ref(db, `messages/${chatId}/${item.key}`), { 
                    [`viewedBy/${auth.currentUser.uid}`]: true
                });
            }
            const isConsecutive = msg.sender_id === lastSenderId;
            renderMessage(msg, isConsecutive, item.key);
            lastSenderId = msg.sender_id;
        }
        cont.scrollTop = cont.scrollHeight;
        updateInputButtons();
    }

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
        if (currentChatId && messageData.sender_id !== auth.currentUser.uid && !viewedMessagesInSession.has(data.key)) {
            viewedMessagesInSession.add(data.key);
            update(ref(db, `messages/${currentChatId}/${data.key}`), { 
                [`viewedBy/${auth.currentUser.uid}`]: true
            });
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

function renderMessage(msg, isConsecutive = false, messageId) {
    const cont = document.getElementById('messages-container');
    let wrap = document.getElementById(`msg-${messageId}`);
    const isNew = !wrap;

    if (isNew) {
        wrap = document.createElement('div');
        wrap.id = `msg-${messageId}`;
        wrap.dataset.senderId = msg.sender_id; // Store sender_id on the message wrapper
        wrap.dataset.timestamp = msg.timestamp;
    } else {
        wrap.innerHTML = ''; // Clear for update (reactions/edits)
    }

    const isMe = msg.sender_id === auth.currentUser.uid;
    const isSystem = msg.sender_id === 'system';
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

    // Handle Game Invite Link
    if (msg.gameInvite) {
        bubble.classList.add('game-invite-bubble');
        const inviteText = document.createElement('div');
        inviteText.style.fontWeight = '700';
        inviteText.innerText = msg.expired ? "\u{1F6A9} GAME EXPIRED" : "\u{1F6A9} WORLD FLAGS LOBBY";
        bubble.appendChild(inviteText);

        const joinBtn = document.createElement('button');
        joinBtn.className = msg.expired ? 'glass-btn-secondary' : 'glass-btn-primary';
        joinBtn.style.marginTop = '10px';
        joinBtn.innerText = msg.expired ? 'Finished' : 'Join Game';
        joinBtn.disabled = !!msg.expired;
        joinBtn.onclick = () => {
            if (msg.expired) return;
            document.getElementById('flag-game-lobby-modal').style.display = 'flex';
            setupGameLobby();
        };
        bubble.appendChild(joinBtn);
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
            if (pm) pm.style.display = 'none';
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

    // Bold and style mentions within the message
    if (currentChatMemberNames) {
        currentChatMemberNames.forEach((name) => {
            const mentionRegex = new RegExp(`@${name}\\b`, 'g');
            htmlContent = htmlContent.replace(mentionRegex, `<span class="mention-pill">@${name}</span>`);
        });
    }
    htmlContent = htmlContent.replace(/@everyone\b/gi, `<span class="mention-pill">@everyone</span>`);

    // Only show text node if there's actual text remaining or if there are no other embeds to show
    if (htmlContent || (formatted.imageUrls.length === 0 && !formatted.youtubeId && formatted.joinChatIds.length === 0)) {
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
        img.alt = 'Shared image';
        img.onclick = (e) => { openImageLightbox(url); e.stopPropagation(); };
        img.onload = () => {
            imgWrap.style.minHeight = '';
            imgWrap.style.background = '';
            const isNearBottom = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 120;
            if (isNearBottom) cont.scrollTop = cont.scrollHeight;
        };
        imgWrap.appendChild(img);
        msgContent.appendChild(imgWrap);
    });

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
    
    const replyBtn = document.createElement('button');
    replyBtn.innerText = 'Reply';
    replyBtn.className = 'glass-btn-secondary';
    replyBtn.onclick = (e) => {
        e.stopPropagation();
        replyToMessage(messageId, msg.text, msg.sender_name);
        actionMenu.style.display = 'none';
    };
    actionMenu.appendChild(replyBtn);
    
    if (isMe) {
        const editBtn = document.createElement('button');
        editBtn.innerText = 'Edit';
        editBtn.className = 'glass-btn-secondary';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            editMessage(messageId, msg.text);
            actionMenu.style.display = 'none';
        };
        const deleteBtn = document.createElement('button');
        deleteBtn.innerText = 'Delete';
        deleteBtn.className = 'glass-btn-secondary delete-btn';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteMessage(messageId);
            actionMenu.style.display = 'none';
        };
        actionMenu.appendChild(editBtn);
        actionMenu.appendChild(deleteBtn);
    }
    
    actionsContainer.appendChild(actionButton);
    actionsContainer.appendChild(actionMenu);
    
    actionButton.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.msg-action-menu').forEach(m => { 
            if (m !== actionMenu) m.style.display = 'none'; 
        });
        actionMenu.style.display = actionMenu.style.display === 'none' ? 'flex' : 'none';
    };
    
    bubble.appendChild(actionsContainer);
    attachMessageContextMenu(bubble, messageId, msg, isMe);
    
    let avatarHtml;
    if (isSystem) {
        avatarHtml = `<div class="msg-avatar-fallback system-avatar" style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; display: flex; align-items: center; justify-content: center; border-radius: 50%; width: 28px; height: 28px; font-size: 15px;">🛡️</div>`;
    } else {
        const pfp = currentChatMemberPics.get(msg.sender_id);
        avatarHtml = pfp 
            ? `<img src="${pfp}" loading="lazy" decoding="async" class="msg-avatar-img" onclick="event.stopPropagation(); showUserProfile('${msg.sender_id}', currentChatId, currentChatCreatorId)">`
            : `<div class="msg-avatar-fallback">\u{1F464}</div>`;
    }

    const author = createAuthorElement(msg, () => showUserProfile(msg.sender_id, currentChatId, currentChatCreatorId));
    
    const timestampElem = document.createElement('span');
    timestampElem.className = 'msg-timestamp';
    const timeStr = formatSmartTimestamp(msg.timestamp);
    
    let viewCounterHtml = "";
    const isDM = currentChatId && currentChatId.includes('_');
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
    viewResultsBtn.className = 'glass-btn-secondary view-poll-results-btn';
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
    document.getElementById('poll-results-modal').style.display = 'none';
}

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
            if (pm) pm.style.display = 'none';
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
    
    const replyBtn = document.createElement('button');
    replyBtn.innerText = 'Reply';
    replyBtn.className = 'glass-btn-secondary';
    replyBtn.onclick = (e) => {
        e.stopPropagation();
        replyToMessage(messageId, "[Sticker]", msg.sender_name);
        actionMenu.style.display = 'none';
    };
    actionMenu.appendChild(replyBtn);
    
    if (isMe) {
        const deleteBtn = document.createElement('button');
        deleteBtn.innerText = 'Delete';
        deleteBtn.className = 'glass-btn-secondary delete-btn';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteMessage(messageId);
            actionMenu.style.display = 'none';
        };
        actionMenu.appendChild(deleteBtn);
    }
    
    actionsContainer.appendChild(actionButton);
    actionsContainer.appendChild(actionMenu);
    actionButton.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.msg-action-menu').forEach(m => { if (m !== actionMenu) m.style.display = 'none'; });
        actionMenu.style.display = actionMenu.style.display === 'none' ? 'flex' : 'none';
    };
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

function checkMuteStatus() {
    const myUid = auth.currentUser.uid;
    const myData = currentChatMemberData?.[myUid];
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const typingInd = document.getElementById('typing-indicator');
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
            document.getElementById('mute-modal').style.display = 'none';
            currentMuteTarget = null;
            currentMuteTargetName = null;
        }
    };
}

const cancelMuteBtn = document.getElementById('cancel-mute-btn');
if (cancelMuteBtn) {
    cancelMuteBtn.onclick = () => {
        const muteModal = document.getElementById('mute-modal');
        if (muteModal) muteModal.style.display = 'none';
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
        document.getElementById('edit-group-modal').style.display = 'none';
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

// --- Image Lightbox ---
function openImageLightbox(url) {
    const lb = document.getElementById('image-lightbox');
    const img = document.getElementById('lightbox-img');
    if (!lb || !img) return;
    img.src = url;
    lb.style.display = 'flex';
}
window.openImageLightbox = openImageLightbox;

// Modified sendImageMessage to always apply quality setting based on premium status
// This ensures all images sent have the correct quality.
async function sendImageMessage(base64Data) {
    if (!currentChatId) return;

    const mKey = push(ref(db, `messages/${currentChatId}`)).key;
    const senderName = document.getElementById('current-user-name').innerText;
    const updates = {};

    // Always apply quality setting based on premium status
    const quality = isCurrentUserPremium ? 0.9 : 0.7; // Premium users get higher quality (0.9), basic users get (0.7)
    
    const finalBase64 = await new Promise((resolve) => {
        const img = new Image();
        img.src = base64Data;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, img.width, img.height);
            resolve(canvas.toDataURL('image/jpeg', quality)); // Apply quality here
        };
        img.onerror = () => resolve(base64Data); // Fallback if image fails to load
    });

    updates[`/messages/${currentChatId}/${mKey}`] = {
        sender_id: auth.currentUser.uid,
        sender_name: senderName,
        text: finalBase64, // Use the processed base64 data
        timestamp: serverTimestamp()
    };

    updates[`/chats/${currentChatId}/last_message`] = "Sent an image";
    updates[`/chats/${currentChatId}/timestamp`] = serverTimestamp();

    const membersSnap = await get(ref(db, `members/${currentChatId}`));
    const members = membersSnap.val();
    if (members) {
        Object.keys(members).forEach(uid => { if (uid !== auth.currentUser.uid) updates[`/unread/${uid}/${currentChatId}`] = true; });
    }
    await update(ref(db), updates);

    // Lookup recipient's fcmToken from Firestore (with RTDB fallback) and trigger Cloudflare Worker notification for image
    if (members) {
        const recipientUids = Object.keys(members).filter(uid => uid !== auth.currentUser.uid);
        const chatSnap = await get(ref(db, `chats/${currentChatId}`));
        const chatData = chatSnap.val();
        const identityName = chatData?.isChannel ? chatData.title : (document.getElementById('current-user-name')?.innerText || senderName);

        recipientUids.forEach(async (rUid) => {
            try {
                let recipientFcmToken = null;
                try {
                    const userDocSnap = await getDoc(doc(firestore, "users", rUid));
                    if (userDocSnap.exists()) {
                        recipientFcmToken = userDocSnap.data()?.fcmToken;
                    }
                } catch (fsLookupErr) {}
                if (!recipientFcmToken) {
                    const userSnap = await get(ref(db, `users/${rUid}/fcmToken`));
                    recipientFcmToken = userSnap.val();
                }
                if (recipientFcmToken) {
                    sendPushNotification(recipientFcmToken, identityName, "Sent an image", { chatId: currentChatId });
                }
            } catch (notifyErr) {
                console.error("[FCM Worker] Error notifying recipient for image:", rUid, notifyErr);
            }
        });
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
    const amIAdmin = membersMap[myUid]?.role === 'admin';

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
        const uData = uSnap.val();
        return { 
            uid: mUid,
            displayName: getDisplayName(uData),
            profilePic: uData?.profilePic,
            isCreator: mUid === groupCreatorId,
            role: membersMap[mUid]?.role || 'member'
        };
    });
    const memberDetails = await Promise.all(memberDetailsPromises);

    // Populate names cache for tooltips
    memberDetails.forEach(m => {
        currentChatMemberNames.set(m.uid, m.displayName);
        currentChatMemberPics.set(m.uid, m.profilePic);
    });

    // Sort members: creator first, then others alphabetically by display name
    memberDetails.sort((a, b) => {
        if (a.isCreator && !b.isCreator) return -1;
        if (!a.isCreator && b.isCreator) return 1;
        return a.displayName.localeCompare(b.displayName);
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
            const roleInfo = getGroupRoleInfo(memberRole);
            const badgeHtml = (roleInfo && roleInfo.badge) ? `<span class="custom-user-badge" style="border-color: ${roleInfo.color}55; color: ${roleInfo.color};">${roleInfo.badge}</span>` : '';
            const displayName = getDisplayName(uData);
            const status = uData.status;
            const pfp = uData.profilePic;

            div.innerHTML = `
                <div class="member-item-content">
                    <div class="member-avatar-container">
                        ${pfp ? `<img src="${pfp}" class="member-avatar-img">` : `<div class="avatar-sm">\u{1F464}</div>`}
                        <span class="status-dot ${status === 'online' ? 'online' : ''}"></span>
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        ${member.isCreator ? '<span class="group-creator-label">Group creator</span>' : ''}
                        ${memberRole === 'admin' ? '<span class="admin-label">Admin</span>' : ''}
                        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
                            <span class="${nameplateClass}">${escapeHTML(displayName)}</span>
                            ${badgeHtml}
                        </div>
                    </div>
                </div>
            `;
            twemoji.parse(div);
            
            // Update cache for tooltips
            currentChatMemberNames.set(member.uid, displayName);
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
    const isDM = !currentChatId || currentChatId.includes('_');
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
    document.getElementById('sticker-picker-modal').style.display = 'none'; // Close picker after sending

    // Add current message to history AFTER successful send (to avoid adding failed messages)
    userRecentMessages.push({ text: txt, timestamp: currentTime });
    // Keep history length limited
    if (userRecentMessages.length > SPAM_MESSAGE_HISTORY_LENGTH) {
        userRecentMessages.shift(); // Remove the oldest message
        // No need to set recentUserMessages.set(myUid, userRecentMessages) here, as it's already a reference.
    }
    recentUserMessages.set(myUid, userRecentMessages);
    await update(ref(db), updates);

    // Lookup recipient's fcmToken from Firestore (with RTDB fallback) and trigger Cloudflare Worker notification
    if (members) {
        const recipientUids = Object.keys(members).filter(uid => uid !== auth.currentUser.uid);
        recipientUids.forEach(async (rUid) => {
            try {
                let recipientFcmToken = null;
                try {
                    const userDocSnap = await getDoc(doc(firestore, "users", rUid));
                    if (userDocSnap.exists()) {
                        recipientFcmToken = userDocSnap.data()?.fcmToken;
                    }
                } catch (fsLookupErr) {
                    // Fallback to RTDB
                }
                if (!recipientFcmToken) {
                    const userSnap = await get(ref(db, `users/${rUid}/fcmToken`));
                    recipientFcmToken = userSnap.val();
                }
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
document.getElementById('send-btn').onclick = sendMessage;
document.getElementById('sticker-btn').onclick = openStickerPicker;

setupInputAreaListeners();

function setupInputAreaListeners() {
    // --- Plus Menu Logic ---
    const plusBtn = document.getElementById('plus-btn');
    const plusMenu = document.getElementById('plus-menu');
    const createPollOption = document.getElementById('create-poll-option');
    const uploadImageOption = document.getElementById('upload-image-option');
    const fileUploadInput = document.getElementById('file-upload-input');
    const addPollOptionBtn = document.getElementById('add-poll-option-btn');
    const closePollModal = document.getElementById('close-poll-modal');
    const confirmPollBtn = document.getElementById('confirm-poll-btn');
    const pollModal = document.getElementById('poll-modal');
    const pollQuestionInput = document.getElementById('poll-question');
    const pollOptionsContainer = document.getElementById('poll-options-container');
    const openGamesOption = document.getElementById('open-games-option');

    if (plusBtn) {
        plusBtn.onclick = (e) => {
            e.stopPropagation();
            if (plusMenu) {
                const opening = plusMenu.style.display === 'none';
                plusMenu.style.display = opening ? 'flex' : 'none';
                if (opening) { // never show the upload menu and the emoji/sticker picker together
                    const ep = document.getElementById('emoji-picker');
                    if (ep) ep.style.display = 'none';
                    activeReactionMessageId = null;
                }
            }
        };
        document.addEventListener('click', () => { if (plusMenu) plusMenu.style.display = 'none'; });
    } else {
        console.error("Element with ID 'plus-btn' not found.");
    }

    if (openGamesOption) {
        openGamesOption.onclick = () => {
            if (plusMenu) plusMenu.style.display = 'none';
            document.getElementById('games-library-modal').style.display = 'flex';
        };
    }

    document.getElementById('select-flag-game').onclick = () => {
        document.getElementById('games-library-modal').style.display = 'none';
        document.getElementById('flag-game-lobby-modal').style.display = 'flex';
        setupGameLobby();
    };

    document.getElementById('cancel-game-btn').onclick = () => {
        document.getElementById('flag-game-lobby-modal').style.display = 'none';
        if (currentChatId && auth.currentUser) {
            remove(ref(db, `games/${currentChatId}/players/${auth.currentUser.uid}`));
        }
    };

    if (uploadImageOption && fileUploadInput) {
        uploadImageOption.onclick = () => {
            if (plusMenu) plusMenu.style.display = 'none';
            fileUploadInput.click();
        };

        fileUploadInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file || !file.type.startsWith('image/')) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                let base64 = event.target.result;
                if (base64.length > 1000000) {
                    const wantsResize = await showConfirm("Image Too Large", "This image exceeds the size limit. Would you like to automatically resize and compress it to send?");
                    if (wantsResize) {
                        base64 = await downscaleImageDimensions(base64);
                        sendImageMessage(base64);
                    }
                } else {
                    const confirmed = await showConfirm("Send Image", "Do you want to send this image?");
                    if (confirmed) sendImageMessage(base64);
                }
                fileUploadInput.value = '';
            };
            reader.readAsDataURL(file);
        };
    }

    if (createPollOption) {
        createPollOption.onclick = () => {
            if (plusMenu) plusMenu.style.display = 'none';
            if (pollModal) pollModal.style.display = 'flex';
            // Reset modal
            if (pollQuestionInput) pollQuestionInput.value = '';
            if (pollOptionsContainer) {
                pollOptionsContainer.innerHTML = '<label>Options</label><input type="text" class="poll-option-input" placeholder="Option 1"><input type="text" class="poll-option-input" placeholder="Option 2">';
            }
        };
    } else {
        console.error("Element with ID 'create-poll-option' not found.");
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
            if (pollModal) pollModal.style.display = 'none';
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
            if (pollModal) pollModal.style.display = 'none';
        };
    } else {
        console.error("Element with ID 'confirm-poll-btn' not found.");
    }
}

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

messageInput.onpaste = (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            const reader = new FileReader();
            reader.onload = async (event) => {
                let base64 = event.target.result;
                if (base64.length > 1000000) {
                    const wantsResize = await showConfirm("Image Too Large", "This image exceeds the size limit. Would you like to automatically resize and compress it to send?");
                    if (wantsResize) {
                        base64 = await downscaleImageDimensions(base64);
                        sendImageMessage(base64);
                    }
                } else {
                    const confirmed = await showConfirm("Send Image", "Do you want to send the image from your clipboard?");
                    if (confirmed) sendImageMessage(base64);
                }
            };
            reader.readAsDataURL(file);
        }
    }
};

// --- CAMERA UPLOAD FEATURE (PHONE ONLY) ---
const cameraBtn = document.getElementById('camera-btn');
const cameraInput = document.getElementById('camera-input');

function updateInputButtons() {
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const camBtn = document.getElementById('camera-btn');
    const stickerBtn = document.getElementById('sticker-btn');
    const plusBtn = document.getElementById('plus-btn'); // Get the plus button
    if (!input || !sendBtn || !camBtn) return;

    if (!currentChatId) {
        if (plusBtn) plusBtn.style.display = 'none'; // Hide plus button if no chat selected
        sendBtn.style.display = 'none';
        camBtn.style.display = 'none';
        return;
    }

    const isMobile = window.innerWidth <= 768;
    const isPremium = isCurrentUserPremium; // Use the global premium status
    const hasText = input.value.trim().length > 0;

    if (hasText) {
        sendBtn.style.display = isMobile ? 'flex' : 'none';
        camBtn.style.display = 'none';
        stickerBtn.style.display = 'none';
        if (plusBtn) plusBtn.style.display = 'none'; // Hide plus button if text is being typed
    } else {
        sendBtn.style.display = 'none'; // Hide send button if no text
        camBtn.style.display = isMobile ? 'flex' : 'none';
        stickerBtn.style.display = 'none'; // Integrated into emoji menu
        if (plusBtn) plusBtn.style.display = 'flex'; // Show plus button if no text and chat is open
    }
}

window.addEventListener('resize', updateInputButtons);

if (cameraBtn && cameraInput) {
    // Trigger the hidden file input when the camera button is clicked
    cameraBtn.onclick = () => cameraInput.click();

    cameraInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            let base64 = event.target.result;
            // Auto-resize if the captured photo is too large for RTDB
            if (base64.length > 1000000) {
                base64 = await downscaleImageDimensions(base64); // Call the new downscale function
            }
            sendImageMessage(base64);
            cameraInput.value = ''; // Reset input so the same photo can be taken again if needed
        };
        reader.readAsDataURL(file);
    };
}

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

    document.getElementById('creation-modal').style.display = 'none';
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
    document.getElementById('subchannel-modal').style.display = 'none';
    document.getElementById('subchannel-name-input').value = '';
    openChat(chatId, name);
};

document.getElementById('close-subchannel-modal').onclick = () => {
    document.getElementById('subchannel-modal').style.display = 'none';
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

const closePremiumBtn = document.getElementById('close-premium-panel');
if (closePremiumBtn) {
    closePremiumBtn.onclick = () => {
        const premiumModal = document.getElementById('premium-panel-modal');
        const profileModal = document.getElementById('profile-modal');
        closeAnimatedModal(premiumModal, () => {
            if (profileModal) openAnimatedModal(profileModal);
        });
    };
}

const premiumPanelModal = document.getElementById('premium-panel-modal');
if (premiumPanelModal) {
    premiumPanelModal.onclick = (e) => {
        if (e.target.id === 'premium-panel-modal') {
            const profileModal = document.getElementById('profile-modal');
            closeAnimatedModal(premiumPanelModal, () => {
                if (profileModal) openAnimatedModal(profileModal);
            });
        }
    };
}

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
        if (e.target.id !== 'premium-panel-modal' && e.target.id !== 'profile-modal' && e.target.id !== 'confirm-modal') {
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
        const verEl = document.getElementById('app-current-version');
        if (verEl) verEl.textContent = 'v' + CURRENT_APP_VERSION;
        const verElOld = document.getElementById('settings-app-version');
        if (verElOld) verElOld.textContent = CURRENT_APP_VERSION;
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
            const name = settingsNameInput.value.trim();
            const nameMsg = document.getElementById('settings-name-msg');
            if (!name) {
                if (nameMsg) { nameMsg.innerText = "Name can't be empty."; nameMsg.style.color = '#ff6b6b'; }
                return;
            }
            if (name.length > 80) {
                if (nameMsg) { nameMsg.innerText = "Name is too long (max 80 chars)."; nameMsg.style.color = '#ff6b6b'; }
                return;
            }
            try {
                await update(ref(db, `users/${auth.currentUser.uid}`), { displayName: name });
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
    if (lgToggle) lgToggle.onchange = () => {
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
    if (lgAnimToggle) lgAnimToggle.onchange = () => {
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
                playNotificationChime();
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

    async function openAdminPanelModal() {
        document.getElementById('profile-modal').style.display = 'none'; // Close profile modal
        document.getElementById('admin-panel-modal').style.display = 'flex';
        setActiveAdminTab('users');

        const adminUsersList = document.getElementById('admin-users-list');
        adminUsersList.innerHTML = '<p style="text-align: center; opacity: 0.7;">Loading users...</p>';

        const usersSnap = await get(ref(db, 'users'));
        const usersData = usersSnap.val();

        if (!usersData) {
            adminUsersList.innerHTML = '<p style="text-align: center; opacity: 0.7;">No users found.</p>';
            return;
        }

        adminUsersList.innerHTML = '';
        let totalUsers = 0;
        let premiumUsers = 0;

        for (const uid in usersData) {
            totalUsers++;
            const user = usersData[uid];
            if (user.type === 'Premium' || user.isAdmin === true || String(user.isAdmin).toLowerCase() === "true") {
                premiumUsers++;
            }

            const item = document.createElement('div');
            item.className = 'selection-item';
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.innerHTML = `
                <div>
                    <strong>${escapeHTML(getDisplayName(user))}</strong>
                    <small style="display: block; opacity: 0.7;">${escapeHTML(user.email || "")}</small>
                    <small style="display: block; opacity: 0.5;">Type: <span id="user-type-${uid}">${user.type || "Basic"}</span></small>
                </div>
                <div style="display: flex; gap: 5px;">
                    <button class="glass-btn-secondary" data-uid="${uid}" data-type="Basic">Basic</button>
                    <button class="glass-btn-primary" data-uid="${uid}" data-type="Premium">Premium</button>
                </div>
            `;
            adminUsersList.appendChild(item);
        }

        document.getElementById('stat-total-users').innerText = totalUsers;
        document.getElementById('stat-premium-users').innerText = premiumUsers;

        // Add event listeners to the new buttons
        adminUsersList.querySelectorAll('.glass-btn-secondary, .glass-btn-primary').forEach(button => {
            button.onclick = async (e) => {
                const targetUid = e.target.dataset.uid;
                const newType = e.target.dataset.type;
                if (targetUid && newType) {
                    await updateUserType(targetUid, newType);
                }
            };
        });
    }

    async function updateUserType(targetUid, newType) {
        try {
            await update(ref(db, `users/${targetUid}`), {
                type: newType
            });
            document.getElementById(`user-type-${targetUid}`).innerText = newType; // Update UI immediately
        } catch (err) {
            console.error("Error updating user type:", err);
            showNotification("Failed to update user type", "error");
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

    listEl.innerHTML = '<div style="text-align: center; padding: 20px; opacity: 0.5;">Loading members...</div>';

    try {
        const membersSnap = await get(ref(db, `members/${chatId}`));
        const membersMap = membersSnap.val() || {};
        const memberUids = Object.keys(membersMap);
        if (countEl) countEl.innerText = memberUids.length;
        if (statsEl) statsEl.innerText = `${memberUids.length} member${memberUids.length !== 1 ? 's' : ''} \u2022 ${chatData.isChannel ? 'Broadcast Channel' : 'Group Chat'}`;

        const detailsPromises = memberUids.map(async (uid) => {
            const uSnap = await get(ref(db, `users/${uid}`));
            const uData = uSnap.val() || {};
            return {
                uid,
                displayName: getDisplayName(uData),
                profilePic: uData.profilePic,
                role: membersMap[uid]?.role || 'member',
                isCreator: uid === chatData.creatorId,
                status: uData.status
            };
        });
        const details = await Promise.all(detailsPromises);
        details.sort((a, b) => {
            if (a.isCreator && !b.isCreator) return -1;
            if (!a.isCreator && b.isCreator) return 1;
            return a.displayName.localeCompare(b.displayName);
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
        document.getElementById('edit-group-modal').style.display = 'none';
        deleteGroup(chatId);
    };
}

document.getElementById('close-edit-group-modal').onclick = () => {
    document.getElementById('edit-group-modal').style.display = 'none';
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
        document.getElementById('edit-group-modal').style.display = 'none';
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

    document.getElementById('edit-group-modal').style.display = 'none'; // Close edit modal
    document.getElementById('add-members-to-group-modal').dataset.chatId = chatId; // Store chatId
    selectedNewGroupMembers = []; // Reset selection only when opening the modal
    document.getElementById('add-members-to-group-modal').style.display = 'flex';
    populateAddMembersSelection(chatId);
};

document.getElementById('close-add-members-modal').onclick = () => {
    document.getElementById('add-members-to-group-modal').style.display = 'none';
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
        document.getElementById('add-members-to-group-modal').style.display = 'none';
        // Optionally, re-open the edit group modal or refresh the chat members list
        // For now, we'll just close the add members modal.
    } catch (err) {
        console.error(err);
        showNotification("Failed to add members", "error");
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
        document.getElementById('toggle-scanner-btn').innerText = "Open Camera";
    }
}

document.getElementById('toggle-scanner-btn').onclick = () => {
    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("reader");
        const config = { fps: 10, qrbox: { width: 250, height: 250 } };
        html5QrCode.start({ facingMode: "environment" }, config, async (decodedText) => {
            // Stop immediately to prevent duplicate alerts
            await stopScanner();
            document.getElementById('add-friend-modal').style.display = 'none';
            
            if (decodedText) {
                const code = decodedText.trim().toUpperCase();
                const q = query(ref(db, 'users'), orderByChild('friendId'), equalTo(code));
                const snap = await get(q);
                if (snap.exists()) {
                    addFriend(auth.currentUser.uid, Object.keys(snap.val())[0]);
                } else {
                    showNotification("User not found for this QR code.", "error");
                }
            }
        }).catch(err => {
            console.error(err);
            showNotification("Camera error: " + err, "error");
        });
        document.getElementById('toggle-scanner-btn').innerText = "Stop Camera";
    } else {
        stopScanner();
    }
};

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
    document.getElementById('sticker-picker-modal').style.display = 'none';
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
        document.getElementById('sticker-request-notification-modal').style.display = 'none';
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
        document.getElementById('sticker-request-notification-modal').style.display = 'none';
        currentStickerRequest = null;
    }
};

document.getElementById('close-sticker-request-notification-modal').onclick = () => {
    document.getElementById('sticker-request-notification-modal').style.display = 'none';
    currentStickerRequest = null;
};

/* ---------------- MEMBERS PANEL ---------------- */

document.getElementById('open-members-panel').onclick = (e) => {
    e.stopPropagation(); // Prevent the toggle click from immediately triggering the "click outside" listener
    document.body.classList.toggle('members-open');
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
    
    activeMemberStatusOffs.forEach(offFunc => offFunc());
    activeMemberStatusOffs.clear();
    currentChatMemberNames.clear();
    activeChatPartnerOff = null;
    updateTypingStatus(false);
    
    activeChatMetaOff = null;
    activeMembersOff = null;
    activeMessagesOff = null;

    currentChatId = null;
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
            if (pm) pm.style.display = 'none';
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
        document.getElementById('sticker-pack-preview-modal').style.display = 'none';
        currentPackPreviewId = null;
    };
}

const closeCreatePackBtn = document.getElementById('close-create-pack-modal');
if (closeCreatePackBtn) {
    closeCreatePackBtn.onclick = () => {
        document.getElementById('create-pack-modal').style.display = 'none';
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
            document.getElementById('create-pack-modal').style.display = 'none';
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
const closedAt = localStorage.getItem('premiumBannerClosedAt');

if (closedAt && promoBanner) {
    const elapsed = Date.now() - parseInt(closedAt);
    if (elapsed < 300000) { // Keep hidden for 5 minutes (300,000ms)
        promoBanner.style.display = 'none';
    }
}

document.getElementById('close-premium-banner').onclick = (e) => {
    e.stopPropagation();
    if (promoBanner) promoBanner.style.display = 'none';
    localStorage.setItem('premiumBannerClosedAt', Date.now().toString());
};

document.getElementById('open-payment-modal-btn').onclick = () => {
    document.getElementById('payment-modal').style.display = 'flex';
};

document.getElementById('close-payment-modal').onclick = () => {
    document.getElementById('payment-modal').style.display = 'none';
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
