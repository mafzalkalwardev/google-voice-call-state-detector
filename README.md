# Google Voice Real Call State Detector

A Manifest V3 Chrome extension for Google Voice answering machine detection (AMD).

It runs on `https://voice.google.com/*`, confirms whether a call session is active from the DOM, and uses optional local tab-audio heuristics to classify:

- `still_ringing`
- `human_picked`
- `voicemail_detected`
- `no_answer`
- `busy_or_failed`
- `ended`
- `unknown`

The extension does not record or save audio.

## DOM Session States

The DOM engine intentionally stays conservative:

- `idle`
- `dialpad_ready`
- `incoming_ringing`
- `active_call_ui`
- `voicemail_player_or_inbox`
- `ended`
- `unknown_transition`

Google Voice can show the same active UI while an outbound call is ringing, answered by a person, or playing voicemail. DOM only confirms the session. Audio/AMD decides human vs voicemail.

## Audio States

- `audio_not_started`
- `audio_started`
- `audio_silence`
- `audio_ringback_like`
- `audio_speech_like`
- `audio_beep_like`
- `audio_busy_like`
- `audio_unknown`
- `audio_error`
- `audio_stopped`

Audio analysis is local and ephemeral through `chrome.tabCapture`, an offscreen document, `AudioContext`, and `AnalyserNode`.

## Install Or Reload

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on Developer Mode.
4. Click `Load unpacked`.
5. Select the `google-voice-call-state-detector` folder.
6. After code changes, click the extension reload icon on `chrome://extensions`.
7. Reload `https://voice.google.com/`.

## Start Tab Audio

Either:

1. Keep the Google Voice tab active.
2. Click the extension icon.
3. Click `Start Tab Audio Analysis`.

Or use the floating overlay:

1. Click `Start Audio`.
2. Click `Stop Audio` when finished.

## Real-Time Debug Events

AMD event:

```js
window.addEventListener("GV_AMD_STATE_UPDATE", e => console.log(e.detail));
```

Backward-compatible call-state event:

```js
window.addEventListener("GV_CALL_STATE_UPDATE", e => console.log(e.detail));
```

Page message event:

```js
window.addEventListener("message", e => {
  if (e.data?.type === "GV_AMD_STATE_UPDATE") console.log(e.data.payload);
});
```

## Manual Testing Checklist

Test A: Open Google Voice dialpad only.

Expected:

- `domState = dialpad_ready`
- `finalAmdState = unknown`
- not `active_call_ui`

Test B: Start outbound call while ringing.

Expected:

- `domState = active_call_ui`
- `audioState = audio_ringback_like` or `audio_unknown`
- `finalAmdState = still_ringing` when ringback pattern is detected

Test C: Human says hello.

Expected:

- `audioState = audio_speech_like`
- `finalAmdState = human_picked` only after short speech plus short pause and no beep/voicemail phrase

Test D: Voicemail greeting.

Expected:

- long speech, voicemail phrase, or beep causes `finalAmdState = voicemail_detected`

Test E: Hang up.

Expected:

- `domState = ended` or `idle`
- `finalAmdState = ended`

## Optional Backend

The optional FastAPI backend in `backend/` can classify short transcript text only. It does not receive raw audio by default.

Local env files are ignored:

- `.env`
- `backend/.env`

Create local config from:

- `.env.example`
- `backend/.env.example`

The backend reads `XAI_API_KEY` from environment variables only. Never put API keys in extension files.

Run:

```bash
pip install -r backend/requirements.txt
uvicorn backend.app:app --reload --port 8787
```

Health check returns boolean key status only.

## Safety

Use only on calls you are legally allowed to monitor. This extension detects UI/audio state only and does not record audio.
