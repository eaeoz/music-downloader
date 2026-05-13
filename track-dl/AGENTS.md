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

1. Searches YouTube with query
2. Fetches metadata from Deezer -> iTunes (artist, title, album, year, genre, cover)
3. Matches best YouTube result
4. Downloads audio automatically
5. Embeds metadata + album cover into MP3

## APIs Used

- **Deezer**: Primary - artist, title, album, year, genre, cover
- **iTunes**: Backup - same fields