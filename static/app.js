// ────────────────────────────────────────────────────────────
//  State
// ────────────────────────────────────────────────────────────
let currentDownloadId = null;
let progressInterval  = null;
let floatingToastId   = null; // tracks the active downloading toast
let isLoadingState = false; // prevent infinite loop during state loading

// ────────────────────────────────────────────────────────────
//  Theme Management
// ────────────────────────────────────────────────────────────
function applyTheme() {
    try {
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            if (settings.theme === 'light') {
                document.body.setAttribute('data-theme', 'light');
            } else if (settings.theme === 'dark') {
                document.body.removeAttribute('data-theme');
            }
        }
    } catch (error) {
        console.error('Error applying theme:', error);
    }
}

// ────────────────────────────────────────────────────────────
//  LocalStorage Persistence
// ────────────────────────────────────────────────────────────
function saveState() {
    try {
        const state = {
            currentTab: document.querySelector('.tab-btn.active')?.dataset.tab || 'downloader',
            urlInput: document.getElementById('urlInput').value,
            currentDownloadId: currentDownloadId,
            timestamp: Date.now()
        };
        localStorage.setItem('youtubeDownloaderState', JSON.stringify(state));
    } catch (error) {
        console.error('Error saving state:', error);
    }
}

function loadState() {
    if (isLoadingState) return;
    isLoadingState = true;
    
    try {
        const saved = localStorage.getItem('youtubeDownloaderState');
        if (saved) {
            const state = JSON.parse(saved);
            
            // Restore tab
            if (state.currentTab) {
                const tabBtn = document.querySelector(`.tab-btn[data-tab="${state.currentTab}"]`);
                if (tabBtn) {
                    // Manually set tab without calling switchTab to avoid recursion
                    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
                    tabBtn.classList.add('active');
                    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
                    
                    if (state.currentTab === 'queue') {
                        const queueSection = document.getElementById('queueSection');
                        if (queueSection) {
                            queueSection.classList.remove('hidden');
                            updateQueue();
                        }
                    } else if (state.currentTab === 'history') {
                        const historySection = document.getElementById('historySection');
                        if (historySection) {
                            historySection.classList.remove('hidden');
                            loadHistory();
                        }
                    }
                }
            }
            
            // Restore URL input
            if (state.urlInput) {
                const urlInput = document.getElementById('urlInput');
                if (urlInput) {
                    urlInput.value = state.urlInput;
                }
            }
            
            // Restore download ID if recent (within 5 minutes)
            if (state.currentDownloadId && state.timestamp) {
                const age = Date.now() - state.timestamp;
                if (age < 300000) { // 5 minutes
                    currentDownloadId = state.currentDownloadId;
                }
            }
        }
    } catch (error) {
        console.error('Error loading state:', error);
    } finally {
        isLoadingState = false;
    }
}

// ────────────────────────────────────────────────────────────
//  LocalStorage Persistence
// ────────────────────────────────────────────────────────────
function saveState() {
    const state = {
        currentTab: document.querySelector('.tab-btn.active')?.dataset.tab || 'downloader',
        urlInput: document.getElementById('urlInput').value,
        currentDownloadId: currentDownloadId,
        downloadQueue: download_queue || []
    };
    localStorage.setItem('youtubeDownloaderState', JSON.stringify(state));
}

function loadState() {
    try {
        const saved = localStorage.getItem('youtubeDownloaderState');
        if (saved) {
            const state = JSON.parse(saved);
            
            // Restore tab
            if (state.currentTab) {
                switchTab(state.currentTab);
            }
            
            // Restore URL input
            if (state.urlInput) {
                document.getElementById('urlInput').value = state.urlInput;
            }
            
            // Restore download ID
            if (state.currentDownloadId) {
                currentDownloadId = state.currentDownloadId;
            }
            
            // Restore queue
            if (state.downloadQueue && Array.isArray(state.downloadQueue)) {
                // Queue will be restored via API calls
            }
        }
    } catch (error) {
        console.error('Error loading state:', error);
    }
}

// Auto-save state on changes
const originalSwitchTab = switchTab;
switchTab = function(tabName) {
    originalSwitchTab(tabName);
    saveState();
};

const originalUrlInput = document.getElementById('urlInput');
if (originalUrlInput) {
    originalUrlInput.addEventListener('input', saveState);
}

