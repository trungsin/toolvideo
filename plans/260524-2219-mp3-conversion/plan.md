---
name: MP3 Conversion for All Links
slug: mp3-conversion
status: done_with_concerns
created: 2026-05-24 22:19 +07
approach: hybrid (yt-dlp native + FFmpeg fallback for FB)
---

# Plan: MP3 Conversion for All Links

Add unified MP3 audio extraction for YouTube + Facebook + TikTok across CLI and Web UI. VBR ~192kbps, embed thumbnail + ID3v2.3 tags. Composite dedup `(url, audio_only)`.

## Source
- Brainstorm: `plans/reports/brainstorm-260524-2219-mp3-conversion-all-links.md`

## Approach (agreed)
**Hybrid C** — native yt-dlp `-x` for YT/TT/FB-via-ytdlp; FFmpeg post-process MP4→MP3 fallback for FB npm-lib/scraper methods.

## Phases

| # | Phase | Status | Effort |
|---|-------|--------|--------|
| 01 | Shared audio modules (`buildAudioArgs` + `videoToMp3`) | done | S |
| 02 | DB schema migration (`audio_only` column + dedup) | done | S |
| 03 | Handler updates (YouTube, FB, TikTok refactor) | done | M |
| 04 | Orchestrator + CLI surface | done | S |
| 05 | Web UI surface (server + frontend toggle) | done | M |
| 06 | Manual e2e tests + docs update | done_with_concerns | S |

## Dependencies
- 01 → 03 (handlers need shared modules)
- 02 → 04 (orchestrator dedup needs schema)
- 03 → 04 (orchestrator routes to handlers)
- 04 → 05 (web reuses CLI core)
- 05 → 06

## Out of Scope
- Karaoke MP3 export (separate feature)
- Bitrate user selection (fixed VBR ~192kbps)
- Playlist/batch MP3
- Audio formats other than MP3 (m4a/opus/wav)

## Success Criteria
- `./src/cli/index.js --audio-only <url>` works for all 3 platforms
- Web UI "Audio MP3" toggle (mutex w/ Karaoke) produces same result
- FB fallback (when yt-dlp fails) still yields MP3 via FFmpeg
- Same URL → both MP4 + MP3 coexist in history
- MP3 contains ID3v2.3 title/artist + embedded cover art
- File size for 3-min track: ~4-5 MB (VBR ~190kbps)
- Playback works in: Quicktime, VLC, Music.app
