# Agent-authored pages and workflows

A local page lives under the agent-pages root (default `<agent dir>/agent-pages`,
override `ZETA_AGENT_PAGES_DIR`):

```text
<root>/<page-id>/page.json
<root>/<page-id>/index.html
<root>/<page-id>/app.mjs
```

`page.json` is strict; unknown keys and malformed permissions are rejected.

```json
{
	"schema": "agent-page/1",
	"id": "release-board",
	"name": "Release board",
	"entry": "index.html",
	"permissions": {
		"read": ["data/"],
		"write": ["out/"],
		"network": ["api.example.com"],
		"spawn": ["refresh"]
	},
	"workflows": [
		{
			"id": "refresh",
			"steps": [
				{ "id": "read", "kind": "read", "path": "data/state.json", "output": "json" },
				{ "id": "write", "kind": "write", "path": "out/state.json", "input": "read", "dependsOn": ["read"] }
			]
		}
	]
}
```

Permissions are deny-by-default. A path is resolved lexically and through
`realpath`, must stay under the page directory (Windows device names are
rejected), and a network grant names one host or a `*.` suffix. There is no
shell or JavaScript-eval step.

The gateway exposes the same page over the normal authenticated `/api/*`
surface:

| Route | Purpose |
|---|---|
| `GET /api/agent-pages` | list valid pages and manifest warnings |
| `GET /api/agent-pages/:id` | redacted manifest |
| `GET /api/agent-pages/:id/assets/*` | page-owned static files (allowlisted extensions) |
| `POST /api/agent-pages/:id/workflows/:id/run` | run one declared DAG |

A workflow is validated before side effects: cycles, unknown steps, and any
step outside the manifest permissions fail before a read/write/fetch/spawn.
`spawn` composes another declared workflow, never an OS process. Cancellation
is honoured between steps; a failed step aborts its dependents.

There is no page editor or browser UI in this slice; pages are authored as
files and opened through the gateway or a hosting surface.
