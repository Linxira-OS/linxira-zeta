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

Current and planned contents:

- `retired/zetawork/` — the old `main/` Rust workspace and its paused npm
  distribution, once the Rust Pi import starts.
- `retired/web-ui/` — the frozen Next renderer snapshot, once its references
  are removed from the active product path.
