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

### Accepted: v17.2.11

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
- Deliverable: tag merge integrated into `main` at
  `bd5a049836340f5534b1e071e44679823f0e1f77` (verified with
  `git merge-base --is-ancestor`).

### Pending: v17.2.12

- Prior baseline: `v17.2.11` at `4dc97f89ab78fab003f40142ca0b4ebe68224b14`.
- Source: `refs/tags/v17.2.12` at `45e12e5bb758198a920c6070e7e64cb33b21beac`
  (verified with `git ls-remote --tags omp-upstream refs/tags/v17.2.12`).
- Zeta start: `bd5a049836340f5534b1e071e44679823f0e1f77`; integration branch:
  `sync/omp-release/v17.2.12`; tag merge commit:
  `81acf1f86d3c29ce82a32c5710f68e0bd27f20b5`; follow-up Zeta adaptation
  commit: `7d4d2c5186afed67606282c35552a0c4643a550c` (merge driver scope fix,
  native sentinel sync, upstream test adaptation, biome fixes).
- Merge-tree found 26 conflicts: `bun.lock`; root + all ten workspace
  `package.json` files; the native version sentinel (`lib.rs`); nineteen
  coding-agent/ai/catalog/hashline/tui/natives src and test files; `README.md`;
  `docs/native-crates.md`.
- Conflict decisions: package identity, `@zeta/*` scope, and the 1.0.0 version
  line preserved everywhere (package.json merge driver + `@oh-my-pi` → `@zeta`
  sweep). Native sentinel `__piNativesV1_0_0` retained over upstream's
  `V17_2_12` and re-synced into the generated `index.js`/`index.d.ts`. The
  nineteen source/test files resolved to theirs where zeta-side deltas were
  scope-only renames, keeping zeta behavior elsewhere. `README.md` kept the
  Zeta product page (Zeta-owned surface; upstream marketing README not
  imported). `docs/native-crates.md` took the upstream `pi-builtins` restructure
  (v17.2.12 unified uu-*/brush-builtins/jaq into `crates/pi-builtins`) with
  `@oh-my-pi` → `@zeta` branding.
- Post-merge findings: the package.json merge driver had `OMP_SCOPE` set to
  `@zeta/` (upstream is `@oh-my-pi/`); corrected with regression tests. The
  upstream dispose-release memory test referenced the global
  `AsyncJobManager.resetForTests()` which Zeta's per-session manager does not
  have; call removed.
- Checks: `bun check` green (all workspaces + `check:rs`); 26 targeted
  tests pass including the native sentinel contract
  (`windows-staging.test.ts`), loader freshness, and the dispose-release
  suite; CLI smoke probe passes (`zeta/1.0.0`, `--smoke-test: ok`). Required
  CI remains pending before this branch may reach `main`.

### Intermediate merge into `main` (no release)

Per product decision, v17.2.12 is an **intermediate merge product**: it
enters `main` as a drift buffer and main backup before the v17.3.3 complete
merge. No version bump, no tag, no release.

- Merged `main` into `sync/omp-release/v17.2.12` (24 conflicts, listed in the
  merge commit); conflict decisions:
  - `README.md` → `main` side (authoritative Zeta product page: `~/.zeta`
    paths, docs/document two-tree section, upstream-origins table).
  - `.omp/commands/cleanup.md` (upstream-added) → `.zeta/commands/cleanup.md`
    (no `.omp` compatibility surface).
  - `Cargo.toml`/`Cargo.lock` → branch (v17.2.12) dependency graph with
    workspace `version = "1.0.1"`; upstream v17.2.12 renames vendored
    `brush-builtins` into `crates/pi-builtins` — accepted wholesale, matching
    `crates/pi-shell`'s `pi-builtins.workspace` reference; lock regenerated by
    `cargo metadata` (pi-* crates at 1.0.1).
  - `ci.yml` auto-merged keeping the release-gate fix
    (`needs.rust_validate.result != 'failure'`) and the three disabled
    publish jobs (`if: false`).
  - Package files → branch side (newest upstream) with two corrective sweeps:
    `@zeta/` → `@linxiraos/` (the v17.2.12 adaptation's `@zeta/*` scope was
    wrong; actual package scope is `@linxiraos/*`, 58 files) and
    `@linxiraos/pi-coding-agent` → `@linxiraos/zeta` + `@linxiraos/hashline`
    → `@linxiraos/pi-hashline` (self-reference renames in v17.2.12-added
    tests).
  - **Zeta custom command `/language` re-ported** into the refactored
    v17.2.12 registry via new `slash-commands/builtin-zeta.ts` (upstream
    refactor dropped it); `/security` survives in `builtin-modes.ts`. Both
    remain settings-page configurable (`language` and `security.enabled` in
    settings-schema.ts).
  - `document/native-crates.md` → branch structure with `@linxiraos/`
    naming; `mcp-schema.json` description paths `.omp/` → `.zeta/`.
  - Auto-QA contract preserved: `dev.autoqaPush.endpoint` default
    `https://qa.omp.sh/v1/grievances` (upstream default kept this cycle),
    credential flag on `dev.autoqaPush.token`, `~/.zeta/autoqa.db`.
