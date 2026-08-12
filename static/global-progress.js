// Global Progress Widget - Syncs across all pages
let globalProgressInterval = null;
let currentDownloadId = null;
let lastNotificationTimestamp = 0;

// Mobile detection
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
           (window.innerWidth <= 768);
}

// Make currentDownloadId accessible and settable from other scripts
window.setCurrentDownloadId = function(id) {
    currentDownloadId = id;
    console.log('Set currentDownloadId to:', id);
};

window.getCurrentDownloadId = function() {
    return currentDownloadId;
};

// Initialize global progress widget
function initGlobalProgress() {
    // Check if there's an active download in localStorage
    const savedDownload = localStorage.getItem('currentDownload');
    if (savedDownload) {
        const download = JSON.parse(savedDownload);
        if (download.status === 'downloading') {
            currentDownloadId = download.id;
            showGlobalProgress(download);
            startGlobalProgressPolling();
        }
    }
    
    // Event listener for close button
    const closeBtn = document.getElementById('globalProgressClose');
    if (closeBtn) {
        closeBtn.addEventListener('click', hideGlobalProgress);
    }
    
    // Event listeners for control buttons
    const pauseBtn = document.getElementById('globalProgressPause');
    const resumeBtn = document.getElementById('globalProgressResume');
    const stopBtn = document.getElementById('globalProgressStop');
    
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => pauseGlobalDownload());
    }
    if (resumeBtn) {
        resumeBtn.addEventListener('click', () => resumeGlobalDownload());
    }
    if (stopBtn) {
        stopBtn.addEventListener('click', () => stopGlobalDownload());
    }
}

function showGlobalProgress(download) {
    const widget = document.getElementById('globalProgressWidget');
    if (!widget) {
        console.error('Global progress widget not found');
        return;
    }
    
    const pct = parseFloat(download.progress) || 0;
    widget.classList.remove('hidden');
    
    // Update title based on status
    let title = download.title || 'Downloading...';
    if (download.status === 'paused') {
        title = `${title} (Paused)`;
    }
    
    document.getElementById('globalProgressTitle').textContent = title;
    document.getElementById('globalProgressFill').style.width = `${pct}%`;
    document.getElementById('globalProgressPercent').textContent = `${pct.toFixed(1)}%`;
    
    // Update control buttons based on status
    const pauseBtn = document.getElementById('globalProgressPause');
    const resumeBtn = document.getElementById('globalProgressResume');
    
    if (download.status === 'paused') {
        pauseBtn.classList.add('hidden');
        resumeBtn.classList.remove('hidden');
    } else {
        pauseBtn.classList.remove('hidden');
        resumeBtn.classList.add('hidden');
    }
    
    // Update stats with better formatting
    let statsHtml = '';
    if (download.speed) {
        statsHtml += `<span class="global-stat"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>${download.speed}</span>`;
    }
    if (download.eta) {
        statsHtml += `<span class="global-stat"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>${download.eta}</span>`;
    }
    if (download.size) {
        statsHtml += `<span class="global-stat"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>${download.size}</span>`;
    }
    
    const statsContainer = document.getElementById('globalProgressStats');
    if (statsContainer) {
        statsContainer.innerHTML = statsHtml || '<span class="global-stat">--</span>';
    }
    
    console.log('Global progress shown:', download);
}

function updateGlobalProgressStatus(status) {
    const savedDownload = localStorage.getItem('currentDownload');
    if (savedDownload) {
        const download = JSON.parse(savedDownload);
        download.status = status;
        localStorage.setItem('currentDownload', JSON.stringify(download));
        showGlobalProgress(download);
    }
}

function hideGlobalProgress() {
    const widget = document.getElementById('globalProgressWidget');
    if (widget) {
        widget.classList.add('hidden');
    }
    currentDownloadId = null;
    localStorage.removeItem('currentDownload');
    if (globalProgressInterval) {
        clearInterval(globalProgressInterval);
        globalProgressInterval = null;
    }
    
    // Dispatch download completed event for playlist refresh
    const event = new CustomEvent('downloadCompleted', { 
        detail: { type: 'spotify' }
    });
    window.dispatchEvent(event);
}

