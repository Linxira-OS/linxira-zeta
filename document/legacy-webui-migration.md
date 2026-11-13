# Legacy `web-ui` / `zetawork-gui` Migration Ledger

This is the **single tracking ledger** for the retired `web-ui/` renderer and
`main/crates/zetawork-gui/` workbench. It records archive location, current-tree
copies, known migration gaps, target paths, and the deletion gate. It is an
internal migration record under `document/`, not a product surface and not an
owner hold.

## Archive

| Fact | Value |
| --- | --- |
| Archive branch | `archive/web-ui-zetawork-gui-2026-11-12` |
| Archive commit | `e528e6c18deabbe798c51e83a1609fdf28d01f38` |
| Parent | **None** — orphan branch, created from `381acebe3e6` content |
| Contents | `web-ui/` **1,081 files** + `main/crates/zetawork-gui/` **92 files** + root `README.md` |
| Policy | Do **not** build, merge, or publish from this branch. It is a local-only recovery point. |
| Delete gate | Do not delete until this ledger records the replacement/port status and the owner approves; record the SHA in the branch registry before deleting. |

The archive was verified with `git log -1 --format='%H %P' archive/...` (empty
parent) and `git ls-tree` counts (1,081 / 92). It is not a release branch.

## Current tree (not deleted)

At `main@381acebe` both trees are still present:

- `web-ui/` — **1,081 files**
- `main/crates/zetawork-gui/` — **92 files**
- `web-ui/` is frozen; it is not built, shipped, or maintained. Work Studio
  (`web-app/`) supersedes it. `main/` is the paused Rust line.

**PR #281** (`chore/remove-paused-zetawork`, title "remove retired zetawork
workbench and packaging chain") is **OPEN / CONFLICTING / DIRTY** against `main`.
It is held. Do not close, merge, review, or comment on it as part of this
migration; the owner hold in `document/roadmap.md` remains authoritative.

## Migration status

**Status is behavior parity, not file existence.** A target file existing in
`web-app/` does not prove the legacy behavior was migrated. Do not mark a row
`PORTED` without the stated evidence.

| Area | Legacy source | Target | Status | Notes / evidence needed |
| --- | --- | --- | --- | --- |
| Old settings surface | `web-ui/app/settings/`, `web-ui/components/settings/SettingsWindow.tsx`, `web-ui/components/settings/shared.tsx` | `web-app/src/studio/settings/` | **TODO** | Target directory exists, but a file-by-file legacy parity inventory and UI test are not recorded here. Do not infer completion from the presence of panes. |
| Model configuration page | `web-ui/components/ModelsConfig.tsx`, `web-ui/studio/ModelConfigPage.tsx` | `web-app/src/studio/ModelConfigPage.tsx` | **TODO** | The target page exists and is routed as `model-config`, but legacy page parity is not proven. Compare tabs, provider/model editing, roles, presets, accounts, and error/recovery paths. |
| Model YAML/JSON dual-format parsing | `web-ui/studio/structured-editor/` (`parse.ts`, imported by the legacy model config page) | `web-app/src/studio/structured-editor/parse.ts` | **IN PROGRESS** | Standard JSON and block-style YAML are both required; `docs/models.md` uses block-style YAML examples. Current `parseStructured` supports JSON and YAML, and `parseJsonOrYaml` tries JSON first then YAML, but no `structured-editor` test file exists at this base. Add fixtures for standard JSON, block-style YAML, invalid input, and round-trip behavior. |
| Other old `web-ui` features | `web-ui/**` (not yet inventoried) | `web-app/src/studio/**` | **TODO — 待盘点** | No completed-feature claim. Inventory is required before deletion; absence from this table is not evidence of migration. |

Legend: `TODO` = not done; `IN PROGRESS` = work exists but acceptance is not met;
`PORTED` = legacy behavior and its tests/docs are complete. No row is `PORTED` in
this initial ledger.

### Known target paths

- `web-app/src/studio/ModelConfigPage.tsx` — model/provider configuration page.
- `web-app/src/studio/settings/` — Work Studio settings panes and helpers.
- `web-app/src/studio/models/` — model/provider parameter, visibility, preset,
  account, and runtime helper panes.
- `web-app/src/studio/structured-editor/` — JSON/YAML editor and parser.

### Next workflow

`feat/webui-model-config` is the next owner/workflow branch for this migration.
At the base commit it points at `ddb44711b5d05941801ca42b0d4ceed9704c24a4`
with no migration commit on top; this ledger does not start or advance that
branch.

Acceptance for that workflow:

1. **Parser unit tests** covering standard JSON, block-style YAML, invalid input,
   and round-trip/serialization behavior. `docs/models.md` examples use the
   block style; test that exact shape, not only JSON.
2. **UI test** for the model-config page and settings surfaces touched by the
   migration (load, edit, save/reload, dirty-state, and failure display).
3. **Runtime docs** updates in `docs/models.md` and `docs/settings.md` for any
   user-visible command, config key, file format, or behavior change. `docs/`
   is the packaged runtime docs tree; this ledger stays in `document/`.

## Non-goals

- No new release plan. The 1.5.2 checkpoint reference, if any, belongs in
  `document/release.md` and is a pointer only; release readiness is audited by
  the release worker.
- No deletion of `web-ui/` or `main/crates/zetawork-gui/` from `main` in this
  change.
- No build, merge, publish, push, or PR work from the archive branch.
- No claim that any listed area is complete until the acceptance evidence is
  recorded.

## Related records

- `document/roadmap.md` — the small legacy-migration pointer; this is not an
  owner hold.
- `document/release.md` — 1.5.2 release checkpoint pointer only.
- `document/agents/workflow/branch-registry.md` — archive branch registration.
- `document/upstream-sync.md` — upstream lineage; not a migration ledger.
