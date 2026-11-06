# Orion Chat - Agent Instructions

Before executing any deployment, release, or update publication, always refer to and execute the standard operating procedure defined in `AI_UPDATE_SOP.md`.

### Deployment Trigger Handling
Whenever the user requests to "deploy", "release", or "publish an update", automatically follow the three phases in order:
- **Phase 1: Web Version Deployment (Cloudflare Pages)**: Sync assets to `OrionWeb` and push to GitHub `orion-web`.
- **Phase 2: Mobile OTA Deployment (Capgo & GitHub Releases)**: Package `bundle.zip`, compute SHA-256 hash, release on `orion-chat`, update `version.json` with worker URL, and push to `main`.
- **Phase 3: In-App Announcement (Orion Updates Channel)**: Post announcement message in `channel_orion_updates`.
