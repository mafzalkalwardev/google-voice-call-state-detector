import json
import os
from typing import Literal

import httpx
from fastapi import FastAPI
from pydantic import BaseModel, Field

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

if load_dotenv:
    load_dotenv()

Classification = Literal["human_greeting", "voicemail_greeting", "unknown"]


class TranscriptRequest(BaseModel):
    transcript: str = Field(default="", max_length=2000)


class TranscriptResponse(BaseModel):
    enabled: bool
    keyConfigured: bool
    classification: Classification
    confidence: float
    reason: str


app = FastAPI(title="GV AMD Optional Transcript Classifier")


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@app.get("/health")
async def health():
    return {
        "ok": True,
        "aiEnabled": env_bool("AMD_AI_ENABLED", False),
        "xaiKeyConfigured": bool(os.getenv("XAI_API_KEY")),
    }


@app.post("/classify-transcript", response_model=TranscriptResponse)
async def classify_transcript(payload: TranscriptRequest):
    enabled = env_bool("AMD_AI_ENABLED", False)
    api_key = os.getenv("XAI_API_KEY")
    key_configured = bool(api_key)

    if not enabled or not key_configured:
        return TranscriptResponse(
            enabled=enabled,
            keyConfigured=key_configured,
            classification="unknown",
            confidence=0.0,
            reason="AI transcript classification is disabled or no API key is configured.",
        )

    transcript = payload.transcript.strip()
    if not transcript:
        return TranscriptResponse(
            enabled=enabled,
            keyConfigured=key_configured,
            classification="unknown",
            confidence=0.0,
            reason="No transcript text supplied.",
        )

    base_url = os.getenv("AMD_AI_BASE_URL", "https://api.x.ai").rstrip("/")
    model = os.getenv("AMD_AI_MODEL", "grok-4.3")
    url = f"{base_url}/v1/chat/completions"

    system_prompt = (
        "Classify a short call transcript for answering machine detection. "
        "Return JSON only with classification, confidence, and reason. "
        "classification must be human_greeting, voicemail_greeting, or unknown."
    )

    request_body = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": transcript},
        ],
        "response_format": {"type": "json_object"},
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=request_body,
            )
            response.raise_for_status()
            data = response.json()
    except Exception:
        return TranscriptResponse(
            enabled=enabled,
            keyConfigured=key_configured,
            classification="unknown",
            confidence=0.0,
            reason="AI provider request failed.",
        )

    try:
        content = data["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        classification = parsed.get("classification", "unknown")
        if classification not in {"human_greeting", "voicemail_greeting", "unknown"}:
            classification = "unknown"
        confidence = float(parsed.get("confidence", 0.0))
        reason = str(parsed.get("reason", "AI classified transcript."))
    except Exception:
        return TranscriptResponse(
            enabled=enabled,
            keyConfigured=key_configured,
            classification="unknown",
            confidence=0.0,
            reason="AI provider returned non-JSON or unexpected JSON.",
        )

    return TranscriptResponse(
        enabled=enabled,
        keyConfigured=key_configured,
        classification=classification,
        confidence=max(0.0, min(1.0, confidence)),
        reason=reason[:240],
    )


# TODO: Future STT integration can add a WebSocket /audio-stream endpoint.
# Keep raw audio local/ephemeral unless the user explicitly enables streaming.
