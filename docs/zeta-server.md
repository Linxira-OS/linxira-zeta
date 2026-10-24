# ZetaServer — Unified HTTP Reverse Proxy

ZetaServer is a unified HTTP reverse proxy that exposes the Stats Dashboard and
gateway and (when a build is present) the Web UI through a single port. The
Web UI's development is **deferred**: this package ships no build, and the web
port answers a bilingual placeholder page instead. It uses `Bun.serve` as the front-end server and
proxies requests to the appropriate internal backend.

## Architecture

```
Browser → :43141 (Bun.serve) ─┬─ /api/stats/* → Stats Dashboard (:43147)
                              ├─ other /api/* → Web Gateway (:43143)
                              └─ everything else → Web UI build, when one is
                                 present (deferred today: placeholder page)
```

- **Front-end**: `Bun.serve` on port 43141 (configurable)
- **Stats Dashboard**: internal backend on port 43147 (configurable)
- **Web Gateway**: internal backend on port 43143
- **Web UI**: with a build present, a Next.js server on a random internal port;
  without one (the current default, development deferred), a static bilingual
  placeholder page served by the front door itself.

## Routing

| Path prefix | Backend |
|---|---|
| `/api/stats`, `/api/sync`, `/api/request/*` | Stats Dashboard |
| `/api/*` | Web Gateway |
| Everything else | Web UI build, or the placeholder page |

## Usage

### CLI

```bash
# Start Stats Dashboard + gateway (Web UI port answers the placeholder)
zetacode serve

# Start only the web-facing port
zetacode web

# Custom ports
zetacode serve --stats-port 43147 --web-port 43141

# Don't open browser
zetacode serve --no-browser
```

### Programmatic API

```typescript
import { startZetaServer } from "@linxiraos/zeta/server/zeta-server";

const instance = await startZetaServer({
  port: 43141,
  statsPort: 43147,
  noBrowser: false,
});

console.log(instance.url);       // http://localhost:43141
console.log(instance.statsUrl);  // http://localhost:43147

// Graceful shutdown
await instance.shutdown();
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `43141` | Main server port |
| `statsPort` | `number` | `43147` | Stats Dashboard port |
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