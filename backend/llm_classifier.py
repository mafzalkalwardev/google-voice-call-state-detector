import json
import os
import time

import httpx

from amd_decision import classify_transcript_rules

_cache = {}
_last_call_at = 0.0


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def get_env_any(*names: str) -> str:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return ""


async def classify_transcript(text: str):
    text = (text or "").strip()
    rules = classify_transcript_rules(text)
    if not text or rules["classification"] != "unknown":
        return rules

    if not env_bool("AMD_AI_ENABLED", False):
        return rules

    provider = os.getenv("AMD_AI_PROVIDER", "xai").strip().lower()
    if provider == "openai":
        api_key = get_env_any("OPENAI_API_KEY", "OpenAI_api_key", "OPENAI_api_key")
        base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com").rstrip("/")
        model = os.getenv("AMD_AI_MODEL", "gpt-4o-mini")
    else:
        api_key = get_env_any("XAI_API_KEY")
        base_url = os.getenv("AMD_AI_BASE_URL", "https://api.x.ai").rstrip("/")
        model = os.getenv("AMD_AI_MODEL", "grok-4.3")
        provider = "xai"

    if not api_key:
        return rules

    normalized = " ".join(text.lower().split())
    if normalized in _cache:
        return _cache[normalized]

    global _last_call_at
    now = time.time()
    if now - _last_call_at < 3:
        return rules
    _last_call_at = now

    body = {
        "model": model,
        "temperature": 0,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Classify this call-answer transcript as one of "
                    "human_greeting, voicemail_greeting, or unknown. "
                    "Return strict JSON only with classification, confidence, and reason."
                ),
            },
            {"role": "user", "content": text[:2000]},
        ],
        "response_format": {"type": "json_object"},
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{base_url}/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=body,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            parsed = json.loads(content)
    except Exception:
        return rules

    classification = parsed.get("classification", "unknown")
    if classification not in {"human_greeting", "voicemail_greeting", "unknown"}:
        classification = "unknown"

    result = {
        "classification": classification,
        "confidence": max(0.0, min(1.0, float(parsed.get("confidence", 0.0)))),
        "reason": str(parsed.get("reason", "LLM classified transcript."))[:240],
        "provider": provider,
        "voicemailPhraseDetected": classification == "voicemail_greeting",
    }
    _cache[normalized] = result
    return result