- Local checks: `bun install` (workspace links), `bun run check:ts` green;
  `check:rs` environment-blocked on this Windows host (no MSVC linker/SDK) —
  covered by CI. CI green required before the branch merges into `main`.

### Pending: v17.3.3 (complete merge — in progress)

- Prior baseline: `v17.2.12` at `45e12e5bb758198a920c6070e7e64cb33b21beac`.
- Source: `refs/tags/v17.3.3` at `039728ad808395af4066783c6f4f6b079d8e5a78`
  (verified with `git ls-remote --tags omp-upstream refs/tags/v17.3.3`).
- Integration branch: `sync/omp-release/v17.3.3` from `main` after the
  v17.2.12 intermediate merge (`5041f0477b`). This is the **complete merge**:
  1.0.2 is released only after it reaches `main` green.
- Merge-tree: 255 conflicts (246 content + 9 modify/delete). Resolutions:
  - Zeta-owned surfaces kept: `README.md`, root `Cargo.toml` workspace
    version `1.0.1`, native sentinel `__piNativesV1_0_1` (lib.rs + generated
    `native/index.js|d.ts`), ci.yml release-gate fix + three disabled publish
    jobs, `/language` (builtin-zeta.ts) and `/security` (builtin-modes.ts)
    commands, settings-page entries (`language`, `security.enabled`,
    `dev.autoqaPush.*` with default `https://qa.omp.sh/v1/grievances`),
    `.zeta/*` paths, `@linxiraos/*` package identity.
  - Upstream v17.3.3 pair accepted wholesale for the remaining 238 files;
    Zeta overlay re-applied: `@oh-my-pi/*` → `@linxiraos/*` with name
    mapping (`hashline`→`pi-hashline`, `omp-stats`→`pi-stats`,
    `omptype`→`pi-omptype`, `pi-coding-agent`→`zeta`, `snapcompact`→
    `pi-snapcompact`), `.omp/` path fragments → `.zeta/`, brand `π` → `ζ`
    (terminal title), `V17_3_3` sentinel → `V1_0_1`.
  - 9 upstream-deleted files (agent-dashboard etc.) accepted as deletions
    (upstream origin, no Zeta-specific work).
  - `job-manager.ts`: restored upstream v17.3.3 global `instance`/
    `setInstance`/`resetForTests` accessors; `CreateAgentSessionOptions`
    gained explicit `asyncJobManager` so Zeta's per-session sharing
    (vibe/runtime → executor → createAgentSession) still compiles and wins
    over the upstream auto-global fallback.
  - Package graph: root `workspaces.catalog` rewritten to `@linxiraos/*`
    @ `1.0.1` with name mapping; workspace `package.json` dep names
    corrected (`pi-hashline`/`pi-stats`/`pi-snapcompact`) and driver
    duplicate keys deduped; `bun.lock` regenerated with Bun 1.3.14;
    `Cargo.lock` regenerated via `cargo metadata` (pi-* at 1.0.1).
  - `typebox-shim.test.ts` (Zeta shim vs upstream tests): `ArkSchema`
    gained a typed `toJsonSchema()` member; upstream test hunks use a typed
    `toJsonDocument` helper.
- Local checks: `bun run check:ts` green; `check:rs` environment-blocked on
  this Windows host (no MSVC linker/SDK) — covered by CI. Merged into `main`
  (`26608da0ab`) after PR #2 CI green; 1.0.2 released after (bump `9f49bff2` +
  tag `v1.0.2`).

### v17.3.4 (superseded by v17.3.5)

- Prior baseline: `v17.3.3` at `039728ad808395af4066783c6f4f6b079d8e5a78`
  (main `26608da0ab`).
- Source: `refs/tags/v17.3.4` at `ffd53ff92a6f575d499730475a73460dd7cc2eea`
  (verified with `git ls-remote`).
