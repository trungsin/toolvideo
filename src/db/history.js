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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'completed'
  );

  CREATE INDEX IF NOT EXISTS idx_platform ON downloads(platform);
  CREATE INDEX IF NOT EXISTS idx_created ON downloads(created_at);
`);

/**
 * Add a new download record
 * @param {Object} data - Download data
 * @returns {string} Generated ID
 */
export function addDownload(data) {
  const id = nanoid(10);
  const stmt = db.prepare(`
    INSERT INTO downloads (id, url, platform, title, filepath, quality, filesize, duration, thumbnail, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    data.status || 'completed'
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
 * @returns {Object|undefined} Download record
 */
export function searchByUrl(url) {
  const stmt = db.prepare(`SELECT * FROM downloads WHERE url = ?`);
  return stmt.get(url);
}

export default db;
