# 0053. Studio prediction reuses native engines through view-owned private channels

- **Status:** Proposed
- **Date:** 2026-11-16
- **Deciders:** Zeta maintainers
- **Links:** [ADR 0047](0047-studio-runtime-private-resources.md), [ADR 0052](0052-studio-input-validation-authority.md), [REQ-099](../requirements-ledger.md), [official Studio v0.2.1](https://github.com/the-snowpear/omp-studio/tree/v0.2.1)

## Context

The adopted renderer requests version 2 prediction channels, ranked next-message choices and prediction settings. Shared declarations alone do not supply those producers. Zeta already owns a native text-prediction daemon and a composer prediction controller that preserves model request semantics, cancellation, usage accounting and normalization. Studio must not install another Runtime or send drafts through durable HTTP commands, session history or telemetry.

## Decision

Use the existing broker and native text-prediction worker with an explicit Studio profile. Keep its history and learned state in a Studio namespace, separate from the TUI corpus. Do not bootstrap foreign histories or download model weights from a draft query. Only authoritative user-message events add confirmed submissions; import is an explicit operation. Corpus clearing stops that exact Studio daemon and removes its learned state without deleting the shared verified model cache or TUI history.

The authenticated Zeta Host owns settings, query and channel preparation. Each resident session owns one prediction producer, including the existing composer prediction controller for next-message alternatives. Every channel belongs to one live authenticated view and exact session instance. Session replacement, disposal, context closure, expiry and owner loss close channels and cancel their active next-message prediction. Settings persistence continues through native Settings.

Draft revisions, prose, feedback and selected history transfers use bounded authenticated private sockets advertised only in the existing private serve registration. Public results contain channel/session identity and expiry, never socket endpoints, tokens or private paths. Version 2 retains ranked choices and shown/accepted accounting. Desktop adopts the exact descriptor through trusted top-frame IPC, checks Host generation and window identity after asynchronous work, and releases channels on navigation, renderer loss, hide, minimize and closure. A file picker is required for Desktop history transfer; arbitrary renderer paths are not accepted.

Validate HTTP inputs at their owning Host family and socket/IPC payloads at those independent private boundaries. Keep protocol packages type-oriented as established by ADR 0052. Plain-browser word prediction remains unavailable without the Desktop private transport; Host settings and explicit corpus operations do not imply a browser draft bridge.

## Consequences

Native prediction behavior and provider accounting stay shared with the TUI. Studio keeps an independent corpus and profile handshake, requiring coordinated worker/client changes. Tests must cover actual socket ownership, stale revisions, corpus separation, import/clear semantics and cancellation. Local fixtures can prove these invariants but do not establish external-provider success, an actual model download or source-matched addon acceptance. This ADR remains Proposed pending integrated review and product evidence.

## Alternatives

- Use the process-global TUI prediction client: rejected because its foreign-history bootstrap and shared corpus violate Studio's confirmed-submission boundary.
- Send drafts through ordinary Studio commands: rejected because durable transport/event paths must not carry editor content.
- Copy the upstream standalone Runtime: rejected because Zeta serve already owns authentication, session residency and private-resource discovery.

## Links

- [Native prediction client](../../packages/coding-agent/src/predict/client.ts)
- [Native composer controller](../../packages/coding-agent/src/modes/controllers/composer-prediction-controller.ts)
- [Studio private resources](../../packages/coding-agent/src/server/studio-host/private-resources.ts)
- [Desktop private IPC](../../desktop/src/private-ipc.ts)
- [Studio surfaces](../../docs/studio-surfaces.md)
