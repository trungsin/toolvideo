/**
 * Express server for video downloader web interface
 * Provides API endpoints for download, progress tracking, and history
 */

import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { download, detectPlatform, isValidUrl } from '../core/downloader.js';
import { getDownloads } from '../db/history.js';
import { createReadStream, statSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
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
    return res.status(400).json({ error: 'Unsupported platform. Only YouTube and Facebook are supported.' });
  }

  res.json({ platform, valid: true });
});

// API: Start download
app.post('/api/download', async (req, res) => {
  const { url } = req.body;

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

  res.json({ downloadId, platform });
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

// API: Get download history
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 20;
  const downloads = getDownloads(limit);
  res.json(downloads);
});

// API: Serve downloaded file
app.get('/api/file/:id', (req, res) => {
  const { id } = req.params;
  const downloadData = activeDownloads.get(id);

  if (!downloadData || downloadData.status !== 'complete') {
    return res.status(404).json({ error: 'File not ready' });
  }

  const filepath = downloadData.result.filepath;

  if (!existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const filename = filepath.split('/').pop();
  const stat = statSync(filepath);

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', stat.size);

  createReadStream(filepath).pipe(res);
});

// Start server
app.listen(PORT, () => {
  console.log(`\n  Video Downloader Server`);
  console.log(`  -----------------------`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://0.0.0.0:${PORT}\n`);
});
