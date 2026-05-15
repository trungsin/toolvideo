# Toolvideo MCP Server

MCP server exposing the toolvideo (saveclip) video download API to MCP-compatible clients (Claude Code, Claude Desktop, MCP SDK clients).

## Tools

| Tool | Description |
|------|-------------|
| `get_video_info` | Fetch video metadata (title, duration, thumbnail) without downloading |
| `download_video` | Download a video and return a direct download link (blocks up to 120s) |
| `start_karaoke` | Start karaoke conversion (vocal removal + lyrics). Returns ID for polling |
| `get_karaoke_status` | Check karaoke progress; returns final URLs when complete |

## Install

```bash
git clone https://github.com/trungsin/toolvideo.git
cd toolvideo/mcp-server
npm install
```

## Configure

Two environment variables:

- `SAVECLIP_API_KEY` (required) — contact admin for the key
- `SAVECLIP_API_URL` (optional) — default `https://saveclip.datxanhmientrung.ai`

## Use with Claude Code / Claude Desktop

Add to your MCP config (`~/.claude/mcp.json` or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "toolvideo": {
      "command": "node",
      "args": ["/absolute/path/to/toolvideo/mcp-server/index.js"],
      "env": {
        "SAVECLIP_API_KEY": "your-key-here"
      }
    }
  }
}
```

## Run standalone (for testing)

```bash
SAVECLIP_API_KEY=... node index.js
```

Speaks JSON-RPC over stdio. Use `@modelcontextprotocol/inspector` or an MCP client.

## Example tool call (via MCP SDK)

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const t = new StdioClientTransport({
  command: 'node',
  args: ['./index.js'],
  env: { SAVECLIP_API_KEY: 'xxx' }
});
const c = new Client({ name: 'demo', version: '1.0' }, { capabilities: {} });
await c.connect(t);

const r = await c.callTool({
  name: 'download_video',
  arguments: { url: 'https://www.tiktok.com/@user/video/123' }
});
console.log(r.content[0].text);
// → { "download_url": "...", "title": "...", "duration": 10, "quality": "1280p" }
```

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `SAVECLIP_API_KEY env var is required` | Missing env | Set the env var in mcp.json or shell |
| `HTTP 401: Invalid or missing API key` | Wrong key | Verify with admin |
| `Timeout waiting for job` | Video too long | Use `start_karaoke` (long-running) instead of `download_video` for big jobs |
| `HTTP 400: Unsupported platform` | URL not YouTube/Facebook/TikTok | Check URL |

## Architecture

```
Claude Code / Desktop
   │ MCP stdio (JSON-RPC)
   ▼
mcp-server/index.js
   │ HTTPS + X-API-Key
   ▼
saveclip.datxanhmientrung.ai/api/*
```

Source: see `index.js` + `lib/`.
