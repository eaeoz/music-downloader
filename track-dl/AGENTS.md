# AGENTS.md

Project: Node.js CLI tool to search YouTube and download music with auto metadata.

## Setup

- Install: `npm install`
- yt-dlp.exe stored locally (do not delete)
- FFmpeg installed automatically via ffmpeg-static

## Run

```bash
node index.js song name
# Example: node index.js god is a dj
```

- Output: MP3 saved as `{artist} - {title}.mp3`

## Options

| Option | Description |
|--------|-------------|
| `-v, --version` | Show version |
| `-u, --update` | Update yt-dlp.exe |

## How It Works

1. Searches YouTube with query (6 results)
2. Fetches metadata from Deezer -> iTunes (artist, title, album, year, genre, cover)
3. Manually selects the YouTube source, metadata and album cover
4. Selects a source audio bitrate (highest supported by default) and target MP3 bitrate (192 by default)
5. Downloads audio from the chosen source format
6. Embeds metadata + album cover into MP3 at the target bitrate

## Manual Selection (default)

The manual flow always runs (no `-m` flag needed; `-m` is still accepted for compatibility).
Each step shows 6 options:
1. Select a YouTube source
2. Select metadata (artist, title, album, year, genre) from Deezer/iTunes
3. Select an album cover
4. Select a source audio bitrate (from the YouTube video's available formats; codecs without a
   numeric bitrate fall back to a default for that codec, e.g. Opus = 128 kbps)
5. Select a target MP3 bitrate (64, 128, 192, 256, 320; default 192)
6. Downloads audio and embeds the chosen metadata + cover

## Characters & Shell Safety

- Subprocess calls (yt-dlp, ffmpeg) use `spawn` with argument arrays, so queries may contain
  Turkish, English, Arabic, Chinese, Japanese and any other characters without breaking the shell.
- Only Windows-invalid filename characters (`< > : " \ / | ? *`) plus `` $ `` and backtick are
  removed from the output file name.

## APIs Used

- **Deezer**: Primary - artist, title, album, year, genre, cover
- **iTunes**: Backup - same fields