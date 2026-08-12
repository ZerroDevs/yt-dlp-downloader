// Global variables
let audioPlayer = document.getElementById('audioPlayer');
let playlist = [];
let currentTrackIndex = -1;
let isPlaying = false;
let isShuffled = false;
let repeatMode = 0; // 0: off, 1: all, 2: one
let originalPlaylist = [];
let playbackSpeed = 1;
let recentlyPlayed = [];
let favorites = [];
let abRepeat = { a: null, b: null, enabled: false };
let customPlaylists = [];

// ────────────────────────────────────────────────────────────
//  Mobile Detection
// ────────────────────────────────────────────────────────────
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
           (window.innerWidth <= 768);
}

// ────────────────────────────────────────────────────────────
//  Utility Functions
// ────────────────────────────────────────────────────────────
function calculateSimilarity(str1, str2) {
    // Simple Levenshtein distance-based similarity
    if (str1 === str2) return 1;
    if (str1.length === 0 || str2.length === 0) return 0;
    
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1;
    
    const costs = [];
    for (let i = 0; i <= longer.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= shorter.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else if (j > 0) {
                let newValue = costs[j - 1];
                if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
                    newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) costs[shorter.length] = lastValue;
    }
    
    return 1 - (costs[shorter.length] / longer.length);
}

function detectPlatform(url) {
    const urlLower = url.toLowerCase();
    
    // YouTube patterns
    if (urlLower.includes('youtube.com/watch') || 
        urlLower.includes('youtu.be/') || 
        urlLower.includes('youtube.com/shorts/')) {
        return 'YouTube';
    }
    
    // TikTok patterns
    if (urlLower.includes('tiktok.com/@') || 
        urlLower.includes('vm.tiktok.com/') || 
        urlLower.includes('tiktok.com/t/')) {
        return 'TikTok';
    }
    
    // Instagram patterns
    if (urlLower.includes('instagram.com/reel') ||
        urlLower.includes('instagram.com/p/') ||
        urlLower.includes('instagram.com/tv/')) {
        return 'Instagram';
    }
    
    // SoundCloud
    if (urlLower.includes('soundcloud.com')) {
        return 'SoundCloud';
    }
    
    return 'Unknown';
}

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
//  Playlist Management
// ────────────────────────────────────────────────────────────
async function loadPlaylist() {
    try {
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (!savedSettings) {
            console.log('No settings found');
            showEmptyPlaylist();
            return;
        }
        
        const settings = JSON.parse(savedSettings);
        const playerFolder = settings.playerFolder;
        
        console.log('Player folder from settings:', playerFolder);
        
        if (!playerFolder) {
            console.log('Player folder not configured');
            showEmptyPlaylist();
            return;
        }
        
        // Load both files and metadata
        const [filesResponse, metadataResponse] = await Promise.all([
            fetch('/api/player/files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder: playerFolder })
            }),
            fetch('/api/player/metadata')
        ]);
        
        const filesData = await filesResponse.json();
        const metadataData = await metadataResponse.json();
        
        console.log('Files response:', filesData);
        console.log('Metadata response:', metadataData);
        
        if (filesResponse.ok && filesData.files) {
            const files = filesData.files.filter(file => 
                file.name.toLowerCase().endsWith('.mp3') || file.name.toLowerCase().endsWith('.mp4')
            );
            
            console.log('Filtered audio files (MP3/MP4):', files);
            
            // Merge metadata with files
            const metadataMap = {};
            if (metadataResponse.ok && metadataData.metadata) {
                metadataData.metadata.forEach(meta => {
                    // Store by exact filename, lowercase, and base name (without extension)
                    metadataMap[meta.filename] = meta;
                    metadataMap[meta.filename.toLowerCase()] = meta;
                    
                    // Store by base name (without extension) for matching different extensions
                    const baseName = meta.filename.replace(/\.(mp3|mp4)$/i, '');
                    metadataMap[baseName] = meta;
                    metadataMap[baseName.toLowerCase()] = meta;
                    
                    console.log('Added to metadata map:', meta.filename, meta);
                });
            }
            
            console.log('Metadata map:', metadataMap);
            console.log('Files:', files);
            
            playlist = files.map(file => {
                // Try exact match, lowercase match, then base name match
                const baseName = file.name.replace(/\.(mp3|mp4)$/i, '');
                let meta = metadataMap[file.name] || 
                          metadataMap[file.name.toLowerCase()] || 
                          metadataMap[baseName] || 
                          metadataMap[baseName.toLowerCase()];
                
                // If still no match, try fuzzy matching (find closest match)
                if (!meta || !meta.title) {
                    const metadataKeys = Object.keys(metadataMap);
                    for (const key of metadataKeys) {
                        const keyBase = key.replace(/\.(mp3|mp4)$/i, '');
                        // Check if base names are similar (allowing for small differences)
                        if (calculateSimilarity(baseName.toLowerCase(), keyBase.toLowerCase()) > 0.8) {
                            meta = metadataMap[key];
                            console.log('Fuzzy matched:', file.name, 'to', key);
                            break;
                        }
                    }
                }
                
                console.log('Processing file:', file.name, 'Base name:', baseName, 'Meta found:', !!meta, meta);
                console.log('Meta uploader:', meta?.uploader, 'Meta duration:', meta?.duration, 'Meta title:', meta?.title);
                
                const track = {
                    ...file,
                    title: meta?.title || file.name.replace(/\.(mp3|mp4)$/i, ''),
                    uploader: meta?.uploader || meta?.platform || 'Unknown',
                    platform: meta?.platform || '',
                    duration: meta?.duration || '',
                    thumbnail: meta?.thumbnail || '',
                    thumbnail_filename: meta?.thumbnail_filename || '',
                    download_id: meta?.download_id || ''
                };
                console.log('Final track object:', track);
                return track;
            });
            
            // Update both playlist and originalPlaylist
            playlist = playlist;
            originalPlaylist = [...playlist];
            
            console.log('Final playlist:', playlist);
            console.log('Final originalPlaylist:', originalPlaylist);
            renderPlaylist();
        } else {
            console.log('Failed to load files:', filesData);
            showEmptyPlaylist();
        }
    } catch (error) {
        console.error('Error loading playlist:', error);
        showEmptyPlaylist();
    }
}

