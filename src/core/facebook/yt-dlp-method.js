/**
 * Facebook video download via yt-dlp
 * Primary method - most reliable when working
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { AUDIO_EXT, AUDIO_QUALITY, buildAudioArgs } from '../audio-args.js';
import { buildCommonYtdlpArgs } from '../yt-dlp-common-args.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = join(__dirname, '../../../downloads');

/**
 * Download Facebook video using yt-dlp
 * @param {string} url - Facebook video URL
 * @param {Object} options - Download options
 * @returns {Object} Download result
 */
export async function downloadViaYtdlp(url, options = {}) {
  const outputDir = options.outputDir || DEFAULT_OUTPUT;

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Get info first
  const info = await getInfo(url);

  // Download
  const filepath = await runDownload(url, outputDir, options.progress, !!options.audioOnly);

  return {
    title: info.title,
    filepath,
    quality: options.audioOnly ? AUDIO_QUALITY : info.quality,
    duration: info.duration,
    thumbnail: info.thumbnail
  };
}

/**
 * Get video metadata without downloading
 */
async function getInfo(url) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [...buildCommonYtdlpArgs(), '--dump-json', '--no-download', url]);
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
          title: info.title || 'Facebook Video',
          quality: info.format_note || (info.height ? `${info.height}p` : 'best'),
          duration: info.duration || null,
          thumbnail: info.thumbnail || null
        });
      } catch {
        reject(new Error('Failed to parse video info'));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
    });
  });
}

/**
 * Run yt-dlp download process
 */
async function runDownload(url, outputDir, progress, audioOnly = false) {
  return new Promise((resolve, reject) => {
    const outputTemplate = join(outputDir, '%(title)s.%(ext)s');

    const args = audioOnly
      ? [
          ...buildCommonYtdlpArgs(),
          ...buildAudioArgs(),
          '-o', outputTemplate,
          '--no-playlist',
          '--newline',
          url,
        ]
      : [
          ...buildCommonYtdlpArgs(),
          // Force H.264 (avc1) video + AAC (mp4a) audio for universal compatibility
          '-f', 'bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[vcodec^=avc1]/best',
          '--merge-output-format', 'mp4',
          '-o', outputTemplate,
          '--no-playlist',
          '--newline',
          url
        ];

    const proc = spawn('yt-dlp', args);
    let filepath = '';
    let stderr = '';

    proc.stdout.on('data', data => {
      const lines = data.toString().split('\n');

      for (const line of lines) {
        // Parse progress
        if (progress) {
          const match = line.match(/\[download\]\s+(\d+\.?\d*)%/);
          if (match) {
            progress.emit({ percent: parseFloat(match[1]) });
          }
        }

        // Capture filepath from merger
        const mergeMatch = line.match(/\[Merger\] Merging formats into "(.+)"/);
        if (mergeMatch) filepath = mergeMatch[1];

        const audioMatch = line.match(/\[ExtractAudio\] Destination: (.+\.mp3)/);
        if (audioMatch) filepath = audioMatch[1];

        // Capture from destination
        const destMatch = line.match(new RegExp(`Destination: (.+\\.${audioOnly ? AUDIO_EXT : 'mp4'})`));
        if (destMatch && !filepath) filepath = destMatch[1];

        // Already downloaded
        const alreadyMatch = line.match(/\[download\] (.+) has already been downloaded/);
        if (alreadyMatch) filepath = alreadyMatch[1];
      }
    });

    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'yt-dlp download failed'));
        return;
      }
      if (!filepath) {
        reject(new Error('Could not determine output file'));
        return;
      }

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
