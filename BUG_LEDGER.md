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

- *Liquid Glass Default & Orion 2.0 Beta Redesign (v1.2.48):* Enabled Liquid Glass by default for all users. Built a massive theme-compatible 'Orion 2.0 [BETA]' redesign (`beta-redesign.css` + `body.orion-beta`) gated exclusively to Premium & Admin users (with live downgrade enforcement and a Settings unlock teaser for Free accounts). Added the Obsidian Spatial design system, collapsible Members drawer, unified composer dock, embedded game lobby cards, and a `Ctrl+K` Quick Switcher.

- *Theme-Fitting Liquid Glass & Soft Members Panel (v1.2.47):* Replaced neutral gray glass and hardcoded purple active-chat highlights with theme-adaptive `color-mix()` Liquid Glass tokens (`--glass-accent`, `saturate(165%)`, directional specular top-rim shadows). Converted the sharp-cornered Members panel into a rounded floating glass card with soft borders and harmonized incoming/outgoing bubble edges.

- *Instant Tab Switching, Open Stickers, Mod Audit & Hover Actions (v1.2.46):* Added `window.chatMessageCache` (LRU 20 chats) with `window._chatSwitchToken` race guards, atomic `DocumentFragment` `replaceChildren` swaps, scroll position persistence/restoration before listener attach, and stabilized header avatar/title updates. Replaced sticker approval requests with free community stickers and live `stickerStats` (`usageCount` transactions + `owners` saved counts) with Popular/Newest sorting across pickers. Audited global/group moderator permissions across UI and `database.rules.json` (delete non-admin messages, pin, mute non-global-admins, kick non-admins, delete stickers). Removed `#edit-group-btn` in favor of a clickable group title header, upgraded `.msg-quick-actions` into an SVG action pill (with touch tap-to-toggle dismissal), and removed legacy triangle menus and bottom context sheets.

- *Final UI Polish (Patch 4):* Added shimmering chat skeleton loaders and empty-chat states, automatic Today/Yesterday/Date message dividers synced on add/delete/prepend, real-time multi-user typing indicators (`typing/${chatId}/${uid}`) with `onDisconnect` cleanup and Firebase rules, and subtle anti-spam Web Audio incoming message chimes with a Settings toggle.

- *Chat Ergonomics & Visual Cohesion (Patch 3):* Added Discord-style 5-minute consecutive message grouping (with delete/prepend re-evaluation), a desktop-only 1-click hover action pill (Reply/React/Pin) that flips away from the Members sidebar on outgoing messages, smooth image placeholder fade-ins, and unified translucent surface tokens across all modals and popups.

- *Chat Engine & Scroll Polish (Patch 2):* Migrated chat feed rendering from full-container `onValue` wipes to incremental `onChildAdded`/`onChildChanged`/`onChildRemoved` (`limitToLast(60)`) registered in `activeChatCleanups` to eliminate image/media flicker. Added 0ms optimistic message sending via pre-generated `push().key` IDs and smart auto-scroll with a floating 'Jump to latest' / unread count pill.

- *UI Polish & Stability (Patch 1):* Added smooth CSS pop-in transitions for modals/popups, tactile button feedback, custom thin scrollbars, a debounced `.info/connected` Reconnecting banner, centralized `activeChatCleanups` to prevent listener leaks on chat switching, and Discord-style Escape + auto-focus keyboard ergonomics.

- *New Game (Spy):* Built the multiplayer 'Spy' social deduction game integrated with multi-lobby support (`games/${chatId}/${gameId}`), a 100+ categorized word library, server-synced phase timers via `getServerTime()`, `runTransaction`-protected phase transitions (reveal -> 2 clue rounds -> voting -> spy last-chance guess -> finished), HTML-escaped clues, and clean close/unsubscribe handling.