function renderPlaylist() {
    const playlistEl = document.getElementById('playlist');
    const playlistCountEl = document.getElementById('playlistCount');
    
    // Update playlist count
    if (playlistCountEl) {
        playlistCountEl.textContent = `${playlist.length} track${playlist.length !== 1 ? 's' : ''}`;
    }
    
    if (playlist.length === 0) {
        showEmptyPlaylist();
        return;
    }
    
    playlistEl.innerHTML = '';
    
    playlist.forEach((track, index) => {
        const item = document.createElement('div');
        item.className = 'playlist-item';
        item.dataset.index = index;
        
        // Use metadata title if available, otherwise use filename
        const displayTitle = track.title || track.name.replace(/\.(mp3|mp4)$/i, '');
        const displayArtist = track.uploader || track.platform || 'Unknown';
        const duration = track.duration ? formatTime(track.duration) : '';
        
        console.log(`Rendering track ${index}:`, {
            title: displayTitle,
            uploader: track.uploader,
            platform: track.platform,
            displayArtist: displayArtist,
            duration: track.duration,
            formattedDuration: duration,
            thumbnail_filename: track.thumbnail_filename
        });
        
        // Generate thumbnail HTML if available
        let thumbnailHtml = '';
        if (track.thumbnail_filename) {
            const savedSettings = localStorage.getItem('ytDownloaderSettings');
            if (savedSettings) {
                const settings = JSON.parse(savedSettings);
                const playerFolder = settings.playerFolder;
                if (playerFolder) {
                    thumbnailHtml = `
                        <div class="playlist-item-thumbnail">
                            <img src="/api/player/thumbnail?filename=${encodeURIComponent(track.thumbnail_filename)}&folder=${encodeURIComponent(playerFolder)}" alt="Thumbnail" onerror="this.parentElement.style.display='none'">
                        </div>
                    `;
                }
            }
        }
        
        item.innerHTML = `
            ${thumbnailHtml}
            <button class="playlist-item-like-btn ${favorites.some(f => f.name === track.name) ? 'liked' : ''}" data-index="${index}" title="Favorite">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
            </button>
            <span class="playlist-item-number">${index + 1}</span>
            <div class="playlist-item-info">
                <p class="playlist-item-title">${escapeHtml(displayTitle)}</p>
                <p class="playlist-item-artist">${escapeHtml(displayArtist)}</p>
            </div>
            <span class="playlist-item-duration">${duration}</span>
            <div class="playlist-item-actions">
                <button class="playlist-item-btn move-up-btn" data-index="${index}" title="Move Up">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="18 15 12 9 6 15"></polyline>
                    </svg>
                </button>
                <button class="playlist-item-btn move-down-btn" data-index="${index}" title="Move Down">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
                <button class="playlist-item-btn rename-btn" data-index="${index}" title="Rename">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                <button class="playlist-item-btn delete-btn" data-index="${index}" title="Delete">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        `;
        
        item.addEventListener('click', (e) => {
            if (!e.target.closest('.delete-btn') && !e.target.closest('.rename-btn') && 
                !e.target.closest('.move-up-btn') && !e.target.closest('.move-down-btn') &&
                !e.target.closest('.playlist-item-like-btn')) {
                playTrack(index);
            }
        });
        
        item.querySelector('.playlist-item-like-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(playlist[index]);
            updateLikeButton(index);
        });
        
        // Add right-click context menu for adding to playlists
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showPlaylistContextMenu(e, index);
        });
        
        item.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteTrack(index);
        });
        
        item.querySelector('.rename-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            renameTrack(index);
        });
        
        item.querySelector('.move-up-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            moveTrack(index, -1);
        });
        
        item.querySelector('.move-down-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            moveTrack(index, 1);
        });
        
        playlistEl.appendChild(item);
    });
}

