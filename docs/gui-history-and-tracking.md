# GUI history and tracking pages

> **Status (2026-11-06).** This page documents the paused Rust GUI
> (`main/crates/zetawork-gui`), which does not ship. The desktop surface is
> **Work Studio** in the browser (`zetacode serve`); see
> [`desktop-app.md`](./desktop-app.md).


Two right-column pages now read data the web UI used to own. Both are inside
`main/crates/zetawork-gui/src/`; neither adds a second store, a cache of
invented data, or a new endpoint.

## 历史 — the full conversation list

`history.rs` renders every gateway conversation, newest first. The data is the
same `GET /api/sessions` snapshot the left column already keeps
(`sessions::SessionCache`) — the page filters it, so opening 历史 never starts
a request of its own, and the tree and the history list cannot disagree about
which sessions exist.

- **Search** is case-insensitive and whitespace-splits the query. Every token
  must appear in the title, the session id or the cwd, so `zeta parser` finds a
  "Fix the parser" session under `/work/zeta`, and a pasted id finds its row
  even when the title is empty.
- **Order** is the gateway's own newest-first order, unchanged by the filter.
  Rows are grouped under 今天 / 昨天 / `YYYY-MM-DD` headings; a session whose
  timestamp did not parse gets one unlabelled group rather than an invented
  date.
- **Pins** are marked (` · 已置顶`) but do not move a row: a history whose dates
  lie is not a history. Pins reorder 会话管理, where they are managed.
- Clicking a row opens the conversation in the centre's Agent page.
- The refresh button marks the snapshot stale, so the next frame re-reads it.

The gateway's per-session HTML export (`/api/sessions/<id>/export`) remains the
web-only transcript view; this page is the catalogue, not a transcript.

## 跟踪 — the project's tracking documents

`tracking.rs` reads `<workspace>/.zeta/tracking/`, the directory the
`tracking_update` tool maintains (`docs/zeta-tracking.md`). It reads the files
directly — they are the source of truth, and the gateway only reads them too —
so the page works with the backend stopped and never diverges from what the
agent wrote.

| Sub-tab | Files |
| --- | --- |
| 概览 | `INDEX.md` |
| 状态 | `status.json` |
| 计划 | `plans/*.md`, newest first |
| 摘要 | `summaries/*.md`, newest first |
| 会话 | `sessions/*.md`, newest first |

`status.json` is parsed by `parse_status`: the top level must be an object, and
a field of the wrong type falls back to its default instead of blanking the
page. The 状态 tab shows phase, progress, the current todo stage, the last
update and session, blockers, decisions, and the v2 `phases` mirror.

Markdown is not rendered as HTML. `markdown_rows` maps each line to a heading,
a list row, a code fence or body text — the four things a 324 pt column can
actually show — and emphasis/links keep their markers rather than being guessed
at.

The directory is re-read at most once a second while the page is visible. A
workspace that never enabled tracking shows one sentence naming the path; that
is a normal state, not an error.

## Where the data comes from

```
GET /api/sessions                     → 历史 (and the left column, 会话管理)
<workspace>/.zeta/tracking/*.md|json  → 跟踪
```

Nothing in these pages writes: 历史 is a view of a list another surface owns,
and 跟踪 mirrors files the agent's tool owns. Archive, restore and pin live in
[会话管理](gui-sessions-and-worktrees.md).

## History utilities (Studio Host)

The Work Studio history page reads and mutates the same native session store
through registered Host operations; nothing here creates a second index or a
second archive:

- `session.titles.inspect` projects saved titles/cards from the session file
  without opening or migrating it (`SessionManager.peekSessionTitle`).
- `session.lease.read|inspect` reports which listed transcripts are held by a
  live writer. Targets outside the live conversation's session directory are
  reported `unknown`, never guessed free.
- `session.portability.pack|anonymize` write a `.tar` (restorable) or `.zip`
  (anonymous diagnostics) into the session artifact store; `prepare` inspects
  an imported `.tar` (id/title/messages/artifacts/blobs/conflicts), `import`
  lands it through native `unpackSession` with `preserveExisting` so an
  existing local copy becomes a fork, and `moved` only records the operator's
  explicit hand-off note.
- `maintenance.compression.scan|apply` use the native GC collector and the
  same idle/lease checks; `apply` reruns the collector with the reviewed
  candidate set, so an idle transcript that changed in between is not
  compressed. `maintenance.compression.status` reports the last run; the auto
  status reads the redacted maintenance log.
- `archive.sessions.list|recaps.list|prompts.search|session.inspect` read the
  existing native archive/recap data; inspection returns path-free metadata.

Every call requires a live authenticated conversation view whose selection
still names the exact resident session, and the same view is rechecked after
each await. Imports resolve the destination workspace through the existing
projects registry, never through a renderer path. The transfer size limit is
the native session-artifact bound (28 MiB); the pane states that limit rather
than upstream's 64 MiB.

Transfer operations capture their initiating view for the entire call. Another
window's status read cannot substitute its authority. Import reviews expire
after five minutes and belong to the context that prepared them. Secondary
transcript targets and destination workspaces also obey the device binding;
a credential bound to one session cannot import a new session outside its grant.
