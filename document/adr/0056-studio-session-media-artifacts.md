# 0056. Studio image and video jobs publish into native session artifacts

- **Status:** Proposed
- **Date:** 2026-11-16
- **Deciders:** Zeta maintainers
- **Links:** [REQ-099](../requirements-ledger.md), [ADR 0047](0047-studio-runtime-private-resources.md), [ADR 0034](0034-owner-scope-holds-2026-11-12.md)

## Context

Official Studio v0.2.1 image and video jobs use private file transfers and a Desktop artifact library. Zeta already owns session `local://` artifacts, their opaque Studio handles, authentication, conversation contexts and native provider execution. Registering a second Desktop storage root would split session deletion, ownership and remote access. Audio, transcription, speech and device capture remain owner-held.

## Decision

Adapt image and video jobs to the exact resident native AgentSession. Only explicit `media.start` submits provider work. Reads, restarts and resume polling never resubmit an unconfirmed task. Persist job metadata in the Host profile partitioned by session identity; read inputs and write outputs through the existing session artifact owner. An opaque artifact id must resolve to the same session, with bounded bytes and matching media kind. Never accept renderer paths or private transfer grants.

Use existing authenticated Studio binary-resource routes and cookie/CSRF/device-binding/context checks for artifact reads and uploads. A binary request additionally requires the still-open selected conversation context, and a write also requires the live event socket and the exact resident native session; the checks repeat after every await, an upload that loses authority is discarded, and artifact writes are serialized per session against the session trash move. Desktop Main requests bytes from that Host using its existing local or SSH connection, never reads a second library or shares private paths. File import/export uses native dialogs and document lifetime fences. Browser artifact URLs use the same Host authority. Reuse the current 28 MiB native artifact limit; do not widen that contract to upstream's 64 MiB limit during adaptation.

Tasks survive view disconnection but abort on native disposal, identity replacement and Host shutdown. Record incomplete video submission as interrupted; only a confirmed remote job id permits polling resume. Closing a terminal job waits for its writers before removing metadata and outputs. Credential values, private provider endpoints and storage paths never enter public errors or state. Listing models excludes owner-held speech/transcription; image/video requests cannot activate audio capture or speech services.

## Consequences

Standalone serve remains the artifact and session authority for browser, local Desktop and SSH. Current-source acceptance must cover binary round trips, cross-session/context rejection, cancellation, restart without paid replay, confirmed-video resume and removal after writer settlement. Local injected provider checks do not establish external provider success. The decision remains Proposed until the integration and relevant acceptance complete.

## Alternatives

- Install the upstream shared media directory and separate Desktop library: rejected because it duplicates storage and deletion authority.
- Send file payloads in query/state JSON: rejected because bytes do not belong in state and events.
- Hide image/video controls: rejected because the requested official behavior would remain unavailable.

## Links

- [Session artifacts](../../packages/coding-agent/src/server/web-gateway/artifacts.ts)
- [Studio artifact operations](../../packages/coding-agent/src/server/studio-host/ops/files.ts)
- [Desktop Host connection](../../desktop/src/host-http.ts)
