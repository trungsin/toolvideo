/**
 * Facebook video download via fb-downloader-scrapper npm package
 * Fallback #1 - uses third-party scraping library
 */

import { getFbVideoInfo } from 'fb-downloader-scrapper';
import axios from 'axios';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { AUDIO_QUALITY } from '../audio-args.js';
import { videoToMp3 } from '../audio-postprocess.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = join(__dirname, '../../../downloads');

/**
 * Download Facebook video using fb-downloader-scrapper
 * @param {string} url - Facebook video URL
 * @param {Object} options - Download options
 * @returns {Object} Download result
 */
export async function downloadViaNpmLib(url, options = {}) {
  const outputDir = options.outputDir || DEFAULT_OUTPUT;

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Get video info via npm lib
  const info = await getFbVideoInfo(url);

  if (!info) {
    throw new Error('Could not get video info');
  }

  // Check for video URL - library returns different structures
  const videoUrl = info.hd || info.sd || info.url;

  if (!videoUrl) {
    throw new Error('Could not extract video URL from response');
  }

  const title = sanitizeFilename(info.title || 'facebook_video');
  let filepath = join(outputDir, `${title}.mp4`);

  // Download video file
  await downloadFile(videoUrl, filepath, options.progress);

  if (options.audioOnly) {
    filepath = await videoToMp3(
      filepath,
      {
        title: info.title || 'Facebook Video',
        artist: info.uploader || 'Facebook',
        thumbnailUrl: info.thumbnail,
      },
      { deleteSource: true }
    );
  }

  return {
    title: info.title || 'Facebook Video',
    filepath,
    quality: options.audioOnly ? AUDIO_QUALITY : (info.hd ? 'HD' : 'SD'),
    duration: info.duration || null,
    thumbnail: info.thumbnail || null
  };
}

/**
 * Download file from URL with progress tracking
 */
async function downloadFile(url, filepath, progress) {
  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
    timeout: 60000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  const totalLength = parseInt(response.headers['content-length'], 10);
  let downloaded = 0;

  const writer = createWriteStream(filepath);

  response.data.on('data', chunk => {
    downloaded += chunk.length;
    if (progress && totalLength) {
      progress.emit({
        percent: (downloaded / totalLength) * 100,
        downloaded,
        total: totalLength
      });
    }
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => {
      if (progress) {
        progress.emit({ percent: 100, status: 'complete' });
      }
      resolve();
    });
    writer.on('error', reject);
  });
}

/**
 * Sanitize filename for filesystem
 */
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}
