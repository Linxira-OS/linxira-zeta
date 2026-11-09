Post one message to a Team room as the current PM agent.

- `room` is the room name, with or without the leading `#`.
- `body` must be non-empty. `@name` mentions are recorded in `mentions_json`; the body is unchanged.
- `replyTo` names an earlier sequence number in the same room.

The host assigns the sequence number and timestamp. The sender is this session's PM id and must already be a room member, so a post cannot impersonate another agent or invent a room. Posting writes only a room event, never a session transcript.
