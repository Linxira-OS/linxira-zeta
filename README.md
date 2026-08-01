# Zeta

Zeta is a batteries-included coding-agent distribution based on
[Oh My Pi](https://github.com/can1357/oh-my-pi). It keeps OMP's runtime,
terminal UI, tools, sessions, MCP, browser automation, subagents, and Bun
workflow as the product baseline rather than recreating them as extensions.

Pi is an upstream feature source, not a second runtime. Zeta ports Pi changes
selectively when they improve the OMP-based product without discarding OMP's
intentional architecture.

## Repository Layout

```text
zeta/
├── packages/       OMP TypeScript packages and coding-agent CLI
├── crates/         OMP native Rust crates
├── python/         OMP RPC and Robomp services
├── docs/           OMP documentation plus Zeta upstream policy
├── web-ui/         Standalone OMP Web snapshot
└── temp/           Ignored local references for OMP, Pi, OMP Web, and Pi Web
```

`web-ui/` is deliberately outside the root Bun workspace. It has its own npm
dependencies, lockfiles, and development rules in `web-ui/AGENTS.md`.

Internal package names and the `omp` CLI remain unchanged for compatibility
with the OMP ecosystem and to keep downstream synchronization practical.

## Current Baselines

| Source | Baseline | Role |
| --- | --- | --- |
| [OMP](https://github.com/can1357/oh-my-pi) | `v17.2.2` (`80627462`) | Direct runtime parent |
| [Pi](https://github.com/earendil-works/pi) | `977ec83` | Semantic feature-port source |
| [OMP Web](https://github.com/17380936778/omp-web) | `c71edcb` | `web-ui/` source snapshot |
| [Pi Web](https://github.com/agegr/pi-web) | `248aaf4` | Web feature-port source |

See [docs/upstream-sync.md](docs/upstream-sync.md) for the branch model,
baselines, and exact integration process.

## Development

The root application uses Bun. A source checkout needs workspace dependencies
and the local native addon before the CLI can run.

```sh
bun setup
bun dev
bun check
```

The Web UI is developed separately:

```sh
cd web-ui
npm install
npm run dev
```

Do not run root workspace commands inside `web-ui/`, and do not run its Next
production build while its development server is active.

## Upstream Policy

- Sync OMP releases through `sync/omp/<release>` branches.
- Port Pi changes through focused `port/pi/<scope>` branches. Never raw-merge
  `pi-upstream/main` into Zeta.
- Update `web-ui/` from OMP Web as a source snapshot; port Pi Web changes
  through `port/pi-web/<scope>` branches.
- Keep `temp/` local and ignored. It is reference material, never a committed
  dependency.

## License And Attribution

Zeta is derived from OMP, which is derived from Pi. Preserve upstream notices
and licenses when porting code. The repository is distributed under the MIT
license in [LICENSE](LICENSE).
