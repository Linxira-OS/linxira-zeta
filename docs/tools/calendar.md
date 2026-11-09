# calendar

> Real, file-backed calendar events for the current project — list, inspect, create, update, and delete.

## Status

**IMPLEMENTED on `main` (PR #261); not yet in a tagged release.** The built-in
tool writes `.zeta/calendar/events/<id>.json` in the session's project and has
no path/cwd input, so projects stay isolated. Top-level sessions receive it by
default; a subagent receives it only with an explicit `calendar` grant.

There is **no Work Studio calendar UI**: the Studio Team prototype
(`web-app/src/studio/team/TeamPage.tsx`) has a fixture-only Calendar view, and
the gateway exposes no calendar route. The tool is the supported surface; see
the sibling [`board`](./board.md) tool for the other project-scoped built-in
with a gateway/panel surface.

## Source

- Entry: `packages/coding-agent/src/tools/calendar.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/calendar.md`
- Registration: `packages/coding-agent/src/tools/index.ts` (`BUILTIN_TOOLS.calendar`), `packages/coding-agent/src/tools/builtin-names.ts`

## Storage

Events are one JSON file each under `<project>/.zeta/calendar/events/<id>.json`, where `<project>` is the session working directory. The tool derives the directory itself; no action accepts a path or a different cwd, so one project can never read or mutate another project's events.

Each event file holds exactly:

| Field       | Type       | Notes                                                    |
| ----------- | ---------- | -------------------------------------------------------- |
| `id`        | `string`   | Stable for the event's lifetime (UUID).                  |
| `title`     | `string`   | Non-empty.                                               |
| `start`     | `string`   | ISO-8601 instant.                                        |
| `end`       | `string?`  | ISO-8601 instant, strictly after `start`.                |
| `allDay`    | `boolean`  | Defaults to whether `start` is a bare date on create.    |
| `location`  | `string?`  | Free-form.                                               |
| `notes`     | `string?`  | Free-form.                                               |
| `tags`      | `string[]?`| Deduplicated, empty tags dropped.                        |
| `project`   | `string?`  | Project label; also a `list` filter.                     |
| `createdAt` | `string`   | ISO timestamp of creation.                               |
| `updatedAt` | `string`   | ISO timestamp of the last mutation.                      |

Writes stage a sibling temp file and publish it with a single rename (`replaceFileAtomically`); `update` and `delete` hold an OS-backed file lease on the events directory for their read-modify-write. A corrupt event file is reported instead of being silently dropped from a `get`.

## Actions

| Action   | Required        | Optional                                                          |
| -------- | --------------- | ----------------------------------------------------------------- |
| `list`   | —               | `from`, `to`, `project`, `limit`                                  |
| `get`    | `id`            | —                                                                 |
| `create` | `title`, `start`| `end`, `allDay`, `location`, `notes`, `tags`, `project`           |
| `update` | `id`            | `title`, `start`, `end`, `allDay`, `location`, `notes`, `tags`, `project` |
| `delete` | `id`            | —                                                                 |

`list` returns events sorted by start instant. `from`/`to` are inclusive; a bare `YYYY-MM-DD` bound covers that whole day. An event matches when its interval (`end` or `start`) overlaps the requested range. `update` patches only supplied fields; `end`/`location`/`notes`/`project` are cleared with `""` and `tags` with `[]`.

## Validation

- `start` and `end` accept `YYYY-MM-DD` or a zoned date-time (`YYYY-MM-DDTHH:mm[:ss][.fff]Z` or `±HH:MM`). A local time without a zone is rejected.
- Component ranges are checked explicitly, so impossible dates such as `2026-02-30` are rejected rather than rolled over.
- When both are present, `start` must be strictly earlier than `end`; an inverted `list` range errors.
- Event ids must match `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`, so an id can never escape the events directory.

## Availability

Registered as a built-in and present in every top-level session's default toolset. A subagent receives it only when its profile `tools:` list names `calendar` explicitly; it is never added to subagent tools implicitly, and no IM/channel tool surface is involved. The tool is read-approved because it only touches the project's internal `.zeta` store.
