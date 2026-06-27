# Chrome Web Store Listing Content

## 1. Extension Name Options

1. **GV AMD Detector** (Primary recommendation)
2. Voice Call State Monitor
3. Answering Machine Detector for GV
4. GV Live Call Analyzer
5. Real-Time GV Call + AMD Monitor

---

## 2. Short Description Options

1. Monitor Google Voice call state and detect answering machines in real time using UI signals and local audio analysis.
2. See ringing, voicemail, human pickup, and screening prompts live on Google Voice calls.
3. Real-time answering machine detection for Google Voice with optional Deepgram, OpenAI, and xAI integration.
4. Heuristic AMD monitor for Google Voice: track call states, detect voicemail, human pickup, and screening prompts.
5. Lightweight Chrome extension that classifies Google Voice call states and AMD signals using visible UI and audio.

---

## 3. Long Description

**What it does**

GV AMD Detector is a Chrome extension that monitors Google Voice web calls in real time and classifies the current call state. It surfaces whether a call is ringing, has reached a human, gone to voicemail, hit a Google Voice call screening prompt, failed, or ended. It also exposes debug-grade metrics and history so you can tune and verify its behavior.

**Key features**

- Live state overlay showing ringing, human picked up, voicemail detected, screening prompt, busy/failed, ended, or unknown.
- Local tab-audio analysis using Web Audio metrics.
- Optional backend integrations with Deepgram (live transcription), OpenAI, and xAI/Grok for phrase rules and classifier support.
- Debug metrics: RMS, peak amplitude, dominant frequency, ZCR, tone stability, frame count, and last transcript.
- History log with state transitions and exportable snapshots.
- Connections tab to verify backend/API health without exposing keys.

**Who it is for**

This extension is built for power users, call-center operators, VOIP researchers, and developers who need transparent, tunable call-state signals while using Google Voice in the browser. It is especially useful when you need to know whether a ringing call was answered by a live person, a voicemail system, or a screening prompt.

**How it works (high level)**

The extension watches the Google Voice web UI for visible session-state changes. When audio analysis is active, it captures the current tab's audio via `chrome.tabCapture`, runs local Web Audio metrics in an offscreen document, and may stream PCM audio to an optional local or remote backend. The backend can run Deepgram live transcription and apply phrase rules or AI classifiers. The result is surfaced as a heuristic final AMD state in a draggable overlay, popup, and DevTools events.

**Limitations**

- AMD is heuristic and confidence depends on real call conditions, device audio capture behavior, and network latency.
- Google Voice DOM and audio capture may vary across devices, browsers, and updates.
- No 100% accuracy is claimed. Human vs. voicemail classification uses speech timing, phrase rules, and optional AI.
- Backend integrations are optional and run locally by default. Remote endpoints are user-configurable only.
- The extension is not made by or affiliated with Google.

**Privacy**

No audio is recorded or saved by default. Tab-audio analysis is processed for call-state detection features only and is not stored. API keys are never bundled with the extension. Backend integrations are optional; if used, they run under your own control. You are solely responsible for obtaining any required consent before monitoring calls.

---

## 4. Feature Bullets

- **Real-time Google Voice state monitoring** — Watches the visible GV web UI to detect dialpad, active call, screening, ended, and idle states without breaking page behavior.
- **AMD state detection** — Heuristic classification of answering-machine states: ringing, human picked up, voicemail detected, screening prompt, busy/failed, ended, and unknown.
- **Human pickup / voicemail / ringing / screening prompt display** — Shows the final AMD state directly in a draggable overlay, popup, and via custom DOM events for downstream tooling.
- **Tab-audio local analysis** — Captures the active Google Voice tab's audio and computes RMS, peak, dominant frequency, ZCR, tone stability, and frame counts in an offscreen context.
- **Optional backend integrations** — Connect to Deepgram for live transcription, and use OpenAI or xAI/Grok for phrase rules and classifier support via a user-hosted FastAPI backend.
- **Debug history and metrics** — Persistent history of state transitions, numeric metrics, and error events to verify behavior and tune thresholds.
- **Export / copy snapshot** — Copy or export current state and metrics as a clipboard-ready snapshot for debugging or ticketing.

---

## 5. Privacy Disclosure Draft

**Data handling**

- The extension analyzes visible Google Voice UI state to determine call phase. No page content is exfiltrated.
- When enabled, tab audio is captured for local call-state detection. Raw audio is **not recorded or saved** by the extension by default.
- Tab-audio metrics and transcripts, if any, are processed to compute AMD state only.
- API keys for Deepgram, OpenAI, or xAI are stored in a backend `.env` file or user-provided environment, **never in browser extension files**.
- All backend integrations are optional. If no backend is configured, the extension runs in local-only mode.
- You are responsible for legal consent when monitoring calls. Do not use this extension on calls where you lack proper authorization.

---

## 6. Permissions Explanation

- **storage** — Saves settings, history entries, and connection state locally so they persist across reloads.
- **tabs** — Identifies the Google Voice tab and monitors tab lifecycle without reading page content.
- **activeTab** — Grants temporary access to the active Google Voice tab when you start audio analysis; required to capture tab audio via `tabCapture`.
- **tabCapture** — Captures audio from the active tab for local Web Audio analysis and optional backend streaming.
- **offscreen** — Used to run the `OffscreenDocument` audio processing pipeline for stable microphone-and-metrics handling.
- **Host permission: `https://voice.google.com/*`** — Required to observe the Google Voice web interface, detect call-state DOM changes, and apply the overlay on the correct page.

