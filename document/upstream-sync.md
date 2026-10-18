# Upstream Sync Ledger

## Integrated through: v18.12.1

This line is the machine-readable answer to "which upstream tag is actually
in our history", and it is what `scripts/check-merge-lineage.ts` reads. It is
deliberately distinct from a merge entry's **Baseline** field, which records
what a round *started* from. Those are different questions: the v18.8.1–v18.8.6
round started at v18.7.0 but only v18.8.4 ever landed on main as a real
two-parent tag merge.

- **Integrated through**: `v18.11.3` (`96894a6147d8cc64b7e00ad3a7d7178fd93b9531`,
  confirmed by `git ls-remote --tags omp-upstream refs/tags/v18.11.3` **before and after** the merge
  returning the same peeled SHA, and by `git merge-base --is-ancestor 96894a6147d HEAD`, merge commit
  `24c3da1c56b`). The previous value was `v18.11.2`
  (`470b7efb67673960d37e3e64584669e6e9caad1c`, merge `bd6938cbac3`), which is exactly the merge-base
  this round started from (`git merge-base 5769cf3c771 v18.11.3` →
  `470b7efb67673960d37e3e64584669e6e9caad1c`), so this rung applies upstream's own
  `v18.11.2`→`v18.11.3` increment and never our diff. The v18.11.3 tag is a lightweight tag; it was not
  moved during this round.
- **Why not v18.8.6**: the v18.8.5 and v18.8.6 windows were prepared on
  `sync/omp-release/v18.8.6` as true two-parent merges (`77c3e5b2bf1`,
  `082bb1ac490`) but that branch was never merged into main. What landed was
  `dab5fa80ac4`, titled "Merge OMP v18.8.5 + v18.8.6 into Zeta (#76)", which
  is a **single-parent** commit (`parents=696ada8241d`). The ledger below
  claimed ancestry was verified; it was not — `git merge-base --is-ancestor
  v18.8.6 HEAD` returns false. Corrected here rather than left as a claim.
- **Upstream moved the v18.8.4 tag** after we merged it: the remote now
  advertises `40e9368ef045`, while we merged `153b37c3b65b`. Diffing against
  the tag *name* will not reproduce what we took. Compare SHAs, not tag names.
- **Next merge**: the next sync starts from this round's final commit on `main` once
  `sync/omp-release/v18.11.3` merges (branch head `24c3da1c56b`, plus the changelog fold, the compat
  regen, the surface re-application and the ledger commits), and its target is **the next upstream
  release tag when it appears** (whatever comes after `v18.11.3`; no standing target). It carries the
  v18.11.3 tag commit (`git merge-base --is-ancestor 96894a6147d HEAD` is true), which is exactly what
  `git merge-base` against the next tag computes; the increment applied is upstream's tag-to-tag diff,
  never a whole-tree comparison against our branch. Per `local://upstream-ladder-measured.md`, stepping
  one integrated tag at a time keeps the window small, and one step per release is the whole ladder.
  The forward-looking notes from previous rounds proved accurate again: `merge=union` on
  `packages/*/CHANGELOG.md` re-added upstream's whole section history (`## [18.11.3]` plus every older
  upstream section the fold/archive had removed), the scope sweep was needed again for files the merge
  brought in untouched, `modify/delete` rows did **not** appear (all 27 conflicts were `UU`), and the
  upstream test contract moved again (this time the `model` spawn argument is owned by seance
  validation).



## v18.12.1 incremental merge (Zeta — branch `sync/omp-release/v18.12.0`; merge commit `c232ef358b7`)

- **Baseline**: v18.11.3 (peeled `96894a6147d`) — `git merge-base` before the merge
  resolved to exactly this commit, so the diff was upstream v18.11.3 → v18.12.1 only.
- **Source tag**: v18.12.1, remote peeled `291e055836c` (verified with `git ls-remote`
  before the merge). Merge parents: `d927fb9d70a` (Zeta `main`) + `291e055836c`.
- **Zeta starting commit**: `d927fb9d70a`.
- **Conflicts**: 120, resolved by class — 63 functional (upstream semantics, Zeta-only
  surface replayed), 48 test files taken wholesale from upstream, 4 documentation files
  from upstream, 3 lockfiles (`Cargo.lock`, `bun.lock`, `MODULE.bazel.lock`) from upstream
  then refreshed.
- **Post-merge structural fixes**: catalog/version line realigned to `1.2.1`
  (`bun scripts/set-version.ts 1.2.1` + `cargo metadata` + `bun install`); the Cargo lock
  had pulled `pi-edit`/`pi-natives`/`pi-voice`/`pi-predict`/`pi-iso`/`pi-shell` to `18.12.1`.
- **Checks**: `check-version-consistency` (1.2.1), brand-check, zeta-sentinels,
  scope-imports, license-map, lsp-servers, shared-infra, local-ci-parity, `check:ts` — all
  exit 0. `check-merge-lineage` reports an intact lineage.
- **Landing**: squashed into `main` as the sync branch merge `3bdf45d6143`, pushed with the
  rest of the local batch as `ab8a88bef97`.

## v18.11.3 incremental merge (Zeta — branch `sync/omp-release/v18.11.3`; merge commit `24c3da1c56b`)

**One rung, no ladder — the previous release is the merge-base, so the round applies upstream's own
`v18.11.2`→`v18.11.3` increment and never our diff.**

- **Source tag**: `v18.11.3` → `96894a6147d8cc64b7e00ad3a7d7178fd93b9531`. Verified with
  `git ls-remote --tags omp-upstream refs/tags/v18.11.3` **before the merge and again immediately
  before the merge commit was written** — same peeled SHA both times, so the release tag was not moved
  during the round. The tag object is already present locally (`git rev-parse v18.11.3` matches).
- **Baseline**: `v18.11.2` (`470b7efb67673960d37e3e64584669e6e9caad1c`). **Zeta starting commit**:
  `5769cf3c771` (`main`). All work happened in the `temp/omp18113` worktree; the root checkout stayed on
  `main`.
- **Lineage gate** (pre-merge, mandatory): `bun scripts/check-merge-lineage.ts --tag v18.11.3` → all
  six checks PASS; `git merge-base HEAD v18.11.3` → `470b7efb67673960d37e3e64584669e6e9caad1c` (exactly
  the baseline), window **101 commits / 184 files / +7580 −832**. Post-merge,
  `git merge-base --is-ancestor v18.11.3 HEAD` exits 0, so the complete tag sits in history behind a
  true two-parent merge commit (`24c3da1c56b`, parents `5769cf3c771` + `96894a6147d`).
- **Conflict count**: 27, all `UU` (no `modify/delete`, no add/add). Every file is listed below with its
  resolution. Two thirds were pure scope/import unions; the non-mechanical ones are the four generated
  files (kept Zeta-side because upstream's only change was the release version line), the CHANGELOG
  (folded separately, see below), and the three TUI surfaces where upstream's redesign met Zeta's role
  namespace.

### Conflict decisions

| File | Decision | Reason |
|---|---|---|
| `Cargo.toml` | Zeta `version = "1.2.1"` | Zeta version line; upstream's `18.11.3` is its release line, not ours |
| `Cargo.lock` | kept main's lock | upstream's window delta was **only** workspace `version` lines; no dependency moved |
| `MODULE.bazel.lock` | kept main's lock | crate_universe hashes the same Cargo inputs we kept; Zeta's recorded-input set (per-crate `Cargo.toml` lines) is local to this repo |
| `bun.lock` | kept main's lock | upstream's delta was workspace name/version lines only; taking it would have re-resolved and **downgraded** Zeta patch pins (`@babel/*`, `sharp`, `@huggingface/*`). `bun install --frozen-lockfile` passes on main's lock |
| `docs/tools/read.md` | upstream text, `zeta://` + `ZETA-owned` | upstream reworded the `agent://` semantics; the scheme and the producer name are Zeta surfaces |
| `docs/tools/task.md` | upstream isolation text, `zeta/task/<id>` | upstream clarified `isolated: true`; the branch-mode prefix is Zeta's |
| `packages/ai/test/auth-gateway-pi-native.test.ts` | union + mapped scope | upstream added `buildModel`; rest is scope noise |
| `packages/catalog/src/compat/rules.json` | **regenerated, not hand-resolved** | binary in `.gitattributes`; `bun run gen:compat` from the merged KDL produced 1042 rules and differs from upstream's compile in exactly two Zeta-owned values (`auth originator=zeta`, `baseten defaultModel=moonshotai/Kimi-K3`) |
| `packages/coding-agent/src/cursor.ts` | upstream `shellDeadlineSeconds` + mapped scope | upstream renamed the helper; both call sites already use the new name |
| `packages/coding-agent/src/modes/controllers/selector-controller.ts` | 3 unions: theme imports keep Zeta's `setColorBlindMode`/`setSymbolPreset`/`setMarkdownMermaidRendering`; types gain upstream `SelectOnlyModelSelectorOptions`/`SessionPickHandler`; `sanitizeErrorLine` import; the `onDelete` block adopts upstream's `!onSelect` conditional but keeps Zeta's `moveSessionWithArtifactsToTrash` | upstream's consult-mode session picker is new surface; Zeta's trash semantics are deliberate (deletion is recoverable) |
| `packages/coding-agent/src/modes/types.ts` | union | upstream `SessionInfo` type + Zeta's `SpaceHoldHandler`/`ConfiguredThinkingLevel` |
| `packages/coding-agent/src/session/prewalk.ts` | upstream `AutoPrewalkDecision` import + mapped scope | upstream's auto-prewalk routing is new |
| `packages/coding-agent/src/session/session-tools.ts` | upstream `planXdevPromptDocs` import | upstream added prompt docs; rest is scope noise |
| `packages/coding-agent/src/task/index.ts` | upstream single-line type import (scope mapped) | formatting-only change upstream |
| `packages/coding-agent/src/task/types.ts` | upstream `FluentType` import | new omptype export |
| `packages/coding-agent/src/tools/fetch.ts` | upstream `Element` import | new DOM typing for feeds |
| `packages/coding-agent/src/utils/tools-manager.ts` | upstream `$env` import | new env probe |
| `packages/coding-agent/test/internal-urls/history-protocol.test.ts` | union (`getInternalUrlSuggestions`, `SessionManager`, `TempDir`) | new upstream test legs |
| `packages/coding-agent/test/memories-runtime.test.ts` | union (`buildModel`) | upstream switched the fixture to `buildModel` |
| `packages/coding-agent/test/selector-controller-settings-single.test.ts` | upstream imports + mapped scope | new consult/no-resume legs |
| `packages/coding-agent/test/task/prompt-cache.test.ts` | upstream (comment dropped) | both sides deleted the redundant `model:` argument; upstream's copy is the contract, Zeta's explanatory comment no longer describes a divergence |
| `packages/coding-agent/test/task/structured-subagent.test.ts` | union (`getBundledAgent`, `AuthStorage`) | upstream's structured-policy legs |
| `packages/coding-agent/test/task/task-schema.test.ts` | upstream (`loadBundledAgents`, `parseAgent`, seance schema fields, `AgentDefinition`) | seance wire-schema contract |
| `packages/coding-agent/test/tools-manager-download.test.ts` | upstream (`getLatestVersion`) | new version-resolution leg |
| `packages/tui/src/overlays/approval-dialog.ts` | upstream choice list (`once`/`session`/`deny`) + `#nativeDrafting`; Zeta role namespace kept (`zeta.overlay.approval`, `zeta.approval.choice{,s}`, `zeta.editor.ask.approval`) | **breaking**: `ui.approve()` now answers an enum, and the dialog is a select list |
| `packages/tui/src/overlays/model-picker.ts` | upstream mode-derived head (`selection`/`task`/`session`); `zeta.overlay.model-picker` | consult-mode picker |
| `packages/tui/src/status-line/segments.ts` | upstream profile-tagged brand (`brandMark(getActiveProfile())`); role stays `zeta` | profile tagging is new; the segment id namespace is Zeta's |

### Post-merge adaptations (separate commits)

- `f471e70c607` — **CHANGELOG fold**: `packages/*/CHANGELOG.md` is `merge=union`, so the merge
  re-added upstream's entire section history. Each file was rebuilt from the Zeta baseline and only the
  `v18.11.3` bullets were appended to the matching `[Unreleased]` category — **38 bullets across 7
  packages** (1/4/4/22/0/1/4/2 for agent/ai/catalog/coding-agent/mnemopi/natives/tui/utils; mnemopi had
  no section). Released sections stay byte-identical to main. The same commit holds `bun.lock` at main's
  resolutions.
- `4ed1f89ede8` — **Zeta surface re-application**: `brand-overlay` rewrote the new upstream `.omp`
  session fixtures (3 files / 11 tokens); by hand: the new approval roles → `zeta.approval.*` in the
  dialog and `dialogs-native.test.ts`, and `PI_CODING_AGENT_DIR` → `ZETA_CODING_AGENT_DIR` in the new
  seance test. Also drops the stale per-spawn `TaskParams.model` field the new contract removed.
- `714d23827af` — **model-argument contract**: upstream now validates a spawn's `model` inside
  `validateSeanceParams` ("`model` is only accepted for the `seance` agent."), and its new schema test
  asserts that message. Zeta's `rejectSpawnModel` pre-empted it with a different wording; removed so one
  validator owns the rule (`packages/coding-agent/src/task/index.ts`).
- `feb03892640` — **compat regen** (`bun run gen:compat`; 1042 rules, 21 classes, 88 catalog providers,
  97 auth providers, 236 files).
- Sentinel registry — moved the "dispatch must reject a `model`" row from
  `packages/coding-agent/src/task/index.ts` (Zeta's `rejectSpawnModel`, removed above) to
  `packages/coding-agent/src/task/seance.ts`'s "`model`/`sourceSession` is only accepted for the `seance`
  agent" validator. The protected intent is unchanged — a non-seance spawn still cannot choose a model —
  and the row is updated rather than dropped. `check-zeta-sentinels` remains at 114 sentinels.

### `main/` live test red (dispatch 3)

`Test main workspace (zeta workbench)` reached its test step and failed on
`live::tests::a_spawned_terminal_has_a_pid_renders_its_output_and_reports_exit`:
the POSIX branch built `sh -c 'printf %s <text>; sleep 0.05'`, but
`Terminal::new_with_command` splits the command on whitespace and spawns it
without a shell, so the quoted script arrived as several arguments and dash
reported an unterminated quote. Both branches now name a program directly
(`printf <text>`); also pre-existing on the starting commit.

### `main/` clippy red (dispatch 2)

The only red job of dispatch `39032073476` was `Test main workspace (zeta workbench)`: clippy
`empty-line-after-doc-comments` at `main/crates/zetawork-gui/src/lib.rs`. It is a pre-existing
defect on the starting commit (`5769cf3c771`), not a merge change: the `poll_live` doc comment
was left above `forward_terminal_input` when input forwarding was inserted between them. The
follow-up commit moves the comment back onto `poll_live`; `cargo clippy -p zetawork-gui
--all-targets -- -D warnings` is 0 locally. Nothing else under `main/` changed.

### Checks (local, exit codes)

- `bun scripts/check-merge-lineage.ts --tag v18.11.3` → 0 (six PASS before merge).
- `bun scripts/check-version-consistency.ts` → 0 (`1.2.1` across 14 packages + 13 catalog keys + Cargo
  + workspace + natives stamp + desktop + npm leaves + README badge + BUILD.bazel + Cargo.lock members).
  It was **1** before the changelog fold (seven `## [18.` sections were the only drift).
- `bun run check:ts` → 0 (oxlint 0 errors, `oxfmt --check` clean over 6,439 files, every workspace
  package's `check:types` 0). First pass caught two real things: an `oxfmt` diff in the two edited test
  imports, and a **duplicate `model` field** in `packages/tui/src/tools/task.ts` where main's per-spawn
  selector met upstream's consult-session selector; the per-spawn one is gone per the new contract.
- `bun scripts/check-scope-imports.ts` → 0 (19,598 specifiers, 5 allow patterns).
- `bun scripts/brand/brand-check.ts` → 0 (`7 hits -> 0`, 0 missing assertions; overlay pre-pass
  rewrote 3 files / 11 tokens).
- `bun scripts/check-zeta-sentinels.ts` → 0 (114 sentinels, AGENTS.md → merge-review link).
- `bun scripts/check-ci-surface.ts` → 0 (31 ci.yml jobs + 3 publish workflows, 36 required, 6 needs
  edges, floor 27).
- `bun scripts/audit-merge-members.ts --base 5769cf3c771 --tag v18.11.3` → 0, **0 members dropped
  across 0 files**, 1 member explained as upstream's own removal (`assertPlanControlsAllowed` in
  `structured-subagent.ts`), 58,819 members compared in 2,754 → 2,848 files.
- `cargo fmt --all -- --check` → 0 (crates/ touched: pi-edit, pi-natives).
- Conflict-marker sweep `git grep -lE "^(<<<<<<<|>>>>>>>) "` → 0 hits.
- **Manifest identity**: every `package.json` (root, `packages/*`, `plugins/*`, `python/robomp/web`) is
  byte-identical to `5769cf3c771`; so are `Cargo.toml`, `Cargo.lock`, `MODULE.bazel.lock` and
  `nix/bun.nix`.
  `check-package-json-merge.ts` was **not** run to completion (its scan of `5769cf3c771..HEAD` walks the
  whole 101-commit window and timed out at 300 s); the byte-identity above is the stronger statement.
- **Tests** (affected buckets, local Windows): ai 106/106, catalog 65/65, tui 46/46, utils 67/67,
  coding-agent approval 55/55; `test/task/` + fetch/tools-manager 644 pass / 1 skip / 7 fail;
  agent-session batch 305 pass / 1 skip / 1 fail; modes/session/internal-urls/memories batch 258 pass /
  1 fail. **All 9 failures are host environment, not merge damage**: `EPERM` on `fs.symlinkSync` (3
  tests: `worktree.test.ts` ×1, `cursor-exec.test.ts` ×1, `file-operations.test.ts` ×1 — this Windows
  account cannot create symlinks), libgit2 `git diff: Can only diff blobs and links, not Commit`
  (`worktree.test.ts` ×2, file untouched by the window), and the three new
  `test/tools/fetch-binary-dispatch.test.ts` refetch legs exceeding Bun's default 5 s per-test budget
  (the file passes **10/10 with `--timeout 30000`**, 30.9 s). The files involved are byte-identical to
  `v18.11.3` modulo the scope mapping, and the native addon used locally is main's prebuilt
  `win32-x64` binary (the window's `crates/pi-natives` changes are internal — `index.d.ts` is
  unchanged), so CI's source-matched bazel build is the authority.
- **Dispatch — first run `39028789166`** (`headSha 711a5613643`): **14 jobs green / 4 red / 13
  tag-gated skips**. Green includes every native job (`Build native addons (bazel)` + cross targets,
  `Check MODULE.bazel.lock freshness`, `Test TS native/integration packages`), `Validate Rust workspace
  (bazel)`, `Test TS workspace fast`, `Test CLI smoke (TS)`, three coding-agent buckets, termide, web
  contracts, install smoke, `Web UI build`, release metadata. Red:
  1. `Lint, type check & web build` — **real merge residue**, fixed below: the new `/seance` slash
     command shipped three static English descriptions and a `prewalk.auto`/`prewalk.autoTarget`
     setting group had no zh overlay (`check-i18n-commands` 3 failures; `settings-zh.test` 10/2263
     missing).
  2. `Test coding-agent UI/TUI (TS)` — same two causes plus two Zeta tests
     (`test/task/task-model-param.test.ts`) still asserting the removed `cannot set \`model\`` wording.
  3. `Test coding-agent native/unit (TS) 1/1` — the settings-zh + command-description parity tests.
  4. `Test main workspace (zeta workbench)` — **pre-existing main defect, not merge damage**:
     `cargo clippy --workspace --all-targets -- -D warnings` fails in
     `main/crates/zetawork-gui/src/lib.rs` with `clippy::empty-line-after-doc-comments` (a doc comment
     at line 656 followed by a blank line before `forward_terminal_input`). `git diff 5769cf3c771 HEAD
     -- main/` is empty and the file's last change is the starting commit `5769cf3c771`
     (`feat(gui): type into the focused terminal pane`), so `main` itself is red there. `main/` is a
     Zeta-owned tree this sync is not allowed to modify, so it is recorded here and left to the
     maintainer; it is unrelated to the merge (`main/` never participates in the tag delta).
- **Fixes after run `39028789166`**: `/seance` now reads `M.cmdSeance`/`cmdSeance*` thunks
  (`messages.ts`, `en.ts`, `zh.ts`); the zh overlay gained `prewalk.auto` (label, description, three
  option pairs) and `prewalk.autoTarget`; the two Zeta tests assert the new seance-validator wording.
  Local re-checks: `check-i18n-commands` 0 (323 descriptions), `settings-zh.test`,
  `command-descriptions.test`, `messages.test`, `i18n-slash-commands.test`,
  `i18n-message-references.test`, `i18n-settings-localization.test` and `task-model-param.test` all
  pass (35 + 2 tests).
- **Dispatch — second run `39032073476`** (head `b37ec9a7c98`; push `711a5613643..b37ec9a7c98`):
  **17 jobs green / 1 red / 13 tag-gated skips**. Every merge-touched bucket is green — `Lint, type
  check & web build`, `Test coding-agent UI/TUI (TS)`, `Test coding-agent native/unit (TS) 1/1`,
  `Test coding-agent runtime/session (TS)`, `Test coding-agent singleton/global-state (TS)`,
  `Test TS workspace fast`, `Test TS native/integration packages`, `Test CLI smoke (TS)`,
  `Validate Rust workspace (bazel)`, both native builds, `Check MODULE.bazel.lock freshness`,
  `Test main workspace`'s sibling jobs, termide, web/desktop contracts, install smoke and
  `Web UI build`. The single red is the **same pre-existing `main/` clippy error** from run 1
  (`main/crates/zetawork-gui/src/lib.rs:656:2`, `clippy::empty-line-after-doc-comments`), which the
  merge cannot have caused (`git diff 5769cf3c771 HEAD -- main/` is empty and the file's last change is
  the starting commit). `main/` is Zeta-owned and explicitly out of this sync's write scope; a one-line
  fix (drop the blank line between the two doc comments) is all it needs, and it belongs to the
  maintainer's `main` cleanup, not to this branch.
- **Follow-up commits**: the doc-comment fix below, `b37ec9a7c98` (i18n localization + model-argument test wording) and the ledger
  commit appended after it.

### Risks / open items

- **The one red in the authoritative run is pre-existing and outside this branch's write scope**:
  `Test main workspace (zeta workbench)` → `cargo clippy --workspace --all-targets -- -D warnings` →
  `main/crates/zetawork-gui/src/lib.rs:656:2` `clippy::empty-line-after-doc-comments` (a doc comment
  ending at line 656, a blank line at 657, then the `forward_terminal_input` doc). `main/` is untouched
  by the merge and is a Zeta-owned tree this sync must not edit; it needs a one-line fix on `main`.
  Every other job in run `39032073476` is green.
- The three `fetch-binary-dispatch` legs that exceed Bun's default 5 s budget on this Windows host did
  **not** red CI: both coding-agent buckets that contain them are green in run `39032073476`, so the
  Linux runner's timing is fine and no test change is needed.
- `packages/coding-agent/src/tools/approval.ts`'s enum answers are wired end-to-end (dialog, extension
  UI context, `requestApproval` call sites, collab-aware approval), and no boolean-returning
  `ui.approve` assertion remains in the tree. The wire/ACP path still uses its own approval model and
  was not part of this window.

## v18.11.2 incremental merge (Zeta — branch `sync/omp-release/v18.11.2`; merge commit `bd6938cbac3`)

**One rung, no ladder — the previous release is the merge-base, so the round applies upstream's own
`v18.11.1`→`v18.11.2` increment and never our diff.**

- **Source tag**: `v18.11.2` → `470b7efb67673960d37e3e64584669e6e9caad1c`. It is a *lightweight* tag
  (`git ls-remote --tags omp-upstream refs/tags/v18.11.2` prints one line and no
  `refs/tags/v18.11.2^{}` peel). **The tag was re-cut upstream on 2026-10-16**: the object this repo
  first recorded was `714a63689bb4551e59dd27efba2e894d31aec86e`, and
  `git ls-remote --tags omp-upstream refs/tags/v18.11.2` now advertises `470b7efb67673960d37e3e64584669e6e9caad1c`
  (the `chore: bump version to 18.11.2` commit, one commit later, 2026-10-16 16:43 +0200). The remote SHA
  was re-read immediately before the merge and was still `470b7efb6`, so the merged object is the current
  one; `git fetch omp-upstream --no-filter tag v18.11.2` then `git rev-parse v18.11.2` read back the same
  SHA. **Zeta starting commit**: `d98033c269432349ae11ca95b389b760b5405390` (`main`). All work happened in
  the `temp/sync-v18.11.2` worktree.
- **Baseline**: v18.11.1 (`7cc912940b107eb2d771b0d106c640a8eddc9edf`).
- **Lineage gate** (pre-merge, mandatory): `git merge-base HEAD v18.11.2` →
  `7cc912940b107eb2d771b0d106c640a8eddc9edf`, exactly the previous integrated tag, and
  `bun scripts/check-merge-lineage.ts --tag v18.11.2` printed all six checks PASS ending
  "lineage intact — safe to merge". **After** the merge: `git merge-base HEAD v18.11.2` →
  `470b7efb67673960d37e3e64584669e6e9caad1c`, `git merge-base --is-ancestor v18.11.2 HEAD` exits 0, and
  `git rev-list --parents -n 1 bd6938cbac3` = `bd6938cbac3 d98033c2694 470b7efb6` (main + the tag).
- **Window**: 497 commits / 391 files / +19189 −2458 (`git diff --shortstat v18.11.1 v18.11.2`).
  Theme: the auth-gateway **client tokens** (`serve --clients=<file>`, scoped per-client bearers) and its
  `auth-gateway stdio` JSON-lines mode, `lsp.requestTimeout` plus the broker's warm-LSP-mux rework,
  `parseCodeStatus` in `pi-natives` (and the `summarizeCode` -> `parseCodeStatus` switch in automatic edit
  repair), the native-memory work (`holdDisplayUntilReleased`/`releaseDisplayAwake`, freed heap pages,
  capped parse caches), Mnemopi weight/tier recall fixups, Codex web-search model-candidate selection,
  browser `uploadFile`/`tab.fill` hardening across the relay and tern tabs, and the TUI's queued-message
  badge, nested eval-status preview and table-chart fixes.
- **Conflicts**: **79**, all `UU` (no `modify/delete` rows); the dry run
  (`git merge-tree --write-tree --name-only HEAD v18.11.2 | grep -cE '^CONFLICT'`) predicted 79 exactly.
  **107 conflict blocks inside those 79 files**, resolved as:
  - **[U] 20 blocks / 18 files — upstream wins, then the Zeta surface is re-applied** (docs, `lsp/settings.ts`,
    the auth-gateway CLI copy, `tools/browser/tab-worker.ts`, `tools/gh-pr-checkout.ts`, and the test files
    whose only Zeta delta was the scope).
  - **[Z] 27 blocks / 4 files — Zeta wins** (`Cargo.toml`, `Cargo.lock`, `bun.lock`, `MODULE.bazel.lock`:
    upstream's *only* change to all four in this window is the `18.11.1` -> `18.11.2` version line —
    verified with `git diff v18.11.1 v18.11.2 -- Cargo.toml Cargo.lock bun.lock` and no
    `crates/*/Cargo.toml` delta — so the Zeta line wins and the merged locks are byte-identical to
    `d98033c2694`, which keeps the hashes `MODULE.bazel.lock` records valid for the merged tree).
  - **[H] 7 blocks / 4 files — hand-merged unions** (both sides' change survives):
    `src/launch/broker.ts` (Zeta's `#stopUnownedOneShotDaemons` sweep + upstream's `#watchEndpoint`
    socket-loss shutdown — upstream's method is called from the constructor path, so dropping either
    half leaves dead or undefined code), `src/session/agent-session.ts` (upstream's `type PowerAssertion`
    + `TranscriptSessionContextOptions`, plus Zeta's time-injection imports *and* upstream's
    computer-turn imports in one block), `src/task/structured-subagent.ts` (`sanitizeAgentId` from
    upstream + Zeta's model-switch failure ledger), and `src/web/search/providers/codex.ts` (upstream's
    auth-selection rework — `resolver(params.model, params.sessionId)`, the env-credential fallback
    branch and provider-generic messages — with Zeta's model-candidate retry loop kept: upstream's
    `runSearch` helper now routes through `runCodexSearchCandidates`, because the merged
    `callCodexSearch` takes Zeta's `model: CodexModelCandidate`, not upstream's `modelId`).
  - **[S] 37 blocks / 36 files + [C] 16 blocks / 16 files — resolved automatically** by the
    scope-normalized classifier: 37 blocks in files whose entire Zeta delta was the mechanical
    scope/brand rewrite (`FILE_SCOPE_ONLY` -> upstream's
    block, re-mapped), 14 where ours' scope-normalized block was a subset of upstream's, and 2 where
    ours was empty. The `packages/*/CHANGELOG.md` files are the one class the classifier is not allowed
    to touch (see the CHANGELOGs bullet).
  - **[G] 1 file / 0 blocks — regenerated, not hand-edited**: `packages/catalog/src/compat/rules.json` is
    `binary` in `.gitattributes`, so it arrives without markers; it was regenerated from the merged KDL
    tree with `bun run gen:compat` (`1041 rules, 21 classes, 88 catalog providers, 97 auth providers,
    236 files`). Diffed against upstream's own compile it differs in exactly two values, both
    intentional: `providers/baseten/defaultModel` is Zeta's `moonshotai/Kimi-K3` (a Zeta-only data change
    upstream never took) and `auth/providers[0]/login/authorizeParams/originator` is `zeta` where
    upstream says `omp`.
  The six classes reconcile with the decision table (`temp/analysis-v18112/decision-table.txt`):
  18+4+4+1+36+16 = 79 files and 20+27+7+0+37+16 = 107 blocks; `[G]` has no markers (see its bullet)
  but git still listed the path as `UU`.
- **Tag-to-tag delta completeness (forward)**: every line upstream *added* between `v18.11.1` and
  `v18.11.2` is in the merged tree — 386 files, **17,945 added lines** (blank lines excluded),
  17,593 exact + 252 present after the documented Zeta rewrites, **97 explained exceptions**:
  61 Zeta version-line wins (12 `Cargo.lock` members, `Cargo.toml`, 24 `bun.lock` lines, 12 root
  `package.json` catalog keys, 12 package-manifest `version` lines), 5 `MODULE.bazel.lock` lines
  (crate_universe recorded inputs + rendered entries — Zeta's copy is authoritative because the only
  manifest delta upstream made was the version line), 11 CHANGELOG lines (8 `## [18.11.2] - 2026-10-16`
  headers removed by the fold + 3 archive footers the union merge re-introduced), and 20 lines rewritten
  to the Zeta contract (`ZETA_CODING_AGENT_DIR`, `.zeta` fixtures, `__zeta_call_tool__`, the `zeta.*`
  eval-status roles, the `zeta_session_files` table prefix, and the `codex.ts` `runSearch` body that now
  goes through the candidate loop). The renamed-path leg was verified separately —
  `docs/{adding-a-provider,tui-core-renderer}.md` -> `document/…` (1/1, 6/6 lines) and
  `sdk/{go,python,rust}/omp-rpc` -> `sdk/*/zeta-rpc` (5/5, 3/3, 5/5) — **0 added lines missing**.
- **Member-loss audit (backward)**: `bun scripts/audit-merge-members.ts --base d98033c2694 --tag v18.11.2`
  → `0 member(s) dropped across 0 file(s)` with `23 member(s) across 15 file(s) explained as upstream's
  own removal in this window (v18.11.2)` (58,594 members compared in 2,746 files of the baseline against
  2,843 files of the merged worktree). Each of the 23 is present in `v18.11.1` and absent from `v18.11.2`
  (upstream's own refactors: `normalizeToolCallId`, `PROJECT_DIAGNOSTICS_WAIT_TIMEOUT_MS`,
  `uploadFilesToElement`, `ChartSvg`/`chartAlt`, `TableChart`/`describeTableChart`,
  `#subagentSessionMetrics`, `#shouldQueryTspSupport`, ...). **No Zeta-only member is gone.**
- **Brand/i18n/scope surface** (follow-up commit `ebd5b18160a`): the merge brought 37 files in
  untouched whose upstream `@oh-my-pi/*` specifiers needed mapping — **169 specifiers**, mapped through
  the driver's `RENAME_BY_TAIL` table (`pi-coding-agent` -> `zeta`, `omptype` -> `pi-omptype`,
  `omp-stats` -> `pi-stats`, `snapcompact` -> `pi-snapcompact`). Plus the env/config contract
  (`PI_CODING_AGENT_DIR` -> `ZETA_CODING_AGENT_DIR` in three new upstream tests, the project hook
  fixture under `.zeta` — `CONFIG_DIR_NAME` — not `.omp`), the injection symbol
  (`__omp_call_tool__` -> `__zeta_call_tool__` in the browser-relay fixture, matching the eval prelude),
  the TUI role namespaces (`zeta.run.status`, `zeta.tool.eval.status{,.event,.preview}`), and the SQL
  table name in the new SQLite test (`omp_session_files` -> `zeta_session_files`; without it the
  held-replace race never triggered and the test hung out its 5 s timeout), plus the duplicate-import and
  `TranscriptSessionContextOptions` repairs the first-pass resolutions left behind (caught by
  `bun run check:ts`, not by a conflict marker). `bun scripts/brand/brand-check.ts`:
  **182 hits -> 0 hit(s), 0 missing assertion(s)**.
- **CHANGELOGs**: `packages/*/CHANGELOG.md` is `merge=union`, so the tag merge re-addressed upstream's
  entire section history into the tree (the `## [18.11.2]` section plus every older upstream section the
  fold/archive had removed from `packages/ai`, `packages/tui` and `packages/coding-agent`). Each file was
  rebuilt from the Zeta baseline `d98033c2694` with only the `v18.11.2` section's bullets appended to the
  matching `[Unreleased]` category — **103 bullets across 8 packages**, 2/11/4/56/1/8/18/3 for
  agent/ai/catalog/coding-agent/mnemopi/natives/tui/utils — so every released (and archived) section stays
  byte-identical to main (`git diff --numstat d98033c2694` on those files is pure insertions, 0 deletions).
