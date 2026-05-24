---
type: brainstorm
date: 2026-05-24 22:19 +07
slug: mp3-conversion-all-links
status: agreed
---

# Brainstorm: MP3 Conversion for All Links

## Problem Statement

Currently only TikTok supports `--audio-only` MP3 extraction. Users want unified MP3 conversion for YouTube + Facebook + TikTok across CLI and Web UI, with embedded metadata + cover art.

## Requirements (agreed)

- **Platforms:** YouTube + Facebook + TikTok (all)
- **Bitrate:** VBR ~192kbps (yt-dlp `-q 5`)
- **Surface:** Both CLI flag + Web UI toggle
- **Metadata:** ID3 tags (title, artist) + embedded cover art via yt-dlp `--embed-thumbnail --add-metadata`
- **History dedup:** Composite (url, audioOnly) — MP4 and MP3 of same URL coexist
- **Karaoke output:** out-of-scope (existing behavior unchanged)

## Approaches Evaluated

| # | Approach | Pros | Cons | Decision |
|---|----------|------|------|----------|
| A | Native MP3 per handler (yt-dlp `-x`) | Simple, embed metadata free, no FFmpeg round-trip | FB falls flat if yt-dlp fails | Subset of C |
| B | Universal FFmpeg post-process | Uniform code, reuses karaoke audio-extractor | Wastes bandwidth (download MP4 → strip), metadata work | Rejected |
| C | **Hybrid native + FFmpeg fallback** | Efficient happy path + robust FB fallback | +1 fallback branch in FB | **Chosen** |

## Final Solution (Approach C)

### Flow

```
audioOnly=true
├── YouTube  → yt-dlp -x (native MP3 + metadata)
├── TikTok   → yt-dlp -x (existing, refactor to share buildAudioArgs)
└── Facebook
    ├── Try yt-dlp -x (native)
    ├── If fails → npm-lib → MP4 → FFmpeg strip → MP3 + metadata via FFmpeg
    └── If fails → scraper → MP4 → FFmpeg strip → MP3 + metadata via FFmpeg
```

### New shared module
- `src/core/audio-args.js` — `buildAudioArgs()` returns yt-dlp flags (DRY, used by YT/TT/FB-ytdlp)
- `src/core/audio-postprocess.js` — `videoToMp3(filepath, meta)` FFmpeg wrapper for FB fallback

### Files to modify
| File | Change |
|------|--------|
| `src/core/audio-args.js` | NEW — shared yt-dlp audio flag builder |
| `src/core/audio-postprocess.js` | NEW — FFmpeg MP4→MP3 with ID3 tags |
| `src/core/downloader.js` | Pass `audioOnly` to YT + FB handlers |
| `src/core/youtube-handler.js` | Branch on `audioOnly` in `runYtdlp` |
| `src/core/facebook-handler.js` | After fallback chain, post-process if MP4 returned but audioOnly |
| `src/core/facebook/yt-dlp-method.js` | Accept + handle `audioOnly` |
| `src/core/tiktok/yt-dlp-method.js` | Refactor to use shared `buildAudioArgs()` |
| `src/cli/index.js` | Update `--audio-only` description (drop "TikTok only") |
| `src/web/server.js` | Forward `audioOnly` from `/api/download` body to downloader |
| `src/web/public/index.html` | Add "Audio MP3" toggle (mirror Karaoke pattern) |
| `src/web/public/app.js` | Include `audioOnly` in download POST, mutex w/ Karaoke toggle |
| `src/web/public/style.css` | Toggle styling (reuse Karaoke toggle class) |
| `src/db/history.js` | Add `audio_only` column + dedup composite `(url, audio_only)` |

## Key Technical Decisions

1. **VBR over CBR**: yt-dlp `-q 5` ≈ 190kbps VBR, ~10% smaller files, equivalent perceived quality.
2. **Embed via yt-dlp not FFmpeg**: free metadata + thumbnail with `--embed-thumbnail --add-metadata`; ID3v2.3 via `--postprocessor-args "ffmpeg:-id3v2_version 3"` for player compat.
3. **FB fallback post-process**: only when yt-dlp method fails; npm-lib/scraper give MP4, strip with `ffmpeg -i in.mp4 -vn -c:a libmp3lame -q:a 5 out.mp3 -metadata title=...`.
4. **History migration**: ALTER TABLE add `audio_only INTEGER DEFAULT 0`. Update `searchByUrl` to accept `audioOnly` param. Backfill existing rows with 0.
5. **Web UI mutex**: Audio MP3 toggle disables Karaoke toggle (and vice versa) — not supported simultaneously.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| yt-dlp version variance in `--add-metadata` behavior | Pin minimum version note in README |
| FB fallback double-converts when video already exists in tmp | Cleanup MP4 after MP3 produced (or keep both? — keep MP3 only, audio is the request) |
| History dedup migration breaks existing installs | Idempotent migration: `PRAGMA table_info` check before ALTER |
| Web UI: Karaoke + Audio MP3 both checked | Frontend disables the other on toggle; backend validates 422 if both true |

## Success Criteria

- [ ] CLI `--audio-only <url>` works for YT, FB, TT — produces `.mp3` with ID3 tags + cover
- [ ] Web UI toggle produces same result
- [ ] FB fallback (when yt-dlp fails) still produces MP3
- [ ] Same URL can have both MP4 + MP3 in history without conflict
- [ ] File size for 3-min song: ~4-5 MB (VBR ~190kbps)
- [ ] MP3 plays correctly in: Quicktime, VLC, iTunes/Music.app (ID3v2.3 compat)

## Next Steps

1. → `/ck:plan` to create detailed phase plan in `plans/260524-2219-mp3-conversion/`
2. → Implementation per phases
3. → Tester runs end-to-end for each platform
4. → Code review + docs update

## Unresolved Questions

- Naming convention for MP3 file: keep `%(title)s.mp3` or prefix with date like karaoke output? (Default: keep `%(title)s.mp3` for consistency with current TikTok behavior — confirm in plan phase)
- Should history dedup migration auto-run on startup or via separate `npm run migrate`? (Recommend auto-idempotent on server start)
