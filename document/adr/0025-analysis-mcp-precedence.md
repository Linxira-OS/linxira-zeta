# 0025. Analysis MCP is recognized, never auto-installed; one capability mounts

- **Status:** Proposed
- **Date:** 2026-11-11
- **Deciders:** Zeta product owner (pending)
- **Links:** [External sources and tool exposure §8](../external-sources-and-tool-exposure.md#8-mcp-与内置重复), [MCP configuration](../../docs/mcp-config.md), [MCP runtime lifecycle](../../docs/mcp-runtime-lifecycle.md), [CodeGraph roadmap](../roadmap.md)

## Context

Zeta already discovers explicit MCP servers from `mcp.json` / `.mcp.json`,
`.zeta/mcp.json`, profiles, plugins, and imported tool configs. It does not yet
recognize a project-analysis capability such as CodeGraph
(`@colbymchenry/codegraph`, `.codegraph/`) and does not resolve collisions with
native tools. The design target is in
[external-sources-and-tool-exposure.md §8](../external-sources-and-tool-exposure.md):
native first by default, same-name/same-capability MCP servers shadowed, and the
prompt containing only the selected tool set.

Recognition must not become installation or execution. A project marker or a
declared package is evidence that the capability is present or intended, not
proof that a server is configured or trusted. An external project source stays
off until the consent service (REQ054) has approved its hash; this ADR does not
change that gate.

## Decision

- **Explicit manifests only.** `ANALYSIS_MCP_MANIFESTS` in
  `packages/coding-agent/src/mcp/analysis-precedence.ts` names the server
  names, package names, markers, native equivalents, and expected tools. An
  arbitrary package or command is never classified as analysis MCP.
- **Configured vs detected.** A matching `mcpServers` entry is `configured` and
  can mount. A package/marker without a server is `detected`: shown as a
  suggestion, never mounted, never marked available, and never installed or
  spawned.
- **One capability, one mounted set.** For each manifest the first mountable
  server wins; later servers with the same capability or duplicate function
  names are `shadowed-duplicate`. `/mcp` can print the reason.
- **Precedence.** `mcp.precedence` is `native` (default), `mcp`, or `ask`.
  `native` shadows the MCP server only when the native tool is currently
  active; a disabled native tool cannot shadow an allowed MCP server. `mcp`
  mounts the server and reports the overlapping native tools for suppression.
  `ask` emits an approval descriptor only; the caller must use the existing
  `requestApproval` path. With no answering UI the server stays unmounted.
  YOLO does not add a new security approval.
- **Profile allowlist.** The active tool-profile allowlist is applied to the
  expected tools. A server with no allowed tools is `shadowed-profile`. The
  manager hook recomputes from the current snapshot on `tools/list_changed` and
  reconnect; a denied or shadowed server is not resurrected from a cache.
- **External sources remain opt-in.** Recognition reads declared project
  metadata only. It does not read a foreign source, run a binary, or bypass the
  REQ054 hash-consent service.

## Consequences

- CodeGraph and similar analysis servers become discoverable without adding a
  package manager or a second install path.
- Core does not depend on any analysis server; the official plugin remains a
  plugin. Disabling the plugin or never configuring the server leaves native
  search intact.
- `/mcp` needs the shadow reason from the hook rather than inferring it from
  connection status.
- The pure resolver can be tested without spawning MCP processes. A separate
  local stdio smoke still covers `tools/list`, `list_changed`, and filtering.

## Alternatives

- **Auto-detect by command/package name and run `npx`.** Rejected: untrusted
  project content would execute a binary and violates the source-consent rule.
- **Treat every MCP server as analysis.** Rejected: it would shadow unrelated
  servers and makes the capability list unmaintainable.
- **Move analysis tools into core.** Rejected for CodeGraph: it is a local
  database plus MCP server, not a built-in Zeta tool; recognition is the
  integration surface.
- **Hard-depend on CodeGraph.** Rejected: optional capability, no core
  dependency, no automatic install.

## Links

- [External sources and tool exposure §8](../external-sources-and-tool-exposure.md#8-mcp-与内置重复)
- [MCP configuration](../../docs/mcp-config.md)
- [MCP runtime lifecycle](../../docs/mcp-runtime-lifecycle.md)
- Resolver: `packages/coding-agent/src/mcp/analysis-precedence.ts`
- Hook adapter: `packages/coding-agent/src/mcp/analysis-precedence-hook.ts`
- Tests: `packages/coding-agent/test/mcp/analysis-precedence.test.ts`
