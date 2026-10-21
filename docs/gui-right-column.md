# The right column: git branches and the context ring

Two pieces of the desktop shell's right column became interactive: the Git
tab can now move between branches, and 用量 draws its context share as a ring
instead of a bar. This page covers what each one reads, what it writes, and
where its numbers come from.

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

Both actions are the only writes this column performs. Their result (the
switched branch, or git's own refusal text) is shown on one line above the
groups, and a success re-reads the snapshot immediately, because the changed
files, ahead/behind counts and commit tail all belong to the new checkout.

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
