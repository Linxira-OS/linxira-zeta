<p align="center">
  <img src="./assets/zeta-mark.svg" width="360" alt="Zeta">
</p>

<p align="center">
  <a href="https://github.com/Linxira-OS/linxira-zeta/releases"><img src="https://img.shields.io/badge/zeta-1.5.2-8B5CF6?style=flat-square" alt="Zeta version"></a>
  <img src="https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun&logoColor=white" alt="Runtime: Bun">
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="Language: TypeScript">
  <img src="https://img.shields.io/badge/native-Rust-dea584?style=flat-square&logo=rust&logoColor=white" alt="Native: Rust">
  <a href="https://github.com/Linxira-OS/linxira-zeta/actions"><img src="https://img.shields.io/github/actions/workflow/status/Linxira-OS/linxira-zeta/ci.yml?style=flat-square" alt="CI"></a>
</p>

**English** · [简体中文](rep-docs/README.zh-CN.md)

Zeta is an agent workspace suite: **Z Work Studio**, the browser workbench
served by the CLI (`zetacode serve`), together with the coding agent
(`zetacode`), the terminal IDE (`zetaide`), and the editor payload they share.
It is an **agent development environment (ADE)**, not an IDE with a chat pane:
the session is the unit of work, and every panel is a surface the agent can
use. Linux is the primary platform; Windows x64 is supported; macOS is not
built. There is no Rust desktop UI: the desktop editions host the same browser
workbench.

Zeta is a downstream fork of [OMP](https://github.com/can1357/oh-my-pi),
licensed MIT. The integrated runtime source is OMP **v18.22.0**. Z Work Studio
is a maintained fork of
[OMP Studio](https://github.com/the-snowpear/omp-studio); its **v0.2.1** source
ancestry is integrated while full acceptance and CI are still pending.
`zetaide` vendors [TermIDE](https://github.com/termide/termide) **0.49.0**.
Upstream copyright notices and licence texts remain in [`LICENSE`](./LICENSE)
and [`NOTICE`](./NOTICE); per-tree modification records are in
[`THIRD-PARTY-NOTICES.txt`](./THIRD-PARTY-NOTICES.txt).

## Quick start

Install the CLI and serve the workbench in your browser (Node 18+ or Bun):

```sh
npm i -g @linxiraos/zeta      # or: bun add -g @linxiraos/zeta
zetacode serve                # serves Z Work Studio on loopback
```

Z Work Studio ships inside that package at `dist/web-app`; `ZETA_WEB_APP_DIR`
overrides the renderer for a custom build. `zetacode serve` is the supported
entry point. Install the terminal IDE separately:

```sh
npm i -g @linxiraos/ide       # zetaide — terminal IDE
```

The editor is a workbench pane, not a standalone tool: `@linxiraos/editor` is a
reserved package name whose payload is not published today.

The desktop editions package the same runtime and launch the bundled
`zetacode serve`. The browser edition hands the served URL to the default
browser; the Electron edition loads the same server in its window. Both reuse
the standalone server's existing HTTP authentication and need neither Bun nor
Node on the target machine. There is no Rust desktop UI. See
[`docs/desktop-app.md`](./docs/desktop-app.md).

From a source checkout:

```sh
bun install
bun run build:native
bun run dev
```

## The suite

| Command    | Package           | What it is                                                |
| ---------- | ----------------- | --------------------------------------------------------- |
| `zetacode` | `@linxiraos/zeta` | Coding agent CLI; `zetacode serve` opens Z Work Studio    |
| `zetaide`  | `@linxiraos/ide`  | Terminal IDE (TermIDE, vendored Rust)                     |

Every command launches standalone with its own `--help`. Z Work Studio is the
workbench: the page served by `zetacode serve` shares the CLI's runtime, host
contract (`/api/v1/*`), and settings, and hands coding and editing off to
`zetacode` and `zetaide` instead of re-implementing them. The `zetawork` /
`zeta` bins still exist in the paused `@linxiraos/main` package; the name is
reserved for the main/super-agent surface, and no Rust GUI ships under it.

## Coverage

Coverage is measured and reviewed, not gated by a threshold. The baseline
(2026-11-03), loaded-file caveat, and per-package metrics are in
[Repository and development](rep-docs/development.md#coverage); maintainer
policy is in [`.github/MAINTAINERS.md`](./.github/MAINTAINERS.md).

## Documentation

- [Product and platform](./rep-docs/product.md) — the suite, Z Work Studio and
  its desktop editions, the coding agent, ADE model, capabilities, and platform
  support.
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
| [OMP](https://github.com/can1357/oh-my-pi) (oh-my-pi), MIT | `v18.22.0` | the runtime tree: agent, tools, TUI, model catalog, wire protocol |
| [OMP Studio](https://github.com/the-snowpear/omp-studio), MIT | `v0.2.1` source ancestry (acceptance and CI pending) | the web UI: renderer, client, and the host contract it speaks |
| [TermIDE](https://github.com/termide/termide), MIT | `0.49.0` | `zetaide` and the built-in editor pane |

Further upstreams shaped earlier work and stay credited:
[Pi](https://github.com/earendil-works/pi) / [Pi Web](https://github.com/agegr/pi-web)
as semantic port sources, and [OMP Web](https://github.com/17380936778/omp-web) as
the origin of the frozen `web-ui/` snapshot. Per-tree ledgers and the full fork
declaration are in [`THIRD-PARTY-NOTICES.txt`](./THIRD-PARTY-NOTICES.txt).

## License

Zeta carries two licences, split by path:

- `main/` — the paused Rust workbench — is **AGPL-3.0-only**
  ([text](./main/LICENSE)).
- Everything outside `main/` is **MIT**, including `packages/`, `crates/`,
  `sdk/`, `web-app/`, `desktop/`, `docs/`, `document/`, `scripts/`, and
  `rep-docs/`. `termide/` and `editor/` — vendored TermIDE — are **MIT**
  ([text](./termide/LICENSE)).

The root [`LICENSE`](./LICENSE) states the split and reproduces the MIT text
that governs everything outside `main/`. Derived and vendored projects keep
their own licences and are listed in
[`THIRD-PARTY-NOTICES.txt`](./THIRD-PARTY-NOTICES.txt). Zeta's copyright lines
mark Zeta's modifications and additions only; upstream notices and licence
texts remain in force for the upstream portions. The licence text is not
translated.

**English** · [简体中文](rep-docs/README.zh-CN.md)
