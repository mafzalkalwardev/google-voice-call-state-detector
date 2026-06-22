# Chrome Web Store Publish Checklist

## Package

ZIP file:

```text
dist/gv-amd-detector-chrome-web-store-v1.0.0.zip
```

The ZIP root must contain `manifest.json` directly.

## Files Included

- `manifest.json`
- `background.js`
- `content.js`
- `offscreen.html`
- `offscreen.js`
- `overlay.css`
- `popup.html`
- `popup.js`
- `icons/icon.svg`
- `icons/icon16.png`
- `icons/icon32.png`
- `icons/icon48.png`
- `icons/icon128.png`

## Files Excluded

- `.env`
- `.env.example`
- `backend/`
- `backend/.env`
- `backend/.venv/`
- `.venv/`
- `.git/`
- `node_modules/`
- `__pycache__/`
- generated `.wav` / `.mp3` samples
- debug recordings
- logs
- docs not required by runtime
- screenshots/source files not required by runtime

## Permission Justification

- `storage`: stores detector settings, latest summary, and safe status metadata.
- `tabs`: finds the active Google Voice tab for tab audio capture.
- `activeTab`: limits user-triggered tab interaction to the active tab.
- `tabCapture`: captures tab audio after the user clicks Start Audio.
- `offscreen`: runs Web Audio analysis in Manifest V3 without recording audio.
- `https://voice.google.com/*`: injects the detector only on Google Voice.

## Privacy Checklist

- No API keys in extension files.
- No `.env` files in ZIP.
- Raw audio is not recorded by default.
- Local tab audio metrics are computed in memory.
- Optional backend transcription is user-run and backend-based.
- Backend/API keys remain outside the Chrome extension package.

## Manual Chrome Web Store Upload Steps

1. Go to Chrome Web Store Developer Dashboard.
2. Create or select the item.
3. Upload `dist/gv-amd-detector-chrome-web-store-v1.0.0.zip`.
4. Fill store listing fields from `docs/STORE_LISTING_FINAL.md`.
5. Upload screenshots captured manually from the extension overlay and popup.
6. Complete privacy and permission disclosures.
7. Submit for review.

## Reviewer Test Instructions

Use `docs/REVIEWER_TEST_INSTRUCTIONS.md`.

## Known Limitations

GV AMD Detector is a heuristic AMD helper and diagnostic tool. It does not guarantee perfect human-vs-voicemail detection. Google Voice UI changes, browser tab audio behavior, microphone/speaker routing, and backend availability can affect results.
