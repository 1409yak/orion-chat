# Orion Chat: Historical Bug Ledger

> **PURPOSE:**  
> This ledger documents critical historical bugs, their root causes, and verified architectural solutions. Before refactoring or implementing fixes, review this ledger to prevent regressions.

---

| Bug ID | Bug Symptom | Root Cause | Solution & Architectural Rule |
| :--- | :--- | :--- | :--- |
| **BUG-001** | **Capgo Checksum Mismatch**<br>App fails OTA update with checksum validation error. | Cloudflare Edge and GitHub release caches serving stale zips when tags or releases were overwritten or re-uploaded without version bumping. | **Anti-Mismatch Protocol:** Always bump `CURRENT_APP_VERSION` to a brand-new semver tag. Never overwrite existing GitHub releases. Calculate the SHA-256 hash strictly *after* packaging `bundle.zip`. Verify through the Cloudflare Worker proxy endpoint before concluding. |
| **BUG-002** | **Main-Thread HEIC Upload Freeze**<br>Selecting high-res iPhone/HEIC images locked the UI thread or crashed the WebView. | Native Android WebView does not natively decode `.heic`/`.heif` images; synchronous FileReader operations and unthrottled canvas downscaling consumed excessive memory. | Integrated `heic2any` library into `<head>` of `index.html`. Refactored `compressImageAsync` to be fully asynchronous, intercepting `.heic` extensions and converting to JPEG before canvas resizing. Injected `setTimeout(..., 0)` to yield control back to the UI thread. |
| **BUG-003** | **Endless OTA Update Loop**<br>App continuously re-downloaded and re-prompted for the same update on every launch. | `checkForUpdates()` compared `manifest.version` directly against the static fallback string `CURRENT_APP_VERSION` instead of querying Capgo's active bundle container. | Always query Capgo's live runtime version first: `const current = await window.Capacitor.Plugins.CapacitorUpdater.current(); if (current?.bundle?.version) currentVersion = String(current.bundle.version);`. Only prompt if remote manifest is strictly newer. |
| **BUG-004** | **linkifyAndEmbed Crash**<br>App crashed with `TypeError: Assignment to constant variable` when rendering chat messages. | In `linkifyAndEmbed(rawText)`, variables (`escaped`, `text`, `html`) were declared with `const` but subsequently reassigned during URL, emoji, and mention regex replacement passes. | Declared all mutating variables with `let` (`let text`, `let escaped`, `let html`). Added type guards to sanitize and validate inputs before running regex operations. |
| **BUG-005** | **Firebase Permission Denied**<br>Console filled with Realtime Database permission denied errors on app startup. | `ensureOrionUpdatesChannel()` attempted to write a membership record (`members/channel_orion_updates/${uid}`) to the system broadcast channel, which has strict server-side read-only security rules. | Added a guard clause in `ensureOrionUpdatesChannel`: `if (channelId !== 'channel_orion_updates') { ... }` to skip member writes for the announcement channel while allowing read subscription. |
| **BUG-006** | **Stale Base APK Compilation**<br>Newly compiled Android debug APK still loaded older web assets (e.g. v1.0.1) instead of the latest code. | Gradle's incremental build cache and `npx cap sync android` failed to overwrite assets when source timestamps or directories had minor drift. | Bypass `cap sync` when necessary by directly clearing and injecting `OrionWeb` assets into `android/app/src/main/assets/public`. Verify version strings in memory before compiling, and build using `.\gradlew.bat clean assembleDebug --no-build-cache`. |
| **BUG-007** | **Main-Thread Lock During Server Upload Execution**<br>UI thread deadlocked immediately following `[UPLOAD] Initiating server upload for: ...` log. | 1. `fileUploadInput.onchange` invoked a blocking DOM modal `showConfirm` after file selection.<br>2. `sendImageMessage` ran a redundant second canvas re-compression pass via synchronous `canvas.toDataURL('image/jpeg')` on large images.<br>3. Foreground notification dispatches blocked the write. | 1. Removed `showConfirm` modal from file picker.<br>2. Created `blobToDataUrlAsync` with non-blocking `FileReader`.<br>3. Eliminated the redundant second canvas pass (relies on `compressImageAsync`'s native `canvas.toBlob`).<br>4. Injected event loop yields (`await new Promise(r => setTimeout(r, 0))`).<br>5. Offloaded push notification dispatches to background tasks. |

---

## Recent Fixes & Feature Enhancements

- *TikTok Silent Failure:* Mobile short-links failed to embed silently due to CORS redirect restrictions. Solution: Implemented dual regex to harden full-link iframes with `encrypted-media` tags and render a graceful fallback UI message for mobile short-links.

- *Embed Misses:* YouTube Shorts and some TikTok desktop links were bypassed by strict regex. Solution: Added `/shorts/` explicitly to the YouTube filter and loosened the TikTok regex. (Note: Mobile TikTok short-links remain un-embeddable client-side due to CORS redirect blocks).

- *Feature Enhancement:* Links to TikTok and Instagram were just plain text. Solution: Parsed specific URL parameters and injected native iframe embeds directly into the chat flow.

- *Missing Samsung Keyboard Support:* Native keyboard stickers were being ignored by the text input. Solution: Added a `paste` event listener to `#message-input` to intercept rich image blobs and route them instantly through `handleMediaUpload`.

- *Nag Screen:* Premium/Admin users were still receiving the Support Us popup. Solution: Added `display: none` by default and bound the banner's visibility logic directly to the `fetchMyProfile` tier evaluation.

- *Live QR Scanner Blocked:* Missing native plugin caused Android to permanently block `getUserMedia`. Solution: Ripped out live video feed and replaced `#toggle-scanner-btn` logic with `Html5Qrcode.scanFile()` utilizing a native `<input type="file" capture="environment">`.

- *QR Camera Native Plugin Missing:* Android base APK lacked compiled @capacitor/camera code. Solution: Provided Html5Qrcode.scanFile fallback via standard file/camera capture input.

- *QR Scanner Permission Denied:* WebView threw `NotAllowedError` because native OS permissions weren't granted. Solution: Dynamically imported `@capacitor/camera` to trigger the Android native camera permission prompt before initializing the HTML5 web scanner.
- *Lobby Management:* Games lacked host reassignment and stale lobby cleanup. Solution: Added peer-to-peer host reassignment for the oldest remaining player, 5-minute empty lobby expiration, and a strict 2-player minimum to start.
- *UI Polish:* Replaced emoji paperclip with a minimalist SVG vector and overhauled poll message styling for a cleaner, cohesive aesthetic.
- *Invisible Modal Freezes:* Legacy modals opened via `display: flex` lacked the new opacity classes, creating transparent full-screen UI blocks. Solution: Injected a global MutationObserver to automatically append `modal-visible` to dynamically opened modals.
- *Unresponsive Paperclip:* Static event listeners severed during DOM refresh. Solution: Implemented global Event Delegation to dynamically route clicks for the paperclip and attachment options.
- *Null TypeError Crash:* Orphaned onclick listeners for deleted UI elements crashed app.js. Solution: Scrubbed dead listeners and properly mapped the right-side paperclip design using stable legacy DOM IDs.
- *Menu Unclickable & Console Spam:* Adblockers blocked accidental Firestore WebChannel injection, and new menu wrapper broke click targets. Solution: Stripped Firestore imports to enforce Realtime DB WebSockets and reverted menu to legacy #plus-btn design mapped to a paperclip icon.
- *Fatal Syntax Error:* Duplicate `const cameraInput` declaration crashed `app.js` on load, breaking the login screen. Solution: Removed legacy variable declarations and consolidated the camera DOM inputs.
- *Menu Invisible & Adblock Drops:* Adblockers dropped WebChannel XHRs, and the consolidated menu lacked strict z-indexing. Solution: Forced DB WebSockets and rebuilt the attachment HTML with absolute positioning and high z-index.
- *Game Mode Migration:* Flag guessing game dropped during previous UI consolidation. Solution: Successfully ported legacy game HTML, CSS, and state machine logic into the latest build.
- *Phantom UI Freezes:* Screen stopped responding to taps after scrolling. Solution: Added `touchcancel` event listener to reset stuck swipe-to-reply states when Android OS interrupts gestures.
- *Game Mode Broken:* Flag game trigger disconnected during menu consolidation. Solution: Re-bound the unified Games button to the game initialization function and secured the game modal DOM.
- *UI Fragmentation:* Redundant attachment menus on left (+) and right (paperclip). Solution: Consolidated all media, poll, and game options into a single restyled paperclip dropdown on the right.
- *UI Clipping & Crowding:* File button displaced camera, and context menu clipped off-screen at chat bottom. Solution: Consolidated attachments into a popover menu and added viewport boundary math to dynamically render context menus above or below messages.
- *Swipe Gestures:* Implemented X/Y axis touchmath to enable horizontal swipe-to-reply on message bubbles while preserving vertical chat scrolling.
- *All Photos Sending As Stickers:* The isSticker flag leaked into standard uploads, and native keyboard intercepts remained blocked by OEM WebViews. Solution: Rolled back custom sticker logic to restore standard photo bubbles.
- *Android Keyboard Block:* WebViews natively reject IME CommitContent. Solution: Bypassed keyboard restriction by adding a dedicated attachment button for gallery stickers.
- *Keyboard Media Blocked:* Android OS blocked rich media paste into standard text inputs. Solution: Converted chat input to `contenteditable='true'` div to signal rich media support to the native keyboard.
- *Native Keyboard Stickers:* Intercepted Android keyboard paste events to send local gallery/keyboard stickers as transparent images.
- *Message Menu Overlap:* Menu hidden under subsequent messages. Solution: Dynamically elevated parent message z-index when menu is active.
- *Mobile Context Menu:* Bound menu trigger directly to message tap on mobile, hiding the legacy dropdown button.
- *Viewer Download Fail:* WebViews silently block web downloads. Solution: Enforced @capacitor/filesystem to write to Directory.Documents.
- *Native Filesystem Unavailable:* Missing native plugin in build. Solution: Installed @capacitor/filesystem and compiled a new base APK.
- *OTA Check Connection Error:* App reverted to CORS-blocked releases URL. Solution: Hardcoded raw.githubusercontent.com URL into base APK v1.1.9.
- *Filesystem Plugin Unavailable:* Capacitor 3+ requires manual JS registration. Solution: Used `Capacitor.registerPlugin('Filesystem')` and string enum `'DOCUMENTS'` in v1.1.10.
- *False Negative isNative Check:* Capgo OTA obfuscated the `isNative` boolean. Solution: Bypassed boolean and checked directly for `window.Capacitor.registerPlugin` in v1.1.11.
- *Vanilla JS Bridge Failure:* Missing JS proxies for Filesystem plugin. Solution: Utilized dynamic ES module imports (`import()`) via CDN to bridge the vanilla JS directly to the native API.
- *App Lag:* DOM bloat and media RAM leaks. Solution: Capped group chat initial load to 15 messages and explicitly nullified image src/blob references to trigger garbage collection.
- *Excessive Network Requests:* App redownloaded identical chat history on every room open. Solution: Implemented stale-while-revalidate local caching to load instantly from disk and background-sync delta changes.

