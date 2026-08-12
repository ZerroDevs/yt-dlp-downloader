// ────────────────────────────────────────────────────────────
//  State
// ────────────────────────────────────────────────────────────
let currentDownloadId = null;
let progressInterval  = null;
let floatingToastId   = null; // tracks the active downloading toast
let modalCallback     = null; // callback for modal confirm action
let selectedPreset = null;
let autoFetchEnabled = true;

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
//  Mobile Detection
// ────────────────────────────────────────────────────────────
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
           (window.innerWidth <= 768);
}

// ────────────────────────────────────────────────────────────
//  Platform Detection
// ────────────────────────────────────────────────────────────
function detectPlatform(url) {
    const urlLower = url.toLowerCase();
    
    // YouTube patterns
    if (urlLower.includes('youtube.com/watch') || 
        urlLower.includes('youtu.be/') || 
        urlLower.includes('youtube.com/shorts/')) {
        return { name: 'YouTube', color: '#00ff00', emoji: '🟢', supported: true };
    }
    
    // TikTok patterns
    if (urlLower.includes('tiktok.com/@') || 
        urlLower.includes('vm.tiktok.com/') || 
        urlLower.includes('tiktok.com/t/')) {
        return { name: 'TikTok', color: '#a855f7', emoji: '🟣', supported: true };
    }
    
    // Instagram patterns
    if (urlLower.includes('instagram.com/reel') ||
        urlLower.includes('instagram.com/p/') ||
        urlLower.includes('instagram.com/tv/')) {
        return { name: 'Instagram', color: '#ff6b00', emoji: '🟠', supported: true };
    }
    
    // Unsupported
    return { name: 'Unsupported', color: '#ff0000', emoji: '🔴', supported: false };
}

function updatePlatformDisplay(url) {
    const platform = detectPlatform(url);
    const platformDisplay = document.getElementById('platformDisplay');
    
    if (!platformDisplay) {
        // Create platform display element if it doesn't exist
        const inputWrapper = document.querySelector('.input-wrapper');
        if (inputWrapper) {
            const display = document.createElement('div');
            display.id = 'platformDisplay';
            display.className = 'platform-display';
            inputWrapper.appendChild(display);
        }
        return;
    }
    
    platformDisplay.innerHTML = `
        <span class="platform-indicator" style="color: ${platform.color}">
            ${platform.emoji} ${platform.name}
        </span>
    `;
    
    if (!platform.supported && url.trim()) {
        platformDisplay.innerHTML += `
            <span class="platform-error">Only YouTube, TikTok, and Instagram are currently supported.</span>
        `;
    }
}

// ────────────────────────────────────────────────────────────
//  Save/Restore Video Info
// ────────────────────────────────────────────────────────────
function saveVideoInfo(data) {
    try {
        localStorage.setItem('currentVideoInfo', JSON.stringify(data));
    } catch (error) {
        console.error('Error saving video info:', error);
    }
}

function restoreVideoInfo() {
    try {
        const saved = localStorage.getItem('currentVideoInfo');
        if (saved) {
            const data = JSON.parse(saved);
            displayVideoInfo(data);
            // Don't remove it - keep it until user dismisses or starts new download
        }
    } catch (error) {
        console.error('Error restoring video info:', error);
    }
}

function clearVideoInfo() {
    localStorage.removeItem('currentVideoInfo');
}

// ────────────────────────────────────────────────────────────
//  Paste from clipboard
// ────────────────────────────────────────────────────────────
async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        document.getElementById('urlInput').value = text;
        document.getElementById('urlInput').focus();
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
function handlePaste(e) {
    setTimeout(() => {
        if (autoFetchEnabled && document.getElementById('urlInput').value.trim()) {
            fetchVideoInfo();
        }
    }, 100);
}

// ────────────────────────────────────────────────────────────
//  Dismiss video info
// ────────────────────────────────────────────────────────────
function dismissVideo() {
    hideAllSections();
    document.getElementById('urlInput').value = '';
    document.getElementById('urlInput').focus();
    clearVideoInfo();
    localStorage.removeItem('currentUrl');
}

