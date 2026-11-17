# 0060. Two-factor storage failures deny remote writes and factor changes revoke grants

- **Status:** Proposed
- **Date:** 2026-11-16
- **Deciders:** Zeta maintainers
- **Links:** [REQ-102](../requirements-ledger.md), [serve authentication](../../docs/zeta-serve-web.md)

## Context

The existing TOTP store treats malformed or unreadable state as an empty store. That removes the remote write gate after a storage failure. In-memory verification grants also outlive local disable/re-enrollment and can authorize a device against a replacement factor. The renderer advertises recovery codes but submits them as TOTP codes, and its prompt queue can leave cancelled or unmounted requests pending.

The owner asks to complete existing 2FA fixes and verification while deferring mobile remote development. This does not authorize configuring external devices/accounts, adding a push provider or changing SSH host/key trust.

## Decision

A missing TOTP file retains the existing fresh-install behavior. Invalid JSON, unsupported schema, inconsistent factor state and non-ENOENT read failures are unavailable authentication state, never an implicit opt-out. Remote writes and factor mutations fail with a secret-free `503 two_factor_unavailable`. Status reports the same failure. Genuine loopback access remains usable; an explicit local disable resets the store, then the operator can re-enroll. Reads do not overwrite damaged bytes.

Keep the existing 12-hour write and 10-minute sensitive-action windows. Bind each grant to the active factor and its enrollment timestamp, recheck that binding on use, and clear grants on successful confirmation, disable and policy changes. Revalidate the original device/cookie identity before publishing a verification grant after awaited work. Restart still clears every grant.

Replay counters and recovery-code consumption commit before any grant is published. Staged-file replacement reuses the existing bounded Windows atomic retry while leaving the previous file present; a failed durable commit reports unavailable and never creates a grant.

The renderer submits six-digit input as TOTP and other nonempty input as a recovery code. Concurrent challenges for the same fetch wrapper share one verification attempt; each protected request may replay once. Cancellation/unmount settles every pending prompt without verification or replay. Enrolling and confirming a replacement factor retains the existing local-or-recent-step-up requirement.

The terminal surfaces also expose the same profile's read-only status: `/2fa status` in the TUI and `zetacode 2fa status` in the CLI. They show enrollment, required policy, pending enrollment, recovery-code count, unavailable-state recovery guidance and the two verification-window durations. They never display the factor, hashes, device tokens or claim that a different process has a live verification grant. Enrollment and destructive recovery remain on the existing authenticated local settings surface.

## Consequences

A damaged store now blocks remote mutations until repaired locally. Status failure must remain visible rather than being rendered as "off". A replacement factor requires fresh verification on every device, even when a prior grant had time remaining. Existing valid version-1 stores remain readable; no credential-store migration or copy is introduced.

Push confirmation remains unimplemented and separately scoped. Local SSH port forwarding retains the documented loopback trust boundary; TOTP does not replace SSH authentication.

Acceptance requires store corruption/schema/replay tests, real gateway/Host authority and grant-transition tests, renderer recovery/concurrency/cancel checks, and a browser exercise of the actual prompt against an isolated native Host. Passing checks does not change this ADR's Proposed status.

## Alternatives

- Treat damage as disabled: rejected because a file error removes remote protection.
- Persist verification grants: rejected because restart should require fresh verification.
- Add a second push-approval store/provider in this repair: deferred with mobile remote scope; it requires its own challenge/device binding and external acceptance.

## Links

- [TOTP persistence](../../packages/coding-agent/src/server/auth/two-factor-store.ts)
- [HTTP verification](../../packages/coding-agent/src/server/auth/two-factor-auth.ts)
- [Renderer prompt](../../web-app/src/studio/settings/AuthStepUpBoundary.tsx)
- [Requirements ledger](../requirements-ledger.md)