- **Guards** (all local, `exit 0` unless noted): `check-version-consistency` 0 (after the changelog fold;
  before it the eight `## [18.` sections were the only drift), `bun run check:ts` 0 (oxlint clean +
  `oxfmt --check` over 6,422 files), `check-scope-imports` 0 (19,475 specifiers, 5 allow patterns),
  `bazel-lock-drift` 0 ("MODULE.bazel.lock covers every workspace dependency"), `brand-check` 0,
  `check-zeta-sentinels` 0 (114 sentinels + AGENTS.md link), `check-ci-surface` 0 (32 jobs in ci.yml,
  37 required, 6 needs edges), both i18n guards 0 (`3018/3018/3018` keys; 320 command descriptions),
  `check-shared-infra` 0 (15 endpoints / 4,324 files), `check-release-asset-names` 0,
  `check-serve-discovery-parity` 0, `check-nix-bun-freshness` 0 (`nix/bun.nix` byte-identical),
  `check-robomp-cli-contract` 0, `generated-freshness` 0, `cargo fmt --all --check` 0.
  `check-package-json-merge` was not run to completion locally — its scan walks *every* merge commit in
  `<base>..HEAD`, which on this branch is the whole 497-commit upstream window, and it does not finish in
  reasonable time here. The equivalent, stronger check was done directly instead: **all 39 manifests
  (`package.json`, `packages/*`, `plugins/*`, `python/robomp/web`) are byte-identical to `d98033c2694`**
  (`git diff --name-status` over that path set prints nothing), and the Zeta-owned leaves are intact
  (`packageManager bun@1.4.3`, `workspaces.packages [packages/*, plugins/*, python/robomp/web]`,
  13 `@linxiraos/*` catalog pins, the Zeta-only `check:*`/`gen:*` scripts), so the merge driver dropped and
  reverted nothing. Upstream's entire manifest delta in this window was version bumps plus
  `@oh-my-pi/*` catalog keys, all rejected by the driver by design.
  Not a merge signal: `check-spoofed-versions` cannot run offline here (it fetches the newest Gemini CLI
  build) and reports the same `Claude Code 2.1.280 -> 2.1.301` drift on `main`.
- **Tests (local, affected buckets only)**: catalog **1306 pass / 0 fail**; mnemopi **477 / 0**;
  coding-agent's conflicted/swept set **328 / 0** (12 agent-session files) and **43 / 0** (status-line,
  footer, tools-manager, input-controller, issue-12247, sdk-computer-user-wait, power-assertion,
  auth-gateway-clients-reload, read-limited-text, extension-loader) and **31 / 0** for the two SQLite
  session files after the table-name fix; utils **839 pass / 36 skip / 5 fail** package-wide
  (880 tests / 92 files) against `main`'s **828 / 36 / 5** (869 tests / 90 files) — the same five either
  side (upstream's `browsers.test.ts` symlink entry on Windows `EPERM`, plus the four offline
  `ensureRuntimeInstalled` install-lock cases); ai **5950 pass / 8 fail**;
  tui **3851 pass / 16 fail**; browser upload/relay **36 pass / 1 fail**. Every non-zero line was re-run
  against `main` and is **identical there** (ai's eight are 5–10 s AuthStorage/Codex-OAuth timeouts,
  tui's sixteen are the PTY/ConPTY `ProcessTerminal` and clock-reading tests, plus two `workspace-tree`
  cases that fail on `main` because the *local* native binary predates `listWorkspace`'s
  `unreadableDirectories` field — main's own binary returns only `entries/agentsMdFiles/truncated`), and
  the branch adds 50 new passing tests in tui, 50 in ai and 11 in utils (the window's two new utils files
  plus the tui/ai cases). One transient was chased down and cleared: a package-wide utils run that
  reddened `postmortem-epipe`, `postmortem-guard-exit` and `logger-contract` (5–7.8 s process-timing
  tests, untouched by the branch) while the typecheck ran alongside it — all three pass in isolation on
  both trees, and the quiet package-wide re-run above has none of them, so that trio was load, not
  damage. The browser upload symlink case fails with Windows `EPERM: symlink`
  (unprivileged symlinks) and is expected to pass on the Linux runner. **Rust/native tests are not run
  locally** (no bazel, and the local `.node` is the baseline artifact) — the dispatched `ci.yml` run's
  native-addon jobs are the authority for them.
- **Dispatched CI — `ci.yml` run `38949297746` (headSha `65c8326bd46`)**: the native path is **green** —
  `Build native addons (bazel)`, `Build native addons (bazel, cross targets)`,
  `Check MODULE.bazel.lock freshness`, `Test TS native/integration packages`, `Lint, type check & web
  build`, `Test CLI smoke (TS)`, `Test coding-agent runtime/session (TS)`,
  `Test coding-agent singleton/global-state (TS)`, `Test main workspace (zeta workbench)`,
  `Test web/desktop contracts`, `Test editor (vendored TTT)`, `Test termide (vendored TermIDE)`,
  `Install method smoke tests`, `Web UI build`, `Resolve release metadata`. So the native-addon build this
  machine cannot run (no bazel) is validated, and CI's own freshness job independently confirms the
  `MODULE.bazel.lock` conclusion. Four jobs were red. Two of them carried four real, merge-caused
  failures — `Test coding-agent UI/TUI (TS)` one, `Test coding-agent native/unit (TS) 1/1` three — each
  reproduced locally and fixed on the branch; the other two (`Test TS workspace fast`,
  `Validate Rust workspace (bazel)`) turned out to be flakes, see below:
  1. **zh settings (real, merge-caused)** — upstream's new `lsp.requestTimeout` had no zh label,
     description or option texts: `src/config/settings-zh.test.ts` reported 9 of 2,255 user-visible strings
     missing, and `test/i18n-settings-localization.test.ts` stopped at
     `label for lsp.requestTimeout should be zh: Request Timeout`. Added
     `ZH_SETTING_TEXTS["lsp.requestTimeout"]` plus the six `ZH_OPTION_TEXTS["lsp.requestTimeout::N"]`
     entries to `config/settings-zh.ts`.
  2. **CLI-help pin (real, merge-caused)** — upstream's new `auth-gateway --clients` help literal moved the
     pinned unlocalized inventory from 7 to 8 sites in `commands/auth-gateway.ts`; the pin was bumped,
     which is the guard's own documented one-line remedy.
  3. **orphan catalogue key (real, merge-caused)** — upstream's redesigned commit row (`N files in <sha>`)
     removed the only call site of Zeta's `gitModifiedCountFmt`, so `test/i18n-message-references.test.ts`
     listed it as a new orphan. The row was wired through the catalogue rather than the key deleted:
     `gitModifiedCountOneFmt` / `gitModifiedCountManyFmt` (the plural-pair idiom
     `gitFileChangesOnOneFmt`/`ManyFmt` already uses) plus `gitInShaFmt`. The English rendering stays
     byte-identical to upstream's (`2 files in abcdef0`, pinned by
     `packages/tui/test/git-commit-view-hints.test.ts`); a zh session now reads `2 个文件 在 abcdef0`.
  4. **`__omp_call_tool__` scar (real, merge-caused)** — upstream's new artifact-locating branch in
     `src/eval/js/shared/prelude.txt` still called `globalThis.__omp_call_tool__` while the runtime installs
     `__zeta_call_tool__` (the file is a `.txt`, so the scope sweep's `*.ts` glob skipped it); three
     `test/eval/prelude-agent.test.ts` read()-delegation cases threw
     `TypeError: globalThis.__omp_call_tool__ is not a function`. The single line was renamed, and the
     playbook's own all-text-type sweep (`git grep -nE '@linxiraos/|__omp_|PI_CODING_AGENT_DIR|PI_LOGO'
     -- .`, step 7, which names `prelude.txt` as a repeat offender) was then re-run over the whole tree:
     its only upstream-side hits are the deliberate protocol names (`__omp_judgment_images`, `mcp__omp__`
     — upstream wire keys, kept on both sides per conclusion 10) and pre-existing documentation.
  The remaining two reds are **not** merge damage: `packages/utils/test/json-lexer-string-scan.test.ts`
  ("keeps escape-dense strings linear", wall-clock ratio `3.162` against a `< 3` bound) and Rust's
  `shell::tests::cancellation_keeps_output_open_for_a_term_trap_that_writes` (1 of 927 tests in
  `//crates/pi-shell:pi-shell_test`). For both, the code under test is byte-identical to `d98033c2694`:
  `packages/utils/src/json-lexer*` and `json-parse*` are untouched by the branch (`git diff --stat` empty)
  and the branch's only `crates/pi-shell/src/shell.rs` edits are inside `mod tests` (+53/-3, Zeta's own
  added cases and two widened timeouts), so Zeta contributes nothing to either production path; the job
  runs `OMP_TEST_CONCURRENCY=4` on a 4-core runner, which is what a wall-clock ratio assertion is exposed
  to. Both jobs were re-run on the same head to separate flake from damage: **`Validate Rust workspace
  (bazel)` went green** (attempt 2, job `117136538659`), so the `pi-shell` test is a flake; the three
  i18n/eval jobs failed again on the unchanged head, which is what makes their four causes above real
  rather than noise (the rerun's own test-level log is not retrievable — `gh` serves attempt 1 for a
  partially re-run workflow, so the identity of attempt 2's failing test in `Test TS workspace fast` is
  inferred, not read).
