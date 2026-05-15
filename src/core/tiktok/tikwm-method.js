/**
 * TikTok download via tikwm.com public API
 * Fallback method when yt-dlp fails
 *
 * API: GET https://www.tikwm.com/api/?url=<encoded>&hd=1
 * Response: { code: 0, data: { title, play, wmplay, music, duration, cover, images? } }
 */

import { join, dirname } from 'path';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = join(__dirname, '../../../downloads');
const TIKWM_API = 'https://www.tikwm.com/api/';
const ALLOWED_CDN_HOSTS = [
  'tikwm.com',
  'tiktok.com',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokcdn-eu.com',
  'byteoversea.com',
  'muscdn.com',
  'musical.ly'
];
const FETCH_TIMEOUT = 30000;
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB safety cap

/**
 * Download TikTok content via tikwm.com API
 * @param {string} url - TikTok URL
 * @param {Object} options - { outputDir, progress, contentType, watermark, audioOnly }
 * @returns {Promise<Object>} Download result
 */
export async function downloadViaTikwm(url, options = {}) {
  const outputDir = options.outputDir || DEFAULT_OUTPUT;
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const data = await fetchTikwmApi(url);
  const title = sanitizeFilename(data.title || `tiktok-${data.id || Date.now()}`);
  const isPhoto = options.contentType === 'photo' || (Array.isArray(data.images) && data.images.length > 0);

  if (isPhoto) {
    return downloadCarousel(data, title, outputDir, options);
  }

  // Pick URL based on options. Track actual selection for honest quality reporting.
  let downloadUrl;
  let ext;
  let quality;
  if (options.audioOnly) {
    downloadUrl = data.music;
    ext = 'mp3';
    quality = 'mp3';
  } else if (options.watermark) {
    downloadUrl = data.wmplay;
    ext = 'mp4';
    quality = 'WM';
  } else if (data.play) {
    downloadUrl = data.play;
    ext = 'mp4';
    quality = 'no-WM';
  } else if (data.wmplay) {
    downloadUrl = data.wmplay;
    ext = 'mp4';
    quality = 'WM-fallback';
    console.log('[tikwm] No-WM unavailable, falling back to watermark version');
  }

  if (!downloadUrl) {
    throw new Error('No download URL in tikwm response');
  }
  validateCdnUrl(downloadUrl);

  const filepath = join(outputDir, `${title}.${ext}`);
  await streamDownload(downloadUrl, filepath, options.progress);

  return {
    title: data.title || title,
    filepath,
    quality,
    duration: data.duration || null,
    thumbnail: data.cover || null,
    contentType: 'video'
  };
}

/**
 * Download all carousel images + audio into dedicated folder
 */
async function downloadCarousel(data, title, outputDir, options) {
  const targetDir = join(outputDir, title);
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  const images = [];
  for (let i = 0; i < data.images.length; i++) {
    const imgUrl = data.images[i];
    validateCdnUrl(imgUrl);
    const imgPath = join(targetDir, `image-${String(i + 1).padStart(2, '0')}.jpg`);
    await streamDownload(imgUrl, imgPath);
    images.push(imgPath);
    if (options.progress) {
      options.progress.emit({ percent: ((i + 1) / data.images.length) * 80 });
    }
  }

  let audio = null;
  if (data.music) {
    validateCdnUrl(data.music);
    audio = join(targetDir, 'audio.mp3');
    await streamDownload(data.music, audio);
    if (options.progress) options.progress.emit({ percent: 95 });
  }

  return {
    title: data.title || title,
    filepath: targetDir,
    quality: 'carousel',
    duration: data.duration || null,
    thumbnail: data.cover || null,
    contentType: 'photo',
    rawFiles: { images, audio }
  };
}

/**
 * Call tikwm.com API
 */
async function fetchTikwmApi(url) {
  const apiUrl = `${TIKWM_API}?url=${encodeURIComponent(url)}&hd=1`;
  const response = await fetch(apiUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT)
  });

  if (!response.ok) {
    throw new Error(`tikwm API ${response.status}: ${response.statusText}`);
  }

  const json = await response.json();
  if (json.code !== 0 || !json.data) {
    throw new Error(json.msg || 'tikwm API returned error');
  }
  return json.data;
}

/**
 * Whitelist check on CDN URL to prevent SSRF / rogue redirects
 */
function validateCdnUrl(urlStr) {
  const parsed = new URL(urlStr);
  const ok = ALLOWED_CDN_HOSTS.some(host =>
    parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
  );
  if (!ok) throw new Error(`Untrusted CDN host: ${parsed.hostname}`);
}

/**
 * Stream download with progress tracking and size cap
 */
async function streamDownload(url, destPath, progress) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT)
  });

  if (!response.ok) {
    throw new Error(`Download failed ${response.status}: ${response.statusText}`);
  }

  const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
  if (totalSize > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${totalSize} bytes`);
  }

  let downloaded = 0;
  const writer = createWriteStream(destPath);
  const nodeStream = Readable.fromWeb(response.body);

  nodeStream.on('data', chunk => {
    downloaded += chunk.length;
    if (downloaded > MAX_FILE_SIZE) {
      nodeStream.destroy(new Error('File size exceeded cap'));
      return;
    }
    if (progress && totalSize > 0) {
      progress.emit({ percent: (downloaded / totalSize) * 100 });
    }
  });

  await pipeline(nodeStream, writer);
  if (progress) progress.emit({ percent: 100, status: 'complete' });
}

/**
 * Sanitize title for safe filename / folder name
 */
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || `tiktok-${Date.now()}`;
}
