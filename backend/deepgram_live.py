import asyncio
import json
import os
from urllib.parse import urlencode

import websockets


def get_deepgram_key() -> str:
    return os.getenv("DEEPGRAM_API_KEY") or os.getenv("Deepgram_API_KEY") or ""


def deepgram_url(sample_rate: int = 16000) -> str:
    query = urlencode({
        "model": "nova-3",
        "language": "en-US",
        "encoding": "linear16",
        "sample_rate": sample_rate,
        "channels": 1,
        "interim_results": "true",
        "punctuate": "true",
        "smart_format": "true",
        "endpointing": 300,
        "utterance_end_ms": 1000,
    })
    return f"wss://api.deepgram.com/v1/listen?{query}"


def extract_transcript(message: dict):
    channel = message.get("channel") or {}
    alternatives = channel.get("alternatives") or []
    transcript = ""
    if alternatives:
        transcript = alternatives[0].get("transcript") or ""
    is_final = bool(message.get("is_final") or message.get("speech_final"))
    return transcript.strip(), is_final


class DeepgramBridge:
    def __init__(self, sample_rate: int = 16000):
        self.sample_rate = sample_rate
        self.ws = None
        self.connected = False
        self._lock = asyncio.Lock()

    async def connect(self):
        api_key = get_deepgram_key()
        if not api_key:
            return False, "DEEPGRAM_API_KEY missing"

        self.ws = await websockets.connect(
            deepgram_url(self.sample_rate),
            additional_headers={"Authorization": f"Token {api_key}"},
            ping_interval=20,
            ping_timeout=20,
            max_size=2**22,
        )
        self.connected = True
        return True, "Deepgram connected"

    async def send_audio(self, chunk: bytes):
        if not self.ws or not self.connected:
            return
        async with self._lock:
            await self.ws.send(chunk)

    async def recv(self):
        if not self.ws:
            return None
        raw = await self.ws.recv()
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    async def close(self):
        self.connected = False
        if self.ws:
            await self.ws.close()
        self.ws = None
