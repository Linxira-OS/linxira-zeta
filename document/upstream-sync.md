# Upstream Sync Ledger

## v18.2.4 + squash-sync reset (Zeta — history reset authorized by maintainer, PR pending)

- **Baseline**: v18.2.3 chain (sync branch carried 1de9977e28 -> cbf0cc5158 -> 509f6b45cb, full two-parent merges, gates green)
- **v18.2.4**: tag 1c0303b1f2ec515cbf4b44a9a49d68a029531aac (verified vs remote), merged as 509f6b45cb (6 upstream commits, 79 files, 13 conflicts — all upstream-rewrite takes + scope map)
- **History reset**: maintainer authorized squash-sync (AGENTS.md §超大量上游同步): new main = backup/omp/main (856d9375e0, origin anchor) + 2 squashed commits — (1) v18.1.16..v18.2.3 content [skip ci], (2) v18.2.4 + policy docs. Old main preserved remotely as main-old-20260917. Upstream commit-level detail lives at github.com/can1357/oh-my-pi (fork provenance).
- **Deviation note**: this overrides the standing non-squash/ancestor-check rule for this window (transfer-layer constraint: multi-hundred-MB pack vs proxy/direct-link instability, evidence: remote unpack failed: index-pack failed on every full-pack attempt; 593/721 hops uploaded fine).
- **backup/omp/main**: retained on origin + local, fast-forwarded to v18.2.4 as the standing fast-sync anchor.
- **Gates**: re-run green on the squash tree (identical content to the verified merge tree).

## v18.2.1 + v18.2.3 chained (Zeta — sync branch `sync/omp-release/v18.2.1`, PR pending)

