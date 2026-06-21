# Google Voice AMD Detector

A Manifest V3 Chrome extension plus optional FastAPI backend for live Google Voice answering machine detection.

The detector classifies:

- `still_ringing`
- `human_picked`
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

## Start Live Audio

1. Start the backend.
2. Keep the Google Voice tab active.
3. Click `Start Audio` in the overlay or `Start Tab Audio Analysis` in the popup.
4. The overlay should show:
   - `Backend WS = yes`
   - `Deepgram = yes` when the key is valid and the Deepgram socket connects
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

## Limitations

AMD is heuristic and needs real-call tuning. Google Voice UI can change, browser tab capture can vary by device, and speech/transcript timing affects human-vs-voicemail confidence. The system is designed to expose enough live metrics to tune thresholds safely.

## Safety

Use only on calls you are legally allowed to monitor. Do not commit `.env` files or API keys. The extension detects UI/audio state and does not record audio.
