# The right column: git branches, shipping and the context ring

> **Status (2026-11-06).** This page documents the paused Rust GUI
> (`main/crates/zetawork-gui`), which does not ship. The desktop surface is
> **Work Studio** in the browser (`zetacode serve`); see
> [`desktop-app.md`](./desktop-app.md).


The Git tab can move between branches, commit all changes with a message, and
push the current branch. 用量 draws its context share as a ring instead of a
bar. This page covers what each one reads, what it writes, and where its
numbers come from.

## Git tab: listing, switching, creating

`main/crates/zetawork-gui/src/git.rs` still owns every git answer. The status
snapshot gained one call:

```
git -C <workspace> for-each-ref \
  --format=%(refname)%00%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(symref) \
  refs/heads refs/remotes
```

`parse_branches` drops symrefs (`refs/remotes/origin/HEAD` is an alias, not a
branch) and sorts locals before remote-tracking refs, each group by name. A
local branch carries `current` from `%(HEAD)`, and its upstream when one is
configured.

`right.rs` draws that list under 分支:

- a click on a non-current row switches the worktree;
- the current row is inert and marked 当前;
- a remote row shows its full `origin/…` name and is marked 远程.

The argv is built by `switch_args`, not by the click handler, so the command a
test asserts is the command that runs:

| Row | `git switch` argv |
| --- | --- |
| local `feat/x` | `switch feat/x` |
| remote `origin/dev` | `switch -c dev --track origin/dev` |
| 新建分支 `release/1.2` | `switch -c release/1.2` |

The remote form creates the local branch explicitly instead of relying on
git's DWIM, which is ambiguous when two remotes carry the same branch name.
`valid_branch_name` applies the `check-ref-format --branch` rules the user can
type before the 创建 button is enabled; the real command still runs under git's
own validation.

A branch action's result (the switched branch, or git's own refusal text) is
shown on one line above the groups, and a success re-reads the snapshot
immediately, because the changed files, ahead/behind counts and commit tail all
belong to the new checkout.

## Git tab: commit all and push

The commit row writes the shell's one-line message to
`git_commit_draft`; the message survives a tab switch because it belongs to the
shell, not to the panel. 提交全部更改 is enabled only when the snapshot has
tracked or untracked changes and the message is not blank. It runs:

```
git -C <workspace> add -A
git -C <workspace> commit -m <message>
```

The add is deliberately repository-wide: the button says 提交全部更改, and the
untracked list is part of that. Git's identity, hooks and refusal text are not
bypassed. On success the draft is cleared and the snapshot is re-read.

推送 runs plain `git push` when the branch already tracks an upstream, and
`git push -u origin HEAD` when it does not, so the first push creates the
upstream. It is enabled when there is no upstream or when the snapshot reports
ahead commits. Both outcomes land in the same notice line above the groups.

Per-file staging, hunk-level staging, pull-request creation and merge-conflict
resolution are not implemented; the panel does not draw placeholder buttons for
them.

## 用量: the context ring

The ring replaces the percentage bar in the context row. It is drawn from two
sources:

1. **The conversation journal** (`conversation.rs`) supplies the token sums,
   the window when the journal records one, and the single-arc fallback.
2. **`GET /api/agent/<id>/context`** supplies the live composition
   (`systemPrompt` / `systemTools` / `systemContext` / `skills` / `messages`),
   the compaction threshold and the authoritative `usedTokens`. The cache polls
   it every 5 s while an Agent tab is attached to a live session, and backs off
   to 30 s after a failure. The journal remains the source for the cumulative
   rows (input/output/total/cost/model); only the ring's window and
   composition come from the live report, and only when it names the same
   session on screen.

Geometry lives in `ring.rs` and is unit-tested without a window:

- angles are degrees, 0 at 12 o'clock, clockwise; `angle_at(percent)` is the
  only conversion;
- `segment_sweeps(tokens, window)` returns each category's sweep and clamps an
  over-counting report so the ring cannot wrap past its start;
- `annulus`/`threshold_tick` return the points the painter draws;
- `tone(percent, threshold)` classifies the share as normal, near (within 10
  points below the threshold) or over, and the arcs switch from their category
  colours to amber, then red.

The threshold tick is drawn only when the live report names one — the pane
does not invent a compaction point for a journal-only conversation. Hovering
the ring lists every arc's tokens and share, which the 104 px circle cannot
carry inline.

The page still never prices a request or invents a window: with no window, the
row says 窗口未知，不显示占比 and draws no ring.
