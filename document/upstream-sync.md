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

## OMP Release Sync Policy

- Only OMP official release tags are integrated (see AGENTS.md). Never raw commits or `omp-upstream/main`.
- `sync/omp` is an unmodified mirror, never merged into product.
- Integration happens on short-lived `sync/omp-release/<release>` branches, deleted after merge to `main`.

## Current Baselines

- OMP: `v18.1.10` (fetched tag `f241301c83726afe75a847e919b89977a54dafbe`)
- Zeta: `1.1.9` (tag on `main`; release run in flight at the time of the brush-core stop-detection repair), version line holds across 14 published `@linxiraos/*` packages.
