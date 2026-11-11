# 0008. Native-only foreign project sources and tool exposure tiers

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Zeta maintainers (REQ-054)
- **Links:** [external sources](../../document/external-sources-and-tool-exposure.md)

## Context

Root rules require foreign project config to be inert by default, but
`.claude/settings.json`, `.claude/**` skills/hooks/tools/MCP, and analogous
trees were loaded without consent. Tool exposure also lacked a real
`tools.disabled`/tier mechanism.

## Decision

1. Foreign providers are inert for project-scope items until the operator
   approves them in `<agentDir>/sources.json`; approval stores a SHA-256 of the
   provider's project files and is revoked by any edit. Foreign user-level
   sources keep their existing `enabledProviders` opt-in.
2. Foreign `SYSTEM.md`/`SYSTEM_TEMPLATE.md` never replaces the prompt, even
   with consent. `zetacode sources list|approve|revoke` is the explicit
   surface; `ZETA_FOREIGN_PROJECT_SOURCES=all|a,b` is the non-interactive escape.
3. `tools.profile` expands the documented 4/5/12/full presets for built-ins;
   `tools.disabled` subtracts names from every family (built-in, extension,
   custom, MCP). Denied tools are never registered.
4. `write xd://enable` enables one already-registered tool after the write
   tool's existing approval gate; it cannot widen `tools.disabled` or a profile.

## Consequences

- Cloning a repository no longer executes its foreign config on session start.
- No new approval for native `.zeta` plugins, and YOLO remains the default.

## Alternatives

- Load foreign project config by default and document the risk. Rejected: it
  executes an untrusted repository's configuration on session start.
- A second approval layer for native `.zeta` plugins. Rejected: native sources
  are the operator's own configuration, not a foreign trust boundary.

## Links

- [external sources](../../document/external-sources-and-tool-exposure.md)
- [discovery consent](../../packages/coding-agent/src/config/foreign-sources.ts)