// ────────────────────────────────────────────────────────────
//  Fetch video info
// ────────────────────────────────────────────────────────────
async function fetchVideoInfo() {
    const url = document.getElementById('urlInput').value.trim();
    if (!url) { showError('Please enter a video URL'); return; }
    
    // Check platform support
    const platform = detectPlatform(url);
    if (!platform.supported) {
        showError('Only YouTube, TikTok, and Instagram are currently supported.');
        return;
    }
    
    // Save URL to localStorage
    localStorage.setItem('currentUrl', url);
    
    hideAllSections();
    showLoading();

    try {
        const response = await fetch('/api/video-info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to fetch video info');
        }

        displayVideoInfo(data);
    } catch (error) {
        showError(error.message);
    }
}

function displayVideoInfo(data) {
    hideLoading();
    document.getElementById('thumbnail').src = data.thumbnail;
    document.getElementById('videoTitle').textContent = data.title;
    document.getElementById('videoUploader').textContent = data.uploader;
    document.getElementById('videoDuration').textContent = data.duration_human;
    document.getElementById('videoViews').textContent = formatViews(data.view_count);
    document.getElementById('videoInfo').classList.remove('hidden');

    if (data.note) {
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent = data.note;
        const formatSection = document.getElementById('formatSelection');
        formatSection.insertBefore(note, formatSection.firstChild);
    }

    displayFormats(data.formats);
    
    // Save to localStorage for persistence (including platform)
    saveVideoInfo(data);
}

