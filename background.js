"use strict";

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

let latestVoiceTabId = null;
let audioRunning = false;

async function safeStorageSet(values) {
  try {
    await chrome.storage.local.set(values);
  } catch (err) {
    // Storage can fail because of quota or transient extension-context issues.
  }
}

async function getActiveVoiceTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs?.[0];

  if (!tab?.id || !tab?.url?.startsWith("https://voice.google.com/")) {
    throw new Error("Open https://voice.google.com/ and keep that tab active first.");
  }

  latestVoiceTabId = tab.id;
  return tab;
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (chrome.runtime.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["USER_MEDIA"],
    justification: "Analyze Google Voice tab audio locally without recording or saving audio."
  });
}

async function startTabAudioAnalysis() {
  const tab = await getActiveVoiceTab();
  await ensureOffscreenDocument();

  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tab.id
  });

  const started = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "START_TAB_AUDIO",
    streamId,
    tabId: tab.id
  });

  if (!started?.ok) {
    throw new Error(started?.error || "Offscreen audio analysis failed to start.");
  }

  audioRunning = true;

  await safeStorageSet({
    gvDetectorAudioRunning: true,
    gvDetectorLastError: null
  });

  await sendToContent(tab.id, {
    type: "GV_AUDIO_CONTROL",
    status: "started"
  });

  return { ok: true, tabId: tab.id };
}

async function stopTabAudioAnalysis() {
  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "STOP_TAB_AUDIO"
  }).catch(() => {});

  audioRunning = false;

  await safeStorageSet({
    gvDetectorAudioRunning: false
  });

  if (latestVoiceTabId) {
    await sendToContent(latestVoiceTabId, {
      type: "GV_AUDIO_CONTROL",
      status: "stopped"
    }).catch(() => {});
  }

  return { ok: true };
}

async function sendToContent(tabId, message) {
  if (!tabId) return;

  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    // The content script may not be ready or the tab may have navigated.
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === "START_AUDIO_FROM_POPUP" || message?.type === "START_AUDIO_FROM_OVERLAY") {
        sendResponse(await startTabAudioAnalysis());
        return;
      }

      if (message?.type === "STOP_AUDIO_FROM_POPUP" || message?.type === "STOP_AUDIO_FROM_OVERLAY") {
        sendResponse(await stopTabAudioAnalysis());
        return;
      }

      if (message?.type === "GET_STATUS") {
        const storage = await chrome.storage.local.get([
          "gvDetectorAudioRunning",
          "gvDetectorLatestState",
          "gvDetectorLatestAudio",
          "gvDetectorLastError"
        ]);

        sendResponse({
          ok: true,
          audioRunning,
          storage
        });
        return;
      }

      if (message?.target === "background" && message?.type === "AUDIO_STATE_UPDATE") {
        const payload = {
          type: "GV_AUDIO_STATE_UPDATE",
          audio: message.audio,
          ts: Date.now()
        };

        if (latestVoiceTabId) {
          await sendToContent(latestVoiceTabId, payload);
        }

        await safeStorageSet({
          gvDetectorLatestAudio: payload
        });

        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message type." });
    } catch (err) {
      const error = err?.message || String(err);
      await safeStorageSet({ gvDetectorLastError: error });
      sendResponse({ ok: false, error });
    }
  })();

  return true;
});

chrome.tabCapture?.onStatusChanged?.addListener(async (info) => {
  if (info.status !== "stopped" && info.status !== "error") return;

  audioRunning = false;
  await safeStorageSet({ gvDetectorAudioRunning: false });

  if (latestVoiceTabId) {
    await sendToContent(latestVoiceTabId, {
      type: "GV_AUDIO_CONTROL",
      status: "stopped",
      captureInfo: info
    });
  }
});
