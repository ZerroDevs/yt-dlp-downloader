// ────────────────────────────────────────────────────────────
//  Other Tools Page - Tab Persistence & Functionality
// ────────────────────────────────────────────────────────────

// Tab persistence key
const OTHER_TAB_KEY = 'otherToolsActiveTab';

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadActiveTab();
    setupTabListeners();
    setupUrlShortener();
    setupQrGenerator();
    setupImageConverter();
    setupImageResizer();
    setupImageCompressor();
    setupImageCropper();
    setupVideoTrimmer();
    setupGifMaker();
});

// ────────────────────────────────────────────────────────────
//  Tab Persistence
// ────────────────────────────────────────────────────────────
function loadActiveTab() {
    try {
        const savedTab = localStorage.getItem(OTHER_TAB_KEY);
        if (savedTab) {
            switchOtherTab(savedTab);
        }
    } catch (error) {
        console.error('Error loading active tab:', error);
    }
}

function saveActiveTab(tabName) {
    try {
        localStorage.setItem(OTHER_TAB_KEY, tabName);
    } catch (error) {
        console.error('Error saving active tab:', error);
    }
}

function setupTabListeners() {
    const tabBtns = document.querySelectorAll('.other-tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchOtherTab(tabName);
            saveActiveTab(tabName);
        });
    });
}

function switchOtherTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.other-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab panels
    document.querySelectorAll('.other-tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `${tabName}-panel`);
    });
}

// ────────────────────────────────────────────────────────────
//  URL Shortener
// ────────────────────────────────────────────────────────────
function setupUrlShortener() {
    const shortenBtn = document.getElementById('shortenBtn');
    const longUrlInput = document.getElementById('longUrl');
    const copyShortBtn = document.getElementById('copyShortBtn');
    const clearHistoryBtn = document.getElementById('clearShortenHistory');
    const downloadQrBtn = document.getElementById('downloadQrBtn');

    if (shortenBtn) {
        shortenBtn.addEventListener('click', shortenUrl);
    }

    if (copyShortBtn) {
        copyShortBtn.addEventListener('click', copyShortUrl);
    }

    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', clearShortenHistory);
    }

    if (downloadQrBtn) {
        downloadQrBtn.addEventListener('click', downloadQrCode);
    }

    loadShortenHistory();
}

async function shortenUrl() {
    const longUrl = document.getElementById('longUrl').value.trim();
    if (!longUrl) {
        showToast('Please enter a URL', 'error');
        return;
    }

    // Get selected shortening method
    const method = document.querySelector('input[name="shortenMethod"]:checked').value;

    try {
        const response = await fetch('/api/shorten', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: longUrl, method: method })
        });

        const data = await response.json();

        console.log('Shorten response:', data);

        if (data.success) {
            document.getElementById('shortUrl').value = data.short_url;
            document.getElementById('shortenResult').classList.remove('hidden');
            addToShortenHistory(longUrl, data.short_url);
            
            // Show appropriate message based on method
            if (data.method && data.method.includes('fallback')) {
                showToast(`URL shortened using ${data.method}`, 'info');
            } else {
                showToast('URL shortened successfully!', 'success');
            }
            
            // Generate QR code
            generateQRCode(data.short_url);
        } else {
            showToast('Failed to shorten URL: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error shortening URL:', error);
        showToast('Error shortening URL. Please try again.', 'error');
    }
}

function copyShortUrl() {
    const shortUrl = document.getElementById('shortUrl');
    shortUrl.select();
    document.execCommand('copy');
    showToast('Copied to clipboard!', 'success');
}

function clearShortenHistory() {
    try {
        localStorage.removeItem('shortenHistory');
        loadShortenHistory();
        showToast('History cleared', 'success');
    } catch (error) {
        console.error('Error clearing history:', error);
    }
}

