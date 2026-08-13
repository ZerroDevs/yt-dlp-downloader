from flask import Flask, render_template, request, jsonify, send_file, after_this_request
import yt_dlp
import os
import uuid
import threading
import json
import re
from datetime import datetime
from dotenv import load_dotenv
import boto3
from botocore.client import Config
import requests
from spotify_service import get_spotify_service, reload_credentials

# Load environment variables
load_dotenv()

try:
    # pyrefly: ignore [missing-import]
    import imageio_ffmpeg
    FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    # Try to find FFmpeg in system PATH
    import shutil
    FFMPEG_PATH = shutil.which('ffmpeg')

app = Flask(__name__)

# Configuration
DOWNLOAD_FOLDER = 'downloads'
HISTORY_FILE = 'download_history.json'
PLAYER_METADATA_FILE = 'player_metadata.json'
if not os.path.exists(DOWNLOAD_FOLDER):
    os.makedirs(DOWNLOAD_FOLDER)

# Store download status
download_status = {}
download_queue = []

# Store cloud upload status
cloud_upload_status = {}

# Cloud configuration from environment
B2_BUCKET_NAME = os.getenv('B2_BUCKET_NAME')
B2_ENDPOINT_URL = os.getenv('B2_ENDPOINT_URL')
B2_KEY_ID = os.getenv('B2_KEY_ID')
B2_APPLICATION_KEY = os.getenv('B2_APPLICATION_KEY')
DISCORD_WEBHOOK_URL = os.getenv('DISCORD_WEBHOOK_URL')

# Lock for thread-safe history operations
import threading
history_lock = threading.Lock()
player_metadata_lock = threading.Lock()

# Load history from file
def load_history():
    with history_lock:
        if os.path.exists(HISTORY_FILE):
            try:
                with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                return []
        return []

# Save history to file
def save_history(history):
    with history_lock:
        try:
            # Use a temporary file to avoid corruption
            temp_file = HISTORY_FILE + '.tmp'
            with open(temp_file, 'w', encoding='utf-8') as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
            # Atomic rename
            import shutil
            shutil.move(temp_file, HISTORY_FILE)
            print(f"History saved to {HISTORY_FILE} with {len(history)} entries")
        except Exception as e:
            print(f"Error saving history: {e}")
            import traceback
            traceback.print_exc()

# Load player metadata from file
def load_player_metadata():
    with player_metadata_lock:
        if os.path.exists(PLAYER_METADATA_FILE):
            try:
                with open(PLAYER_METADATA_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                return []
        return []

# Save player metadata to file
def save_player_metadata(metadata):
    with player_metadata_lock:
        try:
            temp_file = PLAYER_METADATA_FILE + '.tmp'
            with open(temp_file, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, ensure_ascii=False, indent=2)
            import shutil
            shutil.move(temp_file, PLAYER_METADATA_FILE)
            print(f"Player metadata saved to {PLAYER_METADATA_FILE} with {len(metadata)} entries")
        except Exception as e:
            print(f"Error saving player metadata: {e}")
            import traceback
            traceback.print_exc()

# Initialize history
download_history = load_history()

class DownloadCancelled(Exception):
    """Custom exception raised when user cancels a download"""
    pass

class QuietLogger:
    """Custom quiet logger for yt-dlp to avoid console stdout/stderr write errors on Windows"""
    def debug(self, msg):
        pass
    def warning(self, msg):
        pass
    def error(self, msg):
        pass

def cleanup_download_files(filename, download_id=None, download_path=None):
    """Clean up download files including .part files"""
    try:
        # Use provided download_path or fall back to default
        if download_path and os.path.exists(download_path):
            downloads_abs = os.path.abspath(download_path)
        else:
            downloads_abs = os.path.abspath(DOWNLOAD_FOLDER)
        
        safe_base = sanitize_filename(filename)
        short_id = download_id[:8] if download_id else ''
        
        print(f"Cleanup: Looking for files in {downloads_abs} with short_id={short_id}, safe_base={safe_base}")
        
        # Delete all files matching the pattern (including .part files)
        for f in os.listdir(downloads_abs):
            file_path = os.path.join(downloads_abs, f)
            should_delete = False
            
            # Check if file matches our criteria
            if safe_base and f.startswith(safe_base):
                should_delete = True
                print(f"Match by safe_base: {f}")
            elif short_id and short_id in f:
                should_delete = True
                print(f"Match by short_id: {f}")
            
            if should_delete:
                try:
                    os.remove(file_path)
                    print(f"Deleted file: {file_path}")
                except Exception as e:
                    print(f"Error deleting file {file_path}: {e}")
        
        # Fallback: Delete any .part files in the directory if we have a download_id
        # These are temporary files and safe to remove when cancelling
        if download_id:
            print(f"Cleanup fallback: Looking for any .part files in {downloads_abs}")
            for f in os.listdir(downloads_abs):
                if f.endswith('.part') or f.endswith('.temp') or f.endswith('.ytdl'):
                    file_path = os.path.join(downloads_abs, f)
                    try:
                        os.remove(file_path)
                        print(f"Deleted .part file (fallback): {file_path}")
                    except Exception as e:
                        print(f"Error deleting .part file {file_path}: {e}")
    except Exception as e:
        print(f"Error cleaning up files for {filename}: {e}")

def sanitize_filename(filename):
    """Sanitize filename to be safe for filesystem"""
    # Remove invalid characters
    filename = re.sub(r'[<>:"/\\|?*]', '', filename)
    # Remove non-ASCII characters
    filename = re.sub(r'[^\x00-\x7F]+', '', filename)
    # Remove leading/trailing spaces and dots
    filename = filename.strip('. ')
    # Replace multiple spaces with single space (keep spaces for readability)
    filename = re.sub(r'\s+', ' ', filename)
    # Limit length to avoid path length issues (keep it under 100 chars for titles)
    if len(filename) > 100:
        filename = filename[:100]
    return filename or 'video'

def detect_platform(url):
    """Detect the platform from URL"""
    url_lower = url.lower()
    
    # YouTube patterns
    if 'youtube.com/watch' in url_lower or 'youtu.be/' in url_lower or 'youtube.com/shorts/' in url_lower:
        return 'YouTube'
    
    # TikTok patterns
    if 'tiktok.com/@' in url_lower or 'vm.tiktok.com/' in url_lower or 'tiktok.com/t/' in url_lower:
        return 'TikTok'
    
    # Instagram patterns
    if 'instagram.com/reel' in url_lower or 'instagram.com/p/' in url_lower or 'instagram.com/tv/' in url_lower:
        return 'Instagram'
    
    # Unsupported
    return 'Unsupported'

def process_filename_template(template, title, quality, download_id, uploader=None):
    """Process filename template and replace placeholders with actual values"""
    from datetime import datetime
    
    # Clean up the quality string (remove parentheses and extra info)
    quality_clean = re.sub(r'[()]', '', quality).strip()
    
    # Get current date in YYYY-MM-DD format
    current_date = datetime.now().strftime('%Y-%m-%d')
    
    # Get short ID from download_id
    short_id = download_id[:8] if download_id else ''
    
    # Sanitize title for filename
    title_clean = sanitize_filename(title)
    
    # Sanitize uploader if provided
    uploader_clean = sanitize_filename(uploader) if uploader else ''
    
    # Replace placeholders
    result = template
    result = result.replace('{title}', title_clean)
    result = result.replace('{quality}', quality_clean)
    result = result.replace('{date}', current_date)
    result = result.replace('{id}', short_id)
    if uploader_clean:
        result = result.replace('{uploader}', uploader_clean)
    
    # Remove .mp4 extension if present (we'll add it later)
    if result.endswith('.mp4'):
        result = result[:-4]
    
    # Final sanitization to ensure valid filename
    result = sanitize_filename(result)
    
    return result

def get_video_info(url):
    """Fetch video information including available formats"""
    # Detect if URL is TikTok or YouTube
    is_tiktok = 'tiktok.com' in url.lower()
    is_youtube = 'youtube.com' in url.lower() or 'youtu.be' in url.lower()
    
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'nocheckcertificate': True,  # Bypass SSL certificate issues
        'noprogress': True,
        'logger': QuietLogger(),
        'format': 'best',  # Get best quality info
        'extract_flat': False,  # Get full format info
    }
    
    # Add cookie file support if cookies.txt exists
    import os
    cookies_path = os.path.join(os.path.dirname(__file__), 'cookies.txt')
    if os.path.exists(cookies_path):
        ydl_opts['cookiefile'] = cookies_path
    
    # Add Node.js runtime for JavaScript challenges (dict format)
    ydl_opts['js_runtimes'] = {'node': {}}
    
    # Add TikTok-specific options to try to bypass restrictions
    if is_tiktok:
        ydl_opts.update({
            'extractor_args': {
                'tiktok': {
                    'api_hostname': 'api22-normal-c-useast1a.tiktokv.com',
                }
            },
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Cache-Control': 'max-age=0',
            },
            'nocheckcertificate': True,
            'ignoreerrors': True,
        })
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                info = ydl.extract_info(url, download=False)
            except yt_dlp.utils.DownloadError as e:
                # Handle yt-dlp download errors (unavailable videos, etc.)
                error_msg = str(e)
                if 'not available' in error_msg.lower():
                    return {'error': 'This video is not available. It may be private, region-restricted, deleted, or the URL is invalid.'}
                elif 'private' in error_msg.lower():
                    return {'error': 'This video is private. You need to be logged in to view it.'}
                elif 'region' in error_msg.lower():
                    return {'error': 'This video is region-restricted and not available in your location.'}
                elif 'premium' in error_msg.lower():
                    return {'error': 'This video is only available to YouTube Premium members.'}
                elif 'subscriber' in error_msg.lower():
                    return {'error': 'This video is only available to channel subscribers.'}
                else:
                    return {'error': f'Video unavailable: {error_msg}'}
            except Exception as e:
                return {'error': f'Failed to extract video info: {str(e)}'}
            
            # Check if info extraction failed
            if info is None:
                return {'error': 'Failed to extract video information. The video might be private, region-restricted, or the URL is invalid.'}
            
            # Check if video is unavailable
            if info.get('availability') == 'private':
                return {'error': 'This video is private. You need to be logged in to view it.'}
            if info.get('availability') == 'subscriber_only':
                return {'error': 'This video is only available to channel subscribers.'}
            if info.get('availability') == 'premium_only':
                return {'error': 'This video is only available to YouTube Premium members.'}
            if info.get('availability') == 'needs_auth':
                return {'error': 'This video requires authentication to view.'}
            if info.get('live_status') == 'is_upcoming':
                return {'error': 'This video is a scheduled premiere and has not started yet.'}
            if info.get('live_status') == 'was_live':
                return {'error': 'This live stream has ended.'}
            if info.get('live_status') == 'is_live':
                return {'error': 'This is a live stream. Live streams cannot be downloaded.'}
            
            # ── Collect all candidate formats ──────────────────────────
            # Map actual heights to standard YouTube resolution labels
            
            STANDARD_RESOLUTIONS = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320]
            
            def get_standard_label(height):
                """Map actual height to nearest standard YouTube resolution"""
                # If height is already a standard resolution, use it as-is
                if height in STANDARD_RESOLUTIONS:
                    return height
                
                # Find nearest standard resolution
                return min(STANDARD_RESOLUTIONS, key=lambda x: abs(x - height))
            
            formats = []
            seen_resolutions = set()
            
            # Debug: Print all available formats
            print(f"Total formats from yt-dlp: {len(info.get('formats', []))}")
            
            for fmt in info.get('formats', []):
                h = fmt.get('height')
                vcodec = fmt.get('vcodec', 'none') or 'none'
                acodec = fmt.get('acodec', 'none') or 'none'
                ext = fmt.get('ext', 'mp4')
                
                # Debug: Print format details
                if h and h >= 720:
                    print(f"Format: height={h}, vcodec={vcodec}, acodec={acodec}, ext={ext}, format_id={fmt.get('format_id')}")
                
                if not h or h < 50:
                    continue
                
                # Skip formats without video codec
                if vcodec == 'none':
                    continue
                
                # Allow both mp4 and webm formats for higher resolutions
                # YouTube often uses VP9/AV1 in webm for 1440p/2160p
                
                # Use actual height as resolution
                resolution = f"{h}p"
                
                # Skip if we already have this resolution
                if resolution in seen_resolutions:
                    continue
                    
                seen_resolutions.add(resolution)
                formats.append(fmt)
            
            print(f"Filtered formats: {len(formats)}")
            print(f"Resolutions found: {sorted(seen_resolutions, key=lambda x: int(x.replace('p','')), reverse=True)}")
            
            # Process formats for output
            processed_formats = []
            for fmt in formats:
                h = fmt.get('height')
                vcodec = fmt.get('vcodec', 'none') or 'none'
                ext = fmt.get('ext', 'mp4')
                
                # Determine quality label
                quality_label = 'Standard'
                if h >= 2160:
                    quality_label = 'Ultra HD'
                elif h >= 1440:
                    quality_label = '2K'
                elif h >= 1080:
                    quality_label = 'Full HD'
                elif h >= 720:
                    quality_label = 'HD'
                elif h >= 480:
                    quality_label = 'SD'
                elif h >= 360:
                    quality_label = 'Standard'
                else:
                    quality_label = 'Basic'
                
                processed_formats.append({
                    'id': fmt['format_id'],
                    'resolution': f"{h}p",
                    'ext': ext,
                    'filesize': fmt.get('filesize') or fmt.get('filesize_approx') or 0,
                    'filesize_human': format_size(fmt.get('filesize') or fmt.get('filesize_approx') or 0),
                    'fps': fmt.get('fps', 30),
                    'vcodec': vcodec,
                    'acodec': fmt.get('acodec', 'none'),
                    'quality_label': quality_label
                })
            
            # Sort by actual resolution (highest first)
            processed_formats.sort(key=lambda x: int(x['resolution'].replace('p', '')), reverse=True)
            formats = processed_formats

            # Add note if this appears to be a vertical video
            note = None
            vid_width = info.get('width', 0)
            vid_height = info.get('height', 0)
            if vid_height > vid_width and vid_width > 0:
                note = "📱 Vertical video detected - resolutions mapped to standard YouTube quality labels"

            if not formats:
                return {
                    'error': 'No downloadable video formats found. The video may be private or unavailable.'
                }

            platform = detect_platform(url)

            return {
                'title': info.get('title', 'Unknown'),
                'thumbnail': info.get('thumbnail', ''),
                'duration': info.get('duration', 0),
                'duration_human': format_duration(info.get('duration', 0)),
                'uploader': info.get('uploader', 'Unknown'),
                'view_count': info.get('view_count', 0),
                'formats': formats[:15],  # Show up to 15 formats
                'note': note,
                'platform': platform
            }
    except Exception as e:
        import traceback
        traceback.print_exc()
        error_msg = str(e)
        # Provide more helpful error messages
        if 'RequestsResponseAdapter' in error_msg or '_http_error' in error_msg:
            error_msg = "Compatibility error detected. Please update dependencies: pip install --upgrade yt-dlp requests urllib3"
        elif 'HTTP Error' in error_msg:
            error_msg = f"HTTP error occurred. The video might be private or region-restricted."
        elif 'Video unavailable' in error_msg:
            error_msg = "This video is unavailable or has been removed."
        elif 'private' in error_msg.lower():
            error_msg = "This video is private and cannot be downloaded."
        return {'error': error_msg}

