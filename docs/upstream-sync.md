# Upstream Sync

## Purpose

Zeta is a downstream OMP distribution. OMP is the direct code parent; Pi and
Pi Web are feature sources that require semantic ports. Do not treat all four
projects as interchangeable merge sources.

The goal is user-visible feature and bug-fix coverage, not textual code parity.
Every upstream change must be classified as one of: port, already covered,
intentional divergence, or not applicable.

## Registered Upstreams

| Remote | Role | Current baseline |
| --- | --- | --- |
| `omp-upstream` | Direct runtime and CLI parent | `v17.2.2` at `80627462b4e91f46795ba87f3678174bd3c0b907` |
| `pi-upstream` | Semantic-port source for runtime features | `977ec833bbb86e245057e9162dbc1443c7b6e707` |
| `omp-web-upstream` | Direct source for `web-ui/` snapshots | `omp-web@0.8.1`, `c71edcb2a548fafb3889f9065527e08a8db80d71` |
| `pi-web-upstream` | Semantic-port source for Web UI features | `v0.8.5-9-g248aaf4`, `248aaf464d20f6b76966b6646e743ea0904214d1` |

`baseline/omp-v17.2.2` marks the OMP runtime baseline. The imported Web UI
code snapshot is recorded by its subtree commit and source SHA; Zeta owns the
small README and AGENTS overlay. OMP Web and Pi Web share `pi-web v0.8.1` at
`b4f4576b890de92b1def79a56ad1fb2841ee84c1` as their useful Web porting anchor.

## Branch Model

| Branch or namespace | Purpose |
| --- | --- |
| `main` | Zeta product branch. Only reviewed OMP syncs and Zeta changes land here. |
| `sync/omp` | Clean local branch tracking `omp-upstream/main`. Do not add Zeta changes. |
| `sync/omp-release/<release>` | Temporary OMP integration branch created from `main`. |
| `port/pi/<scope>` | Temporary semantic port of one Pi PR, package, or tightly related range. |
| `sync/web-ui/omp/<sha>` | Temporary OMP Web subtree update branch. |
| `port/pi-web/<scope>` | Temporary semantic port of one Pi Web feature. |

Remote-tracking refs are the source of truth for `pi-upstream`,
`omp-web-upstream`, and `pi-web-upstream`; do not create long-lived local
branches that invite a raw merge from those trees.

## OMP Runtime Sync

OMP updates are regular downstream integrations because OMP is an ancestor of
Zeta `main`, but they are admitted only at complete, official OMP release
tags. A release tag, not the upstream main branch, is the immutable boundary.

1. The user supplies the exact tag. Do not infer the latest release or accept
   `omp-upstream/main`, a commit SHA, or a commit range as the source.
2. Verify the remote tag with `git ls-remote --tags omp-upstream
   refs/tags/<tag>`. Fetch that exact tag and confirm its resolved commit agrees
   with the remote result. Stop if the tag is missing, ambiguous, or moved.
3. Fast-forward the unmodified `sync/omp` mirror to `omp-upstream/main`. Never
   merge this mirror into `main`.
4. Create `sync/omp-release/<release>` from `main`, preferably in an isolated
   worktree. Run a merge-tree report, then make a real non-squash merge of the
   verified release tag. Never cherry-pick, rebase, squash, copy individual
   upstream files, or omit incoming files to simplify a sync.
5. Resolve Zeta-specific conflicts within that complete merge. Record every
   conflict decision. Follow with separate commits for necessary Zeta branding,
   packaging, Bun, CI, or product adaptations; never use later untagged OMP
   work for these decisions.
   Root `README.md`, Zeta logo assets, product naming, homepage, install
   instructions, and public examples are Zeta-owned product surfaces. Restore
   them through a documented branding-overlay commit after the complete merge,
   not by skipping upstream files during the merge.
6. Verify `git merge-base --is-ancestor <tag-commit> HEAD`, run focused checks
   and required CI, then merge the integration branch into `main`.
7. Add a baseline tag and update the release ledger below after acceptance.

### OMP Release Ledger

For every OMP runtime sync, record:

- Previous Zeta OMP baseline and target release tag.
- Exact remote tag ref and resolved source commit SHA.
- Zeta starting commit, integration branch, and final merge commit.
- Merge-tree result and each conflict decision.
- Checks and CI results.

Do not alter an existing ledger entry after it records an accepted release.

### Pending: v17.2.11

- Prior baseline: `v17.2.2` at `80627462b4e91f46795ba87f3678174bd3c0b907`.
- Source: `refs/tags/v17.2.11` at `4dc97f89ab78fab003f40142ca0b4ebe68224b14`
  (verified with `git ls-remote --tags omp-upstream refs/tags/v17.2.11`).
- Zeta start: `a6dcdc34d7e2ce1cab726877819ec0bbeb5e24ce`; integration branch:
  `sync/omp-release/v17.2.11`; tag merge commit:
  `5d251c2d620d216dcbdc62726f3a7b60f7fc0cbf`.
- Merge-tree found ten conflicts: `bun.lock`, the native version sentinel,
  model registry, command controller, and seven coding-agent test files.
- Retained Zeta package identity, workspace graph, localized handoff display,
  explicit retry-after behavior, provenance-aware renderer tests, and native
  sentinel `__piNativesV1_0_0`. Restored the OMP provider unregistration
  lifecycle, provider discovery preparation, normalized handoff cancellation,
  task-agent refresh regressions, and regenerated `bun.lock` with Bun 1.3.14.
- Checks: `bun install --frozen-lockfile` and
  `bun --cwd=packages/coding-agent run check` passed. Targeted coding-agent
  tests and root Rust checks are blocked locally because the Windows host has
  no MSVC `link.exe`; required CI remains pending before this branch may reach
  `main`.

## Pi Runtime Ports

Never run `git merge pi-upstream/main` into Zeta. Pi and OMP intentionally
diverge in the agent loop, session storage, tools, TUI, extension loader, auth
storage, runtime, and test framework.

1. Identify a Pi PR or a focused commit range and its affected packages.
2. Classify each change: direct port, semantic port, covered, divergence, or
   not applicable.
3. Create `port/pi/<scope>` from `main`.
4. Follow `docs/porting-from-pi-mono.md`: read both implementations, map APIs,
   retain OMP guarantees, and add focused coverage for changed behavior.
5. Record the source commit range and classification in the port commit body or
   pull request description. Update OMP's Pi marker only after a coherent port
   batch completes.

## Web UI Sync

`web-ui/` is intentionally outside the root Bun workspace. It keeps OMP Web's
own npm lockfile and development flow. Do not run a root formatter or lockfile
refresh across it.

1. For OMP Web updates, use `sync/web-ui/omp/<sha>` and update the subtree from
   `omp-web-upstream/main` as one source snapshot.
2. For Pi Web technology or product changes, use `port/pi-web/<scope>`, compare
   against the shared `v0.8.1` anchor, and preserve OMP-specific session,
   configuration, and database behavior.
3. Resolve the known OMP Web manifest/lockfile drift only as a dedicated Web UI
   maintenance change, never as incidental fallout from an upstream snapshot.

## Validation

- Runtime changes: run `bun check` and focused OMP checks required by the
  touched package.
- Web UI changes: follow `web-ui/AGENTS.md`; do not run `next build` during a
  development-server session.
- Upstream snapshots: verify the imported code is an exact source snapshot
  before applying documented Zeta-specific overlays.
