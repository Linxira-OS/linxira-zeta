# board

> Read and edit the user's project board under `<project>/.zeta/board/`.

## Status

**IMPLEMENTED on `main` (PR #260); not yet in a tagged release.** The built-in
tool is real and shares `board-store.ts` with the Web Gateway routes. It is
project-scoped (no `cwd`/path input), top-level sessions receive it by default,
and a subagent receives it only when its profile or spawn request names
`board`. Storage format and the GUI/TUI/IDE panels are documented in
[the user board](../board.md).

## Source
- Entry: `packages/coding-agent/src/tools/board.ts`
- Store: `packages/coding-agent/src/tools/board-store.ts` (shared with the web gateway)
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/board.md`
- HTTP routes: `packages/coding-agent/src/server/web-gateway/board.ts`

## Registration / Visibility
- Built-in tool (`BUILTIN_TOOLS.board`), not a plugin.
- Top-level sessions receive it by default. A subagent receives it only when
  its `tools:` frontmatter (or an explicit spawn `tools` request) names `board`;
  it is never inherited implicitly.
- `loadMode = "discoverable"`, so with `tools.xdev` on (the default) it is
  presented as an `xd://board` device instead of a top-level schema.
- Reads (`list`, `get`) are read-tier; every mutation (`create`, `update`,
  `move`, `assign`, `delete`) is write-tier. Calls are serialized so two card
  writes cannot interleave read-modify-write.

## Project scope
The project root is the session's root (`ToolSession.cwd`). The tool has no
`cwd`, root or path parameter and MUST NOT accept one: the model cannot point
the board at another directory. The gateway's `/api/board*` routes are separate
and keep their `cwd` query/header contract unchanged.

## Storage
One Markdown card per file; the file is the truth. Front matter carries
`title`, `column`, optional `tags`, `assignee`, optional `due`; hand-added keys
are preserved on update. Ids are file stems validated against
`^[A-Za-z0-9_-][A-Za-z0-9._-]*$` and confined to the board directory.

## Inputs

| Field | Type | Required | Description |
|---|---|---:|---|
| `action` | `"list" \| "get" \| "create" \| "update" \| "move" \| "assign" \| "delete"` | Yes | Operation. |
| `id` | `string` | For `get`/`update`/`move`/`assign`/`delete` | Card id (file stem). |
| `title` | `string` | For `create` | Card title; one line, at most 200 characters. |
| `description` / `body` | `string` | No | Card description/brief (Markdown); at most 64 KiB. |
| `column` / `status` | `"todo" \| "doing" \| "done"` | No | Card status. `create` defaults to `todo`; changing an existing card uses `move`. |
| `assignee` / `owner` | `"user" \| "agent"` | No | Card owner. `create` defaults to `user`. |
| `tags` | `string[]` | No | At most 20 tags, each at most 40 characters. |
| `due` | `string` | No | `YYYY-MM-DD`; `""` clears. |
| `tag` | `string` | No | `list` filter: cards carrying this tag. |

## Operations

### `list`
Return every card, optionally filtered by `column`/`status`, `assignee`/`owner`
and `tag`, plus warnings for `.md` files that are not usable cards.

### `get`
Return one card and its brief (title, column, tags, assignee, due, body).

### `create`
Create a card; the id is a slug of the title and is returned. A slug collision
gets a numeric suffix. Missing title is an error.

### `update`
Change `title`, `description`/`body`, `tags`, `assignee`/`owner` or `due`. The
id never changes; changing `column` here is rejected in favor of `move`.

### `move`
Rewrite the card's `column`. Unknown columns are rejected.

### `assign`
Set the owner (`user` or `agent`).

### `delete`
Remove the card file. A missing id is a `card not found` error.

## Results
Each call returns a text summary and structured `details`
(`action`, `cwd`, `message`, and `card`/`cards`/`warnings` where applicable).
Errors surface as tool errors with the store's message; no card is fabricated
for an unknown id or an unparsable file.
