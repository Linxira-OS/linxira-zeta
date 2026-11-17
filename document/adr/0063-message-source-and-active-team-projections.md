# 0063. Preserve message-level ingress attribution and project active Team facts

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Zeta product owner
- **Links:** [ADR0038](0038-two-lane-agent-hierarchy.md), [Team surfaces](../../docs/team-studio.md), REQ-098, REQ-100

## Context

One native conversation can receive input from Web, TUI and several IM entrances.
Attributing history from the current binding loses the source of older messages.
Active Team projections also need the worker's owning transcript to distinguish
its live state from a main agent that has navigated to another conversation.

## Decision

Active Team UI consumes source-scoped Vibe worker facts, the main-agent registry,
and the existing durable mesh room log. Legacy TeamDb/PM/engineer/Secretary data
and services remain preserved and hidden by default; they do not determine the
active graph. A worker registry join must match its source transcript before
showing status/activity or opening its observer. A main navigated to a different
source conversation cannot supply the old Team owner's live mode/activity.

Inbound IM messages remain real `role: user` entries and use the ordinary user
bubble on the right. Agent messages remain on the left. Every historical user
bubble displays its own ingress attribution, never the currently selected chat,
current session origin or latest binding. The existing REQ081 entry metadata is
the authority for IM platform, instance and sender. Explicit IM metadata takes
precedence over a client stamp on that entry.

`SessionMessageEntry.client` additively records the submitting client for each
new user entry. A prompt captures its actual request client before asynchronous
preparation/queueing; `PromptOptions.client` carries that identity to the message
writer. The writer's manager client is a fallback only for locally originated
messages. Gateway context exposes aligned `messageClients`, alongside existing
IM `messageMetadata`. The public conversation message carries an allow-listed
`source` display projection. Neither client nor source is an authorization field
or provider payload. Unknown older entries stay unknown; no replay migration
labels them Web, TUI or IM from current state.

No worker becomes an independent IM binding. External group-chat-specific UI
remains deferred; later channel adapters can add it without reinterpreting the
ordinary main conversation or rewriting historical message identities.

## Consequences

The same main conversation can contain Web, TUI and multiple IM-interface inputs
without losing sender identity or changing the user/agent layout. Source-bound
Team workers and durable room history remain visible across navigation, while
missing/offline observations stay explicit. Contract validators allow only the
small public source projection; private route, transcript paths and arbitrary
entry metadata are not copied to bubbles.

## Alternatives

- Derive every bubble's source from the current conversation binding: loses
  historical attribution when a binding changes.
- Use the legacy Team database as the active worker graph: represents a different
  ownership model from the Vibe-backed Team runtime.
- Copy arbitrary entry metadata into the renderer: exposes private routing and
  transcript details that the display projection does not need.

## Links

- [Team ownership decision](0038-two-lane-agent-hierarchy.md)
- [Team surfaces](../../docs/team-studio.md)
- [Canonical conversation projection](../../packages/coding-agent/src/server/studio-host/conversation-projector.ts)
- [Live conversation feed](../../packages/coding-agent/src/server/studio-host/conversation-feed.ts)
