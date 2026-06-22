# Google Voice AMD Detector

A Manifest V3 Chrome extension plus optional FastAPI backend for live Google Voice answering machine detection.

The detector classifies:

- `still_ringing`
- `human_picked`
- `call_screening_prompt`
- `voicemail_detected`
- `no_answer`
- `busy_or_failed`
- `ended`
- `unknown`

DOM only confirms the Google Voice session state. Audio and transcript evidence decide human vs voicemail.

## Live Flow

```text
Google Voice call
-> content.js DOM session detector
-> Start Audio
-> chrome.tabCapture
-> offscreen.js local Web Audio metrics
-> 16 kHz mono PCM Int16 WebSocket stream
-> FastAPI /ws/amd-audio
-> Deepgram live transcription
-> voicemail phrase rules and optional xAI/OpenAI classifier
-> GV_AMD_STATE_UPDATE
```

No audio is recorded or saved by default.

## Backend Setup

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create `backend/.env` from `backend/.env.example`.

Use these exact key names:

```env
OPENAI_API_KEY=
XAI_API_KEY=
DEEPGRAM_API_KEY=
AMD_STT_PROVIDER=deepgram
AMD_AI_PROVIDER=xai
AMD_AI_ENABLED=true
AMD_BACKEND_PORT=8787
AMD_DEBUG=false
```

Run:

```powershell
python app.py
```

Or:

```powershell
uvicorn app:app --host 127.0.0.1 --port 8787 --reload
```

Health check:

```powershell
curl http://127.0.0.1:8787/health
```

The health endpoint returns boolean key status only.

## Reload Extension

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click reload on `Google Voice Real Call State Detector`.
4. Open or refresh `https://voice.google.com/`.
5. Confirm the draggable AMD overlay appears.

## UI

The overlay uses five compact tabs:

- Main: final AMD state, confidence, recommended action, and core call summary
- Connections: backend, Deepgram, OpenAI, and xAI/Grok status
- Metrics: live audio and timing diagnostics
- History: recent AMD transitions plus copy/download/clear controls
- Settings: audio controls, backend URL, debug mode, compact mode, and reset

## Start Live Audio

1. Start the backend.
2. Keep the Google Voice tab active.
3. Click `Start Audio` in the overlay or `Start Tab Audio Analysis` in the popup.
4. The overlay should show:
- `Backend WS = yes`
- `Deepgram = yes` when the key is valid and the Deepgram socket connects
- `Deepgram error`, `Deepgram event`, and `Backend error` explain failures without exposing API keys
- RMS, peak, dominant frequency, ZCR, tone stability, and audio frame count
   - last transcript text when Deepgram hears speech

If the backend is off, the extension still runs local AMD and shows backend disconnected.

## DevTools

```js
window.addEventListener("GV_AMD_STATE_UPDATE", e => console.log(e.detail));
```

Backward-compatible event:

```js
window.addEventListener("GV_CALL_STATE_UPDATE", e => console.log(e.detail));
```

## Manual Tests

Test A: Dialpad only

- Expected: `domState = dialpad_ready`
- Not expected: `active_call_ui`

Test B: Outbound ringing

- Expected: `domState = active_call_ui`
- Expected: `audioState = audio_ringback_like` or useful debug metrics
- Expected: `finalAmdState = still_ringing` when ringback pattern is detected

Test C: Human says hello

- Expected: `audioState = audio_speech_like`
- Deepgram may show `hello`, `hi`, or similar
- Expected: `finalAmdState = human_picked` only with short speech/pause and no voicemail evidence
- Expected: `recommendedAction = connect_agent`

Test D: Voicemail

- Expected: transcript phrase such as `please leave your message` or `after the tone`
- Expected: `finalAmdState = voicemail_detected`
- Expected: `recommendedAction = skip_or_hangup`

Test D2: Google Voice call screening

