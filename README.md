# 🚀 Video Downloader & Utility WebApp

![Banner](Logo.webp) <!-- Assuming there is a logo based on directory listing -->

A modern, full-featured Python web application that not only allows you to download videos from multiple platforms (YouTube, TikTok, Instagram, Spotify) using `yt-dlp` and `ffmpeg`, but also includes a robust suite of utility tools for images, videos, and general productivity. All wrapped in a beautiful, responsive, and glass-morphism user interface.

**Created by [ZerroDevs](https://github.com/ZerroDevs)**

---

## ✨ Features

### 🎬 Video Downloading
- **Multi-platform support** - Seamlessly download from YouTube, TikTok, Instagram, and more!
- **Smart platform detection** - Automatically detects the video platform straight from the URL.
- **Multiple quality options** - Select from various video resolutions and audio formats.
- **Real-time progress tracking** - Live download progress with ETA and speed metrics.
- **Windows-compatible output** - Converts to H.264 MP4 format for maximum compatibility.

### 🎵 Media Player & Management
- **Integrated Music Player** - Listen to your downloaded audio or external files directly within the app.
- **Queue System** - Queue multiple downloads and process them simultaneously without freezing the app.
- **Download History** - View, manage, and re-download past media from your comprehensive history tab.

### 🛠️ Utility Tools
A suite of built-in tools to manage your media and productivity:
- **URL Shortener** - Create short, manageable links quickly.
- **QR Generator** - Generate QR codes for any URL or text.
- **Image Converter** - Convert images between different formats seamlessly.
- **Image Resizer** - Scale your images to custom dimensions.
- **Image Compressor** - Reduce image file sizes without sacrificing quality.
- **Image Cropper** - Crop images to focus on the perfect subject.
- **Video Rotator** - Easily rotate incorrectly oriented videos.
- **Video Trimmer** - Cut and trim videos to your desired length.

### ☁️ Cloud Integration
- **Backblaze B2 storage** - Archive your downloads securely to cloud storage.
- **Bulk upload** - Upload multiple files to the cloud at once.
- **File management** - View, download, share, and delete cloud files directly from the UI.
- **File type icons** - Visual indicators for video, image, and audio files.
- **Storage tracking** - Monitor your cloud storage usage with visual progress bars.
- **Discord notifications** - Automatic webhook notifications for successful uploads.

### 🎨 User Interface
- **Modern glass-morphism design** - Beautiful, responsive UI that looks premium.
- **Dark/Light themes** - Toggle between dark and light modes, or sync with your system preferences.
- **Tabbed settings** - Organized settings menu with intuitive navigation.
- **Custom modals** - Modern dialog system with smooth, non-intrusive animations.
- **Platform badges** - Visual indicators for video sources in your download history.
- **Keyboard shortcuts** - Quick actions for power users (e.g., `Ctrl+V` to paste and fetch).

### ⚙️ Additional Features
- **Filename templates** - Customize download filenames with dynamic variables.
- **Auto-rename** - Automatically rename duplicate files to prevent overwriting.
- **Auto-fetch** - Automatically fetch video info immediately upon pasting a URL.
- **Cleanup tool** - Remove incomplete `.part` files easily.
- **Persistent state** - Remember your settings and preferences locally in your browser.

---

## 🛠️ Installation

1. Make sure you have **Python 3.8 or higher** installed on your system.
2. Clone this repository or download the source code.
3. Install the required dependencies:
```bash
pip install -r requirements.txt
```

### FFmpeg Setup (Required for video conversion & utilities)
1. Download FFmpeg from [https://ffmpeg.org/download.html](https://ffmpeg.org/download.html)
2. Extract the files to a folder (e.g., `C:\ffmpeg`)
3. Add the FFmpeg `bin` folder to your system PATH:
   - Right-click "This PC" → Properties → Advanced system settings
   - Click "Environment Variables"
   - Under "System variables", find "Path" and click "Edit"
   - Click "New" and add the path to your FFmpeg `bin` folder (e.g., `C:\ffmpeg\bin`)
4. Restart your command prompt/terminal.
5. Verify installation by running: `ffmpeg -version`

---

## 🚀 Usage

1. Run the application:
```bash
python app.py
```
*(Alternatively, you can run `start.bat` or `start_hidden.vbs` on Windows)*

2. Open your web browser and navigate to:
```
http://localhost:5000
```

---

## ⚙️ Configuration

You can customize the app extensively via the Settings menu in the web UI.

### 📥 Download Settings
- **Default Quality** - Set preferred video quality.
- **Download Folder** - Choose where to save downloads (defaults to `downloads/`).
- **Max Concurrent Downloads** - Control simultaneous downloads (1-5).

### 🏷️ Filename Settings
- **Filename Template** - Use variables like `{title}`, `{quality}`, `{date}`, `{id}`, `{uploader}` to customize output names.
- **Auto-rename** - Automatically rename if a file with the same name already exists.

### 🖥️ Interface Settings
- **Auto-fetch on paste** - Automatically fetch video info when pasting a URL.
- **Download notifications** - Enable desktop notifications when a download completes.
- **Theme** - Choose between Dark, Light, or Auto.

### ☁️ Cloud Settings (Backblaze B2)
- Configure your Backblaze B2 credentials (Bucket Name, Endpoint URL, Key ID, Application Key) to enable cloud features.
- Setup a Discord Webhook URL for upload notifications.

---

## ⌨️ Keyboard Shortcuts

- `Ctrl+V` - Paste URL from clipboard
- `Enter` - Fetch video info / Start download
- `Esc` - Close modals

---

## 🤝 Credits

**Developed by [ZerroDevs](https://github.com/ZerroDevs)**

---

## 📄 License

This project is licensed under a custom **Educational & Personal Use License**. 
- You may use this software for educational and personal purposes.
- You may **NOT** buy, sell, resell, or use this software for any commercial purposes.

See the `LICENSE` file for more details.
