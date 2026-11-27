<p align="center">
  <img src="./assets/zeta-mark.svg" width="360" alt="Zeta">
</p>

<p align="center">
  <a href="https://github.com/Linxira-OS/linxira-zeta/releases"><img src="https://img.shields.io/badge/zeta-1.5.15-8B5CF6?style=flat-square" alt="Zeta version"></a>
  <img src="https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun&logoColor=white" alt="Runtime: Bun">
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="Language: TypeScript">
  <img src="https://img.shields.io/badge/native-Rust-dea584?style=flat-square&logo=rust&logoColor=white" alt="Native: Rust">
  <a href="https://github.com/Linxira-OS/linxira-zeta/actions"><img src="https://img.shields.io/github/actions/workflow/status/Linxira-OS/linxira-zeta/ci.yml?style=flat-square" alt="CI"></a>
</p>

**English** · [简体中文](rep-docs/README.zh-CN.md)

Zeta is a **terminal-first** agent workspace: the coding agent (`zetacode`),
the terminal IDE (`zetaide`), and **Zeta Terminal** (the Wave fork in
`terminal/`) are the product. Work Studio and the Electron desktop shell are
retired from release; `zetacode serve` remains a headless backend for sessions,
remote clients, Terminal integration, and a slim set of high-interaction
fallback pages (Team, Rooms, IM).

It is an **agent development environment (ADE)**, not an IDE with a chat pane:
the session is the unit of work, and every panel is a surface the agent can
use. Linux is the primary platform; Windows x64 is supported; macOS is not
built. There is no Rust desktop UI.

