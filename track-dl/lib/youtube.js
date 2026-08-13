const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpegStatic = require('ffmpeg-static');

const YTDLP_PATH = path.join(__dirname, '..', 'yt-dlp.exe');
const FFMPEG_PATH = path.dirname(ffmpegStatic);

function execPromise(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr || `exit code ${code}`));
      } else {
        resolve(stdout);
      }
    });
    proc.on('error', reject);
  });
}

async function searchYouTube(query, limit = 5) {
  try {
    const result = await execPromise(YTDLP_PATH, [
      `ytsearch${limit}:${query}`,
      '--dump-json',
      '--no-warnings',
      '--flat-playlist'
    ]);

    if (!result.trim()) {
      return [];
    }

    const lines = result.trim().split('\n');
    const videos = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);

    return videos.map(video => ({
      id: video.id,
      title: video.title,
      uploader: video.uploader || '',
      duration: video.duration || '',
      url: `https://www.youtube.com/watch?v=${video.id}`,
      thumbnail: video.thumbnails?.[0]?.url || video.thumbnail || ''
    }));
  } catch (err) {
    console.error('Error searching YouTube:', err.message);
    return [];
  }
}

async function downloadYouTubeAudioWithTemp(url) {
  const tempDir = path.join(__dirname, '..');
  const tempFile = path.join(tempDir, 'temp_audio');

  const baseArgs = [
    url,
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '-o', tempFile,
    '--ffmpeg-location', FFMPEG_PATH,
    '--js-runtimes', 'node'
  ];

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await execPromise(YTDLP_PATH, baseArgs);

      const possibleExtensions = ['.mp3', '.m4a', '.webm', '.opus', '.aac'];
      for (const ext of possibleExtensions) {
        if (fs.existsSync(tempFile + ext)) {
          return tempFile + ext;
        }
      }
      console.error('Downloaded file not found.');
      return null;
    } catch (err) {
      const retryable = /403|Forbidden|unable to download/i.test(err.message || '');
      if (attempt < maxAttempts && retryable) {
        console.log(`Download failed (attempt ${attempt}), retrying...`);
        await new Promise(r => setTimeout(r, 2000));
      } else {
        console.error('Error downloading YouTube audio:', err.message);
        return null;
      }
    }
  }
}

module.exports = {
  searchYouTube,
  downloadYouTubeAudioWithTemp
};