---

## 7. Screenshot Plan

### Screenshot 1: Main AMD Overlay
- **What to show:** The draggable overlay docked to the bottom-right of the Google Voice tab, displaying a clear final state (e.g., `VOICEMAIL_DETECTED`) with a confidence-style indicator or timestamp.
- **Suggested caption:** "Live AMD state displayed in a minimal, draggable overlay while on a call."

### Screenshot 2: Popup Panel
- **What to show:** The extension popup open, showing current DOM state, audio state, final AMD state, recommended action, and Start/Stop Audio controls.
- **Suggested caption:** "Extension popup with real-time state, metrics, and one-click audio controls."

### Screenshot 3: Connections Tab
- **What to show:** The Connections panel inside the popup, showing Backend WS, Deepgram, OpenAI, and xAI connection status with green/red indicators and concise error messages.
- **Suggested caption:** "Backend and API status at a glance — no exposed keys, just connection health."

### Screenshot 4: Metrics Tab
- **What to show:** The Metrics panel showing RMS, peak, dominant frequency, ZCR, tone stability, frame counts, and the last transcript line.
- **Suggested caption:** "Raw audio metrics and live transcript line to verify detection quality."

### Screenshot 5: History Tab
- **What to show:** The History/Log panel with a scrollable list of timestamped state transitions and actions.
- **Suggested caption:** "Full history of state transitions and recommended actions."

### Screenshot 6: Minimized Overlay
- **What to show:** The overlay collapsed to a small compact badge or icon when minimized.
- **Suggested caption:** "Minimized overlay keeps state accessible without taking up space."

### Screenshot 7: Settings Tab
- **What to show:** The Settings panel with threshold sliders, backend URL fields, debug toggle, and export buttons.
- **Suggested caption:** "Tune thresholds, backend endpoints, and export snapshots."

---

## 8. README Publishing Section

Add this section to `README.md`:

```markdown
## Chrome Web Store Preparation

### Test before packaging
1. Load the extension unpacked via `chrome://extensions`.
2. Visit `https://voice.google.com/` in a separate window.
3. Trigger each manual test case in the README and confirm expected states.
4. Open the popup and Connections tab to verify backend/API status indicators.

### Check for errors
- Open `chrome://extensions`, enable Developer Mode, and inspect the extension's service worker for console errors.
- Use the Offscreen document console if available for audio capture logs.
- Verify no uncaught exceptions appear when starting or stopping audio.

### Verify no API keys are included
- Search the extension folder for patterns like `AIza`, `sk-`, `xg-`, or your own development key strings.
- Confirm that `background.js`, `popup.js`, `content.js`, and `offscreen.js` do not contain hardcoded keys.
- Confirm `manifest.json` does not include `web_accessible_resources` that expose secrets.

### Zip extension safely
- Create a clean folder with only the files required by the extension.
- Include `manifest.json`, JS/CSS/HTML files, and icon assets.
- Exclude `node_modules`, `.env`, backend files, debug recordings, caches, and VCS folders.

### What not to include in the zip
- `.env`, `backend/`, `node_modules/`, `**pycache__/`, `.git/`, sample recordings, debug logs, and any temporary or credential files.
```

---

## 9. Package Safety Checklist

**Pre-package**
- [ ] No `.env` files in the packaged directory
- [ ] No `backend/.env` or backend source files included unless required
- [ ] No API keys string-searchable in JS/HTML/manifest
- [ ] No debug recordings or audio samples included
- [ ] No `node_modules` directory
- [ ] No `**pycache__` directories
- [ ] Icons exist and match manifest sizes (16, 48, 128)
- [ ] `manifest.json` icon paths are valid

**Pre-submit smoke test**
- [ ] Extension loads unpacked without errors
- [ ] Popup opens and displays correctly
- [ ] Overlay appears on `https://voice.google.com/`
- [ ] Start Audio / Stop Audio toggles without crash
- [ ] Service worker has no persistent crash errors in `chrome://extensions`

---

## 10. Final Output Summary

**Files created/changed**
- `docs/CHROME_WEB_STORE_LISTING.md` — Created
- `README.md` — Updated with "Chrome Web Store Preparation" section

**Recommended extension name**
- GV AMD Detector

**Best short description**
- Monitor Google Voice call state and detect answering machines in real time using UI signals and local audio analysis.

**Best long description**
- See "3. Long Description" above. Keep the tone factual, include limitations up front, avoid guarantees, and include the privacy note at the bottom.

**Privacy summary**
- No audio is recorded or saved by default. API keys are never bundled. Backend integrations are optional and run under your own control. You are responsible for legal consent on monitored calls.

**Screenshot list**
1. Main AMD Overlay
2. Popup Panel
3. Connections Tab
4. Metrics Tab
5. History Tab
6. Minimized Overlay
7. Settings Tab

**Packaging checklist**
- No `.env` files
- No `backend/.env`
- No API keys
- No debug recordings
- No `node_modules`
- No `**pycache__`
- Icons exist and are valid
- Extension loads unpacked without errors
- Popup works
- Overlay works
- Start Audio / Stop Audio works
- Service worker has no persistent crash errors