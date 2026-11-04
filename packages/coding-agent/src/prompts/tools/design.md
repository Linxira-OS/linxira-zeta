# design

Workspace-scoped OpenDesign bridge. This tool exists only when `.zeta/design.yml` has `enabled: true` in the current workspace; otherwise it is not registered.

`design` is one tool, not a dump of OpenDesign's MCP surface. It keeps MCP for structured project/artifact/run operations and uses the OpenDesign CLI for media generation, export, brand, design systems, Figma, and other shell-first operations.

## Actions

- `status` — detect the CLI, daemon, and MCP server; report which layer is missing.
- `mcp` — call one OpenDesign MCP tool. Pass `mcp_tool` and `arguments`. Use for project/file/artifact discovery, briefs, runs, and resources.
- `cli` — run one OpenDesign CLI subcommand. Pass `args` without the leading `od`. Use for `media`, `export`, `brand`, `design-systems`, `figma`, `lint`, `templates`, `library`, and similar operations.
- `open` — open an `http`/`https` preview URL in the user's browser.

## Rules

- Do not call this tool in repositories without the workspace switch.
- Prefer MCP for stateful design operations; use CLI only for capabilities MCP does not expose.
- Keep the daemon running. The MCP process is a thin proxy; it does not make OpenDesign work offline.
- For binary exports, use `cli` with `export`. For a browser-visible page, return the preview URL and use `open`.
- Do not expose raw MCP tool names as separate tools.
- Never put secrets in `.zeta/design.yml`.
