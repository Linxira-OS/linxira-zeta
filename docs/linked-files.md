# Clicking a file reference

An agent prints file references all day: `src/agent.ts:42`, a plan path, a
`local://` document, an `artifact://` log. In the workbench those are links —
a click opens the file **in the pane beside the one you clicked from**, so the
conversation or terminal you were reading keeps its own tab.

Both surfaces share one text model; only the thing a click opens differs.

## What counts as a link

| Shape | Example | Resolves to |
|---|---|---|
| Relative path | `docs/plan.md` | the active workspace root |
| Absolute path | `C:\repo\src\main.rs` | as written |
| Home path | `~/notes/todo.md` | the user's home |
| Position suffix | `src/agent.ts:42:7` | the file, plus line 42, column 7 |
| `local://` | `local://plans/v2.md` | `~/.zeta/plans/v2.md` (a shared artifact) |
| `artifact://` | `artifact://build.log` | `~/.zeta/artifact…`; the flat spelling under `~/.zeta` is tried too |

`agent://` (a subagent's saved output) and `out://` (the agent's mid-turn
reply channel) are **not files**. A click reports that instead of opening
something unrelated. Web addresses are not opened by the workbench either.

## Where it opens

| File | Page |
|---|---|
| `.md`, `.mdx` | the **Markdown page** — rendered read-only (headings, lists, fences), never a text buffer you could accidentally edit |
| source and config (`rs`, `ts`, `tsx`, `js`, `jsx`, `py`, `go`, `c`, `h`, `cpp`, `java`, `kt`, `swift`, `rb`, `php`, `cs`, `css`, `html`, `json`, `toml`, `yaml`, …) | the **IDE page** — the same embedded `panel-ide` the TUI runs |
| anything else | the text editor |
| `.pdf` | the text editor; there is no rendered PDF page |

A file already open in the target pane is activated, never reloaded: an
unsaved buffer is the user's work.

## What is refused

- A path that does not exist, or that names a directory: the click says so
  (`… 不存在或无法打开 / does not exist or cannot be opened`) instead of
  opening an empty page.
- In the GUI, a path that resolves **outside** the workspace and `~/.zeta`
  after canonicalization. A symlink inside the workspace that points outside
  is refused too, so a terminal line cannot talk the window into opening
  `/etc/passwd`.

The TUI has no root set: the workbench already opens what the terminal names,
and this feature does not widen that.

## Not yet

- The IDE page opens the file but does not place the cursor at the linked
  line/column; the plain editor page does.
- Links **inside** a rendered Markdown page are not clickable yet.

## Implementation

- GUI: `main/crates/zetawork-gui/src/link.rs` (text model, root check),
  `src/center.rs` (`link_pointer`, `markdown_body`), `src/lib.rs`
  (`Shell::open_linked`), `src/state.rs` (`open_ide_linked`, `is_markdown`).
- TUI (`zetawork`): `main/crates/zeta-main/src/link_target.rs` (text model,
  URI mapping), `src/app.rs` (`open_path_in_editor`, `PanelEvent::OpenLink`),
  `src/tab.rs` (`PaneKind::Markdown`, `PaneKind::IdePage`).
