# Google Voice AMD Backend

FastAPI backend for live Google Voice AMD.

The Chrome extension streams local tab audio as 16 kHz mono PCM Int16 chunks to:

```text
ws://127.0.0.1:8787/ws/amd-audio
```

The backend forwards those chunks to Deepgram live transcription when `DEEPGRAM_API_KEY` is configured. It sends transcript and AMD evidence back to the extension.

## Security

- API keys are read from `backend/.env` or process environment only.
- API keys are never sent to the Chrome extension.
- Health checks return boolean key status only.
- Raw audio is streamed through memory and is not saved by default.
- Real call recordings should not be stored. `*.wav`, `*.mp3`, and `debug-recordings/` are ignored.

Correct environment names:

```env
OPENAI_API_KEY=
XAI_API_KEY=
DEEPGRAM_API_KEY=
AMD_BACKEND_HOST=127.0.0.1
AMD_BACKEND_PORT=8787
AMD_BACKEND_URL=http://127.0.0.1:8787
AMD_STT_PROVIDER=deepgram
AMD_AI_PROVIDER=xai
AMD_AI_ENABLED=true
AMD_SAMPLE_RATE=16000
AMD_NO_ANSWER_TIMEOUT_MS=30000
AMD_HUMAN_MAX_GREETING_MS=3500
AMD_VOICEMAIL_MIN_LONG_SPEECH_MS=5000
AMD_DEBUG=false
```

Backward-compatible reads exist for older names like `Deepgram_API_KEY` and `OpenAI_api_key`, but the correct names are `DEEPGRAM_API_KEY` and `OPENAI_API_KEY`.

Set `AMD_DEBUG=true` only for temporary local debugging. Logs are sanitized and must never include API keys.

## Setup

From `backend/`:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create `backend/.env` from `backend/.env.example`.

Run:

```powershell
python app.py
```

Or:

```powershell
uvicorn app:app --host 127.0.0.1 --port 8787 --reload
```

## Endpoints

```http
GET /health
```

Returns:

```json
{
  "ok": true,
  "deepgram_key_found": true,
  "xai_key_found": true,
  "openai_key_found": true
}
```

```http
POST /classify-transcript
```

Input:

```json
{ "transcript": "hello" }
```

Output:

```json
{
  "classification": "human_greeting",
  "confidence": 0.72,
  "reason": "Short human-like greeting detected.",
  "provider": "rules"
}
```

Google Voice call screening phrases return:

```json
{
  "classification": "call_screening_prompt",
  "confidence": 0.94,
  "reason": "Google Voice call screening phrase detected.",
  "provider": "rules"
}
```

```text
WebSocket /ws/amd-audio
```

Receives binary PCM Int16 chunks and sends `backend_amd_update` JSON messages.

## Samples

Generate synthetic local samples:

```powershell
python generate_samples.py
```

Run sample checks:

```powershell
python test_samples.py
```

These are synthetic calibration fixtures, not real call recordings.
