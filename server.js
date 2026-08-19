const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

process.on('unhandledRejection', (err) => console.error('Unhandled:', err));
process.on('uncaughtException', (err) => console.error('Uncaught:', err));

const app = express();
const PORT = process.env.PORT || 3666;
const TRACK_DL_DIR = process.env.TRACK_DL_PATH || path.join(__dirname, '..', 'track-dl');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SETTINGS_FILE = process.env.ELECTRON_USERDATA ? path.join(process.env.ELECTRON_USERDATA, 'settings.json') : path.join(__dirname, 'settings.json');
const DOWNLOADS_STATE_FILE = process.env.ELECTRON_USERDATA ? path.join(process.env.ELECTRON_USERDATA, 'downloads-state.json') : path.join(__dirname, 'downloads-state.json');

const DEFAULT_DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DEFAULT_DOWNLOADS_DIR)) fs.mkdirSync(DEFAULT_DOWNLOADS_DIR, { recursive: true });

const { searchYouTube, downloadYouTubeAudioWithTemp, getAudioFormats } = require(path.join(TRACK_DL_DIR, 'lib', 'youtube'));
const { mergeMetadata } = require(path.join(TRACK_DL_DIR, 'lib', 'merger'));
const { fetchSongInfoOptions, fetchCoverOptions, parseYouTubeTitle } = require(path.join(TRACK_DL_DIR, 'lib', 'metadata'));
const { Shazam } = require('node-shazam');

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

