/**
 * Fetch wrapper for toolvideo (saveclip) REST API.
 * Adds X-API-Key header and timeout. Throws on non-2xx.
 */

const DEFAULT_BASE = 'https://saveclip.datxanhmientrung.ai';
const DEFAULT_TIMEOUT = 15000;

export function getBaseUrl() {
  return process.env.SAVECLIP_API_URL || DEFAULT_BASE;
}

function getApiKey() {
  const key = process.env.SAVECLIP_API_KEY;
  if (!key) {
    throw new Error('SAVECLIP_API_KEY env var is required');
  }
  return key;
}

async function request(method, path, body, timeoutMs = DEFAULT_TIMEOUT) {
  const url = `${getBaseUrl()}${path}`;
  const headers = { 'X-API-Key': getApiKey() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs)
  });

  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${json.error || text.slice(0, 200)}`);
  }
  return json;
}

export const apiGet = (path, timeoutMs) => request('GET', path, undefined, timeoutMs);
export const apiPost = (path, body, timeoutMs) => request('POST', path, body, timeoutMs);

/**
 * Build absolute download URL for a completed video.
 */
export function fileUrl(id) {
  return `${getBaseUrl()}/api/file/${id}`;
}

/**
 * Build absolute karaoke file URL.
 * @param {string} id - karaoke job id
 * @param {'video'|'lrc'|'ass'} type
 */
export function karaokeFileUrl(id, type) {
  return `${getBaseUrl()}/api/karaoke/file/${id}/${type}`;
}