// ────────────────────────────────────────────────────────────
//  Init
// ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Apply theme first
    applyTheme();
    
    document.getElementById('fetchBtn').addEventListener('click', fetchVideoInfo);
    document.getElementById('pasteBtn').addEventListener('click', pasteFromClipboard);
    document.getElementById('dismissVideoBtn').addEventListener('click', dismissVideo);
    document.getElementById('previewBtn').addEventListener('click', showVideoPreview);
    document.getElementById('closePreviewBtn').addEventListener('click', hideVideoPreview);
    document.getElementById('templateHelpBtn').addEventListener('click', showTemplateHelp);
    document.getElementById('urlInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') fetchVideoInfo();
    });
    document.getElementById('urlInput').addEventListener('paste', handlePaste);
    document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);

    // Quality preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => selectPreset(btn.dataset.preset));
    });

    // Pause/Resume buttons
    document.getElementById('pauseBtn').addEventListener('click', pauseDownload);
    document.getElementById('resumeBtn').addEventListener('click', resumeDownload);

    // Cancel button inside main download-progress section
    const cancelMainBtn = document.getElementById('cancelMainBtn');
    if (cancelMainBtn) {
        cancelMainBtn.addEventListener('click', () => cancelCurrentDownload());
    }

    // Browser notification permission
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    loadHistory();
    loadState(); // Load saved state
    setInterval(updateQueue, 2000);
    
    // Save state periodically
    setInterval(saveState, 5000);
});

// ────────────────────────────────────────────────────────────
//  Paste from clipboard
// ────────────────────────────────────────────────────────────
async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        document.getElementById('urlInput').value = text;
        // Auto-focus the input after pasting
        document.getElementById('urlInput').focus();
        // Auto-fetch if enabled
        if (autoFetchEnabled) {
            fetchVideoInfo();
        }
    } catch (error) {
        console.error('Failed to read clipboard:', error);
        showError('Unable to access clipboard. Please paste manually.');
    }
}

// ────────────────────────────────────────────────────────────
//  Auto-fetch on paste
// ────────────────────────────────────────────────────────────
let autoFetchEnabled = true;

function handlePaste(e) {
    // Add small delay to allow paste to complete
    setTimeout(() => {
        if (autoFetchEnabled && document.getElementById('urlInput').value.trim()) {
            fetchVideoInfo();
        }
    }, 100);
}

// ────────────────────────────────────────────────────────────
//  Quality Presets
// ────────────────────────────────────────────────────────────
let selectedPreset = null;

function selectPreset(preset) {
    // Update UI
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === preset);
    });
    
    selectedPreset = preset;
    
    // Auto-select appropriate format based on preset
    const formatCards = document.querySelectorAll('.format-card');
    if (formatCards.length === 0) return;
    
    let targetIndex = 0;
    switch(preset) {
        case 'best':
            targetIndex = 0; // First (highest quality)
            break;
        case 'smallest':
            targetIndex = formatCards.length - 1; // Last (lowest quality)
            break;
        case 'audio':
            // For audio, we'll use the middle format as placeholder
            // Real implementation would need separate audio-only formats
            targetIndex = Math.floor(formatCards.length / 2);
            break;
    }
    
    // Highlight the selected format
    formatCards.forEach((card, index) => {
        card.style.border = index === targetIndex ? '2px solid var(--primary-color)' : '1px solid var(--glass-border)';
    });
    
    // Auto-click download on the highlighted format
    const targetCard = formatCards[targetIndex];
    const downloadBtn = targetCard.querySelector('.btn-download');
    if (downloadBtn) {
        // Small delay to show the highlight first
        setTimeout(() => downloadBtn.click(), 300);
    }
}

// ────────────────────────────────────────────────────────────
//  Video Preview
// ────────────────────────────────────────────────────────────
function showVideoPreview() {
    const url = document.getElementById('urlInput').value.trim();
    if (!url) return;
    
    // Extract video ID for YouTube embed
    const videoId = extractYouTubeID(url);
    if (!videoId) {
        showError('Unable to generate preview for this URL');
        return;
    }
    
    const embedUrl = `https://www.youtube.com/embed/${videoId}`;
    document.getElementById('previewFrame').src = embedUrl;
    document.getElementById('previewModal').classList.remove('hidden');
}

