'use strict';
const fs = require('fs');
const path = require('path');

const roots = (process.argv[2] || '/mnt/NAS/Music,/mnt/USB/Music,/mnt/INTERNAL').split(',').map(s => s.trim()).filter(Boolean);
const maxDepthArg = parseInt(process.argv[3] || '3', 10);
const maxDepth = Number.isFinite(maxDepthArg) && maxDepthArg > 0 ? Math.min(maxDepthArg, 5) : 3;
const excludes = (process.argv[4] || '#recycle,@eaDir,.AppleDouble,video,Sounds').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const AUDIO_RE = /\.(flac|mp3|m4a|wav|aiff|aif|dsf|dff|ogg)$/i;
const SKIP_RE = /(^\.|#recycle|\.download$|@eaDir)/i;

function isAudioFile(p) { return AUDIO_RE.test(p); }
function listSafe(dir) { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; } }
function listDirs(dir) { return listSafe(dir).filter(e => e.isDirectory()).map(e => path.join(dir, e.name)); }
function listAudioFiles(dir) { return listSafe(dir).filter(e => e.isFile() && isAudioFile(e.name)).map(e => path.join(dir, e.name)); }
function isDiscFolderName(name) { return /^(cd|disc|disk|disque|volume|vol)\s*[-_. ]*\d+$/i.test(String(name || '').trim()); }
function shouldSkip(folderPath) {
  const name = path.basename(folderPath);
  if (SKIP_RE.test(name)) return true;
  return excludes.includes(name.toLowerCase());
}
function parseAlbumName(folderName) {
  let artist = '';
  let album = folderName;
  if (folderName.includes(' - ')) {
    const parts = folderName.split(' - ');
    artist = parts.shift().trim();
    album = parts.join(' - ').trim();
  } else if (folderName.includes('-')) {
    const parts = folderName.split('-');
    artist = parts.shift().trim();
    album = parts.join('-').trim();
  }
  return { artist, album };
}
function parseAlbumFromPath(folderPath, root) {
  const folderName = path.basename(folderPath);
  const parsed = parseAlbumName(folderName);
  if (parsed.artist) return parsed;
  const parts = path.relative(root, folderPath).split(path.sep).filter(Boolean);
  if (parts.length >= 2) return { artist: parts[parts.length - 2], album: folderName };
  return parsed;
}
function scanRoot(root) {
  const albums = [];
  function walk(folderPath, depth) {
    if (depth > maxDepth || shouldSkip(folderPath)) return;
    const directAudio = listAudioFiles(folderPath);
    if (directAudio.length) {
      albums.push({ folderPath, trackFolders: [folderPath], depth });
      return;
    }
    const childDirs = listDirs(folderPath).filter(d => !shouldSkip(d));
    const discDirs = childDirs.filter(d => isDiscFolderName(path.basename(d)) && listAudioFiles(d).length)
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' }));
    if (discDirs.length) {
      albums.push({ folderPath, trackFolders: discDirs, depth });
      return;
    }
    if (depth >= maxDepth) return;
    childDirs.forEach(child => walk(child, depth + 1));
  }
  listDirs(root).forEach(folderPath => walk(folderPath, 1));
  return albums;
}

const albums = [];
for (const root of roots) {
  for (const candidate of scanRoot(root)) {
    let stat;
    try { stat = fs.statSync(candidate.folderPath); } catch (e) { continue; }
    const parsed = parseAlbumFromPath(candidate.folderPath, root);
    albums.push({
      source: path.basename(root),
      folder: path.basename(candidate.folderPath),
      artist: parsed.artist,
      album: parsed.album,
      depth: candidate.depth,
      trackFolders: candidate.trackFolders,
      mtime: stat.mtime,
      path: candidate.folderPath
    });
  }
}

albums.sort((a, b) => b.mtime - a.mtime);
console.log(`Found ${albums.length} albums. Roots: ${roots.join(', ')}. Max depth: ${maxDepth}`);
albums.slice(0, 30).forEach((a, i) => {
  const discNote = a.trackFolders.length > 1 ? ` (${a.trackFolders.length} disc folders)` : '';
  console.log(`${String(i + 1).padStart(2, '0')}. ${a.artist ? a.artist + ' — ' : ''}${a.album} [${a.source}, depth ${a.depth}]${discNote} ${a.mtime.toISOString().slice(0, 10)}`);
  console.log(`    ${a.path}`);
});
