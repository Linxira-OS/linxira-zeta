# Compaction service: progress, commit hook, and fidelity

Compaction runs as one service across every trigger — manual (`/compact`, RPC `compact`,
extension `ctx.compact()`), automatic (threshold, overflow, idle, incomplete), and
background speculation. The service owns pass progress and the commit notification; a
dedicated compaction agent owns the summary artifact. The five methods
(`remote`, `snapcompact`, `handoff`, `shake`, `soft`), their configured order, and their
model/threshold sources are unchanged.

## Progress phases

The session event stream carries an additive `compaction_phase` event beside the existing
`auto_compaction_start/_end` and `manual_compaction_start/_end` pairs:

```jsonc
{
  "type": "compaction_phase",
  "passId": "cmp-…",           // constant across method fallbacks in one pass
  "trigger": "manual",          // "manual" | "auto" | "speculation"
  "phase": "summarize",         // plan | summarize | archive | commit | failed | aborted
  "method": "soft",             // remote | snapcompact | handoff | shake | soft | experimental | extension
  "reason": "user_requested",   // auto reason, or user_requested for manual
  "at": 1762819200000,
  "detail": { "tokensBefore": 81234, "entryId": "…", "fidelity": { "qa": 2, "paths": 6 } }
}
```

Guarantees:

- a pass starts with `plan`; `plan` repeats inside the same pass when a method fallback
  begins (never a new pass);
- `summarize`/`archive` fires immediately before the corresponding work;
- `commit` is final and only after the entry is durable;
- `aborted` means cancellation only (user abort, hook cancel, superseded speculation);
  any provider/auth/parse/projection failure is `failed` with `detail.errorMessage`.

Surfaces: the RPC event wire (`compaction_phase`, forwarded to RPC clients), the TUI
compaction loaders (auto and `/compact` alike show `· summarizing` / `· archiving` /
`· committing`), and the same session-event path Host/Web already use for the compaction
pairs.

## Commit hook

```ts
const unsubscribe = session.onCompactionCommit(async commit => {
  // commit.entry            — the durable compaction entry (read-only)
  // commit.cutPoint         — { firstKeptEntryId, discardedEntryIds } (the old region)
  // commit.fidelity         — structured artifact, when the range carried facts
  // commit.sourcePassId     — armed speculation provenance, when spliced
  await myDurableIndex.append(commit);   // snapshot/enqueue only — no model calls here
});
```

The hook fires exactly once per appended compaction entry, after the entry and the
tracking mirror are durable and before `session_compact` fans out. It is awaited in
registration order, so a listener must be bounded: capture what you need (or enqueue
durably) and return. Listener errors are logged and isolated; they never fail or roll
back the compaction. Deduplicate on `entry.id`. Types live at
`@linxiraos/zeta/session/compaction-contract`.

## Fidelity artifact

Summaries are prose; exact facts are now extracted deterministically from the discarded
range (bounded; no model call) and stored on the entry:

```jsonc
"preserveData": {
  "zeta.compactionFidelity": {
    "version": 1,
    "generatedAt": "2026-11-11T…",
    "qa": [{ "question": "…", "answer": "…" }],
    "paths": ["packages/coding-agent/src/session/compaction/service.ts"],
    "ids": ["REQ-051", "#321"],
    "constraints": ["MUST keep the five methods"],
    "unfinished": ["TODO: wire the phase consumer"],
    "tracking": { "dir": "…/.zeta/tracking", "index": "…/INDEX.md", "status": "…/status.json", "summaries": "…/summaries" }
  }
}
```

The rendered ledger is appended to the summarizer's side request with a static prompt
that requires verbatim retention; the structured object is what consumers should read
(`readCompactionFidelity`). Buckets are capped (QA 8, paths 24, ids 24, constraints 12,
unfinished 12), and empty buckets stay empty — extraction never fabricates entries.

`tracking` exists only when `tracking.enabled` is on. With tracking off, no user file is
read or written and the field is absent.
