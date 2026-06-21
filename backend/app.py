import asyncio
import os

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from amd_decision import backend_update, classify_transcript_rules
from deepgram_live import DeepgramBridge, extract_transcript, get_deepgram_key
from llm_classifier import classify_transcript, env_bool, get_env_any

load_dotenv()


class TranscriptRequest(BaseModel):
    transcript: str = Field(default="", max_length=2000)


app = FastAPI(title="Google Voice AMD Backend")


def env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def env_debug() -> bool:
    return env_bool("AMD_DEBUG", False)


def debug_log(*parts):
    if env_debug():
        print("[GV AMD backend]", *parts)


def safe_error(exc: Exception) -> str:
    text = str(exc) or exc.__class__.__name__
    for value in [
        os.getenv("DEEPGRAM_API_KEY", ""),
        os.getenv("Deepgram_API_KEY", ""),
        os.getenv("XAI_API_KEY", ""),
        os.getenv("OPENAI_API_KEY", ""),
        os.getenv("OpenAI_api_key", ""),
    ]:
        if value:
            text = text.replace(value, "[redacted]")
    return text[:240]


@app.get("/health")
async def health():
    return {
        "ok": True,
        "deepgram_key_found": bool(get_deepgram_key()),
        "xai_key_found": bool(get_env_any("XAI_API_KEY")),
        "openai_key_found": bool(get_env_any("OPENAI_API_KEY", "OpenAI_api_key", "OPENAI_api_key")),
        "ai_enabled": env_bool("AMD_AI_ENABLED", False),
        "stt_provider": os.getenv("AMD_STT_PROVIDER", "deepgram"),
    }


@app.post("/classify-transcript")
async def classify_transcript_endpoint(payload: TranscriptRequest):
    transcript = payload.transcript.strip()
    rules = classify_transcript_rules(transcript)
    result = rules if rules["classification"] != "unknown" else await classify_transcript(transcript)
    return {
        "classification": result["classification"],
        "confidence": result["confidence"],
        "reason": result["reason"],
        "provider": result.get("provider", "rules"),
    }


@app.websocket("/ws/amd-audio")
async def amd_audio_ws(websocket: WebSocket):
    await websocket.accept()

    sample_rate = env_int("AMD_SAMPLE_RATE", 16000)
    bridge = DeepgramBridge(sample_rate=sample_rate)
    deepgram_ok = False
    final_transcript_parts = []
    partial_transcript = ""
    send_lock = asyncio.Lock()

    async def send_json(payload: dict):
        async with send_lock:
            await websocket.send_json(payload)

    try:
        if os.getenv("AMD_STT_PROVIDER", "deepgram").lower() != "deepgram":
            await send_json(backend_update(
                reason="Only AMD_STT_PROVIDER=deepgram is implemented.",
                deepgram_connected=False,
            ))
        else:
            try:
                deepgram_ok, reason = await bridge.connect()
            except Exception as exc:
                deepgram_ok = False
                reason = safe_error(exc)
                debug_log("Deepgram connection failed:", reason)

            await send_json(backend_update(
                reason=reason,
                deepgram_connected=deepgram_ok,
                deepgram_error="" if deepgram_ok else reason,
                deepgram_last_event="connect_ok" if deepgram_ok else "connect_error",
            ))

        async def browser_to_deepgram():
            while True:
                message = await websocket.receive()
                if "bytes" in message and message["bytes"]:
                    if deepgram_ok:
                        await bridge.send_audio(message["bytes"])
                elif "text" in message and message["text"]:
                    # Control messages are accepted for future tuning; no secrets are expected here.
                    continue
                elif message.get("type") == "websocket.disconnect":
                    break

        async def deepgram_to_browser():
            while deepgram_ok:
                try:
                    data = await bridge.recv()
                except Exception as exc:
                    error = safe_error(exc)
                    debug_log("Deepgram receive failed:", error)
                    await send_json(backend_update(
                        reason="Deepgram receive failed.",
                        deepgram_connected=False,
                        deepgram_error=error,
                        deepgram_last_event="receive_error",
                    ))
                    break
                if not data:
                    continue
                transcript, is_final = extract_transcript(data)
                event_name = data.get("type") or ("transcript_final" if is_final else "transcript_partial")
                if not transcript:
                    await send_json(backend_update(
                        reason="Deepgram event received without transcript.",
                        deepgram_connected=True,
                        deepgram_last_event=event_name,
                    ))
                    continue

                nonlocal partial_transcript
                if is_final:
                    final_transcript_parts.append(transcript)
                    partial_transcript = ""
                else:
                    partial_transcript = transcript

                full_transcript = " ".join(final_transcript_parts).strip()
                classifier_input = full_transcript or partial_transcript
                classifier = await classify_transcript(classifier_input)
                await send_json(backend_update(
                    transcript=full_transcript,
                    partial=partial_transcript,
                    classifier=classifier,
                    deepgram_connected=True,
                    deepgram_last_event=event_name,
                ))

        tasks = [asyncio.create_task(browser_to_deepgram())]
        if deepgram_ok:
            tasks.append(asyncio.create_task(deepgram_to_browser()))

        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in done:
            task.result()
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        error = safe_error(exc)
        debug_log("Backend websocket error:", error)
        try:
            await send_json(backend_update(
                reason="Backend audio websocket error.",
                deepgram_connected=False,
                backend_last_error=error,
            ))
        except Exception:
            pass
    finally:
        await bridge.close()


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("AMD_BACKEND_HOST", "127.0.0.1")
    port = env_int("AMD_BACKEND_PORT", 8787)
    uvicorn.run("app:app", host=host, port=port, reload=True)
