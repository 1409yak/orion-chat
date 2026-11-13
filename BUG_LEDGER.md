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

- *UI Rendering Fix:* Google Drive video iframe controls were clipping on mobile due to fixed height constraints. Solution: Wrapped the iframe in a responsive 4:3 aspect-ratio container (`padding-top: 75%`) with `overflow: hidden` and styled borders to guarantee the internal Drive player has adequate space to render its UI controls cleanly.

- *Feature Launch (v1.2.0):* Upgraded the custom Drive API pipeline to fully support video attachments. Expanded HTML file inputs to `image/*,video/*` and implemented a 50MB file size hard limit prior to `readAsDataURL` execution to prevent mobile WebView RAM exhaustion crashes during base64 encoding.

- *Mobile Render & DB Fix:* Google Drive images failed to load on phones because the Capacitor custom URL scheme triggered Google's hotlink protection. Solution: Added `referrerpolicy="no-referrer"` to media tags. Fixed a crashing background task by adding `".indexOn": "timestamp"` to the `messages` node in Firebase rules.

- *UI Rendering Fix:* Google Drive `export=view` links returned HTML, causing `<img src>` tags to fail and display duplicate 'Shared image' alt text. Solution: Intercepted the Drive ID and routed images through the Google Drive `thumbnail` API for raw pixel rendering. Switched videos to `iframe` embeds to bypass Google CORS streaming blocks. Cleared legacy `text: 'Shared image'` payloads to prevent double-bubble nesting.

- *Architecture Upgrade:* Migrated media uploads from Firebase Storage to a custom Google Apps Script backend hooked into a 5TB Google Drive to eliminate bandwidth costs. Configured a Base64 POST pipeline and isolated Time-Driven triggers for automated 5-day deletion.

- *Architecture & Security:* Added local Firebase rules management. Updated `$chatId` rules to check group `members` arrays, fixing `PERMISSION_DENIED` errors for group lobbies. Replaced strict underscore string checks for DM identification with `!chatData.isGroup` evaluations. Added a 30-minute stale lobby overwrite to prevent chat locking.

- *Game Engine Crash:* Lobbies failed to open in group chats because the initialization script relied on extracting a single `opponentId`. Solution: Replaced DM-specific opponent lookups with generic group-safe initialization payloads and enforced a 2-player minimum check before starting.

- *Gameplay Enhancement:* Implemented Gartic-style logic for Doodle Dash. Added a native RGB color wheel, live chat feed for guesses, anti-spoiler blind logic hiding correct guessers' messages from active guessers, and a 3-second post-round word reveal screen.

- *UI & Logic Overhaul:* Replaced default browser `<select>` and `<input type="color">` with custom, theme-styled segmented controls and color swatches. Patched Doodle Dash word repetition by tracking a `usedWords` array in Firebase and filtering the available pool during turn advances.

- *Game Overhaul:* Upgraded Doodle Dash from single-round to turn-based multi-round rotation. Added round configuration lobby selector, letter-count hint generation (`_ _ _ _`), timer scaled to word difficulty, and a point scoring system based on answer speed leading to a final podium ranking.

- *Feature Integration:* Added 'Doodle Dash' multiplayer drawing game. Implemented relative-coordinate `pointermove` syncing to Firebase `child_added` nodes, ensuring cross-device aspect ratio scaling and instant state retrieval for late joiners.

- *Navigation Enhancement:* In-app notifications for new messages were purely visual. Solution: Upgraded `showNotification` to accept `onClick` callbacks, allowing users to tap a notification toast to instantly switch to the originating chat, complete with mobile drawer auto-close logic.

- *Notification Overhaul:* In-app toasts were firing redundantly for active chats. Solution: Suppressed notifications if `incomingChatId === currentChatId`. Implemented `playThemeNotification()` to route audio files based on the active `body.theme-*` class.

- *Theme Overhaul:* The Retro 2000s theme was a flat, ugly white. Solution: Injected an authentic MSN/XP Luna aesthetic using metallic silver gradients (`#ece9d8`), glossy blue accents (`#0b77e9`), text inversion, and enforced `Tahoma` as the base font.

- *UI Color Clash:* The sidebar retained a hardcoded navy-blue tint (`rgba(14, 18, 42)`) that clashed with non-blue themes. Solution: Stripped out the navy base values and enforced `var(--solid-panel)` mixed dynamically with `var(--accent)` across both desktop and mobile breakpoints.

- *UI & Logic Enhancement:* Fixed left-screen overflow on action menus via `Math.min/max` boundaries. Overhauled pinning to support up to 5 concurrent pins in groups (3 in DMs) via a horizontal CSS snap-scroll container. Pinned messages bypass the 5-day retention limit and are purged upon unpinning if expired.

- *Feature Enhancement:* Added message pinning. Included a dynamic `pinnedMessageId` listener to render a clickable banner header. Enforced group role checks (Admins/Mods only in groups; open access in DMs) for the Pin/Unpin actions.

- *Game Engine Exploit:* Players could submit invalid 5-letter gibberish strings (e.g., 'AAAAA') in Word Rush to brute-force color hints. Solution: Added a pre-submission `fetch` validation against `api.dictionaryapi.dev`, blocking progression and throwing an error toast if a 404 is returned.

- *Feature Integration:* Added 'Word Rush' (multiplayer Wordle). Implemented localized grid rendering, strict tile color validation (consuming characters to prevent duplicate yellow hints), async completion state, and ranked podium sorting based on win status, attempts, and timestamp.

- *Asset Configuration:* Reverted web UI elements back to `orion.png` for consistency, while utilizing `orion.svg` exclusively for the native Android launcher icon.

- *Asset Optimization:* Replaced legacy raster `orion.png` with scalable `orion.svg` for the favicon, auth screen, and empty chat state.

- *Game Stability & UI:* Accidental touches outside the game container closed the modal and kicked players. Dynamically injected game emojis rendered as missing glyphs. Solution: Added game modals to the global click-outside exclusion list and explicitly called `twemoji.parse()` on dynamically generated chest/victim buttons.

- *Dead Lobby Trap:* Trying to start a new game immediately after finishing one would trap the user in the dead lobby. Solution: Marked games as `status: 'finished'` at 00:00, extended the podium timeout to 5 minutes, and explicitly purged any `finished` games when a user requests a new lobby from the menu.

- *Sidebar Theming & Paywall Leak:* Liquid Glass toggles were clickable by Basic users, and the sidebar felt disconnected from the active theme. Solution: Intercepted toggle events to enforce Premium status, and injected `color-mix()` CSS to blend `--accent` into the sidebar's background and borders globally.

- *UI & Theme Overhaul:* Non-liquid glass destroyed themes, AMOLED wasn't true black, and action/game menus overflowed on mobile. Solution: Implemented fallback CSS variables (`--solid-bg`), forced #000000 on AMOLED, bounded the action menu to window width via JS, and added responsive grid/text clamping to game buttons.

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

