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
const resultTitle = document.getElementById('result-title');
const downloadLink = document.getElementById('download-link');
const errorDiv = document.getElementById('error');
const historyList = document.getElementById('history-list');

// State
let currentDownloadId = null;
let pollInterval = null;

// Initialize
loadHistory();

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
    // Start download via API
    const response = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Download failed');
    }

    currentDownloadId = data.downloadId;
    platformDiv.textContent = data.platform.toUpperCase();

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

    if (data.status === 'downloading') {
      const percent = Math.round(data.progress || 0);
      progressFill.style.width = `${percent}%`;

      let text = `${percent}%`;
      if (data.speed) text += ` - ${data.speed}`;
      if (data.eta) text += ` - ETA: ${data.eta}`;
      progressText.textContent = text;

    } else if (data.status === 'complete') {
      clearInterval(pollInterval);
      pollInterval = null;

      progressFill.style.width = '100%';
      progressText.textContent = 'Complete!';

      // Show download result
      resultTitle.textContent = data.result.title || 'Video';
      downloadLink.href = `/api/file/${currentDownloadId}`;
      resultDiv.classList.remove('hidden');
      downloadBtn.disabled = false;

      // Refresh history
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

      li.innerHTML = `
        <span class="platform-tag ${d.platform}">${d.platform}</span>
        <span class="title" title="${d.title || ''}">${title}${d.title && d.title.length > 40 ? '...' : ''}</span>
        <span class="date">${date}</span>
      `;
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
