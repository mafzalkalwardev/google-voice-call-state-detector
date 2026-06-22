"use strict";

let audioContext = null;
let mediaStream = null;
let analyser = null;
let source = null;
let intervalId = null;
let processor = null;
let silentSink = null;
let backendSocket = null;
let pcmBuffer = [];
let audioFrameCount = 0;

const audioMemory = {
  frames: [],
  lastSent: 0,
  lastStrongState: null
};

const BACKEND_WS_URL = "ws://127.0.0.1:8787/ws/amd-audio";
const TARGET_SAMPLE_RATE = 16000;
const PCM_CHUNK_SAMPLES = 3200;
let amdDebug = false;

const STRONG_AUDIO_STATES = new Set([
  "audio_ringback_like",
  "audio_speech_like",
  "audio_beep_like",
  "audio_busy_like"
]);

function now() {
  return Date.now();
}

function safeSendAudio(audio) {
  chrome.runtime.sendMessage({
    target: "background",
    type: "AUDIO_STATE_UPDATE",
    audio
  }).catch(() => {});
}

function safeSendBackend(update) {
  chrome.runtime.sendMessage({
    target: "background",
    type: "BACKEND_AMD_UPDATE",
    backend: update
  }).catch(() => {});
}

function debugLog(...args) {
  if (amdDebug) console.log("[GV AMD offscreen]", ...args);
}

async function startTabAudio(streamId) {
  await stopTabAudio({ sendStopped: false });
  const data = await chrome.storage.local.get(["gvDetectorSettings"]).catch(() => ({}));
  amdDebug = Boolean(data.gvDetectorSettings?.debug);

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  audioContext = new AudioContext();
  source = audioContext.createMediaStreamSource(mediaStream);

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.65;

  source.connect(analyser);

  // Keep the captured Google Voice tab audible to the user.
  source.connect(audioContext.destination);
  setupPcmStreaming();
  connectBackendWebSocket();

  intervalId = setInterval(analyzeAudioFrame, 250);

  safeSendAudio({
    state: "audio_started",
    confidence: 1,
    rms: 0,
    peak: 0,
    dominantFrequency: 0,
    audioFrameCount,
    backendConnected: false,
    reason: "Tab audio analysis started.",
    ts: now()
  });
}

async function stopTabAudio(options = {}) {
  const { sendStopped = true } = options;

  if (intervalId) clearInterval(intervalId);
  intervalId = null;

  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
  }

  closeBackendWebSocket("stopped");

  if (processor) {
    processor.disconnect();
  }
  if (silentSink) {
    silentSink.disconnect();
  }

  mediaStream = null;
  analyser = null;
  source = null;
  processor = null;
  silentSink = null;
  pcmBuffer = [];
  audioFrameCount = 0;

  if (audioContext) {
    await audioContext.close().catch(() => {});
  }

  audioContext = null;
  audioMemory.frames = [];

  if (sendStopped) {
    safeSendAudio({
      state: "audio_stopped",
      confidence: 1,
      rms: 0,
      peak: 0,
      dominantFrequency: 0,
      audioFrameCount,
      backendConnected: false,
      reason: "Tab audio analysis stopped.",
      ts: now()
    });
  }
}

function setupPcmStreaming() {
  if (!audioContext || !source) return;

  processor = audioContext.createScriptProcessor(4096, 1, 1);
  silentSink = audioContext.createGain();
  silentSink.gain.value = 0;

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const downsampled = downsampleTo16k(input, audioContext.sampleRate);
    for (const sample of downsampled) {
      pcmBuffer.push(floatToInt16(sample));
    }

    while (pcmBuffer.length >= PCM_CHUNK_SAMPLES) {
      const chunk = pcmBuffer.splice(0, PCM_CHUNK_SAMPLES);
      sendPcmChunk(new Int16Array(chunk));
    }
  };

  source.connect(processor);
  processor.connect(silentSink);
  silentSink.connect(audioContext.destination);
}

