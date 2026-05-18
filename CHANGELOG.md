# Changelog

## 0.1.1

- Added best-effort album artwork lookup for album and track rows using common cover image files first, then the first audio file for embedded artwork fallback.
- Added an experimental **Enable album-level playback** setting. It is off by default so the original track-level playback behaviour is preserved.
- Documented artwork and album-level playback limitations for Volumio 4 users.

## 0.1.0

- Prepared initial public Volumio 4 / Bookworm source tree.
- Replaced personal path defaults with generic Volumio examples.
- Removed persistent album cache storage.
- Replaced Base64 path-based album browse IDs with short in-memory scan IDs.
- Preserved the three browse views and track-level playback model from v17.
- Updated package metadata for Bookworm, Node.js 20, and Volumio 4.
- Rewrote README for public installation, configuration, troubleshooting, and privacy notes.
