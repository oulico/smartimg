# smartimg local upload agent

Watches a local folder and uploads dropped images through the same presign/S3
API the web app uses, then files them into per-outcome folders.

## Folders

```
~/ImageDrop/
  Inbox/     drop images here
  Uploaded/  successfully uploaded files are moved here
  Failed/    files rejected by the API or the image sniffer are moved here
  Results/   one JSON + Markdown pair per batch, with every CDN URL
```

The agent never stores AWS credentials. It only talks to the image API with an
optional bearer token; the server performs the S3 presigning and key naming.

## Run in the foreground

```bash
export IMAGE_API_URL=http://127.0.0.1:8787/api
export IMAGE_CDN_BASE=http://127.0.0.1:8787/mock-cdn   # or your CloudFront domain
export IMAGE_API_TOKEN=...                              # only if the server requires it
bun install
bun src/main.ts
```

Files are uploaded one at a time, in arrival order. A batch is closed once no
new files arrive for 2 seconds after the last upload finishes.

## Install as a launchd service (macOS)

1. Resolve the placeholders in the template (run from the repo root):

   ```bash
   BUN=$(which bun) PROJECT=$PWD HOME_DIR=$HOME \
   sed -e "s|__BUN__|${BUN}|" -e "s|__PROJECT__|${PROJECT}|" \
       -e "s|__HOME__|${HOME_DIR}|g" -e "s|__TOKEN__|your-token|" \
       agent/launchd/com.smartimg.image-drop-agent.plist > /tmp/com.smartimg.image-drop-agent.plist
   ```

   Adjust `IMAGE_API_URL`, `IMAGE_CDN_BASE`, and `AGENT_ROOT` in the copy if
   needed. If the server has no token requirement, delete the
   `IMAGE_API_TOKEN` entry.

2. Load it:

   ```bash
   cp /tmp/com.smartimg.image-drop-agent.plist ~/Library/LaunchAgents/
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.smartimg.image-drop-agent.plist
   ```

3. Stop or uninstall:

   ```bash
   launchctl bootout gui/$(id -u)/com.smartimg.image-drop-agent
   ```

Logs go to `~/Library/Logs/smartimg-agent.log`. Because the agent uploads
through the public API, images appear in the web library automatically.