- *Floating Reply Box Alignment:* Reverted the full-width reply strip back to a floating `position: absolute` box and added `positionReplyPreview()` to dynamically offset its `right` edge by the visible Members panel width, keeping it centered strictly between the left edge of the chat and the Members panel.

- *Reply Preview Containment:* Moved and constrained the reply preview bar strictly inside the chat column flex container (removing viewport-relative positioning) so it stays centered over the chat input and never overflows into the Members side panel.

- *Chat Reply UI Fixes:* Added top/bottom viewport clamping to the message Reply/Pin action menu so it never clips outside chat borders on top or bottom messages. Centered the 'Replying to' preview bar above the input with clean text ellipsis.

- *Admin Panel Premium UX:* Added a unified live search bar filtering users by both username and email simultaneously, and replaced static tier controls with a color-coded sliding segmented control to visually display and toggle each user's premium tier.

- *Doodle Dash Early Round Advance:* Added a check on correct guesses comparing `guessedPlayers` against all non-drawing players in `gameData.players`. When everyone has guessed, the round immediately clears `guessedPlayers` and transitions to the next drawer instead of waiting for the timer to expire.

- *Attachment Menu & PC Camera Fix:* Added `cursor: pointer` to attachment menu buttons. Implemented a `getUserMedia` live webcam capture modal for desktop clients since desktop browsers ignore `<input capture>` and fall back to File Explorer.

- *Payment Flow & Admin Requests:* Removed the old payment QR code and link, replacing it with a 'Contact Admin' request form writing to `adminRequests`. Added a live 'Requests' section to the Admin Panel with DM and dismiss actions, protected by global admin Firebase rules.

- *Doodle Dash Timer Sync:* Replaced local `Date.now()` comparisons with Firebase `.info/serverTimeOffset` via `window.getServerTime()` so word-selection and round countdowns stay synchronized across devices with different system clocks.

- *Multi-Lobby & Game Start Fix:* Migrated game lobbies from a single `games/${chatId}` slot to unique `games/${chatId}/${gameId}` keys so multiple users can host lobbies without overwriting or blocking each other. Fixed `startGame` state transitions and listener binding, added live player counters to lobby chat cards, and added an `ACTIVE LOBBY: {Game Name}` banner near the pinned messages bar.

- *Game UI Fixes:* Wired up `closeFlagsGame()` to properly hide the World Flags UI and clear the `flagsGameInterval` to prevent background memory leaks. Introduced a global `formatMoney` helper using `toLocaleString('en-US')` to render large currency values with commas across the game UI and stats panel.

- *Moderation Logic:* Prevented global Admins from being muted. Applied a server-side Firebase rule block checking `root.child('users')` for the admin role, and removed the Mute UI button on client-side profiles for admin accounts.

- *Game Expansion:* Massively expanded the Word Rush 5-letter dictionary array with over 400 new valid 5-letter words to prevent replay repetition, leaving the Doodle Dash array completely intact.

- *UI & Game Expansion:* Applied a `.substring(0, 15)` limit to all username rendering and profile saves to prevent UI breaking from long names. Injected minimal `👑` and `🛡️` emojis to the side panel to indicate roles without wasting space. Massively expanded the `DOODLE_WORDS` array with hundreds of new entries to drastically reduce game repetition.

- UI Polish: Replaced the ugly native <select> dropdown in the mute modal with a premium CSS pill-selector grid. Removed group role badges from the side panel to reduce clutter, and fixed the profile modal layout by placing the role badge in a flex-column directly beneath the username to prevent overlap.

- *Moderation Upgrade:* Replaced binary mute toggle with an advanced timed mute modal (15m, 1h, 24h, 1w, Perm) requiring a reason. Updated `database.rules.json` to validate `mutedUntil < now`. Updated the muted user UI to display an informative read-only banner showing the expiration date and reason.

- *UI Refinement:* Removed the default teal focus outline and box-shadow from the chat text input to maintain a flat, clean design when typing.

