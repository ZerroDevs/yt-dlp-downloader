// Cloud Files Manager JavaScript
let cloudFiles = [];
let filteredFiles = [];
let deleteFileKey = null;
let deleteDownloadId = null;
let storageLimit = 10; // Default 10GB
let selectedFiles = new Set(); // Track selected files for bulk operations

// Helper function to get B2 settings from localStorage
function getB2Settings() {
    try {
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (!savedSettings) return null;
        const settings = JSON.parse(savedSettings);
        return {
            bucket_name: settings.b2BucketName,
            endpoint_url: settings.b2EndpointUrl,
            key_id: settings.b2KeyId,
            application_key: settings.b2ApplicationKey
        };
    } catch (error) {
        console.error('Error loading B2 settings:', error);
        return null;
    }
}

// Helper function to get file type icon
function getFileTypeIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    
    // Video files
    if (['mp4', 'webm', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'm4v'].includes(ext)) {
        return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2">
            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
            <line x1="7" y1="2" x2="7" y2="22"></line>
            <line x1="17" y1="2" x2="17" y2="22"></line>
            <line x1="2" y1="12" x2="22" y2="12"></line>
            <line x1="2" y1="7" x2="7" y2="7"></line>
            <line x1="2" y1="17" x2="7" y2="17"></line>
            <line x1="17" y1="17" x2="22" y2="17"></line>
            <line x1="17" y1="7" x2="22" y2="7"></line>
        </svg>`;
    }
    
    // Image files
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext)) {
        return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
        </svg>`;
    }
    
    // Audio files
    if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'].includes(ext)) {
        return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
        </svg>`;
    }
    
    // Default file icon
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
        <polyline points="13 2 13 9 20 9"></polyline>
    </svg>`;
}

// Load storage info
async function loadStorageInfo() {
    try {
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (!savedSettings) {
            return;
        }

        const settings = JSON.parse(savedSettings);
        storageLimit = settings.storageLimit || 10;

        const b2Settings = getB2Settings();
        if (!b2Settings) return;

        const response = await fetch('/api/cloud/storage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ b2_settings: b2Settings })
        });

        if (response.ok) {
            const data = await response.json();
            updateStorageDisplay(data);
        }
    } catch (error) {
        console.error('Error loading storage info:', error);
    }
}

// Update storage display
function updateStorageDisplay(data) {
    const usedGB = data.total_size_gb || 0;
    const limitGB = storageLimit;
    const freeGB = Math.max(0, limitGB - usedGB);
    const percentage = limitGB > 0 ? Math.min(100, (usedGB / limitGB) * 100) : 0;
    
    document.getElementById('storageUsed').textContent = `${usedGB.toFixed(2)} GB`;
    document.getElementById('storageFree').textContent = `${freeGB.toFixed(2)} GB`;
    document.getElementById('storageLimit').textContent = `${limitGB} GB`;
    document.getElementById('storageFiles').textContent = data.file_count || 0;
    document.getElementById('storageProgressFill').style.width = `${percentage}%`;
    document.getElementById('storagePercentage').textContent = `${percentage.toFixed(1)}%`;
    
    // Update analytics bar
    document.getElementById('usedStorageBar').style.width = `${percentage}%`;
    
    // Update analytics stats (always update when data changes)
    updateAnalyticsStats();
    
    // Alert if near limit
    if (percentage > 90) {
        document.getElementById('storageProgressFill').style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
        document.getElementById('usedStorageBar').style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
        showNotification('Warning: Storage usage above 90%');
    } else if (percentage > 75) {
        document.getElementById('storageProgressFill').style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
        document.getElementById('usedStorageBar').style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
    } else {
        document.getElementById('storageProgressFill').style.background = 'linear-gradient(90deg, var(--primary-color), #8b5cf6)';
        document.getElementById('usedStorageBar').style.background = 'linear-gradient(90deg, var(--primary-color), #8b5cf6)';
    }
}

