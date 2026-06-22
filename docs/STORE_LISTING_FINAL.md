# Chrome Web Store Listing

## Extension Name

GV AMD Detector

## Short Description

Live Google Voice AMD helper with local audio metrics and optional backend transcription diagnostics.

## Long Description

GV AMD Detector is a Manifest V3 Chrome extension that helps debug Google Voice web calls with live answering machine detection diagnostics.

The extension adds a compact draggable overlay to `voice.google.com` and displays color-coded AMD states such as still ringing, human picked up, voicemail detected, call screening prompt, no answer, busy or failed, ended, and unknown.

Detection combines conservative Google Voice session-state detection with local tab-audio metrics such as RMS, peak, dominant frequency, zero crossing rate, tone stability, speech duration, ringback duration, and silence after speech. Optional local backend integration can provide transcript evidence through Deepgram and text-only classification through server-side AI providers.

The extension does not record audio by default. API keys are not stored in the Chrome extension and are only used by an optional local backend that the user runs separately.

GV AMD Detector is intended for users who need live debugging and diagnostics for calls they are legally allowed to monitor.

## Feature Bullets

- Compact draggable Google Voice overlay.
- Color-coded AMD states and recommended actions.
- Local tab-audio metrics without recording audio.
- Optional local backend transcription and transcript classification.
- Call screening prompt detection.
- Copy/download JSON diagnostics.
- Popup and overlay connection status.
- Backend-off local-only mode.

## Privacy Disclosure

- The extension runs only on `https://voice.google.com/*`.
- Tab audio is analyzed locally after the user clicks Start Audio.
- Raw audio is not recorded or saved by default.
- Optional backend transcription requires a user-run local backend.
- API keys are never included in extension files.
- `.env` files are not included in the Chrome Web Store package.

## Permissions Explanation

- `storage`: saves extension settings and safe detector summaries.
- `tabs`: identifies the active Google Voice tab.
- `activeTab`: allows user-triggered interaction with the active tab.
- `tabCapture`: captures Google Voice tab audio after user action.
- `offscreen`: runs Web Audio processing in Manifest V3.
- `https://voice.google.com/*`: injects the detector only into Google Voice.

## Chrome Reviewer Testing Instructions

1. Load the extension unpacked from `dist/chrome-web-store/`.
2. Open `https://voice.google.com/`.
3. Confirm the overlay appears.
4. Open the dialpad and confirm the DOM session shows `dialpad_ready`.
5. Click Start Audio and confirm local metrics update if tab audio is present.
6. If no backend is running, confirm Connections shows local-only/disconnected mode without crashing.
7. Confirm popup opens and displays status tabs.
8. Confirm no API keys are bundled with the extension.

## Support / Contact

Support contact placeholder:

```text
support@example.com
```
