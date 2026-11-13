/**
 * Express server for video downloader web interface
 * Provides API endpoints for download, progress tracking, and history
 */

import express from 'express';
import { dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';
import { download, detectPlatform, isValidUrl } from '../core/downloader.js';
import { getDownloads, getDownloadById, addKaraoke, getKaraokeById } from '../db/history.js';
import { createReadStream, statSync, existsSync } from 'fs';
import { convertToKaraoke, checkDependencies } from '../core/karaoke/karaoke-handler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(express.json());

/**
 * API key auth middleware.
 * Web UI (browser with matching Origin/Referer) bypasses auth.
 * File download routes (/api/file/:id, /api/karaoke/file/:id/:type) are always public:
 *   IDs are random and unguessable, so the URL itself is the secret. This lets
 *   end users open download links directly in a browser (no key needed).
 * Other /api/* routes require X-API-Key matching process.env.API_KEY for external callers.
 * If API_KEY env is not set, all /api/* routes are open (backward compat).
 */
const WEB_UI_HOSTS = [
  'saveclip.datxanhmientrung.ai',
  'saveclip.leesun.space',
  'localhost',
  '127.0.0.1',
];
// Paths are relative to the /api mount point (req.path strips the prefix)
const PUBLIC_PATH_PREFIXES = ['/file/', '/karaoke/file/'];
function apiKeyAuth(req, res, next) {
  if (!process.env.API_KEY) return next(); // not configured → open
  if (PUBLIC_PATH_PREFIXES.some(p => req.path.startsWith(p))) return next();
  const origin = req.get('origin') || req.get('referer') || '';
  const isWebUI = WEB_UI_HOSTS.some(h => origin.includes(h));
  if (isWebUI) return next();
  const key = req.get('x-api-key');
  if (key !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}
app.use('/api', apiKeyAuth);

app.use(express.static(join(__dirname, 'public')));

// Store active downloads for progress tracking
const activeDownloads = new Map();

// Cleanup old downloads after 1 hour
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, data] of activeDownloads) {
    if (data.timestamp < oneHourAgo) {
      activeDownloads.delete(id);
    }
  }
}, 10 * 60 * 1000); // Run every 10 minutes

// API: Check URL validity and platform
app.post('/api/check', (req, res) => {
  const { url } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const { platform } = detectPlatform(url);
  if (platform === 'unknown') {
    return res.status(400).json({ error: 'Unsupported platform. Supported: YouTube, Facebook, TikTok.' });
  }

  res.json({ platform, valid: true });
});

// API: Start download
app.post('/api/download', async (req, res) => {
  const { url, audioOnly } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const { platform } = detectPlatform(url);
  if (platform === 'unknown') {
    return res.status(400).json({ error: 'Unsupported platform' });
  }

  // Generate download ID
  const downloadId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  activeDownloads.set(downloadId, {
    progress: 0,
    status: 'downloading',
    timestamp: Date.now()
  });

  // Start download in background
  download(url, {
    audioOnly: !!audioOnly,
    onProgress: (data) => {
      const current = activeDownloads.get(downloadId);
      if (current && data.percent !== undefined) {
        current.progress = data.percent;
        current.speed = data.speed;
        current.eta = data.eta;
        current.status = data.status || 'downloading';
      }
    }
  })
    .then((result) => {
      const current = activeDownloads.get(downloadId);
      if (current) {
        current.status = 'complete';
        current.progress = 100;
        current.result = result;
      }
    })
    .catch((error) => {
      const current = activeDownloads.get(downloadId);
      if (current) {
        current.status = 'error';
        current.error = error.message;
      }
    });

  res.json({ downloadId, platform, audioOnly: !!audioOnly });
});

// API: Check download progress
app.get('/api/progress/:id', (req, res) => {
  const { id } = req.params;
  const downloadData = activeDownloads.get(id);

  if (!downloadData) {
    return res.status(404).json({ error: 'Download not found' });
  }

  res.json(downloadData);
});

// API: Get video metadata without downloading (for MCP get_video_info)
app.get('/api/info', async (req, res) => {
  const url = req.query.url;
  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid or missing url query param' });
  }
  const { platform } = detectPlatform(url);
  if (platform === 'unknown') {
    return res.status(400).json({ error: 'Unsupported platform' });
  }
  try {
    const { getInfo } = await import('../core/downloader.js');
    const info = await getInfo(url);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get download history
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 20;
  const downloads = getDownloads(limit);
  res.json(downloads);
});

// API: Serve downloaded file. Looks up in in-memory map first (current session),
// then falls back to persistent history DB so links survive pm2 restarts.
app.get('/api/file/:id', (req, res) => {
  const { id } = req.params;

  let filepath = null;

  // Path 1: in-memory active downloads (any URL scheme — downloadId or history id)
  const downloadData = activeDownloads.get(id);
  if (downloadData && downloadData.status === 'complete' && downloadData.result?.filepath) {
    filepath = downloadData.result.filepath;
  }

  // Path 2: persistent lookup by history DB id
  if (!filepath) {
    const record = getDownloadById(id);
    if (record && record.filepath) {
      filepath = record.filepath;
    }
  }

  if (!filepath) {
    return res.status(404).json({ error: 'File not ready' });
  }

  if (!existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const filename = filepath.split('/').pop();
  const stat = statSync(filepath);
  const contentType = getDownloadContentType(filepath);

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stat.size);

  createReadStream(filepath).pipe(res);
});