- **Baseline**: v18.1.21 (`acf943d3c8` parent of Zeta 1.1.15 line; Zeta start `45dbc74458`, main post-PR-#20, version line 1.1.15)
- **Source tags**: `v18.2.1` (peeled = tag = `acf943d3c8dc1ed135b42aa33fef4d9d2ff61c9a`, verified via `git ls-remote --tags omp-upstream`) and `v18.2.3` (lightweight `a2d83061c5d673bf3ee495d7652b63ee5a0ceb14`, verified). v18.2.2 skipped as internal to the 18.2.1..18.2.3 range; both tags are ancestors of HEAD (`git merge-base --is-ancestor` passes for both).
- **Zeta starting commit**: `45dbc74458` (main) → isolated worktree `../zeta-sync-1821`, branch `sync/omp-release/v18.2.1`.
- **Merge 1**: `1de9977e28` = merge of tag `v18.2.1` (non-squash two-parent). Conflict set 445 files (source 226 / tests 199 / docs 10 / version-line 4 / rust 4 / ci 2), resolved by 9 parallel slices + 2 test slices (Round B after source), shared contract doc `local://sync-rules-v1821.md`.
- **Merge 2**: `cbf0cc5158` = merge of tag `v18.2.3` on top (delta 171 commits / 256 files; 70 conflict files, resolved by 3 slices). Chained-tag methodology per merge-playbook (second hop much smaller than a fresh merge).
- **Key decisions**:
   - Version line kept Zeta: root Cargo workspace 1.1.15, catalog 13 keys @1.1.15, `__piNativesV1_1_15`, `__ompInstallTokioRuntime` untouched.
   - zeta-package driver union leaked upstream `@oh-my-pi/*` catalog keys — dropped 12; per-package manifests re-mapped to `catalog:`.
   - Tree-wide sweeps post-merge (auto-merged files have no owner): 114+14 files `@linxiraos/*`→`@linxiraos/*` (omptype→pi-omptype, omp-stats→pi-stats, snapcompact→pi-snapcompact, pi-coding-agent→zeta); `.zeta` fixture paths→`.zeta` except interop surfaces (`.omp-plugin`, `.omp-sessions`, `.zeta/plugins` discovery, `omp.extensions`, `ompprurl`, `@omp-print-signal-`, `_omp_call`, `my.omp.sh`, `omp.sh/install`); `__omp_worker_*` selectors renamed to `__zeta_worker_*` to match the merged `worker-host.ts` validator (protocol constants follow the checker).
   - Zeta-only preserved: AgentSession/InteractiveMode mode API + `state_version_changed`, sdk sinks (channelSend/workspaceRun/imControl), IRC auto-reply, dirs tracking helpers, `/language` `/tracking` registry, web-gateway git/archive/temp endpoints, TUI sidebar (gutter engine ported onto upstream PreparedLines renderer; `setMainWidth` compose/physical width split with `#previousPhysicalWidth` for resize replay).
   - Upstream restructures accepted: profiler heap-snapshot removal (MemoryStats), browsers.ts refactor (Browser enum + resolveBuildId dropped; browser-launch.test adapted with pinned CfT buildId), model-config-values.ts → resolve-config-value.ts, model-mention registry split, advisor emission-guard rewrite (impl+test pairs kept together).
   - Sentinel registry updated: `snapshotForReplication` signature follows upstream's copier param (path itself intact).
   - Brand: ζ title char kept; omfg-controller comment `.zeta/rules`→`.zeta/rules`; brand-check 0 hits.
- **Gates**: check-version-consistency ✓ 1.1.15 · check:ts ✓ 0 errors · brand-check ✓ 0 · zeta-sentinels ✓ 46 · cargo metadata ✓ · cargo fmt --all --check ✓. bun.lock regenerated; CHANGELOG [18.x.y] sections folded per convention.
- **New playbook lessons**: promisor/blob:none + shallow lazy-fetch aborts merges (`git fetch omp-upstream --no-filter tag <tag>` first); merge-driver catalog dupes; un-owned auto-merged files need full-tree sweeps; sibling in-flight state is not ground truth (CaModes sidebar incident); tests round after source. See `document/merge-playbook.md` §大批量冲突的分级 resolve appendix.

## v18.1.17–v18.1.21 batch (Zeta — feature-branch integration, PR pending)

- **Baseline**: v18.1.16 (`61b1b8aef634`, Zeta `56b2cc6eee`, version line 1.1.14)
- **Source tag**: `v18.1.21` (peeled `a2501722aa05670eeab327ea1325e3fde55e51a9`; verified via `git ls-remote --tags omp-upstream`; the batch covers upstream v18.1.17→v18.1.21, 757 files)
- **Zeta starting commit**: `56b2cc6eee` (main) → work carried on `feat/web-ui-next` (web-ui rework + sync in one train).
- **Merge commit**: `bdb0e04e22` (non-squash two-parent; `merge-tree` pre-report 116 conflict files; resolved by 6 parallel slices: locks/native bindings → upstream; 60 test files → upstream + `.zeta`→`.zeta` rewrites preserving `my.omp.sh` relay URLs; README kept Zeta-owned; 8 mode/session files kept Zeta session-layer mode API (`flushPendingModelSwitch`, `restorePlanPreviousModel`, `enterVibeMode`, `#stateVersion`) + upstream i18n `M.imClosingSession`; 35-file hand merges (anthropic.ts redact+cache-key, settings-schema Zeta `turn_stats` + upstream `vim`); install.ps1 upstream structure + Zeta brand). `git merge-base --is-ancestor v18.1.21 HEAD` passes.
- **Zeta adaptation commits**:
   - `b237c10071` (A3) structural: `set-version.ts 1.1.14`, dropped upstream 18.1.21 root manifest block, 9 package manifest renames (`omptype`→`pi-omptype`, `omp-stats`→`pi-stats`, `snapcompact`→`pi-snapcompact`), 130-file scope sweep, README restore from main, CHANGELOG `## [18.` prune, `__omp_call_tool__`→`__zeta_call_tool__`, `.zeta`→`.zeta` in crates/pi-natives oauth callback + collab registry + plan autosave + utils/dirs.
   - `bc858c7751` (A4) mechanical brand overlay over 13 upstream test files (36 tokens).
   - `86bead6ed7` (A5) test-contract resolution + damage fixes (below).
- **Damage found and fixed (pre-push, none reached CI)**:
   - Astra window policy (class 4): merge kept upstream `contextWindowFloor 1050000` KDL/rules.json but Zeta main owns the gated variant (`limitsPatch 272000` + `maxContextWindow 1050000` behind extended-context); resolved by taking main's `openai-codex.kdl` + `context-window.test.ts` + `codex-discovery.test.ts` pair and regenerating `rules.json` — the model-registry extended-context bucket then matched main's test pair wholesale.
   - Manifest duplicate keys (new damage class; detector: `Duplicate key in object literal` warnings breaking stderr-asserting tests): the mechanical `@linxiraos/*`→`@linxiraos/*` scope rewrite appended renamed keys instead of replacing, leaving 2–7 duplicate keys in 10 package manifests → deduped, `bun.lock`/`Cargo.lock` refreshed.
   - v21 hardcoded `/prewalk` rewrite + `/collab list` + `/btw` descriptions tripped the i18n guard (`i18n-slash-commands.test.ts`): added `cmdPrewalk`/`cmdPrewalkAcp`/`cmdPrewalkRestart`/`cmdCollabList`/`cmdBtwHistory` keys (en+zh+messages) and wired the registry back to catalogue keys, preserving v21's one-shot-handoff behavior.
   - v21's new settings (`tui.mouse`, `tui.vimMode*`, `display.pinnedAgents*`, `plan.autosave*`, `tools.speculativeExecution.*`, `collab.autoStart`, `composer.recallClearedDrafts`) lacked zh texts → added to `settings-zh.ts` (`ZH_SETTING_TEXTS` vs `ZH_OPTION_TEXTS` split per key type).
   - InteractiveMode `#teardown` carried a duplicated pre-dispose block (early `#btwController.dispose()` etc. before `showStatus`), failing the still-closing progress test → reduced to upstream 90b6315a28 shape with `M.imClosingSession`.
- **Checks (local, pre-PR)**: `check-version-consistency` OK (1.1.14), `check:ts` OK, brand-check 0 hits, zeta-sentinels 46 OK, `cargo fmt --all --check` OK; bucket suites green: catalog 951+ (2 Windows-only `issue-8867` quarantine flakes identical on main), agent 583/583, ai = main baseline (12 Windows-env failures, zero branch-unique after manifest dedupe), coding-agent failure set = main's 134 baseline ±3 timing-flaky (re-runs flip); web-gateway 30/30 incl. archive. Local native addon for tests copied from the main checkout (class-5 workaround; win32 MSVC link blocked by Git's GNU `link.exe` shadowing PATH — GNU toolchain works; msvc needs VS Build Tools).
- **Merge into feature branch**: `ac09144ec9` (`sync/omp-release/v18.1.21` → `feat/web-ui-next`, non-squash; v21 + release branch both ancestors). Post-merge gates re-run green.
   - **Post-PR CI repairs (rounds 1–2, `4d2c42825b` + `a121243641`)**: (a) `bun.lock` carried 641 `registry.npmmirror.com` URLs from the local `~/.npmrc` leak during A5's `bun install` — normalized to npmjs.org (standing rule); (b) `logger-contract.test.ts` taken from upstream while source writes `zeta.*` prefixes — restored zeta naming + added a `filenamePrefix: "zeta"` MUST_CONTAIN brand rule (brand-check's `.zeta` rule exempts `/test/` paths, which is why A4 missed it); (c) **torn paste/ask contracts (damage class 9 family, tests-are-contract)**: v21's `beginPaste` paste-reservation (`PasteTarget.beginPaste` + `finishPaste` flow in `handleImagePaste`) and hook-editor ordered-paste were dropped while taking v21's `extension-ui-controller.test.ts` wholesale — restored v21 source for `input-controller.ts` (paste parts), `hook-editor.ts` (wholesale, imports rekeyed), `ask-dialog.ts` single-multi-question submit jump, plus v21's `ask-dialog.test.ts`; (d) `__omp_*` runtime-global sweep lost in 8 eval/core test files (`__zeta_import__`/`__zeta_helpers__`/`__zeta_session__`/`__zeta_run_id__`/`__zeta_tools__`), while upstream-internal protocol symbols (`__omp_with_call_site__`, `__omp_tool_bridge__`, `__omp_final_expr__` marker) stay upstream-named per source provider — recorded as damage class #9 in AGENTS.md.
   - **Post-PR CI repairs (rounds 3–5, `49044fae3e` / `56787c2709` / `0908cb7556`; CI green run `35050684923`)**: (a) `nix/bun.nix` was the **pre-merge** stale file (still `@linxiraos/*` workspaces, no `name` attrs) — regenerated with the canonical CI invocation `bun2nix -l bun.lock -c ../ -o nix/bun.nix`; the intermediate regen WITHOUT `-c ../` emitted `./packages/*` copy paths that don't exist relative to `nix/` (Nix eval `Path does not exist in Git repository`) — the `-c ../` prefix is load-bearing, not cosmetic; (b) A3's CHANGELOG `## [18.` prune had **over-truncated Zeta's own 1.1.10-and-older sections** (class 4; HEAD was a strict subset of main) — restored from main; (c) v21 reordered `DEFAULT_COMPACTION_METHOD_ORDER` (shake before soft): merge kept main's `compaction-methods.ts` + v21's `settings-manager.test.ts`, then main's `agent-session-handoff.test.ts` pinned the old order — took v21 for both test files (handoff import mapped to `@linxiraos/pi-snapcompact`, class-3 mapping); (d) `claude-plugins.test.ts` registry literal `.zeta` → `.zeta` (source resolves via `getConfigDirName()`); (e) inline python stubs `__omp_display = lambda` in bridge/prelude tests → `__zeta_display` (prelude.py calls the zeta name); (f) real-browser `pickElectronTarget` trio self-skips under `ZETA_SKIP_REAL_BROWSER=1` (native bucket job only): GH-hosted ubuntu-22.04 resolves system Chrome but CDP never comes up — **upstream's own ubuntu-22.04 PR run fails identically** (verified run 35045230929); upstream passes only on self-hosted `omp-kata`, which Zeta must not use (class 7).

