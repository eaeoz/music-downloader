# track-dl

Search and download music from YouTube with automatic metadata and album cover.

## Quick Start

### Install globally
```bash
npm install -g track-dl
track-dl song name
```

### Check version
```bash
track-dl --version
```

## Usage

```bash
track-dl song name
```

### Examples

```bash
track-dl shape of you
track-dl umbrella rihanna
```

## Options
| Parameter | Purpose |
|--------|---------|
| `-v, --version` | Show version number |
| `-u, --update` | Update yt-dlp.exe |

### Run
```bash
node index.js song name
```

## Features

- **Free APIs**: Uses Deezer and iTunes APIs (no API keys needed)
- **Manual selection**: Pick the YouTube source, metadata and album cover (6 options per step)
- **Source format selection**: Choose the audio format/bitrate to download from YouTube (default: highest quality)
- **Target format selection**: Choose the output MP3 bitrate (64, 128, 192, 256, 320 kbps; default: 192)
- **Album cover**: Downloads and embeds album art

## How It Works

1. Searches YouTube with your query (6 results)
2. You select a YouTube source
3. Fetches metadata options from Deezer/iTunes (artist, title, album, year, genre, cover)
4. You select metadata and album cover (or skip)
5. Selects a source audio format/bitrate (from the video's available formats; default: highest)
6. Selects a target MP3 bitrate (default: 192 kbps)
7. Downloads audio and embeds the chosen metadata and cover into MP3

## Source & Target Format Selection

During each run you pick two audio formats:

### Source format

After picking the YouTube video, its available audio-only formats are listed (e.g. `128 kbps · Opus · medium`, `160 kbps · AAC · high`). You can:

- Enter the number of the format you want to download, or
- Press `Enter` to use the highest bitrate (default).

Formats with no numeric bitrate fall back to a default for their codec (e.g. Opus = 128 kbps).

### Target MP3 bitrate

The final MP3 is encoded at the bitrate you choose:

| Option | Bitrate |
|--------|---------|
| 1      | 64 kbps |
| 2      | 128 kbps |
| 3      | 192 kbps (default) |
| 4      | 256 kbps |
| 5      | 320 kbps |

## Output

- MP3 file saved to project directory
- File naming: `{artist} - {title}.mp3`
- Includes: title, artist, album, year, genre, cover art

## Author

Sedat ERGOZ [@eaeoz](https://github.com/eaeoz)

## License

MIT License