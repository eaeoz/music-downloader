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

const CODEC_DEFAULT_ABR = {
  opus: 128,
  'mp4a.40.2': 128,
  'mp4a.40.5': 64,
  mp4a: 128,
  mp3: 128,
  vorbis: 128,
  libvorbis: 128,
  ac3: 384,
  eac3: 384,
  dts: 768,
  flac: 1411,
  alac: 1411,
  pcm: 1411,
  wav: 1411,
  aiff: 1411
};

const CODEC_RANK = {
  'mp4a.40.2': 10,
  opus: 9,
  mp3: 8,
  'mp4a.40.5': 7,
  vorbis: 6,
  mp4a: 5,
  ac3: 4,
  eac3: 3,
  flac: 2
};

const CODEC_LABELS = {
  opus: 'Opus',
  'mp4a.40.2': 'AAC',
  'mp4a.40.5': 'HE-AAC',
  mp4a: 'AAC',
  mp3: 'MP3',
  vorbis: 'Vorbis',
  libvorbis: 'Vorbis',
  ac3: 'AC3',
  eac3: 'E-AC3',
  dts: 'DTS',
  flac: 'FLAC',
  alac: 'ALAC',
  pcm: 'WAV',
  wav: 'WAV',
  aiff: 'AIFF'
};

function codecLabel(acodec) {
  return CODEC_LABELS[acodec] || acodec || 'audio';
}

async function getAudioFormats(url) {
  try {
    const result = await execPromise(YTDLP_PATH, [
      url,
      '--dump-json',
      '--no-warnings',
      '--no-playlist',
      '--js-runtimes', 'node'
    ]);

    const video = JSON.parse(result.trim().split('\n')[0]);
    const formats = (video.formats || []).filter(f =>
      f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')
    );

    const byBitrate = new Map();
    for (const f of formats) {
      let bitrate = Math.round(f.abr || f.tbr || 0);
      if (!bitrate) bitrate = CODEC_DEFAULT_ABR[f.acodec] || null;
      if (!bitrate) continue;

      const existing = byBitrate.get(bitrate);
      const rank = CODEC_RANK[f.acodec] || 1;
      const existingRank = existing ? (CODEC_RANK[existing.acodec] || 1) : 0;
      if (!existing || rank > existingRank) {
        const note = f.format_note ? ` · ${f.format_note}` : '';
        byBitrate.set(bitrate, {
          format_id: f.format_id,
          bitrate,
          acodec: f.acodec,
          ext: f.audio_ext || f.ext || '',
          label: `${bitrate} kbps · ${codecLabel(f.acodec)}${note}`
        });
      }
    }

    return [...byBitrate.values()].sort((a, b) => a.bitrate - b.bitrate);
  } catch (err) {
    console.error('Error fetching audio formats:', err.message);
    return [];
  }
}

async function downloadYouTubeAudioWithTemp(url, sourceFormatId) {
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

  if (sourceFormatId) {
    baseArgs.splice(1, 0, '-f', sourceFormatId);
  }

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
  downloadYouTubeAudioWithTemp,
  getAudioFormats
};
