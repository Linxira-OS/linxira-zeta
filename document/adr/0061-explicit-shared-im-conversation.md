# 0061. Multiple IM entrances may explicitly share one Agent conversation

- **Status:** Accepted
- **Date:** 2026-11-16
- **Deciders:** User requirement (via Main); IM runtime line (channels, gateway, Studio settings)
- **Links:** [IM runtime UI](../../docs/im-runtime-ui.md), [GUI IM channels](../../docs/gui-im-channels.md), [channels](../../docs/channels.md), [session router](../../packages/coding-agent/src/channels/session-router.ts), [IM gateway](../../packages/coding-agent/src/server/web-gateway/im-instances.ts), [web config](../../packages/coding-agent/src/config/web-config.ts), REQ-110, ADR-IM-0007

## Context

An IM binding row (`remote.imBindings`) names one instance + chat/thread/sender
and a target/profile. Its `sessionId` is the conversation pointer the router
materializes into a `BotSessionEntry` and a persisted transcript. The current
validator rejects a second binding with the same `sessionId`, and the router's
materializer derives a binding-specific transcript key
(`im-<targetScopedBindingId>`). The Settings binding editor exposes a free-text
session id, so an operator cannot choose an existing Agent conversation and
several entrances (two bots, two chats, a chat and a thread) cannot address the
same history.

The user requirement is narrower than "same profile shares history": adding an
entrance must explicitly select one existing Agent dialogue and then share its
exact conversation id and transcript. A profile (or a default target) alone
must never merge unrelated histories. The choice must include an existing
native Studio/TUI/main conversation, not only conversations first created by
IM. Ordinary settings UI must present conversation names; raw ids remain
internal diagnostics.

The existing single-owner contracts stay authoritative:

- `remote.imBindings` and `remote.botSessions` in `web.yml` are the only
  persisted binding/conversation registry; `WebConfig` owns their reads and
  writes.
- The session header id is the canonical persisted transcript id; a
  `BotSessionEntry` is a registry row pointing at that file, not a second
  transcript store.
- `SessionRouter.ensureImBindingSession` owns materialization; the gateway is
  an HTTP projection over the same methods.
- `SessionRouter`/`ReplyCorrelator` owns reply routing; inbound user entries
  carry immutable `source: "im"` metadata with platform, instance, chat,
  thread and sender.
- `startRpcSession`/the gateway session registry owns the live session by
  real transcript id; a second writer for one transcript is forbidden.

## Decision

Adopt one explicit sharing contract across the persisted schema, router,
gateway routes and Settings UI.

### Identity

- A binding's `sessionId` is the canonical **conversation key**. Several
  bindings may carry the same value. This is the only merge signal; equal
  `agentProfileId`, equal target, equal `lang`, or equal model never merge two
  different keys.
- A `BotSessionEntry` is the conversation registry row. Its `id` is the
  registry key used by `sessionId`, selectors and `!session use`; its
  `sessionFile` is the one transcript. `nativeSessionId` records the header id
  once it is known. For an existing native transcript the registry id SHOULD
  equal the header id; when a collision forces a different registry id,
  `nativeSessionId` is still the durable id and both are persisted once, never
  re-derived per delivery.
- Relaying (`sessionId: "relay"`) remains the coordinator sentinel and is not
  a second transcript.
- A conversation attached from a Studio/TUI/main transcript is marked
  `reusesExistingTranscript` and `nativeSessionId`. IM must never create a copy
  of that file, delete it, rename it, or relocate it. Detaching removes only
  the registry row and its bindings; deleting an IM-owned conversation keeps
  today's transcript deletion.

### Sharing agreement

Every binding that names the same `sessionId` MUST agree exactly on:

1. canonical target (`targetKey`, including workspace/Team/PM/engineer/repo);
2. `agentProfileId`;
3. explicit model override, when any entrance sets one. Absence means inherit
   the conversation's entry model; if two entrances set different models, the
   write fails. Changing the model updates every entrance and the entry in one
   write.

