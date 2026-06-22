# Reviewer Test Instructions

## Load Extension

1. Unzip `dist/gv-amd-detector-chrome-web-store-v1.0.0.zip`.
2. Open Chrome.
3. Go to `chrome://extensions`.
4. Enable Developer Mode.
5. Click Load unpacked.
6. Select the unzipped folder containing `manifest.json`.

## Basic Google Voice Test

1. Open `https://voice.google.com/`.
2. Confirm the draggable GV AMD Detector overlay appears.
3. Open the Google Voice dialpad.
4. Expected result: DOM session state should show `dialpad_ready`.

## Local Audio Test

1. Keep the Google Voice tab active.
2. Click Start Audio in the overlay or popup.
3. Expected result: local audio state and metrics appear.
4. If there is no call audio, metrics may remain low or unknown.

## Backend Optional

The backend is optional and is not included in the Chrome Web Store package.

If the backend is not running:

- The extension should not crash.
- Connections should show backend disconnected/local-only mode.
- Local AMD metrics remain available.

If the backend is running separately:

- Connections can show backend/Deepgram status.
- Transcript evidence may appear when configured.

## Audio and Privacy

- Audio is not recorded by default.
- The extension computes local tab-audio metrics in memory.
- No API keys are inside the extension package.
- API keys are backend-only and not required to load or inspect the extension.

## AMD Disclaimer

GV AMD Detector is heuristic. It is an AMD helper and diagnostic detector, not a guarantee of perfect human-vs-voicemail classification.
