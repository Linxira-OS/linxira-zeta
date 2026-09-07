# Zeta Merge Review Rules

Single-page rules for reviewing an OMP release merge before it can leave a
`sync/omp-release/<tag>` branch. The AGENTS.md damage-class table is the
taxonomy; this page is the operating procedure a reviewer executes. The
machine checks referenced here are enforced in CI (`check` job) so prose-only
compliance cannot drift.

## Scope

Applies to every merge that brings upstream code into a Zeta product branch:

- OMP release merges (`sync/omp-release/<tag>`, complete official tag only)
- Pi semantic ports (`port/pi/<scope>`, `port/pi-web/<scope>`)
- Any hand-carried upstream patch that touches a shared file

## Pre-merge checklist (read, don't copy)

Order is mandatory. Each step links its authoritative source — do not
duplicate the content here; the link target is merge-protected:

1. **Baseline & tag verification** — `document/upstream-sync.md` (release
   sync policy, tag verification, ledger) and `AGENTS.md` (OMP Release Sync
   Policy section).
2. **Damage classes** — `AGENTS.md` post-merge release-surface checklist
   (8 classes) and `document/release.md` damage table. Triage fingerprints
   live there; do not re-derive them.
3. **Procedure** — `document/merge-playbook.md` six-stage pipeline.
4. **Brand surface** — `AGENTS.md` Brand Surface Registry + `scripts/brand/`
   guards (`brand-check.ts`, `brand-overlay.ts`).
5. **Zeta-only sentinels** — `scripts/brand/zeta-sentinels.ts` +
   `bun scripts/check-zeta-sentinels.ts` (this is the mechanical form of
   damage class #4; the registry is merge-protected data, the checker enforces
   the registry floor of 40 and the AGENTS.md link to this file).

## Conflict-resolution decision record

Every file resolved by hand or with `--theirs`/`--ours` in an OMP release
merge gets a row here (append, never rewrite history rows). A merge reaching
`main` with a conflict file not recorded here is invalid.

| Merge (tag) | File | Resolution | Reason |
|---|---|---|---|
| v18.1.10 | `packages/coding-agent/src/cli/update-cli.ts` | kept Zeta constants (`REPO`/`HOMEBREW_FORMULA`/`MISE_TOOL`) | upstream GH release + brew tap are the shared distribution infrastructure; renaming breaks the update chain (plan decision B6) |
| v18.1.10 | `.github/workflows/ci.yml` | kept Zeta CI (GitHub-hosted runners, Zeta job graph) | upstream `runs-on: omp-kata` never resolves in this repo; artifact names follow `zeta-cli-*` |
| v18.1.10 | `desktop/` | restored Zeta desktop CI references | merge-commit 50c5414846 dropped 4 desktop_linux references; desktop CI must survive every merge |

## Guard matrix

| Check | Command | Gate | CI job |
|---|---|---|---|
| Version line (packages, catalog, Cargo, natives sentinel, desktop, README badge) | `bun scripts/check-version-consistency.ts` | every push | `check` |
| Brand residue | `bun scripts/brand/brand-check.ts` | every push | `check` |
| Zeta-only sentinels + AGENTS.md link | `bun scripts/check-zeta-sentinels.ts` | every push | `check` |
| Type check | `bun run ci:check:full` | every push | `check` |
| Rust format | `cargo fmt --all --check` | when `crates/` touched | `rust_validate` |
| Native pipeline smoke | desktop smoke | release runs | `desktop_*` |

## Sentinels maintenance rule

Any PR that deletes or renames a listed symbol must update
`scripts/brand/zeta-sentinels.ts` in the same PR. A review that finds a
Zeta-only surface not yet in the registry should add it in the same PR.
Deletion of registry rows is a red flag: registry rows are removed only when
the underlying Zeta surface is deliberately removed (e.g. Track B cutover),
never as a merge-conflict resolution convenience.
