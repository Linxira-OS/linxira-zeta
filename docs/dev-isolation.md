# Development Isolation

A source checkout of Zeta must never read or write the state of an installed
Zeta: sessions, credentials, the Team database, the serve registry, stats, the
default workspace, Electron `userData`, or the loopback service ports. This page
defines the dev profile that makes that separation explicit, reproducible, and
verifiable.

The profile lives in two scripts:

- [`scripts/dev-isolation.ts`](../scripts/dev-isolation.ts) — the single source
  of truth (paths, ports, exported and cleared environment, audited gaps).
- [`scripts/dev-isolated.ts`](../scripts/dev-isolated.ts) — the launcher
  (`cli`, `tui`, `serve`, `stats`, `desktop`, `--print`, `--check`).

## Quick start

From the checkout root:

```sh
# One-time: build the renderer `serve` will ship from this checkout.
npm ci --prefix web-app
npm run build --prefix web-app

# Inspect the resolved profile without launching anything.
bun run dev:isolated --print

# Interactive CLI/TUI on the dev profile.
bun run dev:isolated

# Web UI + stats dashboard + web gateway on dev ports.
bun run dev:isolated serve

# Stats dashboard only (dev stats DB, dev stats port).
bun run dev:isolated stats

# Desktop shell on dev Electron userData (requires a running dev serve).
bun run dev:isolated desktop

# Guard: paths stay inside the dev root, ports stay off installed defaults.
bun run dev:isolated:check
```

Windows wrappers: `scripts\dev-isolated.cmd ...` or
`pwsh -File scripts\dev-isolated.ps1 ...`. POSIX wrapper:
`./scripts/dev-isolated.sh ...`. The wrappers only require `bun` on `PATH`.

Arguments after the mode are forwarded to the CLI, so ordinary flags work:

```sh
bun scripts/dev-isolated.ts serve --host 127.0.0.1
bun scripts/dev-isolated.ts cli -p "explain this file"
bun scripts/dev-isolated.ts --check --json
```

## What is isolated

| Variable                | Dev value                                      | Why                                                                                          |
| ----------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ZETA_CONFIG_DIR`       | `.zeta-dev`                                    | Moves the whole config root to `~/.zeta-dev`; a *relative* dirname under home (absolute paths are rejected by the resolver). |
| `ZETA_PROFILE`          | `dev`                                          | Named profile under `~/.zeta-dev/profiles/dev`, so two dev profiles can coexist and the default profile is never entered. |
| `ZETA_CODING_AGENT_DIR` | `~/.zeta-dev/profiles/dev/agent`               | Also read directly by the web gateway; the named profile itself ignores the override.        |
| `ZETA_DEFAULT_WORKSPACE`| `~/.zeta-dev/workspace`                        | The coordinator workspace is otherwise hard-coded to `~/.zeta/workspace`.                    |
| `ZETA_TEAM_DB`          | `~/.zeta-dev/data/zeta.db`                     | Keeps the global Team DB out of the installed one.                                          |
| `ZETA_SERVE_REGISTRY`   | `~/.zeta-dev/serve.json`                       | Discovery (and the desktop shell) never adopts an installed serve instance.                  |
| `ZETA_TRASH_DIR`        | `~/.zeta-dev/trash/sessions`                   | Deleted-session trash stays inside the dev root.                                             |
| `ZETA_WEB_GATEWAY_PORT` | `44143`                                        | Gateway clients (`attach`, backend discovery) target the dev gateway.                        |
| `ZETA_GATEWAY_URL`      | `http://127.0.0.1:44143`                       | Default `zetacode attach` target.                                                           |
| `ZETA_WEB_APP_DIR`      | `<checkout>/web-app/dist`                      | `serve` ships the checkout's renderer build, not a packaged one.                             |
| `ZETA_SERVE_COMMAND`    | desktop mode only: this launcher's `serve`      | If desktop discovery ever falls back to spawning, it spawns the dev launcher, never a production-port service. |

