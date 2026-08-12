// Settings page JavaScript
const defaultSettings = {
    defaultQuality: 'best',
    downloadFolder: '',
    playerFolder: '',
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
//  Local Storage Usage
// ────────────────────────────────────────────────────────────
function calculateLocalStorageUsage() {
    let total = 0;
    
    for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
            total += localStorage[key].length + key.length;
        }
    }
    
    return total; // in bytes
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function updateLocalStorageDisplay() {
    const used = calculateLocalStorageUsage();
    const limit = 5 * 1024 * 1024; // 5 MB typical limit
    const percentage = Math.min(100, (used / limit) * 100);
    
    document.getElementById('localStorageUsed').textContent = formatBytes(used);
    document.getElementById('localStorageLimit').textContent = formatBytes(limit);
    document.getElementById('localStoragePercent').textContent = `(${percentage.toFixed(1)}%)`;
    document.getElementById('localStorageFill').style.width = `${percentage}%`;
    
    // Change color based on usage
    const fill = document.getElementById('localStorageFill');
    if (percentage > 90) {
        fill.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
    } else if (percentage > 75) {
        fill.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
    } else {
        fill.style.background = 'linear-gradient(90deg, var(--primary-color), #8b5cf6)';
    }
}

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

// ────────────────────────────────────────────────────────────
//  Mobile Detection
// ────────────────────────────────────────────────────────────
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
           (window.innerWidth <= 768);
}

// Hide folder browse button on mobile devices
function handleMobileUI() {
    if (isMobileDevice()) {
        // Hide browse folder buttons
        const browseBtns = document.querySelectorAll('.folder-input .btn-secondary');
        browseBtns.forEach(btn => {
            btn.style.display = 'none';
        });
        
        // Set default download folder for mobile (downloads folder)
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            if (!settings.downloadFolder || settings.downloadFolder === '') {
                // Set a default path for mobile (server-side will handle this)
                settings.downloadFolder = 'downloads';
                localStorage.setItem('ytDownloaderSettings', JSON.stringify(settings));
            }
        }
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

async function browsePlayerFolder() {
    try {
        const response = await fetch('/api/browse-folder', { method: 'POST' });
        const data = await response.json();
        
        if (data.folderpath) {
            document.getElementById('playerFolder').value = data.folderpath;
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
    document.getElementById('playerFolder').value = currentSettings.playerFolder || '';
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
    currentSettings.playerFolder = document.getElementById('playerFolder').value;
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
    updateLocalStorageDisplay();
    
    // Event listeners
    document.getElementById('saveSettings').addEventListener('click', saveSettings);
    document.getElementById('resetSettings').addEventListener('click', resetSettings);
    
    // Browse folder button
    const browseBtn = document.querySelector('.folder-input .btn-secondary');
    if (browseBtn) {
        browseBtn.addEventListener('click', browseFolder);
    }
    
    // Handle mobile UI (hide browse buttons, set defaults)
    handleMobileUI();
    
    // Browse player folder button
    const browsePlayerBtn = document.getElementById('browsePlayerFolder');
    if (browsePlayerBtn) {
        browsePlayerBtn.addEventListener('click', browsePlayerFolder);
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
    
    // Spotify settings
    loadSpotifyCredentials();
    document.getElementById('saveSpotifySettings').addEventListener('click', saveSpotifyCredentials);
    document.getElementById('testSpotifyConnection').addEventListener('click', testSpotifyConnection);
});

// ────────────────────────────────────────────────────────────
//  Spotify Settings
// ────────────────────────────────────────────────────────────
async function loadSpotifyCredentials() {
    try {
        const response = await fetch('/api/spotify/credentials');
        const data = await response.json();
        
        if (data.status === 'success') {
            if (data.client_id) {
                document.getElementById('spotifyClientId').value = data.client_id;
            }
            if (data.redirect_uri) {
                document.getElementById('spotifyRedirectUri').value = data.redirect_uri;
            }
        }
    } catch (error) {
        console.error('Error loading Spotify credentials:', error);
    }
}

async function saveSpotifyCredentials() {
    const clientId = document.getElementById('spotifyClientId').value.trim();
    const clientSecret = document.getElementById('spotifyClientSecret').value.trim();
    const redirectUri = document.getElementById('spotifyRedirectUri').value.trim();
    
    if (!clientId || !clientSecret) {
        showSpotifyStatus('error', 'Client ID and Client Secret are required');
        return;
    }
    
    try {
        const response = await fetch('/api/spotify/credentials', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri
            })
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            showSpotifyStatus('success', 'Spotify credentials saved successfully!');
            document.getElementById('spotifyClientSecret').value = ''; // Clear secret for security
        } else {
            showSpotifyStatus('error', data.message || 'Failed to save credentials');
        }
    } catch (error) {
        showSpotifyStatus('error', 'Failed to save credentials: ' + error.message);
    }
}

async function testSpotifyConnection() {
    showSpotifyStatus('info', 'Testing connection...');
    
    try {
        const response = await fetch('/api/spotify/credentials');
        const data = await response.json();
        
        if (data.status === 'success' && data.has_credentials) {
            showSpotifyStatus('success', 'Spotify credentials are configured! Try playing a track to test.');
        } else {
            showSpotifyStatus('error', 'No Spotify credentials found. Please configure them first.');
        }
    } catch (error) {
        showSpotifyStatus('error', 'Failed to test connection: ' + error.message);
    }
}

function showSpotifyStatus(type, message) {
    const statusEl = document.getElementById('spotifyStatus');
    statusEl.className = 'spotify-status ' + type;
    statusEl.textContent = message;
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        statusEl.className = 'spotify-status';
    }, 5000);
}