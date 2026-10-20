# Example Panel — the plugin that teaches the three layers

A complete, working Zeta plugin you can read in five minutes. It ships **all
three plugin layers** on purpose, because the same plugin directory is expected
to serve the TUI, the desktop and the browser without three code bases:

| Layer | What it is here | Where it runs | How you see it |
|---|---|---|---|
| **Behaviour** | tool `example_panel_data`, command `/example-panel` | the agent session (TS, in process) | the model calls the tool; the command prints task counts |
| **Declarative panel** | `plugin.json` → `ui.panels` — one `list`, one `form`, one `chart` | a host with a native renderer (zetawork GUI's plugin column) | the panels are drawn by Rust, no webview, no extra HTTP service |
| **Web page** | `pages/index.html` | web-ui's plugin host, and the GUI's plugin column in a webview | `/plugins/view/example-panel/pages/index.html` |

The rule behind that table: **whether a panel can be native depends on whether
the panel is declarative, not on the language the plugin is written in.**

## Layout

```
example-panel/
├── plugin.json          # catalogue + ui.panels (the declarative panel declarations)
├── package.json         # @linxiraos/example-panel; zeta manifest: extensions + locales
├── index.ts             # the extension factory: one tool, one command
├── data/tasks.json      # the one data source every layer reads
├── locales/en.json      # flat Record<string,string>, read through ctx.t()
├── locales/zh.json
├── pages/index.html     # the web-ui page (the html panel points here)
├── README.md
├── AGENTS.md
└── test/example-panel.test.ts
```

## Try it

```bash
# from the Zeta checkout
bun test plugins/official/example-panel/test      # the plugin's own test, no install needed

# install it like any plugin (choose one)
zetacode plugins install @linxiraos/example-panel
zetacode plugins link plugins/official/example-panel --local
```

Then, in a session:

```
> use the example_panel_data tool with panel "tasks"
> /example-panel
```

In the desktop (zetawork GUI) open the right column's **插件** tab: the three
declarative panels are drawn natively; the `guide` panel opens the HTML page
through web-ui in the same column.

In the browser, with `zetacode serve` running:

```
http://127.0.0.1:<web-ui-port>/plugins/view/example-panel/pages/index.html
```

## The declarative panels

`plugin.json` is the file the native host reads. Each panel is one of:

| `kind` | Extra fields | Data the tool returns as `details` |
|---|---|---|
| `list` | `columns: string[]` (optional) | `{ "rows": [{ "<column>": … }] }` |
| `form` | — | `{ "fields": [{ "key", "label", "value" }] }` — read-only, labels pre-localized |
| `chart` | — | `{ "points": [{ "label", "value": number }] }` |
| `html` | `entry: "<path>.html"` | — (the host navigates to `/plugins/view/<plugin>/<entry>`) |

Every declarative panel names its data source as a **tool call**, never an HTTP
route:

```json
{ "id": "tasks", "title": "Tasks", "kind": "list",
  "source": { "tool": "example_panel_data", "args": { "panel": "tasks" } },
  "columns": ["id", "title", "owner", "state"] }
```

The host runs that tool and draws `details`. Two reasons the tool is the source
and not a route: the producer already exists as a tool registration, and a panel
must render even when `zetacode serve` is not running — the HTTP gateway is the
browser's adapter, not a prerequisite for the desktop's own panels.

## The web page

`pages/index.html` is plain HTML/JS/CSS, no build step. web-ui serves it from the
plugin package (`/api/plugin-assets/example-panel/pages/index.html`) inside the
chrome-free host page at `/plugins/view/example-panel/pages/index.html`, so the
page can call whatever `/api` endpoints it needs and can fetch sibling files
(`../data/tasks.json`) through the same asset route.

A plugin that *wants* the browser goes to web-ui; one that *wants* a native
panel declares it. Nothing stops a plugin from shipping both — this one does.

## Locales

`package.json` declares the two catalogues; the host injects
`ctx.t(key, fallback?)` into this plugin's tool and command contexts, resolving
current language → `en` → `fallback` → `key`. The form panel's labels come from
the tool, so they are localized; the manifest's panel `title` strings are static
(the manifest is data, not code) — keep them language-neutral or short.

## Install the distributable copy

`scripts/build-example-plugin-zip.ts` packages this directory (with a fresh
`git init` and one commit) as `zeta-plugin-example-<version>.zip`:

```bash
bun scripts/build-example-plugin-zip.ts
unzip zeta-plugin-example-1.0.0.zip -d /tmp/example-panel
cd /tmp/example-panel/example-panel && git log --oneline   # one commit: this plugin at this version
```

Drop the extracted directory into `~/.zeta/agent/plugins/` and the plugin is
installed.

## Related

- `document/plugin-system.md` — the three-layer model and the decision table.
- `docs/writing-a-plugin.md` — the user-facing guide this example accompanies.
- `plugins/official/README.md` — the official-plugin template and checklist.
