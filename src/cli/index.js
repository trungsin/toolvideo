#!/usr/bin/env node

/**
 * CLI entry point for toolvideo
 * Download videos from YouTube, Facebook, and TikTok
 */

import { Command } from 'commander';
import { download, detectPlatform, isValidUrl } from '../core/downloader.js';
import { getDownloads } from '../db/history.js';

const program = new Command();

// ANSI color helpers
const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`
};

/**
 * Render progress bar
 */
function progressBar(percent, width = 30) {
  const filled = Math.round(width * (percent / 100));
  const empty = width - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  return `[${bar}] ${percent.toFixed(1)}%`;
}

/**
 * Format duration in seconds to readable string
 */
function formatDuration(seconds) {
  if (!seconds) return 'Unknown';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format YYYYMMDD date string
 */
function formatDate(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd || 'Unknown';
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

// Program setup
program
  .name('toolvideo')
  .description('Download videos from YouTube, Facebook, and TikTok')
  .version('1.0.0');

// Default download command
program
  .argument('[url]', 'Video URL to download')
  .option('-o, --output <dir>', 'Output directory', './downloads')
  .option('-f, --force', 'Force re-download even if exists in history')
  .option('--watermark', 'TikTok only: include watermark in downloaded video')
  .option('--audio-only', 'Download audio as MP3 (YouTube, Facebook, TikTok)')
  .action(async (url, options) => {
    if (!url) {
      program.help();
      return;
    }

    // Validate URL
    if (!isValidUrl(url)) {
      console.error(colors.red('Error: Invalid URL'));
      process.exit(1);
    }

    // Detect platform
    const { platform } = detectPlatform(url);
    if (platform === 'unknown') {
      console.error(colors.red('Error: Unsupported platform. Supported: YouTube, Facebook, TikTok.'));
      process.exit(1);
    }

    console.log(colors.cyan(`Platform: ${platform.toUpperCase()}`));
    console.log(colors.dim(`URL: ${url}`));
    console.log('');

    try {
      const result = await download(url, {
        outputDir: options.output,
        force: options.force,
        watermark: options.watermark,
        audioOnly: options.audioOnly,
        onProgress: (data) => {
          if (data.percent !== undefined) {
            let line = `\r${progressBar(data.percent)}`;
            if (data.speed) line += ` ${data.speed}`;
            if (data.eta) line += ` ETA: ${data.eta}`;
            if (data.status) line += ` [${data.status}]`;
            process.stdout.write(line);
          }
        }
      });

      console.log('\n');
      console.log(colors.green('\u2713 Download complete!'));
      console.log(colors.dim(`Title: ${result.title}`));
      console.log(colors.dim(`File: ${result.filepath}`));
      if (options.audioOnly) {
        console.log(colors.dim('Format: MP3 (audio only)'));
      }
      if (result.quality) {
        console.log(colors.dim(`Quality: ${result.quality}`));
      }
      if (result.duration) {
        console.log(colors.dim(`Duration: ${formatDuration(result.duration)}`));
      }

    } catch (error) {
      console.error('\n');
      console.error(colors.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// History command
program
  .command('history')
  .description('Show download history')
  .option('-n, --limit <number>', 'Number of entries to show', '20')
  .action((options) => {
    const limit = parseInt(options.limit, 10) || 20;
    const downloads = getDownloads(limit);

    if (downloads.length === 0) {
      console.log(colors.dim('No download history.'));
      return;
    }

    console.log(colors.cyan(`Recent downloads (${downloads.length}):`));
    console.log('');

    for (const d of downloads) {
      const date = new Date(d.created_at).toLocaleDateString();
      const platform = d.platform.toUpperCase().padEnd(8);
      const title = (d.title || 'Unknown').substring(0, 50);

      console.log(`${colors.dim(date)} ${colors.yellow(platform)} ${title}`);
      console.log(colors.dim(`  \u2514\u2500 ${d.filepath || d.url}`));
    }
  });

// Info command
program
  .command('info <url>')
  .description('Show video info without downloading')
  .action(async (url) => {
    if (!isValidUrl(url)) {
      console.error(colors.red('Error: Invalid URL'));
      process.exit(1);
    }

    const { platform } = detectPlatform(url);
    if (platform === 'unknown') {
      console.error(colors.red('Error: Unsupported platform'));
      process.exit(1);
    }

    console.log(colors.cyan(`Platform: ${platform.toUpperCase()}`));
    console.log(colors.dim('Fetching video info...'));
    console.log('');

    // Use yt-dlp to get info
    const { spawn } = await import('child_process');
    const proc = spawn('yt-dlp', ['--dump-json', '--no-download', url]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      if (code !== 0) {
        console.error(colors.red('Failed to get video info'));
        if (stderr) console.error(colors.dim(stderr.trim()));
        process.exit(1);
      }

      try {
        const info = JSON.parse(stdout);
        console.log(colors.bold(`Title: ${info.title}`));
        console.log(`Duration: ${formatDuration(info.duration)}`);
        console.log(`Quality: ${info.format_note || (info.height ? info.height + 'p' : 'best')}`);

        if (info.uploader) {
          console.log(`Uploader: ${info.uploader}`);
        }
        if (info.view_count) {
          console.log(`Views: ${info.view_count.toLocaleString()}`);
        }
        if (info.upload_date) {
          console.log(`Uploaded: ${formatDate(info.upload_date)}`);
        }
        if (info.description) {
          const desc = info.description.substring(0, 200);
          console.log(`Description: ${desc}${info.description.length > 200 ? '...' : ''}`);
        }
      } catch {
        console.error(colors.red('Failed to parse video info'));
        process.exit(1);
      }
    });

    proc.on('error', (err) => {
      console.error(colors.red(`Failed to run yt-dlp: ${err.message}`));
      process.exit(1);
    });
  });

// Karaoke command
program
  .command('karaoke <input>')
  .description('Convert video to karaoke (vocal removal + synced lyrics)')
  .option('-a, --auto', 'Auto-transcribe lyrics from audio (like VEED.io)')
  .option('-l, --lyrics <text>', 'Provide lyrics manually')
  .option('--no-lyrics', 'Instrumental only (skip lyrics sync)')
  .option('-o, --output <file>', 'Output file path')
  .option('--lang <code>', 'Audio language (e.g., en, vi, ko, ja, zh) - specify for better accuracy')
  .option('--model <name>', 'Whisper model: base, medium, large (default: medium for --auto)')
  .action(async (input, options) => {
    const { convertToKaraoke, checkDependencies } = await import('../core/karaoke/karaoke-handler.js');

    // Check dependencies first
    const deps = await checkDependencies();
    if (!deps.ready) {
      console.error(colors.red(`Error: ${deps.message}`));
      process.exit(1);
    }

    let videoPath = input;
    let sourcePlatform = null;

    // Download if URL
    if (isValidUrl(input)) {
      const { platform } = detectPlatform(input);
      if (platform === 'unknown') {
        console.error(colors.red('Error: Unsupported platform'));
        process.exit(1);
      }
      sourcePlatform = platform;

      console.log(colors.cyan(`Downloading from ${platform.toUpperCase()}...`));

      try {
        const result = await download(input, {
          outputDir: './downloads',
          onProgress: (data) => {
            if (data.percent !== undefined) {
              process.stdout.write(`\r${progressBar(data.percent)}`);
            }
          }
        });
        videoPath = result.filepath;
        console.log('\n');
      } catch (error) {
        console.error(colors.red(`\nDownload failed: ${error.message}`));
        process.exit(1);
      }
    }

    // TikTok songs are usually snippets/remixes — lrclib rarely has them.
    // Default to Whisper auto-transcribe unless user provided manual lyrics or opted out.
    const noLyrics = options.lyrics === false;
    const hasManualLyrics = typeof options.lyrics === 'string';
    let autoLyrics = options.auto;
    if (sourcePlatform === 'tiktok' && !autoLyrics && !hasManualLyrics && !noLyrics) {
      autoLyrics = true;
      console.log(colors.dim('TikTok detected: enabling auto-transcribe (Whisper)'));
    }

    console.log(colors.cyan('Converting to karaoke...'));
    console.log(colors.dim(`Input: ${videoPath}`));
    console.log('');

    try {
      const result = await convertToKaraoke(videoPath, {
        lyrics: hasManualLyrics ? options.lyrics : undefined,
        autoLyrics,
        noLyrics,
        output: options.output,
        language: options.lang,
        model: options.model,
        onProgress: (data) => {
          let line = `\r${colors.dim(data.stage.padEnd(10))} `;
          if (data.status) line += data.status;
          if (data.progress !== undefined) line += ` ${data.progress}%`;
          process.stdout.write(line.padEnd(70));
        }
      });

      console.log('\n');
      console.log(colors.green('\u2713 Karaoke created!'));
      console.log(colors.dim(`Type: ${result.type}`));
      if (result.outputFolder) {
        console.log(colors.dim(`Folder: ${result.outputFolder}`));
      }
      console.log(colors.dim(`Video: ${result.output}`));
      if (result.lyricsLrc) {
        console.log(colors.dim(`Lyrics: ${result.lyricsLrc}`));
      }
      if (result.segments) {
        console.log(colors.dim(`Segments: ${result.segments}`));
      }
      if (result.lyricsSource) {
        console.log(colors.dim(`Source: ${result.lyricsSource}`));
      }

    } catch (error) {
      console.error('\n');
      console.error(colors.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Parse and run
program.parse();
