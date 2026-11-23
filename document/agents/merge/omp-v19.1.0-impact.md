# OMP v19.1.0 sync impact

Checked 2026-11-23 against tag `v19.1.0`
(`a7135b8f31826c878734388b648f52bed8da436e`), merge-base `v18.22.0`
(`3e8cff3b7ce1`).

## Gate

Run before any merge:

```sh
bun scripts/upstream-sync-audit.ts --tag v19.1.0
```

The gate exits non-zero while `git merge-tree` reports conflicts. It reports the
exact tag, merge-base, upstream/Zeta commit counts, added/deleted/modified/
renamed files, crate renames, changed asset paths and conflict count. It does not
touch the worktree and does not authorize a merge.

## Result

- 1,456 upstream commits; 3,028 Zeta commits since the last integrated tag.
- 547 added, 118 deleted, 1,718 modified, 1,779 renamed files.
- 1,776 crate renames: upstream moved `crates/pi-*` to `crates/*` and renamed
  packages from `pi-*` to `omp-*`.
- Package namespace changed from `@linxiraos/*` to upstream `@oh-my-pi/*`.
- **715 merge-tree conflicts** from `main`; 364 conflicts / 477 blocks from the
  old `sync/omp-release/v19.0.0` base.
- Seven native asset files changed: `packages/natives/native/desktop.*`,
  `index.*`, `loader-state.*`, `version-sentinel.js`.

## Asset adjustment rules

1. Native addon `.d.ts`/wrapper files follow the upstream generated set, then
   Zeta's package names, export names and version sentinel are reapplied.
2. Release assets (`zeta-cli-*`, `zeta-desktop-*`, IDE binaries) are not taken
   from upstream; only their source inputs and build scripts are.
3. Desktop icons, installer NSIS, taskbar AUMID and branding stay Zeta-owned.
4. `web-app/` is Zeta's renderer, not an upstream asset; Studio sync remains a
   separate ADR-gated project.
5. Every asset rename must be reflected in release checks, checksum generation
   and `scripts/check-release-asset-names.ts` before CI.

## Merge decision

A one-pass merge is blocked by 715 conflicts. The next sync needs either:

- a dedicated conflict campaign with an ownership matrix and generated-file
  regeneration, or
- an explicitly approved re-baseline that is not a release merge.

Do not use `-X theirs`, cherry-pick, squash, or a rewritten tag to make the
number smaller. Studio stays at `v0.2.4` until the OMP baseline and Host adapter
are stable.