function displayFormats(formats) {
    const formatList = document.getElementById('formatList');
    formatList.innerHTML = '';

    formats.forEach(format => {
        const card = document.createElement('div');
        card.className = 'format-card';
        
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
                <span class="quality">${format.quality_label || 'Standard'}</span>
            </div>
            <div class="format-actions">
                <button class="btn-download" data-format-id="${format.id}">Download</button>
                <button class="btn-download-player" data-format-id="${format.id}" title="Download to Player">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polygon points="10 8 16 12 10 16 10 8"></polygon>
                    </svg>
                    Player
                </button>
            </div>
        `;
        card.querySelector('.btn-download').addEventListener('click', () => startDownload(format.id));
        card.querySelector('.btn-download-player').addEventListener('click', () => startDownloadToPlayer(format.id));
        formatList.appendChild(card);
    });

    document.getElementById('formatSelection').classList.remove('hidden');
}

// ────────────────────────────────────────────────────────────
//  Quality Presets
// ────────────────────────────────────────────────────────────
function selectPreset(preset) {
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === preset);
    });
    
    selectedPreset = preset;
    
    const formatCards = document.querySelectorAll('.format-card');
    if (formatCards.length === 0) return;
    
    let targetIndex = 0;
    switch(preset) {
        case 'best':
            targetIndex = 0;
            break;
        case 'smallest':
            targetIndex = formatCards.length - 1;
            break;
        case 'audio':
            targetIndex = Math.floor(formatCards.length / 2);
            break;
    }
    
    formatCards.forEach((card, index) => {
        card.style.border = index === targetIndex ? '2px solid var(--primary-color)' : '1px solid var(--glass-border)';
    });
    
    const targetCard = formatCards[targetIndex];
    const downloadBtn = targetCard.querySelector('.btn-download');
    if (downloadBtn) {
        setTimeout(() => downloadBtn.click(), 300);
    }
}

// ────────────────────────────────────────────────────────────
//  Start download
// ────────────────────────────────────────────────────────────
async function startDownload(formatId) {
    const url = document.getElementById('urlInput').value.trim();
    const title = document.getElementById('videoTitle').textContent;
    const card = document.querySelector(`.btn-download[data-format-id="${formatId}"]`).closest('.format-card');
    const resolution = card.querySelector('.resolution').textContent;
    const actualNote = card.querySelector('.actual-res-note');
    const actualResolution = actualNote ? actualNote.textContent.replace(/[()]/g, '') : '';
    const customFilename = document.getElementById('filenameInput').value.trim();

    const thumbnail = document.getElementById('thumbnail').src;
    
    // Get platform from saved video info or detect from URL
    let platform = 'YouTube';
    try {
        const savedVideoInfo = localStorage.getItem('currentVideoInfo');
        if (savedVideoInfo) {
            const videoData = JSON.parse(savedVideoInfo);
            platform = videoData.platform || detectPlatform(url);
        } else {
            platform = detectPlatform(url);
        }
    } catch(e) {
        platform = detectPlatform(url);
    }

    let customFolder = '';
    let filenameTemplate = '{title}_{quality}_{date}';
    try {
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            customFolder = settings.downloadFolder || '';
            filenameTemplate = settings.filenameTemplate || '{title}_{quality}_{date}';
        }
    } catch(e) {}

    try {
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                url, 
                format_id: formatId, 
                title, 
                resolution, 
                actual_resolution: actualResolution,
                thumbnail,
                custom_filename: customFilename, 
                preset: selectedPreset,
                download_folder: customFolder,
                filename_template: filenameTemplate,
                platform: platform,
                uploader: document.getElementById('videoUploader').textContent,
                is_mobile: isMobileDevice()
            })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to start download');

        currentDownloadId = data.download_id;

        // Save to localStorage for global progress widget
        localStorage.setItem('currentDownload', JSON.stringify({
            id: currentDownloadId,
            status: 'downloading',
            title: title,
            resolution: resolution,
            progress: 0,
            speed: '0 KB/s'
        }));

        document.getElementById('formatSelection').classList.add('hidden');
        document.getElementById('downloadProgress').classList.remove('hidden');

        showFloatingDownloadCard(currentDownloadId, title, resolution);

        // Show notification when download starts
        showDownloadNotification('Download Started', 'started', title);

        if (progressInterval) clearInterval(progressInterval);
        progressInterval = setInterval(checkProgress, 1000);

    } catch (error) {
        showError(error.message);
    }
}

// ────────────────────────────────────────────────────────────
//  Download to Player
// ────────────────────────────────────────────────────────────
async function startDownloadToPlayer(formatId) {
    const url = document.getElementById('urlInput').value.trim();
    const title = document.getElementById('videoTitle').textContent;
    const uploader = document.getElementById('videoUploader').textContent;
    const thumbnail = document.querySelector('.video-thumbnail img')?.src || '';
    
    // Get player folder from settings
    let playerFolder = '';
    try {
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            playerFolder = settings.playerFolder || '';
        }
    } catch(e) {}
    
    if (!playerFolder) {
        showError('Please configure player folder in settings first');
        return;
    }
    
    try {
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                url, 
                format_id: formatId, 
                title, 
                download_folder: playerFolder,
                preset: 'audio', // Force audio-only for player
                platform: detectPlatform(url),
                uploader: uploader,
                thumbnail: thumbnail,
                save_metadata: true // Save metadata JSON for player
            })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to start download');

        currentDownloadId = data.download_id;

        document.getElementById('formatSelection').classList.add('hidden');
        document.getElementById('downloadProgress').classList.remove('hidden');

        showFloatingDownloadCard(currentDownloadId, title, 'Audio');

        showDownloadNotification('Download to Player Started', 'started', title);

        if (progressInterval) clearInterval(progressInterval);
        progressInterval = setInterval(checkProgress, 1000);

    } catch (error) {
        showError(error.message);
    }
}

// ────────────────────────────────────────────────────────────
//  Pause & Resume Downloads
// ────────────────────────────────────────────────────────────
async function pauseDownload() {
    if (!currentDownloadId) return;
    
    try {
        const response = await fetch(`/api/download/pause/${currentDownloadId}`, { method: 'POST' });
        const data = await response.json();
        if (response.ok) {
            document.getElementById('pauseBtn').classList.add('hidden');
            document.getElementById('resumeBtn').classList.remove('hidden');
            // Update localStorage for global progress widget
            updateGlobalProgressStatus('paused');
            // Show notification
            const title = document.getElementById('videoTitle').textContent;
            showDownloadNotification('Download Paused', 'paused', title);
        } else {
            // Don't show error for 404 - download might have completed
            if (response.status === 404) {
                console.log('Download not found, may have completed');
            } else {
                showError(data.error || 'Unable to pause download');
            }
        }
    } catch (error) {
        console.error('Error pausing download:', error);
        // Don't show error for network issues, just log it
    }
}

async function resumeDownload() {
    if (!currentDownloadId) return;
    
    try {
        const response = await fetch(`/api/download/resume/${currentDownloadId}`, { method: 'POST' });
        const data = await response.json();
        if (response.ok) {
            document.getElementById('resumeBtn').classList.add('hidden');
            document.getElementById('pauseBtn').classList.remove('hidden');
            // Update localStorage for global progress widget
            updateGlobalProgressStatus('downloading');
            // Show notification
            const title = document.getElementById('videoTitle').textContent;
            showDownloadNotification('Download Resumed', 'resumed', title);
        } else {
            // Don't show error for 404 - download might have completed
            if (response.status === 404) {
                console.log('Download not found, may have completed');
            } else {
                showError(data.error || 'Unable to resume download');
            }
        }
    } catch (error) {
        console.error('Error resuming download:', error);
        // Don't show error for network issues, just log it
    }
}

function updateGlobalProgressStatus(status) {
    const savedDownload = localStorage.getItem('currentDownload');
    if (savedDownload) {
        const download = JSON.parse(savedDownload);
        download.status = status;
        localStorage.setItem('currentDownload', JSON.stringify(download));
        // Trigger storage event for other tabs
        window.dispatchEvent(new StorageEvent('storage', {
            key: 'currentDownload',
            newValue: JSON.stringify(download)
        }));
    }
}

// ────────────────────────────────────────────────────────────
//  Video Preview
// ────────────────────────────────────────────────────────────
function showVideoPreview() {
    const url = document.getElementById('urlInput').value.trim();
    if (!url) return;
    
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
    alertModal(
        'Filename Templates',
        'Available variables: {title}, {uploader}, {date}, {quality}, {id}\n\nExample: {title}_{quality}_{date}.mp4\nThis will create: "Video Title_1080p_2024-08-07.mp4"',
        'Got it'
    );
}

// ────────────────────────────────────────────────────────────
//  Progress checking
// ────────────────────────────────────────────────────────────
async function checkProgress() {
    if (!currentDownloadId) return;

    try {
        const response = await fetch(`/api/progress/${currentDownloadId}`);
        const data = await response.json();

        updateProgressUI(data);
        updateFloatingCard(data);

        if (data.status === 'completed') {
            clearInterval(progressInterval);
            const dlId = currentDownloadId;
            currentDownloadId = null;
            localStorage.removeItem('currentDownload');

            document.getElementById('downloadProgress').classList.add('hidden');
            dismissFloatingCard(true, dlId);
            
            // If on mobile, automatically trigger file download to device
            if (isMobileDevice()) {
                try {
                    const downloadResponse = await fetch(`/api/download-file/${dlId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    
                    if (downloadResponse.ok) {
                        const blob = await downloadResponse.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = data.filename || 'download.mp4';
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                        showDownloadNotification('Downloaded to device', 'completed', data.title);
                    }
                } catch (e) {
                    console.error('Error downloading to mobile device:', e);
                }
            }

            // Show notification when download completes
            showDownloadNotification('Download Complete', 'completed', data.title || 'Your video is ready');

            if ('Notification' in window && Notification.permission === 'granted') {
                try { new Notification('Download Complete! 🎉', { body: data.title || 'Your video is ready' }); } catch (e) {}
            }

            // Auto-upload to cloud if enabled
            try {
                const savedSettings = localStorage.getItem('ytDownloaderSettings');
                if (savedSettings) {
                    const settings = JSON.parse(savedSettings);
                    if (settings.autoUpload && settings.b2BucketName && settings.b2EndpointUrl && 
                        settings.b2KeyId && settings.b2ApplicationKey) {
                        // Trigger auto-upload
                        autoUploadToCloud(dlId, settings);
                    }
                }
            } catch (e) {
                console.error('Error checking auto-upload settings:', e);
            }

        } else if (data.status === 'cancelled') {
            clearInterval(progressInterval);
            currentDownloadId = null;
            localStorage.removeItem('currentDownload');
            document.getElementById('downloadProgress').classList.add('hidden');
            dismissFloatingCard(false);

        } else if (data.status === 'error') {
            clearInterval(progressInterval);
            currentDownloadId = null;
            localStorage.removeItem('currentDownload');
            dismissFloatingCard(false);
            showError(data.error || 'Download failed');
        }
    } catch (error) {
        console.error('Error checking progress:', error);
    }
}

