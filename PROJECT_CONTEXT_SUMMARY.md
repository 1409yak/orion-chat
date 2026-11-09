# Orion Chat: Project Context & Architecture Overview

> **SYSTEM NOTE TO AI:**  
> If you are reading this file at the start of a new chat session, acknowledge the architecture, read `BUG_LEDGER.md` to avoid repeating mistakes, and strictly adhere to `AI_UPDATE_SOP.md` for any deployment requests.

---

## 1. Application Overview & Tech Stack

Orion Chat is a real-time messaging application wrapped in a native Android shell with full Over-The-Air (OTA) self-hosted updates.

- **Frontend / Web Client:** Pure HTML5, modern vanilla JavaScript (ES modules), CSS3 glassmorphism design.
- **Backend / Cloud Services:**
  - **Firebase Authentication:** User login, email verification, account sessions.
  - **Firebase Realtime Database (RTDB):** Instant chat messages, typing indicators, user online presence, sticker packs, reactions, and dynamic channel data.
  - **Firebase Firestore:** User directory, FCM push notification token registry, user profile metadata.
  - **Cloudflare Worker (`orion-fcm-worker`):** Push notification routing to Firebase Cloud Messaging (FCM) v1 HTTP API, and OTA release asset proxying.
- **Mobile Container:** Capacitor 8 (`@capacitor/android`, `@capacitor/keyboard`, `@capacitor/push-notifications`, `@capgo/capacitor-updater`).

---

## 2. Workspace & Multi-Repository Architecture

The project spans three coordinated directories in `C:\Users\HP User\Documents\My websites\`:

```text
My websites/
├── OrionApp/                  # Capacitor 8 Android native wrapper project
│   ├── android/               # Native Android Studio Gradle project
│   ├── www/                   # Web assets synced for Capacitor builds
│   ├── capacitor.config.json  # Capacitor configuration (appId: com.mymessenger.app)
│   ├── AI_UPDATE_SOP.md       # Standard Operating Procedure for releases
│   ├── BUG_LEDGER.md          # Architectural history & bug register
│   └── PROJECT_CONTEXT_SUMMARY.md # This document
│
├── OrionWeb/                  # Pure Web Production Directory (GitHub: 1409yak/orion-web)
│   ├── index.html             # Main single-page interface
│   ├── app.js                 # Core client logic, UI state, and updater
│   ├── style.css              # Universal application styling
│   ├── version.json           # Live version manifest for OTA checking
│   └── firebase-messaging-sw.js # Service worker for background notifications
│
└── OrionTests/                # Core repository & backend tools (GitHub: 1409yak/orion-chat)
    ├── .github/workflows/     # Automated OTA packaging and release action
    ├── orion-fcm-worker/      # Cloudflare Worker source code
    ├── scripts/               # Utility scripts (e.g. post-update-announcement.js)
    └── rules.json             # Firebase Realtime Database security rules
```

---

## 3. Over-The-Air (OTA) Update Pipeline

Orion Chat uses a self-hosted Capgo update pipeline with zero external Capgo Cloud dependencies:

1. **Manifest Distribution:**
   - The app queries `https://raw.githubusercontent.com/1409yak/orion-web/main/version.json?t=${Date.now()}`.
   - Query parameter `?t=...` ensures instant cache-busting past GitHub Fastly and Cloudflare Edge caching.
2. **Download Proxy (`orion-fcm-worker`):**
   - The download URL in `version.json` points to:
     `https://orion-fcm-worker.gaim.workers.dev/download-ota/v[VERSION]/bundle.zip`
   - The worker acts as a CORS-friendly proxy, fetching the release asset from `1409yak/orion-chat/releases/download/v[VERSION]/bundle.zip` and streaming it with `Cache-Control: no-cache, no-store, must-revalidate`.
3. **Capgo Container Update:**
   - `window.Capacitor.Plugins.CapacitorUpdater.download(...)` downloads and extracts the zip into a sandboxed bundle container.
   - `window.Capacitor.Plugins.CapacitorUpdater.set(...)` switches the active WebView root to the new container on next reload.
   - `window.Capacitor.Plugins.CapacitorUpdater.notifyAppReady()` locks in the update to prevent auto-rollback.

---

## 4. Current State & Baseline

- **Current Version:** `v1.1.18`
- **Native Android Base APK:** Freshly compiled debug APK (`app-debug.apk`) with native HEIC support (`heic2any`), bulletproof Capgo container checking, read-only broadcast channel guards, fully asynchronous non-blocking image upload pipeline, WhatsApp-style full-screen image viewer, dynamic ES module imports via CDN for native Filesystem JS proxies, hardcoded raw manifest URL, standard chat photo uploads and viewer modal, and Material Symbols.
- **OTA Release Status:** `v1.1.18` published on GitHub releases, Cloudflare Pages, and live on `version.json`. Checksums verified with 100% parity.
- **Announcement Channel:** Updates automatically broadcast to `channel_orion_updates` with interactive in-message update install cards (`[UPDATE_VERSION:x.x.x]`).
