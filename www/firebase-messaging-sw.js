// Updated to use a stable version
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const firebaseConfig = {
    apiKey: "AIzaSyB6cY9r8eyDmqvWeUKIUpUxIGY5R_4Mqn8",
    authDomain: "orion-291b5.firebaseapp.com",
    databaseURL: "https://orion-291b5-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "orion-291b5",
    storageBucket: "orion-291b5.firebasestorage.app",
    messagingSenderId: "39660435419",
    appId: "1:39660435419:web:6541a6c95aa7ab7ad319fe"
};

firebase.initializeApp(firebaseConfig);

let messaging = null;
if (firebase.messaging.isSupported()) { // Check if messaging is supported in this environment
    try {
        messaging = firebase.messaging();
    } catch (e) {
        console.error("Failed to initialize messaging in SW:", e);
    }
} else {
    console.warn("Firebase Messaging is not supported in this service worker environment.");
}

if (messaging) {
    messaging.onBackgroundMessage((payload) => {
        console.log('[firebase-messaging-sw.js] Background message received: ', payload);

        // We no longer call self.registration.showNotification() here.
        // Because the FCM payload now includes a 'notification' object, 
        // the browser displays it automatically. 
        // Handling it here manually causes a duplicate.
    });
}

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    // Safely extract data, handling missing payload edge cases
    const data = event.notification.data || {};
    const chatId = data.chatId || null;
    
    // Construct the absolute target URL based on provided URL or fallback to chat path
    const targetUrl = new URL(data.url || (chatId ? `/?chat=${chatId}` : '/'), self.location.origin).href;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // Edge case: App already open (possibly in multiple tabs)
            for (const client of windowClients) {
                if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                    // Focus an existing tab instead of creating a new one
                    return client.focus().then((focusedClient) => {
                        if (chatId) {
                            // Seamless SPA navigation: notify main thread to load DM
                            focusedClient.postMessage({ type: 'NAVIGATE_TO_CHAT', chatId: chatId });
                        } else if (focusedClient.url !== targetUrl) {
                            // If no specific chat but a different URL was requested, navigate
                            focusedClient.navigate(targetUrl);
                        }
                    });
                }
            }
            
            // Edge case: No matching tab exists. Open new window directly to the chat URL
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});

// Force immediate activation when service worker changes
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});