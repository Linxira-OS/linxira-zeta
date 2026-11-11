# NNNN. zetaide owns the Git center, JSON viewer and TODO scanner in `panel-ide`

> **Local draft.** The number is allocated by execution-system; this file lives
> in `document/adr/drafts/` until that number arrives and the index row can be
> added in the same change. Not an accepted ADR yet.

- **Status:** Proposed
- **Date:** 2026-11-11
- **Deciders:** Zeta maintainers (execution-system assigns the ADR id)
- **Links:** `document/roadmap.md` §P1 batch 2/4, `termide/crates/panel-ide`, `termide/crates/panel-git-log`, `termide/crates/panel-git-diff`, `termide/crates/walk`

## Context

The P1 roadmap asks the standard IDE page (`panel-ide`) for a Git center with
Changes, paginated History, per-file history and inline diff, plus the small
tools JSON Viewer and TODO Scanner. Formatter, bookmarks, notepad, ports, spell
and colour picker already exist; they are not re-decided here.

What is true in the tree today:

- History paging already streams through `termide_git::LogStream`; appended
  pages extend the existing rows (`GitLogPanel::take_rows`) and the refresh path
  keeps the selected commit. `Load older` is the auto-load near the end, not a
  separate widget.
- `GitLogPanel::set_file_filter` narrows history to one file, but the IDE only
  set the filter when the history view was first opened. Switching tabs kept the
  previous file's history.
- `GitLogPanel::view_diff` emitted `OpenGitDiff { file_path: None }`, so a
  per-file history opened the whole commit. The app's handler matched
  `(_, Some(file))` before `(Some(hash), None)`, so a commit+file request would
  have shown the working-tree diff and dropped the commit.
- There is no JSON viewer and no TODO scanner in the vendored termide tree.
- `termide-walk` already provides the git-aware tree walker used by project
  search; `termide-core::util::is_binary_file` already classifies binary files.

The desktop `zetawork-gui` surface is retired (2026-11-06 form ruling); this
decision stays inside the terminal IDE and does not revive it.

## Decision

1. **Git center stays on the existing termide panels.** `panel-git-log` remains
   the history source (streamed, append-only pages, per-file filter);
   `panel-git-diff` remains the hunk renderer. No git command logic is copied
   into `panel-ide`, and no new scan framework is introduced.
2. **Per-file history follows the active tab.** `IdePage` re-points the
   `GitLogPanel` filter whenever the active tab changes (open, cycle, close,
   tab click) while the History view is showing.
3. **Inline diff.** `view_diff` carries the current file filter; the app adds
   `GitDiffPanel::new_for_commit_file`. Inside `IdePage`, an `OpenGitDiff` event
   is mounted in the editor area as a preview panel (with `Esc` returning to the
   file) instead of opening a separate top-level panel. Outside the IDE the
   event keeps its existing meaning.
4. **JSON viewer is read-only and precision-preserving.** A small JSON parser in
   `panel-ide` keeps every number as its exact source text and every string's
   quoted literal; copying a value reproduces the source bytes, not an `f64`.
   The viewer never writes or formats the file; syntax errors show line/column.
   `Ctrl+J` opens the active file.
5. **TODO scanner uses the shared walker.** It scans the repository root through
   `termide_walk::walker(root, true)` (git ignore rules), skips binary files via
   `termide_core::util::is_binary_file`, caps file size and result count, and
   honours a cancel flag. Selecting a hit emits `OpenFileAt` so the existing
   editor path performs the jump. `Ctrl+D` opens it.
6. **Entries are in the IDE itself.** `Ctrl+J` / `Ctrl+D`, the empty-page hint,
   the preview status line and mouse selection are the discoverable entries; no
   new top-level menu or panel crate is required.

## Consequences

- The Git center answers the same question at every layer: the list, the filter
  and the diff are all per-file, while `stage`/`unstage` still act only on the
  selected paths (unchanged).
- JSON and TODO ship without new workspace dependencies beyond `regex` and
  `termide-walk` in `panel-ide`.
- The preview slot is shared by diff, JSON and TODO, so `Esc` has one meaning and
  the fixed IDE layout is untouched.
- The JSON parser is intentionally JSON-only (no comments, no trailing commas)
  and capped at 8 MiB; a larger document gets an explicit error instead of a
  partial tree.
- TODO scanning is synchronous per file on a worker thread with one result
  batch; very large repositories finish in one pass and can be cancelled, but
  do not stream partial rows.

## Alternatives

- **New standalone `panel-json` / `panel-todo` crates plus app menu entries.**
  Rejected for this slice: more wiring, a new top-level panel for tools the IDE
  already hosts, and no shared preview/Esc behaviour.
- **`serde_json::Value` with `arbitrary_precision`.** Rejected: enabling the
  feature on the shared dependency changes number storage for every consumer,
  while the viewer only needs the raw literal plus a tree.
- **Port the IDE tools into `zeta-main` or `zetawork-gui`.** Rejected: the
  product surface is the terminal IDE; `zetawork-gui` is retired and `zeta-main`
  is the nested-terminal workbench, not the editor.
- **A new ripgrep-style scan framework.** Rejected: `termide-walk` and the
  file-manager search worker already encode ignore rules, cancellation and
  binary/size handling.

## Links

- `document/roadmap.md` (P1 batches 2 and 4)
- `termide/crates/panel-ide/src/json_view.rs`
- `termide/crates/panel-ide/src/todo.rs`
- `termide/crates/panel-ide/src/lib.rs` (preview slot, history filter sync)
- `termide/crates/panel-git-diff/src/lib.rs` (`new_for_commit_file`)
- `termide/crates/panel-git-log/src/actions.rs` (per-file diff event)
- `termide/crates/walk/src/lib.rs`, `termide/crates/core/src/util.rs`
