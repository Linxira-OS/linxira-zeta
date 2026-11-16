# Product and platform

**English** · [简体中文](product.zh-CN.md)

This page describes the public product surfaces and supported platforms. For
install commands, see the [README](../README.md). For repository structure,
build/test commands, and coverage, see
[Repository and development](development.md).

## What Zeta is

Zeta is an agent workspace suite: **Z Work Studio**, the browser workbench
served by the CLI (`zetacode serve`), together with the coding agent
(`zetacode`), the terminal IDE (`zetaide`), and the editor payload they share.
It is an **agent development environment (ADE)**, not an IDE with a chat pane:
the session is the unit of work, and every panel is a surface the agent can
use.

The suite is a downstream distribution of [OMP](https://github.com/can1357/oh-my-pi)
with a maintained [OMP Studio](https://github.com/the-snowpear/omp-studio)
renderer fork and a vendored [TermIDE](https://github.com/termide/termide) tree.
Attribution, integrated tags, and per-component differences are recorded in
[Ownership and attribution](ownership.md) and
[`NOTICE`](../NOTICE).

## The suite

| Command    | Package           | What it is                                                |
| ---------- | ----------------- | --------------------------------------------------------- |
| `zetacode` | `@linxiraos/zeta` | Coding agent CLI; `zetacode serve` opens Z Work Studio    |
| `zetaide`  | `@linxiraos/ide`  | Terminal IDE (TermIDE, vendored Rust)                     |

Every command launches standalone with its own `--help`. The `zetawork` /
`zeta` bins still exist in the paused `@linxiraos/main` package; the name is
reserved for the main/super-agent surface, and no Rust GUI ships under it.
`@linxiraos/editor` is a reserved package name whose payload is not published
today: the editor is a workbench pane, not a standalone command.

## Z Work Studio

Z Work Studio is the browser workbench served by `zetacode serve`. It is the
shipped web surface; the renderer build ships inside `@linxiraos/zeta` at
`dist/web-app`, and `ZETA_WEB_APP_DIR` points a source checkout or custom build
at another renderer directory. `zetacode serve` serves the renderer
same-origin with the gateway, so one port is enough.

- **Sessions first** — home, history, and the workbench are the same session
  tree; opening an old session or starting a new one does not switch runtimes.
- **Panels** — side and bottom panels (explorer, changes/diff, terminal over
  the gateway's PTY stream, media/artifacts, statistics, diagnostics, the agent
  hub) with remembered layout per scope.
- **Agents and approvals** — composer with model/mode pickers, queued messages,
  approval cards, tool bodies, and agent conversations in the same view.
- **One host contract** — every read and action goes through `/api/v1/*`
  (`pair`, CSRF, query, command, events), and the legacy Web Gateway REST
  surface (`/api/*`) is still served for compatibility. The CLI, the browser,
  and remote clients see the same capability manifest; anything not
  implemented is not advertised.
- **No Rust UI** — the old egui/WebView2 workbench
  (`main/crates/zetawork-gui`) is not a product surface; its design work lands
  in `web-app/src/studio/`.

The host contract and serve behavior are documented in
[`docs/zeta-serve-web.md`](../docs/zeta-serve-web.md) and
[`docs/web-ui/api.md`](../docs/web-ui/api.md). The runtime feature index is
[`docs/zeta-features.md`](../docs/zeta-features.md).

## Desktop editions

Z Work Studio ships as a desktop application in two editions built from the
same staged runtime:

| Edition             | What it bundles                                            | Platforms |
| ------------------- | ---------------------------------------------------------- | --------- |
| **Full (Electron)** | Chromium, the kernel, the renderer, tray and window chrome | Windows x64, Linux x64 |
| **Browser**         | The kernel and the renderer only; no browser engine        | Windows x64, Linux x64 |

Both editions carry Zeta's own kernel — the compiled `zeta` binary (the same
CLI as `zetacode`), the native addons, and the Z Work Studio renderer
(`web-app/dist`) — so a target machine needs neither Bun nor Node. The Electron
shell spawns the bundled `zetacode serve` and loads it in its window; the
browser edition's launcher starts the same server and hands the URL to the
default browser. Both reuse the standalone server's existing HTTP
authentication. There is no Rust desktop UI, and no desktop asset comes from
the paused `main/` workbench.

The shell and renderer display **Z Work Studio**; the runtime identifies as
**Zeta**. Packaging layout, shell contracts, and local build steps are in
[`docs/desktop-app.md`](../docs/desktop-app.md).

## The coding agent

`zetacode` is the coding CLI, built on the OMP runtime:

- a terminal coding workspace with file reading, search, patching, shell, git,
  task delegation, and structured tool output;
- multi-provider model access, local configuration, OAuth flows, model
  discovery, session recovery, and controllable retry behavior;
- a local web workbench (`zetacode serve` → Z Work Studio) that embeds the same
  runtime — one session tree, one settings model, one host contract
  (`/api/v1/*`, with `/api/*` behind it);
- native text, image, terminal, browser, and desktop-capable tooling where the
  host platform supports it.

## An agent development environment (ADE)

The suite is not an IDE with a chatbot bolted on. It is an **ADE — an Agent
Development Environment**, the way an IDE is an Integrated Development
Environment: the same structure, with the first word changed from *Integrated*
to *Agent*.

| | IDE | ADE (this suite) |
| --- | --- | --- |
| Center of gravity | the open file | the agent session |
| Who drives the tools | the editor drives LSP, builds, the debugger | the agent drives tools; editors and terminals are its work surfaces |
| Unit of work | a buffer | a session: context, tools, subagents, verification |
| Where the loop lives | type → build → debug | plan → execute → verify, with the human steering |

Zeta keeps the IDE's shape — panes, tabs, real PTYs, LSP, an editor pane, a
terminal IDE (`zetaide`) — because an agent needs somewhere to work. What moves
is the center: `zetacode` sessions, subagent orchestration, the mesh
(`agent://`), extensions and skills are first-class; the editor, terminals and
file manager are the environment the agent operates in. A human can still drive
any pane directly; the suite simply assumes the agent is the primary worker and
the panes are how it observes and changes the world.

## Zeta-originated capabilities

Beyond the OMP runtime lineage, Zeta ships its own capabilities. Each linked
page is the runtime documentation for that surface:

- **Z Work Studio** (`web-app/`) — the browser workbench: session history and
  workbench panels, a PTY terminal, diffs, artifact/media views, statistics and
  the agent hub, served by `zetacode serve` from the packaged `dist/web-app`.
  Its host (`studio-host`, `/api/v1/*`) is Zeta's own.
- **Web gateway** — the `/api/*` REST surface behind the browser, one handler
  module per resource, consumed by Z Work Studio and remote clients.
- **Project tracking** — an opt-in cross-session record in `.zeta/tracking/`
  (progress, decisions, actions, plans) written through `tracking_update`; see
  [`docs/zeta-tracking.md`](../docs/zeta-tracking.md).
- **Taste layer** — per-prompt preference candidates with calibrated judgment
  and a capped system-prompt injection; see
  [`docs/memory.md`](../docs/memory.md#taste-layer).
- **Ultra plan mode** — `/plan-ultra` adds fan-out scouting and incremental
  plan writes to plan mode; see
  [`docs/plan-approval.md`](../docs/plan-approval.md).
- **Channel runtime** — WeChat/Feishu/Telegram bridges embedded in
  `zetacode serve`, with plan-image routing and workspace-scoped execution
  tools; see [`docs/channels.md`](../docs/channels.md).
- **Usage and statistics extensions** — `/api/usage/daily` and the `usage.*`
  host operations feed the Z Work Studio dashboards; the upstream stats
  database and `zetacode stats` dashboard remain the base.
- **Desktop packaging** — Electron and browser editions built from one staged
  runtime; see [`docs/desktop-app.md`](../docs/desktop-app.md).
- **Inherited upstream capabilities** (not Zeta-originated): the `autoresearch`
  experiment loop, custom tools and TypeScript commands, the slash-command
  marketplace, and ACP support ship here with brand adaptations — see
  [`docs/custom-tools.md`](../docs/custom-tools.md),
  [`docs/marketplace.md`](../docs/marketplace.md), and
  [`docs/slash-command-internals.md`](../docs/slash-command-internals.md).

## Platform support

Linux is the primary platform (Linxira OS, Arch-based); Windows x64 is a
supported development and target platform; macOS is not built.

| Surface | Linux | Windows | macOS |
| --- | --- | --- | --- |
| `zetacode` CLI | x64, arm64 | x64 | — |
| `zetaide` (`@linxiraos/ide`) | x64 | x64 | — |
| Z Work Studio (`zetacode serve`, ships in `@linxiraos/zeta`) | x64, arm64 | x64 | — |
| Z Work Studio desktop editions | x64 | x64 | — |

Native text/grep and image capabilities require the platform C/C++ toolchain
when built from source; released binaries bundle the prebuilt native modules.

## Interface language

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
catalogues are complete, so the choice is per-install rather than per-build;
plugins can register their own text through the same source.

## Related repositories

- [Linxira Knowledge Base (`lkb`)](https://github.com/Linxira-OS/linxira-knowledge-base)
  — the sibling self-hosted, layered knowledge base. It exposes an MCP server
  and an OpenAPI 3.1 surface, so a Zeta agent can query it as an external tool.
  It is a separate product with its own release line: not bundled with Zeta and
  not a build dependency. The client boundary — delegated identity, retrieval,
  maintenance scopes, audit attribution, and write approval — is recorded in
  [`document/lkb-integration.md`](../document/lkb-integration.md).

**English** · [简体中文](product.zh-CN.md)
