// History page JavaScript
let historyData = [];

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

async function loadHistory() {
    try {
        const response = await fetch('/api/history');
        const data = await response.json();
        // /api/history returns a plain array
        historyData = Array.isArray(data) ? data : (data.history || []);
        applyFilters();
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const sortFilter = document.getElementById('sortFilter').value;
    
    let filtered = [...historyData];
    
    // Search filter
    if (searchTerm) {
        filtered = filtered.filter(item => 
            item.title.toLowerCase().includes(searchTerm) ||
            item.resolution.toLowerCase().includes(searchTerm)
        );
    }
    
    // Status filter
    if (statusFilter !== 'all') {
        filtered = filtered.filter(item => item.status === statusFilter);
    }
    
    // Sort
    switch(sortFilter) {
        case 'newest':
            filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            break;
        case 'oldest':
            filtered.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            break;
        case 'name':
            filtered.sort((a, b) => a.title.localeCompare(b.title));
            break;
        case 'size':
            filtered.sort((a, b) => (b.filesize || 0) - (a.filesize || 0));
            break;
    }
    
    displayHistory(filtered);
}

function displayHistory(history) {
    const historyList = document.getElementById('historyList');
    const emptyHistory = document.getElementById('emptyHistory');
    
    console.log('History data:', history); // Debug logging
    
    if (!history || history.length === 0) {
        historyList.innerHTML = '';
        emptyHistory.classList.remove('hidden');
        return;
    }
    
    emptyHistory.classList.add('hidden');
    historyList.innerHTML = history.map((item, index) => {
        const isCompleted = item.status === 'completed';
        const statusIcon = isCompleted ? '✓' : item.status === 'failed' ? '✗' : '⟳';
        
        // Platform display
        const platform = item.platform || 'YouTube';
        let platformBadge = '';
        if (platform === 'YouTube') {
            platformBadge = '<span class="platform-badge platform-youtube">🟢 YouTube</span>';
        } else if (platform === 'TikTok') {
            platformBadge = '<span class="platform-badge platform-tiktok">🟣 TikTok</span>';
        } else if (platform === 'Instagram') {
            platformBadge = '<span class="platform-badge platform-instagram">🟠 Instagram</span>';
        } else {
            platformBadge = '<span class="platform-badge platform-unsupported">🔴 Unknown</span>';
        }
        
        // Cloud status
        const cloudStatus = item.cloud_status || 'not_uploaded';
        let cloudStatusIcon = '';
        let cloudStatusText = '';
        let cloudActionButton = '';
        
        if (cloudStatus === 'not_uploaded') {
            cloudStatusIcon = '☁️';
            cloudStatusText = 'Not uploaded';
            cloudActionButton = `
                <button class="btn-action btn-cloud" onclick="uploadToCloud('${item.id}')" title="Upload to Cloud">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="17 8 12 3 7 8"></polyline>
                        <line x1="12" y1="3" x2="12" y2="15"></line>
                    </svg>
                </button>
            `;
        } else if (cloudStatus === 'uploading') {
            cloudStatusIcon = '🟡';
            cloudStatusText = `Uploading ${item.cloud_progress || 0}%`;
            cloudActionButton = `
                <button class="btn-action btn-cloud" disabled title="Uploading...">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                    </svg>
                </button>
            `;
        } else if (cloudStatus === 'uploaded') {
            cloudStatusIcon = '✓';
            cloudStatusText = 'Uploaded';
            cloudActionButton = `
                <button class="btn-action btn-cloud" onclick="openCloudVideo('${item.id}')" title="Open Cloud Video">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-0.93"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                </button>
                <button class="btn-action btn-cloud btn-delete-cloud" onclick="confirmDeleteCloud('${item.id}')" title="Delete Cloud Copy">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            `;
        } else if (cloudStatus === 'failed') {
            cloudStatusIcon = '🔴';
            cloudStatusText = 'Failed';
            cloudActionButton = `
                <button class="btn-action btn-cloud" onclick="uploadToCloud('${item.id}')" title="Retry Upload">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <polyline points="1 20 1 14 7 14"></polyline>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                </button>
            `;
        }
        
        return `
            <div class="history-card">
                <div class="history-number">${index + 1}</div>
                <div class="history-info">
                    <div class="history-title">${escapeHtml(item.title)}</div>
                    <div class="history-meta">
                        ${platformBadge}
                        <span class="history-resolution">${escapeHtml(item.resolution)}</span>
                        <span class="history-time">${formatTime(item.timestamp)}</span>
                        ${item.filesize ? `<span class="history-size">${formatSize(item.filesize)}</span>` : ''}
                        <span class="history-cloud-status" data-status="${cloudStatus}">
                            ${cloudStatusIcon} ${cloudStatusText}
                        </span>
                    </div>
                </div>
                <div class="history-status ${item.status}">${statusIcon}</div>
                <div class="history-actions">
                    ${isCompleted ? `
                        <button class="btn-action" onclick="downloadFile('${item.id}')" title="Download">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                        </button>
                        <button class="btn-action" onclick="openFile('${item.id}')" title="Open File">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                        </button>
                        <button class="btn-action" onclick="openFolder('${item.id}')" title="Open Folder">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 3"></polygon>
                            </svg>
                        </button>
                    ` : ''}
                    ${cloudActionButton}
                    <button class="btn-delete" onclick="deleteHistoryItem('${item.id}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6l-1 14H6L5 6"></path>
                            <path d="M10 11v6M14 11v6"></path>
                            <path d="M9 6V4h6v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function downloadFile(downloadId) {
    try {
        let customFolder = '';
        try {
            const savedSettings = localStorage.getItem('ytDownloaderSettings');
            if (savedSettings) {
                customFolder = JSON.parse(savedSettings).downloadFolder || '';
            }
        } catch(e) {}

        const response = await fetch(`/api/download-file/${downloadId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ download_folder: customFolder })
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'video.mp4';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } else {
            const data = await response.json();
            showError(data.error || 'Failed to download file');
        }
    } catch (error) {
        console.error('Error downloading file:', error);
        showError('Failed to download file');
    }
}

