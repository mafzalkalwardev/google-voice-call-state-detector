"use strict";

const statusEl = document.getElementById("status");
const startBtn = document.getElementById("startAudio");
const stopBtn = document.getElementById("stopAudio");
const refreshBtn = document.getElementById("refresh");

async function send(message) {
  return await chrome.runtime.sendMessage(message);
}

async function refreshStatus() {
  try {
    const response = await send({ type: "GET_STATUS" });
    statusEl.textContent = JSON.stringify(response, null, 2);
  } catch (err) {
    statusEl.textContent = err?.message || String(err);
  }
}

startBtn.addEventListener("click", async () => {
  statusEl.textContent = "Starting tab audio analysis...";
  const response = await send({ type: "START_AUDIO_FROM_POPUP" });
  statusEl.textContent = JSON.stringify(response, null, 2);
});

stopBtn.addEventListener("click", async () => {
  statusEl.textContent = "Stopping tab audio analysis...";
  const response = await send({ type: "STOP_AUDIO_FROM_POPUP" });
  statusEl.textContent = JSON.stringify(response, null, 2);
});

refreshBtn.addEventListener("click", refreshStatus);

refreshStatus();
