#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const https = require('https');
const readline = require('readline');
const { searchYouTube, downloadYouTubeAudioWithTemp, getAudioFormats } = require('./lib/youtube');
const { mergeMetadata } = require('./lib/merger');
const { fetchSongInfoOptions, fetchCoverOptions, parseYouTubeTitle } = require('./lib/metadata');

const packageJson = require('./package.json');

const MANUAL_LIMIT = 6;
const TARGET_BITRATES = [64, 128, 192, 256, 320];

function sanitizeFilename(name) {
  return (name || '')
    .replace(/[<>:"\/\\|?*$`]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[. ]+$/g, '')
    .trim();
}

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

function formatDuration(duration) {
  if (!duration) return '';
  const m = Math.floor(duration / 60);
  const s = String(duration % 60).padStart(2, '0');
  return ` [${m}:${s}]`;
}

function showList(items, render) {
  items.forEach((item, i) => render(i + 1, item));
}

function createPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const queue = [];
  let currentResolver = null;

  rl.on('line', (line) => {
    if (currentResolver) {
      const resolver = currentResolver;
      currentResolver = null;
      resolver(line);
    } else {
      queue.push(line);
    }
  });

  function question(text) {
    process.stdout.write(text);
    return new Promise((resolve) => {
      if (queue.length) {
        resolve(queue.shift());
      } else {
        currentResolver = resolve;
      }
    });
  }

  return {
    question,
    close: () => rl.close()
  };
}

function promptNumber(prompter, max, allowSkip, defaultValue) {
  const skip = allowSkip ? ', 0 to skip' : '';
  const def = defaultValue ? ` [default ${defaultValue}]` : '';
  return prompter.question(`Enter number (1-${max}${skip}${def}): `).then((answer) => {
    const trimmed = answer.trim();
    if (trimmed === '') {
      return defaultValue || null;
    }
    const num = parseInt(trimmed, 10);
    if (allowSkip && num === 0) {
      return 0;
    }
    if (isNaN(num) || num < 1 || num > max) {
      return null;
    }
    return num;
  });
}

async function manualSelect(query, youtubeResults) {
  const prompter = createPrompter();

  try {
    console.log('\n=== Select a YouTube source ===');
    showList(youtubeResults, (i, v) => {
      console.log(`${i}. ${v.title}${formatDuration(v.duration)}`);
      console.log(`   Channel: ${v.uploader}`);
    });

    const youtubeIndex = await promptNumber(prompter, youtubeResults.length, false);
    if (!youtubeIndex) {
      console.log('Invalid selection');
      process.exit(1);
    }
    const selectedYoutube = youtubeResults[youtubeIndex - 1];
    console.log(`\nSelected: ${selectedYoutube.title}`);

    const parsed = parseYouTubeTitle(selectedYoutube.title);
    const metaQuery = [parsed.artist, parsed.title].filter(Boolean).join(' ') || query;

    console.log('\n=== Fetching metadata options ===');
    const metadataOptions = await fetchSongInfoOptions(metaQuery, MANUAL_LIMIT);
    let metadata;

    if (metadataOptions.length) {
      console.log(`\n=== Select metadata (1-${metadataOptions.length}, 0 to skip) ===`);
      showList(metadataOptions, (i, m) => {
        const album = m.album ? ` [${m.album}]` : '';
        const year = m.year ? ` (${m.year})` : '';
        console.log(`${i}. ${m.artist} - ${m.title}${album}${year} [${m.source}]`);
      });
      const metaIndex = await promptNumber(prompter, metadataOptions.length, true);
      if (metaIndex === null) {
        console.log('Invalid selection');
        process.exit(1);
      }
      if (metaIndex > 0) {
        metadata = metadataOptions[metaIndex - 1];
        console.log(`\nSelected metadata: ${metadata.artist} - ${metadata.title}`);
      } else {
        console.log('\nSkipped metadata, will use YouTube title');
      }
    } else {
      console.log('No metadata found, will use YouTube title');
    }

    let cover = null;
    let coverOptions = [];
    if (metadata) {
      console.log('\n=== Fetching album cover options ===');
      coverOptions = await fetchCoverOptions(metadata, MANUAL_LIMIT);
    }

    if (coverOptions.length) {
      console.log(`\n=== Select album cover (1-${coverOptions.length}, 0 to skip) ===`);
      showList(coverOptions, (i, c) => {
        console.log(`${i}. ${c.label} [${c.source}]`);
        console.log(`   ${c.url}`);
      });
      const coverIndex = await promptNumber(prompter, coverOptions.length, true);
      if (coverIndex === null) {
        console.log('Invalid selection');
        process.exit(1);
      }
      if (coverIndex > 0) {
        cover = coverOptions[coverIndex - 1];
        console.log(`\nSelected cover: ${cover.label}`);
      } else {
        console.log('\nSkipped album cover');
      }
    } else if (metadata) {
      console.log('No cover options found');
    }

    let sourceFormatId = null;
    let sourceBitrate = null;

    console.log('\n=== Fetching available audio formats ===');
    const audioFormats = await getAudioFormats(selectedYoutube.url);

    if (audioFormats.length) {
      const highest = audioFormats.length;
      console.log(`\n=== Select source audio bitrate (1-${highest}, default highest) ===`);
      showList(audioFormats, (i, f) => {
        console.log(`${i}. ${f.label}`);
      });
      const formatIndex = await promptNumber(prompter, highest, false, highest);
      if (!formatIndex) {
        console.log('Invalid selection');
        process.exit(1);
      }
      const selectedFormat = audioFormats[formatIndex - 1];
      sourceFormatId = selectedFormat.format_id;
      sourceBitrate = selectedFormat.bitrate;
      console.log(`Selected source bitrate: ${selectedFormat.label}`);
    } else {
      console.log('No audio format details available, will use best quality source');
    }

    console.log(`\n=== Select target MP3 bitrate (1-${TARGET_BITRATES.length}, default 192) ===`);
    showList(TARGET_BITRATES, (i, b) => {
      console.log(`${i}. ${b} kbps${b === 192 ? ' (default)' : ''}`);
    });
    const targetIndex = await promptNumber(prompter, TARGET_BITRATES.length, false, 3);
    if (!targetIndex) {
      console.log('Invalid selection');
      process.exit(1);
    }
    const targetBitrate = TARGET_BITRATES[targetIndex - 1];
    console.log(`Selected target bitrate: ${targetBitrate} kbps`);

    return {
      index: youtubeIndex - 1,
      reason: 'Manual selection',
      artist: metadata?.artist || parsed.artist || selectedYoutube.uploader,
      title: metadata?.title || parsed.title,
      album: metadata?.album || '',
      year: metadata?.year || '',
      genre: metadata?.genre || '',
      coverUrl: cover?.url || '',
      sourceFormatId,
      sourceBitrate,
      targetBitrate,
      video: selectedYoutube
    };
  } finally {
    prompter.close();
  }
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

  const youtubeResults = await searchYouTube(query, MANUAL_LIMIT);

  if (!youtubeResults.length) {
    console.log('No results');
    process.exit(1);
  }

  console.log(`Found ${youtubeResults.length} results`);

  const bestMatch = await manualSelect(query, youtubeResults);

  const selectedYoutube = bestMatch.video;

  console.log(`\nBest: ${bestMatch.artist} - ${bestMatch.title}`);
  if (bestMatch.album) console.log(`Album: ${bestMatch.album}`);
  if (bestMatch.year) console.log(`Year: ${bestMatch.year}`);
  if (bestMatch.genre) console.log(`Genre: ${bestMatch.genre}`);
  if (bestMatch.sourceBitrate) console.log(`Source bitrate: ${bestMatch.sourceBitrate} kbps`);
  console.log(`Target bitrate: ${bestMatch.targetBitrate} kbps`);

  console.log('\n=== Downloading ===');

  const tempAudioPath = await downloadYouTubeAudioWithTemp(selectedYoutube.url, bestMatch.sourceFormatId);

  if (!tempAudioPath) {
    console.log('Download failed');
    process.exit(1);
  }

  console.log('Downloaded');

  const safeArtist = sanitizeFilename(bestMatch.artist);
  const safeTitle = sanitizeFilename(bestMatch.title);
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
    await mergeMetadata(tempAudioPath, metadata, outputPath, bestMatch.targetBitrate);
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
