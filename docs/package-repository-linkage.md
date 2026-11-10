# Package repository linkage and zwork → Zeta migration

This page is the contract between Zeta's own product identity and the external
package repositories that distribute it. The machine-readable form is
[`packaging/package-linkage.json`](../packaging/package-linkage.json); the guard
`scripts/check-package-linkage.ts` keeps it aligned with
`desktop/package.json`, `desktop/electron-builder.yml`, the release job and the
published package metadata.

The manifest is deliberately written from the upstream side. It declares what
this repository builds and publishes; it does **not** claim ownership of
distribution package names. Package repositories normalize upstream assets onto
their own package names, and only a name that repository actually publishes is
authoritative for install and upgrade.

## 1. Repositories

| Repository | Visibility | Role | Current state |
| --- | --- | --- | --- |
| `Linxira-OS/linxira-zeta` | public | Source + GitHub release for the product (`v<version>` tags) | `v1.5.0` published 2026-11-10; `main` is 1.5.1 with no tag yet |
| `Linxira-OS/packages` | public | Arch PKGBUILDs for Linxira packages; CI builds, signs and publishes pacman repositories | `[linxira-zeta]` rolling release tag `zeta-repo`, rebuilt 2026-11-10 with 1.5.0 |
| `Linxira-OS/linxira-packages` | public | Signed `[linxira]` pacman repository database + packages on GitHub Pages | `linxira-catalog 3.6.0-1` and the system stack; **no** `linxira-zeta` |
| `Linxira-OS/linxira-catalog` | public | Compiles/publishes the reviewed software catalog database (`catalog-v2.json`, `catalog-v3.json`) | `VERSION` 3.6.0, tag `v3.6.0`; packaged as `linxira-catalog` |

There are two pacman sections:

```ini
[linxira]
SigLevel = Required DatabaseOptional
Server = https://linxira-os.github.io/linxira-packages/$arch

[linxira-zeta]
SigLevel = Required DatabaseOptional
Server = https://linxira-os.github.io/packages/zeta/$arch
Server = https://github.com/Linxira-OS/packages/releases/download/zeta-repo
```

The desktop package is too large for the `[linxira]` Git checkout, so it lives
only in `[linxira-zeta]`: package files and the signed index are release assets
under the fixed tag `zeta-repo`, mirrored under the same Pages domain at
`packages/zeta/`. `linxira-pacman-fetch` rewrites those GitHub URLs through an
accelerator and resumes partial downloads.

GitHub's package registry cannot be listed with the tooling used here
(`read:packages` is not granted), so the package state above is read from the
signed repository indexes and release assets, not from the package API.

## 2. Published packages and versions (2026-11-10)

| Ecosystem | Name | Version | Notes |
| --- | --- | --- | --- |
| pacman / `[linxira-zeta]` | `linxira-zeta` | 1.5.0-1 | desktop shell; `Replaces`/`Conflicts` `linxira-zetawork`; 353,927,734 B; sha256 `a64fba61…2308d7` |
| pacman / `[linxira-zeta]` | `linxira-zeta-c-bin` | 1.5.0-2 | `Provides zetacode`, `Conflicts zetacode-bin` |
| pacman / `[linxira-zeta]` | `linxira-zeta-ide` | 1.5.0-2 | `Provides zetaide` |
| pacman / `[linxira-zeta]` | `linxira-zetawork` | 1.4.1-1 | **retired**; `Provides zetawork`, installs `/usr/bin/zetawork` |
| pacman / `[linxira-zeta]` | `linxira-zeta` | 1.4.10-1 | **legacy zwork desktop** (TUI + GUI), same package name |
| pacman / `[linxira]` | `linxira-catalog` | 3.6.0-1 | catalog DB package (separate product) |
| npm | `@linxiraos/zeta` | 1.5.0 | bin `zetacode` |
| npm | `@linxiraos/ide` | 1.5.0 | bin `zetaide` |
| npm | `@linxiraos/main` | 1.4.10 | **paused**; bins `zetawork`, `zeta`; does not receive 1.5.x |
| npm | `@linxiraos/main-linux-x64` | 1.4.10 | paused platform leaf |
| npm | `zeta-desktop` | private | desktop shell identity; **not published**, so no npm upgrade path |

Product identity (`desktop/package.json` + `desktop/electron-builder.yml`):

