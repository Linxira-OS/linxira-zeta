<p align="center">
  <img src="./assets/zeta-mark.svg" width="360" alt="Zeta">
</p>

<p align="center">
  <a href="https://github.com/Linxira-OS/linxira-zeta/releases"><img src="https://img.shields.io/badge/zeta-1.1.20-8B5CF6?style=flat-square" alt="Zeta version"></a>
  <img src="https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun&logoColor=white" alt="Runtime: Bun">
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="Language: TypeScript">
  <img src="https://img.shields.io/badge/native-Rust-dea584?style=flat-square&logo=rust&logoColor=white" alt="Native: Rust">
  <a href="https://github.com/Linxira-OS/linxira-zeta/actions"><img src="https://img.shields.io/github/actions/workflow/status/Linxira-OS/linxira-zeta/ci.yml?style=flat-square" alt="CI"></a>
</p>

Zeta is a Bun-native coding agent distribution built on the OMP runtime. It
keeps the terminal workflow fast and direct while owning its package namespace,
product presentation, release policy, and its own local web workspace — one
runtime, three surfaces (terminal, browser, desktop).

## Update Log

Release history (v1.0.9 and earlier): [UPDATE-LOG.md](UPDATE-LOG.md)

## Start Here

Install the released CLI (Node 20+ or Bun on the machine):

```sh
npm i -g @linxiraos/zeta      # or: bun add -g @linxiraos/zeta
zeta                           # opens in the current project directory
zeta --help                    # commands and options
```

The bundled editor ships as its own package:

```sh
npm i -g @linxiraos/editor
zeta-editor .                  # launch in any terminal, including over SSH
```

From a source checkout:

```sh
bun install
bun run build:native
bun run dev
```

The CLI opens in the current project directory. Use `bun run dev -- --help` to
inspect commands and options.

Windows native builds require Visual Studio Build Tools with the Desktop
development with C++ workload. On macOS and Linux, use the platform C/C++
toolchain required by Rust.

## What Zeta Provides

- A terminal coding workspace with file reading, search, patching, shell, git,
  task delegation, and structured tool output.
