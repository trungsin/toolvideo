#!/usr/bin/env node
/**
 * Toolvideo MCP Server
 * Exposes saveclip.datxanhmientrung.ai video download API as MCP tools.
 * Designed for Claude Code / Claude Desktop via stdio transport.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { apiGet, apiPost, fileUrl, karaokeFileUrl } from './lib/api-client.js';
import { pollUntilComplete } from './lib/poll-progress.js';

const TOOLS = [
  {
    name: 'get_video_info',
    description:
      'Fetch video metadata (title, duration, thumbnail) without downloading. Supports YouTube, Facebook, TikTok, X (Twitter). Returns quickly.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Video URL (YouTube, Facebook, TikTok, or X/Twitter)' }
      },
      required: ['url']
    }
  },
  {
    name: 'download_video',
    description:
      'Download a video and return a direct download link. Blocks until complete (up to 120s). For TikTok, supports audio-only MP3 and watermark options.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Video URL' },
        audio_only: {
          type: 'boolean',
          description: 'TikTok only: extract MP3 audio instead of video'
        },
        watermark: {
          type: 'boolean',
          description: 'TikTok only: include TikTok watermark (default: no watermark)'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'start_karaoke',
    description:
      'Start a karaoke conversion (vocal removal + synced lyrics overlay). Long-running (1-3 minutes). Returns karaoke_id immediately; poll with get_karaoke_status.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Video URL with vocals/music' },
        language: {
          type: 'string',
          description: 'Audio language code (e.g. en, vi, ko, ja). Default: auto-detect'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'get_karaoke_status',
    description:
      'Check the status of a karaoke conversion. Returns progress while running, or final URLs (video + lyrics) when complete.',
    inputSchema: {
      type: 'object',
      properties: {
        karaoke_id: { type: 'string', description: 'ID returned by start_karaoke' }
      },
      required: ['karaoke_id']
    }
  }
];

async function handleGetVideoInfo({ url }) {
  return apiGet(`/api/info?url=${encodeURIComponent(url)}`);
}

async function handleDownloadVideo({ url, audio_only, watermark }) {
  const start = await apiPost('/api/download', { url, audioOnly: audio_only, watermark });
  const result = await pollUntilComplete(start.downloadId, { timeoutMs: 120000 });
  // Use persistent history DB id (result.id) — survives pm2 restarts.
  // downloadId is in-memory only and would 404 after restart.
  return {
    download_url: fileUrl(result.id),
    title: result.title,
    duration: result.duration,
    quality: result.quality,
    platform: start.platform
  };
}

async function handleStartKaraoke({ url, language }) {
  const start = await apiPost('/api/karaoke', {
    url,
    source: 'whisper',
    language: language || 'auto'
  });
  return {
    karaoke_id: start.karaokeId,
    platform: start.platform,
    message: 'Karaoke conversion started. Use get_karaoke_status to poll. Typical duration: 1-3 minutes.'
  };
}

async function handleGetKaraokeStatus({ karaoke_id }) {
  const progress = await apiGet(`/api/progress/${karaoke_id}`);
  if (progress.status === 'complete' && progress.result) {
    return {
      status: 'complete',
      video_url: karaokeFileUrl(karaoke_id, 'video'),
      lyrics_lrc_url: karaokeFileUrl(karaoke_id, 'lrc'),
      lyrics_ass_url: karaokeFileUrl(karaoke_id, 'ass'),
      duration: progress.result.duration,
      segments: progress.result.segments,
      lyrics_source: progress.result.lyricsSource
    };
  }
  if (progress.status === 'error') {
    return { status: 'error', error: progress.error };
  }
  return {
    status: progress.status,
    stage: progress.stage,
    progress_percent: progress.progress
  };
}

const HANDLERS = {
  get_video_info: handleGetVideoInfo,
  download_video: handleDownloadVideo,
  start_karaoke: handleStartKaraoke,
  get_karaoke_status: handleGetKaraokeStatus
};

const server = new Server(
  { name: 'toolvideo-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const handler = HANDLERS[name];
  if (!handler) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true
    };
  }
  try {
    const result = await handler(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
