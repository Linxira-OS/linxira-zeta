Manage this PM's one persistent Secretary.

- `spawn`: create the Secretary and run its first turn with `prompt`. If this PM already has one, the existing Secretary is returned instead of creating a duplicate.
- `send`: continue the existing Secretary with `message`. It keeps its conversation and returns its report.
- `list`: return the durable Secretary record (agent id, owner PM, session file, state) without creating or reviving anything.

The Secretary is a PM-owned persistent subagent with `read`, optional `todo`, `calendar`, `board`, and read-only `room_read`. It has no folder, repository, branch, seat in the Team root, or external channel; it cannot edit code, run commands, spawn agents, or send channel messages. The Team database owns the durable reference, so a resumed PM can find the same Secretary.

Spawning is idempotent per PM. Never invent a Secretary id, session, or report; use the returned record.
