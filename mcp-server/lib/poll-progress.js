/**
 * Poll /api/progress/:id until complete, error, or timeout.
 */

import { apiGet } from './api-client.js';

const DEFAULT_TIMEOUT = 120000;
const DEFAULT_INTERVAL = 2000;

/**
 * Poll a download/karaoke job to completion.
 * @param {string} id - job id from /api/download or /api/karaoke response
 * @param {Object} options
 * @param {number} [options.timeoutMs=120000]
 * @param {number} [options.intervalMs=2000]
 * @returns {Promise<Object>} the `result` field from the final progress payload
 */
export async function pollUntilComplete(id, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const progress = await apiGet(`/api/progress/${id}`);
    if (progress.status === 'complete' && progress.result) {
      return progress.result;
    }
    if (progress.status === 'error') {
      throw new Error(progress.error || 'Job failed without a message');
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timeout (${timeoutMs}ms) waiting for job ${id}`);
}
