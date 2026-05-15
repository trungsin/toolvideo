# Goclaw — Toolvideo MCP Integration Guide

Tích hợp tool tải video (saveclip.datxanhmientrung.ai) vào goclaw thông qua MCP. Sau khi setup, user chat "tải video từ TikTok này về cho tôi" → agent gọi tool → trả link tải.

## Tổng quan

- **Transport**: stdio (process spawn)
- **Stack**: Node.js 18+, `@modelcontextprotocol/sdk`
- **Auth**: API key qua header `X-API-Key` (giữ trong env của MCP process, không expose ra agent)
- **Output**: URL link tải, không phải binary file

## Prerequisites

- Node.js ≥ 18 trên máy chạy goclaw
- Claude Code / Claude Desktop / MCP-compatible client
- API key từ admin saveclip

## Setup

### 1. Clone + install

```bash
git clone https://github.com/trungsin/toolvideo.git
cd toolvideo/mcp-server
npm install
```

### 2. Get API key

Liên hệ admin saveclip để lấy key. Key dạng hex 64 chars.

### 3. Cấu hình MCP client

**Claude Code** (`~/.claude/mcp.json` hoặc trong project `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "toolvideo": {
      "command": "node",
      "args": ["/absolute/path/to/toolvideo/mcp-server/index.js"],
      "env": {
        "SAVECLIP_API_KEY": "PASTE_KEY_HERE",
        "SAVECLIP_API_URL": "https://saveclip.datxanhmientrung.ai"
      }
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`): cùng format.

### 4. Restart MCP client

Sau khi save config, restart Claude Code / Desktop để load MCP server.

## Tools available

### `get_video_info`

Lấy metadata không tải. Trả về nhanh (<5s).

**Input:**
```json
{ "url": "https://www.tiktok.com/@user/video/123..." }
```

**Output:**
```json
{
  "platform": "tiktok",
  "title": "Video title",
  "duration": 10,
  "thumbnail": "https://...",
  "uploader": "username"
}
```

### `download_video`

Tải video, trả link tải. Block đến khi xong (timeout 120s).

**Input:**
```json
{
  "url": "https://www.tiktok.com/@user/video/123...",
  "audio_only": false,    // optional, TikTok only
  "watermark": false      // optional, TikTok only
}
```

**Output:**
```json
{
  "download_url": "https://saveclip.datxanhmientrung.ai/api/file/abc123",
  "title": "Video title",
  "duration": 10,
  "quality": "1280p",
  "platform": "tiktok"
}
```

**Lưu ý**: `download_url` là link public — end user click trực tiếp trong browser sẽ tải file ngay, không cần API key (ID nanoid unguessable đóng vai trò token).

### `start_karaoke`

Convert video thành karaoke (tách vocal + lyrics overlay). Long-running 1-3 phút. Trả `karaoke_id` ngay lập tức.

**Input:**
```json
{
  "url": "https://www.tiktok.com/@user/video/123...",
  "language": "vi"        // optional, default auto-detect
}
```

**Output:**
```json
{
  "karaoke_id": "kmp6r...",
  "platform": "tiktok",
  "message": "Karaoke conversion started. Use get_karaoke_status to poll. Typical duration: 1-3 minutes."
}
```

### `get_karaoke_status`

Check progress hoặc lấy final URLs.

**Input:**
```json
{ "karaoke_id": "kmp6r..." }
```

**Output (đang chạy):**
```json
{
  "status": "Separating vocals (this may take a while)...",
  "stage": "separate",
  "progress_percent": 50
}
```

**Output (xong):**
```json
{
  "status": "complete",
  "video_url": "https://saveclip.datxanhmientrung.ai/api/karaoke/file/kmp6r.../video",
  "lyrics_lrc_url": "https://.../api/karaoke/file/kmp6r.../lrc",
  "lyrics_ass_url": "https://.../api/karaoke/file/kmp6r.../ass",
  "duration": 10.5,
  "segments": 1,
  "lyrics_source": "whisper-transcribed"
}
```

## Example chat prompts

User trong goclaw:
- "Tải video TikTok này: https://www.tiktok.com/@scout2015/video/6718335390845095173"
- "Lấy MP3 từ TikTok URL ..."
- "Cho tôi karaoke version bài này: https://youtu.be/..."
- "Video này dài bao nhiêu? https://facebook.com/.../videos/..."

Agent flow tự động chọn tool phù hợp.

## Troubleshooting

| Lỗi | Nguyên nhân | Fix |
|-----|-------------|-----|
| `SAVECLIP_API_KEY env var is required` | Thiếu env trong mcp.json | Thêm vào "env" block |
| `HTTP 401: Invalid or missing API key` | Key sai | Verify với admin |
| `HTTP 400: Unsupported platform` | URL không phải YouTube/Facebook/TikTok | Check URL |
| `Timeout waiting for job` | Video quá dài (>2 phút) | Hiện tại tool block 120s. Video dài cần upgrade tool sang async pattern. |
| MCP server không khởi động | Path sai trong mcp.json | Dùng absolute path, check `node /path/to/index.js` chạy được không |

## Limitations

- File limit: 500MB (server-side cap)
- Disk: ~10GB free trên server, dọn định kỳ
- Rate limit: chưa enforce, fair-use only
- Download URLs (`/api/file/:id`, `/api/karaoke/file/:id/:type`) là public — bảo mật dựa vào ID nanoid unguessable. Không share công khai (e.g. paste lên forum) để tránh leak.
- Karaoke yêu cầu Whisper model trên server (đã có `base` + `medium`)

## Support

- Toolvideo repo: https://github.com/trungsin/toolvideo
- Production: https://saveclip.datxanhmientrung.ai
- MCP server source: `mcp-server/` trong repo