// Update analytics stats
function updateAnalyticsStats() {
    if (cloudFiles.length === 0) {
        document.getElementById('avgFileSize').textContent = '0 MB';
        document.getElementById('largestFile').textContent = '0 MB';
        document.getElementById('totalFiles').textContent = '0';
        return;
    }
    
    const totalSize = cloudFiles.reduce((sum, file) => sum + file.size_mb, 0);
    const avgSize = totalSize / cloudFiles.length;
    const largestSize = Math.max(...cloudFiles.map(file => file.size_mb));
    
    document.getElementById('avgFileSize').textContent = `${avgSize.toFixed(2)} MB`;
    document.getElementById('largestFile').textContent = `${largestSize.toFixed(2)} MB`;
    document.getElementById('totalFiles').textContent = cloudFiles.length;
}

// Toggle analytics visibility
function toggleAnalytics() {
    const content = document.getElementById('analyticsContent');
    const icon = document.getElementById('analyticsToggleIcon');
    const card = document.querySelector('.storage-analytics-card');
    
    if (content.style.display === 'none') {
        content.style.display = 'grid';
        icon.innerHTML = '<polyline points="18 15 12 9 6 15"></polyline>';
        card.classList.remove('collapsed');
        // Update stats when opening
        updateAnalyticsStats();
    } else {
        content.style.display = 'none';
        icon.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
        card.classList.add('collapsed');
    }
}

// Load cloud files from API
async function loadCloudFiles() {
    try {
        const b2Settings = getB2Settings();
        if (!b2Settings) {
            showError('Please configure cloud settings in Settings first');
            return;
        }

        const response = await fetch('/api/cloud/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ b2_settings: b2Settings })
        });

        if (response.ok) {
            const data = await response.json();
            cloudFiles = data.files || [];
            filteredFiles = [...cloudFiles];
            renderCloudFiles();
            showNotification(`Loaded ${cloudFiles.length} cloud files`);
        } else {
            const data = await response.json();
            showError('Failed to load cloud files: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error loading cloud files:', error);
        showError('Failed to load cloud files');
    }
}

