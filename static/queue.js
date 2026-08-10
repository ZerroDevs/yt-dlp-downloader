// Queue page JavaScript
let updateInterval = null;
// #region debug-point shared:report
const __dbgReport = (hypothesisId, location, msg, data = {}, runId = 'post-fix') => fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'queue-progress-bar', runId, hypothesisId, location, msg: `[DEBUG] ${msg}`, data, ts: Date.now() })
}).catch(() => {});
// #endregion

function forceQueueProgressLayout(root = document) {
    const cards = root.matches?.('.queue-card')
        ? [root]
        : Array.from(root.querySelectorAll?.('.queue-card') || []);

    cards.forEach((card) => {
        const progressRow = card.querySelector('.queue-progress');
        const bar = card.querySelector('.queue-progress-bar');
        const fill = card.querySelector('.queue-progress-fill');
        const percent = card.querySelector('.queue-progress-percent');

        if (!progressRow || !bar || !fill) return;

        const cardWidth = Math.round(card.getBoundingClientRect().width || card.clientWidth || 0);
        const percentWidth = Math.max(Math.round(percent?.getBoundingClientRect().width || 0), 52);
        const targetBarWidth = Math.max(cardWidth - percentWidth - 64, 180);

        progressRow.style.display = 'grid';
        progressRow.style.gridTemplateColumns = `minmax(180px, 1fr) ${percentWidth}px`;
        progressRow.style.alignItems = 'center';
        progressRow.style.columnGap = '12px';
        progressRow.style.width = '100%';

        bar.style.display = 'block';
        bar.style.width = `${targetBarWidth}px`;
        bar.style.minWidth = '180px';
        bar.style.maxWidth = '100%';

        fill.style.display = 'block';
    });
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

        const response = await fetch('/api/cleanup-part-files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ download_folder: customFolder })
        });
        const data = await response.json();
        
        if (response.ok) {
            if (data.deleted_count > 0) {
                showDownloadNotification('Cleanup Complete', 'completed', `Deleted ${data.deleted_count} .part file(s)`);
            } else {
                showDownloadNotification('Cleanup Complete', 'completed', 'No .part files found');
            }
        } else {
            showDownloadNotification('Cleanup Failed', 'error', data.error || 'Failed to cleanup .part files');
        }
    } catch (error) {
        console.error('Error cleaning up .part files:', error);
        showDownloadNotification('Cleanup Failed', 'error', 'Failed to cleanup .part files');
    }
}

async function updateQueue() {
    try {
        const response = await fetch('/api/queue');
        const data = await response.json();
        // #region debug-point A:queue-response
        __dbgReport('A', 'static/queue.js:updateQueue', 'Queue API returned data', {
            ok: response.ok,
            count: Array.isArray(data) ? data.length : (Array.isArray(data.queue) ? data.queue.length : -1),
            firstProgress: Array.isArray(data) && data[0] ? data[0].progress : (data.queue && data.queue[0] ? data.queue[0].progress : null),
            firstStatus: Array.isArray(data) && data[0] ? data[0].status : (data.queue && data.queue[0] ? data.queue[0].status : null)
        });
        // #endregion
        // /api/queue returns a plain array
        displayQueue(Array.isArray(data) ? data : (data.queue || []));
    } catch (error) {
        console.error('Error updating queue:', error);
    }
}

