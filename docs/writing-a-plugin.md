# Writing a plugin

A Zeta plugin is a directory. It can contribute three kinds of things, and you
choose per thing — not per language, not per front end:

| What you are adding | Where it goes | Who runs it |
| --- | --- | --- |
| An action the model or the user can trigger | a **tool** or a **command** in your extension module | the session process, whatever front end is attached |
| Structured data you want in the desktop's plugin column | a **declarative panel** in `plugin.json` (`list` / `form` / `chart`) | the Rust GUI draws it natively — no webview, no extra service |
| A page of your own HTML/JS/CSS | an **`.html` file** in your package | the GUI's plugin column in a webview (the Web UI's plugin host is deferred with the rest of the Web UI) |

The rule that decides the second and third rows: **a panel can be drawn natively
when it is declarative**, not when the plugin is written in any particular
language. If your panel is an arbitrary web page, it stays a web page.

A complete worked example ships in the repository:
`plugins/official/example-panel/` (also distributed as
`zeta-plugin-example-<version>.zip`). Read it alongside this page.

## 1. The package

```
my-plugin/
├── package.json        # name + version + the zeta manifest block
├── plugin.json         # catalogue manifest + the declarative panels
├── index.ts            # the extension factory (tools, commands)
├── locales/en.json     # optional: flat key → string tables
├── locales/zh.json
└── pages/index.html    # optional: page(s) rendered by the host surface
```

`package.json` carries the manifest the loader reads:

```json
{
	"name": "@scope/my-plugin",
	"version": "1.0.0",
	"type": "module",
	"zeta": {
		"version": "1.0.0",
		"extensions": ["./index.ts"],
		"locales": { "en": "locales/en.json", "zh": "locales/zh.json" }
	}
}
```

Declare `zeta` (or the upstream spellings `omp` / `pi`, which are still read).
Relative paths are resolved from the plugin root. A plugin without `zeta` is not
a plugin package — it will be listed only if it is an extension package.

## 2. Behaviour: a tool and a command

```ts
import type { ExtensionAPI } from "@linxiraos/zeta";

export default function myPlugin(pi: ExtensionAPI): void {
	const Type = pi.typebox.Type; // the host injects its schema builder
	pi.registerTool({
		name: "my_plugin_data",
		label: "My plugin data",
		description: "Return this plugin's panel data.",
		approval: "read",
		parameters: Type.Object({ panel: Type.String({ description: "which panel" }) }),
		async execute(_callId, params, _signal, _update, ctx) {
			const data = { rows: [{ id: "T-1", state: ctx.t("state.done", "done") }] };
			return { content: [{ type: "text" as const, text: JSON.stringify(data) }], details: data };
		},
	});

	pi.registerCommand("my-plugin", {
		description: "Print something",
		handler: async (_args, ctx) => ctx.ui.notify(ctx.t("hello", "Hello")),
	});
}
```

Rules that matter:

- **Registration happens at load time.** A tool registered later does not exist
  for the session; a module that throws while importing contributes *nothing*
  while the plugin still lists as installed. `zetacode plugin doctor` checks the
  declared entries exist, not that they import.
- **`ctx.t(key, fallback?)`** resolves current host language → `en` →
  `fallback` → `key`, per plugin. It is available in tool `execute`, event
  handlers, commands and shortcuts of that plugin.
- Tools that only read should say `approval: "read"`.
- Do not reach for a front end: no importing GUI/TUI/IDE crates, no assuming a
  window exists (`ctx.hasUI` is false on the server).

## 3. A declarative panel

In `plugin.json`:

```json
{
	"id": "my-plugin",
	"name": "My Plugin",
	"ui": {
		"panels": [
			{
				"id": "tasks",
				"title": "Tasks",
				"kind": "list",
				"source": { "tool": "my_plugin_data", "args": { "panel": "tasks" } },
				"columns": ["id", "state"]
			},
			{ "id": "guide", "title": "Guide", "kind": "html", "entry": "pages/index.html" }
		]
	}
}
```

| `kind` | Needs | Your tool returns as `details` |
| --- | --- | --- |
| `list` | `source` (and usually `columns`) | `{ "rows": [{ "<column>": … }] }` |
| `form` | `source` | `{ "fields": [{ "key", "label", "value" }] }` |
| `chart` | `source` | `{ "points": [{ "label", "value": number }] }` |
| `html` | `entry` (an `.html` file in your package) | — (the host opens the page) |

- `source` is **a tool call**, not an HTTP route. The data producer is already a
  tool, and a panel has to draw even when `zetacode serve` is not running.
- `html` reuses the page URL that already exists:
  `/plugins/view/<plugin-id>/<entry>`. There is no second scheme.
- `id` must be lowercase `[a-z0-9-]` and unique in the plugin. Titles are static
  manifest strings — keep them short and language-neutral; anything localized
  has to come from your tool (e.g. form field labels).
- Invalid declarations are rejected by name, e.g.
  `` `ui.panels[0].source.tool` must be a non-empty tool name, got undefined ``.
  At load time an invalid `ui` block is dropped with a warning and the plugin
  still works — the panels just do not appear.