- npm name `zeta-desktop`, product `Zeta`, appId `com.zeta.desktop`,
  executable `zeta-desktop`;
- release tag `v<version>`; asset basename
  `zeta-desktop-<version>-<os>-<arch>.<ext>`;
- Linux: `zeta-desktop-<v>-linux-x64.tar.gz`,
  `zeta-desktop-<v>-linux-amd64.deb`,
  `zeta-desktop-<v>-linux-x86_64.AppImage`; Windows:
  `zeta-desktop-<v>-win-x64.exe` / `.zip`;
- `SHA256SUMS.txt` covers every other release asset.

The deb's control metadata (verified from the 1.5.0 asset) is
`Package: zeta-desktop`, `Version: 1.5.0`, with no `Conflicts`/`Replaces`.

## 3. How version flow works

1. `Linxira-OS/linxira-zeta` publishes `v<version>` with the upstream assets.
2. `Linxira-OS/packages` `auto-bump.yml` scans its `upstream-sync.toml` entry
   for `linxira-zeta` in `assets` mode, rewrites `pkgver`/sha256 from
   `SHA256SUMS.txt`, and opens a `chore(bump)` PR. Squash-merging it triggers
   `packages.yml`; the `chore(bump` commit message lets the publish job sign
   and upload the new `linxira-zeta-<version>-1` package plus the rebuilt
   `linxira-zeta.db` to the `zeta-repo` release, and mirror it under Pages.
3. Installed systems see it only if the `[linxira-zeta]` section is configured
   (see §6). The desktop shell itself has no app updater: `desktop/src/update-check.ts`
   maps the gateway answer with `app.plan = "none"`; the runtime updates
   through the bundled service, the bundle through a replacement installer.

## 4. zwork → Zeta desktop migration

Identity mapping (explicit, no guessing):

| Old identity | New identity | Automatic |
| --- | --- | --- |
| zetawork GUI (`/usr/lib/zetawork/zetawork-gui`, `zetawork-gui.exe`) | `zeta-desktop` (npm identity, private) / `linxira-zeta` (pacman) / `zeta-desktop` (deb) | no — package/installer semantics below |
| zetawork TUI (`/usr/bin/zetawork`, `@linxiraos/main` bin `zetawork`) | retired; the CLI is `@linxiraos/zeta` (bin `zetacode`) | no |
| `@linxiraos/main` (paused, 1.4.10) | `@linxiraos/zeta` — **not a rename** | no |

Two legacy products exist and they migrate differently. Never claim an
automatic in-place upgrade where the package name or installer identity differs.

| Platform | From | To | Mechanism | Uninstall needed |
| --- | --- | --- | --- | --- |
| Linux (pacman) | `linxira-zeta` ≤ 1.4.10-1 (zwork TUI/GUI) | `linxira-zeta` ≥ 1.5.0-1 | **in place** — same package name; pacman removes the old file set and installs `/opt/linxira-zeta` + `/usr/bin/zeta-desktop` | no |
| Linux (pacman) | `linxira-zetawork` ≤ 1.4.1-1 | `linxira-zeta` ≥ 1.5.0-1 | **replace** — the current package declares `Replaces`/`Conflicts` `linxira-zetawork`; `pacman -Syu` applies it. A bare `pacman -U` does not apply `Replaces`, so remove the old package first on that path | no |
| Linux (deb) | `zeta-desktop` ≤ 1.4.13 | `zeta-desktop` ≥ 1.5.0 | in place (`dpkg -i` / `apt install ./…deb`); no deb existed in the 1.4.10 zwork release | no |
| Linux (AppImage) | `linxira-zeta-*` / `zeta-desktop-*` AppImage | `zeta-desktop-<v>-linux-x86_64.AppImage` | replace the file; no package-manager state | no |
| Windows | zwork per-user NSIS (`%LOCALAPPDATA%\Programs\Linxira Zeta`, `HKCU\Software\LinxiraZeta`, no appId) | electron-builder NSIS (`appId com.zeta.desktop`, `%LOCALAPPDATA%\Programs\Zeta`) | **replace**: uninstall then install; the installers share neither appId nor install directory | **yes** |
| npm | `@linxiraos/main` ≤ 1.4.10 | none | not renamed into `zeta-desktop`; the CLI stays `@linxiraos/zeta` (bin `zetacode`). Uninstall the old workbench launcher | — |