function hideVideoPreview() {
    document.getElementById('previewModal').classList.add('hidden');
    document.getElementById('previewFrame').src = '';
}

function extractYouTubeID(url) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

// ────────────────────────────────────────────────────────────
//  Filename Template Help
// ────────────────────────────────────────────────────────────
function showTemplateHelp() {
    const content = 'Available variables: {title}, {uploader}, {date}, {quality}, {id}<br><br>Example: {title}_{quality}_{date}.mp4<br>This will create: "Video Title_1080p_2024-08-07.mp4"';
    
    customModal({
        title: 'Filename Templates',
        content,
        confirmText: 'OK',
        showCancel: false
    });
}

// ────────────────────────────────────────────────────────────
//  Pause & Resume Downloads
// ────────────────────────────────────────────────────────────
async function pauseDownload() {
    if (!currentDownloadId) return;
    
    try {
        const response = await fetch(`/api/download/pause/${currentDownloadId}`, { method: 'POST' });
        if (response.ok) {
            document.getElementById('pauseBtn').classList.add('hidden');
            document.getElementById('resumeBtn').classList.remove('hidden');
        } else {
            showError('Pause functionality is limited - download will continue in background');
        }
    } catch (error) {
        console.error('Error pausing download:', error);
        showError('Unable to pause download');
    }
}

async function resumeDownload() {
    if (!currentDownloadId) return;
    
    try {
        const response = await fetch(`/api/download/resume/${currentDownloadId}`, { method: 'POST' });
        if (response.ok) {
            document.getElementById('resumeBtn').classList.add('hidden');
            document.getElementById('pauseBtn').classList.remove('hidden');
        } else {
            showError('Resume functionality is limited for this download');
        }
    } catch (error) {
        console.error('Error resuming download:', error);
        showError('Unable to resume download');
    }
}

// ────────────────────────────────────────────────────────────
//  Dismiss video info
// ────────────────────────────────────────────────────────────
function dismissVideo() {
    hideAllSections();
    document.getElementById('urlInput').value = '';
    document.getElementById('urlInput').focus();
}

// ────────────────────────────────────────────────────────────
//  Fetch video info
// ────────────────────────────────────────────────────────────
async function fetchVideoInfo() {
    const url = document.getElementById('urlInput').value.trim();
    if (!url) { showError('Please enter a YouTube URL'); return; }

    hideAllSections();
    showLoading();

    try {
        const response = await fetch('/api/video-info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to fetch video info');
        displayVideoInfo(data);
    } catch (error) {
        showError(error.message);
    }
}

// ────────────────────────────────────────────────────────────
//  Display video info & formats
// ────────────────────────────────────────────────────────────
function displayVideoInfo(data) {
    hideLoading();

    document.getElementById('thumbnail').src = data.thumbnail;
    document.getElementById('videoTitle').textContent = data.title;
    document.getElementById('videoUploader').textContent = data.uploader;
    document.getElementById('videoDuration').textContent = data.duration_human;
    document.getElementById('videoViews').textContent = formatViews(data.view_count);
    document.getElementById('videoInfo').classList.remove('hidden');

    if (data.note) {
        const formatSection = document.getElementById('formatSelection');
        const existingNote = formatSection.querySelector('.compatibility-note');
        if (existingNote) existingNote.remove();
        const note = document.createElement('div');
        note.className = 'compatibility-note';
        note.textContent = data.note;
        formatSection.insertBefore(note, formatSection.firstChild);
    }

    displayFormats(data.formats);
}

function displayFormats(formats) {
    const formatList = document.getElementById('formatList');
    formatList.innerHTML = '';

    formats.forEach(format => {
        const card = document.createElement('div');
        card.className = 'format-card';
        
        // Add actual resolution note if different from standard
        const actualNote = format.actual_resolution && format.actual_resolution !== format.resolution 
            ? `<span class="actual-res-note">(${format.actual_resolution})</span>` 
            : '';
        
        card.innerHTML = `
            <div class="format-info">
                <span class="resolution">${format.resolution}${actualNote}</span>
                <span class="format-ext">MP4</span>
            </div>
            <div class="format-details">
                <span class="filesize">${format.filesize_human}</span>
                <span class="fps">${format.fps} fps</span>
                <span class="codec">H.264</span>
            </div>
            <button class="btn-download" data-format-id="${format.id}">Download</button>
        `;
        card.querySelector('.btn-download').addEventListener('click', () => startDownload(format.id));
        formatList.appendChild(card);
    });

    document.getElementById('formatSelection').classList.remove('hidden');
}