function showEmptyPlaylist() {
    const playlistEl = document.getElementById('playlist');
    playlistEl.innerHTML = `
        <div class="empty-playlist">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M9 17V7l0-5.4L9 7l0 5.4"></path>
                <path d="M15 17V7l0-5.4L15 7l0 5.4"></path>
            </svg>
            <p>No audio files found</p>
            <small>Configure player folder in settings</small>
        </div>
    `;
}

async function deleteTrack(index) {
    if (index < 0 || index >= playlist.length) return;
    
    const track = playlist[index];
    
    if (typeof dangerModal === 'undefined') {
        console.error('dangerModal not available');
        return;
    }
    
    dangerModal(
        'Delete Track',
        `Are you sure you want to delete "${track.title || track.name}"?`,
        async () => {
            try {
                const savedSettings = localStorage.getItem('ytDownloaderSettings');
                if (!savedSettings) {
                    showError('Settings not found');
                    return;
                }
                
                const settings = JSON.parse(savedSettings);
                const playerFolder = settings.playerFolder;
                
                if (!playerFolder) {
                    showError('Player folder not configured');
                    return;
                }
                
                const response = await fetch('/api/player/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        filename: track.name,
                        folder: playerFolder
                    })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    // Remove from playlist
                    playlist.splice(index, 1);
                    
                    // If deleting current track, stop playback
                    if (currentTrackIndex === index) {
                        audioPlayer.pause();
                        audioPlayer.src = '';
                        currentTrackIndex = -1;
                        isPlaying = false;
                        updatePlayPauseButton();
                        updateNowPlaying({ title: 'No track playing', uploader: 'Select a track to play' });
                    } else if (currentTrackIndex > index) {
                        currentTrackIndex--;
                    }
                    
                    renderPlaylist();
                    showNotification('Track deleted successfully');
                } else {
                    showError(data.error || 'Failed to delete track');
                }
            } catch (error) {
                console.error('Error deleting track:', error);
                showError('Failed to delete track');
            }
        }
    );
}

async function renameTrack(index) {
    if (index < 0 || index >= playlist.length) return;
    
    const track = playlist[index];
    const currentName = track.title || track.name.replace(/\.(mp3|mp4)$/i, '');
    
    if (typeof inputModal === 'undefined') {
        console.error('inputModal not available');
        return;
    }
    
    inputModal(
        'Rename Track',
        'Enter new name',
        async (newName) => {
            if (!newName || newName.trim() === '') return;
            
            const sanitizedName = newName.trim();
            
            try {
                const savedSettings = localStorage.getItem('ytDownloaderSettings');
                if (!savedSettings) {
                    showError('Settings not found');
                    return;
                }
                
                const settings = JSON.parse(savedSettings);
                const playerFolder = settings.playerFolder;
                
                if (!playerFolder) {
                    showError('Player folder not configured');
                    return;
                }
                
                const oldPath = track.name;
                const extension = oldPath.substring(oldPath.lastIndexOf('.'));
                const newFilename = sanitizedName + extension;
                
                // Rename the file
                const response = await fetch('/api/player/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        oldFilename: track.name,
                        newFilename: newFilename,
                        folder: playerFolder
                    })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    // Update track in playlist
                    playlist[index].name = newFilename;
                    playlist[index].title = sanitizedName;
                    
                    // Update metadata if it exists
                    try {
                        const metadataResponse = await fetch('/api/player/metadata');
                        const metadataData = await metadataResponse.json();
                        if (metadataResponse.ok && metadataData.metadata) {
                            const metadata = metadataData.metadata;
                            const metaIndex = metadata.findIndex(m => m.filename === oldPath);
                            if (metaIndex !== -1) {
                                metadata[metaIndex].filename = newFilename;
                                metadata[metaIndex].title = sanitizedName;
                                await fetch('/api/player/update-metadata', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ metadata })
                                });
                            }
                        }
                    } catch (e) {
                        console.error('Error updating metadata:', e);
                    }
                    
                    renderPlaylist();
                    showNotification('Track renamed successfully');
                    
                    // Update now playing if this is the current track
                    if (currentTrackIndex === index) {
                        updateNowPlaying({ ...playlist[index], title: sanitizedName });
                    }
                } else {
                    showError(data.error || 'Failed to rename track');
                }
            } catch (error) {
                console.error('Error renaming track:', error);
                showError('Failed to rename track');
            }
        },
        currentName
    );
}

