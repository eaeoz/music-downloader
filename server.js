const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

process.on('unhandledRejection', (err) => console.error('Unhandled:', err));
process.on('uncaughtException', (err) => console.error('Uncaught:', err));

const app = express();
const PORT = process.env.PORT || 3666;
const TRACK_DL_DIR = process.env.TRACK_DL_PATH || path.join(__dirname, 'node_modules', 'track-dl');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SETTINGS_FILE = process.env.ELECTRON_USERDATA ? path.join(process.env.ELECTRON_USERDATA, 'settings.json') : path.join(__dirname, 'settings.json');
const DOWNLOADS_STATE_FILE = process.env.ELECTRON_USERDATA ? path.join(process.env.ELECTRON_USERDATA, 'downloads-state.json') : path.join(__dirname, 'downloads-state.json');

const DEFAULT_DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DEFAULT_DOWNLOADS_DIR)) fs.mkdirSync(DEFAULT_DOWNLOADS_DIR, { recursive: true });

const { searchYouTube, downloadYouTubeAudioWithTemp } = require('track-dl/lib/youtube');
const { mergeMetadata } = require('track-dl/lib/merger');
const { findBestSongMatch, fetchSongInfo, parseYouTubeTitle } = require('track-dl/lib/metadata');

const downloadEmitters = {};
let downloadIdCounter = 0;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(PUBLIC_DIR, { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate') }));
app.use('/downloads', express.static(DEFAULT_DOWNLOADS_DIR));

function loadSettings() {
  try { if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')); } catch (_) {}
  return {};
}
function saveSettings(data) {
  const current = loadSettings();
  const merged = { ...current, ...data };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

function getDownloadsDir() {
  const settings = loadSettings();
  if (settings.downloadPath) return settings.downloadPath;
  if (process.env.DOWNLOAD_PATH) return process.env.DOWNLOAD_PATH;
  return DEFAULT_DOWNLOADS_DIR;
}

function loadDownloadsState() {
  try { if (fs.existsSync(DOWNLOADS_STATE_FILE)) return JSON.parse(fs.readFileSync(DOWNLOADS_STATE_FILE, 'utf-8')); } catch (_) {}
  return [];
}
function saveDownloadsState(downloads) {
  fs.writeFileSync(DOWNLOADS_STATE_FILE, JSON.stringify(downloads, null, 2));
}

const YTDLP_PATH = path.join(TRACK_DL_DIR, 'yt-dlp.exe');
const FFMPEG_PATH = path.dirname(require('ffmpeg-static'));

function sanitize(str) {
  return str.replace(/[<>:"/\\|?*]/g, '').trim();
}

function execSpawn(command, args, eventEmitter, stage) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        if (eventEmitter) eventEmitter.emit('progress', { stage, message: line });
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      const lines = text.split('\n').filter(l => l.trim());
      for (const line of lines) {
        if (eventEmitter) {
          if (line.includes('[download]') && line.includes('%')) {
            const pctMatch = line.match(/(\d+\.\d+)%/);
            const progress = pctMatch ? parseFloat(pctMatch[1]) : 0;
            eventEmitter.emit('progress', { stage, message: line.trim(), progress });
          } else if (line.includes('[ExtractAudio]')) {
            eventEmitter.emit('progress', { stage: 'extract', message: line.trim() });
          } else if (line.includes('[Metadata]') || line.includes('Adding metadata')) {
            eventEmitter.emit('progress', { stage: 'metadata', message: line.trim() });
          } else {
            eventEmitter.emit('progress', { stage, message: line.trim() });
          }
        }
      }
    });

    proc.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(stderr || `Exit code ${code}`));
    });
    proc.on('error', reject);
  });
}

app.get('/api/version', (req, res) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
  res.json({ version: pkg.version });
});

