# `zetacode serve` and `zetacode web` Commands

CLI commands for one-click startup of the Stats Dashboard and Web UI, backed by
ZetaServer's unified reverse proxy.

> **Status (2026-11-06).** The shipped Web UI is **Work Studio**: the renderer in
> `web-app/`, served same-origin by `zetacode serve` (next section). Two earlier
> distributions are retired — `@linxiraos/zeta-web` (the Next.js `web-ui/`
> snapshot; frozen, no new builds) and the zetawork desktop bundle (Rust GUI
> paused, no installers published). Neither is a supported way to run the UI.
>
> Ports stay the Zeta block, not OMP's: gateway `43143`
> (`--gateway-port`/`ZETA_WEB_GATEWAY_PORT`), stats `43147`
> (`--stats-port`/`NEXT_PUBLIC_STATS_URL`), UI `43141` (`--web-port`).
>
> ```bash
> zetacode serve --web-only --web-port 43141 --gateway-port 43143
> # then open http://127.0.0.1:43141/ — that origin is Work Studio
> ```

## Studio renderer and host (same origin)

`zetacode serve` also serves the Studio renderer build (`web-app/`) on its own
origin, so the browser needs no second process:

- every path outside `/api/*` is served from the renderer directory — hashed
  assets from `/assets/` are cached immutably, `index.html` never is, and any
  other path falls back to `index.html` (client-side routing). A missing asset
  is a 404, never the HTML entry;
- the renderer directory is resolved in this order:
  1. `ZETA_WEB_APP_DIR`, when set. It is authoritative — if that path has no
     `index.html`, `serve` answers the placeholder rather than silently using
     another build;
  2. the packaged copy shipped inside the npm package:
     `<package-root>/dist/web-app/index.html`;
  3. the repository checkout's `web-app/dist`, for source installs;
- the npm package always ships a build. A plain `bun install` in a checkout
  resolves `web-app/dist` and never needs the packaged copy, so a source
  contributor runs `cd web-app && npm ci && npm run build` (types + bundle) as before;
- packaging is automatic: the package's `prepack` runs `gen:web-app`
  (`bun scripts/build-web-app.ts`), which builds `web-app`, stages it at
  `packages/coding-agent/dist/web-app/`, and is also what `npm pack` and the
  release publish use. To reproduce it by hand:

  ```bash
  bun run --cwd packages/coding-agent gen:web-app
  (cd packages/coding-agent && npm pack --dry-run)
  ```

- without a build (a truncated install, or a checkout before the first build)
  `/` answers a placeholder page naming these three ways to get one, and every
  `/api/*` route still works;
- the renderer's Content-Security-Policy is sent as a response header and is
  the same policy the packaged `index.html` carries as a meta tag;
- static assets ship precompressed: the build writes `.br` (brotli q11) and
  `.gz` (gzip q9) sidecars next to each asset, and the server negotiates
  `Accept-Encoding` (honouring q-values; `br` wins ties) instead of compressing
  per request. A response carries `Vary: Accept-Encoding` and the encoded
  `content-length`; a coding whose sidecar is missing is skipped, and identity
  is the fallback. Encoding of the same URL is part of the cache key.

The renderer speaks the Studio host contract on the same origin:

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | none | `{ok:true, protocolVersion:1}` — "is this a Studio host" |
| `POST /api/v1/pair` | remote-access gate + pairing code | Sets the `studio_session` cookie, returns `{csrf, expiresAt, device: {id, token, …}}`; the device token is shown once |
| `POST /api/v1/session/revoke` | remote-access gate + cookie + `X-Studio-CSRF` | Drops the session |
| `GET /api/v1/bootstrap` | remote-access gate + cookie | Identity, runtime status, surfaces, capability manifest |
| `POST /api/v1/query` | remote-access gate + cookie | `ClientQueryRequest` → `ClientQueryResponse` |
| `POST /api/v1/command` | remote-access gate + cookie + `X-Studio-CSRF` | `ClientCommandRequest` → 202 `ClientCommandAccepted` |
| `WS /api/v1/events` | remote-access gate + cookie | Event subscription (`ClientEvent`) |

