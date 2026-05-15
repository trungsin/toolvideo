/**
 * Render TikTok photo carousel into MP4 slideshow
 * Uses FFmpeg concat demuxer + audio overlay
 * Reuses karaoke/audio-extractor.getAudioDuration for DRY
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { writeFileSync, existsSync, mkdirSync, rmSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { getAudioDuration } from '../karaoke/audio-extractor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = join(__dirname, '../../../temp');
const DEFAULT_RESOLUTION = '1080:1920'; // TikTok portrait
const FADE_DURATION = 0.5;
const MIN_DURATION_PER_IMAGE = 2.0;

/**
 * Render images + audio into slideshow MP4
 * @param {Object} rawFiles - { images: string[], audio: string|null }
 * @param {Object} options - { outputDir, title, progress }
 * @returns {Promise<Object>} { filepath, quality }
 */
export async function renderCarousel(rawFiles, options = {}) {
  const { images, audio } = rawFiles;
  if (!images || images.length === 0) {
    throw new Error('No images to render');
  }

  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });

  const outputDir = options.outputDir || dirname(images[0]);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const safeTitle = sanitize(options.title || 'tiktok-carousel');
  const outputPath = join(outputDir, `${safeTitle}.mp4`);

  // Compute per-image duration from audio length
  let totalDuration = images.length * MIN_DURATION_PER_IMAGE;
  if (audio && existsSync(audio)) {
    try {
      const d = await getAudioDuration(audio);
      if (d > 0) totalDuration = d;
    } catch {
      // fall through with default
    }
  }
  const perImage = Math.max(MIN_DURATION_PER_IMAGE, totalDuration / images.length);

  // Build concat list file
  const listPath = join(TEMP_DIR, `carousel-${Date.now()}.txt`);
  const listLines = [];
  for (const img of images) {
    listLines.push(`file '${escapeForConcat(img)}'`);
    listLines.push(`duration ${perImage.toFixed(3)}`);
  }
  // Repeat last image (concat demuxer quirk: last duration ignored)
  listLines.push(`file '${escapeForConcat(images[images.length - 1])}'`);
  writeFileSync(listPath, listLines.join('\n'));

  try {
    await runFFmpeg(listPath, audio, outputPath, options.progress);
  } finally {
    // Cleanup concat list always
    try { unlinkSync(listPath); } catch {}
  }

  // Cleanup raw images + audio after successful render
  for (const img of images) {
    try { unlinkSync(img); } catch {}
  }
  if (audio) {
    try { unlinkSync(audio); } catch {}
  }
  // Remove empty folder if applicable
  try {
    const imgDir = dirname(images[0]);
    if (imgDir !== outputDir) rmSync(imgDir, { recursive: true, force: true });
  } catch {}

  return { filepath: outputPath, quality: 'slideshow' };
}

/**
 * Run FFmpeg with concat + audio overlay + scale/pad/fade
 */
function runFFmpeg(listPath, audioPath, outputPath, progress) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath
    ];

    if (audioPath && existsSync(audioPath)) {
      args.push('-i', audioPath);
    }

    args.push(
      '-vf',
      `scale=${DEFAULT_RESOLUTION}:force_original_aspect_ratio=decrease,` +
      `pad=${DEFAULT_RESOLUTION}:(ow-iw)/2:(oh-ih)/2:black,` +
      `fade=t=in:st=0:d=${FADE_DURATION},format=yuv420p`,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-r', '30'
    );

    if (audioPath && existsSync(audioPath)) {
      args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    } else {
      args.push('-an');
    }

    args.push('-progress', 'pipe:1', outputPath);

    const proc = spawn('ffmpeg', args);
    let stderr = '';

    proc.stdout.on('data', data => {
      if (!progress) return;
      const text = data.toString();
      const m = text.match(/out_time_ms=(\d+)/);
      if (m) {
        // out_time_ms is microseconds despite the name in some ffmpeg versions
        // emit a coarse progress signal
        progress.emit({ percent: Math.min(99, parseInt(m[1], 10) / 1e7) });
      }
    });

    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`FFmpeg carousel render failed: ${stderr.slice(-500)}`));
        return;
      }
      if (progress) progress.emit({ percent: 100, status: 'complete' });
      resolve();
    });

    proc.on('error', err => reject(new Error(`Failed to spawn ffmpeg: ${err.message}`)));
  });
}

function escapeForConcat(path) {
  return path.replace(/'/g, "'\\''");
}

function sanitize(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'carousel';
}