// ────────────────────────────────────────────────────────────
//  Start download
// ────────────────────────────────────────────────────────────
async function startDownload(formatId) {
    const url            = document.getElementById('urlInput').value.trim();
    const title          = document.getElementById('videoTitle').textContent;
    const resolution     = document.querySelector(`.btn-download[data-format-id="${formatId}"]`)
                               .closest('.format-card').querySelector('.resolution').textContent;
    const customFilename = document.getElementById('filenameInput').value.trim();

    try {
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, format_id: formatId, title, resolution, custom_filename: customFilename, preset: selectedPreset })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to start download');

        currentDownloadId = data.download_id;

        // Hide format panel, show in-page progress section
        document.getElementById('formatSelection').classList.add('hidden');
        document.getElementById('downloadProgress').classList.remove('hidden');

        // Show Cobalt-style floating card (top-right)
        showFloatingDownloadCard(currentDownloadId, title, resolution);

        // Switch to queue tab
        switchTab('queue');

        // Poll progress
        if (progressInterval) clearInterval(progressInterval);
        progressInterval = setInterval(checkProgress, 1000);

    } catch (error) {
        showError(error.message);
    }
}

// ────────────────────────────────────────────────────────────
//  Floating "Cobalt-style" progress card
// ────────────────────────────────────────────────────────────
function showFloatingDownloadCard(downloadId, title, resolution) {
    // Remove previous if any
    const existing = document.getElementById('floating-dl-card');
    if (existing) existing.remove();

    const container = document.getElementById('toastContainer');
    if (!container) return;

    const card = document.createElement('div');
    card.className = 'toast-card downloading';
    card.id = 'floating-dl-card';
    card.innerHTML = `
        <div class="toast-icon" style="background:rgba(99,102,241,0.15);color:#818cf8;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="8 17 12 21 16 17"></polyline>
                <line x1="12" y1="21" x2="12" y2="3"></line>
            </svg>
        </div>
        <div class="toast-body">
            <div class="toast-title" id="fdc-title">${escapeHtml(title)}</div>
            <div class="toast-message">
                <span id="fdc-resolution">${escapeHtml(resolution)}</span>
                &nbsp;·&nbsp;
                <span id="fdc-speed">Starting…</span>
            </div>
            <div class="toast-progress-bar-container">
                <div class="toast-progress-fill" id="fdc-bar"></div>
            </div>
            <div class="toast-stats">
                <span id="fdc-percent" class="toast-percent">0%</span>
                <span id="fdc-eta">ETA: —</span>
            </div>
            <div class="toast-actions" style="margin-top:8px;">
                <button class="btn-toast-stop" id="fdc-stop-btn">
                    ✕ Stop Download
                </button>
            </div>
        </div>
    `;

    container.appendChild(card);
    requestAnimationFrame(() => card.classList.add('show'));

    document.getElementById('fdc-stop-btn').addEventListener('click', () => {
        cancelCurrentDownload();
    });

    floatingToastId = downloadId;
}

function updateFloatingCard(data) {
    const card = document.getElementById('floating-dl-card');
    if (!card) return;

    const pct  = parseFloat(data.progress) || 0;
    const bar  = document.getElementById('fdc-bar');
    const pctEl = document.getElementById('fdc-percent');
    const speedEl = document.getElementById('fdc-speed');
    const etaEl   = document.getElementById('fdc-eta');

    if (bar)     bar.style.width = `${pct}%`;
    if (pctEl)   pctEl.textContent = `${pct.toFixed(1)}%`;
    if (speedEl) speedEl.textContent = data.speed || '—';
    if (etaEl)   etaEl.textContent  = data.eta ? `ETA: ${data.eta}` : 'ETA: —';
}