A write MUST also agree with an existing `BotSessionEntry`'s target/profile/
model. Conflicting target/profile/model is rejected with a field-specific
error; the router never silently remaps a shared or attached conversation to a
new transcript. Bindings that are not explicitly given the same `sessionId`
keep separate conversations even when all other fields match.

### Materialization and ownership

- The first binding for a new conversation materializes one entry and
  transcript. Later bindings with the same explicit key reuse that entry; the
  router neither forks the transcript nor overwrites its owner metadata.
- Owner metadata (`instanceId`, `bindingId`, `agentProfileId`, `target`,
  `model`) is stamped once, from the first binding, and then read-only for
  other entrances. The conversation transcript and its target/profile/model
  are owned by the conversation, not by whichever entrance spoke last.
- A shared conversation's registry row is not repinned to the latest chat.
  Per-message metadata carries the actual source. The transcript header origin
  may omit channel/chat when several entrances share it; `botSessionId` and
  `workspaceAlias` remain.
- Unbinding or editing one entrance removes/updates only its exact
  instance + chat + thread + sender row. It must not close, rename, move or
  switch the shared conversation or a sibling entrance. Project relocation of
  a shared/attached conversation is refused; it would rewrite every entrance's
  target.

### Delivery and replies

- One inbound IM message is delivered to the shared session as a `role: user`
  turn with immutable per-message metadata: platform, instance, chat id,
  optional thread id, optional sender id/name, platform message id, timestamp
  and the delivery-time route snapshot.
- Reply correlation is per delivered message id, not per binding's latest
  message. The reply target pinned at delivery (instance, chat, thread/sender
  scope) wins even when another entrance queued a message later, or another
  binding was edited while the turn was in flight. The outbound sink receives
  the originating platform message id and thread id when known; the existing
  `ChannelSendOptions` carries them, and adapters that do not support a
  thread/topic id keep the origin chat instead of inventing one.
- Concurrent/queued turns on one shared session answer only the message they
  actually woke for. A turn that answers no delivered IM record (Studio/attach
  prompt, agent-to-agent traffic) consumes no IM reply slot.
- Journal each inbound entry when its input enters the session context. Waiting
  inputs are process-local and stay out of compaction and replay until consumed.
- **Boundary:** the pending reply map is process-local. A process restart
  preserves the user entry's immutable message metadata and the conversation
  selection, but it does not resurrect an in-flight assistant reply slot; a
  turn interrupted by shutdown has no durable pending reply. Persisting
  reply correlation is not part of this decision.

### IM command contract

- `!session list` and `!session use <selector>` stay zero-AI and keep their
  existing command set; they need no extra approval. Both real entrances
  (`serve` and the CLI/TUI session host) resolve control commands before
  `resolveChatTarget`, so a command is never sent to a model or a bound
  workspace.
- Both commands carry the original instance, chat, thread and sender context.
  `!session list` marks `[当前]` for that exact entrance; `!session use`
  persists a switch only for that exact entrance. Sibling entrances of a
  shared conversation, and other threads/senders in the same chat, are not
  changed.
- A successful `!session use` reply names the conversation and its short
  stable selector (`NN-00001`). It never prints the raw registry or native
  UUID. `!session list` lines use the same selector and name.
- ASCII `!` is the primary command prefix in help and ordinary examples;
  full-width `！` is normalized to it for Chinese IMEs. `@`-prefixed aliases
  remain accepted for compatibility but are not the primary help/example
  form. Platform-native `@mention` triggers are unrelated and unchanged.
- Command replies are sent to the originating thread and, when the adapter
  supports it, carry the originating platform message id as a reply reference.

### Native conversation choice

- `GET /api/im/conversations` is a read model over the existing
  `remote.botSessions` and the gateway's existing session listing. It returns
  human names plus internal ids, workspace/target facts, bound entrance count
  and availability. Ordinary UI renders the name; raw ids are not table text.
