# ZetaServer — Unified HTTP Reverse Proxy

ZetaServer is a unified HTTP reverse proxy that exposes the Stats Dashboard and
Web UI through a single port. It uses `Bun.serve` as the front-end server and
proxies requests to the appropriate internal backend.

## Architecture

```
Browser → :30141 (Bun.serve) ─┬─ /api/stats/* → Stats Dashboard (:3847)
                              └─ 其他所有请求 → Web UI Next.js (随机内部端口)
```

- **Front-end**: `Bun.serve` on port 30141 (configurable)
- **Stats Dashboard**: Internal backend on port 3847 (configurable)
- **Web UI**: Next.js server on a random internal port to avoid conflicts

## Routing

| Path prefix | Backend |
|---|---|
| `/api/stats`, `/api/sync`, `/api/request/*` | Stats Dashboard |
| Everything else | Web UI (Next.js) |

## Usage

### CLI

```bash
# Start both Stats Dashboard and Web UI
zeta serve

# Start only the Web UI
zeta web

# Custom ports
zeta serve --stats-port 3847 --web-port 30141

# Don't open browser
zeta serve --no-browser
```

### Programmatic API

```typescript
import { startZetaServer } from "@linxiraos/zeta/server/zeta-server";

const instance = await startZetaServer({
  port: 30141,
  statsPort: 3847,
  noBrowser: false,
});

console.log(instance.url);       // http://localhost:30141
console.log(instance.statsUrl);  // http://localhost:3847

// Graceful shutdown
await instance.shutdown();
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `30141` | Main server port |
| `statsPort` | `number` | `3847` | Stats Dashboard port |
| `noBrowser` | `boolean` | `false` | Don't open browser on start |
| `statsOnly` | `boolean` | `false` | Start only Stats Dashboard |
| `webOnly` | `boolean` | `false` | Start only Web UI |

## Lifecycle

1. `start()`: Starts Stats Dashboard (if needed) → starts Web UI on random port → starts Bun.serve proxy
2. `waitForWebUiReady(ms)`: Polls the Web UI health endpoint until ready (default 15s timeout)
3. `shutdown()`: Stops all servers and kills child processes

## Implementation

Source: `packages/coding-agent/src/server/zeta-server.ts`

The `ZetaServer` class manages the full lifecycle:
- Stats Dashboard is started via `@linxiraos/pi-stats`'s `startServer()`
- Web UI is spawned as a child process via `spawnWebUi()` from `commands/web-ui-launcher`
- The main `Bun.serve` proxy strips hop-by-hop headers and forwards requests to the appropriate backend
- All servers bind to `127.0.0.1` (localhost only) for security