def format_size(size):
    """Format file size in human-readable format"""
    if not size:
        return "Unknown size"
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024.0:
            return f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} TB"

def format_duration(seconds):
    """Format duration in human-readable format"""
    if not seconds:
        return "0:00"
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"

def download_video(url, format_id, download_id, title, resolution, actual_resolution=None, custom_filename=None, custom_folder=None, thumbnail=None, is_audio=False, platform='YouTube', uploader='', save_metadata=False):
    """Download video in background thread with pause/resume support"""
    # Determine filename once at the start
    if custom_filename and custom_filename.strip():
        # Sanitize the custom filename
        safe_custom = sanitize_filename(custom_filename)
        # Remove extension if provided
        if safe_custom.endswith('.mp4') or safe_custom.endswith('.mp3') or safe_custom.endswith('.m4a'):
            safe_custom = safe_custom[:-4]
        filename = safe_custom
    elif save_metadata and is_audio:
        # For player downloads, use the sanitized title as filename (title only)
        filename = sanitize_filename(title)
    else:
        # Use only first 8 chars of UUID to keep it short
        short_id = download_id[:8]
        filename = f"video_{short_id}"
    
    try:
        # Determine file extension based on whether it's audio or video
        file_ext = '.mp3' if is_audio else '.mp4'
        
        download_status[download_id] = {
            'status': 'downloading',
            'progress': 0,
            'speed': '0 KB/s',
            'eta': 'Unknown',
            'title': title,
            'resolution': resolution,
            'actual_resolution': actual_resolution or '',
            'thumbnail': thumbnail or '',
            'cancelled': False,
            'paused': False,
            'timestamp': datetime.now().isoformat(),
            'filename': f"{filename}{file_ext}",
            'download_path': None,  # Will be set after determining the actual path
            'duration': '',  # Will be populated from video info
            'uploader': uploader or ''
        }
        
        # Use custom folder if provided and exists/can be created
        current_dir = os.getcwd()
        downloads_path = os.path.join(current_dir, DOWNLOAD_FOLDER)
        
        if custom_folder and custom_folder.strip():
            try:
                os.makedirs(custom_folder, exist_ok=True)
                downloads_path = os.path.abspath(custom_folder)
            except Exception as e:
                print(f"Warning: Could not create custom folder {custom_folder}: {e}")
                
        # Ensure base directory exists
        if not os.path.exists(downloads_path):
            os.makedirs(downloads_path)
        
        # Store the actual download path for cleanup
        download_status[download_id]['download_path'] = downloads_path
        
        # Fetch video info to get duration
        video_duration = ''
        is_tiktok = 'tiktok.com' in url.lower()
        is_youtube = 'youtube.com' in url.lower() or 'youtu.be' in url.lower()
        
        try:
            info_opts = {
                'quiet': True,
                'no_warnings': True,
                'nocheckcertificate': True,
            }
            
            # Add cookie file support if cookies.txt exists
            cookies_path = os.path.join(os.path.dirname(__file__), 'cookies.txt')
            if os.path.exists(cookies_path):
                info_opts['cookiefile'] = cookies_path
            
            # Add Node.js runtime for JavaScript challenges
            info_opts['js_runtimes'] = {'node': {}}
            
            # Add TikTok-specific options
            if is_tiktok:
                info_opts.update({
                    'extractor_args': {
                        'tiktok': {
                            'api_hostname': 'api22-normal-c-useast1a.tiktokv.com',
                        }
                    },
                    'http_headers': {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    }
                })
            
            with yt_dlp.YoutubeDL(info_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                if info:
                    video_duration = format_duration(info.get('duration', 0))
                    download_status[download_id]['duration'] = video_duration
                    if not uploader:
                        uploader = info.get('uploader', '')
                        download_status[download_id]['uploader'] = uploader
        except Exception as e:
            print(f"Error fetching video info for duration: {e}")
        
        output_template = os.path.join(downloads_path, f"{filename}.%(ext)s")
        
        # Handle audio-only downloads
        if is_audio:
            format_spec = "bestaudio[ext=mp3]/bestaudio/best"
            ydl_opts = {
                'format': format_spec,
                'outtmpl': output_template,
                'quiet': True,
                'no_warnings': True,
                'nocheckcertificate': True,
                'noprogress': True,
                'logger': QuietLogger(),
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }],
                'prefer_ffmpeg': True,
                'final_ext': 'mp3'
            }
        else:
            # Combine chosen video format with best audio for standard Windows-playable MP4 container
            # Only use merging if FFmpeg is available
            if FFMPEG_PATH:
                format_spec = f"{format_id}+bestaudio[ext=m4a]/bestaudio/{format_id}/best"
                print(f"FFmpeg found at: {FFMPEG_PATH}, using format: {format_spec}")
            else:
                # Fall back to single format if FFmpeg is not available
                # Prefer formats that are Windows Media Player compatible (H.264/AAC in MP4)
                # Windows Media Player supports: H.264 video, AAC audio in MP4 container
                format_spec = f"{format_id}[vcodec^=avc1][acodec^=mp4a]/{format_id}[vcodec^=h264][acodec^=aac]/{format_id}[ext=mp4][acodec^=aac]/{format_id}[ext=mp4]/{format_id}/best[ext=mp4][vcodec^=avc1]/best[ext=mp4]/best"
                print("FFmpeg not found, using H.264/AAC format for Windows Media Player compatibility")
            
            ydl_opts = {
                'format': format_spec,
                'outtmpl': output_template,
                'quiet': True,
                'no_warnings': True,
                'nocheckcertificate': True,
                'noprogress': True,
                'logger': QuietLogger(),
            }
        
        # Add cookie file support if cookies.txt exists
        cookies_path = os.path.join(os.path.dirname(__file__), 'cookies.txt')
        if os.path.exists(cookies_path):
            ydl_opts['cookiefile'] = cookies_path
        
        # Add Node.js runtime for JavaScript challenges
        ydl_opts['js_runtimes'] = {'node': {}}
        
        # Add TikTok-specific options to download as well
        if is_tiktok:
            ydl_opts.update({
                'extractor_args': {
                    'tiktok': {
                        'api_hostname': 'api22-normal-c-useast1a.tiktokv.com',
                    }
                },
                'http_headers': {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Cache-Control': 'max-age=0',
                },
                'nocheckcertificate': True,
                'ignoreerrors': True,
                'extract_flat': 'in_playlist',  # Try flat extraction for TikTok
            })
        
        # Custom progress hook that respects pause/resume
        def progress_hook(d):
            # Check if paused
            while download_status.get(download_id, {}).get('paused', False):
                if download_status.get(download_id, {}).get('cancelled', False):
                    raise DownloadCancelled("Download cancelled by user")
                import time
                time.sleep(0.5)
            
            # Check if cancelled
            if download_status.get(download_id, {}).get('cancelled', False):
                raise DownloadCancelled("Download cancelled by user")
            
            # Update progress
            update_progress(d, download_id)
        
        ydl_opts['progress_hooks'] = [progress_hook]
        
        # Only set merge options if FFmpeg is available
        if FFMPEG_PATH:
            ydl_opts['ffmpeg_location'] = FFMPEG_PATH
            ydl_opts['merge_output_format'] = 'mp4'
            ydl_opts['postprocessors'] = [{
                'key': 'FFmpegVideoConvertor',
                'preferedformat': 'mp4',
            }]
        # Don't use post-processors if FFmpeg is not available
        
        # Try download with retry for TikTok
        max_retries = 3 if is_tiktok else 1
        last_error = None
        
        for attempt in range(max_retries):
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([url])
                break  # Success, exit retry loop
            except Exception as e:
                last_error = e
                error_str = str(e)
                if is_tiktok and attempt < max_retries - 1:
                    print(f"TikTok download attempt {attempt + 1} failed, retrying... Error: {error_str}")
                    import time
                    time.sleep(2)  # Wait before retry
                    # Try different API hostname on retry
                    if attempt == 1:
                        ydl_opts['extractor_args']['tiktok']['api_hostname'] = 'api16-normal-c-useast1a.tiktokv.com'
                    elif attempt == 2:
                        ydl_opts['extractor_args']['tiktok']['api_hostname'] = 'api19-normal-c-useast1a.tiktokv.com'
                else:
                    raise
            
        # Check if cancelled right after download finishes
        if download_status.get(download_id, {}).get('cancelled'):
            raise DownloadCancelled("Download cancelled by user")

        # Preserve metadata before overwriting download_status
        old_status = download_status.get(download_id, {})
        
        download_status[download_id] = {
            'status': 'completed',
            'progress': 100,
            'speed': 'Done',
            'eta': 'Done',
            'filename': f"{filename}.mp4",
            'title': title,
            'resolution': resolution,
            # Preserve metadata for cloud upload
            'size_bytes': old_status.get('size_bytes', 0),
            'duration': old_status.get('duration', ''),
            'uploader': old_status.get('uploader', ''),
            'thumbnail': old_status.get('thumbnail', '')
        }
        
        # Get actual file size from disk
        try:
            file_path = os.path.join(downloads_path, f"{filename}{file_ext}")
            if os.path.exists(file_path):
                download_status[download_id]['size_bytes'] = os.path.getsize(file_path)
        except Exception as e:
            print(f"Error getting file size: {e}")
        
        # Download and save thumbnail (for all downloads)
        thumbnail_filename = ''
        if thumbnail:
            try:
                import requests
                response = requests.get(thumbnail, timeout=10)
                if response.status_code == 200:
                    thumbnail_filename = f"{filename}.jpg"
                    thumbnail_path = os.path.join(downloads_path, thumbnail_filename)
                    with open(thumbnail_path, 'wb') as f:
                        f.write(response.content)
                    print(f"Saved thumbnail to: {thumbnail_path}")
            except Exception as e:
                print(f"Error downloading thumbnail: {e}")
        
        # Save metadata JSON file if requested (for player downloads)
        if save_metadata:
            try:
                # Normalize platform to string
                platform_str = platform
                if isinstance(platform, dict):
                    platform_str = platform.get('name', 'Unknown')
                elif not isinstance(platform, str):
                    platform_str = str(platform)
                
                metadata = {
                    'title': title,
                    'url': url,
                    'platform': platform_str,
                    'thumbnail': thumbnail or '',
                    'thumbnail_filename': thumbnail_filename,
                    'uploader': uploader or '',
                    'resolution': resolution,
                    'filename': f"{filename}{file_ext}",
                    'duration': download_status[download_id].get('duration', ''),
                    'filesize': download_status[download_id].get('size_bytes', 0),
                    'timestamp': datetime.now().isoformat(),
                    'download_id': download_id
                }
                
                # Load existing metadata, add new entry, save
                player_metadata = load_player_metadata()
                player_metadata.append(metadata)
                save_player_metadata(player_metadata)
                
                print(f"Saved metadata to central player_metadata.json")
            except Exception as e:
                print(f"Error saving metadata: {e}")
        
        # Remove from queue
        if download_id in download_queue:
            download_queue.remove(download_id)
        
        # Add to history
        # Ensure platform is a simple string (normalize if it's an object)
        platform_str = platform
        if isinstance(platform, dict):
            platform_str = platform.get('name', 'Unknown')
        elif not isinstance(platform, str):
            platform_str = str(platform)
        
        # Show "Audio" for MP3 files instead of resolution
        display_resolution = 'Audio' if is_audio else resolution
        
        history_entry = {
            'id': download_id,
            'title': title,
            'url': url,
            'resolution': display_resolution,
            'filename': f"{filename}{file_ext}",  # Use correct extension based on audio/video
            'timestamp': datetime.now().isoformat(),
            'status': 'completed',
            'platform': platform_str,  # Ensure platform is always a string
            'thumbnail': thumbnail or '',  # Save thumbnail URL to history
            'thumbnail_filename': thumbnail_filename,  # Save local thumbnail filename
            # Cloud Archive fields
            'cloud_status': 'not_uploaded',  # not_uploaded, uploading, uploaded, failed
            'cloud_progress': 0,
            'cloud_file_key': '',
            'discord_message_id': '',
            'filesize': download_status[download_id].get('size_bytes', 0),
            'duration': download_status[download_id].get('duration', ''),
            'uploader': download_status[download_id].get('uploader', '')
        }
        download_history.insert(0, history_entry)
        save_history(download_history)
        
        # Check if auto-upload is enabled (would need to get from client settings)
        # For now, this requires client-side trigger or we'd need to store settings server-side
        # This is a placeholder for future auto-upload integration
            
    except DownloadCancelled:
        print(f"Download {download_id} was cancelled by user.")
        # Get the download path from status to use for cleanup
        download_path = download_status.get(download_id, {}).get('download_path')
        download_status[download_id] = {
            'status': 'cancelled',
            'error': 'Download cancelled by user',
            'progress': 0,
            'title': title,
            'resolution': resolution
        }
        if download_id in download_queue:
            download_queue.remove(download_id)
        cleanup_download_files(filename, download_id=download_id, download_path=download_path)

    except Exception as e:
        import traceback
        print(f"Error during download: {e}")
        traceback.print_exc()
        download_status[download_id] = {
            'status': 'failed',
            'error': str(e),
            'progress': 0,
            'title': title,
            'resolution': resolution
        }
        if download_id in download_queue:
            download_queue.remove(download_id)

