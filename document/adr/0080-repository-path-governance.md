# 0080. Repository layout: Rust Pi core, retired Zetawork and frozen web-ui

- **Status:** Accepted; owner override 2026-11-21 (immediate move, Rust Pi import still deferred)
- **Date:** 2026-11-20
- **Deciders:** Owner, main agent
- **Links:** `document/agents/surface/surfaces.md`, `document/agents/surface/code-locations.md`

## Owner override (2026-11-21)

The owner superseded the deferred timing in the original decision:

- `main/` and `web-ui/` move to `retired/zetawork/` and `retired/web-ui/`
  immediately, even while Rust Pi remains outside the repository.
- `main/` is reserved for the future Rust Pi import; the retired Zetawork tree
  must not be rebuilt, published, or imported from.
- The active release/CI gates must stop referencing `main/` and `web-ui/` rather
  than keep passing by accident. A release gate that depends on retired paths
  is a defect, not a reason to keep the old path.

ADR is an implementation record for the owner's decision, not an authority
above the owner. This section is the current decision; the earlier deferred
timing sentence below is historical context only.

## Context

The repository currently uses `main/` for the paused Zetawork Rust workspace
(`zeta-main`, `zetawork-gui`, `workbench-projects`, `sysmon`, and the paused
`@linxiraos/main` npm distribution). Zetawork is no longer a product surface:
its TUI was replaced by Work Studio and its GUI was retired.

The maintained Rust Pi runtime is not tracked in the repository; it exists only
as an ignored reference copy under `temp/`. It already contains the native
durable runtime and the `rpi-*` crates. The owner wants the core runtime to move
toward that Rust Pi line, but not in the same change as the path cleanup.

`desktop/` is still the Electron distribution shell for Work Studio. It packages
the compiled runtime and `web-app`; it is not the retired `web-ui/` Next shell.
The three product surfaces remain Work Studio, `zetacode`, and `zetaide`. The
frozen `web-ui/` snapshot is not a product surface.

## Decision

The repository is organized by ownership, not by historical product names:

- `main/` becomes the home of the maintained Rust Pi runtime. Rust Pi is not a
  third-party dependency directory: it is an official maintained fork, so it
  gets a first-class path, with preserved MIT copyright and an additional Zeta
  maintenance notice.
- The old Zetawork contents move to `retired/zetawork/`. They are not built,
  imported, packaged, or release-versioned after the move.
- `web-ui/` moves to `retired/web-ui/` as a frozen snapshot. It is not a
  product surface and must not gain new code or publish legs.
- `desktop/` stays as the Work Studio Electron distribution shell. It is not
  the retired `web-ui` shell and is not part of the core runtime.
- `termide/` and `editor/` stay: they carry the `zetaide` product surface.
- `temp-bazel/` is removed; it was a tracked Bazelisk manifest with no source
  references, not a scratch directory.
- Rust Pi uses its own Cargo workspace and version line. It is not added to the
  Zeta 1.5.x release version gate until a later ADR defines the runtime
  transition.

`retired/` is a one-way boundary: no product source may import from it, no CI
job may build it, and no npm or GitHub release may publish from it. A path that
must be restored is restored by a new ADR and a normal code move, never by
reaching into the retired tree.

## Consequences

- `main` stops meaning "Zetawork" and starts meaning "the Rust Pi core runtime".
  Historical references must be updated rather than silently kept.
- Zetawork history remains available in the retired tree, but its builds,
  release assets, npm line, and version checks leave the active surface.
- The Work Studio browser renderer and Electron distribution keep their existing
  ownership split: `web-app/` renders, `desktop/` packages.
- Rust Pi can be imported without pretending it is a third-party package, but
  its license, provenance, sync policy, and independent version line become
  explicit maintenance obligations.
- Moving files is not a runtime cutover. The TS product continues to run on the
  existing `packages/coding-agent` surface until a later runtime ADR changes it.

## Alternatives

- **Keep Zetawork in `main` and put Rust Pi under `third_party/`.** Rejected:
  Rust Pi is an official maintained fork, and `main/` would continue to claim a
  retired product. It also hides the runtime transition behind a dependency
  path.
- **Delete Zetawork and `web-ui` immediately.** Rejected: history and recovery
  value are real; a retired tree is cheaper than reconstructing deleted code.
- **Retire `desktop/` with `web-ui/`.** Rejected: `desktop/` packages the
  current `web-app` renderer and is still the Electron distribution surface.
- **Move Rust Pi into `main/` in this ADR's implementation commit.** Deferred:
  the path decision is accepted, but the import and license/provenance review
  are a separate change so the move is reviewable.

## Links

- [Product surfaces](../agents/surface/surfaces.md)
- [Code locations](../agents/surface/code-locations.md)
- [Release policy](../release.md)
