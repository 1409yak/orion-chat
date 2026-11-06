# Orion Chat: AI Deployment Standard Operating Procedure
Whenever I ask you to "deploy", "release", or "publish an update", you MUST automatically execute the following three phases in order:

### Phase 1: Web Version Deployment (Cloudflare Pages)
- Sync the updated pure web assets (`index.html`, `app.js`, `style.css`, etc.) into the dedicated `OrionWeb` directory.
- Commit and push the `OrionWeb` folder to the `orion-web` GitHub repository to trigger the Cloudflare Pages auto-deployment.

### Phase 2: Mobile OTA Deployment (Capgo & GitHub Releases)
- Package the updated web assets into a root-level `bundle.zip`.
- Calculate the exact SHA-256 checksum of `bundle.zip`.
- Create a new GitHub Release on the main `orion-chat` repository and upload `bundle.zip`.
- Update `version.json` with the new version number, the exact SHA-256 checksum, and the Cloudflare proxy download link formatted as: `https://orion-fcm-worker.gaim.workers.dev/download-ota/v[VERSION]/bundle.zip`.
- Push `version.json` to the `main` branch.

### Phase 3: In-App Announcement (Orion Updates Channel)
- Write an automated script or Firebase admin snippet to inject a new system message into the `channel_orion_updates` chat in Firestore.
- The message MUST state the new version number, briefly summarize the changes, and include a clear call-to-action (e.g., "Version vX.Y.Z is live! Go to Settings -> Check for Updates to install.").