async function openFile(downloadId) {
    try {
        let customFolder = '';
        try {
            const savedSettings = localStorage.getItem('ytDownloaderSettings');
            if (savedSettings) {
                customFolder = JSON.parse(savedSettings).downloadFolder || '';
            }
        } catch(e) {}

        const response = await fetch(`/api/open-file/${downloadId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ download_folder: customFolder })
        });
        
        const data = await response.json();
        
        if (data.opened) {
            showNotification('Opening file...');
        } else if (data.filepath) {
            // fallback if it couldn't open natively
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
            showError(data.error || 'File not found');
        }
    } catch (error) {
        console.error('Error opening file:', error);
        showError('Unable to open file');
    }
}

async function openFolder(downloadId) {
    try {
        let customFolder = '';
        try {
            const savedSettings = localStorage.getItem('ytDownloaderSettings');
            if (savedSettings) {
                customFolder = JSON.parse(savedSettings).downloadFolder || '';
            }
        } catch(e) {}

        const response = await fetch(`/api/open-folder/${downloadId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ download_folder: customFolder })
        });
        
        const data = await response.json();
        
        if (data.opened) {
            showNotification('Opening folder...');
        } else if (data.folderpath) {
            // fallback if it couldn't open natively
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
            showError(data.error || 'Folder not found');
        }
    } catch (error) {
        console.error('Error opening folder:', error);
        showError('Unable to open folder');
    }
}

