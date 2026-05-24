---
phase: 05
name: Web UI Surface (Server + Frontend)
status: done
priority: medium
effort: M
depends_on: [04]
---

# Phase 05 — Web UI Surface

## Context
- Server: `src/web/server.js` — `POST /api/download` accepts `{url}`, currently ignores `audioOnly`
- HTML: `src/web/public/index.html` — has Karaoke toggle pattern at lines 20-24
- JS: `src/web/public/app.js` — state `isKaraokeMode`, toggle handler, fetch body
- CSS: `src/web/public/style.css` — `.toggle`, `.toggle-slider`, `.toggle-label`, `.options-group`

## Overview
Add "Audio MP3" toggle alongside Karaoke toggle. Mutually exclusive (can't be both at once). Server forwards `audioOnly` to orchestrator. File serving sets correct Content-Type for MP3.

## Key Insights
- Pattern already exists for Karaoke toggle — mirror it for KISS consistency
- File serving currently hardcodes `Content-Type: video/mp4` (line 201) — needs MIME detection
- Mutex: when one toggle is checked, disable the other (better UX than silent override)

## Files to Modify
- `src/web/server.js`
- `src/web/public/index.html`
- `src/web/public/app.js`
- `src/web/public/style.css` (minor, if any)

## Implementation Steps

### `src/web/server.js`

1. **Accept `audioOnly` in `/api/download`** (line 79):
   ```js
   app.post('/api/download', async (req, res) => {
     const { url, audioOnly } = req.body;
     // ... validation unchanged ...
     download(url, {
       audioOnly: !!audioOnly,
       onProgress: (data) => { /* unchanged */ }
     })
     // ...
   ```

2. **Karaoke + audioOnly mutex on backend** (line 218 `/api/karaoke`):
   - If `req.body.audioOnly` truthy AND karaoke route hit → 400. Karaoke is separate flow; not relevant here unless frontend bug.
   - Actually karaoke endpoint doesn't accept audioOnly — leave it; mutex enforced client-side.

3. **Dynamic Content-Type for `/api/file/:id`** (line 201):
   ```js
   const ext = filename.toLowerCase().split('.').pop();
   const mimeMap = { mp4: 'video/mp4', mp3: 'audio/mpeg', m4a: 'audio/mp4', jpg: 'image/jpeg' };
   res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
   ```

### `src/web/public/index.html`

1. **Add MP3 toggle inside `.options-group`** (after line 39, before closing `</div>`):
   ```html
   <label class="toggle">
     <input type="checkbox" id="audio-toggle">
     <span class="toggle-slider"></span>
     <span class="toggle-label">Audio MP3</span>
   </label>
   ```

2. **Update subtitle** (line 12) to reflect TikTok inclusion + MP3:
   ```html
   <p class="subtitle">YouTube • Facebook • TikTok</p>
   ```

### `src/web/public/app.js`

1. **Add element ref** (after line 21):
   ```js
   const audioToggle = document.getElementById('audio-toggle');
   ```

2. **Add state** (after line 26):
   ```js
   let isAudioMode = false;
   ```

3. **Mutex toggle handlers**:
   - Update existing karaoke handler:
     ```js
     karaokeToggle.addEventListener('change', () => {
       isKaraokeMode = karaokeToggle.checked;
       if (isKaraokeMode) {
         audioToggle.checked = false;
         isAudioMode = false;
       }
       karaokeOptions.classList.toggle('hidden', !isKaraokeMode);
       updateDownloadBtn();
     });
     ```
   - Add audio handler:
     ```js
     audioToggle.addEventListener('change', () => {
       isAudioMode = audioToggle.checked;
       if (isAudioMode) {
         karaokeToggle.checked = false;
         isKaraokeMode = false;
         karaokeOptions.classList.add('hidden');
       }
       updateDownloadBtn();
     });
     function updateDownloadBtn() {
       downloadBtn.textContent = isKaraokeMode ? 'Create Karaoke'
                                : isAudioMode ? 'Download MP3'
                                : 'Download';
     }
     ```

4. **Include `audioOnly` in download POST body** (line 90):
   ```js
   body: JSON.stringify({ url, audioOnly: isAudioMode })
   ```

5. **Update platform display label when audio mode** (around line 100):
   ```js
   platformDiv.textContent = isAudioMode
     ? `${data.platform.toUpperCase()} • MP3`
     : data.platform.toUpperCase();
   ```

### `src/web/public/style.css`
- Verify `.toggle` styles cover multiple toggles in `.options-group` (likely already does via flex)
- No new CSS expected; if toggles overlap, add `gap: 1rem` to `.options-group`

## Architecture
```
Browser
  ├─ Audio MP3 toggle ─┐
  │                    ├─ mutex via JS
  ├─ Karaoke toggle ───┘
  │
  └─ POST /api/download {url, audioOnly: true}
        └─ server.js → download(url, {audioOnly: true})
              └─ orchestrator → handler → mp3 file
                    └─ GET /api/file/:id → Content-Type: audio/mpeg
```

## Todo
- [ ] Modify `server.js`: parse `audioOnly` from body, pass to download
- [ ] Modify `server.js`: dynamic Content-Type for file serve
- [ ] Modify `index.html`: add audio toggle + subtitle
- [ ] Modify `app.js`: ref, state, mutex handlers, body field, label
- [ ] Verify `style.css` looks OK (manual visual check)
- [ ] E2E test in browser:
  - Toggle Audio MP3 → URL field → Download MP3
  - Check Karaoke toggle → Audio auto-unchecks (mutex)
  - Click download link → mp3 file downloads w/ correct extension
  - Mobile responsive check (320px viewport)

## Success Criteria
- Both toggles visible, mutually exclusive
- MP3 download via web UI produces same result as CLI
- Browser shows correct file name + extension in download
- No regression on existing video / karaoke flows

## Risks
- **Browser caches old app.js** → hint user hard-refresh; consider bumping cache-buster query string
- **Mobile layout**: 2 toggles may stack — check `.options-group` flex-wrap

## Security
- `audioOnly` from body is boolean-coerced (`!!`) — safe
- Filename in Content-Disposition is URL-encoded (existing pattern)

## Next
→ Phase 06 (Tests + docs update)
