/**
 * Main download orchestrator
 * Routes downloads to appropriate platform handlers
 */

import { detectPlatform, isValidUrl, resolveShortUrl } from './url-detector.js';
import { addDownload, searchByUrl } from '../db/history.js';
import { ProgressTracker } from '../utils/progress.js';

/**
 * Download video from URL
 * @param {string} url - Video URL (YouTube or Facebook)
 * @param {Object} options - Download options
 * @param {string} options.outputDir - Output directory
 * @param {boolean} options.force - Force re-download if exists
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
    throw new Error('Unsupported platform. Supported: YouTube, Facebook, TikTok.');
  }

  // Check if already downloaded (optional skip)
  if (!options.force) {
    const existing = searchByUrl(url);
    if (existing && existing.filepath) {
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

  if (platform === 'youtube') {
    const { downloadYouTube } = await import('./youtube-handler.js');
    result = await downloadYouTube(url, { progress, outputDir: options.outputDir });
  } else if (platform === 'facebook') {
    const { downloadFacebook } = await import('./facebook-handler.js');
    result = await downloadFacebook(url, { progress, outputDir: options.outputDir });
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

  if (platform === 'youtube') {
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
