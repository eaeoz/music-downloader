const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');

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

async function downloadImage(url, filepath) {
  try {
    const response = await axios({
      url,
      responseType: 'stream'
    });
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(filepath);
      response.data.pipe(writer);
      writer.on('finish', () => resolve(filepath));
      writer.on('error', reject);
    });
  } catch (err) {
    console.error('Error downloading image:', err.message);
    return null;
  }
}

async function mergeMetadata(audioPath, metadata, outputPath) {
  const ffmpegPath = ffmpegStatic;
  const tempImage = path.join(__dirname, 'temp_cover.jpg');
  
  try {
    const safeTitle = (metadata.title || '').replace(/[<>:"/\\|?*]/g, '');
    const safeArtist = (metadata.artist || '').replace(/[<>:"/\\|?*]/g, '');
    const safeAlbum = (metadata.album || '').replace(/[<>:"/\\|?*]/g, '');
    const safeYear = (metadata.year || '').replace(/[<>:"/\\|?*]/g, '');
    const safeGenre = (metadata.genre || '').replace(/[<>:"/\\|?*]/g, '');

    let hasCover = false;
    
    if (metadata.albumArt && metadata.albumArt.startsWith('http')) {
      console.log('Downloading album cover...');
      const imagePath = await downloadImage(metadata.albumArt, tempImage);
      if (imagePath && fs.existsSync(imagePath)) {
        hasCover = true;
      }
    }

    const args = [];
    
    if (hasCover) {
      args.push('-i', audioPath, '-i', tempImage);
    } else {
      args.push('-i', audioPath);
    }
    
    args.push(
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      '-id3v2_version', '3',
      '-write_id3v1', '1',
      '-metadata', `title=${safeTitle}`,
      '-metadata', `artist=${safeArtist}`,
      '-metadata', `album=${safeAlbum}`,
      '-metadata', `date=${safeYear}`,
      '-metadata', `genre=${safeGenre}`
    );

    if (hasCover) {
      args.push(
        '-map', '0:a',
        '-map', '1:v',
        '-c:v', 'copy',
        '-id3v2_version', '3'
      );
    }

    args.push('-y', outputPath);

    await execPromise(ffmpegPath, args);

    if (fs.existsSync(tempImage)) fs.unlinkSync(tempImage);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    
    return outputPath;
  } catch (err) {
    console.error('Merge error:', err.message);
    if (fs.existsSync(tempImage)) fs.unlinkSync(tempImage);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    throw err;
  }
}

module.exports = { mergeMetadata };