function updateProgressUI(data) {
    const bar     = document.getElementById('progressBar');
    const pctEl   = document.getElementById('progressPercent');
    const speedEl = document.getElementById('downloadSpeed');
    const etaEl   = document.getElementById('downloadETA');
    const sizeEl  = document.getElementById('downloadSize');
    const pct     = parseFloat(data.progress) || 0;

    if (bar)     bar.style.width = `${pct}%`;
    if (pctEl)   pctEl.textContent = `${pct.toFixed(1)}%`;
    if (speedEl) speedEl.textContent = `Speed: ${data.speed || '—'}`;
    if (etaEl)   etaEl.textContent = `ETA: ${data.eta || 'Unknown'}`;
    if (sizeEl)  sizeEl.textContent = `Size: ${data.size || 'Unknown'}`;
    
    // Update localStorage for global progress widget
    localStorage.setItem('currentDownload', JSON.stringify({
        id: currentDownloadId,
        status: data.status,
        title: data.title,
        progress: data.progress,
        speed: data.speed,
        size: data.size
    }));
}

// ────────────────────────────────────────────────────────────
//  Floating "Cobalt-style" progress card
// ────────────────────────────────────────────────────────────
function showFloatingDownloadCard(downloadId, title, resolution) {
    const existing = document.getElementById('floating-dl-card');
    if (existing) existing.remove();

    const container = document.getElementById('toastContainer');
    if (!container) return;

    const card = document.createElement('div');
    card.className = 'toast-card downloading';
    card.id = 'floating-dl-card';
    card.innerHTML = `
        <div class="toast-content">
            <div class="toast-title">${escapeHtml(title)}</div>
            <div class="toast-meta">
                <span class="toast-resolution">${escapeHtml(resolution)}</span>
                <span class="toast-status" id="fdc-speed">Starting…</span>
            </div>
            <div class="toast-progress-bar-container">
                <div class="toast-progress-fill" id="fdc-fill" style="width: 0%"></div>
            </div>
            <div class="toast-stats">
                <span class="toast-percent" id="fdc-pct">0%</span>
            </div>
            <div style="margin-top:8px;text-align:right;">
                <button class="btn-toast-stop" id="fdc-stop-btn" style="
                    background:rgba(239,68,68,0.15);
                    border:1px solid rgba(239,68,68,0.4);
                    color:#f87171;
                    padding:4px 12px;
                    border-radius:6px;
                    cursor:pointer;
                    font-size:0.8rem;
                    font-family:inherit;
                ">✕ Stop</button>
            </div>
        </div>
    `;
    container.appendChild(card);
    floatingToastId = downloadId;
    requestAnimationFrame(() => card.classList.add('show'));

    document.getElementById('fdc-stop-btn').addEventListener('click', () => cancelCurrentDownload());
}

