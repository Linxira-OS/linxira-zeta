# Local CI (Gitea-only Linux mirror)

`.gitea/workflows/local-ci.yml` is a **Linux-only mirror of the verification
jobs** in `.github/workflows/ci.yml`. It exists so the release line — which
targets our own Arch-based Linux distribution first — can be verified on our own
hardware before anything reaches GitHub.

Two rules define it:

1. **It never publishes.** No release/publish job exists in it, its `push`
   trigger is pinned to the `main` *branch* (a tag ref cannot match), and the
   first job refuses to run when the ref is a tag or when HEAD carries a `v*`
   tag. Release semantics stay exclusively on GitHub.
2. **It never runs GitHub's workflows.** The file lives under `.gitea/`, so the
   Gitea runner executes the mirror and nothing else. See
   [Gitea server-side checklist](#gitea-server-side-checklist) for the
   server-side half of that guarantee.
3. **It can run from behind a domestic mirror.** Every download a
   China-hosted runner cannot reach reliably (npm/bun registry, node tarball,
   electron, rustup, cargo index, GitHub release assets, bazel archives) is
   normalised through an overridable knob in this workflow's `env:` block. See
   [Domestic mirror layer](#domestic-mirror-layer-transport-only).

## Job map

**Sync rule — three places, one edit.** Adding or removing a CI job means
changing all three of:

1. the job body in `.github/workflows/ci.yml`;
2. its mirror in `.gitea/workflows/local-ci.yml` — or an entry in the guard's
   `EXCLUDED` / `LOCAL_ONLY` with the reason it is not mirrored;
3. this job map.

`scripts/check-local-ci-parity.ts` only guarantees 1 ↔ 2 (job classification,
both directions, plus the entry-point sets). Nothing checks this document, so
it is the one that rots silently. The guard now runs in **both** `check` jobs —
the Gitea one and GitHub `ci.yml`'s — so a merge that desyncs the mirror
reddens the GitHub run too.

| GitHub CI job | Local mirror | Notes |
| --- | --- | --- |
| `check` | `check` | type check + brand/sentinel/CI-surface/scope/release-asset guards + i18n guards + collab web build + **parity guard** |
| `web_ui_build` | `web_ui_build` | npm ci / tsc / lint / build |
| `bazel_lock` | `bazel_lock` | crate-coverage guard + `--check`; no failure-refresh/upload (GitHub-side convenience, registered in `ENTRY_EXCEPTIONS`) |
| `rust_validate` | `rust_validate` | bazel `test //crates/...`, three clippy scopes, rustfmt |
| `native_addons` | `native_addons` | linux-x64 pair only, built straight into `packages/natives/native/` (no artifact round-trip, registered in `ENTRY_EXCEPTIONS`) |
| `test_coding_agent_native` | same id | single shard (`1/1`) |
| `test_workspace` | same id | includes the two repo-script test files GitHub runs here |
| `test_coding_agent_singleton` | same id | |
| `test_ts_native` | same id | |
| `test_coding_agent_ui` | same id | |
| `test_coding_agent_runtime` | same id | |
| `test_smoke` | same id | CLI smoke |
| `install_methods` | same id | |
| `termide_tests` | `termide_tests` | fmt / check / clippy / nextest (zetaide) |
| `main_tests` | `main_tests` | fmt / check / clippy + `cargo nextest run` (GitHub has no nextest, registered in `ENTRY_EXCEPTIONS`) |
| `web_desktop_tests` | `desktop_tests` | the desktop contract suites + the CLI's Web UI launcher resolution |
| `release_*`, `release_metadata`, `release_gate`, `native_addons_cross` | — | excluded by design: release chain (1.3.0 起桌面与工作台 TUI 已退出发布面), Windows/macOS legs |

Local-only jobs: `preflight` (tag guard) and `toolchains` (persistent toolchain
store + `bun install`).

## Suites (per-run skipping)

`workflow_dispatch` takes a `suite` input; `push` to `main` always runs
`full`.

| suite | covers |
| --- | --- |
| `full` (default) | everything above |
| `gates` | static gates + web-ui + desktop contracts + vendor Rust workspaces |
| `ts` | native addon build + all six TS buckets + CLI smoke + install methods |
| `rust` | bazel lock + `rust_validate` + native addons + vendor Rust workspaces |

## Why it is faster than GitHub CI (and where it deliberately differs)

The runner workspace is persistent, so:

- toolchains live in `$HOME/.local-ci-tools` (bun pinned to
  `package.json#packageManager`, rustup with the repo nightly plus the two
  vendor pins, bazelisk, cargo-nextest, cargo-deny, node). Two properties
  matter: the directory must outlive the run (a per-run ephemeral `HOME` would
  throw it away) and it must be the *same* directory for every job. The host
  executor gives each job its own `act/<hash>/hostexecutor` workdir, so
  `$GITHUB_WORKSPACE/.tools` was per-job: the bootstrap job populated its copy and
  every consumer then failed its `Toolchain PATH` step with
  `…/.tools/env.path is missing` (run 538). Jobs resolve the store as
  `${LOCAL_CI_TOOLS:-$HOME/.local-ci-tools}`; the bootstrap job exports `TOOLS`
  through `$GITHUB_ENV` for its own later steps. `CARGO_HOME=$TOOLS/cargo` is
  also where the cargo mirror config lives (below). There is **no** Go
  toolchain: the only Go job was the retired vendored editor, so the install
  step and both PATH entries are gone with it.
- cargo `target/` dirs and the bazel disk cache (`~/.cache/omp-bazel-disk`)
  survive between runs, so Rust re-verification is incremental.
- the native addon is built once, in place; no artifact upload/download
  round-trip and no `actions/cache` key bookkeeping.

Deliberate deviations from `ci.yml`, all documented inline in the workflow:

- no GitHub artifact/cache plumbing (see above);
- `OMP_TEST_CHUNK_TIMEOUT=900` — the 600 s watchdog mis-fires on a slower
  always-on box (it has already killed the
  `scripts/ci-test-ts.test.ts scripts/release.test.ts` chunk);
- single shard instead of a 3-way matrix (one runner, not eight);
- `cargo nextest run --workspace || cargo test --workspace` where GitHub runs
  `cargo test --workspace` (nextest ships in the persistent store);
- `native_addons` stages the built `.node` straight into
  `packages/natives/native/` instead of downloading an artifact;
- `bazel_lock` reports the refresh hint instead of regenerating the lockfile;
- downloads go through the mirror knobs below.

The last four are recorded in the guard's `ENTRY_EXCEPTIONS`; the mirror knobs
change no command, only its transport.

Everything that *decides* whether the tree is good is the same code path as
GitHub: `bun run ci:test:*`, `bun scripts/*.ts` guards, `cargo
fmt/check/clippy/nextest`, `bazelisk test`.

## Domestic mirror layer (transport only)

The runner lives behind a domestic link, so every download that is slow or
unreachable from there is routed through a knob in the workflow's top-level
`env:` block. **Transport only**: `Cargo.lock` / `MODULE.bazel.lock` checksums
are still verified per package, so a mirror changes where the bytes come from,
never what they are.

| Knob | Default | Consumed by |
| --- | --- | --- |
| `npm_config_registry`, `BUN_CONFIG_REGISTRY` | `https://registry.npmmirror.com` | every `npm ci` / `npx` / `bun install` / `bun pm` |
| `ELECTRON_MIRROR` | `https://npmmirror.com/mirrors/electron/` | the `desktop` npm ci postinstall |
| `RUSTUP_DIST_SERVER`, `RUSTUP_UPDATE_ROOT` | `https://mirrors.ustc.edu.cn/rust-static[/rustup]` | `rustup` toolchain installs |
| `LOCAL_CI_MIRROR_NODE` | `https://npmmirror.com/mirrors/node/` | the node tarball `fetch` (shell, `${VAR:-default}` at the use site) |
| `LOCAL_CI_CARGO_MIRROR` | `https://mirrors.tuna.tsinghua.edu.cn/crates.io-index/` | `$CARGO_HOME/config.toml`, written by the `toolchains` job |
| `LOCAL_CI_MIRROR_GH` | empty (direct) | proxy prefix for GitHub release downloads (currently `bazelisk`); set it to `https://<proxy>/` |
| `BAZEL_REGISTRY` | unset | optional BCR mirror; exported ⇒ `common --registry=…` is added to the bazel rc |

To switch any of them, edit that one line (or, for the shell-consumed ones, set
the same name in the runner environment — the use sites carry
`${VAR:-<same default>}`). Never hardcode an address only the intranet can
resolve: when a mirror is down the step must fall back to the official source or
fail loudly at the download, not half-run.

Two things the mirror layer deliberately does **not** invent:

- **bun.** `https://bun.sh/install` is not a GitHub URL and its installer builds
  its own GitHub release URL internally, so `LOCAL_CI_MIRROR_GH` cannot cover
  it. If the mirror is unreachable, install bun into `$TOOLS` from the
  distribution's package manager instead of editing that URL.
- **A bazel BCR mirror.** None is assumed to exist. The fallback is the
  persistent `--distdir`: the first `rust_validate` / `native_addons` run warms
  `~/.cache/omp-bazel-distdir` with every BCR/GitHub archive, after which those
  jobs re-run fully offline. `--registry` is only added when `BAZEL_REGISTRY`
  is exported.

None of this touches `.github/**`: GitHub runners are outside the slow link, so
they keep talking to the official registries.

## Drift guard

`scripts/check-local-ci-parity.ts` fails when:

- a `ci.yml` job is neither mirrored nor listed as an acknowledged exclusion;
- a mirrored job is missing from the local file (or vice versa);
- a mirrored job's **entry-point set differs** from its GitHub counterpart in
  either direction — a renamed repo script, a command the mirror drops, or a
  command it grows on its own (`bun run …`, `bun scripts/…`, `bun test …`,
  `cargo …`, `bazelisk …`, `go …`). The comparison is set equality, not
  substring containment, so dropping one command from a mirrored job is caught;
- an entry in the guard's `ENTRY_EXCEPTIONS` allowlist has gone stale (both
  sides agree again) — the allowlist cannot silently hide future drift;
- the local workflow contains anything publish-shaped (`release_`, `publish`,
  `git push`, `tag -f`). Only `step.run` is scanned, so mirror URLs in `env:`
  are fine — but never put such a literal inside a `run:` command.

`ENTRY_EXCEPTIONS` is the *only* way to record a deliberate asymmetry, and every
row carries its reason: today it holds `bazel_lock` (no failure-refresh),
`native_addons` (addon staged in place) and `main_tests` (nextest). Add a row
only with a reason that a reviewer can check.

It runs as the last step of the local `check` job **and** in the GitHub `check`
job:

```sh
bun scripts/check-local-ci-parity.ts
```

Add a new GitHub job → the guard goes red on both sides → either mirror it or
record it in `EXCLUDED` with a reason; add or drop a command in a mirrored job →
either mirror the change or record it in `ENTRY_EXCEPTIONS` with a reason.

## Running it without Gitea

The workflow is a thin shell over repo scripts, so the same coverage is one
command away on a Linux box (WSL included):

```sh
bun install
# One command for every layer — mechanical guards, the three merge audits and
# the behaviour suites — with a single-page pass/fail summary at the end:
bun run merge-gate
bun run merge-gate --gates-only        # guards + merge audits only (pre-merge)
bun run merge-gate --base v18.10.0 --tag v18.10.1
bun run merge-gate --dry-run           # print the plan, run nothing
bun run merge-gate --only audit-members
# …or one step at a time:
bun scripts/check-local-ci-parity.ts
bun run ci:check:full
bun scripts/brand/brand-check.ts
bun scripts/check-zeta-sentinels.ts
bun scripts/check-ci-surface.ts
bun scripts/check-serve-discovery-parity.ts
bun scripts/check-package-json-merge.ts        # merge commit 没吃掉/回退/复活分支侧 manifest leaf
bun run check:nix-bun                        # no nix needed (bunx fallback)
bun run check:relay-assets                   # no zip/bun install needed
cargo build --release -p pi-natives        # then copy into packages/natives/native/
bun run ci:test:full                       # every TS bucket + cargo nextest
```

`merge-gate` is also the only entry point that *gates* on the two orphan suites —
`packages/stats/test` and `plugins/official/pi-messenger/tests` (vitest, outside
the bun workspace, so it installs its own dependencies). `bun run test:ts` alone
still skips both; in CI they run in `test_workspace` and `check` respectively as
`continue-on-error` (annotate-only) steps until their pre-existing failures are
fixed — today 69/214 and 7/438.

## Gitea server-side checklist

Half of this mirror is not in the repository: it lives in the Gitea instance and
the runner host. Nothing here is enforceable from a file, so it is a checklist
for whoever maintains the server. Items marked **(verify)** must be checked
against the running instance before we document their semantics as fact.

**Host level (server maintainer)**

- `/etc/pacman.d/mirrorlist` points at a domestic mirror — we are an Arch-based
  distribution, and the runner box installs nothing from `archlinux.org`.
- `act_runner` can fetch the actions this workflow uses (`actions/checkout`,
  `actions/setup-node`, …): either `DEFAULT_ACTIONS_URL` points at a reachable
  mirror, or those actions are vendored into the instance. The NAS box's egress
  to github.com is intermittent — one reset without a retry loses the whole run,
  which is why every job clones from the Gitea remote instead of using
  `actions/checkout` for the repo itself.
- Optional corporate/home proxy for the remaining direct downloads
  (`LOCAL_CI_MIRROR_GH` in the workflow's `env:` is the hook for GitHub release
  assets).

**Repository level**

- **Runner label:** `self-hosted` — every job in the mirror uses it, and the
  label must exist on the runner (there is no `ubuntu-latest` fallback).
- **Persistent, shared workspace and toolchain store:** the workspace and
  `$HOME/.local-ci-tools` must survive between runs *and* be the same directory
  for every job (run 538: a per-job `$GITHUB_WORKSPACE/.tools` made every
  consumer fail `Toolchain PATH`). Move the store with `LOCAL_CI_TOOLS`.
- **Disable Gitea's scan of `.github/workflows`:** Gitea Actions picks up both
  trees, so disable them once in the UI — repository → **Actions** → disable
  `CI`, `Zeta Nix`, `Zeta generated files`, `Warm bun store cache`,
  `Publish …` — or turn Actions off for `.github/workflows` instance-wide if the
  instance is ours. Until that is done, "Gitea must not run GitHub's pipelines"
  is an operational rule, not an enforced one.
- **Never push `v*` tags to the `gitea` remote** (`gitea@gitea:bhys/zeta.git`):
  a tagged main HEAD triggers `ci.yml`'s release run. Releases push to
  `origin`/GitHub only, via `scripts/release-v2.ts`.
- **No `NPM_TOKEN` is needed.** The mirror never publishes: no release/publish
  job is mirrored, and every `GITHUB_TOKEN` / `gh run watch` step lives in the
  release chain that `EXCLUDED` cuts.
- **Mirror overrides (optional):** the knobs are the workflow's top-level
  `env:` block. For the shell-consumed ones the runner environment can override
  them per deployment; for the tool-consumed ones edit the one line in the
  `env:` block (see [Domestic mirror layer](#domestic-mirror-layer-transport-only)).
- **(verify)** `concurrency` semantics on this instance — the mirror declares no
  `concurrency` group, so overlapping runs of a `push` to `main` may interleave
  on the single self-hosted runner. Confirm before relying on it either way.
- **(verify)** `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` — `ci.yml` sets it for the
  GitHub runners; the mirror does not, and whether the Gitea-side runner honours
  it (or needs its own Node) is unverified.
- **(verify)** whether the runner passes its own environment into job containers
  (it affects how the `LOCAL_CI_MIRROR_*` overrides above reach a step).