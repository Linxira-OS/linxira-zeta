# Native Crates

Contributor map for Rust workspace members under `crates/`. They are implementation details behind `@linxiraos/pi-natives` and its embedded shell; package consumers use JavaScript entrypoints, not these crate APIs.

The root `Cargo.toml` lists every crate under `crates/` explicitly in `workspace.members` — add new crates there. Its `[patch.crates-io]` selects vendored `cfg_aliases`, `grep-searcher`, `napi`, and `tree-sitter-go`.

## First-party crates

| Crate         | Path                                          | Role and consumers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `omp-natives`  | [`crates/natives`](../crates/natives)   | Top-level N-API `cdylib`. It exposes the JS-visible API and depends on `omp-ast`, `omp-diff`, `omp-edit`, `omp-iso`, `omp-predict`, `omp-shell`, `omp-vcs`, `omp-vfs`, `omp-voice`, and `omp-xfs`.                                                                                                                                                                                                                                                                                                                                                     |
| `omp-builtins` | [`crates/builtins`](../crates/builtins) | pi's in-process extras for the embedded shell: one module per command-line utility (`cat`, `grep`/`rg`, `sed`, `ls`, `find`, `jq`, `fd`, `diff`, the moreutils set, …) plus the process builtins (`ps`, `top`, `sleep`, `pgrep`, `pkill`, `pidwait`, `lsof`). `src/host.rs` holds the `Utility` trait and the `Host` view of the shell (stdio, working directory, exported environment, cancellation, `Host::vfs()`) that the utilities run against. `rg`, `grep`, `fd`, `find`, and `ast-grep`/`sg` are `AsyncUtility`s: the host awaits them as tokio tasks (synchronous utilities run on the blocking pool), and cancellation drops the body. Their output goes to memory-backed writers that `Host::flush_output` drains, and all input (stdin, operands, FIFOs, `<(…)`, decompressor pipes) is read through `stdio::Source`: provider files through the async `omp_vfs` API, regular files inline, descriptors readiness-driven through tokio `AsyncFd` (inherited ones via a private dup, each syscall gated by a zero-timeout `poll`, since `O_NONBLOCK` on a shared description would leak into other processes). Searches are fed chunk by chunk through the vendored grep-searcher's `Searcher::search_push`, so no utility uses the blocking pool on unix. Ports of uutils coreutils/findutils/sed and jaq live here too; see the crate `LICENSE` for third-party notices. |
| `omp-diff`     | [`crates/diff`](../crates/diff)         | N-API-free jsdiff-compatible Myers, line, word, and structured-patch primitives, consumed by native diff bindings and the edit engine.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `omp-edit`     | [`crates/edit`](../crates/edit)         | Edit-mode parsing, matching, staging, streaming previews, snapshots, and host-writer application (missing-path suffix recovery lives in the async layer of `omp-natives/src/edit.rs`); wrapped by native `EditSession` / `EditStore`.                                                                                                                                                                                                                                                                                                                                                                                                |
| `omp-predict`  | [`crates/predict`](../crates/predict)   | N-API-free ngram, SmolLM, and macOS spelling-backed word-completion engines, wrapped by `TextPredictor`.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `omp-vfs`      | [`crates/vfs`](../crates/vfs)           | Injectable async filesystem (with a blocking facade for sync callers), native host fast paths, and URL-preserving lexical helpers shared by shell, builtins, and traversal.                                                                                                                                                                                                                                                                                                                                                                                        |
| `omp-shell`    | [`crates/shell`](../crates/shell)       | pi's embedded bash and the shell API `omp-natives` exports. `bash` is the bash 5.3 engine (IR, VM scheduler with safepoints, bash's builtins, host and state-store seams; `bash::syntax` lexer/parser with alias expansion and the `declare -f` printer, `bash::pattern` glob/extglob/ERE matching); `sys` holds the OS pieces (process spawner with sessions, process groups and Job Objects, files, pumps, `PATHEXT`, shebangs); `vfs` is the engine filesystem over `omp-vfs`; `host` (`PiHost`, every external leads its own session), `session` (the persistent driver), `tools` (`timeout`, `nohup`, `git`, command-running extras), `extras` (`omp-builtins` utilities as engine commands) and `git`; `testkit` holds the engine test kit, and `src/bin/obash` is the engine as a standalone shell (OS host, in-memory store) for differential tests and benchmarks against bash. On top sit `Shell`/`execute_shell`, command minimization, pipe taps, cancellation, and process plumbing; traversal and injectable filesystem primitives live in `omp-xfs` and `omp-vfs`.                                                                                                                                                                                                                                                                                                                    |
| `omp-voice`    | [`crates/voice`](../crates/voice)       | Cross-platform microphone/playback and Opus/WebRTC support used by the `AudioCapture`, `AudioPlayback`, and `LiveWebRtcPeer` bindings.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `omp-ast`      | [`crates/ast`](../crates/ast)           | tree-sitter/ast-grep language registry, matching/editing, block analysis, and summarization. Common grammars are linked in; the rest load as WebAssembly modules the agent downloads on first use (`src/language/grammar.rs`). They are built and published by [stencil-hq/wasm-grammars](https://github.com/stencil-hq/wasm-grammars); `bun run gen:grammars` pins the latest release in `src/language/wasm_grammars.rs`.                                                                                                                      |
| `omp-iso`      | [`crates/iso`](../crates/iso)           | Isolation backend implementations and diffing for APFS, btrfs, ZFS, Linux reflinks, overlayfs, Windows block clones, and ProjFS; fallback uses a Git worktree for Git repositories and recursive copy otherwise.                                                                                                                                                                                                                                                                                                                                |
| `omp-xfs`   | [`crates/xfs`](../crates/xfs)     | Parallel ignore-aware walker, per-directory listing cache, glob selection, and content search, all async over the caller's Tokio runtime (tasks are `tokio::spawn`ed per call, bounded by a permit semaphore; dropping a future cancels its work), shared by native scans and shell `rg`/`grep`/`fd`/`find`. Native reads use per-platform syscall fast paths; providers go through `omp-vfs` and are never cached.                                                                                                                                                                                                                                                       |
| `omp-vcs`      | [`crates/vcs`](../crates/vcs)           | In-process version control: git on gitoxide (the git binary also handles credential-bound network transfers, reftable repos, and whole-worktree status/untracked walks) and Jujutsu on jj-lib; unified discovery and operations used by the `vcs*` native bindings.                                                                                                                                                                                                                                                                             |

## Vendored workspace crates

| Group                       | Paths                                                                                                                                                                         | Purpose                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build/runtime compatibility | [`crates/vendor/cfg_aliases`](../crates/vendor/cfg_aliases), [`crates/vendor/grep-searcher`](../crates/vendor/grep-searcher), [`crates/vendor/napi`](../crates/vendor/napi), [`crates/vendor/tree-sitter-go`](../crates/vendor/tree-sitter-go) | Workspace patches fix macro compatibility, add a chunk-fed search (`Searcher::search_push`), fix N-API environment teardown, and fix Go grammar support respectively.                                                                             |

`omp_builtins::extras::extras()` (defined in `src/extras.rs`) is the authoritative list of in-process extras; `omp-shell` (`src/extras.rs`) resolves a command name through the engine's builtins, pi's tools, then these extras, honoring the `PI_DISABLE_*` gates in the session environment `omp-shell` configures. A directory being a workspace member does not by itself mean that `omp-natives` exposes it as a JavaScript API.

## Boundary map

```text
@linxiraos/pi-natives JS entrypoints
  -> omp-natives (N-API conversion, platform bindings, task boundaries)
       -> omp-ast / omp-diff / omp-edit / omp-iso / omp-predict / omp-vcs / omp-voice
       -> omp-xfs / omp-vfs
       -> omp-shell
            -> omp_shell::session / host / tools / extras (session driver, engine host, pi's commands)
                 -> omp_shell::bash (engine: compiler, VM, bash builtins; bash::syntax, bash::pattern)
                 -> omp_shell::sys (process spawner, OS files) / omp_shell::vfs (engine filesystem)
            -> omp-builtins (in-process utilities + process builtins; host.rs: per-invocation I/O and cwd)
            -> omp-vfs / omp-xfs (filesystem provider and traversal)
@linxiraos/pi-natives JS entrypoints
  -> pi-natives (N-API conversion, platform bindings, task boundaries)
       -> pi-ast / pi-diff / pi-edit / pi-iso / pi-predict / pi-vcs / pi-voice
       -> pi-xfs / pi-vfs
       -> pi-shell
            -> pi_shell::session / host / tools / extras (session driver, engine host, pi's commands)
                 -> pi_shell::bash (engine: compiler, VM, bash builtins; bash::syntax, bash::pattern)
                 -> pi_shell::sys (process spawner, OS files) / pi_shell::vfs (engine filesystem)
            -> pi-builtins (in-process utilities + process builtins; host.rs: per-invocation I/O and cwd)
            -> pi-vfs / pi-xfs (filesystem provider and traversal)
```

For the loader and JS boundary, see:

- [`natives-architecture.md`](./natives-architecture.md) (loader runtime details included)
- [`natives-binding-contract.md`](./natives-binding-contract.md)

Subsystem details live in:

- [`natives-build-release-debugging.md`](./natives-build-release-debugging.md)
- [`natives-media-system-utils.md`](./natives-media-system-utils.md)
- [`natives-rust-task-cancellation.md`](./natives-rust-task-cancellation.md)
- [`natives-shell-pty-process.md`](./natives-shell-pty-process.md)
- [`natives-text-search-pipeline.md`](./natives-text-search-pipeline.md)
- [`fs-scan-cache-architecture.md`](./fs-scan-cache-architecture.md)

## Documentation policy

These crates remain contributor-facing implementation details. Promote one to standalone user-facing documentation only when it gains a public API or executable consumed independently of `@linxiraos/pi-natives`; see [`user-facing-packages.md`](./user-facing-packages.md).

## Porting field notes

> Merged from the former `porting-to-natives.md`; the full historical copy is in
> [`archive/porting-to-natives.md`](./archive/porting-to-natives.md).

### When to port

Port a hot path when it runs in render loops or large batches, when JS allocation
(string churn, regex, large arrays) dominates, when a JS baseline exists for a
side-by-side benchmark, or when the work is CPU-bound/blocking or async I/O that
belongs on the libuv thread pool or Tokio. Avoid ports that depend on JS-only
state or dynamic imports; N-API exports should be data-in/data-out. Long-running
work goes through `task::blocking` (CPU/blocking I/O) or `task::future` (async
I/O), with `CancelToken`/`heartbeat()` when the API exposes `timeoutMs` or
`AbortSignal`.

### Shape

- Runtime wrapper: `packages/natives/native/index.js`; types:
  `native/index.d.ts`; loader helpers: `loader-state.js`; embedded manifest:
  `embedded-addon.js`.
- Rust implementation: `crates/pi-natives/src/<module>.rs`, registered in
  `src/lib.rs`, exported with `#[napi]` (snake_case becomes camelCase).
- `packages/natives/scripts/build-bindings.ts` runs napi-rs, installs the
  `.node`, copies declarations, and regenerates explicit ESM exports/enums.
- At publish time the core ships the loader only; each platform `.node` is an
  optional-dependency leaf `@linxiraos/pi-natives-<tag>`.

### Checklist

1. Add the Rust implementation and register the module.
2. Run `bun --cwd=packages/natives run build`; confirm `index.d.ts` and
   `index.js` carry the new export/enums.
3. Update consumers to import from `@linxiraos/pi-natives`; remove the obsolete
   JS path in the same change when native is canonical.
4. Add a benchmark beside the owning package with a JS baseline and the native
   version in one run (`Bun.nanoseconds()`, fixed iterations, realistic input).
5. Run the focused build, benchmark, and narrow tests/scenarios.

### Pitfalls

- **Stale platform/variant artifacts**: the loader tries `modern`, then
  `baseline`, then the unsuffixed file; a stale earlier candidate can hide a new
  export. Delete the local/variant/versioned cache and rebuild.
- **Generated types vs loaded binary**: verify the export set from the exact
  candidate path reported by the loader; do not add optional consumer guards for
  a required export.
- **Rust signatures**: keep them owned/simple (`String`, `Vec<String>`,
  `Uint8Array`, `#[napi(object)]`); avoid borrowed `&str` in public exports.
- **Enums/ESM exports**: napi-rs declarations alone are not enough; regenerate
  `native/index.js` and verify enum objects.
- **Benchmarking**: identical inputs, same file for both versions, enough
  iterations, realistic data.

### Rule of thumb

If native is slower, keep the JS path and do not switch callsites. If native is
faster and behavior-compatible, switch and keep the benchmark as the regression
guard.