function dismissFloatingCard(success = true, downloadId = null) {
    const card = document.getElementById('floating-dl-card');
    if (!card) return;

    if (success) {
        // Transition to completion card
        card.classList.remove('downloading');
        card.style.borderColor = 'rgba(16,185,129,0.4)';
        card.style.boxShadow = '0 12px 32px rgba(0,0,0,0.5), 0 0 20px rgba(16,185,129,0.15)';
        card.innerHTML = `
            <div class="toast-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </div>
            <div class="toast-body">
                <div class="toast-title">Download Complete! 🎉</div>
                <div class="toast-message" id="fdc-complete-title"></div>
                <div class="toast-actions" style="margin-top:8px;">
                    ${downloadId ? `<button class="btn-toast-save" onclick="downloadFile('${downloadId}')">Save File</button>` : ''}
                </div>
            </div>
            <button class="toast-close" onclick="this.closest('.toast-card').remove()">&times;</button>
        `;
        // Fill in title safely
        const titleEl = document.querySelector('#floating-dl-card .toast-message');
        if (titleEl) titleEl.textContent = document.getElementById('videoTitle')?.textContent || 'Your video is ready';

        setTimeout(() => {
            card.classList.remove('show');
            setTimeout(() => card.remove(), 400);
        }, 7000);
    } else {
        card.classList.remove('show');
        setTimeout(() => card.remove(), 400);
    }

    floatingToastId = null;
}

// ────────────────────────────────────────────────────────────
//  Cancel download
// ────────────────────────────────────────────────────────────
async function cancelCurrentDownload() {
    if (!currentDownloadId) return;

    const dlId = currentDownloadId;
    try {
        await fetch(`/api/download/cancel/${dlId}`, { method: 'POST' });
    } catch (e) { /* server might not respond immediately */ }

    clearInterval(progressInterval);
    progressInterval = null;
    currentDownloadId = null;

    document.getElementById('downloadProgress').classList.add('hidden');
    dismissFloatingCard(false);
    loadHistory();
    showToastNotification('Download Stopped', 'The download was cancelled.', null, 'cancel');
}

// ────────────────────────────────────────────────────────────
//  Poll progress
// ────────────────────────────────────────────────────────────
async function checkProgress() {
    if (!currentDownloadId) return;

    try {
        const response = await fetch(`/api/progress/${currentDownloadId}`);
        const data = await response.json();

        if (data.status === 'not_found') {
            clearInterval(progressInterval);
            showError('Download not found');
            return;
        }

        // Update inline + floating card
        updateProgressUI(data);
        updateFloatingCard(data);

        if (data.status === 'completed') {
            clearInterval(progressInterval);
            const dlId = currentDownloadId;
            currentDownloadId = null;

            document.getElementById('downloadProgress').classList.add('hidden');
            dismissFloatingCard(true, dlId);
            switchTab('history');
            loadHistory();

            // Browser push notification
            if ('Notification' in window && Notification.permission === 'granted') {
                try { new Notification('Download Complete! 🎉', { body: data.title || 'Your video is ready' }); } catch (e) {}
            }

        } else if (data.status === 'cancelled') {
            clearInterval(progressInterval);
            currentDownloadId = null;
            document.getElementById('downloadProgress').classList.add('hidden');
            dismissFloatingCard(false);
            loadHistory();

        } else if (data.status === 'error') {
            clearInterval(progressInterval);
            currentDownloadId = null;
            dismissFloatingCard(false);
            showError(data.error || 'Download failed');
            loadHistory();
        }
    } catch (error) {
        console.error('Error checking progress:', error);
    }
}

// ────────────────────────────────────────────────────────────
//  Progress UI (inline section)
// ────────────────────────────────────────────────────────────
function updateProgressUI(data) {
    const bar     = document.getElementById('progressBar');
    const pctEl   = document.getElementById('progressPercent');
    const speedEl = document.getElementById('downloadSpeed');
    const etaEl   = document.getElementById('downloadETA');
    const pct     = parseFloat(data.progress) || 0;

    if (bar)     bar.style.width = `${pct}%`;
    if (pctEl)   pctEl.textContent = `${pct.toFixed(1)}%`;
    if (speedEl) speedEl.textContent = `Speed: ${data.speed || '—'}`;

    if (etaEl) {
        if (data.queue_position > 1) {
            etaEl.textContent = `Queue: ${data.queue_position}/${data.total_in_queue}`;
        } else {
            etaEl.textContent = `ETA: ${data.eta || '—'}`;
        }
    }
}

