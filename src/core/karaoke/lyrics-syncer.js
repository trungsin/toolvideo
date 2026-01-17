/**
 * Sync lyrics with audio using Whisper transcription
 * Supports: LRC input (from lrclib), plain lyrics + Whisper alignment
 * Auto mode: Direct transcription without pre-existing lyrics
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '../../../scripts/whisper-transcribe.sh');
const TEMP_DIR = join(__dirname, '../../../temp');

/**
 * Sync lyrics with audio
 * @param {string} vocalsPath - Path to vocals audio
 * @param {Object} lyricsData - Lyrics data from fetchLyrics
 * @param {Object} options - Options
 * @returns {Promise<Object>} Synced lyrics with timestamps
 */
export async function syncLyrics(vocalsPath, lyricsData, options = {}) {
  // If we have synced lyrics from lrclib, parse them directly
  if (lyricsData.syncedLyrics) {
    const segments = parseLRC(lyricsData.syncedLyrics);
    return {
      segments,
      lrc: lyricsData.syncedLyrics,
      ass: generateASS(segments, options),
      source: 'lrclib-synced'
    };
  }

  // Otherwise, use Whisper to transcribe and align
  const transcription = await transcribeAudio(vocalsPath, options);
  const segments = alignLyrics(lyricsData.lyrics, transcription);
  const lrc = generateLRC(segments);
  const ass = generateASS(segments, options);

  return {
    segments,
    lrc,
    ass,
    source: 'whisper-aligned'
  };
}

/**
 * Parse LRC format into segments
 * @param {string} lrcContent - LRC content with timestamps
 * @returns {Array} Segments with start/end times
 */
function parseLRC(lrcContent) {
  const lines = lrcContent.split('\n');
  const segments = [];

  const timeRegex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/;

  for (const line of lines) {
    const match = line.match(timeRegex);
    if (match) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      const ms = parseInt(match[3].padEnd(3, '0'), 10);
      const text = match[4].trim();

      if (text) {
        const start = mins * 60 + secs + ms / 1000;
        segments.push({ text, start, end: start + 3 }); // Default 3s duration
      }
    }
  }

  // Calculate end times based on next segment start
  for (let i = 0; i < segments.length - 1; i++) {
    segments[i].end = segments[i + 1].start;
  }

  return segments;
}

/**
 * Transcribe audio with Whisper
 * @param {string} audioPath - Path to audio
 * @param {Object} options - Options
 * @returns {Promise<Array>} Transcription segments
 */
