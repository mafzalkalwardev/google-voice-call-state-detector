import time

VOICEMAIL_PHRASES = [
    "your call has been forwarded",
    "please leave your message",
    "leave a message",
    "after the tone",
    "at the tone",
    "after the beep",
    "at the beep",
    "record your message",
    "voice message system",
    "mailbox",
    "mailbox is full",
    "not available",
    "unavailable",
    "the person you are trying to reach",
    "has not set up voicemail",
    "automatic voice message system",
    "you have reached",
    "please record",
    "when you are finished",
]

HUMAN_GREETINGS = [
    "hello",
    "hello?",
    "hi",
    "yes",
    "yeah",
    "who is this",
    "speaking",
    "good morning",
    "good afternoon",
    "good evening",
]


def normalize_text(text: str) -> str:
    return " ".join((text or "").lower().split())


def detect_voicemail_phrase(text: str):
    normalized = normalize_text(text)
    for phrase in VOICEMAIL_PHRASES:
        if phrase in normalized:
            return True, phrase
    return False, ""


def detect_human_greeting(text: str):
    normalized = normalize_text(text).strip(" .,!?:;")
    if not normalized:
        return False, ""

    for phrase in HUMAN_GREETINGS:
        if normalized == phrase or normalized.startswith(f"{phrase} "):
            return True, phrase
    return False, ""


def classify_transcript_rules(text: str):
    voicemail_found, phrase = detect_voicemail_phrase(text)
    if voicemail_found:
        return {
            "classification": "voicemail_greeting",
            "confidence": 0.92,
            "reason": f"Transcript contains voicemail phrase: {phrase}.",
            "provider": "rules",
            "voicemailPhraseDetected": True,
        }

    human_found, greeting = detect_human_greeting(text)
    if human_found and len(normalize_text(text).split()) <= 8:
        return {
            "classification": "human_greeting",
            "confidence": 0.72,
            "reason": f"Short human-like greeting detected: {greeting}.",
            "provider": "rules",
            "voicemailPhraseDetected": False,
        }

    return {
        "classification": "unknown",
        "confidence": 0.25,
        "reason": "No decisive rule-based AMD phrase found.",
        "provider": "rules",
        "voicemailPhraseDetected": False,
    }


def backend_update(transcript="", partial="", classifier=None, deepgram_connected=False, reason=""):
    classifier = classifier or classify_transcript_rules(transcript or partial)
    voicemail_phrase_detected = bool(classifier.get("voicemailPhraseDetected"))
    final_state = "unknown"
    recommended_action = "wait"

    if classifier["classification"] == "voicemail_greeting" or voicemail_phrase_detected:
        final_state = "voicemail_detected"
        recommended_action = "skip_or_hangup"
    elif classifier["classification"] == "human_greeting":
        final_state = "human_picked"
        recommended_action = "connect_agent"

    return {
        "type": "backend_amd_update",
        "ts": int(time.time() * 1000),
        "transcript": transcript,
        "partialTranscript": partial,
        "voicemailPhraseDetected": voicemail_phrase_detected,
        "classification": classifier["classification"],
        "finalAmdState": final_state,
        "recommendedAction": recommended_action,
        "confidence": classifier["confidence"],
        "reason": reason or classifier["reason"],
        "provider": classifier.get("provider", "rules"),
        "deepgramConnected": deepgram_connected,
    }
