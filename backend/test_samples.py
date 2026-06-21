from pathlib import Path

from amd_decision import classify_transcript_rules
from generate_samples import main as generate_samples
from sample_library import SAMPLE_ROOT


EXPECTED_TEXT = {
    "voicemail": "voicemail_greeting",
    "human": "human_greeting",
}


def test_text_fixtures():
    failures = 0
    for folder, expected in EXPECTED_TEXT.items():
        for path in (SAMPLE_ROOT / folder).glob("*.txt"):
            result = classify_transcript_rules(path.read_text(encoding="utf-8"))
            actual = result["classification"]
            ok = actual == expected
            print(f"{path.relative_to(SAMPLE_ROOT)} expected={expected} actual={actual} ok={ok}")
            failures += 0 if ok else 1
    return failures


def test_screening_and_tone_context_rules():
    cases = [
        (
            "Hello. Please state your name after the tone, and Google Voice will try to connect you.",
            "call_screening_prompt",
        ),
        ("Please wait after the tone.", "unknown"),
        ("Please leave a message after the tone.", "voicemail_greeting"),
        ("The person you are trying to reach is unavailable.", "voicemail_greeting"),
    ]
    failures = 0
    for text, expected in cases:
        result = classify_transcript_rules(text)
        actual = result["classification"]
        ok = actual == expected
        print(f"phrase expected={expected} actual={actual} ok={ok}")
        failures += 0 if ok else 1
    return failures


def test_audio_fixture_presence():
    checks = {
        "ringback": "still_ringing",
        "busy": "busy_or_failed",
        "beep": "voicemail_detected",
        "noise": "unknown",
    }
    failures = 0
    for folder, expected in checks.items():
        files = list((SAMPLE_ROOT / folder).glob("*.wav"))
        ok = bool(files)
        print(f"{folder} expected={expected} wav_count={len(files)} ok={ok}")
        failures += 0 if ok else 1
    return failures


def main():
    generate_samples()
    failures = test_text_fixtures() + test_screening_and_tone_context_rules() + test_audio_fixture_presence()
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
