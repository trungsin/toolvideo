# Deployment

Host-specific values (`<VPS_IP>`, `<SSH_PORT>`, `<user>`, `<ssh-key>`, `<TUNNEL_ID>`) are redacted; the real ones live in the gitignored `docs/deployment.local.md`.

## Platform
Self-hosted VPS + Cloudflare Tunnel (named tunnel `saveclip`)

## Production URL
https://saveclip.leesun.space

## Host
- VPS: `<VPS_IP>`
- SSH: port `<SSH_PORT>`, user `<user>` (public key)
- App dir: `/home/<user>/apps/saveclip`
- App bind: `127.0.0.1:3010` (not public; tunnel only)

## Deploy Command
From the laptop:

```bash
rsync -avz --delete \
  --exclude node_modules \
  --exclude data/ \
  --exclude downloads/ \
  --exclude .git/ \
  --exclude plans/ \
  --exclude docs/ \
  --exclude .claude/ \
  --exclude .opencode/ \
  --exclude .codex/ \
  --exclude .agents/ \
  --exclude temp/ \
  --exclude mcp-server/ \
  --exclude saveclip.env \
  -e "ssh -i ~/.ssh/<ssh-key> -o IdentitiesOnly=yes -p <SSH_PORT>" \
  ./ \
  <user>@<VPS_IP>:/home/<user>/apps/saveclip/

ssh -i ~/.ssh/<ssh-key> -o IdentitiesOnly=yes -p <SSH_PORT> <user>@<VPS_IP> \
  'cd /home/<user>/apps/saveclip && npm install --omit=dev && systemctl --user restart saveclip.service'
```

## Runtime
User systemd units (linger enabled for `<user>`):

- `saveclip.service` — Node web app
- `cloudflared-saveclip.service` — Cloudflare tunnel

```bash
ssh -i ~/.ssh/<ssh-key> -p <SSH_PORT> <user>@<VPS_IP> \
  'systemctl --user status saveclip.service cloudflared-saveclip.service'
```

## Environment Variables
File on the server: `/home/<user>/apps/saveclip/saveclip.env` (mode `600`)

| Variable | Description | Required |
|---|---|---|
| `PORT` | Listen port (`3010`) | Yes |
| `HOST` | Bind address (`127.0.0.1`) | Yes |
| `API_KEY` | Required on `/api/*` unless Origin/Referer is the web UI host | Yes |
| `NODE_ENV` | Set to `production` by the unit | Yes |
| `YTDLP_COOKIES` | Path to YouTube `cookies.txt` (Netscape format). Needed when YouTube bot-checks the VPS IP | No |
| `YTDLP_COOKIES_FROM_BROWSER` | `--cookies-from-browser` spec; ignored if `YTDLP_COOKIES` is set. Not usable on the headless VPS | No |

Do not commit this file. It lives inside the app dir, so the deploy `rsync --delete` MUST keep `--exclude saveclip.env` or it gets wiped and the unit fails with `Failed to load environment files`. Web UI at `https://saveclip.leesun.space` bypasses the key via Origin/Referer. External callers send `X-API-Key`.

## Custom Domain
`saveclip.leesun.space` is a Cloudflare proxied CNAME to named tunnel `saveclip` (`<TUNNEL_ID>`).

Tunnel config: `/home/<user>/.cloudflared/saveclip.yml`

```bash
cloudflared tunnel route dns --overwrite-dns saveclip saveclip.leesun.space
```

## Dependencies (user-local, no root)
Because `<user>` sudo is password-gated, binaries live in the home directory:

- `/home/<user>/bin/ffmpeg`, `ffprobe` (static 7.0.2)
- `/home/<user>/bin/yt-dlp` (nightly)
- `/home/<user>/.deno/bin/deno`

Karaoke (Demucs / whisper.cpp) is not installed on this VPS.

## Rollback
```bash
ssh -i ~/.ssh/<ssh-key> -p <SSH_PORT> <user>@<VPS_IP> \
  'systemctl --user restart saveclip.service'
```

To take the hostname offline without deleting the tunnel:

```bash
ssh -i ~/.ssh/<ssh-key> -p <SSH_PORT> <user>@<VPS_IP> \
  'systemctl --user stop cloudflared-saveclip.service saveclip.service'
```

## Troubleshooting
- Disk is tight (~4G free after cleanup). Downloads live in `/home/<user>/apps/saveclip/downloads/` — prune old files.
- Cloudflare Free HTTP responses cap around 100MB. Large video file downloads through the tunnel may fail; the job itself still runs on the VPS.
- If the UI loads but `/api/*` returns 401, Origin/Referer is missing `saveclip.leesun.space`.
- App crash `Cannot open database because the directory does not exist`: `mkdir -p /home/<user>/apps/saveclip/data`.
- Tunnel healthy, site down: `systemctl --user restart saveclip.service`.
- YouTube `HTTP Error 429` / `Sign in to confirm you're not a bot`: the IP is flagged. Export `cookies.txt` from a logged-in browser (use a private window, then close it so the session doesn't rotate), copy it to `/home/<user>/.config/saveclip/youtube-cookies.txt` (outside the app dir, or `rsync --delete` wipes it; mode `600`, writable — yt-dlp updates it), set `YTDLP_COOKIES=/home/<user>/.config/saveclip/youtube-cookies.txt` in `saveclip.env`, restart. Use a throwaway Google account; heavy use can get it banned.