function displayQueue(queue) {
    const queueList = document.getElementById('queueList');
    const emptyQueue = document.getElementById('emptyQueue');
    
    if (!queue || queue.length === 0) {
        queueList.innerHTML = '';
        emptyQueue.classList.remove('hidden');
        return;
    }
    
    emptyQueue.classList.add('hidden');
    
    // Check if we need to rebuild or just update
    const existingCards = queueList.querySelectorAll('.queue-card');
    const existingIds = Array.from(existingCards).map(card => card.dataset.id);
    const newIds = queue.map(item => item.id);
    
    // Rebuild if the queue structure changed (items added/removed)
    if (JSON.stringify(existingIds.sort()) !== JSON.stringify(newIds.sort())) {
        queueList.innerHTML = queue.map((item, index) => {
            const progress = parseFloat(item.progress) || 0;
            const actualRes = item.actual_resolution && item.actual_resolution !== item.resolution 
                ? `(${item.actual_resolution})` : '';
            const isPaused = item.status === 'paused';
            
            return `
            <div class="queue-card" data-id="${item.id}">
                <div class="queue-card-header">
                    <div class="queue-number">${index + 1}</div>
                    ${item.thumbnail ? `<img src="${item.thumbnail}" alt="thumbnail" class="queue-thumbnail">` : ''}
                    <div class="queue-info">
                        <div class="queue-title">${escapeHtml(item.title)}</div>
                        <div class="queue-meta">
                            <span class="queue-resolution">${escapeHtml(item.resolution)}${actualRes}</span>
                            <span class="queue-time">${formatTime(item.started_at)}</span>
                        </div>
                    </div>
                </div>
                <div class="queue-progress-section">
                    <div class="queue-progress-bar-wrapper">
                        <div class="queue-progress-bar">
                            <div class="queue-progress-fill" style="width: ${progress}%"></div>
                        </div>
                        <span class="queue-progress-percent">${progress.toFixed(1)}%</span>
                    </div>
                    <div class="queue-stats-grid">
                        <div class="queue-stat">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                            </svg>
                            <span>${item.speed || '--'}</span>
                        </div>
                        <div class="queue-stat">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            <span>${item.eta || 'Unknown'}</span>
                        </div>
                        <div class="queue-stat">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            <span>${item.size || '--'}</span>
                        </div>
                    </div>
                </div>
                <div class="queue-card-footer">
                    <div class="queue-actions">
                        ${isPaused ? `
                            <button class="btn-control btn-resume" onclick="resumeDownload('${item.id}')" title="Resume">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                </svg>
                            </button>
                        ` : `
                            <button class="btn-control btn-pause" onclick="pauseDownload('${item.id}')" title="Pause">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="6" y="4" width="4" height="16"></rect>
                                    <rect x="14" y="4" width="4" height="16"></rect>
                                </svg>
                            </button>
                        `}
                        <button class="btn-cancel" onclick="cancelDownload('${item.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                            Stop
                        </button>
                    </div>
                    <div class="queue-status">
                        <span class="status-indicator ${isPaused ? 'paused' : 'active'}"></span>
                        ${isPaused ? 'Paused' : 'Downloading'}
                    </div>
                </div>
            </div>
        `;
        }).join('');
    } else {
        // Just update existing cards (smooth updates)
        queue.forEach((item, index) => {
            const card = queueList.querySelector(`.queue-card[data-id="${item.id}"]`);
            if (card) {
                const progress = parseFloat(item.progress) || 0;
                const isPaused = item.status === 'paused';
                
                // Update progress bar
                const fill = card.querySelector('.queue-progress-fill');
                const percent = card.querySelector('.queue-progress-percent');
                if (fill) {
                    fill.style.width = `${progress}%`;
                }
                if (percent) percent.textContent = `${progress.toFixed(1)}%`;
                
                // Update stats
                const stats = card.querySelectorAll('.queue-stat span');
                if (stats[0]) stats[0].textContent = item.speed || '--';
                if (stats[1]) stats[1].textContent = item.eta || 'Unknown';
                if (stats[2]) stats[2].textContent = item.size || '--';
                
                // Update pause/resume button
                const actions = card.querySelector('.queue-actions');
                if (actions) {
                    if (isPaused) {
                        actions.innerHTML = `
                            <button class="btn-control btn-resume" onclick="resumeDownload('${item.id}')" title="Resume">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                </svg>
                            </button>
                            <button class="btn-cancel" onclick="cancelDownload('${item.id}')">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                                Stop
                            </button>
                        `;
                    } else {
                        actions.innerHTML = `
                            <button class="btn-control btn-pause" onclick="pauseDownload('${item.id}')" title="Pause">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="6" y="4" width="4" height="16"></rect>
                                    <rect x="14" y="4" width="4" height="16"></rect>
                                </svg>
                            </button>
                            <button class="btn-cancel" onclick="cancelDownload('${item.id}')">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                                Stop
                            </button>
                        `;
                    }
                }
                
                // Update status
                const statusText = card.querySelector('.queue-status');
                if (statusText) {
                    const indicator = statusText.querySelector('.status-indicator');
                    if (indicator) {
                        indicator.className = `status-indicator ${isPaused ? 'paused' : 'active'}`;
                    }
                    statusText.innerHTML = `<span class="status-indicator ${isPaused ? 'paused' : 'active'}"></span>${isPaused ? 'Paused' : 'Downloading'}`;
                }
                
                // Update queue number
                const number = card.querySelector('.queue-number');
                if (number) number.textContent = index + 1;
            }
        });
    }
}

