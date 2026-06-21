from pathlib import Path

from sample_library import SAMPLE_ROOT, busy_pattern, ensure_sample_dirs, low_noise, ringback_pattern, silence, tone, write_wav


def main():
    ensure_sample_dirs()
    write_wav(SAMPLE_ROOT / "ringback" / "synthetic-ringback.wav", ringback_pattern())
    write_wav(SAMPLE_ROOT / "busy" / "synthetic-busy.wav", busy_pattern())
    write_wav(SAMPLE_ROOT / "beep" / "synthetic-beep-1000hz.wav", tone(1000, 1.0, 0.35))
    write_wav(SAMPLE_ROOT / "beep" / "synthetic-beep-1400hz.wav", tone(1400, 1.0, 0.35))
    write_wav(SAMPLE_ROOT / "noise" / "silence.wav", silence(3.0))
    write_wav(SAMPLE_ROOT / "noise" / "low-noise.wav", low_noise(3.0))

    fixtures = {
        SAMPLE_ROOT / "voicemail" / "voicemail_phrase.txt": "Please leave your message after the tone.",
        SAMPLE_ROOT / "human" / "human_hello.txt": "Hello?",
    }
    for path, text in fixtures.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    print(f"Generated synthetic AMD samples under {SAMPLE_ROOT}")


if __name__ == "__main__":
    main()
