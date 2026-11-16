# 0045. Studio command terminals retain their workspace

- **Status:** Proposed
- **Date:** 2026-11-15
- **Deciders:** Zeta maintainers
- **Links:** [REQ-099](../requirements-ledger.md), [terminal gateway](../../packages/coding-agent/src/server/web-gateway/terminal.ts), [Studio surfaces](../../docs/studio-surfaces.md)

## Context

Studio v0.2.1 creates command terminals from conversation code blocks. Zeta's renderer already supplies an explicit workspace and shell command, but its browser and desktop adapters discard both. The shared standalone gateway must remain the PTY owner and authentication authority.

## Decision

Extend the existing `POST /api/terminal/ensure` input with `workspaceId?: string` and `command?: {shell: "bash" | "sh" | "zsh" | "powershell", text: string}`. Resolve workspace identity through the same hidden-inclusive Host inventory used by conversation contexts. The credential binding check and process creation use that resolved directory; conflicting explicit cwd is rejected. Do not change the process-global project selection.

Run the complete command as the argv of a new shell process, never as delayed keystrokes into a reusable interactive shell. Discover the requested shell on the target machine. Missing shells fail explicitly; do not substitute another shell. Command launches cannot also specify a shell profile, companion program or file injection. A retry with the same cwd, instance and command reattaches; a different command cannot silently reuse that slot. Existing interactive terminals keep their reattach behavior.

Keep the existing response, one-time tickets, credential/device scope, origin checks and raw PTY WebSocket protocol. Forward dimensions and workspace through both browser and desktop adapters. Do not advertise renderer ACK support without real gateway backpressure.

## Consequences

Command blocks execute in the selected workspace on the selected local/SSH Host. The Host must enforce ownership before spawning. The multi-terminal manager remains owner-held. This ADR stays Proposed until gateway behavior, adapter behavior and a real terminal scenario have been verified.

## Alternatives

- Write command text into an existing shell: rejected because shell state and prompt races change execution semantics.
- Spawn in Electron: rejected because it splits PTY ownership and bypasses the shared gateway contract.
- Trust renderer cwd alone: rejected because a bound device must resolve the canonical workspace before spawning.

## Links

- [Browser terminal adapter](../../web-app/src/studio/terminals/browserTerminalApi.ts)
- [Desktop terminal bridge](../../desktop/src/terminal/bridge.ts)
- [Terminal behavior tests](../../packages/coding-agent/test/web-gateway/terminal.test.ts)