async function cancelDownload(downloadId) {
    // Get video title before cancelling
    const queueList = document.getElementById('queueList');
    const queueItem = queueList.querySelector(`[onclick*="${downloadId}"]`)?.closest('.queue-card');
    const videoTitle = queueItem?.querySelector('.queue-title')?.textContent || 'Unknown';
    
    showModal(
        'Cancel Download',
        'Are you sure you want to cancel this download?',
        async () => {
            try {
                const response = await fetch(`/api/download/cancel/${downloadId}`, { method: 'POST' });
                if (response.ok) {
                    updateQueue();
                    // Show notification
                    showDownloadNotification('Download Cancelled', 'cancelled', videoTitle);
                }
            } catch (error) {
                console.error('Error cancelling download:', error);
            }
        }
    );
}

async function pauseDownload(downloadId) {
    // Get video title before pausing
    const queueList = document.getElementById('queueList');
    const queueItem = queueList.querySelector(`[onclick*="${downloadId}"]`)?.closest('.queue-card');
    const videoTitle = queueItem?.querySelector('.queue-title')?.textContent || 'Unknown';
    
    try {
        const response = await fetch(`/api/download/pause/${downloadId}`, { method: 'POST' });
        if (response.ok) {
            updateQueue();
            // Show notification
            showDownloadNotification('Download Paused', 'paused', videoTitle);
        }
    } catch (error) {
        console.error('Error pausing download:', error);
    }
}

async function resumeDownload(downloadId) {
    // Get video title before resuming
    const queueList = document.getElementById('queueList');
    const queueItem = queueList.querySelector(`[onclick*="${downloadId}"]`)?.closest('.queue-card');
    const videoTitle = queueItem?.querySelector('.queue-title')?.textContent || 'Unknown';
    
    try {
        const response = await fetch(`/api/download/resume/${downloadId}`, { method: 'POST' });
        if (response.ok) {
            updateQueue();
            // Show notification
            showDownloadNotification('Download Resumed', 'resumed', videoTitle);
        }
    } catch (error) {
        console.error('Error resuming download:', error);
    }
}

