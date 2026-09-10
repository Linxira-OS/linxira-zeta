# Upstream Sync Ledger

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
  - Mechanical: `@oh-my-pi/*` scope residue from silently merged upstream files (606 hits) → swept to `@linxiraos/*` with the RENAME_BY_TAIL mapping; a bad perl pass truncated some to `@oh/` (12 files) — repaired.
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

## OMP Release Sync Policy

- Only OMP official release tags are integrated (see AGENTS.md). Never raw commits or `omp-upstream/main`.
- `sync/omp` is an unmodified mirror, never merged into product.
- Integration happens on short-lived `sync/omp-release/<release>` branches, deleted after merge to `main`.

## Current Baselines

- OMP: `v18.1.14` (peeled tag `daf07999c2fee9b22edc7bf8fea1fb6272e0df5e`; v13 `a1b254047d` also in history via the dual-tag serial merge)
- Zeta: `1.1.10` (version line holds across the published `@linxiraos/*` packages; release tag pending)
