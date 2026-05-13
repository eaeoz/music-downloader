const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpegStatic = require('ffmpeg-static');

const YTDLP_PATH = path.join(__dirname, '..', 'yt-dlp.exe');
const FFMPEG_PATH = path.dirname(ffmpegStatic);

function execPromise(command) {
  return new Promise((resolve, reject) => {
    exec(command, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !stdout.trim()) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

async function searchYouTube(query, limit = 5) {
  try {
    const result = await execPromise(`"${YTDLP_PATH}" "ytsearch${limit}:${query}" --dump-json --no-warnings --flat-playlist`);
    
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
  
  const command = `"${YTDLP_PATH}" "${url}" -x --audio-format mp3 --audio-quality 0 -o "${tempFile}" --ffmpeg-location "${FFMPEG_PATH}"`;
  
  try {
    await execPromise(command);
    
    const possibleExtensions = ['.mp3', '.m4a', '.webm', '.opus', '.aac'];
    for (const ext of possibleExtensions) {
      if (fs.existsSync(tempFile + ext)) {
        return tempFile + ext;
      }
    }
    console.error('Downloaded file not found.');
    return null;
  } catch (err) {
    console.error('Error downloading YouTube audio:', err.message);
    return null;
  }
}

module.exports = {
  searchYouTube,
  downloadYouTubeAudioWithTemp
};