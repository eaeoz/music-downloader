# track-dl

Search and download music from YouTube with automatic metadata and album cover.

## Quick Start

### Run
```bash
node index.js song name
```

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

| Option | Description |
|--------|-------------|
| `-v, --version` | Show version number |
| `-u, --update` | Update yt-dlp.exe |

## Features

- **Free APIs**: Uses Deezer and iTunes APIs (no API keys needed)
- **Manual selection**: Pick the YouTube source, metadata and album cover (6 options per step)
- **Album cover**: Downloads and embeds album art

## How It Works

1. Searches YouTube with your query (6 results)
2. You select a YouTube source
3. Fetches metadata options from Deezer/iTunes (artist, title, album, year, genre, cover)
4. You select metadata and album cover (or skip)
5. Downloads audio automatically
6. Embeds the chosen metadata and album cover into MP3

## Output

- MP3 file saved to project directory
- File naming: `{artist} - {title}.mp3`
- Includes: title, artist, album, year, genre, cover art

## Author

Sedat ERGOZ [@eaeoz](https://github.com/eaeoz)

## License

MIT License