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
| `sync/omp/<release>` | Temporary OMP integration branch created from `main`. |
| `port/pi/<scope>` | Temporary semantic port of one Pi PR, package, or tightly related range. |
| `sync/web-ui/omp/<sha>` | Temporary OMP Web subtree update branch. |
| `port/pi-web/<scope>` | Temporary semantic port of one Pi Web feature. |

Remote-tracking refs are the source of truth for `pi-upstream`,
`omp-web-upstream`, and `pi-web-upstream`; do not create long-lived local
branches that invite a raw merge from those trees.

## OMP Runtime Sync

OMP updates are regular downstream integrations because OMP is an ancestor of
Zeta `main`.

1. Fetch `omp-upstream` and fast-forward `sync/omp` to its `main`.
2. Read the release notes and diff against the last Zeta OMP baseline.
3. Create `sync/omp/<release>` from `main` and merge the desired OMP range.
4. Resolve only Zeta-specific conflicts, preserve OMP behavior elsewhere, run
   the relevant checks, and merge the integration branch into `main`.
5. Add a baseline tag and update this document after an accepted release sync.

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