- Merge-tree from `main`: 20 conflicts (18 content + 2 modify/delete).
  Resolutions:
  - Zeta-owned surfaces kept: native sentinel `__piNativesV1_0_2` (lib.rs +
    generated `native/index.js|d.ts`), root `Cargo.toml` workspace version
    `1.0.2`, `workspaces.catalog` `@linxiraos/*` @ `1.0.2` with name mapping
    (`hashline`→`pi-hashline`, `omp-stats`→`pi-stats`, `omptype`→`pi-omptype`,
    `pi-coding-agent`→`zeta`, `snapcompact`→`pi-snapcompact`), `mupdf`
    external dep (bundle-dist), `logger` usage (markit).
  - Upstream v17.3.4 accepted: `pdf` native module (`pdfToMarkdown` +
    `read-pdf` tool + markit pdf converters + tests), `alibaba-token-plan`
    usage provider, ai usage/auth fixes; upstream-deleted
    `read-pdf-images` (+ test) accepted (replaced by pdf module).
  - Package graph: workspace `package.json` dep names corrected
    (`pi-snapcompact`/`pi-hashline`/`pi-stats`), duplicate keys deduped;
    `bun.lock` regenerated with Bun 1.3.14; `Cargo.lock` regenerated via
    `cargo metadata`; new upstream files package-scope `@oh-my-pi/*` →
    `@linxiraos/*` re-applied.
- Status: merged into `main` as part of the v17.3.5 sync (v17.3.5 tag builds on
  the same release line; the v17.3.4 worktree became the v17.3.5 branch).

### v17.3.5 (complete — branch `sync/omp-release/v17.3.5`)

- Prior baseline: `v17.3.4` at `ffd53ff92a6f575d499730475a73460dd7cc2eea`
  (superseded above; worktree `zeta-omp-v17.3.4`).
- Source: `refs/tags/v17.3.5` at `37eee71978951fccf66b21f7e3e2b74596ac9d74`
  (verified with `git ls-remote`; upstream `main` == tag, no commits after).
- Merge-tree from `main`: 53 conflicts resolved on the v17.3.4 worktree per the
  v17.3.4 pattern, then the branch renamed to `sync/omp-release/v17.3.5`.
  Resolutions:
  - Zeta-owned surfaces kept (ours): sentinel/version group — root
    `Cargo.toml` workspace `1.0.2`, `crates/pi-natives/src/lib.rs`
    `__piNativesV1_0_2`, generated `packages/natives/native/index.js` +
    `index.d.ts`; all `pi-*` crates `1.0.2`; `workspaces.catalog`
    `pi-natives`/`pi-omptype`/`pi-wire` @ `1.0.2`; 10 core packages @ `1.0.5`
    (aligned to main); catalog keys renamed/deduped (`pi-hashline`,
    `pi-stats`, `pi-omptype`, `pi-snapcompact`); stale old-name deps removed
    (agent `snapcompact`; coding-agent `hashline`/`omp-stats`/`snapcompact`).
  - `bunfig.toml` hand-merged: Zeta `[test]` `pathIgnorePatterns` extended with
    `"bazel-*/**"`, `"**/bazel-out/**"` (upstream bazel test paths).
  - Upstream accepted: remaining 46 files theirs + worktree-wide
    `@oh-my-pi` → `@linxiraos` sweep (73 files); `Cargo.lock` regenerated via
    `cargo metadata` (crates stay `1.0.2`); `bun.lock` regenerated.
  - Post-sweep fixes: `@linxiraos/omptype` → `@linxiraos/pi-omptype` in 10
    files (batch-sweep missed the renamed package), Biome import ordering.
- Local checks: `bun run check:ts` green; sentinels verified
  (`__piNativesV1_0_2` = 1/1/1 in lib.rs/index.js/index.d.ts, `pdfToMarkdown`
  export retained). Branch CI required before merging to `main`; no version
  bump, no tag on the branch.

### Merged: v17.3.8 (branch `zeta/v1.1.10-17.3.8`)

- Prior baseline: `v17.3.5` at `37eee71978951fccf66b21f7e3e2b74596ac9d74`
  (worktree `temp/sync-v17.3.8`).
- Source: `refs/tags/v17.3.8` at
  `858f7dd91fff9b84cf8a2c6a6bb85aa0e6d03a55` (verified with `git ls-remote
  --tags omp-upstream refs/tags/v17.3.8`; upstream `main` == tag HEAD).
- Zeta start: `6980aa1a70`; integration branch: `zeta/v1.1.10-17.3.8`;
  tag merge commit: `2bf455c9c3`; follow-up Zeta adaptation commits:
  `99690bdd72` (brand/package overlay) and `1264454571` (issue-887 test
  adaptation). `git merge-base --is-ancestor v17.3.8 HEAD` verified.
