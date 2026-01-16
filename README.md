# toolvideo

Personal video download tool for YouTube and Facebook with CLI and Web interface.

## Features

- **YouTube** - Downloads via yt-dlp with best quality auto-selection
- **Facebook** - Multi-fallback chain (yt-dlp → npm lib → custom scraper)
- **CLI** - Simple command-line interface
- **Web UI** - Minimal dark-themed web app
- **History** - SQLite database tracking all downloads

## Requirements

- Node.js 18+
- yt-dlp (`brew install yt-dlp` or `pip install yt-dlp`)
- FFmpeg (`brew install ffmpeg`)

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

### Web Interface

```bash
# Start server
npm start

# Open in browser
open http://localhost:3000
```

## Project Structure

```
src/
├── cli/index.js           # CLI entry point
├── web/
│   ├── server.js          # Express server
│   └── public/            # Frontend assets
├── core/
│   ├── downloader.js      # Main orchestrator
│   ├── url-detector.js    # Platform detection
│   ├── youtube-handler.js # yt-dlp wrapper
│   └── facebook-handler.js # Multi-fallback handler
├── db/history.js          # SQLite operations
└── utils/progress.js      # Progress tracking
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/download | Start download |
| GET | /api/progress/:id | Check progress |
| GET | /api/history | Get download history |
| GET | /api/file/:id | Download completed file |

## License

MIT
