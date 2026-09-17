# `zeta serve` and `zeta web` Commands

CLI commands for one-click startup of the Stats Dashboard and Web UI, backed by
ZetaServer's unified reverse proxy.

## `zeta serve`

Start both the Stats Dashboard and Web UI simultaneously.

```bash
zeta serve
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
zeta serve

# Custom ports
zeta serve --stats-port 9000 --web-port 8080

# Stats only
zeta serve --stats-only

# Don't open browser
zeta serve --no-browser
```

## `zeta web`

Start only the Web UI. Equivalent to `zeta serve --web-only`.

```bash
zeta web
```

### Flags

| Flag | Short | Default | Description |
|---|---|---|---|
| `--port` | `-p` | `30141` | Port for the Web UI |
| `--no-browser` | — | `false` | Don't open browser automatically |

### Examples

```bash
# Default port
zeta web

# Custom port
zeta web --port 8080
```

## Programmatic Equivalent

```typescript
import { startZetaServer } from "@linxiraos/zeta/server/zeta-server";

// Equivalent to: zeta serve
await startZetaServer();

// Equivalent to: zeta web
await startZetaServer({ webOnly: true });

// Equivalent to: zeta serve --stats-only
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

## Desktop entry: `zeta-d` and `--desktop`

Command resolution contract — the two installs never collide on PATH:

| Command | Owner | Behavior |
|---|---|---|
| `zeta` | npm/source install | Always the CLI/TUI; never the desktop bundle. |
| `zeta-d` | Desktop install only | No args → the bundled CLI/TUI. |
| `zeta-d -d [cwd]` | Desktop install only | Opens the desktop GUI at `cwd` (default: current directory). |
| `zeta --desktop [cwd]` | npm/source install | Probes for a desktop install and opens its GUI; exits 1 listing probed paths when none is found. |

Mechanics:

- The desktop package ships a two-line shim (`resources/bin/zeta-d`, `.cmd` on Windows) that sets `ZETA_DESKTOP_ENTRY=1` and re-enters the bundled zeta binary. The NSIS installer adds `resources\bin` to the user PATH (`build/installer.nsh` + `add-to-path.ps1`); the Linux installer symlinks `~/.local/bin/zeta-d`.
- Dispatch lives in `src/cli/desktop-entry.ts` (`dispatchDesktopEntry`), runs before profile bootstrap in `runCli`. In entry mode it resolves the GUI relative to the running binary (`<install>/resources/zeta` → `<install>` root); otherwise it probes `%LOCALAPPDATA%\Programs\Zeta`, `/opt/zeta-desktop`, `~/.local/lib/zeta-desktop`, and the macOS app locations. The GUI receives `--cwd=<dir>` and starts its service in that workspace.
- The bundled binary refuses standalone self-updates (`isDesktopBundledRuntime()` guard in `update-cli.ts`) — desktop installs update through the desktop updater, which replaces the whole bundle atomically.

## Native directory picker

Inside the desktop shell the embedded Web UI exposes `window.piDesktop.selectDirectory(startPath?)` (preload bridge in `desktop/src/preload.ts`, IPC handler `pi:select-directory`). The directory pickers show a **Browse…** button that opens the OS dialog when this bridge exists; in a plain browser they fall back to manual path entry (and the File System Access API where available). `GET /api/desktop/info` reports `{ desktop: boolean }` so renderer code can distinguish the embedded shell from remote browsers.