async function getBackendWsUrl() {
  const data = await chrome.storage.local.get(["gvDetectorSettings"]).catch(() => ({}));
  const backendUrl = data.gvDetectorSettings?.backendUrl || "http://127.0.0.1:8787";
  try {
    const url = new URL(backendUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws/amd-audio";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (err) {
    return BACKEND_WS_URL;
  }
}

async function connectBackendWebSocket() {
  closeBackendWebSocket("reconnecting");

  try {
    backendSocket = new WebSocket(await getBackendWsUrl());
    backendSocket.binaryType = "arraybuffer";

    backendSocket.onopen = () => {
      debugLog("backend websocket connected");
      safeSendBackend({
        type: "backend_ws_connected",
        backendConnected: true,
        deepgramConnected: false,
        reason: "Backend WebSocket connected.",
        ts: now()
      });
      backendSocket.send(JSON.stringify({
        type: "start",
        sampleRate: TARGET_SAMPLE_RATE,
        encoding: "linear16",
        channels: 1
      }));
    };

    backendSocket.onmessage = (event) => {
      try {
        safeSendBackend(JSON.parse(event.data));
      } catch (err) {
        safeSendBackend({
          type: "backend_ws_error",
          backendConnected: true,
          deepgramConnected: false,
          reason: "Backend sent non-JSON message.",
          ts: now()
        });
      }
    };

    backendSocket.onerror = () => {
      debugLog("backend websocket error");
      safeSendBackend({
        type: "backend_ws_error",
        backendConnected: false,
        deepgramConnected: false,
        reason: "Backend not connected. Local AMD only.",
        ts: now()
      });
    };

    backendSocket.onclose = () => {
      debugLog("backend websocket disconnected");
      safeSendBackend({
        type: "backend_ws_disconnected",
        backendConnected: false,
        deepgramConnected: false,
        reason: "Backend WebSocket disconnected. Local AMD only.",
        ts: now()
      });
    };
  } catch (err) {
    safeSendBackend({
      type: "backend_ws_error",
      backendConnected: false,
      deepgramConnected: false,
      reason: "Backend WebSocket could not be opened. Local AMD only.",
      ts: now()
    });
  }
}

function closeBackendWebSocket(reason) {
  if (!backendSocket) return;
  try {
    backendSocket.close(1000, reason || "closed");
  } catch (err) {
    // Ignore close errors from already-closed sockets.
  }
  backendSocket = null;
}

function sendPcmChunk(int16Chunk) {
  audioFrameCount += 1;
  if (!backendSocket || backendSocket.readyState !== WebSocket.OPEN) return;
  backendSocket.send(int16Chunk.buffer);
}

function downsampleTo16k(input, sourceSampleRate) {
  if (sourceSampleRate === TARGET_SAMPLE_RATE) return input;
  const ratio = sourceSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += input[j];
      count += 1;
    }
    output[i] = count ? sum / count : 0;
  }

  return output;
}

