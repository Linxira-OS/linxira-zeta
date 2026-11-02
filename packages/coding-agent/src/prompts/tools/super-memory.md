Record a durable coding preference, or inspect the ones already stored.

A recorded preference is a candidate: it enters the store as evidence and only reaches the prompt once the host's scoring clears the confidence floor. Recording is therefore cheap and reversible — `forget` removes an entry, and a retraction stays visible for 30 days.

## Actions

| `action` | Required | Effect |
| --- | --- | --- |
| `record` | `statement`, `category`, `polarity`, `evidenceText` | Queue one preference candidate. `evidenceText` must be a verbatim substring of the user's message. |
| `query` | — | List stored preferences with their confidence, mentions and last use. `query` filters by text, `limit` caps the rows. |
| `resolve` | `topicKey`, `keep` | Resolve a recorded conflict: `keep: "prefer"` or `"avoid"` keeps that side and clears the other's conflict mark. |
| `forget` | `statement` | Delete an entry and leave a retraction. |
| `stats` | — | Counts per category, queued candidates, unresolved conflicts, retractions. |

Use `record` only for what the user actually said. A preference the user did not state is not a preference — the host rejects candidates whose evidence is not in their message.
