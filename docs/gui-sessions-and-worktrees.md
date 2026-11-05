# GUI: session management and per-conversation worktrees

> **Status (2026-11-06).** This page documents the paused Rust GUI
> (`main/crates/zetawork-gui`), which does not ship. The desktop surface is
> **Work Studio** in the browser (`zetacode serve`); see
> [`desktop-app.md`](./desktop-app.md).


Two surfaces that were web-only: the flat session list with pin/archive, and
the worktree switcher.

## 移除、关闭、归档与删除

The left column offers four actions that look similar and are not. Only the
last one touches a transcript, and even then the GUI never removes a file
itself.

| Action | Where | Effect |
| --- | --- | --- |
| **仅从视图移除** | Delete on a focused row, or 关闭标签页 in the row's menu | Closes every open tab that shows the session and drops its SSE reader. The conversation row, the gateway session and the transcript stay; nothing is archived. |
| **关闭并归档** | Shift+Delete on a conversation, or a tab's ✕ when it was that session's last tab | Stops the view and asks the gateway to `POST /api/sessions/<id>/archive` only when no remaining tab shows the session. Reversible from 会话管理 → 已归档 (恢复). |
| **删除会话** | Ctrl+Shift+Delete on a conversation (not running) | The first action only opens 会话管理 with that row's 确认删除 armed; no request is sent. The second click sends `DELETE /api/sessions/<id>`, which zetacode/gateway turns into a **soft delete** into `~/.zeta/trash/sessions` (30-day retention). The GUI never deletes a transcript or a directory. |
| **移除工作区** | The workspace row's ⋯ menu → 关闭工作区, or Delete on a focused workspace | Removes the workspace from the UI and closes its tabs by the rules below. The directory, files and worktrees are the user's; conversation rows are not archived or deleted and reappear when a workspace covering their `cwd` exists again. |

**关闭标签页 policy** (a tab's ✕, and Shift+Delete on an Agent row):

- **Agent** — stop the view; if this was the session's last open tab, request
  an archive first. Another workspace can reopen it from its conversation row.
- **编辑器** — a dirty buffer is written before the tab is removed; a failed
  save is shown in the notice and the tab stays. Closing a tab never discards
  unsaved text.
- **终端 / zetacode** — stop the PTY (or the page's own process) before the tab
  is removed. A pane always keeps at least one tab, so the last tab refuses to
  close and says so.

The 大标签页 strip scrolls horizontally once its tabs exceed the window width;
the tab order never reflows into a second row.

The gateway origin is discovered from `~/.zeta/serve.json` (`webUrl`). A
headless shell never probes, and with no published origin an action that needs
one says 未发现网关地址 instead of failing silently. This is checked manually,
not by a test: `stats::discover()` reads the user's home, so an automated test
would depend on the machine. To reproduce: move `~/.zeta/serve.json` aside,
open the GUI, and 新建会话 or 归档 → the notice; start `zetacode serve` and
repeat → the action succeeds.

## 会话管理

The left column's head has a list button; it opens a modal over the frame
(`session_admin.rs`). It lists every gateway conversation across all projects,
because the left column can only show the ones a workspace owns.

- **Search** uses the same rules as 历史 (title, id, cwd, all tokens required).
- **置顶 / 取消置顶** is a GUI preference. Pinned conversations sort first in
  the modal and are marked in 历史; the pins live in
  `~/.zeta/zetawork-session-pins.json`, written only by a real run. Nothing in
  zetacode's config is touched.
- **归档** calls `POST /api/sessions/<id>/archive`; **恢复** calls
  `POST /api/sessions/<id>/unarchive`. Both are the gateway's own reversible
  filesystem moves — this dialog never deletes a transcript.
- The 已归档 tab reads `GET /api/sessions/archived` (at most every 5 s while it
  is open). A restore moves the transcript back into the live tree, and the
  main list is marked stale immediately so it reappears without waiting for the
  poll.
- Requests run on a worker and are drained once per frame; the modal never
  blocks on a socket. A failure (relay session, missing file, server down) is
  shown in the dialog's status line.

Only a real run (`probe`) writes the pin file or talks to a backend; a headless
shell used by the tests and screenshots reads seeded rows.

## 工作树

`worktrees.rs` fills the right column's 工作树 tab. It answers one question:
*which checkouts does the active conversation's repository have, and which one
is the conversation in?*

- The directory it reasons about is the active Agent tab's session `cwd`, else
  the active workspace root. That is why the page is per-conversation: two
  conversations in one workspace can live in two worktrees.
- Rows come from `git worktree list --porcelain` at the repository root found
  through `git rev-parse --git-common-dir` (a linked worktree's common dir is
  the main repository's). Prunable rows are dropped.
- A row is marked 主工作树 (first), 会话 (contains the conversation's cwd),
  当前 (the workspace points at it) and 已锁定.
- **Clicking a row switches** the active workspace to that checkout. The
  branch is taken from the worktree's own `branch` line (or, when detached,
  from `git rev-parse --abbrev-ref HEAD`); a typed branch is never used.
  Running PTYs keep their directories — a process cannot be moved — but the
  file tree, git panel, new terminals and zetacode all start from the new root.
- **新建工作树** takes a branch name and runs:

  ```
  git worktree add -b <branch> -- <repo>-worktrees/<branch-dir>   # new branch
  git worktree add    -- <repo>-worktrees/<branch-dir>            # existing
  ```

  `<repo>-worktrees/<branch-dir>` is the web gateway's location rule
  (`/` and Windows-reserved characters become `-`), so worktrees created from
  either surface share one layout. The workspace then moves into it.
- **Remove** is a second click on the row (a right click arms it too):

  ```
  git worktree remove -- <path>          # clean
  git worktree remove --force -- <path>  # after git refuses a dirty checkout
  ```

  The main checkout cannot be removed; git's refusal text is shown verbatim
  and the next click on the same row forces the removal.

### The workspace branch

The branch chip on a workspace row and in the status bar is now always real:
`read_status` writes the checkout's current branch back into the workspace on
every git read, the seed reads it at startup, a new 大标签页 reads it instead of
assuming `main`, and a worktree switch writes the target's branch. Nothing in
the GUI spells `main` as a default any more.
