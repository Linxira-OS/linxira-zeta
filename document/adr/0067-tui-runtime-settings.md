# 0067. TUI runtime settings reuse the existing serve authority

- **Status:** Accepted
- **Date:** 2026-11-17
- **Deciders:** Owner requested nested, clickable TUI settings; implementation and release acceptance remain separate.
- **Links:** [REQ-124](../requirements-ledger.md), [IM runtime](../../docs/im-runtime-ui.md), [ADR 0030](0030-im-secret-storage.md), [ADR 0061](0061-explicit-shared-im-conversation.md)

## Context

Work Studio already uses the native gateway for TOTP and IM configuration. The TUI settings selector supports nested editors, configured selection keys, native controls and SGR mouse routing, but `/2fa` only prints status and `/channels` only exposes administrative commands. Repeated slash commands do not satisfy the requested settings hierarchy.

## Decision

Add discoverable identity/device and IM entries to the existing TUI settings hierarchy. Each opens a child page with a visible Back action and the configured cancel key. Both native pointer events and SGR mouse input use the same actions as keyboard selection. Slash shortcuts open those same pages.

The coding-agent host supplies runtime pages to the schema-independent TUI package. A page discovers and probes the registered local Zeta serve instance, and uses its existing gateway routes. It never starts a server, channel poller or agent, creates a conversation, or persists a second configuration store. Configuration edits read current gateway state and retain unrelated rows; the existing WebConfig validation and lock remain authoritative.

TOTP enrollment, confirmation, verification, policy, recovery and disable use the existing auth routes and local/step-up rules. QR payloads, credentials, codes and enrollment secrets exist only in the transient alternate-screen editor. Back, close, expiry and disposal clear sensitive component state; asynchronous completion cannot repopulate a departed page. Debug metadata contains no secrets. Narrow/short terminals show complete wrapped manual data rather than a clipped QR.

IM pages preserve immutable instance/profile IDs. Bindings explicitly select an existing native conversation via the existing list/attach routes. Target, profile and model compatibility are checked by the existing backend; independent unbind changes only the selected entrance. No new-conversation fallback or last-chat inference is permitted. Platform login controls reflect actual support; QQ/WeCom holds are unchanged.

## Consequences

TUI and Work Studio share config, auth, session identity and channel lifecycle. Runtime settings need a live registered local serve; absence is an actionable error with retry, never a hidden replacement runtime. Character QR rendering reuses the existing renderer and remains independent of terminal image extensions. Physical scanning and external IM delivery require separate acceptance evidence.

The existing bulk gateway update routes retain their existing concurrency contract. This change does not introduce a second wire protocol or upgrade Proposed ADRs to Accepted. Release acceptance requires owner/reviewer decision and the normal release gates.

## Alternatives

- Status-only slash commands do not provide the requested navigation.
- Direct TUI config/auth mutations would bypass the live serve authority and are rejected.
- Reusing the frozen web-ui as a second product surface conflicts with the active surface boundary.

## Links

- [Settings selector](../../packages/tui/src/overlays/settings-selector.ts)
- [Native auth](../../packages/coding-agent/src/server/auth/two-factor-auth.ts)
- [IM gateway](../../packages/coding-agent/src/server/web-gateway/im-instances.ts)
- [Serve discovery](../../packages/coding-agent/src/server/serve-registry.ts)
