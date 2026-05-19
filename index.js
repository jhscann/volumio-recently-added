'use strict';

var libQ = require('kew');
var fs = require('fs');
var path = require('path');
var Config = require('v-conf');
var childProcess = require('child_process');

module.exports = ControllerRecentlyAdded;

function ControllerRecentlyAdded(context) {
  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context.logger;
  this.configManager = this.context.configManager;
  this.config = null;
  this.albums = [];
}

var AUDIO_RE = /\.(flac|mp3|m4a|wav|aiff|aif|dsf|dff|ogg)$/i;
var SKIP_RE = /(^\.|#recycle|\.download$|@eaDir)/i;
var DEFAULT_ROOTS = '/mnt/NAS/Music,/mnt/USB/Music,/mnt/INTERNAL';
var DEFAULT_MAX_ALBUMS = 100;
var DEFAULT_MAX_DEPTH = 3;
var DEFAULT_EXCLUDE_FOLDERS = '#recycle,@eaDir,.AppleDouble,video,Sounds';
var URI_VERSION = 'v1';
var URI_ALBUM_PREFIX = 'recentlyadded/' + URI_VERSION + '/album/';

ControllerRecentlyAdded.prototype.onVolumioStart = function () {
  var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
  this.config = new Config();
  this.config.loadFile(configFile);
  return libQ.resolve();
};

ControllerRecentlyAdded.prototype.onStart = function () {
  var self = this;
  return self.scanAlbums().then(function () {
    self.addToBrowseSources();
    self.logger.info('[recentlyadded] Started with ' + self.albums.length + ' albums');
    return libQ.resolve();
  }).fail(function (e) {
    self.logger.error('[recentlyadded] Failed to start: ' + e.message);
    return libQ.reject(e);
  });
};

ControllerRecentlyAdded.prototype.onStop = function () {
  return libQ.resolve();
};

ControllerRecentlyAdded.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

ControllerRecentlyAdded.prototype.addToBrowseSources = function () {
  // Volumio browse-source tiles use albumart/sourceicon rather than the
  // Font Awesome icon field used inside normal browse lists.
  this.commandRouter.volumioAddToBrowseSources({
    name: 'Recently Added',
    uri: 'recentlyadded',
    plugin_type: 'music_service',
    plugin_name: 'recentlyadded',
    albumart: buildSourceIconUri()
  });
};

ControllerRecentlyAdded.prototype.handleBrowseUri = function (curUri) {
  if (curUri === 'recentlyadded') return this.listRoot();
  if (curUri === 'recentlyadded/albums') return this.listAlbums('recent');
  if (curUri === 'recentlyadded/albums/artist') return this.listAlbums('artist');
  if (curUri === 'recentlyadded/albums/title') return this.listAlbums('title');
  if (curUri.indexOf(URI_ALBUM_PREFIX) === 0) return this.listAlbumTracks(curUri);
  if (curUri.indexOf('recentlyadded/album/') === 0) return this.listAlbumTracks(curUri);
  return libQ.resolve(this.emptyNavigation('Unknown Recently Added item', 'recentlyadded'));
};

ControllerRecentlyAdded.prototype.search = function (query) {
  var q = String(query || '').toLowerCase();
  var items = this.albums.filter(function (a) {
    return (a.artist + ' ' + a.album + ' ' + a.folder).toLowerCase().indexOf(q) !== -1;
  }).slice(0, 50).map(this.albumToBrowseItem.bind(this));
  return libQ.resolve({
    title: 'Recently Added',
    icon: 'fa fa-clock-o',
    availableListViews: ['list', 'grid'],
    items: items
  });
};

ControllerRecentlyAdded.prototype.explodeUri = function (uri) {
  // Playback is intentionally restricted to track rows. Navigation and album rows are
  // returned as item-no-menu browse rows so Volumio should not expose play/add
  // controls for them. This defensive explodeUri guard remains in case an old
  // cached URI or UI action still tries to play a browse-only row.
  if (isBrowseOnlyRecentlyAddedUri(uri)) {
    this.logger.info('[recentlyadded] Non-track playback is disabled for browse-only URI: ' + uri);
    return libQ.resolve([]);
  }
  return libQ.resolve([]);
};

ControllerRecentlyAdded.prototype.listRoot = function () {
  return libQ.resolve({
    navigation: {
      prev: { uri: '/' },
      lists: [{
        title: 'Recently Added',
        icon: 'fa fa-clock-o',
        availableListViews: ['list'],
        playable: false,
        addToQueue: false,
        disablePlay: true,
        disableAddToQueue: true,
        items: [markBrowseOnly({
          service: 'recentlyadded',
          type: 'folder',
          title: 'Recently Added Albums',
          artist: 'Newest first',
          icon: 'fa fa-clock-o',
          albumart: buildSourceIconUri(),
          uri: 'recentlyadded/albums'
        }), markBrowseOnly({
          service: 'recentlyadded',
          type: 'folder',
          title: 'Albums by Artist',
          artist: 'Artist A-Z',
          icon: 'fa fa-user',
          albumart: buildSourceIconUri(),
          uri: 'recentlyadded/albums/artist'
        }), markBrowseOnly({
          service: 'recentlyadded',
          type: 'folder',
          title: 'Albums by Title',
          artist: 'Album A-Z',
          icon: 'fa fa-list',
          albumart: buildSourceIconUri(),
          uri: 'recentlyadded/albums/title'
        })]
      }]
    }
  });
};

ControllerRecentlyAdded.prototype.listAlbums = function (sortMode) {
  sortMode = sortMode || 'recent';
  var maxAlbums = this.getConfiguredMaxAlbums();
  var sortedAlbums = this.getSortedRecentAlbumSubset(sortMode, maxAlbums);
  var listTitle = getAlbumListTitle(sortMode);
  var listIcon = sortMode === 'artist' ? 'fa fa-user' : (sortMode === 'title' ? 'fa fa-list' : 'fa fa-clock-o');
  var items = sortedAlbums.map(this.albumToBrowseItem.bind(this));
  return libQ.resolve({
    navigation: {
      prev: { uri: 'recentlyadded' },
      lists: [{
        title: listTitle,
        icon: listIcon,
        availableListViews: ['list', 'grid'],
        playable: false,
        addToQueue: false,
        disablePlay: true,
        disableAddToQueue: true,
        items: items
      }]
    }
  });
};

ControllerRecentlyAdded.prototype.getSortedRecentAlbumSubset = function (sortMode, maxAlbums) {
  // First select the same newest-N album set for every view, then apply the
  // requested display order. This keeps Recently Added Albums, Albums by Artist
  // and Albums by Title as different orderings of the same recently added set.
  var albums = this.albums.slice().sort(function (a, b) { return compareDateDesc(a.sortDate, b.sortDate); }).slice(0, maxAlbums);

  if (sortMode === 'artist') {
    return albums.sort(function (a, b) {
      return compareText(a.artist, b.artist) || compareText(a.album, b.album) || compareDateDesc(a.sortDate, b.sortDate);
    });
  }
  if (sortMode === 'title') {
    return albums.sort(function (a, b) {
      return compareText(a.album, b.album) || compareText(a.artist, b.artist) || compareDateDesc(a.sortDate, b.sortDate);
    });
  }
  return albums;
};

ControllerRecentlyAdded.prototype.listAlbumTracks = function (curUri) {
  var album = this.findAlbumByUri(curUri);
  if (!album) return libQ.resolve(this.emptyNavigation('Album not found', 'recentlyadded/albums'));
  return libQ.resolve({
    navigation: {
      prev: { uri: 'recentlyadded/albums' },
      lists: [{
        title: (album.artist ? album.artist + ' — ' : '') + album.album,
        icon: 'fa fa-music',
        availableListViews: ['list'],
        items: this.trackItemsForAlbum(album)
      }]
    }
  });
};

ControllerRecentlyAdded.prototype.albumToBrowseItem = function (album) {
  var title = (album.artist ? album.artist + ' — ' : '') + album.album;
  var subtitle = album.source + ' · ' + (album.sortDate || '').slice(0, 10);
  return markBrowseOnly({
    service: 'recentlyadded',
    type: 'folder',
    title: title,
    artist: subtitle,
    album: album.album,
    icon: 'fa fa-folder-open-o',
    uri: URI_ALBUM_PREFIX + encodeURIComponent(album.id)
  });
};

ControllerRecentlyAdded.prototype.trackItemsForAlbum = function (album) {
  var tracks = this.collectAudioFilesForAlbum(album).map(buildTrackInfo);
  tracks.sort(trackInfoSort);

  return tracks.map(function (track) {
    return {
      service: 'mpd',
      type: 'song',
      title: track.displayTitle,
      artist: album.artist || '',
      album: album.album || '',
      icon: 'fa fa-music',
      uri: absolutePathToMpdRelativeUri(track.file),
      tracknumber: track.track < 9999 ? track.track : undefined,
      discnumber: track.disc < 9999 ? track.disc : undefined
    };
  });
};

ControllerRecentlyAdded.prototype.findAlbumByUri = function (uri) {
  var id = uri.indexOf(URI_ALBUM_PREFIX) === 0 ? uri.replace(URI_ALBUM_PREFIX, '') : uri.replace('recentlyadded/album/', '');
  id = decodeURIComponent(id);
  return this.albums.find(function (a) { return a.id === id; });
};

ControllerRecentlyAdded.prototype.getConfiguredRoots = function () {
  var raw = String(this.config.get('roots') || DEFAULT_ROOTS);
  return raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
};

ControllerRecentlyAdded.prototype.getConfiguredMaxAlbums = function () {
  var value = parseInt(this.config.get('maxAlbums'), 10);
  if (!Number.isFinite(value) || value < 1) return DEFAULT_MAX_ALBUMS;
  return Math.min(value, 1000);
};

ControllerRecentlyAdded.prototype.getConfiguredMaxDepth = function () {
  var value = parseInt(this.config.get('maxDepth'), 10);
  if (!Number.isFinite(value) || value < 1) return DEFAULT_MAX_DEPTH;
  return Math.min(value, 5);
};

ControllerRecentlyAdded.prototype.getConfiguredExcludeFolders = function () {
  var raw = String(this.config.get('excludeFolders') || DEFAULT_EXCLUDE_FOLDERS);
  return raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
};

ControllerRecentlyAdded.prototype.shouldSkipFolder = function (folderPath, excludeFolders) {
  var folderName = path.basename(folderPath);
  if (SKIP_RE.test(folderName)) return true;
  var lower = folderName.toLowerCase();
  return excludeFolders.some(function (name) { return lower === String(name).toLowerCase(); });
};

ControllerRecentlyAdded.prototype.saveSettings = function (data) {
  var self = this;

  var rootsValue = extractUIValue(data, 'roots');
  var maxAlbumsValue = extractUIValue(data, 'maxAlbums');
  var maxDepthValue = extractUIValue(data, 'maxDepth');
  var excludeFoldersValue = extractUIValue(data, 'excludeFolders');

  if (rootsValue !== undefined) {
    var roots = String(rootsValue).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!roots.length) {
      self.commandRouter.pushToastMessage('error', 'Recently Added', 'Please enter at least one folder path.');
      return libQ.resolve();
    }
    this.config.set('roots', roots.join(','));
  }

  if (maxAlbumsValue !== undefined) {
    var maxAlbums = parseInt(maxAlbumsValue, 10);
    if (!Number.isFinite(maxAlbums) || maxAlbums < 1) maxAlbums = DEFAULT_MAX_ALBUMS;
    if (maxAlbums > 1000) maxAlbums = 1000;
    this.config.set('maxAlbums', maxAlbums);
  }

  if (maxDepthValue !== undefined) {
    var maxDepth = parseInt(maxDepthValue, 10);
    if (!Number.isFinite(maxDepth) || maxDepth < 1) maxDepth = DEFAULT_MAX_DEPTH;
    if (maxDepth > 5) maxDepth = 5;
    this.config.set('maxDepth', maxDepth);
  }

  if (excludeFoldersValue !== undefined) {
    var excludeFolders = String(excludeFoldersValue).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    this.config.set('excludeFolders', excludeFolders.join(','));
  }

  this.config.save();
  return self.scanAlbums().then(function () {
    self.commandRouter.pushToastMessage('success', 'Recently Added', 'Settings saved and library scanned.');
  }).fail(function (e) {
    self.commandRouter.pushToastMessage('error', 'Recently Added', e.message);
  });
};