// ────────────────────────────────────────────────────────────
//  Toast notification (success / cancel)
// ────────────────────────────────────────────────────────────
function showToastNotification(title, message, downloadId, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const isSuccess = (type === 'success');
    const iconColor  = isSuccess ? '#10b981' : '#f59e0b';
    const borderColor = isSuccess ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.3)';

    const toast = document.createElement('div');
    toast.className = 'toast-card';
    toast.style.borderColor = borderColor;
    toast.innerHTML = `
        <div class="toast-icon" style="background:${iconColor}1a;color:${iconColor};">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                ${isSuccess
                    ? '<polyline points="20 6 9 17 4 12"></polyline>'
                    : '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>'}
            </svg>
        </div>
        <div class="toast-body">
            <div class="toast-title">${escapeHtml(title)}</div>
            <div class="toast-message" id="stn-msg"></div>
            ${isSuccess && downloadId ? `
            <div class="toast-actions" style="margin-top:8px;">
                <button class="btn-toast-save" onclick="downloadFile('${downloadId}')">Save File</button>
            </div>` : ''}
        </div>
        <button class="toast-close" onclick="this.closest('.toast-card').remove()">&times;</button>
    `;

    // Safely set message text
    const msgEl = toast.querySelector('#stn-msg');
    if (msgEl) msgEl.textContent = message;

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 6000);
}

// ────────────────────────────────────────────────────────────
//  Save / download file
// ────────────────────────────────────────────────────────────
function downloadFile(downloadId) {
    if (downloadId) {
        // Create a hidden iframe to trigger download without leaving the page
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = `/api/download-file/${downloadId}`;
        document.body.appendChild(iframe);
        
        // Remove iframe after a short delay
        setTimeout(() => {
            document.body.removeChild(iframe);
        }, 1000);
    }
}

async function openFile(downloadId) {
    try {
        const response = await fetch(`/api/open-file/${downloadId}`);
        const data = await response.json();
        
        if (data.filepath) {
            // Show file path with copy button (browsers block direct file opening)
            const content = `File path:<br><br><code style="background:var(--input-bg);padding:8px;border-radius:4px;display:block;word-break:break-all;">${escapeHtml(data.filepath)}</code><br><br>Click "Copy" to copy this path, then paste it in File Explorer to open the file.`;
            
            customModal({
                title: 'File Location',
                content,
                confirmText: 'Copy Path',
                onConfirm: async () => {
                    await navigator.clipboard.writeText(data.filepath);
                    showNotification('Path copied to clipboard!');
                }
            });
        } else {
            showError('File not found');
        }
    } catch (error) {
        console.error('Error opening file:', error);
        showError('Unable to open file');
    }
}

async function openFolder(downloadId) {
    try {
        const response = await fetch(`/api/open-folder/${downloadId}`);
        const data = await response.json();
        
        if (data.folderpath) {
            // Show folder path with copy button (browsers block direct folder opening)
            const content = `Folder path:<br><br><code style="background:var(--input-bg);padding:8px;border-radius:4px;display:block;word-break:break-all;">${escapeHtml(data.folderpath)}</code><br><br>Click "Copy" to copy this path, then paste it in File Explorer to open the folder.`;
            
            customModal({
                title: 'Folder Location',
                content,
                confirmText: 'Copy Path',
                onConfirm: async () => {
                    await navigator.clipboard.writeText(data.folderpath);
                    showNotification('Path copied to clipboard!');
                }
            });
        } else {
            showError('Folder not found');
        }
    } catch (error) {
        console.error('Error opening folder:', error);
        showError('Unable to open folder');
    }
}

// ────────────────────────────────────────────────────────────
//  Delete a history item (file + record)
// ────────────────────────────────────────────────────────────
async function deleteHistoryItem(downloadId, btn) {
    dangerModal(
        'Delete Video',
        'Are you sure you want to delete this video and remove it from history? This action cannot be undone.',
        async () => {
            try {
                const response = await fetch(`/api/history/delete/${downloadId}`, { method: 'POST' });
                if (response.ok) {
                    // Animate removal
                    const row = btn.closest('.history-item');
                    if (row) {
                        row.style.transition = 'opacity 0.3s, transform 0.3s';
                        row.style.opacity = '0';
                        row.style.transform = 'translateX(30px)';
                        setTimeout(() => loadHistory(), 350);
                    } else {
                        loadHistory();
                    }
                }
            } catch (e) {
                console.error('Error deleting item:', e);
            }
        }
    );
}

