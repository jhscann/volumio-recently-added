# Recently Added for Volumio

Recently Added is a Volumio music-service plugin that adds a **Recently Added** browse source for albums stored in local or NAS-mounted folders.

It scans the filesystem paths you configure directly. The "recently added" signal is each album folder's modified time, so this is not the same as a true MPD or library database added timestamp.

## Features

- Adds a **Recently Added** source under Browse.
- Shows three views over the same newest album set:
  - **Recently Added Albums**: newest folder modified time first.
  - **Albums by Artist**: artist A-Z, then album A-Z.
  - **Albums by Title**: album A-Z, then artist A-Z.
- Supports bounded recursive scanning with a configurable maximum depth.
- Supports mixed folder layouts under the same configured root:
  - `Root / Album / Tracks`
  - `Root / Artist / Album / Tracks`
  - `Root / Genre / Artist / Album / Tracks`
- Detects album folders by finding folders that contain audio files directly.
- Handles common multi-disc layouts such as `CD1`, `CD2`, `Disc 1`, and `Disc 2`.
- Shows best-effort album artwork from common cover images or embedded track artwork.
- Keeps album rows browse-only so clicking an album opens its track list.
- Adds a separate **Play Album** row inside each album as an experimental album playback path.
- Uses `metaflac` for FLAC `DISCNUMBER`, `TRACKNUMBER`, and `TITLE` tags when available, with filename ordering as a fallback.

## Compatibility

This source tree is prepared for Volumio 4 on Debian Bookworm.

- Volumio: `>=4`
- Node.js: `>=20`
- OS: `bookworm`
- Architectures: `amd64`, `armhf`

The plugin still uses the standard Volumio plugin patterns for `kew`, `v-conf`, `UIConfig.json`, `config.json`, `install.sh`, and `uninstall.sh`.

## Installation

SSH into your Volumio 4 device:

```bash
ssh volumio@volumio4.local
```

The default password is often:

```text
volumio
```

Then install the plugin from GitHub:

```bash
cd /home/volumio
git clone https://github.com/jhscann/volumio-recently-added.git recentlyadded
cd /home/volumio/recentlyadded
npm install --production --no-audit --no-fund
volumio plugin install
```

Restart Volumio:

```bash
volumio vrestart
```

Open `http://volumio4.local`, go to **Plugins**, enable **Recently Added**, then open its settings and configure your music folder paths.

If `git` is missing on the Volumio box:

```bash
sudo apt update
sudo apt install git
```

For Volumio plugin submission, test from a Bookworm device and use this from the plugin folder:

```bash
volumio plugin submit
```

## Configuration

Open the plugin settings from Volumio's installed plugins page.

Settings:

- **Music folder paths**: comma-separated full Volumio filesystem paths to scan, for example `/mnt/NAS/Music,/mnt/USB/Music,/mnt/INTERNAL`.
- **Maximum albums shown**: maximum number of albums shown in each view. Values above 1000 are capped.
- **Maximum folder depth**: how many folder levels below each configured root to scan. The default is 3 and values above 5 are capped.
- **Excluded folder names**: comma-separated folder names skipped while scanning, for example `#recycle,@eaDir,.AppleDouble,video,Sounds`.

Press **Save and rescan** after changing settings.

Avoid setting a root such as `/`, `/mnt`, or another broad filesystem path. The scanner is intentionally bounded, but it is designed for music library roots rather than whole-disk crawling.

## Usage

1. Open **Browse** in Volumio.
2. Open **Recently Added**.
3. Choose **Recently Added Albums**, **Albums by Artist**, or **Albums by Title**.
4. Open an album.
5. Play an individual track, or use **Play Album** at the top of the album track list.

Album rows are browse-only. This test build does not make the album row itself playable because that caused Volumio to treat the whole album list as a playback queue instead of opening the selected album.

## Album Artwork

The plugin asks Volumio's album-art service for artwork on album rows, track rows, and the **Play Album** row. It looks for common image names such as `cover.jpg`, `folder.jpg`, `front.jpg`, `album.jpg`, and `artwork.png` in the album folder or disc folders. If no cover image is found, it falls back to the first audio file so Volumio can try embedded artwork.

Artwork paths are passed to Volumio using MPD-relative paths such as `NAS/Music/Artist/Album/cover.jpg`, plus artist and album hints. Artwork support is still best-effort because this plugin scans folders directly rather than using Volumio's library album records.

## Track Ordering

For FLAC files, the plugin tries to read:

- `DISCNUMBER`
- `TRACKNUMBER`
- `TITLE`

It does this with `metaflac`. If `metaflac` is not installed, cannot read a file, or the file is not FLAC, the plugin falls back to filename-based ordering.

Filename fallback supports common patterns such as:

- `01 - Track.flac`
- `1. Track.flac`
- `1-01 Track.flac`
- `101 Track.flac`

## Privacy And Security

The plugin does not store a persistent album cache. It scans on startup and when settings are saved.

Album browse URIs use short in-memory IDs for the current scan rather than Base64-encoded filesystem paths. Track rows still need MPD-compatible file URIs so Volumio can play the selected track.

Configuration values necessarily contain the scan paths you enter. Do not share logs, screenshots of URLs, or configuration files publicly without reviewing them first.

## Troubleshooting

If the plugin does not appear, restart Volumio and hard-refresh the browser.

```bash
volumio vrestart
```

Check plugin logs with:

```bash
journalctl -u volumio -f
```

Useful checks from the plugin directory:

```bash
node -c index.js
node -e "require('kew'); require('v-conf'); console.log('dependencies ok')"
which metaflac
```

If no albums appear:

- Confirm each configured path exists on the Volumio device.
- Confirm the Volumio user can read the folders.
- Confirm the maximum folder depth matches your library layout.
- Check excluded folder names.
- Remember that only folders containing audio files directly, or parent folders containing disc subfolders with audio files, are treated as albums.

## Development

`scanner-test.js` is a local helper for checking scan behavior without running Volumio:

```bash
node scanner-test.js "/mnt/NAS/Music,/mnt/USB/Music" 3 "#recycle,@eaDir,.AppleDouble"
```

Before publishing or submitting:

```bash
node -c index.js
npm install --production --no-audit --no-fund
volumio plugin install
volumio plugin submit
```

Remove `node_modules` before committing source to GitHub unless you are packaging a Volumio zip that explicitly requires bundled dependencies.

## License

MIT