def update_progress(d, download_id):
    """Update download progress and check for cancellation"""
    if download_status.get(download_id, {}).get('cancelled'):
        raise DownloadCancelled("Download cancelled by user")

    if d['status'] == 'downloading':
        raw_percent = d.get('_percent_str', '0%')
        clean_percent = re.sub(r'\x1b\[[0-9;]*m', '', raw_percent).replace('%', '').strip()
        raw_speed = d.get('_speed_str', '0 KB/s')
        clean_speed = re.sub(r'\x1b\[[0-9;]*m', '', raw_speed).strip()
        raw_eta = d.get('_eta_str', 'Unknown')
        clean_eta = re.sub(r'\x1b\[[0-9;]*m', '', raw_eta).strip()
        
        downloaded_bytes = d.get('downloaded_bytes', 0)
        total_bytes = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
        size_str = format_size(downloaded_bytes)
        if total_bytes:
            size_str += f" / {format_size(total_bytes)}"
        
        download_status[download_id].update({
            'status': 'downloading',
            'progress': clean_percent,
            'speed': clean_speed,
            'eta': clean_eta,
            'size': size_str
        })

@app.route('/manifest.webmanifest')
def manifest():
    return send_file('static/manifest.webmanifest', mimetype='application/manifest+json')

@app.route('/sw.js')
def service_worker():
    response = send_file('static/sw.js', mimetype='application/javascript')
    response.headers['Service-Worker-Allowed'] = '/'
    return response

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/queue')
def queue():
    return render_template('queue.html')

@app.route('/history')
def history():
    """History page"""
    return render_template('history.html')

@app.route('/cloud')
def cloud():
    """Cloud files page"""
    return render_template('cloud.html')

@app.route('/settings')
def settings():
    """Settings page"""
    return render_template('settings.html')

@app.route('/other')
def other():
    """Other tools page"""
    return render_template('other.html')

@app.route('/player')
def player():
    """Music player page"""
    return render_template('player.html')

