# design

Workspace-scoped OpenDesign bridge. It is injected as a custom tool only when the current workspace's `.zeta/design.yml` has `enabled: true`; a workspace without the marker never registers it.

See [Design bridge](../design.md) for the workspace switch, lifecycle, status model, security boundaries, and extension points.

## Actions

### `status`

Detect the OpenDesign CLI, daemon, and MCP server and report the first missing layer.

### `mcp`

Call one OpenDesign MCP tool:

```json
{
	"action": "mcp",
	"mcp_tool": "create_project",
	"arguments": { "name": "landing-page" }
}
```

The bridge keeps one MCP connection per workspace so `collect_brief` / `confirm_brief` share their draft store. It closes on session shutdown or switch.

### `cli`

Run an OpenDesign CLI command without a shell:

```json
{
	"action": "cli",
	"args": ["media", "models"]
}
```

Allowed top-level commands: `media`, `export`, `brand`, `design-systems`, `figma`, `lint`, `templates`, `library`, `files`, `artifacts`, `project`, `run`, `skill`, `plugin`, `comment`, `collab`, `share`, `atoms`, `workspace`, `version`, `doctor`. The daemon must be reachable for commands that use it.

### `open`

Open a browser-visible preview:

```json
{
	"action": "open",
	"url": "http://127.0.0.1:3000/preview/..."
}
```

Only `http` and `https` are accepted.

## Requirements

- `.zeta/design.yml` enabled in the workspace
- OpenDesign CLI (`od`) on `PATH`, or absolute `cli.command` / `mcp.command` paths
- OpenDesign daemon running for MCP calls and daemon-backed CLI commands

## Security

The tool requests `write` approval. It never uses a shell, never exposes the 22 raw MCP tools as separate tools, and never writes outside the workspace marker or OpenDesign's own project files.
