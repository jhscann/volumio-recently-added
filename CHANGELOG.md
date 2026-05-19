# Changelog

## 0.2.0-beta.1

- Added best-effort album artwork lookup for album rows, track rows, and the in-album play row.
- Kept album rows browse-only so clicking an album opens its track list.
- Added a separate **Play Album** row inside each album view to test album playback without making album rows playable.

## 0.1.0

- Prepared initial public Volumio 4 / Bookworm source tree.
- Replaced personal path defaults with generic Volumio examples.
- Removed persistent album cache storage.
- Replaced Base64 path-based album browse IDs with short in-memory scan IDs.
- Preserved the three browse views and track-level playback model from v17.
- Updated package metadata for Bookworm, Node.js 20, and Volumio 4.
- Rewrote README for public installation, configuration, troubleshooting, and privacy notes.
