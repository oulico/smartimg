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

## Upload straight from the NAS

`src/nas.ts` takes files that already live on a mounted share, compresses them,
uploads them, and prints the CDN URL. Nothing is moved or written on the NAS.

```bash
export IMAGE_API_URL=http://127.0.0.1:8787/api
export IMAGE_CDN_BASE=http://127.0.0.1:8787/mock-cdn   # or your CloudFront domain
export IMAGE_API_TOKEN=...                              # only if the server requires it

bun src/nas.ts "/mnt/smartimg/1.업무보고서/박홍제/monkey.jpg"
```

Either form of the path works, and both name the same object:

```
\\192.168.0.200\smartimg\1.업무보고서\박홍제\monkey.jpg
/mnt/smartimg/1.업무보고서/박홍제/monkey.jpg
```

### The key mirrors the share path

```
share    directories kept verbatim     name . ext
smartimg / 1.업무보고서 / 박홍제      / monkey.webp
```

The share name is lowercased and becomes the first segment; every directory
below it is kept exactly as the NAS spells it, Korean and spaces included (the
URL percent-encodes them). The extension comes from the MIME type.

One file, one URL, for good. Drop a new image onto the NAS under the same name,
re-run the command, and the object is overwritten — the link you already sent
starts showing the new image. Nothing to re-send, nothing to update.

The cost is that such a key cannot be cached forever, since it no longer names
one fixed set of bytes. Path-mirrored uploads are stored with
`Cache-Control: public, max-age=60, must-revalidate` instead of the one-year
`immutable` used for keys nothing overwrites, so a replacement is visible within
about a minute. Raise or lower that window with `MUTABLE_MAX_AGE_SECONDS` on the
server. On a real CloudFront distribution, add an invalidation after upload if
you need the change to be instant rather than within the TTL.

### Keeping every version instead

`--versioned` appends a short digest of the **source** bytes before the
extension, making each version its own object:

```
smartimg/1.업무보고서/박홍제/monkey.637ae5f.webp
```

Now a replacement mints a new URL and the old one keeps resolving to the image
it was sent for, so those objects keep the full one-year immutable cache. Use it
for images that go out in email or print, where a link must not change under the
recipient. The digest covers the source rather than the compressed output, so
tuning quality later does not churn URLs.

### Options

| Flag | Effect |
| --- | --- |
| `--preset NAME` | print the preset URL (`thumbnail`, `productCard`, `productDetail`, `hero`) instead of the original |
| `-r`, `--recursive` | descend into directories |
| `--dry-run` | compress and print the URL without uploading |
| `--versioned` | add a source digest to the name, so each version is its own permanent URL |
| `--json` | machine-readable output, including every preset URL and both byte counts |

| Variable | Default | Meaning |
| --- | --- | --- |
| `SMARTIMG_SHARES` | `/mnt/smartimg` | mount points to accept, `path=share` to rename |
| `SMARTIMG_MAX_EDGE` | `2400` | longest edge in pixels; larger images are scaled down |
| `SMARTIMG_QUALITY` | `82` | encoder quality |
| `SMARTIMG_KEEP_FORMAT` | unset | set to keep the source format instead of converting to WebP |

Paths outside every configured share are refused, as are `..` segments, so the
command cannot be pointed at the rest of the filesystem. GIFs are uploaded
untouched — re-encoding one through a still-image pipeline would drop every
frame but the first.

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

## Install as a systemd service (Linux / NAS)

The agent has no macOS-specific code; on Linux Chokidar watches via inotify.

1. Resolve the placeholders in the template (run from the repo root):

   ```bash
   BUN=$(which bun) PROJECT=$PWD HOME_DIR=$HOME \
   sed -e "s|__BUN__|${BUN}|" -e "s|__PROJECT__|${PROJECT}|" \
       -e "s|__TOKEN__|your-token|" -e "s|__HOME__|${HOME_DIR}|g" \
       agent/systemd/smartimg-agent.service > /tmp/smartimg-agent.service
   ```

   Adjust `IMAGE_API_URL`, `IMAGE_CDN_BASE`, and `AGENT_ROOT` in the copy
   (point `AGENT_ROOT` at a NAS volume such as `/volume1/smartimg`). If the
   server has no token requirement, delete the `IMAGE_API_TOKEN` line.

2. Install and start:

   ```bash
   sudo cp /tmp/smartimg-agent.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now smartimg-agent
   ```

3. Follow logs or stop:

   ```bash
   journalctl -u smartimg-agent -f
   sudo systemctl disable --now smartimg-agent
   ```

Notes:

- Bun ships Linux builds for x64 and arm64 (glibc and musl). On an
  unsupported CPU, run the same entrypoint under Node 20+ with `tsx`.
- Run the agent on the NAS itself. SMB/NFS writes arriving at the NAS fire
  inotify locally; watching a remote mount from another machine may not
  produce events.
