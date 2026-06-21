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
    latestAudio: null,
    history: [],
    lastPayload: null,
    lastDomScan: 0
  };

  const OVERLAY_POSITION_KEY = "gvDetectorOverlayPosition";

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
    const audio = state.latestAudio;
    const combined = combineState(dom, audio);
    const ts = Date.now();

    if (combined.finalState === "outbound_or_active_call_ui") {
      state.lastActiveAt = ts;
    }

    const payload = {
      type: "GV_CALL_STATE_UPDATE",
      source,
      ts,
      isoTime: new Date(ts).toISOString(),
      dom,
      audio,
      finalState: combined.finalState,
      confidence: combined.confidence,
      reason: combined.reason,
      history: state.history.slice(0, 25)
    };

    const changed = payload.finalState !== state.lastFinalState ||
      dom.domState !== state.lastPayload?.dom?.domState ||
      audio?.state !== state.lastPayload?.audio?.state;

    if (changed) {
      addHistory(payload);
      payload.history = state.history.slice(0, 25);
    }

    state.lastFinalState = payload.finalState;
    state.lastPayload = payload;

    renderOverlay(payload);
    dispatchPageEvents(payload);

    chrome.storage.local.set({
      gvDetectorLatestState: payload
    }).catch(() => {});
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
    const hasActiveControls = hasAny(buttonLabels, ["mute", "hold", "transfer", "keypad", "record"]);
    const hasOngoingText = bodyText.includes("ongoing call");
    const hasVoicemailText = bodyText.includes("voicemail") && (
      hasAny(ariaLabels, ["play voicemail", "pause voicemail"]) ||
      bodyText.includes("transcript")
    );
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
    } else if (visible(outgoingOrActiveCall) || visible(sidebar) || hasOngoingText || hasEndCall || hasActiveControls || visible(inCallStatus) || timer || elapsedA11y) {
      domState = "outbound_or_active_call_ui";
      confidence = 0.83;
      reason = "Active Google Voice call UI markers found.";
    } else if (visible(makeCallPanel) && hasNoActiveCall) {
      domState = "dialpad_ready";
      confidence = 0.78;
      reason = "Dialpad panel visible while root has no-active-call.";
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
      domState: payload.dom.domState,
      audioState: payload.audio?.state || "none",
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
        <div class="title">GV Call State Detector</div>
        <div class="header-actions">
          <div class="badge" id="finalState">Starting...</div>
          <button class="minimize-btn" id="minimizeBtn">Minimize</button>
        </div>
      </div>
      <div class="body">
        <div class="row"><span class="key">DOM</span><span class="val" id="domState">-</span></div>
        <div class="row"><span class="key">Audio</span><span class="val" id="audioState">-</span></div>
        <div class="row"><span class="key">Confidence</span><span class="val" id="confidence">-</span></div>
        <div class="row"><span class="key">Number</span><span class="val" id="number">-</span></div>
        <div class="row"><span class="key">Timer</span><span class="val" id="timer">-</span></div>
        <div class="row"><span class="key">Reason</span><span class="val" id="reason">-</span></div>
        <div class="small danger">Audio is heuristic only. DOM cannot always tell outbound human pickup vs voicemail.</div>
        <div class="signals"><strong>Signals</strong><div id="signals">-</div></div>
        <div class="signals"><strong>Controls</strong><div id="controls">-</div></div>
        <div class="history"><strong>History</strong><div id="history">-</div></div>
        <div class="buttons">
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

    setText(root, "finalState", payload.finalState);
    setText(root, "domState", payload.dom.domState);
    setText(root, "audioState", payload.audio?.state || "none");
    setText(root, "confidence", `${Math.round((payload.confidence || 0) * 100)}%`);
    setText(root, "number", payload.dom.number || "-");
    setText(root, "timer", payload.dom.timer || payload.dom.elapsedA11y || "-");
    setText(root, "reason", payload.reason || "-");

    setHtml(root, "signals", safeList(payload.dom.signals));
    setHtml(root, "controls", safeList(payload.dom.controls?.slice(0, 20) || []));
    setHtml(root, "history", state.history.length ? state.history.map((item) => `
      <div class="history-item">
        <strong>${escapeHtml(item.time)}</strong> - ${escapeHtml(item.finalState)}
        <br><span class="small">DOM: ${escapeHtml(item.domState)} | Audio: ${escapeHtml(item.audioState)} | ${Math.round((item.confidence || 0) * 100)}%</span>
      </div>
    `).join("") : "-");
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

  init();
})();
