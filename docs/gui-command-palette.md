# The GUI command palette

`main/crates/zetawork-gui/src/palette.rs`, opened with **⌘K / Ctrl-K** (the
shortcut the 帮助 toast and the 快捷键 settings already advertised).

It is a **jump-and-act** surface, not a command line:

- it never interprets `/`, `!` or any other prefix as a command;
- it never types into a terminal, and the terminal's input path is untouched —
  the palette consumes keys only while it is open;
- it lists only things that exist: projects, workspaces, conversations, files,
  and three desktop actions.

## Rows

| Section | Source | Running the row |
| --- | --- | --- |
| 操作 | Active workspace branches (non-current), plus two fixed rows | Switches branch / opens 设置 → 远程访问 / restarts the backend |
| 项目 | `AppState::projects` | Selects the project (and its first workspace) |
| 工作区 | Every project's 大标签页 | Selects the workspace's 大标签页 |
| 会话 | The gateway list the left column reads | Opens the Agent page, reusing an existing tab |
| 文件 | `git ls-files --cached --others --exclude-standard` of the active workspace, else a depth-4 walk that skips `node_modules`, `target`, `dist`, … | Opens the file in the active pane's editor |

The two I/O lists (files and branches) are read once when the palette opens,
not per frame. The file list is capped at 2000 rows.

## Ranking

`rank` is pure and tested. A query is whitespace-split and every token must
match, on this scale:

1. exact title match,
2. title prefix,
3. a word inside the title (split on spaces, `/`, `\`, `-`, `_`, `.`, `:`),
4. a title substring,
5. a match in the detail line (path, command).

Ties keep the build order, so an empty query shows the sections as listed and
the list is stable between frames. Up/Down wraps; Enter runs the highlighted
row; Esc closes. A click outside closes.

## The three actions

- **切换分支** — reads the active workspace's branches with
  `git for-each-ref`, then uses the same `switch_args` the Git panel uses
  (a remote branch gets `switch -c <local> --track <remote>`). Nothing new is
  constructed here.
- **打开远程访问设置** — opens 设置 on the 远程访问 section (the pane documented
  in `docs/gui-settings.md`).
- **重启后端** — runs the shipped `zetacode daemon restart` (see
  `docs/daemon.md`) on a worker thread; the result arrives as a toast on a
  later frame. A headless shell (`probe == false`) names the command instead of
  starting a CLI, the same rule the updater follows.
