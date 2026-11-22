# 0086. Plan entry should follow model-confirmed user intent; keep the Ask gate for 1.5.13

- **Status:** Proposed
- **Date:** 2026-11-22
- **Deciders:** Zeta owner
- **Links:** [ADR-0085](0085-btw-steering-text-injection.md), [mode tool](../../packages/coding-agent/src/tools/mode.ts), [plan mode prompt](../../packages/coding-agent/src/prompts/system/plan-mode-active.md)

## Context

1.5.13 closes a safety hole: the agent could arm plan mode from guessed wording.
The interim gate requires either `/plan` / `/ultra plan` or a visible Ask radio
(`plan_mode=yes`), which works in every language but asks the user to operate a
control even when they already asked for a plan.

The owner wants the eventual behavior to resemble Claude Code: once the model
confirms the user intends to plan, it may switch modes itself; after the user
says the plan is acceptable, execution can start without a separate plan-review
page. Plan mode is used rarely, so frequent AI-initiated switching is
disruptive; the confirmation must be explicit enough not to repeat that bug.

## Decision

This ADR records the target direction, not a 1.5.13 implementation:

- Preserve the current Ask-consent gate in 1.5.13 as the safety baseline.
- A later change may let the model confirm the user's intent semantically in any
  language and then enter plan mode on the user's behalf, equivalent to
  `/plan` or `/ultra plan`.
- A later change may accept the user's direct execution instruction without
  showing the plan-review surface, while preserving the existing approval and
  file-write boundaries.
- Before that change ships, the intent signal, mode transition, and execution
  admission must be specified and tested end to end; it cannot be a second
  hidden heuristic.

## Consequences

The interim behavior costs one extra user interaction per plan request but
cannot self-arm from a proposal/方案. Replacing it requires a durable user-intent
record, an audit trail for mode transitions, and tests for denial, timeout,
language coverage, and cancellation. Plan-mode entry and execution authority
must remain separate: entering plan mode never grants write access, and direct
execution still crosses the normal approval boundaries.

## Alternatives

Keeping the Ask gate forever was rejected by the owner as too cumbersome for a
rarely used mode. Returning to free model judgment was rejected by the 1.5.13
incident. A new language keyword list was rejected because it cannot cover users
outside Chinese and English.

## Links

- [ADR-0083](0083-studio-version-pin-compatibility.md)
- [mode tool](../../packages/coding-agent/src/tools/mode.ts)
- [plan mode prompt](../../packages/coding-agent/src/prompts/system/plan-mode-active.md)