Per-device credentials live on the gateway surface (see
[Remote access](./remote-workspaces.md#device-tokens-per-device-revocation)):

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/remote/devices` | remote-access gate | `{devices, currentDeviceId, legacyTokenActive}` — never a token or hash |
| `DELETE /api/remote/devices/:id` | gate + `write` scope | Revoke one device (idempotent; 404 for an unknown id) |
| `POST /api/remote/devices/revoke-all` | gate + `write` scope | `{keepCurrent?: boolean}` — revoke every device, optionally sparing the caller |

Two-factor (TOTP) guards remote device access (never IM credentials):

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/auth/2fa` | remote-access gate | `{enrolled, required, verified, verifiedUntil, recoveryCodesRemaining, enrolledAt}` — never the secret |
| `POST /api/auth/2fa/enroll` | genuine-local or 10-min step-up | `{secret, otpauthUrl, qrSvg, recoveryCodes, expiresAt}` — shown once |
| `POST /api/auth/2fa/confirm` | same | `{code}` activates the pending secret |
| `POST /api/auth/2fa/verify` | gate | `{code}` or `{recoveryCode}` → `{verifiedUntil, method, recoveryCodesRemaining}` |
| `POST /api/auth/2fa/disable` | genuine-local, or step-up + code | erase secret, recovery codes and policy |
| `POST /api/auth/2fa/recovery/regenerate` | step-up + code | new one-time codes; the old set dies |
| `PUT /api/auth/2fa/policy` | genuine-local or step-up | `{required}`; `true` before enrollment → `400 not_enrolled` |

State lives in `<agentDir>/auth/totp.json` (`0600`, atomic). Verification
grants are in memory (12 h for writes, 10 min for sensitive device actions);
a serve restart forgets them. There is no OS keychain here: the base32 secret
is protected by file permissions only, so 2FA defends against a stolen token,
not a compromised local account. A corrupt/missing file reads as "2FA off" and
the local operator can re-enroll.

`zetacode serve` prints the single-use pairing code (60 s TTL); set
`ZETA_STUDIO_PAIRING_CODE` to pin it for scripted runs. Bodies are capped at
1 MiB, one session may hold eight commands in flight, and a genuinely local
peer must send a loopback `Origin` (a peer that already presented a token or
device token proved possession of a secret, so the loopback-only Origin
allowlist — a CSRF guard for ambient cookie authority — does not apply to it).

Every `/api/v1` route sits behind the same remote-access gate as `/api/*`:
a request passes without a token only when the socket peer is loopback **and**
no proxy forwarding header (`forwarded`, `x-forwarded-*`, `x-real-ip`,
`cf-connecting-ip`, …) is present. A reverse proxy or tunnel makes every remote
client look like `127.0.0.1`, so forwarded requests need `remote.token` (and
share the failed-attempt limiter). Implicit (loopback) pairing on
`/api/v1/bootstrap` is only for a plain local install; once `remote.token` or
`remote.publicUrl` is configured, even a local peer pairs with the code.
Failed pairing codes are rate-limited like token failures (`429` with
`Retry-After`).

The capability manifest is built from the operations this host implements, so
a surface Zeta cannot serve is not advertised and the renderer hides it. An
unimplemented operation answers `{ok:false, queryName, error:{code:"unsupported", message}}`
for a query and `400` with the same envelope for a command.

During renderer development, `vite dev` keeps its proxy: `/api` and `/health`
are forwarded to the gateway port (`--gateway-port`, default `43143`), so the
same host contract serves the dev page.

## `zetacode serve`

Start both the Stats Dashboard and Web UI simultaneously.

```bash
zetacode serve
```

### Flags

| Flag | Short | Default | Description |
|---|---|---|---|
| `--stats-port` | `-s` | `43147` | Port for the Stats Dashboard |
| `--web-port` | `-w` | `43141` | Port for the Web UI |
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
| `--port` | `-p` | `43141` | Port for the Web UI |
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

1. Starts the Stats Dashboard on port 43147
2. Starts the Web UI (Next.js) on a random internal port
3. Starts a `Bun.serve` proxy on port 43141 that routes:
   - `/api/stats/*` → Stats Dashboard
   - Everything else → Web UI
4. Optionally opens the browser to the unified URL

See [zeta-server.md](./zeta-server.md) for the full server architecture.

## Instance discovery and reuse (multi-surface coexistence)

A machine can host the same backend from several surfaces (the desktop shell, a
terminal `zetacode serve`, `zeta-d`). They must not fight over `43141`/`43143`,
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