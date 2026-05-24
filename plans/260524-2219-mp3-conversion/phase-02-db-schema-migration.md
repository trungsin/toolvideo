---
phase: 02
name: DB Schema Migration
status: done
priority: high
effort: S
---

# Phase 02 — DB Schema Migration

## Context
- DB module: `src/db/history.js` (better-sqlite3, schema initialized via `db.exec` on import)
- DB file: `data/history.db`
- Existing table: `downloads (id, url, platform, title, filepath, quality, filesize, duration, thumbnail, created_at, status)`

## Overview
Add `audio_only INTEGER DEFAULT 0` column to `downloads` table. Update `searchByUrl` to accept `audioOnly` param so MP4 + MP3 of same URL coexist. Idempotent migration on module load.

## Key Insights
- better-sqlite3 supports synchronous `PRAGMA table_info` — safe runtime check
- Adding column with default is non-destructive; existing rows backfill to 0
- KISS: no separate migration tool; inline at schema init block
- `addDownload` already accepts a `data` object — just pass `audioOnly` through

## Requirements
**Functional:**
- New column `audio_only` defaults 0
- `searchByUrl(url, audioOnly = false)` filters by both
- `addDownload(data)` writes `audio_only = data.audioOnly ? 1 : 0`
- `getDownloads()` returns column in results (already auto via `SELECT *`)

**Non-functional:**
- Migration runs once per startup, no-op if column exists
- Backward compatible: old code calling `searchByUrl(url)` still works (default false)

## Architecture
- Inline idempotent migration in `db.exec` block via `PRAGMA table_info('downloads')` check
- Single source of truth: schema init OR migration check, not both

## Files to Modify
- `src/db/history.js`

## Implementation Steps

1. Add idempotent migration after current `db.exec` schema init:
   ```js
   // Migration: add audio_only column if not present
   const cols = db.prepare(`PRAGMA table_info(downloads)`).all();
   if (!cols.some(c => c.name === 'audio_only')) {
     db.exec(`ALTER TABLE downloads ADD COLUMN audio_only INTEGER DEFAULT 0`);
   }
   ```

2. Update `addDownload` INSERT statement — add `audio_only` to column list + value list:
   ```js
   const stmt = db.prepare(`
     INSERT INTO downloads (id, url, platform, title, filepath, quality, filesize, duration, thumbnail, status, audio_only)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   `);
   stmt.run(id, data.url, data.platform, data.title || null, data.filepath || null,
            data.quality || null, data.filesize || null, data.duration || null,
            data.thumbnail || null, data.status || 'completed', data.audioOnly ? 1 : 0);
   ```

3. Update `searchByUrl`:
   ```js
   export function searchByUrl(url, audioOnly = false) {
     const stmt = db.prepare(`SELECT * FROM downloads WHERE url = ? AND audio_only = ?`);
     return stmt.get(url, audioOnly ? 1 : 0);
   }
   ```

4. Update schema `CREATE TABLE` to include `audio_only INTEGER DEFAULT 0` for fresh installs.

## Todo
- [ ] Add CREATE TABLE column for fresh installs
- [ ] Add idempotent migration block
- [ ] Update `addDownload` signature + INSERT
- [ ] Update `searchByUrl` signature + WHERE
- [ ] Test: run server twice on existing DB — no errors, column added once
- [ ] Test: existing rows show `audio_only = 0`

## Success Criteria
- Existing `data/history.db` continues to work
- New `audio_only` column present in schema
- Two records can exist for same URL with different `audio_only` values

## Risks
- **Multiple processes opening DB simultaneously during migration**: better-sqlite3 uses WAL, low risk for single-user tool
- **PRAGMA result format**: `.all()` returns rows w/ `name` field — verified stable across sqlite3 versions

## Security
- N/A — internal schema change, no user input in DDL

## Next
→ Phase 04 (orchestrator dedup uses new `searchByUrl` signature)
