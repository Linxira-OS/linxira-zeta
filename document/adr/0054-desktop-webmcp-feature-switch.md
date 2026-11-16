# 0054. Desktop enables Chromium WebMCP for typed page tools

- **Status:** Proposed
- **Date:** 2026-11-16
- **Deciders:** Zeta maintainers
- **Links:** [ADR 0047](0047-studio-runtime-private-resources.md), [ADR 0052](0052-studio-input-validation-authority.md), [REQ-099](../requirements-ledger.md)

## Context

Official Studio v0.2.1 exposes page-declared typed tools through Chromium's
WebMCP API. Chromium 156 (Electron 45.3.0) gates `document.modelContext` behind
`--enable-features=WebMCPTesting`; Chromium 157 renamed the feature to `WebMCP`.
The generic headless browser launcher hardcoded `WebMCPTesting` and therefore
exposes no tools on newer Chrome. The Desktop shell needs the feature before
`app.ready`, which means a process-global switch rather than a per-page flag.

## Decision

Enable both feature names in the generic headless launcher
(`WebMCP,WebMCPTesting,DevToolsWebMCPSupport`) and merge `WebMCPTesting` once
into the Desktop app's existing `enable-features` value at module load, before
`app.ready`, with a unit test for absent/existing/idempotent values.

The switch is process-global: the Studio renderer and plugin pages also gain
`document.modelContext` in secure contexts. That grants no IPC, filesystem or
Host authority by itself. Plugin pages remain preload-less and sandboxed, and
typed registration/invocation still requires the Host's authenticated private
relay path with document-identity checks. The relay rejects discarded or
crashed targets, keeps same-document navigation, and invalidates catalogs and
references on cross-document commit or renderer crash.

This ADR does not install a second browser runtime, a page-script bridge, or an
arbitrary-JS fallback. When the feature is unavailable, typed tools report
unavailable instead of degrading to script injection.

## Consequences

Cross-version WebMCP works without pinning Chrome. The renderer/plugin page API
surface widens to include `document.modelContext`; review must keep treating
page-provided names, schemas and results as untrusted and keep invocation behind
the Host relay. A future Chromium rename requires touching the two feature-name
constants, which are isolated in the launcher and the Desktop helper. Actual
Electron lifecycle acceptance (reload/crash/handoff/second window) remains
separate evidence; this ADR stays Proposed until that matrix and the integrated
review are accepted.

## Alternatives

- Enable only `WebMCPTesting`: rejected because Chrome 157 exposes nothing.
- Inject a page script to emulate WebMCP: rejected as an arbitrary-JS bridge.
- Per-WebContents flags: unavailable in Electron; feature flags are
  process-wide.

## Links

- [Headless launcher](../../packages/coding-agent/src/tools/browser/launch.ts)
- [Desktop managed browser](../../desktop/src/managed-browser.ts)
- [WebMCP helper](../../desktop/src/managed-browser-webmcp.ts)
- [Host managed browser](../../packages/coding-agent/src/server/studio-host/services/managed-browser.ts)
