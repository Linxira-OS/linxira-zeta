# 0032. Lead mode is reachable from headless/ACP/IM slash dispatch

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** A core/product owner (REQ-045 `/lead` parity)
- **Links:** [Team foundation](../../docs/team.md), [mode service](../../packages/coding-agent/src/session/agent-session.ts), [slash modes](../../packages/coding-agent/src/slash-commands/builtin-modes.ts), ADR-0003, ADR-0031, REQ-045

## Context

`/lead` and its `/pm` alias register only `handleTui`. ACP and IM dispatchers
require `handle` and skip TUI-only entries. The session already owns the shared
mode service: `enterLeadMode`/`exitLeadMode` validate PM workspace identity,
reject plan/goal/vibe conflicts, preserve the previous toolset, and install the
coordination tools. There is no second Lead-mode backend.

## Decision

Add a `handle` to the existing `/lead` (`/pm`) command. It toggles the same
`AgentSession` lead-mode methods used by the TUI, reports the entered PM/team or
disabled state as plain text, and returns a failed result on mode errors. It
does not create an agent, enable Vibe, or bypass the existing PM workspace and
toolset boundary.

## Consequences

- Headless, ACP and IM callers can enter/exit Lead mode through the same session
  state and tool activation as the TUI.
- `/pm` remains an alias with identical behavior; the TUI handler is unchanged.
- The PM toolset, Secretary availability and mode-conflict rules stay owned by
  the existing session service.

## Alternatives

- Add a separate headless Lead coordinator. Rejected: duplicates mode state and
  the PM tool boundary.
- Keep the TUI-only command and tell clients to attach a terminal. Rejected:
  ACP/IM have no terminal and the session service is already headless-capable.

## Links

- [Team foundation](../../docs/team.md)
- [AgentSession mode service](../../packages/coding-agent/src/session/agent-session.ts), [slash modes](../../packages/coding-agent/src/slash-commands/builtin-modes.ts)
- ADR-0003, ADR-0031, REQ-045
