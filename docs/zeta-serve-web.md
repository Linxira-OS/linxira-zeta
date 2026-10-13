# `zetacode serve` and `zetacode web` Commands

CLI commands for one-click startup of the Stats Dashboard and Web UI, backed by
ZetaServer's unified reverse proxy.

## `zetacode serve`

Start both the Stats Dashboard and Web UI simultaneously.

```bash
zetacode serve
```

### Flags

| Flag | Short | Default | Description |
|---|---|---|---|
| `--stats-port` | `-s` | `3847` | Port for the Stats Dashboard |
| `--web-port` | `-w` | `30141` | Port for the Web UI |
| `--no-browser` | — | `false` | Don't open browser automatically |
| `--stats-only` | — | `false` | Start only Stats Dashboard |
| `--web-only` | — | `false` | Start only Web UI |

### Examples

```bash
# Default: both services on standard ports
zetacode serve

# Custom ports
zetacode serve --stats-port 9000 --web-port 8080

# Stats only
zetacode serve --stats-only

# Don't open browser
zetacode serve --no-browser
```

## `zetacode web`

Start only the Web UI. Equivalent to `zetacode serve --web-only`.

```bash
zetacode web
```

### Flags

| Flag | Short | Default | Description |
|---|---|---|---|
| `--port` | `-p` | `30141` | Port for the Web UI |
| `--no-browser` | — | `false` | Don't open browser automatically |

### Examples

```bash
# Default port
zetacode web

# Custom port
zetacode web --port 8080
```

## Programmatic Equivalent

```typescript
import { startZetaServer } from "@linxiraos/zeta/server/zeta-server";

// Equivalent to: zetacode serve
await startZetaServer();

// Equivalent to: zetacode web
await startZetaServer({ webOnly: true });

// Equivalent to: zetacode serve --stats-only
await startZetaServer({ statsOnly: true });
```

## Architecture

Both commands use `ZetaServer` under the hood. The server:

1. Starts the Stats Dashboard on port 3847
2. Starts the Web UI (Next.js) on a random internal port
3. Starts a `Bun.serve` proxy on port 30141 that routes:
   - `/api/stats/*` → Stats Dashboard
   - Everything else → Web UI
4. Optionally opens the browser to the unified URL

See [zeta-server.md](./zeta-server.md) for the full server architecture.

## Instance discovery and reuse (multi-surface coexistence)

A machine can host the same backend from several surfaces (the desktop shell, a
terminal `zetacode serve`, `zeta-d`). They must not fight over `30141`/`30142`,
so a starting instance **discovers** a healthy one before it binds:

- **Registration file** — a running `zetacode serve` publishes itself to
  `<config root>/serve.json` (`~/.zeta/serve.json`; `ZETA_SERVE_REGISTRY`
  overrides the path). It holds `{ pid, webUrl, statsUrl, gatewayUrl, version,
  startedAt, cwd }` and is written owner-only (`0600`) after the port is bound,
  replaced atomically, and removed on a clean shutdown. A registration whose
  `pid` is gone is stale: the next start deletes it (and says so) instead of
  trusting it. A stats-only instance (`--stats-only`) publishes nothing, because
  it serves no identity endpoint and could never be confirmed.
- **Identity probe** — `GET /api/server/identity` reports
  `{ app: "zeta", version, pid, startedAt, webUrl, statsUrl, gatewayUrl }` from
  the serving process, so a newcomer can tell *whose* port it is and *which
  version* answers there. It rides the existing gateway access gate: a
  non-loopback caller still needs `remote.token`.
- **Same version + healthy** — the newcomer does not start a second listener.
  `zetacode serve` prints the running instance's URLs and exits `0` (force a
  separate instance with explicit ports, e.g. `--web-port 30241
  --gateway-port 30242`); the desktop shell points its window at the running
  instance and spawns nothing. The desktop also survives a broken launcher
  resolution in that case, because discovery needs no binary.
- **Different version** — the port is *not* taken over silently. `zetacode
  serve` prints the running and expected versions with the options (stop the old
  instance, or start on other ports) and exits `1`; the desktop shell shows the
  same choice instead of failing later with a bind error.
- **Another port** — an instance that answers somewhere else is reported and the
  requested listener still starts (`zetacode serve` never second-guesses an
  explicit `--web-port`). The desktop shell reuses such an instance too: it
  reads the runtime URLs from discovery and points its window, stats window and
  gateway calls at them.

## Desktop entry: `zeta-d` and `--desktop`

Command resolution contract — the two installs never collide on PATH:

| Command | Owner | Behavior |
|---|---|---|
| `zetacode` | npm/source install | Always the CLI/TUI; never the desktop bundle. |
| `zeta-d` | Desktop install only | No args → the bundled CLI/TUI. |
| `zeta-d -d [cwd]` | Desktop install only | Opens the desktop GUI at `cwd` (default: current directory). |
| `zetacode --desktop [cwd]` | npm/source install | Probes for a desktop install and opens its GUI; exits 1 listing probed paths when none is found. |

Mechanics:

- The desktop package ships a two-line shim (`resources/bin/zeta-d`, `.cmd` on Windows) that sets `ZETA_DESKTOP_ENTRY=1` and re-enters the bundled zetacode binary. The NSIS installer adds `resources\bin` to the user PATH (`build/installer.nsh` + `add-to-path.ps1`); the Linux installer symlinks `~/.local/bin/zeta-d`.
- Dispatch lives in `src/cli/desktop-entry.ts` (`dispatchDesktopEntry`), runs before profile bootstrap in `runCli`. In entry mode it resolves the GUI relative to the running binary (`<install>/resources/zeta` → `<install>` root; the staging folder keeps its literal `zeta` name — desktop-entry.ts treats that basename as the bundled-runtime marker); otherwise it probes `%LOCALAPPDATA%\Programs\Zeta`, `/opt/zeta-desktop`, `~/.local/lib/zeta-desktop`, and the macOS app locations. The GUI receives `--cwd=<dir>` and starts its service in that workspace.
- The bundled binary refuses standalone self-updates (`isDesktopBundledRuntime()` guard in `update-cli.ts`) — desktop installs update through the desktop updater, which replaces the whole bundle atomically.

## Native directory picker

Inside the desktop shell the embedded Web UI exposes `window.piDesktop.selectDirectory(startPath?)` (preload bridge in `desktop/src/preload.ts`, IPC handler `pi:select-directory`). The directory pickers show a **Browse…** button that opens the OS dialog when this bridge exists; in a plain browser they fall back to manual path entry (and the File System Access API where available). `GET /api/desktop/info` reports `{ desktop: boolean }` so renderer code can distinguish the embedded shell from remote browsers.