function generateQRCode(url) {
    const qrCodeImg = document.getElementById('qrCode');
    const qrContainer = document.getElementById('qrCodeContainer');
    
    // Use QR Server API to generate QR code
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
    qrCodeImg.src = qrApiUrl;
    qrContainer.classList.remove('hidden');
}

function downloadQrCode() {
    const qrCodeImg = document.getElementById('qrCode');
    const shortUrl = document.getElementById('shortUrl').value;
    
    // Create a temporary link to download the QR code
    const link = document.createElement('a');
    link.href = qrCodeImg.src;
    link.download = `qr-${shortUrl.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('QR code downloaded!', 'success');
}

// ────────────────────────────────────────────────────────────
//  QR Code Generator
// ────────────────────────────────────────────────────────────
function setupQrGenerator() {
    const generateBtn = document.getElementById('generateQrBtn');
    const downloadBtn = document.getElementById('downloadQrStandaloneBtn');

    if (generateBtn) {
        generateBtn.addEventListener('click', generateStandaloneQr);
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadStandaloneQr);
    }
}

function generateStandaloneQr() {
    const text = document.getElementById('qrText').value.trim();
    if (!text) {
        showToast('Please enter text or URL', 'error');
        return;
    }

    const qrCodeImg = document.getElementById('qrCodeStandalone');
    const qrResult = document.getElementById('qrResult');
    
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}`;
    qrCodeImg.src = qrApiUrl;
    qrResult.classList.remove('hidden');
    showToast('QR code generated!', 'success');
}

