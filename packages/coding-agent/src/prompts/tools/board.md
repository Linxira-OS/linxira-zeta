The user's project board lives in `<project>/.zeta/board/` as one Markdown card per
file. It outlives a session and is shared with the user's board UI, so treat
every change as user-visible project state, not scratch notes.

<instruction>
- Use `board` when the user asks what is on the board, to add or edit a card, or
  to move/assign one. Do not duplicate cards that already exist; `list` first.
- The board is project-scoped to this session's project root. No `cwd` or path
  parameter exists — never guess one.
- `create` derives the card id from the title; use the returned id in later
  calls. `update` never changes the id.
- Use action `move` to change a card's column, and action `assign` to change its
  owner. `update` covers title, description and tags.
- Card fields are the store's: `column` is the status (`todo` | `doing` |
  `done`), `body` is the description/brief, `assignee` is the owner (`user` |
  `agent`). `description`, `status` and `owner` are accepted aliases. There is
  no priority field. `due` is `YYYY-MM-DD`; an empty string clears it.
- `delete` removes the card file. Only delete when the user asked for it.
</instruction>

<contract>
- NEVER accept or supply a filesystem path for the board; the session root is
  the only project.
- Values MUST survive the card format: a title is one line, at most 20 tags,
  and a description at most 64 KiB.
- Errors are real: an unknown id, a bad column, an invalid date or a card file
  that will not parse MUST surface as an error, never as a fabricated card.
</contract>
