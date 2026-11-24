# Zeta Terminal fork (Wave snapshot)

This directory is Zeta's fork of Wave Terminal. It is an independent product
unit, not a member of the root Bun workspace and not part of the current Zeta
release, packaging, npm, or CI publication chain.

## Provenance

- Upstream: `wavetermdev/waveterm`
- Snapshot: `waveterm-main.zip`, upstream commit `9f1c9670d407be3b93cf090319a63ef30bf54d0e`
- Imported: 2026-11-23
- Upstream package version at import: `0.14.5`
- License: Apache-2.0 (`LICENSE`); upstream `NOTICE` is preserved verbatim
- No upstream Git history is present in this snapshot; upstream sync is by a
  named snapshot/tag and a reviewed import, never by rewriting this tree's
  history.

## License and issue-reporting policy

Because this is an Apache-2.0 fork:

1. All Zeta changes remain under Apache-2.0 and must retain `LICENSE` and
   `NOTICE`; modified files carry a short Zeta modification notice where the
   change is material.
2. **Report every problem found while adapting this fork to Zeta maintainers
   first. Do not open upstream issues, pull requests, discussions, or security
   reports for Zeta-specific changes.** If an issue is confirmed to be a
   genuine upstream defect, a Zeta maintainer decides whether and how to
   contact upstream.
3. Do not remove copyright, attribution, or third-party notices from vendored
   dependencies.

## Scope of the fork

Planned Zeta-owned changes, in order:

1. Resources and product identity: replace Wave names, icons, screenshots, and
   links with Zeta Terminal assets while keeping the Apache-2.0 notices.
2. Simplified Chinese localization: introduce an explicit message catalogue and
   a `zh-CN` locale; no ad-hoc string replacement inside renderer code.
3. Standalone CI and release: only after 1–3 land; separate workflow, lockfile,
   artifacts, and tag namespace.

Until those land, this directory is excluded from brand scanning as a vendored
upstream snapshot, and no root workflow builds or publishes it. See
`document/adr/0097-wave-terminal-fork.md` and REQ-149.

## Modification log

| Date | File | Change |
|---|---|---|
| 2026-11-23 | `terminal/README.md` | Added the Zeta fork notice (`ZETA-FORK.md`, no-upstream-report policy). |
| 2026-11-23 | `terminal/ZETA-FORK.md`, `terminal/AGENTS.md` | New Zeta fork metadata; upstream source unchanged. |
| 2026-11-24 | `frontend/app/view/term/term.tsx`, `termwrap.ts` | Removed the hidden overview-ruler reservation and force a full refresh/atlas clear after resize or renderer changes; targets the right-edge stale-cell artifacts. |
| 2026-11-24 | `frontend/app/view/term/termwrap.ts` | Do not scroll-to-bottom or serialize scrollback for alternate-screen TUIs; avoids viewport jumps and idle memory churn on large full-screen frames. |

No JavaScript, Go, build, or asset files have been modified yet. When they are,
add one row per material change and keep the upstream `LICENSE`/`NOTICE` intact.

## Upstream sync

- Import a fresh upstream snapshot and record its commit/version here.
- Re-apply Zeta changes on top; do not run an unreviewed textual brand sweep.
- Run the fork's own tests and the Zeta license/brand policy checks.
- Never push Zeta changes to the upstream repository without the owner's
  explicit instruction.