## v18.1.10 (Zeta — merged, released as 1.1.9)

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
- **Conflict decision**: modify/delete → accept upstream deletions; content → take upstream (`--theirs` for 184 files), then re-apply Zeta layer.
- **Checks**: PR #8 CI fully green (4 rounds; run `33958572706` = success incl. brand-residue guard), `bun scripts/check-version-consistency.ts`, ancestor check, Zeta Nix success. Local prebuilt natives stale (damage class #5, CI builds fresh via bazel).
- **Release-run repairs (first GH-hosted execution of the Rust gate)**:
   - `14db3db79a` utok fixtures: dropped 5 stale Zeta-snapshot entries whose reference counts went stale with the v18.1.10 tokenizer update; pi-shell kill-test timeouts 5s→30s (superseded by the root-cause fix below).
   - brush-core stop detection: `ChildProcess::wait` relied on a tokio SIGCHLD stream that misses signals arriving before registration — a pipeline stage that SIGSTOPs during later-stage spawning stalled `run_string` forever on loaded GH-hosted runners (fast local/upstream machines always win the race, so the upstream test never showed it). Fix in the vendored fork: `waitid` scoped to the caller's pid (`Id::Pid`, no cross-child event consumption) + one entry probe for already-pending stops (`processes.rs`, `sys/unix/signal.rs` incl. macOS shim, `sys/stubs/signal.rs`), regression test `wait_observes_a_stop_that_precedes_the_wait` verified red (5s timeout) without the entry probe and green with it. Upstream test files untouched. Run 3 confirmed on CI: Rust tests + all three clippy scopes green for the first time post-merge.
   - rustfmt collapse flip (damage class #8): the brand replacement shortened `"oh-my-pi"`→`"zeta"`, pulling `pi-vcs/git/mutate.rs`'s `SignatureRef` literal back under `max_width`, so the final `Rustfmt` step (never reached by runs 1–2, skipped on PRs entirely) failed `pi-vcs.rustfmt.ok`. Fixed by `cargo fmt --all`; workspace-wide check reports zero further offenders.

## v18.1.16 (Zeta — offline backup-branch validation merge, release pending)

- **Baseline**: v18.1.14 (`daf07999c2fe`, Zeta `75f5066f51`, release v1.1.12)
- **Source tag**: `v18.1.16` (peeled `61b1b8aef634334eaf1412afd003a763e1d1b9c1`; verified via `git ls-remote --tags omp-upstream`)
- **Merge commit**: `8418f8571a` (non-squash two-parent on `backup/pre-sync-v18.1.16`; ancestor check passes)
- **Scope report**: `bun scripts/merge-scope-report.ts --tag v18.1.16 --from u-v18.1.14` → 270 upstream files, 88 true conflicts (exactly matched the report), 130 silent merges; slices v14→15 (140 files) and v15→16 (162 files) reviewed separately.
- **Damage found and fixed during validation** (all pre-push, none reached CI):
   - Mechanical: `@linxiraos/*` scope residue from silently merged upstream files (606 hits) → swept to `@linxiraos/*` with the RENAME_BY_TAIL mapping; a bad perl pass truncated some to `@oh/` (12 files) — repaired.
   - Class-4 variant (lost upstream hunks in conflict resolution): `packages/ai/src/auth-storage.ts` merged-block contract (`priorBlockedUntilMs`/`providerTimed`), `session/turn-recovery.ts` provider-timing params, `ai/src/error/flags.ts` `auth-gateway 5xx` retryable pattern, `utils/src/fetch-retry.ts` longest-wins parser rewrite, `openai-codex-responses.ts` abort-cause chain, `session-advisors.ts` `providerTimed` field, `agent-session-retry-cap.test.ts` (+1480 lines) and `auth-storage-force-refresh-rotate.test.ts` — all restored from v18.1.16 with scope rekey. Systematic hunk-level scan against `u-v18.1.14→u-v18.1.16` additions confirms zero remaining losses (excluding intentional Zeta surfaces).
   - Tests: `task`/`modes`/`session` buckets show zero HEAD-unique failures vs main; `ai` bucket zero HEAD-unique (6 main flakes fixed); `retry-cap` 51/51. Remaining local failures are Windows-only noise (git-worktree tests writing `:(glob)*` paths, native `.node` stale per class 5) — CI bazel unaffected.
   - Upstream changelog sections (## [18.x]) dropped from package CHANGELOGs; version line realigned to 1.1.12 via `set-version.ts` + `bun install`.
- **Note**: upstream replaced biome with oxfmt/oxlint (+oxfmt); Zeta keeps its own check pipeline — `prefer-const` on definite-assignment `let` (8 sites) is a pre-existing main debt, unchanged by this merge.

## v18.1.13 + v18.1.14 (Zeta — merged as PR #14, dual-tag serial merge)

- **Baseline**: v18.1.10 (`f241301c8372`, Zeta `e325c888d9`)
- **Source tags**: `v18.1.13` (peeled `a1b254047d12e143b7c6011536e918c6c35c5906`) merged first, then `v18.1.14` (peeled `daf07999c2fee9b22edc7bf8fea1fb6272e0df5e`) on the same `sync/omp-release/v18.1.14` branch; both verified via `git ls-remote --tags omp-upstream`, both ancestor-checked in HEAD.
- **Merge commits**: `711d230673` (v13, two-parent) → `e522237bb0` (v14, two-parent on top).
- **Zeta adaptation commits**: scope rewrite + version line 1.1.10 + brand overlay + i18n/tool-schema contracts + changelog rekey + idle-compaction async-wake guard; methodology in `document/merge-playbook.md` §双 tag 连续合并方法论.
- **CI rounds and damage found**:
   - Round 1: `bun install --frozen-lockfile` dead in every job (damage class 1 fingerprint) — merged `bun.lock` carried duplicate workspace keys + stale catalog; regen fixed it.
   - Round 2: three damage sites: (a) conflict resolution had dropped the Zeta-only `/plan-ultra` registry entry and reverted Zeta i18n `M.*` descriptions to upstream hardcoded strings (class 4, detector: `plan-ultra.test.ts` + `i18n-slash-commands.test.ts`); (b) v14's new `changelog-summary.test.ts` (lexer contract) was silently dropped in a delete/modify resolve (class 4/6 — "tests are contract" violation), and its companion source change (`summarizeChangelogEntries` lexer rewrite) was missing; (c) `Cargo.lock` stale vs v14 manifests (`cargo fetch --locked` / `cargo-deny --locked` red). Fixed: restored registry from main baseline, adopted the v14 test+source pair wholesale with the shipped-notes contract rekeyed to the Zeta 1.1.10 line, consolidated the duplicate `1.1.10` changelog sections (omp18.1.x sync bodies folded in, one uncategorized bullet kept above the headings per the contract), `cargo update` + committed lock.
   - Round 3: Zeta Nix `bun-lock` check red — the merge had also pulled the **upstream OMP `nix/bun.nix`** back in (old bun2nix format without `name =`, OMP dependency set incl. the removed oxfmt/oxlint), plus locally regenerated `bun.lock` carried `registry.npmmirror.com` URLs from the local mirror config. Fixed by regenerating `nix/bun.nix` with the pinned bun2nix 2.1.2 from the Zeta `bun.lock` and normalizing lock URLs back to npmjs.org.
   - Round 4: CI 20/20 + Zeta Nix green → merged as PR #14 (`caef3818cc`).
- **New standing rule** (from this sync): `nix/bun.nix` is Zeta-owned release surface — after any `bun.lock` change, regen with `bunx bun2nix -l bun.lock -c ../ -o nix/bun.nix` (bun2nix 2.1.2, same rev as flake.lock) and normalize lock registry URLs to npmjs.org before pushing; the flake's `bun-lock` check is the detector.

## v18.4.3 (Zeta — dev/main 实验线,五 tag 直拉合并,2026-09-29)

用户授权跳过分步,从 v18.3.4 基线一步直拉 v18.4.3(覆盖 v18.3.5/v18.4.0/v18.4.1/
v18.4.2/v18.4.3 五个 tag 的增量)。干跑 255→实跑 288 冲突(多出的 33 为锁文件/
CI 工件类机械冲突),谱系检查通过。

| 项      | 值                                                                                                                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 起点    | `dev/main` @ `e72cdcea7bc`(v18.3.3+34 合并后基线)                                                                                                                                                         |
| v18.4.3 | tag `fc671eba383f2a7208500836673b485c0dc7073d`(远程核验未移动);merge-base = v18.3.4 `dff728c572a` ✓                                                                                                       |
| 增量    | 656 提交;上游性能大年——cache-warming、投机 task 启动、grep 流式背压、Oniguruma 高亮(内存 −5x)、流式/transcript/工具热路径大扫除(PR #13650)、~20 连发 perf(tui)(首屏 722ms 分帧、overlay 300KB→9KB 帧写入) |

**v18.4.3 冲突决策(288)**:

- **类 4 恢复(批量 stage-3 后逐项)**:InteractiveMode sidebar 面
  (`SidebarComponent` 构造/`applySidebar`/`handleSidebarToggle`/
  `handlePlanUltraCommand` + `PlanWorkflow` ultra 参数链:
  `handlePlanModeCommand` 第三参 + `#enterPlanMode` 类型回 `PlanWorkflow`);
  tui component `getSidebarContext`/`setStatusLineSidebarOpen` + 两处
  `session_name` 段隐藏条件;`SttCallbacks.requestRender`(STT 子系统全 Zeta
  自有);segments.ts `turn_stats` 段(schema/turn-stats.ts 存活,仅注册项丢失)。
- **UD 处置事故与修复**:无差别 `git rm` 循环把 stage-3 失败文件与真 UD 混删,
  182 个 staged 删除中 127 个上游仍在——经 `git cat-file -e v18.4.3:$f` 全量
  审计后按 scope 归一化指纹三版脚本恢复(65 取 theirs+清扫、62 双改取 theirs)。
  教训:UD 循环必须先探测 stage-3 可得性,不可盲删。
- **web/search modelRoles 迁移处置**(上游把 provider 选择迁到 role chain + TUI
  `web-search-types`):
   - 保留并重建:`types.ts` Zeta 导出(`SEARCH_PROVIDER_ORDER/CHOICES/
PREFERENCES`/`isSearchProviderId/Preference`)改从 TUI `SEARCH_PROVIDER_LABELS`
     派生(与上游新优先级序对齐);`index.ts` 重导出 setter;`geminiModel` 管道
     (providers.webSearchGeminiModel → provider.search)恢复;`provider` pin 参数
      - scoped 过滤块恢复(上游已删 `hoistProvider`——考证其在基线即无效:engine
        marker 模型 `provider` 字段恒为 "web",语义全在过滤块);exclusion 层完好
        (public.ts 扇出过滤存活)。
   - 随上游放弃:setup 向导 search-provider 步骤(向导整体重写,`saveSearchProvider`
     死于重写;providers tab 仍是配置入口)。
   - **惰性化决策**:webSearchOrder 在基线即惰性(`resolveProviderCandidates`
     0 调用方,orderedProvIds 无读者),维持基线形态不加戏;**image 侧
     `providers.imageOrder` 运行时消费随旧 candidate 循环被上游删除而失活**
     ——`setImageProviderOrder` 保留为状态种子(settings 面/zh 翻译/legacy 迁移/
     provider-globals 测试契约完整),按 role chain 的重集成列为后续工作。
- **品牌**:logger 日志文件名回 `zeta.*`(上游 v18.1.17+ omp.* + 新 stderr-guard
  `onRotate` 机制保留);dirs.ts `expandWindowsLongPath` import scope 归
  `@linxiraos/pi-natives/path`;jfind `omp://`→`zeta://` 全量清扫(含
  `complete("zeta")` scheme 前缀——裸 `"omp"` 字符串 sed 扫不到,靠测试暴露);
  stats README、composer-cache 注释、git-utils 测试 fixture 回 linxira-zeta;
  `Symbol.for("omp.expectedCleanupError")` 保留(postmortem.ts 源码即此名,
  进程间协议符号);测试文件名对同步(logger-contract/stderr-guard/rotation
  probe 全部 zeta.*)。
- **测试契约**:runtime-global-dispose 定为「上游 v18.4.3 形态 + scope 改名 +
  `__zeta_*` 符号清扫」——合并曾把上游版原样带入(回退了 v18.1.21 清扫),
  修复时先取基线整文件,后按 tag 窗口核对(v18.3.4→v18.4.3 该文件唯一上游
  动作 = `aa5aab0ffb4` 测试清扫提交删除 dispatcher identity 冗余测试)改为
  跟随上游删除、保留清扫——与上游最小分叉。
- **changelog**:各包上游段全剔(含 legacy 15-18.x 档案段)。
- **生成物**:rules.json/catalog 编译物、bun.lock、nix 三件套随合并刷新;
  MODULE.bazel.lock 无本地 bazel,维持 CI 验证回路(过期则取工件回提)。

**natives 类 5(双平台)**:合并新增 `expandWindowsLongPath`(Windows 8.3 路径
展开)、`summarizeCodeAsync`(tree-sitter 线程池化)、grep `onMatches` 流式+
背压。本地重建路径:Windows 侧无 VS Build Tools 时用 GNU 工具链替代——
`rustup target/toolchain install nightly-<pin>-x86_64-pc-windows-gnu` + msys2
ucrt64 gcc,`cargo build -p pi-natives --target x86_64-pc-windows-gnu --profile
local`,产物改名 `pi_natives.win32-x64-modern.node`(宿主 build script 会撞
link.exe:Git Bash 的 GNU link.exe 遮蔽 MSVC linker);Linux 侧 WSL 同法
(`x86_64-unknown-linux-gnu` → `libpi_natives.so` → `pi_natives.linux-x64-
modern.node`)。CI bazel 现场构建不受影响。

**测试裁决**:

- WSL Rust(test:rs):3084/3085 通过;唯一失败 `detach_git_dir_..._snapshot_fails`
  为 WSL-root 环境噪声(chmod 000 拦不住 root,测试前提失效;测试体与实现
  三方逐字一致,CI 非 root Linux 不受影响)。
- **WSL coding-agent 全量(脏树状态,1602 staged 文件)误判教训**:单进程
  `bun test` 下 InteractiveMode 系列成片 5s 超时(单测试隔离 <1s、放大 timeout
  后 25-52s)——根因是每个 InteractiveMode 实例经 pi-vcs `status_porcelain`
  对进程 cwd(本仓库)spawn `git --no-optional-locks status`,合并中的脏树 +
  WSL drvfs 使每次数秒、并发叠加成风暴。纯上游/基线 worktree(干净树)同测试
  飞快佐证。**非代码回归**;fresh checkout 的 CI 与提交后的干净树不受影响。
  单文件隔离复跑 33 个失败文件:20 个纯串跑污染产物;其余为 zh 缺口(已修)、
  `.omp` 契约(已扫)、symlink/EBUSY/drvfs 环境族。
- Windows utils 包:12 失败与基线 worktree **逐条一致**(安装锁/zip symlink/
  SQLite 损伤恢复/EBUSY 族)——零净增。
- Windows coding-agent 全量:234 失败 + 1 挂死(collab 后某测试)属 Windows
  噪声族形态(EBUSY 临时目录/5s hook 超时),WSL Linux 全量为裁决环境。
- jfind `complete("omp")`→`complete("zeta")`、logger 文件名对、runtime-global
  清扫恢复后各自桶全绿;cli-provider-settings 2 超时经基线 worktree 对照判为
  既有 Windows 噪声(TempDir.remove 句柄滞留)。
- **合并比较规范纠偏(用户指出)**:冲突考证一律用上游 tag 窗口差异
  (v18.3.4→v18.4.3),不得用我们树 vs 上游 tag(会把 Zeta 分叉差异误当损伤)。
  已按正确形式逐文件复核:agent-session.ts 上游窗口 375 新增行全部在位;
  全部合并后触碰文件的"缺失行"均为 scope 改写/品牌清扫的等价形态,无上游
  内容丢失。

**推送前 CI 风险预扫(第三轮惯例)命中并修复**:

- **类 7 回潮**:合并把上游 ci.yml 的 12 处 omp-kata runner 带回(10 处
  `pull_request && ubuntu || omp-kata` 条件 + 2 处裸 omp-kata;dispatch 事件
  会打到不存在的 runner 排队死)。全部恢复 ubuntu-22.04;needs 图校验无悬挂。
- **changelog 清扫过切(自伤)**:剔上游段时把 6 个包的**已发布段**内容一并
  清空(coding-agent 1.1.10 十条、collab-web 1.0.0、mnemopi 1.1.19、
  natives 1.1.11、stats 1.1.19、utils 1.1.18 各一条),违反"Released 段
  不可变";changelog-summary 契约测试逮住,已按基线回植,49 项契约全绿。
  教训:changelog 清扫只允许动 omp 键段(如 `1.1.21-omp15.11.1` 与上游
  archive 链接行),已发布 1.1.x 段逐字不动。
- **类 9 收尾**:worker-core.test 同行混扫(`__zeta_worker_core_gate` +
  `__omp_session__`)统一为源码注入的 `__zeta_session__`;browser-recording
  的 `__omp_recording_cursor__` 与源码一致保留。
- **遗留(dev→main 合并时决策)**:release 矩阵与 bazel-cache-warm 的
  `xcode-27`(上游自有 ARM macOS runner)——tag/main 事件才会触发,届时
  映射为托管标签或按 v18.3.3 裁剪决策处理;`ubuntu-24.04-arm`/`windows-11-arm`
  为 GitHub 托管标签,保留。

**CI 首轮(36598768135)失败复盘与"每轮同类错误"根因(用户命题,2026-09-30)**:

六个红 job 的逐项根因——全部归于**同一结构性病根**:

| 失败 | 根因 | 修复 |
|---|---|---|
| session-resolution ×7 | main.ts hint "Run \`omp --resume\`" 未扫,测试期望 zeta | 清扫 + 守卫 |
| xAI UA | 测试正则 `/^omp\/\d/` 未扫(USER_AGENT 源是 zeta/) | 清扫 + 守卫 |
| baseten 默认模型 | 上游 models.json 换掉 Kimi-K2.7-Code,Zeta 描述符默认值漂移 | KDL 默认→K3 + gen:compat |
| agent-storage | 测试 env 块是上游契约 `PI_CODING_AGENT_DIR`,源码只读 ZETA_* | env 块回基线 + 守卫 |
| js-executor/js-pkg-env/eval-timeout/install-smoke | **`JS_EVAL_PROCESS_ARG="__omp_worker_js_eval_process"`(源)vs cli.ts 只派发 `__zeta_worker_*`**——子进程当普通 CLI 全量启动后报错退出,worker init 10-15s 超时级联("JS context disposed"/"No models available" 均其连锁) | 协议名对齐(执行 10.9s→4.3s=基线水平,WSL 全绿) |
| windows-staging | 夹具写死 15.10.x(相对上游 18.x 是"旧版"),我们 1.x 版本线判定翻转 | 夹具随 currentMajor 推导 |
| composer XDG | 测试期望 `$XDG_CACHE_HOME/omp/…`,源码是 zeta/ | 清扫(Linux 验证) |
| MODULE.bazel.lock | **Cargo.lock 12 行版本线修复(18.4.3→1.1.21)在锁生成之后**,crate_universe 哈希失新 | 取 CI 刷新工件回提(5 行哈希) |

**为什么每轮合并都在同几类上翻车(结构性根因)**:

1. **双面 token 只扫一面**。Zeta 清扫是"把上游品牌面改成我们的",但同一
   token 往往存在于**生产者与消费者两侧**(源码 vs 测试、JS vs Rust、
   spawn 参数 vs 派发表)。人工 sed 按文件/按模式扫,永远扫不齐;而
   `check:ts` 对字符串/正则/env 名**完全失明**——错配编译全绿,只在
   运行时/CI 炸。这是最大的时间黑洞。
2. **守卫表只认"品牌面",不认"契约面"**。brand-rules 原有规则盯
   π/PI_LOGO/scope/URL scheme,但 worker 协议参数、env 名、UA 正则、
   CLI 提示串这些"跨面契约 token"不在表里——每轮靠 CI 试错发现。
3. **上游测试夹具携带上游坐标**(版本号 15.10.x、runner 标签 omp-kata、
   向导步骤)——这些不是品牌,是"上游世界假设",合并原样带入即错。
4. **生成物顺序耦合**:Cargo.lock→MODULE.bazel.lock 的哈希链,版本线
   修复必须在其上游一切 Cargo 变更之后重刷,否则 freshness 门禁红。
5. changelog 清扫无段落感知(本轮自伤已述)。

**对策(已落实)**:`brand-rules.ts` MUST_NOT_CONTAIN 新增"跨面 token 对"
组:`__omp_worker_*`(argv 协议)、`PI_CODING_AGENT_DIR`(env 契约)、
`USER_AGENT` omp/ 模板与 `/^omp\/\d` 测试正则、`` Run `omp `` CLI 提示——
命中即红,producer/consumer 两侧同受约束;守卫首跑即逮住 Rust 侧
crash_handler 读旧 env 名的**基线遗留同类病灶**(顺手治愈:ZETA_* + fmt 绿)。
上表各修复随 `bun scripts/brand/brand-check.ts` 常驻 CI check job。


## v18.3.3 + v18.3.4 (Zeta — dev/main 实验线,增量双 tag 串联合并,2026-09-29)

按「上游增量合并规程」在 `dev/main` 上完成的两步串联合并;干跑预测与实跑逐个
相符(v18.3.3:135;v18.3.4:15),谱系检查全程通过。

| 项      | 值                                                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 起点    | `dev/main` @ `7d88e8190f9`(14 批 CI 修复全绿基线,CI 36435585671)                                                                                                                                         |
| v18.3.3 | tag `608ac7360ff`(远程核验未移动);merge-base = v18.3.2 `7853b4e4999` ✓;合并提交 `c9b8c2d1413`                                                                                                            |
| v18.3.4 | tag `dff728c572a`;merge-base = v18.3.3 ✓;合并提交 `14e774c9d94`                                                                                                                                          |
| 增量    | v18.3.3:454 文件/31k 行(TUI autocomplete+@-mention、SmolLM 预测文本、natives 哨兵→stamp 机制、CI 基建重构);v18.3.4:143 文件/32k 行(vendored napi 线程 env 泄漏修复、task effort 重构、prompt cache 保全) |

**v18.3.3 冲突决策(135)**:

- 机制变更整对接受:natives 版本哨兵 → `__piNativesBuildVersion` stamp 机制
  (四个 Zeta 检查器同步改锚机制符号);ci-release-publish 并发管线重写
  (editor/work vendored 分支重嫁接为 `publishVendoredNpmDirs`,--dry-run 冒烟);
  ci.yml 重建(接纳 bazel_lock + native_addons_cross 进 gate;**裁掉**
  release_binary_hosted/release_github_verify/release_brew 三个 darwin/上游
  tap job 与 linux-arm64 发布矩阵——安装器面未跟上;omp-kata 全扫为
  ubuntu-22.04;7 个 Zeta job 重应用);command-usage.ts 与
  tiny-title-download-progress.ts 随上游机制替换删除。
- **拒绝上游 OMP_PROFILE env 优先级**(与用户机器上真 OMP 冲突),保持
  ZETA_PROFILE 单源。
- 批量 stage-3 后的类 4 恢复:AgentSession mode API + state_version_changed、
  tools/index 五个 channel/im 工厂、InteractiveMode sidebar/plan-ultra 成员、
  handlePlanModeCommand workflow 参数、builtin registry i18n 解析器、
  worker 哨兵重扫 `__zeta_worker_`(含新增 text_predict)、ZETA_LOGO/icon.omp、
  omp→zeta 提示串、四条 slash 描述 M 键化。
- 生成物:rules.json 重生成(local.kdl lfm)、bun.lock/nix 刷新、changelog
  rekey 1.1.21-omp*、set-version 全绿。
- 测试裁决:净新增失败 16 全清(9 修复:hint 串/plan-ultra 注册/zh 契约/
  unsettled 断言/prewarm 测试迁移 setModelRole;5 Windows 噪声;2 慢测试
  ——x-codex-turn-state SSE 对在 30s 预算下通过,CI 120s 覆盖)。
  基线差集法(worktree 对照)用于区分既有噪声与合并伤。
- bunfig 修剪:root `bun test` 不再扫 editor/termide/web-ui(各有独立门禁)。

**v18.3.4 冲突决策(15)**:全部机械(Cargo 版本行保 1.1.21 + napi vendor
条目、import 并集、测试断言守卫、lockfiles);新文件 scope 清扫;task 桶
Windows 12 失败经 WSL 判定为符号链接族噪声(Linux 0 fail)。

## OMP Web divergence (Zeta — own-desktop upgrade, upstream frozen)

- **Date**: 2026-09-10; **Branch**: `feat/desktop-ui-upgrade` (from `main@43d39b9f5f`)
- **Policy change**: `omp-web-upstream` is no longer a merge source. `web-ui/`
  is Zeta-owned and diverged as of this branch; only manual cherry-picks from
  `temp/omp-web` hereafter, each recorded here.
- **Baseline before divergence**: `omp-web@c71edcb2a5` (the snapshot
  `web-ui/` was carried at since adoption).
- **Absorbed source**: `omp-web@f09920e` (9/9 overhaul; 136 files,
  +11742/−2096) — semantic port, not raw copy.
   - Absorbed: 21 component overhauls (AppShell/ChatInput/ChatMinimap/
     ModelsConfig/SkillsConfig/FileExplorer/SessionSidebar/…), ExtensionStatusBar
     extraction, useResizablePanel/useViewportHeight hooks, event-stream
     hardening + model-scope overrides in useAgentSession, starfield +
     ViewTransition styling, Windows drive-picker browser helpers,
     git line-stats, request-security hardening, models-config
     catalog/discover/metadata gateway endpoints.
   - Not absorbed (scope boundary): PWA surface (manifest/sw/offline),
     ProjectTrustDialog + project-trust, upstream useI18n catalog (Zeta's is
     stronger), rpc-manager (server-only; superseded by gateway), session-title.
   - Preserved Zeta surfaces: i18n catalog (`lib/i18n` + messages zh-CN/en),
     theme system (40+ JSON themes), gateway rewrite (`/api/*` → zeta serve).
- **Ledger discipline**: future omp-web cherry-picks get a dated subsection
  under this entry.

## OMP Release Sync Policy

- Only OMP official release tags are integrated (see AGENTS.md). Never raw commits or `omp-upstream/main`.
- `sync/omp` is an unmodified mirror, never merged into product.
- Integration happens on short-lived `sync/omp-release/<release>` branches, deleted after merge to `main`.

## Current Baselines

- OMP: `v18.1.14` (peeled tag `daf07999c2fee9b22edc7bf8fea1fb6272e0df5e`; v13 `a1b254047d` also in history via the dual-tag serial merge)
- Zeta: `1.1.10` (version line holds across the published `@linxiraos/*` packages; release tag pending)
