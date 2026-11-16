# 0047. Studio runtime resources retain Zeta serve ownership

- **Status:** Proposed
- **Date:** 2026-11-15
- **Deciders:** Zeta maintainers
- **Links:** [REQ-099](../requirements-ledger.md), [ADR 0043](0043-studio-conversation-contexts.md), [ADR 0044](0044-studio-tag-sync-automation.md)

## Context

Official Studio v0.2.1 includes Runtime producers in omp-patch/overlay and seam patches, in addition to renderer/shared/desktop source. Browser observation, managed-browser relay and computer captures require those producers. A protocol declaration or preload method without its owner does not implement the feature. Zeta already owns sessions and credentials through standalone serve and its Studio Host.

## Decision

Adapt the official Runtime services into the existing Zeta Host, bound to the actual AgentSession and disposed with it. Keep one HTTP authentication authority and the existing scoped query/command transport; do not import the upstream standalone bridge listener or replace Zeta session/project ownership. Port required tool/native lifecycle seams together with their behavior tests. Existing owner holds for audio and Skillshare retirement remain explicit boundaries.

Publish a Main-only optional studioPrivate record in the existing user-private serve registration: `{schema: 1, mediaDirectory: string, socketDirectory: string}`. The serving PID creates these paths under its agent run directory. POSIX socket names use a short per-instance directory under the user config run directory and must fit the native socket path bound. Desktop accepts the registration only after matching its live identity PID, never derives fallback paths, and never sends this record to the renderer. No public HTTP endpoint returns private paths or credentials.

Retain upstream media-v1 descriptors and private authenticated observation pipes, with Zeta internal pipe names (`zeta-studio-browser-<uuid>` on Windows). Descriptors carry actual session identity and bounded expiry; the private token authenticates one observation connection. Public replies carry only opaque IDs. Capture bytes stay outside public state/events. Closing/revoking a view or disposing its owner must release leases; session disposal tears down timers, sockets and pending captures. Missing passive-native support is unavailable, never an input-enabled fallback.

Managed browser relays are private per-session resources owned by one live
authenticated view. A second view cannot silently replace that owner. The
existing browser tool selects that relay for the owner and its proven live
descendants; disposing or switching the view stops the relay and removes its
descriptor. Agent cleanup borrows desktop pages; only explicit browser close
requests may close them. Native WebMCP reads use the worker's typed controller
route and invocations require the current document identity.

The conversation root prepares the managed relay after bootstrap/events, then
passes only `{sessionId, descriptorId}` to desktop `managedBrowser.attach`.
Desktop reads that exact PID-bound descriptor and completes its relay control
handshake before answering. `managedBrowser.release({sessionId})` and native
navigation/crash/destroy revoke the sender's lease and park its views. No
directory-wide discovery can attach another view's descriptor.

## Consequences

A desktop can reuse standalone serve without creating a second private root or runtime owner. Older registrations omit studioPrivate and cannot advertise the dependent desktop capabilities. Browser, desktop, SSH and native verification remain separate acceptance layers. The complete omp-patch delta is classified as Host adaptation, including seam and paired tests; it is not excluded as repository infrastructure.

## Alternatives

- A second Studio bridge/authentication server: rejected because it splits authority.
- Send private paths through bootstrap: rejected because renderer and remote clients do not need local filesystem credentials.
- Infer a shared directory in Electron: rejected because multiple serve instances and profile overrides would cross ownership.

## Links

- [Serve registry](../../packages/coding-agent/src/server/serve-registry.ts)
- [Host registry](../../packages/coding-agent/src/server/studio-host/registry.ts)
- [Desktop discovery](../../desktop/src/serve-discovery.ts)