// ────────────────────────────────────────────────────────────
//  Modal helpers (removed - using modal.js instead)
// ────────────────────────────────────────────────────────────

// Simple notification function
function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: var(--primary-color);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        z-index: 2000;
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, 2000);
}

// Download notification function
function showDownloadNotification(title, status, videoTitle) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast-card';
    
    let iconSvg = '';
    let color = '';
    let borderColor = '';
    
    switch(status) {
        case 'started':
            iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="8 17 12 21 16 17"></polyline><line x1="12" y1="21" x2="12" y2="3"></line></svg>';
            color = '#3b82f6';
            borderColor = 'rgba(59,130,246,0.4)';
            break;
        case 'completed':
            iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            color = '#10b981';
            borderColor = 'rgba(16,185,129,0.4)';
            break;
        case 'paused':
            iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
            color = '#f59e0b';
            borderColor = 'rgba(245,158,11,0.3)';
            break;
        case 'resumed':
            iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
            color = '#3b82f6';
            borderColor = 'rgba(59,130,246,0.4)';
            break;
        case 'cancelled':
            iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            color = '#ef4444';
            borderColor = 'rgba(239,68,68,0.4)';
            break;
        default:
            iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12.01" y2="16"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
            color = '#6b7280';
            borderColor = 'rgba(107,114,128,0.4)';
    }
    
    toast.style.borderColor = borderColor;
    toast.innerHTML = `
        <div class="toast-icon" style="background:${color}1a;color:${color};">${iconSvg}</div>
        <div class="toast-body">
            <div class="toast-title">${escapeHtml(title)}</div>
            <div class="toast-message">${escapeHtml(videoTitle)}</div>
        </div>
        <button class="toast-close" onclick="this.closest('.toast-card').remove()">&times;</button>
    `;
    
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// ────────────────────────────────────────────────────────────
//  Loading / error helpers
// ────────────────────────────────────────────────────────────
function showLoading() {
    document.getElementById('loadingSpinner').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loadingSpinner').classList.add('hidden');
}

function showError(message) {
    hideLoading();
    document.getElementById('errorText').textContent = message;
    document.getElementById('errorMessage').classList.remove('hidden');
}

function hideAllSections() {
    document.getElementById('videoInfo').classList.add('hidden');
    document.getElementById('formatSelection').classList.add('hidden');
    document.getElementById('downloadProgress').classList.add('hidden');
    document.getElementById('errorMessage').classList.add('hidden');
}

// ────────────────────────────────────────────────────────────
//  Format helpers
// ────────────────────────────────────────────────────────────
function formatViews(views) {
    if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M views`;
    if (views >= 1_000)     return `${(views / 1_000).toFixed(1)}K views`;
    return `${views} views`;
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const diff = Date.now() - date;
    if (diff < 60_000)       return 'Just now';
    if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)}h ago`;
    return date.toLocaleDateString();
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str || ''));
    return d.innerHTML;
}

// ────────────────────────────────────────────────────────────
//  Tab switching
// ────────────────────────────────────────────────────────────
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.tab === tabName)
    );
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));

    if (tabName === 'queue') {
        document.getElementById('queueSection').classList.remove('hidden');
        updateQueue();
    } else if (tabName === 'history') {
        document.getElementById('historySection').classList.remove('hidden');
        loadHistory();
    }
    
    // Only save state if not loading (prevents recursion)
    if (!isLoadingState) {
        saveState();
    }
}

// ────────────────────────────────────────────────────────────
//  History
// ────────────────────────────────────────────────────────────
async function loadHistory() {
    try {
        const response = await fetch('/api/history');
        const history  = await response.json();
        displayHistory(history);
    } catch (e) {
        console.error('Error loading history:', e);
    }
}

