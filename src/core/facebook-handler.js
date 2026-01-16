/**
 * Facebook video downloader with multi-fallback strategy
 * Tries multiple methods in sequence until one succeeds
 *
 * Methods (in order):
 * 1. yt-dlp - most reliable when working
 * 2. fb-downloader-scrapper npm - third-party library
 * 3. Custom cheerio scraper - direct HTML parsing
 */

import { downloadViaYtdlp } from './facebook/yt-dlp-method.js';
import { downloadViaNpmLib } from './facebook/npm-lib-method.js';
import { downloadViaScraper } from './facebook/scraper-method.js';

// Download methods in priority order
const METHODS = [
  { name: 'yt-dlp', fn: downloadViaYtdlp },
  { name: 'npm-lib', fn: downloadViaNpmLib },
  { name: 'scraper', fn: downloadViaScraper }
];

/**
 * Download Facebook video with multi-fallback strategy
 * @param {string} url - Facebook video URL
 * @param {Object} options - Download options
 * @param {string} options.outputDir - Output directory
 * @param {Object} options.progress - Progress tracker
 * @returns {Object} Download result with method used
 */
export async function downloadFacebook(url, options = {}) {
  const errors = [];

  for (const method of METHODS) {
    try {
      console.log(`[FB] Trying ${method.name}...`);
      const result = await method.fn(url, options);
      console.log(`[FB] Success via ${method.name}`);
      return { ...result, method: method.name };
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      console.log(`[FB] ${method.name} failed: ${errorMsg}`);
      errors.push({ method: method.name, error: errorMsg });
    }
  }

  // All methods failed - provide detailed error
  const errorSummary = errors.map(e => `${e.method}: ${e.error}`).join('; ');
  throw new Error(`All download methods failed. ${errorSummary}`);
}

/**
 * Try to get video info without downloading
 * Only yt-dlp supports this reliably
 * @param {string} url - Facebook video URL
 * @returns {Object|null} Video info or null
 */
export async function getFacebookInfo(url) {
  try {
    const { spawn } = await import('child_process');

    return new Promise((resolve, reject) => {
      const proc = spawn('yt-dlp', ['--dump-json', '--no-download', url]);
      let stdout = '';

      proc.stdout.on('data', d => stdout += d);
      proc.on('close', code => {
        if (code !== 0) {
          resolve(null);
          return;
        }
        try {
          const info = JSON.parse(stdout);
          resolve({
            title: info.title,
            duration: info.duration,
            thumbnail: info.thumbnail
          });
        } catch {
          resolve(null);
        }
      });
    });
  } catch {
    return null;
  }
}
