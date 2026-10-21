# GUI: session management and per-conversation worktrees

Two surfaces that were web-only: the flat session list with pin/archive, and
the worktree switcher.

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