function updateFloatingCard(data) {
    const card = document.getElementById('floating-dl-card');
    if (!card) return;

    const fill    = document.getElementById('fdc-fill');
    const pctEl   = document.getElementById('fdc-pct');
    const speedEl = document.getElementById('fdc-speed');

    const percent = parseFloat(data.progress) || 0;
    if (fill)    fill.style.width = `${percent}%`;
    if (pctEl)   pctEl.textContent = `${percent.toFixed(1)}%`;
    if (speedEl) speedEl.textContent = data.speed ? `Speed: ${data.speed}` : 'Speed: --';
}

function dismissFloatingCard(success, downloadId) {
    const card = document.getElementById('floating-dl-card');
    if (!card) return;

    if (success) {
        card.classList.remove('downloading');
        card.classList.add('success');
        const status = card.querySelector('.toast-status');
        if (status) status.textContent = '✓ Complete';
    } else {
        card.classList.remove('downloading');
        card.classList.add('dismissed');
    }

    requestAnimationFrame(() => card.classList.remove('show'));
    setTimeout(() => {
        if (card.parentNode) card.remove();
        floatingToastId = null;
    }, 300);
}

// ────────────────────────────────────────────────────────────
//  Cleanup .part files
// ────────────────────────────────────────────────────────────
async function cleanupPartFiles() {
    try {
        // Get custom download folder if set
        let customFolder = '';
        try {
            const savedSettings = localStorage.getItem('ytDownloaderSettings');
            if (savedSettings) {
                customFolder = JSON.parse(savedSettings).downloadFolder || '';
            }
        } catch(e) {}

        console.log('Starting cleanup with folder:', customFolder);

        const response = await fetch('/api/cleanup-part-files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ download_folder: customFolder })
        });
        
        console.log('Response status:', response.status);
        
        const data = await response.json();
        console.log('Response data:', data);
        
        if (response.ok) {
            if (data.deleted_count > 0) {
                showSimpleToast('Cleanup Complete', `Deleted ${data.deleted_count} .part file(s)`, 'success');
            } else {
                showSimpleToast('Cleanup Complete', 'No .part files found', 'info');
            }
        } else {
            console.error('API error:', data);
            showError(data.error || 'Failed to cleanup .part files');
        }
    } catch (error) {
        console.error('Error cleaning up .part files:', error);
        showError('Failed to cleanup .part files: ' + error.message);
    }
}

