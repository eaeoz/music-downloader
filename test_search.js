const { exec } = require('child_process');
const path = require('path');

const YTDLP_PATH = path.join(__dirname, 'node_modules', 'track-dl', 'yt-dlp.exe');
const query = 'test song';
const sanitized = query.replace(/[^a-zA-Z0-9 ]/g, '').trim();
const cmd = `"${YTDLP_PATH}" "ytsearch5:${sanitized}" --dump-json --no-warnings --flat-playlist`;

console.log('Command:', cmd);
console.log('---');

exec(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
  if (error) {
    console.log('ERROR:', error.message);
    console.log('STDERR:', stderr);
  }
  console.log('STDOUT length:', stdout.length);
  const lines = stdout.trim().split('\n').filter(l => l.trim());
  console.log('Results count:', lines.length);
  if (lines.length > 0) {
    const first = JSON.parse(lines[0]);
    console.log('First result:', first.title);
  }
  // Clean up test file
  const fs = require('fs');
  try { fs.unlinkSync(__filename); } catch(_) {}
});
