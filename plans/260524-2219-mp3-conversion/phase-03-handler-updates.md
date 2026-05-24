---
phase: 03
name: Handler Updates (YouTube, Facebook, TikTok)
status: done
priority: high
effort: M
depends_on: [01]
---

# Phase 03 — Handler Updates

## Context
- Brainstorm: `plans/reports/brainstorm-260524-2219-mp3-conversion-all-links.md`
- Shared modules from Phase 01: `src/core/audio-args.js`, `src/core/audio-postprocess.js`
- Existing handlers:
  - `src/core/youtube-handler.js` — pure yt-dlp
  - `src/core/facebook-handler.js` — 3-method fallback chain
  - `src/core/facebook/yt-dlp-method.js` — primary FB method
  - `src/core/facebook/npm-lib-method.js` — fallback 2 (MP4 only)
  - `src/core/facebook/scraper-method.js` — fallback 3 (MP4 only)
  - `src/core/tiktok/yt-dlp-method.js` — already does audioOnly

## Overview
Wire `audioOnly` through each handler. For YT + FB-via-ytdlp + TT: use shared `buildAudioArgs()`. For FB npm-lib/scraper fallback: catch the MP4 output and post-process via `videoToMp3()`.

## Key Insights
- yt-dlp `-x` writes file as `%(title)s.mp3` automatically (no need for `--merge-output-format`)
- FB fallback methods cannot natively output MP3 → must download MP4 first, then strip
- TikTok refactor is mechanical: replace inline audio flags with `buildAudioArgs()` call
- Output filepath capture from yt-dlp logs differs slightly when `-x` is used — `[ExtractAudio] Destination: foo.mp3` pattern appears

## Requirements
- `audioOnly` flag propagates through all handler functions
- All MP3 outputs have ID3v2.3 + embedded thumbnail
- FB returns MP3 even when only npm-lib/scraper succeed
- TikTok behavior unchanged (just refactored to share module)

## Files to Modify

### `src/core/youtube-handler.js`
- `downloadYouTube(url, options)` — accept `options.audioOnly`, pass to `runYtdlp`
- `runYtdlp(url, outputDir, progress, audioOnly)`:
  - If `audioOnly`: use `buildAudioArgs()` + `-o '%(title)s.%(ext)s'` + `--no-playlist --newline`
  - Else: existing video args
  - Add capture pattern: `[ExtractAudio] Destination: (.+\.mp3)` → filepath
- Return shape unchanged (`quality` becomes `'mp3-vbr-192'` or similar marker when audio)

### `src/core/facebook/yt-dlp-method.js`
- `downloadViaYtdlp(url, options)` — accept `options.audioOnly`, pass to `runDownload`
- `runDownload(url, outputDir, progress, audioOnly)`:
  - If `audioOnly`: shared `buildAudioArgs()` + output template
  - Capture `[ExtractAudio] Destination: ...mp3` pattern
- Return shape unchanged

### `src/core/facebook/npm-lib-method.js`
- `downloadViaNpmLib(url, options)` — accept `options.audioOnly`
- If `audioOnly` AND download succeeds → call `videoToMp3(filepath, {title, artist}, {deleteSource: true})`, return result with new mp3 path
- Use info.title as title, "Facebook" as artist (or info.uploader if available)

### `src/core/facebook/scraper-method.js`
- Same pattern as npm-lib: post-process MP4 → MP3 if `audioOnly`

### `src/core/facebook-handler.js`
- `downloadFacebook(url, options)` — pass `options.audioOnly` through `options` into each method (already spreads options, just need to verify)
- Verify all 3 methods receive audioOnly

### `src/core/tiktok/yt-dlp-method.js`
- Replace inline `['-x', '--audio-format', 'mp3', '--audio-quality', '0']` (line ~160) with spread of `buildAudioArgs()`
- Import from `../audio-args.js`
- Note: original used `--audio-quality 0` (best). New shared module uses `5` (~192). This is an **intentional change** for consistency.