- Merge-tree: 59 conflicts, all resolved per the AGENTS.md policy table:
  - `bun.lock` / `Cargo.lock` / `Cargo.toml`: upstream dependency graph with
    Zeta versions (`bun.lock` regenerated under `@linxiraos/*` names via
    `bun install`; `Cargo.lock` reconciled via `cargo metadata` at 1.0.9;
    `Cargo.toml` workspace `version = "1.0.9"` kept).
  - Native sentinel: `__piNativesV1_0_9` kept in `lib.rs` + `index.js`;
    `index.d.ts` rebuilt from upstream declarations (upstream content is a
    superset: Zeta's file had the same declarations duplicated — a prior
    generation artifact — deduplicated to upstream's single set + Zeta
    sentinel).
  - Root `package.json`: restored `@linxiraos/*` catalog keys @ 1.0.9
    (auto-merge had taken upstream's `@oh-my-pi/*` @ 17.3.8).
  - Workspace `package.json` files: 43 duplicate `@oh-my-pi/*` deps dropped
    (each verified to have a `@linxiraos` twin); `@larksuiteoapi/node-sdk`
    restored (Zeta feishu channel; upstream manifest dropped it).
  - Source files (`packages/ai`, `agent`, `catalog`, `coding-agent`):
    upstream implementation accepted; Zeta deltas preserved — i18n keys
    (`M.*` in `mcp-command-controller` 198 keys, `builtin-session` 62,
    `settings-selector` 24), `@linxiraos/*` imports, `.zeta` paths, Zeta
    features (`serve`/`web` command entries, `#requestRender` defensive
    renderer, `localizeOptions` zh localization).
  - Tests-as-contract: upstream test bodies accepted with Zeta adaptations
    (`.omp` → `.zeta`, `@oh-my-pi` → `@linxiraos`). `issue-887-repro.test.ts`
    kept (upstream deleted it) with one assertion updated: upstream 17.3.8
    regenerated `models.json` routing `qwen3.7-max`/`qwen3.7-plus`/
    `qwen3.8-max` on opencode-go from `anthropic-messages` to
    `openai-completions` (3-model consistent metadata change); the kept test
    now asserts the merged routing while still protecting the minimax/qwen3.x
    override map.
  - `.omp` path adaptations recorded: `omp-plugins.test.ts` (`.omp/settings.json`
    → `.zeta`), `lsp-regressions.test.ts` comment (`~/.omp/agent` →
    `~/.zeta/agent`), `update-cli.test.ts` mock registry URL
    (`@linxiraos/zeta` → `@linxiraos/zeta`), `docs/extensions.md`
    import example (`@linxiraos/zeta` → `@linxiraos/zeta`).
  - `structured-subagent.test.ts` (upstream 17.3.8-added "reloads model roles"
    case): `.omp/config.yml` + `.omp/agents/hot-worker.md` writes adapted to
    `.zeta` (caught by release CI — discovery is `.zeta`-only; recorded here
    per policy).
  - Tree-wide `@oh-my-pi/*` → `@linxiraos/*` sweep for 31 upstream-added or
    auto-merged files (new upstream files carrying un-rebranded imports;
    these resolved through main's node_modules and broke worktree type
    checking).
- Local checks: `bun run check:ts` green (all workspaces + biome lint);
  `check:rs` environment-blocked on this Windows host (no MSVC linker/SDK) —
  covered by CI. Affected conflict tests green; remaining failures
  `agent.test.ts` hang, tui component-render scrollback replay,
  changelog-static-import, settings-manager symlink, rpc-client.restart)
  reproduce identically on clean `main` (environmental). `ci:test:smoke`
  passes (`smoke-test: ok`).
- Merged into `main` as `76588be094` (clean, no conflicts; follow-up fix
  commit `82309f384d` lands on top with the 17.3.8 content). Ancestry
  re-verified on `main`. Released as Zeta `v1.0.10`.

### Pending/In-progress: v17.4.0 (branch `sync/omp-release/v17.4.0`)

- Prior baseline: `v17.3.8` at `858f7dd91fff9b84cf8a2c6a6bb85aa0e6d03a55`
  (main `76588be094` + IM feature work up to `bd6a6ca95d`).
- Source: `refs/tags/v17.4.0` at
  `72000acfeb902e21816252699482887f34d1a5a4` (verified with `git ls-remote
  --tags omp-upstream refs/tags/v17.4.0`; upstream `main` == tag HEAD).
