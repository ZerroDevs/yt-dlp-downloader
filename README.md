# Video Downloader

A modern Python web application that allows you to download videos from multiple platforms (YouTube, TikTok, Instagram) using yt-dlp with a beautiful, responsive interface.

## Features

### Core Functionality
- **Multi-platform support** - Download from YouTube, TikTok, and Instagram
- **Smart platform detection** - Automatically detects video platform from URL
- **Multiple quality options** - Select from various video resolutions
- **Real-time progress tracking** - Live download progress with ETA
- **Queue system** - Download multiple videos simultaneously
- **Download history** - View and re-download past downloads
- **Windows-compatible output** - H.264 codec for maximum compatibility

### Cloud Integration
- **Backblaze B2 storage** - Archive downloads to cloud storage
- **Bulk upload** - Upload multiple files at once
- **File management** - View, download, share, and delete cloud files
- **File type icons** - Visual indicators for video, image, and audio files
- **Storage tracking** - Monitor storage usage with visual progress bars
- **Discord notifications** - Automatic webhook notifications for uploads

### User Interface
- **Modern glass-morphism design** - Beautiful, responsive UI
- **Dark/Light themes** - Toggle between dark and light modes
- **Tabbed settings** - Organized settings with intuitive navigation
- **Custom modals** - Modern dialog system with smooth animations
- **Platform badges** - Visual indicators for video sources in history
- **Keyboard shortcuts** - Quick actions for power users

### Additional Features
- **Filename templates** - Customize download filenames with variables
- **Auto-rename** - Automatically rename duplicate files
- **Auto-fetch** - Automatically fetch video info on paste
- **Cleanup tool** - Remove incomplete .part files
- **Persistent state** - Remember your settings and preferences

## Installation

1. Install Python 3.8 or higher if you don't have it already

2. Install the required dependencies:
```bash
pip install -r requirements.txt
```

## Usage

1. Run the application:
```bash
python app.py
```

2. Open your browser and navigate to: `http://localhost:5000`

## Configuration

### Download Settings
- **Default Quality** - Set preferred video quality
- **Download Folder** - Choose where to save downloads
- **Max Concurrent Downloads** - Control simultaneous downloads (1-5)

### Filename Settings
- **Filename Template** - Use variables like `{title}`, `{quality}`, `{date}`, `{id}`, `{uploader}`
- **Auto-rename** - Automatically rename if file exists

### Interface Settings
- **Auto-fetch on paste** - Automatically fetch video info when pasting URL
- **Download notifications** - Enable desktop notifications
- **Theme** - Choose between Dark, Light, or Auto

### Cloud Settings (Backblaze B2)
- **B2 Bucket Name** - Your Backblaze bucket name
- **B2 Endpoint URL** - Your bucket's endpoint URL
- **B2 Key ID** - Application Key ID
- **B2 Application Key** - Application Key
- **Discord Webhook URL** - Optional Discord webhook for notifications
- **Auto-upload** - Automatically upload to cloud after download
- **Signed URL Expiration** - Set link expiration time (seconds)
- **Storage Limit** - Set your storage quota for tracking

## Supported Platforms

- **YouTube** - Videos, Shorts, and playlists
- **TikTok** - Videos and profile links
- **Instagram** - Reels, posts, and TV videos

## File Format

All videos are downloaded in MP4 format with H.264 codec for maximum compatibility across devices and platforms.

## Keyboard Shortcuts

- `Ctrl+V` - Paste URL from clipboard
- `Enter` - Fetch video info / Start download
- `Esc` - Close modals

## Troubleshooting

### Downloads fail
- Check your internet connection
- Ensure the video URL is valid and public
- Try a different quality option

### Cloud upload fails
- Verify your B2 credentials are correct
- Check your storage limit
- Ensure you have write permissions on the bucket

### Theme not persisting
- Clear browser cache and cookies
- Ensure localStorage is enabled in your browser

## License

This project is for personal use only. Please respect the terms of service of the platforms you download from.

## Requirements

- Python 3.8+
- Flask
- yt-dlp
- FFmpeg (required for video conversion to Windows-compatible MP4 format)
- boto3 (for Backblaze B2 cloud integration)

### Installing FFmpeg on Windows

1. Download FFmpeg from https://ffmpeg.org/download.html
2. Extract the files to a folder (e.g., C:\ffmpeg)
3. Add the FFmpeg bin folder to your system PATH:
   - Right-click "This PC" → Properties → Advanced system settings
   - Click "Environment Variables"
   - Under "System variables", find "Path" and click "Edit"
   - Click "New" and add the path to your FFmpeg bin folder (e.g., C:\ffmpeg\bin)
4. Restart your command prompt/terminal
5. Verify installation by running: `ffmpeg -version`

## Notes

- Downloaded files are stored in the `downloads` folder by default
- The app runs on port 5000 by default
- Make sure you have a stable internet connection for downloading
- Cloud features require a Backblaze B2 account
- Settings are persisted in browser localStorage
