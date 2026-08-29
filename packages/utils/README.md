# @linxiraos/pi-utils

Shared utilities for [Zeta](https://github.com/Linxira-OS/linxira-zeta) packages. Zero ceremony, Bun-first.

## Notable modules

| Module | Purpose |
| --- | --- |
| `logger` | Centralized logger writing to `~/.zeta/logs/` with rotation (TUI-safe — never stdout) |
| `prompt` | Handlebars-based prompt templating and formatting helpers |
| `dirs` | Path helpers for Zeta config directories (`~/.zeta`, XDG-aware on Linux) |
| `stream` | `readStream` / `readLines` helpers over `ReadableStream` |
| `ptree` / `procmgr` | Process trees, `ChildProcess` wrapper, process lifecycle management |
| `postmortem` | Cleanup callbacks on exit, signals, and fatal exceptions |
| `which` | `$which()` binary lookup with caching |
| `fetch-retry` | `fetch` with retry/backoff policies |
| `fs-error` | Errno guards (`isEnoent` and friends) |
| `env` / `worker-host` | Environment plumbing and side-effect-free worker-host entry contract (`workerHostEntry`) |
| `abortable` / `async` | AbortSignal-aware stream/promise helpers |
| `math-delimiters` | LaTeX span/block delimiter grammar (offsets only) shared by the TUI and collab-web renderers |
| `peek-file` | Read the first N bytes of a file with pooled buffers |
| `frontmatter`, `glob`, `mime`, `temp`, `format`, `color`, `snowflake`, `tab-spacing`, `path-tree`, `sanitize-text` | Smaller single-purpose helpers |

Import from the root barrel or per-module subpaths (`@linxiraos/pi-utils/<module>`).

## Install

```sh
bun add @linxiraos/pi-utils
```

Ships TypeScript source directly (no build step); requires Bun ≥ 1.3.14.

## References

- [Monorepo README](https://github.com/Linxira-OS/linxira-zeta#readme)
- [CHANGELOG](./CHANGELOG.md)
