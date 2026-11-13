/**
 * URL detector for identifying video platforms
 * Supports YouTube, Facebook, TikTok, and X (Twitter) video URLs
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

// TikTok video URL patterns - captures video ID in group 1
const TIKTOK_VIDEO_PATTERNS = [
  /tiktok\.com\/@[^/]+\/video\/(\d+)/,
  /m\.tiktok\.com\/v\/(\d+)/,
  /tiktok\.com\/embed\/(\d+)/,
];

// TikTok photo carousel patterns - captures post ID in group 1
const TIKTOK_PHOTO_PATTERNS = [
  /tiktok\.com\/@[^/]+\/photo\/(\d+)/,
];

// TikTok short URL patterns - need redirect resolve before parsing
const TIKTOK_SHORT_PATTERNS = [
  /(?:vm|vt)\.tiktok\.com\/[\w]+/i,
];

// X (Twitter) post URL patterns - captures post ID in group 1.
// Host anchored on `//` or `.` so e.g. netflix.com never matches.
// Optional /video/N suffix is kept in the URL; yt-dlp uses it to pick the Nth video.
const X_PATTERNS = [
  /(?:\/\/|\.)(?:x|twitter)\.com\/(?:i\/web|[^/?#]+)\/status(?:es)?\/(\d+)/i,
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

  // Check TikTok video patterns
  for (const pattern of TIKTOK_VIDEO_PATTERNS) {
    if (pattern.test(url)) {
      const match = url.match(pattern);
      return {
        platform: 'tiktok',
        videoId: match?.[1] || null,
        contentType: 'video',
        originalUrl: url
      };
    }
  }

  // Check TikTok photo carousel patterns
  for (const pattern of TIKTOK_PHOTO_PATTERNS) {
    if (pattern.test(url)) {
      const match = url.match(pattern);
      return {
        platform: 'tiktok',
        videoId: match?.[1] || null,
        contentType: 'photo',
        originalUrl: url
      };
    }
  }

  // Check TikTok short URLs (need resolveShortUrl before content detection)
  for (const pattern of TIKTOK_SHORT_PATTERNS) {
    if (pattern.test(url)) {
      return {
        platform: 'tiktok',
        videoId: null,
        contentType: 'unknown',
        isShortUrl: true,
        originalUrl: url
      };
    }
  }

  // Check X (Twitter) post patterns
  for (const pattern of X_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      return {
        platform: 'x',
        videoId: match[1],
        originalUrl: url
      };
    }
  }

  // Any tiktok.com host that didn't match a specific pattern → treat as TikTok
  // with unknown content type. yt-dlp can still handle many edge URL shapes.
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('tiktok.com')) {
      return {
        platform: 'tiktok',
        videoId: null,
        contentType: 'unknown',
        originalUrl: url
      };
    }
  } catch {
    // Fall through to unknown
  }

  return {
    platform: 'unknown',
    videoId: null,
    originalUrl: url
  };
}

/**
 * Resolve TikTok short URL (vm.tiktok.com / vt.tiktok.com) to full URL
 * Follows redirects manually (max 3 hops) with whitelisted domain
 * @param {string} url - Short URL
 * @returns {Promise<string>} Resolved full URL
 */
export async function resolveShortUrl(url) {
  if (!isValidUrl(url)) {
    throw new Error('Invalid URL');
  }

  let current = url;
  let resolved = false;
  for (let i = 0; i < 3; i++) {
    const parsed = new URL(current);
    // Defense-in-depth: only allow http/https schemes
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Disallowed protocol in redirect: ${parsed.protocol}`);
    }
    // Whitelist tiktok.com domains only for security
    if (!parsed.hostname.endsWith('tiktok.com')) {
      throw new Error(`Unexpected redirect host: ${parsed.hostname}`);
    }

    const next = await fetchRedirect(current);
    if (next) {
      current = new URL(next, current).toString();
      resolved = true;
      continue;
    }
    // No redirect — current is final
    return current;
  }

  if (!resolved) {
    throw new Error('Failed to resolve short URL: no redirect received');
  }
  return current;
}

/**
 * Single redirect fetch — tries HEAD then GET, returns Location header or null when final
 */
async function fetchRedirect(url) {
  const tryFetch = async (method) => {
    return fetch(url, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
  };

  let response;
  try {
    response = await tryFetch('HEAD');
  } catch {
    response = await tryFetch('GET');
  }

  if (response.status >= 300 && response.status < 400) {
    return response.headers.get('location');
  }
  return null;
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
 * Check if URL is supported (YouTube, Facebook, TikTok, or X)
 * @param {string} url - URL to check
 * @returns {boolean} True if supported platform
 */
export function isSupportedUrl(url) {
  const { platform } = detectPlatform(url);
  return platform !== 'unknown';
}