ControllerRecentlyAdded.prototype.scanAlbums = function () {
  var self = this;
  var defer = libQ.defer();
  try {
    var roots = self.getConfiguredRoots();
    var maxDepth = self.getConfiguredMaxDepth();
    var excludeFolders = self.getConfiguredExcludeFolders();
    var found = [];

    roots.forEach(function (root) {
      self.scanRootForAlbums(root, maxDepth, excludeFolders).forEach(function (candidate) {
        var folderPath = candidate.folderPath;
        var folderName = path.basename(folderPath);
        var stat = fs.statSync(folderPath);
        var parsed = parseAlbumFromPath(folderPath, root);
        var mtime = stat.mtime.toISOString();
        found.push({
          source: path.basename(root),
          folder: folderName,
          folderPath: folderPath,
          trackFolders: candidate.trackFolders,
          depth: candidate.depth,
          artist: parsed.artist,
          album: parsed.album,
          folderModifiedAt: mtime,
          sortDate: mtime
        });
      });
    });

    found.sort(function (a, b) { return new Date(b.sortDate) - new Date(a.sortDate); });
    found.forEach(function (album, index) {
      album.id = 'album-' + String(index + 1);
    });
    self.albums = found;
    self.logger.info('[recentlyadded] Scan complete: ' + found.length + ' albums found across ' + roots.length + ' roots, max depth ' + maxDepth);
    defer.resolve(found);
  } catch (e) {
    defer.reject(e);
  }
  return defer.promise;
};

