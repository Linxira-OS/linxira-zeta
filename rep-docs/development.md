# Repository and development

**English** · [简体中文](development.zh-CN.md)

This page describes the repository layout, documentation trees, development
commands, and the measured coverage baseline. Product behavior and supported
platforms are in [Product and platform](product.md); maintenance and upstream
policy are in [Ownership and attribution](ownership.md).

## Layers

The product has four layers and one rule: **the runtime depends on nothing
above it, and no front-end depends on another front-end.** The HTTP gateway is
an adapter, not the hub — it exists so a browser can talk to the runtime, not
because anything else needs it. `document/architecture-layers.md` is the full
contract; this is the orientation.

| Layer | Where | What it does |
| --- | --- | --- |
| Core runtime | `packages/coding-agent/src/` (+ `packages/agent`, `packages/ai`, `packages/tui`, `packages/channels`, `packages/stats`) | Sessions, tools, extensions/plugins, memory, skills, IRC/mesh. Runs in-process; no HTTP, no UI. |
| Host | `packages/coding-agent/src/server/` (`zeta-server.ts`), `packages/coding-agent/src/channels/` | Wires a session to its workspace, IM channels, the router, config and the default workspace. Nothing here serves HTTP. |
| Front-ends | `web-app/` (Z Work Studio, browser), `packages/coding-agent/src/commands/` (CLI/TUI), `termide/` (`zetaide`) | Each one is a client of the host. IM bots are a front-end too. |
| HTTP adapter | `packages/coding-agent/src/server/web-gateway/` | REST/SSE/WS over the host. `zetacode serve` starts it; the browser UI and remote clients consume it. |

## Repository map

| Path | Contents |
| --- | --- |
| `packages/` | The published runtime packages (`@linxiraos/*`): coding-agent, ai, agent, tui, catalog, stats, channels, wire, mnemopi, natives, utils, omptype, browser-relay. |
| `main/` | Paused Rust line, its own Cargo workspace: the TUI (`crates/zeta-main`), the egui GUI (`crates/zetawork-gui`), `crates/sysmon`. Not a product surface; releases do not build it. |
| `termide/` | Vendored TermIDE panel library — the panels both workbenches embed — plus the `zetaide` entry (`@linxiraos/ide`). Deviations from the vendored snapshot are logged in `termide/VENDOR.md`. |
| `editor/` | The built-in editor pane's npm face. The payload is a `termide-editor` binary; the package declares no command. |
| `crates/` | Rust runtime crates compiled as native addons (`pi-natives`, `pi-ast`, `pi-diff`, `pi-builtins`, …), built by Bazel. |
| `web-app/` | **Z Work Studio**: the product renderer (Vite + React), its own npm project. Ships inside `@linxiraos/zeta` at `dist/web-app`. |
| `web-ui/` | Frozen OMP Web snapshot (2026-11-05): not built, not published, no new features. Not the current renderer. |
| `desktop/` | Desktop packaging and shell for the Electron and browser editions. See `docs/desktop-app.md`. |
| `plugins/` | `official/` first-party plugins (source in-tree, `INDEX.md` registry) and `community/` pointer files. |
| `docs/` | Runtime documentation shipped with the product (`zeta://docs`). |
| `document/` | Internal engineering docs: architecture contracts, merge playbook, release mechanics, roadmap. Never packaged. |
| `rep-docs/` | Public repository documentation for product, development, and ownership; the Chinese README lives here. Not packaged. |
| `scripts/` | Build, release, packaging and the mechanical guards CI runs. |
| `sdk/` | Protocol SDKs (`rust/`, `python/`, `go/`) for embedding the runtime. |
| `python/robomp/` | The containerised agent runner. |
| `infra/`, `bazel/`, `nix/`, `patches/`, `lsp/`, `skills/`, `assets/`, `types/` | Build infrastructure, toolchain files, patch set, LSP server table, bundled skills, image assets, ambient type shims. |

## Plugin layers

A plugin is TypeScript, but what it *shows* is a choice of layer. Pick by what
the surface needs, not by what the plugin is written in:

