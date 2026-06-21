# Google Voice Real Call State Detector

A Manifest V3 Chrome extension that detects Google Voice call state in real time using:

1. DOM/UI state detection.
2. Optional local tab-audio heuristics through `chrome.tabCapture` and an offscreen document.

It does not record or save audio.

## States

- `idle`
- `dialpad_ready`
- `incoming_ringing`
- `outbound_or_active_call_ui`
- `likely_still_ringing_audio`
- `likely_human_or_speech_audio`
- `likely_voicemail_beep_audio`
- `voicemail_player_or_inbox`
- `ended`
- `unknown_transition`

## Important Limitation

For outbound calls, Google Voice DOM may show "Ongoing call", a timer, End Call, Mute, Hold, Transfer, and Keypad even while the remote phone is still ringing. DOM alone cannot reliably detect human pickup vs voicemail.

Use the optional tab-audio analysis for better detection. It is heuristic and local only.

## Install From Scratch

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on Developer Mode.
4. Click `Load unpacked`.
5. Select the `google-voice-call-state-detector` folder.
6. Open `https://voice.google.com/`.
7. Reload the Google Voice page.
8. Confirm the floating detector panel appears.

## Test A Live Call

1. Keep the Google Voice tab active.
2. Click the extension icon.
3. Click `Start Tab Audio Analysis`.
4. Make or receive a real test call.
5. Watch the floating panel for DOM state, audio state, final state, confidence, detected controls, signals, and state history.
6. Use `Copy Snapshot` or `Download JSON` for debugging.
7. Click `Stop Tab Audio Analysis` when finished.

## Raw Real-Time Events

Open DevTools on the Google Voice page, go to Console, and paste:

```js
window.addEventListener("GV_CALL_STATE_UPDATE", e => console.log(e.detail));
```

The content script also posts page messages:

```js
window.addEventListener("message", e => {
  if (e.data?.type === "GV_CALL_STATE_UPDATE") console.log(e.data.payload);
});
```

## Safety

Use only on calls you are legally allowed to monitor.

This tool detects UI/audio state only and does not record audio.