- `POST /api/im/conversations/attach` canonicalizes one existing session id
  into a registry entry that points at the existing file. It performs no
  transcript write; it refuses unknown workspace ids and sessions whose
  canonical id is ambiguous.
- Availability is honest: a transcript whose workspace is not registered, or
  a session being written by another process, is rejected with the concrete
  prerequisite instead of being silently imported or copied.
- At most one live AgentSession exists per resolved transcript id. Conversely,
  if a native conversation is live and has no IM origin, attaching it is
  refused until that writer is closed; the gateway must not open a second
  writer or silently keep the existing non-IM runtime while claiming the new
  profile.

### Presentation

- Settings tables and selectors show the conversation registry name or native
  title. Raw `sessionId`/header ids appear only in diagnostics such as the TUI
  `/channels` view or advanced fields, never as the ordinary conversation
  label.
- The chooser selects by name, shows workspace/target/profile facts and the
  number of entrances, and auto-locks target/profile/model when the selected
  conversation already owns them.

## Consequences

- Two (or more) IM entrances can intentionally read and write one Agent
  history; every participant sees messages from all of them, with per-message
  source attribution. This is a deliberate trust expansion and must be
  documented where bindings are edited.
- Existing one-session-per-binding configs remain valid; no migration merges
  them. A legacy migration that split ambiguous duplicate session ids remains
  as-is and is not reinterpreted as sharing.
- A shared conversation can no longer be project-switched, model-switched, or
  moved by a single entrance; those operations either update all bindings
  atomically or fail explicitly.
- Attached native transcripts become IM-origin at runtime (they gain an IM
  header stamp and appear in the IM group) but keep their file, id, title and
  history. Deleting the IM conversation detaches rather than deletes them.
- The UI needs one additional read route and attach route; no second session
  store, no browser-side id composition, and no new runtime authority.
- Tests must cover two entrances on one transcript, conflicting
  profile/target/model rejection, restart roundtrip, attach idempotence,
  unbind/rebind isolation, and origin-correct delayed replies.

## Alternatives

- **Reuse one bot session whenever the profile and target match.** Rejected:
  profile/target equality is not an explicit request to share history; it
  would merge unrelated chats and private transcripts silently.
- **Fork/copy the selected conversation per entrance.** Rejected by the user:
  the requirement is the same conversation id and history, not a snapshot.
- **Keep the free-text session id and only relax the uniqueness check.**
  Rejected: the ordinary UI would still ask operators to invent/type ids and
  could not select a native conversation safely.
- **Create a second registry/transcript for an attached native file.**
  Rejected: it duplicates history and violates the single-writer/single-file
  authority.
- **Let the latest binding's chat own the shared transcript.** Rejected:
  replies and tool attribution must use the origin message, not global
  "latest" state.

## Links

- [IM runtime UI](../../docs/im-runtime-ui.md)
- [GUI IM channels](../../docs/gui-im-channels.md)
- [Channels](../../docs/channels.md)
- [Session router](../../packages/coding-agent/src/channels/session-router.ts)
- [IM gateway handlers](../../packages/coding-agent/src/server/web-gateway/im-instances.ts)
- [Web config](../../packages/coding-agent/src/config/web-config.ts)
- Tests: `packages/coding-agent/test/channels/im-shared-conversation.test.ts`,
  `packages/coding-agent/test/channels/shared-im-commands.test.ts`,
  `packages/coding-agent/test/web-gateway/im-conversations.test.ts`,
  `packages/coding-agent/test/channels/session-router.test.ts`,
  `packages/coding-agent/test/config/web-config-routing.test.ts`,
  `web-app/src/studio/settings/imRuntimeApi.test.ts`,
  `web-app/src/studio/settings/ImRuntimePage.test.tsx`
- [Integration PR #324](https://github.com/Linxira-OS/linxira-zeta/pull/324)
- [Real-session input and reply regression](../../packages/coding-agent/test/agent-session-log-context.test.ts)
