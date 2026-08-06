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
import { startZetaServer } from "@zeta/pi-coding-agent/server/zeta-server";

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