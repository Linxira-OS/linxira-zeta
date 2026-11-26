# 0102. Layered model control starts with provider/fallback policy

- **Status:** Accepted
- **Date:** 2026-11-26
- **Deciders:** Zeta owner
- **Links:** [0100](0100-terminal-product-line-work-studio-retirement.md), [0101](0101-scoped-external-pages-fallback.md), [requirements ledger](../requirements-ledger.md) REQ-152

## Context

The model/fallback surface has grown without a stable policy boundary: fallback
chains can repeat the same provider/model, role fallbacks and resume fallbacks
are conflated, agent identities all share a single `task` role, and a future
model-control page would otherwise edit YAML directly. TTS/STT/video are
paused; image generation and decision routing are active.

The full target (provider adapters, model control page, per-agent/scenario
policy, Blueprint view, lightweight API scripts) cannot be shipped in one
change without turning configuration into a new runtime.

## Decision

Roll out in layers. Each layer is optional for the next, and the old config
remains valid.

### Layer 1 — provider/fallback kernel (this layer)

- Canonical model identity is `provider/id`; aliases resolve to one identity.
- A fallback chain is ordered, trimmed, and de-duplicated by canonical identity.
- Duplicate entries are removed with a warning; order is preserved; a longer
  chain is never silently truncated.
- Fallback scopes are separate: `resume`, `retry`, `role`, `agent`, `mode`.
  A chain for one scope is never silently reused by another.
- Provider descriptors expose capabilities and deployment metadata; secrets
  stay in the credential vault.
- Existing `modelRoles`, `retry.fallbackChains` and `models.yml` remain the
  input format. New fields are optional.
- No UI is required for this layer; it lands as a pure resolver/validation
  module first.

### Later layers

2. Simple `/pages/models` control page over the kernel.
3. Per-agent and per-mode overrides (Vibe/Team), with inheritance.
4. Blueprint view: the same state projected as typed nodes/edges.
5. Adapter mapping/light scripts and more modalities.

### Paused capabilities

TTS, STT and video generation remain paused. Their capability types may be
declared so the kernel can report `unsupported`, but no provider, tool or
workflow node is registered until the owner reopens audio/video with its own
ADR. Image generation and decision routing are in scope.

## Consequences

- The first implementation is testable without a renderer or provider network.
- Old configs keep their effective models and fallback order; only duplicate
  canonical entries are collapsed.
- The model-control page becomes a view over the kernel, not a YAML editor.
- Provider-specific API adapters remain behind the gateway; pages/agents never
  receive service keys.
- A future Blueprint compiles to this state; it does not become a second
  execution engine.

## Alternatives

- Build the full model-control UI first: rejected; it would encode unresolved
  policy in the renderer.
- Let the UI rewrite YAML directly: rejected; no validation, duplicate or
  alias safety.
- Keep one global fallback chain: rejected; resume/retry/agent scopes conflict.
- Register TTS/STT/video now: rejected; owner-held and not part of this train.

## Links

- [Model control surface](../../document/agents/surface/pages.md)
- [Fallback chain implementation](../../packages/coding-agent/src/session/retry-fallback-chains.ts)
- [Requirements ledger](../requirements-ledger.md) REQ-152
