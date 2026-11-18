# 0068. Align Zeta consumers to the OMP 18.22 runtime contracts

- **Status:** Proposed
- **Date:** 2026-11-17
- **Deciders:** Owner selected official OMP v18.22.0 for a complete release merge before preparing Zeta 1.6.0. Contract adoption follows ADR 0036; release acceptance remains separate.
- **Links:** [REQ-125](../requirements-ledger.md), [ADR 0036](0036-upstream-interface-alignment.md), [ADR 0039](0039-background-work-source-binding.md), [ADR 0058](0058-studio-ida-worker-reviews.md), [sync ledger](../upstream-sync.md)

## Context

The integrated upstream baseline is v18.20.0. Official v18.22.0 (`3e8cff3b7ce19a805c11a26a6dd1703066435851`) includes v18.20.3's historical-consult removal, v18.21.0's run lifecycle split, and v18.22.0's backend-neutral disassembler and terminal drain contracts. Zeta has additional Team, source-bound async work and Studio Host consumers that must migrate with the shared implementation.

## Decision

Adopt the complete official release in a true non-squash merge. Preserve Zeta's runtime authority and policies through explicit call-site migration rather than restoring retired upstream members.

| Upstream change | Zeta consumers | Required action |
| --- | --- | --- |
| Session `agent_end` is final for a run; `agent_pause` describes a stopped loop whose run remains open | Team/background completion, TUI, security scans, maintenance, Studio status and prediction | Use `isRunActive`, `wakeSources` and `waitForRunEnd()` for actual completion. A pause must not complete a scan/worker or make a resumable session idle. Keep per-loop RPC/JSON/extension encoding solely at upstream `loop-end-wire` boundaries. |
| `hasPendingAsyncWork`, `settleAsyncWork`, `suppressAutoResumeUntilPrompt` removed | Zeta-only compaction and scan drivers, tests, public imports | Migrate to the new run contract and abort semantics; remove old methods and shims. Preserve admitted-submission and source-change fences after every await. |
| `seance`, `/seance`, task `sourceSession` removed | Settings/command manifests, history consult UI, Studio contracts and generated consumers | Accept retirement and remove obsolete actions, dialogs and public contract members. Ordinary history/resume/fork remains; no renamed substitute historical-consult executor. |
| IDA/Ghidra shared hosting becomes `disasm`; tools become eval `dsm` | Studio IDA producers, settings catalogue, worker identity/version checks | Migrate host/database access to the new backend-neutral API. Keep the IDA-specific Studio capability tied to IDA and preserve session/view ownership, native identity/version fencing, one-use review tokens and recovery copies. Do not recreate the old IDA client/supervisor exports. Shared worker extensions must stay explicit and backend-checked. |
| `TtyWriter` requires drain threshold/callback; terminal backpressure requires `onOutputDrain` | Production terminal and terminal fixtures | Accept native/output-drain contract and update every affected terminal implementation. Do not claim terminal ACK/backpressure support on transports that do not implement it. |
| Provider/tool/media interfaces change in intervening releases | Zeta SDK, Host and renderer callers | Migrate producer and consumer together; regenerate owned wire/catalog outputs from real sources. Audio/mobile/QQ/WeCom and retired collaboration surfaces retain their existing holds. |

Background work admitted under one transcript remains bound to that exact source identity through navigation, restart and late completion (ADR 0039). A run ending or being abandoned does not authorize redirecting source work to the currently visible session. Team worker role, agent definition and lifetime remain distinct. This integration does not implement the pending Team governance/type/perception requirements by assumption.

File-backed worker spawns materialize the parent journal before recording its source. Cold revival uses the parent recorded in the child header and refuses a declared source it cannot verify. Standalone and legacy children without a recorded parent can answer a correlated wake message. They cannot publish an owner-routed job result from a guessed conversation.

Standalone Zeta serve remains the only session/config/auth/workspace/IM authority. Native-only project-source admission, default YOLO, hidden GUI helper processes, ports, package names, frozen startup art, hard-disabled telemetry and current product-surface boundaries remain mandatory. Studio upstream v0.2.2 integration stays paused; adapting existing Zeta callers to OMP does not reopen it.

MCP registry refresh keeps REQ-053 analysis precedence and Profile admission on the new serialized tool-registry boundary. Read the current cwd, selected native tools and settings inside that mutation. Borrowed managers expose configured names and recognition fields (`type`, `command`, `args` or `url`) through the worker bridge, omitting transport environment, headers and authentication/OAuth objects. Recognition fields can themselves contain operator-supplied values; this is not a general credential-redaction boundary. The child still owns only its scoped proxy catalog and never its parent's callbacks or transports. Refresh cannot re-enable a native tool the user deselected while MCP suppressed it, and shadowed analysis-server instructions must stay out of the session prompt.

## Consequences

Every manual conflict and changed interface needs a mapped disposition and exercised behavior. Source ancestry proves a full release merge, not a green runtime or release. Current native rebuild, TUI/Host/renderer interaction, external service prerequisites and CI are recorded separately. No historical stale-native result is promoted to source-matched acceptance.

The integration stays on the existing 1.5.2 development version until the later 1.6.0 release preparation updates the single version line, policy and complete npm/assets chain. No push, release tag or publication is authorized by this ADR. Proposed status becomes Accepted only through the normal owner/reviewer decision.

## Alternatives

- Restoring old method names or IDA exports would preserve a second runtime contract and violate ADR 0036.
- Importing only selected patches would lose official tag ancestry and omit related tests and fixes.
- Retaining a visible Seance action with an unavailable or replacement executor would misrepresent upstream retirement.
- Treating `agent_pause` as completion would allow background work to outlive reported final results and break source-bound delivery.

## Links

- [Upstream release](https://github.com/can1357/oh-my-pi/releases/tag/v18.22.0)
- [Pinned run event contract](https://github.com/can1357/oh-my-pi/blob/v18.22.0/packages/coding-agent/src/session/agent-session-events.ts)
- [Pinned wire boundary](https://github.com/can1357/oh-my-pi/blob/v18.22.0/packages/coding-agent/src/session/loop-end-wire.ts)
- [Pinned disassembler API](https://github.com/can1357/oh-my-pi/blob/v18.22.0/packages/coding-agent/src/disasm/client.ts)
