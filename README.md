# YouTube Video Downloader

A Python web application that allows you to download YouTube videos using yt-dlp with a beautiful, modern interface.

## Features

- Paste any YouTube URL to fetch video information
- Select from multiple video resolutions
- Real-time download progress tracking
- Download multiple videos simultaneously with queue system
- Download history with ability to re-download files
- Windows-compatible MP4 output (H.264 codec)
- Modern, responsive UI with glass-morphism design
- Dark/Light theme support

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

3. Paste a YouTube URL in the input field
4. Click "Fetch Video" to get available formats
5. Select your preferred resolution
6. Click "Download" to start the download
7. View download progress in the "Download Queue" tab
8. Once complete, find your video in the "History" tab with download option

### Tabs

- **Downloader**: Main interface for fetching and downloading videos
- **Download Queue**: Shows currently downloading videos with queue positions (1, 2, 3...)
- **History**: Shows all past downloads with ability to re-download completed files

## Requirements

- Python 3.8+
- Flask
- yt-dlp
- FFmpeg (required for video conversion to Windows-compatible MP4 format)

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

- Downloaded files are stored in the `downloads` folder
- The app runs on port 5000 by default
- Make sure you have a stable internet connection for downloading