- Zeta start: `bd6a6ca95d` (IM command-language / default-space session /
  model + language + plan-approval feature commit); integration branch:
  `sync/omp-release/v17.4.0`; tag merge commit: `b90f69f69a`.
  `git merge-base --is-ancestor v17.4.0 HEAD` verified.
- Merge-tree: 111 conflicts, resolved per the AGENTS.md policy table:
  - Zeta-owned surfaces kept (ours): native sentinel `__piNativesV1_0_10`
    (lib.rs + generated `native/index.js|d.ts`, plus upstream `nodeChainAt`
    export); root `Cargo.toml` workspace `1.0.10`; `workspaces.catalog`
    `@linxiraos/*` @ `1.0.10` with name mapping
    (`hashline`→`pi-hashline`, `omp-stats`→`pi-stats`, `omptype`→
    `pi-omptype`, `pi-coding-agent`→`zeta`, `snapcompact`→`pi-snapcompact`);
    `@bufbuild/*` catalog entries restored; `@larksuiteoapi/node-sdk` dep
    restored (feishu channel); `.zeta/*` paths; `~/.zeta/agent/last-changelog-version`
    marker; ci.yml `release_quality_gate` clippy-check adopted (upstream)
    with Zeta `release_build_gate` job + three disabled publish jobs kept;
    `/security` command (builtin-modes.ts, all subcommands, `M.cmdSecurity*`
    i18n) and `/language` (builtin-zeta.ts); Zeta i18n `M.*`/`ZH_*` usages
    re-applied across TUI components; `compaction.methodOrder` schema +
    `settings-zh.ts` zh entries updated to the upstream refactor
    (`compaction.strategy`/`compaction.remoteEnabled` removed).
  - `scripts/merge-package-json.ts` driver bug fixed: `OMP_SCOPE` corrected
    from `@linxiraos/` to `@oh-my-pi/` with full `RENAME_BY_TAIL`
    (hashline/omp-stats/omptype/pi-coding-agent/snapcompact) — the previous
    value made upstream `@oh-my-pi/*` deps land as new entries instead of
    mapping onto Zeta's `@linxiraos/*` deps (duplicate keys).
  - `@types/bun` pinned `1.3.14` in the root catalog (upstream's lock
    resolution picked 1.4.0 whose `process.once` typing broke
    `input-controller-suspend.test.ts`); regenerated `bun.lock` with Bun
    1.3.14 and `Cargo.lock` via `cargo generate-lockfile` (pi-* crates at
    1.0.10).
  - Upstream v17.4.0 accepted wholesale for the remaining files: tokenizer →
    `Tokenizer` class refactor, `compaction.methodOrder` +
    remote-compaction, `generateModels`/cursor-proto refactors, cleanse/
    ps-cli additions, `OverlayPanel` TUI component refactor, extension
    parse-cache (`getLegacyPiExtensionCacheDbPath`), daemon runtime root
    helpers (`getDaemonRuntimeRoot`/`getGlobalDaemonRuntimeRoot`),
    `telemetry-export-otlp` lazy-load, `gen-clippy-bazelrc` release step,
    `release.ts` nix-bun deps generation.
  - Tree-wide `@oh-my-pi/*` → `@linxiraos/*` sweep for 77 pure-rename
    conflict files (resolved to upstream content + scope sweep) and
    upstream-added files; `.omp/` → `.zeta/` path adaptations
    (`docs/settings.md`, `docs/extensions.md` import examples,
    `dirs.ts`/`changelog.ts` comments). `update-cli.test.ts` intentionally
    keeps the `@linxiraos/zeta/omp` managed-path fixture (the
    resolver detects the upstream-managed pattern).
- Local checks: `bun run check:types` green in all 11 workspace packages;
  biome check green (25 files auto-fixed). Channel tests 60 pass (IM
  feature intact, wechat network flake except), web-gateway 21 pass,
  compaction + model-registry 148 pass; agent tokenizer tests 72 pass
  (2 failures are a stale local native addon lacking upstream's `ClaudeV47`
  `Encoding` variant — `check:rs` blocked on this Windows host, covered by
  CI). `check:rs` environment-blocked as before.
- Status: pending merge into `main` + CI before acceptance.

## Pi Runtime Ports

Never run `git merge pi-upstream/main` into Zeta. Pi and OMP intentionally
diverge in the agent loop, session storage, tools, TUI, extension loader, auth
storage, runtime, and test framework.

1. Identify a Pi PR or a focused commit range and its affected packages.
2. Classify each change: direct port, semantic port, covered, divergence, or
   not applicable.
3. Create `port/pi/<scope>` from `main`.
4. Follow `document/porting-from-pi-mono.md`: read both implementations, map APIs,
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
