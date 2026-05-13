#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const https = require('https');
const { searchYouTube, downloadYouTubeAudioWithTemp } = require('./lib/youtube');
const { mergeMetadata } = require('./lib/merger');
const { findBestSongMatch } = require('./lib/metadata');

const packageJson = require('./package.json');

async function updateYtDlp() {
  const exePath = path.join(__dirname, 'yt-dlp.exe');
  console.log('Downloading yt-dlp.exe...');

  function download(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (response) => {
        if (response.statusCode === 302 && response.headers.location) {
          download(response.headers.location).then(resolve).catch(reject);
        } else {
          const file = fs.createWriteStream(exePath);
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            console.log('yt-dlp.exe downloaded');
            resolve();
          });
        }
      }).on('error', (err) => {
        fs.unlink(exePath, () => {});
        reject(err);
      });
    });
  }

  await download('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe');
}

async function main() {
  const args = process.argv.slice(2);
  
  if (!args.length) {
    console.log(`track-dl v${packageJson.version}`);
    console.log('Usage: track-dl song name');
    console.log('Example: track-dl god is a dj');
    process.exit(1);
  }

  const firstArg = args[0];
  let manualMode = false;

  if (firstArg === '-v' || firstArg === '--version') {
    console.log(`track-dl v${packageJson.version}`);
    process.exit(0);
  }

  if (firstArg === '-h' || firstArg === '--help') {
    console.log(`track-dl v${packageJson.version}`);
    console.log('');
    console.log('Usage: track-dl song name');
    console.log('Example: track-dl god is a dj');
    console.log('');
    console.log('Options:');
    console.log('  -v, --version  Show version');
    console.log('  -u, --update  Update yt-dlp.exe');
    console.log('  -m, --manual  Select song manually from YouTube results');
    process.exit(0);
  }

  if (firstArg === '-u' || firstArg === '--update') {
    try {
      await updateYtDlp();
      process.exit(0);
    } catch (err) {
      console.error('Failed to update:', err.message);
      process.exit(1);
    }
  }

  if (firstArg === '-m' || firstArg === '--manual') {
    manualMode = true;
    args.shift();
  }

  if (!args.length) {
    console.log(`track-dl v${packageJson.version}`);
    console.log('Usage: track-dl song name');
    console.log('Example: track-dl god is a dj');
    process.exit(1);
  }

  const query = args.join(' ');

  console.log(`\n=== Searching YouTube: "${query}" ===`);
  
  const youtubeResults = await searchYouTube(query, 5);
  
  if (!youtubeResults.length) {
    console.log('No results');
    process.exit(1);
  }

  console.log(`Found ${youtubeResults.length} results`);

  let bestMatch;

  if (manualMode) {
    console.log('\n=== Select a song ===');
    youtubeResults.forEach((video, index) => {
      const duration = video.duration ? ` [${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, '0')}]` : '';
      console.log(`${index + 1}. ${video.title}${duration}`);
      console.log(`   Channel: ${video.uploader}`);
    });

    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const selectedIndex = await new Promise((resolve) => {
      readline.question('\nEnter number (1-' + youtubeResults.length + '): ', (answer) => {
        readline.close();
        resolve(answer);
      });
    });

    const index = parseInt(selectedIndex) - 1;
    if (isNaN(index) || index < 0 || index >= youtubeResults.length) {
      console.log('Invalid selection');
      process.exit(1);
    }

    const selectedYoutube = youtubeResults[index];
    bestMatch = await findBestSongMatch(query, [selectedYoutube]);
    console.log(`\nSelected: ${selectedYoutube.title}`);
  } else {
    bestMatch = await findBestSongMatch(query, youtubeResults);
  }

  const selectedYoutube = bestMatch.video;

  console.log(`\nBest: ${bestMatch.artist} - ${bestMatch.title}`);
  if (bestMatch.album) console.log(`Album: ${bestMatch.album}`);
  if (bestMatch.year) console.log(`Year: ${bestMatch.year}`);
  if (bestMatch.genre) console.log(`Genre: ${bestMatch.genre}`);

  console.log('\n=== Downloading ===');

  const tempAudioPath = await downloadYouTubeAudioWithTemp(selectedYoutube.url);
  
  if (!tempAudioPath) {
    console.log('Download failed');
    process.exit(1);
  }

  console.log('Downloaded');

  const safeArtist = (bestMatch.artist || '').replace(/[<>:"/\\|?*]/g, '').trim();
  const safeTitle = (bestMatch.title || '').replace(/[<>:"/\\|?*]/g, '').trim();
  const outputPath = path.join(process.cwd(), `${safeArtist} - ${safeTitle}.mp3`);

  const metadata = {
    title: bestMatch.title,
    artist: bestMatch.artist,
    album: bestMatch.album || '',
    year: bestMatch.year || '',
    genre: bestMatch.genre || '',
    albumArt: bestMatch.coverUrl || ''
  };

  try {
    await mergeMetadata(tempAudioPath, metadata, outputPath);
    console.log(`\n=== SUCCESS ===`);
    console.log(`File: ${outputPath}`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});