Where you used to see them: the paused Rust GUI had a 插件 page in the
right column. Pick your plugin, pick a panel, and it is drawn natively. The
`html` panel opens your page in that same column.

Panels are a workbench surface, so the agent only reports them when it is
running inside a Zetawork terminal: a local pane (`ZETA_WORKBENCH=1`) or a
pane attached to `zetacode serve` (`TERM_PROGRAM=zetawork`). In a plain
terminal the declaration reads as "no panels" — `zetacode plugins panel` says
so by name — while your plugin's tools, hooks and commands keep working.
Set `PI_FORCE_PLUGIN_PANELS=1` to see the panels outside the workbench for
debugging. `ui` validation only runs when the gate is open, so an invalid block
is not reported from a plain terminal.

## 4. A web page

A plugin page is declared in `plugin.json` as an `html` panel; the host serves
the manifest entry, not every HTML file in the package:

```json
{
	"id": "my-plugin",
	"name": "My plugin",
	"ui": {
		"panels": [{ "id": "tasks", "kind": "html", "title": "Tasks", "entry": "pages/tasks.html" }]
	}
}
```

- host page: `/plugins/view/<plugin-id>/<entry>` (Studio route; `<entry>` is the
  package-relative HTML path, URL-encoded per segment)
- the file itself: `/api/plugin-assets/<plugin-id>/pages/tasks.html?cwd=<project>`

`plugin.json#id` is the catalogue id used by both URLs; without it the package
name basename is used. Asset URLs produced by `plugins.pages` carry
`?cwd=<project>` when a project root is known: iframe navigation cannot
forward the Studio client's `x-zeta-cwd` header, so the query keeps
project-scoped plugin roots resolvable at asset time. The file is served
same-origin inside a sandboxed iframe (`allow-scripts allow-same-origin`), so it
can load sibling CSS/JS/images but cannot navigate the top window, open popups,
or submit forms.

### Page host bridge

The host injects `window.__zetaPage` after the page loads. It is the only
host API a page gets; there is no ambient Node access or arbitrary HTTP server.

| Method | Result |
| --- | --- |
| `ready(capabilities?)` | announces protocol v1; host replies `init` + `context` |
| `callTool(tool, args?)` | runs one tool registered by **this plugin**, through the session's normal tool wrapper/approval; resolves to `{ content, details? }` or rejects |
| `getContext()` | read-only `{ theme, language, cwd, plugin }` |
| `subscribe(events)` | requests host event projection; unsupported scopes reject |
| `notify(level, message)` | host-local notice (`info`/`warning`/`error`) |
| `on(type, listener)` | listens for host `event` messages |
| `resize(height?)` | sets the iframe height; a `ResizeObserver` sends it automatically |

Messages are `postMessage` envelopes with `__zetaPage: 1`, protocol `v: 1`, and
a request `id`; the host answers `result` / `error` (`{ code, message }`).
`callTool` fails unless the tool is active in the session and registered by the
page's own plugin, so a page cannot reach another plugin's tools or a tool the
user disabled. Writes go through `callTool`; HTTP `/api/*` stays read-only data.

## 5. Locales

`locales/en.json` and `locales/zh.json` are flat `Record<string, string>`:

```json
{ "hello": "Hello", "state.done": "done" }
```

Keep the two files key-identical: a key only one language has falls back to `en`,
then to the caller's fallback, then to the raw key. `ctx.t` reads the live
language on every call, so `/language` switches take effect without reloading.

## 6. Testing and installing

```bash
# the plugin's own test (a stub host — no install needed)
bun test plugins/official/example-panel/test

# install for a session
zetacode plugins install <path-or-package>
zetacode plugins link /absolute/path/to/my-plugin --local
zetacode plugins list

# what a native host sees for one panel (the desktop runs exactly this)
zetacode plugins panel my-plugin tasks --json
```

Drop a directory into `~/.zeta/agent/plugins/` and it is installed too — which
is exactly what the distributable zip is for.

## What a plugin may not assume

- **No plugin layer in the TUI (`zeta-main`) or in `termide`/`zetaide`.** These
  front ends do not discover plugins, draw panels, or run plugin hooks, by
  ruling; a plugin must not require them. (Guarded by a test so it cannot
  regress silently.)
- No webview, no window, no HTTP server of your own.
- No file writes outside `ctx.storage` (or the project's `.zeta/`).
- No dependency on a particular front end's presence: if `zetacode serve` is
  down, your tool still works and your declarative panels still draw; only the
  browser page URL needs a host surface (the Web UI is deferred; the GUI
  plugin column still renders pages).

## See also

- [`plugins.md`](./plugins.md) — install shapes, roots, lockfile, session wiring
- [`extensions.md`](./extensions.md) — the extension API in full
- [`../document/plugin-system.md`](../document/plugin-system.md) — the design
  contract (three layers, panel schema, decision table)
- [`../plugins/official/example-panel/README.md`](../plugins/official/example-panel/README.md)
  — the worked example