function moveTrack(index, direction) {
    if (index < 0 || index >= playlist.length) return;
    
    const newIndex = index + direction;
    
    if (newIndex < 0 || newIndex >= playlist.length) return;
    
    // Swap tracks
    const temp = playlist[index];
    playlist[index] = playlist[newIndex];
    playlist[newIndex] = temp;
    
    // Update current track index if needed
    if (currentTrackIndex === index) {
        currentTrackIndex = newIndex;
    } else if (currentTrackIndex === newIndex) {
        currentTrackIndex = index;
    }
    
    renderPlaylist();
    updatePlaylistActiveState();
}

// ────────────────────────────────────────────────────────────
//  Playback Controls
// ────────────────────────────────────────────────────────────
function playTrack(index) {
    if (index < 0 || index >= playlist.length) return;
    
    const track = playlist[index];
    currentTrackIndex = index;
    
    const savedSettings = localStorage.getItem('ytDownloaderSettings');
    const settings = JSON.parse(savedSettings);
    const playerFolder = settings.playerFolder;
    
    audioPlayer.src = `/api/player/play?file=${encodeURIComponent(track.name)}&folder=${encodeURIComponent(playerFolder)}`;
    
    // Update now playing before playing
    updateNowPlaying(track);
    
    // Add to recently played
    addToRecentlyPlayed(track);
    
    audioPlayer.play().then(() => {
        isPlaying = true;
        updatePlayPauseButton();
        updatePlaylistActiveState();
    }).catch(error => {
        console.error('Error playing track:', error);
        showError('Error playing audio file');
    });
}

function togglePlayPause() {
    if (currentTrackIndex === -1 && playlist.length > 0) {
        playTrack(0);
        return;
    }
    
    if (isPlaying) {
        audioPlayer.pause();
        isPlaying = false;
    } else {
        audioPlayer.play();
        isPlaying = true;
    }
    
    updatePlayPauseButton();
}

function playNext() {
    if (playlist.length === 0) return;
    
    let nextIndex;
    
    if (isShuffle) {
        nextIndex = Math.floor(Math.random() * playlist.length);
    } else {
        nextIndex = currentTrackIndex + 1;
        if (nextIndex >= playlist.length) {
            nextIndex = repeatMode === 1 ? 0 : -1; // Loop or stop
        }
    }
    
    if (nextIndex >= 0) {
        playTrack(nextIndex);
    } else {
        isPlaying = false;
        updatePlayPauseButton();
    }
}

function playPrevious() {
    if (playlist.length === 0) return;
    
    let prevIndex = currentTrackIndex - 1;
    
    if (prevIndex < 0) {
        prevIndex = repeatMode === 1 ? playlist.length - 1 : 0;
    }
    
    playTrack(prevIndex);
}

function toggleShuffle() {
    isShuffle = !isShuffle;
    document.getElementById('shuffleBtn').classList.toggle('active', isShuffle);
}

function toggleRepeat() {
    repeatMode = (repeatMode + 1) % 3;
    
    const repeatBtn = document.getElementById('repeatBtn');
    repeatBtn.classList.toggle('active', repeatMode > 0);
    
    // Update icon based on mode
    if (repeatMode === 2) {
        // Show repeat one icon
        repeatBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="17 1 21 5 17 9"></polyline>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                <polyline points="7 23 3 19 7 15"></polyline>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
                <text x="12" y="14" font-size="8" text-anchor="middle">1</text>
            </svg>
        `;
    } else {
        repeatBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="17 1 21 5 17 9"></polyline>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                <polyline points="7 23 3 19 7 15"></polyline>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
            </svg>
        `;
    }
}

function setVolume(value) {
    // Boost volume by 1.5x to match Spotify's louder output
    // Scale: 0-100 input becomes 0-1.5 output (capped at 1.0 for audio element)
    const boostedVolume = Math.min((value / 100) * 1.5, 1.0);
    audioPlayer.volume = boostedVolume;
    
    document.getElementById('volumeFill').style.width = `${value}%`;
    document.getElementById('volumePercentage').textContent = `${value}%`;
    
    // Save to localStorage
    const savedSettings = localStorage.getItem('ytDownloaderSettings');
    if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        settings.volume = value;
        localStorage.setItem('ytDownloaderSettings', JSON.stringify(settings));
    }
}

function toggleMute() {
    if (audioPlayer.volume > 0) {
        previousVolume = audioPlayer.volume;
        audioPlayer.volume = 0;
        document.getElementById('volumeSlider').value = 0;
        setVolume(0);
    } else {
        audioPlayer.volume = previousVolume;
        document.getElementById('volumeSlider').value = previousVolume * 100;
        setVolume(previousVolume * 100);
    }
}

// ────────────────────────────────────────────────────────────
//  UI Updates
// ────────────────────────────────────────────────────────────
function updatePlayPauseButton() {
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    
    if (isPlaying) {
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
    } else {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
    }
}