ControllerRecentlyAdded.prototype.listDirectories = function (root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(function (e) { return e.isDirectory(); })
      .map(function (e) { return path.join(root, e.name); });
  } catch (e) {
    this.logger.warn('[recentlyadded] Cannot read root: ' + root + ' - ' + e.message);
    return [];
  }
};

ControllerRecentlyAdded.prototype.scanRootForAlbums = function (root, maxDepth, excludeFolders) {
  var self = this;
  var albums = [];

  function walk(folderPath, depth) {
    if (depth > maxDepth) return;
    if (self.shouldSkipFolder(folderPath, excludeFolders)) return;

    var directAudioFiles = self.listAudioFiles(folderPath);
    if (directAudioFiles.length > 0) {
      albums.push({ folderPath: folderPath, trackFolders: [folderPath], depth: depth });
      return;
    }

    var childDirs = self.listDirectories(folderPath).filter(function (child) {
      return !self.shouldSkipFolder(child, excludeFolders);
    });

    var discDirs = childDirs.filter(function (child) {
      return isDiscFolderName(path.basename(child)) && self.listAudioFiles(child).length > 0;
    }).sort(function (a, b) {
      return path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' });
    });

    if (discDirs.length > 0) {
      albums.push({ folderPath: folderPath, trackFolders: discDirs, depth: depth });
      return;
    }

    if (depth >= maxDepth) return;
    childDirs.forEach(function (child) { walk(child, depth + 1); });
  }

  this.listDirectories(root).forEach(function (folderPath) { walk(folderPath, 1); });
  return albums;
};

