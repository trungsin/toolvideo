/**
 * Frontend JavaScript for video downloader
 * Handles UI interactions, API calls, and progress polling
 */

// DOM Elements
const urlInput = document.getElementById('url-input');
const downloadBtn = document.getElementById('download-btn');
const statusDiv = document.getElementById('status');
const platformDiv = document.getElementById('platform');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const resultDiv = document.getElementById('result');
const errorDiv = document.getElementById('error');
const historyList = document.getElementById('history-list');
const karaokeToggle = document.getElementById('karaoke-toggle');
const audioToggle = document.getElementById('audio-toggle');
const karaokeOptions = document.getElementById('karaoke-options');
const lyricsSource = document.getElementById('lyrics-source');
const langSelect = document.getElementById('lang-select');

// State
let currentDownloadId = null;
let pollInterval = null;
let isKaraokeMode = false;
let isAudioMode = false;

// Initialize
loadHistory();

// Karaoke toggle handler
karaokeToggle.addEventListener('change', () => {
  isKaraokeMode = karaokeToggle.checked;
  if (isKaraokeMode) {
    audioToggle.checked = false;
    isAudioMode = false;
  }
  karaokeOptions.classList.toggle('hidden', !isKaraokeMode);
  updateDownloadButton();
});

audioToggle.addEventListener('change', () => {
  isAudioMode = audioToggle.checked;
  if (isAudioMode) {
    karaokeToggle.checked = false;
    isKaraokeMode = false;
    karaokeOptions.classList.add('hidden');
  }
  updateDownloadButton();
});

// Event listeners
downloadBtn.addEventListener('click', startDownload);
urlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') startDownload();
});

/**
 * Start download process
 */
async function startDownload() {
  const url = urlInput.value.trim();
  if (!url) {
    showError('Please enter a URL');
    return;
  }

  // Reset UI
  hideAll();
  statusDiv.classList.remove('hidden');
  downloadBtn.disabled = true;
  progressFill.style.width = '0%';
  progressText.textContent = 'Starting...';

  try {
    let response, data;

    if (isKaraokeMode) {
      // Start karaoke conversion
      response = await fetch('/api/karaoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          source: lyricsSource.value,
          language: langSelect.value
        })
      });

      data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Karaoke conversion failed');
      }

      currentDownloadId = data.karaokeId;
      platformDiv.textContent = `${data.platform.toUpperCase()} • KARAOKE`;

    } else {
      // Normal download
      response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, audioOnly: isAudioMode })
      });

      data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Download failed');
      }

      currentDownloadId = data.downloadId;
      platformDiv.textContent = isAudioMode
        ? `${data.platform.toUpperCase()} • MP3`
        : data.platform.toUpperCase();
    }

    // Start polling for progress
    pollInterval = setInterval(checkProgress, 500);

  } catch (error) {
    showError(error.message);
    downloadBtn.disabled = false;
  }
}

/**
 * Poll for download progress
 */
async function checkProgress() {
  if (!currentDownloadId) return;

  try {
    const response = await fetch(`/api/progress/${currentDownloadId}`);
    const data = await response.json();

    const isKaraoke = data.isKaraoke;

    if (data.status === 'downloading' || data.status === 'processing') {
      const percent = Math.round(data.progress || 0);
      progressFill.style.width = `${percent}%`;

      let text = `${percent}%`;
      if (isKaraoke && data.stage) {
        const stageNames = {
          download: 'Downloading',
          extract: 'Extracting audio',
          separate: 'Separating vocals',
          lyrics: 'Fetching lyrics',
          transcribe: 'Transcribing',
          sync: 'Syncing lyrics',
          render: 'Rendering video'
        };
        text = `${stageNames[data.stage] || data.stage} - ${percent}%`;
      } else {
        if (data.speed) text += ` - ${data.speed}`;
        if (data.eta) text += ` - ETA: ${data.eta}`;
      }
      progressText.textContent = text;

    } else if (data.status === 'complete') {
      clearInterval(pollInterval);
      pollInterval = null;

      progressFill.style.width = '100%';
      progressText.textContent = 'Complete!';

      if (isKaraoke) {
        // Show karaoke result with multiple download options
        resultDiv.innerHTML = `
          <div class="result-title">Karaoke Ready!</div>
          <div class="karaoke-downloads">
            <a href="/api/karaoke/file/${currentDownloadId}/video" class="download-link" download>
              Download Karaoke Video
            </a>
            <a href="/api/karaoke/file/${currentDownloadId}/lrc" class="download-link secondary" download>
              Download Lyrics (.lrc)
            </a>
          </div>
          <div class="result-info">
            Segments: ${data.result.segments || 0} | Source: ${data.result.lyricsSource || 'unknown'}
          </div>
        `;
        resultDiv.classList.remove('hidden');
      } else {
        // Normal download result
        renderDownloadResult(data.result.title || 'Video', `/api/file/${currentDownloadId}`);
        resultDiv.classList.remove('hidden');
      }

      downloadBtn.disabled = false;
      loadHistory();

    } else if (data.status === 'error') {
      clearInterval(pollInterval);
      pollInterval = null;

      showError(data.error || 'Download failed');
      downloadBtn.disabled = false;
    }

  } catch (error) {
    // Ignore polling errors - may be temporary network issues
  }
}

/**
 * Load download history
 */
async function loadHistory() {
  try {
    const response = await fetch('/api/history?limit=10');
    const downloads = await response.json();

    historyList.innerHTML = '';

    if (downloads.length === 0) {
      historyList.innerHTML = '<li class="empty">No downloads yet</li>';
      return;
    }

    for (const d of downloads) {
      const li = document.createElement('li');
      const date = new Date(d.created_at).toLocaleDateString();
      const title = (d.title || 'Unknown').substring(0, 40);

      const tag = d.audio_only ? 'mp3' : d.platform;
      const platformTag = document.createElement('span');
      platformTag.className = `platform-tag ${tag}`;
      platformTag.textContent = tag;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'title';
      titleSpan.title = d.title || '';
      titleSpan.textContent = `${title}${d.title && d.title.length > 40 ? '...' : ''}`;

      const dateSpan = document.createElement('span');
      dateSpan.className = 'date';
      dateSpan.textContent = date;

      li.append(platformTag, titleSpan, dateSpan);
      historyList.appendChild(li);
    }

  } catch (error) {
    console.error('Failed to load history:', error);
    historyList.innerHTML = '<li class="empty">Failed to load history</li>';
  }
}

/**
 * Show error message
 */
function showError(message) {
  errorDiv.textContent = message;
  errorDiv.classList.remove('hidden');
  statusDiv.classList.add('hidden');
  resultDiv.classList.add('hidden');
}

/**
 * Hide all status elements
 */
function hideAll() {
  statusDiv.classList.add('hidden');
  resultDiv.classList.add('hidden');
  errorDiv.classList.add('hidden');
}

function updateDownloadButton() {
  downloadBtn.textContent = isKaraokeMode
    ? 'Create Karaoke'
    : isAudioMode
      ? 'Download MP3'
      : 'Download';
}

function renderDownloadResult(title, href) {
  resultDiv.textContent = '';

  const titleEl = document.createElement('div');
  titleEl.className = 'result-title';
  titleEl.textContent = title;

  const linkEl = document.createElement('a');
  linkEl.className = 'download-link';
  linkEl.href = href;
  linkEl.download = true;
  linkEl.textContent = isAudioMode ? 'Download MP3' : 'Download File';

  resultDiv.append(titleEl, linkEl);
}