Zeta is a downstream fork of OMP,
licensed MIT. The integrated runtime source is OMP **v19.2.0**. `zetaide`
vendors [TermIDE](https://github.com/termide/termide) **0.49.0**. Zeta Terminal
is an Apache-2.0 fork of Wave Terminal; its fork policy is in
[`terminal/ZETA-FORK.md`](./terminal/ZETA-FORK.md).
Upstream copyright notices and licence texts remain in [`LICENSE`](./LICENSE)
and [`NOTICE`](./NOTICE); per-tree modification records are in
[`THIRD-PARTY-NOTICES.txt`](./THIRD-PARTY-NOTICES.txt).

The next product line is Zeta Terminal, built on the TSP surface. The browser
Work Studio and its desktop editions are archived and no longer built or
released (ADR-0100).

## TSP is the presentation surface

> 一个TSP协议已经能够在很多情况下做出非常完美的显示了。现有的很多webui的显示其实都没有使用TSP协议来得更轻巧快捷，会显得比较笨重在我们第一次使用webui，后面又转了其他家的webapp之后，我们严肃地发现，还是TSP协议能够发挥的事情更好

This is a standing product rule, recorded verbatim: a browser UI is not the
default answer, and adding one is not progress by itself. TSP stays the
lightweight presentation surface; `zetacode serve` stays the headless backend.

## Quick start

Recommended terminal path (Node 18+ or Bun):

```sh
npm i -g @linxiraos/zeta      # or: bun add -g @linxiraos/zeta
zetacode                      # interactive terminal agent
```

`zetacode serve` is the headless backend: it owns the machine-wide session
service for CLI clients and Zeta Terminal and does not serve a browser
renderer. Backend mode is **on by default**: a bare `zetacode` attaches to a
reachable backend and falls back to its own local process only when none is
running; explicit `--backend` / `--attach` still fails closed. Install the
terminal IDE separately:

```sh
npm i -g @linxiraos/ide       # zetaide — terminal IDE
```

The editor is a workbench pane, not a standalone tool: `@linxiraos/editor` is a
reserved package name whose payload is not published today.

Zeta Terminal is built and released from `terminal/` with its own toolchain;
NixOS is source-build only (the flake is best-effort and not part of the release gate); Linux releases are AppImage/deb/rpm/pacman.
it is not a root Bun workspace member.

From a source checkout:

```sh
bun install
bun run build:native
bun run dev
```

## The suite

| Command         | Package           | What it is                                      |
| --------------- | ----------------- | ----------------------------------------------- |
| `zetacode`      | `@linxiraos/zeta` | Coding agent CLI; `serve` is headless backend   |
| `zetaide`       | `@linxiraos/ide`  | Terminal IDE (TermIDE, vendored Rust)           |
| Zeta Terminal   | `terminal/`       | Terminal product line (Wave fork, TSP)          |

Every command launches standalone with its own `--help`. Zeta Terminal is the
TSP presentation surface; the headless backend shares the CLI's runtime and
settings and hands coding/editing off to `zetacode` and `zetaide` instead of
re-implementing them. The `zetawork` /
`zeta` bins still exist in the paused `@linxiraos/main` package; the name is
reserved for the main/super-agent surface, and no Rust GUI ships under it.

## Coverage

Coverage is measured and reviewed, not gated by a threshold. The baseline
(2026-11-03), loaded-file caveat, and per-package metrics are in
[Repository and development](rep-docs/development.md#coverage); maintainer
policy is in [`.github/MAINTAINERS.md`](./.github/MAINTAINERS.md).

## Documentation

- [Product and platform](./rep-docs/product.md) — the suite, Zeta Terminal, the
  coding agent, ADE model, capabilities, and platform support.
- [Repository and development](./rep-docs/development.md) — layers, repository
  map, documentation trees, build/test commands, and coverage policy.
- [Ownership and attribution](./rep-docs/ownership.md) — maintenance roles,
  issue routing, upstream policy, per-component lineage, commercial surfaces,
  and licensing.
- [`docs/`](./docs/) — **runtime documentation** packaged with the product and
  served at `zeta://docs` for users, operators, and extension authors.
- [`document/`](./document/) — **internal engineering documentation**, never
  packaged: architecture, ADRs, roadmap, sync ledger, and release procedure.

## Contributing and security

Contribution rules, PR requirements, and AI-assisted contribution policy are in
[`CONTRIBUTING.md`](./CONTRIBUTING.md) ([简体中文](./CONTRIBUTING.zh-CN.md)).
Report vulnerabilities through the private advisory described in
[`.github/SECURITY.md`](./.github/SECURITY.md)
([简体中文](./.github/SECURITY.zh-CN.md)), never a public issue or pull request.
The advisory form is
<https://github.com/Linxira-OS/linxira-zeta/security/advisories/new>.

## Built on

Three projects make Zeta possible, and we thank their authors and contributors.

| Project | Integrated source | What Zeta takes from it |
| --- | --- | --- |
| [OMP](https://github.com/Linxira-OS/linxira-zeta) (Zeta), MIT | `v19.2.0` | the runtime tree: agent, tools, TUI, model catalog, wire protocol |
| [OMP Studio](https://github.com/the-snowpear/omp-studio), MIT | `v0.2.4` release tag (`v0.2.1` ancestry, 978 sync decisions accepted; v0.2.8 held on OMP 19) | the web UI: **v0.2.4** renderer, client, and the host contract it speaks |
| [TermIDE](https://github.com/termide/termide), MIT | `0.49.0` | `zetaide` and the built-in editor pane |

Further upstreams shaped earlier work and stay credited:
[Pi](https://github.com/earendil-works/pi) / [Pi Web](https://github.com/agegr/pi-web)
as semantic port sources, and [OMP Web](https://github.com/17380936778/omp-web) as
the origin of the frozen `retired/web-ui/` snapshot. Per-tree ledgers and the full fork
declaration are in [`THIRD-PARTY-NOTICES.txt`](./THIRD-PARTY-NOTICES.txt).

## License

Zeta carries two licences, split by path:

- `retired/zetawork/` — the historical Rust workbench — is **AGPL-3.0-only**
  ([text](./retired/zetawork/LICENSE)).
- Everything outside `retired/zetawork/` is **MIT**, including `packages/`,
  `crates/`, `sdk/`, `web-app/`, `desktop/`, `docs/`, `document/`, `scripts/`,
  and `rep-docs/`. `termide/` and `editor/` — vendored TermIDE — are **MIT**
  ([text](./termide/LICENSE)).

The root [`LICENSE`](./LICENSE) states the split and reproduces the MIT text
that governs everything outside `retired/zetawork/`. Derived and vendored
projects keep their own licences and are listed in
[`THIRD-PARTY-NOTICES.txt`](./THIRD-PARTY-NOTICES.txt). Zeta's copyright lines
mark Zeta's modifications and additions only; upstream notices and licence
texts remain in force for the upstream portions. The licence text is not
translated.

**English** · [简体中文](rep-docs/README.zh-CN.md)
