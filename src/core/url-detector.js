/**
 * URL detector for identifying video platforms
 * Supports YouTube and Facebook video URLs
 */

// YouTube URL patterns - captures video ID in group 1
const YOUTUBE_PATTERNS = [
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
];

// Facebook URL patterns
const FACEBOOK_PATTERNS = [
  /facebook\.com\/.*\/videos\//,
  /facebook\.com\/watch/,
  /facebook\.com\/reel\//,
  /fb\.watch\//,
  /facebook\.com\/.*\/posts\//,
  /facebook\.com\/share\/v\//,
  /facebook\.com\/video\.php/,
];

/**
 * Detect platform from video URL
 * @param {string} url - Video URL
 * @returns {Object} Platform info with videoId if available
 */
export function detectPlatform(url) {
  if (!url || typeof url !== 'string') {
    return { platform: 'unknown', videoId: null, originalUrl: url };
  }

  // Normalize URL for pattern matching
  const normalized = url.trim().toLowerCase();

  // Check YouTube patterns
  for (const pattern of YOUTUBE_PATTERNS) {
    if (pattern.test(url)) {
      const match = url.match(pattern);
      return {
        platform: 'youtube',
        videoId: match?.[1] || null,
        originalUrl: url
      };
    }
  }

  // Check Facebook patterns
  for (const pattern of FACEBOOK_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        platform: 'facebook',
        videoId: null,
        originalUrl: url
      };
    }
  }

  return {
    platform: 'unknown',
    videoId: null,
    originalUrl: url
  };
}

/**
 * Validate URL format
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL
 */
export function isValidUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if URL is supported (YouTube or Facebook)
 * @param {string} url - URL to check
 * @returns {boolean} True if supported platform
 */
export function isSupportedUrl(url) {
  const { platform } = detectPlatform(url);
  return platform !== 'unknown';
}
