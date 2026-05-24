/**
 * FFmpeg MP4-to-MP3 post-processing for fallback download methods.
 */

import { spawn } from 'child_process';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, extname, join } from 'path';

const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const THUMBNAIL_TIMEOUT_MS = 10000;

/**
 * Convert a downloaded video file to MP3 with optional metadata and cover art.
 *
 * @param {string} videoPath - Existing input video path
 * @param {Object} meta - Metadata: { title, artist, thumbnailPath }
 * @param {Object} opts - Options: { deleteSource }
 * @returns {Promise<string>} Output MP3 path
 */
export async function videoToMp3(videoPath, meta = {}, opts = {}) {
  if (!existsSync(videoPath)) {
    throw new Error(`videoToMp3 input not found: ${videoPath}`);
  }

  const outputPath = join(dirname(videoPath), `${basename(videoPath, extname(videoPath))}.mp3`);
  const tempThumbnailPath = await resolveThumbnailPath(meta);
  const thumbnailPath = meta.thumbnailPath || tempThumbnailPath;
  const args = ['-y', '-i', videoPath];

  if (thumbnailPath && existsSync(thumbnailPath)) {
    args.push(
      '-i',
      thumbnailPath,
      '-map',
      '0:a',
      '-map',
      '1:v',
      '-c:v',
      'mjpeg',
      '-disposition:v',
      'attached_pic'
    );
  } else {
    args.push('-vn');
  }

  args.push('-c:a', 'libmp3lame', '-q:a', '5', '-id3v2_version', '3');

  if (meta.title) {
    args.push('-metadata', `title=${meta.title}`);
  }
  if (meta.artist) {
    args.push('-metadata', `artist=${meta.artist}`);
  }

  args.push(outputPath);

  try {
    await runFfmpeg(args);
  } catch (error) {
    cleanupFile(outputPath);
    if (opts.deleteSource) {
      cleanupFile(videoPath);
    }
    throw error;
  } finally {
    cleanupFile(tempThumbnailPath);
    cleanupTempDir(tempThumbnailPath);
  }

  if (opts.deleteSource) {
    cleanupFile(videoPath);
  }

  return outputPath;
}

async function resolveThumbnailPath(meta) {
  if (!meta.thumbnailUrl) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), THUMBNAIL_TIMEOUT_MS);

  try {
    const response = await fetch(meta.thumbnailUrl, { signal: controller.signal });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (!contentType.startsWith('image/') || contentLength > MAX_THUMBNAIL_BYTES) {
      return null;
    }

    const ext = contentType.includes('png') ? '.png' : '.jpg';
    const tempDir = mkdtempSync(join(tmpdir(), 'toolvideo-cover-'));
    const thumbnailPath = join(tempDir, `cover${ext}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_THUMBNAIL_BYTES) {
      cleanupTempDir(thumbnailPath);
      return null;
    }

    writeFileSync(thumbnailPath, buffer);
    return thumbnailPath;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function cleanupFile(filepath) {
  if (!filepath) return;
  try {
    unlinkSync(filepath);
  } catch {
    // Best-effort cleanup only.
  }
}

function cleanupTempDir(filepath) {
  if (!filepath) return;
  try {
    rmSync(dirname(filepath), { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const tail = stderr.trim().split('\n').slice(-3).join(' ');
        reject(new Error(`ffmpeg failed: ${tail || 'Unknown error'}`));
        return;
      }
      resolve();
    });

    proc.on('error', (error) => {
      reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
    });
  });
}
