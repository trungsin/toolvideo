---
phase: 06
name: Tests + Docs Update
status: done_with_concerns
priority: medium
effort: S
depends_on: [05]
---

# Phase 06 — Tests + Docs Update

## Context
- Project has no formal test runner (no `package.json` test script as far as scout revealed) — relies on manual/CLI testing
- Docs: `README.md` (root), `docs/` directory
- Per development rules: don't add fake test infrastructure just to pass build

## Overview
Manual e2e smoke matrix across 3 platforms × 2 modes (video / audio). Update `README.md` to document new MP3 capability. Update `docs/codebase-summary.md` if exists.

## Implementation Steps

### 1. Manual E2E Smoke Matrix

Run each, verify output and history record:

| # | Platform | Mode | Command | Expected |
|---|----------|------|---------|----------|
| 1 | YouTube | video | `./src/cli/index.js <yt-url>` | .mp4, history `audio_only=0` |
| 2 | YouTube | audio | `./src/cli/index.js --audio-only <yt-url>` | .mp3, ID3 tags + cover, ~190kbps VBR |
| 3 | Facebook | video | `./src/cli/index.js <fb-url>` | .mp4 |
| 4 | Facebook | audio (yt-dlp path) | `./src/cli/index.js --audio-only <fb-url>` | .mp3 via yt-dlp |
| 5 | Facebook | audio (fallback) | force FB yt-dlp failure scenario | .mp3 via FFmpeg post-process |
| 6 | TikTok | video | `./src/cli/index.js <tt-url>` | .mp4 (no regression) |
| 7 | TikTok | audio | `./src/cli/index.js --audio-only <tt-url>` | .mp3 (uses shared buildAudioArgs now) |
| 8 | Dedup | combo | run #1 then #2 with same URL | both records coexist |
| 9 | Web UI | audio | toggle MP3 + paste URL | .mp3 downloads via browser |
| 10 | Web UI | mutex | toggle Karaoke then MP3 | Karaoke auto-unchecks |

For each MP3 output, validate with `ffprobe`:
```bash
ffprobe -v error -show_format -show_streams <file.mp3> | grep -E 'title|artist|bit_rate|codec_name'
```
Expected: `codec_name=mp3`, `bit_rate≈190000`, `TAG:title=...`, attached_pic stream present.

### 2. README.md Updates

- Update Features section:
  - Change `- **TikTok** ... audio-only MP3` to remove TikTok-only mention
  - Add bullet: `- **MP3 Audio** - Extract audio as MP3 from any platform (VBR ~192kbps, embedded metadata + cover)`
- Update CLI section: change `--audio-only` example to show all platforms
- Update Web Interface section: mention "Audio MP3" toggle
- API Endpoints table: note `POST /api/download` accepts `{audioOnly: boolean}`

### 3. docs/ Updates (if files exist)

Read `docs/` and update relevant ones:
- `docs/codebase-summary.md` — add note about `audio-args.js` + `audio-postprocess.js` modules
- `docs/system-architecture.md` — update flow diagram if present
- `docs/project-roadmap.md` — mark MP3 feature as complete
- `docs/project-changelog.md` — add entry: `feat: MP3 audio extraction for all platforms (YouTube/Facebook/TikTok)`

If files don't exist, skip — don't create speculatively.

### 4. Code Review

Delegate to `code-reviewer` agent:
- Review all files modified in phases 01-05
- Focus: error handling in FFmpeg fallback, history migration idempotency, web UI mutex correctness
- Acceptance: no security/correctness issues, no unused imports

## Todo
- [ ] Run e2e smoke matrix (10 scenarios)
- [ ] Verify ffprobe output for each MP3
- [ ] Update README.md
- [ ] Update docs/ (only existing files)
- [ ] Delegate code-reviewer agent on changeset
- [ ] Address review findings if any

## Success Criteria
- All 10 smoke scenarios pass
- All MP3s have valid ID3v2.3 + cover art
- README accurately documents new feature
- Code review clean (no blocker findings)

## Risks
- **Facebook URL availability varies** — pick a known-working public FB watch URL for tests
- **TikTok rate limiting** — space out tests if multiple calls
- **yt-dlp version differences** in metadata embedding — note minimum version in README

## Out of Scope (for this phase)
- Automated unit tests (project has none currently — adding test infra is separate work)
- CI/CD integration

## Next
→ Feature complete. Consider follow-up plan if user wants bitrate selection or other audio formats.