- *UI Refinement:* The message action menu (Reply/Pin) floated too high above the message box; adjusted CSS positioning to align `top: 0` with the message wrapper. Removed mod Mute buttons from the group members side panel to declutter the UI, restricting mute actions to the user profile screen.

- *Media Download Fix:* Attempting to download images via JS `fetch()` triggered strict CORS policy blocks from Google Drive's thumbnail endpoint. Solution: Ripped out the `fetch` logic and implemented a regex ID extractor that constructs a `uc?export=download` URL, utilizing a temporary anchor tag to force a native browser download and bypass cross-origin restrictions.

- *UI & UX Fix:* The group members side panel was clipping long lists without allowing scrolling. Solution: Applied `overflow-y: auto` and a flexible height constraint to the CSS wrapper. Upgraded the member rendering routine in `app.js` to sort the array before DOM injection, prioritizing online users at the top followed by alphabetical sorting.

- *World Flags Optimization:* Replaced intrusive full-screen red victim flash with a top-right notification toast. Fixed game timer desync by moving finish enforcement to a Firebase `status === 'finished'` state that strictly halts local inputs. Added an endgame stats engine tracking `earned`, `stolenAmount`, `timesRobbed`, and `lostToRobbers`.

- *Doodle Dash Upgrade:* Enforced a 30s minimum timer, injected a 10s progressive hint system with a <Word> (<Length>) <Time> UI layout, massively expanded the dictionary to over 300 words, added a 10s drawer selection phase, and implemented a BFS flood-fill algorithm for a new canvas bucket tool.

- *Feature Addition (Moderator Tools):* Implemented group-level mod actions. Added `mutedUsers` node in Firebase rules to block message writes at the server level. Added `toggleUserMute` and `inviteToGroup` logic, disabled the chat input UI for muted users, and exposed mod controls in the group details screen.

- *Database Architecture Fix:* Querying users by friend code triggered an `Index not defined` error because Firebase blocked the unindexed child property sort. Solution: Added `".indexOn": ["friendID"]` to the database rules to enable authorized querying and resolve the crash.

- *Attachment Menu Rollback & Clipboard Paste:* Reverted the standalone `#attachment-menu` overwrite to restore the original attachment menu containing Games and Polls. Added a single `Clipboard paste` option inside the existing menu that invokes `navigator.clipboard.read()` to prompt for permission and paste the latest copied image or text.

- *Attachment Menu & Clipboard Permission:* Added an attachment popover menu (`Photo or Video` and `Paste from Clipboard`) to the paperclip icon. Configured `requestClipboardPermissionAndPaste` to query `clipboard-read` and invoke `navigator.clipboard.read()` directly inside the click gesture to trigger the native permission prompt, backed by a `contenteditable` paste catcher modal for restricted mobile WebViews.

- *Native Clipboard Paste Fix:* Removed the manual clipboard button (`navigator.clipboard.read` is blocked without native plugin permissions in Android WebView). Converted the chat input to `contenteditable="true"` with a `.value` property shim so Android `InputConnection` advertises `image/*` support to Gboard/Samsung Keyboard, and routed `paste`/`beforeinput` image blobs directly into the chat attachment upload routine.

- *Clipboard Image Fix:* Replaced custom upload logic inside the `paste` listener with a `DataTransfer` bridge into the existing `<input type="file">` element so PC `Ctrl+V` triggers the native attachment handler directly. Added `navigator.clipboard.read()` and a dedicated paste button to bypass Android `<input type="text">` IME restrictions on mobile image pasting.

- *Feature Addition (Clipboard Paste):* Added a `paste` event listener that intercepts `image/*` items from `event.clipboardData.items`, wraps the blob in a timestamped `File` object, enforces the 50MB memory guard, and routes it through `uploadMediaToDrive`.