function displayHistory(history) {
    const list = document.getElementById('historyList');

    if (!history || history.length === 0) {
        list.innerHTML = '<p class="empty-message">No download history</p>';
        return;
    }

    list.innerHTML = '';
    history.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = `history-item ${item.status}`;

        const isCompleted = item.status === 'completed';
        const statusIcon  = isCompleted ? '✓' : item.status === 'failed' ? '✗' : '⊘';

        div.innerHTML = `
            <div class="history-number">${index + 1}</div>
            <div class="history-info">
                <div class="history-title"></div>
                <div class="history-meta">
                    <span class="history-resolution">${escapeHtml(item.resolution)}</span>
                    <span class="history-time">${formatTime(item.timestamp)}</span>
                </div>
            </div>
            <div class="history-actions">
                ${isCompleted
                    ? `
                        <button class="btn-action" data-id="${item.id}" data-action="download" title="Download">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                        </button>
                        <button class="btn-action" data-id="${item.id}" data-action="open" title="Open File">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                        </button>
                        <button class="btn-action" data-id="${item.id}" data-action="folder" title="Open Folder">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 3"></polygon>
                            </svg>
                        </button>
                    `
                    : `<div class="history-status ${item.status}">${statusIcon}</div>`
                }
                <button class="btn-delete-small" data-id="${item.id}" title="Delete video &amp; record">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6l-1 14H6L5 6"></path>
                        <path d="M10 11v6M14 11v6"></path>
                        <path d="M9 6V4h6v2"></path>
                    </svg>
                </button>
            </div>
        `;

        // Set title safely
        div.querySelector('.history-title').textContent = item.title;

        // Action buttons
        div.querySelectorAll('.btn-action').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                
                switch(action) {
                    case 'download':
                        downloadFile(id);
                        break;
                    case 'open':
                        openFile(id);
                        break;
                    case 'folder':
                        openFolder(id);
                        break;
                }
            });
        });

        // Delete button
        const delBtn = div.querySelector('.btn-delete-small');
        if (delBtn) delBtn.addEventListener('click', () => deleteHistoryItem(item.id, delBtn));

        list.appendChild(div);
    });
}

async function clearHistory() {
    dangerModal(
        'Clear History',
        'Are you sure you want to clear all download history? This action cannot be undone.',
        async () => {
            try {
                const response = await fetch('/api/history/clear', { method: 'POST' });
                if (response.ok) loadHistory();
            } catch (e) {
                console.error('Error clearing history:', e);
            }
        }
    );
}

// ────────────────────────────────────────────────────────────
//  Queue
// ────────────────────────────────────────────────────────────
async function updateQueue() {
    try {
        const response = await fetch('/api/queue');
        const queue    = await response.json();
        displayQueue(queue);
    } catch (e) {
        console.error('Error updating queue:', e);
    }
}

function displayQueue(queue) {
    const list = document.getElementById('queueList');

    if (!queue || queue.length === 0) {
        list.innerHTML = '<p class="empty-message">No downloads in queue</p>';
        return;
    }

    list.innerHTML = '';
    queue.forEach((item, index) => {
        const pct = parseFloat(item.progress) || 0;
        const div = document.createElement('div');
        div.className = 'queue-item';
        div.innerHTML = `
            <div class="queue-number">${index + 1}</div>
            <div class="queue-info">
                <div class="queue-title"></div>
                <div class="queue-meta">
                    <span class="queue-resolution">${escapeHtml(item.resolution)}</span>
                    <span class="queue-progress">${pct.toFixed(1)}%</span>
                </div>
            </div>
            <div class="queue-status">
                ${item.status === 'downloading'
                    ? '<div class="mini-spinner"></div>'
                    : item.status === 'completed' ? '✓'
                    : item.status === 'error'     ? '✗'
                    : item.status === 'cancelled' ? '⊘' : '?'}
            </div>
            <button class="btn-cancel-small" data-id="${item.id}" title="Cancel">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        `;

        div.querySelector('.queue-title').textContent = item.title;

        const cancelBtn = div.querySelector('.btn-cancel-small');
        cancelBtn.addEventListener('click', async () => {
            try {
                await fetch(`/api/download/cancel/${item.id}`, { method: 'POST' });
                if (item.id === currentDownloadId) {
                    clearInterval(progressInterval);
                    progressInterval  = null;
                    currentDownloadId = null;
                    document.getElementById('downloadProgress').classList.add('hidden');
                    dismissFloatingCard(false);
                }
                updateQueue();
                loadHistory();
            } catch (e) { console.error('Cancel failed:', e); }
        });

        list.appendChild(div);
    });
}
