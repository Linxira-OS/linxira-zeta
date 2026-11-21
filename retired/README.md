# Retired repository surfaces

This tree holds material that is deliberately no longer part of the product
surface. It is kept for history, recovery, and provenance; it is not a place for
new code.

Rules:

- no product package may import from `retired/`;
- no CI job may build, test, package, or publish from `retired/`;
- no release version line may include it;
- a restoration requires a new ADR and a normal forward move.

See `document/adr/0080-repository-path-governance.md`.

Current contents:

- `retired/zetawork/` — the old `main/` Rust workspace and its paused npm
  distribution. `main/` is reserved for the future Rust Pi import; this tree
  must not be built, published, or imported.
- `retired/web-ui/` — the frozen Next renderer snapshot, removed from the
  active product path. `web-app/` is the Work Studio renderer.
