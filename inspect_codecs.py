import yt_dlp
import json

ydl_opts = {'quiet': True, 'no_warnings': True}
# Just use a random popular video
with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info('https://www.youtube.com/watch?v=Xb3Isd-MoIA', download=False)
    
    formats = info.get('formats', [])
    for f in formats:
        h = f.get('height')
        if not h or h < 50:
            continue
        print(f"Height: {h}, vcodec: {f.get('vcodec')}, ext: {f.get('ext')}, format_id: {f.get('format_id')}")
