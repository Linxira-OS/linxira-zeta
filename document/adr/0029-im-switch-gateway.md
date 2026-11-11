# 0029. IM switch handshake gateway wire

- **Status:** Proposed
- **Date:** 2026-11-12
- **Deciders:** IM line (session/router/TUI host/gateway); Team renderer consumer: team-studio2
- **Links:** [Team Studio](../../docs/team-studio.md), [session router](../../packages/coding-agent/src/channels/session-router.ts), [IM gateway](../../packages/coding-agent/src/server/web-gateway/im-instances.ts), ADR-IM-0007, REQ-080, REQ-084

## Context

`SessionRouter` already owns the confirm-gated workspace switch: a preview
stores one pending request (scoped by instance + chat + thread + sender, 10
minute TTL, optional restore from a durable `im_control` transcript entry),
and `confirm`/`cancel` apply or discard it. The IM web gateway exposes read
routes for sessions/commands/bindings but no wire for a Team IM page to read
the pending handshake or confirm/cancel it. Adding a second pending store,
another numbering model, or browser-side validation would violate the existing
single-owner contract.

## Decision

Expose three routes over the existing router methods:

- `GET /api/im/switch?instanceId&chatId[&threadId&userId]`
  → `{ current, pending? }` where `current = {workspaceAlias?, agentId?,
  bindingId?, targetKey}` and `pending = {requestId, operation,
  from, to, requestedAt, controlRecord?}`. Pending is read from the live map
  or rebuilt from `im_control`; the restore path and the live path share the
  same 10-minute expiry.
- `POST /api/im/switch/confirm`
  body `{instanceId, chatId, threadId?, userId?, requestId}` (requestId required)
  → `{ok:true,target}` or `{ok:false,error}`.
- `POST /api/im/switch/cancel`
  same body → `{ok:true}` or `{ok:false,error}`.

`requestId` is mandatory for mutations. The router takes an optional
`expectedRequestId` and compares it to the live pending request *inside the
same method*, before deleting or applying anything. The gateway never does a
`GET` then a `POST`, so a preview replaced between the UI read and the click
cannot be applied or cancelled by a stale id. A mismatched id returns 409
`stale-request` and leaves the live pending state and binding untouched.

Identity is exactly `instanceId + chatId + (threadId) + (userId)`; a sibling
thread or unrelated sender cannot see or mutate another entry. The existing
bang commands (`@workspace confirm`, `!workspace confirm`) continue to call
the same methods without `expectedRequestId`, using the live pending.

No authorization layer is added here: gateway routes inherit the gateway's
existing server auth policy; chat/thread/sender scoping is the router's
existing binding key.

## Consequences

- Team IM can show a real switch/confirm control with no local state.
- Stale UI ids fail closed; no second store, retry loop, or new validation
  system.
- Capabilities remain on the existing read-only `GET /api/im/commands`
  payload (`capabilities`), not a new route.

## Alternatives

- **Local renderer pending state with a direct binding PUT.** Rejected: it would
  create a second approval path and could apply a switch the router never
  previewed.
- **Reuse `!session use` command text only.** Rejected: it applies immediately
  and has no confirm step, so it cannot represent a pending preview.
- **A separate switch store or token.** Rejected: the router already owns the
  only pending map, TTL and restore path; a second store would diverge.

## Links

- [Team Studio docs](../../docs/team-studio.md)
- [Session router](../../packages/coding-agent/src/channels/session-router.ts)
- [IM gateway handlers](../../packages/coding-agent/src/server/web-gateway/im-instances.ts)
- Consumers: `web-app/src/studio/TeamImChatPane.tsx`,
  `web-app/src/studio/teamImBindingGateway.ts`
- Tests: `web-app/src/studio/teamImBindingGateway.test.ts`,
  `packages/coding-agent/test/im-switch-gateway.test.ts`
