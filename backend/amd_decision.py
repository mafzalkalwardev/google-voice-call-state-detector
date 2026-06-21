import time

VOICEMAIL_PHRASES = [
    "your call has been forwarded",
    "please leave your message",
    "leave a message",
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

VOICEMAIL_TONE_CONTEXT_PHRASES = [
    "leave a message",
    "record your message",
    "mailbox",
    "voice message system",
    "not available",
    "unavailable",
    "the person you are trying to reach",
]

CALL_SCREENING_PHRASES = [
    "state your name",
    "please state your name",
    "say your name",
    "google voice will try to connect you",
    "try to connect you",
    "after the tone and google voice will try to connect you",
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
    if detect_call_screening_phrase(normalized)[0]:
        return False, ""
    for phrase in VOICEMAIL_PHRASES:
        if phrase in normalized:
            return True, phrase
    tone_phrase = (
        "after the tone" in normalized
        or "at the tone" in normalized
        or "after the beep" in normalized
        or "at the beep" in normalized
    )
    if tone_phrase:
        for phrase in VOICEMAIL_TONE_CONTEXT_PHRASES:
            if phrase in normalized:
                return True, f"tone + {phrase}"
    return False, ""


def detect_call_screening_phrase(text: str):
    normalized = normalize_text(text)
    for phrase in CALL_SCREENING_PHRASES:
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
    screening_found, screening_phrase = detect_call_screening_phrase(text)
    if screening_found:
        return {
            "classification": "call_screening_prompt",
            "confidence": 0.94,
            "reason": f"Google Voice call screening phrase detected: {screening_phrase}.",
            "provider": "rules",
            "voicemailPhraseDetected": False,
            "callScreeningDetected": True,
        }

    voicemail_found, phrase = detect_voicemail_phrase(text)
    if voicemail_found:
        return {
            "classification": "voicemail_greeting",
            "confidence": 0.92,
            "reason": f"Transcript contains voicemail phrase: {phrase}.",
            "provider": "rules",
            "voicemailPhraseDetected": True,
            "callScreeningDetected": False,
        }

    human_found, greeting = detect_human_greeting(text)
    if human_found and len(normalize_text(text).split()) <= 8:
        return {
            "classification": "human_greeting",
            "confidence": 0.72,
            "reason": f"Short human-like greeting detected: {greeting}.",
            "provider": "rules",
            "voicemailPhraseDetected": False,
            "callScreeningDetected": False,
        }

    return {
        "classification": "unknown",
        "confidence": 0.25,
        "reason": "No decisive rule-based AMD phrase found.",
        "provider": "rules",
        "voicemailPhraseDetected": False,
        "callScreeningDetected": False,
    }


def backend_update(
    transcript="",
    partial="",
    classifier=None,
    deepgram_connected=False,
    reason="",
    backend_connected=True,
    deepgram_error="",
    deepgram_last_event="",
    backend_last_error="",
):
    classifier = classifier or classify_transcript_rules(transcript or partial)
    voicemail_phrase_detected = bool(classifier.get("voicemailPhraseDetected"))
    call_screening_detected = bool(classifier.get("callScreeningDetected"))
    final_state = "unknown"
    recommended_action = "wait"

    if classifier["classification"] == "call_screening_prompt" or call_screening_detected:
        final_state = "call_screening_prompt"
        recommended_action = "say_name_then_continue_waiting"
    elif classifier["classification"] == "voicemail_greeting" or voicemail_phrase_detected:
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
        "callScreeningDetected": call_screening_detected,
        "classification": classifier["classification"],
        "finalAmdState": final_state,
        "recommendedAction": recommended_action,
        "confidence": classifier["confidence"],
        "reason": reason or classifier["reason"],
        "provider": classifier.get("provider", "rules"),
        "backendConnected": backend_connected,
        "deepgramConnected": deepgram_connected,
        "deepgramError": deepgram_error,
        "deepgramLastEvent": deepgram_last_event,
        "backendLastError": backend_last_error,
    }
