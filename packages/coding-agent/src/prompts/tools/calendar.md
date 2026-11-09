Manage this project's calendar: a file-backed event store under `.zeta/calendar/events/` in the session working directory. Event files are an implementation detail; always act through this tool, which derives the directory itself and never accepts a path.

Actions:
- `list` — return events sorted by start. Optional `from`/`to` bound the range (both inclusive; a bare `YYYY-MM-DD` bound covers that whole day). Optional `project` filters by the event's project label, and `limit` caps the result count.
- `get` — return one event by `id`.
- `create` — add an event. Requires `title` and `start`; accepts `end`, `allDay`, `location`, `notes`, `tags`, and `project`. `allDay` defaults to whether `start` is a bare date.
- `update` — patch one event by `id`. Only supplied fields change; `end`, `location`, `notes`, and `project` are cleared with an empty string, `tags` with an empty array.
- `delete` — remove one event by `id`.

Dates must be ISO-8601: `YYYY-MM-DD` or a zoned date-time (`YYYY-MM-DDTHH:mm[:ss][.fff]Z` or with a `±HH:MM` offset). Local times without a zone are rejected. When `end` is present it must be strictly later than `start`.

All stored events carry `id`, `title`, `start`, `end?`, `allDay`, `location?`, `notes?`, `tags?`, `project?`, `createdAt`, and `updatedAt`. `id` is stable for the event's lifetime, so use the returned id for later `get`/`update`/`delete` calls. Events in a different project directory are invisible to this tool.