async function deleteHistoryItem(downloadId) {
    dangerModal(
        'Delete Video',
        'Are you sure you want to delete this video from history?',
        async () => {
            try {
                let customFolder = '';
                try {
                    const savedSettings = localStorage.getItem('ytDownloaderSettings');
                    if (savedSettings) {
                        customFolder = JSON.parse(savedSettings).downloadFolder || '';
                    }
                } catch(e) {}

                const response = await fetch(`/api/history/delete/${downloadId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ download_folder: customFolder })
                });
                const data = await response.json();
                if (response.ok) {
                    showNotification('Video deleted successfully');
                    loadHistory();
                } else {
                    showError(data.error || 'Failed to delete video');
                }
            } catch (error) {
                console.error('Error deleting history item:', error);
                showError('Failed to delete video');
            }
        }
    );
}

async function clearHistory() {
    dangerModal(
        'Clear History',
        'Are you sure you want to clear all download history? This cannot be undone.',
        async () => {
            try {
                let customFolder = '';
                try {
                    const savedSettings = localStorage.getItem('ytDownloaderSettings');
                    if (savedSettings) {
                        customFolder = JSON.parse(savedSettings).downloadFolder || '';
                    }
                } catch(e) {}

                const response = await fetch('/api/history/clear', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ download_folder: customFolder })
                });
                const data = await response.json();
                if (response.ok) {
                    showNotification('History cleared successfully');
                    loadHistory();
                } else {
                    showError(data.error || 'Failed to clear history');
                }
            } catch (error) {
                console.error('Error clearing history:', error);
                showError('Failed to clear history');
            }
        }
    );
}

async function openDownloadsFolder() {
    try {
        let customFolder = '';
        try {
            const savedSettings = localStorage.getItem('ytDownloaderSettings');
            if (savedSettings) {
                customFolder = JSON.parse(savedSettings).downloadFolder || '';
            }
        } catch(e) {}

        const response = await fetch('/api/open-downloads-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ download_folder: customFolder })
        });
        
        const data = await response.json();
        if (data.opened) {
            showNotification('Opening downloads folder...');
        } else {
            showError(data.error || 'Unable to open folder');
        }
    } catch (error) {
        console.error('Error opening downloads folder:', error);
        showError('Unable to open downloads folder');
    }
}

async function cleanupPartFiles() {
    try {
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
                showNotification(`Deleted ${data.deleted_count} .part file(s)`);
            } else {
                showNotification('No .part files found');
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

function formatTime(timestamp) {
    if (!timestamp) return 'Unknown';
    try {
        const date = new Date(timestamp);
        return date.toLocaleString();
    } catch (error) {
        return 'Unknown';
    }
}

function formatSize(bytes) {
    if (!bytes) return 'Unknown';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

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

function showError(message) {
    showNotification(message);
}

// Initialize

async function uploadToCloud(downloadId) {
    try {
        // Get cloud settings from localStorage
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (!savedSettings) {
            showError('Please configure cloud settings in Settings first');
            return;
        }
        
        const settings = JSON.parse(savedSettings);
        
        // Validate B2 settings
        if (!settings.b2BucketName || !settings.b2EndpointUrl || !settings.b2KeyId || !settings.b2ApplicationKey) {
            showError('Please configure B2 settings in Settings first');
            return;
        }
        
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
                download_folder: settings.downloadFolder,
                signed_url_expiration: settings.signedUrlExpiration || 31536000  // Default to 1 year
            })
        });
        
        if (response.ok) {
            showNotification('Cloud upload started');
            // Refresh history periodically to check status
            const refreshInterval = setInterval(async () => {
                await loadHistory();
                // Check if uploaded by looking at the history entry
                const historyResponse = await fetch('/api/history');
                const historyData = await historyResponse.json();
                const entry = historyData.find(e => e.id === downloadId);
                if (entry && (entry.cloud_status === 'uploaded' || entry.cloud_status === 'failed')) {
                    clearInterval(refreshInterval);
                    if (entry.cloud_status === 'uploaded') {
                        showNotification('Cloud upload completed!');
                    } else {
                        showError('Cloud upload failed');
                    }
                }
            }, 2000);
        } else {
            const data = await response.json();
            showError('Failed to start cloud upload: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        showError('Error uploading to cloud: ' + error.message);
    }
}

async function openCloudVideo(downloadId) {
    try {
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (!savedSettings) {
            showError('Please configure cloud settings in Settings first');
            return;
        }
        
        const settings = JSON.parse(savedSettings);
        
        const response = await fetch(`/api/cloud/open/${downloadId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                b2_settings: {
                    bucket_name: settings.b2BucketName,
                    endpoint_url: settings.b2EndpointUrl,
                    key_id: settings.b2KeyId,
                    application_key: settings.b2ApplicationKey
                },
                expiration: settings.signedUrlExpiration || 604800  // Default to 7 days (B2 max limit)
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            window.open(data.url, '_blank');
            showNotification('Opening cloud video...');
        } else {
            const data = await response.json();
            showError(data.error || 'Failed to open cloud video');
        }
    } catch (error) {
        console.error('Error opening cloud video:', error);
        showError('Failed to open cloud video');
    }
}

let deleteCloudId = null;

function confirmDeleteCloud(downloadId) {
    deleteCloudId = downloadId;
    
    confirmModal(
        'Delete Cloud Copy',
        'Are you sure you want to delete this video from cloud storage? The local file will NOT be deleted.',
        () => {
            deleteFromCloud(downloadId);
        }
    );
}

async function deleteFromCloud(downloadId) {
    try {
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (!savedSettings) {
            showError('Please configure cloud settings in Settings first');
            return;
        }
        
        const settings = JSON.parse(savedSettings);
        
        const response = await fetch(`/api/cloud/delete/${downloadId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                b2_settings: {
                    bucket_name: settings.b2BucketName,
                    endpoint_url: settings.b2EndpointUrl,
                    key_id: settings.b2KeyId,
                    application_key: settings.b2ApplicationKey
                }
            })
        });
        
        if (response.ok) {
            showNotification('Cloud copy deleted successfully');
            await loadHistory(); // Refresh the history UI
        } else {
            const data = await response.json();
            showError('Failed to delete cloud copy: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error deleting from cloud:', error);
        showError('Failed to delete cloud copy');
    }
    
    deleteCloudId = null;
}

function pollCloudProgress(downloadId) {
    const interval = setInterval(async () => {
        try {
            const response = await fetch(`/api/cloud/progress/${downloadId}`);
            const data = await response.json();
            
            console.log('Cloud progress data:', data);
            
            // Update history display with progress
            await loadHistory();
            
            // Check if completed based on status from API
            if (data.status === 'completed' || data.status === 'failed') {
                clearInterval(interval);
                if (data.status === 'completed') {
                    showNotification('Cloud upload completed!');
                } else {
                    showError('Cloud upload failed: ' + (data.error || 'Unknown error'));
                }
            }
        } catch (error) {
            console.error('Error polling cloud progress:', error);
        }
    }, 1000);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    loadHistory();
    
    // Event listeners
    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('statusFilter').addEventListener('change', applyFilters);
    document.getElementById('sortFilter').addEventListener('change', applyFilters);
    
    const clearBtn = document.getElementById('clearHistoryBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearHistory);
    
    const openFolderBtn = document.getElementById('openFolderBtn');
    if (openFolderBtn) openFolderBtn.addEventListener('click', openDownloadsFolder);
    
    const cleanupPartBtn = document.getElementById('cleanupPartBtn');
    if (cleanupPartBtn) cleanupPartBtn.addEventListener('click', cleanupPartFiles);
});