- *Video Bubble Collapse Fix:* Setting `position: absolute` on the video `iframe` inside a `width: 100%` wrapper caused shrink-to-fit chat bubbles to collapse to 0x0px. Solution: Removed JS scaling and applied explicit pixel dimensions (`480x360px` on desktop; `300x250px` wrapper on mobile wrapping a `480x400px` iframe with `transform: scale(0.625)`), keeping Google Drive's compact desktop control bar on mobile with zero layout shifts.

- *Video Layout Stability:* Removed `ResizeObserver` from `.drive-video-wrapper` because scaling a non-absolute `iframe` caused a DOM width feedback loop that made mobile video bubbles oscillate between horizontal and vertical. Replaced with CSS `aspect-ratio: 4 / 3` wrappers, `position: absolute` iframes, and one-pass `syncDriveVideoScales()` scaling.

- *Video Player Architecture:* Removed custom `<video>` overlays and restored the default Google Drive `iframe` embed. Fixed oversized, overlapping mobile Drive controls by adding a `ResizeObserver` that maintains a 480px virtual iframe width and applies proportional CSS `transform: scale()` on narrow viewports, preserving the compact desktop control bar across all devices.

- *Video UI Expansion:* Custom CSS overlays restricted access to OS-level fullscreen and timeline APIs. Additionally, `overflow: hidden` wrappers were physically clipping player controls on varied aspect ratios. Solution: Reverted to pure native `<video controls>` to restore fullscreen capabilities. Eliminated restrictive DOM wrappers and increased vertical bounds to `70vh` to allow massive, unclipped media rendering.

- *Video UI Customization:* Dropped the native OS `controls` attribute in favor of a custom-built CSS play button overlay. Utilized `playsinline` and a JavaScript controller to manage playback state, providing a unified, styled media experience across all mobile devices while maintaining the ad-blocker iframe fallback.

- *Architecture Optimization:* The client-side `cleanupOldMessages` routine crashed mobile WebViews and failed due to index requirements. Solution: Stripped the routine from the frontend entirely. Offloaded 5-day message retention policies to a daily automated Google Apps Script Cron job interacting securely via the Firebase REST API.

- *Mobile UI Overhaul:* The Google Drive iframe injected a massive, overlapping control UI on mobile devices that could not be styled due to CORS. Solution: Reverted the primary renderer to a native HTML5 `<video>` tag to utilize clean OS-level media controls, while retaining a global `loadDriveIframe` fallback function specifically for PC environments running strict ad-blockers.

- *UI Rendering Fix:* Vertical and square videos were clipping the Drive player controls because the iframe container was hardcoded to a 16:9 `padding-top` aspect ratio constraint. Solution: Replaced the absolute aspect-ratio wrapper with a responsive `height: 350px` container to guarantee sufficient vertical space for the Drive UI across all video shapes. Added WebKit mask styling to preserve iframe border-radii on mobile.

- *UI Rendering Fix:* Ad-blockers intercepted native video streams. Reverted to the Google Drive `iframe` embed to guarantee playback. Fixed Drive control bar clipping by applying `padding-top: calc(56.25% + 60px)` to the responsive container, accommodating both the 16:9 video aspect ratio and the bottom player UI.

- *Architecture Resilience:* Native `<video>` streaming occasionally failed due to PC ad-blockers (`ERR_BLOCKED_BY_CLIENT`) intercepting Drive download redirects. Solution: Implemented a hybrid rendering pipeline. The app defaults to native HTML5 video for aesthetic parity, but utilizes an `onerror` listener to dynamically swap the DOM element to a responsive Drive `iframe` if the stream request drops.

- *UI Rendering Upgrade:* Video players were clipping and lacked style customization due to Google Drive `iframe` CORS restrictions. Solution: Scrapped the iframe renderer. Implemented a regex extractor to pull the Drive ID from legacy and current database URLs, rerouting them to the `uc?export=download` endpoint. Fed the raw stream into a native HTML5 `<video>` tag, ensuring aspect-ratio parity with image attachments and clean native OS controls.

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

