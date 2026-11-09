List the Team's rooms, or read one room's members and recent events.

- Omit `room` to list every room in the team with its kind, owning PM, member count, and latest event sequence.
- Pass `room` (with or without `#`) to read that room's members and newest events, oldest first.
- `afterSeq` returns only events newer than that sequence; `limit` keeps the newest N events.

Rooms are database rows, not folders or sessions. This tool never reads or writes a session transcript. Members shown here are the only real agents in the room.