ControllerRecentlyAdded.prototype.collectAudioFilesForAlbum = function (album) {
  var self = this;
  var folders = Array.isArray(album.trackFolders) && album.trackFolders.length ? album.trackFolders : [album.folderPath];
  var files = [];
  folders.forEach(function (folder) {
    files = files.concat(self.listAudioFiles(folder));
  });
  return files;
};

ControllerRecentlyAdded.prototype.hasAudioFiles = function (dir) {
  return this.listAudioFiles(dir).length > 0;
};

ControllerRecentlyAdded.prototype.listAudioFiles = function (dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(function (e) { return e.isFile() && AUDIO_RE.test(e.name); })
      .map(function (e) { return path.join(dir, e.name); });
  } catch (e) {
    return [];
  }
};

ControllerRecentlyAdded.prototype.emptyNavigation = function (title, prev) {
  return {
    navigation: {
      prev: { uri: prev || 'recentlyadded' },
      lists: [{ title: title, availableListViews: ['list'], items: [] }]
    }
  };
};


function extractUIValue(data, key) {
  if (!data || data[key] === undefined || data[key] === null) return undefined;
  if (typeof data[key] === 'object' && data[key].value !== undefined) return data[key].value;
  return data[key];
}

function buildSourceIconUri() {
  return '/albumart?sourceicon=music_service/recentlyadded/recentlyaddedicon.png';
}

