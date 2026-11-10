# GitHub CI tiers

Scope: `.github/workflows/ci.yml` only. Gitea has its own mirror in
`.gitea/workflows/local-ci.yml`; this document does not change it.

## Why tiers exist

The full gate is expensive because it compiles Bazel native addons, cross-target
addons, the Rust workspace, and the GUI workspaces. A TS-only change does not
need any of that before review. A native-changing PR does; a merge to `main`
does; a release does not need to repeat tests that the source commit already
passed.

The rule is:

- **PR / non-main dispatch** = fast validation.
- **main push** = full validation.
- **release** = no test fan-out; build and publish from the green source SHA.

This mirrors upstream's split: PR skips Rust and cross builds, restores main's
native cache or the npm leaf, and shards the longest TS bucket. The difference
is that upstream runs `main` on warm self-hosted runners; GitHub-hosted runners
are cold.

## Current fast path

`workflow_dispatch` on a non-main ref is treated like a PR. The `full` input
opts back into the main gate when a manual run really needs it.

| Job | PR / non-main dispatch | main push | release |
|---|---|---|---|
| `check` | runs | runs | runs; workspace type-check skipped |
| `rust_validate` | skipped | runs | skipped |
| `native_addons` | restore main cache or npm; no build | restore exact main cache; build and save on miss | restore exact main cache; build on miss |
| `native_addons_cross` | skipped | restore exact cross cache; build and save on miss | restore exact cross cache; build on miss |
| `test_coding_agent_native` | 3 shards | 1 shard | skipped |
| `test_coding_agent_browser` | skipped | skipped | runs |
| other TS buckets | run | run | skipped |
| `termide_tests` | diff against `origin/main`; skip untouched | diff against the pushed base | skipped unless needed |
| release/publish jobs | skipped | skipped unless HEAD carries a `v*` tag | run |

Native cache key inputs are Cargo/Bazel/rust-toolchain/build files. A version
bump does not change them, so the release run can reuse the source commit's
cache entry. Every full-gate branch restores the exact main cache first; only a
key miss builds. `native_addons_cross` uses its own prefix over the same inputs,
so a non-native main push also skips the cross build.

### The browser bucket runs off the push path

`test_coding_agent_browser` holds the coding-agent suites that launch real
Chromium (or drive a CDP endpoint): every `browser*.test.ts` plus the
PDF-screenshot renderer. They are the slow, timing-sensitive tail of the old
native bucket, so they never gate an ordinary push or PR. They run:

- nightly, on the `schedule` trigger (03:37 UTC);
- on a `workflow_dispatch` with `browser_tests` enabled;
- on every release-state run (a `v*` tag at HEAD).

Because the push run does not execute them, `release_gate` lists the job in
`needs` and carries an explicit `Assert the browser bucket ran` step: a skipped
prerequisite fails the gate rather than publishing a release whose browser
suites never ran. Local full runs are unchanged — `bun test` / `bun run
test:ts` route through `coding-agent-heavy`, which includes the bucket.

## What may be skipped

Always allowed to skip on PR / fast path:

- Rust workspace validation;
- cross-target native builds;
- release and packaging jobs;
- real-browser/Chromium suites (nightly + release only, plus an explicit
  `browser_tests` dispatch);
- GUI/termide gate when those paths are untouched.

Never skipped for affected code:

- type check, lint, brand/docs guards;
- unit and integration tests for changed packages;
- native/Rust validation when native inputs changed;
- full validation on `main`;
- the source commit's green run before a release tag is created.

## GitHub-hosted runners are cold

`ubuntu-22.04` starts a fresh VM per job. `actions/cache` restores files, not a
warm Bazel server, Rust target directory, or CPU cache. Do not expect
self-hosted `vmon` timings from GitHub-hosted runners.

Real warm runs require a persistent self-hosted Linux runner for `main` and
release, with persistent Bazel/Cargo/Bun caches. PRs should stay on hosted
runners unless the repository is private and every contributor is trusted.

## Next stages

1. Path tiering: a `ci_plan` job drives `native`, `web`, `gui`, and `ts` jobs
   from changed paths so docs-only and web-only runs do not execute every
   bucket.
2. A single `CI / required` aggregator as the branch-protection check; skipped
   jobs count as success, failed executed jobs fail the aggregator.
3. Validate the cross cache hit path on a non-native main push and release.
4. Self-hosted `main` runner if the cold-hosted full gate remains the
   bottleneck.

Auto-merge is not part of this workflow change. It only becomes relevant after
the PR required-check surface is stable; it never resolves semantic conflicts.