app.post('/api/search', async (req, res) => {
  let { query, mode } = req.body;
  if (!query) return res.status(400).json({ error: 'Query required' });
  query = query.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  if (!query) return res.status(400).json({ error: 'Invalid query' });

  try {
    const results = await searchYouTube(query, 5);
    if (!results.length) return res.json({ results: [], bestMatch: null, noResults: true });

    if (mode === 'auto') {
      const bestMatch = await findBestSongMatch(query, results);
      return res.json({ results, bestMatch });
    }

    res.json({ results, bestMatch: null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/download', async (req, res) => {
  const { query, videoUrl, title, uploader, manualMetadata } = req.body;
  if (!query || !videoUrl) return res.status(400).json({ error: 'Query and videoUrl required' });

  const id = `dl-${++downloadIdCounter}-${Date.now()}`;
  const emitter = new EventEmitter();
  downloadEmitters[id] = emitter;

  res.json({ id });

  process.nextTick(async () => {
    try {
      emitter.emit('progress', { stage: 'search', message: `Searching YouTube for: "${query}"` });

      let bestMatch;
      if (manualMetadata) {
        let songInfo = null;
        try { songInfo = await Promise.race([fetchSongInfo(query), new Promise(r => setTimeout(() => r(null), 6000))]); } catch (_) {}
        const parsed = parseYouTubeTitle(title);
        bestMatch = {
          artist: songInfo?.artist || parsed.artist || uploader,
          title: songInfo?.title || parsed.title || title,
          album: songInfo?.album || '',
          year: songInfo?.year || '',
          genre: songInfo?.genre || '',
          coverUrl: songInfo?.coverUrl || '',
          video: { url: videoUrl, title, uploader }
        };
      } else {
        let songInfo = null;
        try { songInfo = await Promise.race([fetchSongInfo(query), new Promise(r => setTimeout(() => r(null), 6000))]); } catch (_) {}
        const parsed = parseYouTubeTitle(title);
        bestMatch = {
          artist: songInfo?.artist || parsed.artist || uploader,
          title: songInfo?.title || parsed.title || title,
          album: songInfo?.album || '',
          year: songInfo?.year || '',
          genre: songInfo?.genre || '',
          coverUrl: songInfo?.coverUrl || '',
          video: { url: videoUrl, title, uploader }
        };
      }

      emitter.emit('progress', { stage: 'metadata', message: `Matched: ${bestMatch.artist} - ${bestMatch.title}` });
      if (bestMatch.album) emitter.emit('progress', { stage: 'metadata', message: `Album: ${bestMatch.album}` });

      emitter.emit('progress', { stage: 'download', message: 'Downloading audio from YouTube...', progress: 0 });

      const ytdlpArgs = [videoUrl, '-x', '--audio-format', 'mp3', '--audio-quality', '0',
        '-o', path.join(getDownloadsDir(), 'temp_audio_') + id,
        '--ffmpeg-location', FFMPEG_PATH,
        '--newline', '--progress', '--no-warnings'];

      await execSpawn(YTDLP_PATH, ytdlpArgs, emitter, 'download');
      emitter.emit('progress', { stage: 'extract', message: 'Audio extracted successfully' });

      const possibleExts = ['.mp3', '.m4a', '.webm', '.opus', '.aac'];
      let tempAudioPath = null;
      for (const ext of possibleExts) {
        const f = path.join(getDownloadsDir(), `temp_audio_${id}${ext}`);
        if (fs.existsSync(f)) { tempAudioPath = f; break; }
      }
      if (!tempAudioPath) {
        const files = fs.readdirSync(getDownloadsDir()).filter(f => f.startsWith(`temp_audio_${id}`));
        if (files.length) tempAudioPath = path.join(getDownloadsDir(), files[0]);
      }
      if (!tempAudioPath) throw new Error('Downloaded file not found');

      emitter.emit('progress', { stage: 'processing', message: 'Adding metadata and album art...' });

      const safeArtist = sanitize(bestMatch.artist || 'Unknown');
      const safeTitle = sanitize(bestMatch.title || title || 'Unknown');
      const outputFile = `${safeArtist} - ${safeTitle}.mp3`;
      const outputPath = path.join(getDownloadsDir(), outputFile);

      let counter = 1;
      let finalPath = outputPath;
      while (fs.existsSync(finalPath)) {
        const ext = path.extname(outputPath);
        const base = path.basename(outputPath, ext);
        finalPath = path.join(getDownloadsDir(), `${base} (${counter})${ext}`);
        counter++;
      }

      await mergeMetadata(tempAudioPath, {
        title: bestMatch.title || title,
        artist: bestMatch.artist || uploader,
        album: bestMatch.album || '',
        year: bestMatch.year || '',
        genre: bestMatch.genre || '',
        albumArt: bestMatch.coverUrl || ''
      }, finalPath);

      const state = loadDownloadsState();
      state.unshift({ id, name: path.basename(finalPath), path: finalPath, query, artist: safeArtist, title: safeTitle, downloadedAt: new Date().toISOString() });
      saveDownloadsState(state);

      emitter.emit('progress', { stage: 'done', message: `Downloaded: ${path.basename(finalPath)}`, file: finalPath });

      if (tempAudioPath && fs.existsSync(tempAudioPath) && tempAudioPath !== finalPath) {
        try { fs.unlinkSync(tempAudioPath); } catch (_) {}
      }
    } catch (e) {
      emitter.emit('progress', { stage: 'error', message: e.message });
    }
  });
});

app.get('/api/download/progress/:id', (req, res) => {
  const { id } = req.params;
  const emitter = downloadEmitters[id];

  if (!emitter) return res.status(404).json({ error: 'Download not found' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const onProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (data.stage === 'done' || data.stage === 'error') {
      emitter.removeListener('progress', onProgress);
      setTimeout(() => res.end(), 1000);
      setTimeout(() => delete downloadEmitters[id], 2000);
    }
  };

  emitter.on('progress', onProgress);
  req.on('close', () => {
    emitter.removeListener('progress', onProgress);
  });
});

app.post('/api/update-ytdlp', (req, res) => {
  const id = `upd-${Date.now()}`;
  const emitter = new EventEmitter();
  downloadEmitters[id] = emitter;

  res.json({ id });

  process.nextTick(async () => {
    try {
      emitter.emit('progress', { stage: 'update', message: 'Downloading yt-dlp.exe...' });

      const script = path.join(TRACK_DL_DIR, 'index.js');
      const child = spawn('node', [script, '--update'], {
        cwd: TRACK_DL_DIR,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        for (const line of lines) {
          emitter.emit('progress', { stage: 'update', message: line.trim() });
        }
      });

      child.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        for (const line of lines) {
          emitter.emit('progress', { stage: 'update', message: line.trim() });
        }
      });

      child.on('close', (code) => {
        if (code === 0) {
          const ytPath = path.join(TRACK_DL_DIR, 'yt-dlp.exe');
          const stat = fs.statSync(ytPath, { throwIfNoEntry: false });
          if (!stat || stat.size < 1000000) {
            emitter.emit('progress', { stage: 'error', message: 'Update failed: downloaded file is missing or too small' });
            return;
          }
          emitter.emit('progress', { stage: 'done', message: 'yt-dlp updated successfully!' });
        } else {
          emitter.emit('progress', { stage: 'error', message: `Update failed (exit code ${code})` });
        }
      });

      child.on('error', (e) => {
        emitter.emit('progress', { stage: 'error', message: e.message });
      });
    } catch (e) {
      emitter.emit('progress', { stage: 'error', message: e.message });
    }
  });
});

app.get('/api/downloads', (req, res) => {
  res.json(loadDownloadsState());
});

app.post('/api/downloads/redownload', (req, res) => {
  const { itemPath, query } = req.body;
  if (!itemPath) return res.status(400).json({ error: 'Item path required' });

  try {
    if (fs.existsSync(itemPath)) {
      const cmd = process.platform === 'win32' ? 'start ""' : 'open';
      const dir = path.dirname(itemPath);
      require('child_process').exec(`${cmd} "${dir}"`);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/downloads/clear', (req, res) => {
  saveDownloadsState([]);
  res.json({ ok: true });
});

app.post('/api/downloads/remove', (req, res) => {
  const { id, filePath } = req.body;
  const state = loadDownloadsState().filter(d => d.id !== id);
  saveDownloadsState(state);
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
  res.json({ ok: true });
});

app.post('/api/open-folder', (req, res) => {
  try {
    const cmd = process.platform === 'win32' ? `explorer "${getDownloadsDir()}"` :
      process.platform === 'darwin' ? `open "${getDownloadsDir()}"` : `xdg-open "${getDownloadsDir()}"`;
    require('child_process').exec(cmd);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/settings', (req, res) => {
  res.json(loadSettings());
});

app.post('/api/settings', (req, res) => {
  try {
    const { downloadPath } = req.body;
    if (downloadPath !== undefined) {
      if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath, { recursive: true });
      saveSettings({ downloadPath });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Music Downloader running at http://localhost:${PORT}`);
});

module.exports = { app, server };

function cleanup() {
  try { server.close(); } catch (_) {}
}
module.exports.cleanup = cleanup;