function updateNowPlaying(track) {
    console.log('updateNowPlaying called with track:', track);
    
    const titleEl = document.getElementById('currentTrackTitle');
    const artistEl = document.getElementById('currentTrackArtist');
    const albumArt = document.getElementById('albumArt');
    const albumArtImage = document.getElementById('albumArtImage');
    
    if (titleEl) titleEl.textContent = track.title || track.name || 'No track playing';
    if (artistEl) artistEl.textContent = track.uploader || track.platform || 'Select a track to play';
    
    console.log('Updated now playing - Title:', titleEl?.textContent, 'Artist:', artistEl?.textContent);
    
    // Update album art with thumbnail if available
    if (track.thumbnail_filename && albumArt && albumArtImage) {
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            const playerFolder = settings.playerFolder;
            if (playerFolder) {
                albumArtImage.src = `/api/player/thumbnail?filename=${encodeURIComponent(track.thumbnail_filename)}&folder=${encodeURIComponent(playerFolder)}`;
                albumArt.style.display = 'flex';
                albumArtImage.onerror = () => {
                    albumArt.style.display = 'none';
                };
            }
        }
    } else if (albumArt) {
        albumArt.style.display = 'none';
    }
}

function updatePlaylistActiveState() {
    const items = document.querySelectorAll('.playlist-item');
    items.forEach((item, index) => {
        item.classList.toggle('active', index === currentTrackIndex);
        
        // Update like button state
        const likeBtn = item.querySelector('.playlist-item-like-btn');
        if (likeBtn && playlist[index]) {
            const isLiked = favorites.some(f => f.name === playlist[index].name);
            likeBtn.classList.toggle('liked', isLiked);
        }
    });
}

function updateLikeButton(index) {
    const items = document.querySelectorAll('.playlist-item');
    if (items[index]) {
        const likeBtn = items[index].querySelector('.playlist-item-like-btn');
        if (likeBtn && playlist[index]) {
            const isLiked = favorites.some(f => f.name === playlist[index].name);
            likeBtn.classList.toggle('liked', isLiked);
        }
    }
}

function updateProgress() {
    if (audioPlayer.duration) {
        const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        document.getElementById('progressFill').style.width = `${progress}%`;
        document.getElementById('currentTime').textContent = formatTime(audioPlayer.currentTime);
        document.getElementById('totalTime').textContent = formatTime(audioPlayer.duration);
    }
}

function formatTime(value) {
    // If already formatted as string (e.g., "2:43"), return as is
    if (typeof value === 'string' && value.includes(':')) {
        return value;
    }
    
    // If it's a number (seconds), format it
    const seconds = parseFloat(value);
    if (isNaN(seconds)) return '0:00';
    
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

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
    }, 3000);
}

