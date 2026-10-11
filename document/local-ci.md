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
   [One-time Gitea setting](#one-time-gitea-setting) for the server-side
   half of that guarantee.

## Job map

| GitHub CI job | Local mirror | Notes |
| --- | --- | --- |
| `check` | `check` | type check + brand/sentinel/CI-surface guards + collab web build + **parity guard** |
| `web_ui_build` | `web_ui_build` | npm ci / tsc / lint / build |
| `bazel_lock` | `bazel_lock` | `--check` only; no artifact upload (GitHub-side convenience) |
| `rust_validate` | `rust_validate` | bazel `test //crates/...`, three clippy scopes, rustfmt |
| `native_addons` | `native_addons` | linux-x64 pair only, built straight into `packages/natives/native/` |
| `test_coding_agent_native` | same id | single shard (`1/1`) |
| `test_workspace` | same id | includes the two repo-script test files GitHub runs here |
| `test_coding_agent_singleton` | same id | |
| `test_ts_native` | same id | |
| `test_coding_agent_ui` | same id | |
| `test_coding_agent_runtime` | same id | |
| `test_smoke` | same id | CLI smoke |
| `install_methods` | same id | |
| `editor_tests` | `editor_tests` | Go tests + functional vitest (zetaeditor) |
| `termide_tests` | `termide_tests` | fmt / check / clippy / nextest (zetaide) |
| `main_tests` | `main_tests` | fmt / check / clippy / tests (zetawork) |
| `desktop_linux` / `desktop_windows` | `desktop_tests` | both are `is-release`-gated on GitHub; locally only the **test half** runs (`desktop npm test`) — packaging stays a release concern |
| `release_*`, `release_metadata`, `release_gate`, `native_addons_cross` | — | excluded by design |

Local-only jobs: `preflight` (tag guard), `toolchains` (persistent toolchain +
`bun install`), `desktop_tests` (release-gated job's test half).

## Suites (per-run skipping)

`workflow_dispatch` takes a `suite` input; `push` to `main` always runs
`full`.

| suite | covers |
| --- | --- |
| `full` (default) | everything above |
| `gates` | static gates + web-ui + desktop contracts + editor + vendor Rust workspaces |
| `ts` | native addon build + all six TS buckets + CLI smoke + install methods |
| `rust` | bazel lock + `rust_validate` + native addons + vendor Rust workspaces |

## Why it is faster than GitHub CI (and where it deliberately differs)

The runner workspace is persistent, so:

- toolchains live in `$GITHUB_WORKSPACE/.tools` (bun pinned to
  `package.json#packageManager`, rustup with the repo nightly plus the two
  vendor pins, bazelisk, cargo-nextest, cargo-deny, node, go). A per-run
  ephemeral `HOME` would throw all of that away — that was the failure the
  `.tools` layout was introduced to fix.
- cargo `target/` dirs and the bazel disk cache (`~/.cache/omp-bazel-disk`)
  survive between runs, so Rust re-verification is incremental.
- the native addon is built once, in place; no artifact upload/download
  round-trip and no `actions/cache` key bookkeeping.

Deliberate deviations from `ci.yml`, all documented inline in the workflow:

- no GitHub artifact/cache plumbing (see above);
- `OMP_TEST_CHUNK_TIMEOUT=900` — the 600 s watchdog mis-fires on a slower
  always-on box (it has already killed the
  `scripts/ci-test-ts.test.ts scripts/release.test.ts` chunk);
- single shard instead of a 3-way matrix (one runner, not eight).

Everything that *decides* whether the tree is good is the same code path as
GitHub: `bun run ci:test:*`, `bun scripts/*.ts` guards, `cargo
fmt/check/clippy/nextest`, `bazelisk test`, `go test`.

## Drift guard

`scripts/check-local-ci-parity.ts` fails when:

- a `ci.yml` job is neither mirrored nor listed as an acknowledged exclusion;
- a mirrored job is missing from the local file (or vice versa);
- a mirrored job no longer calls the same repo entry points (`bun run …`,
  `cargo …`, `bazelisk …`, `go …`);
- the local workflow contains anything publish-shaped (`release_`, `publish`,
  `git push`, `tag -f`).

It runs as the last step of the local `check` job:

```sh
bun scripts/check-local-ci-parity.ts
```

Add a new GitHub job → the guard goes red → either mirror it or record it in
`EXCLUDED` with a reason.

## Running it without Gitea

The workflow is a thin shell over repo scripts, so the same coverage is one
command away on a Linux box (WSL included):

```sh
bun install
bun scripts/check-local-ci-parity.ts
bun run ci:check:full
bun scripts/brand/brand-check.ts
bun scripts/check-zeta-sentinels.ts
bun scripts/check-ci-surface.ts
cargo build --release -p pi-natives        # then copy into packages/natives/native/
bun run ci:test:full                       # every TS bucket + cargo nextest
```

## One-time Gitea setting

Repository files alone cannot stop a Gitea instance from *also* picking up
`.github/workflows/*.yml` (Gitea Actions scans both trees). Disable them once
in the Gitea UI — repository → **Actions** → disable `CI`, `Zeta Nix`,
`Warm bun store cache`, `Publish …` — or, if the instance is yours, turn off
Actions for `.github/workflows` globally.

Until that is done, treat "Gitea must not run GitHub's workflows" as an
operational rule, not an enforced one: **never push `v*` tags to the `gitea`
remote** (releases push to `origin`/GitHub only, via
`scripts/release-v2.ts`), because a `ci.yml` release run is triggered by a
tagged main HEAD.