function floatToInt16(sample) {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

function analyzeAudioFrame() {
  if (!analyser || !audioContext) return;

  const timeData = new Float32Array(analyser.fftSize);
  const freqData = new Uint8Array(analyser.frequencyBinCount);

  analyser.getFloatTimeDomainData(timeData);
  analyser.getByteFrequencyData(freqData);

  const frame = {
    ts: now(),
    rms: calculateRms(timeData),
    peak: calculatePeak(timeData),
    zcr: calculateZeroCrossingRate(timeData),
    dominantFrequency: calculateDominantFrequency(freqData, audioContext.sampleRate, analyser.fftSize),
    toneStability: calculateToneStability(freqData)
  };
  audioFrameCount += 1;

  frame.silence = frame.rms < 0.008;
  frame.tone = frame.rms > 0.014 && frame.toneStability > 0.08;
  frame.beep = frame.rms > 0.02 &&
    frame.toneStability > 0.18 &&
    frame.dominantFrequency > 350 &&
    frame.dominantFrequency < 1800;
  frame.speechActivity = frame.rms > 0.014 &&
    frame.zcr > 0.02 &&
    frame.toneStability < 0.18 &&
    !frame.beep;

  audioMemory.frames.push(frame);
  audioMemory.frames = audioMemory.frames.filter((item) => now() - item.ts <= 8000);

  if (now() - audioMemory.lastSent > 500) {
    audioMemory.lastSent = now();
    safeSendAudio(smoothAudioState(classifyAudio(audioMemory.frames)));
  }
}

function calculateRms(samples) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

function calculatePeak(samples) {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

function calculateZeroCrossingRate(samples) {
  let crossings = 0;

  for (let i = 1; i < samples.length; i += 1) {
    if ((samples[i - 1] >= 0 && samples[i] < 0) || (samples[i - 1] < 0 && samples[i] >= 0)) {
      crossings += 1;
    }
  }

  return crossings / samples.length;
}

function calculateDominantFrequency(freqData, sampleRate, fftSize) {
  let max = 0;
  let maxIndex = 0;

  for (let i = 1; i < freqData.length; i += 1) {
    if (freqData[i] > max) {
      max = freqData[i];
      maxIndex = i;
    }
  }

  return Math.round((maxIndex * sampleRate) / fftSize);
}

function calculateToneStability(freqData) {
  let total = 0;
  let max = 0;

  for (const value of freqData) {
    total += value;
    if (value > max) max = value;
  }

  return total <= 0 ? 0 : max / total;
}

function classifyAudio(frames) {
  const ts = now();
  const recent = frames.filter((frame) => ts - frame.ts <= 2500);
  const longer = frames.filter((frame) => ts - frame.ts <= 7000);

  if (!recent.length) {
    return {
      state: "audio_unknown",
      confidence: 0.1,
      reason: "No audio frames yet.",
      ts
    };
  }

  const rmsAvg = avg(recent, "rms");
  const peakAvg = avg(recent, "peak");
  const zcrAvg = avg(recent, "zcr");
  const toneAvg = avg(recent, "toneStability");
  const freqAvg = avg(recent, "dominantFrequency");

  const loudFrames = recent.filter((frame) => frame.rms > 0.018).length;
  const silentFrames = recent.filter((frame) => frame.rms < 0.008).length;
  const longLoud = longer.filter((frame) => frame.rms > 0.018);
  const longSilent = longer.filter((frame) => frame.rms < 0.008);
  const freqVariance = variance(recent.map((frame) => frame.dominantFrequency));
  const rmsVariance = variance(recent.map((frame) => frame.rms));
  const toneFrames = recent.filter((frame) => frame.tone).length;
  const beepFrames = recent.filter((frame) => frame.beep).length;
  const speechFrames = recent.filter((frame) => frame.speechActivity).length;
  const ringbackPattern = longer.length >= 14 &&
    longLoud.length >= 4 &&
    longSilent.length >= 4 &&
    toneFrames >= Math.max(2, recent.length * 0.3) &&
    rmsVariance > 0.00002;
  const sustainedSpeechLike = speechFrames >= Math.max(2, recent.length * 0.3) ||
    durationOfRecent(frames, (frame) => frame.speechActivity) >= 500 ||
    (rmsAvg > 0.012 && peakAvg > 0.035 && zcrAvg > 0.02 && freqVariance > 5000 && toneAvg < 0.22);
  const busyTonePattern = longer.length >= 12 &&
    longLoud.length >= 5 &&
    longSilent.length >= 3 &&
    toneAvg > 0.15 &&
    freqAvg > 300 &&
    freqAvg < 700 &&
    freqVariance < 8000 &&
    speechFrames < Math.max(2, recent.length * 0.25);

  const metrics = {
    rms: rmsAvg,
    peak: peakAvg,
    zcr: zcrAvg,
    dominantFrequency: Math.round(freqAvg),
    toneStability: toneAvg,
    frequencyVariance: freqVariance,
    rmsVariance,
    speechActivity: sustainedSpeechLike,
    silence: silentFrames >= Math.max(4, recent.length * 0.75),
    tone: toneFrames >= Math.max(2, recent.length * 0.35),
    beep: beepFrames >= 2,
    ringbackPattern,
    busyTonePattern,
    silenceDurationMs: durationOfRecent(frames, (frame) => frame.silence),
    toneDurationMs: durationOfRecent(frames, (frame) => frame.tone),
    speechLikeDurationMs: durationOfRecent(frames, (frame) => frame.speechActivity),
    audioFrameCount,
    backendConnected: backendSocket?.readyState === WebSocket.OPEN
  };

  if (metrics.silence) {
    return {
      state: "audio_silence",
      confidence: 0.8,
      ...metrics,
      reason: "Low RMS for recent frames.",
      ts
    };
  }

  if (metrics.beep && freqVariance < 12000) {
    return {
      state: "audio_beep_like",
      confidence: 0.72,
      ...metrics,
      reason: "Stable tone detected. Could be voicemail beep or call tone.",
      ts
    };
  }

  if (sustainedSpeechLike) {
    return {
      state: "audio_speech_like",
      confidence: 0.66,
      ...metrics,
      reason: "Sustained speech-like audio metrics detected.",
      ts
    };
  }

  if (busyTonePattern) {
    return {
      state: "audio_busy_like",
      confidence: 0.72,
      ...metrics,
      reason: "Repeated busy-tone-like cadence detected.",
      ts
    };
  }

  if (ringbackPattern) {
    return {
      state: "audio_ringback_like",
      confidence: 0.65,
      ...metrics,
      reason: "Repeating tone/silence pattern detected. Could be outbound ringing.",
      ts
    };
  }

  return {
    state: "audio_unknown",
    confidence: 0.35,
    ...metrics,
    reason: "Audio present but not classified confidently.",
    ts
  };
}

function smoothAudioState(audio) {
  const ts = now();

  if (STRONG_AUDIO_STATES.has(audio.state)) {
    audioMemory.lastStrongState = {
      ...audio,
      lastSeenAt: ts
    };
    return audio;
  }

  const lastStrong = audioMemory.lastStrongState;
  if (!lastStrong || ts - lastStrong.lastSeenAt > 2500) return audio;

  if (audio.state === "audio_silence") {
    const recentSilence = audioMemory.frames.filter((frame) => ts - frame.ts <= 1500 && frame.silence);
    if (lastStrong.state === "audio_speech_like" && recentSilence.length < 5) {
      return {
        ...lastStrong,
        state: "audio_speech_like",
        confidence: Math.max(0.5, lastStrong.confidence - 0.08),
        smoothedFrom: audio.state,
        reason: "Holding speech state until silence is continuous.",
        ts
      };
    }
  }

  if (audio.state === "audio_unknown" || audio.state === "audio_silence") {
    return {
      ...lastStrong,
      confidence: Math.max(0.45, lastStrong.confidence - 0.1),
      smoothedFrom: audio.state,
      reason: `Holding recent strong audio state over ${audio.state}.`,
      ts
    };
  }

  return audio;
}

function avg(items, key) {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + item[key], 0) / items.length;
}

function variance(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
}

function durationOfRecent(frames, predicate) {
  const matching = [...frames].reverse().filter(predicate);
  if (!matching.length) return 0;
  const newest = matching[0].ts;
  let oldest = newest;
  for (const frame of matching) {
    if (newest - frame.ts > 8000) break;
    oldest = frame.ts;
  }
  return newest - oldest;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.target !== "offscreen") return;

      if (message.type === "START_TAB_AUDIO") {
        await startTabAudio(message.streamId);
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "STOP_TAB_AUDIO") {
        await stopTabAudio();
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: "Unknown offscreen message." });
    } catch (err) {
      const error = err?.message || String(err);
      safeSendAudio({
        state: "audio_error",
        confidence: 1,
        reason: error,
        ts: now()
      });
      sendResponse({ ok: false, error });
    }
  })();

  return true;
});