`linxira-zeta` 1.5.x no longer `Provides zetawork`. No repository package
depends on that virtual; a third-party package that does must be updated.

### Package-manager fields

- pacman: same-name upgrade for `linxira-zeta`; `replaces=linxira-zetawork`,
  `conflicts=linxira-zetawork`; `provides` dropped.
- deb: `Package: zeta-desktop`, no `replaces`/`conflicts` needed because the
  zwork era shipped no deb.
- The external repository owns these names; the manifest mirrors them but does
  not invent additional aliases.

## 5. Config and data compatibility

`~/.zeta` is the shared configuration root and is **preserved**:

- zwork GUI/CLI read `~/.zeta` (`projects.json`, `serve.json`,
  `agent/web.yml`, `agent/sessions/`, `zetawork.toml`);
- the 1.5.x desktop shell finds the service through `~/.zeta/serve.json` and the
  bundled `zeta` CLI owns the same root (`APP_NAME=zeta`);
- package payloads install under `/opt`, `/usr/bin`, `/usr/share` and never
  touch `$HOME`.

Not migrated: the Electron shell's own window/workspace state
(`app.getPath('userData')/workspace-state.json`, `desktop-settings.json`) has no
zwork predecessor and starts fresh; `~/.zeta/zetawork.toml` is left on disk but
not read by the shell.

## 6. Update channel and the existing-install gap

New installs get both pacman sections from the installer
(`linxirapacstrap._enable_target_linxira_repo`) and the download adapter
(`_enable_pacman_fetch`). Installs created before that change do not.

Verified gap: an inspected Linxira OS install with `linxira-zeta 1.4.4-1`
(installed 2026-10-27) has only `[linxira]` in `/etc/pacman.conf` and no
`XferCommand`. `linxira-zeta` is absent from `[linxira]`, so `pacman -Syu`
cannot see 1.5.0 on that system until the `[linxira-zeta]` section is added
(or the package is installed explicitly with `pacman -U`). This is why the
manifest marks "every existing 1.4.x install can discover 1.5.x with
pacman -Syu" as **unverified** rather than claiming a guarantee.

For 1.5.0 → 1.5.1 the same rule applies: once `v1.5.1` exists and the packages
workflow republishes `zeta-repo`, systems with the section upgrade in place;
systems without it do not.

## 7. Verification status

Verified from live sources:

- `v1.5.0` release, its assets and `SHA256SUMS.txt` hashes;
- `linxira-zeta` 1.5.0-1 in the signed `[linxira-zeta]` index, including
  `Replaces`/`Conflicts` and the package sha256 (`a64fba61…`), matching the
  downloaded package byte for byte;
- legacy identity: published `linxira-zeta-1.4.10-1` `.PKGINFO`
  (`Provides zetawork`, `linxira-zeta`), an installed 1.4.4-1 pacman DB, and the
  retired `linxira-zetawork` 1.4.1-1 PKGBUILD;
- deb control fields; npm versions and `zeta-desktop` absence;
- **the pacman upgrade transaction**, run 2026-11-10 in a Linxira OS (Arch)
  environment with the published packages:

  ```
  linxira-zeta 1.4.10-1  ->  linxira-zeta 1.5.0-1   (same package name, in place)
  PASS: upgraded version is 1.5.0-1
  PASS: /usr/bin/zetawork and /usr/lib/zetawork removed
  PASS: /opt/linxira-zeta + /usr/bin/zeta-desktop present (symlink)
  PASS: ~/.zeta is byte-identical
  PASS: bundled kernel starts and reports 1.5.0 (zetacode/1.5.0)
  PASS: synthetic linxira-zetawork 1.4.1-1 replaced through pacman -Su
  ```

  The retired `linxira-zetawork` package is no longer published, so its side of
  the transaction uses a synthetic 1.4.1-1 package with the real package name,
  version and file; the replacing package and its `Replaces`/`Conflicts` fields
  are the real 1.5.0-1 artifact.

Unverified or pending (see the manifest `verification.claims`):

- deb (dpkg) and AppImage replacement transactions;
- Windows installer replacement (distinct installer identity, requires
  uninstall);
- automatic repo discovery on pre-2026-10-28 installs (blocked, §6);
- any 1.5.1 package or asset (not published at analysis time).
