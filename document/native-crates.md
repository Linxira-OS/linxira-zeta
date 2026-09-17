# Native Crates

Contributor-facing map of the Rust crates under `crates/`. These crates back
`@linxiraos/pi-natives` and the embedded shell/PTY runtime. They are intentionally
internal: end users see `@linxiraos/pi-natives` exports, not these crate APIs.

The root `Cargo.toml` lists every crate under `crates/` explicitly in `workspace.members` — add new crates there. It also patches crates.io `brush-core` to the vendored copy.

For the consumer-side runtime contract see
[`natives-architecture.md`](./natives-architecture.md). For inclusion policy
covering when a crate should be promoted to user-facing docs, see
[`user-facing-packages.md`](../docs/user-facing-packages.md).

## Crate map

| Crate           | Path                                              | Role and consumers                                                                                                                                              |
| --------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pi-natives`    | [`crates/pi-natives`](../crates/pi-natives)       | Top-level N-API `cdylib`. It exposes the JS-visible API and depends on `pi-ast`, `pi-diff`, `pi-edit`, `pi-iso`, `pi-shell`, `pi-vcs`, `pi-voice`, and `pi-walker`.                    |
| `pi-builtins`   | [`crates/pi-builtins`](../crates/pi-builtins)     | Every builtin the embedded shell installs: a patched fork of brush's POSIX/bash builtins, plus one module per in-process command-line utility (`cat`, `grep`/`rg`, `sed`, `ls`, `find`, `jq`, `fd`, `diff`, `ps`, `top`, `kill`, the moreutils set, …). `src/host.rs` holds the `Utility` trait and the `Host` view of the shell (stdio, working directory, exported environment, cancellation) that the utilities run against. Ports of uutils coreutils/findutils/sed and jaq live here too; see the crate `LICENSE` for third-party notices. |
| `pi-shell`      | [`crates/pi-shell`](../crates/pi-shell)           | Persistent embedded brush shell, command execution/minimization, process plumbing, filesystem walking, and in-process command integration used by `pi-natives`. |
| `pi-voice`      | [`crates/pi-voice`](../crates/pi-voice)           | Cross-platform microphone/playback and Opus/WebRTC support used by the `AudioCapture`, `AudioPlayback`, and `LiveWebRtcPeer` bindings.                          |
| `pi-ast`        | [`crates/pi-ast`](../crates/pi-ast)               | tree-sitter/ast-grep language registry, matching/editing, block analysis, and summarization support across the workspace grammar set.                           |
| `pi-iso`        | [`crates/pi-iso`](../crates/pi-iso)               | Isolation backend implementations and diffing for APFS, Linux/Windows clone/reflink paths, overlayfs, ProjFS, and recursive copy fallback.                      |
| `pi-walker`     | [`crates/pi-walker`](../crates/pi-walker)         | Parallel, cache-aware filesystem walker using ignore rules and globsets; shared by native grep/glob/workspace paths and shell commands.                         |
| `pi-diff`       | [`crates/pi-diff`](../crates/pi-diff)             | jsdiff-compatible diff primitives (Myers O(ND) core, line/word/structured patch helpers, UTF-16 entry points) with no FFI dependency; consumed by `pi-natives`. |
| `pi-edit`       | [`crates/pi-edit`](../crates/pi-edit)             | Edit engine: parsing/matching/application/diff generation for every edit mode, plus a streaming session that turns tool-call argument deltas into progressive previews and an atomic apply; consumed by `pi-natives`. |
| `pi-vcs`        | [`crates/pi-vcs`](../crates/pi-vcs)               | In-process version control: git on gitoxide (the git binary survives only for credential-bound network transfers and reftable repos) and Jujutsu on jj-lib; unified discovery and operations used by the `vcs*` native bindings. |

## What lives where

- Native API surface and loader (`@linxiraos/pi-natives`):
  [`natives-architecture.md`](./natives-architecture.md),
  [`natives-addon-loader-runtime.md`](./natives-addon-loader-runtime.md),
  [`natives-binding-contract.md`](./natives-binding-contract.md),
  [`natives-build-release-debugging.md`](./natives-build-release-debugging.md),
  [`natives-media-system-utils.md`](./natives-media-system-utils.md),
  [`natives-rust-task-cancellation.md`](./natives-rust-task-cancellation.md),
  [`natives-shell-pty-process.md`](./natives-shell-pty-process.md),
  [`natives-text-search-pipeline.md`](./natives-text-search-pipeline.md).
- Porting cross-references:
  [`porting-from-pi-mono.md`](./porting-from-pi-mono.md),
  [`porting-to-natives.md`](./porting-to-natives.md).
- Filesystem scan cache contract that consumes `pi-walker`:
  [`fs-scan-cache-architecture.md`](./fs-scan-cache-architecture.md).

## Brush

| Group | Paths | Purpose |
| ----- | ----- | ------- |
| Brush | [`crates/vendor/brush-core`](../crates/vendor/brush-core) | Vendored shell engine consumed by `pi-shell` and `pi-builtins`. Its manifest retains upstream package metadata; a workspace patch selects this local fork. |

`pi_builtins::utility_builtins()` and `pi_builtins::process_builtins()` are the authoritative lists of the commands linked into the embedded shell; `pi-shell` decides which of them to register. A directory being a workspace member does not by itself mean that `pi-natives` exposes it as a JavaScript API.

## Boundary map

```text
@linxiraos/pi-natives JS entrypoints
  -> pi-natives (N-API conversion, platform bindings, task boundaries)
       -> pi-ast / pi-iso / pi-vcs / pi-voice / pi-walker
       -> pi-shell
            -> brush-core (parser, expansion, interpreter)
            -> pi-builtins (bash builtins + utility builtins; host.rs: per-invocation I/O and cwd)
```

For the loader and JS boundary, see:

- [`natives-architecture.md`](./natives-architecture.md)
- [`natives-addon-loader-runtime.md`](./natives-addon-loader-runtime.md)
- [`natives-binding-contract.md`](./natives-binding-contract.md)

Subsystem details live in:

- [`natives-build-release-debugging.md`](./natives-build-release-debugging.md)
- [`natives-media-system-utils.md`](./natives-media-system-utils.md)
- [`natives-rust-task-cancellation.md`](./natives-rust-task-cancellation.md)
- [`natives-shell-pty-process.md`](./natives-shell-pty-process.md)
- [`natives-text-search-pipeline.md`](./natives-text-search-pipeline.md)
- [`fs-scan-cache-architecture.md`](./fs-scan-cache-architecture.md)

## Documentation policy

These crates remain contributor-facing implementation details. Promote one to standalone user-facing documentation only when it gains a public API or executable consumed independently of `@linxiraos/pi-natives`; see [`user-facing-packages.md`](../docs/user-facing-packages.md).