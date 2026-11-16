# 0043. Studio Conversation Contexts

- **Status:** Proposed
- **Date:** 2026-11-14
- **Deciders:** Zeta maintainers
- **Links:** [Studio surfaces](../../docs/studio-surfaces.md), [Studio host](../../packages/coding-agent/src/server/studio-host/index.ts)

## Context

Studio v0.2.1 provides concurrent conversation clients. Zeta serve needs an explicit context that keeps workspace and conversation selection, command receipts, and event subscriptions isolated. Context ownership must preserve device binding, CSRF, 2FA, and remote access scope.

## Decision

Extend the existing Zeta Host with authenticated context open/close operations. Each opaque handle belongs to one authenticated cookie, pins a registered workspace and optional session, and receives an independent event/socket namespace. HTTP requests use `X-Studio-Context`; WebSocket upgrades use the `contextId` query parameter. Production browser requests are same-origin; this adds no CORS authority or origin exemption. Explicit nested targets and pending-dialog ownership are checked before operation dispatch. An empty or closed context never selects the process-global session.

`HomeReadModel.snapshot` is optional: an empty conversation has host and workspace facts but no session identity. `home.get` omits the snapshot until that context owns a session; it must not manufacture one or read the process-global session. Existing snapshot consumers already handle absence. Session-scoped commands continue to reject an empty context.

The production command manifest is projected from Zeta's canonical builtin registry. Text handlers use `operator.invoke`; terminal-only commands retain their native Studio mapping or remain terminal-only. Hidden and configuration-disabled commands are omitted. Risk and effect describe the strongest supported subcommand; an unknown classification is reported in `unclassifiedBuiltins` and blocked rather than advertised as safe. Descriptions and gates are evaluated on each read in the selected workspace's settings scope. Bootstrap hashes the same command entries as `commands.getManifest`; timestamps do not change that hash. This projection adds no approval policy.

Streaming messages carry an in-memory identity token from the Agent event source across immutable snapshots. SessionManager reserves the eventual entry ID before the start event and consumes that reservation at persistence; the JSONL format and append order stay unchanged. Host conversation events reuse that entry ID, never timestamp/text matching. Facade cursors are contiguous within each authenticated event namespace; conversation stream sequences remain session-local. Closing or changing a context releases its runtime subscription. Reconnect reads the persisted page plus bounded live recovery state.

Implemented Host/browser coverage includes interleaved selections, foreign cookies, missing CSRF, workspace-bound devices, persisted transcripts in two workspaces, receipt isolation, revoke/expiry and late socket attachment. Desktop IPC/SSH forwarding carries the same handle and rejects stale connection generations. This ADR remains Proposed while real multiple-conversation, native desktop and SSH acceptance are incomplete.

## Consequences

The contract affects HTTP routing, operation-handler state, browser transport, desktop IPC and SSH session lifecycle. Remaining acceptance covers real conversation creation and runtime event streams, empty drafts, read-only/bound device operations, late-open/close races and real SSH forwarding. Renderer build success alone is not acceptance evidence.

## Alternatives

- Keep one mutable selection per cookie: rejected because concurrent conversations can route operations and receipts to the wrong workspace/session.
- Use an unbound renderer-side filter: rejected because it cannot enforce authorization or isolate host event delivery.
- Add a second authentication server in the vendored loopback adapter: rejected; production contexts stay behind the existing Zeta Host authority.

## Links

- [Conversation context client](../../web-app/src/vendor/transport-web/src/browser-client.ts)
- [Host authentication and event routing](../../packages/coding-agent/src/server/studio-host/server.ts)
- [Remote SSH bridge](../../desktop/src/remote/bridge.ts)