function markBrowseOnly(item) {
  // Volumio documents item-no-menu as the browse item type without extra
  // functionality. Use it for navigation/view rows and album rows so only track
  // rows expose playback actions.
  item.type = 'item-no-menu';
  item.folder = true;
  item.isFolder = true;
  item.playable = false;
  item.isPlayable = false;
  item.is_playable = false;
  item.addable = false;
  item.addToQueue = false;
  item.disablePlay = true;
  item.disableAddToQueue = true;
  item.disableClearAndPlay = true;
  item.noPlayButton = true;
  item.showPlayButton = false;
  item.showAddToQueueButton = false;
  return item;
}

function isBrowseOnlyRecentlyAddedUri(uri) {
  uri = String(uri || '');
  return uri === 'recentlyadded' ||
    uri === 'recentlyadded/albums' ||
    uri === 'recentlyadded/albums/artist' ||
    uri === 'recentlyadded/albums/title' ||
    uri.indexOf(URI_ALBUM_PREFIX) === 0 ||
    uri.indexOf('recentlyadded/album/') === 0;
}

function getAlbumListTitle(sortMode) {
  if (sortMode === 'artist') return 'Albums by Artist';
  if (sortMode === 'title') return 'Albums by Title';
  return 'Recently Added Albums';
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base', numeric: true });
}

function compareDateDesc(a, b) {
  return new Date(b || 0) - new Date(a || 0);
}

function parseAlbumName(folderName) {
  var artist = '';
  var album = folderName;
  if (folderName.indexOf(' - ') !== -1) {
    var parts = folderName.split(' - ');
    artist = parts.shift().trim();
    album = parts.join(' - ').trim();
  } else if (folderName.indexOf('-') !== -1) {
    var p = folderName.split('-');
    artist = p.shift().trim();
    album = p.join('-').trim();
  }
  return { artist: artist, album: album };
}

function parseAlbumFromPath(folderPath, root) {
  var folderName = path.basename(folderPath);
  var parsed = parseAlbumName(folderName);
  if (parsed.artist) return parsed;

  var rel = path.relative(root, folderPath);
  var parts = rel.split(path.sep).filter(Boolean);
  if (parts.length >= 2) {
    return { artist: parts[parts.length - 2], album: folderName };
  }
  return parsed;
}

function isDiscFolderName(folderName) {
  return /^(cd|disc|disk|disque|volume|vol)\s*[-_. ]*\d+$/i.test(String(folderName || '').trim());
}

