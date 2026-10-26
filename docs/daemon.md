# Background daemon (`zetacode daemon`)

`zetacode daemon` manages a **background** backend. It does not redefine
[`zetacode serve`](./cli-reference.md#subcommands): `serve` is still the
foreground process that owns its ports, prints its URLs, and exits on Ctrl+C.
The daemon simply spawns that same `zetacode serve` command detached, keeps a
record of the pid and ports, and appends its output to a log.

```sh
zetacode daemon status [--json]
zetacode daemon start [--web-port 43141] [--stats-port 43147] [--gateway-port 43143]
zetacode daemon stop [--timeout <seconds>]
zetacode daemon restart
zetacode daemon logs [--lines 80] [--follow]
zetacode daemon install-autostart
zetacode daemon uninstall-autostart
```

`zetacode` with no arguments follows `backend.enabled` (see
[Backend mode](#backend-mode)); attaching is otherwise a separate surface.
`start` accepts the same exposure flags as `serve` (`--host`, `--tls`,
`--tls-cert`, `--tls-key`, `--allow-plain-http`, `--channels`), and the same
refusals apply: a non-loopback bind still needs `remote.token` and TLS (or an
explicit plaintext opt-in).

## Backend mode

`backend.enabled` (default `false`) is the machine-wide switch. It is a
**global-only** setting (`~/.zeta/agent/config.yml`); a project config cannot
enable a background service.

- **Off** — every bare `zetacode` launch is a local process. Nothing is
  auto-started, probed, or attached.
- **On** — a bare `zetacode` becomes a client of the one default backend. If
  the backend is not running, startup fails with a diagnostic instead of
  silently opening a local session.
- **`--standalone`** — force a local process even while the switch is on. It
  never registers or listens, and may coexist with the backend.
- Explicit `--attach`, `--attach-session`, `--attach-new`, `--backend`, and
  `--backend-url` still select backend mode on their own; the switch governs
  the default, not an explicit request.

```sh
zetacode backend status [--json]
zetacode backend on [--workspace <dir>]
zetacode backend off [--timeout <seconds>] [--force]
zetacode backend logs
```

| Action | Behaviour |
| --- | --- |
| `on` | Sets `backend.enabled=true`, records `backend.workspace` (default: the stable `~/.zeta/workspace`), and starts the hidden detached backend there. Idempotent: an already-running backend is reported, not duplicated. Refuses when more than one live backend is registered. |
| `off` | Sets `backend.enabled=false` immediately. New clients become local; running turns are allowed to finish (drained) before the backend is stopped. `--timeout` bounds the wait; `--force` stops immediately. After the backend stops, attach replicas under `<config root>/backend` are imported into normal resume history, so a standalone `zetacode --resume` can reopen the full backend conversation. `backend on` during a drain cancels the drain and leaves the backend running. |
| `status` | Prints the switch, default workspace, backend pid/URLs, and running-session count. `--json` is machine-readable. |
| `logs` | Prints the tail of the same daemon log. |

The backend runs detached, so closing the terminal that launched it does not
stop it. Only one backend is expected; a second live registration is an error
to clean up, not a candidate for automatic selection. `daemon start` remains a
low-level explicit command; `backend on` is the normal switch.

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
	"port": 43141,
	"webPort": 43141,
	"statsPort": 43147,
	"gatewayPort": 43143,
	"webUrl": "http://127.0.0.1:43141",
	"statsUrl": "http://127.0.0.1:43147",
	"gatewayUrl": "http://127.0.0.1:43143",
	"startedAt": "2026-10-21T09:12:00.000Z",
	"cliVersion": "1.4.0",
	"source": "daemon",
	"statePath": "/home/me/.zeta/run/daemon.json",
	"lockPath": "/home/me/.zeta/run/daemon.lock",
	"logPath": "/home/me/.zeta/run/daemon.log",
	"autostart": {
		"platform": "linux",
		"supported": true,
		"installed": true,
		"enabled": true,
		"active": false,
		"path": "/home/me/.config/systemd/user/zetacode-daemon.timer",
		"setting": true,
		"installForm": "bundled"
	}
}
```

`source` is `daemon` (our record), `instance-lock` (record lost but the lock is
live), or `serve-registry` (a foreground `serve` or an OS-supervised backend).
For a stopped backend, `running` is `false`; `stale: true` means a dead pid's
records are still on disk and `stop` will remove them. `port` is the web port.

`autostart.installed`, `autostart.enabled` and `autostart.active` come from the
OS (`systemctl --user show` / `Get-ScheduledTask`), never from `daemon.json` or
`serve.json`: our pid file cannot know that the user disabled the timer or
ended the task. `setting` is the global `backend.autostart` value, and
`installForm` is `bundled` or `npm`.

## Autostart

Autostart is a real per-user OS component, installed only by the bundled app.
The npm/source form (a script or `node_modules` shim, i.e. `PI_COMPILED` is not
`true`) is refused: `install-autostart` writes **no** unit, task, registry
entry, or setting, and exits non-zero with a message naming the bundled app as
the only supported form. `detectInstallForm()` in
`packages/coding-agent/src/autostart/install-form.ts` is the single decision;
`daemon status`, the refusal and the docs all use it.

### The setting

`backend.autostart` (default `false`) is the decision “start the backend with
the system”. It lives in the **global user config only**
(`~/.zeta/agent/config.yml`); a project `.zeta/config.yml` or a `--config`
overlay is deliberately ignored, so checking out a repository cannot make the
machine start a service. `backend.enabled` must also be true: autostart is
inert while backend mode is off. It is also the checkbox **Start Backend at Login**
in the desktop app's settings surface (`PUT /api/settings` with path
`backend.autostart`), which writes the same file — there is no GUI-only state.

The setting alone installs nothing. `install-autostart` is the explicit
command; it writes the component and sets the setting to `true`.
`uninstall-autostart` disables/removes the component and sets it to `false`.
The installed component consults the setting at start-up:

- Linux: `ExecCondition=… daemon autostart-enabled` (exit 0 only when both
  global values are true).
- Windows: the task runs `serve --autostart`, which exits quietly when either
  global value is false.

So editing the config to `false` disables the OS-triggered start without
removing the component. Pointing the setting at `true` does not resurrect a
component the OS has disabled: `daemon start` never calls `enable`, `schtasks
/Change`, or any installer, and the units/task are created with
`Restart=no` / no restart-on-failure, so nothing respawns itself.

### Linux: systemd user service + timer

`install-autostart` writes two files under
`$XDG_CONFIG_HOME/systemd/user` (default `~/.config/systemd/user`):

- `zetacode-daemon.service` — `Type=exec`, runs `zetacode serve --no-browser …`
  in the foreground, `Restart=no`, `KillMode=control-group`;
- `zetacode-daemon.timer` — `OnBootSec=3min` **and** `OnStartupSec=3min`, so
  the backend starts three minutes after boot or login.

Both names are visible in `systemctl --user list-timers` /
`systemctl --user status zetacode-daemon.service`. Installation runs
`systemctl --user daemon-reload` and
`systemctl --user enable --now zetacode-daemon.timer`.

**Lingering:** a user manager normally exists only while the user is logged in.
Starting the backend at boot, before login, additionally needs
`loginctl enable-linger $USER` (a privileged, one-time change). Without it the
timer fires three minutes after login.

Disable or force-stop from the OS (this also wins over the config; `daemon
start` will not re-enable it):

```sh
systemctl --user disable --now zetacode-daemon.timer
systemctl --user stop zetacode-daemon.service   # force-stop the running backend
systemctl --user status zetacode-daemon.service
```

`uninstall-autostart` runs `disable --now`, stops the service, deletes both
files, and reloads systemd.

### Windows: Task Scheduler

`install-autostart` writes a task definition to
`%LOCALAPPDATA%\Zeta\autostart\zetacode-backend.xml` and registers it through
the Task Scheduler API (`Register-ScheduledTask -Xml … -Force`), which creates
a task that runs as the current user without elevation. `schtasks /Create
/SC ONLOGON` is deliberately not used: that form demands an elevated shell.
The task:

- is registered for the current user (`InteractiveToken`,
  `RunLevel=LeastPrivilege`) with **no elevation requirement** and no stored
  password;
- has a logon trigger with `<Delay>PT3M</Delay>` — three minutes after sign-in;
- appears in Task Scheduler as **Zeta Backend Autostart** and is controllable
  there (Run, End, Disable, Delete).

Force-stop / disable from the OS:

```bat
schtasks /End /TN "Zeta Backend Autostart"
schtasks /Change /TN "Zeta Backend Autostart" /DISABLE
schtasks /Delete /TN "Zeta Backend Autostart" /F
```

`uninstall-autostart` deletes the task and removes the XML. Task Scheduler
owns the `serve` process, so ending the task releases the ports; the normal
`serve` shutdown path (SIGTERM/SIGINT, and `daemon stop`) also reaps the
Web UI child and every gateway PTY before exiting.

### macOS

Reported as unsupported. Run `zetacode daemon start` at login or add a launchd
agent yourself.

## The desktop app

`zetawork` (the egui desktop shell) owns the backend instead of hoping one is
running, but it honors the same product switch as the CLI. On launch it asks
this command surface, on a worker thread:

1. `zetacode backend status --json` — when `backend.enabled` is false (the
   default) the shell starts nothing and every `zetacode` tab is local;
2. when enabled and a backend is live (whatever its `source`), it connects to
   it as-is; nothing is started beside it;
3. when enabled with no live backend, `zetacode backend on` starts the daemon
   in `backend.workspace` (or the stable default workspace), and the shell
   waits for the record (up to 20 s).

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
made, the tab reports the failure instead of starting a second local session;
attach is a contract, not a best-effort redirect.

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
| `false` (default) | `zetacode backend off` (drain, detached) | left alone |
| `true` | left running | left alone |

The stop is spawned detached, so closing the app never waits for the daemon to
exit.
