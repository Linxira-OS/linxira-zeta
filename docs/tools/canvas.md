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
- `create` requests write approval; `list` and `outline` are read-only.

## Operations

| `op`      | Fields                         | Result                                                     |
| --------- | ------------------------------ | ---------------------------------------------------------- |
| `list`    | —                              | Canvas paths under `.canvas/`, relative to that directory. |
| `create`  | `title`, `kind?`, `overwrite?` | Writes an empty template and returns its repository path.  |
| `outline` | `path`                         | Markdown summary of nodes/text/edges for the given canvas. |

- `kind` is `excalidraw` (default) or `obsidian`.
- `create` refuses to replace an existing canvas unless `overwrite: true`.
- `outline` accepts paths relative to `.canvas/` and rejects paths outside it.

## Files

- `.canvas/<slug>.excalidraw` — Excalidraw scene JSON (`{ type: "excalidraw", elements, appState, files }`).
- `.canvas/<slug>.canvas` — Obsidian Canvas JSON (`{ nodes, edges }`).
- Templates are empty. Fill them with the normal `write`/`edit` tools; use `read <file>:img` for a terminal preview and `vault://…?op=canvas` for an outline under a configured vault.
- Git tracking is the project's choice. The tool creates files only and never edits `.gitignore`.
