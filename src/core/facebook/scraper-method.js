/**
 * Facebook video download via custom cheerio scraper
 * Fallback #2 - parses page HTML to extract video URLs
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = join(__dirname, '../../../downloads');

/**
 * Download Facebook video using custom scraper
 * @param {string} url - Facebook video URL
 * @param {Object} options - Download options
 * @returns {Object} Download result
 */
export async function downloadViaScraper(url, options = {}) {
  const outputDir = options.outputDir || DEFAULT_OUTPUT;

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Fetch page HTML
  const html = await fetchPage(url);

  // Extract video URL from page
  const videoData = extractVideoUrl(html);

  if (!videoData.url) {
    throw new Error('Could not find video URL in page source');
  }

  const title = sanitizeFilename(videoData.title || 'facebook_video');
  const filepath = join(outputDir, `${title}.mp4`);

  // Download video
  await downloadFile(videoData.url, filepath, options.progress);

  return {
    title: videoData.title || 'Facebook Video',
    filepath,
    quality: videoData.quality || 'unknown',
    duration: null,
    thumbnail: null
  };
}

/**
 * Fetch page HTML with browser-like headers
 */
async function fetchPage(url) {
  const response = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    }
  });
  return response.data;
}

/**
 * Extract video URL from page HTML
 */
function extractVideoUrl(html) {
  const $ = cheerio.load(html);
  let videoUrl = null;
  let title = null;
  let quality = 'SD';

  // Method 1: og:video meta tag
  const ogVideo = $('meta[property="og:video"]').attr('content');
  if (ogVideo && ogVideo.includes('.mp4')) {
    videoUrl = ogVideo;
  }

  // Method 2: og:video:url meta tag
  if (!videoUrl) {
    const ogVideoUrl = $('meta[property="og:video:url"]').attr('content');
    if (ogVideoUrl && ogVideoUrl.includes('.mp4')) {
      videoUrl = ogVideoUrl;
    }
  }

  // Method 3: Search for video URL in script tags
  if (!videoUrl) {
    const htmlStr = html.toString();

    // Look for HD URL first
    const hdPatterns = [
      /"hd_src":"([^"]+)"/,
      /"hd_src_no_ratelimit":"([^"]+)"/,
      /hd_src\\?":\\?"([^"\\]+)/,
    ];

    for (const pattern of hdPatterns) {
      const match = htmlStr.match(pattern);
      if (match) {
        videoUrl = cleanUrl(match[1]);
        quality = 'HD';
        break;
      }
    }

    // Look for SD URL if no HD found
    if (!videoUrl) {
      const sdPatterns = [
        /"sd_src":"([^"]+)"/,
        /"sd_src_no_ratelimit":"([^"]+)"/,
        /sd_src\\?":\\?"([^"\\]+)/,
      ];

      for (const pattern of sdPatterns) {
        const match = htmlStr.match(pattern);
        if (match) {
          videoUrl = cleanUrl(match[1]);
          quality = 'SD';
          break;
        }
      }
    }

    // Alternative patterns
    if (!videoUrl) {
      const altPatterns = [
        /playable_url":"([^"]+)"/,
        /playable_url_quality_hd":"([^"]+)"/,
        /"browser_native_hd_url":"([^"]+)"/,
        /"browser_native_sd_url":"([^"]+)"/,
      ];

      for (const pattern of altPatterns) {
        const match = htmlStr.match(pattern);
        if (match) {
          videoUrl = cleanUrl(match[1]);
          break;
        }
      }
    }
  }

  // Get title from meta tags
  title = $('meta[property="og:title"]').attr('content') ||
          $('meta[name="title"]').attr('content') ||
          $('title').text() ||
          'Facebook Video';

  // Clean up title
  title = title.replace(/\| Facebook$/, '').trim();

  return { url: videoUrl, title, quality };
}

/**
 * Clean and unescape URL
 */
function cleanUrl(url) {
  if (!url) return null;

  return url
    .replace(/\\u0025/g, '%')
    .replace(/\\u003C/g, '<')
    .replace(/\\u003E/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/&amp;/g, '&');
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
