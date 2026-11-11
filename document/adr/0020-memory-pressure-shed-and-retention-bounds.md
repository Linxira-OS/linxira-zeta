# 0020. Memory pressure sheds derived render caches only; retention is bounded by measured consumer bytes

- **Status:** Proposed
- **Date:** 2026-11-11
- **Deciders:** report-integration reservation; implementation owner report-memory
- **Links:** [`document/roadmap.md`](../roadmap.md) P1 Memory stability track; shipped upstream fixes `83a4c6c10e1`, `8ff98674e52`; `crates/pi-natives/src/vcs.rs`; `scripts/memory-soak.ts`

## Context

The v18-era Windows crashes ended at the system commit limit: the process
committed tens of GB, the next native allocation failed with os error 1455
(`ERROR_COMMITMENT_LIMIT`), and a gix worker-thread `.expect` panicked
(`document/v18-gix-status-oom-triage.md`). Two protections already exist in this
tree and are not to be rewritten:

- Git status prefers the git CLI, so the memory-heavy walk runs in a subprocess
  whose memory returns to the OS (`crates/pi-vcs/src/git/read.rs`,
  `status_porcelain`). The in-process gitoxide fallback is guarded at the Node
  boundary: `catch_panic` in `crates/pi-natives/src/vcs.rs` converts a panic into
  a typed `VcsError`, covered by `catch_panic_converts_native_panics_into_backend_errors`
  (which panics with `Os { code: 1455 }`). This catches unwind panics only; an
  allocation abort is not caught and must not be described as caught.
- Derived render output is released when transcript entries retire:
  `Component.releaseRenderCaches()` plus `TranscriptContainer.#retireEntry`
  (upstream `83a4c6c10e1`, carried by the v18.18.3 sync), tested by
  `packages/tui/test/transcript-committed-release.test.ts`. The semantic
  transcript is preserved; rows, formatting, and streaming state are rebuilt
  lazily.
- The Markdown L2 cache is byte-weighted: a 4 MiB aggregate budget, a 512 KiB
  entry budget that includes the key, and `sizeCalculation` over rendered row
  bytes plus key bytes (upstream `8ff98674e52`).

Memory is otherwise sampled, not pushed: `packages/coding-agent/src/task/fanout-pressure.ts`
is the sampler, and `memory-shed.ts` sheds at the spawn permit, the workpool
ceiling, and turn end. Bun's typings also document `process.on("memoryPressure")`
(`node_modules/bun-types/overrides.d.ts`): macOS distinguishes `warning` and
`critical`, Windows always emits `critical`. That is an API contract in the
type definitions. This repository has not observed a native OS signal, and a
listener registered on an EventEmitter proves nothing about OS delivery — both
are facts this ADR relies on.

## Decision

1. `packages/coding-agent/src/task/memory-shed.ts` owns a Windows-only push
   adapter. `supportsMemoryPressureEvent(platform)` returns true only for
   `win32`; elsewhere `installMemoryPressureShed` returns `undefined` instead of
   registering a listener that no OS path delivers.
2. `InteractiveMode.init()` installs the adapter and `stop()` removes it. The
   adapter is installed once per process and has no session context, so an event
   clears derived render caches only: Markdown L2 and mermaid L1. It does not
   touch the transcript, the append-only emission ledger, image ownership,
   expansion state, browser tabs, or memory backends.
3. Clearing is safe because the consumers are lazy: the next frame re-renders
   from semantic content, and the L2 refills on demand. The contract test fills
   a cache, performs the same release, and asserts byte-identical rows
   afterwards; committed transcript blocks are asserted through their own
   release path.
4. The claimed behavior of the push adapter is "the injected level clears
   derived caches and is removed on stop". Native OS delivery is explicitly out
   of the tested contract. Tests inject the level; they do not claim pressure
   was observed.
5. Retention is guarded by consumer-visible bytes, not by asserting cache
   constants: `packages/tui/test/render-cache-consumer-bounds.test.ts` offers
   more bytes than the aggregate budget and asserts retained heap after a full
   GC, and `packages/tui/test/render-cache-pressure-restore.test.ts` proves that
   the release is restore-safe.
6. `scripts/memory-soak.ts` is the bounded profiling harness: scripted large
   Markdown output plus transcript commits across a width-cycle, sampling RSS,
   heap, and — on Windows only — the system commit charge from PowerShell's
   `Get-Counter '\Memory\Committed Bytes'`. It has no default threshold. A run is
   report-only and exits 0 unless `--max-rss-growth-mib` is supplied from a
   measurement on the runner class being gated.
7. `bun.lock` stays at `lockfileVersion` 1. The pinned bun2nix generation reads
   v1 (`scripts/gen-nix-bun.ts` restamps v2 to v1; `scripts/check-nix-bun-freshness.ts`
   treats v1 as current). No lockfile format upgrade is part of this decision;
   the real prerequisite for v2 is a bun2nix parser that accepts it.

## Consequences

- A Windows process under OS memory pressure can drop multi-megabyte render
  caches before the commit limit is reached, with no semantic loss.
- The adapter is inert on macOS/Linux, where no runtime delivery has been
  verified; those platforms keep only the sampled checkpoints.
- Tests cannot regress into asserting a cache constant instead of behavior; they
  measure retained heap and rendered output.
- The soak harness cannot become a flaky CI gate by accident: someone must run
  it, record a peak, and pass an explicit cap. Until then it reports only.
- A future bun2nix upgrade can relax the v1 restamp; nothing else in this
  decision changes.

## Alternatives

- **Do nothing:** rejected — the sampled checkpoints run at spawn/turn boundaries
  and a TUI that is only rendering never samples.
- **Register on every platform:** rejected — no verified delivery off Windows,
  and an accepted-but-dead listener would read as support.
- **Clear the transcript or its emission ledger on pressure:** rejected —
  published rows are already in native scrollback and cannot be retracted;
  clearing the ledger would re-emit or drop content.
- **Port the upstream retention fix again:** rejected — `83a4c6c10e1` is already
  in this tree via the sync.
- **Bump the lockfile to version 2:** rejected for now — the pinned bun2nix
  cannot parse it.
- **Ship a fixed soak threshold now:** rejected — a shared-runner number without
  a measurement is budget theater; the harness reports until measured.

## Links

- `packages/coding-agent/src/task/memory-shed.ts` (push adapter, pull checkpoints)
- `packages/coding-agent/src/modes/interactive-mode.ts` (install on `init`, remove on `stop`)
- `packages/coding-agent/test/task/memory-pressure-event.test.ts`
- `packages/tui/test/render-cache-consumer-bounds.test.ts`
- `packages/tui/test/render-cache-pressure-restore.test.ts`
- `scripts/memory-soak.ts`, `scripts/memory-soak-core.ts`
- Upstream commits: `83a4c6c10e1` (retire-time cache release), `8ff98674e52` (byte-weighted markdown cache)
- Windows status path: `crates/pi-vcs/src/git/read.rs`, `crates/pi-natives/src/vcs.rs`
