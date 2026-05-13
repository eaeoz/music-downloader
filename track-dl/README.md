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
track-dl --manual god is a dj
track-dl -m umbrella rihanna
```

## Options

| Option | Description |
|--------|-------------|
| `-v, --version` | Show version number |
| `-u, --update` | Update yt-dlp.exe |
| `-m, --manual` | Select song manually from YouTube results |

## Features

- **Free APIs**: Uses Deezer and iTunes APIs (no API keys needed)
- **Auto metadata**: Gets artist, title, album, year, genre automatically
- **Album cover**: Downloads and embeds album art
- **Smart matching**: Matches YouTube results using metadata

## How It Works

1. Searches YouTube with your query
2. Fetches song info from Deezer/iTunes (artist, title, album, year, genre, cover)
3. Finds best YouTube match
4. Downloads audio automatically
5. Embeds metadata and album cover into MP3

## Output

- MP3 file saved to project directory
- File naming: `{artist} - {title}.mp3`
- Includes: title, artist, album, year, genre, cover art

## Author

Sedat ERGOZ [@eaeoz](https://github.com/eaeoz)

## License

MIT License