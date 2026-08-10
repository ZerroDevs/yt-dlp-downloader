// Settings page JavaScript
const defaultSettings = {
    defaultQuality: 'best',
    downloadFolder: '',
    maxConcurrent: 3,
    filenameTemplate: '{title}_{quality}_{date}',
    autoRename: false,
    autoFetch: true,
    notifications: true,
    theme: 'dark',
    // Cloud Archive Settings
    b2BucketName: '',
    b2EndpointUrl: 'https://s3.eu-central-003.backblazeb2.com',
    b2KeyId: '',
    b2ApplicationKey: '',
    discordWebhookUrl: '',
    autoUpload: false,
    signedUrlExpiration: 604800,  // 7 days (B2 max limit)
    storageLimitGB: 10  // Default 10GB free tier
};

let currentSettings = { ...defaultSettings };

// ────────────────────────────────────────────────────────────
//  Tab Navigation
// ────────────────────────────────────────────────────────────
function initSettingsNav() {
    const navItems = document.querySelectorAll('.settings-nav-item');
    const tabs = document.querySelectorAll('.settings-tab');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tabName = item.dataset.tab;

            // Update nav items
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Update tabs
            tabs.forEach(tab => tab.classList.remove('active'));
            const targetTab = document.getElementById(`${tabName}-tab`);
            if (targetTab) {
                targetTab.classList.add('active');
            }
        });
    });
}