async function transcribeAudio(audioPath, options = {}) {
  // Ensure temp directory exists
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  const outputJson = join(TEMP_DIR, `whisper_${Date.now()}.json`);

  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [SCRIPT_PATH, audioPath, outputJson], {
      env: {
        ...process.env,
        WHISPER_MODEL: options.model || 'base',
        WHISPER_LANG: options.language || 'auto'
      }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Whisper failed (code ${code}): ${stdout} ${stderr}`));
        return;
      }

      try {
        if (!existsSync(outputJson)) {
          reject(new Error('Whisper output file not created'));
          return;
        }

        const data = JSON.parse(readFileSync(outputJson, 'utf-8'));
        resolve(data.transcription || []);
      } catch (e) {
        reject(new Error(`Failed to parse Whisper output: ${e.message}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to run whisper: ${err.message}`));
    });
  });
}

/**
 * Align fetched lyrics with transcription
 * Uses fuzzy matching to map lyrics lines to timestamps
 * @param {string} lyrics - Original lyrics
 * @param {Array} transcription - Whisper segments
 * @returns {Array} Aligned segments with timestamps
 */
function alignLyrics(lyrics, transcription) {
  const lyricsLines = lyrics.split('\n').filter(l => l.trim());
  const segments = [];

  if (transcription.length === 0) {
    // No transcription, estimate timing (3 seconds per line)
    let time = 0;
    for (const line of lyricsLines) {
      const duration = Math.max(2, line.split(/\s+/).length * 0.4);
      segments.push({
        text: line,
        start: time,
        end: time + duration,
        confidence: 0
      });
      time += duration + 0.5;
    }
    return segments;
  }

  // Build transcription text index for matching
  let transIdx = 0;

  for (const line of lyricsLines) {
    // Find best matching transcription segment
    let bestMatch = null;
    let bestScore = 0;
    let bestIdx = transIdx;

    // Search within a window
    const searchEnd = Math.min(transIdx + 20, transcription.length);

    for (let i = transIdx; i < searchEnd; i++) {
      const seg = transcription[i];
      const segText = seg.text || '';
      const score = similarity(line.toLowerCase(), segText.toLowerCase());

      if (score > bestScore) {
        bestScore = score;
        bestMatch = seg;
        bestIdx = i;
      }
    }

    // Use matched segment or estimate
    if (bestMatch && bestScore > 0.2) {
      transIdx = bestIdx + 1;
      segments.push({
        text: line,
        start: getSegmentStart(bestMatch),
        end: getSegmentEnd(bestMatch),
        confidence: bestScore
      });
    } else {
      // Estimate based on previous segment
      const prevEnd = segments.length > 0 ? segments[segments.length - 1].end : 0;
      const duration = Math.max(2, line.split(/\s+/).length * 0.4);
      segments.push({
        text: line,
        start: prevEnd + 0.3,
        end: prevEnd + 0.3 + duration,
        confidence: 0
      });
    }
  }

  return segments;
}

/**
 * Get segment start time (handles different whisper.cpp output formats)
 */
function getSegmentStart(seg) {
  if (seg.timestamps && seg.timestamps.length > 0) {
    return seg.timestamps[0].t;
  }
  if (seg.offsets && typeof seg.offsets.from === 'number') {
    return seg.offsets.from / 1000;
  }
  if (typeof seg.start === 'number') {
    return seg.start;
  }
  return 0;
}

/**
 * Get segment end time
 */
function getSegmentEnd(seg) {
  if (seg.timestamps && seg.timestamps.length > 0) {
    return seg.timestamps[seg.timestamps.length - 1].t;
  }
  if (seg.offsets && typeof seg.offsets.to === 'number') {
    return seg.offsets.to / 1000;
  }
  if (typeof seg.end === 'number') {
    return seg.end;
  }
  return getSegmentStart(seg) + 3;
}

/**
 * Simple string similarity (Dice coefficient)
 */
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aBigrams = new Set();
  for (let i = 0; i < a.length - 1; i++) {
    aBigrams.add(a.slice(i, i + 2));
  }

  let matches = 0;
  for (let i = 0; i < b.length - 1; i++) {
    if (aBigrams.has(b.slice(i, i + 2))) matches++;
  }

  const denom = a.length + b.length - 2;
  return denom > 0 ? (2 * matches) / denom : 0;
}

/**
 * Generate LRC format
 * @param {Array} segments - Aligned segments
 * @returns {string} LRC content
 */
function generateLRC(segments) {
  const lines = segments.map(seg => {
    const mins = Math.floor(seg.start / 60);
    const secs = (seg.start % 60).toFixed(2);
    return `[${mins.toString().padStart(2, '0')}:${secs.padStart(5, '0')}]${seg.text}`;
  });

  return lines.join('\n');
}

/**
 * Auto-wrap text to fit within max characters per line
 * @param {string} text - Text to wrap
 * @param {number} maxChars - Max characters per line
 * @returns {string} Wrapped text with \N line breaks
 */
function autoWrapText(text, maxChars = 45) {
  if (text.length <= maxChars) return text;

  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= maxChars) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  // Limit to 2 lines max, truncate if needed
  if (lines.length > 2) {
    return lines.slice(0, 2).join('\\N') + '...';
  }

  return lines.join('\\N');
}

/**
 * Calculate max chars per line based on video width
 * @param {number} videoWidth - Video width in pixels
 * @param {number} fontSize - Font size
 * @returns {number} Max characters per line
 */
function calculateMaxChars(videoWidth = 1920, fontSize = 48) {
  // Approximate: each char is ~0.6 * fontSize wide
  // Leave 10% margin on each side
  const usableWidth = videoWidth * 0.8;
  const charWidth = fontSize * 0.55;
  const maxChars = Math.floor(usableWidth / charWidth);
  // Limit to reasonable range for readability
  return Math.min(Math.max(maxChars, 30), 55);
}

/**
 * Generate ASS subtitle format (karaoke style)
 * @param {Array} segments - Aligned segments
 * @param {Object} options - Style options
 * @returns {string} ASS content
 */
function generateASS(segments, options = {}) {
  const fontName = options.fontName || 'Arial';
  const fontSize = options.fontSize || 48;
  const videoWidth = options.videoWidth || 1920;
  const primaryColor = options.primaryColor || '&H00FFFF&';     // Yellow (BGR)
  const secondaryColor = options.secondaryColor || '&HFFFFFF&'; // White
  const outlineColor = options.outlineColor || '&H000000&';     // Black

  // Calculate max chars for auto-wrap
  const maxChars = calculateMaxChars(videoWidth, fontSize);

  const header = `[Script Info]
Title: Karaoke Subtitles
ScriptType: v4.00+
PlayDepth: 0
WrapStyle: 0
PlayResX: ${videoWidth}
PlayResY: ${Math.round(videoWidth * 9 / 16)}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primaryColor},${secondaryColor},${outlineColor},&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,20,20,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const formatTime = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = (secs % 60).toFixed(2);
    return `${h}:${m.toString().padStart(2, '0')}:${s.padStart(5, '0')}`;
  };

  const events = segments.map(seg => {
    const start = formatTime(seg.start);
    const end = formatTime(seg.end);
    // Auto-wrap long lines
    const wrappedText = autoWrapText(seg.text, maxChars);
    // Karaoke fill effect: {\kf<duration in centiseconds>}
    const duration = Math.round((seg.end - seg.start) * 100);
    const text = `{\\kf${duration}}${wrappedText}`;
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
  });

  return header + '\n' + events.join('\n');
}

