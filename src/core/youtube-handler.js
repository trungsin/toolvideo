/**
 * YouTube video downloader using yt-dlp
 * Handles video download, metadata extraction, and progress reporting
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = join(__dirname, '../../downloads');

/**
 * Download YouTube video using yt-dlp
 * @param {string} url - YouTube video URL
 * @param {Object} options - Download options
 * @param {string} options.outputDir - Output directory
 * @param {Object} options.progress - Progress tracker instance
 * @returns {Object} Download result with title, filepath, quality, etc.
 */
export async function downloadYouTube(url, options = {}) {
  const outputDir = options.outputDir || DEFAULT_OUTPUT;

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // First, get video info
  const info = await getVideoInfo(url);

  // Download video
  const filepath = await runYtdlp(url, outputDir, options.progress);

  return {
    title: info.title,
    filepath,
    quality: info.quality,
    filesize: info.filesize,
    duration: info.duration,
    thumbnail: info.thumbnail
  };
}

/**
 * Get video metadata without downloading
 * @param {string} url - YouTube video URL
 * @returns {Object} Video metadata
 */
export async function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-download',
      url
    ];

    const proc = spawn('yt-dlp', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp info failed: ${stderr.trim() || 'Unknown error'}`));
        return;
      }

      try {
        const info = JSON.parse(stdout);
        resolve({
          title: info.title,
          quality: info.format_note || (info.height ? `${info.height}p` : 'best'),
          filesize: info.filesize || info.filesize_approx || null,
          duration: info.duration || null,
          thumbnail: info.thumbnail || null,
          uploader: info.uploader || null,
          viewCount: info.view_count || null,
          uploadDate: info.upload_date || null
        });
      } catch (e) {
        reject(new Error('Failed to parse video info'));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}. Is yt-dlp installed?`));
    });
  });
}

/**
 * Run yt-dlp download process
 * @param {string} url - Video URL
 * @param {string} outputDir - Output directory
 * @param {Object} progress - Progress tracker
 * @returns {string} Downloaded file path
 */
async function runYtdlp(url, outputDir, progress) {
  return new Promise((resolve, reject) => {
    const outputTemplate = join(outputDir, '%(title)s.%(ext)s');

    const args = [
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '-o', outputTemplate,
      '--no-playlist',
      '--newline',  // Better progress parsing
      url
    ];

    const proc = spawn('yt-dlp', args);
    let filepath = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');

      for (const line of lines) {
        // Parse progress
        if (progress && line.includes('[download]')) {
          const parsed = parseProgress(line);
          if (parsed) {
            progress.emit(parsed);
          }
        }

        // Capture output filename from merger
        const mergerMatch = line.match(/\[Merger\] Merging formats into "(.+)"/);
        if (mergerMatch) {
          filepath = mergerMatch[1];
        }

        // Capture from ExtractAudio or direct download
        const destMatch = line.match(/Destination: (.+)/);
        if (destMatch && !filepath) {
          filepath = destMatch[1];
        }

        // Capture from "has already been downloaded"
        const alreadyMatch = line.match(/\[download\] (.+) has already been downloaded/);
        if (alreadyMatch) {
          filepath = alreadyMatch[1];
        }

        // Capture from download complete message
        const completeMatch = line.match(/\[download\] (.+\.mp4) has already been downloaded/);
        if (completeMatch) {
          filepath = completeMatch[1];
        }
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp download failed: ${stderr.trim() || 'Unknown error'}`));
        return;
      }

      if (!filepath) {
        reject(new Error('Could not determine output filepath'));
        return;
      }

      // Emit 100% on completion
      if (progress) {
        progress.emit({ percent: 100, status: 'complete' });
      }

      resolve(filepath);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
    });
  });
}

/**
 * Parse yt-dlp progress output line
 * @param {string} line - Output line
 * @returns {Object|null} Parsed progress or null
 */
function parseProgress(line) {
  // Standard: [download]  45.2% of 125.36MiB at 2.50MiB/s ETA 00:25
  const match = line.match(
    /\[download\]\s+(\d+\.?\d*)%\s+of\s+~?(\S+)\s+at\s+(\S+)\s+ETA\s+(\S+)/
  );

  if (match) {
    return {
      percent: parseFloat(match[1]),
      total: match[2],
      speed: match[3],
      eta: match[4]
    };
  }

  // Already downloaded
  if (line.includes('has already been downloaded')) {
    return { percent: 100, status: 'already_downloaded' };
  }

  // 100% completion
  if (line.includes('100%')) {
    const percentMatch = line.match(/(\d+\.?\d*)%/);
    if (percentMatch) {
      return { percent: parseFloat(percentMatch[1]) };
    }
  }

  return null;
}
