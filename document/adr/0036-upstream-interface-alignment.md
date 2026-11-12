# 0036. Align to upstream interfaces before extending; never blanket-allowlist Zeta losses

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** Zeta owner (explicit interface-alignment ruling, 2026-11-12)
- **Links:** [merge damage classes](../agents/merge/damage-classes.md), [maintenance and ownership protocol](../maintenance-ownership.md), [upstream sync ledger](../upstream-sync.md), [release policy](../release.md)

## Context

The `v18.19.0` merge exposed **68 Zeta-only interface losses** across shared
files. Upstream changed those shared interfaces to make the code more regular
and to improve quality; the change is not a defect to reverse merely because it
conflicts with Zeta's previous shape.

Two past responses are now measured and rejected:

- A trial **full restoration of all 68** produced **73 type errors** and
  resurrected surfaces Zeta had deliberately retired. It also recreated
  maintenance and attack surface that the retirement had removed.
- A **blanket allowlist for Zeta-owned members** would let the merge go green
  while Zeta-owned functionality disappears silently. A green merge gate would
  then be hiding a product regression.

The missing third option is alignment: keep upstream's new contract as the
baseline, migrate Zeta's call sites to it, and add only the Zeta extensions that
have no upstream equivalent at a clean new boundary.

## Decision

Zeta treats the upstream contract and its new extension points as the standard
for shared interfaces.

1. **Renamed, moved, or merged by upstream:** migrate Zeta call sites to the new
   boundary and delete the old member. Do not restore the old name, even as an
   alias, unless a later ADR explicitly requires a compatibility promise.
2. **Genuinely deleted by upstream:** accept the deletion. Do not recreate the
   removed member under a Zeta-only name merely to keep a call site compiling.
3. **Zeta still needs the capability, but upstream has no equivalent:** implement
   the Zeta extension at a **new, clean boundary**. Do not restore the old
   upstream member, and do not disguise the extension as an upstream
   compatibility shim.
4. **Zeta-initiated retired surfaces stay retired.** Only these may enter a
   **retired-surface exception list**, with the retirement reason and the
   decision/ADR that established it. An exception is not a blanket permission
   for unrelated missing members.
5. **No blanket allowlist for Zeta-owned losses.** Each missing interface must
   be classified as migrated, accepted-deleted, new Zeta extension, or
   retired-surface exception. A generic allowlist that suppresses the loss is
   not an acceptable merge resolution.
6. **Future syncs align first, then extend.** Build the mapping from upstream's
   new contract to Zeta call sites before adding Zeta-specific behavior; do not
   use the next sync to reintroduce the previous shape.

This ADR governs merge resolution and interface ownership. It does not authorize
deleting working Zeta behavior without a mapping, and it does not weaken the
security, evidence, or release rules in the linked records.

## Consequences

- Each sync needs a **mapping table**: upstream old interface → upstream new
  interface/extension point → affected Zeta call sites → action
  (`migrate`, `accept-delete`, `new-extension`, or `retired-exception`).
- Call-site migration, type checking, and behavior verification become the work
  of the merge, not a post-merge cleanup. The merge gate should turn green
  through alignment rather than through suppression.
- Retired-surface exceptions need a recorded reason and the decision/ADR that
  retired the surface; they are auditable and bounded.
- Some Zeta-only capabilities will move to new modules or new method names. That
  is intentional boundary repair, not a loss of the capability.
- Future upstream syncs start with an interface diff and call-site inventory
  before any Zeta extension work. This reduces repeated restore/allowlist
  churn, at the cost of more deliberate mapping work per sync.
- A compile-clean tree is not sufficient evidence: behavior tests and the
  relevant runtime checks still decide whether a migrated call site works.

## Alternatives

- **Restore all 68 interfaces wholesale.** Rejected: the trial produced 73 type
  errors, revived retired surfaces, and recreated maintenance and attack
  surface.
- **Allowlist all Zeta-owned missing members.** Rejected: it lets Zeta-owned
  functionality disappear silently and turns a green merge gate into a false
  signal.
- **Delete everything upstream deleted without migrating Zeta call sites.**
  Rejected: it causes functional regression where Zeta still needs the
  capability. The correct route for those cases is a new clean Zeta extension
  boundary.
- **Do nothing and keep the merge gate red.** Rejected: the interface drift
  compounds, and the next sync inherits the same ambiguous losses without a
  mapping.

## Links

- [Merge damage classes](../agents/merge/damage-classes.md)
- [Maintenance, ownership, and security protocol](../maintenance-ownership.md)
- [Upstream sync ledger](../upstream-sync.md)
- [Release policy](../release.md)
