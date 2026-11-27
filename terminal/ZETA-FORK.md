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

1. Resources and product identity: Zeta Terminal logo (Zeta mark in a terminal
   frame), icons, About/help/onboarding links to the Zeta repository and site.
2. Simplified Chinese localization: typed `en`/`zh-CN` catalogue under
   `frontend/i18n`, starting with About, Help, and settings entry labels.
3. ACP-first agent surface: launch `zetacode acp`, keep a TSP page as an optional
   right-side surface instead of porting Wave AI.
4. Linux + Windows builds only in this phase; macOS is deferred. Separate CI,
   lockfile, artifacts, and `zeta-terminal-v*` tag namespace.
5. Shell policy: Nushell recommended; Bash/Fish on Linux; PowerShell 7+ on
   Windows; Windows PowerShell 5.1, `cmd.exe`, and per-window shell UI work
   tracked separately.

Until release/publish work starts, this directory is excluded from brand
scanning as a vendored upstream snapshot. It now has a root-owned CI entry
(`.github/workflows/terminal-ci.yml`) for its frontend and Go tests, but no root
workflow packages or publishes it. See
`document/adr/0097-wave-terminal-fork.md` and REQ-149.

## Modification log

| Date | File | Change |
|---|---|---|
| 2026-11-23 | `terminal/README.md` | Added the Zeta fork notice (`ZETA-FORK.md`, no-upstream-report policy). |
| 2026-11-23 | `terminal/ZETA-FORK.md`, `terminal/AGENTS.md` | New Zeta fork metadata; upstream source unchanged. |
| 2026-11-24 | `frontend/app/view/term/term.tsx`, `termwrap.ts` | Removed the hidden overview-ruler reservation and force a full refresh/atlas clear after resize or renderer changes; targets the right-edge stale-cell artifacts. |
| 2026-11-24 | `frontend/app/view/term/termwrap.ts` | Do not scroll-to-bottom or serialize scrollback for alternate-screen TUIs; avoids viewport jumps and idle memory churn on large full-screen frames. |
| 2026-11-24 | `assets/zeta/*`, `build/icons/*`, `build/icon.ico`, `assets/appicon-windows.*`, `frontend/app/asset/logo.svg` | New Zeta Terminal mark: Zeta LZ logo inside a terminal window frame; generated PNG/ICO sizes. |
| 2026-11-24 | `frontend/i18n/*`, `frontend/app/modals/about.tsx`, `frontend/app/view/helpview/*`, `frontend/app/view/waveconfig/waveconfig-model.ts` | Typed `en`/`zh-CN` catalogue; About, Help, and settings labels/links moved to it. |
| 2026-11-24 | `frontend/app/{modals,element,onboarding,aipanel}/*`, `README.md` | User-visible About/help/onboarding/docs links now point at the Zeta repo, Zeta docs, or Zeta website instead of Wave upstream. |
| 2026-11-27 | `frontend/app/view/waveconfig/shellsettings.tsx` | Windows shell picker now offers Nushell, the detected Git Bash, and PowerShell 7; POSIX keeps Nu/Bash/Zsh/Fish, so the full matrix is reachable without typing a path. |
| 2026-11-27 | `package.json`, `package-lock.json`, `electron-builder.config.cjs`, `Taskfile.yml` | Product identity set to `zeta-terminal` / `Zeta Terminal` / `so.linxira.ZetaTerminal`; Linux deb/rpm/snap/AppImage/pacman package name is now stable as `zeta-terminal`. |
| 2026-11-24 | `pkg/wconfig/defaultconfig/settings.json` | Default browser page points at the Zeta terminal path; telemetry defaults off; Wave AI button/cloud modes hidden. |
| 2026-11-24 | `pkg/util/shellutil/shellutil.go`, `pkg/shellexec/shellexec.go` | Nushell detection/version; Windows prefers `nu` then `pwsh` 7+, never falls back to PowerShell 5.1; empty/legacy shell gives an actionable error. |
| 2026-11-24 | `frontend/app/view/waveconfig/{shellsettings.tsx,waveconfig-model.ts,waveconfigenv.ts,waveconfig.tsx}` | General settings gets a visual shell picker; labels/visual/raw tabs localized. |
| 2026-11-24 | `.github/workflows/terminal-ci.yml` (root) | Migrated Terminal's active checks out of the ignored nested `.github` tree: Linux/Windows frontend typecheck/tests, Linux Go tests/build, Windows shell-package test. Upstream release workflows remain intentionally unmigrated. |

When further JavaScript, Go, build, or asset files are modified, add one row per
material change and keep the upstream `LICENSE`/`NOTICE` intact.

## Upstream sync

- Import a fresh upstream snapshot and record its commit/version here.
- Re-apply Zeta changes on top; do not run an unreviewed textual brand sweep.
- Run the fork's own tests and the Zeta license/brand policy checks.
- Never push Zeta changes to the upstream repository without the owner's
  explicit instruction.
