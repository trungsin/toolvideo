/**
 * Fetch lyrics from multiple sources
 * Primary: lyrics.ovh (free, no token)
 * Fallback: Genius API (requires token)
 * Last resort: lrclib.net (synced lyrics)
 */

import axios from 'axios';
import { load } from 'cheerio';

const LYRICS_OVH_API = 'https://api.lyrics.ovh/v1';
const LRCLIB_API = 'https://lrclib.net/api';
const GENIUS_API = 'https://api.genius.com';

/**
 * Fetch lyrics from multiple sources
 * @param {string} query - Song title or "artist - title"
 * @param {Object} options - Options
 * @returns {Promise<Object>} Lyrics data
 */
export async function fetchLyrics(query, options = {}) {
  // Parse artist and title from query
  const parsed = parseArtistTitle(cleanVideoTitle(query));

  // Try sources in order
  const errors = [];

  // 1. Try lyrics.ovh (free, no token)
  if (parsed.artist && parsed.title) {
    try {
      const result = await fetchFromLyricsOvh(parsed.artist, parsed.title);
      if (result.found) return result;
    } catch (e) {
      errors.push(`lyrics.ovh: ${e.message}`);
    }
  }

  // 2. Try lrclib.net (has synced lyrics)
  try {
    const result = await fetchFromLrclib(parsed.title, parsed.artist);
    if (result.found) return result;
  } catch (e) {
    errors.push(`lrclib: ${e.message}`);
  }

  // 3. Try Genius (requires token)
  const geniusToken = options.accessToken || process.env.GENIUS_ACCESS_TOKEN;
  if (geniusToken) {
    try {
      const result = await fetchFromGenius(query, geniusToken);
      if (result.found) return result;
    } catch (e) {
      errors.push(`genius: ${e.message}`);
    }
  }

  return {
    found: false,
    query: parsed.title,
    artist: parsed.artist,
    errors
  };
}

/**
 * Fetch from lyrics.ovh (free API)
 */
async function fetchFromLyricsOvh(artist, title) {
  const url = `${LYRICS_OVH_API}/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;

  const response = await axios.get(url, { timeout: 10000 });

  if (response.data?.lyrics) {
    return {
      found: true,
      source: 'lyrics.ovh',
      title,
      artist,
      lyrics: response.data.lyrics.trim(),
      synced: false
    };
  }

  return { found: false };
}

/**
 * Fetch from lrclib.net (synced lyrics)
 * Tries multiple search strategies for best results
 */
async function fetchFromLrclib(title, artist) {
  const strategies = [];

  // Strategy 1: title + artist
  if (title && artist) {
    strategies.push({ track_name: title, artist_name: artist });
    // Strategy 2: swapped (YouTube often has "Title | Artist" format)
    strategies.push({ track_name: artist, artist_name: title });
  }

  // Strategy 3: full-text search with combined query
  if (title) {
    const query = artist ? `${title} ${artist}` : title;
    strategies.push({ q: query });
  }

  for (const params of strategies) {
    try {
      const response = await axios.get(`${LRCLIB_API}/search`, {
        params,
        timeout: 10000
      });

      const results = response.data || [];
      if (results.length > 0) {
        // Get first result with synced lyrics (preferred) or plain lyrics
        const song = results.find(r => r.syncedLyrics) ||
                     results.find(r => r.plainLyrics) ||
                     results[0];

        if (song.plainLyrics || song.syncedLyrics) {
          return {
            found: true,
            source: 'lrclib',
            title: song.trackName || title,
            artist: song.artistName || artist,
            lyrics: song.plainLyrics || '',
            syncedLyrics: song.syncedLyrics || null,
            synced: !!song.syncedLyrics
          };
        }
      }
    } catch {
      // Try next strategy
      continue;
    }
  }

  return { found: false };
}

/**
 * Fetch from Genius API
 */
async function fetchFromGenius(query, accessToken) {
  // Search
  const searchResponse = await axios.get(`${GENIUS_API}/search`, {
    params: { q: cleanVideoTitle(query) },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10000
  });

  const hits = searchResponse.data?.response?.hits || [];
  if (hits.length === 0) {
    return { found: false };
  }

  const song = hits[0].result;

  // Scrape lyrics from page
  const pageResponse = await axios.get(song.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    },
    timeout: 15000
  });

  const $ = load(pageResponse.data);
  let lyrics = '';

  $('[data-lyrics-container="true"]').each((_, elem) => {
    $(elem).find('br').replaceWith('\n');
    lyrics += $(elem).text() + '\n';
  });

  lyrics = lyrics
    .replace(/\[.*?\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!lyrics) {
    return { found: false };
  }

  return {
    found: true,
    source: 'genius',
    title: song.title,
    artist: song.primary_artist?.name || 'Unknown',
    url: song.url,
    lyrics,
    synced: false
  };
}

/**
 * Clean video title for better search
 */
function cleanVideoTitle(title) {
  return title
    // Normalize fullwidth characters (｜ → |)
    .replace(/[｜│]/g, '|')
    // Remove common YouTube title patterns
    .replace(/\s*\|\s*official\s*(music\s*)?video\s*/gi, ' ')
    .replace(/\s*\|\s*mv\s*/gi, ' ')
    .replace(/\s*\|\s*lyric\s*video\s*/gi, ' ')
    .replace(/\s*\(Official\s*(Video|Music Video|Audio|Lyric Video|MV)\)\s*/gi, '')
    .replace(/\s*\[Official\s*(Video|Music Video|Audio|Lyric Video|MV)\]\s*/gi, '')
    .replace(/\s*Official\s*(Video|Music Video|Audio)\s*/gi, '')
    .replace(/\s*\(?(HD|HQ|4K|1080p|720p)\)?\s*/gi, '')
    .replace(/\s*M[-\s]?V\s*$/gi, '')
    .replace(/\s*\(?\s*ft\.?\s*/gi, ' feat. ')
    .replace(/\s*\(?\s*feat\.?\s*/gi, ' feat. ')
    // Clean up separators and whitespace
    .replace(/\s*[|]\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse "Artist - Title" format
 */
export function parseArtistTitle(text) {
  // Try "Artist - Title" format
  const match = text.match(/^(.+?)\s*[-–—]\s*(.+)$/);

  if (match) {
    return {
      artist: match[1].trim(),
      title: match[2].trim()
    };
  }

  return {
    artist: null,
    title: text.trim()
  };
}

/**
 * Check if any lyrics source is available
 */
export function isLyricsAvailable() {
  return true; // lyrics.ovh and lrclib don't need tokens
}
