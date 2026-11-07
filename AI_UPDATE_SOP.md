# Orion Chat: AI Deployment Standard Operating Procedure (SOP)

> **MANDATORY INSTRUCTION FOR AGENTS:**  
> Whenever requested to "deploy", "release", or "publish an update", you **MUST** execute the following phases strictly in order. Do **NOT** skip any steps or improvise shortcuts.

---

## Phase 1: Pre-Flight & Version Bump

1. **Clean Workspace:**
   - Delete any existing `bundle.zip` files across `OrionApp`, `OrionWeb`, `OrionTests`, and `android/app/src/main/assets/public`.
   - Never allow stale archives to linger in the workspace.

2. **Update Version Strings:**
   - Open `app.js` in `OrionWeb`.
   - Bump `CURRENT_APP_VERSION = '<NEW_VERSION>';`.
   - Update fallback version references in `updateSettingsVersionDisplay()` and `checkForUpdates()`.
   - Open `index.html` in `OrionWeb` and update the version label: `<span id="account-tab-app-version"><NEW_VERSION></span>`.

3. **Verify Critical Guard Clauses:**
   - **OTA Loop Guard:** In `checkForUpdates()`, verify that Capgo's active container version is read first via `CapacitorUpdater.current()`. Remote version must be strictly newer before showing update prompts.
   - **Upload Non-Blocking Pipeline:** Verify `sendImageMessage` uses `blobToDataUrlAsync` and does not call synchronous `canvas.toDataURL`.
   - **HEIC Conversion:** Verify `heic2any` script tag is present in `<head>` of `index.html`.
   - **Updates Channel Guard:** Verify `ensureOrionUpdatesChannel` does not write presence/member data to `channel_orion_updates`.

4. **Sync Codebase Across Repositories:**
   - Copy updated `app.js` and `index.html` from `OrionWeb` into:
     - `OrionApp/www/`
     - `OrionApp/` (root)
     - `OrionApp/android/app/src/main/assets/public/`
     - `OrionTests/` (`orion-chat` repo)
   - Commit and push `OrionTests` to `1409yak/orion-chat` on branch `main` **BEFORE** creating any release tag, ensuring GitHub Actions checkout the latest source code.

---

## Phase 2: Packaging & The Anti-Mismatch Protocol

> [!CAUTION]
> **STRICT ZERO-TOLERANCE ANTI-MISMATCH RULE:**  
> The SHA-256 hash must be calculated **ONLY AFTER** `bundle.zip` is completely packaged. If even a single byte or file is modified, the zip **MUST** be deleted, re-packaged, and re-hashed. Never guess or pre-populate the checksum.

1. **Package Verified Bundle:**
   - Navigate into the `OrionWeb` directory.
   - Compress all web assets with `index.html` at the zip root (excluding `.git` and `bundle.zip`):
     ```powershell
     Set-Location "..\OrionWeb"
     Remove-Item "bundle.zip" -Force -ErrorAction SilentlyContinue
     Get-ChildItem -Exclude "bundle.zip",".git" | Compress-Archive -DestinationPath "bundle.zip" -Force
     ```
   - Verify archive structure using `tar -tf bundle.zip` (`index.html`, `app.js`, `style.css` must be at root).

2. **Calculate True Checksum:**
   - Calculate strict lowercase SHA-256 hash in PowerShell:
     ```powershell
     $CHECKSUM = (Get-FileHash bundle.zip -Algorithm SHA256).Hash.ToLower()
     Write-Output "CHECKSUM: $CHECKSUM"
     ```

3. **Deploy Brand-New GitHub Release (Never Overwrite):**
   - Create a brand-new release tag `v<NEW_VERSION>` on `1409yak/orion-chat`:
     ```powershell
     gh release create v<NEW_VERSION> bundle.zip --repo 1409yak/orion-chat -t "Release v<NEW_VERSION>" -n "Release v<NEW_VERSION>"
     ```
   - If an automated GitHub Action triggers, allow it to complete or upload with `--clobber` to lock in the true bundle.
   - Query `gh release view v<NEW_VERSION> --repo 1409yak/orion-chat --json assets` to verify the asset digest matches `$CHECKSUM`.

4. **Update Manifest & Deploy Web (`orion-web`):**
   - Open `version.json` in `OrionWeb`.
   - Update strictly to:
     ```json
     {
       "version": "<NEW_VERSION>",
       "url": "https://orion-fcm-worker.gaim.workers.dev/download-ota/v<NEW_VERSION>/bundle.zip",
       "checksum": "<CALCULATED_SHA256>",
       "notes": "Orion Chat v<NEW_VERSION> release"
     }
     ```
   - Commit and push `OrionWeb` to `1409yak/orion-web` on branch `main`:
     ```powershell
     git -C "..\OrionWeb" add app.js index.html version.json
     git -C "..\OrionWeb" commit -m "Deploy v<NEW_VERSION>: <SUMMARY>"
     git -C "..\OrionWeb" push origin main
     ```
   - This triggers Cloudflare Pages auto-deployment and updates `raw.githubusercontent.com/1409yak/orion-web/main/version.json`.

5. **Verify Worker Proxy Download:**
   - Test live download through the Cloudflare Worker proxy:
     ```powershell
     curl.exe -s "https://orion-fcm-worker.gaim.workers.dev/download-ota/v<NEW_VERSION>/bundle.zip" -o "test-bundle.zip"
     $DL_HASH = (Get-FileHash test-bundle.zip -Algorithm SHA256).Hash.ToLower()
     Remove-Item "test-bundle.zip" -Force
     Write-Output "Downloaded: $DL_HASH | Expected: $CHECKSUM"
     ```
   - Ensure the hashes match with 100% parity before proceeding.

---

## Phase 3: In-App Announcement (Broadcast)

1. **Broadcast to `channel_orion_updates`:**
   - Execute the update announcement script from `OrionTests`:
     ```powershell
     node "..\OrionTests\scripts\post-update-announcement.js" "<NEW_VERSION>" "<BRIEF_SUMMARY_OF_CHANGES>"
     ```
   - This automatically injects the update card `[UPDATE_VERSION:<NEW_VERSION>]` and system announcement into Firebase Realtime Database.
   - Users viewing the announcement channel can install the update with one tap.

---

## Phase 4: Native Android APK Compilation (When Requested)

When compiling a fresh native base APK:
1. **Never use `npx cap sync`** if doing direct native injection.
2. Directly copy `OrionWeb` files into `android/app/src/main/assets/public`.
3. Verify in memory that `android/app/src/main/assets/public/app.js` contains `CURRENT_APP_VERSION = '<NEW_VERSION>'`.
4. Compile using cache-busting flags:
   ```powershell
   cd android && .\gradlew.bat clean assembleDebug --no-build-cache
   ```
5. Confirm output at `android/app/build/outputs/apk/debug/app-debug.apk`.
