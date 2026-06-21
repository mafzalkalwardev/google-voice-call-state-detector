import math
import wave
from pathlib import Path

from amd_decision import classify_transcript_rules

SAMPLE_ROOT = Path(__file__).parent / "samples"
SAMPLE_RATE = 16000


def ensure_sample_dirs():
    for name in ["ringback", "busy", "beep", "voicemail", "human", "noise"]:
        (SAMPLE_ROOT / name).mkdir(parents=True, exist_ok=True)


def write_wav(path: Path, samples, sample_rate: int = SAMPLE_RATE):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        frames = bytearray()
        for sample in samples:
            value = int(max(-1.0, min(1.0, sample)) * 32767)
            frames.extend(value.to_bytes(2, "little", signed=True))
        wav.writeframes(bytes(frames))


def tone(freq: float, seconds: float, amplitude: float = 0.35):
    total = int(SAMPLE_RATE * seconds)
    return [amplitude * math.sin(2 * math.pi * freq * i / SAMPLE_RATE) for i in range(total)]


def silence(seconds: float):
    return [0.0] * int(SAMPLE_RATE * seconds)


def low_noise(seconds: float, amplitude: float = 0.015):
    total = int(SAMPLE_RATE * seconds)
    return [amplitude * math.sin(2 * math.pi * 173 * i / SAMPLE_RATE) for i in range(total)]


def ringback_pattern(repeats: int = 3):
    samples = []
    for _ in range(repeats):
        samples += tone(440, 1.8, 0.25)
        samples += silence(2.2)
    return samples


def busy_pattern(repeats: int = 6):
    samples = []
    for _ in range(repeats):
        samples += tone(480, 0.5, 0.3)
        samples += silence(0.5)
    return samples


def classify_fixture_text(text: str):
    return classify_transcript_rules(text)
