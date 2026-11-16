# 0048. Desktop memory credentials supplement the existing Zeta runtime authority

- **Status:** Proposed
- **Date:** 2026-11-15
- **Deciders:** Zeta maintainers
- **Links:** [REQ-099](../requirements-ledger.md), [ADR 0047](0047-studio-runtime-private-resources.md)

## Context

Studio v0.2.1 provides a Desktop Hindsight credential editor and encrypted per-target storage. Zeta already owns Hindsight configuration and request execution in the standalone serve process; Desktop and SSH clients reuse that process through its cookie/CSRF/device/2FA authority. Copying the upstream worker broker would establish another runtime authority and would not reach reused serve instances.

## Decision

Keep native `hindsight.apiToken` configuration and environment precedence. Desktop stores supplementary tokens encrypted with Electron safeStorage, keyed by exact normalized HTTP(S) service URL and execution target. No plaintext storage fallback is permitted. URLs with userinfo, query or fragment are rejected.

Desktop Main sends a bounded replacement set through the existing authenticated Host at `POST /api/v1/memory/credentials`; it does not use query/command envelopes or receipts. The route requires an unbound cookie session, its CSRF token, write scope and the existing two-factor write gate. A read-only status probe uses the same cookie authority. Neither response contains tokens. SSH uses its existing authenticated tunnel and cookie, retaining received credentials only in Host memory. A different owner cannot replace a live owner's token for the same URL.

The Host retains supplements only for the authenticated owner lifetime. Revocation, expiry or disconnect removes them. Existing Hindsight clients resolve a supplement at each request only when their native configuration has no token; changing/removing a supplement takes effect without copying it into Settings or persisting it remotely. Host metadata reports only configured/source state. Desktop target switches do not retarget an in-flight credential update; generation checks prevent late writes from adopting a new connection.

## Consequences

Standalone serve remains the only runtime/settings/session authority. A Desktop can attach to an already running Host, and SSH never writes memory credentials into provisioning files. Native configuration wins, while private supplements remain removable and expire with the caller. Runtime credential checks and real SSH acceptance remain required before marking this decision accepted.

## Alternatives

- Copy the upstream per-worker broker: rejected because Zeta does not create that worker authority.
- Persist Desktop tokens into remote native settings: rejected because they are temporary target credentials.
- Put tokens in `runtime.settings.set` receipts: rejected because receipts and replay are public metadata.

## Links

- [Hindsight client](../../packages/coding-agent/src/hindsight/client.ts)
- [Studio Host](../../packages/coding-agent/src/server/studio-host/server.ts)
- [Desktop Host connection](../../desktop/src/host-http.ts)
