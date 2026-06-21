"use strict";

(() => {
  const SELECTORS = {
    rootCandidates: ["div.root", "#gvPageRoot"],
    activeCallWrapper: ".active-call-wrapper",
    incomingCall: ".active-call-wrapper.incoming-call",
    outgoingOrActiveCall: ".active-call-wrapper.not-incoming-call",
    sidebar: "gv-call-sidebar, GV-CALL-SIDEBAR",
    makeCallPanel: "gv-make-call-panel",
    inCallStatus: "gv-in-call-status",
    voicemailPlayer: "gv-voicemail-player",
    overlayContainer: ".cdk-overlay-container",
    visuallyHidden: ".cdk-visually-hidden, .mat-mdc-visually-hidden"
  };

  const state = {
    paused: false,
    overlayMinimized: false,
    lastFinalState: null,
    lastActiveAt: 0,
    lastSummarySavedAt: 0,
    latestAudio: null,
    latestBackend: {
      backendConnected: false,
      deepgramConnected: false,
      deepgramError: "",
      deepgramLastEvent: "",
      backendLastError: "",
      transcript: {
        partial: "",
        final: "",
        lastText: ""
      },
      voicemailPhraseDetected: false,
      classification: "unknown",
      confidence: 0,
      reason: "Backend not connected. Local AMD only."
    },
    history: [],
    lastPayload: null,
    lastDomScan: 0
  };

  const OVERLAY_POSITION_KEY = "gvDetectorOverlayPosition";
  const NO_ANSWER_TIMEOUT_MS = 30000;
  const AMD_VOICEMAIL_MIN_LONG_SPEECH_MS = 5000;
  const STRONG_AUDIO_STATES = new Set([
    "audio_ringback_like",
    "audio_speech_like",
    "audio_beep_like",
    "audio_busy_like"
  ]);
  const VOICEMAIL_PHRASES = [
    "your call has been forwarded",
    "please leave your message",
    "after the tone",
    "at the tone",
    "leave a message",
    "record your message",
    "mailbox",
    "voice message system",
    "not available",
    "unavailable",
    "the person you are trying to reach",
    "has not set up voicemail",
    "mailbox is full"
  ];
  const amdTimeline = createAmdTimeline();

  const debouncedUpdate = debounce(() => updateState("mutation"), 120);

  function init() {
    createOverlay();
    updateState("init");

    const observer = new MutationObserver(() => {
      if (!state.paused) debouncedUpdate();
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "aria-label", "role", "style"]
      });
    }

    setInterval(() => {
      if (!state.paused) updateState("interval");
    }, 500);
  }

  function updateState(source) {
    if (state.paused) return;

    const dom = detectDomState();
    if (dom.domState === "active_call_ui" && amdTimeline.finalAmdState === "ended") {
      resetAmdTimeline();
    }
    const audio = getEffectiveAudioState();
    const amd = updateAmdTimeline(dom, audio);
    const ts = Date.now();

    if (dom.domState === "active_call_ui") {
      state.lastActiveAt = ts;
    }

    const payload = {
      type: "GV_CALL_STATE_UPDATE",
      source,
      ts,
      isoTime: new Date(ts).toISOString(),
      number: dom.number,
      timer: dom.timer || dom.elapsedA11y,
      domState: dom.domState,
      audioState: audio?.state || "audio_not_started",
      backendConnected: Boolean(state.latestBackend.backendConnected),
      deepgramConnected: Boolean(state.latestBackend.deepgramConnected),
      deepgramError: state.latestBackend.deepgramError || "",
      deepgramLastEvent: state.latestBackend.deepgramLastEvent || "",
      backendLastError: state.latestBackend.backendLastError || "",
      finalAmdState: amd.finalAmdState,
      finalState: amd.finalAmdState,
      confidence: amd.confidence,
      recommendedAction: getRecommendedAction(amd.finalAmdState),
      reason: amd.reason,
      transcript: state.latestBackend.transcript,
      metrics: getAmdMetrics(),
      signals: dom.signals,
      controls: dom.controls,
      dom,
      audio,
      amdTimeline: getAmdSnapshot(),
      history: state.history.slice(0, 25)
    };

    const changed = payload.finalAmdState !== state.lastFinalState ||
      dom.domState !== state.lastPayload?.dom?.domState ||
      audio?.state !== state.lastPayload?.audio?.state;

    if (changed) {
      addHistory(payload);
      payload.history = state.history.slice(0, 25);
    }

    state.lastFinalState = payload.finalAmdState;
    state.lastPayload = payload;

    renderOverlay(payload);
    dispatchPageEvents(payload);
    maybeSaveSummary(payload, changed);
  }

  function detectDomState() {
    const rootClass = getRootClass();
    const hasNoActiveCall = rootClass.includes("no-active-call");
    const ariaLabels = getAriaLabels();
    const buttonLabels = getButtonLabels();
    const bodyText = normalizeText(document.body?.innerText || "");

    const activeCallWrapper = document.querySelector(SELECTORS.activeCallWrapper);
    const incomingCall = document.querySelector(SELECTORS.incomingCall);
    const outgoingOrActiveCall = document.querySelector(SELECTORS.outgoingOrActiveCall);
    const sidebar = document.querySelector(SELECTORS.sidebar);
    const makeCallPanel = document.querySelector(SELECTORS.makeCallPanel);
    const inCallStatus = document.querySelector(SELECTORS.inCallStatus);
    const voicemailPlayer = document.querySelector(SELECTORS.voicemailPlayer);
    const overlayContainer = document.querySelector(SELECTORS.overlayContainer);

    const controls = collectActiveControls(buttonLabels, ariaLabels);
    const timer = extractTimer();
    const elapsedA11y = extractElapsedA11y();
    const number = extractLikelyPhoneNumber();
    const signals = [];

    if (hasNoActiveCall) signals.push("root no-active-call");
    if (visible(activeCallWrapper)) signals.push("active-call-wrapper visible");
    if (visible(incomingCall)) signals.push("incoming-call wrapper visible");
    if (visible(outgoingOrActiveCall)) signals.push("not-incoming-call wrapper visible");
    if (visible(sidebar)) signals.push("GV-CALL-SIDEBAR visible");
    if (visible(makeCallPanel)) signals.push("gv-make-call-panel visible");
    if (visible(inCallStatus)) signals.push("gv-in-call-status visible");
    if (visible(voicemailPlayer)) signals.push("gv-voicemail-player visible");
    if (visible(overlayContainer)) signals.push("cdk overlay container visible");
    if (timer) signals.push(`timer ${timer}`);
    if (elapsedA11y) signals.push(elapsedA11y);
    if (controls.length) signals.push(`controls ${controls.join(", ")}`);

    const hasIncomingText = bodyText.includes("incoming call");
    const hasAnswerDecline = hasAny(buttonLabels, ["answer"]) && hasAny(buttonLabels, ["decline", "ignore"]);
    const hasEndCall = hasAny(buttonLabels, ["end call", "hang up", "hangup"]);
    const hasActiveControls = hasAny(buttonLabels, ["mute", "hold", "transfer", "record"]);
    const hasOngoingText = bodyText.includes("ongoing call");
    const hasDialpadText = bodyText.includes("enter a name or number") || hasAny(buttonLabels, ["call", "keypad"]);
    const hasVoicemailText = bodyText.includes("voicemail") && (
      hasAny(ariaLabels, ["play voicemail", "pause voicemail"]) ||
      bodyText.includes("transcript")
    );
    const hasStrongActiveSignal = visible(outgoingOrActiveCall) ||
      hasOngoingText ||
      visible(inCallStatus) ||
      Boolean(timer) ||
      Boolean(elapsedA11y) ||
      hasEndCall ||
      hasActiveControls;
    const roleAlertIncoming = [...document.querySelectorAll("[role='alert']")]
      .some((el) => normalizeText(el.textContent).includes("incoming call"));

    let domState = "unknown_transition";
    let confidence = 0.35;
    let reason = "No known Google Voice call-state markers found.";

    if (visible(voicemailPlayer) || hasVoicemailText) {
      domState = "voicemail_player_or_inbox";
      confidence = 0.9;
      reason = "Voicemail player or voicemail transcript markers found.";
    } else if (visible(incomingCall) || hasIncomingText || hasAnswerDecline || roleAlertIncoming) {
      domState = "incoming_ringing";
      confidence = 0.88;
      reason = "Incoming call wrapper, text, alert, or Answer/Decline controls found.";
    } else if (hasStrongActiveSignal) {
      domState = "active_call_ui";
      confidence = 0.83;
      reason = "Strong active Google Voice call UI markers found.";
    } else if (visible(makeCallPanel) || (hasNoActiveCall && hasDialpadText)) {
      domState = "dialpad_ready";
      confidence = 0.78;
      reason = "Dialpad/search panel visible without strong active call controls.";
    } else if (hasNoActiveCall) {
      if (Date.now() - state.lastActiveAt < 4000) {
        domState = "ended";
        confidence = 0.75;
        reason = "Recently active call returned to no-active-call.";
      } else {
        domState = "idle";
        confidence = 0.82;
        reason = "Root has no-active-call and no active controls found.";
      }
    }

    return {
      domState,
      confidence,
      reason,
      rootClass,
      number,
      timer,
      elapsedA11y,
      controls: controls.slice(0, 60),
      signals
    };
  }

  function combineState(dom, audio) {
    if (dom.domState === "voicemail_player_or_inbox") {
      return {
        finalState: "voicemail_player_or_inbox",
        confidence: Math.max(dom.confidence, 0.9),
        reason: "Voicemail inbox/player markers found in DOM."
      };
    }

    if (dom.domState === "incoming_ringing") {
      return {
        finalState: "incoming_ringing",
        confidence: dom.confidence,
        reason: dom.reason
      };
    }

    if (["dialpad_ready", "idle", "ended"].includes(dom.domState)) {
      return {
        finalState: dom.domState,
        confidence: dom.confidence,
        reason: dom.reason
      };
    }

    if (dom.domState === "outbound_or_active_call_ui") {
      if (audio?.state === "audio_ringback_like") {
        return {
          finalState: "likely_still_ringing_audio",
          confidence: Math.min(0.95, ((dom.confidence + audio.confidence) / 2) + 0.12),
          reason: "Google Voice active call UI plus tab audio ringback-like pattern."
        };
      }

      if (audio?.state === "audio_beep_like") {
        return {
          finalState: "likely_voicemail_beep_audio",
          confidence: Math.min(0.95, ((dom.confidence + audio.confidence) / 2) + 0.12),
          reason: "Google Voice active call UI plus stable beep-like tone. Could be voicemail beep."
        };
      }

      if (audio?.state === "audio_speech_like") {
        return {
          finalState: "likely_human_or_speech_audio",
          confidence: Math.min(0.9, ((dom.confidence + audio.confidence) / 2) + 0.08),
          reason: "Google Voice active call UI plus speech-like audio. Could be human or voicemail greeting."
        };
      }

      if (audio?.state === "audio_silence") {
        return {
          finalState: "outbound_or_active_call_ui",
          confidence: dom.confidence,
          reason: "Google Voice active call UI found. Audio is currently silent."
        };
      }

      return {
        finalState: "outbound_or_active_call_ui",
        confidence: dom.confidence,
        reason: "Google Voice active call UI found. Start tab audio analysis for better outbound ringing, speech, and voicemail detection."
      };
    }

    return {
      finalState: "unknown_transition",
      confidence: Math.min(dom.confidence || 0.3, 0.45),
      reason: dom.reason || "Unknown transition."
    };
  }

  function createAmdTimeline() {
    return {
      callStartedAt: null,
      activeCallStartedAt: null,
      firstAudioAt: null,
      ringbackFirstAt: null,
      ringbackLastAt: null,
      ringbackTotalMs: 0,
      speechFirstAt: null,
      speechLastAt: null,
      speechSegments: [],
      currentSpeechStartedAt: null,
      longestSpeechMs: 0,
      totalSpeechMs: 0,
      silenceStartedAt: null,
      silenceAfterSpeechMs: 0,
      beepDetectedAt: null,
      busyDetectedAt: null,
      voicemailPhraseDetectedAt: null,
      lastTranscript: "",
      finalAmdState: "unknown",
      confidence: 0.25,
      reason: "Waiting for call session and audio."
    };
  }

  function resetAmdTimeline() {
    Object.assign(amdTimeline, createAmdTimeline());
  }

  function getEffectiveAudioState() {
    const audio = state.latestAudio || {
      state: "audio_not_started",
      confidence: 0,
      reason: "Tab audio analysis has not started.",
      ts: Date.now()
    };

    const ts = Date.now();
    if (audio.state === "audio_unknown" && isSpeechMetricActive(audio)) {
      const upgraded = {
        ...audio,
        state: "audio_speech_like",
        confidence: Math.max(0.58, audio.confidence || 0),
        reason: "Speech-like duration and active audio metrics detected.",
        upgradedFrom: "audio_unknown",
        ts
      };
      state.lastStrongAudio = {
        ...upgraded,
        lastSeenAt: ts
      };
      return upgraded;
    }

    if (STRONG_AUDIO_STATES.has(audio.state)) {
      state.lastStrongAudio = {
        ...audio,
        lastSeenAt: ts
      };
      return audio;
    }

    const lastStrong = state.lastStrongAudio;
    if (!lastStrong || ts - lastStrong.lastSeenAt > 2500) return audio;

    if (audio.state === "audio_silence" && lastStrong.state === "audio_speech_like") {
      const silenceStartedAt = amdTimeline.silenceStartedAt || ts;
      if (ts - silenceStartedAt < 1500) {
        return {
          ...lastStrong,
          confidence: Math.max(0.45, lastStrong.confidence - 0.1),
          smoothedFrom: "audio_silence",
          ts
        };
      }
    }

    if (audio.state === "audio_unknown" || audio.state === "audio_silence") {
      return {
        ...lastStrong,
        confidence: Math.max(0.45, lastStrong.confidence - 0.12),
        smoothedFrom: audio.state,
        ts
      };
    }

    return audio;
  }

  function isSpeechMetricActive(audio) {
    if (!audio) return false;
    return audio.speechLikeDurationMs >= 500 ||
      (audio.rms > 0.012 && audio.peak > 0.035 && audio.zcr > 0.02 && !audio.tone);
  }

  function updateAmdTimeline(dom, audio) {
    const ts = Date.now();
    const audioState = audio?.state || "audio_not_started";

    if (dom.domState === "active_call_ui") {
      amdTimeline.callStartedAt ||= ts;
      amdTimeline.activeCallStartedAt ||= ts;
    }

    if (audioState !== "audio_not_started" && audioState !== "audio_stopped") {
      amdTimeline.firstAudioAt ||= ts;
    }

    updateTranscriptEvidence(dom);

    if (audioState === "audio_ringback_like") {
      amdTimeline.ringbackFirstAt ||= ts;
      if (amdTimeline.ringbackLastAt) {
        amdTimeline.ringbackTotalMs += Math.min(1000, ts - amdTimeline.ringbackLastAt);
      }
      amdTimeline.ringbackLastAt = ts;
    }

    const speechLike = audioState === "audio_speech_like" || isSpeechMetricActive(audio);

    if (speechLike) {
      amdTimeline.speechFirstAt ||= ts;
      amdTimeline.speechLastAt = ts;
      amdTimeline.silenceStartedAt = null;
      amdTimeline.silenceAfterSpeechMs = 0;
      if (!amdTimeline.currentSpeechStartedAt) {
        amdTimeline.currentSpeechStartedAt = ts;
      }
      const currentMs = ts - amdTimeline.currentSpeechStartedAt;
      amdTimeline.longestSpeechMs = Math.max(amdTimeline.longestSpeechMs, currentMs);
      amdTimeline.totalSpeechMs = estimateTotalSpeechMs(ts);
    } else if (amdTimeline.currentSpeechStartedAt) {
      const endedAt = amdTimeline.speechLastAt || ts;
      const durationMs = Math.max(0, endedAt - amdTimeline.currentSpeechStartedAt);
      if (durationMs > 150) {
        amdTimeline.speechSegments.push({
          startedAt: amdTimeline.currentSpeechStartedAt,
          endedAt,
          durationMs
        });
      }
      amdTimeline.longestSpeechMs = Math.max(amdTimeline.longestSpeechMs, durationMs);
      amdTimeline.currentSpeechStartedAt = null;
      amdTimeline.totalSpeechMs = estimateTotalSpeechMs(ts);
    }

    if (audioState === "audio_silence") {
      amdTimeline.silenceStartedAt ||= ts;
      if (amdTimeline.speechLastAt) {
        amdTimeline.silenceAfterSpeechMs = ts - amdTimeline.speechLastAt;
      }
    } else if (!speechLike) {
      amdTimeline.silenceStartedAt = null;
    }

    if (audioState === "audio_beep_like") {
      amdTimeline.beepDetectedAt ||= ts;
    }

    if (audioState === "audio_busy_like" || detectStrongFailedDomText()) {
      amdTimeline.busyDetectedAt ||= ts;
    }

    const decision = decideAmdState(dom, audio, ts);
    amdTimeline.finalAmdState = decision.finalAmdState;
    amdTimeline.confidence = decision.confidence;
    amdTimeline.reason = decision.reason;

    return decision;
  }

  function updateTranscriptEvidence(dom) {
    const visibleText = normalizeText(document.body?.innerText || "");
    const backendText = normalizeText(state.latestBackend.transcript?.lastText || "");
    const text = `${visibleText} ${backendText}`.trim();
    amdTimeline.lastTranscript = (state.latestBackend.transcript?.lastText || visibleText).slice(0, 500);

    if (!amdTimeline.voicemailPhraseDetectedAt && VOICEMAIL_PHRASES.some((phrase) => text.includes(phrase))) {
      amdTimeline.voicemailPhraseDetectedAt = Date.now();
      dom.signals.push("voicemail phrase detected");
    }

    if (!amdTimeline.voicemailPhraseDetectedAt && state.latestBackend.voicemailPhraseDetected) {
      amdTimeline.voicemailPhraseDetectedAt = Date.now();
      dom.signals.push("backend voicemail phrase detected");
    }
  }

  function detectStrongFailedDomText() {
    const statusText = getActiveCallStatusText();
    return [
      "call failed",
      "could not be completed",
      "call could not be completed",
      "line busy",
      "busy signal",
      "call busy",
      "disconnected",
      "call disconnected"
    ].some((phrase) => statusText.includes(phrase));
  }

  function getActiveCallStatusText() {
    const selectors = [
      SELECTORS.activeCallWrapper,
      SELECTORS.inCallStatus,
      "[role='alert']",
      "[aria-live='assertive']",
      "[aria-live='polite']"
    ];

    return selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter(visible)
      .map((el) => normalizeText(el.textContent || el.getAttribute("aria-label") || ""))
      .join(" ");
  }

  function estimateTotalSpeechMs(ts) {
    const closedTotal = amdTimeline.speechSegments.reduce((sum, segment) => sum + segment.durationMs, 0);
    const currentTotal = amdTimeline.currentSpeechStartedAt ? ts - amdTimeline.currentSpeechStartedAt : 0;
    return closedTotal + currentTotal;
  }

  function decideAmdState(dom, audio, ts) {
    const audioState = audio?.state || "audio_not_started";
    const activeMs = amdTimeline.activeCallStartedAt ? ts - amdTimeline.activeCallStartedAt : 0;
    const hasSpeech = Boolean(amdTimeline.speechFirstAt);
    const shortSpeech = amdTimeline.longestSpeechMs >= 300 && amdTimeline.longestSpeechMs <= 3500;
    const shortPauseAfterSpeech = amdTimeline.silenceAfterSpeechMs >= 500 && amdTimeline.silenceAfterSpeechMs <= 2500;
    const longGreeting = amdTimeline.longestSpeechMs >= AMD_VOICEMAIL_MIN_LONG_SPEECH_MS ||
      amdTimeline.totalSpeechMs >= AMD_VOICEMAIL_MIN_LONG_SPEECH_MS;
    const ringbackBeforeSpeech = Boolean(amdTimeline.ringbackFirstAt && amdTimeline.speechFirstAt && amdTimeline.ringbackFirstAt < amdTimeline.speechFirstAt);

    if (dom.domState === "ended" || (dom.domState === "idle" && amdTimeline.activeCallStartedAt)) {
      return {
        finalAmdState: "ended",
        confidence: 0.9,
        reason: "Active call UI ended or returned to idle."
      };
    }

    if (dom.domState === "voicemail_player_or_inbox") {
      return {
        finalAmdState: "voicemail_detected",
        confidence: 0.88,
        reason: "Google Voice voicemail player or inbox markers are visible."
      };
    }

    if (state.latestBackend.classification === "voicemail_greeting" && state.latestBackend.confidence >= 0.75) {
      return {
        finalAmdState: "voicemail_detected",
        confidence: Math.max(0.82, state.latestBackend.confidence),
        reason: `Backend classified transcript as voicemail: ${state.latestBackend.reason}`
      };
    }

    if (amdTimeline.beepDetectedAt && hasSpeech) {
      return {
        finalAmdState: "voicemail_detected",
        confidence: 0.93,
        reason: "Beep-like tone detected after speech, which strongly suggests voicemail."
      };
    }

    if (amdTimeline.voicemailPhraseDetectedAt) {
      return {
        finalAmdState: "voicemail_detected",
        confidence: 0.9,
        reason: "Voicemail phrase detected in visible transcript/text."
      };
    }

    if (dom.domState === "active_call_ui" && longGreeting) {
      return {
        finalAmdState: "voicemail_detected",
        confidence: 0.8,
        reason: "Long continuous speech exceeded voicemail long-speech threshold."
      };
    }

    if (dom.domState === "active_call_ui" && hasSpeech && shortSpeech && shortPauseAfterSpeech && !amdTimeline.beepDetectedAt && !amdTimeline.voicemailPhraseDetectedAt) {
      return {
        finalAmdState: "human_picked",
        confidence: ringbackBeforeSpeech ? 0.82 : 0.72,
        reason: ringbackBeforeSpeech ?
          "Ringback was followed by a short speech greeting and a short pause with no voicemail evidence." :
          "Short speech greeting followed by a short pause with no voicemail evidence."
      };
    }

    if (
      dom.domState === "active_call_ui" &&
      state.latestBackend.classification === "human_greeting" &&
      state.latestBackend.confidence >= 0.68 &&
      !amdTimeline.beepDetectedAt &&
      !amdTimeline.voicemailPhraseDetectedAt &&
      !longGreeting
    ) {
      return {
        finalAmdState: "human_picked",
        confidence: Math.max(0.72, state.latestBackend.confidence),
        reason: `Backend classified transcript as a human greeting: ${state.latestBackend.reason}`
      };
    }

    if (dom.domState === "active_call_ui" && amdTimeline.ringbackFirstAt && !hasSpeech && !amdTimeline.beepDetectedAt) {
      if (activeMs >= NO_ANSWER_TIMEOUT_MS) {
        return {
          finalAmdState: "no_answer",
          confidence: 0.76,
          reason: "Ringback continued past the no-answer timeout without speech, beep, or busy signal."
        };
      }

      return {
        finalAmdState: "still_ringing",
        confidence: Math.min(0.85, 0.65 + (amdTimeline.ringbackTotalMs / 60000)),
        reason: "Active call UI with repeated ringback-like audio and no speech or beep yet."
      };
    }

    if (amdTimeline.busyDetectedAt) {
      return {
        finalAmdState: "busy_or_failed",
        confidence: audioState === "audio_busy_like" ? 0.78 : 0.68,
        reason: audioState === "audio_busy_like" ? "Busy-tone-like audio cadence detected." : "Visible active call status indicates failed, busy, or disconnected call."
      };
    }

    if (dom.domState === "incoming_ringing") {
      return {
        finalAmdState: "still_ringing",
        confidence: 0.82,
        reason: "Incoming ringing UI is visible."
      };
    }

    if (dom.domState === "dialpad_ready") {
      return {
        finalAmdState: "unknown",
        confidence: 0.5,
        reason: "Dialpad is ready; no active outbound call session."
      };
    }

    if (dom.domState === "idle") {
      return {
        finalAmdState: "unknown",
        confidence: 0.55,
        reason: "Google Voice appears idle."
      };
    }

    return {
      finalAmdState: "unknown",
      confidence: 0.35,
      reason: "Waiting for stronger AMD evidence."
    };
  }

  function getRecommendedAction(finalAmdState) {
    return {
      human_picked: "connect_agent",
      voicemail_detected: "skip_or_hangup",
      still_ringing: "keep_waiting",
      no_answer: "skip",
      busy_or_failed: "skip",
      ended: "cleanup",
      unknown: "wait"
    }[finalAmdState] || "wait";
  }

  function getAmdMetrics() {
    return {
      ringbackTotalMs: amdTimeline.ringbackTotalMs,
      longestSpeechMs: amdTimeline.longestSpeechMs,
      totalSpeechMs: amdTimeline.totalSpeechMs,
      silenceAfterSpeechMs: amdTimeline.silenceAfterSpeechMs,
      beepDetected: Boolean(amdTimeline.beepDetectedAt),
      busyDetected: Boolean(amdTimeline.busyDetectedAt),
      voicemailPhraseDetected: Boolean(amdTimeline.voicemailPhraseDetectedAt),
      rms: state.latestAudio?.rms || 0,
      peak: state.latestAudio?.peak || 0,
      zcr: state.latestAudio?.zcr || 0,
      dominantFrequency: state.latestAudio?.dominantFrequency || 0,
      toneStability: state.latestAudio?.toneStability || 0,
      frequencyVariance: state.latestAudio?.frequencyVariance || 0,
      rmsVariance: state.latestAudio?.rmsVariance || 0,
      silenceDurationMs: state.latestAudio?.silenceDurationMs || 0,
      toneDurationMs: state.latestAudio?.toneDurationMs || 0,
      speechLikeDurationMs: state.latestAudio?.speechLikeDurationMs || 0,
      audioFrameCount: state.latestAudio?.audioFrameCount || 0
    };
  }

  function getAmdSnapshot() {
    return {
      ...amdTimeline,
      metrics: getAmdMetrics()
    };
  }

  function maybeSaveSummary(payload, changed) {
    const ts = Date.now();
    if (!changed && ts - state.lastSummarySavedAt < 3000) return;

    state.lastSummarySavedAt = ts;
    chrome.storage.local.set({
      gvDetectorLatestState: {
        ts: payload.ts,
        isoTime: payload.isoTime,
        number: payload.number,
        timer: payload.timer,
        domState: payload.domState,
        audioState: payload.audioState,
        backendConnected: payload.backendConnected,
        deepgramConnected: payload.deepgramConnected,
        deepgramError: payload.deepgramError,
        deepgramLastEvent: payload.deepgramLastEvent,
        backendLastError: payload.backendLastError,
        finalAmdState: payload.finalAmdState,
        confidence: payload.confidence,
        recommendedAction: payload.recommendedAction,
        reason: payload.reason,
        transcript: payload.transcript,
        metrics: payload.metrics
      }
    }).catch(() => {});
  }

  function dispatchPageEvents(payload) {
    try {
      window.dispatchEvent(new CustomEvent("GV_CALL_STATE_UPDATE", {
        detail: payload
      }));
    } catch (err) {
      // Ignore page event failures.
    }

    try {
      window.postMessage({
        type: "GV_CALL_STATE_UPDATE",
        payload
      }, window.location.origin);
    } catch (err) {
      // Ignore postMessage failures.
    }

    try {
      window.dispatchEvent(new CustomEvent("GV_AMD_STATE_UPDATE", {
        detail: payload
      }));
    } catch (err) {
      // Ignore page event failures.
    }

    try {
      window.postMessage({
        type: "GV_AMD_STATE_UPDATE",
        payload
      }, "*");
    } catch (err) {
      // Ignore postMessage failures.
    }
  }

  function collectActiveControls(buttonLabels, ariaLabels) {
    const allLabels = [...buttonLabels, ...ariaLabels];
    const wanted = ["answer", "decline", "end call", "hang up", "mute", "hold", "transfer", "keypad", "record", "call", "play voicemail", "pause voicemail"];
    const found = new Set();

    for (const label of allLabels) {
      for (const item of wanted) {
        if (label.includes(item)) found.add(item);
      }
    }

    return [...found];
  }

  function getRootClass() {
    const roots = SELECTORS.rootCandidates
      .map((selector) => document.querySelector(selector))
      .filter(Boolean);

    return roots.map((el) => String(el.className || "")).join(" ");
  }

  function getAriaLabels() {
    return [...document.querySelectorAll("[aria-label]")]
      .map((el) => normalizeText(el.getAttribute("aria-label") || ""))
      .filter(Boolean);
  }

  function getButtonLabels() {
    return [...document.querySelectorAll("button, [role='button']")]
      .map((el) => normalizeText(el.getAttribute("aria-label") || el.innerText || el.textContent || ""))
      .filter(Boolean);
  }

  function hasAny(list, needles) {
    return list.some((item) => needles.some((needle) => item.includes(needle)));
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function visible(el) {
    if (!el) return false;

    const rect = el.getBoundingClientRect?.();
    const style = getComputedStyle(el);

    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      (!rect || (rect.width > 0 && rect.height > 0));
  }

  function extractTimer() {
    const text = document.body?.innerText || "";
    const matches = text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g);
    if (!matches) return null;

    const filtered = matches.filter((match) => {
      const parts = match.split(":").map(Number);
      if (parts.length === 2) return parts[0] <= 59 && parts[1] <= 59;
      if (parts.length === 3) return parts[0] <= 12 && parts[1] <= 59 && parts[2] <= 59;
      return false;
    });

    return filtered[0] || null;
  }

  function extractElapsedA11y() {
    const hiddenTexts = [...document.querySelectorAll(SELECTORS.visuallyHidden)]
      .map((el) => normalizeText(el.textContent || ""))
      .filter((text) => text.includes("elapsed time"));

    return hiddenTexts[0] || null;
  }

  function extractLikelyPhoneNumber() {
    const text = document.body?.innerText || "";
    const patterns = [
      /\(\d{3}\)\s*\d{3}-\d{4}/,
      /\+?\d[\d\s().-]{7,}\d/
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0].trim();
    }

    return null;
  }

  function addHistory(payload) {
    state.history.unshift({
      ts: payload.ts,
      time: new Date(payload.ts).toLocaleTimeString(),
      finalState: payload.finalState,
      finalAmdState: payload.finalAmdState,
      domState: payload.dom.domState,
      audioState: payload.audioState || payload.audio?.state || "audio_not_started",
      confidence: payload.confidence,
      reason: payload.reason
    });

    state.history = state.history.slice(0, 25);
  }

  function createOverlay() {
    if (document.getElementById("gv-detector-host")) return;

    const host = document.createElement("div");
    host.id = "gv-detector-host";
    host.style.pointerEvents = "none";
    document.documentElement.appendChild(host);

    const root = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        pointer-events: none;
      }
      .panel {
        position: fixed;
        left: 86px;
        bottom: 20px;
        width: min(360px, calc(100vw - 24px));
        max-height: 82vh;
        overflow: auto;
        z-index: 2147483647;
        pointer-events: auto;
        background: #111827;
        color: #f9fafb;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 8px;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.38);
        font-family: Arial, sans-serif;
        font-size: 12px;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 12px 14px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.04);
        position: sticky;
        top: 0;
        cursor: grab;
        user-select: none;
        touch-action: none;
      }
      .header.dragging {
        cursor: grabbing;
      }
      .title {
        flex: 1;
        min-width: 0;
        font-weight: 700;
        font-size: 14px;
      }
      .badge {
        padding: 4px 8px;
        border-radius: 8px;
        background: #2563eb;
        color: #fff;
        font-weight: 700;
        max-width: 190px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .body { padding: 12px 14px; }
      .row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
        border-bottom: 1px dashed rgba(255, 255, 255, 0.08);
        padding-bottom: 6px;
      }
      .key { color: #9ca3af; }
      .val { text-align: right; font-weight: 600; max-width: 230px; word-break: break-word; }
      .signals,
      .history {
        background: rgba(255, 255, 255, 0.06);
        border-radius: 8px;
        padding: 8px;
        margin-top: 8px;
        max-height: 150px;
        overflow: auto;
      }
      .history-item {
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        padding: 6px 0;
      }
      .history-item:last-child { border-bottom: 0; }
      .buttons {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 10px;
      }
      button {
        background: #374151;
        color: #f9fafb;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 8px;
        padding: 8px;
        cursor: pointer;
        font-size: 12px;
      }
      button:hover { background: #4b5563; }
      .minimize-btn {
        padding: 5px 8px;
        white-space: nowrap;
      }
      .panel.minimized {
        width: auto;
        min-width: 168px;
        max-width: calc(100vw - 24px);
        max-height: none;
        overflow: visible;
      }
      .panel.minimized .header {
        border-bottom: 0;
        padding: 8px;
        border-radius: 8px;
      }
      .panel.minimized .title,
      .panel.minimized .body {
        display: none;
      }
      .panel.minimized .badge {
        max-width: min(240px, calc(100vw - 112px));
      }
      .small { color: #9ca3af; font-size: 11px; line-height: 1.35; }
      .danger { color: #fca5a5; }
      ul { margin: 6px 0 0 16px; padding: 0; }
    `;

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
      <div class="header">
        <div class="title">GV AMD Detector</div>
        <div class="header-actions">
          <div class="badge" id="finalState">Starting...</div>
          <button class="minimize-btn" id="minimizeBtn">Minimize</button>
        </div>
      </div>
      <div class="body">
        <div class="row"><span class="key">DOM session</span><span class="val" id="domState">-</span></div>
        <div class="row"><span class="key">Audio</span><span class="val" id="audioState">-</span></div>
        <div class="row"><span class="key">Backend WS</span><span class="val" id="backendConnected">-</span></div>
        <div class="row"><span class="key">Deepgram</span><span class="val" id="deepgramConnected">-</span></div>
        <div class="row"><span class="key">Deepgram event</span><span class="val" id="deepgramLastEvent">-</span></div>
        <div class="row"><span class="key">Deepgram error</span><span class="val" id="deepgramError">-</span></div>
        <div class="row"><span class="key">Backend error</span><span class="val" id="backendLastError">-</span></div>
        <div class="row"><span class="key">Final AMD</span><span class="val" id="amdState">-</span></div>
        <div class="row"><span class="key">Confidence</span><span class="val" id="confidence">-</span></div>
        <div class="row"><span class="key">Number</span><span class="val" id="number">-</span></div>
        <div class="row"><span class="key">Timer</span><span class="val" id="timer">-</span></div>
        <div class="row"><span class="key">RMS</span><span class="val" id="rms">-</span></div>
        <div class="row"><span class="key">Peak</span><span class="val" id="peak">-</span></div>
        <div class="row"><span class="key">Dominant freq</span><span class="val" id="dominantFrequency">-</span></div>
        <div class="row"><span class="key">Zero crossing</span><span class="val" id="zcr">-</span></div>
        <div class="row"><span class="key">Tone stability</span><span class="val" id="toneStability">-</span></div>
        <div class="row"><span class="key">Audio frames</span><span class="val" id="audioFrameCount">-</span></div>
        <div class="row"><span class="key">Ringback</span><span class="val" id="ringbackMs">-</span></div>
        <div class="row"><span class="key">Speech total</span><span class="val" id="speechMs">-</span></div>
        <div class="row"><span class="key">Longest speech</span><span class="val" id="longestSpeechMs">-</span></div>
        <div class="row"><span class="key">Silence after speech</span><span class="val" id="silenceAfterSpeechMs">-</span></div>
        <div class="row"><span class="key">Beep detected</span><span class="val" id="beepDetected">-</span></div>
        <div class="row"><span class="key">Busy detected</span><span class="val" id="busyDetected">-</span></div>
        <div class="row"><span class="key">Voicemail phrase</span><span class="val" id="voicemailPhraseDetected">-</span></div>
        <div class="row"><span class="key">Last transcript</span><span class="val" id="lastTranscript">-</span></div>
        <div class="row"><span class="key">Recommended</span><span class="val" id="recommendedAction">-</span></div>
        <div class="row"><span class="key">Reason</span><span class="val" id="reason">-</span></div>
        <div class="small danger">AMD is heuristic. Audio is local and not recorded.</div>
        <div class="signals"><strong>Signals</strong><div id="signals">-</div></div>
        <div class="signals"><strong>Controls</strong><div id="controls">-</div></div>
        <div class="history"><strong>History</strong><div id="history">-</div></div>
        <div class="buttons">
          <button id="startAudioBtn">Start Audio</button>
          <button id="stopAudioBtn">Stop Audio</button>
          <button id="pauseBtn">Pause</button>
          <button id="copyBtn">Copy Snapshot</button>
          <button id="downloadBtn">Download JSON</button>
          <button id="clearBtn">Clear Logs</button>
        </div>
      </div>
    `;

    root.appendChild(style);
    root.appendChild(panel);

    restoreOverlayPosition(panel);
    installOverlayDragBehavior(root, panel);

    root.getElementById("minimizeBtn").addEventListener("click", () => {
      state.overlayMinimized = !state.overlayMinimized;
      panel.classList.toggle("minimized", state.overlayMinimized);
      root.getElementById("minimizeBtn").textContent = state.overlayMinimized ? "Expand" : "Minimize";
      clampAndApplyOverlayPosition(panel, readPanelPosition(panel), { save: true });
    });

    root.getElementById("startAudioBtn").addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "START_AUDIO_FROM_OVERLAY" }).catch(() => {});
    });

    root.getElementById("stopAudioBtn").addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "STOP_AUDIO_FROM_OVERLAY" }).catch(() => {});
    });

    root.getElementById("pauseBtn").addEventListener("click", () => {
      state.paused = !state.paused;
      root.getElementById("pauseBtn").textContent = state.paused ? "Resume" : "Pause";
      if (!state.paused) updateState("resume");
    });

    root.getElementById("copyBtn").addEventListener("click", async () => {
      const text = JSON.stringify(state.lastPayload || {}, null, 2);
      await navigator.clipboard.writeText(text).catch(() => {});
    });

    root.getElementById("downloadBtn").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({
        latest: state.lastPayload,
        history: state.history
      }, null, 2)], { type: "application/json" });

      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `gv-call-state-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    });

    root.getElementById("clearBtn").addEventListener("click", () => {
      state.history = [];
      renderOverlay(state.lastPayload);
    });
  }

  function restoreOverlayPosition(panel) {
    const saved = readSavedOverlayPosition();

    if (saved) {
      clampAndApplyOverlayPosition(panel, saved, { save: false });
      return;
    }

    panel.style.left = "86px";
    panel.style.right = "auto";
    panel.style.top = "auto";
    panel.style.bottom = "20px";
  }

  function readSavedOverlayPosition() {
    try {
      const value = JSON.parse(localStorage.getItem(OVERLAY_POSITION_KEY) || "null");
      if (Number.isFinite(value?.left) && Number.isFinite(value?.top)) return value;
    } catch (err) {
      // Ignore bad saved overlay coordinates and fall back to the default bottom-left position.
    }

    return null;
  }

  function saveOverlayPosition(position) {
    try {
      localStorage.setItem(OVERLAY_POSITION_KEY, JSON.stringify(position));
    } catch (err) {
      // localStorage can be unavailable in unusual browser/privacy modes.
    }
  }

  function readPanelPosition(panel) {
    const rect = panel.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top
    };
  }

  function clampAndApplyOverlayPosition(panel, position, options = {}) {
    const { save = true } = options;
    const rect = panel.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const next = {
      left: clamp(position.left, margin, maxLeft),
      top: clamp(position.top, margin, maxTop)
    };

    panel.style.left = `${next.left}px`;
    panel.style.top = `${next.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";

    if (save) saveOverlayPosition(next);
    return next;
  }

  function installOverlayDragBehavior(root, panel) {
    const header = root.querySelector(".header");
    let drag = null;

    // The header is the drag handle. During drag we convert the panel to explicit
    // top/left coordinates, clamp movement to the viewport, and persist the result.
    header.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;

      const rect = panel.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };

      header.setPointerCapture(event.pointerId);
      header.classList.add("dragging");
      document.documentElement.style.userSelect = "none";
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      event.preventDefault();
    });

    header.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;

      clampAndApplyOverlayPosition(panel, {
        left: event.clientX - drag.offsetX,
        top: event.clientY - drag.offsetY
      }, { save: false });

      event.preventDefault();
    });

    const finishDrag = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;

      header.releasePointerCapture(event.pointerId);
      header.classList.remove("dragging");
      document.documentElement.style.userSelect = "";
      clampAndApplyOverlayPosition(panel, readPanelPosition(panel), { save: true });
      drag = null;
    };

    header.addEventListener("pointerup", finishDrag);
    header.addEventListener("pointercancel", finishDrag);

    window.addEventListener("resize", () => {
      clampAndApplyOverlayPosition(panel, readPanelPosition(panel), { save: true });
    });
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function renderOverlay(payload) {
    const host = document.getElementById("gv-detector-host");
    const root = host?.shadowRoot;
    if (!root || !payload) return;

    setText(root, "finalState", payload.finalAmdState);
    setText(root, "domState", payload.domState);
    setText(root, "audioState", payload.audioState);
    setText(root, "backendConnected", payload.backendConnected ? "yes" : "no");
    setText(root, "deepgramConnected", payload.deepgramConnected ? "yes" : "no");
    setText(root, "deepgramLastEvent", payload.deepgramLastEvent || "-");
    setText(root, "deepgramError", payload.deepgramError || "-");
    setText(root, "backendLastError", payload.backendLastError || "-");
    setText(root, "amdState", payload.finalAmdState);
    setText(root, "confidence", `${Math.round((payload.confidence || 0) * 100)}%`);
    setText(root, "number", payload.number || "-");
    setText(root, "timer", payload.timer || "-");
    setText(root, "rms", formatNumber(payload.metrics?.rms, 5));
    setText(root, "peak", formatNumber(payload.metrics?.peak, 5));
    setText(root, "dominantFrequency", `${Math.round(payload.metrics?.dominantFrequency || 0)} Hz`);
    setText(root, "zcr", formatNumber(payload.metrics?.zcr, 5));
    setText(root, "toneStability", formatNumber(payload.metrics?.toneStability, 4));
    setText(root, "audioFrameCount", String(payload.metrics?.audioFrameCount || 0));
    setText(root, "ringbackMs", formatMs(payload.metrics?.ringbackTotalMs));
    setText(root, "speechMs", formatMs(payload.metrics?.totalSpeechMs));
    setText(root, "longestSpeechMs", formatMs(payload.metrics?.longestSpeechMs));
    setText(root, "silenceAfterSpeechMs", formatMs(payload.metrics?.silenceAfterSpeechMs));
    setText(root, "beepDetected", payload.metrics?.beepDetected ? "yes" : "no");
    setText(root, "busyDetected", payload.metrics?.busyDetected ? "yes" : "no");
    setText(root, "voicemailPhraseDetected", payload.metrics?.voicemailPhraseDetected ? "yes" : "no");
    setText(root, "lastTranscript", payload.transcript?.lastText || "-");
    setText(root, "recommendedAction", payload.recommendedAction || "-");
    setText(root, "reason", payload.reason || "-");

    setHtml(root, "signals", safeList(payload.signals));
    setHtml(root, "controls", safeList(payload.controls?.slice(0, 20) || []));
    setHtml(root, "history", state.history.length ? state.history.map((item) => `
      <div class="history-item">
        <strong>${escapeHtml(item.time)}</strong> - ${escapeHtml(item.finalAmdState || item.finalState)}
        <br><span class="small">DOM: ${escapeHtml(item.domState)} | Audio: ${escapeHtml(item.audioState)} | ${Math.round((item.confidence || 0) * 100)}%</span>
      </div>
    `).join("") : "-");
  }

  function formatMs(value) {
    const ms = Number(value || 0);
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function formatNumber(value, digits) {
    const number = Number(value || 0);
    return number.toFixed(digits);
  }

  function setText(root, id, value) {
    const el = root.getElementById(id);
    if (el) el.textContent = value;
  }

  function setHtml(root, id, value) {
    const el = root.getElementById(id);
    if (el) el.innerHTML = value;
  }

  function safeList(items) {
    if (!items?.length) return "-";
    return `<ul>${items.map((item) => `<li>${escapeHtml(String(item))}</li>`).join("")}</ul>`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#039;");
  }

  function debounce(fn, wait) {
    let timer = null;

    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "GV_AUDIO_STATE_UPDATE") {
      state.latestAudio = message.audio;
      updateState("audio");
    }

    if (message?.type === "GV_BACKEND_AMD_UPDATE") {
      applyBackendUpdate(message.backend);
      updateState("backend");
    }

    if (message?.type === "GV_AUDIO_CONTROL") {
      state.latestAudio = {
        state: message.status === "started" ? "audio_started" : "audio_stopped",
        confidence: 1,
        reason: `Audio analysis ${message.status}.`,
        ts: Date.now()
      };
      updateState("audio-control");
    }
  });

  function applyBackendUpdate(update) {
    if (!update) return;

    const backendConnected = update.backendConnected ?? update.type === "backend_amd_update";
    const deepgramConnected = Boolean(update.deepgramConnected);
    const partial = update.partialTranscript || state.latestBackend.transcript.partial || "";
    const finalText = update.transcript || state.latestBackend.transcript.final || "";
    const lastText = finalText || partial || state.latestBackend.transcript.lastText || "";

    state.latestBackend = {
      backendConnected,
      deepgramConnected,
      deepgramError: update.deepgramError || "",
      deepgramLastEvent: update.deepgramLastEvent || update.type || "",
      backendLastError: update.backendLastError || (update.type === "backend_ws_error" ? update.reason : ""),
      transcript: {
        partial,
        final: finalText,
        lastText
      },
      voicemailPhraseDetected: Boolean(update.voicemailPhraseDetected),
      classification: update.classification || state.latestBackend.classification || "unknown",
      confidence: Number(update.confidence || 0),
      reason: update.reason || state.latestBackend.reason || "",
      provider: update.provider || state.latestBackend.provider || "rules",
      raw: update
    };
  }

  init();
})();