On Linux/macOS the launcher also clears `XDG_DATA_HOME`, `XDG_STATE_HOME`, and
`XDG_CACHE_HOME` for the child. The resolver sends profile-independent roots
(daemon sockets, session-owner leases, plugin data) to `$XDG_*/zeta` when that
directory exists — which is the installed root. Clearing them pins those roots
to `~/.zeta-dev`.

It also clears inherited relocations that would point the child at production
state: `PI_PROFILE`, `PI_CONFIG_DIR`, `PI_CODING_AGENT_SESSION_DIR`,
`PI_NATIVES_DIR`, `ZETA_AUTORESEARCH_DB_DIR`, `ZETA_AUTH_BROKER_SNAPSHOT_CACHE`,
`ZETA_GITHUB_CACHE_DB`, `ZETA_COMMIT_CACHE_DB`, `ZETA_JUDGMENT_CACHE_DB`,
`ZETA_WORKTREE_DIR`, `ZETA_DAEMON_PROJECT_DIR`, `ZETA_DAEMON_RUNTIME_DIR`,
`ZETA_SERVE_HOSTNAME`, `ZETA_SERVE_TLS_CERT`, `ZETA_SERVE_TLS_KEY`.
`ZETA_AUTH_BROKER_*` credentials are intentionally inherited (a broker is not
state under `~/.zeta`); its snapshot cache still lands in the dev root.

### Dev paths

| State                | Path                                             |
| -------------------- | ------------------------------------------------ |
| Config root          | `~/.zeta-dev`                                    |
| Profile root         | `~/.zeta-dev/profiles/dev`                       |
| Agent dir            | `~/.zeta-dev/profiles/dev/agent`                  |
| Stats DB             | `~/.zeta-dev/profiles/dev/stats.db` (derived)     |
| Team DB              | `~/.zeta-dev/data/zeta.db`                        |
| Serve registry       | `~/.zeta-dev/serve.json`                          |
| Session trash        | `~/.zeta-dev/trash/sessions`                      |
| Default workspace    | `~/.zeta-dev/workspace`                           |
| Desktop `userData`   | `~/.zeta-dev/desktop-user-data`                   |
| Renderer (`serve`)   | `<checkout>/web-app/dist`                         |

## Ports

| Service         | Installed Zeta | Dev profile | Notes                                                    |
| --------------- | -------------- | ----------- | -------------------------------------------------------- |
| Web UI          | `43141`        | `44141`     | Distinct origin: browser storage/cookies do not mix.     |
| Web gateway     | `43143`        | `44143`     | `ZETA_WEB_GATEWAY_PORT` + `ZETA_GATEWAY_URL`.            |
| Stats dashboard | `43147`        | `44147`     | `serve --stats-port` / `stats --port`.                   |
| Browser relay   | `43153`        | `43153`     | **Gap:** compile-time constant, no env override.         |

The launcher passes the ports explicitly to `serve` (`--web-port`,
`--gateway-port`, `--stats-port`, `--no-browser`) and to `stats` (`--port`).
The dev origin `http://127.0.0.1:44141` is a different browser origin from the
installed `http://127.0.0.1:43141`, so local storage, cookies, and service
workers cannot leak between them. `zetacode web` has no port environment
variable; when you invoke it through the launcher, pass `--port 44141`
yourself:

```sh
bun scripts/dev-isolated.ts cli web --port 44141
```

## Desktop shell

The Electron shell is a standalone npm project (`desktop/`) and is not built
with the workspace. Its state is isolated two ways:

1. Launch with `--user-data-dir=~/.zeta-dev/desktop-user-data`, set by the
   launcher's `desktop` mode (Electron/Chromium switch that moves
   `app.getPath("userData")`).
2. Inherited `ZETA_SERVE_REGISTRY` points the shell's discovery at the dev
   registry, so it adopts the dev `serve` instance instead of the installed one.

The shell's own spawn fallback is pinned to production ports in
`desktop/src/main.ts`, so `desktop` mode requires a dev `serve` to be running:

```sh
# Terminal 1
bun run dev:isolated serve

# Terminal 2
npm ci --prefix desktop && npm run build --prefix desktop
bun run dev:isolated desktop
```