## Architecture
```
audioOnly request
  │
  ├─ YT  ──► youtube-handler.runYtdlp(audioOnly:true)
  │                ↓ buildAudioArgs() → yt-dlp → file.mp3
  │
  ├─ FB  ──► facebook-handler → for method in [yt-dlp, npm-lib, scraper]:
  │           ├─ yt-dlp:  runDownload(audioOnly:true) → buildAudioArgs() → file.mp3
  │           ├─ npm-lib: download MP4 → videoToMp3() → file.mp3
  │           └─ scraper: download MP4 → videoToMp3() → file.mp3
  │
  └─ TT  ──► tiktok yt-dlp-method → buildArgs() → spread buildAudioArgs() → file.mp3
```

## Implementation Steps

1. **YouTube** (`youtube-handler.js`):
   - Import `buildAudioArgs, AUDIO_EXT` from `./audio-args.js`
   - Add `audioOnly` param to `runYtdlp` and `downloadYouTube`
   - Build args conditionally; for audio, push `...buildAudioArgs()` + `-o template`
   - Add regex capture: `/\[ExtractAudio\] Destination: (.+\.mp3)/`

2. **Facebook yt-dlp** (`facebook/yt-dlp-method.js`):
   - Mirror YouTube changes
   - Same regex capture for mp3 destination

3. **Facebook fallback** (`facebook/npm-lib-method.js` + `facebook/scraper-method.js`):
   - After successful video download, if `options.audioOnly`:
     ```js
     const { videoToMp3 } = await import('../audio-postprocess.js');
     const mp3Path = await videoToMp3(result.filepath, {
       title: result.title,
       artist: 'Facebook'
     }, { deleteSource: true });
     result.filepath = mp3Path;
     ```

4. **Facebook handler** (`facebook-handler.js`):
   - Verify options spreading: `method.fn(url, options)` already passes whole options object — no change needed if methods accept `options.audioOnly`

5. **TikTok refactor** (`tiktok/yt-dlp-method.js`):
   - Import `buildAudioArgs` from `../audio-args.js`
   - Replace lines 159-160:
     ```js
     // OLD: args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
     // NEW:
     args.push(...buildAudioArgs());
     args.push('-o', join(outputDir, '%(title)s.%(ext)s'));
     ```

6. After each handler change, run: `node -c src/core/<file>.js` for syntax check, or `node --check src/core/...`

## Todo
- [ ] Modify `youtube-handler.js`: add audioOnly branch
- [ ] Modify `facebook/yt-dlp-method.js`: add audioOnly branch
- [ ] Modify `facebook/npm-lib-method.js`: post-process on audioOnly
- [ ] Modify `facebook/scraper-method.js`: post-process on audioOnly
- [ ] Verify `facebook-handler.js` passes audioOnly through (likely no change)
- [ ] Refactor `tiktok/yt-dlp-method.js` to use shared `buildAudioArgs()`
- [ ] Syntax check all modified files via `node --check`
- [ ] Manual smoke: `./src/cli/index.js --audio-only <yt-url>` (after Phase 04)

## Success Criteria
- All handlers accept and respect `audioOnly`
- Output is `.mp3` file with ID3 + cover when `audioOnly=true`
- Output is unchanged when `audioOnly=false`
- No code duplication (yt-dlp audio args defined once)

## Risks
- **FB npm-lib/scraper may not return `title`** — fallback to filename basename or "Facebook Video"
- **MP4 cleanup race**: ensure `videoToMp3` completes before deleting source (already awaited)
- **TikTok behavior change**: switching from `-q 0` (best ~320) to `-q 5` (~192) — agreed per brainstorm for consistency
- **yt-dlp ExtractAudio output line format**: verify regex on actual yt-dlp output during smoke test

## Security
- Filenames from URLs — yt-dlp sanitizes via `%(title)s`
- FFmpeg metadata args: title from yt-dlp JSON (controlled), no shell interpolation (args array)

## Next
→ Phase 04 (orchestrator + CLI surface)
