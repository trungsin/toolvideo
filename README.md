# toolvideo

Personal video download tool for YouTube, Facebook, and TikTok with CLI and Web interface. Includes karaoke conversion with vocal removal and synced lyrics.

## Features

- **YouTube** - Downloads via yt-dlp with best quality auto-selection
- **Facebook** - Multi-fallback chain (yt-dlp → npm lib → custom scraper)
- **TikTok** - Multi-fallback (yt-dlp → tikwm.com API). Supports no-watermark video, watermark video, and photo carousels rendered as MP4 slideshow.
- **MP3 Audio** - Extract audio as MP3 from any platform (VBR ~192kbps, embedded metadata + cover art)
- **Karaoke** - Vocal removal + synced lyrics overlay
- **CLI** - Simple command-line interface
- **Web UI** - Minimal dark-themed web app
- **History** - SQLite database tracking all downloads

## Requirements

- Node.js 18+
- yt-dlp (`brew install yt-dlp` or `pip install -U --pre yt-dlp`)
- A JavaScript runtime for YouTube: Deno (recommended) or Node.js
- FFmpeg (`brew install ffmpeg`)

YouTube extractors break often. If downloads return `HTTP 403 Forbidden`, update yt-dlp to nightly and confirm Deno is on `PATH`:

```bash
python3 -m pip install -U --pre yt-dlp
# macOS: brew install deno
# Linux: curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh
```

### Karaoke Requirements (optional)

- Python 3.8+ with Demucs (`pip install demucs`)
- whisper.cpp (`brew install whisper-cpp`)
- Download Whisper model: `whisper-cpp-download-ggml-model medium`

## Installation

```bash
npm install
```

## Usage

### CLI

```bash
# Download video (YouTube, Facebook, TikTok)
./src/cli/index.js <url>

# TikTok: download with watermark
./src/cli/index.js --watermark <tiktok-url>

# Extract audio as MP3 (YouTube, Facebook, TikTok)
./src/cli/index.js --audio-only <url>

# TikTok short URL (vm.tiktok.com / vt.tiktok.com) is auto-resolved
./src/cli/index.js https://vm.tiktok.com/ZSXXXXXX/

# TikTok photo carousel — auto-rendered as MP4 slideshow
./src/cli/index.js https://www.tiktok.com/@user/photo/<id>

# Show download history
./src/cli/index.js history

# Get video info without downloading
./src/cli/index.js info <url>
```

### Karaoke

```bash
# Create karaoke from YouTube (fetches lyrics from lrclib)
./src/cli/index.js karaoke <url>

# Auto-transcribe lyrics (for videos without lyrics in database)
./src/cli/index.js karaoke <url> --auto --lang vi

# Specify language for better accuracy
./src/cli/index.js karaoke <url> --lang vi    # Vietnamese
./src/cli/index.js karaoke <url> --lang en    # English
./src/cli/index.js karaoke <url> --lang ko    # Korean

# Use larger Whisper model for better transcription
./src/cli/index.js karaoke <url> --auto --model large

# Instrumental only (no lyrics)
./src/cli/index.js karaoke <url> --no-lyrics

# From local file
./src/cli/index.js karaoke ./video.mp4

# TikTok — auto-transcribe enabled by default (lrclib rarely has snippet/remix lyrics)
./src/cli/index.js karaoke https://www.tiktok.com/@user/video/<id>
```

**Output:** Creates folder `downloads/YYMMDD-HHMM-song-name/` with:
- `karaoke.mp4` - Video with instrumental audio + synced lyrics
- `lyrics.lrc` - Timestamped lyrics file
- `lyrics.ass` - Subtitle file for karaoke effect

### Web Interface

```bash
# Start server
npm start

# Open in browser
open http://localhost:3000
```

Toggle **Audio MP3** in the web UI to extract MP3 audio, or toggle **Karaoke Mode** to convert videos with vocal removal and synced lyrics. These modes are mutually exclusive.

## Project Structure

```
src/
├── cli/index.js              # CLI entry point
├── web/
│   ├── server.js             # Express server
│   └── public/               # Frontend assets
├── core/
│   ├── downloader.js         # Main orchestrator
│   ├── url-detector.js       # Platform detection + short-URL resolver
│   ├── audio-args.js         # Shared yt-dlp MP3 extraction args
│   ├── audio-postprocess.js  # FFmpeg MP4-to-MP3 fallback conversion
│   ├── youtube-handler.js    # yt-dlp wrapper
│   ├── facebook-handler.js   # Multi-fallback handler
│   ├── facebook/             # Facebook methods (yt-dlp, npm-lib, scraper)
│   ├── tiktok-handler.js     # TikTok multi-fallback handler
│   ├── tiktok/
│   │   ├── yt-dlp-method.js     # Primary TikTok download
│   │   ├── tikwm-method.js      # Fallback via tikwm.com
│   │   └── carousel-renderer.js # FFmpeg slideshow for photo posts
│   └── karaoke/
│       ├── karaoke-handler.js   # Karaoke orchestrator
│       ├── audio-extractor.js   # FFmpeg audio extract
│       ├── vocal-separator.js   # Demucs wrapper
│       ├── lyrics-fetcher.js    # lrclib/Genius API
│       ├── lyrics-syncer.js     # Whisper alignment
│       └── video-renderer.js    # FFmpeg ASS overlay
├── db/history.js             # SQLite operations
└── utils/progress.js         # Progress tracking
scripts/
├── demucs-separate.py        # Python vocal separator
└── whisper-transcribe.sh     # Whisper CLI wrapper
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/download | Start download; accepts `{ "url": string, "audioOnly": boolean }` |
| POST | /api/karaoke | Start karaoke conversion |
| GET | /api/progress/:id | Check progress |
| GET | /api/history | Get download history |
| GET | /api/file/:id | Download completed file |
| GET | /api/karaoke/file/:id/:type | Download karaoke files (video/lrc/ass) |

## License

MIT
