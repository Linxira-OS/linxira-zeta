# super_memory

> Inspect and curate the taste layer's preference store: query what is known, record a preference the user just stated, resolve a conflict, forget one, or read totals.

## Source

- Entry: `packages/coding-agent/src/tools/super-memory.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/super-memory.md`
- Store: `packages/coding-agent/src/taste/store.ts` (`taste.md` + `state.json`)
- Scoring: `packages/coding-agent/src/taste/score.ts`
- Extraction (the other writer): `packages/coding-agent/src/taste/extract.ts`

## Registration / Visibility

- `loadMode = "discoverable"`, so the tool is not top-level by default; the model reaches it through `xd://ast_edit`-style discovery or an explicit `super_memory` in its tool list.
- `approval = "read"`: `record` only queues a candidate, and `forget`/`resolve` change host-owned state rather than files in your working tree.
- Registered only when `memory.backend` is not `off` and `taste.enabled = true` (`SuperMemoryTool.createIf`). With the layer off the tool does not exist, even on a running backend.
- Enabled top-level sessions include `super_memory` through the settings-gated built-in reconcile; subagents get it only when their tool list names it.

## Inputs

| Field          | Type                                                             | Required | Description                                                                                                   |
| -------------- | ---------------------------------------------------------------- | -------: | ------------------------------------------------------------------------------------------------------------- |
| `action`       | `"record" \| "query" \| "resolve" \| "forget" \| "stats"`        |      Yes | What to do.                                                                                                   |
| `statement`    | `string`                                                         | record/forget | The preference, as a sentence starting with `Prefers` or `Avoids`. `forget` accepts it as an alternative to `topicKey`. |
| `category`     | `"cli" \| "typescript" \| "architecture" \| "style" \| "workflow" \| "other"` | record | Area the preference belongs to. |
| `polarity`     | `"prefer" \| "avoid"`                                            |       No | Defaults to `prefer`.                                                                                         |
| `evidenceText` | `string`                                                         | record   | The user's own words. Must be a verbatim substring of the latest user message, or the call fails.             |
| `query`        | `string`                                                         |       No | Case-insensitive filter over statement and category for `query`.                                              |
| `limit`        | `number`                                                         |       No | Maximum rows for `query`, clamped to 1–50; default 20.                                                       |
| `topicKey`     | `string`                                                         | resolve  | Stable topic id of the conflicted entry, as reported by `query` (`details.rows[].topicKey`).                  |
| `keep`         | `"prefer" \| "avoid"`                                            | resolve  | Which side of the conflict survives; the other stays stored but unresolved entries stop blocking injection.    |

## Outputs

- `record`: `content[0].text = "Queued preference candidate: <statement>"`, `details = { queued: true, scope: "agents" | "projects" | "global" }`. Nothing is stored yet — consolidation applies it.
- `query`: one bullet per row, `- [<category>/<polarity>] <statement>. Confidence: <p> (mentions <n>, last used <YYYY-MM-DD>[, unresolved conflict])`, plus `details.rows` with `topicKey`, `confidence`, `mentions`, `lastUsed`, and `conflict`.
- `resolve`: `"Resolved conflict on <topicKey> in favour of <keep>."`
- `forget`: `"Forgot <n> entr{y|ies}; the retraction stays visible for 30 days."`, `details = { forgotten }`.
- `stats`: entity counts per category, unresolved conflicts, and retractions on record, as text and as `details = { entries, byCategory, unresolved, tombstones }`.

## Semantics

- `record` can never raise a preference's confidence: it adds one candidate and one evidence strand, exactly like an extraction. Confidence moves only in consolidation, from the Beta posterior.
- An empty or non-verbatim `evidenceText` is rejected before anything is written. Hosts that cannot supply the latest user message skip that check (`getLastUserPromptText` is optional), but the settings that made the tool available always gate it.
- `forget` and `resolve` are user decisions, so they write immediately under the consolidation lock and ask the host to rebuild the base system prompt; the next prompt reflects the change without waiting for a scheduler tick.
- `forget` matches by `topicKey` (derived from the statement when only a statement is given) and retires *every* polarity of that topic on the writable scope. The entries disappear from `taste.md`; their tombstones are what the prompt shows under `## Retracted`.
- `resolve` only clears the conflict flags on the scope's entries after checking that the kept polarity exists, so a typo fails instead of silently unblocking the other side.
- Reads span the caller's whole scope chain, narrowest first; a topic claimed by a narrower scope shadows the same topic in a broader one.
- Writing always targets the narrowest writable scope (`agents/<bank>/<id>` for a subagent, otherwise the project or global store per `taste.scoping`).