function downloadStandaloneQr() {
    const qrCodeImg = document.getElementById('qrCodeStandalone');
    const text = document.getElementById('qrText').value;
    
    const link = document.createElement('a');
    link.href = qrCodeImg.src;
    link.download = `qr-${text.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('QR code downloaded!', 'success');
}

// ────────────────────────────────────────────────────────────
//  Image Converter
// ────────────────────────────────────────────────────────────
function setupImageConverter() {
    const convertBtn = document.getElementById('convertBtn');
    const downloadBtn = document.getElementById('downloadConvertBtn');

    if (convertBtn) {
        convertBtn.addEventListener('click', convertImage);
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => downloadImage('convertPath'));
    }
}

async function convertImage() {
    const fileInput = document.getElementById('convertImageFile');
    const format = document.getElementById('convertFormat').value;
    
    if (!fileInput.files[0]) {
        showToast('Please select an image', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    formData.append('format', format);

    const progress = document.getElementById('convertProgress');
    const progressBar = document.getElementById('convertProgressBar');
    const result = document.getElementById('convertResult');
    
    progress.classList.remove('hidden');
    progressBar.style.width = '50%';

    try {
        const response = await fetch('/api/image/convert', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            document.getElementById('convertPath').value = data.output_path;
            document.getElementById('convertPreview').src = `/api/download-image?path=${data.output_path}`;
            result.classList.remove('hidden');
            progressBar.style.width = '100%';
            showToast('Image converted successfully!', 'success');
        } else {
            showToast('Failed to convert image: ' + (data.error || 'Unknown error'), 'error');
            progress.classList.add('hidden');
        }
    } catch (error) {
        console.error('Error converting image:', error);
        showToast('Error converting image. Please try again.', 'error');
        progress.classList.add('hidden');
    }
}

// ────────────────────────────────────────────────────────────
//  Image Resizer
// ────────────────────────────────────────────────────────────
function setupImageResizer() {
    const resizeBtn = document.getElementById('resizeBtn');
    const downloadBtn = document.getElementById('downloadResizeBtn');
    const maintainAspect = document.getElementById('maintainAspect');
    const widthInput = document.getElementById('resizeWidth');
    const heightInput = document.getElementById('resizeHeight');

    if (resizeBtn) {
        resizeBtn.addEventListener('click', resizeImage);
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => downloadImage('resizePath'));
    }

    if (maintainAspect && widthInput && heightInput) {
        widthInput.addEventListener('input', () => {
            if (maintainAspect.checked) {
                // Auto-calculate height based on aspect ratio
                // This would need the original image dimensions
            }
        });
    }
}

async function resizeImage() {
    const fileInput = document.getElementById('resizeImageFile');
    const width = document.getElementById('resizeWidth').value;
    const height = document.getElementById('resizeHeight').value;
    const maintainAspect = document.getElementById('maintainAspect').checked;
    
    if (!fileInput.files[0]) {
        showToast('Please select an image', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    formData.append('width', width);
    formData.append('height', height);
    formData.append('maintainAspect', maintainAspect);

    const progress = document.getElementById('resizeProgress');
    const progressBar = document.getElementById('resizeProgressBar');
    const result = document.getElementById('resizeResult');
    
    progress.classList.remove('hidden');
    progressBar.style.width = '50%';

    try {
        const response = await fetch('/api/image/resize', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            document.getElementById('resizePath').value = data.output_path;
            document.getElementById('resizePreview').src = `/api/download-image?path=${data.output_path}`;
            result.classList.remove('hidden');
            progressBar.style.width = '100%';
            showToast('Image resized successfully!', 'success');
        } else {
            showToast('Failed to resize image: ' + (data.error || 'Unknown error'), 'error');
            progress.classList.add('hidden');
        }
    } catch (error) {
        console.error('Error resizing image:', error);
        showToast('Error resizing image. Please try again.', 'error');
        progress.classList.add('hidden');
    }
}

// ────────────────────────────────────────────────────────────
//  Image Compressor
// ────────────────────────────────────────────────────────────
function setupImageCompressor() {
    const compressBtn = document.getElementById('compressBtn');
    const downloadBtn = document.getElementById('downloadCompressBtn');
    const qualitySlider = document.getElementById('compressQuality');
    const qualityValue = document.getElementById('compressQualityValue');

    if (compressBtn) {
        compressBtn.addEventListener('click', compressImage);
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => downloadImage('compressPath'));
    }

    if (qualitySlider && qualityValue) {
        qualitySlider.addEventListener('input', () => {
            qualityValue.textContent = qualitySlider.value + '%';
        });
    }
}

async function compressImage() {
    const fileInput = document.getElementById('compressImageFile');
    const quality = document.getElementById('compressQuality').value;
    
    if (!fileInput.files[0]) {
        showToast('Please select an image', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    formData.append('quality', quality);

    const progress = document.getElementById('compressProgress');
    const progressBar = document.getElementById('compressProgressBar');
    const result = document.getElementById('compressResult');
    
    progress.classList.remove('hidden');
    progressBar.style.width = '50%';

    try {
        const response = await fetch('/api/image/compress', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            document.getElementById('compressPath').value = data.output_path;
            document.getElementById('compressPreview').src = `/api/download-image?path=${data.output_path}`;
            document.getElementById('originalSize').textContent = data.original_size;
            document.getElementById('compressedSize').textContent = data.compressed_size;
            document.getElementById('savedPercent').textContent = data.saved_percent;
            result.classList.remove('hidden');
            progressBar.style.width = '100%';
            showToast('Image compressed successfully!', 'success');
        } else {
            showToast('Failed to compress image: ' + (data.error || 'Unknown error'), 'error');
            progress.classList.add('hidden');
        }
    } catch (error) {
        console.error('Error compressing image:', error);
        showToast('Error compressing image. Please try again.', 'error');
        progress.classList.add('hidden');
    }
}

// ────────────────────────────────────────────────────────────
//  Image Cropper
// ────────────────────────────────────────────────────────────
function setupImageCropper() {
    const cropBtn = document.getElementById('cropBtn');
    const downloadBtn = document.getElementById('downloadCropBtn');
    const fileInput = document.getElementById('cropImageFile');
    const preview = document.getElementById('cropPreviewOriginal');

    if (cropBtn) {
        cropBtn.addEventListener('click', cropImage);
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => downloadImage('cropPath'));
    }

    if (fileInput && preview) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    preview.src = e.target.result;
                };
                reader.readAsDataURL(e.target.files[0]);
            }
        });
    }
}

async function cropImage() {
    const fileInput = document.getElementById('cropImageFile');
    const x = document.getElementById('cropX').value;
    const y = document.getElementById('cropY').value;
    const width = document.getElementById('cropWidth').value;
    const height = document.getElementById('cropHeight').value;
    
    if (!fileInput.files[0]) {
        showToast('Please select an image', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    formData.append('x', x);
    formData.append('y', y);
    formData.append('width', width);
    formData.append('height', height);

    try {
        const response = await fetch('/api/image/crop', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            document.getElementById('cropPath').value = data.output_path;
            document.getElementById('cropPreviewFinal').src = `/api/download-image?path=${data.output_path}`;
            document.getElementById('cropResult').classList.remove('hidden');
            showToast('Image cropped successfully!', 'success');
        } else {
            showToast('Failed to crop image: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error cropping image:', error);
        showToast('Error cropping image. Please try again.', 'error');
    }
}

function downloadImage(pathId) {
    const path = document.getElementById(pathId).value;
    window.open(`/api/download-image?path=${path}`, '_blank');
    showToast('Download started!', 'success');
}

function addToShortenHistory(longUrl, shortUrl) {
    try {
        let history = JSON.parse(localStorage.getItem('shortenHistory') || '[]');
        history.unshift({ longUrl, shortUrl, timestamp: Date.now() });
        history = history.slice(0, 10); // Keep last 10
        localStorage.setItem('shortenHistory', JSON.stringify(history));
        loadShortenHistory();
    } catch (error) {
        console.error('Error saving to history:', error);
    }
}

function loadShortenHistory() {
    try {
        const history = JSON.parse(localStorage.getItem('shortenHistory') || '[]');
        const historyList = document.getElementById('shortenHistoryList');
        if (!historyList) return;

        if (history.length === 0) {
            historyList.innerHTML = '<p class="empty-history">No recent shortened URLs</p>';
            return;
        }

        historyList.innerHTML = history.map(item => `
            <div class="history-item">
                <div class="history-url">${escapeHtml(item.longUrl.substring(0, 50))}${item.longUrl.length > 50 ? '...' : ''}</div>
                <div class="history-short">${escapeHtml(item.shortUrl)}</div>
                <button class="history-copy" data-url="${escapeHtml(item.shortUrl)}">Copy</button>
            </div>
        `).join('');

        // Add copy listeners
        historyList.querySelectorAll('.history-copy').forEach(btn => {
            btn.addEventListener('click', () => {
                navigator.clipboard.writeText(btn.dataset.url);
                alert('Copied!');
            });
        });
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

// ────────────────────────────────────────────────────────────
//  Video Trimmer
// ────────────────────────────────────────────────────────────
function setupVideoTrimmer() {
    const trimBtn = document.getElementById('trimBtn');
    const downloadTrimmedBtn = document.getElementById('downloadTrimmedBtn');
    const videoFile = document.getElementById('trimVideoFile');

    if (trimBtn) {
        trimBtn.addEventListener('click', trimVideo);
    }

    if (downloadTrimmedBtn) {
        downloadTrimmedBtn.addEventListener('click', downloadTrimmedVideo);
    }

    if (videoFile) {
        videoFile.addEventListener('change', updateTrimDuration);
    }
}

function updateTrimDuration() {
    const videoFile = document.getElementById('trimVideoFile');
    if (videoFile.files.length > 0) {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(videoFile.files[0]);
        video.onloadedmetadata = () => {
            document.getElementById('trimEnd').max = video.duration;
            document.getElementById('trimEnd').value = video.duration;
        };
    }
}

async function trimVideo() {
    const videoFile = document.getElementById('trimVideoFile');
    const startTime = parseFloat(document.getElementById('trimStart').value);
    const endTime = parseFloat(document.getElementById('trimEnd').value);

    if (!videoFile.files.length) {
        alert('Please select a video file');
        return;
    }

    if (startTime >= endTime) {
        alert('Start time must be less than end time');
        return;
    }

    const formData = new FormData();
    formData.append('video', videoFile.files[0]);
    formData.append('start', startTime);
    formData.append('end', endTime);

    try {
        document.getElementById('trimProgress').classList.remove('hidden');
        const response = await fetch('/api/trim', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            document.getElementById('trimmedVideoPath').value = data.output_path;
            document.getElementById('trimResult').classList.remove('hidden');
            document.getElementById('trimProgress').classList.add('hidden');
        } else {
            alert('Failed to trim video: ' + (data.error || 'Unknown error'));
            document.getElementById('trimProgress').classList.add('hidden');
        }
    } catch (error) {
        console.error('Error trimming video:', error);
        alert('Error trimming video. Please try again.');
        document.getElementById('trimProgress').classList.add('hidden');
    }
}

function downloadTrimmedVideo() {
    const path = document.getElementById('trimmedVideoPath').value;
    if (path) {
        window.location.href = `/api/download-trimmed?path=${encodeURIComponent(path)}`;
    }
}

// ────────────────────────────────────────────────────────────
//  GIF Maker
// ────────────────────────────────────────────────────────────
function setupGifMaker() {
    const gifBtn = document.getElementById('gifBtn');
    const downloadGifBtn = document.getElementById('downloadGifBtn');
    const gifVideoFile = document.getElementById('gifVideoFile');

    if (gifBtn) {
        gifBtn.addEventListener('click', createGif);
    }

    if (downloadGifBtn) {
        downloadGifBtn.addEventListener('click', downloadGif);
    }

    if (gifVideoFile) {
        gifVideoFile.addEventListener('change', updateGifDuration);
    }
}

function updateGifDuration() {
    const gifVideoFile = document.getElementById('gifVideoFile');
    if (gifVideoFile.files.length > 0) {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(gifVideoFile.files[0]);
        video.onloadedmetadata = () => {
            document.getElementById('gifDuration').max = video.duration;
        };
    }
}

async function createGif() {
    const gifVideoFile = document.getElementById('gifVideoFile');
    const startTime = parseFloat(document.getElementById('gifStart').value);
    const duration = parseFloat(document.getElementById('gifDuration').value);
    const width = parseInt(document.getElementById('gifWidth').value);
    const fps = parseInt(document.getElementById('gifFps').value);

    if (!gifVideoFile.files.length) {
        alert('Please select a video file');
        return;
    }

    const formData = new FormData();
    formData.append('video', gifVideoFile.files[0]);
    formData.append('start', startTime);
    formData.append('duration', duration);
    formData.append('width', width);
    formData.append('fps', fps);

    try {
        document.getElementById('gifProgress').classList.remove('hidden');
        const response = await fetch('/api/create-gif', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            document.getElementById('gifPreview').src = data.gif_url;
            document.getElementById('gifPath').value = data.output_path;
            document.getElementById('gifResult').classList.remove('hidden');
            document.getElementById('gifProgress').classList.add('hidden');
        } else {
            alert('Failed to create GIF: ' + (data.error || 'Unknown error'));
            document.getElementById('gifProgress').classList.add('hidden');
        }
    } catch (error) {
        console.error('Error creating GIF:', error);
        alert('Error creating GIF. Please try again.');
        document.getElementById('gifProgress').classList.add('hidden');
    }
}

function downloadGif() {
    const path = document.getElementById('gifPath').value;
    if (path) {
        window.location.href = `/api/download-gif?path=${encodeURIComponent(path)}`;
    }
}

// ────────────────────────────────────────────────────────────
//  Utility Functions
// ────────────────────────────────────────────────────────────
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    // Create toast container if it doesn't exist
    let toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toastContainer';
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    // Add to container
    toastContainer.appendChild(toast);
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.add('toast-removing');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}