function getDownloadContentType(filepath) {
  const mimeMap = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.mp4': 'video/mp4',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
  };
  return mimeMap[extname(filepath).toLowerCase()] || 'application/octet-stream';
}

// API: Check karaoke dependencies
app.get('/api/karaoke/check', async (req, res) => {
  try {
    const deps = await checkDependencies();
    res.json(deps);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Start karaoke conversion
app.post('/api/karaoke', async (req, res) => {
  const { url, source, language } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const { platform } = detectPlatform(url);
  if (platform === 'unknown') {
    return res.status(400).json({ error: 'Unsupported platform' });
  }

  // Generate karaoke ID
  const karaokeId = 'k' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  activeDownloads.set(karaokeId, {
    progress: 0,
    status: 'downloading',
    stage: 'download',
    timestamp: Date.now(),
    isKaraoke: true
  });

  // Start karaoke process in background
  (async () => {
    const current = activeDownloads.get(karaokeId);
    try {
      // Step 1: Download video
      const downloadResult = await download(url, {
        onProgress: (data) => {
          if (current && data.percent !== undefined) {
            current.progress = data.percent * 0.2; // 0-20%
            current.status = 'downloading';
            current.stage = 'download';
          }
        }
      });

      if (current) {
        current.videoPath = downloadResult.filepath;
        current.stage = 'processing';
        current.status = 'processing';
      }

      // TikTok: default to Whisper auto-transcribe — lrclib rarely has snippet/remix lyrics.
      const useAuto = source === 'whisper' || (platform === 'tiktok' && source !== 'lrclib');

      // Step 2: Convert to karaoke
      const karaokeResult = await convertToKaraoke(downloadResult.filepath, {
        autoLyrics: useAuto,
        language: language !== 'auto' ? language : undefined,
        onProgress: (data) => {
          if (current) {
            current.stage = data.stage;
            current.status = data.status || data.stage;
            // Map stages to progress (20-100%)
            const stageProgress = {
              extract: 25,
              separate: 50,
              lyrics: 60,
              transcribe: 70,
              sync: 80,
              render: 95
            };
            current.progress = stageProgress[data.stage] || current.progress;
          }
        }
      });

      if (current) {
        current.status = 'complete';
        current.progress = 100;
        current.result = karaokeResult;
      }

      // Persist karaoke job for file serving across pm2 restarts
      try {
        addKaraoke({
          id: karaokeId,
          url,
          platform,
          title: karaokeResult.title,
          outputFolder: karaokeResult.outputFolder,
          videoPath: karaokeResult.output,
          lyricsLrcPath: karaokeResult.lyricsLrc,
          lyricsAssPath: karaokeResult.lyricsAss,
          duration: karaokeResult.duration,
          segments: karaokeResult.segments,
          lyricsSource: karaokeResult.lyricsSource
        });
      } catch (persistErr) {
        console.error('[karaoke] failed to persist job:', persistErr.message);
      }
    } catch (error) {
      if (current) {
        current.status = 'error';
        current.error = error.message;
      }
    }
  })();

  res.json({ karaokeId, platform });
});

// API: Serve karaoke files. Resolves via in-memory map (current session) or
// persistent karaoke table (survives pm2 restart).
app.get('/api/karaoke/file/:id/:type', (req, res) => {
  const { id, type } = req.params;

  // Build the { video, lrc, ass } path map from whichever source has it
  let paths = null;
  const downloadData = activeDownloads.get(id);
  if (downloadData && downloadData.status === 'complete' && downloadData.result) {
    paths = {
      video: downloadData.result.output,
      lrc: downloadData.result.lyricsLrc,
      ass: downloadData.result.lyricsAss
    };
  } else {
    const record = getKaraokeById(id);
    if (record) {
      paths = {
        video: record.video_path,
        lrc: record.lyrics_lrc_path,
        ass: record.lyrics_ass_path
      };
    }
  }

  if (!paths) {
    return res.status(404).json({ error: 'File not ready' });
  }

  const contentTypeMap = { video: 'video/mp4', lrc: 'text/plain', ass: 'text/plain' };
  if (!(type in contentTypeMap)) {
    return res.status(400).json({ error: 'Invalid file type' });
  }

  const filepath = paths[type];
  const contentType = contentTypeMap[type];

  if (!filepath || !existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const filename = filepath.split('/').pop();
  const stat = statSync(filepath);

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stat.size);

  createReadStream(filepath).pipe(res);
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`\n  Video Downloader Server`);
  console.log(`  -----------------------`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Bind:    http://${HOST}:${PORT}\n`);
});
