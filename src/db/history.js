/**
 * SQLite database operations for download history
 * Uses better-sqlite3 for synchronous, fast SQLite access
 */

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '../../data/history.db');

const db = new Database(dbPath);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    platform TEXT NOT NULL,
    title TEXT,
    filepath TEXT,
    quality TEXT,
    filesize INTEGER,
    duration INTEGER,
    thumbnail TEXT,
    audio_only INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'completed'
  );

  CREATE INDEX IF NOT EXISTS idx_platform ON downloads(platform);
  CREATE INDEX IF NOT EXISTS idx_created ON downloads(created_at);

  CREATE TABLE IF NOT EXISTS karaoke (
    id TEXT PRIMARY KEY,
    url TEXT,
    platform TEXT,
    title TEXT,
    output_folder TEXT,
    video_path TEXT,
    lyrics_lrc_path TEXT,
    lyrics_ass_path TEXT,
    duration REAL,
    segments INTEGER,
    lyrics_source TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_karaoke_created ON karaoke(created_at);
`);

// Migration: keep existing installs compatible with audio/video dedup.
const downloadColumns = db.prepare(`PRAGMA table_info(downloads)`).all();
if (!downloadColumns.some((column) => column.name === 'audio_only')) {
  db.exec(`ALTER TABLE downloads ADD COLUMN audio_only INTEGER DEFAULT 0`);
}

/**
 * Add a new download record
 * @param {Object} data - Download data
 * @returns {string} Generated ID
 */
export function addDownload(data) {
  const id = nanoid(10);
  const stmt = db.prepare(`
    INSERT INTO downloads (id, url, platform, title, filepath, quality, filesize, duration, thumbnail, status, audio_only)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    data.url,
    data.platform,
    data.title || null,
    data.filepath || null,
    data.quality || null,
    data.filesize || null,
    data.duration || null,
    data.thumbnail || null,
    data.status || 'completed',
    data.audioOnly ? 1 : 0
  );
  return id;
}

/**
 * Get recent downloads
 * @param {number} limit - Max number of records
 * @returns {Array} Download records
 */
export function getDownloads(limit = 50) {
  const stmt = db.prepare(`
    SELECT * FROM downloads ORDER BY created_at DESC LIMIT ?
  `);
  return stmt.all(limit);
}

/**
 * Get download by ID
 * @param {string} id - Download ID
 * @returns {Object|undefined} Download record
 */
export function getDownloadById(id) {
  const stmt = db.prepare(`SELECT * FROM downloads WHERE id = ?`);
  return stmt.get(id);
}

/**
 * Search by URL (check if already downloaded)
 * @param {string} url - Video URL
 * @param {boolean} audioOnly - Whether to search audio-only downloads
 * @returns {Object|undefined} Download record
 */
export function searchByUrl(url, audioOnly = false) {
  const stmt = db.prepare(`SELECT * FROM downloads WHERE url = ? AND audio_only = ?`);
  return stmt.get(url, audioOnly ? 1 : 0);
}

/**
 * Persist a completed karaoke job for later file serving.
 * Uses the in-memory karaoke ID as primary key (no re-mapping needed).
 */
export function addKaraoke(data) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO karaoke
    (id, url, platform, title, output_folder, video_path, lyrics_lrc_path, lyrics_ass_path, duration, segments, lyrics_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    data.id,
    data.url || null,
    data.platform || null,
    data.title || null,
    data.outputFolder || null,
    data.videoPath || null,
    data.lyricsLrcPath || null,
    data.lyricsAssPath || null,
    data.duration || null,
    data.segments || null,
    data.lyricsSource || null
  );
  return data.id;
}

/**
 * Look up a karaoke job by ID for file serving after pm2 restart.
 */
export function getKaraokeById(id) {
  const stmt = db.prepare(`SELECT * FROM karaoke WHERE id = ?`);
  return stmt.get(id);
}

export default db;