@app.route('/api/player/files', methods=['POST'])
def list_player_files():
    """API endpoint to list audio files in player folder"""
    try:
        data = request.json
        folder = data.get('folder')
        
        if not folder or not os.path.exists(folder):
            return jsonify({'files': []})
        
        files = []
        for filename in os.listdir(folder):
            if filename.lower().endswith('.mp3') or filename.lower().endswith('.mp4'):
                filepath = os.path.join(folder, filename)
                if os.path.isfile(filepath):
                    files.append({
                        'name': filename,
                        'path': filepath,
                        'size': os.path.getsize(filepath),
                        'modified': os.path.getmtime(filepath)
                    })
        
        # Sort by filename
        files.sort(key=lambda x: x['name'].lower())
        
        return jsonify({'files': files})
    except Exception as e:
        print(f"Error listing player files: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/player/metadata')
def get_player_metadata():
    """API endpoint to get player metadata from central JSON"""
    try:
        metadata = load_player_metadata()
        return jsonify({'metadata': metadata})
    except Exception as e:
        print(f"Error loading player metadata: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/player/delete', methods=['POST'])
def delete_player_file():
    """API endpoint to delete a file from player folder"""
    try:
        data = request.json
        filename = data.get('filename')
        folder = data.get('folder')
        
        if not filename or not folder:
            return jsonify({'error': 'Filename and folder required'}), 400
        
        filepath = os.path.join(folder, filename)
        
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
        
        os.remove(filepath)
        
        # Also try to delete corresponding metadata entry and thumbnail
        try:
            player_metadata = load_player_metadata()
            
            # Find the metadata entry - try exact match first, then by download_id, then by base name
            meta_entry = next((m for m in player_metadata if m.get('filename') == filename), None)
            
            if not meta_entry:
                # Try matching by base name (without extension)
                base_name = os.path.splitext(filename)[0]
                meta_entry = next((m for m in player_metadata if os.path.splitext(m.get('filename', ''))[0] == base_name), None)
            
            if not meta_entry:
                # Try matching by download_id if available
                # Extract download_id from filename if it's in the format like "Superman_da5f2c6f.mp3"
                import re
                match = re.search(r'([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})', filename)
                if match:
                    download_id = match.group(1)
                    meta_entry = next((m for m in player_metadata if m.get('download_id') == download_id), None)
            
            # Delete thumbnail file if it exists
            if meta_entry and meta_entry.get('thumbnail_filename'):
                thumbnail_path = os.path.join(folder, meta_entry['thumbnail_filename'])
                if os.path.exists(thumbnail_path):
                    os.remove(thumbnail_path)
                    print(f"Deleted thumbnail: {thumbnail_path}")
            
            # Remove metadata entry if found
            if meta_entry:
                player_metadata = [m for m in player_metadata if m.get('filename') != meta_entry.get('filename')]
                save_player_metadata(player_metadata)
                print(f"Removed metadata entry for: {meta_entry.get('filename')}")
            else:
                print(f"No metadata entry found for: {filename}")
        except Exception as e:
            print(f"Error updating metadata after delete: {e}")
        
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error deleting file: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/player/rename', methods=['POST'])
def rename_player_file():
    """API endpoint to rename a file in player folder"""
    try:
        data = request.json
        old_filename = data.get('oldFilename')
        new_filename = data.get('newFilename')
        folder = data.get('folder')
        
        if not old_filename or not new_filename or not folder:
            return jsonify({'error': 'Old filename, new filename, and folder required'}), 400
        
        old_path = os.path.join(folder, old_filename)
        new_path = os.path.join(folder, new_filename)
        
        if not os.path.exists(old_path):
            return jsonify({'error': 'File not found'}), 404
        
        if os.path.exists(new_path):
            return jsonify({'error': 'File with that name already exists'}), 400
        
        os.rename(old_path, new_path)
        
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error renaming file: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/player/update-metadata', methods=['POST'])
def update_player_metadata():
    """API endpoint to update player metadata"""
    try:
        data = request.json
        metadata = data.get('metadata')
        
        if not metadata:
            return jsonify({'error': 'Metadata required'}), 400
        
        save_player_metadata(metadata)
        
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error updating metadata: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/player/thumbnail')
def get_player_thumbnail():
    """API endpoint to serve thumbnail image"""
    try:
        filename = request.args.get('filename')
        folder = request.args.get('folder')
        
        if not filename or not folder:
            return jsonify({'error': 'Filename and folder parameters required'}), 400
        
        filepath = os.path.join(folder, filename)
        
        if not os.path.exists(filepath):
            return jsonify({'error': 'Thumbnail not found'}), 404
        
        return send_file(filepath, mimetype='image/jpeg')
    except Exception as e:
        print(f"Error serving thumbnail: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/player/play')
def play_audio():
    """API endpoint to stream audio file"""
    try:
        file = request.args.get('file')
        folder = request.args.get('folder')
        
        if not file or not folder:
            return jsonify({'error': 'File and folder parameters required'}), 400
        
        filepath = os.path.join(folder, file)
        
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
        
        return send_file(filepath, mimetype='audio/mpeg')
    except Exception as e:
        print(f"Error playing audio: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/video-info', methods=['POST'])
def get_video_info_api():
    """API endpoint to get video info"""
    data = request.json
    url = data.get('url')
    
    if not url:
        return jsonify({'error': 'URL is required'}), 400
    
    info = get_video_info(url)
    
    if 'error' in info:
        return jsonify(info), 400
    
    return jsonify(info)

@app.route('/api/download', methods=['POST'])
def start_download():
    """API endpoint to start video download"""
    data = request.json
    url = data.get('url')
    format_id = data.get('format_id')
    title = data.get('title', 'Unknown')
    resolution = data.get('resolution', 'Unknown')
    thumbnail = data.get('thumbnail', '')
    custom_filename = data.get('custom_filename')
    preset = data.get('preset')  # 'best', 'smallest', 'audio'
    filename_template = data.get('filename_template', '{title}_{quality}_{date}')
    is_audio = preset == 'audio'  # Check if this is an audio-only download
    platform = data.get('platform', 'YouTube')  # Get platform from request
    
    if not url:
        return jsonify({'error': 'URL is required'}), 400
    
    # Handle presets
    if preset and not format_id:
        format_id = get_preset_format(url, preset)
        if not format_id:
            return jsonify({'error': f'Could not find format for preset: {preset}'}), 400
    
    if not format_id:
        return jsonify({'error': 'Format selection is required'}), 400
    
    download_id = str(uuid.uuid4())
    
    # Add to queue
    queue_position = len(download_queue) + 1
    download_queue.append(download_id)
    
    # Process filename template (skip for player downloads)
    uploader = data.get('uploader', '')
    save_metadata = data.get('save_metadata', False)
    
    if save_metadata and is_audio:
        # For player downloads, don't use filename template - use title only
        custom_filename = None
    elif custom_filename:
        custom_filename = process_filename_template(custom_filename, title, resolution, download_id, uploader)
    elif filename_template:
        # Use template from settings if no custom filename provided
        custom_filename = process_filename_template(filename_template, title, resolution, download_id, uploader)
    
    download_folder = data.get('download_folder')
    actual_resolution = data.get('actual_resolution')
    is_mobile = data.get('is_mobile', False)
    
    # For mobile devices, use default downloads folder
    if is_mobile and not download_folder:
        download_folder = DOWNLOAD_FOLDER
    
    # Start download in background thread
    thread = threading.Thread(target=download_video, args=(url, format_id, download_id, title, resolution, actual_resolution, custom_filename, download_folder, thumbnail, is_audio, platform, uploader, save_metadata))
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'download_id': download_id,
        'queue_position': queue_position
    })

def get_preset_format(url, preset):
    """Get the appropriate format ID for a preset"""
    try:
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'nocheckcertificate': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            if preset == 'best':
                # Get best video format
                return info.get('format_id', 'best')
            elif preset == 'smallest':
                # Get smallest video format
                formats = [f for f in info.get('formats', []) if f.get('vcodec') != 'none' and f.get('height')]
                if formats:
                    smallest = min(formats, key=lambda x: x.get('filesize', float('inf')))
                    return smallest.get('format_id')
            elif preset == 'audio':
                # Get best audio format
                return info.get('format_id', 'bestaudio/best')
                
        return None
    except Exception as e:
        print(f"Error getting preset format: {e}")
        return None

def process_filename_template(template, title, resolution, download_id, uploader=''):
    """Process filename template with variables"""
    from datetime import datetime
    
    # Create variable mapping
    variables = {
        '{title}': sanitize_filename(title),
        '{uploader}': sanitize_filename(uploader) if uploader else 'Unknown',
        '{date}': datetime.now().strftime('%Y-%m-%d'),
        '{quality}': resolution,
        '{id}': download_id[:8],
    }
    
    # Replace variables
    result = template
    for var, value in variables.items():
        result = result.replace(var, str(value))
    
    return result

@app.route('/api/progress/<download_id>')
def get_progress(download_id):
    """API endpoint to check download progress"""
    status = download_status.get(download_id, {'status': 'not_found'})
    
    # Add queue position if downloading
    if status.get('status') == 'downloading':
        queue_position = download_queue.index(download_id) + 1 if download_id in download_queue else 0
        status['queue_position'] = queue_position
        status['total_in_queue'] = len(download_queue)
    
    # Ensure all required fields are present for global progress widget
    if 'speed' not in status:
        status['speed'] = '--'
    if 'eta' not in status:
        status['eta'] = 'Unknown'
    if 'size' not in status:
        status['size'] = 'Unknown'
    
    return jsonify(status)

@app.route('/api/download/cancel/<download_id>', methods=['POST', 'DELETE'])
def cancel_download(download_id):
    """API endpoint to cancel an active download"""
    if download_id in download_status:
        download_status[download_id]['cancelled'] = True
        download_status[download_id]['status'] = 'cancelled'
        
    if download_id in download_queue:
        download_queue.remove(download_id)
        
    return jsonify({'success': True, 'message': 'Download cancelled'})

@app.route('/api/history/delete/<download_id>', methods=['POST', 'DELETE'])
def delete_history_item(download_id):
    """API endpoint to delete a downloaded file and its history entry"""
    try:
        # Try to get data from JSON or form
        custom_folder = None
        try:
            if request.is_json:
                data = request.get_json()
                custom_folder = data.get('download_folder')
            else:
                custom_folder = request.form.get('download_folder')
        except Exception:
            pass
        
        downloads_abs = os.path.abspath(custom_folder) if custom_folder else os.path.abspath(DOWNLOAD_FOLDER)
        
        global download_history
        print(f"Attempting to delete history item: {download_id}")
        target_entry = None
        
        for entry in download_history:
            if entry['id'] == download_id:
                target_entry = entry
                break
                
        if target_entry:
            download_history = [e for e in download_history if e['id'] != download_id]
            save_history(download_history)
            
            filename = target_entry.get('filename')
            if filename:
                try:
                    filepath = os.path.join(downloads_abs, filename)
                    if os.path.exists(filepath):
                        os.remove(filepath)
                        print(f"Deleted file: {filepath}")
                except Exception as e:
                    # Ignore file not found errors, just log them
                    print(f"File not found during delete: {filename} - {e}")
                    
        if download_id in download_status:
            del download_status[download_id]
            
        print(f"Successfully deleted history item: {download_id}")
        return jsonify({'success': True, 'message': 'Video deleted successfully'})
    except Exception as e:
        print(f"Error deleting history item: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/download-file/<download_id>', methods=['GET', 'POST'])
def download_file(download_id):
    """API endpoint to download the completed file"""
    try:
        # Try to get data from JSON or form
        custom_folder = None
        try:
            if request.is_json:
                data = request.get_json()
                custom_folder = data.get('download_folder')
            else:
                custom_folder = request.form.get('download_folder')
        except Exception:
            pass
        
        downloads_abs = os.path.abspath(custom_folder) if custom_folder else os.path.abspath(DOWNLOAD_FOLDER)
        
        # Find the actual file by looking in history
        for entry in download_history:
            if entry['id'] == download_id and entry['status'] == 'completed':
                filepath = os.path.join(downloads_abs, entry['filename'])
                if os.path.exists(filepath):
                    safe_title = sanitize_filename(entry['title'])
                    return send_file(filepath, as_attachment=True, download_name=f"{safe_title}.mp4")
        
        # Fallback: try to find any file with the short ID
        short_id = download_id[:8]
        
        for ext in ['mp4', 'webm', 'mkv']:
            filepath = os.path.join(downloads_abs, f"video_{short_id}.{ext}")
            if os.path.exists(filepath):
                return send_file(filepath, as_attachment=True, download_name=f"video_{short_id}.{ext}")
        
        return jsonify({'error': 'File not found'}), 404
    except Exception as e:
        print(f"Error downloading file: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/open-file/<download_id>', methods=['POST'])
def open_file(download_id):
    """API endpoint to get file path for opening"""
    try:
        # Try to get data from JSON or form
        custom_folder = None
        try:
            if request.is_json:
                data = request.get_json()
                custom_folder = data.get('download_folder')
            else:
                custom_folder = request.form.get('download_folder')
        except Exception:
            pass
        
        downloads_abs = os.path.abspath(custom_folder) if custom_folder else os.path.abspath(DOWNLOAD_FOLDER)
        
        for entry in download_history:
            if entry['id'] == download_id and entry['status'] == 'completed':
                filepath = os.path.join(downloads_abs, entry.get('filename', ''))
                if os.path.exists(filepath):
                    try:
                        if os.name == 'nt':
                            os.startfile(filepath)
                    except Exception as e:
                        return jsonify({'error': str(e)}), 500
                    return jsonify({'filepath': filepath, 'opened': True})
        
        return jsonify({'error': 'File not found'}), 404
    except Exception as e:
        print(f"Error opening file: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/open-folder/<download_id>', methods=['POST'])
def open_folder(download_id):
    """API endpoint to get folder path for opening"""
    try:
        # Try to get data from JSON or form
        custom_folder = None
        try:
            if request.is_json:
                data = request.get_json()
                custom_folder = data.get('download_folder')
            else:
                custom_folder = request.form.get('download_folder')
        except Exception:
            pass
        
        downloads_abs = os.path.abspath(custom_folder) if custom_folder else os.path.abspath(DOWNLOAD_FOLDER)
        
        for entry in download_history:
            if entry['id'] == download_id and entry['status'] == 'completed':
                if os.path.exists(downloads_abs):
                    try:
                        if os.name == 'nt':
                            os.startfile(downloads_abs)
                    except Exception as e:
                        return jsonify({'error': str(e)}), 500
                    return jsonify({'folderpath': downloads_abs, 'opened': True})
        
        return jsonify({'error': 'Folder not found'}), 404
    except Exception as e:
        print(f"Error opening folder: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/open-downloads-folder', methods=['POST'])
def open_downloads_folder():
    """API endpoint to open the main downloads folder"""
    try:
        # Check if client sent a custom download folder
        data = request.json or {}
        custom_folder = data.get('download_folder')
        
        downloads_path = os.path.abspath(custom_folder) if custom_folder else os.path.abspath(DOWNLOAD_FOLDER)
        
        if not os.path.exists(downloads_path):
            os.makedirs(downloads_path, exist_ok=True)
            
        if os.name == 'nt':
            os.startfile(downloads_path)
            
        return jsonify({'opened': True, 'path': downloads_path})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/browse-folder', methods=['POST'])
def browse_folder():
    """API endpoint to open native folder picker dialog"""
    try:
        import tkinter as tk
        from tkinter import filedialog
        
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes('-topmost', 1)
        
        # Get current download folder to set as initial dir
        current_folder = os.path.abspath(DOWNLOAD_FOLDER)
        if not os.path.exists(current_folder):
            current_folder = os.getcwd()
            
        folder_path = filedialog.askdirectory(
            parent=root, 
            initialdir=current_folder, 
            title="Select Download Folder"
        )
        root.destroy()
        
        if folder_path:
            return jsonify({'folderpath': os.path.abspath(folder_path)})
        else:
            return jsonify({'cancelled': True})
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/history')
def get_history():
    """API endpoint to get download history"""
    # Reload history from file to ensure it's up to date
    # This is important because cloud upload status is updated in background threads
    download_history.clear()
    download_history.extend(load_history())
    
    # Also scan downloads folder for any files not in history
    downloads_path = os.path.abspath(DOWNLOAD_FOLDER)
    if os.path.exists(downloads_path):
        existing_files = set()
        for entry in download_history:
            if entry.get('filename'):
                existing_files.add(entry['filename'])
        
        # Add any files in downloads folder that aren't in history
        for filename in os.listdir(downloads_path):
            if filename.endswith(('.mp4', '.webm', '.mkv', '.m4a', '.mp3')):
                if filename not in existing_files:
                    # Add to history
                    file_path = os.path.join(downloads_path, filename)
                    file_stat = os.stat(file_path)
                    download_history.insert(0, {
                        'id': str(uuid.uuid4()),
                        'title': filename.replace('.mp4', '').replace('.webm', '').replace('.mkv', '').replace('.m4a', '').replace('.mp3', ''),
                        'url': 'unknown',
                        'resolution': 'unknown',
                        'filename': filename,
                        'timestamp': datetime.fromtimestamp(file_stat.st_mtime).isoformat(),
                        'status': 'completed',
                        'filesize': file_stat.st_size
                    })
    
    # Don't save here - only read to avoid overwriting background thread changes
    # The background upload thread handles saving
    
    return jsonify(download_history)

@app.route('/api/queue')
def get_queue():
    """API endpoint to get current download queue"""
    queue_info = []
    for download_id in download_queue:
        status = download_status.get(download_id, {'status': 'unknown'})
        queue_info.append({
            'id': download_id,
            'status': status.get('status', 'unknown'),
            'title': status.get('title', 'Unknown'),
            'resolution': status.get('resolution', 'Unknown'),
            'actual_resolution': status.get('actual_resolution', ''),
            'progress': status.get('progress', 0),
            'speed': status.get('speed', '--'),
            'eta': status.get('eta', 'Unknown'),
            'size': status.get('size', 'Unknown'),
            'thumbnail': status.get('thumbnail', ''),
            'started_at': status.get('timestamp', datetime.now().isoformat())
        })
    return jsonify(queue_info)

@app.route('/api/history/clear', methods=['POST'])
def clear_history():
    """API endpoint to clear download history"""
    try:
        # Try to get data from JSON or form
        custom_folder = None
        try:
            if request.is_json:
                data = request.get_json()
                custom_folder = data.get('download_folder')
            else:
                custom_folder = request.form.get('download_folder')
        except Exception:
            pass
        
        downloads_abs = os.path.abspath(custom_folder) if custom_folder else os.path.abspath(DOWNLOAD_FOLDER)
        
        global download_history
        print(f"Starting history clear in folder: {downloads_abs}")
        for entry in download_history:
            if entry.get('filename'):
                try:
                    cleanup_download_files(entry['filename'], download_path=downloads_abs)
                except Exception as e:
                    # Ignore file not found errors, just log them
                    print(f"File not found during cleanup: {entry.get('filename')} - {e}")
        download_history = []
        save_history(download_history)
        print("History cleared successfully")
        return jsonify({'success': True, 'message': 'History cleared successfully'})
    except Exception as e:
        print(f"Error clearing history: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/download/pause/<download_id>', methods=['POST'])
def pause_download(download_id):
    """API endpoint to pause a download using flag-based approach"""
    if download_id in download_status:
        download_status[download_id]['status'] = 'paused'
        download_status[download_id]['paused'] = True
        return jsonify({'success': True, 'message': 'Download paused'})
    return jsonify({'error': 'Download not found'}), 404

@app.route('/api/download/resume/<download_id>', methods=['POST'])
def resume_download(download_id):
    """API endpoint to resume a paused download using flag-based approach"""
    if download_id in download_status:
        download_status[download_id]['status'] = 'downloading'
        download_status[download_id]['paused'] = False
        return jsonify({'success': True, 'message': 'Download resumed'})
    return jsonify({'error': 'Download not found'}), 404

@app.route('/api/cleanup-part-files', methods=['POST'])
def cleanup_part_files():
    """API endpoint to find and delete all .part files in download directories"""
    try:
        # Get custom download folder from request if provided
        data = request.json or {}
        custom_folder = data.get('download_folder')
        
        # Use custom folder if provided, otherwise use default
        if custom_folder and custom_folder.strip():
            downloads_abs = os.path.abspath(custom_folder)
        else:
            downloads_abs = os.path.abspath(DOWNLOAD_FOLDER)
        
        deleted_files = []
        total_deleted = 0
        
        if os.path.exists(downloads_abs):
            print(f"Checking for .part files in: {downloads_abs}")
            
            for f in os.listdir(downloads_abs):
                if f.endswith('.part') or f.endswith('.temp') or f.endswith('.ytdl'):
                    file_path = os.path.join(downloads_abs, f)
                    try:
                        os.remove(file_path)
                        deleted_files.append(f)
                        total_deleted += 1
                        print(f"Deleted .part file: {file_path}")
                    except Exception as e:
                        print(f"Error deleting {file_path}: {e}")
        
        return jsonify({
            'success': True,
            'deleted_count': total_deleted,
            'deleted_files': deleted_files,
            'message': f'Deleted {total_deleted} .part file(s)'
        })
    except Exception as e:
        print(f"Error cleaning up .part files: {e}")
        return jsonify({'error': str(e)}), 500

# ────────────────────────────────────────────────────────────
# Cloud Archive Functions
# ────────────────────────────────────────────────────────────

def get_b2_client():
    """Get B2 S3 client using settings from request or environment"""
    try:
        # Try to get settings from request JSON (for per-request config)
        data = request.json if request.is_json else {}
        b2_settings = data.get('b2_settings', {})
        
        bucket_name = b2_settings.get('bucket_name') or B2_BUCKET_NAME
        endpoint_url = b2_settings.get('endpoint_url') or B2_ENDPOINT_URL
        key_id = b2_settings.get('key_id') or B2_KEY_ID
        application_key = b2_settings.get('application_key') or B2_APPLICATION_KEY
        
        if not all([bucket_name, endpoint_url, key_id, application_key]):
            return None, None
        
        s3 = boto3.client(
            's3',
            endpoint_url=endpoint_url,
            aws_access_key_id=key_id,
            aws_secret_access_key=application_key,
            config=Config(signature_version='s3v4')
        )
        return s3, bucket_name
    except Exception as e:
        print(f"Error creating B2 client: {e}")
        return None, None

def send_discord_webhook(webhook_url, embed_data):
    """Send initial Discord webhook message"""
    try:
        payload = {
            'embeds': [embed_data]
        }
        print(f"Sending Discord webhook to: {webhook_url}")
        # Don't print embed data to avoid emoji encoding issues
        response = requests.post(webhook_url, json=payload, timeout=10)
        print(f"Discord response status: {response.status_code}")
        print(f"Discord response body: {response.text}")
        if response.status_code == 200:
            data = response.json()
            print(f"Discord message ID: {data.get('id')}")
            return data.get('id'), None
        elif response.status_code == 204:
            # 204 No Content - webhook sent successfully but no body
            # Try to get message ID from response headers
            message_id = response.headers.get('X-Message-Id') or None
            print(f"Discord webhook sent successfully (204 No Content), message ID from headers: {message_id}")
            return message_id, None
        return None, f"Discord webhook failed: {response.status_code}"
    except Exception as e:
        print(f"Discord webhook exception: {e}")
        import traceback
        traceback.print_exc()
        return None, str(e)

def edit_discord_webhook(webhook_url, message_id, embed_data):
    """Edit existing Discord webhook message"""
    try:
        payload = {
            'embeds': [embed_data]
        }
        edit_url = f"{webhook_url}/messages/{message_id}"
        print(f"Editing Discord webhook: {edit_url}")
        # Don't print embed data to avoid emoji encoding issues
        response = requests.patch(edit_url, json=payload, timeout=10)
        print(f"Discord edit response status: {response.status_code}")
        print(f"Discord edit response body: {response.text}")
        if response.status_code not in [200, 204]:
            return f"Discord webhook edit failed: {response.status_code}"
        return None
    except Exception as e:
        print(f"Discord webhook edit exception: {e}")
        import traceback
        traceback.print_exc()
        return str(e)

def upload_to_b2_with_progress(file_path, object_key, download_id, b2_settings=None):
    """Upload file to B2 with progress tracking"""
    try:
        # Get B2 client
        if b2_settings:
            s3 = boto3.client(
                's3',
                endpoint_url=b2_settings.get('endpoint_url'),
                aws_access_key_id=b2_settings.get('key_id'),
                aws_secret_access_key=b2_settings.get('application_key'),
                config=Config(signature_version='s3v4')
            )
            bucket_name = b2_settings.get('bucket_name')
        else:
            s3, bucket_name = get_b2_client()
            if not s3:
                raise Exception("B2 client not configured")
        
        file_size = os.path.getsize(file_path)
        uploaded = 0
        last_save_progress = 0
        print(f"Starting upload: {file_path} ({file_size} bytes)")
        
        def upload_callback(bytes_transferred):
            nonlocal uploaded, last_save_progress
            uploaded += bytes_transferred
            progress = (uploaded / file_size) * 100
            cloud_upload_status[download_id] = {
                'status': 'uploading',
                'progress': progress,
                'uploaded_bytes': uploaded,
                'total_bytes': file_size
            }
            # Update history entry with progress periodically
            for entry in download_history:
                if entry['id'] == download_id:
                    entry['cloud_progress'] = progress
                    # Save history every 10% progress to avoid excessive file I/O
                    if progress - last_save_progress >= 10:
                        save_history(download_history)
                        last_save_progress = progress
                    break
        
        # Upload with callback
        s3.upload_file(
            file_path,
            bucket_name,
            object_key,
            Callback=upload_callback,
            ExtraArgs={'ContentType': 'video/mp4'}
        )
        
        print(f"Upload completed: {object_key}")
        return None, object_key
    except Exception as e:
        print(f"Upload error: {e}")
        import traceback
        traceback.print_exc()
        return str(e), None

@app.route('/api/cloud/upload/<download_id>', methods=['POST'])
def upload_to_cloud(download_id):
    """Upload a downloaded video to cloud storage"""
    try:
        # Find history entry
        history_entry = None
        for entry in download_history:
            if entry['id'] == download_id:
                history_entry = entry
                break
        
        if not history_entry:
            return jsonify({'error': 'History entry not found'}), 404
        
        # Get settings from request
        data = request.json or {}
        b2_settings = data.get('b2_settings', {})
        discord_webhook = data.get('discord_webhook_url') or DISCORD_WEBHOOK_URL
        
        # Validate B2 settings
        if not all([b2_settings.get('bucket_name'), b2_settings.get('endpoint_url'), 
                   b2_settings.get('key_id'), b2_settings.get('application_key')]):
            return jsonify({'error': 'B2 settings not configured'}), 400
        
        # Get file path
        custom_folder = data.get('download_folder')
        downloads_abs = os.path.abspath(custom_folder) if custom_folder else os.path.abspath(DOWNLOAD_FOLDER)
        file_path = os.path.join(downloads_abs, history_entry['filename'])
        
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404
        
        # Update history status
        history_entry['cloud_status'] = 'uploading'
        history_entry['cloud_progress'] = 0
        save_history(download_history)
        
        # Start upload in background thread
        def upload_thread():
            try:
                print(f"Upload thread started for {download_id}")
                # Reload history from file to get the latest reference
                global download_history
                download_history.clear()
                download_history.extend(load_history())
                
                # Re-find history entry to ensure we have the latest reference
                history_entry = None
                for entry in download_history:
                    if entry['id'] == download_id:
                        history_entry = entry
                        break
                
                if not history_entry:
                    print(f"History entry not found in thread for {download_id}")
                    return
                # Send initial Discord webhook
                discord_message_id = None
                if discord_webhook:
                    embed_data = {
                        'title': f"🟡 Uploading: {history_entry['title']}",
                        'description': f"Starting upload to Backblaze B2 cloud storage",
                        'color': 0xffff00,  # Yellow
                        'fields': [
                            {'name': '📁 File Name', 'value': history_entry.get('filename', 'Unknown'), 'inline': False},
                            {'name': '📊 File Size', 'value': f"{history_entry.get('filesize', 0) / (1024*1024):.2f} MB", 'inline': True},
                            {'name': '📺 Resolution', 'value': history_entry.get('resolution', 'Unknown'), 'inline': True},
                            {'name': '☁️ Bucket', 'value': b2_settings.get('bucket_name', 'Unknown'), 'inline': True},
                            {'name': '⏰ Started At', 'value': datetime.now().strftime('%Y-%m-%d %H:%M:%S'), 'inline': True},
                        ],
                        'url': history_entry.get('url', '')
                    }
                    if history_entry.get('thumbnail'):
                        embed_data['thumbnail'] = {'url': history_entry['thumbnail']}
                    embed_data['footer'] = {'text': 'YouTube Downloader - Cloud Archive'}
                    
                    discord_message_id, discord_error = send_discord_webhook(discord_webhook, embed_data)
                    if discord_error:
                        print(f"Discord webhook error (non-fatal): {discord_error}")
                    else:
                        history_entry['discord_message_id'] = discord_message_id
                
                # Generate object key
                object_key = f"videos/{download_id}/{history_entry['filename']}"
                
                # Upload to B2
                error, file_key = upload_to_b2_with_progress(file_path, object_key, download_id, b2_settings)
                
                if error:
                    # Update history on failure
                    history_entry['cloud_status'] = 'failed'
                    history_entry['cloud_progress'] = 0
                    save_history(download_history)
                    
                    # Update Discord on failure
                    if discord_webhook and discord_message_id:
                        embed_data = {
                            'title': f"🔴 Upload Failed: {history_entry['title']}",
                            'description': f"Status: Upload failed\nError: {error}",
                            'color': 0xff0000,  # Red
                            'fields': [
                                {'name': 'Duration', 'value': history_entry.get('duration', 'Unknown'), 'inline': True},
                                {'name': 'File Size', 'value': f"{history_entry.get('filesize', 0) / (1024*1024):.2f} MB", 'inline': True},
                            ]
                        }
                        edit_discord_webhook(discord_webhook, discord_message_id, embed_data)
                    
                    cloud_upload_status[download_id] = {
                        'status': 'failed',
                        'error': error
                    }
                    return
                
                # Update history on success
                print(f"Updating history for {download_id} to uploaded status")
                print(f"Before update: cloud_status={history_entry.get('cloud_status')}")
                history_entry['cloud_status'] = 'uploaded'
                history_entry['cloud_progress'] = 100
                history_entry['cloud_file_key'] = file_key
                print(f"After update: cloud_status={history_entry.get('cloud_status')}")
                
                # Generate and save signed URL
                s3 = boto3.client(
                    's3',
                    endpoint_url=b2_settings.get('endpoint_url'),
                    aws_access_key_id=b2_settings.get('key_id'),
                    aws_secret_access_key=b2_settings.get('application_key'),
                    config=Config(signature_version='s3v4')
                )
                signed_url = s3.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': b2_settings.get('bucket_name'), 'Key': file_key},
                    ExpiresIn=data.get('signed_url_expiration', 604800)  # Default to 7 days (B2 max limit)
                )
                history_entry['cloud_signed_url'] = signed_url
                
                # Save to file directly without using global variable
                print(f"About to save history directly to file, current cloud_status={history_entry['cloud_status']}")
                try:
                    # Read current file
                    with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                        file_history = json.load(f)
                    
                    # Find and update the entry in the file data
                    for entry in file_history:
                        if entry['id'] == download_id:
                            entry['cloud_status'] = 'uploaded'
                            entry['cloud_progress'] = 100
                            entry['cloud_file_key'] = file_key
                            entry['cloud_signed_url'] = signed_url
                            print(f"Updated entry in file data: cloud_status={entry['cloud_status']}")
                            break
                    
                    # Write back to file
                    temp_file = HISTORY_FILE + '.tmp'
                    with open(temp_file, 'w', encoding='utf-8') as f:
                        json.dump(file_history, f, ensure_ascii=False, indent=2)
                    import shutil
                    shutil.move(temp_file, HISTORY_FILE)
                    print(f"History saved directly to file")
                    
                    # Verify
                    with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                        verify_history = json.load(f)
                    verify_entry = None
                    for entry in verify_history:
                        if entry['id'] == download_id:
                            verify_entry = entry
                            break
                    if verify_entry:
                        print(f"Verification: cloud_status={verify_entry.get('cloud_status')}")
                    else:
                        print(f"Verification: Entry not found in file")
                except Exception as e:
                    print(f"Direct save error: {e}")
                    import traceback
                    traceback.print_exc()
                
                # Update Discord on success
                if discord_webhook:
                    # Calculate expiration days
                    expiration_seconds = data.get('signed_url_expiration')
                    if not expiration_seconds or expiration_seconds == 0:
                        expiration_seconds = 604800  # Default to 7 days (B2 max limit)
                    expiration_days = expiration_seconds // 86400
                    
                    print(f"Expiration: seconds={expiration_seconds}, days={expiration_days}")
                    
                    embed_data = {
                        'title': f"🟢 Uploaded Successfully: {history_entry['title']}",
                        'description': f"Video has been uploaded to Backblaze B2 cloud storage",
                        'color': 0x00ff00,  # Green
                        'fields': [
                            {'name': '📁 File Name', 'value': history_entry.get('filename', 'Unknown'), 'inline': False},
                            {'name': '📊 File Size', 'value': f"{history_entry.get('filesize', 0) / (1024*1024):.2f} MB", 'inline': True},
                            {'name': '📺 Resolution', 'value': history_entry.get('resolution', 'Unknown'), 'inline': True},
                            {'name': '☁️ Bucket', 'value': b2_settings.get('bucket_name', 'Unknown'), 'inline': True},
                            {'name': '⏰ Uploaded At', 'value': datetime.now().strftime('%Y-%m-%d %H:%M:%S'), 'inline': True},
                            {'name': '🔗 Link Expires', 'value': f"{expiration_days} days", 'inline': True},
                        ],
                        'url': signed_url
                    }
                    if history_entry.get('thumbnail'):
                        embed_data['thumbnail'] = {'url': history_entry['thumbnail']}
                    embed_data['footer'] = {'text': 'YouTube Downloader - Cloud Archive'}
                    
                    # Try to edit if we have a message ID, otherwise send new message
                    if discord_message_id:
                        edit_error = edit_discord_webhook(discord_webhook, discord_message_id, embed_data)
                        if edit_error:
                            print(f"Failed to edit Discord message, sending new one instead: {edit_error}")
                            send_discord_webhook(discord_webhook, embed_data)
                    else:
                        send_discord_webhook(discord_webhook, embed_data)
                
                cloud_upload_status[download_id] = {
                    'status': 'completed',
                    'progress': 100,
                    'file_key': file_key
                }
                
            except Exception as e:
                print(f"Upload thread error: {e}")
                import traceback
                traceback.print_exc()
                history_entry['cloud_status'] = 'failed'
                save_history(download_history)
                cloud_upload_status[download_id] = {
                    'status': 'failed',
                    'error': str(e)
                }
        
        thread = threading.Thread(target=upload_thread)
        thread.daemon = True
        thread.start()
        
        return jsonify({'success': True, 'message': 'Upload started'})
    except Exception as e:
        print(f"Error starting cloud upload: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cloud/progress/<download_id>')
def get_cloud_upload_progress(download_id):
    """Get cloud upload progress"""
    # Reload history from file to get the latest status
    global download_history
    download_history.clear()
    download_history.extend(load_history())
    
    # Always check history first for the most up-to-date status
    for entry in download_history:
        if entry['id'] == download_id:
            cloud_status = entry.get('cloud_status', 'not_uploaded')
            cloud_progress = entry.get('cloud_progress', 0)
            
            # Return status based on history
            if cloud_status == 'uploaded':
                return jsonify({
                    'status': 'completed',
                    'progress': 100,
                    'cloud_status': 'uploaded',
                    'cloud_progress': 100
                })
            elif cloud_status == 'failed':
                return jsonify({
                    'status': 'failed',
                    'cloud_status': 'failed',
                    'cloud_progress': 0
                })
            elif cloud_status == 'uploading':
                # Check in-memory status for real-time progress
                in_memory = cloud_upload_status.get(download_id, {})
                return jsonify({
                    'status': 'uploading',
                    'progress': in_memory.get('progress', cloud_progress),
                    'cloud_status': 'uploading',
                    'cloud_progress': in_memory.get('progress', cloud_progress)
                })
            else:
                return jsonify({
                    'status': 'not_started',
                    'cloud_status': 'not_uploaded',
                    'cloud_progress': 0
                })
    
    # If no history entry found, check in-memory status
    status = cloud_upload_status.get(download_id, {'status': 'not_started'})
    return jsonify(status)

@app.route('/api/cloud/open/<download_id>', methods=['POST'])
def open_cloud_video(download_id):
    """Generate signed URL for cloud video"""
    try:
        # Reload history from file to get the latest status
        global download_history
        download_history.clear()
        download_history.extend(load_history())
        
        # Find history entry
        history_entry = None
        for entry in download_history:
            if entry['id'] == download_id:
                history_entry = entry
                break
        
        if not history_entry:
            return jsonify({'error': 'History entry not found'}), 404
        
        if history_entry.get('cloud_status') != 'uploaded':
            return jsonify({'error': 'Video not uploaded to cloud'}), 400
        
        # Use the saved signed URL if available
        if history_entry.get('cloud_signed_url'):
            return jsonify({'url': history_entry['cloud_signed_url'], 'expires_in': 'saved'})
        
        # If no saved URL, generate a new one
        data = request.json or {}
        b2_settings = data.get('b2_settings', {})
        expiration = data.get('expiration', 604800)  # Default to 7 days (B2 max limit)
        
        # Use provided settings or fall back to environment
        bucket_name = b2_settings.get('bucket_name') or B2_BUCKET_NAME
        endpoint_url = b2_settings.get('endpoint_url') or B2_ENDPOINT_URL
        key_id = b2_settings.get('key_id') or B2_KEY_ID
        application_key = b2_settings.get('application_key') or B2_APPLICATION_KEY
        
        if not all([bucket_name, endpoint_url, key_id, application_key]):
            return jsonify({'error': 'B2 settings not configured'}), 400
        
        # Create S3 client
        s3 = boto3.client(
            's3',
            endpoint_url=endpoint_url,
            aws_access_key_id=key_id,
            aws_secret_access_key=application_key,
            config=Config(signature_version='s3v4')
        )
        
        # Generate signed URL
        signed_url = s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket_name, 'Key': history_entry['cloud_file_key']},
            ExpiresIn=expiration
        )
        
        return jsonify({'url': signed_url, 'expires_in': expiration})
    except Exception as e:
        print(f"Error generating signed URL: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cloud/open/generate', methods=['POST'])
def generate_signed_url():
    """Generate signed URL for a file by key"""
    try:
        data = request.json or {}
        file_key = data.get('file_key')
        b2_settings = data.get('b2_settings', {})
        expiration = data.get('expiration', 604800)
        
        if not file_key:
            return jsonify({'error': 'File key is required'}), 400
        
        # Use provided settings or fall back to environment
        bucket_name = b2_settings.get('bucket_name') or B2_BUCKET_NAME
        endpoint_url = b2_settings.get('endpoint_url') or B2_ENDPOINT_URL
        key_id = b2_settings.get('key_id') or B2_KEY_ID
        application_key = b2_settings.get('application_key') or B2_APPLICATION_KEY
        
        if not all([bucket_name, endpoint_url, key_id, application_key]):
            return jsonify({'error': 'B2 settings not configured'}), 400
        
        # Create S3 client
        s3 = boto3.client(
            's3',
            endpoint_url=endpoint_url,
            aws_access_key_id=key_id,
            aws_secret_access_key=application_key,
            config=Config(signature_version='s3v4')
        )
        
        # Generate signed URL
        signed_url = s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket_name, 'Key': file_key},
            ExpiresIn=expiration
        )
        
        return jsonify({'url': signed_url, 'expires_in': expiration})
    except Exception as e:
        print(f"Error generating signed URL: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cloud/storage', methods=['POST'])
def get_cloud_storage():
    """Get B2 storage usage information"""
    try:
        data = request.json or {}
        b2_settings = data.get('b2_settings', {})
        
        # Use provided settings or fall back to environment
        bucket_name = b2_settings.get('bucket_name') or B2_BUCKET_NAME
        endpoint_url = b2_settings.get('endpoint_url') or B2_ENDPOINT_URL
        key_id = b2_settings.get('key_id') or B2_KEY_ID
        application_key = b2_settings.get('application_key') or B2_APPLICATION_KEY
        
        if not all([bucket_name, endpoint_url, key_id, application_key]):
            return jsonify({'error': 'B2 settings not configured'}), 400
        
        # Create S3 client
        s3 = boto3.client(
            's3',
            endpoint_url=endpoint_url,
            aws_access_key_id=key_id,
            aws_secret_access_key=application_key,
            config=Config(signature_version='s3v4')
        )
        
        # Get bucket size
        total_size = 0
        file_count = 0
        try:
            paginator = s3.get_paginator('list_objects_v2')
            for page in paginator.paginate(Bucket=bucket_name):
                if 'Contents' in page:
                    for obj in page['Contents']:
                        total_size += obj['Size']
                        file_count += 1
        except Exception as e:
            print(f"Error listing bucket objects: {e}")
            return jsonify({'error': f'Failed to list bucket: {str(e)}'}), 500
        
        # Format sizes
        total_size_mb = total_size / (1024 * 1024)
        total_size_gb = total_size_mb / 1024
        
        return jsonify({
            'bucket_name': bucket_name,
            'total_size_bytes': total_size,
            'total_size_mb': round(total_size_mb, 2),
            'total_size_gb': round(total_size_gb, 2),
            'file_count': file_count
        })
    except Exception as e:
        print(f"Error getting storage info: {e}")
        return jsonify({'error': str(e)}), 500



@app.route('/api/cloud/files', methods=['POST'])

def list_cloud_files():

    """List all files in B2 bucket"""

    try:

        data = request.json or {}

        b2_settings = data.get('b2_settings', {})

        

        # Use provided settings or fall back to environment

        bucket_name = b2_settings.get('bucket_name') or B2_BUCKET_NAME

        endpoint_url = b2_settings.get('endpoint_url') or B2_ENDPOINT_URL

        key_id = b2_settings.get('key_id') or B2_KEY_ID

        application_key = b2_settings.get('application_key') or B2_APPLICATION_KEY

        

        if not all([bucket_name, endpoint_url, key_id, application_key]):

            return jsonify({'error': 'B2 settings not configured'}), 400

        

        # Create S3 client

        s3 = boto3.client(

            's3',

            endpoint_url=endpoint_url,

            aws_access_key_id=key_id,

            aws_secret_access_key=application_key,

            config=Config(signature_version='s3v4')

        )

        

        # List all objects

        files = []

        try:

            paginator = s3.get_paginator('list_objects_v2')

            for page in paginator.paginate(Bucket=bucket_name):

                if 'Contents' in page:

                    for obj in page['Contents']:

                        # Extract download_id from key (format: videos/{download_id}/{filename})

                        key = obj['Key']

                        parts = key.split('/')

                        download_id = parts[1] if len(parts) > 1 else None

                        filename = parts[-1] if parts else key

                        

                        files.append({

                            'key': key,

                            'filename': filename,

                            'size': obj['Size'],

                            'size_mb': round(obj['Size'] / (1024 * 1024), 2),

                            'last_modified': obj['LastModified'].isoformat(),

                            'download_id': download_id

                        })

        except Exception as e:

            print(f"Error listing bucket objects: {e}")

            return jsonify({'error': f'Failed to list bucket: {str(e)}'}), 500

        

        # Sort by last modified descending

        files.sort(key=lambda x: x['last_modified'], reverse=True)

        

        return jsonify({

            'bucket_name': bucket_name,

            'files': files,

            'total_count': len(files)

        })

    except Exception as e:

        print(f"Error listing cloud files: {e}")

        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/cloud/settings', methods=['POST'])
def save_cloud_settings():
    """Save cloud settings to server (for auto-upload feature)"""
    try:
        data = request.json
        # In a production app, you'd encrypt and store these securely
        # For now, we'll just acknowledge receipt
        return jsonify({'success': True, 'message': 'Settings received'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ────────────────────────────────────────────────────────────
#  Other Tools API Endpoints
# ────────────────────────────────────────────────────────────
# Simple in-memory URL shortener storage
url_shortener_storage = {}

@app.route('/api/shorten', methods=['POST'])
def shorten_url():
    """Generate a short URL for any given URL"""
    try:
        data = request.json
        long_url = data.get('url', '').strip()
        method = data.get('method', 'local')
        
        if not long_url:
            return jsonify({'success': False, 'error': 'URL is required'}), 400
        
        # Validate URL format
        if not (long_url.startswith('http://') or long_url.startswith('https://')):
            return jsonify({'success': False, 'error': 'URL must start with http:// or https://'}), 400
        
        short_url = ''
        
        if method == 'local':
            # Generate a short code (6 characters)
            import random
            import string
            short_code = ''.join(random.choices(string.ascii_letters + string.digits, k=6))
            
            # Store the mapping
            url_shortener_storage[short_code] = long_url
            
            # Generate short URL (using current host)
            host = request.host_url.rstrip('/')
            short_url = f"{host}/s/{short_code}"
            
        else:
            # Use pyshorteners library for external services
            try:
                import pyshorteners
                s = pyshorteners.Shortener()
                
                if method == 'tinyurl':
                    short_url = s.tinyurl.short(long_url)
                elif method == 'isgd':
                    # Is.gd sometimes has rate limiting or database issues
                    # Check if the response contains an error message
                    short_url = s.isgd.short(long_url)
                    if 'Error' in short_url or not short_url.startswith('http'):
                        print(f"Is.gd returned error: {short_url}, falling back to local")
                        raise Exception('Is.gd service unavailable')
                elif method == 'dagd':
                    short_url = s.dagd.short(long_url)
                else:
                    return jsonify({'success': False, 'error': 'Invalid shortening method'}), 400
                    
            except Exception as e:
                # Fallback to local if external service fails
                print(f"External shortener failed ({method}): {e}, using local fallback")
                import random
                import string
                short_code = ''.join(random.choices(string.ascii_letters + string.digits, k=6))
                url_shortener_storage[short_code] = long_url
                host = request.host_url.rstrip('/')
                short_url = f"{host}/s/{short_code}"
                method = 'local (service unavailable)'
        
        return jsonify({
            'success': True,
            'short_url': short_url,
            'method': method
        })
    except Exception as e:
        print(f"Error shortening URL: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/s/<short_code>')
def redirect_short_url(short_code):
    """Redirect short URL to original URL"""
    long_url = url_shortener_storage.get(short_code)
    if long_url:
        return redirect(long_url)
    else:
        return "Short URL not found", 404

@app.route('/api/trim', methods=['POST'])
def trim_video():
    """Trim video to specified time range using FFmpeg"""
    try:
        if 'video' not in request.files:
            return jsonify({'success': False, 'error': 'No video file provided'}), 400
        
        video_file = request.files['video']
        start_time = float(request.form.get('start', 0))
        end_time = float(request.form.get('end', 0))
        
        if start_time >= end_time:
            return jsonify({'success': False, 'error': 'Start time must be less than end time'}), 400
        
        # Save uploaded video temporarily
        import uuid
        temp_dir = os.path.join(os.getcwd(), DOWNLOAD_FOLDER, 'temp')
        os.makedirs(temp_dir, exist_ok=True)
        
        temp_input = os.path.join(temp_dir, f"input_{uuid.uuid4()}.mp4")
        temp_output = os.path.join(temp_dir, f"trimmed_{uuid.uuid4()}.mp4")
        
        video_file.save(temp_input)
        
        # Use FFmpeg to trim video
        duration = end_time - start_time
        ffmpeg_cmd = [
            FFMPEG_PATH or 'ffmpeg',
            '-i', temp_input,
            '-ss', str(start_time),
            '-t', str(duration),
            '-c', 'copy',
            '-y',
            temp_output
        ]
        
        import subprocess
        result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        
        # Clean up input file
        try:
            os.remove(temp_input)
        except:
            pass
        
        if result.returncode != 0:
            return jsonify({'success': False, 'error': f'FFmpeg error: {result.stderr}'}), 500
        
        # Move to downloads folder
        downloads_dir = os.path.join(os.getcwd(), DOWNLOAD_FOLDER)
        final_output = os.path.join(downloads_dir, f"trimmed_{uuid.uuid4()}.mp4")
        os.rename(temp_output, final_output)
        
        return jsonify({
            'success': True,
            'output_path': final_output
        })
    except Exception as e:
        print(f"Error trimming video: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/download-trimmed')
def download_trimmed():
    """Download trimmed video"""
    try:
        path = request.args.get('path', '')
        if not path or not os.path.exists(path):
            return jsonify({'error': 'File not found'}), 404
        
        return send_file(path, as_attachment=True)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/create-gif', methods=['POST'])
def create_gif():
    """Convert video segment to GIF using FFmpeg"""
    try:
        if 'video' not in request.files:
            return jsonify({'success': False, 'error': 'No video file provided'}), 400
        
        video_file = request.files['video']
        start_time = float(request.form.get('start', 0))
        duration = float(request.form.get('duration', 3))
        width = int(request.form.get('width', 480))
        fps = int(request.form.get('fps', 10))
        
        # Save uploaded video temporarily
        import uuid
        temp_dir = os.path.join(os.getcwd(), DOWNLOAD_FOLDER, 'temp')
        os.makedirs(temp_dir, exist_ok=True)
        
        temp_input = os.path.join(temp_dir, f"input_{uuid.uuid4()}.mp4")
        temp_output = os.path.join(temp_dir, f"output_{uuid.uuid4()}.gif")
        
        video_file.save(temp_input)
        
        # Use FFmpeg to create GIF
        ffmpeg_cmd = [
            FFMPEG_PATH or 'ffmpeg',
            '-i', temp_input,
            '-ss', str(start_time),
            '-t', str(duration),
            '-vf', f'scale={width}:-1:flags=lanczos,fps={fps}',
            '-y',
            temp_output
        ]
        
        import subprocess
        result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        
        # Clean up input file
        try:
            os.remove(temp_input)
        except:
            pass
        
        if result.returncode != 0:
            return jsonify({'success': False, 'error': f'FFmpeg error: {result.stderr}'}), 500
        
        # Move to downloads folder
        downloads_dir = os.path.join(os.getcwd(), DOWNLOAD_FOLDER)
        final_output = os.path.join(downloads_dir, f"gif_{uuid.uuid4()}.gif")
        os.rename(temp_output, final_output)
        
        # Generate URL for preview
        gif_url = f"/api/download-gif?path={final_output}"
        
        return jsonify({
            'success': True,
            'output_path': final_output,
            'gif_url': gif_url
        })
    except Exception as e:
        print(f"Error creating GIF: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/download-gif')
def download_gif():
    """Download or serve GIF file"""
    try:
        path = request.args.get('path', '')
        if not path or not os.path.exists(path):
            return jsonify({'error': 'File not found'}), 404
        
        return send_file(path, mimetype='image/gif')
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ────────────────────────────────────────────────────────────
#  Image Tools API Endpoints
# ────────────────────────────────────────────────────────────
@app.route('/api/image/convert', methods=['POST'])
def convert_image():
    """Convert image to different format"""
    try:
        if 'image' not in request.files:
            return jsonify({'success': False, 'error': 'No image file provided'}), 400
        
        image_file = request.files['image']
        format = request.form.get('format', 'png')
        
        # Save uploaded image temporarily
        temp_dir = os.path.join(os.getcwd(), DOWNLOAD_FOLDER, 'temp')
        os.makedirs(temp_dir, exist_ok=True)
        
        temp_input = os.path.join(temp_dir, f"input_{uuid.uuid4()}")
        image_file.save(temp_input)
        
        # Open and convert image
        from PIL import Image
        img = Image.open(temp_input)
        
        # Convert RGBA to RGB for formats that don't support transparency
        if format in ['jpg', 'jpeg', 'bmp'] and img.mode == 'RGBA':
            img = img.convert('RGB')
        
        # Save in new format
        output_path = os.path.join(temp_dir, f"converted_{uuid.uuid4()}.{format}")
        img.save(output_path, format.upper())
        
        # Clean up input
        try:
            os.remove(temp_input)
        except:
            pass
        
        # Move to downloads folder
        downloads_dir = os.path.join(os.getcwd(), DOWNLOAD_FOLDER)
        final_output = os.path.join(downloads_dir, f"converted_{uuid.uuid4()}.{format}")
        os.rename(output_path, final_output)
        
        return jsonify({
            'success': True,
            'output_path': final_output
        })
    except Exception as e:
        print(f"Error converting image: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/image/resize', methods=['POST'])
def resize_image():
    """Resize image to custom dimensions"""
    try:
        if 'image' not in request.files:
            return jsonify({'success': False, 'error': 'No image file provided'}), 400
        
        image_file = request.files['image']
        width = int(request.form.get('width', 800))
        height = int(request.form.get('height', 600))
        maintain_aspect = request.form.get('maintainAspect', 'true').lower() == 'true'
        
        # Save uploaded image temporarily
        temp_dir = os.path.join(os.getcwd(), DOWNLOAD_FOLDER, 'temp')
        os.makedirs(temp_dir, exist_ok=True)
        
        temp_input = os.path.join(temp_dir, f"input_{uuid.uuid4()}")
        image_file.save(temp_input)
        
        # Open and resize image
        from PIL import Image
        img = Image.open(temp_input)
        
        if maintain_aspect:
            img.thumbnail((width, height), Image.Resampling.LANCZOS)
        else:
            img = img.resize((width, height), Image.Resampling.LANCZOS)
        
        # Save resized image
        output_path = os.path.join(temp_dir, f"resized_{uuid.uuid4()}.png")
        img.save(output_path, 'PNG')
        
        # Clean up input
        try:
            os.remove(temp_input)
        except:
            pass
        
        # Move to downloads folder
        downloads_dir = os.path.join(os.getcwd(), DOWNLOAD_FOLDER)
        final_output = os.path.join(downloads_dir, f"resized_{uuid.uuid4()}.png")
        os.rename(output_path, final_output)
        
        return jsonify({
            'success': True,
            'output_path': final_output
        })
    except Exception as e:
        print(f"Error resizing image: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/image/compress', methods=['POST'])
def compress_image():
    """Compress image to reduce file size"""
    try:
        if 'image' not in request.files:
            return jsonify({'success': False, 'error': 'No image file provided'}), 400
        
        image_file = request.files['image']
        quality = int(request.form.get('quality', 80))
        
        # Get original size
        original_size = len(image_file.read())
        image_file.seek(0)
        
        # Save uploaded image temporarily
        temp_dir = os.path.join(os.getcwd(), DOWNLOAD_FOLDER, 'temp')
        os.makedirs(temp_dir, exist_ok=True)
        
        temp_input = os.path.join(temp_dir, f"input_{uuid.uuid4()}")
        image_file.save(temp_input)
        
        # Open and compress image
        from PIL import Image
        img = Image.open(temp_input)
        
        # Save compressed image
        output_path = os.path.join(temp_dir, f"compressed_{uuid.uuid4()}.jpg")
        img.save(output_path, 'JPEG', quality=quality, optimize=True)
        
        # Get compressed size
        compressed_size = os.path.getsize(output_path)
        saved_percent = round((1 - compressed_size / original_size) * 100, 2)
        
        # Clean up input
        try:
            os.remove(temp_input)
        except:
            pass
        
        # Move to downloads folder
        downloads_dir = os.path.join(os.getcwd(), DOWNLOAD_FOLDER)
        final_output = os.path.join(downloads_dir, f"compressed_{uuid.uuid4()}.jpg")
        os.rename(output_path, final_output)
        
        return jsonify({
            'success': True,
            'output_path': final_output,
            'original_size': f"{original_size / 1024:.2f} KB",
            'compressed_size': f"{compressed_size / 1024:.2f} KB",
            'saved_percent': f"{saved_percent}%"
        })
    except Exception as e:
        print(f"Error compressing image: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/image/crop', methods=['POST'])
def crop_image():
    """Crop image to specific area"""
    try:
        if 'image' not in request.files:
            return jsonify({'success': False, 'error': 'No image file provided'}), 400
        
        image_file = request.files['image']
        x = int(request.form.get('x', 0))
        y = int(request.form.get('y', 0))
        width = int(request.form.get('width', 200))
        height = int(request.form.get('height', 200))
        
        # Save uploaded image temporarily
        temp_dir = os.path.join(os.getcwd(), DOWNLOAD_FOLDER, 'temp')
        os.makedirs(temp_dir, exist_ok=True)
        
        temp_input = os.path.join(temp_dir, f"input_{uuid.uuid4()}")
        image_file.save(temp_input)
        
        # Open and crop image
        from PIL import Image
        img = Image.open(temp_input)
        
        # Validate crop area
        img_width, img_height = img.size
        if x + width > img_width or y + height > img_height:
            return jsonify({'success': False, 'error': 'Crop area exceeds image dimensions'}), 400
        
        # Crop image
        cropped = img.crop((x, y, x + width, y + height))
        
        # Save cropped image
        output_path = os.path.join(temp_dir, f"cropped_{uuid.uuid4()}.png")
        cropped.save(output_path, 'PNG')
        
        # Clean up input
        try:
            os.remove(temp_input)
        except:
            pass
        
        # Move to downloads folder
        downloads_dir = os.path.join(os.getcwd(), DOWNLOAD_FOLDER)
        final_output = os.path.join(downloads_dir, f"cropped_{uuid.uuid4()}.png")
        os.rename(output_path, final_output)
        
        return jsonify({
            'success': True,
            'output_path': final_output
        })
    except Exception as e:
        print(f"Error cropping image: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/download-image')
def download_image():
    """Download processed image"""
    try:
        path = request.args.get('path', '')
        if not path or not os.path.exists(path):
            return jsonify({'error': 'File not found'}), 404
        
        return send_file(path, as_attachment=True)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/cloud/delete/<download_id>', methods=['POST'])
def delete_from_cloud(download_id):
    """Delete a video from cloud storage"""
    try:
        # Reload history from file to get the latest status
        global download_history
        download_history.clear()
        download_history.extend(load_history())
        
        # Find history entry
        history_entry = None
        for entry in download_history:
            if entry['id'] == download_id:
                history_entry = entry
                break
        
        if not history_entry:
            return jsonify({'error': 'History entry not found'}), 404
        
        if history_entry.get('cloud_status') != 'uploaded':
            return jsonify({'error': 'Video not uploaded to cloud'}), 400
        
        # Get settings from request
        data = request.json or {}
        b2_settings = data.get('b2_settings', {})
        
        # Use provided settings or fall back to environment
        bucket_name = b2_settings.get('bucket_name') or B2_BUCKET_NAME
        endpoint_url = b2_settings.get('endpoint_url') or B2_ENDPOINT_URL
        key_id = b2_settings.get('key_id') or B2_KEY_ID
        application_key = b2_settings.get('application_key') or B2_APPLICATION_KEY
        
        if not all([bucket_name, endpoint_url, key_id, application_key]):
            return jsonify({'error': 'B2 settings not configured'}), 400
        
        # Create S3 client
        s3 = boto3.client(
            's3',
            endpoint_url=endpoint_url,
            aws_access_key_id=key_id,
            aws_secret_access_key=application_key,
            config=Config(signature_version='s3v4')
        )
        
        # Delete from B2
        file_key = history_entry.get('cloud_file_key')
        if not file_key:
            return jsonify({'error': 'Cloud file key not found'}), 400
        
        print(f"Deleting from B2: bucket={bucket_name}, key={file_key}")
        s3.delete_object(Bucket=bucket_name, Key=file_key)
        print(f"Successfully deleted from B2: {file_key}")
        
        # Update history entry
        history_entry['cloud_status'] = 'not_uploaded'
        history_entry['cloud_progress'] = 0
        history_entry['cloud_file_key'] = None
        history_entry['cloud_signed_url'] = None
        
        # Save to file directly
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            file_history = json.load(f)
        
        for entry in file_history:
            if entry['id'] == download_id:
                entry['cloud_status'] = 'not_uploaded'
                entry['cloud_progress'] = 0
                entry['cloud_file_key'] = None
                entry['cloud_signed_url'] = None
                break
        
        temp_file = HISTORY_FILE + '.tmp'
        with open(temp_file, 'w', encoding='utf-8') as f:
            json.dump(file_history, f, ensure_ascii=False, indent=2)
        import shutil
        shutil.move(temp_file, HISTORY_FILE)
        
        print(f"History updated after cloud deletion")
        
        return jsonify({'success': True, 'message': 'Cloud copy deleted successfully'})
    except Exception as e:
        print(f"Error deleting from cloud: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/cloud/bulk-delete', methods=['POST'])
def bulk_delete_cloud_files():
    """Delete multiple files from cloud storage"""
    try:
        data = request.json
        file_keys = data.get('file_keys', [])
        b2_settings = data.get('b2_settings', {})
        
        if not file_keys:
            return jsonify({'error': 'No file keys provided'}), 400
        
        # Use provided settings or fall back to environment
        bucket_name = b2_settings.get('bucket_name') or B2_BUCKET_NAME
        endpoint_url = b2_settings.get('endpoint_url') or B2_ENDPOINT_URL
        key_id = b2_settings.get('key_id') or B2_KEY_ID
        application_key = b2_settings.get('application_key') or B2_APPLICATION_KEY
        
        if not all([bucket_name, endpoint_url, key_id, application_key]):
            return jsonify({'error': 'B2 settings not configured'}), 400
        
        # Create S3 client
        s3 = boto3.client(
            's3',
            endpoint_url=endpoint_url,
            aws_access_key_id=key_id,
            aws_secret_access_key=application_key,
            config=Config(signature_version='s3v4')
        )
        
        deleted_count = 0
        errors = []
        
        for file_key in file_keys:
            try:
                print(f"Deleting from B2: bucket={bucket_name}, key={file_key}")
                s3.delete_object(Bucket=bucket_name, Key=file_key)
                deleted_count += 1
                print(f"Successfully deleted from B2: {file_key}")
            except Exception as e:
                print(f"Error deleting {file_key}: {e}")
                errors.append({'file_key': file_key, 'error': str(e)})
        
        # Update history entries for deleted files
        global download_history
        download_history.clear()
        download_history.extend(load_history())
        
        updated_history = False
        for entry in download_history:
            if entry.get('cloud_file_key') in file_keys:
                entry['cloud_status'] = 'not_uploaded'
                entry['cloud_progress'] = 0
                entry['cloud_file_key'] = None
                entry['cloud_signed_url'] = None
                updated_history = True
        
        if updated_history:
            save_history(download_history)
        
        return jsonify({
            'success': True,
            'deleted_count': deleted_count,
            'errors': errors
        })
    except Exception as e:
        print(f"Error in bulk delete: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/cloud/file/delete', methods=['POST'])
def delete_cloud_file():
    """Delete a file directly from B2 by key"""
    try:
        data = request.json or {}
        file_key = data.get('file_key')
        b2_settings = data.get('b2_settings', {})
        
        if not file_key:
            return jsonify({'error': 'File key is required'}), 400
        
        # Use provided settings or fall back to environment
        bucket_name = b2_settings.get('bucket_name') or B2_BUCKET_NAME
        endpoint_url = b2_settings.get('endpoint_url') or B2_ENDPOINT_URL
        key_id = b2_settings.get('key_id') or B2_KEY_ID
        application_key = b2_settings.get('application_key') or B2_APPLICATION_KEY
        
        if not all([bucket_name, endpoint_url, key_id, application_key]):
            return jsonify({'error': 'B2 settings not configured'}), 400
        
        # Create S3 client
        s3 = boto3.client(
            's3',
            endpoint_url=endpoint_url,
            aws_access_key_id=key_id,
            aws_secret_access_key=application_key,
            config=Config(signature_version='s3v4')
        )
        
        # Delete from B2
        print(f"Deleting from B2: bucket={bucket_name}, key={file_key}")
        s3.delete_object(Bucket=bucket_name, Key=file_key)
        print(f"Successfully deleted from B2: {file_key}")
        
        # Try to update history if this file is linked to a download
        download_id = data.get('download_id')
        if download_id:
            global download_history
            download_history.clear()
            download_history.extend(load_history())
            
            for entry in download_history:
                if entry['id'] == download_id and entry.get('cloud_file_key') == file_key:
                    entry['cloud_status'] = 'not_uploaded'
                    entry['cloud_progress'] = 0
                    entry['cloud_file_key'] = None
                    entry['cloud_signed_url'] = None
                    break
            
            # Save to file
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                file_history = json.load(f)
            
            for entry in file_history:
                if entry['id'] == download_id and entry.get('cloud_file_key') == file_key:
                    entry['cloud_status'] = 'not_uploaded'
                    entry['cloud_progress'] = 0
                    entry['cloud_file_key'] = None
                    entry['cloud_signed_url'] = None
                    break
            
            temp_file = HISTORY_FILE + '.tmp'
            with open(temp_file, 'w', encoding='utf-8') as f:
                json.dump(file_history, f, ensure_ascii=False, indent=2)
            import shutil
            shutil.move(temp_file, HISTORY_FILE)
        
        return jsonify({'success': True, 'message': 'File deleted successfully'})
    except Exception as e:
        print(f"Error deleting cloud file: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/cloud/bulk-upload', methods=['POST'])
def bulk_upload_to_cloud():
    """Bulk upload files to B2"""
    try:
        data = request.json or {}
        files_data = data.get('files', [])
        b2_settings = data.get('b2_settings', {})
        send_discord = data.get('send_discord', False)
        
        if not files_data:
            return jsonify({'error': 'No files provided'}), 400
        
        # Use provided settings or fall back to environment
        bucket_name = b2_settings.get('bucket_name') or B2_BUCKET_NAME
        endpoint_url = b2_settings.get('endpoint_url') or B2_ENDPOINT_URL
        key_id = b2_settings.get('key_id') or B2_KEY_ID
        application_key = b2_settings.get('application_key') or B2_APPLICATION_KEY
        discord_webhook = b2_settings.get('discord_webhook') or DISCORD_WEBHOOK_URL
        
        if not all([bucket_name, endpoint_url, key_id, application_key]):
            return jsonify({'error': 'B2 settings not configured'}), 400
        
        # Create S3 client
        s3 = boto3.client(
            's3',
            endpoint_url=endpoint_url,
            aws_access_key_id=key_id,
            aws_secret_access_key=application_key,
            config=Config(signature_version='s3v4')
        )
        
        uploaded_files = []
        errors = []
        
        for file_info in files_data:
            try:
                filename = file_info.get('filename')
                file_data = file_info.get('data')
                file_type = file_info.get('type', 'unknown')
                
                if not filename or not file_data:
                    errors.append({'filename': filename or 'unknown', 'error': 'Missing filename or data'})
                    continue
                
                # Decode base64 data
                import base64
                file_bytes = base64.b64decode(file_data)
                
                # Generate unique key
                import uuid
                unique_id = str(uuid.uuid4())[:8]
                file_key = f"bulk/{unique_id}/{filename}"
                
                # Upload to B2
                s3.put_object(
                    Bucket=bucket_name,
                    Key=file_key,
                    Body=file_bytes,
                    ContentType=file_type
                )
                
                # Generate signed URL
                signed_url = s3.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': bucket_name, 'Key': file_key},
                    ExpiresIn=604800
                )
                
                uploaded_files.append({
                    'filename': filename,
                    'key': file_key,
                    'size': len(file_bytes),
                    'size_mb': round(len(file_bytes) / (1024 * 1024), 2),
                    'url': signed_url,
                    'type': file_type
                })
                
                print(f"Successfully uploaded: {filename}")
                
            except Exception as e:
                print(f"Error uploading {file_info.get('filename', 'unknown')}: {e}")
                errors.append({'filename': file_info.get('filename', 'unknown'), 'error': str(e)})
        
        # Send Discord webhook if enabled
        if send_discord and discord_webhook and uploaded_files:
            try:
                # Find first image for main image
                image_url = None
                for f in uploaded_files:
                    if f['type'] and f['type'].startswith('image/'):
                        image_url = f['url']
                        break
                
                # Count images
                image_count = sum(1 for f in uploaded_files if f['type'] and f['type'].startswith('image/'))
                
                embed_data = {
                    'title': f"📦 Bulk Upload Complete",
                    'description': f"Successfully uploaded {len(uploaded_files)} files to B2 ({image_count} images)",
                    'color': 0x00ff00,
                    'fields': [
                        {'name': '📁 Files Uploaded', 'value': str(len(uploaded_files)), 'inline': True},
                        {'name': '❌ Errors', 'value': str(len(errors)), 'inline': True},
                    ],
                    'timestamp': datetime.now().isoformat()
                }
                
                # Add main image if available (large image at bottom of embed)
                if image_url:
                    embed_data['image'] = {'url': image_url}
                
                # Add file list with URLs and types
                # Discord has limits: 25 fields per embed, 1024 chars per field value
                # We'll show all files by splitting into multiple fields if needed
                file_list = []
                for f in uploaded_files:
                    file_type = f['type'] or 'unknown'
                    # For images, show the image directly in Discord
                    if file_type.startswith('image/'):
                        file_list.append(f"• **{f['filename']}** ({f['size_mb']} MB)\n  Type: {file_type}\n  [View Image]({f['url']})")
                    else:
                        file_list.append(f"• **{f['filename']}** ({f['size_mb']} MB)\n  Type: {file_type}\n  [Download Link]({f['url']})")
                
                # Split file list into chunks that fit Discord's limits
                # Max 25 fields per embed, max 1024 chars per field value
                max_field_length = 1000  # Leave buffer
                max_fields = 25
                current_chunk = []
                current_length = 0
                field_count = 0
                chunk_number = 1
                files_shown_count = 0
                
                for file_entry in file_list:
                    entry_length = len(file_entry)
                    # Check if adding this entry would exceed field length limit
                    if current_length + entry_length + 2 > max_field_length:
                        if current_chunk:
                            embed_data['fields'].append({
                                'name': f'📋 Files (Part {chunk_number})',
                                'value': '\n'.join(current_chunk),
                                'inline': False
                            })
                            field_count += 1
                            chunk_number += 1
                            files_shown_count += len(current_chunk)
                            current_chunk = []
                            current_length = 0
                    
                    # Check if we've reached max fields (25) - reserve 2 for summary fields
                    if field_count >= max_fields - 2:
                        break
                    
                    current_chunk.append(file_entry)
                    current_length += entry_length + 2  # +2 for newline
                
                # Add remaining files if we haven't hit the field limit
                if current_chunk and field_count < max_fields - 2:
                    embed_data['fields'].append({
                        'name': f'📋 Files (Part {chunk_number})',
                        'value': '\n'.join(current_chunk),
                        'inline': False
                    })
                    field_count += 1
                    files_shown_count += len(current_chunk)
                
                # If we couldn't show all files, add a note
                if files_shown_count < len(file_list):
                    remaining = len(file_list) - files_shown_count
                    if remaining > 0:
                        embed_data['fields'].append({
                            'name': '📊 Summary',
                            'value': f'And {remaining} more files not shown due to Discord limits.',
                            'inline': False
                        })
                
                # Debug: print embed data size
                print(f"Discord embed: {len(embed_data['fields'])} fields, total files: {len(uploaded_files)}, shown: {files_shown_count}")
                
                response = requests.post(discord_webhook, json={'embeds': [embed_data]})
                print(f"Discord webhook response: {response.status_code}")
                if response.status_code != 204:
                    print(f"Discord webhook error: {response.text}")
                else:
                    print("Discord webhook sent for bulk upload")
            except Exception as e:
                print(f"Error sending Discord webhook: {e}")
                import traceback
                traceback.print_exc()
        
        return jsonify({
            'success': True,
            'uploaded': uploaded_files,
            'errors': errors,
            'total_uploaded': len(uploaded_files),
            'total_errors': len(errors)
        })
    except Exception as e:
        print(f"Error in bulk upload: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ────────────────────────────────────────────────────────────
#  Spotify API Endpoints
# ────────────────────────────────────────────────────────────

@app.route('/api/spotify/play', methods=['POST'])
def play_spotify():
    """Play a Spotify track, playlist, or album"""
    try:
        data = request.json
        url_or_uri = data.get('url_or_uri')
        
        if not url_or_uri:
            return jsonify({'error': 'URL or URI is required'}), 400
        
        spotify_service = get_spotify_service()
        result = spotify_service.play_spotify_playlist(url_or_uri)
        
        return jsonify(result)
    except Exception as e:
        print(f"Error playing Spotify: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/spotify/download', methods=['POST'])
def download_spotify():
    """Download a Spotify playlist or track using spotDL"""
    try:
        data = request.json
        url = data.get('url')
        output_dir = data.get('output_dir')
        
        if not url:
            return jsonify({'error': 'URL is required'}), 400
        
        if not output_dir:
            return jsonify({'error': 'Output directory is required'}), 400
        
        # Validate Spotify URL
        if not ('spotify.com' in url or url.startswith('spotify:')):
            return jsonify({
                'status': 'error',
                'message': 'Invalid Spotify URL. Please use a Spotify track, playlist, or album URL (e.g., https://open.spotify.com/track/...)'
            }), 400
        
        # Check if it's an authorization URL (user mistake)
        if 'accounts.spotify.com/authorize' in url:
            return jsonify({
                'status': 'error',
                'message': 'This is an authorization URL. Please paste a Spotify track, playlist, or album URL instead.'
            }), 400
        
        spotify_service = get_spotify_service()
        result = spotify_service.download_spotify_playlist(url, output_dir)
        
        # If successful, create a download ID for global progress tracking
        if result.get('status') == 'success':
            download_id = str(uuid.uuid4())
            youtube_url_container = result.get('youtube_url', {'url': None})
            
            # Save to download_status for tracking
            download_status[download_id] = {
                'status': 'downloading',
                'progress': 0,
                'title': 'Spotify Download',
                'speed': '',
                'size': '',
                'eta': 'Unknown',
                'url': url,
                'youtube_url': youtube_url_container,
                'output_dir': output_dir
            }
            
            # Start a background thread to monitor the process and handle metadata
            def monitor_spotify_download():
                import time
                process_id = result.get('process_id')
                youtube_url = None
                
                if process_id:
                    # Monitor the process
                    import psutil
                    try:
                        process = psutil.Process(process_id)
                        while process.is_running():
                            time.sleep(1)
                            # Check if YouTube URL was found
                            if youtube_url_container['url'] and youtube_url is None:
                                youtube_url = youtube_url_container['url']
                                print(f"Spotify download found YouTube URL: {youtube_url}")
                                # Fetch metadata using yt-dlp
                                try:
                                    ydl_opts = {'quiet': True, 'no_warnings': True}
                                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                                        info = ydl.extract_info(youtube_url, download=False)
                                        
                                        # Update download status with metadata
                                        if download_id in download_status:
                                            download_status[download_id]['title'] = info.get('title', 'Spotify Download')
                                            download_status[download_id]['thumbnail'] = info.get('thumbnail', '')
                                            download_status[download_id]['uploader'] = info.get('uploader', 'Unknown')
                                            download_status[download_id]['duration'] = format_duration(info.get('duration', 0))
                                            
                                            # Download thumbnail
                                            thumbnail = info.get('thumbnail', '')
                                            if thumbnail:
                                                try:
                                                    import requests
                                                    response = requests.get(thumbnail, timeout=10)
                                                    if response.status_code == 200:
                                                        title = info.get('title', 'Unknown')
                                                        sanitized_title = sanitize_filename(title)
                                                        thumbnail_filename = f"{sanitized_title}.jpg"
                                                        thumbnail_path = os.path.join(output_dir, thumbnail_filename)
                                                        with open(thumbnail_path, 'wb') as f:
                                                            f.write(response.content)
                                                        print(f"Saved Spotify thumbnail to: {thumbnail_path}")
                                                        download_status[download_id]['thumbnail_filename'] = thumbnail_filename
                                                        download_status[download_id]['sanitized_title'] = sanitized_title
                                                except Exception as e:
                                                    print(f"Error downloading Spotify thumbnail: {e}")
                                except Exception as e:
                                    print(f"Error fetching Spotify metadata: {e}")
                            
                            # Update progress (mock since spotDL doesn't provide progress)
                            if download_id in download_status:
                                current_progress = download_status[download_id]['progress']
                                if current_progress < 90:
                                    download_status[download_id]['progress'] = current_progress + 1
                    except:
                        pass
                
                # Mark as complete and save metadata
                if download_id in download_status:
                    download_status[download_id]['status'] = 'completed'
                    download_status[download_id]['progress'] = 100
                    
                    # Save to player_metadata.json
                    try:
                        sanitized_title = download_status[download_id].get('sanitized_title', sanitize_filename(download_status[download_id].get('title', 'Unknown')))
                        metadata = {
                            'title': download_status[download_id].get('title', 'Unknown'),
                            'url': youtube_url or url,
                            'platform': 'YouTube (from Spotify)',
                            'thumbnail': download_status[download_id].get('thumbnail', ''),
                            'thumbnail_filename': download_status[download_id].get('thumbnail_filename', ''),
                            'uploader': download_status[download_id].get('uploader', 'Unknown'),
                            'resolution': 'Unknown',
                            'filename': f"{sanitized_title}.mp3",
                            'duration': download_status[download_id].get('duration', '0:00'),
                            'filesize': 0,
                            'timestamp': datetime.now().isoformat(),
                            'download_id': download_id,
                            'spotify_url': url
                        }
                        
                        # Save to player_metadata.json
                        player_metadata = load_player_metadata()
                        player_metadata.append(metadata)
                        save_player_metadata(player_metadata)
                        print(f"Saved Spotify metadata to player_metadata.json")
                        
                        # Save to download_history.json
                        global download_history
                        download_history.insert(0, metadata)
                        save_history(download_history)
                        print(f"Saved Spotify metadata to download_history.json")
                        
                    except Exception as e:
                        print(f"Error saving Spotify metadata: {e}")
            
            import threading
            monitor_thread = threading.Thread(target=monitor_spotify_download, daemon=True)
            monitor_thread.start()
            
            result['download_id'] = download_id
        
        return jsonify(result)
    except Exception as e:
        print(f"Error downloading Spotify: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/spotify/credentials', methods=['POST'])
def save_spotify_credentials():
    """Save Spotify credentials to .env file"""
    try:
        data = request.json
        client_id = data.get('client_id')
        client_secret = data.get('client_secret')
        redirect_uri = data.get('redirect_uri', 'http://localhost:8888/callback')
        
        if not client_id or not client_secret:
            return jsonify({'error': 'Client ID and Client Secret are required'}), 400
        
        # Read existing .env file
        env_path = '.env'
        env_vars = {}
        
        if os.path.exists(env_path):
            with open(env_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        env_vars[key] = value
        
        # Update Spotify credentials
        env_vars['SPOTIFY_CLIENT_ID'] = client_id
        env_vars['SPOTIFY_CLIENT_SECRET'] = client_secret
        env_vars['SPOTIFY_REDIRECT_URI'] = redirect_uri
        
        # Write back to .env file
        with open(env_path, 'w') as f:
            for key, value in env_vars.items():
                f.write(f"{key}={value}\n")
        
        # Reload credentials in service
        reload_credentials()
        
        return jsonify({
            'status': 'success',
            'message': 'Spotify credentials saved successfully'
        })
    except Exception as e:
        print(f"Error saving Spotify credentials: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/spotify/credentials', methods=['GET'])
def get_spotify_credentials():
    """Get current Spotify credentials (without secret)"""
    try:
        load_dotenv()
        client_id = os.getenv('SPOTIFY_CLIENT_ID')
        redirect_uri = os.getenv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:8888/callback')
        
        return jsonify({
            'status': 'success',
            'client_id': client_id,
            'redirect_uri': redirect_uri,
            'has_credentials': bool(client_id)
        })
    except Exception as e:
        print(f"Error getting Spotify credentials: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

if __name__ == '__main__':
    # Disable debug mode for better performance
    app.run(debug=True, host='0.0.0.0', port=5000, threaded=True)

