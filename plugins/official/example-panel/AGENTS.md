# AGENTS.md — example-panel

Scope: everything under `plugins/official/example-panel/`. This file is the
operating contract for an agent working on this plugin (or on a copy of it
extracted from the release zip).

## What this plugin is

The teaching example for Zeta's three plugin layers. It is deliberately small
and dependency-free: the extension factory imports only `node:fs`/`node:path`
and host types, so it loads in a session, on a machine with no `node_modules`,
and inside the zipped distribution.

## Invariants — do not break these

1. **One data source.** `data/tasks.json` is read by the tool
   (`example_panel_data`), and the web page fetches the same file through the
   asset route. Do not add a second dataset; a copy makes the native panels and
   the page disagree, which is exactly the failure this example exists to rule
   out.
2. **`ui.panels` and the tool agree.** Every declarative panel's
   `source.tool` is `example_panel_data` and its `args.panel` is one of
   `PANELS` in `index.ts`. `test/example-panel.test.ts` asserts it; keep it
   passing rather than editing the manifest alone.
3. **Panel shapes are the contract.** `list` → `{ rows }`, `form` →
   `{ fields: [{ key, label, value }] }`, `chart` → `{ points: [{ label, value }] }`.
   The native renderer reads `details`; a shape change is a renderer change.
4. **`html` means the web page.** The `guide` panel is `kind: "html"` with
   `entry: "pages/index.html"`. The host opens
   `/plugins/view/example-panel/pages/index.html` — do not invent a second URL
   scheme, and do not turn that panel into another declarative one.
5. **Locale pairs stay key-identical.** `locales/en.json` and `locales/zh.json`
   must have the same keys and no empty values (asserted by the test).
   `ctx.t(key, fallback?)` resolves current language → `en` → `fallback` → `key`.
6. **No behaviour layer for the TUI or the IDE.** This plugin registers tools,
   a command and a manifest. It must not import or assume `zetawork-gui`,
   `zeta-main` (TUI) or `termide`/`zetaide`: those two hosts carry no plugin
   layer by ruling, and a plugin hook there would be the silent regression.

## Commands

```bash
bun test test                     # the plugin's own test (no install needed)
bun run test                      # same, through package.json
```

From the Zeta checkout, for the host-integrated checks:

```bash
bun test packages/coding-agent/test/plugin-ui-panels.test.ts \
         packages/coding-agent/test/plugin-example-panel.test.ts
bun scripts/build-example-plugin-zip.ts    # zeta-plugin-example-<version>.zip
```

## Style

- Flat `Record<string, string>` locale tables; no nesting.
- Panel ids are lowercase `[a-z0-9-]` and unique; titles are short and static.
- Read-only data: the tool has `approval: "read"` and writes nothing.
- Comments explain *why* (the layering rule, the renderer contract), never what.

## When you change the manifest

`plugin.json` is validated by
`packages/coding-agent/src/extensibility/plugins/parser.ts` (`parsePluginUi`) and
by the Rust host (`main/crates/zetawork-gui/src/plugin_panels.rs`). Both reject
an unknown `kind`, a missing `source` for a declarative panel, an `html` panel
without `entry`, a non-`.html` entry and duplicate ids — run both test suites.
