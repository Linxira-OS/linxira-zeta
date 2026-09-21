# ssh_exec

> Run a shell command on a configured remote host over SSH and return its output. The host must already be registered through `/ssh add` (or `zeta ssh add`); the agent cannot create connections itself.

## Source
- Entry: `packages/coding-agent/src/tools/ssh-exec.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/ssh-exec.md`
- Underlying stack: `packages/coding-agent/src/ssh/` (connection-manager, config-writer)

## Registration / Visibility
- Always registered as a built-in (`ssh_exec`), but execution requires a host
  name that resolves in the SSH config scopes. Project scope (`.zeta/ssh.json`)
  wins over user scope (`~/.zeta/agent/ssh.json`) for the same name.
- Approval level `write`: the run is gated like other mutating tools.

## Inputs

| Field | Type | Required | Description |
|---|---|---:|---|
| `host` | `string` | Yes | Connection NAME from `/ssh add` / `/ssh list`. Not an `user@host` string. |
| `command` | `string` | Yes | Shell command executed through the host's default POSIX login shell. Keep it non-interactive and self-contained. |
| `timeoutMs` | `number` | No | Kill the remote command after this many milliseconds. Default 120000, clamped to 600000. |

## Outputs
- `content[0].type = "text"` — `exit code: N` plus capped `stdout` / `stderr`
  sections (20k characters each; larger output is truncated with a notice).
- `isError: true` when the exit code is non-zero, the host name does not
  resolve, the connection fails, or the command exceeds the timeout.

## Side Effects
- Executes the command on the remote host with the configured account's
  permissions. Reuses the SSH control-master connection for the host, so
  repeated calls do not re-authenticate.
- No local files are touched; output is returned to the session only.

## Notes
- Prefer narrow read commands (`tail -n 50`, `journalctl -u x -n 100`) over
  dumping whole files; output is capped.
- Destructive remote actions (`rm -rf`, service stop, config rewrites) run with
  the same tool approval as any other `write` action — the model should confirm
  intent, but the host account permissions are the real boundary.
- Long-running interactive programs are out of scope; the command is killed at
  the timeout.
