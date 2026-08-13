const https = require('https');
const fs = require('fs');
const path = require('path');

function parseYouTubeTitle(title) {
  const cleanTitle = title
    .replace(/\(Official.*?\)/gi, '')
    .replace(/\(Audio.*?\)/gi, '')
    .replace(/\(Lyric.*?\)/gi, '')
    .replace(/\(Video.*?\)/gi, '')
    .replace(/\(Lyrics.*?\)/gi, '')
    .replace(/\(Visualizer.*?\)/gi, '')
    .replace(/\[Official.*?\]/gi, '')
    .replace(/\[Audio.*?\]/gi, '')
    .replace(/\s*[-|]\s*YouTube.*$/gi, '')
    .replace(/\s*ft\..*$/gi, '')
    .replace(/\s*feat\..*$/gi, '')
    .replace(/\s*featuring.*$/gi, '')
    .trim();

  if (cleanTitle.includes(' - ')) {
    const parts = cleanTitle.split(' - ');
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }

  return { artist: '', title: cleanTitle };
}

async function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
  });
}

async function searchDeezer(query, limit = 1) {
  try {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const data = await httpGet(url);
    const json = JSON.parse(data);

    if (!json.data) {
      return [];
    }

    const entries = json.data.slice(0, limit);
    return await Promise.all(entries.map(async (t) => {
      let year = '';
      let genre = '';

      if (t.album?.id) {
        try {
          const albumUrl = `https://api.deezer.com/album/${t.album.id}`;
          const albumData = await httpGet(albumUrl);
          const albumJson = JSON.parse(albumData);
          year = albumJson.release_date?.substring(0, 4) || '';
          genre = albumJson.genres?.data?.[0]?.name || '';
        } catch {}
      }

      return {
        artist: t.artist?.name || '',
        title: t.title,
        album: t.album?.title || '',
        year: year,
        genre: genre,
        coverUrl: t.album?.cover_big || t.album?.cover_medium || t.album?.cover || ''
      };
    }));
  } catch (err) {
    return [];
  }
}

async function searchITunes(query, limit = 1) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=${limit}`;
    const data = await httpGet(url);
    const json = JSON.parse(data);

    if (!json.results) {
      return [];
    }

    return json.results.slice(0, limit).map(t => ({
      artist: t.artistName || '',
      title: t.trackName || '',
      album: t.collectionName || '',
      year: t.releaseDate?.substring(0, 4) || '',
      genre: t.primaryGenreName || '',
      coverUrl: t.artworkUrl100?.replace('100x100', '600x600') || ''
    }));
  } catch (err) {
    return [];
  }
}

async function fetchSongInfoOptions(query, limit = 6) {
  const options = [];
  const seen = new Set();

  function add(r, source) {
    if (!r?.artist || !r?.title) return;
    const key = `${r.artist}|||${r.title}|||${r.album}`;
    if (seen.has(key)) return;
    seen.add(key);
    options.push({ ...r, source });
  }

  const [deezer, itunes] = await Promise.all([
    searchDeezer(query, limit),
    searchITunes(query, limit)
  ]);

  for (const r of deezer) add(r, 'Deezer');
  for (const r of itunes) add(r, 'iTunes');

  return options.slice(0, limit);
}

async function fetchCoverOptions(metadata, limit = 6) {
  const options = [];
  const seen = new Set();

  function add(url, source, label) {
    if (!url || seen.has(url)) return;
    seen.add(url);
    options.push({ url, source, label });
  }

  if (metadata?.coverUrl) {
    add(metadata.coverUrl, metadata.source || 'Selected metadata', `${metadata.artist} - ${metadata.album || metadata.title}`);
  }

  const artist = metadata?.artist || '';
  const title = metadata?.title || '';
  const album = metadata?.album || '';
  const shortTitle = title
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const queries = [];
  function addQuery(q) {
    q = (q || '').trim();
    if (q && !queries.includes(q)) queries.push(q);
  }
  addQuery([artist, title].filter(Boolean).join(' '));
  addQuery([artist, shortTitle].filter(Boolean).join(' '));
  addQuery([artist, album].filter(Boolean).join(' '));
  addQuery(artist);
  addQuery(title);

  for (const q of queries) {
    if (options.length >= limit) break;
    const [deezer, itunes] = await Promise.all([
      searchDeezer(q, 20),
      searchITunes(q, 20)
    ]);
    for (const r of deezer) add(r.coverUrl, 'Deezer', `${r.artist} - ${r.album || r.title}`);
    for (const r of itunes) add(r.coverUrl, 'iTunes', `${r.artist} - ${r.album || r.title}`);
  }

  return options.slice(0, limit);
}

module.exports = { fetchSongInfoOptions, fetchCoverOptions, parseYouTubeTitle };
