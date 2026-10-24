<!-- 从根 AGENTS.md 原文移出（2026-10-25 精简，未改写）。代码落点（桌面/Web/网关/频道/工作台）与上游面 vs Zeta 自有面的路径归属。 -->

# 代码落点与路径归属

> 一句话版在根 AGENTS.md 的「代码落点」；**本文是展开版**，含退役中的 Electron 内嵌架构说明。
> 新增代码不要按本文的 desktop 叙述去扩展——`desktop/` 是待退役遗留。

### Code Location Rules — desktop vs web-ui vs gateway

Three top-level surfaces have **distinct homes**. Put code only where it belongs;
never guess from a feature's name. When a task spans surfaces, split the change
across the correct directories.

| Surface | Location | Engineering rules |
|---|---|---|
| **Desktop shell** (Electron: tray, autostart, window lifecycle, serving the built web-ui + stats) | repo root `desktop/` | Standalone Electron project, **not** a Bun workspace package. Own `package.json`, `package-lock.json`, `electron-builder.yml`, `scripts/`, `src/main.ts`. Install with `npm`/`npm ci`, build with `electron-builder`. Code here talks to the backend only over HTTP (`http://127.0.0.1:30141` web-ui, `http://127.0.0.1:3847` stats). It must never import from `packages/*` or `web-ui/*` source — it launches the built runtime via `resolveServeCommand()`. |
| **Web UI** (Next.js app: components, pages, client libraries) | repo root `web-ui/` | Standalone OMP Web snapshot, **not** a root Bun workspace package. Own package manager + lockfiles; read `web-ui/AGENTS.md` for its rules. All React components/pages/hooks/client helpers live here (`web-ui/components/`, `web-ui/lib/`, `web-ui/hooks/`). Talks to the backend only via `fetch` to the gateway `/api/*` on `http://127.0.0.1:30141`. Never place `.ts` server code or Electron code here. |
| **Server-side gateway** (REST API handlers behind the web-ui runtime) | `packages/coding-agent/src/server/web-gateway/` (one handler module per resource, e.g. `settings.ts`, `models.ts`, `open.ts`, `web-config.ts`, `terminal.ts`) | Bun runtime code. Route regexes live in `packages/coding-agent/src/server/web-gateway.ts` (`*_RE` constants + dispatch in `webGatewayFetch`). `terminal.ts` is the WS precedent (upgrade wiring in `zeta-server.ts`, one-time tickets for browser WS auth) — new WebSocket endpoints follow its pattern. Handler modules import from `packages/coding-agent/src/**` only. |
| **Channel / bot runtime** (WeChat/Feishu/Telegram, plan-image, workspace routing) | `packages/coding-agent/src/channels/` | Bun runtime, embedded in `zeta serve` (`packages/coding-agent/src/server/zeta-server.ts`). Channel tools (`channel_send`, `workspace_run`) live in `packages/coding-agent/src/tools/`. |
| **Config layer** (web.yml: tray/autostart/channels/remote) | `packages/coding-agent/src/config/web-config.ts` | Bun runtime, read by both the gateway and (via `zeta serve` HTTP) the desktop shell. |

> **方向变更（2026-10-15 用户裁决）**：`web-ui/` **冻结**——不再作为独立桌面应用分发
> （Electron 桌面长期起不来：`The Zeta service did not become ready in time.` /
> `The running Zeta service at http://127.0.0.1:30141 did not answer.`，根因是"外部服务端口
> 就绪"这条链），只保留为 **zetawork 桌面应用内部可选的渲染后端**；**桌面应用本体 =
> zetawork**，其家迁到 `desktop/`（现有 Electron 外壳退役中）。上表的 desktop/web-ui 分工
> 按此方向读：Electron 行与"内嵌 Next standalone"链路属**待退役**遗留。渲染方式（原生
> ratatui ／ Web UI）由用户在应用内选择；启动后保底由工作台自己拉起/内嵌 `zetacode`，
> **不依赖外部服务端口就绪**。

**Dependency direction (never invert):**

```
desktop/ (Electron)  ──HTTP──▶  zeta serve (zeta-server.ts)  ──▶  packages/coding-agent/src/**
web-ui/ (Next.js)    ──HTTP──▶  webGatewayFetch (/api/*)     ──▶  packages/coding-agent/src/server/web-gateway/
```

**Desktop ↔ Web UI relationship (nested, not alternatives):** the desktop app is
not a second UI — `desktop/` is an Electron shell that **embeds a standalone
build of `web-ui/`** plus the compiled `zeta` runtime and a bundled Node. One
package, three layers:

```
build (desktop/scripts/prepare-runtime.mjs)
  web-ui: npm run build (NEXT_OUTPUT_STANDALONE=1) ─▶ .next/standalone + .next/static + public
  zeta:   bun run build (packages/coding-agent)    ─▶ zeta binary + Node executable
  ─▶ staged to temp/desktop/staging/zeta/, folded into the Electron app via extraResources

runtime (desktop/src/main.ts)
  spawns `zeta serve` (ZETA_DESKTOP=1) ─▶ serves the embedded web-ui
  window.loadURL(WEB_UI_URL = http://127.0.0.1:30141) ─▶ web-ui /api/* ─▶ webGatewayFetch ─▶ gateway
```

- **One source, two outputs**: the web-ui the desktop embeds is the same source
  and the same build as the browser UI (`NEXT_OUTPUT_STANDALONE=1` makes it a
  self-contained deployment). There is no separate desktop UI codebase —
  `desktop/` holds only the Electron shell.
- **Build-time nesting** (`desktop/scripts/prepare-runtime.mjs`): runs the web-ui
  build, then stages `.next/standalone` + `.next/static` + `public` next to the
  compiled `zeta` binary and `process.execPath` as the bundled Node. The target
  machine needs neither Bun nor Node.
- **Runtime**: `desktop/src/main.ts` launches `zeta serve` and points the Electron
  window at `WEB_UI_URL` (`http://127.0.0.1:30141`); the shell and the web-ui never
  share code — only the HTTP loopback. Web-ui and desktop each depend on the
  gateway side (`packages/coding-agent/src/**`) via HTTP, never via imports.
- **CI** (`desktop_linux`/`desktop_windows` jobs): `npm ci` (web-ui
  + desktop deps) → `npm test` (platform contracts) → `npm run dist` (= build +
  `prepare:runtime` + `package-desktop`) → smoke → upload `zeta-desktop-*` assets. macOS exited the release surface 2026-10-01 — no `desktop_mac` job; do not reintroduce darwin consumers.

**Hard rules:**
- Electron/Tray/autostart code goes in `desktop/src/main.ts` — never in `web-ui/`, never in `packages/`, never in a new directory under `packages/coding-agent/desktop/` (that path does not exist).
- React components/pages/hooks go in `web-ui/` — never in `packages/*`, never in `desktop/`.
- Gateway REST handlers go in `packages/coding-agent/src/server/web-gateway/` and are registered in `web-gateway.ts` — never inline in `web-ui/` or `desktop/`.
- `desktop/src/main.ts` already owns `resolveServeCommand()`, `createWindow()`, `buildMenu()`, `boot()`, and the `WEB_UI_URL`/`STATS_URL` constants. Extend it in place; do not rewrite it wholesale.

**Catalog import convention**: code in this repo imports catalog _values_ (bundled models, model-thinking helpers, identity, descriptors, model manager/cache) from `@linxiraos/pi-catalog/<module>` — never via `@linxiraos/pi-ai`. The pi-ai barrel re-exports only the model/effort _types_ its own signatures use (`Model`, `Api`, `ThinkingConfig`, `Effort`, …); type-only imports of those from `@linxiraos/pi-ai` are fine.

---

### 路径归属：上游面 vs Zeta 自有面（2026-10-16 立规）

上游 tag↔tag 差异**只**落在这些路径：`packages/`、`crates/`、`docs/`、`sdk/`，
以及根锁文件与清单（`Cargo.toml`、`Cargo.lock`、`bun.lock`、
`MODULE.bazel.lock`）。下面这些顶层目录**永不参与合并计算**，是 **Zeta 自有面**：

| 自有面 | 是什么 |
|---|---|
| `main/` | zetawork：TUI（`main/crates/zeta-main/`）+ GUI（`main/crates/zetawork-gui/`），独立 Cargo workspace |
| `termide/` | vendored TermIDE = `zetaide`（`@linxiraos/ide`），另有 Zeta 新增的 `termide-editor` bin |
| `editor/` | `@linxiraos/editor` 的 npm 面（载荷 = `termide-editor`） |
| `web-ui/` | 浏览器远程 UI（降级维护） |
| `desktop/` | 待退役 Electron 壳（不新增代码） |
| `.gitea/` | Gitea 本地 CI 镜像（见 `document/local-ci.md`） |

- 改/删这些目录**只按路径判定**：不需要与上游协商，也不会与同步分支冲突
  （判据是 `git diff --name-only <prev-tag> <tag> -- <path>` 为空）。
- 因此"一次只做一个集成分支"**只约束同一面内部**；Zeta 自有面的分支可以与上游
  同步并行（2026-10-16 用户裁决，当日四轨并行即按此执行）。
- GUI 代码**只落** `main/crates/zetawork-gui/`；TUI 只落 `main/crates/zeta-main/`；
  `termide/crates/**` 是 vendored 面板库，**不在 `main/` 里重写它**；对 vendored
  快照的任何偏离都要在 `termide/VENDOR.md` 的偏离清单登记一行。
- 新增/删除一个 CI job 必须同步三处（`ci.yml` / `local-ci.yml` 或 `EXCLUDED` /
  `document/local-ci.md` 的 job map），见该文档的同步规则。

