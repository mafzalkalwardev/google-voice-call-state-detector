# Optional AMD Transcript Classifier Backend

This backend is optional. The Chrome extension does local AMD first and does not send raw audio here.

The current endpoint accepts short transcript text only:

```http
POST /classify-transcript
```

Response:

```json
{
  "enabled": false,
  "keyConfigured": false,
  "classification": "unknown",
  "confidence": 0.0,
  "reason": "AI transcript classification is disabled or no API key is configured."
}
```

## Setup

1. Create a local `backend/.env` file from `backend/.env.example`.
2. Put your real key in `backend/.env`.
3. Keep `AMD_AI_ENABLED=false` until you intentionally enable transcript classification.
4. Install dependencies:

```bash
pip install -r backend/requirements.txt
```

5. Run:

```bash
uvicorn backend.app:app --reload --port 8787
```

## Security

- Do not commit `backend/.env`.
- Do not put API keys in extension files.
- The health endpoint returns only boolean key status, never key values.
- Raw audio is not accepted by this endpoint.

## Future STT Placeholder

A future local transcription pipeline could add:

- WebSocket `/audio-stream`
- WebRTC VAD or Silero VAD
- faster-whisper or Vosk
- scipy/numpy tone analysis

Keep audio local and ephemeral unless explicitly enabled.
