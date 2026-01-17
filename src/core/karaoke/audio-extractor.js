/**
 * Extract audio from video using FFmpeg
 * Used as first step in karaoke pipeline
 */

import { spawn } from 'child_process';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = join(__dirname, '../../../temp');

/**
 * Extract audio from video file
 * @param {string} videoPath - Path to video file
 * @param {Object} options - Options
 * @param {string} options.format - Output format (wav, mp3)
 * @param {number} options.sampleRate - Sample rate (default 44100)
 * @returns {Promise<string>} Path to extracted audio
 */
export async function extractAudio(videoPath, options = {}) {
  const format = options.format || 'wav';
  const sampleRate = options.sampleRate || 44100;

  // Ensure temp dir exists
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  // Handle various extensions
  const baseName = basename(videoPath).replace(/\.[^.]+$/, '');
  const outputPath = join(TEMP_DIR, `${baseName}_audio.${format}`);

  return new Promise((resolve, reject) => {
    const args = [
      '-i', videoPath,
      '-vn',                    // No video
      '-acodec', format === 'wav' ? 'pcm_s16le' : 'libmp3lame',
      '-ar', String(sampleRate),
      '-ac', '2',               // Stereo
      '-y',                     // Overwrite
      outputPath
    ];

    const proc = spawn('ffmpeg', args);
    let stderr = '';

    proc.stderr.on('data', (d) => stderr += d);

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg failed: ${stderr.slice(-500)}`));
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
 * Get audio duration in seconds
 * @param {string} audioPath - Path to audio file
 * @returns {Promise<number>} Duration in seconds
 */
export async function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', audioPath,
      '-show_entries', 'format=duration',
      '-v', 'quiet',
      '-of', 'csv=p=0'
    ];

    const proc = spawn('ffprobe', args);
    let stdout = '';

    proc.stdout.on('data', (d) => stdout += d);

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Failed to get duration'));
        return;
      }
      resolve(parseFloat(stdout.trim()) || 0);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ffprobe: ${err.message}`));
    });
  });
}

/**
 * Get temp directory path
 * @returns {string} Temp directory path
 */
export function getTempDir() {
  return TEMP_DIR;
}
