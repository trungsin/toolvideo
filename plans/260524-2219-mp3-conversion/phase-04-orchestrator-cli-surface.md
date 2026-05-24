---
phase: 04
name: Orchestrator + CLI Surface
status: done
priority: high
effort: S
depends_on: [02, 03]
---

# Phase 04 — Orchestrator + CLI Surface

## Context
- Orchestrator: `src/core/downloader.js` (routes by platform, manages history dedup)
- CLI: `src/cli/index.js` (commander.js, has `--audio-only` flag scoped to TikTok)
- After Phase 02: `searchByUrl(url, audioOnly)` accepts 2 params
- After Phase 03: YT/FB/TT handlers accept `audioOnly`

## Overview
Update `downloader.download()` to forward `audioOnly` to YouTube + Facebook handlers, use new `searchByUrl(url, audioOnly)` for dedup, and persist `audioOnly` in history. Update CLI flag description (no longer "TikTok only") and ensure correct success output for MP3.

## Key Insights
- Orchestrator currently passes `audioOnly` only to TikTok (line 72) — extend to YT + FB
- Orchestrator currently passes `audioOnly` to history `addDownload` via... actually NOT — need to add
- CLI already wires `audioOnly: options.audioOnly` (line 97), just description text fix

## Files to Modify
- `src/core/downloader.js`
- `src/cli/index.js`

## Implementation Steps

### `src/core/downloader.js`

1. **Forward `audioOnly` to YouTube** (line ~61):
   ```js
   if (platform === 'youtube') {
     const { downloadYouTube } = await import('./youtube-handler.js');
     result = await downloadYouTube(url, {
       progress,
       outputDir: options.outputDir,
       audioOnly: options.audioOnly,
     });
   }
   ```

2. **Forward `audioOnly` to Facebook** (line ~62):
   ```js
   } else if (platform === 'facebook') {
     const { downloadFacebook } = await import('./facebook-handler.js');
     result = await downloadFacebook(url, {
       progress,
       outputDir: options.outputDir,
       audioOnly: options.audioOnly,
     });
   }
   ```

3. **Update dedup check** (line ~43):
   ```js
   if (!options.force) {
     const existing = searchByUrl(url, !!options.audioOnly);
     if (existing && existing.filepath && existsSync(existing.filepath)) {
       console.log(`Already downloaded: ${existing.filepath}`);
       return existing;
     }
   }
   ```

4. **Persist `audioOnly` in history** (line ~77):
   ```js
   const id = addDownload({
     url,
     platform,
     title: result.title,
     filepath: result.filepath,
     quality: result.quality,
     filesize: result.filesize,
     duration: result.duration,
     thumbnail: result.thumbnail,
     audioOnly: !!options.audioOnly,
     status: 'completed'
   });
   ```

### `src/cli/index.js`

1. **Update flag description** (line 68):
   ```js
   .option('--audio-only', 'Download audio as MP3 (YouTube, Facebook, TikTok)')
   ```

2. **No other changes** — `audioOnly: options.audioOnly` already passed through (line 97).

3. (Optional polish) Display "Audio (MP3)" in result output when `audioOnly`:
   ```js
   if (options.audioOnly) {
     console.log(colors.dim('Format: MP3 (audio only)'));
   }
   ```

## Todo
- [ ] Modify `downloader.js`: pass audioOnly to YT + FB handlers
- [ ] Modify `downloader.js`: dedup uses new searchByUrl signature
- [ ] Modify `downloader.js`: addDownload includes audioOnly
- [ ] Modify `cli/index.js`: update flag description
- [ ] Syntax check: `node --check src/core/downloader.js src/cli/index.js`
- [ ] E2E test (manual):
  - `./src/cli/index.js --audio-only https://www.youtube.com/watch?v=<id>` → expect `.mp3`
  - `./src/cli/index.js --audio-only https://www.facebook.com/<watch-url>` → expect `.mp3`
  - `./src/cli/index.js --audio-only https://www.tiktok.com/@user/video/<id>` → expect `.mp3`
  - Run same URL without `--audio-only` after MP3 succeeds → expect MP4 (separate history record)
  - `ffprobe <output.mp3>` → verify title/artist tags present, audio bitrate ~190kbps

## Success Criteria
- `--audio-only` works for all 3 platforms via CLI
- MP4 and MP3 of same URL coexist in history (no dedup conflict)
- `--force` still re-downloads regardless of audioOnly state

## Risks
- **Existing scripts using positional `searchByUrl(url)`**: backward compat preserved via default param (Phase 02)
- **`!!options.audioOnly` coercion**: ensures boolean for SQLite int comparison

## Security
- N/A — no new user input surface

## Next
→ Phase 05 (Web UI surface)