// Render cloud files
function renderCloudFiles() {
    const container = document.getElementById('cloudFilesList');
    const emptyState = document.getElementById('emptyCloud');
    
    if (filteredFiles.length === 0) {
        container.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    }
    
    emptyState.classList.add('hidden');
    
    container.innerHTML = filteredFiles.map((file, index) => {
        const date = new Date(file.last_modified);
        const formattedDate = date.toLocaleDateString();
        const formattedTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const isSelected = selectedFiles.has(file.key);

        // Determine file type for preview
        const isImage = file.filename.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i);
        const isVideo = file.filename.match(/\.(mp4|webm|mkv|avi|mov)$/i);

        return `
            <div class="cloud-file-card ${isSelected ? 'selected' : ''}" data-file-key="${file.key}">
                <div class="cloud-file-checkbox">
                    <input type="checkbox" class="file-checkbox" data-file-key="${file.key}" ${isSelected ? 'checked' : ''} onchange="toggleFileSelection('${file.key}')">
                </div>
                <div class="cloud-file-number">${index + 1}</div>
                ${isImage ? `
                    <div class="cloud-file-preview">
                        <img src="" data-file-key="${file.key}" alt="${escapeHtml(file.filename)}" class="preview-image" loading="lazy">
                    </div>
                ` : ''}
                ${isVideo ? `
                    <div class="cloud-file-preview">
                        <video src="" data-file-key="${file.key}" class="preview-video" muted preload="metadata"></video>
                    </div>
                ` : ''}
                ${!isImage && !isVideo ? `
                    <div class="cloud-file-preview cloud-file-icon">
                        ${getFileTypeIcon(file.filename)}
                    </div>
                ` : ''}
                <div class="cloud-file-info">
                    <div class="cloud-file-name">${escapeHtml(file.filename)}</div>
                    <div class="cloud-file-meta">
                        <span>${file.size_mb} MB</span>
                        <span>•</span>
                        <span>${formattedDate} ${formattedTime}</span>
                    </div>
                </div>
                <div class="cloud-file-actions">
                    <button class="btn-action btn-download" onclick="downloadToLocal('${file.key}', '${escapeHtml(file.filename)}')" title="Download to Local">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    </button>
                    <button class="btn-action btn-share" onclick="generateShareLink('${file.key}', '${escapeHtml(file.filename)}')" title="Share Link">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                        </svg>
                    </button>
                    <button class="btn-action btn-open" onclick="openCloudFile('${file.key}')" title="Open File">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-0.93"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                    </button>
                    <button class="btn-action btn-delete" onclick="confirmDeleteCloudFile('${file.key}', '${file.download_id || ''}', '${escapeHtml(file.filename)}')" title="Delete File">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    // Load previews after rendering
    loadFilePreviews();
}

// Load file previews with concurrency limit
async function loadFilePreviews() {
    const b2Settings = getB2Settings();
    if (!b2Settings) return;

    const BATCH_SIZE = 5;

    // Helper function to load a single preview
    const loadPreview = async (element, fileKey) => {
        try {
            const response = await fetch('/api/cloud/open/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    b2_settings: b2Settings,
                    file_key: fileKey,
                    expiration: 3600
                })
            });

            if (response.ok) {
                const data = await response.json();
                element.src = data.url;
            }
        } catch (error) {
            console.error('Error loading preview:', error);
        }
    };

    // Load image previews in batches
    const images = document.querySelectorAll('.preview-image');
    for (let i = 0; i < images.length; i += BATCH_SIZE) {
        const batch = Array.from(images).slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(img => loadPreview(img, img.dataset.fileKey)));
    }

    // Load video previews in batches
    const videos = document.querySelectorAll('.preview-video');
    for (let i = 0; i < videos.length; i += BATCH_SIZE) {
        const batch = Array.from(videos).slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(video => loadPreview(video, video.dataset.fileKey)));
    }
}

// Open cloud file
async function openCloudFile(fileKey) {
    try {
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (!savedSettings) {
            showError('Please configure cloud settings in Settings first');
            return;
        }
        
        const settings = JSON.parse(savedSettings);
        
        // Generate signed URL
        const response = await fetch('/api/cloud/open/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                b2_settings: {
                    bucket_name: settings.b2BucketName,
                    endpoint_url: settings.b2EndpointUrl,
                    key_id: settings.b2KeyId,
                    application_key: settings.b2ApplicationKey
                },
                file_key: fileKey,
                expiration: settings.signedUrlExpiration || 604800
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            window.open(data.url, '_blank');
            showNotification('Opening file...');
        } else {
            const data = await response.json();
            showError('Failed to open file: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error opening cloud file:', error);
        showError('Failed to open file');
    }
}

// Download cloud file to local storage
async function downloadToLocal(fileKey, filename) {
    try {
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (!savedSettings) {
            showError('Please configure cloud settings in Settings first');
            return;
        }
        
        const settings = JSON.parse(savedSettings);
        
        // Generate signed URL
        const response = await fetch('/api/cloud/open/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                b2_settings: {
                    bucket_name: settings.b2BucketName,
                    endpoint_url: settings.b2EndpointUrl,
                    key_id: settings.b2KeyId,
                    application_key: settings.b2ApplicationKey
                },
                file_key: fileKey,
                expiration: 3600 // 1 hour for download
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // Direct download using the signed URL
            const a = document.createElement('a');
            a.href = data.url;
            a.download = filename;
            a.target = '_blank';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            showNotification('Download started');
        } else {
            const data = await response.json();
            showError('Failed to download file: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error downloading cloud file:', error);
        showError('Failed to download file');
    }
}

let currentShareFileKey = null;

// Generate custom share link
async function generateShareLink(fileKey, filename) {
    currentShareFileKey = fileKey;
    
    const content = `
        <label for="shareExpirationInput" style="display: block; margin-bottom: 8px; color: var(--text-main);">Expiration Time (hours)</label>
        <input type="number" id="shareExpirationInput" class="url-input" style="width: 100%; margin-bottom: 16px;" min="1" max="168" value="24">
        <p style="color: var(--text-muted); font-size: 0.85rem;">Maximum 168 hours (7 days) allowed by B2.</p>
        <div id="shareLinkResult" style="margin-top: 16px; display: none;">
            <label style="display: block; margin-bottom: 8px; color: var(--text-main);">Share Link</label>
            <div style="display: flex; gap: 8px;">
                <input type="text" id="shareLinkOutput" class="url-input" style="flex: 1;" readonly>
                <button class="btn-secondary" onclick="copyShareLink()">Copy</button>
            </div>
        </div>
    `;
    
    const modal = customModal({
        title: 'Generate Share Link',
        content,
        confirmText: 'Generate',
        onConfirm: async () => {
            if (!currentShareFileKey) return;
            
            const input = document.getElementById('shareExpirationInput');
            const expirationHours = parseInt(input.value);
            
            if (isNaN(expirationHours) || expirationHours < 1 || expirationHours > 168) {
                showError('Please enter a valid expiration time (1-168 hours)');
                return;
            }
            
            const expirationSeconds = Math.min(604800, Math.max(3600, expirationHours * 3600));
            
            try {
                const savedSettings = localStorage.getItem('ytDownloaderSettings');
                if (!savedSettings) {
                    showError('Please configure cloud settings in Settings first');
                    return;
                }
                
                const settings = JSON.parse(savedSettings);
                
                const response = await fetch('/api/cloud/open/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        b2_settings: {
                            bucket_name: settings.b2BucketName,
                            endpoint_url: settings.b2EndpointUrl,
                            key_id: settings.b2KeyId,
                            application_key: settings.b2ApplicationKey
                        },
                        file_key: currentShareFileKey,
                        expiration: expirationSeconds
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    
                    // Show result
                    const resultDiv = document.getElementById('shareLinkResult');
                    const output = document.getElementById('shareLinkOutput');
                    output.value = data.url;
                    resultDiv.style.display = 'block';
                    
                    // Auto-copy
                    await navigator.clipboard.writeText(data.url);
                    showNotification('Share link generated and copied');
                } else {
                    const data = await response.json();
                    showError('Failed to generate share link: ' + (data.error || 'Unknown error'));
                }
            } catch (error) {
                console.error('Error generating share link:', error);
                showError('Failed to generate share link');
            }
        }
    });
}

// Hide share link modal (no longer needed with modal.js)
function hideShareLinkModal() {
    // Handled by modal.js automatically
}

// Generate share link from modal (no longer needed with modal.js)
async function generateShareLinkFromModal() {
    // Handled by modal.js automatically
}

// Copy share link
async function copyShareLink() {
    const output = document.getElementById('shareLinkOutput');
    await navigator.clipboard.writeText(output.value);
    showNotification('Share link copied');
}

// Confirm delete cloud file
function confirmDeleteCloudFile(fileKey, downloadId, filename) {
    deleteFileKey = fileKey;
    deleteDownloadId = downloadId;
    
    const content = `
        <p>Are you sure you want to delete this file from cloud storage?</p>
        <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 8px;">${escapeHtml(filename)}</p>
    `;
    
    const modal = dangerModal(
        'Delete Cloud File',
        content,
        () => {
            executeDeleteCloudFile();
        }
    );
}

// Execute delete cloud file
async function executeDeleteCloudFile() {
    if (!deleteFileKey) return;
    
    try {
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (!savedSettings) {
            showError('Please configure cloud settings in Settings first');
            return;
        }
        
        const settings = JSON.parse(savedSettings);
        
        const response = await fetch('/api/cloud/file/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file_key: deleteFileKey,
                download_id: deleteDownloadId,
                b2_settings: {
                    bucket_name: settings.b2BucketName,
                    endpoint_url: settings.b2EndpointUrl,
                    key_id: settings.b2KeyId,
                    application_key: settings.b2ApplicationKey
                }
            })
        });
        
        if (response.ok) {
            showNotification('File deleted successfully!');
            loadCloudFiles();
            loadStorageInfo();
        } else {
            const data = await response.json();
            showError('Failed to delete file: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error deleting cloud file:', error);
        showError('Failed to delete file');
    }
    
    deleteFileKey = null;
    deleteDownloadId = null;
}

// Hide delete cloud file modal (no longer needed with modal.js)
function hideDeleteCloudFileModal() {
    // Handled by modal.js automatically
}

// Search files
function searchFiles(query) {
    const lowerQuery = query.toLowerCase();
    filteredFiles = cloudFiles.filter(file => 
        file.filename.toLowerCase().includes(lowerQuery) ||
        (file.download_id && file.download_id.toLowerCase().includes(lowerQuery))
    );
    applySort();
    renderCloudFiles();
}

// Sort files
function applySort() {
    const sortValue = document.getElementById('sortFilter').value;
    
    switch (sortValue) {
        case 'newest':
            filteredFiles.sort((a, b) => new Date(b.last_modified) - new Date(a.last_modified));
            break;
        case 'oldest':
            filteredFiles.sort((a, b) => new Date(a.last_modified) - new Date(b.last_modified));
            break;
        case 'name':
            filteredFiles.sort((a, b) => a.filename.localeCompare(b.filename));
            break;
        case 'size':
            filteredFiles.sort((a, b) => b.size - a.size);
            break;
    }
}

// Show notification
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

// Show error
function showError(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: var(--danger);
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
    }, 3000);
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Load storage info and files on page load
    loadStorageInfo();
    loadCloudFiles();
    
    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadStorageInfo();
        loadCloudFiles();
    });
    
    // Storage settings button
    document.getElementById('storageSettingsBtn').addEventListener('click', showStorageSettings);
    
    // Analytics toggle button
    document.getElementById('analyticsToggleBtn').addEventListener('click', toggleAnalytics);
    
    // Bulk upload button
    document.getElementById('bulkUploadBtn').addEventListener('click', handleBulkUpload);
    
    // Search input
    document.getElementById('searchInput').addEventListener('input', (e) => {
        searchFiles(e.target.value);
    });
    
    // Sort filter
    document.getElementById('sortFilter').addEventListener('change', () => {
        applySort();
        renderCloudFiles();
    });
});

// Show storage settings modal
function showStorageSettings() {
    const content = `
        <label for="storageLimitInput" style="display: block; margin-bottom: 8px; color: var(--text-main);">Storage Limit (GB)</label>
        <input type="number" id="storageLimitInput" class="url-input" style="width: 100%; margin-bottom: 16px;" min="1" step="1" value="${storageLimit}">
        <p style="color: var(--text-muted); font-size: 0.85rem;">Set the maximum storage limit for your B2 bucket. You will be alerted when usage exceeds 75% and 90%.</p>
    `;
    
    const modal = customModal({
        title: 'Storage Settings',
        content,
        confirmText: 'Save',
        onConfirm: () => {
            const input = document.getElementById('storageLimitInput');
            const newLimit = parseFloat(input.value);
            
            if (isNaN(newLimit) || newLimit <= 0) {
                showError('Please enter a valid storage limit');
                return;
            }
            
            storageLimit = newLimit;
            
            // Save to settings
            const savedSettings = localStorage.getItem('ytDownloaderSettings');
            if (savedSettings) {
                const settings = JSON.parse(savedSettings);
                settings.storageLimit = storageLimit;
                localStorage.setItem('ytDownloaderSettings', JSON.stringify(settings));
            }
            
            // Refresh display
            loadStorageInfo();
            showNotification('Storage limit updated');
        }
    });
}

// Hide storage settings modal (no longer needed with modal.js)
function hideStorageSettingsModal() {
    // Handled by modal.js automatically
}

// Toggle file selection for bulk operations
function toggleFileSelection(fileKey) {
    if (selectedFiles.has(fileKey)) {
        selectedFiles.delete(fileKey);
    } else {
        selectedFiles.add(fileKey);
    }
    updateBulkActionButton();
}

// Select all files
function selectAllFiles() {
    filteredFiles.forEach(file => selectedFiles.add(file.key));
    renderCloudFiles();
    updateBulkActionButton();
}

// Deselect all files
function deselectAllFiles() {
    selectedFiles.clear();
    renderCloudFiles();
    updateBulkActionButton();
}

// Update bulk delete button state
function updateBulkActionButton() {
    const btn = document.getElementById('bulkDeleteBtn');
    if (btn) {
        btn.disabled = selectedFiles.size === 0;
        btn.textContent = selectedFiles.size > 0 ? `Delete Selected (${selectedFiles.size})` : 'Delete Selected';
    }
}

// Confirm bulk delete
function confirmBulkDelete() {
    if (selectedFiles.size === 0) {
        showNotification('No files selected');
        return;
    }
    
    dangerModal(
        'Delete Selected Files',
        `Are you sure you want to delete ${selectedFiles.size} file(s) from cloud storage? This action cannot be undone.`,
        executeBulkDelete
    );
}

// Execute bulk delete
async function executeBulkDelete() {
    try {
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (!savedSettings) {
            showError('Please configure cloud settings in Settings first');
            return;
        }
        
        const settings = JSON.parse(savedSettings);
        
        const response = await fetch('/api/cloud/bulk-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file_keys: Array.from(selectedFiles),
                b2_settings: {
                    bucket_name: settings.b2BucketName,
                    endpoint_url: settings.b2EndpointUrl,
                    key_id: settings.b2KeyId,
                    application_key: settings.b2ApplicationKey
                }
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            showNotification(`Deleted ${data.deleted_count} file(s) successfully`);
            selectedFiles.clear();
            loadCloudFiles();
            loadStorageInfo();
        } else {
            const data = await response.json();
            showError('Failed to delete files: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error deleting files:', error);
        showError('Failed to delete files');
    }
}

// Bulk upload files
async function handleBulkUpload() {
    const fileInput = document.getElementById('bulkFileInput');
    fileInput.click();
}

// Set up the file input change handler once (outside the function to prevent duplicates)
let bulkUploadHandlerAttached = false;

document.addEventListener('DOMContentLoaded', () => {
    if (bulkUploadHandlerAttached) return;
    
    const fileInput = document.getElementById('bulkFileInput');
    if (fileInput) {
        let isUploading = false; // Flag to prevent duplicate uploads
        
        fileInput.onchange = async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;
            
            if (isUploading) {
                console.log('Upload already in progress, ignoring duplicate request');
                return;
            }
            
            isUploading = true;
            
            // Show Discord webhook confirmation modal
            const modal = confirmModal(
                'Discord Webhook Notification',
                'Send Discord webhook notification for this upload?',
                () => {
                    // User confirmed - proceed with upload and Discord notification
                    performBulkUpload(files, true).finally(() => {
                        isUploading = false;
                    });
                },
                () => {
                    // User cancelled - proceed without Discord notification
                    performBulkUpload(files, false).finally(() => {
                        isUploading = false;
                    });
                }
            );
        };
        
        bulkUploadHandlerAttached = true;
    }
});

// Perform the actual bulk upload
async function performBulkUpload(files, sendDiscord) {
    try {
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (!savedSettings) {
            showError('Please configure cloud settings in Settings first');
            return;
        }
        
        const settings = JSON.parse(savedSettings);
        
        // Read files as base64
        const filesData = await Promise.all(files.map(async (file) => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const base64 = reader.result.split(',')[1];
                    resolve({
                        filename: file.name,
                        data: base64,
                        type: file.type
                    });
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }));
        
        showNotification(`Uploading ${files.length} files...`);
        
        const response = await fetch('/api/cloud/bulk-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: filesData,
                b2_settings: {
                    bucket_name: settings.b2BucketName,
                    endpoint_url: settings.b2EndpointUrl,
                    key_id: settings.b2KeyId,
                    application_key: settings.b2ApplicationKey,
                    discord_webhook: settings.discordWebhook
                },
                send_discord: sendDiscord
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            showNotification(`Uploaded ${data.total_uploaded} files successfully`);
            
            if (data.total_errors > 0) {
                showError(`${data.total_errors} files failed to upload`);
            }
            
            // Refresh file list
            loadCloudFiles();
            loadStorageInfo();
        } else {
            const data = await response.json();
            showError('Bulk upload failed: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error in bulk upload:', error);
        showError('Bulk upload failed');
    }
    
    // Reset file input
    document.getElementById('bulkFileInput').value = '';
}