function formatTime(timestamp) {
    if (!timestamp) return 'Unknown';
    try {
        const date = new Date(timestamp);
        return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (error) {
        return 'Unknown';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Modal functions
function showModal(title, message, callback) {
    const modal = document.getElementById('customModal');
    if (!modal) {
        if (confirm(message)) callback();
        return;
    }
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = message;
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

let modalCallback = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // #region debug-point B:dom-ready
    __dbgReport('B', 'static/queue.js:DOMContentLoaded', 'Queue page DOMContentLoaded fired', {
        readyState: document.readyState,
        visibilityState: document.visibilityState
    });
    // #endregion
    updateQueue();
    setTimeout(() => {
        updateQueue();
        forceQueueProgressLayout(document);
    }, 150);
    updateInterval = setInterval(updateQueue, 1000);
    
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

    // Cleanup .part files button
    const cleanupPartBtn = document.getElementById('cleanupPartBtn');
    if (cleanupPartBtn) {
        cleanupPartBtn.addEventListener('click', cleanupPartFiles);
    }

    // #region debug-point C:window-load-measure
    window.addEventListener('load', () => {
        requestAnimationFrame(() => {
            forceQueueProgressLayout(document);
            const card = document.querySelector('.queue-card');
            const bar = card?.querySelector('.queue-progress-bar');
            const fill = card?.querySelector('.queue-progress-fill');
            __dbgReport('C', 'static/queue.js:windowLoad', 'Measured queue progress after full page load', {
                cardExists: !!card,
                barExists: !!bar,
                fillExists: !!fill,
                barOffsetWidth: bar?.offsetWidth || 0,
                fillOffsetWidth: fill?.offsetWidth || 0,
                inlineWidth: fill?.style.width || null
            });
        });
    }, { once: true });
    // #endregion

    window.addEventListener('pageshow', () => {
        requestAnimationFrame(() => {
            updateQueue();
            forceQueueProgressLayout(document);
        });
    }, { once: true });
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (updateInterval) clearInterval(updateInterval);
});

// Notification functions (shared with global-progress.js)
function showDownloadNotification(title, action, videoTitle = '') {
    const notification = {
        title: title,
        action: action,
        videoTitle: videoTitle,
        timestamp: Date.now()
    };
    
    // Save to localStorage for cross-page sync
    localStorage.setItem('downloadNotification', JSON.stringify(notification));
    
    // Show immediately on current page
    handleDownloadNotification(notification);
}

function handleDownloadNotification(notification) {
    let type = 'info';
    let message = '';
    
    switch(notification.action) {
        case 'paused':
            type = 'info';
            message = `Download paused: ${notification.videoTitle}`;
            break;
        case 'resumed':
            type = 'success';
            message = `Download resumed: ${notification.videoTitle}`;
            break;
        case 'cancelled':
            type = 'warning';
            message = `Download cancelled: ${notification.videoTitle}`;
            break;
        case 'completed':
            type = 'success';
            message = `Download completed: ${notification.videoTitle}`;
            break;
    }
    
    showGlobalToast(notification.title, type, message);
}

function showGlobalToast(title, type = 'success', message = '') {
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
    let defaultMessage = '';
    
    switch(type) {
        case 'success':
            iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
            color = '#10b981';
            defaultMessage = 'Download has been successfully completed.';
            break;
        case 'error':
            iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
            color = '#ef4444';
            defaultMessage = 'Download failed.';
            break;
        case 'warning':
            iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
            color = '#f59e0b';
            defaultMessage = 'Download cancelled.';
            break;
        case 'info':
            iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
            color = '#3b82f6';
            defaultMessage = 'Download paused.';
            break;
    }
    
    toast.innerHTML = `
        <div class="toast-icon ${type}" style="margin-right: 12px; display: flex; align-items: center; justify-content: center; color: ${color};">${iconSvg}</div>
        <div class="toast-content" style="flex: 1;">
            <div class="toast-title" style="font-weight: 600; font-size: 0.95rem; margin-bottom: 2px;">${title}</div>
            <div class="toast-message" style="font-size: 0.85rem; color: var(--text-muted);">${message || defaultMessage}</div>
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

// Listen for download notifications from other pages
let lastNotificationTimestamp = 0;
window.addEventListener('storage', (e) => {
    if (e.key === 'downloadNotification') {
        const notification = JSON.parse(e.newValue);
        // Only show if it's from another tab (not the current one)
        if (notification && notification.timestamp > lastNotificationTimestamp) {
            handleDownloadNotification(notification);
            lastNotificationTimestamp = notification.timestamp;
        }
    }
});