/**
 * Save synced lyrics to files
 * @param {Object} syncResult - Result from syncLyrics
 * @param {string} basePath - Base output path (without extension)
 * @returns {Object} Paths to generated files
 */
export function saveSyncedLyrics(syncResult, basePath) {
  writeFileSync(`${basePath}.lrc`, syncResult.lrc);
  writeFileSync(`${basePath}.ass`, syncResult.ass);

  return {
    lrc: `${basePath}.lrc`,
    ass: `${basePath}.ass`
  };
}

/**
 * Auto-transcribe audio to lyrics (VEED.io style)
 * Transcribes audio directly without pre-existing lyrics
 * @param {string} audioPath - Path to audio file (vocals recommended)
 * @param {Object} options - Options
 * @param {string} options.model - Whisper model (base, medium, large)
 * @param {string} options.language - Language code or 'auto'
 * @returns {Promise<Object>} Transcribed lyrics with timestamps
 */
export async function transcribeToLyrics(audioPath, options = {}) {
  // Use medium model by default for better multi-language support
  const model = options.model || 'medium';
  const language = options.language || 'auto';

  // Transcribe with Whisper
  const transcription = await transcribeAudio(audioPath, { model, language });

  if (transcription.length === 0) {
    throw new Error('Whisper transcription returned empty result. Try specifying --lang with the correct language code (e.g., --lang vi for Vietnamese).');
  }

  // Group word segments into lines (by pause or punctuation)
  const segments = groupIntoLines(transcription);

  if (segments.length === 0) {
    throw new Error('Whisper could not transcribe any speech. The audio may have no clear vocals, or try specifying --lang with the correct language code.');
  }

  const lrc = generateLRC(segments);
  const ass = generateASS(segments, options);

  return {
    segments,
    lrc,
    ass,
    source: 'whisper-transcribed',
    model
  };
}

/**
 * Filter out Whisper's non-speech markers
 * @param {string} text - Text to filter
 * @returns {string} Cleaned text
 */
function filterNonSpeechMarkers(text) {
  // Remove [Silence], [Singing], [Music], [Applause], etc.
  return text
    .replace(/\[\s*(Silence|Singing|Music|Applause|Laughter|BLANK_AUDIO)\s*\]/gi, '')
    .trim();
}

/**
 * Group word-level transcription into sentence/line segments
 * Groups by pauses (>0.5s) or punctuation
 * Also handles sentence-level segments (skips grouping if already sentences)
 * @param {Array} transcription - Word or sentence-level transcription from Whisper
 * @returns {Array} Line-level segments
 */
function groupIntoLines(transcription) {
  // Filter out non-speech segments first
  const filtered = transcription.filter(seg => {
    const text = filterNonSpeechMarkers(seg.text || '');
    return text.length > 0;
  });

  if (filtered.length === 0) {
    return [];
  }

  // Check if transcription is already sentence-level (avg text length > 15 chars)
  const avgLen = filtered.reduce((sum, s) => sum + (s.text || '').length, 0) / filtered.length;
  const isSentenceLevel = avgLen > 15;

  if (isSentenceLevel) {
    // Already sentence-level, just clean and return
    return filtered.map(seg => ({
      text: filterNonSpeechMarkers(seg.text || '').trim(),
      start: getSegmentStart(seg),
      end: getSegmentEnd(seg)
    })).filter(s => s.text.length > 0);
  }

  // Word-level: group into lines
  const lines = [];
  let currentLine = { text: '', start: 0, end: 0, words: [] };

  for (let i = 0; i < filtered.length; i++) {
    const seg = filtered[i];
    const text = filterNonSpeechMarkers(seg.text || '').trim();
    if (!text) continue;

    const start = getSegmentStart(seg);
    const end = getSegmentEnd(seg);

    // Start new line if this is the first word
    if (currentLine.words.length === 0) {
      currentLine.start = start;
    }

    // Check if should start new line
    const prevEnd = currentLine.end || start;
    const pause = start - prevEnd;
    const endsWithPunctuation = /[.!?。！？]$/.test(currentLine.text);

    // Start new line if: pause > 0.8s OR ends with sentence punctuation
    if (currentLine.words.length > 0 && (pause > 0.8 || endsWithPunctuation)) {
      // Save current line
      if (currentLine.text.trim()) {
        lines.push({
          text: currentLine.text.trim(),
          start: currentLine.start,
          end: currentLine.end
        });
      }
      // Start new line
      currentLine = { text: text, start, end, words: [seg] };
    } else {
      // Append to current line with space
      currentLine.text += ' ' + text;
      currentLine.end = end;
      currentLine.words.push(seg);
    }
  }

  // Don't forget the last line
  if (currentLine.text.trim()) {
    lines.push({
      text: currentLine.text.trim(),
      start: currentLine.start,
      end: currentLine.end
    });
  }

  return lines;
}

/**
 * Check if whisper.cpp is installed
 * @returns {Promise<boolean>}
 */
export async function isWhisperAvailable() {
  return new Promise((resolve) => {
    const proc = spawn('which', ['whisper-cli']);
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}