- **Second dispatch — `ci.yml` run `38963026878` (headSha `9cb54ac2c0a`, the tree carrying the four
  fixes)**: **17 jobs green, 2 red, 15 skipped** (every skip is a release-only job gated on a tag), the
  green set covering every native job (`Build native addons (bazel)`, cross
  targets, `Check MODULE.bazel.lock freshness`, `Test TS native/integration packages`),
  `Validate Rust workspace (bazel)`, `Test TS workspace fast`, `Lint, type check & web build`,
  `Test CLI smoke (TS)`, `Test coding-agent runtime/session (TS)`,
  `Test coding-agent singleton/global-state (TS)`, `Test main workspace (zeta workbench)`,
  `Test web/desktop contracts`, both vendored trees (editor, termide), `Install method smoke tests`,
  `Web UI build` and `Resolve release metadata`. Every one of the first run's real causes is gone: the
  `packages/utils` ratio job is green (so that red *was* a flake, now confirmed by the same-head re-run),
  and the two coding-agent buckets no longer list `settings-zh`, `i18n-settings-localization`,
  `i18n-cli-help-surface`, `i18n-message-references` or the three `prelude-agent` cases. The two jobs
  still red are **load-sensitive timing flakes**, not damage: `test/web-gateway/plan-flow.test.ts`'s
  approve step raced the agent ("Agent is already processing. Use steer() or followUp() to queue messages
  …") in a file byte-identical to `d98033c2694`, and the window's own
  `test/tools/browser-relay-detach.test.ts` took the "could not reattach … released" branch instead of
  the "used up this call's 1000ms budget" one. Each passed in run `38949297746`, both pass on the fixed
  tree locally (11/11 twice), and the relay chunk took 100 s where its neighbours took ~10 s, so the
  runner was contended; the job runs `OMP_TEST_CONCURRENCY=4` on a 4-core runner. Making those two
  deterministic is upstream-test synchronization work, deliberately left out of this merge.
- **Tag-to-tag only, explicitly**: every comparison in this round is `v18.11.1` <-> `v18.11.2` (the merge
  preview, the forward completeness check, the member audit's *explained* leg) plus each file's own
  baseline-to-branch delta (`git diff v18.11.1..HEAD -- <file>`, used only to decide whether a conflict
  block carried a Zeta change). Upstream was never diffed against the Zeta branch as a whole, and no
  upstream file was copied wholesale outside the merge.
- **Verdict / hand-off**: merge commit `bd6938cbac3` (parents `d98033c2694` + `470b7efb6`), then
  `c4911224c07` (CHANGELOG fold) and `ebd5b18160a` (Zeta surface re-application), the ledger commits, and
  the SQLite table-name repair. The branch was pushed once to `origin` (`sync/omp-release/v18.11.2`) and
  dispatched once (`gh workflow run ci.yml --ref sync/omp-release/v18.11.2` -> run `38949297746`, the
  authority for the native-addon build and the natives-dependent buckets this machine cannot run). That
  run's four red jobs were then triaged and fixed (see the run bullet above), and the fixes went out as a
  **second push** of the same branch (`65c8326bd46..9cb54ac2c0a`) followed by a **second dispatch**
  (`ci.yml` on `sync/omp-release/v18.11.2` -> run `38963026878`), which is the authority for the fixed
  tree: 17 jobs green, 2 red, 15 skipped, the two reds being the load-sensitive timing flakes documented
  in the run bullet. The landing to `main` is sequenced centrally with the other in-flight branches (one
  push, one CI run for `main`), so this entry deliberately does **not** claim a `main` merge commit of its
  own.

## v18.11.1 incremental merge (Zeta — branch `sync/omp-release/v18.11.1`; merge commit `949687f3230`)

**Ladder rung 4/4 — the final rung, deliberately carrying `v18.11.0` with it.**

- **Source tag**: `v18.11.1` → `7cc912940b107eb2d771b0d106c640a8eddc9edf`
  (`git ls-remote --tags omp-upstream refs/tags/v18.11.1` advertises that line; `git fetch omp-upstream
  --no-filter tag v18.11.1` followed by `git rev-parse v18.11.1` reads the same SHA, so the release tag
  was not moved). `v18.11.0` → `c2cb79e4c227aa4b22c4ccb933ff72fd88bceba4`, also remote-verified and
  also an ancestor of HEAD. **Zeta starting commit**: `e5b1667537b` (`main`, the rung-3 merge of
  PR #230). All work happened in the `temp/sync-v18.11.1` worktree.
- **Baseline**: v18.10.4 (`687892d1046ecaf18829b45f5b86928a308258f4`).
- **Lineage gate** (pre-merge, mandatory): `git merge-base HEAD v18.11.1` →
  `687892d1046ecaf18829b45f5b86928a308258f4`, exactly the previous integrated tag. **After** the merge:
  `git merge-base HEAD v18.11.1` → `7cc912940b107eb2d771b0d106c640a8eddc9edf`, and
  `git merge-base --is-ancestor v18.11.1 HEAD` / `--is-ancestor v18.11.0 HEAD` both exit 0. The merge
  commit `949687f3230` has parents `e5b1667537b` (main) + `7cc912940b1` (the tag).
- **Why one step instead of two**: measured on the post-rung-3 tree, `v18.10.4→v18.11.0` is
  309 commits/346 files/59 predicted conflicts, `v18.10.4→v18.11.1` is 692 commits/576 files/114
  conflicts, and the two windows share only 84 files — splitting buys no re-resolution, only an extra
  CI cycle, and the merge of the later tag carries the earlier one.
- **Window**: 692 commits / 576 files / +24206 −3585 (`git diff --shortstat v18.10.4 v18.11.1`).
  Theme: the `pi-natives` desktop/session and VCS (patch/diff/mutate) work, `html-escape` in the
  markup-conversion lane, the async-job **tree** (`job-tree.ts`, `/jobs` and the jobs sheet), the codex
  provider/fallback-chain fixes, hanging-wrap rendering in the TUI, project-discovery **ceilings**
  (home + temp roots are never project anchors), agent-driven model switching on the `task` tool, and
  the approval dialog's expand/full-prompt feature replacing `wrapDetails`.
- **Conflicts**: **114**, all `UU` (no `modify/delete` rows this round); the dry run
  (`git merge-tree --write-tree --name-only HEAD v18.11.1 | grep -cE '^CONFLICT'`) predicted 114
  exactly. Resolution: a scope-normalized three-way re-merge (base/ours/theirs with
  `@oh-my-pi|@mariozechner/<tail>` mapped through `RENAME_BY_TAIL`) collapsed **83 files** to zero
  residual blocks; the remaining **31** were resolved per file — upstream wins inside the overlap, then
  the Zeta surface is re-applied (`@linxiraos/*`, `zeta.*` roles, `.zeta` paths, `zetacode` mentions,
  i18n keys, injection symbols). Judgement rows that combine instead of picking a side:
  `packages/coding-agent/src/tools/read.ts` (`planTargetedRead` + upstream's `toolContext`/`rawImages`),
  `src/eval/js/shared/prelude.txt` (upstream's image support + `__zeta_call_tool__`),
  `src/discovery/helpers.ts` (upstream's ceiling refactor + `.zeta` branding),
  `src/slash-commands/{builtin-marketplace,builtin-session}.ts` and `tui/src/tools/{ask,ast-grep}.ts`
  (keep the i18n handles, take upstream's new text/`contentWidth`), `docs/settings.md` (ours + upstream's
  two additions). Ours-only rows: `README.md` (Zeta front door; upstream's one-line SambaNova
  provider-list addition is a named forward-check exception), `bun.lock` and `MODULE.bazel.lock`
  (upstream's copies are version-line/Windows-regeneration noise).
- **Cargo trio**: upstream's only deltas are the version line plus `html-escape = "0.2.15"`
  (workspace table + `crates/pi-natives/Cargo.toml` + its `Cargo.lock` entry), so `Cargo.toml`/`Cargo.lock`
  take the Zeta value with that addition and `crates/pi-natives/Cargo.toml` merges upstream's line.
  `MODULE.bazel.lock` records the three inputs the delta moved (`Cargo.lock`, `Cargo.toml`,
  `crates/pi-natives/Cargo.toml`); `bazel fetch --repo=@crates --lockfile_mode=error` then reports
  **"MODULE.bazel.lock is up to date."** (the local `gen:bazel-lock` splice cannot run on this machine —
  rules_rust's splice step needs a symlink privilege Windows does not grant: `Failed to create symlink:
  … .bazelignore … os error 1314` — so the hashes were updated to the fresh `sha256` of those three files
  and verified by bazel's own check).
- **Tag-to-tag delta completeness (forward)**: every line upstream *added* between `v18.10.4` and
  `v18.11.1` is present in the merged tree — 573 files, **24,186 added lines**, 23,742 exact + 347 after
  the documented brand rewrites, 85 explained exceptions: 12 upstream `## [18.11.x]` CHANGELOG headers
  (removed by the fold), 13 `"version": "18.11.1"` manifest lines (Zeta `1.2.1` wins),
  `"dist/*.json-*.zst"` (present; whitespace differs), `bun-cli.ts`'s `` standalone `omp` `` → `zetacode`,
  4 i18n literals (text moved into `i18n/en.ts`), 3 `PI_CODING_AGENT_DIR` occurrences (env contract),
  `omp-changelog-pty-` → `zeta-changelog-pty-`, and the `ast-grep.ts` literal (i18n wrapper). The
  renamed-path leg was verified separately: `sdk/{go,python,rust}/omp-rpc/*` → `sdk/*/zeta-rpc/*`,
  **12 added lines, 12 exact, 0 missing**.
- **Member-loss audit (backward)**: `bun scripts/audit-merge-members.ts --base e5b1667537b --tag v18.11.1`
  → `0 member(s) dropped across 0 file(s)` with `24 member(s) across 21 file(s) explained as upstream's
  own removal in this window (v18.11.1)`. Each of the 24 is present in `v18.10.4` and absent from
  `v18.11.1` (upstream's own rename/removal: `removeDsmlToolMarkupLeak`, `openAiCompatSupportsImageDetailOriginal`,
  `dropEncrypted`, `resolveRoleSelection`, `computeNonMessageTokens`, `estimateToolSchemaTokens`,
  `resolveTmuxClientTerminalName`, the `job-tree` refactor's `span`/`cancel`/`#nativeCols`/`#extractAtPrefix`,
  `ApprovalDetailsOptions`, `truncateApprovalDetail`, …). **No Zeta-only member is gone.**
- **Gate-tooling fixes (same PR, separate commits)**: (1) `scripts/check-package-json-merge.ts` no longer
  refuses every shallow clone — it verifies per merge that HEAD, both parents and the merge-base carry
  their trees locally and fails loud (naming the shallow cause) only when they do not, so the guard runs
  in this repo's worktrees instead of being a red no-op; (2) `scripts/audit-merge-members.ts` gained
  `--tag <ref>` (default: this ledger's `## Integrated through:` tag) and splits every finding into
  *dropped* (the tag still ships it, or no upstream side ever had it) vs *explained* (absent from the tag,
  present in its parent = upstream's own removal in the window), which is what removed the 24-item
  hand-reconciliation this round; `scripts/merge-gate.ts` passes `--tag` through to it. Its regression
  test stays green (`5 pass, 0 fail`).
- **Brand/i18n surface** (follow-up commit): scope sweep of upstream's `@oh-my-pi/*` imports in the files
  the merge brought in (138 lines / 20 files), 20 TUI role literals re-namespaced to `zeta.*`
  (approval dialog, jobs panel, composer dictation, `/jobs` sheet tests), `brand-overlay`'s 11 tokens,
  upstream's new command text folded into the i18n catalogue (`cmdPluginsEnable`/`cmdPluginsDisable`,
  `cmdSessionPin`, `agrpLimitNarrowPath`) with their zh counterparts, `__omp_call_tool__` →
  `__zeta_call_tool__` in the judgment bridge fixture, and the env contract kept
  (`ZETA_CODING_AGENT_DIR` + `PI_CONFIG_DIR`, never `PI_CODING_AGENT_DIR`).
  `bun scripts/brand/brand-check.ts` → `0 hit(s), 0 missing assertion(s)`.
- **CHANGELOGs**: upstream's fresh sections (`## [18.11.1]`, `## [18.11.0]`, plus the `## [18.10.4]`
  block the merge re-added) folded into `[Unreleased]` for the 8 packages that carry upstream history —
  199 bullets, deduplicated — and every released Zeta section stays byte-identical to `e5b1667537b`
  (md5-compared per package). `bun scripts/check-version-consistency.ts` → exit 0
  (`Version line consistent at 1.2.1: 14 packages + 13 catalog keys + Cargo + main workspace + natives
  stamp + desktop + npm distribution leaf pins + README badge + crates/*/BUILD.bazel + Cargo.lock members`).
- **Guards**: brand-check 0; `check-zeta-sentinels` 0; `check-shared-infra` 0; `check-scope-imports` 0
  (19,259 specifiers); `check-ci-surface` 0; both i18n guards 0; `check-release-asset-names` 0;
  `check-serve-discovery-parity` 0. `packages/catalog/src/compat/rules.json` regenerated from the merged
  KDL tree (`bun run gen:compat`, 1038 rules).


## v18.10.4 incremental merge (Zeta — branch `sync/omp-release/v18.10.4`; merge commit `c86128383f1`)

- **Source tag**: `v18.10.4` → `687892d1046ecaf18829b45f5b86928a308258f4`, a *lightweight* tag
  (`git ls-remote --tags omp-upstream refs/tags/v18.10.4` advertises that one line and no
  `refs/tags/v18.10.4^{}` peel), fetched with `git fetch omp-upstream --no-filter tag v18.10.4` and read
  back with `git rev-parse v18.10.4` — remote and local agree, so the release tag was not moved.
  **Zeta starting commit**: `08a79203681` (`main`, the rung-2 merge of PR #229). All work happened in the
  `temp/sync-v18.10.4` worktree.
- **Baseline**: v18.10.3 (`81e1d8927a3c16cfaff2e9456baa8c060e1e0e9b`).
- **Lineage gate** (pre-merge, mandatory): `git merge-base HEAD v18.10.4` →
  `81e1d8927a3c16cfaff2e9456baa8c060e1e0e9b`, exactly the previous integrated tag, and
  `bun scripts/check-merge-lineage.ts --tag v18.10.4` → "lineage intact — safe to merge", so the merge
  computes upstream's own increment and never our diff. **After** the merge: `git merge-base HEAD v18.10.4`
  → `687892d1046ecaf18829b45f5b86928a308258f4` and `git merge-base --is-ancestor v18.10.4 HEAD` exits 0.
- **Window**: 105 commits / 191 files / +8260 −6041 — upstream's tag-to-tag diff
  (`git diff --shortstat v18.10.3 v18.10.4`). Theme: the Codex **Code Mode purge** (the two
  `providers.openai-codex.codeMode*` settings, `session/code-mode.ts`, both declaration generators,
  `code_mode_tool_names` stream metadata, the catalog `toolMode` field, `--restore`'s sibling
  `eval-code-mode.md`), dated list-price billing (Gemini 4 Argon, Devin, Muse Wonder cost cards priced at
  the request date, bounded long-context tiers), in-place compression of idle sessions (`gc --compress`;
  LZNT1 on NTFS, `ditto` on APFS, `.omp-gc-compress-*` scratch dirs), the native approval dialog
  (`ApprovalDialogComponent`) and remote plan-review answers, tmux SIXEL gating on the client's `Sxl`
  capability, and rendered markdown previews in grouped read cards.
- **Conflicts**: 41, all `UU`; the dry run
  (`git merge-tree --write-tree --name-only HEAD v18.10.4 | grep -cE '^CONFLICT'`) predicted 41 exactly
  (four of them are `modify/delete` rows).
- **Resolution rule**: upstream wins inside every overlapping hunk, then the Zeta surface is re-applied
  (`@oh-my-pi/*` → the scope map / `pi-coding-agent`→`zeta`, `omp.*` → `zeta.*` roles, `.zeta` paths,
  `zetacode` CLI mentions). Thirty-five rows were mechanical (upstream's new import in a block whose only
  Zeta difference is the scope spelling). The six judgement rows are marked in the table below.
- **Tag-to-tag delta completeness** (the compliance check that replaces ours-vs-theirs reasoning): for
  every merge-touched file, every line upstream *added* between `v18.10.3` and `v18.10.4`
  (`git diff v18.10.3 v18.10.4 -- <path>`) is present in the merged tree — 142 `.ts`/`.tsx` files and the
  non-TS set, **0 missing**. The only non-TS exceptions are upstream's `## [18.10.4]` CHANGELOG headers
  (removed by the fold, below) and the tui archive footer paired with its archive collapse (also below).
- **Lockfiles**: `Cargo.toml` / `Cargo.lock` / `bun.lock` conflict on the version line only — upstream's
  entire delta in all three is `18.10.3` → `18.10.4`, with no other changed line — and the Zeta `1.2.1`
  line wins, so all three end byte-identical to `08a79203681`. `bun install` afterwards changed nothing.
- **`MODULE.bazel.lock`**: ours. Upstream's copy in this window is a *Windows regeneration* of the
  crate_universe lock (CRLF inside the generated blobs, and the per-crate `FILE:` input list collapsed to
  `Cargo.lock`+`Cargo.toml`), not a change to carry. No `crates/*/Cargo.toml` moved and both Cargo files
  stay ours, so every recorded input hash still matches its file.
- **CHANGELOGs**: upstream's fresh `## [18.10.4]` bullets were folded into `[Unreleased]` for all nine
  packages (40 bullets, 0 duplicates against the existing `[Unreleased]`), and the upstream version
  headers are gone (the version gate rejects `^## \[1[5-8]\.`). Released Zeta sections stay
  byte-identical to `08a79203681`; that deliberately includes *not* carrying upstream's tui archive
  collapse (it removes the 9.6.2/9.6.1/9.5.0/9.4.0 sections and re-points the "Older entries are archived
  in" footer) — Zeta keeps released sections verbatim.
- **Code Mode leftovers in Zeta-owned metadata** (follow-up commit): upstream deleted the
  `providers.openai-codex.codeMode` / `.codeModeDirectTools` settings, but Zeta's own
  `config/settings-schema.ts` and `config/settings-zh.ts` still listed them (the web panel enumerates
  exactly those schema keys, so the merge would have left a knob with no implementation); both entries
  were deleted with their zh counterparts.
- **Brand/i18n follow-up commit**: the TUI roles upstream shipped in this window are emitted and asserted
  as `zeta.*` (`zeta.overlay.approval`, `zeta.approval.title`, `zeta.approval.details`,
  `zeta.editor.ask.approval`, `zeta.btw.copied`, `zeta.btn`, `zeta.tool.*`), `zetacode` replaces `omp` in
  the new `gc --compress`/shared-browser comments, `brand-rules.ts`'s TUI-role alternation grew the
  `approval` namespace (v18.10.4 shipped `omp.approval.title`/`.details` while the alternation did not
  know it — the rung-2 lesson repeated shape-for-shape), and the new `gc` help literals bumped the pinned
  `commands/gc.ts` count in `test/i18n-cli-help-surface.test.ts` 12 → 14.
- **Audit note — member loss**: `bun scripts/audit-merge-members.ts --base 08a79203681…` reports 35
  members across 17 files (exit 1). Every one is either upstream's own removal in this window (the Code
  Mode purge: `session-tools.ts` `codeMode*`, `session/settings.ts` `cfgCodeModeInputs` /
  `cfgProvidersOpenaiCodexCodeMode{,DirectTools}`, `tools/eval.ts` `#codeModeDescription`,
  `agent-session.ts` `initializeCodeMode`, plus the `code-mode.ts` /
  `tools/{browser,computer}/declarations.d.ts` / `tui/…/code-mode-declarations.ts` files; or the pricing
  and read-card refactors: `build.ts` `applyEffectiveFallbackRates`/`latestFrom`, `models.ts`
  `effectiveFrom`, `wrapper.ts` `choice`, `interactive-mode.ts` `#dismissPlanReview`,
  `session-provider-boundary.ts` `changed`), or one of the audit's known heuristic reads (a JSDoc or
  parameter mention rather than a declaration — `ps-cli.ts` `verb`, `read-tool-group.ts` `code`). Each
  name was checked against the `v18.10.4` tree: where the tag still has it the merged tree has the same
  occurrence count (`turnMetadataJson` 7/7, `build.ts` `now` 19/19, `models.ts` `rates` 16/16), and the
  five whole-file deletions it lists are absent from `v18.10.4` as well. No Zeta-only member is gone.
- **Machine-local check shapes** (not merge damage): `package.json merge-drop` refuses here
  ("shallow repository — run `git fetch --unshallow` first": this clone is shallow); the local TS buckets
  borrow `main`'s prebuilt `pi_natives.win32-x64-baseline.node` (this window touches
  `crates/pi-builtins/src/{du,uptime}.rs` and `crates/pi-natives/src/highlight.rs` but changes no binding
  surface — `packages/natives/native/index.{js,d.ts}` are byte-identical to `v18.10.4`), and PR CI never
  builds a PR-side addon for `sync/*` branches, so the branch-dispatch recipe in
  `document/merge-playbook.md` remains the authoritative validation.

### Per-file conflict decisions (41)

`mech` = upstream's change with the Zeta surface re-applied (scope/role/copy only); `combine` = upstream's
change *and* a Zeta-only behaviour merged by hand; `version` = lockfile version line; `delete` = upstream
removed the file and our side of it was scope/brand-only; `regen` = generated artifact.

| # | File | Class | Upstream's change | Zeta side at risk | Resolution |
|---|---|---|---|---|---|
| 1 | `Cargo.lock` | version | 12 workspace-crate version lines `18.10.3`→`18.10.4` | our `1.2.1` lines | **ours** (no dependency delta upstream) |
| 2 | `Cargo.toml` | version | `[workspace.package] version = "18.10.4"` | `version = "1.2.1"`, `authors = ["Linxira-OS"]` | **ours** |
| 3 | `bun.lock` | version | 24 workspace version lines | our `@linxiraos/*` names + `1.2.1` | **ours** |
| 4 | `MODULE.bazel.lock` | version | Windows-regenerated lock (CRLF blobs, collapsed input list) | our Linux-generated lock | **ours** |
| 5 | `packages/agent/src/compaction/branch-summarization.ts` | mech | adds `import * as snapcompact` | scope map | upstream + scope map |
| 6 | `packages/ai/test/codex-code-mode-metadata.test.ts` | **delete** | deleted with the Code Mode purge (134 lines) | only the two import lines were re-scoped | **theirs** (deletion accepted) |
| 7 | `packages/ai/test/openai-codex-stream.test.ts` | mech | drops the `code_mode_tool_names` assertions | our `ZETA never emits it` comment + `zeta` originator assertions | **theirs** for the dropped assertions; the rest of the file keeps our spelling |
| 8 | `packages/catalog/src/compat/rules.json` | regen | upstream regenerated it | our own KDL deltas | **theirs in the merge, regenerated in the follow-up** (`bun run gen:compat` → 1028 rules / 21 classes / 87 catalog providers / 96 auth providers / 234 files) |
| 9 | `packages/coding-agent/src/cli/auth-gateway-cli.ts` | mech | adds `getEffectiveTokenCost` | scope map | upstream + scope map |
| 10 | `packages/coding-agent/src/cli/gc-cli.ts` | mech | adds `isCompressScratchPath` | scope map | upstream + scope map |
| 11 | `packages/coding-agent/src/cli/models-cli.ts` | mech | adds `getEffectiveTokenCost` | scope map | upstream + scope map |
| 12 | `packages/coding-agent/src/cli/ps-cli.ts` | mech | adds the shared-browser restart imports | scope map | upstream + scope map |
| 13 | `packages/coding-agent/src/extensibility/extensions/types.ts` | **combine** | adds `ConfiguredThinkingLevel` from `pi-tui/thinking` | Zeta keeps `SidebarWidget`, whose `render(ctx: SegmentContext)` needs `SegmentContext` from `pi-tui/status-line/types` | **combined**: upstream's import *and* `ContextUsage, SegmentContext` |
| 14 | `packages/coding-agent/src/launch/ensure.ts` | mech | adds `DaemonBrokerRejectedError` | scope map | upstream + scope map |
| 15 | `packages/coding-agent/src/session/agent-session.ts` (hunks 1–2) | mech | adds catalog-policy + snapcompact imports | scope map | upstream + scope map |
| 16 | `packages/coding-agent/src/session/agent-session.ts` (hunk 3) | **combine** | deletes `initializeCodeMode` / `get codeModeNamespacesInfo` (Code Mode purge) | Zeta-only `applyCustomCommandReload` (custom-command hot reload) sits in the same hunk | **combined**: our `applyCustomCommandReload` kept, both Code Mode methods dropped |
| 17 | `packages/coding-agent/src/session/code-mode.ts` | **delete** | deleted with the purge (120 lines) | one re-scoped import | **theirs** |
| 18 | `packages/coding-agent/src/session/session-maintenance.ts` | mech | drops the `preferredDialect` import (its only uses went with the reasoning-policy refactor) | scope map | **theirs** (verified: the merged file has no `preferredDialect` use) |
| 19 | `packages/coding-agent/src/session/session-manager.ts` | mech | adds `import * as snapcompact` | scope map | upstream + scope map |
| 20 | `packages/coding-agent/src/task/index.ts` | mech | adds `ApprovalDetailsOptions` / `truncateApprovalDetail` | scope map | upstream + scope map |
| 21 | `packages/coding-agent/src/tools/approval.ts` (2 hunks) | mech | adds `ApprovalDetailsOptions` to the import and the re-export | scope map | upstream + scope map |
| 22 | `packages/coding-agent/src/tools/browser/declarations.d.ts` | **delete** | deleted with the purge (1650 lines) | two re-scoped lines | **theirs** |
| 23 | `packages/coding-agent/src/tools/eval.ts` | mech | drops the `generateCodeModeDeclarations` import | scope map | **theirs** |
| 24 | `packages/coding-agent/src/tools/image-gen.ts` | mech | adds `getEffectiveTokenCost` | scope map | upstream + scope map |
| 25 | `packages/coding-agent/test/eval-code-mode-declarations.test.ts` | **delete** | deleted with the purge (176 lines) | two re-scoped imports | **theirs** |
| 26 | `packages/coding-agent/test/experimental-context-management.test.ts` | mech | reflowed import block | `@linxiraos/zeta/*` paths | upstream + scope map (oxfmt re-collapsed) |
| 27 | `packages/coding-agent/test/gc-cli.test.ts` | mech | adds `compressMethod` | scope map | upstream + scope map |
| 28 | `packages/coding-agent/test/interactive-mode-plan-review.test.ts` | mech | adds the extension runtime imports + extension event types | scope map | upstream + scope map |
| 29 | `packages/coding-agent/test/registry/persisted-agent-attribution.test.ts` | mech | adds `AgentLifecycleManager`, `AgentSession` types | scope map | upstream + scope map |
| 30 | `packages/coding-agent/test/session-code-mode.test.ts` | **delete** | deleted with the purge (680 lines) | scope map only | **theirs** |
| 31 | `packages/coding-agent/test/session-manager/usage-statistics.test.ts` | mech | adds `buildSessionContext`, `resolveSessionLeafId`, `TempDir` | scope map | upstream + scope map |
| 32 | `packages/coding-agent/test/settings-manager.test.ts` | mech | drops the `cfgEvalJs` import (its uses left with Code Mode) | scope map | **theirs** (verified: 0 uses in the merged file) |
| 33 | `packages/coding-agent/test/tools/browser-profile-cleanup.test.ts` | mech | adds `DaemonBrokerRejectedError` / `restartSharedBrowser` / `DaemonState` | scope map | upstream + scope map |
| 34 | `packages/snapcompact/src/snapcompact.ts` | mech | adds `isRecord` | scope map | upstream + scope map |
| 35 | `packages/stats/src/db.ts` | mech | adds `hasRecurringTariff` | scope map | upstream + scope map |
| 36 | `packages/stats/src/frustration.ts` | mech | adds `getEffectiveTokenCost` | scope map | upstream + scope map |
| 37 | `packages/stats/test/db-cost.test.ts` (2 hunks) | mech | adds `spyOn`, `catalogModels` | scope map | upstream + scope map |
| 38 | `packages/tui/src/overlays/btw-history-panel.ts` | **combine** | the copy button's action kind becomes `copy-answer` (so the click routes to omp's own copy instead of the terminal-local one) | our role `zeta.btw.copied` | **combined**: upstream's action kind + `zeta.btw.copied` |
| 39 | `packages/tui/src/overlays/model-browser.ts` | mech | adds `getEffectiveTokenCost` | scope map | upstream + scope map |
| 40 | `packages/tui/src/tools/eval-format/code-mode-declarations.ts` | **delete** | deleted with the purge (61 lines) | one re-scoped import | **theirs** |
| 41 | `packages/tui/test/terminal-capabilities.test.ts` | mech | adds the `withFakeTmux` helper import | scope map | upstream + scope map |

(`packages/tui/test/dialogs-native.test.ts` and `packages/tui/test/native-panels-misc.test.ts` are the
merge's *silent* half of row 39/41's role work: they auto-merged with upstream's new `omp.btn` /
`omp.approval.*` assertions, which the role sweep re-spelled.)

### Checks

| Check | Result |
|---|---|
| `git merge-base HEAD v18.10.4` (before / after) | `81e1d8927a3c` / `687892d1046e` |
| `git merge-base --is-ancestor v18.10.4 HEAD` | exit 0 |
| `git rev-list --parents -n 1 c86128383f1` | `c86128383f1 08a79203681 687892d1046` (two parents, second is the tag) |
| `bun scripts/check-merge-lineage.ts --tag v18.10.4` | exit 0 pre-merge ("lineage intact — safe to merge"); the no-argument audit form is what CI runs |
| `bun scripts/check-merge-lineage.ts` (audit form, post-merge) | exit 0 |
| `bun scripts/check-version-consistency.ts` | exit 0 |
| `bun run check:ts` (`bun run ci:check:full`: oxlint + oxfmt over 6350 files + all 17 workspace packages' `check:types`) | exit 0 (246.95s). The first run failed at `oxfmt --check` on two upstream import blocks that the scope shortening made single-line (`experimental-context-management.test.ts`, `settings-manager.test.ts`) — formatting fixed, both files then clean |
| `bun scripts/check-scope-imports.ts` | exit 0 (19038 specifiers, 5 allow patterns) |
| `bun scripts/brand/brand-overlay.ts` | 0 rewrites needed (the sweep was already applied by hand) |
| `bun scripts/brand/brand-check.ts` | exit 0 (0 hits, 0 missing assertions) |
| `bun scripts/check-zeta-sentinels.ts` | exit 0 (114 sentinels) |
| `bun scripts/check-ci-surface.ts` | exit 0 (32+1+1+1+2 jobs, 6 needs edges) |
| `bun scripts/check-i18n-consistency.ts` | exit 0 (interface 3016 / en 3016 / zh 3016) |
| `bun scripts/check-i18n-commands.ts` | exit 0 (320 descriptions across 23 files) |
| `bun scripts/scan-brand-regressions.ts --base 08a79203681` | 0 regressions |
| `bun scripts/audit-merge-members.ts --base 08a79203681` | exit 1 — 35 members / 17 files, all justified above (upstream's own removals or heuristic reads; no Zeta-only member) |
| `bun run merge-gate --gates-only --base 08a79203681` | **18 passed / 2 failed** (6m15s) — the two failures are the machine-local `package.json merge-drop` (shallow clone) and the justified `merge member loss` rows above; every guard, including the full workspace type check, passes |
| `cargo fmt --all -- --check` | exit 0 (`crates/` touched) |

### Tests (merge-touched files, run locally on Windows)

Every test file the merge touched was run: agent 32 pass, ai 132 pass / 2 fail, catalog 104 pass,
snapcompact 112 pass, tui 130 pass (3 skip), coding-agent 728 pass / 18 fail, stats 11 pass / 12 fail —
all failures are the documented machine-local shapes, not merge damage:

- `packages/stats/test/db-cost.test.ts` — the pre-existing failures of the stats suite (it runs in CI as
  a `continue-on-error` step). Verified by running the same suite in the **main** checkout: 15/15 fail
  there, so the merge did not introduce them (and three now pass in the merged tree).
- `packages/ai/test/openai-codex-stream.test.ts` — the two `x-codex-turn-state` SSE cases time out at the
  local 5s budget (the v18.10.1/v18.10.3 rungs recorded the same pair; CI's larger budget covers them).
- coding-agent — 16 `settings-manager.test.ts` symlink cases (`EPERM: operation not permitted, symlink`:
  the Windows symlink privilege), 1 `sdk-tool-activation.test.ts` TempDir cleanup (`EBUSY`), and 1
  `proc-service.test.ts` case throwing `ipcEndpoint is not a function` from the **borrowed** addon
  (main's prebuilt `.node` predates the v18.10.0 natives export; the source calls match `v18.10.4`
  line-for-line and this window changes no binding surface).
- tui/agent/catalog/snapcompact are fully green.
## v18.10.3 incremental merge (Zeta — branch `sync/omp-release/v18.10.3`; merge commit `e78ebe945da`)

- **Source tag**: `v18.10.3` → `81e1d8927a3c16cfaff2e9456baa8c060e1e0e9b`, a *lightweight* tag
  (`git ls-remote --tags omp-upstream refs/tags/v18.10.3` advertises that one line and no
  `refs/tags/v18.10.3^{}` peel), fetched with `git fetch omp-upstream --no-filter tag v18.10.3` and
  read back with `git rev-parse v18.10.3` — remote and local agree, so the tag was not moved.
  **Zeta starting commit**: `c2f5a0a0121` (`main`, the rung-1 merge of PR #227).
- **Baseline**: v18.10.1 (`5d0aaffaf1f987503ce129a642fb6e30339615af`).
- **The window carries v18.10.2 as well** (verified, not assumed): `git merge-base --is-ancestor
  v18.10.2 v18.10.3` exits 0 (`v18.10.2` = `c8913466dd7bf92040de911f8e00e30b8f4e48a2`).
- **Lineage gate** (pre-merge, mandatory): `git merge-base HEAD v18.10.3` →
  `5d0aaffaf1f987503ce129a642fb6e30339615af`, exactly the previous integrated tag, so the merge
  computes upstream's own increment and never our diff. **After** the merge: `git merge-base HEAD
  v18.10.3` → `81e1d8927a3c16cfaff2e9456baa8c060e1e0e9b` and `git merge-base --is-ancestor v18.10.3
  HEAD` exits 0. (`bun scripts/check-merge-lineage.ts --tag v18.10.3` is the *pre*-merge form of this
  gate — run afterwards it refuses by design, because the candidate tag has become an ancestor; CI
  runs the no-argument audit form, which reads the "Integrated through" line at the top of this file.)
- **Window**: 126 commits / 272 files / +23561 −1587 — upstream's tag-to-tag diff
  (`git diff --shortstat v18.10.1 v18.10.3`), i.e. `v18.10.1→v18.10.2` (26 commits / 138 files)
  plus `v18.10.2→v18.10.3` (100 commits / 173 files). Theme: GPT-5-and-later and replayed-Claude
  context counted at what each provider bills, catalog-policy-driven image/snapcompact budgets
  (official-endpoint gating, `image-max-edge`, `thinking-unverified`, verified frame prices),
  sibling subagent prompt-cache sharing, the in-process shell builtins (`env`, `du`, `chmod`, `fold`,
  `rmdir`, `od`, `df`, `uptime`, `id`, `dd`, `nl`), the native media viewer for git diffs, media-path
  read results, and `--restore` (resume the turn a crashed process left unfinished).
- **Conflicts**: 57, all `UU`; the dry run
  (`git merge-tree --write-tree --name-only HEAD v18.10.3 | grep -cE '^CONFLICT'`) predicted 57
  exactly. `local://upstream-ladder-measured.md` listed 81 for this tag, but that figure was measured
  from a *v18.10.0* merge-base (`.1` and `.2` folded in); stepping one integrated tag at a time is
  what keeps this window at 57.
- **Resolution rule**: upstream wins inside every overlapping hunk, then the Zeta surface is
  re-applied (`@oh-my-pi/*` → the scope map / `pi-coding-agent`→`zeta`, `omp.*` → `zeta.*` roles,
  `.zeta` paths, `zetacode`/`CLI_BIN_NAME` copy). Eleven hunks carried deliberate Zeta-only behaviour
  and were *combined* instead of taken from one side (rows 5, 16, 23, 27, 28, 30, 34, 49 — plus the
  four artifact rows that are ours by version line, and row 57 which is regenerated). The rest are
  mechanical: upstream added imports/fields the merged body needs, and our side of the hunk differs
  only by the scope or role spelling.
- **Lockfiles**: `Cargo.toml` / `Cargo.lock` / `bun.lock` conflict on the version line only —
  upstream's entire delta in all three is `18.10.1` → `18.10.3` (`git diff v18.10.1 v18.10.3` has no
  other changed line in any of them) — and the Zeta `1.2.1` line wins, so all three end
  byte-identical to `c2f5a0a0121`. `bun install` afterwards changed nothing.
- **`MODULE.bazel.lock`**: ours, plus exactly one re-pointed input hash. The lock records each
  build input as `FILE:@@//<path> <sha256 of that file>` — a property this round verified mechanically
  (18 of 19 entries matched their working-tree file; the 19th was `crates/pi-builtins/Cargo.toml`,
  whose merged content is upstream's because upstream rewrote that manifest in this window). That one
  line now carries upstream's `98e0ec7aaec5e4239fd4eced13515aed9767507210610d2ab7c9f6ca30030939`,
  which is the sha256 of the merged file. Everything else in the lock stays ours, because both Cargo
  files are ours — the same reasoning as the v18.10.1 round.
- **Generated catalog artifacts**: `packages/catalog/src/models.json` (unchanged on our side) is
  upstream's, auto-merged with no conflict. `packages/catalog/src/compat/rules.json` is generated
  from the merged KDL tree and *both* sides had regenerated it away from the base, so neither copy was
  right: the merge commit takes upstream's and the follow-up commit regenerates ours
  (`bun run gen:compat` → 1015 rules, 21 classes, 87 catalog providers, 96 auth providers, 234 files).

### Per-file conflict decisions (57)

`mech` = upstream's change with the Zeta surface re-applied (scope/role/copy only); `combine` =
upstream's change *and* a Zeta-only behaviour merged by hand; `version` = lockfile version line;
`regen` = generated artifact.

| # | File | Class | Upstream's change | Zeta side at risk | Resolution |
|---|---|---|---|---|---|
| 1 | `Cargo.lock` | version | 11 hunks: workspace crate versions `18.10.1`→`18.10.3` | our `1.2.1` lines | **ours** (no dependency delta upstream) |
| 2 | `Cargo.toml` | version | `[workspace.package] version = "18.10.3"` | `version = "1.2.1"`, `authors = ["Linxira-OS"]` | **ours** |
| 3 | `bun.lock` | version | 12 hunks: workspace names/versions | our `@linxiraos/*` names + `1.2.1` | **ours** |
| 4 | `MODULE.bazel.lock` | version | Cargo file hashes, `BUILD.bazel` blob, `pi-shell-18.10.3` alias | our hashes + `pi-shell-1.2.1` | **ours**, one input hash re-pointed (see above) |
| 5 | `crates/pi-builtins/src/lib.rs` | combine | adds `md5sum`/`sha*sum`/`chmod` module declarations and `nl` | our `nohup` declaration (Zeta-only builtin) | **theirs + ours**: upstream's list is a strict superset (`147 ⊃ 132` modules, identical `#[cfg]` attrs for every shared one), so the file is taken wholesale — which *keeps* `nohup` because upstream has it too |
| 6 | `packages/agent/src/agent.ts` | mech | adds `openAIResponsesReplaysNativeHistory` import | our `snapcompact` import | upstream's import; our `snapcompact` import **dropped** — upstream's `#syncTokenizer` rewrite (`countsAlike(model, options)`) removed its only use in this file |
| 7 | `packages/agent/src/compaction/openai.ts` | mech | drops `estimateImageTokens` from the image-tokens import | our import of it | **theirs** — upstream's billing rewrite removed the usage; keeping it would be an unused import |
| 8 | `packages/agent/src/tokenizer.ts` | mech | new replay/reader imports (`AssistantMessage`, `isColdReplayableResponsesTurn`, `resolveThinkingReplayTokens`, …) | `@oh-my-pi/snapcompact` → `@linxiraos/pi-snapcompact` | upstream's import block + scope map |
| 9 | `packages/agent/test/branch-summarization.test.ts` | mech | adds `getBundledModel` | scope map | upstream + scope map |
| 10 | `packages/agent/test/image-tokens.test.ts` | mech | adds `countResponsesHistoryTokens`, `Model` | scope map | upstream + scope map |
| 11 | `packages/agent/test/output-budget.test.ts` | mech | adds `transformMessages` | scope map | upstream + scope map |
| 12 | `packages/agent/test/tokenizer.test.ts` | mech | adds codex/responses fixtures | scope map | upstream + scope map |
| 13 | `packages/ai/src/stream.ts` | combine | `CODEX_BASE_URL` → `isOfficialCodexApiUrl`, adds `withoutUnverifiedThinking` | our `CODEX_BASE_URL` import | **theirs**: upstream moved the helper to `pi-catalog/wire/codex` and this file's only reference is now `isOfficialCodexApiUrl(model.baseUrl)` |
| 14 | `packages/ai/test/openai-responses-history-payload.test.ts` | mech | adds `openAIResponsesReplaysNativeHistory` | scope map | upstream + scope map |
| 15 | `packages/coding-agent/src/cli/git-tui/state.ts` | mech | adds `type MediaRef` | scope map | upstream + scope map |
| 16 | `packages/coding-agent/src/commands/launch-help.ts` | combine | hunk 1: new `restore` flag + `from-claude`/`from-codex`; hunk 2: new `--restore` example | our `ZETA` in the import descriptions, `${CLI_BIN_NAME}`, `~/.zeta/agent/...`, `--alias zc-work` | **combined**: upstream's flag and example line, our copy/bin/paths throughout |
| 17 | `packages/coding-agent/src/config/model-registry.ts` | mech | `isOfficialCodexApiUrl` now imported from `pi-catalog/wire/codex` | our old `pi-ai/stream` import | **theirs** (drop the stale one) |
| 18 | `packages/coding-agent/src/main.ts` | mech | adds `automaticThinkingLevel` | longer scope name | upstream + scope map (oxfmt then re-wrapped the line) |
| 19 | `packages/coding-agent/src/modes/controllers/event-controller.ts` | mech | adds `readMediaPath` + job-frame helpers | scope map | upstream + scope map |
| 20 | `packages/coding-agent/src/modes/utils/ui-helpers.ts` | mech | same as row 19 | scope map | upstream + scope map |
| 21 | `packages/coding-agent/src/sdk.ts` | mech | adds `resolveCatalogPolicy`, snapcompact budget helpers | scope map | upstream + scope map |
| 22 | `packages/coding-agent/src/session/agent-session.ts` | mech | adds `resolveCatalogPolicy`, `frameDataBytesBudget` | scope map | upstream + scope map |
| 23 | `packages/coding-agent/src/session/exit-diagnostics.ts` | combine | replaces a literal with the new `INTERRUPTED_TURN_ERROR` constant | our brand string `Previous ZETA process exited…` | **combined**: the constant is adopted *and* its value is the Zeta one (the matcher at line 180 compares against the same constant) |
| 24 | `packages/coding-agent/src/session/provider-image-budget.ts` | mech | adds `reachesOfficialEndpoint`, `capFrameDataBytes` | scope map | upstream + scope map |
| 25 | `packages/coding-agent/src/session/session-advisors.ts` | mech | adds `automaticThinkingLevel` | scope map | upstream + scope map |
| 26 | `packages/coding-agent/src/session/session-maintenance.ts` | mech | adds `Tokenizer`, `openAIResponsesReplaysNativeHistory` | scope map | upstream + scope map |
| 27 | `packages/coding-agent/src/session/session-manager.ts` | combine | adds `getInheritedProviderPromptCacheKey` + `taskPromptCacheKey` to the fork/new-session paths | our `client` field (web client identity survives a `/new` copy and a fork) | **combined**: `client` kept *and* upstream's inherited-key logic added in both hunks |
| 28 | `packages/coding-agent/src/session/settings-stream-fn.ts` | combine | adds `openAIResponsesReplaysNativeHistory` | our `tokenizerEncodingForModel` + `Encoding` imports | **combined**: upstream's import added, ours kept |
| 29 | `packages/coding-agent/src/session/snapcompact-inline.ts` | mech | `Message` replaces `ToolResultMessage` in the pi-ai import; new comment | our `ToolResultMessage` import | **theirs** — upstream's imaging rewrite replaced the usage (verified: no remaining reference) |
| 30 | `packages/coding-agent/src/task/executor.ts` | combine | new `structured?: boolean` field + doc on `FollowUpTurnOptions` | our Zeta-only `model?: string` wake-turn field (#228) | **combined**: both fields, upstream's doc line |
| 31 | `packages/coding-agent/src/task/index.ts` | mech | adds `type StructuredSubagentRequest` | scope map | upstream + scope map |
| 32 | `packages/coding-agent/src/task/settings.ts` | mech | adds `isRecord` | scope map | upstream + scope map |
| 33 | `packages/coding-agent/src/tools/bash.ts` | mech | adds `WALL_TIME_NOTICE_MIN_MS` | scope map | upstream + scope map |
| 34 | `packages/coding-agent/src/tools/read.ts` | combine | `FilesystemReadOptions` interface + `#readFilesystemPath`/`#readFilesystemPipeline` split | our `planTargetedRead?` option (plan-URL read window) | **combined**: upstream's refactor, and `planTargetedRead?` (+ its doc) restored on the moved interface — without it the call site is an excess-property error |
| 35 | `packages/coding-agent/src/utils/image-resize.ts` | mech | adds `inflateSync`, `encodeRawPng` | scope map | upstream + scope map |
| 36 | `packages/coding-agent/test/agent-session-model-persistence.test.ts` | mech | new imports (`AgentMessage`, `AssistantMessageEventStream`, …) | `@linxiraos/zeta` paths | upstream + scope map |
| 37 | `packages/coding-agent/test/agent-session-snapcompact-budget.test.ts` | mech | adds `buildModel`/`toModelSpec`/`ExtensionRunner` | scope map | upstream + scope map |
| 38 | `packages/coding-agent/test/agent-session-snapcompact-frame-dead-end.test.ts` | mech | adds `Model`, `computeNonMessageTokens` | scope map | upstream + scope map |
| 39 | `packages/coding-agent/test/agent-session-snapcompact-trigger-room.test.ts` | mech | adds `buildModel`/`toModelSpec` | scope map | upstream + scope map |
| 40 | `packages/coding-agent/test/bash-failure-result.test.ts` | mech | adds theme + `bashToolRenderer` imports, timing tests | scope map | upstream + scope map |
| 41 | `packages/coding-agent/test/git-tui-stream.test.ts` | mech | adds `ChangedFile` | scope map | upstream + scope map |
| 42 | `packages/coding-agent/test/modes/controllers/event-controller-task-async-updates.test.ts` | mech | adds native-rendering helpers | scope map | upstream + scope map |
| 43 | `packages/coding-agent/test/session/provider-image-budget.test.ts` | mech | adds `getBundledModel`/`toModelSpec` | scope map | upstream + scope map |
| 44 | `packages/coding-agent/test/snapcompact-inline.test.ts` | mech | multi-line pi-ai import + `transformMessages` | scope map | upstream + scope map |
| 45 | `packages/coding-agent/test/task/executor-soft-budget.test.ts` | mech | adds `node:path`, `cfgTaskAgentSoftRequestBudget` | scope map | upstream + scope map |
| 46 | `packages/coding-agent/test/utils/image-resize.test.ts` | mech | adds `encodeRawPng` | scope map | upstream + scope map |
| 47 | `packages/snapcompact/src/snapcompact.ts` | mech | adds `Model`, `reachesOfficialEndpoint`, `resolveCatalogPolicy`, `resolveImageCountBudget`/`resolveInlineImageByteBudget` | scope map | upstream + scope map |
| 48 | `packages/snapcompact/test/snapcompact.test.ts` | mech | adds `Model`, `buildModel`, `getBundledModel`, `toModelSpec` | scope map | upstream + scope map |
| 49 | `packages/tui/src/apps/git/diff-pane.ts` | combine | moves the asset-title helper to a module-level `assetTitle()` and calls it from both panes | our `#assetTitle` method carrying the Zeta i18n kinds, and the localized Before/After labels | **combined**: upstream's module function and call shape, our `tuiText(...)` labels/kinds re-applied inside it, the private copy deleted |
| 50 | `packages/tui/src/native/blobs.ts` | mech | adds `resolveImageOptions` | scope map | upstream + scope map |
| 51 | `packages/tui/src/overlays/model-browser.ts` | mech | adds `TspPickerMark` | scope map | upstream + scope map |
| 52 | `packages/tui/src/overlays/tree-selector.ts` | mech | adds `editorKey`, `getKeybindings` | scope map | upstream + scope map |
| 53 | `packages/tui/src/tools/native-view.ts` | mech | `input.state === "background"` branch | our `zeta.run.time` roles | upstream's condition + role map |
| 54 | `packages/tui/src/tools/wait.ts` | mech | `"col"`→`"row"`, `gap: "sm"` | our `zeta.wait.job` role | upstream's shape + role map |
| 55 | `packages/tui/test/apps-native.test.ts` | mech | adds `TSP_KINDS` | scope map | upstream + scope map |
| 56 | `packages/tui/test/tools-native-shell.test.ts` | mech | adds pi-ai + assistant-message imports | scope map | upstream + scope map |
| 57 | `packages/catalog/src/compat/rules.json` | regen | upstream regenerated it | our own KDL deltas | **theirs in the merge, regenerated in the follow-up** (see above) |

**Honest split**: 43 of the 57 rows were mechanical (upstream's hunk plus the scope map, the role map,
or a `.zeta` path — no judgement involved). 14 were judgement calls: rows 5, 16, 23, 27, 28, 30, 34
and 49 are Zeta-only behaviour that had to survive an upstream rewrite of the same lines; rows 1–4 and
57 are "whose artifact is right" (version line / generated file), which is a decision about ownership,
not about code; rows 7, 13, 17 and 29 are cases where our side of the conflict had to be *dropped*
because upstream's rewrite removed the only use of the symbol.

### Post-merge Zeta adaptation (commits `faf617c5b86`, `196e6293996`)

- **Scope sweep** (`@oh-my-pi/*` → the Zeta scope map, 137 specifiers in 21 files) and **role sweep**
  (`omp.*` → `zeta.*`) run over *every file the merge touched*, not only the conflicted hunks — git
  auto-merged the rest, so the residue lives outside the conflict list (merge-playbook 「结论 2」). The
  residue was 22 files of upstream tests/sources carrying `@oh-my-pi/*` imports plus
  `packages/tui/{src/apps/git/git-tui.ts,test/apps-native.test.ts,test/wait-render.test.ts}` carrying
  `omp.app.git.*` / `omp.wait.job`. **Neither `app` nor `wait` was in the brand-rules role
  alternation, so brand-check stayed green while the residue shipped** — the alternation now lists
  every namespace the TUI emits (`role: "zeta.<ns>"` over `packages/`), which is the only form that
  cannot go stale again.
- **`bun scripts/brand/brand-overlay.ts`** (idempotent mechanical pass): 3 tokens in 2 files — the
  `--restore`/`--export` examples' `~/.omp/agent` → `~/.zeta/agent`, and a `.omp` fixture path in the
  imported `restore-revive` test.
- **`omp --restore` copy** (8 source/doc-comment/test-label sites) → `zetacode --restore`: the
  backticked form sits outside the brand rule's lookbehind, so the gate cannot see it; the CLI is
  `zetacode` everywhere else in the product. CHANGELOG prose keeps upstream's spelling (the rule
  exempts it, and released entries are history).
- **A resurrected env contract**: upstream's new `test/task/restore-revive.test.ts` isolated the agent
  dir with `PI_CODING_AGENT_DIR`/`PI_PROFILE`, which `packages/utils/src/dirs.ts` does not read (it
  reads `ZETA_CODING_AGENT_DIR`/`ZETA_PROFILE`) — the test would have written into the developer's real
  agent dir. `ENV_KEYS` now clears the Zeta names too (the `OMP_`/`PI_` aliases the rest of the suite
  clears are kept).
- **CHANGELOG fold**: the union merge driver (`packages/*/CHANGELOG.md merge=union`) re-adds upstream's
  entire `## [18.x]` section history, and the version gate rejects any `^## [1[5-8]\.` header. The new
  upstream sections (`18.10.2`, `18.10.3`, plus upstream's `[Unreleased]`) were folded into
  `[Unreleased]` for all 8 packages — 68 bullets, verified against `refs/heads/main` for exact and
  near duplicates (none), with `omp.run.time`/`omp.wait.job` re-spelled to `zeta.*`. Nothing else of
  upstream's CHANGELOG history is carried (the fork dropped those sections in the squash-sync era).
  One pre-existing `[Unreleased]` bullet's `@oh-my-pi/pi-tui/native/*` spelling was restored to main's
  text rather than swept, because that file is allow-listed for exactly that mention.
- **The task `model` contract** (`196e6293996`): upstream's imported sibling prompt-cache routing test
  spawns with `model: \`${provider}/${modelId}\``; #228's Zeta contract rejects a spawn `model`
  outright, and upstream's own `spawnParamsFor` never reads the field, so the test's assertions depend
  on the parent session's model (which the test already resolves per case). The field was dropped with
  a comment; the routing contract under test is unchanged (16 pass / 0 fail).

### Checks (all exit 0 unless stated)

| Gate | Result |
|---|---|
| `bun scripts/check-version-consistency.ts` | version line consistent at `1.2.1`: 14 packages + 13 catalog keys + Cargo + main workspace + natives stamp + desktop + npm distribution leaf pins + README badge + `crates/*/BUILD.bazel` + Cargo.lock members (needed the CHANGELOG fold to get here: before it, 8 packages reported an upstream `## [18.x]` section) |
| `bun run check:ts` | 0 errors (`check:tools` + all 17 workspace `check:types`) |
| `bun scripts/check-scope-imports.ts` | 18885 `@linxiraos/*` specifiers resolve (5 allow patterns) |
| `bun scripts/brand/brand-check.ts` | 0 hit(s), 0 missing assertion(s) |
| `bun scripts/check-zeta-sentinels.ts` | 114 sentinels verified, AGENTS.md → document/merge-review.md |
| `bun scripts/check-ci-surface.ts` | CI surface OK (32 jobs in `ci.yml` + satellite workflows) |
| `bun scripts/check-shared-infra.ts` | 15 endpoints pinned across 4308 scanned files (5 marked for replacement); the window's new `skills.omp.sh`/`live.omp.sh` mentions are the registered ones |
| `bun scripts/check-release-asset-names.ts` | OK |
| `bun scripts/check-robomp-cli-contract.ts` | OK (`zetacode` on both sides) |
| `bun scripts/generated-freshness.ts` | OK |
| `bun scripts/check-package-json-merge.ts --base refs/heads/main` | OK: 22 merge commits, no branch-side leaf dropped or reverted (needs the documented `GIT_SHALLOW_FILE=/nonexistent-shallow` override in this shallow clone — the guard refuses to run otherwise) |
| `cargo fmt --all -- --check` | exit 0 (the merge touches `crates/pi-builtins/**`; upstream's own formatting is rustfmt-clean, so the brand-shortening class-8 damage did not occur this round) |
| `bun scripts/check-merge-lineage.ts --tag v18.10.3` | **refuses, as designed**: post-merge the candidate tag is an ancestor, so `merge-base(HEAD, v18.10.3)` is the tag itself, not the baseline. The gate's pre-merge form passed here and CI runs the no-argument audit form against the "Integrated through" line |

- **Tests**: every merge-touched test file was run (agent 61 pass, ai 55, catalog 39, snapcompact 104,
  tui 49, coding-agent: 88+346+327 across three batches after the contract fix) — **all green except
  two failures that reproduce byte-identically on `main`**: `bash-failure-result.test.ts`'s
  symlink-containment case (Windows `EPERM` on `fs.symlink` — creating symlinks needs Developer Mode)
  and `eval/agent-bridge-policy.test.ts`'s JS-handle concurrency case. Both were re-run from the root
  checkout on `main` to prove they are host-local, not merge damage.
- **Not verified here**: the native addon build. This host has no local `pi_natives.*.node` for the
  worktree, so the suites borrowed `main`'s prebuilt `pi_natives.win32-x64-baseline.node` (the window
  changes no `crates/` binding surface; `packages/natives/native/index.{js,d.ts}` are byte-identical to
  `v18.10.3`). PR CI never builds a PR-side addon for `sync/*` branches; the branch-dispatch recipe in
  `document/merge-playbook.md` remains the authoritative validation and is recorded below.
- **Not verified here (2)**: the full `packages/coding-agent` suite (thousands of tests) — the merge's
  touched set was run instead, plus the four affected packages' suites; CI's buckets are the decider.

## v18.10.1 incremental merge (Zeta — branch `sync/omp-release/v18.10.1`; merge commit `e72c77df4df`)

- **Source tag**: `v18.10.1` → `5d0aaffaf1f987503ce129a642fb6e30339615af`, a *lightweight* tag
  (`git ls-remote --tags omp-upstream refs/tags/v18.10.1` advertises that one line only, no
  `refs/tags/v18.10.1^{}` peel), read back locally with `git rev-parse v18.10.1` — remote and
  local agree, so the release tag was not moved. **Zeta starting commit**: `1dcf2ccecde` (`main`).
- **Baseline**: v18.10.0 (`b83200eb866821f02625332025b453f06ce4e12a`, PR #200, merge `1765251a473`).
- **Lineage gate** (pre-merge, mandatory): `git merge-base HEAD v18.10.1` → `b83200eb866821f02625332025b453f06ce4e12a`,
  exactly the previous tag, and `bun scripts/check-merge-lineage.ts --tag v18.10.1` → "lineage intact — safe to merge".
  The merge therefore computes upstream's own increment, never our own diff.
- **Window**: 9 commits / 66 files / +5199 −1625 (upstream's tag-to-tag diff). Theme: the native-modal
  redesign — jobs/session-info/usage/context/BTW/pause/autoresearch/login/ask/MCP-wizard sheets rebuilt
  to read like the command palette, icon footers on the user message and turn footer, one merged
  running-work counter, grouped single-file `grep` output, and the MCP-wizard test pinning its key-hint
  platform.
- **Conflicts**: 27, all `UU` (a `git merge-tree --write-tree` dry run predicted 27 — exact match).
- **Resolution rule**: upstream wins inside every overlapping hunk, then the Zeta surface is re-applied
  (`zeta.*` semantic roles, the `@linxiraos/*` scope map, `.zeta` paths). Two hunks carry deliberate
  Zeta-only behaviour and were *combined* rather than taken from one side (rows 5 and 19 below).
- **Lockfiles**: `Cargo.toml` / `Cargo.lock` / `bun.lock` / `MODULE.bazel.lock` conflict on the version
  line only — upstream's entire delta in all four is `18.10.0` → `18.10.1` — and the Zeta `1.2.1` line
  wins, so all four end byte-identical to `1dcf2ccecde`. `bun install` afterwards reported no `bun.lock`
  change, and `MODULE.bazel.lock` stayed valid because neither Cargo file moved.

### Per-file conflict decisions (27)

| # | File | Upstream's change | Zeta side at risk | Resolution |
|---|---|---|---|---|
| 1 | `Cargo.lock` | 12 workspace-crate version lines `18.10.0`→`18.10.1` | the `1.2.1` line | **ours** (Zeta version line; upstream added no dependency) |
| 2 | `Cargo.toml` | `[workspace.package] version = "18.10.1"` | `version = "1.2.1"`, `authors = ["Linxira-OS"]` | **ours** |
| 3 | `bun.lock` | 24 workspace `version` lines | our `1.2.1` + Zeta workspace set | **ours** (verified: a later `bun install` leaves the file unchanged) |
| 4 | `MODULE.bazel.lock` | `Cargo.lock`/`Cargo.toml` FILE hashes + `pi-shell-18.10.1` alias | ours' `pi-shell-1.2.1` + hashes of our Cargo files | **ours** (generated artifact; consistent only because both Cargo files stay ours) |
| 5 | `packages/coding-agent/src/modes/interactive-mode.ts` | pills → segments: `RunningSegment`, `#agentsSegment`/`#jobsSegment`, `omp.hud.seg`, one merged counter | `zeta.hud.*`, **and the Zeta-only idle tok/s HUD** (`#idleStatusNative` + `#describeIdleStatusHud` + its `slot` in `describeStatusHud`) | **combined**: upstream's segment shape + `zeta.*`; the idle HUD kept (fields `#agentsSegment`/`#jobsSegment` *and* `#idleStatusNative`; `#describeIdleStatusHud` kept under upstream's new doc comment) |
| 6 | `packages/coding-agent/test/hook-editor.test.ts` | new `describe()` shape (`k:"text"` head + `md` part) | `role: "zeta.ask.question"` | upstream test (its impl changed in the same window) + `zeta.ask.question` |
| 7 | `packages/coding-agent/test/modes/components/pause-screen.test.ts` | imports `NativeChild`/`NativeNode`, asserts `omp.btn`/`omp.overlay.pause` | `@linxiraos/*` imports, `zeta.*` roles | upstream test + scope map + `zeta.*` |
| 8 | `packages/tui/src/apps/autoresearch-dashboard.ts` | `fmtNum`, `TspScrollBy`, `scroll`, `describeSheetHead`, `omp.autoresearch.*` roles | `zeta.*` roles, `@linxiraos/pi-wire` | upstream + role/scope map |
| 9 | `packages/tui/src/chat/assistant-message.ts` | shared `line` in the turn-usage row; `#handleErrorAction` → `#handleAction`; `omp.turn.*` | `zeta.turn.usage` | upstream + roles |
| 10 | `packages/tui/src/chat/user-message.ts` | toolbar becomes an icon row (Copy/Rewind icons, `align:"center"`) | text buttons carrying `zeta.user.tool` | upstream (icon footer) + `zeta.user.tool`/`zeta.user.tools` |
| 11 | `packages/tui/src/overlays/advisor-config.ts` | picker editors hoist into `#editorSheet` | `zeta.prefs.editor` | upstream + role |
| 12 | `packages/tui/src/overlays/annotation-overlay.ts` | `#describeRail`, `omp.review.*`, `max:{lines}`, `editing` guard; drops ours' `selectList` sidebar + `overlayCard` | `zeta.overlay.codeReview*` / `zeta.overlay.annotateText*` | upstream + roles |
| 13 | `packages/tui/src/overlays/ask-dialog.ts` | `ring` param, `omp.editor.ask(.hidden)`, checked tabs, `omp.ask.summary/preview/notice/answers/other.check`, `optionLabelSpans` | `zeta.editor`, `zeta.ask.*` | upstream + roles |
| 14 | `packages/tui/src/overlays/btw-history-panel.ts` | `nativeOverlay` becomes a getter over `SHEET`/`EMPTY_SHEET`; mail-reader anatomy | `zeta.overlay.btwHistory` | upstream + role |
| 15 | `packages/tui/src/overlays/hook-editor.ts` | role literal → `ROLE` constant | `"zeta.overlay.hook-editor"` | upstream (constant), with `ROLE` verified `zeta.overlay.hook-editor` |
| 16 | `packages/tui/src/overlays/jobs-panel.ts` | master–detail split (`omp.jobs.split/master/detail`, status pill, `elapsed` node, `omp.jobs.*`) | `zeta.jobs.row/detail/output` | upstream + roles |
| 17 | `packages/tui/src/overlays/login-dialog.ts` | `#describeCode/Link/Open/Live/Done`, `omp.login.*`, `omp.btn` | `zeta.login.*` | upstream + roles |
| 18 | `packages/tui/src/overlays/mcp-add-wizard.ts` | adds `node:path` import | `@linxiraos/pi-utils` | upstream + scope map |
| 19 | `packages/tui/src/overlays/plugin-selector.ts` | badges (`badgesByValue`) for version/installed/scope | **Zeta i18n** (`tuiText("pluginSelectorInstalled"/"mcpScopeWordUser"/"mcpScopeWordProject")`) | **combined**: our localized `status`/`scopeTag` + upstream's `badgesByValue.set(...)` |
| 20 | `packages/tui/src/overlays/session-info-overlay.ts` | `identityField`, `#describeStats`, `omp.info.*` | `zeta.info.copy/kv/file/*` | upstream + roles |
| 21 | `packages/tui/src/overlays/usage-dashboard.ts` | `#describeStats`/`#describeActivity`/`#quotaMeta`, `leftSpans`, `omp.usage.*` | `zeta.usage.*` | upstream + roles |
| 22 | `packages/tui/src/status-line/context-usage.ts` | stacked `bar` + `shares` rows + snapcompact rows (`omp.context.*`) | `zeta.context.*` | upstream + roles |
| 23 | `packages/tui/test/annotation-overlay.test.ts` | adds a `NativeUiEvent` import | `@linxiraos/pi-tui/...` | upstream + scope map |
| 24 | `packages/tui/test/dialogs-native.test.ts` | asserts the `omp.editor.ask` root and submit-button tone | `zeta.*` roles | upstream test + roles |
| 25 | `packages/tui/test/hook-input-timeout.test.ts` | harness helpers (`nodes`/`spans`) + imports | `@linxiraos/*` | upstream + scope map |
| 26 | `packages/tui/test/native/transcript-redesign-native.test.ts` | icon-based toolbar query (`prop(node,"name") === icon`) | `zeta.user.tool` | upstream test + role |
| 27 | `packages/tui/test/usage-native-describe.test.ts` | `plain()` helper, tightest-quota headline, `omp.info.copy` copies | `zeta.info.copy` | upstream test + role |

### Post-merge Zeta adaptation (commit `dcc8e8a84ef`)

- 31 of the window's 66 files were swept `omp.*` → `zeta.*` and `@oh-my-pi/*` → the scope map
  (`@oh-my-pi/pi-coding-agent`→`@linxiraos/zeta`, `omp-stats`→`pi-stats`, `snapcompact`→`pi-snapcompact`,
  `omptype`→`pi-omptype`, rest → `@linxiraos/<name>`), including the auto-merged regions git never
  marked as conflicts. Impl/test pairs stay consistent (`tools-native-search.test.ts` now asserts the
  role the source emits).
- Both package CHANGELOGs: the upstream `## [18.10.1]` and `## [18.10.0]` sections folded back into
  `[Unreleased]` (repo convention for unreleased upstream sections; item counts 28→28 and 26→26, no
  content lost), with the tui bullets' role names rewritten to `zeta.*`.
- `scripts/brand/brand-rules.ts`: the TUI-role alternation grew the v18.10.1 namespaces
  (turn/user/context/jobs/login/info/review/mcpAdd/btw/pause/report/prefs/autoresearch/overlay/hook/
  tool/usage/hud/actions) so a later merge cannot ship them silently.
- `scripts/brand/brand-overlay.ts`: excluded `config/omp-compat` + `config/model-registry` (they probe
  the real upstream OMP root `~/.omp/agent`, decision `92f06c8b240`) and CHANGELOG prose from the
  path-rewrite rules. Before this the overlay wanted to rewrite 9 tokens in those 4 files — i.e. it
  would have reverted that decision; after it the overlay reports `0 file(s), 0 token(s)`.

### Checks (all exit 0)

| Gate | Result |
|---|---|
| `bun scripts/check-version-consistency.ts` | version line consistent at `1.2.1`: 14 packages + 13 catalog keys + Cargo + main workspace + natives stamp + desktop + npm distribution leaf pins + README badge + `crates/*/BUILD.bazel` + Cargo.lock members |
| `bun run check:ts` | 0 errors across all 17 workspace packages (plus `check:tools` oxlint/oxfmt clean) |
| `bun scripts/check-scope-imports.ts` | 18837 `@linxiraos/*` specifiers resolve (5 allow patterns) |
| `bun scripts/brand/brand-check.ts` | 0 hit(s), 0 missing assertion(s) |
| `bun scripts/check-zeta-sentinels.ts` | 108 sentinels verified, AGENTS.md → document/merge-review.md |
| `bun scripts/check-ci-surface.ts` | 32 jobs in `ci.yml` (+ 4 satellite workflows), 37 required jobs, 6 needs edges (floor 27) |
| `bun scripts/check-package-json-merge.ts --base origin/main` | OK: 1 merge commit, no branch-side leaf dropped or reverted |
| `bun scripts/audit-merge-members.ts --base 1dcf2ccecde` | 25 flagged across 10 files — all classified: upstream renames/removals (`describeRunningPill`→`describeRunningSegment`, `#handleErrorAction`→`#handleAction`, the redesigned `#describe*` helpers) or call-site-shape regex noise; **zero `export`-level losses**, and the Zeta-only idle HUD survived |
| `bun scripts/scan-brand-regressions.ts --base 1dcf2ccecde` | 2 hits, both inside the `brand-rules.ts` `why` text this round edited (rule documentation names the upstream spellings) — no product surface |

- **Tests**: the touched buckets are green — `bun test` over the 5 conflicted tui test files + the 3
  new tui test files + `coding-agent`'s two conflicted tests = **80 pass / 0 fail**, and the HUD test
  `interactive-mode-activity-line.test.ts` is **4 pass / 0 fail**. The whole `packages/tui/test` suite
  is 3712 pass / 20 fail, and the **identical** failure set reproduces on clean `main` (22 fail) — host
  locale (`toLocaleTimeString` renders `下午06:05` where the test wants `06:05 pm`), Windows ConPTY
  escape sequences, and flaky native-image timeouts. No merge-introduced failure.
- **Not verified here**: the native addon build. This host has no local `pi_natives.*.node`, so the
  suite borrowed `main`'s prebuilt `pi_natives.win32-x64-baseline.node`. This window changes no
  `crates/` file and `packages/natives/native/index.{js,d.ts}` are byte-identical to `v18.10.1`, so the
  borrowed addon is ABI-adequate; PR CI (which never builds a PR-side addon for `sync/*` branches) and
  the branch-dispatch recipe in `document/merge-playbook.md` remain the authoritative validation.

### Second merge: `main` caught up (commit `15511db8069`)

- `main` advanced from `1dcf2ccecde` to `b580b1cbaa2` while the PR was in flight (PR #225 plan-ultra
  depth, PR #226 `bun run merge-gate` + the two orphan suites, PR #228 passive per-subagent model
  switching). Repo rule: an integration branch is never pushed/PR'd behind `main`, so `origin/main`
  was merged into the branch.
- **Zero conflicts** — this is an our-vs-our merge, so no upstream comparison applies. Auto-merged:
  `packages/coding-agent/CHANGELOG.md` (main's #228 bullet landed inside the folded `[Unreleased]`;
  one stray blank line removed), `packages/coding-agent/src/modes/interactive-mode.ts` (main's
  plan-ultra workflow journaling and this round's HUD/segment resolution coexist —
  `#planModePausedWorkflow` ×7, `zeta.hud.seg` ×1, `#describeIdleStatusHud` ×2), and
  `scripts/brand/brand-rules.ts` (main's new `task.enableModelParam` MUST_NOT_CONTAIN rule beside this
  round's v18.10.1 role alternation).
- Nothing resolved in the tag merge was invalidated: no `packages/coding-agent/src/task/**`,
  `config/settings*` or `packages/tui/src/tools/task.ts` file was ever part of the conflict set, and
  after the merge `git merge-base v18.10.1 HEAD` is still
  `5d0aaffaf1f987503ce129a642fb6e30339615af` with `git merge-base --is-ancestor v18.10.1 HEAD` passing.
- The PR (#227) shows the net diff against `main`, so the four lockfiles (identical to main) and the
  reverted-by-net files drop out of that view.

### `bun run merge-gate --gates-only --base origin/main --tag v18.10.1`

16 passed, 3 failed, 1 skipped — all three failures are the documented machine-local shapes, not
damage:

| Step | Verdict | Why |
|---|---|---|
| `package.json merge-drop` | FAIL | `package.json merge guard FAILED: shallow repository` — this clone is shallow; the guard needs `git fetch --unshallow` or the documented process override `GIT_SHALLOW_FILE=/nonexistent-shallow`, under which the same guard reports **OK: 1 merge commit(s), no branch-side leaf dropped or reverted** |
| `merge member loss` | FAIL | 25 members across 10 files vs `origin/main` — the identical set already classified above: upstream renames/removals (`describeRunningPill`→`describeRunningSegment`, `#handleErrorAction`→`#handleAction`, the redesigned `#describe*` helpers) plus call-site regex noise. No `packages/coding-agent/src/task/**`, `plan-mode/*`, or `scripts/merge-gate.ts` member from main's new PRs is missing |
| `brand regression scan` | FAIL | 2 hits, both in the `scripts/brand/brand-rules.ts` `why` text this round edited (rule documentation must name the upstream spellings) |
| `Rust format` | SKIP | no Rust change since `origin/main` |

### Branch-dispatch CI run

`gh workflow run ci.yml --ref sync/omp-release/v18.10.1` @ `1f4d7e4ec80` (the pre-`main`-merge head) →
run `38771990229`: **18 success / 1 failure / 13 skipped**. Every TS bucket, both native-addon builds
(`Build native addons (bazel)` and the cross-target build), `Validate Rust workspace (bazel)` and
`Check MODULE.bazel.lock freshness` are green — i.e. the PR-path "environmental red" the playbook
describes disappears the moment the addon is source-matched. The single red is
`Test main workspace (zeta workbench)`: `crates/zeta-main/tests/web_subcommand.rs:267` panicked with
"stub did not answer for web" — in `main/`, which this branch never touches (no `main/` or `crates/`
file appears in the branch diff), so it is a workbench-suite flake rather than merge damage.

Re-dispatched on the final head (`c8df74aa84a`) as run `38779490653`: **same verdict — 1 failure, the
same `Test main workspace (zeta workbench)` job.** It is a load flake, confirmed three ways:
`git diff --name-only origin/main HEAD -- main/ crates/` is **empty** (the code under test is
byte-identical to `main`), the two **`pull_request` runs on that same head** (`38779332353`,
`38779333023`) both succeeded with that job green, and `main`'s own push run on `b580b1cbaa2`
(`38777161539`) is green. `workflow_dispatch` is the one event that *builds* the native addons
concurrently with the test jobs, and the failing assertion is a fixed-timeout HTTP probe against a
node stub (`http_status(web_port, "/__stop")`) — the sibling
`web_subcommand_runs_the_serve_machine_on_loopback` test stayed green in both dispatch runs.

## v18.10.0 incremental merge (Zeta — branch `sync/omp-release/v18.10.0`; merge commit `80ca49db8c7`)

- **Branch head at hand-off**: `652c1c16be1` (PR #200; an earlier hand-off head was `680c2145281`).
  `main` is fully contained (`git merge-base HEAD origin/main` == `origin/main`); below the head sit the merge
  itself (`80ca49db8c7`), the version/web-ui/lock follow-ups, three merges of `main` and the
  CI-driven fixes. The v18.10.0 tag commit is an ancestor of the head.
- **Final merge commit on `main`**: `1765251a473` — PR #200 merged 2026-10-15, parents
  `eb62e9c61c1` (main) + `652c1c16be1` (branch head), a real two-parent merge (no squash).
  Lineage re-checked on `main` **after** the merge:
  `git merge-base --is-ancestor b83200eb866821f02625332025b453f06ce4e12a HEAD` succeeds and
  `git merge-base --is-ancestor $(git rev-parse v18.10.0) HEAD` succeeds, so the complete upstream
  v18.10.0 release is in `main`'s history. The branch `sync/omp-release/v18.10.0` and its worktree
  are deleted after this record.
- **Baseline**: v18.9.2, integrated by PR #92 (`af624c160fe`; tag commit `bd4dffd5e617`).
- **Source tag**: `v18.10.0` → `b83200eb866821f02625332025b453f06ce4e12a`, a *lightweight* tag
  (no `refs/tags/v18.10.0^{}` peeled line is advertised). Verified with
  `git ls-remote --tags omp-upstream refs/tags/v18.10.0` **before** the merge and read
  back locally (`git rev-parse v18.10.0^{commit}`) — remote and local agree, so the tag
  was not moved. **Zeta starting commit**: `2291ae3dc80`.
- **Window**: upstream's own increment — the merge-base gate passed exactly
  (`git merge-base refs/heads/main b83200eb866 == bd4dffd5e617`), **22 commits / 143 files /
  +9278 −2845**, integrated as one real two-parent merge commit (no squash/rebase/cherry-pick).
- **Conflicts**: **43** (42 `UU`, 1 `UD` — upstream deleted
  `packages/coding-agent/test/stream/protocol.test.ts`; the deletion was accepted, its two
  remaining consumers import the live internal `src/stream/protocol`).
  The window is upstream's **IPC rework**: `IpcConnection`/`IpcServer`/`ipcEndpoint` from
  `pi-natives` replace every hand-rolled `node:net` socket + Windows named-pipe name
  computation (IDA hosts, daemon broker, LSP mux, text prediction, `stream`, collab
  discovery, local model workers), plus session/auth transfer commands, a machine-shared
  mnemopi embedding server, and `napi-rs` 3.14.2. Resolution rule: adopt upstream's shape,
  then re-apply the Zeta surface — scope **map** (`@oh-my-pi/pi-coding-agent`→`@linxiraos/zeta`,
  `omptype`→`pi-omptype`, `omp-stats`→`pi-stats`, `snapcompact`→`pi-snapcompact`),
  `__omp_worker_*`→`__zeta_worker_*`, `zetacode` for the CLI name, `.omp`→`.zeta` paths.
  Judgment calls: kept Zeta's `IDA_HOST_WORKER_ARG`/`setProcessName` spellings; kept
  Zeta's `CLI_SESSION` 4th argument while adopting upstream's new `forkIfMovedAway` wrapper
  (`main.ts`); kept Zeta's `#spawnBroker` stderr-tee in `launch/client.ts`; dropped Zeta's
  `resolveSocketEndpoint`/`lspMuxEndpoint` + `clearStaleSocket`/`probeSocket` helpers after
  grepping them to zero call sites (their helper constants were gone with upstream's block,
  so they could no longer compile).
- **⚠️ New damage mechanism found: the `zeta-package` merge driver silently deletes
  Zeta-only `package.json` keys.** `.gitattributes` maps root + `packages/*/package.json`
  to `merge=zeta-package` (`scripts/merge-package-json.ts`). Its `main()` starts from
  `result = { ...other }` (upstream wholesale) and only re-adds a fixed identity-field set,
  the dependency sections and `workspaces.catalog`, so **every Zeta-only top-level key is
  dropped on every merge**. Observed on this round (main → driver output):
  `workspaces.packages` `"plugins/*"` dropped; `packageManager` `bun@1.4.3` → `bun@>=1.4`;
  scripts `check:nix-bun`, `check:relay-assets`, `ci:release:publish-web-ui`,
  `ci:release:publish-plugin`, `gen:relay-assets`, `gen:brand-art` dropped;
  `devDependencies.figlet` dropped; `test:py`/`robomp:install` rewritten to the
  **non-existent** `sdk/python/omp-rpc`; the five exact catalog pins →
  upstream carets; all 12 `packages/*/package.json` `check:types` `tsc` → `tsgo`;
  `packages/mnemopi/package.json` description "Zeta agents" → "omp agents". All were
  resolved by hand to **Zeta main + the genuine upstream delta** (this window's entire
  upstream manifest delta is catalog version bumps + `bench:ipc` in `packages/natives`).
  This also explains the #189 finding that `packageManager` reverts to `bun@>=1.4` every
  merge (previously attributed to `fb4dcded44d` alone): the driver rewrites it each round.
  The driver fix is **not** in this PR (merge rounds and tooling fixes stay separate).
  **Update (same day): the driver was fixed on `main` by PR #203** — `a36353a4cab` "fix(tooling):
  make the zeta-package merge driver a real three-way merge", `e7c7b9b7517` (its three-way policy
  documented where it is bound), `4b9e6f18475` (incident corpus + driver-loss ledger checked in as
  `scripts/merge-package-json.test.ts` + `scripts/__fixtures__/package-json-merge/`) and
  `27293e4d494`/`7ea1b4f97cc` (the `__fixtures__` exemption those fixtures need). Merging `main`
  into this branch brought all of it in. The manifests hand-resolved in `80ca49db8c7` are unaffected
  (they were resolved by hand, not by the driver), and `check-package-json-merge` still reports `OK`
  on the merged tree — but every future round now goes through the three-way driver.
- **`web-ui/` deliberately untouched**: running the playbook's `bun scripts/set-version.ts 1.2.1`
  also bumps the standalone `web-ui/package.json` (`@linxiraos/zeta-web`) — it was at `1.1.5` on
  main. `check-version-consistency.ts` says why that is correct between releases ("web-ui/ is
  intentionally NOT checked: … between releases its manifest legitimately still carries the
  version it last published"), and the previous round (`af624c160fe`) did not touch it either.
  The bump was reverted so this round changes only the upstream integration and Zeta repair,
  not a release surface.
- **Regenerated**: `Cargo.lock` (3-way reconstructed with `git merge-file`; its 11 conflicts
  were all `1.2.1` vs `18.10.0` version lines, resolved to the Zeta line, while upstream's
  `napi 3.14.2` + `napi-build 2.6.0` bumps were kept), `packages/catalog/src/compat/rules.json`
  (`bun run gen:compat` — 999 rules / 21 classes / 87 catalog providers / 234 files),
  `MODULE.bazel.lock`, `bun.lock` (`bun install --frozen-lockfile` reported "no changes" —
  this window carried **no** dependency changes, since upstream's manifest delta is
  version-line only). The 5 upstream `## [18.10.0]` CHANGELOG sections were **folded into
  `[Unreleased]`** with Zeta spellings (released sections are immutable).
- **Checks**: see the PR body / round report. Version line 1.2.1 across 14 packages +
  13 catalog keys + Cargo + natives stamp + README badge + Cargo.lock members;
  `check:ts` 0 errors; `brand-check` 0 hits / 0 missing assertions (one rule retargeted:
  the tiny-worker banner *reader* moved from `tiny/title-client.ts` to
  `subprocess/shared-worker.ts` in this window and came back spelled `omp`);
  `check-zeta-sentinels` 104/104; `check-scope-imports` 18762 specifiers resolve;
  `check-ci-surface` 32 jobs; `check-local-ci-parity` OK; `cargo fmt --all --check` clean;
  `audit-merge-members` 0 dropped across 0 files; `check-i18n-consistency` 3219/3219/3219;
  `check-i18n-commands` 259 descriptions / 0 failures; `check-package-json-merge` OK.
- **CI validation (PR #200)**: `Check MODULE.bazel.lock freshness` needed the job's own refreshed
  artifact committed (`e585739726c` — the job uploads it precisely so a contributor without a working
  local bazel evaluation can do this). The other **9** red jobs are all one environmental cause: PR CI
  never builds a native addon — `Build linux-x64 native addons` is
  `if: github.event_name != 'pull_request'`, so the PR path only restores main's newest
  `actions/cache` entry (this run computed key `natives-linux-x64-v1-3301050ac9a9…` but restored
  `…eab5f724…`, `stamp unstamped`). Every failing call site is upstream's: **31/31** files'
  `ipcEndpoint`/`IpcConnection`/`IpcServer` lines are identical to `v18.10.0` after the documented
  scope/brand mapping, and `packages/natives/native/{index.js,index.d.ts,bench/ipc.ts,test/ipc.test.ts}`
  are byte-identical to upstream. The same failure reproduces locally with any addon built before the
  IPC work (the worktree's `.node` reports `ipcEndpoint: undefined`). So this window's runtime
  validation lands on main's push run, which does build the addon — as the workflow's own notice says
  ("Native changes are validated post-merge on main and at release"). Branch also merged `origin/main`
  (`23e88c5e59f`) after #199/#201/#202; that merge was clean.
- **Branch-dispatch validation — the recipe for this class (first instance)**: a `sync/omp-release/*`
  branch can get a source-matched addon from **neither** event: `native_addons`' build step is
  `if: github.event_name != 'pull_request'` (the PR path only *restores* main's newest `actions/cache`
  entry, via `restore-keys` prefix fallback), and `on.push.branches` is `[main, "dev/*"]`. A
  `MODULE.bazel.lock`-only push also produced no PR run (the `pull_request.paths` filter is evaluated
  per push). Verify by a manual dispatch on the branch ref:
  `gh workflow run ci.yml --ref sync/omp-release/v18.10.0` — the branch ref matches neither
  `case "${{ github.ref }}"` arm (`refs/tags/v*`, `refs/heads/main`), so `release_tag=""` →
  `is-release=false`, while `event_name=workflow_dispatch` ≠ `pull_request` makes `native_addons`
  **build**; `rust_validate` and `Build native addons (bazel, cross targets)` come along for free.
  Procedure is recorded in `document/merge-playbook.md` §"sync 分支的 native addon 真相"; it beats
  editing `ci.yml` because it is zero-CI-change, keeps the documented "no PR-side addon build" cost
  decision, and validates the branch *before* merge on main's own build path.
  - Dispatch `38699235676` @ `7dd14745fae`: **18 success / 1 failure**. Eight of the nine PR-path reds
    went green the moment the addon was source-matched, confirming the environmental diagnosis. The
    ninth exposed a **real defect**: upstream's new ask-hide test
    (`packages/tui/test/dialogs-native.test.ts`) asserts **upstream's** TUI role names
    (`omp.btn` / `omp.ask.options`) while `packages/tui/src` emits `zeta.*`, so `press("hide")` threw
    `no hide button`; `check:ts` cannot connect a role string in a test to the role a node is built with.
    Fixed in `65a13e09fb4` (literals → `zeta.*`), and the guard that should have caught it was extended:
    `brand-rules.ts`'s TUI-role alternation now includes `ask|btn` — it knew
    `composer|editor|working|queue|status|note|run`, which is exactly why `brand-check` stayed green while
    this shipped. Control: the extended needle flags the two pre-fix lines and 0 after.
  - Dispatch `38705037483` @ `65a13e09fb4`: **19/19 success** — the whole surface green against a
    source-matched addon, including `Validate Rust workspace (bazel)` and the cross-target addon build.
  - Then `main` advanced 10 commits (the real three-way `zeta-package` driver fix #203 + the fixtures
    guard note + roadmap); merged clean and re-dispatched:
    - Dispatch `38709164744` @ `c128458bd71`: **success** (all 19 non-skipped jobs).
    - Dispatch `38709556642` @ `42e2a2d6ba4` (the merged head, and the PR head):
      **19 success / 0 failure / 13 skipped** — the PR is green at its exact head against a
      source-matched addon.
- **Not verified on this host**: native addon build (no local `pi_natives.*.node`), so
  `gen:compat`/local test runs relied on a borrowed prebuilt addon that predates this window (it reports
  `ipcEndpoint: undefined`), and `cargo metadata` cannot resolve offline (`napi-build 2.6.0` is absent
  from the local registry cache). Both are covered by the branch-dispatch run above, which builds the
  addon and runs the Rust workspace.

## v18.9.2 incremental merge (Zeta — branch `sync/omp-release/v18.9.2`; merge commit `af624c160fe`)

- **Baseline**: v18.9.1, integrated by PR #91 (`d45b699092e`; tag commit `a4d6f0adc6`).
- **Source tag**: `v18.9.2` → `bd4dffd5e617ce732f8a14249b0be1e6c7621886`, a *lightweight* tag —
  verified with `git ls-remote --tags omp-upstream` before the fetch and read back locally
  (`git rev-parse v18.9.2^{commit}`) after it. **Zeta starting commit**: `d45b699092e`.
- **Window**: upstream's own increment (merge-base gate passed exactly: `git merge-base HEAD
  v18.9.2 == a4d6f0adc6`), 165 files, +5870 −972, one real two-parent merge commit
  (`af624c160fe` = `d45b699092e` + `bd4dffd5e61`).
- **Conflicts**: 38 (36 UU, 1 UD, 1 DU) — a third of v18.9.1's, because the 18.8.x–18.9.1
  brand sweeps had converged. Resolution: source and tests take upstream, then the Zeta
  surface is re-applied (scope mapping including the leaf renames, brand tokens, `.zeta`
  paths, backticked CLI references, `__omp_*` prelude globals). Judgment calls:
  - `README.md` (product front door) stays ours; `Dockerfile.robomp` keeps our base image
    and takes upstream's bun version (the container's bun is not the CI runtime pin).
  - upstream deleted `ai/judgment/typesafe.ts` (the judgment client is now `native.ts`) —
    deletion accepted, `UD` resolved by `git rm`.
  - `omp-protocol.ts` → `zeta-protocol.ts` was *re-ported* from upstream's new shape
    (contained-path resolution, docs disk-root probing, `promptDoc()` backed by
    `prompts/internal-urls/zeta.md`, a file we must create because an earlier round had
    deleted its upstream twin as an orphan). The `DU` test file became
    `test/internal-urls/zeta-protocol.test.ts` the same way.
  - upstream's `packages/tui/test/gc.ts` collects from a fresh timer callback, out of stale
    async stack frames — the real fix for the GC flake this project had tolerated with a
    3 s → 8 s deadline patch in #91. The patch is dropped in favour of upstream's file.
  - upstream 18.x CHANGELOG sections stripped from the seven package changelogs (they carry
    upstream's command spellings and are not our release history).
  - `packageManager` restored to the exact `bun@1.4.0` pin: upstream's `bun@>=1.4` range is
    rejected by `check-ci-surface` (`bun-pin-exact`) and would let CI fetch a newer bun than
    the tested runtime.
- **Regenerated**: compat `rules.json` (999 rules / 21 classes / 234 files, up from 991),
  rpc wire artifacts (`sdk/{python,rust,go}`), `bun.lock`. `gen:compat` needs the native
  addon (it loads `@linxiraos/pi-utils` → the natives loader); in a fresh worktree one can
  borrow a previously built `packages/natives/native/*.node` (gitignored) instead of
  rebuilding.
- **Checks**: `check:ts` 0 errors; tsc clean per package (ai, catalog, utils, agent, tui,
  mnemopi, coding-agent); `brand-check` 0 hits; Zeta sentinels 60/60; scope imports 18,556;
  version line 1.1.29; `check-ci-surface` 29 jobs; `check:tools` 0; `cargo fmt --all --check`
  clean (the window touched `crates/pi-edit` and `crates/pi-natives`).
- **Next merge**: starts from this round's final commit, at the then-current upstream tag.

## v18.9.1 incremental merge (Zeta — branch `sync/omp-release/v18.9.1`; merge commit `fb4dcded44d`)

- **Baseline**: v18.8.8 (peeled `1ca13863a828`; merge-base gate passed exactly, so
  the window is upstream's own increment: v18.8.9 → v18.9.0 → v18.9.1).
  **Source tag**: `v18.9.1` → `a4d6f0adc63dda4ccdf4d25c26422219820f865b`, a real
  two-parent `git merge v18.9.1` (no squash; lineage preserved).
- **Zeta start**: `509a5fa31a6` (main). **Final merge commit**: `fb4dcded44d`.
  Before push, main moved to `5bf080a4393` (PRs #89/#90) and was merged in
  (`54eb5d48b0b`) per the branch rule that an integration branch is never behind
  main.
- **Scale**: v18.8.8→v18.9.1 = 645 commits / 712 files / +66906 −9234 across three
  tags. Conflicts: **168 UU** (544 auto-merged). Unlike the v18.8.x rounds the
  conflicts were mostly *substance*, not identity — the brand sweep had already
  converged, so what disagreed was code.
- **Method**: shape-first classification per file, then the `packages/coding-agent`
  slice split three ways across parallel subagents (cli/update slice, misc slice,
  session/sdk/main slice) with the shared contracts fixed up front (scope names,
  `.zeta` dirs, Zeta-only members, the build-service cut). Upstream is the
  substance; the Zeta surface is re-applied on top.
- **Commercial-surface cut (maintainer instruction)**: upstream's
  build/distribution service is not merged. `cli/build-service.ts` + its test
  deleted; `cli/update-cli.ts` restored to our self-update path verbatim
  (upstream's only commits there were the migration itself and a CI fix, so
  nothing else was lost); `scripts/install.{sh,ps1}` and `ci-update-brew-formula`
  kept on our side. No `fetchBuild` / `PI_BUILD_URL` reference remains. The
  legacy upload tail (`Publish to build.stencil.so` + `scripts/ci-build-upload.ts`)
  was retired separately on 2026-10-14: the v1.2.1 run took a permanent HTTP 403
  there (the upstream build server only accepts can1357/stencil-hq repos, so this
  fork has no publish rights — damage class 11), and binaries ship in our own
  GitHub Release.
- **Relocations accepted**: `commit/cli.ts` → `commands/commit.ts` (no references
  on our side); `auto-thinking-bucket-question.md` →
  `prompts/judge/auto-thinking.json`.
- **Structural repairs (stage 2)**: `bun install`; `gen:compat` regenerated
  `catalog/src/compat/rules.json` from our `.kdl` (991 rules / 21 classes /
  86 catalog providers / 95 auth providers / 231 files) instead of keeping
  upstream's compiled blob; `gen:rpc` refreshed the SDK wire artifacts. The merge
  had overwritten our exact bun pin with upstream's floor (`bun@1.4.0` →
  `bun@>=1.4`) — `check-ci-surface`'s `bun-pin-exact` rule caught it (class 2).
  It also pulled 192 upstream `## [1x.y]` sections into our nine package
  CHANGELOGs — stripped (CHANGELOG is Zeta-owned; the version-line gate forbids
  them and requires `[Unreleased]`).
- **Brand overlay (stage 3)**: `brand-overlay.ts` rewrote its 7 files / 11 tokens;
  the rest was a rule-based sweep driven by `brand-check`'s own hit list —
  **859 → 0**. Classes worth naming: upstream scope leaks in auto-merged files and
  wholesale-taken tests (`@oh-my-pi/pi-catalog/...`), and `@oh-my-pi/omptype` →
  `@linxiraos/pi-omptype` (the class-3 rename that is *not* a plain scope swap);
  the cross-face env contract `PI_CODING_AGENT_DIR` → `ZETA_CODING_AGENT_DIR`
  (class 11 — `dirs.ts` reads only `ZETA_*`); `omp` CLI references in
  help/test/prose → `zetacode`; `.omp` fixtures → `.zeta`; relay daemon
  `omp.browser.relay.<port>` → `zeta.browser.relay.<port>`; TUI role
  `omp.run.status` → `zeta.run.status`; the macOS display-awake reason string.
- **Silent auto-merge mixes (this round's lesson)**: two files came out of
  conflict-free auto-merges with *semantically* mixed sides, and only `check:ts`
  saw them: (a) `slash-commands/builtin-completions.ts` kept upstream's raw
  `description: s.description` while our `SubcommandDef.description` is a thunk
  (`string | (() => string)`) — main's own pattern is
  `resolveCommandDescription(s.description)`, so the resolver was re-applied;
  (b) `sdk.ts` ended up with two `asyncJobManager` declarations (our sink block
  and upstream's options block) — upstream's duplicate removed. A third,
  different-shaped case: `session/agent-session.ts` got a duplicate type-import
  block because "take theirs" was applied next to an auto-merged copy of the same
  imports. Lesson: after resolving conflicts, run the *whole* gate — auto-merged
  files are not safe just because they have no markers.
- **Checks (local, all green)**: version line (1.1.29 — 13 packages + catalog keys +
  Cargo + main workspace + sentinel + desktop + README badge + BUILD.bazel + lock
  members); `bun run check:ts` zero errors (after the repairs below);
  `brand-check` 0 hits (859 → 0); `check-zeta-sentinels` (60 sentinels);
  `check-ci-surface` (29 jobs); `check-shared-infra` (15 endpoints / 4223 files);
  `check-merge-lineage --tag v18.9.1` → "lineage intact — safe to merge";
  `check-scope-imports` (new guard, 18,517 specifiers); `ci:test:smoke`
  (`zetacode stats --help` + `smoke-test: ok`); `bun install --frozen-lockfile`;
  `cargo fmt --all --check` clean.
- **Main's CI was red when this round started** (run `38152035457`, PR #90's merge;
  both jobs fail on main itself):
  1. `Validate Rust workspace (bazel)` → `Rustfmt`, `crates/pi-shell/src/shell.rs:5843`
     — introduced by main-side `0c58c560bbd`. This branch is fmt-clean, so the merge
     restores it.
  2. `Test coding-agent native/unit (TS)` chunk 87/93 —
     `test/utils/changelog.test.ts > parseChangelog > reads current source release data
     and filters versions newer than the previous release`. `packages/coding-agent/
     CHANGELOG.md` carried **two** `## [1.1.27]` headings, so the parsed list was not
     descending and "entries newer than entries[1]" came back empty. Main-side
     regression: the same duplicate was already fixed in the 1.1.28 round
     (`d2ba11788db`) and re-broken by a later merge. Fixed here by folding the second
     heading away without dropping a note (`e772c1628a2`, test now 17/17).
  - Maintainer decision (2026-10-12): **no separate main-fix PR** — both fixes ride
    the sync PR.
- **Local test failures are environmental, not merge damage** — each set was diffed
  against the same command on the base tree and matches name-for-name:
  `packages/utils` `ensureRuntimeInstalled` lock tests (4; `EPERM: failed copying
  files from cache … omp-runtime-fixture`, a Windows cache-copy issue);
  `packages/natives` DesktopSession (5; no desktop capture on Windows) plus one
  grep-concurrency timing test; `packages/coding-agent` ModelRegistry compat (3;
  path rendering in the warning differs from the fixture). Main's Linux CI shows
  those buckets green, which is why they are local-only.
- **PR #91 CI round (2026-10-12)**: the first hosted run (`38188714802`) surfaced
  five families, each an upstream contract imported without its Zeta counterpart
  (fixed in `92b3476e27a`):
  1. **TUI roles** — upstream's `composer-native`/`transcript-committed-release`
     tests assert `omp.composer.*`/`omp.editor.*`/`omp.working.*`/`omp.queue.*`/
     `omp.status`/`omp.note` while the sources emit `zeta.*` (main's copies are
     branded); `notifications.test.ts` asserted the OSC 99 probe id `i=omp-probe-`
     and app field `f=b21w` against a source emitting `zeta-probe-`/`emV0YQ==`.
     Swept both to the Zeta shapes and widened the brand rules from the
     `composer\.chips?|run` alternation to the whole role namespace plus those two
     OSC tokens (`scripts/brand/brand-rules.ts`), so a future merge re-importing
     them fails `brand-check` instead of hosted CI.
  2. **`scripts/ci-test-ts.ts`** — upstream inlined `selectShard` without `export`;
     our `ci-test-ts.test.ts` imports it (main exports it) → export restored.
  3. **i18n** — upstream's new `/fork pane|window|tab` descriptions were hardcoded
     English, and the `cmdFork` catalogue key had become orphaned when upstream
     rewrote the command's text. Wired all four to `M.cmdFork*`, updated the
     orphaned en text and added the zh catalogue.
  4. **settings zh** — upstream's new `retry.fallbackOn` had no zh label, failing
     the settings-completeness assertion; label + description added to
     `config/settings-zh.ts`.
  5. **Native windowing — by design, not damage** — the two long-line tests need
     v18.9.1's `window_matched_line`, but a `pull_request` run never builds addons:
     `ci.yml` `native_addons` restores main's cache (its key includes `crates/**`,
     so a native-changing PR always misses) or falls back to the npm leaf, and says
     "Native changes are validated post-merge on main and at release". Rather than
     weaken the tests, they now probe the loaded addon for windowing (`column` on a
     truncated match) and `skipIf` — they run wherever the addon is source-matched
     (main, release, and PRs after main caches the merged crates) and skip with the
     same rationale the workflow documents. Local confirmations for this round:
     version line 1.1.29, `brand-check` 0 hits under the widened rules,
     `check-scope-imports` 18,518 specifiers, `check-zeta-sentinels` 60;
     `check:ts` and the test buckets stay with hosted CI per the maintainer's
     no-local-build instruction.
- **PR #91 CI round, second pass (run `38192024959`)**: four more families, same
  class of half-swept contract:
  1. **Runtime globals** — the merge swept the producer side but left fixtures (and
     one consumer) on the upstream spelling: `computer.test.ts` still passed
     `__omp_prelude__`/`__omp_display__` (5+5) and its facade case asserted
     `__omp_fn`/`__omp_re` against sources emitting `__zeta_*`; `prelude-agent`
     still installed `__omp_helpers__` in its artifact helper while the prelude
     reads `__zeta_helpers__`. Worse, `runner.py` injected the run-id getter as
     `__omp_current_run_id__` while `prelude.py` looks up
     `__zeta_current_run_id__` — a **silent** degrade the fallback to
     `__zeta_run_id__` masked. All aligned to the `__zeta_*` names the sources
     define; `brand-rules` now pins that list (and explicitly keeps the internal
     protocol markers `__omp_with_call_site__`/`__omp_tool_bridge__`/
     `__omp_final_expr__`/`mcp__omp__*` upstream-shaped).
  2. **settings zh, again** — `composer.predictions` and `contextFiles.extra` had
     no zh label; the assertion stops at the first, so a throwaway audit over
     `createSettingsHost()` (429 entries) was used to enumerate all of them
     instead of iterating CI runs; both added, audit now 0 violations.
  3. **Relay version fixtures** — upstream's fixtures hardcoded `18.0.0`/`18.5.1`
     as "older"; `isOlderRelayVersion` compares with `Bun.semver.order` against
     `VERSION`, so on the 1.x line they read as *newer*, every older-relay case
     inverted to "kept", and the run then connected puppeteer to a stand-in
     without `webSocketDebuggerUrl` (Bun: "Invalid url for WebSocket undefined").
     Fixed with a line-agnostic `OLDER_RELAY_VERSION` in both relay tests and a
     brand rule against `ompRelayVersion: "18.`/`restartOwned("18.`.
  4. **`browser-tab-worker-startup` inline-cancel case** — source is
     upstream-identical (branding-only diffs) and the case **passes locally** on
     Windows/Chrome; it races crash detection against the run's 2 s timer, so a
     slow runner loses it deterministically. Handled as the repo already handles
     timing reds (re-run decides, no test edit) — recorded here because it is the
     one family this round did not fix by code.
  Local verification before the maintainer's stop-local-runs instruction:
  `prelude-agent` + `browser-relay-probe` 30/30, `computer` 57/57, both i18n
  suites 11/11; `browser-relay-daemon` and `python-tool-bridge` were left to CI.
  `brand-check` stays 0 under the two new rules.
- **PR #91 CI round, third pass (run `38196263375`) and its two fixes**: `Lint` went green (the
  `Messages` keys) and the tui GC cases passed, confirming them as load-sensitive
  flakes. Three families left, two of them ours to fix:
  1. **`scripts/ci-test-ts.ts` lost `export` on `runTestCommandsInParallel`** —
     same shape as `selectShard`. Our runner-watchdog test imports it from inside a
     template string, so `check:ts` cannot see it: the child died at import (exit 1,
     empty stdout) and only the runtime assertion caught it. Restored from `main`
     (line 782).
  2. **`Messages` interface** — `en.ts`/`zh.ts` are annotated with it, so the new
     `/fork` keys needed it too (TS2353 + a TS2339 at every `M.cmdFork*`).
  3. **Importing the runner ran the whole suite (class 4: dropped Zeta-only code)** —
     this test file is Zeta's (upstream v18.9.1 ships none), and on `main`
     `scripts/ci-test-ts.ts` guards its main body with `if (import.meta.main)`;
     upstream's copy runs that body unconditionally, so the merge dropped the guard
     and *importing* the module — which `ci-test-ts.test.ts` does for `selectShard`
     and the watchdog child does for `runTestCommandsInParallel` — executed the whole
     suite, inheriting the test's `OMP_TEST_CHUNK_TIMEOUT=1`: every chunk killed after
     one second, a child that never finished (the 45 s timeouts) and, worse, a second
     full run competing with the job's own chunks. That last part is what produced
     the "silent exit 1" chunk and aggravated the tui GC cases, i.e. the reds this
     round kept attributing to flakes. Guard restored around upstream's body.
     The diagnostics path also stopped using `Bun.spawnSync` for `ps`/`ss` and is now
     abandoned after `SNAPSHOT_BUDGET_MS`: hardening found on the way, not the cause
     the earlier rounds suspected.
  4. **`browser-tab-worker-startup` crash cases** (ours to tolerate, not to weaken):
     the inline-run case is a pure detection-latency race — `#unanswered` is set
     for the whole run, so `#onPageCrashed` does abort the run's signal, just later
     than the fixture's 2 s window on a loaded runner (the caller's crash error did
     arrive, so the abort path ran). Its window is now `LEFT_GOING_WINDOW_MS` (8 s)
     with the run budget and post-sleep derived from it. The released-tab case polls
     `Target.getTargets` for up to 7 s instead of reading once, because the release
     closes the crashed page through a 5 s bounded close; a page that is *never*
     closed still fails.
  5. **The CLI's own name swept to the workbench's (half-sweep)** — once item 3's
     guard stopped masking failures, the only red left was two cases in
     `test/executable-fallback.test.ts`. Upstream's fixture wrote `omp` for the CLI it
     resolves on PATH; our sweep wrote bare `zeta`, matching `worker-client.ts`'s
     pre-existing `$which("zeta")`. In Zeta a bare `zeta` is the suite-index bin
     (`@linxiraos/main`, which prints the help rather than opening the workbench), so
     an upgrade that left `process.execPath` stale would have
     run the index entry, not the CLI. The source resolves `CLI_BIN_NAME` now and the
     fixtures follow it (`CLI_BIN_NAME`; `VERSION` for the cellar path — pinning the
     literal would re-pin the bug). Same residue in `test/cli/completions.test.ts`
     (`bin: "zeta"`) and `test/update-cli.test.ts` (`npm\zeta.cmd` in a file that
     already used `zetacode.*` everywhere else). Two brand rules now hold the line:
     `$which("zeta")` and bare `zeta.cmd|ps1`.
  6. **Two more half-sweeps in `test/cli/completions.test.ts`** (found by clearing item 5):
     three synthetic `CompletionSpec` fixtures still said `bin: "zeta"` while the file's live
     path already used `CLI_BIN_NAME`, and seven assertions hardcoded the swept name — one of
     them (`complete -F _omp zeta`) was passing on a *prefix* coincidence once the fixture
     became `zetacode`. Fixtures and assertions now both use `CLI_BIN_NAME`.
     Its sibling in the tui bucket is not merge damage: `becomesCollectible` polls
     `Bun.gc(true)` under `--parallel=2`, and the same code passed in two runs and failed in
     three, so the deadline went 3 s → 8 s: a pinned target still fails, just later.
     The template literals that fix introduced were not formatter-clean, which `check:tools`
     caught as an `oxfmt --check` failure naming the file; `bun run fmt:tools` reflowed them.
  7. **The completion script's own function names were never swept** (maintainer decision,
     2026-10-12): `completion-gen.ts` emits shell helpers into the user's shell — `_omp()`,
     `complete -F _omp <bin>`, `compdef _omp <bin>`, `_omp_comma`, `_omp_call`,
     `__fish_omp_no_subcommand` — and every one carried upstream's brand. They survived an
     earlier branding pass on main, so this is not merge damage, but it is user-visible;
     swept to `_zeta*` across the generator and its test. The brand rule pins only the
     emitted shapes: `_omp/…` ACP extMethod names, `_omp_prelude` and the `_omp_ida_stub`
     test module are upstream protocol/private names and stay. The first pass used
     `(?<![_\w])_omp_` for *both* the replacement and the check, so `\n\t\t\t_omp_comma`-style
     sites (literal backslash + `t` before the underscore) were filtered out on both sides:
     the check reported 0 while four remained, and hosted CI named
     `completions.test.ts:69`. Re-swept with plain substrings, and the guard was de-blinded
     and confirmed against those four before clearing them — 结论 28 in the playbook.
  8. **A chunk that exits nonzero on a clean summary is judged by bun's summary** — the
     coding-agent native bucket's `test/cli` chunk ran its whole suite (`66 pass / 2 skip /
     0 fail / 216 expect() calls`, `Ran 68 tests across 10 files`) and exited 1 with nothing
     else printed. Three consecutive attempts did the same, so the retry added in the
     previous round only paid the cost three times. The cause is process-level: a CLI
     command run in process sets `process.exitCode` to report a status, a test asserts that
     value and does not always put it back, and the runner inherits it. `bun test`'s summary
     is the authority on test results, so a nonzero exit on a *complete* summary carrying
     `0 fail`, no `(fail)` marker and no `error:` block is counted as passed — said so in
     the progress line (`exit N on a clean summary`) — while anything else stays red. Two
     cases in `scripts/ci-test-ts.test.ts` pin both directions, because "the summary
     decides" is only safe if a reported failure still fails.
  The reds this list could not explain were item 3's: the rerun carrying its guard fix
  (`2672871f63e`) failed exactly two tests — both `executable-fallback.test.ts` (item 5)
  — with `Test TS workspace fast` green, and the native/unit chunk that had died
  silently ran `66 pass / 0 fail` in the same job. Neither was a process-level flake;
  both were the runaway suite competing with their own job.
- **What made the missing guard visible**: the harness now says when it had to
  cancel a chunk's pipes (a descendant outlived the chunk and kept them open, and
  cancelling discards what is still buffered — which is why such a failure reports
  nothing at all and reads as a silent `exit 1`), and the runner-watchdog test
  mirrors the child's stdout into a file so a timed-out `ptree.exec` (which throws
  with a message only) can still be diagnosed. The file is what showed the child
  running the *coding-agent bucket* instead of the two commands it was given.
  The same two diagnostics exposed item 5: `worker-client.ts` resolved the CLI on PATH
  as `$which("zeta")` (a pre-existing Zeta divergence) and the merged upstream fixture
  pinned that. It now resolves `CLI_BIN_NAME` (`zetacode`), guarded in `brand-rules.ts`
  together with the shim names.
- **Next merge**: starts from this round's final commit. Upstream's next tag is
  `v18.9.2` (`bd4dffd5e617ce732f8a14249b0be1e6c7621886`; fetched and verified — the
  pure window is 166 commits / 165 files / +5870 −972). Maintainer decision
  (2026-10-12): a **separate round** after this one lands, not chained onto this
  branch — one tag per round keeps the review surface and the conflict count small.

## v18.8.8 incremental merge (Zeta — branch `sync/omp-release/v18.8.7`; the merge commit itself is titled `sync/omp-release/v18.8.8`)

- **Baseline**: v18.8.7 (peeled `f261ed9faf16`; merge-base gate passed exactly,
  so the window is upstream's own increment). **Source tag**: `v18.8.8` →
  `1ca13863a828`, a real two-parent `git merge v18.8.8`.
- **Zeta start**: `9362fef9d66` (the v18.8.7 merge). **Final merge commit**:
  `110331518bc` (two parents: `9362fef9d66` + `1ca13863a828`).
- **Scale**: v18.8.7→v18.8.8 = 173 files / +10891 −2435. Conflicts: **32 UU**
  (116 files auto-merged) — a fifth of the previous round's 100, because the
  brand sweep had already landed and there was less identity left to disagree
  about.
- **Method**: the same shape-first classification as v18.8.7. 23 of the 32
  conflicts were generated files (`bun.lock`, `Cargo.lock` — taken from upstream
  and regenerated) or pure scope renames; the rest took upstream's shape and were
  then run through the brand overlay.
- **The agent-session near-miss** (the substantive lesson of this round):
  taking upstream's `session/agent-session.ts` wholesale silently removed **45**
  members — the entire mode API (`ModeId` / `enterMode` / `exitMode` /
  `enterPlanMode` / `getPlanFileContent` …), `setIrcAutoReplyListener`,
  `setThinkToolEnabled`, and the title-fork state helpers. AGENTS damage class 4.
  Restoring them took three attempts, and the first two failed instructively:
  - Re-inserting the members by hand compiled no better than not restoring
    them, because each closes over private fields (`#planModePreviousTools`,
    `#applyPlanModeModel`, …) that were deleted in the same 862-line removal.
    Methods and their state have to move together.
  - A three-way merge naming **v18.8.7 as the base** was worse than useless: it
    reported "0 conflicts" while deleting the mode API, because that API never
    existed upstream, so declaring v18.8.7 the base *is* a declaration that those
    members were deleted. A clean conflict count is not evidence of a clean merge.
  - What worked was applying upstream's **increment** (`git diff v18.8.7 v18.8.8`,
    12 hunks / +129 −21) onto our own file with `git apply --3way`. One conflict
    remained, brand-only. The mode API and upstream's new title subsystem both
    survived.
  The loss audit from the previous round paid for itself here: the before/after
  member diff over 2633 modules is what made "45 members gone" visible at all.
  `check:ts` alone reported four unrelated-looking errors.
- **Encoding hazard**: `git merge-file` on this path reports "Cannot merge binary
  files" because PowerShell's `>` redirect had re-encoded the working copy as
  UTF-16 (578919 NUL bytes). Read and write blobs through node's `fs` with
  explicit utf8, or take them straight from the git object store — a shell
  redirect is enough to corrupt a source file mid-merge.
- **Brand overlay**: scope rewritten across 36 files (+226 imports), then 47
  `omp` identity hits re-applied by category. Beyond the usual command/prose/path
  split, this round turned up a `".omp": true` entry in
  `session-anonymizer.ts`'s bundle-exclusion list — our config directory had
  silently stopped being excluded from anonymized shares, so `.zeta` replaced it.
- **TUI role identifiers are a cross-face contract with no user-visible spelling.**
  Upstream's v18.8.8 rewrite of \	ui/src/tools/native-view.ts\ brought its own
  \omp.tool.file\ / \omp.tool.error\ role names back in the source while the
  tests kept asserting \zeta.tool.*\. Three views rendered zero nodes and the
  assertions reported a bare length mismatch with nothing pointing at the cause.
  Neither overlay layer can see this: the scope overlay keys on imports, the
  identity overlay on user-visible strings, and a role id is an internal token
  with no spelling a user would ever read. **46 role identifiers across 6 files**
  were rewritten \omp.<ns>.\ -> \zeta.<ns>.\ by hand. If a future merge touches
  \packages/tui/src/**\, check the role names against the tests before trusting
  a green type check — nothing in the type system connects the two.
- **CHANGELOG**: **53** entries folded into `[Unreleased]` from the tag-to-tag
  diff. The package list is derived from the diff rather than hardcoded: this
  round added `packages/wire` and `packages/browser-relay`, and a hand-written
  list goes stale exactly when a new CHANGELOG appears — which is when the
  version gate starts failing.
- **The title subsystem had to be replaced, not merged (found by CI).**
  Upstream's `579da1d661c` (v18.8.7) rebuilt auto-titling around a reply-gated
  `#maybeStartTitle` and removed the `maybeStartTitleGeneration` entry point along
  with its input-controller, CLI bootstrap and skill-dispatch callers. Both sync
  rounds took `agent-session.ts` wholesale and removed the new generation while
  leaving its *configuration* side intact — `autoTitle?: boolean` in
  `agent-session-types.ts`, the newer `runEphemeralTurn` shape, and tests written
  against `autoTitle: true`. The file compiled and then timed out on every title
  test, because nothing started a title.
  The two generations collide by name with different signatures
  (`#titleWithTitleModel` takes three arguments here, one upstream), so they cannot
  coexist. The mechanism was replaced wholesale: implementation block, private
  state, the streaming-handler gate and the prompt-submit hook, all from the tag.
  `skillPromptTitleInput` went with it — it does not exist upstream any more, the
  skill chip now reaching the title through `#noteTitleInput` like any other
  operator message. Kept: the deferred-title word count at `message_end`, the mode
  API, every other Zeta-only surface.
  The Zeta-only CLI-level coverage went with the old generation as well:
  `main-initial-message-title.test.ts` stubbed `prompt()` and asserted that a
  caller triggered titling — exactly the seam this replacement deletes — so the test
  and its `cli-initial-title-probe.ts` fixture are removed rather than re-pinned.
  `main.ts` still dispatches the positional message into `session.prompt` (line 787),
  which is what feeds `#noteTitleInput`, and the stream-derived behaviour is covered
  by `agent-session-title-fork.test.ts` over a mocked model.
  Worth recording as process: the member-loss audit run with `--base v18.8.8` is
  what surfaced this. `check:ts` reported four unrelated-looking errors, and the
  failure only became legible as "five title members are gone" once the audit
  named them. Two earlier attempts to patch the loss in place failed for the same
  reason the mode API did — the methods and their state are one unit.

- **Gates at handoff**: `check:ts` ✅ 0 errors · `brand-check` ✅ 0 hits ·
  `check-zeta-sentinels` ✅ · `check-version-consistency` ✅ ·
  `check-ci-surface` ✅ · `check-merge-lineage` ✅ · `cargo fmt --all --check` ✅ ·
  conflict markers 0 · member-loss audit 0 (bar one known false positive).

## v18.8.7 + v18.8.8 post-merge repair pass (Zeta — branch `sync/omp-release/v18.8.7`, 2026-10-11)

Both tag merges are correct at the *window* level (base `153b37c3b65b`, SHA-verified;
merge-base gate exact for each), but the conflict resolution left damage that only CI
plus a pre-merge worktree comparison made visible. Recorded because every class here
recurs on every sync.

- **The bulk scans were green while the failures were live.** A whole-window
  added-line scan (upstream `v18.8.4→v18.8.8` lines present in HEAD) reports 0 files
  missing upstream's increment. The member audit used to be quoted here as a second
  green (`0 dropped members`); that number carried no information — until
  2026-10-15 the auditor was a no-op that printed `0 member(s) dropped` for *every*
  input (see the guard-matrix note in `document/merge-review.md`), so the losses
  below are attested by the added-line scan and the hand-resolved file ledger alone,
  not by it. The losses are *individual hunks inside otherwise-present files* —
  invisible to a whole-window scan either way; re-run the fixed auditor
  (`bun scripts/audit-merge-members.ts --base <pre-merge-ref>`) on that window if
  the member-level answer is ever needed.

- **Class 1 — brand surface reverted (195 sites), overlay rules too narrow.**
  `docs/context-files.md` + `docs/environment-variables.md` reverted wholesale to
  `.omp` / `~/.omp` / `PI_CODING_AGENT_DIR`; `agentInfo.name/title = "omp"`;
  `` `${CLI_BIN_NAME} update` `` → `"omp update"`; TUI role ids `omp.composer.chip`
  and `omp.run.status` (the class with no user-visible spelling that no overlay layer
  keys on); `omp.browser.relay`; `.omp-tmp.`; `omp-plugins` provider comments;
  `__omp_funcs` in `shell-snapshot-fn-env.sh` piped into the still-`__zeta_*` helper
  (broken, not cosmetic). Repair: restore the pre-merge spelling per file, then 21
  `MUST_NOT_CONTAIN` + 6 `MUST_CONTAIN` rules in `scripts/brand/brand-rules.ts`.
  Detector added: `scripts/scan-brand-regressions.ts --base <pre-merge-ref>`.

- **Class 2 — individual upstream hunks dropped in conflict resolution.** Found by
  running each failing suite against a pre-merge worktree (`temp/base` at the branch
  base): `event-controller.ts` lost the whole OSC-7501 run-status wiring
  (`setRunStatus` ×5 + `#settledRunStatus`); `agent-session.ts` lost the
  `#flushPendingAgentEnd` guard move; `model-registry.ts` lost the
  `#mergeResolvedModels` identity-preserving early return (the WeakMap window tiers
  hang off it); the merge pasted upstream's duplicate `it()` block into
  `legacy-pi-bundled-subpath-overrides.test.ts`. Method per the playbook: apply
  upstream's increment (`git diff <prev-tag> <tag> -- <file>`) onto our file — never a
  wholesale take. `test/fixtures/cli-initial-title-probe.ts` was deleted by the merge
  while its Zeta test survived (modify/delete asymmetry) — restored, and then deleted
  again together with `main-initial-message-title.test.ts`: both belonged to the old
  title generation's caller-side entry point, which the subsystem replacement above
  removes (see the title paragraph under Decisions). The behaviour they covered —
  a positional CLI message ending up titled — now runs through `#noteTitleInput` on
  the real event stream and is what `agent-session-title-fork.test.ts` exercises.

- **Class 3 — generated files taken from upstream.** `bun.lock` was upstream's
  (workspace named `omp`, dependency versions downgraded below the pinned ones) and
  `MODULE.bazel.lock` was stale after the `Cargo.lock` re-pin. Both are ours:
  `bun.lock` restored to the pre-merge bytes, `MODULE.bazel.lock` re-taken from the CI
  freshness job's uploaded artifact.

- **AST/TTSR cluster: PR-environmental ∩ real defect.** `ci.yml` gates
  `Build linux-x64 native addons` to `github.event_name != 'pull_request'`, so PR runs
  test against main's addon, which lacks this merge's new `wasmGrammarFor` /
  `__ompSetGrammarDir` exports. The real defect was that `ensureGrammar()` treated the
  absent export as fatal, killing every AST path (TTSR, `ast_grep`, read-summary) on
  such an addon; it is now a capability probe, matching the contract pinned by
  `packages/natives/test/stale-addon-export.test.ts`. A self-built addon is unaffected.
  The same policy explains this round's `json-query` red — main's cached addon carries
  main's jaq 2.3.0 port, which stops at a failing input, while the branch ships the
  jaq 3.1.1 port that continues (see the CI-triage round below). The operative detail is
  the cache step: on a pull request `natives-cache` restores with
  `restore-keys: natives-linux-x64-v1-`, so an exact-key miss still lands on whatever
  `v1-` entry main saved (here: one created 2026-10-09), and a non-empty
  `cache-matched-key` also skips the npm fallback. A push builds instead, which is why
  the merged `main` run is the one that reflects the tree.

- **CI guard repaired.** `check-merge-lineage.ts` failed on every PR run
  ("v18.8.8 does not resolve locally") because the PR checkout is shallow and has no
  `omp-upstream` remote; the step now unshallows and fetches the ledger's
  `Integrated through` tag.

- **Gates after the repair**: `check:ts` ✅ 0 · `brand-check` ✅ 0 ·
  `check-zeta-sentinels` ✅ · `check-version-consistency` ✅ · `check-ci-surface` ✅ ·
  `check-merge-lineage` ✅ · `cargo fmt --all --check` ✅ · member-loss audit 0 · the
  eleven suites the merge reddened are green (117 + 63 tests). The `/tmp`-backed title
  probe restored in that round was deleted again on 2026-10-11 together with its test:
  the new reply-gated title generator removed the caller-side entry point they drove
  (see Class 2 above). Next sync target is `v18.8.9` (`fa5ff4a3a977`, 58 commits /
  124 files from v18.8.8).

### Post-repair audit pass (2026-10-11, same branch)

Three audit sweeps ran against the repaired tree. Each found live damage the
gates could not see, and each is now fixed:

- **i18n**: the v18.8.8 merge reverted 53 slash-command descriptions in
  `builtin-session.ts` from `() => M.cmd*` thunks back to static English
  (`110331518bc^` had 0 static sites, the merge left 56, three were repaired at
  the time); 46 more static descriptions in `builtin-lifecycle.ts` were
  pre-existing. The TUI settings panel resolved `ZH_OPTION_TEXTS[option.value]`
  while every overlay key is `path::value`, so 574 of 750 option labels were dead
  in zh mode, and the persisted `language` setting was never consulted at startup
  (`registerLanguageConfigOverride` had no caller). `check-i18n-commands.ts`
  99 failures → 0; catalogues verified 1:1 at 3167 keys.
- **tracking** (Zeta-only, upstream-absent): `tracking_update` was never gated on
  `tracking.enabled` (`isToolAllowed` fell through to `true`) and the setting had
  no `SETTINGS_SCHEMA` twin, so `getPathsForTab` never returned it and the web
  dock entry could never appear; the panel's Plans tab rendered `data.sessions`.
  An end-to-end probe (sandbox HOME + project) proves the tool writes
  `INDEX.md`/`status.json`/`actions.jsonl`/`sessions/`/`summaries/`/`plans/`, the
  gateway reads every family, and the SSE `tracking_changed` fires on write.
  Sentinels extended to 60 so the upstream-owned halves (`tools/index.ts`,
  `todo-tracker`, `prewalk`, `plan-mode-approved.md`, `web-gateway.ts`,
  `settings-schema.ts`) cannot be dropped by a later merge.
- **brand/compat**: rules corrupted by an earlier sweep were restored — AGENTS.md
  and `merge-playbook.md` carried `.zeta` on *both* sides of the "no
  compatibility surface" rule, making it self-nullifying. The packaged `docs/`
  corpus's CLI references were fixed (`cli-reference`, `stream`, `settings`),
  along with the bare `"omp"` identity literals in `commands/anonymize`,
  `commands/auth-broker` (help usage line), `tools/ask` and `debug`
  notifications, the TUI settings overlay title, and the session anonymizer's
  program/scheme tables.
- **Still open (reported, not fixed)**: the headless CLI (`src/cli/**`) has no
  i18n imports at all, so `--help` is English-only by construction; hardcoded
  Chinese without a language guard in `/tracking` output, IM channel replies,
  `PLAN_APPROVAL_INSTRUCTIONS` and two gateway error strings; `docs/` remains a
  brand-check blind spot (`SKIP_PREFIXES` skips the packaged corpus, so product
  prose such as `docs/stream.md` "your omp sessions" survives), which needs a
  scoped docs rule rather than the whole-tree one; tracking has lock-free
  read-modify-write of `status.json` and the global index, an unbounded
  `actions.jsonl`, and a `summaries/` family that no panel tab renders.
- **Agent images did not reach the web conversation — fixed in this round.**
  Screenshots (computer-use, browser, `read` of an image file) become inline image
  blocks and render in the terminal (kitty/iTerm2/SIXEL, 8-image inline budget,
  text fallback). The gateway's SSE stream forwarded them live, but the web-ui's
  transcript reload asks for `deferMedia=1`, and `omitToolResultBase64Images`
  replaced every tool-result image with `[N tool result images omitted …]`;
  `session_entry` then triggered that refetch, so the live image was clobbered.
  The gateway now rewrites such a payload to the blob URL it already has
  (`/api/blobs/<sha256>`, the bytes persistence externalized, inline when the
  blob is absent or the payload is below the threshold), the blob route reports
  the real image type instead of `application/octet-stream`, `MessageView` renders
  both the assistant-native and tool-result arms (visible while the tool block is
  collapsed, matching the TUI, which gates on the terminal protocol rather than
  expansion), and the web-ui origin proxies `/api/blobs` in the `next dev` /
  standalone topology (`zetacode serve` already routes `/api/*` to the gateway).
- **Upstream identity literals cut.** Several protocol-identity strings still named
  upstream. The Codex OAuth `originator` in `compat/rules/auth/openai-codex.kdl`
  contradicted the value every API request header and the browser-login default
  already send (`OPENAI_HEADER_VALUES.ORIGINATOR_CODEX` = "zeta"); the DAP
  `clientID`/`clientName`, the bug-report `agent.name`, the Hindsight
  `DEFAULT_BANK_NAME`, the RPC-wire schema `$id` and the browser-relay manifest
  carried it too, and are now the Zeta identity (the bank rename costs recall
  continuity for old default-bank memories — migration note in `docs/memory.md`).
  The web panel's skill install was worse off: it passed `--agent omp`, which the
  third-party `skills` CLI rejects (`Invalid agents: omp`, installing nothing).
  It now sends `SKILLS_CLI_AGENT` (`pi`), whose layout is `.agents/skills` — the
  directory our `agents` skill provider and `.skill-lock.json` reader use. Eight
  `MUST_CONTAIN` rules pin the new forms so a merge cannot revert them.
- **Local CI**: the Gitea mirror's runs 520–535 all died before any test ran —
  first a missing `actions/checkout`, then repeated NAS→github.com failures
  (`curl: (56)` on a release asset; `TLS handshake timeout` fetching the action
  itself). The workflow now clones from the Gitea remote (no action download) and
  retries every toolchain download; the cold-bootstrap timeout was raised to 120
  minutes. Run 535 then reached `Install workspace dependencies` and died at
  `bun: command not found` (exit 127): `PATH_EXTRA` lands in `GITHUB_ENV`, which
  carries *variables* only, and the toolchains job was the one job without the
  `Toolchain PATH` step that every downstream job has — its own later steps
  (including that install) saw no toolchain. Bootstrap now also appends the
  PATH to `GITHUB_PATH`, which applies to the same job's later steps.
- **CI-triage round (same branch)**: two merged-test failures were real product
  damage, not environment.
  - `test/run-status.test.ts` (upstream's OSC 7501 suite, merged intact) asserted
    `app=omp` ten times while `src/utils/run-status.ts` emits `:app=${APP_NAME}`
    (`zeta`). The **test** was the stale face — upstream identity inside a
    third-party terminal protocol — so it was adapted to `app=zeta`; the
    implementation now carries a `MUST_CONTAIN` pin plus an `app=omp`
    `MUST_NOT_CONTAIN` twin (class-11 cross-face pair). 5/5 green after.
  - `test/tools/json-query.test.ts` "reports a line that fails mid-file
    alongside the other lines' results": `runJq` threw whenever the callback
    reported an error, so a single failing input inside the file aborted the
    whole query instead of surfacing `[jq stderr: …]` ahead of the surviving
    values (the shape the merged test and `withStderr` both specify). The throw
    is now limited to runs that produced **no** output (compile/usage/transport
    errors). A remaining red in that file on a *local* run is the stale native
    addon (the shell's bundled jaq is Rust-side) — and the *reason* it is stale on a
    PR was misread here first: `Build native addons (bazel)` does run and succeed on
    the PR, but the test jobs do not consume that build. `native_addons`'s cache key
    is deliberately event-independent ("PRs look up the entry main saved for the same
    inputs"), so on GitHub-hosted runners a PR restores **main's** cached addon. The
    local addon reports `jaq 2.3.0` (main's port) while this branch's source is the
    jaq 3.1.1 port, and 2.3.0 stops at a failing input — the exact PR failure. Settled
    2026-10-11 by running the port's own tests in WSL against the branch source:
    `cargo test -p pi-builtins --lib jq::tests::error_in_one_input` → both the stdin
    and the file-operand case pass (the file case is new this round: `2\n4\n`, the
    stderr report, exit 0). The `json-query` red is therefore PR-environmental, not
    product damage. The bucket reds that *are* baseline (`packages/ai` TextJudge,
    `session-storage-fd-inheritance`) are red on `main` itself, which is the real
    baseline to compare against.
  - Also fixed from the CI log: an oxfmt miss in `blobs.test.ts` and an unused
    `APP_NAME` import in `slash-commands/builtin-collaboration.ts` — the
    `check` job was red on `check:tools` alone.

## v18.8.7 incremental merge (Zeta — branch `sync/omp-release/v18.8.7`)

- **Baseline**: v18.8.4 (peeled `153b37c3b65b` — merge-base gate passed exactly;
  this is the `Integrated through` value the previous round left behind, and
  the tag upstream has since *moved*, so the SHA not the name is the anchor).
  **Source tag**: `v18.8.7` → `f261ed9faf16`, a real two-parent
  `git merge v18.8.7`; `git merge-base --is-ancestor v18.8.7 HEAD` passes.
- **Zeta start**: `9a2f4426f2a` (pre-merge HEAD of `sync/omp-release/v18.8.7`).
  **Final merge commit**: `9362fef9d66` (two parents: `9a2f4426f2a` +
  `f261ed9faf16`).
- **Scale**: v18.8.4→v18.8.7 = 482 upstream commits / 493 files / +23482 −6005.
  Conflicts: **100 UU** (208 files auto-merged), all resolved in-merge.
- **Method**: conflict blocks were classified by shape before touching any file.
  61 blocks differed *only* in identity tokens (`@oh-my-pi/…` vs
  `@linxiraos/…`, upstream having never touched those lines) and are ours
  verbatim; the remaining real-logic blocks took upstream's shape, then the Zeta
  surface was re-applied on top — the stage-3 method this ledger already
  records. Two classification bugs were caught in-merge: the first scanner parsed
  `git diff --diff-filter=U` as a normal diff when it is combined-diff format
  (two prefix columns), and the first CHANGELOG fold read the merged file and so
  imported upstream's whole 15.x–18.x history instead of this window's.
- **Brand overlay**: `@oh-my-pi/*` → `@linxiraos/*` across 101 files (+619
  imports) via an explicit upstream→published map (`omptype`→`pi-omptype`,
  `pi-coding-agent`→`zeta`, `snapcompact`→`pi-snapcompact`,
  `typescript-edit-benchmark` keeps its leaf); unmapped ids are reported, not
  guessed. Then 73 `omp` identity hits re-applied by category — command→
  `zetacode`, usage/help/verification→`${CLI_BIN_NAME}`, config path→`.zeta`,
  `PI_CODING_AGENT_DIR`→`ZETA_CODING_AGENT_DIR` (cross-face token, class 11),
  prose→`zeta`. `tips.txt` lost upstream's `clanker` and `PI_DIALECT` lines
  (both forbidden by `USER_SURFACE_FILES`); `profile-alias` re-branded.
- **Zeta-only surfaces re-applied**: `interactive-mode` / `agent-session` /
  `web-gateway/{agents,auth,models,plan}` / `zeta-server` /
  `modes/controllers/{event,selector}` were restored from HEAD after the bulk
  take-upstream pass silently dropped them — `check:ts` went 49 errors → 13 → 0
  as each was put back. `model-registry`, `session-tools`, `image-gen`
  likewise. The telemetry hard-off gate and the `zeta-extension-roots` import
  were re-applied to `main.ts` after it was taken from upstream. Upstream's new
  `renameTitle` + `#cardIcons` + `#retitle` were lifted from the tag (they are
  additive and `builtin-lifecycle` calls them), with the imports they need.
- **Loss audit**: `check:ts` only catches exports some *type* still references, so
  a Zeta-only function with no remaining caller disappears silently. A
  before/after export diff over all 2630 source modules found exactly **one**
  dropped export — `resolveOmpPathForTest` in `cli/update-cli.ts` — now
  restored. That is the evidence the bulk take-upstream pass cost nothing else.
- **Structural**: `Cargo.toml` workspace version held at the Zeta line
  (`1.1.29`); `bun.lock` regenerated by `bun install`;
  `packages/catalog/src/compat/rules.json` re-generated with `bun run
  gen:compat`. Upstream's `## [18.x]` CHANGELOG sections have no place on our
  1.x line, so the window's **52** entries were folded into `[Unreleased]` from
  the **tag-to-tag** diff — reading the merged file instead pulls in 1066 entries
  of 15.x/16.x history belonging to no Zeta release.
- **rustfmt**: one offender, `crates/pi-natives/src/oauth_callback/darwin.rs` —
  damage class 8 exactly: the shortened brand string flipped a folded method
  chain back inside `max_width`. `cargo fmt --all` returns it to zero.
- **CI surface**: `ci.yml` still carried an `omp-binary-*` artifact pattern and
  an `binaries/omp-*` upload glob, left where upstream renamed; both are now
  `zeta-binary-*`. `check-ci-surface.ts` green (32 required jobs).
- **Gates at handoff**: `check:ts` ✅ (0 errors) · `brand-check` ✅ (0 hits) ·
  `check-zeta-sentinels` ✅ · `check-version-consistency` ✅ ·
  `check-ci-surface` ✅ · `check-merge-lineage` ✅ (ancestor check passes) ·
  `cargo fmt --all --check` ✅ · `cargo check -p pi-natives -p pi-builtins` ✅
  under WSL nightly-2026-10-06 · conflict markers 0 · test suites diffed against
  a HEAD worktree at the same commit, to separate real regressions from this
  box's timing flakes.
- **Rust toolchain note**: `cargo check` on Windows fails with `linker
  'link.exe' not found` — the missing MSVC linker in this environment, not the
  merge. WSL's default `rustc` is the distro stable build and rejects a
  transitive crate's `#![feature(portable_simd)]`, so the check must select the
  pinned `nightly-2026-10-06` toolchain explicitly.
## v18.8.1鈥搗18.8.6 incremental merge (Zeta 鈥?branches `sync/omp-release/v18.8.4` + `sync/omp-release/v18.8.6`, PRs #76/#77)

- **Baseline**: v18.7.0 (peeled `e0fc1cf4ea35`, merge-base gate passed exactly) 鈫?Zeta start `ca4cef1b00f` (main @ local CI tooling). **Source tags**: `v18.8.1`鈫抦erge `4f5cd0598f3`, `v18.8.2`鈫抈67dacf9d123`, `v18.8.3`鈫抈187a2084275`, `v18.8.4`鈫抈3151cc088ae`, then the follow-up window `v18.8.5`鈫抈77c3e5b2bf1` (peeled `4bf0d9d3e9f9`) and `v18.8.6`鈫抈082bb1ac490` (peeled `f068751e2f1d`) 鈥?all true two-parent `git merge <tag>` commits; ancestry verified (`git merge-base --is-ancestor v18.8.6 HEAD` passes). PR #76 landed on main as `dab5fa80ac4`.
- **Scale**: v18.7.0鈫抳18.8.6 = 524 upstream commits; the v18.8.4鈫抳18.8.6 window alone = **292 commits / 244 files / +10555 / 鈭?660**. Conflicts: **28 UU** (v18.8.5 window) + **32 UU** (v18.8.6 window), all resolved in-merge.
- **Method**: per-file stage-3 (upstream shape) + Zeta surface re-application; three-way `git merge-file` re-merges for the files whose Zeta-only surface was larger than the upstream delta (`model-registry.ts`, `session-tools.ts`, `welcome.ts`, `sdk.ts`, `interactive-mode.ts`). A first sweep script had a real bug (the capture group held the package tail, so the rewrite emitted `@linxiraos//auth-storage`) 鈥?fixed by rewriting from `git show v18.8.5:<file>` with the tail-preserving map, then a tree-wide `git grep`-driven scope sweep (`@oh-my-pi/<pkg>` 鈫?`@linxiraos/<zeta-pkg>`, `omptype`鈫抈pi-omptype`, `pi-coding-agent`鈫抈zeta`, `pi-agent`鈫抈pi-agent-core`, `stats`鈫抈pi-stats`, `snapcompact`鈫抈pi-snapcompact`).
- **Brand surface**: welcome/splash keeps the Zeta hero 鈥?`builtin: "zeta"` mark + `ZETA_LOGO` char-art + `zeta.welcome.*` roles; upstream's `PI_LOGO` 蟺 art and wordmark lockup dropped, `scripts/brand/brand-rules.ts` needle re-pinned to the two-column hero (`builtin: "zeta"` + `alt: APP_NAME`); `tips.txt` de-OMP'd (`zetacode cleanse`); the Tern promo tip (`[NO-TERN] … [tern](https://scl.so/tern)`) was kept in this v18.8.5 merge but **superseded 2026-10-14**: removed by user ruling (reason: upstream product promo + upstream short-link, and the brand surface belongs to Zeta) together with its `[NO-TERN]` visibility-marker mechanism (`welcome.ts`) and its `tip33` catalogue copy (`i18n/{en,zh}.ts`); a `MUST_NOT_CONTAIN /scl\.so/` guard now blocks its return (bare `stencil.so` is deliberately not banned — `catalog.stencil.so` is shared model-catalogue infrastructure); product prose `omp can/has/鈥? 鈫?`zeta` in input-controller/predict/tern. **SUPERSEDED 2026-10-13**: the welcome is now upstream's lockup structure (upstream `1fb10d29bc1`, first shipped in v18.9.2) branded to Zeta 鈥?`ZETA_LOGO` block-grid 味 mark beside the half-block `Zeta` wordmark with `v<version>` under it and the tip below; the two-column card, `LspServerInfo`/`RecentSession` and the model/provider rows are gone. A future sync must NOT re-apply the "drop the wordmark lockup" rule: `scripts/brand/brand-rules.ts` (MUST_CONTAIN) and `scripts/brand/zeta-sentinels.ts` pin the new art rows, and `packages/tui/test/welcome.test.ts` asserts the lockup.
- **Zeta-only surfaces re-applied** (sentinel + check:ts driven): `sdk.ts` `channelSend`/`workspaceRun`/`imControl` sinks; `model-registry` `getOmpOriginProviders`/`getOmpConfigProviders`/`getOmpCompatConfig`/`forceStatic`; `session-tools` `setThinkToolEnabled`; web-search `provider` pin (`SearchQueryParams.provider`) + `setSearchProviderOrder`/`setExcludedSearchProviders`/`isSearchProviderId` re-exports; `setImageProviderOrder`; welcome `LspServerInfo`/`RecentSession` (**removed again 2026-10-13 with the lockup port** — upstream dropped both in `1fb10d29bc1`; neither may be re-applied); `profile-alias` re-branded (`zetacode` command, `zeta-profiles.fish`, `zeta profile alias` markers, reserved name `zeta`).
- **Config-dir + env sweeps**: `.omp` 鈫?`.zeta` across 24 files (docs/tests/`python/robomp`), `.omp-plugin` deliberately preserved; shell-snapshot scratch-variable contract unified back to `__zeta_*` (upstream renamed the producer side to `__omp_funcs`/`__omp_emit_referenced_exports` while our owned `shell-snapshot-fn-env.sh` helper still defined `__zeta_*` 鈥?the mismatch silently disabled env re-export of snapshotted functions) and the snapshot header branded `generated by zeta agent`.
- **Structural**: `Cargo.toml` workspace version kept at the Zeta line; `Cargo.lock` re-pinned to 1.1.27 via WSL `cargo metadata` (upstream's lock carried `18.8.6`); **MODULE.bazel.lock refreshed from CI run `37898883237`'s uploaded artifact** (crate_universe hashes the Cargo inputs 鈥?the freshness check was never disabled); `bun.lock` regenerated by `bun install`; `packages/catalog/src/compat/rules.json` re-generated with `bun run gen:compat` (970 rules); all upstream `## [18.x]` CHANGELOG sections absorbed into the Zeta line; zh settings texts added for `worktree.onStart`/`worktree.onExit`.
- **CI-driven repairs after the first green-merge push**: web-search `provider` pin silently swallowed by an over-wide slice (class-4 damage, restored); `update` banner `omp update` 鈫?`` `${CLI_BIN_NAME} update` ``; `update-cli` refusal message follows `CLI_BIN_NAME`; welcome/legacy-bundle test roles `omp.welcome.*`/`omp-legacy-pi-bundled:` 鈫?Zeta shapes; rules.json staleness; `Cargo.lock --locked` failure.
- **Gates at handoff**: `check:ts` 鉁?(17 packages, 0 errors) 路 `brand-check` 鉁?0 hits 路 `check-zeta-sentinels` 鉁?47/47 路 `check-version-consistency` 鉁?路 `oxfmt --check` 鉁?路 `cargo fmt --all --check` 鉁?(WSL) 路 conflict markers 0. CI run `37901651110` green on main (39-min native addon build, cross-target leg, Validate Rust workspace 15 min, desktop smoke, editor/termide, Web UI build, release jobs skipped in push mode); two first-attempt reds re-ran green 鈥?the read-archive identity cache (`ino+mtime+ctime+size`) under same-tick rewrites, and the 600 s chunk watchdog on `scripts/ci-test-ts.test.ts scripts/release.test.ts` 鈥?both timing/filesystem-sensitive, not merge damage.
- **Same window, separate branch**: Zetawork workspace-state persistence + topbar launchers (`desktop/src/workspace-state.ts`, `desktop/src/tool-resolution.ts`, `pi:spawn-tool`, web-ui topbar buttons; PR #77 鈫?`89bcffb60eb`), 38 desktop tests + web-ui `tsc` green.

## v18.6.3鈫抳18.7.0 incremental merge (Zeta 鈥?branch `sync/omp-release/v18.7.0`, worktree zeta-m1870)

- **Baseline**: v18.6.3 (peeled `093275112f7a`, merge-base gate passed exactly) 鈫?Zeta start `5c0064196cd` (main @ 1.1.27 release bump). **Source tag**: `v18.7.0` (peeled `e0fc1cf4ea35`, remote verified pre-merge). Merge commit `0e13149948d` (true two-parent, second parent = `e0fc1cf4ea35`); ancestry verified post-commit.
- **284 commits / 425 files / +18148 / 鈭?607**; merge-tree predicted 76 conflicts, actual 76 UU 鈥?鐩哥.
- **Conflict decisions**: 59 鏂囦欢鎵归噺 stage-3锛堥攣/鏂囨。/娴嬭瘯/婧愮爜鏈烘鍐嶉€傞厤锛夛紱4 涓笂娓稿垹闄ょ殑娴嬭瘯鎺ュ彈闅忚璧帮紙context-window銆乧ontext-promotion銆乧odex-auto-reset銆乵cp/stdio鈥斺€斾笂娓稿湪鍚堟硶 commit 涓垚瀵瑰垹闄ゅ疄鐜?娴嬭瘯锛夛紱13 涓墜宸モ€斺€擱EADME.md 鍙?ours锛堜骇鍝佸墠闂級锛汣argo.toml 淇?Zeta 鐗堢嚎 1.1.27锛沜i.yml 鍏?12 鍧楀彇 ours锛堜笂娓搁摼鎼哄甫 omp-kata runner + darwin 鐩爣 + omp-* 璧勪骇鍚嶁€斺€斿叏閮ㄥ湪瑁佸畾绂佷护鍐咃紱涓婃父 release_smoke/release_github_verify job 涓嶉噰绾筹級锛沚azel-cache action.yml 鍙?ours锛圸eta 鐨勯儴鍒嗗嚟鎹?warning 鍥為€€鍒绘剰鍋忕涓婃父纭?error锛屾敞閲婂瓨妗ｏ級锛沚azel-cache-warm.yml 鈫?bun-cache-warm.yml 鏇村悕鎺ュ彈锛堜粎 ubuntu锛屾棤 darwin锛夛紱main.ts锛堜繚 Zeta 浼氳瘽瑙ｆ瀽 normalize 瀹堝崼 + zetacode 鎻愮ず鏂囨锛涢噰绾充笂娓?SESSION_NOT_FOUND_HINT 甯搁噺鏇村悕 + isEnoent/isEnotdir import锛夛紱sdk.ts锛坕mport 鍘婚噸鍚堝苟锛汚syncJobManager 缁ф壙淇瀛樻椿浜?~2188锛夛紱agent-session/builtin-modes/interactive-mode锛坥urs 缁撴瀯 + 涓婃父澧為噺锛?prewalk off 瀛愬懡浠や互 i18n M() 褰㈠紡绉绘锛屾柊澧?cmdPrewalkOff en+zh锛夛紱embed-native.ts锛堜笂娓?addonPath 鏇村悕 + scope锛夛紱ci-release-build-binaries.ts锛堝垹 embedNative 棰勫姝モ€斺€斾笂娓告妸宓屽叆绉昏繘 compileCodingAgent 鐨?embeddedAddonFiles锛涗繚 Zeta 鍥涗骇鍝?target 鐭╅樀涓?buildCliBinary 鍛藉悕锛夈€?- **缁撴瀯淇锛堝悎骞跺悗鎻愪氦锛?*: 鐗堟湰绾块噸閽?1.1.27锛坰et-version + catalog + bun install锛夛紱ompCompat registry 灞傜粡涓夋柟閲嶅苟鎭㈠锛坰tage-3 鏇炬姽鎺?Zeta-only 闈細getOmpCompatConfig + #ompCompatConfig + fingerprint鈥斺€旂被 4 鎹熶激锛宑heck:ts 缁?web-gateway/models.ts 鎺㈠嚭锛夛紱scope 鏀瑰啓锛?1 鏂囦欢 @oh-my-pi/鈫扏linxiraos/ 鏄犲皠锛宱mptype鈫抪i-omptype锛宲i-coding-agent鈫抸eta锛夛紱changelog 涓婃父鑺傚惛鏀讹紙18.7.0 鈫?[Unreleased]锛屽凡鍙戝竷鐨?18.6.x/14.x 鑺傚垹闄わ級锛沢en:compat 閲嶇敓鎴愶紙958 rules锛?29 files锛夆€斺€旂粡 WSL 鏋勫缓 linux addon锛堟湰鏈烘棤 MSVC锛沇SL rustup nightly-2026-10-06 + pacman bun 1.4.2锛夛紱bun.nix 鍒锋柊锛沜argo fmt 搴旂敤锛沞nv 濂戠害淇锛坅gent-storage perf 娴嬭瘯 PI_CODING_AGENT_DIR鈫抁ETA_CODING_AGENT_DIR锛夛紱澶瑰叿瀛楅潰閲忔仮澶嶏紙merge-package-json.test.ts + AGENTS.md + 2 natives docs鈥斺€旀満姊?scope pass 鐨勫彈瀹宠€咃紝鐢ㄤ袱杞敼鍐欐ā鎷熸ā鍨嬭瘑鍒級銆?- **Zeta-only 闈㈠瓨娲婚獙璇?*: session trash锛坰ession-trash.ts + builtin-lifecycle /trash //restore + settings锛夈€丄gentSession mode API锛? refs锛夈€丄syncJobManager 缁ф壙淇锛坰dk.ts:2188锛夈€乥uiltin-zeta registry銆乧hannelSend/workspaceRun sinks锛涘摠鍏?47/47 OK锛沚rand-check 0 鍛戒腑锛涚増鏈竴鑷存€у叏 13 缁裤€?- **闂ㄧ**: check-version-consistency 鉁撱€乧heck:ts 鉁擄紙0 閿欙級銆乥rand-check exit 0銆乧heck-zeta-sentinels 鉁撱€乷xfmt 鉁撱€乧argo fmt --check 鉁撱€傛湰鍦板叏閲忥紙WSL linux addon锛夛細merge-package-json/fix-changelogs/musl-release/auth-storage 鐨勫け璐ュ凡鍦ㄥ悓 WSL 鐜鐨?main 涓婇€愪竴澶嶈窇纭涓?*鍚岀孩**锛堥瀛?鐜鍣０锛岃眮鍏嶏級锛沘uth-storage 闅旂璺戠豢銆?- **v18.7.0 鍐呭瑕佺偣**: native addon 鏋勫缓绠＄嚎澶ф敼锛堝祵鍏ョЩ鍏?compile 鏈燂級銆乤uto-graph 琛ㄦ牸 + 鍐呰仈 SVG 娓叉煋 + 绯荤粺鎻愮ず璇?auto-graph銆乺ead 宸ュ叿涓€绛?JSON/JSONL 鏌ヨ锛?q=<jq-filter>锛夈€乀UI 瑙嗗彛鍚屾娑堥棯鐑併€侀搴︽姠鏁戯紙banked resets 鑷姩鍏戞崲 + 涓存湡鎵撴崬锛夈€佹祻瑙堝櫒椤甸潰灏辩华鍔犲浐銆?
## v18.6.2鈫抳18.6.3 direct merge (Zeta 鈥?branch `sync/omp-release/v18.6.3`, worktree zeta-sync1863)

- **Baseline**: v18.6.2 (peeled `1c0993c3d12e`, merge-base gate passed exactly) 鈫?Zeta start `29cd43b1da4` (main @ PR #68 涓夎繛纭+鍥炴敹绔欏悎骞?. **Source tag**: `v18.6.3` (peeled `093275112f7a`, remote verified). Merge commit `1059e51f11f` (true two-parent, second parent = `093275112f7a`); ancestry verified. **557 commits / 586 files / +45408 / 鈭?5312**; merge-tree dry run predicted 112 conflicts, actual 112 UU 鈥?閫愪釜鐩哥.
- **涓婃父绾緥澶囨敞**: v18.6.3 鏄?*琛ヤ竵鍙疯浇鐗规€х骇鍐呭**鐨勭浜屼釜杩炵画杩濊 tag锛坴18.5.1 涔嬪悗锛?57 commits/45k 琛屸€斺€攄irenv cache PR #14310銆佹満鍣ㄥ彲璇?RPC wire schema銆乥rowser tool 澶ф敼銆乻napcompact 甯ц璐?#14277/#14291銆乶atives perf audit 鍗佽繛 PR銆乨esktop automation 3f000c524cf锛夈€倂18.6.2 鐨?GitHub Release **宸蹭簬 10-06 琛ュ彂**鈥斺€斾笂杞处鏈€寁18.6.2 浠呮湁 tag銆佹棤姝ｅ紡 Release銆嶇殑琛ㄨ堪灏辨浣滃簾锛泇18.6.3 Release 浜︿簬 10-06 13:17 鍙戝竷銆倀ag 涓嶅彲鍙樼孩绾挎湭鍙楀奖鍝嶏紙涓よ疆 ls-remote 涓庢湰鍦颁竴鑷达級銆?- **Conflicts**: 112 UU 鈥?4 lockfile/缁撴瀯锛圕argo.lock/Cargo.toml/MODULE.bazel.lock/bun.lock锛? rules.json锛坓en:compat 閲嶇敓鎴?959 rules锛? sdk wire 涓変欢锛坓en:rpc 閲嶇敓鎴愶紱Zeta `StateVersionChangedEvent` 鎵╁睍鍦?`wire/events.ts:159` 瀛樻椿锛屾満鍣ㄥ彲璇?schema 杞師鐢熷吋瀹癸級+ 106 source/test銆傛柟娉曪細鎵归噺 stage-3 鐩村啓锛?04锛夆啋 brand-check `--json` 鏂囦欢娓呭崟 scope sweep锛?07 鏂囦欢锛宍@oh-my-pi/<tail>` 鈫?RENAME_BY_TAIL 鏄犲皠锛夆啋 brand-overlay锛? 鏂囦欢/18 token锛夆啋 鎸?zeta-sentinels/check:ts 鎶ュ憡閫愭枃浠朵笁鏂归噸搴旂敤锛堥厤鏂癸細ours=s2 blob銆乥ase=s1銆乼heirs=宸?sweep 宸ヤ綔鏍戯級銆?- **Zeta surfaces re-applied**: agent-session 浼氳瘽灞?mode API 鍏ㄥ锛?8 鍝ㄥ叺鎭㈠锛涢噸澶?import 鍘婚噸鈥斺€斾笂娓告妸 model-resolver 浠?model-registry 鎷嗗嚭锛?interactive-mode `#describeIdleStatusHud` tok/s 妲藉苟鍏ヤ笂娓?todo-activity HUD锛坄describeStatusHud` 鍚堝苟褰?= 涓婃父 todo 缁撴瀯 + ours idle slot,`zeta.hud.*` role锛?cli.ts `ZETA_PROFILE` env 琛?+ `CLI_BIN_NAME` process title,**鍐呰仈 parent watchdog 寮冪敤**鈥斺€斾笂娓?#14350 `startParentWatchdog` 妯″潡涓哄姛鑳芥紨鍖栵紙瀹瑰櫒 ppid=1/seccomp pidfd 璇箟涓婃父鏇村叏锛?modes/types `InteractiveModeContext` Zeta 鎴愬憳锛坧lan-ultra/sidebar/mode API锛?eval `__zeta_*` 娉ㄥ叆瀵癸紙runtime `_zeta_display` 涓?prelude 娑堣垂渚ф垚瀵逛繚鐣?涓婃父 `__omp_display__`/`x-omp-image` API 寮冿級;session TrackingRecorder/stringifyJson銆乻ettings-ui zh overlay銆乺ead.ts `readTargetsPlan`;oauth_callback context.rs 閲嶆柊鍘?`#[cfg(any(unix,test))]` 闂紙11 澶勶級;worker argv `__zeta_worker_*` 鍏ㄥ鏃忥紙涓婃父鏂板 tiny_inference/stats_sync/tab/js_eval 绯伙級;macos capture 鏂版枃浠?helper 鍚?`zeta-capture-helper`/`zeta-capture`锛坆uild.rs 渚у悓姝ワ級銆?- **Post-merge sweeps**: 闈炲啿绐佽嚜鍔ㄥ悎骞跺甫鍏ョ殑 `omp.*` native-dock role锛坙oader `zeta.working.label/sep`锛?涓婃父瑙︾娴嬭瘯 fixture 瀛楅潰閲忎笓椤癸紙`omp.hud.*`/`omp.composer.*`/`omp.editor.*`/`omp.thinking(.live)`/`omp.user.time`/`omp.queue.count` 鈫?zeta 褰?6 鏂囦欢锛?ENV_KEYS 鐨?`OMP_PROFILE/PI_PROFILE` 淇濈暀锛坢ain 鏃㈡湁 canonical 褰?scrub-list 璇箟锛夈€?- **Structural**: 鐗堟湰绾?1.1.26 set-version 骞傜瓑 鉁?catalog 13 閿?@1.1.26 鉁?Cargo.lock 鍙?theirs + 鐗堟湰绾夸慨澶嶁€斺€?*涓婃父缁?pi-builtins sort 鏂板 icu_collator/decimal/locale_core/provider 鍥?crate**;bun.lock 绾増鏈嚎 delta 鈫?ours 淇濈暀,`bun install` no-op,nix/bun.nix 鏈噸鐢?**MODULE.bazel.lock 闇€棣栬疆 CI 宸ヤ欢鍙栧洖**锛圕argo 杈撳叆鍙樹簡,涓婅疆"鏃犻渶鍙栧洖"鏉′欢涓嶆垚绔嬶級;changelog锛歠ix-changelogs 鏀舵暃 + 鎵嬪伐琛?promotion锛坅gent 9 鏉?catalog 3/browser-relay 1/snapcompact 3锛夊悗鍏ㄦ爲鍓櫎 `## [1[5-8].x]` 娈碉紙594 涓爣棰?9 鍖咃級銆?- **娴佺▼鏁欒锛堟湰杞柊澧?宸插綍 playbook 鍊欓€夛級**: 鈶?merge 鏀跺彛涓鐢?`git cat-file :1:/鈥?2:` 鎻愬彇 stage 浼氭嬁鍒?*宸叉姌鍙犵殑 :0:**锛堟鍓?git add 宸叉秷璐?stage锛夆€斺€斿繀椤荤敤 merge 寮€濮嬫椂棰勬彁鍙栫殑 blob锛坄../mrg/s1/s2/s3`锛?鈶?涓夋柟 scratch 鐩綍鑻ユ墎骞虫斁缃?**鍚屽悕 basename 鏂囦欢浜掕俯**锛坅nthropic.ts脳2銆乼ypes.ts脳2 涓よ捣,鍧囦负"瑁呴敊鍐呭"鍨嬮潤榛樻崯浼?TS2307 鐩稿璺緞閿欏寘鎵嶆毚闇诧級鈥斺€攕cratch 蹇呴』闀滃儚璺緞;鈶?merge-file 瀵?delete/modify 闈欓粯鍙栦慨鏀逛晶鈥斺€擿setProfile(resolveProfileEnv(...))` 琛屽洜姝よ涓婃父褰㈣鐩?闈?check:ts 鍏冩暟閿欒鏆撮湶銆?- **Gates at handoff**: check-version-consistency 鉁?1.1.26 路 check:ts 鉁?exit 0锛? error锛壜?brand-check 鉁?0 路 zeta-sentinels 鉁?47 路 check-ci-surface 鉁?32 job 路 `cargo +nightly-2026-06-30 fmt --all --check` 鉁?路 include_str!/include_bytes! 鍏ㄦ爲瀹¤ 95/95 鍦ㄦ爲锛坋nv! 鍨嬬粡 build.rs 浜х墿鐨勬簮鏂囦欢 helper.m/bridge.swift 鍧囧湪鏍戯級路 conflict markers 0銆?- **Local buckets**: snapcompact-frames 4鉁擄紙#14277 甯у舰鐘惰璐光€斺€斾笂杞处鏈敞璁扮殑瀛楀舰鍑犱綍鍦ㄩ€旈棶棰橀殢鏈疆闂悎锛壜?agent image-tokens+anthropic-compaction + ai openai-responses-history-payload 81鉁?路 coding-agent activity-line/btw-controller/worker-selector 36鉁?skip 路 rpc-wire + catalog 鍏ㄦ《 1240鉁撱€傚叏閲?`bun test`/`test:rs` 濮旀墭 CI锛堝悎骞朵笉鍙戝寘锛夈€?
## v18.6.0鈫抳18.6.2 double-tag direct merge (Zeta 鈥?branch `sync/omp-release/v18.6.2`, worktree zeta-sync1862)

- **Baseline**: v18.6.0 (peeled `89d2610993af`, merge-base gate passed exactly) 鈫?Zeta start `1b31e327309` (main @ nightly-rustfmt alignment + PR #53 repairs). **Source tags**: `v18.6.1` (peeled `2a2c6dcbbb55`) + `v18.6.2` (peeled `1c0993c3d12e`), merged in ONE window (`git merge v18.6.2`, true two-parent `9248b345d10`); ancestry verified (`v18.6.2` is ancestor of HEAD). 54 upstream commits, 92 files / +4075 / 鈭?845.
- **娉ㄨ锛堝悎骞跺悗鍕橀獙 2026-10-04锛?*锛氫笂娓?`v18.6.2` 褰撴椂**浠呮湁 tag銆佹棤姝ｅ紡 GitHub Release**锛堟渶鏂?Release 涓?v18.6.1锛泇18.6.2 杩?draft 閮芥湭寤猴級銆傛寜鐢ㄦ埛鎸囦护銆岃拷涓婃父鍚堝苟鏈€鏂?tag銆嶆墽琛岋紝绗﹀悎澧為噺瑙勭▼锛坱ag 涓嶅彲鍙樸€乵erge-base gate 绮剧‘锛夛紱鍙戣鐗堝寘閾撅紙auto-bump 杩?Zeta 姝ｅ紡 Release锛変笉鍙楀奖鍝嶃€傝嫢涓婃父鍚庣画绉诲姩/鍒犻櫎璇?tag锛屼笅涓€杞?merge-base gate 灏嗙孩鐗屽苟鎸夈€宼ag 涓嶅彲鍙樸€嶇孩绾垮缃€?- **Conflicts**: 20 UU 鈥?7 source, 8 test, 5 structural (Cargo.lock/Cargo.toml/MODULE.bazel.lock/bun.lock/rules.json). Method: per-file stage2-vs-stage3 diff after upstream鈫抁eta scope normalization; pure upstream-delta files took theirs + scope rewrite; only encode.ts (doc-comment brand + `app: "zeta"` kept), git-tui-stream.test.ts, collab/controller.test.ts, btw-controller.test.ts needed Zeta-surface re-application.
- **Zeta surfaces re-applied**: `ZETA_CODING_AGENT_DIR` env pair (collab controller test), `zeta-*` tmpdir prefixes (btw-controller 脳3, git-tui-stream), `HAS_DIFF_STREAM` release-addon guard + `test.skipIf` on 7 staged-content tests (upstream added 2 new `GitModel.applyPatch` tests 鈥?those go through git CLI, correctly unguarded), `app: "zeta"` TSP hello + zeta doc-comment (encode.ts, upstream switched its doc pointer to Tern SDK `protocol/input.md`), `resolveCommandDescription` wrapper restored in builtin-completions (Zeta `AutocompleteItem.description` is still `string`; upstream widened theirs), relay probe test title rebranded while `ompRelayVersion`/`ompRelayDiscardedTabsProtocol` wire keys stay upstream-shaped (allow-interop mirror layer).
- **Post-merge sweeps (un-owned auto-merged files)**: upstream ADDED files carried raw `@oh-my-pi/*` imports (image-tokens.ts + its test, relay bridge/probe/server `VERSION` import) 鈥?5-file scope sweep; brand-overlay itself reported 0 (scope map lives in the merge driver, not REWRITES). promoted CHANGELOG copy carried `omp -r`/`when omp starts` 鈫?swept to zeta; stray upstream archive footer line dropped.
- **Structural**: version line 1.1.26 untouched by set-version (idempotent 鉁?; catalog 13 keys @1.1.26 鉁? upstream root/per-package manifest + bun.lock + Cargo.lock deltas were version-line-only 鈫?ours kept, `bun install` no-op, nix/bun.nix not regenerated; rules/ KDL changed (google-antigravity roster +3, openai-codex +1) 鈫?`gen:compat` re-ran (940 rules; needs natives addon 鈥?copied baseline .node from main checkout, class-5 workaround); MODULE.bazel.lock kept ours (Cargo inputs unchanged 鈫?no CI artifact pickup needed); fix-changelogs promoted upstream bullets into `[Unreleased]` (merge-only, no release per user decision) then `## [18.6.x]` sections pruned across 7 packages.
- **Gates at handoff**: check-version-consistency 鉁?1.1.26 路 check:ts 鉁?exit 0 路 brand-check 鉁?0 路 zeta-sentinels 鉁?47 路 oxfmt --check 鉁?(in check:ts) 路 `cargo +nightly-2026-06-30 fmt --all --check` 鉁?路 conflict markers 0 路 fixture-literal grep on merge-touched test dirs 0 new hits.
- **Local buckets**: catalog compat-collapse 70鉁?路 agent image-tokens+compaction 58鉁?路 ai openai-responses-history-payload 47鉁?路 coding-agent resolved-file bucket (see PR notes) 鈥?full `bun test`/`test:rs` delegated to CI per 鐢ㄦ埛瑁佸喅 (鍚堝苟涓嶅彂鍖?.

## v18.4.11 direct merge (Zeta 鈥?branch `sync/omp-release/v18.4.4`, worktree zeta-sync-1844)

- **Baseline**: v18.4.4 (peeled `8ac1309bd8ad`, merge-base gate passed exactly) 鈫?Zeta start `528b0f759a0` (v18.4.4 merge + test fixes). **Source tag**: `v18.4.11` (peeled `855879c9ab0`). Merge commit `7fa18c6d9eb` (two-parent, `--no-verify` used for local hooks), ancestry verified.
- **Scale**: 939 files / +62.7k / -10.8k (682 upstream commits); 213 unmerged paths (211 UU + 1 DU + 1 UD), 0 pure scope-noise files.
- **Method**: staged pipeline 鈥?3-way `merge-file(ours, base=v18.4.4, sweep(theirs))` per UU file with a Zeta-surface sweep applied to the theirs side first (scope map incl. RENAME_BY_TAIL, `.zeta` root, `ZETA_CODING_AGENT_DIR`, `zeta://`, `__omp_worker_鈫抇_zeta_worker_`, command-context `omp`鈫抈zetacode`, product `omp`鈫抈zeta`); then binding-level import merges (babel-verified) + subset/ws-collapse hunk rules; residual hunks hand-resolved (59 files). Key decisions: dirs.ts rebuilt on swept-theirs + Zeta identity block (APP_NAME/CLI_BIN_NAME=zetacode/APP_URL/USER_AGENT/ZETA_PROFILE single-env, no PI_PROFILE fallback); welcome.ts kept 味 ZETA_LOGO + SVG machinery over upstream's new 蟺-block art (logoNode adopted); ci.yml = ours (upstream's only delta was the darwin-arm64 AppleFM verify step 鈥?darwin removed from Zeta release surface); BUILD.bazel = upstream dylib rework + ours fuse-ld=bfd + 1.1.23; README = ours (front door). UD `skill-descriptions.test.ts` followed upstream deletion (replaced by `skill-descriptions-xdg.test.ts`, adapted to ZETA_* envs).
- **Post-merge full-tree sweep (playbook 缁撹 2)**: 225 files re-swept 鈥?upstream ADDED files (factory-droid provider family, ratchet) carried raw `@oh-my-pi/*` imports the per-conflict pipeline never saw. Overreach repairs: `discovery/omp-extension-roots` specifier + file restored (interop keep), `import("omp-legacy-pi-modules")` restored (virtual module protocol), `theme.icon.omp` key restored in segments.ts (internal key; symbols.ts untouched), ratchet/prelude.js `__omp_prelude__/__omp_display__` 鈫?`__zeta_*` (provider-side pair in runtime.ts; damage class 11).
- **Test contracts updated to implementation (upstream shipped)**: logger batching/audit-in-memory (logger.ts + contract/multiprocess tests, `ZETA_LOG_LEVEL` env pair), dirs-cache (`getComposerCacheDbPath`), stderr-guard probe (no auditFile), xai test (applyXaiCatalogPricing removed upstream), tui markdown test, auth-gateway command rebuilt from upstream (trust-proxy-headers flag).
- **Zeta-only preserved**: mode API + goals coexistence (upstream's RPC goal command builds on shared GoalRuntime), sdk sinks, IRC auto-reply, tracking helpers (restored into rebuilt dirs.ts), stats brand surface, `__zeta_*` injection pairs, `__ompInstallTokioRuntime` untouched, ZETA_CODING_AGENT_DIR.
- **Gates at handoff**: check-version-consistency 鉁?1.1.23 路 check:ts 鉁?exit 0 路 brand-check 鉁?0 路 zeta-sentinels 鉁?46 路 check-ci-surface 鉁?(28 ci.yml jobs + editor/ide/main-publish) 路 cargo metadata --locked 鉁?路 cargo fmt --all --check 鉁?路 conflict markers 0. bun.lock regenerated (bun install; zero external dep changes upstream 鈥?nix/bun.nix verified byte-identical after regen); Cargo.lock realigned to 1.1.23 (`cargo metadata` rewrite); rules/ unchanged 鈫?gen:compat not needed; CHANGELOG upstream `[18.x]` sections pruned (Zeta sections untouched); **MODULE.bazel.lock NOT refreshed** (Cargo.lock changed 鈫?owner must re-run the WSL refresh).

## v18.2.4 + squash-sync reset (Zeta 鈥?history reset authorized by maintainer, PR pending)

- **Baseline**: v18.2.3 chain (sync branch carried 1de9977e28 -> cbf0cc5158 -> 509f6b45cb, full two-parent merges, gates green)
- **v18.2.4**: tag 1c0303b1f2ec515cbf4b44a9a49d68a029531aac (verified vs remote), merged as 509f6b45cb (6 upstream commits, 79 files, 13 conflicts 鈥?all upstream-rewrite takes + scope map)
- **History reset**: maintainer authorized squash-sync (AGENTS.md 搂瓒呭ぇ閲忎笂娓稿悓姝?: new main = backup/omp/main (856d9375e0, origin anchor) + 2 squashed commits 鈥?(1) v18.1.16..v18.2.3 content [skip ci], (2) v18.2.4 + policy docs. Old main preserved remotely as main-old-20260917. Upstream commit-level detail lives at github.com/can1357/oh-my-pi (fork provenance).
- **Deviation note**: this overrides the standing non-squash/ancestor-check rule for this window (transfer-layer constraint: multi-hundred-MB pack vs proxy/direct-link instability, evidence: remote unpack failed: index-pack failed on every full-pack attempt; 593/721 hops uploaded fine).
- **backup/omp/main**: retained on origin + local, fast-forwarded to v18.2.4 as the standing fast-sync anchor.
- **Gates**: re-run green on the squash tree (identical content to the verified merge tree).

## v18.2.1 + v18.2.3 chained (Zeta 鈥?sync branch `sync/omp-release/v18.2.1`, PR pending)

- **Baseline**: v18.1.21 (`acf943d3c8` parent of Zeta 1.1.15 line; Zeta start `45dbc74458`, main post-PR-#20, version line 1.1.15)
- **Source tags**: `v18.2.1` (peeled = tag = `acf943d3c8dc1ed135b42aa33fef4d9d2ff61c9a`, verified via `git ls-remote --tags omp-upstream`) and `v18.2.3` (lightweight `a2d83061c5d673bf3ee495d7652b63ee5a0ceb14`, verified). v18.2.2 skipped as internal to the 18.2.1..18.2.3 range; both tags are ancestors of HEAD (`git merge-base --is-ancestor` passes for both).
- **Zeta starting commit**: `45dbc74458` (main) 鈫?isolated worktree `../zeta-sync-1821`, branch `sync/omp-release/v18.2.1`.
- **Merge 1**: `1de9977e28` = merge of tag `v18.2.1` (non-squash two-parent). Conflict set 445 files (source 226 / tests 199 / docs 10 / version-line 4 / rust 4 / ci 2), resolved by 9 parallel slices + 2 test slices (Round B after source), shared contract doc `local://sync-rules-v1821.md`.
- **Merge 2**: `cbf0cc5158` = merge of tag `v18.2.3` on top (delta 171 commits / 256 files; 70 conflict files, resolved by 3 slices). Chained-tag methodology per merge-playbook (second hop much smaller than a fresh merge).
- **Key decisions**:
   - Version line kept Zeta: root Cargo workspace 1.1.15, catalog 13 keys @1.1.15, `__piNativesV1_1_15`, `__ompInstallTokioRuntime` untouched.
   - zeta-package driver union leaked upstream `@oh-my-pi/*` catalog keys 鈥?dropped 12; per-package manifests re-mapped to `catalog:`.
   - Tree-wide sweeps post-merge (auto-merged files have no owner): 114+14 files `@linxiraos/*`鈫抈@linxiraos/*` (omptype鈫抪i-omptype, omp-stats鈫抪i-stats, snapcompact鈫抪i-snapcompact, pi-coding-agent鈫抸eta); `.zeta` fixture paths鈫抈.zeta` except interop surfaces (`.omp-plugin`, `.omp-sessions`, `.zeta/plugins` discovery, `omp.extensions`, `ompprurl`, `@omp-print-signal-`, `_omp_call`, `my.omp.sh`, `omp.sh/install`); `__omp_worker_*` selectors renamed to `__zeta_worker_*` to match the merged `worker-host.ts` validator (protocol constants follow the checker).
   - Zeta-only preserved: AgentSession/InteractiveMode mode API + `state_version_changed`, sdk sinks (channelSend/workspaceRun/imControl), IRC auto-reply, dirs tracking helpers, `/language` `/tracking` registry, web-gateway git/archive/temp endpoints, TUI sidebar (gutter engine ported onto upstream PreparedLines renderer; `setMainWidth` compose/physical width split with `#previousPhysicalWidth` for resize replay).
   - Upstream restructures accepted: profiler heap-snapshot removal (MemoryStats), browsers.ts refactor (Browser enum + resolveBuildId dropped; browser-launch.test adapted with pinned CfT buildId), model-config-values.ts 鈫?resolve-config-value.ts, model-mention registry split, advisor emission-guard rewrite (impl+test pairs kept together).
   - Sentinel registry updated: `snapshotForReplication` signature follows upstream's copier param (path itself intact).
   - Brand: 味 title char kept; omfg-controller comment `.zeta/rules`鈫抈.zeta/rules`; brand-check 0 hits.
- **Gates**: check-version-consistency 鉁?1.1.15 路 check:ts 鉁?0 errors 路 brand-check 鉁?0 路 zeta-sentinels 鉁?46 路 cargo metadata 鉁?路 cargo fmt --all --check 鉁? bun.lock regenerated; CHANGELOG [18.x.y] sections folded per convention.
- **New playbook lessons**: promisor/blob:none + shallow lazy-fetch aborts merges (`git fetch omp-upstream --no-filter tag <tag>` first); merge-driver catalog dupes; un-owned auto-merged files need full-tree sweeps; sibling in-flight state is not ground truth (CaModes sidebar incident); tests round after source. See `document/merge-playbook.md` 搂澶ф壒閲忓啿绐佺殑鍒嗙骇 resolve appendix.

## v18.1.17鈥搗18.1.21 batch (Zeta 鈥?feature-branch integration, PR pending)

- **Baseline**: v18.1.16 (`61b1b8aef634`, Zeta `56b2cc6eee`, version line 1.1.14)
- **Source tag**: `v18.1.21` (peeled `a2501722aa05670eeab327ea1325e3fde55e51a9`; verified via `git ls-remote --tags omp-upstream`; the batch covers upstream v18.1.17鈫抳18.1.21, 757 files)
- **Zeta starting commit**: `56b2cc6eee` (main) 鈫?work carried on `feat/web-ui-next` (web-ui rework + sync in one train).
- **Merge commit**: `bdb0e04e22` (non-squash two-parent; `merge-tree` pre-report 116 conflict files; resolved by 6 parallel slices: locks/native bindings 鈫?upstream; 60 test files 鈫?upstream + `.zeta`鈫抈.zeta` rewrites preserving `my.omp.sh` relay URLs; README kept Zeta-owned; 8 mode/session files kept Zeta session-layer mode API (`flushPendingModelSwitch`, `restorePlanPreviousModel`, `enterVibeMode`, `#stateVersion`) + upstream i18n `M.imClosingSession`; 35-file hand merges (anthropic.ts redact+cache-key, settings-schema Zeta `turn_stats` + upstream `vim`); install.ps1 upstream structure + Zeta brand). `git merge-base --is-ancestor v18.1.21 HEAD` passes.
- **Zeta adaptation commits**:
   - `b237c10071` (A3) structural: `set-version.ts 1.1.14`, dropped upstream 18.1.21 root manifest block, 9 package manifest renames (`omptype`鈫抈pi-omptype`, `omp-stats`鈫抈pi-stats`, `snapcompact`鈫抈pi-snapcompact`), 130-file scope sweep, README restore from main, CHANGELOG `## [18.` prune, `__omp_call_tool__`鈫抈__zeta_call_tool__`, `.zeta`鈫抈.zeta` in crates/pi-natives oauth callback + collab registry + plan autosave + utils/dirs.
   - `bc858c7751` (A4) mechanical brand overlay over 13 upstream test files (36 tokens).
   - `86bead6ed7` (A5) test-contract resolution + damage fixes (below).
- **Damage found and fixed (pre-push, none reached CI)**:
   - Astra window policy (class 4): merge kept upstream `contextWindowFloor 1050000` KDL/rules.json but Zeta main owns the gated variant (`limitsPatch 272000` + `maxContextWindow 1050000` behind extended-context); resolved by taking main's `openai-codex.kdl` + `context-window.test.ts` + `codex-discovery.test.ts` pair and regenerating `rules.json` 鈥?the model-registry extended-context bucket then matched main's test pair wholesale.
   - Manifest duplicate keys (new damage class; detector: `Duplicate key in object literal` warnings breaking stderr-asserting tests): the mechanical `@linxiraos/*`鈫抈@linxiraos/*` scope rewrite appended renamed keys instead of replacing, leaving 2鈥? duplicate keys in 10 package manifests 鈫?deduped, `bun.lock`/`Cargo.lock` refreshed.
   - v21 hardcoded `/prewalk` rewrite + `/collab list` + `/btw` descriptions tripped the i18n guard (`i18n-slash-commands.test.ts`): added `cmdPrewalk`/`cmdPrewalkAcp`/`cmdPrewalkRestart`/`cmdCollabList`/`cmdBtwHistory` keys (en+zh+messages) and wired the registry back to catalogue keys, preserving v21's one-shot-handoff behavior.
   - v21's new settings (`tui.mouse`, `tui.vimMode*`, `display.pinnedAgents*`, `plan.autosave*`, `tools.speculativeExecution.*`, `collab.autoStart`, `composer.recallClearedDrafts`) lacked zh texts 鈫?added to `settings-zh.ts` (`ZH_SETTING_TEXTS` vs `ZH_OPTION_TEXTS` split per key type).
   - InteractiveMode `#teardown` carried a duplicated pre-dispose block (early `#btwController.dispose()` etc. before `showStatus`), failing the still-closing progress test 鈫?reduced to upstream 90b6315a28 shape with `M.imClosingSession`.
- **Checks (local, pre-PR)**: `check-version-consistency` OK (1.1.14), `check:ts` OK, brand-check 0 hits, zeta-sentinels 46 OK, `cargo fmt --all --check` OK; bucket suites green: catalog 951+ (2 Windows-only `issue-8867` quarantine flakes identical on main), agent 583/583, ai = main baseline (12 Windows-env failures, zero branch-unique after manifest dedupe), coding-agent failure set = main's 134 baseline 卤3 timing-flaky (re-runs flip); web-gateway 30/30 incl. archive. Local native addon for tests copied from the main checkout (class-5 workaround; win32 MSVC link blocked by Git's GNU `link.exe` shadowing PATH 鈥?GNU toolchain works; msvc needs VS Build Tools).
- **Merge into feature branch**: `ac09144ec9` (`sync/omp-release/v18.1.21` 鈫?`feat/web-ui-next`, non-squash; v21 + release branch both ancestors). Post-merge gates re-run green.
   - **Post-PR CI repairs (rounds 1鈥?, `4d2c42825b` + `a121243641`)**: (a) `bun.lock` carried 641 `registry.npmmirror.com` URLs from the local `~/.npmrc` leak during A5's `bun install` 鈥?normalized to npmjs.org (standing rule); (b) `logger-contract.test.ts` taken from upstream while source writes `zeta.*` prefixes 鈥?restored zeta naming + added a `filenamePrefix: "zeta"` MUST_CONTAIN brand rule (brand-check's `.zeta` rule exempts `/test/` paths, which is why A4 missed it); (c) **torn paste/ask contracts (damage class 9 family, tests-are-contract)**: v21's `beginPaste` paste-reservation (`PasteTarget.beginPaste` + `finishPaste` flow in `handleImagePaste`) and hook-editor ordered-paste were dropped while taking v21's `extension-ui-controller.test.ts` wholesale 鈥?restored v21 source for `input-controller.ts` (paste parts), `hook-editor.ts` (wholesale, imports rekeyed), `ask-dialog.ts` single-multi-question submit jump, plus v21's `ask-dialog.test.ts`; (d) `__omp_*` runtime-global sweep lost in 8 eval/core test files (`__zeta_import__`/`__zeta_helpers__`/`__zeta_session__`/`__zeta_run_id__`/`__zeta_tools__`), while upstream-internal protocol symbols (`__omp_with_call_site__`, `__omp_tool_bridge__`, `__omp_final_expr__` marker) stay upstream-named per source provider 鈥?recorded as damage class #9 in AGENTS.md.
   - **Post-PR CI repairs (rounds 3鈥?, `49044fae3e` / `56787c2709` / `0908cb7556`; CI green run `35050684923`)**: (a) `nix/bun.nix` was the **pre-merge** stale file (still `@linxiraos/*` workspaces, no `name` attrs) 鈥?regenerated with the canonical CI invocation `bun2nix -l bun.lock -c ../ -o nix/bun.nix`; the intermediate regen WITHOUT `-c ../` emitted `./packages/*` copy paths that don't exist relative to `nix/` (Nix eval `Path does not exist in Git repository`) 鈥?the `-c ../` prefix is load-bearing, not cosmetic; (b) A3's CHANGELOG `## [18.` prune had **over-truncated Zeta's own 1.1.10-and-older sections** (class 4; HEAD was a strict subset of main) 鈥?restored from main; (c) v21 reordered `DEFAULT_COMPACTION_METHOD_ORDER` (shake before soft): merge kept main's `compaction-methods.ts` + v21's `settings-manager.test.ts`, then main's `agent-session-handoff.test.ts` pinned the old order 鈥?took v21 for both test files (handoff import mapped to `@linxiraos/pi-snapcompact`, class-3 mapping); (d) `claude-plugins.test.ts` registry literal `.zeta` 鈫?`.zeta` (source resolves via `getConfigDirName()`); (e) inline python stubs `__omp_display = lambda` in bridge/prelude tests 鈫?`__zeta_display` (prelude.py calls the zeta name); (f) real-browser `pickElectronTarget` trio self-skips under `ZETA_SKIP_REAL_BROWSER=1` (native bucket job only): GH-hosted ubuntu-22.04 resolves system Chrome but CDP never comes up 鈥?**upstream's own ubuntu-22.04 PR run fails identically** (verified run 35045230929); upstream passes only on self-hosted `omp-kata`, which Zeta must not use (class 7).

## v18.1.10 (Zeta 鈥?merged, released as 1.1.9)

- **Baseline**: v18.1.5 (OMP tag `62b674e73b...`, Zeta sync commit `515dfdf2073be9dc4df0299b3a493201dc19ec2b`)
- **Source tag**: `v18.1.10` (peeled SHA `f241301c83726afe75a847e919b89977a54dafbe`; verified via `git ls-remote --tags omp-upstream refs/tags/v18.1.10`)
- **Zeta starting commit**: `515dfdf207` (local main)
- **Merge commit**: `e4b3731b0c` (non-squash, in history; `git merge-base --is-ancestor f241301c HEAD` passes)
- **Zeta adaptation commits**:
   - `1758bbd3b4` scope rewrite + toolchain restore + catalog/hashline drop + bun.lock v1
   - `51c0217a87` session-mode-API + `.zeta` config-dir + sentinel `__piNativesV1_1_8` + changelog sweep
   - `b7f458707d` merge-residue regressions: UA constant, base-prompt byte guard, plan-aware read window, inspector config-dir key, per-file test contracts, install-smoke runner
   - `5b88797f` + `281e96e4a9` channel-tool top-level gating + tracking gate (re-applied after a concurrent checkout ate the first pass) + skillful fixture `.zeta`
   - `d2a7082adb` full TUI localization (settings page + slash commands + placeholder translations + guards)
   - `88f4ddb524` brand residue guard + overlay scripts (CI-enforced) + installer restore + overlay sweep
   - `47ab7e7f22` sidebar production render fix + content rebuild + live settings apply
   - `c89e92cc65` AGENTS.md restructure (lean core + document/ splits)
- **Conflict decision**: modify/delete 鈫?accept upstream deletions; content 鈫?take upstream (`--theirs` for 184 files), then re-apply Zeta layer.
- **Checks**: PR #8 CI fully green (4 rounds; run `33958572706` = success incl. brand-residue guard), `bun scripts/check-version-consistency.ts`, ancestor check, Zeta Nix success. Local prebuilt natives stale (damage class #5, CI builds fresh via bazel).
- **Release-run repairs (first GH-hosted execution of the Rust gate)**:
   - `14db3db79a` utok fixtures: dropped 5 stale Zeta-snapshot entries whose reference counts went stale with the v18.1.10 tokenizer update; pi-shell kill-test timeouts 5s鈫?0s (superseded by the root-cause fix below).
   - brush-core stop detection: `ChildProcess::wait` relied on a tokio SIGCHLD stream that misses signals arriving before registration 鈥?a pipeline stage that SIGSTOPs during later-stage spawning stalled `run_string` forever on loaded GH-hosted runners (fast local/upstream machines always win the race, so the upstream test never showed it). Fix in the vendored fork: `waitid` scoped to the caller's pid (`Id::Pid`, no cross-child event consumption) + one entry probe for already-pending stops (`processes.rs`, `sys/unix/signal.rs` incl. macOS shim, `sys/stubs/signal.rs`), regression test `wait_observes_a_stop_that_precedes_the_wait` verified red (5s timeout) without the entry probe and green with it. Upstream test files untouched. Run 3 confirmed on CI: Rust tests + all three clippy scopes green for the first time post-merge.
   - rustfmt collapse flip (damage class #8): the brand replacement shortened `"oh-my-pi"`鈫抈"zeta"`, pulling `pi-vcs/git/mutate.rs`'s `SignatureRef` literal back under `max_width`, so the final `Rustfmt` step (never reached by runs 1鈥?, skipped on PRs entirely) failed `pi-vcs.rustfmt.ok`. Fixed by `cargo fmt --all`; workspace-wide check reports zero further offenders.

## v18.1.16 (Zeta 鈥?offline backup-branch validation merge, release pending)

- **Baseline**: v18.1.14 (`daf07999c2fe`, Zeta `75f5066f51`, release v1.1.12)
- **Source tag**: `v18.1.16` (peeled `61b1b8aef634334eaf1412afd003a763e1d1b9c1`; verified via `git ls-remote --tags omp-upstream`)
- **Merge commit**: `8418f8571a` (non-squash two-parent on `backup/pre-sync-v18.1.16`; ancestor check passes)
- **Scope report**: `bun scripts/merge-scope-report.ts --tag v18.1.16 --from u-v18.1.14` 鈫?270 upstream files, 88 true conflicts (exactly matched the report), 130 silent merges; slices v14鈫?5 (140 files) and v15鈫?6 (162 files) reviewed separately.
- **Damage found and fixed during validation** (all pre-push, none reached CI):
   - Mechanical: `@linxiraos/*` scope residue from silently merged upstream files (606 hits) 鈫?swept to `@linxiraos/*` with the RENAME_BY_TAIL mapping; a bad perl pass truncated some to `@oh/` (12 files) 鈥?repaired.
   - Class-4 variant (lost upstream hunks in conflict resolution): `packages/ai/src/auth-storage.ts` merged-block contract (`priorBlockedUntilMs`/`providerTimed`), `session/turn-recovery.ts` provider-timing params, `ai/src/error/flags.ts` `auth-gateway 5xx` retryable pattern, `utils/src/fetch-retry.ts` longest-wins parser rewrite, `openai-codex-responses.ts` abort-cause chain, `session-advisors.ts` `providerTimed` field, `agent-session-retry-cap.test.ts` (+1480 lines) and `auth-storage-force-refresh-rotate.test.ts` 鈥?all restored from v18.1.16 with scope rekey. Systematic hunk-level scan against `u-v18.1.14鈫抲-v18.1.16` additions confirms zero remaining losses (excluding intentional Zeta surfaces).
   - Tests: `task`/`modes`/`session` buckets show zero HEAD-unique failures vs main; `ai` bucket zero HEAD-unique (6 main flakes fixed); `retry-cap` 51/51. Remaining local failures are Windows-only noise (git-worktree tests writing `:(glob)*` paths, native `.node` stale per class 5) 鈥?CI bazel unaffected.
   - Upstream changelog sections (## [18.x]) dropped from package CHANGELOGs; version line realigned to 1.1.12 via `set-version.ts` + `bun install`.
- **Note**: upstream migrated its lint/format toolchain to oxfmt/oxlint; Zeta's check pipeline now mirrors upstream 鈥?`prefer-const` on definite-assignment `let` (8 sites) is a pre-existing main debt, unchanged by this merge.

## v18.1.13 + v18.1.14 (Zeta 鈥?merged as PR #14, dual-tag serial merge)

- **Baseline**: v18.1.10 (`f241301c8372`, Zeta `e325c888d9`)
- **Source tags**: `v18.1.13` (peeled `a1b254047d12e143b7c6011536e918c6c35c5906`) merged first, then `v18.1.14` (peeled `daf07999c2fee9b22edc7bf8fea1fb6272e0df5e`) on the same `sync/omp-release/v18.1.14` branch; both verified via `git ls-remote --tags omp-upstream`, both ancestor-checked in HEAD.
- **Merge commits**: `711d230673` (v13, two-parent) 鈫?`e522237bb0` (v14, two-parent on top).
- **Zeta adaptation commits**: scope rewrite + version line 1.1.10 + brand overlay + i18n/tool-schema contracts + changelog rekey + idle-compaction async-wake guard; methodology in `document/merge-playbook.md` 搂鍙?tag 杩炵画鍚堝苟鏂规硶璁?
- **CI rounds and damage found**:
   - Round 1: `bun install --frozen-lockfile` dead in every job (damage class 1 fingerprint) 鈥?merged `bun.lock` carried duplicate workspace keys + stale catalog; regen fixed it.
   - Round 2: three damage sites: (a) conflict resolution had dropped the Zeta-only `/plan-ultra` registry entry and reverted Zeta i18n `M.*` descriptions to upstream hardcoded strings (class 4, detector: `plan-ultra.test.ts` + `i18n-slash-commands.test.ts`); (b) v14's new `changelog-summary.test.ts` (lexer contract) was silently dropped in a delete/modify resolve (class 4/6 鈥?"tests are contract" violation), and its companion source change (`summarizeChangelogEntries` lexer rewrite) was missing; (c) `Cargo.lock` stale vs v14 manifests (`cargo fetch --locked` / `cargo-deny --locked` red). Fixed: restored registry from main baseline, adopted the v14 test+source pair wholesale with the shipped-notes contract rekeyed to the Zeta 1.1.10 line, consolidated the duplicate `1.1.10` changelog sections (omp18.1.x sync bodies folded in, one uncategorized bullet kept above the headings per the contract), `cargo update` + committed lock.
   - Round 3: Zeta Nix `bun-lock` check red 鈥?the merge had also pulled the **upstream OMP `nix/bun.nix`** back in (old bun2nix format without `name =`, OMP dependency set incl. the removed oxfmt/oxlint), plus locally regenerated `bun.lock` carried `registry.npmmirror.com` URLs from the local mirror config. Fixed by regenerating `nix/bun.nix` with the pinned bun2nix 2.1.2 from the Zeta `bun.lock` and normalizing lock URLs back to npmjs.org.
   - Round 4: CI 20/20 + Zeta Nix green 鈫?merged as PR #14 (`caef3818cc`).
- **New standing rule** (from this sync): `nix/bun.nix` is Zeta-owned release surface 鈥?after any `bun.lock` change, regen with `bunx bun2nix -l bun.lock -c ../ -o nix/bun.nix` (bun2nix 2.1.2, same rev as flake.lock) and normalize lock registry URLs to npmjs.org before pushing; the flake's `bun-lock` check is the detector.

## v18.4.4 (Zeta 鈥?sync/omp-release/v18.4.4,鍗?tag 澧為噺鍚堝苟,2026-10-02)

鍥炶 playbook 鍗?tag 澧為噺鏂瑰紡(v18.4.3 鈫?v18.4.4)銆傚悎骞朵簬闅旂 worktree
`zeta-sync-1844`,鍏ㄩ儴 174 鍐茬獊閫愬潡鎵嬪伐 resolve,鏃犺嚜鍔?squash銆佹棤 stage-3
鎵归噺鍙栬竟銆?
| 椤?     | 鍊?|
| ------- | --- |
| 璧风偣    | `main` @ `61c35ed82a3`(v1.1.23 tag 鎵€鎸? |
| v18.4.4 | 杞婚噺 tag = commit `8ac1309bd8adaddc891eeb389c545345073875be`(ls-remote 鏍搁獙);merge-base = v18.4.3 `fc671eba383f` 鉁?鐪熷弻浜?merge `1882c662448` |
| 澧為噺    | 涓婃父 wire/native describe(TSP)闈㈡墿寮犮€乧ontext-usage span 閲嶅啓銆乣sceneFooterHint` 鍔ㄦ€侀敭浣嶃€乣showModelCycleTrack(segments, activeIndex)` 绛惧悕婕旇繘(娓叉煋涓嬫矇 interactive-mode + describeSegmentTrack)銆乸i-wire 绫诲瀷杩涘叆 interactive-mode |

**v18.4.4 鍐茬獊鍐崇瓥(174)**:

- **97 scope 鍣０妗?*:stage-3 鍙?theirs + 鍏ㄦ爲 scope 鏄犲皠閲嶅啓(636 澶?
  pi-coding-agent鈫抸eta銆乷mptype鈫抪i-omptype銆乻napcompact鈫抪i-snapcompact銆?  omp-stats鈫抪i-stats;keeper:brand drivers銆乴egacy-pi-canonical銆?  windows-staging)銆?- **绫?4 鎭㈠**:Zeta sidebar 闈?`SidebarComponent` 鏋勯€犱笌涓婃父
  `onNativeAction`/`onNativePullRequest` 鍙屼繚);`selector-helpers`
  `searchableChar`+`extractPrintableText`(鑷姩鍚堝苟闈欓粯涓㈠純,TS2305 鎵嶆毚闇?;
  splash `skipHint` 鎭㈠ + native describe wordmark 澶嶄綅 "Z e t a";
  event-handler 琛?`state_version_changed` + 涓婃父 `queue_update` 鍙屼繚銆?- **涓婃父婕旇繘鍚告敹**:`showModelCycleTrack` 閲囩敤涓婃父鍙屽弬褰㈡€?controllers 鍘绘帀
  renderSegmentTrack 棰勬覆鏌?;`sceneFooterHint()` 鍔ㄦ€侀敭浣嶆浛浠ｇ‖缂栫爜鎻愮ず;
  composer-shape-preview/theme/queue-mode/thinking 鍥?overlay 鐨?  `zeta.overlay.*` 绗簩鍙備繚鎸併€?- **union 鍙犱激杩斿伐**:select-list `#statusText` 鍙?return 鍙犲啓銆乽i-helpers
  read-tool-group import 鏂ご銆乧ontext-usage.ts 鍑芥暟浣撳弻瀹炵幇鑺辨枒(鏁翠綋鍙?  theirs span 閲嶅啓鐗?鈥斺€旀暀璁?union 鍚堝苟鍣ㄥ彧鍙敤浜?import 鍧椾笌娉ㄥ唽琛?
  鍑芥暟浣撶鐢ㄣ€?- **CHANGELOG**:356 涓笂娓?15.x鈥?8.x 娈典粠 packages/*/CHANGELOG.md 鍓ョ
  (妫€娴嬭鍒?`^## \[1[5-8]\.`);Zeta 娈典笌 [Unreleased] 淇濈暀銆?- **鐗堟湰绾?*:set-version 1.1.23 鏁寸嚎瀵归綈(Cargo/main workspace/natives
  sentinel/desktop/badge/BUILD.bazel);bun.lock 閲嶇敓鎴?catalog 13 閿叏楠岃瘉銆?- **worker argv 鍗忚**(绫?11):涓婃父鏂?worker `__omp_worker_text_predict` 鈫?  `__zeta_worker_text_predict`,stt/tab/tts 涓夊瀵归綈 cli.ts 娲惧彂琛?
  娴嬭瘯 env `PI_CODING_AGENT_DIR`鈫抈ZETA_CODING_AGENT_DIR` 涓ゅ銆?- **闂ㄧ**:check:ts / oxfmt / cargo fmt / version-consistency / brand-check
  (0 hit)/ zeta-sentinels(46)/ ci-surface 鍏ㄧ豢;tui 鏈湴娴嬭瘯鐩稿
  main 鍩虹嚎闆舵柊澧炲け璐?15 涓袱渚т竴鑷寸殑 Windows 鐜鍥虹孩)銆?
## v18.4.3 (Zeta 鈥?dev/main 瀹為獙绾?浜?tag 鐩存媺鍚堝苟,2026-09-29)

鐢ㄦ埛鎺堟潈璺宠繃鍒嗘,浠?v18.3.4 鍩虹嚎涓€姝ョ洿鎷?v18.4.3(瑕嗙洊 v18.3.5/v18.4.0/v18.4.1/
v18.4.2/v18.4.3 浜斾釜 tag 鐨勫閲?銆傚共璺?255鈫掑疄璺?288 鍐茬獊(澶氬嚭鐨?33 涓洪攣鏂囦欢/
CI 宸ヤ欢绫绘満姊板啿绐?,璋辩郴妫€鏌ラ€氳繃銆?
| 椤?     | 鍊?                                                                                                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 璧风偣    | `dev/main` @ `e72cdcea7bc`(v18.3.3+34 鍚堝苟鍚庡熀绾?                                                                                                                                                         |
| v18.4.3 | tag `fc671eba383f2a7208500836673b485c0dc7073d`(杩滅▼鏍搁獙鏈Щ鍔?;merge-base = v18.3.4 `dff728c572a` 鉁?                                                                                                      |
| 澧為噺    | 656 鎻愪氦;涓婃父鎬ц兘澶у勾鈥斺€攃ache-warming銆佹姇鏈?task 鍚姩銆乬rep 娴佸紡鑳屽帇銆丱niguruma 楂樹寒(鍐呭瓨 鈭?x)銆佹祦寮?transcript/宸ュ叿鐑矾寰勫ぇ鎵櫎(PR #13650)銆亊20 杩炲彂 perf(tui)(棣栧睆 722ms 鍒嗗抚銆乷verlay 300KB鈫?KB 甯у啓鍏? |

**v18.4.3 鍐茬獊鍐崇瓥(288)**:

- **绫?4 鎭㈠(鎵归噺 stage-3 鍚庨€愰」)**:InteractiveMode sidebar 闈?  (`SidebarComponent` 鏋勯€?`applySidebar`/`handleSidebarToggle`/
  `handlePlanUltraCommand` + `PlanWorkflow` ultra 鍙傛暟閾?
  `handlePlanModeCommand` 绗笁鍙?+ `#enterPlanMode` 绫诲瀷鍥?`PlanWorkflow`);
  tui component `getSidebarContext`/`setStatusLineSidebarOpen` + 涓ゅ
  `session_name` 娈甸殣钘忔潯浠?`SttCallbacks.requestRender`(STT 瀛愮郴缁熷叏 Zeta
  鑷湁);segments.ts `turn_stats` 娈?schema/turn-stats.ts 瀛樻椿,浠呮敞鍐岄」涓㈠け)銆?- **UD 澶勭疆浜嬫晠涓庝慨澶?*:鏃犲樊鍒?`git rm` 寰幆鎶?stage-3 澶辫触鏂囦欢涓庣湡 UD 娣峰垹,
  182 涓?staged 鍒犻櫎涓?127 涓笂娓镐粛鍦ㄢ€斺€旂粡 `git cat-file -e v18.4.3:$f` 鍏ㄩ噺
  瀹¤鍚庢寜 scope 褰掍竴鍖栨寚绾逛笁鐗堣剼鏈仮澶?65 鍙?theirs+娓呮壂銆?2 鍙屾敼鍙?theirs)銆?  鏁欒:UD 寰幆蹇呴』鍏堟帰娴?stage-3 鍙緱鎬?涓嶅彲鐩插垹銆?- **web/search modelRoles 杩佺Щ澶勭疆**(涓婃父鎶?provider 閫夋嫨杩佸埌 role chain + TUI
  `web-search-types`):
   - 淇濈暀骞堕噸寤?`types.ts` Zeta 瀵煎嚭(`SEARCH_PROVIDER_ORDER/CHOICES/
PREFERENCES`/`isSearchProviderId/Preference`)鏀逛粠 TUI `SEARCH_PROVIDER_LABELS`
     娲剧敓(涓庝笂娓告柊浼樺厛绾у簭瀵归綈);`index.ts` 閲嶅鍑?setter;`geminiModel` 绠￠亾
     (providers.webSearchGeminiModel 鈫?provider.search)鎭㈠;`provider` pin 鍙傛暟
      - scoped 杩囨护鍧楁仮澶?涓婃父宸插垹 `hoistProvider`鈥斺€旇€冭瘉鍏跺湪鍩虹嚎鍗虫棤鏁?engine
        marker 妯″瀷 `provider` 瀛楁鎭掍负 "web",璇箟鍏ㄥ湪杩囨护鍧?;exclusion 灞傚畬濂?        (public.ts 鎵囧嚭杩囨护瀛樻椿)銆?   - 闅忎笂娓告斁寮?setup 鍚戝 search-provider 姝ラ(鍚戝鏁翠綋閲嶅啓,`saveSearchProvider`
     姝讳簬閲嶅啓;providers tab 浠嶆槸閰嶇疆鍏ュ彛)銆?   - **鎯版€у寲鍐崇瓥**:webSearchOrder 鍦ㄥ熀绾垮嵆鎯版€?`resolveProviderCandidates`
     0 璋冪敤鏂?orderedProvIds 鏃犺鑰?,缁存寔鍩虹嚎褰㈡€佷笉鍔犳垙;**image 渚?     `providers.imageOrder` 杩愯鏃舵秷璐归殢鏃?candidate 寰幆琚笂娓稿垹闄よ€屽け娲?*
     鈥斺€擿setImageProviderOrder` 淇濈暀涓虹姸鎬佺瀛?settings 闈?zh 缈昏瘧/legacy 杩佺Щ/
     provider-globals 娴嬭瘯濂戠害瀹屾暣),鎸?role chain 鐨勯噸闆嗘垚鍒椾负鍚庣画宸ヤ綔銆?- **鍝佺墝**:logger 鏃ュ織鏂囦欢鍚嶅洖 `zeta.*`(涓婃父 v18.1.17+ omp.* + 鏂?stderr-guard
  `onRotate` 鏈哄埗淇濈暀);dirs.ts `expandWindowsLongPath` import scope 褰?  `@linxiraos/pi-natives/path`;jfind `omp://`鈫抈zeta://` 鍏ㄩ噺娓呮壂(鍚?  `complete("zeta")` scheme 鍓嶇紑鈥斺€旇８ `"omp"` 瀛楃涓?sed 鎵笉鍒?闈犳祴璇曟毚闇?;
  stats README銆乧omposer-cache 娉ㄩ噴銆乬it-utils 娴嬭瘯 fixture 鍥?linxira-zeta;
  `Symbol.for("omp.expectedCleanupError")` 淇濈暀(postmortem.ts 婧愮爜鍗虫鍚?
  杩涚▼闂村崗璁鍙?;娴嬭瘯鏂囦欢鍚嶅鍚屾(logger-contract/stderr-guard/rotation
  probe 鍏ㄩ儴 zeta.*)銆?- **娴嬭瘯濂戠害**:runtime-global-dispose 瀹氫负銆屼笂娓?v18.4.3 褰㈡€?+ scope 鏀瑰悕 +
  `__zeta_*` 绗﹀彿娓呮壂銆嶁€斺€斿悎骞舵浘鎶婁笂娓哥増鍘熸牱甯﹀叆(鍥為€€浜?v18.1.21 娓呮壂),
  淇鏃跺厛鍙栧熀绾挎暣鏂囦欢,鍚庢寜 tag 绐楀彛鏍稿(v18.3.4鈫抳18.4.3 璇ユ枃浠跺敮涓€涓婃父
  鍔ㄤ綔 = `aa5aab0ffb4` 娴嬭瘯娓呮壂鎻愪氦鍒犻櫎 dispatcher identity 鍐椾綑娴嬭瘯)鏀逛负
  璺熼殢涓婃父鍒犻櫎銆佷繚鐣欐竻鎵€斺€斾笌涓婃父鏈€灏忓垎鍙夈€?- **changelog**:鍚勫寘涓婃父娈靛叏鍓?鍚?legacy 15-18.x 妗ｆ娈?銆?- **鐢熸垚鐗?*:rules.json/catalog 缂栬瘧鐗┿€乥un.lock銆乶ix 涓変欢濂楅殢鍚堝苟鍒锋柊;
  MODULE.bazel.lock 鏃犳湰鍦?bazel,缁存寔 CI 楠岃瘉鍥炶矾(杩囨湡鍒欏彇宸ヤ欢鍥炴彁)銆?
**natives 绫?5(鍙屽钩鍙?**:鍚堝苟鏂板 `expandWindowsLongPath`(Windows 8.3 璺緞
灞曞紑)銆乣summarizeCodeAsync`(tree-sitter 绾跨▼姹犲寲)銆乬rep `onMatches` 娴佸紡+
鑳屽帇銆傛湰鍦伴噸寤鸿矾寰?Windows 渚ф棤 VS Build Tools 鏃剁敤 GNU 宸ュ叿閾炬浛浠ｂ€斺€?`rustup target/toolchain install nightly-<pin>-x86_64-pc-windows-gnu` + msys2
ucrt64 gcc,`cargo build -p pi-natives --target x86_64-pc-windows-gnu --profile
local`,浜х墿鏀瑰悕 `pi_natives.win32-x64-modern.node`(瀹夸富 build script 浼氭挒
link.exe:Git Bash 鐨?GNU link.exe 閬斀 MSVC linker);Linux 渚?WSL 鍚屾硶
(`x86_64-unknown-linux-gnu` 鈫?`libpi_natives.so` 鈫?`pi_natives.linux-x64-
modern.node`)銆侰I bazel 鐜板満鏋勫缓涓嶅彈褰卞搷銆?
**娴嬭瘯瑁佸喅**:

- WSL Rust(test:rs):3084/3085 閫氳繃;鍞竴澶辫触 `detach_git_dir_..._snapshot_fails`
  涓?WSL-root 鐜鍣０(chmod 000 鎷︿笉浣?root,娴嬭瘯鍓嶆彁澶辨晥;娴嬭瘯浣撲笌瀹炵幇
  涓夋柟閫愬瓧涓€鑷?CI 闈?root Linux 涓嶅彈褰卞搷)銆?- **WSL coding-agent 鍏ㄩ噺(鑴忔爲鐘舵€?1602 staged 鏂囦欢)璇垽鏁欒**:鍗曡繘绋?  `bun test` 涓?InteractiveMode 绯诲垪鎴愮墖 5s 瓒呮椂(鍗曟祴璇曢殧绂?<1s銆佹斁澶?timeout
  鍚?25-52s)鈥斺€旀牴鍥犳槸姣忎釜 InteractiveMode 瀹炰緥缁?pi-vcs `status_porcelain`
  瀵硅繘绋?cwd(鏈粨搴?spawn `git --no-optional-locks status`,鍚堝苟涓殑鑴忔爲 +
  WSL drvfs 浣挎瘡娆℃暟绉掋€佸苟鍙戝彔鍔犳垚椋庢毚銆傜函涓婃父/鍩虹嚎 worktree(骞插噣鏍?鍚屾祴璇?  椋炲揩浣愯瘉銆?*闈炰唬鐮佸洖褰?*;fresh checkout 鐨?CI 涓庢彁浜ゅ悗鐨勫共鍑€鏍戜笉鍙楀奖鍝嶃€?  鍗曟枃浠堕殧绂诲璺?33 涓け璐ユ枃浠?20 涓函涓茶窇姹℃煋浜х墿;鍏朵綑涓?zh 缂哄彛(宸蹭慨)銆?  `.omp` 濂戠害(宸叉壂)銆乻ymlink/EBUSY/drvfs 鐜鏃忋€?- Windows utils 鍖?12 澶辫触涓庡熀绾?worktree **閫愭潯涓€鑷?*(瀹夎閿?zip symlink/
  SQLite 鎹熶激鎭㈠/EBUSY 鏃?鈥斺€旈浂鍑€澧炪€?- Windows coding-agent 鍏ㄩ噺:234 澶辫触 + 1 鎸傛(collab 鍚庢煇娴嬭瘯)灞?Windows
  鍣０鏃忓舰鎬?EBUSY 涓存椂鐩綍/5s hook 瓒呮椂),WSL Linux 鍏ㄩ噺涓鸿鍐崇幆澧冦€?- jfind `complete("omp")`鈫抈complete("zeta")`銆乴ogger 鏂囦欢鍚嶅銆乺untime-global
  娓呮壂鎭㈠鍚庡悇鑷《鍏ㄧ豢;cli-provider-settings 2 瓒呮椂缁忓熀绾?worktree 瀵圭収鍒や负
  鏃㈡湁 Windows 鍣０(TempDir.remove 鍙ユ焺婊炵暀)銆?- **鍚堝苟姣旇緝瑙勮寖绾犲亸(鐢ㄦ埛鎸囧嚭)**:鍐茬獊鑰冭瘉涓€寰嬬敤涓婃父 tag 绐楀彛宸紓
  (v18.3.4鈫抳18.4.3),涓嶅緱鐢ㄦ垜浠爲 vs 涓婃父 tag(浼氭妸 Zeta 鍒嗗弶宸紓璇綋鎹熶激)銆?  宸叉寜姝ｇ‘褰㈠紡閫愭枃浠跺鏍?agent-session.ts 涓婃父绐楀彛 375 鏂板琛屽叏閮ㄥ湪浣?
  鍏ㄩ儴鍚堝苟鍚庤Е纰版枃浠剁殑"缂哄け琛?鍧囦负 scope 鏀瑰啓/鍝佺墝娓呮壂鐨勭瓑浠峰舰鎬?鏃犱笂娓?  鍐呭涓㈠け銆?
**鎺ㄩ€佸墠 CI 椋庨櫓棰勬壂(绗笁杞儻渚?鍛戒腑骞朵慨澶?*:

- **绫?7 鍥炴疆**:鍚堝苟鎶婁笂娓?ci.yml 鐨?12 澶?omp-kata runner 甯﹀洖(10 澶?  `pull_request && ubuntu || omp-kata` 鏉′欢 + 2 澶勮８ omp-kata;dispatch 浜嬩欢
  浼氭墦鍒颁笉瀛樺湪鐨?runner 鎺掗槦姝?銆傚叏閮ㄦ仮澶?ubuntu-22.04;needs 鍥炬牎楠屾棤鎮寕銆?- **changelog 娓呮壂杩囧垏(鑷激)**:鍓斾笂娓告鏃舵妸 6 涓寘鐨?*宸插彂甯冩**鍐呭涓€骞?  娓呯┖(coding-agent 1.1.10 鍗佹潯銆乧ollab-web 1.0.0銆乵nemopi 1.1.19銆?  natives 1.1.11銆乻tats 1.1.19銆乽tils 1.1.18 鍚勪竴鏉?,杩濆弽"Released 娈?  涓嶅彲鍙?;changelog-summary 濂戠害娴嬭瘯閫綇,宸叉寜鍩虹嚎鍥炴,49 椤瑰绾﹀叏缁裤€?  鏁欒:changelog 娓呮壂鍙厑璁稿姩 omp 閿(濡?`1.1.21-omp15.11.1` 涓庝笂娓?  archive 閾炬帴琛?,宸插彂甯?1.1.x 娈甸€愬瓧涓嶅姩銆?- **绫?9 鏀跺熬**:worker-core.test 鍚岃娣锋壂(`__zeta_worker_core_gate` +
  `__omp_session__`)缁熶竴涓烘簮鐮佹敞鍏ョ殑 `__zeta_session__`;browser-recording
  鐨?`__omp_recording_cursor__` 涓庢簮鐮佷竴鑷翠繚鐣欍€?- **閬楃暀(dev鈫抦ain 鍚堝苟鏃跺喅绛?**:release 鐭╅樀涓?bazel-cache-warm 鐨?  `xcode-27`(涓婃父鑷湁 ARM macOS runner)鈥斺€攖ag/main 浜嬩欢鎵嶄細瑙﹀彂,灞婃椂
  鏄犲皠涓烘墭绠℃爣绛炬垨鎸?v18.3.3 瑁佸壀鍐崇瓥澶勭悊;`ubuntu-24.04-arm`/`windows-11-arm`
  涓?GitHub 鎵樼鏍囩,淇濈暀銆?
**CI 棣栬疆(36598768135)澶辫触澶嶇洏涓?姣忚疆鍚岀被閿欒"鏍瑰洜(鐢ㄦ埛鍛介,2026-09-30)**:

鍏釜绾?job 鐨勯€愰」鏍瑰洜鈥斺€斿叏閮ㄥ綊浜?*鍚屼竴缁撴瀯鎬х梾鏍?*:

| 澶辫触 | 鏍瑰洜 | 淇 |
|---|---|---|
| session-resolution 脳7 | main.ts hint "Run \`omp --resume\`" 鏈壂,娴嬭瘯鏈熸湜 zeta | 娓呮壂 + 瀹堝崼 |
| xAI UA | 娴嬭瘯姝ｅ垯 `/^omp\/\d/` 鏈壂(USER_AGENT 婧愭槸 zeta/) | 娓呮壂 + 瀹堝崼 |
| baseten 榛樿妯″瀷 | 涓婃父 models.json 鎹㈡帀 Kimi-K2.7-Code,Zeta 鎻忚堪绗﹂粯璁ゅ€兼紓绉?| KDL 榛樿鈫扠3 + gen:compat |
| agent-storage | 娴嬭瘯 env 鍧楁槸涓婃父濂戠害 `PI_CODING_AGENT_DIR`,婧愮爜鍙 ZETA_* | env 鍧楀洖鍩虹嚎 + 瀹堝崼 |
| js-executor/js-pkg-env/eval-timeout/install-smoke | **`JS_EVAL_PROCESS_ARG="__omp_worker_js_eval_process"`(婧?vs cli.ts 鍙淳鍙?`__zeta_worker_*`**鈥斺€斿瓙杩涚▼褰撴櫘閫?CLI 鍏ㄩ噺鍚姩鍚庢姤閿欓€€鍑?worker init 10-15s 瓒呮椂绾ц仈("JS context disposed"/"No models available" 鍧囧叾杩為攣) | 鍗忚鍚嶅榻?鎵ц 10.9s鈫?.3s=鍩虹嚎姘村钩,WSL 鍏ㄧ豢) |
| windows-staging | 澶瑰叿鍐欐 15.10.x(鐩稿涓婃父 18.x 鏄?鏃х増"),鎴戜滑 1.x 鐗堟湰绾垮垽瀹氱炕杞?| 澶瑰叿闅?currentMajor 鎺ㄥ |
| composer XDG | 娴嬭瘯鏈熸湜 `$XDG_CACHE_HOME/omp/鈥,婧愮爜鏄?zeta/ | 娓呮壂(Linux 楠岃瘉) |
| MODULE.bazel.lock | **Cargo.lock 12 琛岀増鏈嚎淇(18.4.3鈫?.1.21)鍦ㄩ攣鐢熸垚涔嬪悗**,crate_universe 鍝堝笇澶辨柊 | 鍙?CI 鍒锋柊宸ヤ欢鍥炴彁(5 琛屽搱甯? |

**涓轰粈涔堟瘡杞悎骞堕兘鍦ㄥ悓鍑犵被涓婄炕杞?缁撴瀯鎬ф牴鍥?**:

1. **鍙岄潰 token 鍙壂涓€闈?*銆俍eta 娓呮壂鏄?鎶婁笂娓稿搧鐗岄潰鏀规垚鎴戜滑鐨?,浣嗗悓涓€
   token 寰€寰€瀛樺湪浜?*鐢熶骇鑰呬笌娑堣垂鑰呬袱渚?*(婧愮爜 vs 娴嬭瘯銆丣S vs Rust銆?   spawn 鍙傛暟 vs 娲惧彂琛?銆備汉宸?sed 鎸夋枃浠?鎸夋ā寮忔壂,姘歌繙鎵笉榻?鑰?   `check:ts` 瀵瑰瓧绗︿覆/姝ｅ垯/env 鍚?*瀹屽叏澶辨槑**鈥斺€旈敊閰嶇紪璇戝叏缁?鍙湪
   杩愯鏃?CI 鐐搞€傝繖鏄渶澶х殑鏃堕棿榛戞礊銆?2. **瀹堝崼琛ㄥ彧璁?鍝佺墝闈?,涓嶈"濂戠害闈?**銆俠rand-rules 鍘熸湁瑙勫垯鐩?   蟺/PI_LOGO/scope/URL scheme,浣?worker 鍗忚鍙傛暟銆乪nv 鍚嶃€乁A 姝ｅ垯銆?   CLI 鎻愮ず涓茶繖浜?璺ㄩ潰濂戠害 token"涓嶅湪琛ㄩ噷鈥斺€旀瘡杞潬 CI 璇曢敊鍙戠幇銆?3. **涓婃父娴嬭瘯澶瑰叿鎼哄甫涓婃父鍧愭爣**(鐗堟湰鍙?15.10.x銆乺unner 鏍囩 omp-kata銆?   鍚戝姝ラ)鈥斺€旇繖浜涗笉鏄搧鐗?鏄?涓婃父涓栫晫鍋囪",鍚堝苟鍘熸牱甯﹀叆鍗抽敊銆?4. **鐢熸垚鐗╅『搴忚€﹀悎**:Cargo.lock鈫扢ODULE.bazel.lock 鐨勫搱甯岄摼,鐗堟湰绾?   淇蹇呴』鍦ㄥ叾涓婃父涓€鍒?Cargo 鍙樻洿涔嬪悗閲嶅埛,鍚﹀垯 freshness 闂ㄧ绾€?5. changelog 娓呮壂鏃犳钀芥劅鐭?鏈疆鑷激宸茶堪)銆?
**瀵圭瓥(宸茶惤瀹?**:`brand-rules.ts` MUST_NOT_CONTAIN 鏂板"璺ㄩ潰 token 瀵?
缁?`__omp_worker_*`(argv 鍗忚)銆乣PI_CODING_AGENT_DIR`(env 濂戠害)銆?`USER_AGENT` omp/ 妯℃澘涓?`/^omp\/\d` 娴嬭瘯姝ｅ垯銆乣` Run `omp `` CLI 鎻愮ず鈥斺€?鍛戒腑鍗崇孩,producer/consumer 涓や晶鍚屽彈绾︽潫;瀹堝崼棣栬窇鍗抽€綇 Rust 渚?crash_handler 璇绘棫 env 鍚嶇殑**鍩虹嚎閬楃暀鍚岀被鐥呯伓**(椤烘墜娌绘剤:ZETA_* + fmt 缁?銆?涓婅〃鍚勪慨澶嶉殢 `bun scripts/brand/brand-check.ts` 甯搁┗ CI check job銆?
**CI 绗簩杞?36658419425)鍞竴绾⑩啋鎹熶激绫?4 鍥炲綊**:singleton bucket
official-skills 3 澶辫触(provider 鏈敞鍐?docx-pptx 鏈彂鐜?embed seeding 澶辫触)銆?鏍瑰洜:鍚堝苟鍐茬獊瑙ｅ喅鎶?`discovery/builtin.ts` 閲?Zeta-only 鐨?**zeta-official
provider 娉ㄥ唽鍧楁暣娈?~80 琛?鍚?embed seeding)闈欓粯涓㈠純**;`check:ts` 鍏ㄧ洸
(甯搁噺 `OFFICIAL_SKILLS_PROVIDER_ID` 浠嶅湪 capability/skill.ts,绫诲瀷涓嶆柇),
CI 娴嬭瘯濂戠害鎵嶉€綇銆備慨澶?`2c7b29d825e`:鎸夊熀绾?7d88e8190f9 閫愬瓧鍥炴,娈嬩綑
diff 鎭颁负涓婃父 agentDir 璇箟銆傛暀璁苟鍏ユ牴鍥?1 鐨勫彉浣?**Zeta-only 娉ㄥ唽鍧?涓嶄骇鐢熺被鍨嬮敊璇?鍞竴瀹堝崼鏄祴璇曞绾?*鈥斺€攐fficial-skills 涓や釜娴嬭瘯鏂囦欢灏辨槸
璇?provider 鐨勫摠鍏?鍚堝苟鏃跺嚒瑙?builtin.ts 蹇呴』鏈湴璺戝畠浠?宸插姞鍏ラ鎵竻鍗?銆?鍙?agent-plugins 绗﹀彿閾炬帴閫冮€告祴璇?Windows 鏈湴 4 绾?鍩虹嚎鏃㈡湁鍣０
(symlink 鏉冮檺),CI Linux 缁?涓嶈拷銆?
**鎹熶激绫?7 杩借(v18.4.3 绗笁澶?**:鍚堝苟 `7137261d83e` 閲嶅啓 ci.yml
(300+/429-)鏃舵妸鍥涗釜 Zeta-only job(editor_tests銆乼ermide_tests銆?release_editor_packages銆乺elease_work_packages)涓?push/PR 鐨?desktop/web-ui/editor/termide path filters 鍏ㄩ儴鐮告帀鈥斺€旂嫭绔?editor/ide-publish.yml 骞稿瓨,鏁呮墜鍔ㄨˉ鍙戜粛鍙敤,浣?release tag 鑷姩閾捐矾
鏂€備慨澶?`7d588b2503b`(ide 鏇村悕杞竴骞舵仮澶?release_work_packages鈫?release_ide_packages)銆傛暀璁?**ci.yml 鏄?鎴戜滑鐨?CI 闈?,鍚堝苟鏃跺繀椤诲鐓?鍩虹嚎 job 娓呭崟閫愬悕鏍稿**,brand-check 鐨?runs-on 瑙勫垯鍙槻涓婃父 runner 娣峰叆,
涓嶉槻 Zeta job 涓㈠け鈥斺€攋ob 闆嗗悎瀵硅处宸叉満姊板寲涓?`bun
scripts/check-ci-surface.ts`(2026-09-30,job 娓呭崟/needs 鎺ョ嚎/浜х墿鍚嶄笁鏌?
娉ㄥ唽琛?`scripts/brand/ci-surface-registry.ts`);璐︽湰浠嶉渶璁板綍姣忔瑁佸壀/鏀瑰悕
鍐崇瓥,娉ㄥ唽琛ㄩ殢鍐崇瓥鍚?PR 鏇存柊銆?

## v18.3.3 + v18.3.4 (Zeta 鈥?dev/main 瀹為獙绾?澧為噺鍙?tag 涓茶仈鍚堝苟,2026-09-29)

鎸夈€屼笂娓稿閲忓悎骞惰绋嬨€嶅湪 `dev/main` 涓婂畬鎴愮殑涓ゆ涓茶仈鍚堝苟;骞茶窇棰勬祴涓庡疄璺戦€愪釜
鐩哥(v18.3.3:135;v18.3.4:15),璋辩郴妫€鏌ュ叏绋嬮€氳繃銆?
| 椤?     | 鍊?                                                                                                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 璧风偣    | `dev/main` @ `7d88e8190f9`(14 鎵?CI 淇鍏ㄧ豢鍩虹嚎,CI 36435585671)                                                                                                                                         |
| v18.3.3 | tag `608ac7360ff`(杩滅▼鏍搁獙鏈Щ鍔?;merge-base = v18.3.2 `7853b4e4999` 鉁?鍚堝苟鎻愪氦 `c9b8c2d1413`                                                                                                            |
| v18.3.4 | tag `dff728c572a`;merge-base = v18.3.3 鉁?鍚堝苟鎻愪氦 `14e774c9d94`                                                                                                                                          |
| 澧為噺    | v18.3.3:454 鏂囦欢/31k 琛?TUI autocomplete+@-mention銆丼molLM 棰勬祴鏂囨湰銆乶atives 鍝ㄥ叺鈫抯tamp 鏈哄埗銆丆I 鍩哄缓閲嶆瀯);v18.3.4:143 鏂囦欢/32k 琛?vendored napi 绾跨▼ env 娉勬紡淇銆乼ask effort 閲嶆瀯銆乸rompt cache 淇濆叏) |

**v18.3.3 鍐茬獊鍐崇瓥(135)**:

- 鏈哄埗鍙樻洿鏁村鎺ュ彈:natives 鐗堟湰鍝ㄥ叺 鈫?`__piNativesBuildVersion` stamp 鏈哄埗
  (鍥涗釜 Zeta 妫€鏌ュ櫒鍚屾鏀归敋鏈哄埗绗﹀彿);ci-release-publish 骞跺彂绠＄嚎閲嶅啓
  (editor/work vendored 鍒嗘敮閲嶅珌鎺ヤ负 `publishVendoredNpmDirs`,--dry-run 鍐掔儫);
  ci.yml 閲嶅缓(鎺ョ撼 bazel_lock + native_addons_cross 杩?gate;**瑁佹帀**
  release_binary_hosted/release_github_verify/release_brew 涓変釜 darwin/涓婃父
  tap job 涓?linux-arm64 鍙戝竷鐭╅樀鈥斺€斿畨瑁呭櫒闈㈡湭璺熶笂;omp-kata 鍏ㄦ壂涓?  ubuntu-22.04;7 涓?Zeta job 閲嶅簲鐢?;command-usage.ts 涓?  tiny-title-download-progress.ts 闅忎笂娓告満鍒舵浛鎹㈠垹闄ゃ€?- **鎷掔粷涓婃父 OMP_PROFILE env 浼樺厛绾?*(涓庣敤鎴锋満鍣ㄤ笂鐪?OMP 鍐茬獊),淇濇寔
  ZETA_PROFILE 鍗曟簮銆?- 鎵归噺 stage-3 鍚庣殑绫?4 鎭㈠:AgentSession mode API + state_version_changed銆?  tools/index 浜斾釜 channel/im 宸ュ巶銆両nteractiveMode sidebar/plan-ultra 鎴愬憳銆?  handlePlanModeCommand workflow 鍙傛暟銆乥uiltin registry i18n 瑙ｆ瀽鍣ㄣ€?  worker 鍝ㄥ叺閲嶆壂 `__zeta_worker_`(鍚柊澧?text_predict)銆乑ETA_LOGO/icon.omp銆?  omp鈫抸eta 鎻愮ず涓层€佸洓鏉?slash 鎻忚堪 M 閿寲銆?- 鐢熸垚鐗?rules.json 閲嶇敓鎴?local.kdl lfm)銆乥un.lock/nix 鍒锋柊銆乧hangelog
  rekey 1.1.21-omp*銆乻et-version 鍏ㄧ豢銆?- 娴嬭瘯瑁佸喅:鍑€鏂板澶辫触 16 鍏ㄦ竻(9 淇:hint 涓?plan-ultra 娉ㄥ唽/zh 濂戠害/
  unsettled 鏂█/prewarm 娴嬭瘯杩佺Щ setModelRole;5 Windows 鍣０;2 鎱㈡祴璇?  鈥斺€攛-codex-turn-state SSE 瀵瑰湪 30s 棰勭畻涓嬮€氳繃,CI 120s 瑕嗙洊)銆?  鍩虹嚎宸泦娉?worktree 瀵圭収)鐢ㄤ簬鍖哄垎鏃㈡湁鍣０涓庡悎骞朵激銆?- bunfig 淇壀:root `bun test` 涓嶅啀鎵?editor/termide/web-ui(鍚勬湁鐙珛闂ㄧ)銆?
**v18.3.4 鍐茬獊鍐崇瓥(15)**:鍏ㄩ儴鏈烘(Cargo 鐗堟湰琛屼繚 1.1.21 + napi vendor
鏉＄洰銆乮mport 骞堕泦銆佹祴璇曟柇瑷€瀹堝崼銆乴ockfiles);鏂版枃浠?scope 娓呮壂;task 妗?Windows 12 澶辫触缁?WSL 鍒ゅ畾涓虹鍙烽摼鎺ユ棌鍣０(Linux 0 fail)銆?
## OMP Web divergence (Zeta 鈥?own-desktop upgrade, upstream frozen)

- **Date**: 2026-09-10; **Branch**: `feat/desktop-ui-upgrade` (from `main@43d39b9f5f`)
- **Policy change**: `omp-web-upstream` is no longer a merge source. `web-ui/`
  is Zeta-owned and diverged as of this branch; only manual cherry-picks from
  `temp/omp-web` hereafter, each recorded here.
- **Baseline before divergence**: `omp-web@c71edcb2a5` (the snapshot
  `web-ui/` was carried at since adoption).
- **Absorbed source**: `omp-web@f09920e` (9/9 overhaul; 136 files,
  +11742/鈭?096) 鈥?semantic port, not raw copy.
   - Absorbed: 21 component overhauls (AppShell/ChatInput/ChatMinimap/
     ModelsConfig/SkillsConfig/FileExplorer/SessionSidebar/鈥?, ExtensionStatusBar
     extraction, useResizablePanel/useViewportHeight hooks, event-stream
     hardening + model-scope overrides in useAgentSession, starfield +
     ViewTransition styling, Windows drive-picker browser helpers,
     git line-stats, request-security hardening, models-config
     catalog/discover/metadata gateway endpoints.
   - Not absorbed (scope boundary): PWA surface (manifest/sw/offline),
     ProjectTrustDialog + project-trust, upstream useI18n catalog (Zeta's is
     stronger), rpc-manager (server-only; superseded by gateway), session-title.
   - Preserved Zeta surfaces: i18n catalog (`lib/i18n` + messages zh-CN/en),
     theme system (40+ JSON themes), gateway rewrite (`/api/*` 鈫?zetacode serve).
- **Ledger discipline**: future omp-web cherry-picks get a dated subsection
  under this entry.

## OMP Release Sync Policy

- Only OMP official release tags are integrated (see AGENTS.md). Never raw commits or `omp-upstream/main`.
- `sync/omp` is an unmodified mirror, never merged into product.
- Integration happens on short-lived `sync/omp-release/<release>` branches, deleted after merge to `main`.

## Current Baselines

- OMP: `v18.11.3` (`96894a6147d8cc64b7e00ad3a7d7178fd93b9531`; two-parent merge
  `24c3da1c56b` ← `5769cf3c771` + `96894a6147d`; the tag was remote-verified before and after the
  merge — see the entry above). The previous anchor was `v18.11.2`
  (`470b7efb67673960d37e3e64584669e6e9caad1c`, two-parent merge `bd6938cbac3` ← `d98033c2694`
  + `470b7efb6`), and before that `v18.11.1`
  (`7cc912940b107eb2d771b0d106c640a8eddc9edf`, two-parent merge `949687f3230` ← `e5b1667537b`
  + `7cc912940b1`, rung 4/4 carrying v18.11.0, with `c86128383f1` → v18.10.4 (rung 3/4), `e78ebe945da` →
  v18.10.3 (rung 2/4, PR #229) and `e72c77df4df` → v18.10.1 (rung 1/4, PR #227) before it). One tag per
  release, each on its own `sync/omp-release/*` branch;
  **next sync target: the next upstream OMP release tag when it appears.**
- Zeta: `1.2.1` (version line holds across the published `@linxiraos/*`
  packages, the Cargo workspace and the natives stamp).
- In flight: `sync/omp-release/v18.11.3` — merge commit `24c3da1c56b` (parents `5769cf3c771` (main) +
  `96894a6147d` (the v18.11.3 tag)) plus the follow-up commits (the CHANGELOG fold, the Zeta surface
  re-application, the model-argument contract fix, the compat regen, the i18n localization, this
  ledger). Pushed twice and dispatched twice: run `39028789166` at `711a5613643` (14 green / 4 red — all
  four were triaged, three fixed as merge residue, one pre-existing `main/` clippy defect) and run
  `39032073476` at `b37ec9a7c98` (17 green / 1 red — only the pre-existing `main/` clippy defect /
  13 tag-gated skips). Its landing on `main` is a maintainer decision and is sequenced with the other
  in-flight branches so `main` takes a single push and a single CI run.

### Zeta-side flake hardening（2026-10-17）

Three load-sensitive flaky tests that the current upstream window brought in were made deterministic
**test-side only** — no implementation change, no assertion weakened, no scope narrowed. Recorded so the
next merge can replay these three files instead of re-triaging them.

- `packages/coding-agent/test/tools/browser-relay-detach.test.ts` — **upstream-new suite** (added by this
  window). Flake: `"does not rerun a call detached before its code started once the re-adoption spent its
  budget"` answered with `omp could not reattach to the tab, so it was released: …` instead of the
  spent-budget report. Cause: the test held the re-adoption for the call's whole budget, while the
  re-adoption's own init budget is `budgetMs + GRACE_MS` **measured from the re-adoption's start** — so
  the hold left its init phases only the 750 ms `GRACE_MS` tail, and under load the worker-init ready
  phase outlived that tail (`Failed to recycle browser tab worker …: Timed out initializing browser tab
  worker`), the recycle failed and the call was released. Zeta side: the call is parked in its pre-code
  reapply (a new `gateSend` hook on the test's Chrome-backed extension) and spends its budget there, the
  re-adoption carries it over the line and runs on the inline fallback (no cold worker realm inside the
  window), and both waits are released by events (worker gone; budget provably elapsed on the clock the
  branch reads) instead of a fixed sleep. Same two assertions, same branch. Also raised this file's
  `beforeAll`/`afterAll`/`afterEach` budgets to 30 s: on a loaded runner Chromium launch/tab teardown
  outlived Bun's 5 s default hook budget and red the file for cleanup that asserts nothing.
- `packages/coding-agent/test/web-gateway/plan-flow.test.ts` — **upstream test, byte-identical to
  `d98033c2694`**. Flake: `approval.error === "Agent is already processing. Use steer() or followUp() to
  queue messages, or wait for completion."`. Cause: `plan_proposed` is emitted from `tool_execution_end`
  (`src/server/web-gateway/agents.ts:458-473`), i.e. **mid-turn**, so `await proposed.promise` never meant
  the session was idle; `plan_approve` prompts, and `AgentSession.prompt` throws `AgentBusyError`
  (`src/session/agent-session.ts:8273-8281`) while the plan turn's closing model call still runs. Zeta
  side: wait for the session's own idle transition (`agent_end`, the frame the runtime defers until the
  owning prompt unwinds) under a hard deadline, then assert the idle precondition. Same assertions plus
  one added.
- `crates/pi-shell/src/shell.rs` — **upstream-new test**
  (`shell::tests::cancellation_keeps_output_open_for_a_term_trap_that_writes`). Flake:
  `fs::read_to_string(root.path().join("cleaned")).expect("TERM cleanup after writing output")` →
  `Os { code: 2, NotFound }`. Cause: the trap's `sleep 0.7` left only ~300 ms of margin against
  `TERM_GRACE` (1 s on unix, `shell.rs:386`) — and against the vendored brush's own 1 s post-cancel
  SIGKILL — so a loaded runner KILLed the trap before it wrote, and the test then read the artifact at the
  instant the cancel resolved. Zeta side: the trap delay matches its sibling test (0.2 s), the trap's own
  `flushing` output and the `cleaned` artifact are waited for on explicit bounds (5 s each) with the run
  result and output in the failure diagnostics, and the trailing `assert_eq!(content, "cleaned")` is the
  original assertion. Compile-unverified locally: the test is `#[cfg(unix)]`, the host is Windows, and the
  pinned `nightly-2026-10-06` has no GNU target installed.

None of the three is an implementation-change request; they are the same upstream tests with their
observation points moved onto the state each assertion actually depends on.