| Layer | Surface | Use it for |
| --- | --- | --- |
| Behaviour | Any front-end (tools, commands, hooks, messaging) | Work the agent performs. Rendered by nobody; identical in every client. |
| Panel | Not hosted yet | Z Work Studio does not render plugin panels today (no declarative-panel or HTML-page host in `web-app/`). A plugin that needs a surface reaches it through the agent's own tools. |

`zetaide` carries TermIDE's own upstream plugin layer from the 0.49 vendor
bump, separate from Zeta's plugin surface.

## Documentation trees

| Tree | Audience | Packaged? | What belongs there |
| --- | --- | --- | --- |
| `docs/` | Users, operators, extension authors | **Yes** — served at `zeta://docs` | Subcommands, flags, tools, config keys, internal URL surfaces, extension APIs |
| `document/` | Maintainers and contributors | **No** | Architecture, ADRs, roadmap, merge/release procedure, ownership protocol |
| `rep-docs/` | Public repository readers | **No** | Product overview, repository/development guide, ownership and attribution |

Moving content between the trees requires cleaning every cross-reference.
Released CHANGELOG entries are immutable. The authoritative path rule is
`document/maintenance-ownership.md` §1.

## Development

```sh
# Static checks for TypeScript and Rust
bun check

# Coding-agent checks only
bun --cwd=packages/coding-agent run check

# Focused tests
bun --cwd=packages/coding-agent test test/<file>.test.ts
```

From a source checkout, install dependencies and build the native addon first:

```sh
bun install
bun run build:native
bun run dev
```

For Rust changes, use `bun run test:rs`; do not invoke `cargo test` directly.
The primary application lives in `packages/coding-agent/`. Shared runtime
packages include `packages/ai/`, `packages/catalog/`, `packages/agent/`,
`packages/tui/`, and `packages/natives/`. The browser renderer lives in
`web-app/` (its own npm project); the paused Rust workbench lives in `main/`,
and the vendored TermIDE tree under `termide/`.

Contribution requirements, including end-to-end verification and the
human-written PR explanation, are in [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Coverage

Coverage is measured and reviewed, not enforced by a threshold. The first
measured baseline (2026-11-03, local Windows, one-off LCOV run) is:

| Package | Line coverage | Function coverage | Source files reached |
| --- | ---: | ---: | ---: |
| `packages/agent` | 88.0% | 83.5% | 100% |
| `packages/ai` | 89.9% | 92.3% | 98.3% |
| `packages/catalog` | 93.8% | 63.4% | 94.9% |
| `packages/tui` | 73.3% | 77.5% | 90.3% |
| `packages/utils` | 78.7% | 75.1% | 97.0% |
| `coding-agent` core | 29.7% | 23.2% | 66.7% |

The five support packages combined are at **81.2% lines / 79.7% functions**.
`coding-agent` shows a **core sample** only (`test/session`,
`test/session-manager`, `test/config`, `test/core`; 1,003 tests): the full
2,113-file suite did not finish within 40 minutes under coverage
instrumentation. Do not read 29.7% as the whole package.

Bun's LCOV only includes source files a test actually loaded, so these numbers
are **loaded-file coverage**, not whole-repository coverage. Files never
imported are absent from the denominator; the “source files reached” column is
the counterweight. Linux CI numbers differ slightly from this Windows baseline.

Generate the same report locally:

```sh
cd packages/ai
bun test --coverage --coverage-reporter=lcov --coverage-dir=../../coverage/ai
```

Maintainers and contributors must run the **Coverage** GitHub Actions workflow
before a release or a coverage-sensitive merge, and attach its LCOV artifact to
the review/release record. The **Coverage** workflow is report-only: a green
run means the report ran, not that all tests passed; normal CI remains the test
gate. A drop larger than 0.5 percentage points in a package's line coverage
needs an explanation. The policy, current gaps, and ratchet rules are in
[`.github/MAINTAINERS.md`](../.github/MAINTAINERS.md). Coverage is evidence, not
a substitute for exercising the changed behavior.

**English** · [简体中文](development.zh-CN.md)