- A bundled terminal editor ([TTT Editor](https://github.com/eugenioenko/ttt),
  vendored and maintained as `@linxiraos/editor`): install `npm i -g @linxiraos/editor`
  and launch `zeta-editor` in any terminal — including over SSH, so an agent
  session, hand-written edits, and code review all run on the server without a
  GUI editor. Windows x64 and Linux x64 builds ship as platform packages.
- Multi-provider model access, local configuration, OAuth flows, model
  discovery, session recovery, and controllable retry behavior.
- Native text, image, terminal, browser, and desktop capabilities where the
  host platform supports them.
- A Bun-first monorepo with internal packages under the `@linxiraos/*` namespace.
- A local web workbench (`zeta serve`, Next.js app in `web-ui/`) and a desktop
  shell (`zeta-desktop`, Electron) that embed the same coding-agent runtime —
  one session tree, one settings model, one gateway API (`/api/*`).

## Upstream Origins

Zeta is a distribution derived from four upstream projects, each with a
fixed role:

| Project                                               | Role in Zeta                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [OMP (oh-my-pi)](https://github.com/can1357/oh-my-pi) | The runtime tree. Integrated only at complete, official release tags — never raw upstream commits |
| [Pi](https://github.com/earendil-works/pi)            | Semantic-port source for feature work, never a raw merge source                                   |
| [OMP Web](https://github.com/17380936778/omp-web)     | Source of the `web-ui/` snapshot                                                                  |
| [Pi Web](https://github.com/agegr/pi-web)             | Semantic-port source for web features                                                             |

The merge policy is recorded in [document/upstream-sync.md](document/upstream-sync.md);
the web workbench's own front door is [web-ui/README.md](web-ui/README.md).
Predecessor contributions remain acknowledged in source history and package
notices.

## Component Lineage

The distribution is assembled from parts with different origins. What a part
inherits from upstream — and what Zeta owns — is stated per component:

| Component                                                               | Upstream origin                                                                                | Zeta ownership                                                                                                                      |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `packages/coding-agent/` (CLI, `zeta`)                                  | OMP runtime tree, release-tag merges                                                           | Brand, config dir `.zeta`, npm scope `@linxiraos/*`, release chain, Zeta-originated capabilities                                    |
| `packages/ai`, `agent`, `catalog`, `tui`, `natives`, `utils`, `stats`   | OMP runtime tree                                                                               | Same adaptation surface as the CLI                                                                                                  |
| `editor/` (TTT Editor, `@linxiraos/editor`, binary `ttt`/`zeta-editor`) | [eugenioenko/ttt](https://github.com/eugenioenko/ttt) — vendored Go source + prebuilt binaries | Brand surface, Zeta theme, mouse/interaction fixes, i18n hook surface; every vendored-binary change is logged in `editor/VENDOR.md` |
| `web-ui/`                                                               | OMP Web snapshot (frozen — manual cherry-picks only)                                           | Own-desktop upgrade content, Next.js app                                                                                            |
| `desktop/`                                                              | Zeta-originated                                                                                | Electron shell that embeds the `web-ui/` build and the compiled `zeta` runtime                                                      |
| `packages/coding-agent/src/channels/` (WeChat/Feishu/Telegram bridge)   | Zeta-originated                                                                                | Channel runtime, tools (`channel_send`, `workspace_run`)                                                                            |
| `packages/coding-agent/src/server/` (web-gateway, `zeta serve`)         | Zeta-originated                                                                                | REST surface consumed by `web-ui/` and `desktop/` over HTTP                                                                         |

**TTT Editor plugin compatibility.** The editor currently follows the upstream
plugin system (Go plugin API) as its extension path. Zeta's vendored changes are
bug fixes, brand surface, and additive hooks — not a fork of the plugin
protocol. If upstream's plugin direction stops being a good fit for the
distribution, the fallback is to vendor the specific plugins the product needs
directly into `editor/` rather than maintain protocol divergence; that decision
is recorded when (and if) it is made. See `editor/VENDOR.md` for the current
change ledger.

## Zeta-Originated Capabilities

Beyond the OMP runtime lineage, Zeta ships its own capabilities (roadmap in
[document/roadmap.md](document/roadmap.md)):

- **Adaptive long-term tracking** — ongoing session observation with standing
  system guidance that keeps provider prefix caches stable across long
  sessions.
- **Experiment measurement** — per-project local experiment tracking with
  metrics, directions, and baseline commits.
- **TypeScript custom commands** — user-defined slash commands from
  `~/.zeta/commands/` and project command dirs, with `arktype`/`typebox`/`zod`
  argument schemas and full access to the runtime API.
- **Command marketplace** — install and share slash commands as Bun packages.
- **ACP collaboration builtins** — Agent Client Protocol session support.
- **Channel runtime** — WeChat/Feishu/Telegram bridges embedded in
  `zeta serve`, with plan-image routing and workspace-scoped execution tools.
- **Web gateway** — REST API behind the web UI (`/api/*`), one handler module
  per resource, consumed by both the browser UI and the desktop shell.
- **Desktop shell** — Electron tray application embedding a standalone build of
  the web UI plus the compiled runtime; target machines need neither Bun nor Node.
- **Linux downstream packaging** — `zeta-desktop` ships as a release asset with
  a frozen name/digest contract so downstream repositories (pacman et al.) can
  pin and verify it; see `document/release.md`.
- **Local stats dashboard** — `zeta stats` observability for the coding agent.

## Documentation

The repository keeps two documentation trees with different audiences:

- [docs/](docs/) — **runtime documentation**, packaged with the product. Agents
  read it at runtime through `zeta://docs/` (embedded in binaries and the npm
  bundle; from a source checkout it reads the live tree). Covers tools,
  tool-call conversion, skills, protocols, configuration, and Zeta features.
- [document/](document/) — **internal development and product-process
  documentation**, never packaged. Includes the [development
  roadmap](document/roadmap.md), the upstream [sync
  ledger](document/upstream-sync.md), and the
  [porting guide](document/porting-from-pi-mono.md).

## Interface Language

The CLI ships Simplified Chinese and English catalogues. The active language
resolves in this order:

1. `language` in the settings file (`~/.zeta/settings.json`) — the explicit
   choice, written by `/language`.
2. `ZETA_LANG` / `LC_ALL` / `LC_MESSAGES` / `LANG` — the shell locale.
3. The OS UI language (`Intl`) — so a Chinese Windows box gets Chinese with no
   configuration at all.
4. English when nothing matches.

`/language` switches live: slash-command descriptions, the composer, and every
localized panel re-resolve on the next render without a restart. Both
catalogues are complete, so the choice is per-install rather than per-build —
plugins can register their own text through the same source.

## Development

```sh
# Static checks for TypeScript and Rust
bun check

# Coding-agent checks only
bun --cwd=packages/coding-agent run check

# Focused tests
bun --cwd=packages/coding-agent test test/<file>.test.ts
```

The primary application lives in `packages/coding-agent/`. Shared runtime
packages include `packages/ai/`, `packages/catalog/`, `packages/agent/`,
`packages/tui/`, and `packages/natives/`.

## Platform Support

| Surface                             | Windows | macOS      | Linux      |
| ----------------------------------- | ------- | ---------- | ---------- |
| `zeta` CLI                          | x64     | x64, arm64 | x64, arm64 |
| `zeta-editor` (`@linxiraos/editor`) | x64     | —          | x64        |
| `zeta serve` (web workbench)        | x64     | x64, arm64 | x64, arm64 |
| `zeta-desktop` shell                | x64     | x64, arm64 | x64        |

Native text/grep and image capabilities require the platform C/C++ toolchain
when built from source; released binaries bundle the prebuilt native modules.

## Upstream Policy

Zeta follows OMP only through complete, official release tags. Each release is
merged as real Git history on a temporary integration branch, then receives any
required Zeta package, brand, Bun, CI, and product adaptations in separate
commits. The exact source tag, SHA, conflict decisions, and checks are recorded
in [document/upstream-sync.md](document/upstream-sync.md).

Pi and Pi Web are semantic feature sources, not raw merge sources. See
[AGENTS.md](AGENTS.md) for the repository rules.

## License

Zeta is distributed under the repository's [MIT License](LICENSE). Its runtime
lineage includes OMP and Pi, and the bundled editor is vendored from
[TTT Editor](https://github.com/eugenioenko/ttt); their contributions remain
acknowledged in source history and package notices.
