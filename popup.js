"use strict";

const els = {
  status: document.getElementById("status"),
  start: document.getElementById("startAudio"),
  stop: document.getElementById("stopAudio"),
  refresh: document.getElementById("refresh"),
  checkBackend: document.getElementById("checkBackend"),
  connectionDetails: document.getElementById("connectionDetails")
};

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab;
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
  });
});

async function send(message) {
  return await chrome.runtime.sendMessage(message);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function refreshStatus() {
  try {
    const response = await send({ type: "GET_STATUS" });
    const latest = response.storage?.gvDetectorLatestState || {};
    const audio = response.storage?.gvDetectorLatestAudio?.audio || {};

    setText("audioRunning", response.audioRunning ? "running" : "stopped");
    setText("finalAmdState", latest.finalAmdState || "-");
    setText("recommendedAction", latest.recommendedAction || "-");
    setText("rms", Number(audio.rms || latest.metrics?.rms || 0).toFixed(5));
    setText("peak", Number(audio.peak || latest.metrics?.peak || 0).toFixed(5));
    setText("frequency", `${Math.round(audio.dominantFrequency || latest.metrics?.dominantFrequency || 0)} Hz`);
    setText("frames", String(audio.audioFrameCount || latest.metrics?.audioFrameCount || 0));
    els.status.textContent = JSON.stringify(response, null, 2);
  } catch (err) {
    els.status.textContent = err?.message || String(err);
  }
}

async function checkBackend() {
  setText("backendStatus", "checking");
  const response = await send({ type: "CHECK_BACKEND_HEALTH" }).catch((err) => ({
    ok: false,
    error: err?.message || String(err)
  }));

  setText("backendStatus", response.ok ? "connected" : "error");
  setText("deepgramKey", response.health?.deepgram_key_found ? "configured" : "missing key");
  setText("openaiKey", response.health?.openai_key_found ? "configured" : "missing key");
  setText("xaiKey", response.health?.xai_key_found ? "configured" : "missing key");
  els.connectionDetails.textContent = JSON.stringify(response, null, 2);
}

els.start.addEventListener("click", async () => {
  els.status.textContent = "Starting tab audio analysis...";
  els.status.textContent = JSON.stringify(await send({ type: "START_AUDIO_FROM_POPUP" }), null, 2);
  refreshStatus();
});

els.stop.addEventListener("click", async () => {
  els.status.textContent = "Stopping tab audio analysis...";
  els.status.textContent = JSON.stringify(await send({ type: "STOP_AUDIO_FROM_POPUP" }), null, 2);
  refreshStatus();
});

els.refresh.addEventListener("click", refreshStatus);
els.checkBackend.addEventListener("click", checkBackend);

refreshStatus();
