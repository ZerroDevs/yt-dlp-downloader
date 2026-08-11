"""
Spotify Service Module
Handles Spotify playback and download functionality using spotipy and spotDL
"""

import os
import subprocess
import re
import json
import uuid
from datetime import datetime
from typing import Dict, Optional
from dotenv import load_dotenv
import yt_dlp

try:
    import spotipy
    from spotipy.oauth2 import SpotifyOAuth
    from spotipy.exceptions import SpotifyException
except ImportError:
    spotipy = None
    SpotifyOAuth = None
    SpotifyException = Exception


class SpotifyService:
    """Service class for Spotify operations"""
    
    def __init__(self):
        """Initialize Spotify service with credentials from .env"""
        self.client_id = None
        self.client_secret = None
        self.redirect_uri = None
        self.sp = None
        self._load_credentials()
    
    def _load_credentials(self):
        """Load Spotify credentials from .env file"""
        load_dotenv(override=True)
        
        self.client_id = os.getenv('SPOTIFY_CLIENT_ID')
        self.client_secret = os.getenv('SPOTIFY_CLIENT_SECRET')
        self.redirect_uri = os.getenv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:8888/callback')
        
        if not self.client_id or not self.client_secret:
            print("Warning: Spotify credentials not found in environment variables")
    
    def _get_spotify_client(self) -> Optional[spotipy.Spotify]:
        """Get or create Spotify client"""
        if spotipy is None:
            return None
        
        if self.sp is None and self.client_id and self.client_secret:
            try:
                scope = "user-read-playback-state,user-modify-playback-state,user-read-currently-playing"
                # Ensure redirect_uri has full URL format
                redirect_uri = self.redirect_uri
                if not redirect_uri.startswith('http://') and not redirect_uri.startswith('https://'):
                    redirect_uri = f'http://{redirect_uri}'
                
                print(f"Using Spotify redirect URI: {redirect_uri}")
                
                auth_manager = SpotifyOAuth(
                    client_id=self.client_id,
                    client_secret=self.client_secret,
                    redirect_uri=redirect_uri,
                    scope=scope,
                    open_browser=False,
                    show_dialog=True
                )
                self.sp = spotipy.Spotify(auth_manager=auth_manager)
            except Exception as e:
                print(f"Error creating Spotify client: {e}")
                return None
        
        return self.sp
    
    def _parse_spotify_url(self, url_or_uri: str) -> Dict[str, str]:
        """
        Parse Spotify URL or URI to extract type and ID
        Returns: {'type': 'track'|'playlist'|'album', 'id': '...'}
        """
        # Handle URIs (spotify:track:abc123)
        if url_or_uri.startswith('spotify:'):
            parts = url_or_uri.split(':')
            if len(parts) >= 3:
                return {'type': parts[1], 'id': parts[2]}
        
        # Handle URLs (https://open.spotify.com/track/abc123)
        url_pattern = r'https?://open\.spotify\.com/(track|playlist|album)/([a-zA-Z0-9]+)'
        match = re.match(url_pattern, url_or_uri)
        if match:
            return {'type': match.group(1), 'id': match.group(2)}
        
        return {'type': 'unknown', 'id': ''}
    
    def _get_spotify_metadata(self, url: str) -> Dict:
        """
        Fetch metadata from Spotify for a track/playlist/album
        Returns: Dict with title, artist, duration, thumbnail, etc.
        """
        try:
            sp = self._get_spotify_client()
            if not sp:
                return {}
            
            parsed = self._parse_spotify_url(url)
            if parsed['type'] == 'unknown':
                return {}
            
            metadata = {'platform': 'Spotify', 'url': url}
            
            if parsed['type'] == 'track':
                track = sp.track(parsed['id'])
                metadata.update({
                    'link': f"https://open.spotify.com/track/{parsed['id']}",
                    'platform_id': parsed['id'],
                    'type': 'track',
                    'title': track.get('name', 'Unknown'),
                    'uploader': track.get('artists', [{}])[0].get('name', 'Unknown'),
                    'duration': self._ms_to_mmss(track.get('duration_ms', 0)),
                    'thumbnail': track.get('album', {}).get('images', [{}])[0].get('url', ''),
                    'resolution': 'Unknown'
                })
            elif parsed['type'] == 'playlist':
                playlist = sp.playlist(parsed['id'])
                metadata.update({
                    'link': f"https://open.spotify.com/playlist/{parsed['id']}",
                    'platform_id': parsed['id'],
                    'type': 'playlist',
                    'title': playlist.get('name', 'Unknown'),
                    'uploader': playlist.get('owner', {}).get('display_name', 'Unknown'),
                    'duration': 'Playlist',
                    'thumbnail': playlist.get('images', [{}])[0].get('url', ''),
                    'resolution': 'Unknown'
                })
            elif parsed['type'] == 'album':
                album = sp.album(parsed['id'])
                metadata.update({
                    'link': f"https://open.spotify.com/album/{parsed['id']}",
                    'platform_id': parsed['id'],
                    'type': 'album',
                    'title': album.get('name', 'Unknown'),
                    'uploader': album.get('artists', [{}])[0].get('name', 'Unknown'),
                    'duration': 'Album',
                    'thumbnail': album.get('images', [{}])[0].get('url', ''),
                    'resolution': 'Unknown'
                })
            
            return metadata
        except Exception as e:
            print(f"Error fetching Spotify metadata: {e}")
            return {}
    
    def _ms_to_mmss(self, ms: int) -> str:
        """Convert milliseconds to MM:SS format"""
        seconds = ms // 1000
        minutes = seconds // 60
        seconds = seconds % 60
        return f"{minutes}:{seconds:02d}"
    
    def play_spotify_playlist(self, url_or_uri: str) -> Dict:
        """
        Play a Spotify track, playlist, or album
        
        Args:
            url_or_uri: Spotify URL or URI (track, playlist, or album)
        
        Returns:
            Dict with status and message
        """
        if spotipy is None:
            return {
                'status': 'error',
                'message': 'spotipy library not installed. Install with: pip install spotipy'
            }
        
        sp = self._get_spotify_client()
        if sp is None:
            return {
                'status': 'error',
                'message': 'Failed to initialize Spotify client. Check credentials.'
            }
        
        try:
            parsed = self._parse_spotify_url(url_or_uri)
            
            if parsed['type'] == 'unknown':
                return {
                    'status': 'error',
                    'message': 'Invalid Spotify URL or URI format'
                }
            
            # Get available devices
            devices = sp.devices()
            if not devices.get('devices'):
                return {
                    'status': 'error',
                    'message': 'No active Spotify device found. Open Spotify on a device first.'
                }
            
            device_id = devices['devices'][0]['id']
            
            # Start playback based on type
            if parsed['type'] == 'track':
                sp.start_playback(device_id=device_id, uris=[f"spotify:{parsed['type']}:{parsed['id']}"])
                return {
                    'status': 'success',
                    'message': f'Playing track: {parsed["id"]}'
                }
            else:  # playlist or album
                context_uri = f"spotify:{parsed['type']}:{parsed['id']}"
                sp.start_playback(device_id=device_id, context_uri=context_uri)
                return {
                    'status': 'success',
                    'message': f'Playing {parsed["type"]}: {parsed["id"]}'
                }
                
        except SpotifyException as e:
            return {
                'status': 'error',
                'message': f'Spotify API error: {str(e)}'
            }
        except Exception as e:
            return {
                'status': 'error',
                'message': f'Unexpected error: {str(e)}'
            }
    
    def download_spotify_playlist(self, url: str, output_dir: str) -> Dict:
        """
        Download a Spotify playlist or track using spotDL
        
        Args:
            url: Spotify URL or URI
            output_dir: Directory to save downloaded files
        
        Returns:
            Dict with status and message
        """
        try:
            # Validate output directory
            if not os.path.exists(output_dir):
                os.makedirs(output_dir, exist_ok=True)
            
            # Try to find spotdl executable
            import shutil
            spotdl_cmd = shutil.which('spotdl')
            
            if not spotdl_cmd:
                # Try running as Python module
                import sys
                spotdl_cmd = [sys.executable, '-m', 'spotdl']
            else:
                spotdl_cmd = [spotdl_cmd]
            
            # Build spotDL command with verbose output
            cmd = spotdl_cmd + [
                'download',
                url,
                '--output', output_dir,
                '--format', 'mp3',
                '--overwrite', 'skip'  # Skip existing files
            ]
            
            print(f"Running spotDL command: {' '.join(cmd)}")
            
            # Run spotDL as subprocess with real-time output capture
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True
            )
            
            # Start a thread to read output in real-time and capture YouTube URL
            import threading
            youtube_url_container = {'url': None}
            def read_output():
                for line in process.stdout:
                    print(f"spotDL: {line.strip()}")
                    # Extract YouTube URL from spotDL output
                    if 'youtube.com/watch' in line or 'youtu.be/' in line:
                        url_match = re.search(r'https?://(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]+)', line)
                        if url_match and youtube_url_container['url'] is None:
                            youtube_url_container['url'] = url_match.group(0)
                            print(f"Found YouTube URL: {youtube_url_container['url']}")
            
            output_thread = threading.Thread(target=read_output, daemon=True)
            output_thread.start()
            
            return {
                'status': 'success',
                'message': f'Download started for: {url}. Check terminal for progress.',
                'process_id': process.pid,
                'youtube_url': youtube_url_container  # Return container so app.py can monitor it
            }
            
        except Exception as e:
            return {
                'status': 'error',
                'message': f'Download failed: {str(e)}'
            }
    
    def _fetch_and_save_metadata(self, youtube_url: str, output_dir: str, spotify_url: str):
        """Fetch metadata from YouTube using yt-dlp and save to player_metadata.json and history"""
        try:
            # Fetch metadata using yt-dlp
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
            }
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(youtube_url, download=False)
                
                # Extract metadata
                metadata = {
                    'title': info.get('title', 'Unknown'),
                    'url': youtube_url,
                    'platform': 'YouTube (from Spotify)',
                    'thumbnail': info.get('thumbnail', ''),
                    'uploader': info.get('uploader', 'Unknown'),
                    'resolution': 'Unknown',
                    'filename': info.get('title', 'Unknown') + '.mp3',
                    'duration': self._seconds_to_mmss(info.get('duration', 0)),
                    'filesize': 0,
                    'timestamp': datetime.now().isoformat(),
                    'download_id': str(uuid.uuid4()),
                    'spotify_url': spotify_url  # Track original Spotify URL
                }
                
                # Sanitize filename
                metadata['filename'] = self._sanitize_filename(metadata['title']) + '.mp3'
                
                print(f"Fetched metadata: {metadata}")
                
                # Save to player_metadata.json
                self._save_to_player_metadata(metadata)
                
                # Save to download_history.json
                self._save_to_download_history(metadata)
                
        except Exception as e:
            print(f"Error fetching metadata: {e}")
    
    def _save_to_player_metadata(self, metadata: Dict):
        """Save metadata to player_metadata.json"""
        try:
            # Use current working directory to find metadata file
            metadata_file = os.path.join(os.getcwd(), 'player_metadata.json')
            
            # Load existing metadata
            if os.path.exists(metadata_file):
                with open(metadata_file, 'r') as f:
                    player_metadata = json.load(f)
            else:
                player_metadata = []
            
            # Add to metadata list
            player_metadata.append(metadata)
            
            # Save back
            with open(metadata_file, 'w') as f:
                json.dump(player_metadata, f, indent=2)
            
            print(f"Saved metadata to {metadata_file}")
        except Exception as e:
            print(f"Error saving to player_metadata.json: {e}")
    
    def _save_to_download_history(self, metadata: Dict):
        """Save metadata to download_history.json"""
        try:
            # Use current working directory to find history file
            history_file = os.path.join(os.getcwd(), 'download_history.json')
            
            # Load existing history
            if os.path.exists(history_file):
                with open(history_file, 'r') as f:
                    history = json.load(f)
            else:
                history = []
            
            # Create history entry
            history_entry = {
                'title': metadata['title'],
                'url': metadata['url'],
                'platform': metadata['platform'],
                'thumbnail': metadata['thumbnail'],
                'uploader': metadata['uploader'],
                'resolution': metadata['resolution'],
                'filename': metadata['filename'],
                'duration': metadata['duration'],
                'filesize': metadata['filesize'],
                'timestamp': metadata['timestamp'],
                'download_id': metadata['download_id'],
                'spotify_url': metadata.get('spotify_url', '')
            }
            
            # Add to history
            history.insert(0, history_entry)  # Add to beginning
            
            # Save back
            with open(history_file, 'w') as f:
                json.dump(history, f, indent=2)
            
            print(f"Saved to {history_file}")
        except Exception as e:
            print(f"Error saving to download_history.json: {e}")
    
    def _sanitize_filename(self, filename: str) -> str:
        """Sanitize filename for filesystem"""
        # Remove invalid characters
        invalid_chars = '<>:"/\\|?*'
        for char in invalid_chars:
            filename = filename.replace(char, '')
        return filename.strip()
    
    def _seconds_to_mmss(self, seconds: int) -> str:
        """Convert seconds to MM:SS format"""
        if seconds == 0:
            return '0:00'
        minutes = seconds // 60
        secs = seconds % 60
        return f"{minutes}:{secs:02d}"


# Global service instance
_spotify_service = None

def get_spotify_service() -> SpotifyService:
    """Get or create global Spotify service instance"""
    global _spotify_service
    if _spotify_service is None:
        _spotify_service = SpotifyService()
    return _spotify_service

def reload_credentials():
    """Reload Spotify credentials from .env (call after settings update)"""
    global _spotify_service
    _spotify_service = SpotifyService()
