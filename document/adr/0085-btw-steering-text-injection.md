# 0085. BTW can inject an arbitrary Studio prompt into the main session

- **Status:** Accepted
- **Date:** 2026-11-21
- **Deciders:** Zeta owner
- **Links:** [BTW runtime](../../packages/coding-agent/src/server/studio-host/services/main-btw-runtime.ts), [Studio BTW panel](../../web-app/src/studio/btw/BtwPanel.tsx)

## Context

BTW (by-the-way) is a side lane. Its answers could only be injected when the
answer contained an `<inject>` block, so the operator could not send the latest
answer, a complete discussion, or selected topics back to the working main
agent. The owner also asked that Escape stop only the BTW lane and Backspace
return to the coding-agent page.

## Decision

`btw.inject` accepts either the existing `injectId` or a `text` payload. Text
uses the same native main-session admission path (`streamingBehavior: "steer"`)
and still requires the `btw.inject` feature setting. Studio's C action sends
only the latest answer; the panel menu can send the full question/answer
conversation or space-selected historical topics. Escape aborts only the BTW
lane; Backspace closes the BTW page.

## Consequences

The renderer gains a direct steering path without a second prompt queue or a
new backend authority. Arbitrary text bypasses the `<inject>` block parser, so
the UI must label what was sent and the native feature setting remains the gate.
The operation is additive; existing `injectId` callers keep working.

## Alternatives

A new `btw.injectText` command was unnecessary and would have created a second
wire contract. Client-side prompt submission would bypass Host admission and
session fencing.

## Links

- [BTW panel](../../web-app/src/studio/btw/BtwPanel.tsx)
- [BTW session hook](../../web-app/src/studio/btw/useBtwSession.ts)
- [runtime-features contract](../../web-app/src/vendor/studio-protocol/src/contracts/runtime-features.ts)
