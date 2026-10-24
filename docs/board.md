# The user board (`.zeta/board/`)

The board is the **user's** long-lived task layer: three columns of cards,
one markdown file per card, under `<project>/.zeta/board/`. It is deliberately
separate from the agent's own todo list:

| Layer | Owner | Lifetime | Where |
| --- | --- | --- | --- |
| Agent todo | the agent | one session | the `todo` tool / session state |
| User board | the user | across sessions and workspaces | `<project>/.zeta/board/*.md` |

The two models are not merged. An agent may be handed a card's brief, but the
board is not the agent's task list and the agent's todo is not written to disk
by this feature.

## File format

Every card is one file named after its id (the file stem). The file is the only
source of truth: the GUI page, the TUI page, the IDE page and the gateway all
read and write these files, so a card can always be edited in a text editor.

```markdown
---
title: Fix the parser
column: doing
tags: [rust, parser]
assignee: agent
due: 2026-11-01
---

The brief an agent receives from `handoff`.
```

Rules:

- The file must open and close its front matter with a line containing only
  `---`.
- `title` is required (non-empty, folded onto one line).
- `column` is `todo`, `doing` or `done` (case-insensitive). Absent → `todo`.
- `assignee` is `user` or `agent`. Absent → `user`.
- `tags` is `[a, b]` or `a, b`; quoted items may contain spaces.
- `due` is `YYYY-MM-DD`; absent or empty → no due date.
- Unknown front-matter keys are preserved when a panel saves the card.
- Everything after the closing `---` is the body; it is what `handoff`
  returns as the brief.
- Files that do not parse (a `README.md`, a half-written file) are skipped and
  reported as warnings by the list API; they never hide the rest of the board.
- Ids are the file stems: ASCII letters, digits, `.`, `_`, `-`; they may not
  start with `.`, and they can never contain a path separator. Creating a card
  derives the id from the title (non-ASCII-only titles get a stable `card-…`
  hash) and de-duplicates with `-2`, `-3`, …
- Renaming a card's title does not rename its file: the id is stable, so links
  and history survive an edit.

## Gateway API

All routes take the project root as `?cwd=<path>` (or the `x-zeta-cwd` header,
or the process cwd). The board is `<cwd>/.zeta/board/`.

| Method | Path | Body / result |
| --- | --- | --- |
| `GET` | `/api/board` | `{ cwd, cards, warnings }` |
| `POST` | `/api/board` | `{ title, column?, tags?, assignee?, due?, body?, cwd? }` → 201 `{ cwd, card }` |
| `GET` | `/api/board/<id>` | `{ cwd, card }` |
| `PATCH` | `/api/board/<id>` | any subset of the create fields → `{ cwd, card }` |
| `POST` | `/api/board/<id>/move` | `{ column, cwd? }` → `{ cwd, card }`; rewrites the file |
| `POST` | `/api/board/<id>/handoff` | `{ assign?, cwd? }` → `{ cwd, card, brief }` |
| `DELETE` | `/api/board/<id>` | `{ ok: true, id }` |

`handoff` returns the card and the brief (title, tags, assignee, due and body)
that the caller starts an agent session from. **The handler starts no session
by itself**; session creation owns its own auth, workspace and history rules.
Passing `assign: true` records `assignee: agent` on the card.

Example:

```bash
curl -s -X POST http://127.0.0.1:43143/api/board \
  -H 'content-type: application/json' \
  -d '{"cwd":"/path/to/project","title":"Fix the parser","tags":["rust"],"due":"2026-11-01","body":"Reproduce, then fix."}'
```

```bash
curl -s -X POST http://127.0.0.1:43143/api/board/fix-the-parser/move \
  -H 'content-type: application/json' \
  -d '{"cwd":"/path/to/project","column":"doing"}'
```

Errors are the gateway's usual `{ error }` JSON: 400 for an invalid id, field
or date, 404 for a missing card, 422 `{ error: "not a card", reason }` when the
file exists but does not parse, and 500 for a filesystem failure.

## Panels

- **GUI**: right column → 看板. Three columns; click a card to edit it (title,
  column, assignee, tags, due, body), use `←`/`→` to move a card, `+` in a
  column to create one. Saves write the card's own file.
- **TUI**: `Alt+K` (or Pane → 🗂 Board). `j`/`k` select, `h`/`l` (or space)
  move the card between columns, `e` edits the title inline, `r` re-reads. The
  page re-reads at most once a second while visible.
- **IDE page**: `Ctrl+T` in the IDE page's lower-left pane shows the same
  board, grouped by column; `h`/`l` move, `Enter` opens the card file in the
  editor.

All three call the same reader/writer (`termide/crates/panel-ide/src/board.rs`
for Rust; `packages/coding-agent/src/server/web-gateway/board.ts` for the
gateway), so the formats cannot drift.
