/**
 * Main karaoke orchestrator
 * Coordinates: extract → separate → fetch lyrics → sync → render
 */

import { extractAudio, getAudioDuration } from './audio-extractor.js';
import { separateVocals, isDemucsAvailable } from './vocal-separator.js';
import { fetchLyrics } from './lyrics-fetcher.js';
import { syncLyrics, saveSyncedLyrics, isWhisperAvailable, transcribeToLyrics } from './lyrics-syncer.js';
import { renderKaraokeVideo, renderInstrumentalVideo } from './video-renderer.js';
import { dirname, join, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync, existsSync, mkdirSync, copyFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = join(__dirname, '../../../temp');
const OUTPUT_DIR = join(__dirname, '../../../downloads');

/**
 * Generate timestamp-based output folder name
 * Format: YYMMDD-HHMM-slug
 * @param {string} videoName - Original video name
 * @returns {string} Folder name
 */
function generateOutputFolder(videoName) {
  const now = new Date();
  const timestamp = [
    now.getFullYear().toString().slice(2),
    (now.getMonth() + 1).toString().padStart(2, '0'),
    now.getDate().toString().padStart(2, '0'),
    '-',
    now.getHours().toString().padStart(2, '0'),
    now.getMinutes().toString().padStart(2, '0')
  ].join('');

  // Create slug from video name
  const slug = videoName
    .toLowerCase()
    .replace(/[^\w\s\u00C0-\u1EF9-]/g, '')  // Keep Vietnamese chars
    .replace(/\s+/g, '-')
    .slice(0, 30);

  return `${timestamp}-${slug}`;
}

/**
 * Convert video to karaoke
 * @param {string} videoPath - Path to video file
 * @param {Object} options - Options
 * @param {string} options.lyrics - Manual lyrics (skip fetch)
 * @param {Object} options.lyricsData - Pre-fetched lyrics data with synced info
 * @param {boolean} options.noLyrics - Instrumental only (no sync)
 * @param {boolean} options.autoLyrics - Auto-transcribe lyrics from audio (VEED.io style)
 * @param {string} options.output - Output path
 * @param {string} options.language - Audio language code
 * @param {string} options.model - Whisper model (base, medium, large)
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} Karaoke result
 */
export async function convertToKaraoke(videoPath, options = {}) {
  // Ensure temp directory exists
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  const progress = (stage, data) => {
    if (options.onProgress) {
      options.onProgress({ stage, ...data });
    }
  };

  // Check dependencies
  const demucsOk = await isDemucsAvailable();
  if (!demucsOk) {
    throw new Error('Demucs not installed. Install: pip install demucs (or setup venv in scripts/.venv)');
  }

  const tempFiles = [];

  try {
    // Step 1: Extract audio from video
    progress('extract', { status: 'Extracting audio from video...' });
    const audioPath = await extractAudio(videoPath);
    tempFiles.push(audioPath);

    const duration = await getAudioDuration(audioPath);
    progress('extract', { status: 'Audio extracted', duration });

    // Step 2: Separate vocals using Demucs
    progress('separate', { status: 'Separating vocals (this may take a while)...', progress: 0 });
    const { vocals, instrumental } = await separateVocals(audioPath, {
      onProgress: (p) => progress('separate', p)
    });
    tempFiles.push(vocals, instrumental);

    // Step 3: Instrumental-only mode (no lyrics)
    if (options.noLyrics) {
      progress('render', { status: 'Rendering instrumental video...' });
      const outputPath = await renderInstrumentalVideo(videoPath, instrumental, {
        output: options.output
      });

      cleanup(tempFiles);

      return {
        type: 'instrumental',
        output: outputPath,
        duration
      };
    }

    // Step 4: Get lyrics
    // Mode: auto-transcribe (VEED.io style), manual, pre-fetched, or fetch from API
    let syncResult;

    if (options.autoLyrics) {
      // Auto-transcribe mode: Use Whisper to transcribe vocals directly
      const model = options.model || 'medium';
      progress('transcribe', { status: `Transcribing audio with Whisper (${model} model)...` });

      syncResult = await transcribeToLyrics(vocals, {
        model,
        language: options.language || 'auto'
      });

      progress('transcribe', {
        status: 'Transcription complete',
        segments: syncResult.segments.length,
        source: syncResult.source
      });

    } else {
      // Traditional mode: Get lyrics then sync
      let lyricsData = options.lyricsData;

      if (options.lyrics) {
        // Manual lyrics provided as string
        lyricsData = {
          found: true,
          lyrics: options.lyrics,
          synced: false,
          source: 'manual'
        };
      }

      if (!lyricsData) {
        progress('lyrics', { status: 'Fetching lyrics...' });
        const ext = extname(videoPath);
        const baseName = basename(videoPath, ext);
        // Clean up common video suffixes
        const searchQuery = baseName
          .replace(/_karaoke$|_instrumental$/i, '')
          .replace(/[-_]/g, ' ')
          .trim();

        lyricsData = await fetchLyrics(searchQuery);

        if (!lyricsData.found) {
          throw new Error(`Lyrics not found for "${searchQuery}". Use --lyrics or --auto to transcribe.`);
        }

        progress('lyrics', {
          status: 'Lyrics found',
          source: lyricsData.source,
          title: lyricsData.title,
          artist: lyricsData.artist,
          synced: lyricsData.synced
        });
      }

      // Sync lyrics to audio
      progress('sync', { status: lyricsData.synced ? 'Using synced lyrics...' : 'Syncing lyrics with audio...' });

      syncResult = await syncLyrics(vocals, lyricsData, {
        model: options.model || 'base',
        language: options.language || 'auto'
      });
    }

    progress('sync', {
      status: 'Lyrics synced',
      source: syncResult.source,
      segments: syncResult.segments.length
    });

    // Create output folder with timestamp
    const ext = extname(videoPath);
    const videoName = basename(videoPath, ext);
    const folderName = generateOutputFolder(videoName);
    const outputFolder = options.output
      ? dirname(options.output)
      : join(OUTPUT_DIR, folderName);

    if (!existsSync(outputFolder)) {
      mkdirSync(outputFolder, { recursive: true });
    }

    // Save lyrics files to output folder (permanent)
    const lyricsBasePath = join(outputFolder, 'lyrics');
    const { lrc, ass } = saveSyncedLyrics(syncResult, lyricsBasePath);

    // Save ASS to temp for rendering (will be cleaned up)
    const tempAssPath = join(TEMP_DIR, `karaoke_${Date.now()}.ass`);
    copyFileSync(ass, tempAssPath);
    tempFiles.push(tempAssPath);

    // Step 6: Render final karaoke video
    progress('render', { status: 'Rendering karaoke video...' });
    const karaokeOutputPath = options.output || join(outputFolder, 'karaoke.mp4');
    const outputPath = await renderKaraokeVideo({
      videoPath,
      instrumentalPath: instrumental,
      assPath: tempAssPath
    }, {
      output: karaokeOutputPath,
      onProgress: (p) => progress('render', p)
    });

    // Cleanup temp files (not lyrics)
    cleanup(tempFiles);

    return {
      type: 'karaoke',
      output: outputPath,
      outputFolder,
      lyricsLrc: lrc,
      lyricsAss: ass,
      duration,
      segments: syncResult.segments.length,
      lyricsSource: syncResult.source
    };

  } catch (error) {
    cleanup(tempFiles);
    throw error;
  }
}

/**
 * Check if karaoke dependencies are available
 * @returns {Promise<Object>} Dependency status
 */
export async function checkDependencies() {
  const demucs = await isDemucsAvailable();
  const whisper = await isWhisperAvailable();

  return {
    demucs,
    whisper,
    ready: demucs,  // Whisper is optional if we get synced lyrics
    message: !demucs
      ? 'Demucs not installed. Run: pip install demucs'
      : !whisper
        ? 'whisper.cpp not installed (optional). Run: brew install whisper-cpp'
        : 'All dependencies ready'
  };
}

/**
 * Cleanup temp files
 */
function cleanup(files) {
  for (const f of files) {
    try {
      if (f && existsSync(f)) {
        rmSync(f);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Export individual modules for direct use
export { extractAudio, getAudioDuration } from './audio-extractor.js';
export { separateVocals, isDemucsAvailable } from './vocal-separator.js';
export { fetchLyrics } from './lyrics-fetcher.js';
export { syncLyrics, saveSyncedLyrics, transcribeToLyrics } from './lyrics-syncer.js';
export { renderKaraokeVideo, renderInstrumentalVideo } from './video-renderer.js';