function showSimpleToast(title, message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast-card show ${type}`;
    
    let iconSvg = '';
    let color = '';
    
    switch(type) {
        case 'success':
            iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
            color = '#10b981';
            break;
        case 'error':
            iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
            color = '#ef4444';
            break;
        case 'warning':
            iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
            color = '#f59e0b';
            break;
        case 'info':
            iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
            color = '#3b82f6';
            break;
    }
    
    toast.innerHTML = `
        <div class="toast-icon ${type}" style="margin-right: 12px; display: flex; align-items: center; justify-content: center; color: ${color};">${iconSvg}</div>
        <div class="toast-content" style="flex: 1;">
            <div class="toast-title" style="font-weight: 600; font-size: 0.95rem; margin-bottom: 2px;">${title}</div>
            <div class="toast-message" style="font-size: 0.85rem; color: var(--text-muted);">${message}</div>
        </div>
        <button class="toast-close" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; display: flex;" onclick="this.parentElement.remove()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, 5000);
}

// ────────────────────────────────────────────────────────────
//  Cancel current download
// ────────────────────────────────────────────────────────────
async function cancelCurrentDownload() {
    if (!currentDownloadId) return;

    confirmModal(
        'Cancel Download',
        'Are you sure you want to cancel this download?',
        async () => {
            try {
                const response = await fetch(`/api/download/cancel/${currentDownloadId}`, { method: 'POST' });
                if (response.ok) {
                    clearInterval(progressInterval);
                    progressInterval = null;
                    currentDownloadId = null;
                    document.getElementById('downloadProgress').classList.add('hidden');
                    dismissFloatingCard(false);
                    // Show notification
                    const title = document.getElementById('videoTitle').textContent;
                    showDownloadNotification('Download Cancelled', 'cancelled', title);
                }
            } catch (error) {
                console.error('Error cancelling download:', error);
            }
        }
    );
}

// ────────────────────────────────────────────────────────────
//  UI Helpers
// ────────────────────────────────────────────────────────────
function hideAllSections() {
    document.getElementById('loadingSpinner').classList.add('hidden');
    document.getElementById('videoInfo').classList.add('hidden');
    document.getElementById('formatSelection').classList.add('hidden');
    document.getElementById('downloadProgress').classList.add('hidden');
    document.getElementById('errorMessage').classList.add('hidden');
}

function showLoading() {
    document.getElementById('loadingSpinner').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loadingSpinner').classList.add('hidden');
}

function showError(message) {
    document.getElementById('errorText').textContent = message;
    document.getElementById('errorMessage').classList.remove('hidden');
}