## Reset dev data

```sh
# POSIX
rm -rf ~/.zeta-dev

# PowerShell
Remove-Item -Recurse -Force "$HOME\.zeta-dev"
```

Deleting `~/.zeta-dev` removes dev sessions, dev credentials, dev Team DB,
stats, the dev workspace, and dev desktop settings. It never touches `~/.zeta`.
To reset only one store, delete that path from the table above (for example
`~/.zeta-dev/serve.json` after a stale registration).

## Running production alongside it

- Installed CLI/TUI: run `zetacode` normally, without any `ZETA_*` overrides.
  The dev profile does not mutate `~/.zeta`, so installed sessions and
  credentials are unaffected.
- Installed desktop: launch the installed app; it uses its own `userData` and
  the default serve registry.
- Installed `serve`: `zetacode serve` keeps `43141/43143/43147`; the dev stack
  uses `44141/44143/44147` and its own registry, so both can run at once.
- Never run the dev launcher with `ZETA_CONFIG_DIR=.zeta`; the guard fails if a
  resolved path lands inside the production root.

## Authentication

Provider credentials are stored in the profile's `agent.db`, so the dev profile
starts unauthenticated. Run `/login` once in the dev profile (it writes only to
`~/.zeta-dev`). To reuse a remote auth broker, export the usual
`ZETA_AUTH_BROKER_URL` / `ZETA_AUTH_BROKER_TOKEN` before launching; they are
inherited, while the broker snapshot cache is relocated into the dev root. API
keys exported in the shell, project `.env`, `~/.zeta-dev/.env`, or `~/.env` are
read normally.

## Audited gaps

These are verified limits of the current code; the launcher does not fake a
variable that does not exist.

| Gap | Behavior | Workaround |
| --- | --- | --- |
| Stats DB override | No `ZETA_STATS_DB` exists. `getStatsDbPath()` is `<profile root>/stats.db`, so the dev root isolates it but a repo-local stats DB cannot be selected. | Keep the dev config root; do not invent `ZETA_STATS_DB`. |
| Browser relay port | `ZETA_BROWSER_RELAY_PORT` is the constant `43153`, not an env knob. | Run only one relay (installed or dev) at a time. |
| LSP shared config | `loadConfig()` reads `~/.zeta/lsp.json` unconditionally (read-only). | Put dev-only servers in the project's `.zeta/lsp.*`; project files win. |
| Browser state save | `tab.saveState()` without an explicit path writes `~/.zeta/browser-state/<tab>.json`. | Pass a path when saving from the dev profile. |
| Home dotenv | `$env` still reads `~/.env` for unset keys (read-only). | Prefer `~/.zeta-dev/.env` for dev overrides; shell exports win. |
| Provider auth | Credentials are per-profile (`agent.db`). | `/login` in the dev profile, or inherit `ZETA_AUTH_BROKER_*`. |

## Verification

```sh
bun run dev:isolated --print   # resolved matrix
bun run dev:isolated --check   # paths/ports guard
bun test scripts/dev-isolation.test.ts
```

`scripts/check-dev-isolation.ts` resolves the profile again through the real
`packages/utils/src/dirs.ts` resolver in a child process and fails when any
resolved path (config root, agent dir, stats DB, Team DB, daemon runtime,
session owners, plugins) leaves `~/.zeta-dev` or enters `~/.zeta`. CI runs the
guard and the unit test on every PR.

## Warnings

- `ZETA_CONFIG_DIR` must stay a relative dirname under home; the resolver
  rejects absolute paths and `..`.
- Do not run two `serve` stacks on the same ports. The dev stack is separate by
  construction; the shared browser relay port is the one exception.
- The dev profile's data is disposable. Never point `ZETA_CONFIG_DIR` at
  `.zeta`, and never copy `~/.zeta-dev` over `~/.zeta`.
- `web-app/dist` is built from the checkout; if it is missing, `serve` prints
  the build instruction and may serve the placeholder page.
