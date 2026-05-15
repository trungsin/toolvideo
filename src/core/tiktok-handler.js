/**
 * TikTok video downloader with multi-fallback strategy
 * Tries yt-dlp first, falls back to tikwm.com API
 *
 * Supports:
 *  - Video (no-watermark / watermark)
 *  - Audio-only (MP3)
 *  - Photo carousel (raw images + audio, rendered to slideshow MP4)
 */

import { downloadViaYtdlp } from './tiktok/yt-dlp-method.js';
import { downloadViaTikwm } from './tiktok/tikwm-method.js';

// Methods in priority order: yt-dlp primary, tikwm fallback
const METHODS = [
  { name: 'yt-dlp', fn: downloadViaYtdlp },
  { name: 'tikwm', fn: downloadViaTikwm }
];

/**
 * Download TikTok content with multi-fallback strategy
 * @param {string} url - TikTok URL (video, photo, or short)
 * @param {Object} options - Download options
 * @param {string} [options.outputDir] - Output directory
 * @param {Object} [options.progress] - Progress tracker
 * @param {string} [options.contentType] - 'video' | 'photo' (auto-detected)
 * @param {boolean} [options.watermark] - Include watermark (default false)
 * @param {boolean} [options.audioOnly] - Audio-only MP3 (default false)
 * @returns {Object} Download result with method used
 */
export async function downloadTikTok(url, options = {}) {
  const errors = [];

  for (const method of METHODS) {
    try {
      console.log(`[TikTok] Trying ${method.name}...`);
      let result = await method.fn(url, options);

      // Render photo carousel into slideshow MP4 — counts as part of method success
      if (result.contentType === 'photo' && result.rawFiles) {
        const { renderCarousel } = await import('./tiktok/carousel-renderer.js');
        const rendered = await renderCarousel(result.rawFiles, {
          outputDir: options.outputDir,
          title: result.title,
          progress: options.progress
        });
        result = { ...result, filepath: rendered.filepath, quality: rendered.quality };
      }

      console.log(`[TikTok] Success via ${method.name}`);
      return { ...result, method: method.name };
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      console.log(`[TikTok] ${method.name} failed: ${errorMsg}`);
      errors.push({ method: method.name, error: errorMsg });
    }
  }

  const errorSummary = errors.map(e => `${e.method}: ${e.error}`).join('; ');
  throw new Error(`All TikTok download methods failed. ${errorSummary}`);
}

/**
 * Get TikTok video metadata without downloading
 * Uses yt-dlp dump-json
 * @param {string} url - TikTok URL
 * @returns {Promise<Object|null>} Video info or null on failure
 */
export async function getTikTokInfo(url) {
  try {
    const { spawn } = await import('child_process');

    return new Promise((resolve) => {
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
            title: info.title || info.description || 'TikTok',
            duration: info.duration || null,
            thumbnail: info.thumbnail || null,
            uploader: info.uploader || null
          });
        } catch {
          resolve(null);
        }
      });
      proc.on('error', () => resolve(null));
    });
  } catch {
    return null;
  }
}
