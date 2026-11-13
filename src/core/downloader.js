/**
 * Main download orchestrator
 * Routes downloads to appropriate platform handlers
 */

import { existsSync } from 'fs';
import { detectPlatform, isValidUrl, resolveShortUrl } from './url-detector.js';
import { addDownload, searchByUrl } from '../db/history.js';
import { ProgressTracker } from '../utils/progress.js';

/**
 * Download video from URL
 * @param {string} url - Video URL (YouTube, Facebook, TikTok, or X)
 * @param {Object} options - Download options
 * @param {string} options.outputDir - Output directory
 * @param {boolean} options.force - Force re-download if exists
 * @param {boolean} options.audioOnly - Extract MP3 audio only
 * @param {Function} options.onProgress - Progress callback
 * @returns {Object} Download result with id, title, filepath, etc.
 */
export async function download(url, options = {}) {
  // Validate URL
  if (!isValidUrl(url)) {
    throw new Error('Invalid URL');
  }

  // Detect platform
  let detection = detectPlatform(url);

  // Resolve TikTok short URLs to get content type
  if (detection.platform === 'tiktok' && detection.isShortUrl) {
    const resolved = await resolveShortUrl(url);
    detection = detectPlatform(resolved);
    url = resolved;
  }

  const { platform } = detection;
  if (platform === 'unknown') {
    throw new Error('Unsupported platform. Supported: YouTube, Facebook, TikTok, X.');
  }

  // Check if already downloaded (skip only if file still exists on disk)
  if (!options.force) {
    const existing = searchByUrl(url, !!options.audioOnly);
    if (existing && existing.filepath && existsSync(existing.filepath)) {
      console.log(`Already downloaded: ${existing.filepath}`);
      return existing;
    }
  }

  // Setup progress tracker
  const progress = new ProgressTracker();
  if (options.onProgress) {
    progress.onProgress(options.onProgress);
  }

  // Download based on platform (dynamic import to avoid circular deps)
  let result;

  if (platform === 'youtube' || platform === 'x') {
    // X has no extra fallbacks: yt-dlp's twitter extractor handles it, same path as YouTube
    const { downloadYouTube } = await import('./youtube-handler.js');
    result = await downloadYouTube(url, {
      progress,
      outputDir: options.outputDir,
      audioOnly: options.audioOnly,
    });
  } else if (platform === 'facebook') {
    const { downloadFacebook } = await import('./facebook-handler.js');
    result = await downloadFacebook(url, {
      progress,
      outputDir: options.outputDir,
      audioOnly: options.audioOnly,
    });
  } else if (platform === 'tiktok') {
    const { downloadTikTok } = await import('./tiktok-handler.js');
    result = await downloadTikTok(url, {
      progress,
      outputDir: options.outputDir,
      contentType: detection.contentType,
      watermark: options.watermark,
      audioOnly: options.audioOnly,
    });
  }

  // Save to history
  const id = addDownload({
    url,
    platform,
    title: result.title,
    filepath: result.filepath,
    quality: result.quality,
    filesize: result.filesize,
    duration: result.duration,
    thumbnail: result.thumbnail,
    audioOnly: !!options.audioOnly,
    status: 'completed'
  });

  return { id, ...result };
}

/**
 * Get video info without downloading
 * @param {string} url - Video URL
 * @returns {Object} Video metadata
 */
export async function getInfo(url) {
  if (!isValidUrl(url)) {
    throw new Error('Invalid URL');
  }

  const { platform } = detectPlatform(url);
  if (platform === 'unknown') {
    throw new Error('Unsupported platform');
  }

  if (platform === 'youtube' || platform === 'x') {
    const { getVideoInfo } = await import('./youtube-handler.js');
    return { platform, ...(await getVideoInfo(url)) };
  } else if (platform === 'facebook') {
    // Facebook info requires download attempt, return basic info
    return { platform, url };
  } else if (platform === 'tiktok') {
    const { getTikTokInfo } = await import('./tiktok-handler.js');
    return { platform, ...(await getTikTokInfo(url)) };
  }
}

// Re-export utilities
export { detectPlatform, isValidUrl } from './url-detector.js';
export { ProgressTracker } from '../utils/progress.js';
