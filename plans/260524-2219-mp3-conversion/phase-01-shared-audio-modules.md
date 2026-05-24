---
phase: 01
name: Shared Audio Modules
status: done
priority: high
effort: S
---

# Phase 01 — Shared Audio Modules

## Context
- Brainstorm: `plans/reports/brainstorm-260524-2219-mp3-conversion-all-links.md`
- Existing audio code: `src/core/karaoke/audio-extractor.js` (FFmpeg wrapper for WAV)
- Existing TikTok MP3: `src/core/tiktok/yt-dlp-method.js:158-161`

## Overview
Create 2 shared modules used by all platform handlers. Eliminates duplication, centralizes MP3 conversion config (VBR quality, metadata flags, ID3 version).

## Key Insights
- yt-dlp `-q 5` ≈ 190kbps VBR (target 192).
- `--embed-thumbnail --add-metadata` writes title/artist/cover automatically.
- `--postprocessor-args "ffmpeg:-id3v2_version 3"` ensures broad player compat (Music.app strict on ID3v2.3).
- FFmpeg fallback: `-vn -c:a libmp3lame -q:a 5 -id3v2_version 3` matches VBR + metadata.

## Files to Create

### `src/core/audio-args.js` (new, ~30 LOC)
Builds yt-dlp argument array for audio extraction.

```js
/**
 * Shared yt-dlp argument builder for audio (MP3) extraction.
 * VBR ~192kbps + embedded thumbnail + ID3v2.3 metadata.
 */
export function buildAudioArgs() {
  return [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '5',           // VBR ~190kbps
    '--embed-thumbnail',
    '--add-metadata',
    '--postprocessor-args', 'ffmpeg:-id3v2_version 3'
  ];
}

export const AUDIO_EXT = 'mp3';
```

### `src/core/audio-postprocess.js` (new, ~80 LOC)
FFmpeg wrapper that converts existing video file → MP3 with metadata. Used by Facebook fallback path when yt-dlp method fails.

```js
import { spawn } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { dirname, basename, extname, join } from 'path';

/**
 * Convert video file to MP3 with metadata + cover art.
 * @param {string} videoPath - Input video path
 * @param {Object} meta - { title, artist, thumbnailPath? }
 * @param {Object} [opts] - { deleteSource: true }
 * @returns {Promise<string>} Output MP3 path
 */
export async function videoToMp3(videoPath, meta = {}, opts = {}) {
  if (!existsSync(videoPath)) {
    throw new Error(`videoToMp3: input not found: ${videoPath}`);
  }
  const out = join(dirname(videoPath), basename(videoPath, extname(videoPath)) + '.mp3');

  const args = ['-y', '-i', videoPath];
  if (meta.thumbnailPath && existsSync(meta.thumbnailPath)) {
    args.push('-i', meta.thumbnailPath, '-map', '0:a', '-map', '1:v',
              '-c:v', 'mjpeg', '-disposition:v', 'attached_pic');
  } else {
    args.push('-vn');
  }
  args.push('-c:a', 'libmp3lame', '-q:a', '5', '-id3v2_version', '3');
  if (meta.title)  args.push('-metadata', `title=${meta.title}`);
  if (meta.artist) args.push('-metadata', `artist=${meta.artist}`);
  args.push(out);

  await runFfmpeg(args);

  if (opts.deleteSource) {
    try { unlinkSync(videoPath); } catch {}
  }
  return out;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`ffmpeg failed: ${stderr.split('\n').slice(-3).join(' ')}`));
      else resolve();
    });
    proc.on('error', err => reject(new Error(`ffmpeg spawn: ${err.message}`)));
  });
}
```

## Architecture
- Pure function for args (testable, no I/O)
- Post-process module isolates FFmpeg invocation, accepts optional thumbnail
- Both modules stateless

## Related Code Files
- Create: `src/core/audio-args.js`
- Create: `src/core/audio-postprocess.js`
- No modifications in this phase

## Implementation Steps
1. Create `src/core/audio-args.js` with `buildAudioArgs()` + `AUDIO_EXT` constant
2. Create `src/core/audio-postprocess.js` with `videoToMp3()` + internal `runFfmpeg()`
3. Smoke-check: `node -e "import('./src/core/audio-args.js').then(m => console.log(m.buildAudioArgs()))"` should print the args array
4. Smoke-check FFmpeg: `node -e "import('./src/core/audio-postprocess.js').then(m => m.videoToMp3('/tmp/test.mp4', {title:'t'}).then(console.log))"` (manual w/ a test mp4)

## Todo
- [ ] Create `audio-args.js`
- [ ] Create `audio-postprocess.js`
- [ ] Verify `buildAudioArgs()` returns expected flag array
- [ ] Manual FFmpeg test with a small mp4 → verify mp3 output has ID3 tags via `ffprobe -show_format`

## Success Criteria
- Both files <100 LOC each
- `buildAudioArgs()` returns deterministic array
- `videoToMp3()` produces playable MP3 with metadata visible in `ffprobe`

## Risks
- FFmpeg not in PATH → already required by project (README), so safe
- Thumbnail attach syntax varies by FFmpeg version → tested with FFmpeg 6+ (homebrew current)

## Next
→ Phase 02 (DB) and Phase 03 (handlers) can both start. Phase 03 imports these modules.