// ────────────────────────────────────────────────────────────
//  Event Listeners
// ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    loadPlaylist();
    
    // Playback controls
    document.getElementById('playPauseBtn').addEventListener('click', togglePlayPause);
    document.getElementById('prevBtn').addEventListener('click', playPrevious);
    document.getElementById('nextBtn').addEventListener('click', playNext);
    document.getElementById('shuffleBtn').addEventListener('click', toggleShuffle);
    document.getElementById('repeatBtn').addEventListener('click', toggleRepeat);
    document.getElementById('muteBtn').addEventListener('click', toggleMute);
    
    // Volume control
    const volumeSlider = document.getElementById('volumeSlider');
    volumeSlider.addEventListener('input', (e) => setVolume(e.target.value));
    
    // Progress bar click
    document.getElementById('progressBar').addEventListener('click', (e) => {
        if (audioPlayer.duration) {
            const rect = e.target.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            audioPlayer.currentTime = percent * audioPlayer.duration;
        }
    });
    
    // Refresh playlist
    document.getElementById('refreshPlaylistBtn').addEventListener('click', () => {
        loadPlaylist();
        showNotification('Playlist refreshed');
    });
    
    // Download panel toggle
    document.getElementById('toggleDownloadPanelBtn').addEventListener('click', () => {
        document.getElementById('downloadPanel').classList.toggle('hidden');
    });
    
    // Close download panel
    document.getElementById('closeDownloadPanelBtn').addEventListener('click', () => {
        document.getElementById('downloadPanel').classList.add('hidden');
    });
    
    // Close download panel when clicking outside
    document.addEventListener('click', (e) => {
        const downloadPanel = document.getElementById('downloadPanel');
        const toggleBtn = document.getElementById('toggleDownloadPanelBtn');
        
        // Check if panel is visible and click is outside panel and toggle button
        if (!downloadPanel.classList.contains('hidden') && 
            !downloadPanel.contains(e.target) && 
            !toggleBtn.contains(e.target)) {
            downloadPanel.classList.add('hidden');
        }
    });
    
    // Download tab switching
    document.querySelectorAll('.download-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs
            document.querySelectorAll('.download-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.download-tab-content').forEach(c => c.classList.remove('active'));
            
            // Add active class to clicked tab
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            document.getElementById(`${tabName}Tab`).classList.add('active');
            
            // Save last used tab to localStorage
            localStorage.setItem('lastDownloadTab', tabName);
        });
    });
    
    // Load saved tab on page load
    const savedTab = localStorage.getItem('lastDownloadTab');
    if (savedTab) {
        const tabToActivate = document.querySelector(`.download-tab[data-tab="${savedTab}"]`);
        if (tabToActivate) {
            // Remove active class from all tabs
            document.querySelectorAll('.download-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.download-tab-content').forEach(c => c.classList.remove('active'));
            
            // Activate saved tab
            tabToActivate.classList.add('active');
            document.getElementById(`${savedTab}Tab`).classList.add('active');
        }
    }
    
    // Start download
    document.getElementById('startDownloadBtn').addEventListener('click', async () => {
        const url = document.getElementById('downloadUrl').value.trim();
        const format = document.getElementById('downloadFormat').value;
        
        if (!url) {
            showError('Please enter a URL');
            return;
        }
        
        // Check if settings have player folder
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (!savedSettings) {
            showError('Settings not found');
            return;
        }
        
        const settings = JSON.parse(savedSettings);
        const playerFolder = settings.playerFolder;
        
        if (!playerFolder) {
            showError('Player folder not configured. Please set it in settings.');
            return;
        }
        
        // Disable button and show loading
        const btn = document.getElementById('startDownloadBtn');
        btn.disabled = true;
        btn.textContent = 'Loading...';
        
        try {
            // First get video info
            const infoResponse = await fetch('/api/video-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            
            const infoData = await infoResponse.json();
            if (!infoResponse.ok) throw new Error(infoData.error || 'Failed to get video info');
            
            const title = infoData.title || 'Unknown Title';
            const uploader = infoData.uploader || 'Unknown';
            const thumbnail = infoData.thumbnail || '';
            const platform = detectPlatform(url);
            
            // Start download to player
            const downloadResponse = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    url, 
                    format_id: format === 'audio' ? 'bestaudio' : 'best',
                    title, 
                    download_folder: playerFolder,
                    preset: format === 'audio' ? 'audio' : 'video',
                    platform: platform,
                    uploader: uploader,
                    thumbnail: thumbnail,
                    save_metadata: true,
                    is_mobile: isMobileDevice()
                })
            });
            
            const downloadData = await downloadResponse.json();
            if (!downloadResponse.ok) throw new Error(downloadData.error || 'Failed to start download');
            
            // Save download info to localStorage for global progress widget
            if (downloadData.download_id) {
                const downloadInfo = {
                    id: downloadData.download_id,
                    status: 'downloading',
                    title: title,
                    progress: 0,
                    speed: '',
                    size: '',
                    eta: ''
                };
                localStorage.setItem('currentDownload', JSON.stringify(downloadInfo));
                
                // Set the global currentDownloadId for global-progress.js using helper function
                if (typeof window.setCurrentDownloadId === 'function') {
                    window.setCurrentDownloadId(downloadData.download_id);
                }
                
                // Manually trigger the global progress widget if it exists
                if (typeof showGlobalProgress === 'function') {
                    showGlobalProgress(downloadInfo);
                }
                
                // Start polling if the function exists
                if (typeof startGlobalProgressPolling === 'function') {
                    startGlobalProgressPolling();
                }
            }
            
            showNotification('Download started! Check the download status.');
            
            // Clear input and close panel
            document.getElementById('downloadUrl').value = '';
            document.getElementById('downloadPanel').classList.add('hidden');
            
            // Don't auto-refresh here - let the download completion event handle it
            
        } catch (error) {
            showError(error.message || 'Failed to start download');
        } finally {
            btn.disabled = false;
            btn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Start Download
            `;
        }
    });
    
    // Download Spotify
    document.getElementById('downloadSpotifyBtn').addEventListener('click', async () => {
        const url = document.getElementById('spotifyUrl').value.trim();
        
        if (!url) {
            showError('Please enter a Spotify URL');
            return;
        }
        
        // Validate Spotify URL
        if (!url.includes('spotify.com') && !url.startsWith('spotify:')) {
            showError('Please enter a valid Spotify URL (e.g., https://open.spotify.com/track/...)');
            return;
        }
        
        // Check if it's an authorization URL (user mistake)
        if (url.includes('accounts.spotify.com/authorize')) {
            showError('This is an authorization URL. Please paste a Spotify track, playlist, or album URL instead.');
            return;
        }
        
        const savedSettings = localStorage.getItem('ytDownloaderSettings');
        if (!savedSettings) {
            showError('Settings not found');
            return;
        }
        
        const settings = JSON.parse(savedSettings);
        const playerFolder = settings.playerFolder;
        
        if (!playerFolder) {
            showError('Player folder not configured. Please set it in settings.');
            return;
        }
        
        try {
            const response = await fetch('/api/spotify/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    url: url,
                    output_dir: playerFolder
                })
            });
            
            const data = await response.json();
            
            if (data.status === 'success') {
                showNotification(data.message);
                document.getElementById('spotifyUrl').value = '';
                document.getElementById('downloadPanel').classList.add('hidden');
                
                // Integrate with global progress widget
                if (data.download_id) {
                    const downloadInfo = {
                        id: data.download_id,
                        status: 'downloading',
                        title: 'Spotify Download',
                        progress: 0,
                        speed: '',
                        size: '',
                        eta: 'Unknown'
                    };
                    localStorage.setItem('currentDownload', JSON.stringify(downloadInfo));
                    
                    if (typeof window.setCurrentDownloadId === 'function') {
                        window.setCurrentDownloadId(data.download_id);
                    }
                    
                    if (typeof showGlobalProgress === 'function') {
                        showGlobalProgress(downloadInfo);
                    }
                    
                    if (typeof startGlobalProgressPolling === 'function') {
                        startGlobalProgressPolling();
                    }
                }
            } else {
                showError(data.message);
            }
        } catch (error) {
            showError('Failed to download Spotify: ' + error.message);
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Don't trigger shortcuts if user is typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        switch(e.code) {
            case 'Space':
                e.preventDefault();
                togglePlayPause();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (audioPlayer.duration) {
                    audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 5);
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (audioPlayer.duration) {
                    audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 5);
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                const currentVol = Math.round(audioPlayer.volume * 100);
                setVolume(Math.min(100, currentVol + 5));
                break;
            case 'ArrowDown':
                e.preventDefault();
                const currentVolDown = Math.round(audioPlayer.volume * 100);
                setVolume(Math.max(0, currentVolDown - 5));
                break;
            case 'KeyM':
                e.preventDefault();
                toggleMute();
                break;
            /*
            case 'KeyN':
                e.preventDefault();
                playNext();
                break;
            case 'KeyP':
                e.preventDefault();
                playPrevious();
                break;
            case 'KeyS':
                e.preventDefault();
                toggleShuffle();
                break;
            case 'KeyR':
                e.preventDefault();
                toggleRepeat();
                break;
            */
        }
    });
    
    // Audio events
    audioPlayer.addEventListener('timeupdate', updateProgress);
    audioPlayer.addEventListener('ended', () => {
        if (repeatMode === 2) {
            audioPlayer.currentTime = 0;
            audioPlayer.play();
        } else {
            playNext();
        }
    });
    audioPlayer.addEventListener('error', () => {
        showError('Error playing audio file');
        isPlaying = false;
        updatePlayPauseButton();
    });
    
    // Load recently played and favorites from localStorage
    loadRecentlyPlayed();
    loadFavorites();
    loadCustomPlaylists();
    
    // Initialize playlist selector
    updatePlaylistSelector();
    
    // Listen for download completion events to refresh playlist
    document.addEventListener('downloadCompleted', (e) => {
        console.log('Download completed, refreshing playlist');
        setTimeout(() => loadPlaylist(), 1000);
    });
    
    // Create playlist button
    document.getElementById('createPlaylistBtn').addEventListener('click', () => {
        inputModal(
            'Create Playlist',
            'Enter playlist name',
            (name) => {
                if (name && name.trim()) {
                    createCustomPlaylist(name.trim());
                }
            }
        );
    });
    
    // Playlist selector change
    document.getElementById('playlistSelector').addEventListener('change', (e) => {
        const selectedPlaylist = e.target.value;
        console.log('Playlist selector changed to:', selectedPlaylist);
        
        if (selectedPlaylist === 'all') {
            playlist = [...originalPlaylist];
            console.log('Loaded all tracks, count:', playlist.length);
        } else if (selectedPlaylist === 'favorites') {
            playlist = favorites.filter(f => originalPlaylist.some(o => o.name === f.name));
            console.log('Loaded favorites, count:', playlist.length);
        } else {
            const customPlaylist = customPlaylists.find(p => p.id === selectedPlaylist);
            if (customPlaylist) {
                playlist = originalPlaylist.filter(track => customPlaylist.tracks.includes(track.name));
                console.log('Loaded custom playlist:', customPlaylist.name, 'count:', playlist.length);
            }
        }
        currentTrackIndex = -1;
        renderPlaylist();
    });
});

// ────────────────────────────────────────────────────────────
//  Recently Played & Favorites
// ────────────────────────────────────────────────────────────
function loadRecentlyPlayed() {
    try {
        const saved = localStorage.getItem('playerRecentlyPlayed');
        if (saved) {
            recentlyPlayed = JSON.parse(saved);
        }
    } catch (error) {
        console.error('Error loading recently played:', error);
    }
}

function saveRecentlyPlayed() {
    try {
        localStorage.setItem('playerRecentlyPlayed', JSON.stringify(recentlyPlayed));
    } catch (error) {
        console.error('Error saving recently played:', error);
    }
}

function addToRecentlyPlayed(track) {
    // Remove if already exists
    recentlyPlayed = recentlyPlayed.filter(t => t.name !== track.name);
    // Add to beginning
    recentlyPlayed.unshift(track);
    // Keep only last 20
    recentlyPlayed = recentlyPlayed.slice(0, 20);
    saveRecentlyPlayed();
}

function loadFavorites() {
    try {
        const saved = localStorage.getItem('playerFavorites');
        if (saved) {
            favorites = JSON.parse(saved);
        }
    } catch (error) {
        console.error('Error loading favorites:', error);
    }
}

function saveFavorites() {
    try {
        localStorage.setItem('playerFavorites', JSON.stringify(favorites));
    } catch (error) {
        console.error('Error saving favorites:', error);
    }
}

function toggleFavorite(track) {
    const index = favorites.findIndex(t => t.name === track.name);
    if (index > -1) {
        favorites.splice(index, 1);
        showNotification('Removed from favorites');
    } else {
        favorites.push(track);
        showNotification('Added to favorites');
    }
    saveFavorites();
}

// ────────────────────────────────────────────────────────────
//  Playback Speed
// ────────────────────────────────────────────────────────────
function setPlaybackSpeed(speed) {
    playbackSpeed = speed;
    audioPlayer.playbackRate = speed;
    showNotification(`Playback speed: ${speed}x`);
}

function cyclePlaybackSpeed() {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const currentIndex = speeds.indexOf(playbackSpeed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    setPlaybackSpeed(speeds[nextIndex]);
}

// ────────────────────────────────────────────────────────────
//  Custom Playlists
// ────────────────────────────────────────────────────────────
function loadCustomPlaylists() {
    try {
        const saved = localStorage.getItem('playerCustomPlaylists');
        if (saved) {
            customPlaylists = JSON.parse(saved);
        }
    } catch (error) {
        console.error('Error loading custom playlists:', error);
    }
}

function saveCustomPlaylists() {
    try {
        localStorage.setItem('playerCustomPlaylists', JSON.stringify(customPlaylists));
    } catch (error) {
        console.error('Error saving custom playlists:', error);
    }
}

function createCustomPlaylist(name) {
    const newPlaylist = {
        id: 'playlist-' + Date.now(),
        name: name,
        tracks: []
    };
    customPlaylists.push(newPlaylist);
    saveCustomPlaylists();
    updatePlaylistSelector();
    showNotification(`Playlist "${name}" created`);
}

function updatePlaylistSelector() {
    const selector = document.getElementById('playlistSelector');
    if (!selector) return;
    
    selector.innerHTML = '<option value="all">All Tracks</option>';
    selector.innerHTML += '<option value="favorites">Favorites</option>';
    
    customPlaylists.forEach(playlist => {
        const option = document.createElement('option');
        option.value = playlist.id;
        option.textContent = playlist.name;
        selector.appendChild(option);
    });
}

function addTrackToPlaylist(trackName, playlistId) {
    const playlist = customPlaylists.find(p => p.id === playlistId);
    if (playlist && !playlist.tracks.includes(trackName)) {
        playlist.tracks.push(trackName);
        saveCustomPlaylists();
        showNotification('Added to playlist');
    }
}

function showPlaylistContextMenu(e, index) {
    const track = playlist[index];
    if (!track) return;
    
    // Create context menu
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.position = 'fixed';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.style.zIndex = '10000';
    
    let menuHtml = '<div class="context-menu-header">Add to Playlist</div>';
    
    if (customPlaylists.length === 0) {
        menuHtml += '<div class="context-menu-item disabled">No playlists</div>';
    } else {
        customPlaylists.forEach(playlist => {
            menuHtml += `<div class="context-menu-item" data-playlist-id="${playlist.id}">${playlist.name}</div>`;
        });
    }
    
    menuHtml += '<div class="context-menu-divider"></div>';
    menuHtml += '<div class="context-menu-item" id="createNewPlaylist">+ Create New Playlist</div>';
    
    menu.innerHTML = menuHtml;
    document.body.appendChild(menu);
    
    // Handle clicks
    menu.querySelectorAll('.context-menu-item[data-playlist-id]').forEach(item => {
        item.addEventListener('click', () => {
            const playlistId = item.dataset.playlistId;
            addTrackToPlaylist(track.name, playlistId);
            menu.remove();
        });
    });
    
    menu.querySelector('#createNewPlaylist').addEventListener('click', () => {
        menu.remove();
        inputModal(
            'Create Playlist',
            'Enter playlist name',
            (name) => {
                if (name && name.trim()) {
                    createCustomPlaylist(name.trim());
                    // Add track to newly created playlist
                    const newPlaylist = customPlaylists[customPlaylists.length - 1];
                    addTrackToPlaylist(track.name, newPlaylist.id);
                }
            }
        );
    });
    
    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 0);
}
