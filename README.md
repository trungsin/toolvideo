# toolvideo

Personal video download tool for YouTube and Facebook with CLI and Web interface. Includes karaoke conversion with vocal removal and synced lyrics.

## Features

- **YouTube** - Downloads via yt-dlp with best quality auto-selection
- **Facebook** - Multi-fallback chain (yt-dlp → npm lib → custom scraper)
- **Karaoke** - Vocal removal + synced lyrics overlay
- **CLI** - Simple command-line interface
- **Web UI** - Minimal dark-themed web app
- **History** - SQLite database tracking all downloads

## Requirements

- Node.js 18+
- yt-dlp (`brew install yt-dlp` or `pip install yt-dlp`)
- FFmpeg (`brew install ffmpeg`)

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
# Download video
./src/cli/index.js <url>

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

Toggle **Karaoke Mode** in the web UI to convert videos with vocal removal and synced lyrics.

## Project Structure

```
src/
├── cli/index.js              # CLI entry point
├── web/
│   ├── server.js             # Express server
│   └── public/               # Frontend assets
├── core/
│   ├── downloader.js         # Main orchestrator
│   ├── url-detector.js       # Platform detection
│   ├── youtube-handler.js    # yt-dlp wrapper
│   ├── facebook-handler.js   # Multi-fallback handler
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
| POST | /api/download | Start download |
| POST | /api/karaoke | Start karaoke conversion |
| GET | /api/progress/:id | Check progress |
| GET | /api/history | Get download history |
| GET | /api/file/:id | Download completed file |
| GET | /api/karaoke/file/:id/:type | Download karaoke files (video/lrc/ass) |

## License

MIT
