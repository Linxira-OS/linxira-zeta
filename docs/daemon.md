# Background daemon (`zetacode daemon`)

`zetacode daemon` manages a **background** backend. It does not redefine
[`zetacode serve`](./cli-reference.md#subcommands): `serve` is still the
foreground process that owns its ports, prints its URLs, and exits on Ctrl+C.
The daemon simply spawns that same `zetacode serve` command detached, keeps a
record of the pid and ports, and appends its output to a log.

```sh
zetacode daemon status [--json]
zetacode daemon start [--web-port 30141] [--stats-port 3847] [--gateway-port 30142]
zetacode daemon stop [--timeout <seconds>]
zetacode daemon restart
zetacode daemon logs [--lines 80] [--follow]
zetacode daemon install-autostart
zetacode daemon uninstall-autostart
```

`zetacode` with no arguments is unchanged; attaching is a separate surface.
`start` accepts the same exposure flags as `serve` (`--host`, `--tls`,
`--tls-cert`, `--tls-key`, `--allow-plain-http`, `--channels`), and the same
refusals apply: a non-loopback bind still needs `remote.token` and TLS (or an
explicit plaintext opt-in).

## Lifecycle

| Action | Behaviour |
| --- | --- |
| `start` | Spawns `zetacode serve --no-browser …` detached and writes the daemon record. **Idempotent:** if a backend is already running, prints its pid and port and does nothing else. |
| `stop` | Terminates the backend (graceful first, hard kill after `--timeout`, default 10s) and removes its records. A stale record (dead pid) or corrupt state file is cleaned immediately — it never waits on a pid that is gone. |
| `restart` | `stop` followed by `start`; starting when nothing runs is the same as `start`. |
| `status` | Reports the live backend (pid, ports, URLs, source) or the stale record. `--json` prints the shape below. |
| `logs` | Prints the last `--lines` lines of the daemon log; `--follow` streams new lines until Ctrl+C. |

Only one backend runs per user. `start` serialises concurrent invocations,
records the live backend in `<config root>/run/daemon.lock` (the shared
instance-lock format), and also recognises a `serve` instance registered in
`serve.json` — so it will not start a second backend beside a foreground
`zetacode serve`.

Daemon records live under `<config root>/run` (`~/.zeta/run` by default):

| File | Purpose |
| --- | --- |
| `daemon.json` | pid, ports, URLs, cwd, start time, log path. |
| `daemon.log` | Combined stdout/stderr of the detached `serve`. |
| `daemon.lock` | Live-backend pid in the shared instance-lock format. |
| `daemon.start.lock` | Short-lived mutex that serialises `daemon start`. |

## `status --json`

```json
{
	"running": true,
	"stale": false,
	"pid": 4812,
	"port": 30141,
	"webPort": 30141,
	"statsPort": 3847,
	"gatewayPort": 30142,
	"webUrl": "http://127.0.0.1:30141",
	"statsUrl": "http://127.0.0.1:3847",
	"gatewayUrl": "http://127.0.0.1:30142",
	"startedAt": "2026-10-21T09:12:00.000Z",
	"cliVersion": "1.4.0",
	"source": "daemon",
	"statePath": "/home/me/.zeta/run/daemon.json",
	"lockPath": "/home/me/.zeta/run/daemon.lock",
	"logPath": "/home/me/.zeta/run/daemon.log",
	"autostart": {
		"platform": "linux",
		"supported": true,
		"installed": false,
		"path": "/home/me/.config/systemd/user/zetacode-daemon.service"
	}
}
```

`source` is `daemon` (our record), `instance-lock` (record lost but the lock is
live), or `serve-registry` (a foreground `serve` or an autostart entry). For a
stopped backend, `running` is `false`; `stale: true` means a dead pid's records
are still on disk and `stop` will remove them. `port` is the web port.

## Autostart

`install-autostart` **installs and prints** the exact file it wrote plus the
command that removes it; nothing is installed silently.

- **Linux:** a user systemd unit at
  `$XDG_CONFIG_HOME/systemd/user/zetacode-daemon.service` (default
  `~/.config/systemd/user/…`), running `zetacode serve --no-browser …` and
  appending output to the daemon log. The command runs
  `systemctl --user daemon-reload` and
  `systemctl --user enable --now zetacode-daemon.service`. Undo:
  `systemctl --user disable --now zetacode-daemon.service`, delete the unit,
  `systemctl --user daemon-reload`.
- **Windows:** a current-user logon entry at
  `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\zetacode-daemon.cmd`.
  It starts the backend with `start "" /b` and appends output to the daemon
  log. Undo: delete that file, or run `zetacode daemon uninstall-autostart`.
- **macOS:** reported as unsupported. Run `zetacode daemon start` at login or
  add a launchd agent yourself.

`uninstall-autostart` disables the entry where the platform has a supervisor
and removes the file; it does not stop a backend that is already running — use
`zetacode daemon stop` for that.

## The desktop app

`zetawork` (the egui desktop shell) owns the backend instead of hoping one is
running. On launch it asks this command surface, on a worker thread:

1. `zetacode daemon status --json` — a live backend (whatever its `source`) is
   connected to as-is; nothing is started beside it;
2. no live backend — `zetacode daemon start` starts the daemon path described
   above, and the shell waits for the record (up to 20 s).

The state is visible: a banner across the top of the window says *starting*,
*failed* (with 重试) or *stopped*, and the same state is a row in 设置 → 常规
together with 启动 / 重启 / 停止 (that row names the running pid and `webUrl`
when the backend is ready, which needs no banner). The health check and every daemon command run
off the UI thread; a slow or missing `zetacode` never blocks a frame.

A `zetacode` tab is a **client** of the backend, not a second agent: when the
backend is reachable the gateway hosts the PTY for the workspace and runs the
shipped CLI there, which attaches to that workspace's newest backend session
(the attach client described in
[Backend attach](./cli-reference.md#backend-attach)). If the attach cannot be
made, the tab falls back to running the CLI locally and its status line says
so — the fallback is never silent.

Restarting or stopping from that settings row reconnects every attached
terminal and tab to the address the restarted daemon publishes; the
conversation list keeps its last snapshot while the backend is away, and a
backend that disappears after it was ready surfaces as a banner instead of a
frozen pane.

### Quitting

`backend.keep_on_quit` (设置 → 常规 → 退出后保留后台服务, default `false`)
decides what quitting does:

| Setting | Backend this window started | Backend already live when the window opened |
| --- | --- | --- |
| `false` (default) | `zetacode daemon stop` | left alone |
| `true` | left running | left alone |

The stop is spawned detached, so closing the app never waits for the daemon to
exit.