async function pauseGlobalDownload() {
    if (!currentDownloadId) return;
    
    try {
        const response = await fetch(`/api/download/pause/${currentDownloadId}`, { method: 'POST' });
        if (response.ok) {
            updateGlobalProgressStatus('paused');
            showGlobalToast('Download Paused', 'info');
        }
    } catch (error) {
        console.error('Error pausing global download:', error);
    }
}

async function resumeGlobalDownload() {
    if (!currentDownloadId) return;
    
    try {
        const response = await fetch(`/api/download/resume/${currentDownloadId}`, { method: 'POST' });
        if (response.ok) {
            updateGlobalProgressStatus('downloading');
            showGlobalToast('Download Resumed', 'success');
        }
    } catch (error) {
        console.error('Error resuming global download:', error);
    }
}

async function stopGlobalDownload() {
    if (!currentDownloadId) return;
    
    if (typeof dangerModal === 'function') {
        dangerModal(
            'Stop Download',
            'Are you sure you want to stop this download?',
            async () => {
                try {
                    const response = await fetch(`/api/download/cancel/${currentDownloadId}`, { method: 'POST' });
                    if (response.ok) {
                        hideGlobalProgress();
                        showGlobalToast('Download Stopped', 'warning');
                    }
                } catch (error) {
                    console.error('Error stopping global download:', error);
                }
            }
        );
    } else {
        // Fallback to confirm if modal not available
        if (confirm('Are you sure you want to stop this download?')) {
            try {
                const response = await fetch(`/api/download/cancel/${currentDownloadId}`, { method: 'POST' });
                if (response.ok) {
                    hideGlobalProgress();
                    showGlobalToast('Download Stopped', 'warning');
                }
            } catch (error) {
                console.error('Error stopping global download:', error);
            }
        }
    }
}

function startGlobalProgressPolling() {
    if (globalProgressInterval) {
        clearInterval(globalProgressInterval);
    }
    
    globalProgressInterval = setInterval(async () => {
        if (!currentDownloadId) {
            console.log('No currentDownloadId, stopping polling');
            hideGlobalProgress();
            return;
        }
        
        try {
            const response = await fetch(`/api/progress/${currentDownloadId}`);
            const data = await response.json();
            
            console.log('Progress update:', data);
            
            // Update UI
            showGlobalProgress(data);
            
            // Save to localStorage for sync across pages
            localStorage.setItem('currentDownload', JSON.stringify({
                id: currentDownloadId,
                status: data.status,
                title: data.title,
                progress: parseFloat(data.progress) || 0,
                speed: data.speed,
                size: data.size,
                eta: data.eta
            }));
            
            // Handle completion
            if (data.status === 'completed' || data.status === 'cancelled' || data.status === 'error') {
                if (data.status === 'completed') {
                    showGlobalToast(`Download Complete: ${data.title}`, 'success');
                    // Dispatch custom event for other scripts to listen
                    document.dispatchEvent(new CustomEvent('downloadCompleted', { detail: data }));
                    
                    // If on mobile, automatically trigger file download to device
                    if (isMobileDevice()) {
                        try {
                            const downloadResponse = await fetch(`/api/download-file/${currentDownloadId}`, {
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
                                showGlobalToast('Downloaded to device', 'success');
                            }
                        } catch (e) {
                            console.error('Error downloading to mobile device:', e);
                        }
                    }
                }
                hideGlobalProgress();
            }
        } catch (error) {
            console.error('Error fetching global progress:', error);
            // Don't hide on error, just log it
        }
    }, 1000);
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

// Show notification for download events (synced across pages)
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

// Handle download notification from localStorage
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

// Listen for storage events (sync across tabs)
window.addEventListener('storage', (e) => {
    if (e.key === 'currentDownload') {
        const download = JSON.parse(e.newValue);
        if (download && download.status === 'downloading') {
            currentDownloadId = download.id;
            showGlobalProgress(download);
            if (!globalProgressInterval) {
                startGlobalProgressPolling();
            }
        } else {
            hideGlobalProgress();
        }
    }
    
    // Handle download notifications
    if (e.key === 'downloadNotification') {
        const notification = JSON.parse(e.newValue);
        // Only show if it's from another tab (not the current one)
        if (notification && notification.timestamp > (lastNotificationTimestamp || 0)) {
            handleDownloadNotification(notification);
            lastNotificationTimestamp = notification.timestamp;
        }
    }
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', initGlobalProgress);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (globalProgressInterval) {
        clearInterval(globalProgressInterval);
    }
});