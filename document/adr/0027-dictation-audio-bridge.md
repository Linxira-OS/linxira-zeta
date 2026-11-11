# 0027. Host-owned draft dictation over a desktop-only ordered audio bridge

- **Status:** Proposed (draft number; reservation list has not reached 0027)
- **Date:** 2026-11-12
- **Deciders:** Zeta voice lane (implementation review pending)
- **Links:** [REQ-075](../requirements-ledger.md), [Studio surfaces](../../docs/studio-surfaces.md), [Desktop app](../../docs/desktop-app.md)

## Context

The Studio composer's dictation control already exists and the Studio protocol
already declares `dictation.status|prepare|start|stop|cancel` and their
`DictationState`. What is missing is the Host implementation and the desktop
audio path:

- `StudioOperations` registers no `dictation.*` handler, so the renderer's
  status poll answers `unsupported` and the control is dead.
- The Electron preload exposes no `attachLiveAudio`/`appendLiveAudio`/
  `detachLiveAudio`, so no renderer can send microphone audio.
- `DictationControl` gated only on `attachLiveAudio` and still rendered a
  "desktop microphone required" control in browser/remote targets.

Zeta already owns a complete speech pipeline: `STTController` resolves the
`dictation` model role and API credentials from existing model settings,
honors `stt.enabled`/`stt.language`, downloads/caches local models, and drives
the ASR subprocess worker. `rpc-dictation.ts` proves the controller can be
driven by external audio instead of the native microphone.

## Decision

- **The Studio Host owns dictation semantics.** `dictation.*` is a normal
  Studio Host family (`server/studio-host/ops/dictation.ts`); registering it is
  what advertises the capability. No renderer-only state can claim dictation.
- **The desktop shell owns audio capture and transport.** Chromium's
  `getUserMedia` + AudioWorklet produces ordered 16 kHz mono Float32 frames
  (1280 bytes / 20 ms). Preload exposes `attachLiveAudio`, `appendLiveAudio`,
  `detachLiveAudio`, plus the macOS TCC `requestMicrophoneAccess` and
  `openMicrophoneSettings` methods. Main serializes frames and POSTs them to a
  loopback-only `/api/dictation/audio*` route; the Renderer never posts audio
  to the Host directly.
- **One prepared capture per session.** `prepare` allocates the `audioId` and
  binds it to the requesting session; `attach` must repeat that session id;
  frames must be strictly increasing. A stale, duplicated, unattached or
  wrong-session frame is rejected, not buffered forever.
- **Stop flushes; cancel never emits text.** `stop` drains queued frames, waits
  for the controller's transcription, and returns `complete` with the draft
  text. `cancel`/`detach` dispose the controller and clear text even if a
  transcription was in flight.
- **No fake fallback.** Browser/remote targets, an incomplete preload bridge,
  and Hosts whose capability manifest does not advertise all five `dictation.*`
  commands do not render the control and do not poll it. Dictation is never
  emulated by the Live audio pane.
- **Existing model policy stays authoritative.** The Host asks the same
  `dictation` role chain and `STTController` for model, cloud/local mode,
  language, credentials, cache and download size. It introduces no provider
  allowlist or hardcoded model.
- **Tests use injected controller/session seams.** Consumer tests cover frame
  bounds/order, stop flush, cancel/no-output, wrong target, and denied start
  without downloading a model or touching a microphone.

## Consequences

- The UI can now honestly offer dictation on a desktop with `stt.enabled`; the
  first start may download the configured model, and the state says so.
- The bridge is desktop-only by design. A browser-only deployment keeps the
  W4 gate (no control) until a trusted local transport exists.
- Audio frames are copied at three boundaries (Worklet → IPC → HTTP → Host),
  which is acceptable at 50 frames/s and keeps ownership boundaries explicit.
- Model downloads, ASR worker crashes and permission denial surface as
  `DictationState.error`; they do not silently return empty text.
- The desktop shell owner must place the single `installLiveAudioIpc` hook and
  spread `liveAudioBridge`; no second UI or fallback implementation is added.

## Alternatives

- **Renderer sends audio through the semantic command channel.** Rejected:
  one command per 20 ms frame would serialize JSON/base64 through receipts and
  still need a Host-only sink; it also exposes frames to any paired page.
- **Reuse the Live realtime audio bridge.** Deferred/rejected for this lane:
  Live is a different, Codex-OAuth-backed feature with its own UI and phase
  model; dictation must stay draft-only and use local/configured STT.
- **Hide dictation permanently.** Rejected by REQ-075: the gate already exists,
  and the Host + bridge are implementable from the existing pipeline.
- **Let each renderer own the ASR worker.** Rejected: model cache, worker
  lifecycle and credentials are Host concerns; a second worker would duplicate
  downloads and leak scope.

## Open points

- ADR number 0027 is provisional until the reservation table advances.
- A signed audio fixture smoke run is only possible when the configured local
  model is already cached; this branch does not download weights.