function absolutePathToMpdRelativeUri(absPath) {
  // MPD stores Volumio-mounted files relative to /mnt, e.g.
  // NAS/Music/Artist - Album/01 Track.flac
  // Do not URL-encode this value.
  return absPath.replace(/^\/mnt\//, '');
}

function buildTrackInfo(file) {
  var fileName = path.basename(file);
  var ext = path.extname(fileName);
  var fileTitle = fileName.replace(/\.[^.]+$/, '').trim();
  var nameOrder = parseTrackOrder(fileName);
  var tags = readFlacTags(file);

  var disc = parsePositiveInt(tags.discnumber || tags.disctotal || tags.disc) || nameOrder.disc;
  var track = parsePositiveInt(tags.tracknumber || tags.track) || nameOrder.track;
  var tagTitle = tags.title || '';
  var baseTitle = tagTitle || fileTitle;
  var displayTitle = formatDisplayTrackTitle(track, baseTitle, !!tagTitle);

  return {
    file: file,
    fileName: fileName,
    ext: ext,
    disc: disc,
    track: track,
    title: baseTitle,
    displayTitle: displayTitle
  };
}

function trackInfoSort(a, b) {
  if (a.disc !== b.disc) return a.disc - b.disc;
  if (a.track !== b.track) return a.track - b.track;
  return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' });
}

function formatDisplayTrackTitle(track, title, titleCameFromTag) {
  var cleaned = String(title || '').trim();
  if (!cleaned) cleaned = 'Unknown track';

  // If the filename already starts with a number, leave it as-is. This keeps
  // Vinyl-style files such as "01 - So What" looking natural.
  if (!titleCameFromTag && /^\d{1,3}\s*[-._ ]\s*/.test(cleaned)) return cleaned;

  // Prefix tag-derived titles with a track number. This is deliberate: some
  // Volumio views appear to sort visible song titles, so the prefix preserves
  // album order for files named only "Song Title.flac".
  if (track && track < 9999) return String(track).padStart(2, '0') + '. ' + cleaned;
  return cleaned;
}

function readFlacTags(file) {
  if (!/\.flac$/i.test(file)) return {};
  try {
    var output = childProcess.execFileSync('metaflac', [
      '--show-tag=TRACKNUMBER',
      '--show-tag=DISCNUMBER',
      '--show-tag=TITLE',
      file
    ], { encoding: 'utf8' });
    return parseTagOutput(output);
  } catch (e) {
    return {};
  }
}

function parseTagOutput(output) {
  var tags = {};
  String(output || '').split(/\r?\n/).forEach(function (line) {
    var idx = line.indexOf('=');
    if (idx === -1) return;
    var key = line.slice(0, idx).trim().toLowerCase();
    var value = line.slice(idx + 1).trim();
    if (key) tags[key] = value;
  });
  return tags;
}

function parsePositiveInt(value) {
  if (value === undefined || value === null || value === '') return null;
  var match = String(value).match(/\d+/);
  if (!match) return null;
  var n = parseInt(match[0], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function trackOrderSort(a, b) {
  var aInfo = parseTrackOrder(path.basename(a));
  var bInfo = parseTrackOrder(path.basename(b));

  if (aInfo.disc !== bInfo.disc) return aInfo.disc - bInfo.disc;
  if (aInfo.track !== bInfo.track) return aInfo.track - bInfo.track;

  return path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' });
}

function parseTrackOrder(fileName) {
  var base = fileName.replace(/\.[^.]+$/, '').trim();

  // Disc-track patterns need to be checked before the simple pattern, otherwise
  // 1-01 would be interpreted as track 1 instead of disc 1, track 01.
  var discDash = base.match(/^(\d{1,2})[-._](\d{1,3})\s*/);
  if (discDash) {
    return {
      disc: parseInt(discDash[1], 10) || 1,
      track: parseInt(discDash[2], 10) || 9999
    };
  }

  var threeDigit = base.match(/^(\d)(\d{2})\s+/);
  if (threeDigit) {
    return {
      disc: parseInt(threeDigit[1], 10) || 1,
      track: parseInt(threeDigit[2], 10) || 9999
    };
  }

  // Common patterns:
  // 01 - Track.flac
  // 01-Track.flac
  // 1. Track.flac
  // 1_Track.flac
  var simple = base.match(/^(\d{1,3})\s*[-._ ]\s*/);
  if (simple) {
    return { disc: 1, track: parseInt(simple[1], 10) || 9999 };
  }

  return { disc: 9999, track: 9999 };
}

ControllerRecentlyAdded.prototype.getUIConfig = function () {
  var defer = libQ.defer();
  var lang_code = this.commandRouter.sharedVars.get('language_code') || 'en';
  var self = this;
  this.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json', __dirname + '/i18n/strings_en.json', __dirname + '/UIConfig.json')
    .then(function (uiconf) {
      try {
        setUIConfigValue(uiconf, 'roots', self.getConfiguredRoots().join(','));
        setUIConfigValue(uiconf, 'maxAlbums', String(self.getConfiguredMaxAlbums()));
        setUIConfigValue(uiconf, 'maxDepth', String(self.getConfiguredMaxDepth()));
        setUIConfigValue(uiconf, 'excludeFolders', self.getConfiguredExcludeFolders().join(','));
      } catch (e) {
        self.logger.warn('[recentlyadded] Could not populate settings UI: ' + e.message);
      }
      defer.resolve(uiconf);
    }).fail(function () {
      defer.reject(new Error('Unable to load UI config'));
    });
  return defer.promise;
};

function setUIConfigValue(uiconf, id, value) {
  var sections = [];
  if (uiconf && Array.isArray(uiconf.sections)) sections = uiconf.sections;
  if (uiconf && uiconf.page && Array.isArray(uiconf.page.sections)) sections = uiconf.page.sections;
  sections.forEach(function (section) {
    (section.content || []).forEach(function (item) {
      if (item.id === id) item.value = value;
    });
  });
}
