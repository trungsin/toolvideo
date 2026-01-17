/**
 * Render karaoke video with FFmpeg
 * Combines original video + instrumental audio + ASS subtitles
 */

import { spawn } from 'child_process';
import { dirname, join, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '../../../downloads');

/**
 * Render karaoke video with lyrics overlay
 * @param {Object} params - Render parameters
 * @param {string} params.videoPath - Original video path
 * @param {string} params.instrumentalPath - Instrumental audio path
 * @param {string} params.assPath - ASS subtitle path
 * @param {Object} options - Options
 * @param {string} options.output - Output file path
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<string>} Output video path
 */
export async function renderKaraokeVideo(params, options = {}) {
  const { videoPath, instrumentalPath, assPath } = params;

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Generate output filename
  const ext = extname(videoPath);
  const baseName = basename(videoPath, ext);
  const outputPath = options.output || join(OUTPUT_DIR, `${baseName}_karaoke.mp4`);

  return new Promise((resolve, reject) => {
    // FFmpeg command:
    // - Input 0: Original video (video stream only)
    // - Input 1: Instrumental audio
    // - Filter: ASS subtitle burn-in
    // - Output: H.264 video + AAC audio

    // Escape ASS path for FFmpeg filter (handle special characters)
    const escapedAssPath = assPath.replace(/'/g, "'\\''").replace(/:/g, '\\:');

    const args = [
      '-i', videoPath,
      '-i', instrumentalPath,
      '-map', '0:v:0',            // Video from input 0
      '-map', '1:a:0',            // Audio from input 1
      '-vf', `ass='${escapedAssPath}'`,  // Burn in subtitles
      '-c:v', 'libx264',          // H.264 codec
      '-preset', 'medium',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',      // Compatibility
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',   // Web streaming
      '-y',
      outputPath
    ];

    const proc = spawn('ffmpeg', args);
    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();

      // Parse progress from ffmpeg output
      if (options.onProgress) {
        const timeMatch = stderr.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (timeMatch) {
          const secs = parseInt(timeMatch[1]) * 3600 +
                       parseInt(timeMatch[2]) * 60 +
                       parseFloat(timeMatch[3]);
          options.onProgress({ time: secs, status: 'rendering' });
        }
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg render failed (code ${code}): ${stderr.slice(-500)}`));
        return;
      }
      resolve(outputPath);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });
  });
}

/**
 * Render instrumental-only video (no lyrics)
 * @param {string} videoPath - Original video path
 * @param {string} instrumentalPath - Instrumental audio path
 * @param {Object} options - Options
 * @returns {Promise<string>} Output video path
 */
export async function renderInstrumentalVideo(videoPath, instrumentalPath, options = {}) {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const ext = extname(videoPath);
  const baseName = basename(videoPath, ext);
  const outputPath = options.output || join(OUTPUT_DIR, `${baseName}_instrumental.mp4`);

  return new Promise((resolve, reject) => {
    const args = [
      '-i', videoPath,
      '-i', instrumentalPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',             // Copy video (no re-encode, fast)
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];

    const proc = spawn('ffmpeg', args);
    let stderr = '';

    proc.stderr.on('data', d => stderr += d);

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg failed (code ${code}): ${stderr.slice(-500)}`));
        return;
      }
      resolve(outputPath);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });
  });
}