function httpsRequest(url, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = { hostname: u.hostname, path: u.pathname + u.search, method, headers };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function getSpotifyCredentials() {
  const settings = loadSettings();
  return {
    id: process.env.SPOTIFY_CLIENT_ID || settings.spotifyClientId || '',
    secret: process.env.SPOTIFY_CLIENT_SECRET || settings.spotifyClientSecret || ''
  };
}

async function spotifyPreview(query) {
  const creds = getSpotifyCredentials();
  if (!creds.id || !creds.secret) return null;
  const auth = Buffer.from(`${creds.id}:${creds.secret}`).toString('base64');
  const tokenRes = await httpsRequest('https://accounts.spotify.com/api/token', 'POST',
    { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    'grant_type=client_credentials');
  const tokenJson = JSON.parse(tokenRes);
  if (!tokenJson.access_token) return null;
  const searchRes = await httpsRequest(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`, 'GET',
    { Authorization: `Bearer ${tokenJson.access_token}` });
  const searchJson = JSON.parse(searchRes);
  const track = searchJson.tracks?.items?.[0];
  if (!track || !track.preview_url) return null;
  return {
    artist: track.artists?.[0]?.name || '',
    title: track.name || '',
    previewUrl: track.preview_url,
    source: 'Spotify'
  };
}

async function deezerPreview(query) {
  const data = await httpsRequest(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5`);
  const json = JSON.parse(data);
  const t = (json.data || []).find(x => x.preview);
  if (!t) return null;
  return { artist: t.artist?.name || '', title: t.title || '', previewUrl: t.preview, source: 'Deezer' };
}

async function deezerChartTrack() {
  const data = await httpsRequest('https://api.deezer.com/chart/0/tracks?limit=50');
  const json = JSON.parse(data);
  const tracks = (json.data || []).filter(t => t.preview);
  if (!tracks.length) return null;
  const pick = tracks[Math.floor(Math.random() * tracks.length)];
  return { artist: pick.artist?.name || '', title: pick.title || '', previewUrl: pick.preview, source: 'Deezer Chart' };
}

let shazamInstance = null;

function s16LEToSamplesArray(buf) {
  const samples = new Array(buf.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(i * 2);
  return samples;
}

async function shazamRecognize(pcmBuffer) {
  if (!shazamInstance) shazamInstance = new Shazam();
  const samples = s16LEToSamplesArray(pcmBuffer);
  const res = await shazamInstance.fullRecognizeSong(samples);
  if (!res || !res.track || !res.track.title) return null;
  return { artist: res.track.subtitle || '', title: res.track.title };
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
  let { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query required' });
  query = query.replace(/[\r\n]+/g, ' ').trim();
  if (!query) return res.status(400).json({ error: 'Invalid query' });

  try {
    const results = await searchYouTube(query, 6);
    res.json({ results, bestMatch: null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/metadata-options', async (req, res) => {
  const { query, videoTitle, uploader } = req.body;
  const q = (query || '').replace(/[\r\n]+/g, ' ').trim() || videoTitle;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    let options = await fetchSongInfoOptions(q, 6);
    if (!options.length) {
      const parsed = parseYouTubeTitle(videoTitle || q);
      options = [{
        artist: parsed.artist || uploader || '',
        title: parsed.title || videoTitle || q,
        album: '',
        year: '',
        genre: '',
        coverUrl: '',
        source: 'YouTube title'
      }];
    }
    res.json({ options });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cover-options', async (req, res) => {
  const { metadata } = req.body;
  if (!metadata) return res.status(400).json({ error: 'Metadata required' });

  try {
    const options = await fetchCoverOptions(metadata, 6);
    res.json({ options });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/audio-formats', async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl required' });

  try {
    const formats = await getAudioFormats(videoUrl);
    res.json({ formats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/preview', async (req, res) => {
  const query = (req.body.query || '').replace(/[\r\n]+/g, ' ').trim();

  try {
    let track = null;
    if (query) {
      track = await spotifyPreview(query);
      if (!track) track = await deezerPreview(query);
    } else {
      track = await deezerChartTrack();
    }
    res.json({ track });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/recognize', async (req, res) => {
  const { pcmBase64 } = req.body;
  if (!pcmBase64) return res.status(400).json({ error: 'PCM required' });

  try {
    const buf = Buffer.from(pcmBase64, 'base64');
    if (buf.length < 16000) return res.json({ track: null });
    let chunk = buf;
    const windowBytes = 16000 * 7 * 2;
    if (buf.length > windowBytes) chunk = buf.slice(buf.length - windowBytes);
    const track = await shazamRecognize(chunk);
    res.json({ track });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/download', async (req, res) => {
  const { query, videoUrl, title, uploader, manualMetadata, sourceFormat, targetBitrate } = req.body;
  if (!query || !videoUrl) return res.status(400).json({ error: 'Query and videoUrl required' });

  const id = `dl-${++downloadIdCounter}-${Date.now()}`;
  const emitter = new EventEmitter();
  downloadEmitters[id] = emitter;

  res.json({ id });

  process.nextTick(async () => {
    try {
      emitter.emit('progress', { stage: 'search', message: `Searching YouTube for: "${query}"` });

      let bestMatch;
      if (manualMetadata && typeof manualMetadata === 'object' && (manualMetadata.artist || manualMetadata.title)) {
        bestMatch = {
          artist: manualMetadata.artist || uploader || '',
          title: manualMetadata.title || title || '',
          album: manualMetadata.album || '',
          year: manualMetadata.year || '',
          genre: manualMetadata.genre || '',
          coverUrl: manualMetadata.coverUrl || '',
          video: { url: videoUrl, title, uploader }
        };
      } else {
        const parsed = parseYouTubeTitle(title);
        bestMatch = {
          artist: parsed.artist || uploader,
          title: parsed.title || title,
          album: '',
          year: '',
          genre: '',
          coverUrl: '',
          video: { url: videoUrl, title, uploader }
        };
      }

      emitter.emit('progress', { stage: 'metadata', message: `Matched: ${bestMatch.artist} - ${bestMatch.title}` });
      if (bestMatch.album) emitter.emit('progress', { stage: 'metadata', message: `Album: ${bestMatch.album}` });

      emitter.emit('progress', { stage: 'download', message: 'Downloading audio from YouTube...', progress: 0 });

      const ytdlpArgs = [videoUrl, '-x', '--audio-format', 'mp3', '--audio-quality', '0',
        '-o', path.join(getDownloadsDir(), 'temp_audio_') + id,
        '--ffmpeg-location', FFMPEG_PATH,
        '--js-runtimes', 'node',
        '--extractor-args', 'youtube:player_client=web,mweb,web_safari',
        '--newline', '--progress', '--no-warnings'];

      if (sourceFormat && sourceFormat.format_id) {
        ytdlpArgs.push('-f', sourceFormat.format_id);
      }

      const maxAttempts = 3;
      let downloadDone = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await execSpawn(YTDLP_PATH, ytdlpArgs, emitter, 'download');
          downloadDone = true;
          break;
        } catch (e) {
          const retryable = /403|Forbidden|unable to download/i.test(e.message || '');
          if (attempt < maxAttempts && retryable) {
            emitter.emit('progress', { stage: 'download', message: `Download failed (attempt ${attempt}), retrying...`, progress: 0 });
            await new Promise(r => setTimeout(r, 2000));
          } else {
            throw e;
          }
        }
      }
      if (!downloadDone) throw new Error('Download failed');
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
      }, finalPath, targetBitrate || 192);

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
    const { downloadPath, minimizeOnStartup } = req.body;
    const update = {};
    if (downloadPath !== undefined) {
      if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath, { recursive: true });
      update.downloadPath = downloadPath;
    }
    if (minimizeOnStartup !== undefined) {
      update.minimizeOnStartup = !!minimizeOnStartup;
    }
    if (Object.keys(update).length) saveSettings(update);
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
