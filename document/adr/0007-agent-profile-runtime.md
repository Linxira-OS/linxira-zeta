# 0007 — Agent profile as the per-runtime tool/memory admission boundary

- Status: Accepted
- Date: 2026-11-11
- Supersedes: —
- Links: [agent-profile contract](../../packages/coding-agent/src/agent-profile), [IM runtime contract](../../docs/agent-modes.md)

## Context

IM channels and personal main agents need distinct tool surfaces, persona,
model, memory namespace, plugin storage and approval cache on one runtime.
`toolNames` alone narrows builtins; MCP/extension/custom tools stayed additive,
and memory was keyed by cwd only.

## Decision

1. A profile is a configuration template; a runtime is one conversation
   (`agentRuntimeId = im:<instance>:<profile>:<binding>`). Runtime state never
   follows a reused profile id.
2. `createAgentSession({ agentProfile })` treats the profile as an admission
   policy: `builtin` is the whole built-in set (`[]` = zero),
   `extensions`/`mcpServers` are allowlists, omitted
   `customTools`/`skills`/`commands` mean none.
3. Admission is enforced at every entry: extension path import, tool
   registration (including late `registerTool`), custom-tool discovery, MCP
   server config/connect and every `refreshMCPTools` (list_changed, reconnect,
   `/mcp reload`). Unknown MCP server origin is denied.
4. Homes, namespaces and caches derive from the exact tuple via injective path
   segments: `<agentDir>/im-agents/<instance>/<profile>/<binding>`,
   `memoryNamespace = im:<instance>:<profile>:<binding>` or
   `<label>@<binding>`. An explicit label never drops the binding suffix.
5. `memoryBackend` overrides the settings layer for the session; the namespace
   is persisted on the session header so restart keeps the scope.
6. A main/front-door session selects a profile with `--agent-profile` or the
   `agent.profile` setting; profile files live in
   `<agentDir>/agent-profiles.json` and `<cwd>/.zeta/agent-profiles.json`
   (project wins).

## Consequences

- Two chats in one process cannot share tools, memory, plugin storage or
  approval cache, even with the same instance and profile.
- Subagents do not widen the parent's profile: the policy is the session
  contract; delegating with `task` remains an explicit profile grant.
- No new approval layer, sandbox or plugin-manager ban is introduced; the
  product default stays `yolo`.