function formatViews(views) {
    if (!views) return '0 views';
    if (views >= 1000000) return (views / 1000000).toFixed(1) + 'M views';
    if (views >= 1000) return (views / 1000).toFixed(1) + 'K views';
    return views + ' views';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
//  Modal helpers
// ────────────────────────────────────────────────────────────
function showModal(title, message, callback, confirmText = 'Confirm') {
    const modal = document.getElementById('customModal');
    if (!modal) {
        if (confirm(message)) {
            callback();
        }
        return;
    }
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = message;
    document.getElementById('modalConfirm').textContent = confirmText;
    modalCallback = callback;
    modal.classList.remove('hidden');
}

function hideModal() {
    const modal = document.getElementById('customModal');
    if (modal) {
        modal.classList.add('hidden');
    }
    modalCallback = null;
}

// ────────────────────────────────────────────────────────────
//  Init
// ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    
    // Restore URL input
    const savedUrl = localStorage.getItem('currentUrl');
    if (savedUrl) {
        document.getElementById('urlInput').value = savedUrl;
    }
    
    // Restore video info if available
    restoreVideoInfo();
    
    // Check if there's an active download
    const savedDownload = localStorage.getItem('currentDownload');
    if (savedDownload) {
        const download = JSON.parse(savedDownload);
        if (download.status === 'downloading') {
            currentDownloadId = download.id;
            document.getElementById('formatSelection').classList.add('hidden');
            document.getElementById('downloadProgress').classList.remove('hidden');
            // Start polling progress
            if (progressInterval) clearInterval(progressInterval);
            progressInterval = setInterval(checkProgress, 1000);
        }
    }
    
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
    document.getElementById('urlInput').addEventListener('input', (e) => {
        updatePlatformDisplay(e.target.value);
    });

    // Initialize platform display on page load
    const existingUrl = document.getElementById('urlInput').value;
    if (existingUrl) {
        updatePlatformDisplay(existingUrl);
    }

    // Quality preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => selectPreset(btn.dataset.preset));
    });

    // Pause/Resume buttons
    document.getElementById('pauseBtn').addEventListener('click', pauseDownload);
    document.getElementById('resumeBtn').addEventListener('click', resumeDownload);

    // Cancel button
    const cancelMainBtn = document.getElementById('cancelMainBtn');
    if (cancelMainBtn) {
        cancelMainBtn.addEventListener('click', () => cancelCurrentDownload());
    }

    // Cleanup .part files button
    const cleanupPartBtn = document.getElementById('cleanupPartBtn');
    if (cleanupPartBtn) {
        cleanupPartBtn.addEventListener('click', cleanupPartFiles);
    }

    // Browser notification permission
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // Modal event listeners
    const modalClose = document.getElementById('modalClose');
    const modalCancel = document.getElementById('modalCancel');
    const modalConfirm = document.getElementById('modalConfirm');
    const modalOverlay = document.querySelector('.modal-overlay');
    
    if (modalClose) modalClose.addEventListener('click', hideModal);
    if (modalCancel) modalCancel.addEventListener('click', hideModal);
    if (modalConfirm) modalConfirm.addEventListener('click', () => {
        if (modalCallback) {
            modalCallback();
            modalCallback = null;
        }
        hideModal();
    });
    if (modalOverlay) modalOverlay.addEventListener('click', hideModal);
});

// ────────────────────────────────────────────────────────────
//  Auto-upload to cloud
// ────────────────────────────────────────────────────────────
async function autoUploadToCloud(downloadId, settings) {
    try {
        showNotification('Auto-uploading to cloud...');
        
        const response = await fetch(`/api/cloud/upload/${downloadId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                b2_settings: {
                    bucket_name: settings.b2BucketName,
                    endpoint_url: settings.b2EndpointUrl,
                    key_id: settings.b2KeyId,
                    application_key: settings.b2ApplicationKey
                },
                discord_webhook_url: settings.discordWebhookUrl,
                download_folder: settings.downloadFolder || '',
                signed_url_expiration: settings.signedUrlExpiration || 3600
            })
        });
        
        if (response.ok) {
            console.log('Auto-upload started successfully');
        } else {
            const data = await response.json();
            console.error('Auto-upload failed:', data.error);
        }
    } catch (error) {
        console.error('Error auto-uploading to cloud:', error);
    }
}