// ────────────────────────────────────────────────────────────
//  Cloud Storage Info
// ────────────────────────────────────────────────────────────
async function fetchStorageInfo() {
    const refreshBtn = document.getElementById('refreshStorageBtn');
    const contentDiv = document.getElementById('storageInfoContent');
    
    if (refreshBtn) refreshBtn.disabled = true;
    
    try {
        const response = await fetch('/api/cloud/storage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                b2_settings: {
                    bucket_name: currentSettings.b2BucketName,
                    endpoint_url: currentSettings.b2EndpointUrl,
                    key_id: currentSettings.b2KeyId,
                    application_key: currentSettings.b2ApplicationKey
                }
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const usedGB = data.total_size_gb;
            const limitGB = currentSettings.storageLimitGB || 10;
            const freeGB = Math.max(0, limitGB - usedGB).toFixed(2);
            const percentUsed = Math.min(100, (usedGB / limitGB) * 100).toFixed(1);
            
            contentDiv.innerHTML = `
                <div class="storage-info-data">
                    <div class="storage-info-item" style="grid-column: span 2;">
                        <div class="storage-info-label">Storage Usage</div>
                        <div class="storage-progress-container">
                            <div class="storage-progress-bar">
                                <div class="storage-progress-fill" style="width: ${percentUsed}%"></div>
                            </div>
                            <div class="storage-progress-text">${percentUsed}% used</div>
                        </div>
                    </div>
                    <div class="storage-info-item">
                        <div class="storage-info-label">Used</div>
                        <div class="storage-info-value">${usedGB} GB</div>
                    </div>
                    <div class="storage-info-item">
                        <div class="storage-info-label">Free</div>
                        <div class="storage-info-value">${freeGB} GB</div>
                    </div>
                    <div class="storage-info-item">
                        <div class="storage-info-label">Limit</div>
                        <div class="storage-info-value">${limitGB} GB</div>
                    </div>
                    <div class="storage-info-item">
                        <div class="storage-info-label">Files</div>
                        <div class="storage-info-value">${data.file_count}</div>
                    </div>
                </div>
            `;
        } else {
            contentDiv.innerHTML = `
                <div class="storage-info-placeholder">
                    <span style="color: var(--danger);">Error: ${data.error || 'Failed to fetch storage info'}</span>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error fetching storage info:', error);
        contentDiv.innerHTML = `
            <div class="storage-info-placeholder">
                <span style="color: var(--danger);">Error: Failed to connect to cloud</span>
            </div>
        `;
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

// ────────────────────────────────────────────────────────────
//  Cleanup .part files
// ────────────────────────────────────────────────────────────
async function cleanupPartFiles() {
    try {
        const response = await fetch('/api/cleanup-part-files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ download_folder: currentSettings.downloadFolder })
        });
        const data = await response.json();
        
        if (response.ok) {
            if (data.deleted_count > 0) {
                showNotification(`Deleted ${data.deleted_count} .part file(s)`);
            } else {
                showNotification('No .part files found');
            }
        } else {
            showNotification('Failed to cleanup .part files: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error cleaning up .part files:', error);
        showNotification('Failed to cleanup .part files');
    }
}

function loadSettings() {
    try {
        const saved = localStorage.getItem('ytDownloaderSettings');
        if (saved) {
            currentSettings = { ...defaultSettings, ...JSON.parse(saved) };
        }
        applySettingsToUI();
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function browseFolder() {
    try {
        const response = await fetch('/api/browse-folder', { method: 'POST' });
        const data = await response.json();
        
        if (data.folderpath) {
            document.getElementById('downloadFolder').value = data.folderpath;
            // Also save it automatically when chosen
            saveSettings();
        } else if (data.error) {
            showError('Error opening folder picker: ' + data.error);
        }
    } catch (error) {
        console.error('Error browsing for folder:', error);
        showError('Unable to open folder picker');
    }
}

function applySettingsToUI() {
    document.getElementById('defaultQuality').value = currentSettings.defaultQuality;
    document.getElementById('downloadFolder').value = currentSettings.downloadFolder;
    document.getElementById('maxConcurrent').value = currentSettings.maxConcurrent;
    document.getElementById('filenameTemplate').value = currentSettings.filenameTemplate;
    document.getElementById('autoRename').checked = currentSettings.autoRename;
    document.getElementById('autoFetch').checked = currentSettings.autoFetch;
    document.getElementById('notifications').checked = currentSettings.notifications;
    document.getElementById('theme').value = currentSettings.theme;
    
    // Cloud Archive Settings
    document.getElementById('b2BucketName').value = currentSettings.b2BucketName || '';
    document.getElementById('b2EndpointUrl').value = currentSettings.b2EndpointUrl || '';
    document.getElementById('b2KeyId').value = currentSettings.b2KeyId || '';
    document.getElementById('b2ApplicationKey').value = currentSettings.b2ApplicationKey || '';
    document.getElementById('discordWebhookUrl').value = currentSettings.discordWebhookUrl || '';
    document.getElementById('autoUpload').checked = currentSettings.autoUpload || false;
    document.getElementById('signedUrlExpiration').value = currentSettings.signedUrlExpiration || 604800;
    document.getElementById('storageLimitGB').value = currentSettings.storageLimitGB || 10;
    
    // Apply theme
    if (currentSettings.theme === 'light') {
        document.body.setAttribute('data-theme', 'light');
    } else if (currentSettings.theme === 'dark') {
        document.body.removeAttribute('data-theme');
    }
}

function saveSettings() {
    currentSettings.defaultQuality = document.getElementById('defaultQuality').value;
    currentSettings.downloadFolder = document.getElementById('downloadFolder').value;
    currentSettings.maxConcurrent = parseInt(document.getElementById('maxConcurrent').value);
    currentSettings.filenameTemplate = document.getElementById('filenameTemplate').value;
    currentSettings.autoRename = document.getElementById('autoRename').checked;
    currentSettings.autoFetch = document.getElementById('autoFetch').checked;
    currentSettings.notifications = document.getElementById('notifications').checked;
    currentSettings.theme = document.getElementById('theme').value;
    
    // Cloud Archive Settings
    currentSettings.b2BucketName = document.getElementById('b2BucketName').value;
    currentSettings.b2EndpointUrl = document.getElementById('b2EndpointUrl').value;
    currentSettings.b2KeyId = document.getElementById('b2KeyId').value;
    currentSettings.b2ApplicationKey = document.getElementById('b2ApplicationKey').value;
    currentSettings.discordWebhookUrl = document.getElementById('discordWebhookUrl').value;
    currentSettings.autoUpload = document.getElementById('autoUpload').checked;
    currentSettings.signedUrlExpiration = parseInt(document.getElementById('signedUrlExpiration').value);
    currentSettings.storageLimitGB = parseInt(document.getElementById('storageLimitGB').value);
    
    try {
        localStorage.setItem('ytDownloaderSettings', JSON.stringify(currentSettings));
        applySettingsToUI();
        showNotification('Settings saved successfully!');
    } catch (error) {
        console.error('Error saving settings:', error);
        showNotification('Error saving settings');
    }
}

function resetSettings() {
    dangerModal(
        'Reset Settings',
        'Are you sure you want to reset all settings to default values?',
        () => {
            currentSettings = { ...defaultSettings };
            applySettingsToUI();
            localStorage.setItem('ytDownloaderSettings', JSON.stringify(currentSettings));
            showNotification('Settings reset to defaults');
        }
    );
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    initSettingsNav();
    
    // Event listeners
    document.getElementById('saveSettings').addEventListener('click', saveSettings);
    document.getElementById('resetSettings').addEventListener('click', resetSettings);
    
    // Browse folder button
    const browseBtn = document.querySelector('.folder-input .btn-secondary');
    if (browseBtn) {
        browseBtn.addEventListener('click', browseFolder);
    }
    
    // Cleanup .part files button
    const cleanupPartBtn = document.getElementById('cleanupPartBtn');
    if (cleanupPartBtn) {
        cleanupPartBtn.addEventListener('click', cleanupPartFiles);
    }
    
    // Refresh storage info button
    const refreshStorageBtn = document.getElementById('refreshStorageBtn');
    if (refreshStorageBtn) {
        refreshStorageBtn.addEventListener('click', fetchStorageInfo);
    }
    
    document.getElementById('theme').addEventListener('change', (e) => {
        if (e.target.value === 'light') {
            document.body.setAttribute('data-theme', 'light');
        } else if (e.target.value === 'dark') {
            document.body.removeAttribute('data-theme');
        }
    });
});