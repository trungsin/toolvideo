/**
 * Progress tracking utility for download operations
 * Supports yt-dlp output parsing and generic progress events
 */

export class ProgressTracker {
  constructor() {
    this.listeners = [];
    this.lastPercent = 0;
  }

  /**
   * Register progress callback
   * @param {Function} callback - Called with progress data
   */
  onProgress(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
    }
  }

  /**
   * Emit progress update to all listeners
   * @param {Object} data - Progress data { percent, downloaded, total, speed, eta }
   */
  emit(data) {
    this.lastPercent = data.percent || this.lastPercent;
    for (const listener of this.listeners) {
      try {
        listener(data);
      } catch (err) {
        // Ignore listener errors to prevent breaking download
      }
    }
  }

  /**
   * Parse yt-dlp progress output line
   * Example: [download]  45.2% of 125.36MiB at 2.50MiB/s ETA 00:25
   * @param {string} line - Output line from yt-dlp
   * @returns {Object|null} Parsed progress data or null
   */
  parseYtdlpProgress(line) {
    if (!line || typeof line !== 'string') {
      return null;
    }

    // Standard progress pattern
    // [download]  45.2% of 125.36MiB at 2.50MiB/s ETA 00:25
    const progressMatch = line.match(
      /\[download\]\s+(\d+\.?\d*)%\s+of\s+~?(\S+)\s+at\s+(\S+)\s+ETA\s+(\S+)/
    );

    if (progressMatch) {
      return {
        percent: parseFloat(progressMatch[1]),
        total: progressMatch[2],
        speed: progressMatch[3],
        eta: progressMatch[4]
      };
    }

    // Already downloaded pattern
    if (line.includes('has already been downloaded')) {
      return {
        percent: 100,
        status: 'already_downloaded'
      };
    }

    // Download complete pattern
    if (line.includes('100%')) {
      const match = line.match(/(\d+\.?\d*)%/);
      if (match) {
        return {
          percent: parseFloat(match[1])
        };
      }
    }

    // Merging formats pattern
    if (line.includes('[Merger]') || line.includes('Merging formats')) {
      return {
        percent: this.lastPercent,
        status: 'merging'
      };
    }

    return null;
  }

  /**
   * Reset progress state
   */
  reset() {
    this.lastPercent = 0;
  }
}

/**
 * Format bytes to human readable string
 * @param {number} bytes - Bytes to format
 * @returns {string} Formatted string (e.g., "125.36 MB")
 */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Format duration seconds to readable string
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted string (e.g., "1:23:45")
 */
export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}
