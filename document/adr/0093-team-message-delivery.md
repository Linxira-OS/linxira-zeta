# 0093. Team messages distinguish direct turns from ambient context

- **Status:** Accepted
- **Date:** 2026-11-22
- **Deciders:** Zeta owner
- **Links:** [Team Agent design](../team-agent-mode-design.md), [chat routing](../../packages/coding-agent/src/team/chat-routing.ts), [Team Hub](../../packages/tui/src/overlays/active-team-hub.ts)

## Context

A Team room is not a normal chat room and not a broadcast queue. The owner
defined the required behavior:

- a DM goes to its target;
- a group message with no mention reaches everyone, and each agent judges
  relevance;
- mentioning one agent assigns the message only to that agent; everyone else is
  told it was explicitly assigned elsewhere;
- mentioning the main is a main decision and does not automatically fan out to
  workers;
- an agent may proactively post in a room and mention another agent;
- a busy agent (for example, compiling) must still hear room messages at its next
  tool-call boundary, but must not be interrupted inside a tool call.

Treating all of these as model interpretation loses assignments, duplicates work,
or interrupts running tools.

## Decision

Team chat uses the model-free `routeTeamChat` contract in
`packages/coding-agent/src/team/chat-routing.ts`:

- DM: exactly the target receives `direct`.
- Group without mentions: every other participant receives `ambient`; nobody
  starts a turn for room membership alone.
- Group mentions: each mentioned first-level participant receives `direct`; all
  other participants receive `assigned-elsewhere` (a short notice, not the full
  message).
- A main mention is `direct` to main only; main decides whether to delegate.
- Unknown mentions are reported to the sender; routing never guesses.
- Agent senders obey the same rules and never receive their own message.

`direct` starts or queues a turn. `ambient` is injected at the recipient's next
tool-call boundary; it never interrupts a tool call or queued write.
`assigned-elsewhere` is a notice only. Room events persist sender, seq, mentions
and delivery state so reconnect/replay cannot lose an assignment.

Agent-originated messages may carry Host-resolved image/file descriptors. The
Web surface renders them inline/cards; the TUI renders clickable links with the
same Host resolution (Ctrl+click opens the image viewer, editor or system app).
No raw filesystem path is a public message field. Outbound agent messages are
audited and policy-gated.

## Consequences

The Team coordinator cannot override mention routing with prose. The Team surface
must show unknown mentions, delivery notices and attachment availability. The
routing contract is shared by Web, TUI and headless clients; a client must not
invent its own mention rules.

## Alternatives

- **Let the model decide recipients.** Rejected: assignments become
  nondeterministic and can be duplicated.
- **Wake every agent for every group message.** Rejected: interrupts long builds
  and wastes model turns.
- **Ignore busy agents until they finish.** Rejected: they would miss the
  message the user intended them to hear.

## Links

- [Team Agent design](../team-agent-mode-design.md)
- [ADR-0088](0088-one-host-many-clients.md)
- [ADR-0092](0092-team-identity-layers.md)
- [chat routing tests](../../packages/coding-agent/test/team/chat-routing.test.ts)