- Transcript example: `Please state your name after the tone, and Google Voice will try to connect you`
- Expected: `finalAmdState = call_screening_prompt`
- Expected: `recommendedAction = prompt_agent_to_say_name`
- Expected: `AMD phase = screening_prompt`, then `post_screening_wait` while it continues listening

Test E: Busy

- Expected: `audio_busy_like` or visible failure text
- Expected: `finalAmdState = busy_or_failed`

Test F: Hang up

- Expected: `domState = ended` or `idle`
- Expected: `finalAmdState = ended`

Test G: Backend off

- Expected: no crash
- Expected: `Backend WS = no`
- Expected: local audio metrics still update

## Sample Library

From `backend/`:

```powershell
python generate_samples.py
python test_samples.py
```

The generated samples are synthetic tones/text fixtures for calibration and regression tests.

## Chrome Web Store Preparation

### Test before packaging
1. Load the extension unpacked via `chrome://extensions`.
2. Visit `https://voice.google.com/` in a separate window.
3. Trigger each manual test case in the README and confirm expected states.
4. Open the popup and Connections tab to verify backend/API status indicators.

### Check for errors
- Open `chrome://extensions`, enable Developer Mode, and inspect the extension's service worker for console errors.
- Use the Offscreen document console if available for audio capture logs.
- Verify no uncaught exceptions appear when starting or stopping audio.

### Verify no API keys are included
- Search the extension folder for common API-key prefixes and your own development key strings.
- Confirm that `background.js`, `popup.js`, `content.js`, and `offscreen.js` do not contain hardcoded keys.
- Confirm `manifest.json` does not include `web_accessible_resources` that expose secrets.

### Zip extension safely
- Create a clean folder with only the files required by the extension.
- Include `manifest.json`, JS/CSS/HTML files, and icon assets.
- Exclude `node_modules`, `.env`, backend files, debug recordings, caches, and VCS folders.

### What not to include in the zip
- `.env`, `backend/`, `node_modules/`, `**pycache__/`, `.git/`, sample recordings, debug logs, and any temporary or credential files.

## Limitations

AMD is heuristic and needs real-call tuning. Google Voice UI can change, browser tab capture can vary by device, and speech/transcript timing affects human-vs-voicemail confidence. The system is designed to expose enough live metrics to tune thresholds safely.

Set `AMD_DEBUG=true` only when you need backend/offscreen debug logs. Debug output must never include API keys.

## Chrome Web Store Listing Draft

Short description:

```text
Live Google Voice AMD helper with local audio metrics, optional backend transcription, and compact call-state diagnostics.
```

Long description:

```text
GV AMD Detector helps users debug Google Voice web calls by detecting call session state, local tab-audio patterns, voicemail phrases, call screening prompts, busy/no-answer outcomes, and human pickup signals.

The extension adds a compact draggable overlay on voice.google.com with clear color-coded AMD states, live audio metrics, backend/Deepgram connection status, state history, and JSON snapshot tools.

Core detection runs locally in the browser. Optional transcript classification is handled by a local FastAPI backend, keeping API keys out of Chrome extension code.

This tool is intended for calls you are legally allowed to monitor and does not record audio by default.
```

Feature highlights:

- Compact tabbed overlay and popup
- Color-coded states for ringing, human pickup, voicemail, screening prompt, busy/failed, ended, and unknown
- Local tab-audio RMS/peak/frequency/tone metrics
- Optional Deepgram transcript support through local backend
- Copy/download diagnostic snapshots
- No API keys in extension files

## Privacy

- Tab audio is analyzed locally in the browser.
- Raw audio is not recorded or saved by default.
- Optional external transcription/classification is backend-based.
- API keys stay in local backend environment variables only.
- `.env` and `backend/.env` are ignored and must not be committed.

## Safety

Use only on calls you are legally allowed to monitor. Do not commit `.env` files or API keys. The extension detects UI/audio state and does not record audio.
