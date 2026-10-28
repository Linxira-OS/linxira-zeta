# canvas

> Manage persistent canvas scenes under `.canvas/` in the repository root.

## Source

- Entry: `packages/coding-agent/src/tools/canvas.ts` (`CanvasTool`)
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/canvas.md`
- Scene summaries / rendering: `packages/coding-agent/src/internal-urls/canvas.ts`, `packages/coding-agent/src/utils/canvas-svg.ts`
- Registration: `packages/coding-agent/src/tools/index.ts`

## Registration / Visibility

- Requires `canvas.enabled = true`, off by default. Enable **Canvas Scenes** under `/settings` → Tools.
- When off, the tool is absent from the tool list and the model is not told about it. `read <file>:img` and `vault://…?op=canvas` reject canvas files with instructions to enable the setting.
- `create` and `write` request write approval; `list` and `outline` are read-only.

## Operations

| `op`      | Fields                                             | Result                                                     |
| --------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `list`    | —                                                  | Canvas paths under `.canvas/`, relative to that directory. |
| `create`  | `title`, `kind?`, `nodes?`, `edges?`, `overwrite?` | Writes a scene and returns its repository path.            |
| `write`   | `path`, `nodes?`, `edges?`                         | Replaces the scene at `path` (creates it if missing).      |
| `outline` | `path`                                             | Markdown summary of nodes/text/edges for the given canvas. |

- `kind` is `excalidraw` (default) or `obsidian`; `write` infers the format from the extension.
- Node fields: `id?`, `text`, `x`, `y`, `width?`, `height?`. Edge fields: `from`, `to`, `label?`. Edge ids must reference nodes in the same call.
- `create` refuses to replace an existing canvas unless `overwrite: true`.
- `write` and `outline` accept paths relative to `.canvas/` and reject paths outside it.

## Files

- `.canvas/<slug>.excalidraw` — Excalidraw scene JSON (`{ type: "excalidraw", elements, appState, files }`).
- `.canvas/<slug>.canvas` — Obsidian Canvas JSON (`{ nodes, edges }`).
- The tool serializes nodes/edges into either format; use `read <file>:img` for a terminal preview and `vault://…?op=canvas` for an outline under a configured vault.
- Git tracking is the project's choice. The tool creates files only and never edits `.gitignore`.
