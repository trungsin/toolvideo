/**
 * TikTok download via yt-dlp
 * Primary method - supports video (no-WM/WM), audio-only, photo carousel
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { AUDIO_QUALITY, buildAudioArgs } from '../audio-args.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = join(__dirname, '../../../downloads');

/**
 * Download TikTok content via yt-dlp
 * @param {string} url - TikTok URL
 * @param {Object} options - { outputDir, progress, contentType, watermark, audioOnly }
 * @returns {Promise<Object>} Download result
 */
export async function downloadViaYtdlp(url, options = {}) {
  const outputDir = options.outputDir || DEFAULT_OUTPUT;
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const info = await getInfo(url);
  const isPhoto = options.contentType === 'photo';

  // For photos, output to a dedicated subfolder for image collection
  const targetDir = isPhoto
    ? join(outputDir, sanitizeFolderName(info.title || `tiktok-${Date.now()}`))
    : outputDir;
  if (isPhoto && !existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  const beforeFiles = isPhoto ? new Set(readdirSync(targetDir)) : null;
  const filepath = await runDownload(url, targetDir, options);

  if (options.audioOnly) return audioResult(info, filepath);

  if (isPhoto) {
    // Collect new files: images + audio
    const afterFiles = readdirSync(targetDir);
    const newFiles = afterFiles.filter(f => !beforeFiles.has(f));
    const images = newFiles
      .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
      .map(f => join(targetDir, f))
      .sort();
    const audio = newFiles.find(f => /\.(mp3|m4a|wav|opus|aac)$/i.test(f));

    return {
      title: info.title,
      filepath: targetDir,
      quality: 'carousel',
      duration: info.duration,
      thumbnail: info.thumbnail,
      contentType: 'photo',
      rawFiles: {
        images,
        audio: audio ? join(targetDir, audio) : null
      }
    };
  }

  return {
    title: info.title,
    filepath,
    quality: options.audioOnly ? AUDIO_QUALITY : (info.quality || 'best'),
    duration: info.duration,
    thumbnail: info.thumbnail,
    contentType: 'video'
  };
}

/**
 * Fetch metadata via yt-dlp --dump-json
 */
async function getInfo(url) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', ['--dump-json', '--no-download', url]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'yt-dlp info failed'));
        return;
      }
      try {
        const info = JSON.parse(stdout);
        resolve({
          title: info.title || info.description?.slice(0, 50) || 'TikTok',
          quality: info.format_note || (info.height ? `${info.height}p` : 'best'),
          duration: info.duration || null,
          thumbnail: info.thumbnail || null
        });
      } catch {
        reject(new Error('Failed to parse video info'));
      }
    });

    proc.on('error', err => reject(new Error(`Failed to spawn yt-dlp: ${err.message}`)));
  });
}

/**
 * Run yt-dlp download with progress parsing
 */
async function runDownload(url, outputDir, options) {
  return new Promise((resolve, reject) => {
    const progress = options.progress;
    const args = buildArgs(url, outputDir, options);
    const proc = spawn('yt-dlp', args);
    let filepath = '';
    let stderr = '';

    proc.stdout.on('data', data => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (progress) {
          const m = line.match(/\[download\]\s+(\d+\.?\d*)%/);
          if (m) progress.emit({ percent: parseFloat(m[1]) });
        }
        const merge = line.match(/\[Merger\] Merging formats into "(.+)"/);
        if (merge) filepath = merge[1];
        const dest = line.match(/Destination: (.+)/);
        if (dest && !filepath) filepath = dest[1];
        const already = line.match(/\[download\] (.+) has already been downloaded/);
        if (already) filepath = already[1];
        const extract = line.match(/\[ExtractAudio\] Destination: (.+)/);
        if (extract) filepath = extract[1];
      }
    });

    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'yt-dlp download failed'));
        return;
      }
      if (!filepath && (options.contentType !== 'photo' || options.audioOnly)) {
        reject(new Error('Could not determine output file'));
        return;
      }
      if (progress) progress.emit({ percent: 100, status: 'complete' });
      resolve(filepath);
    });

    proc.on('error', err => reject(new Error(`Failed to spawn yt-dlp: ${err.message}`)));
  });
}

/**
 * Build yt-dlp args based on options
 */
function buildArgs(url, outputDir, options) {
  const args = ['--no-playlist', '--newline'];

  if (options.audioOnly) {
    // Extract audio as MP3
    args.push(...buildAudioArgs());
    args.push('-o', join(outputDir, '%(title)s.%(ext)s'));
  } else if (options.contentType === 'photo') {
    // Photo carousel: download all images + audio.
    // Prefix with autonumber so multiple images don't overwrite each other.
    args.push('-o', join(outputDir, '%(autonumber)02d-%(title)s.%(ext)s'));
  } else {
    // Video: prefer H.264 mp4. TikTok extractor returns no-WM by default.
    // For watermark version, use extractor-args.
    if (options.watermark) {
      args.push('--extractor-args', 'tiktok:download_addr=1');
    }
    // Force H.264 (avc1) for universal playback compatibility, same as Facebook handler
    args.push(
      '-f',
      'bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[vcodec^=avc1]/best[ext=mp4]/best'
    );
    args.push('--merge-output-format', 'mp4');
    args.push('-o', join(outputDir, '%(title)s.%(ext)s'));
  }

  args.push(url);
  return args;
}

function audioResult(info, filepath) {
  return { title: info.title, filepath, quality: AUDIO_QUALITY, duration: info.duration, thumbnail: info.thumbnail, contentType: 'audio' };
}

/** Sanitize string for safe folder name */
function sanitizeFolderName(name) {
  return name
    .replace(/[^\w\sÀ-ỹ-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50) || `tiktok-${Date.now()}`;
}
