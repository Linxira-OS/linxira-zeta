Run a shell command on a configured remote host over SSH and return its output.

Use this when the user asks to inspect, diagnose, or act on a remote machine that
is already configured via `/ssh add` (for example: checking a service, reading a
log tail, restarting a process, or recovering a workspace on that host).

- `host` is the connection NAME from `/ssh add` / `/ssh list` (project scope wins
  over user scope). It is not an `user@host` string.
- `command` runs through the host's default POSIX login shell; keep it
  non-interactive (no commands that wait for keyboard input) and self-contained.
- Output is capped; prefer narrow commands (`journalctl -u x -n 100`, `tail -n 50`)
  over dumping whole files.
- The command executes with the configured account's permissions on that host.
  Destructive commands (rm -rf, service stop, config rewrites) require explicit
  user intent — confirm scope before running them.
