# 0066. Model visibility and fixed three-level fallback slots

- **Status:** Proposed
- **Date:** 2026-11-11
- **Deciders:** Product (REQ-027/028/029/076), Studio/TUI owners
- **Links:** [PR #321](https://github.com/Linxira-OS/linxira-zeta/pull/321), [model settings](../settings.md#model-selection), [models.md](../models.md), `local://model-visibility-audit.md`

## Context

- Model pickers currently mix catalog availability, provider credentials,
  `enabledModels`, role `accepts` predicates, and `modelTags.hidden`. There was
  no way to hide a single model from pickers while keeping it in the catalog and
  in role/fallback configuration. PR #321 added the shared `hiddenModels`
  setting and a Work Studio visibility tab; TUI consumes the same setting.
- The catalog exposes all model kinds, not just chat: `chat`, `tiny`, `image`,
  `tts`, `stt`, `search`, `judge`, `embedding`, `rerank`, `video`
  (`packages/catalog/src/types.ts`). Role metadata is authoritative in
  `packages/coding-agent/src/config/model-roles.ts` (`MODEL_ROLE_IDS`).
- `retry.fallbackChains.<role>` is an ordered array. The runtime already walks
  primary → chain entries in order
  (`packages/coding-agent/src/session/retry-fallback-chains.ts`), and existing
  tests cover primary → two fallback entries. The ambiguity was product/UI
  shape, not resolver behavior: an arbitrary list editor let users add or
  visually lose slots, and there was no fixed Fallback 2 affordance.
- Studio Host `models.get` was previously unimplemented; `models.roles.create`,
  `models.roles.delete`, and `models.roleStorage.set` were declared but absent.
  `models.get` also had no workspace scope, so multi-workspace reads fell back
  to the gateway process cwd.

## Decision

1. **Visibility is a picker-only, shared setting.** `hiddenModels` holds exact
   selectors, `provider/*`, `provider/vendor/*`, bare model ids, or `*`. It is
   filtered by composer/model selectors in both Work Studio and TUI. The catalog,
   `modelRoles`, `retry.fallbackChains`, settings pages, and explicit hidden
   selector assignment remain intact. The setting is owned by `Settings`; Web and
   TUI read the same value.
2. **Visibility UI covers every kind and role tag.** The Work Studio model
   visibility tab groups by provider, shows kind and role tags, and supports
   search, kind filter, tag filter, per-model hide/show, per-provider bulk, and
   bulk hide/show of the current kind/tag matches. It never derives a second
   catalog or rewrites generated model JSON.
3. **Fallbacks have three fixed UI levels.** Primary = `modelRoles.<role>`,
   Fallback 1 = `chain[0]`, Fallback 2 = `chain[1]`. Fallback 2 is optional;
   both slots empty writes `[]` (explicitly no fallback). Web and TUI expose the
   same three slots and the same host/config shape.
4. **Longer existing chains are preserved, never silently truncated.** Entries
   at index 2+ are displayed as extra fallbacks. Slot editing is locked while
   extras exist; removing them requires an explicit clear-extras confirmation.
   Saving slots preserves extras unless that explicit choice is made.
5. **Host owns the shared contract.** `models.get` composes the read model from
   gateway routes; it accepts an optional `workspaceId` and forwards
   `x-zeta-cwd`. `models.roles.create/delete` write `modelTags` + `modelRoles`,
   and `models.roleStorage.set` writes `modelRoleStorage`. The host validates
   the same array/slot shape the UI writes.
6. **No expansion into catalog policy.** This decision does not change provider
   discovery, compat rules, generated model JSON, or search-provider credential
   metadata. `models.get.webSearch.providers` stays empty because the Host
   cannot safely obtain per-engine credential metadata; routing/order/timeout
   remain real settings.

## Consequences

- Users can hide noisy models (including non-chat kinds) from pickers without
  losing role/fallback configuration; settings remain the recovery surface.
- Fixed slots make the three-level product promise explicit and testable while
  keeping the existing resolver and arbitrary-depth config compatible.
- Extra-fallback lock is intentionally conservative: editing slots requires an
  explicit cleanup, trading a little convenience for no silent config loss.
- `models.get` now depends on gateway routes and configurable cwd; remote/multi-
  workspace callers must pass `workspaceId` to avoid the gateway default.
- Custom-role write support relies on `PUT /api/settings` accepting `modelTags`
  and `modelRoles`; partial writes are reported rather than hidden.

## Alternatives

- **Arbitrary-sized fallback list only (status quo):** rejected because it does
  not deliver fixed Fallback 2 and makes the third slot disappear visually.
- **Truncate chains to two entries on save:** rejected; silently drops user
  configuration.
- **Treat `hiddenModels` as catalog deletion/`disabledModels`:** rejected;
  hidden models must stay assignable and visible in settings.
- **Filter by kind/tag only in WebUI and leave TUI arbitrary:** rejected;
  Web/TUI parity is required for picker behavior and shared config.
- **Invent web-search credential metadata:** rejected; return no providers
  rather than misreport availability.

## Links

- Implementation: `packages/coding-agent/src/config/fallback-slots.ts`,
  `packages/coding-agent/src/server/studio-host/ops/models.ts`,
  `packages/tui/src/overlays/model-hub.ts`,
  `web-app/src/studio/models/ModelVisibilityPane.tsx`,
  `web-app/src/studio/models/fallbackSlots.ts`.
- Tests: `packages/coding-agent/test/fallback-slots.test.ts`,
  `packages/coding-agent/test/studio-host-ops.test.ts`,
  `packages/coding-agent/test/retry-fallback.test.ts`,
  `web-app/src/studio/models/fallbackSlots.test.ts`.
- Docs: [settings](../settings.md), [models](../models.md),
  [UPDATE-LOG](../../UPDATE-LOG.md).
