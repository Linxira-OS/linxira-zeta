<!-- 从根 AGENTS.md 原文移出（2026-10-25 精简，未改写）。代码落点（渲染器/宿主/网关/频道/工作台）与上游面 vs Zeta 自有面的路径归属。 -->

# 代码落点与路径归属

> 一句话版在根 AGENTS.md 的「代码落点」；**本文是展开版**。
> **2026-11-05 渲染器切换**：产品 UI 是 `web-app/`（Vite 7），`web-ui/` 冻结只作快照；
> Studio 宿主契约在 `packages/coding-agent/src/server/studio-host/`。新增代码按本表，
> 不要往 `web-ui/` 或 `desktop/` 里加。

### Code Location Rules — renderer vs host vs gateway

Each surface has a **distinct home**. Put code only where it belongs;
never guess from a feature's name. When a task spans surfaces, split the change
across the correct directories.

| Surface | Location | Engineering rules |
|---|---|---|
| **Studio renderer** (product UI: React components, pages, hooks, styles) | repo root `web-app/` (`src/studio/`) | Vite 7 app with its own `package.json` + `package-lock.json`, **not** a root Bun workspace member (root `workspaces.packages` covers `packages/*`, `plugins/*`, `python/robomp/web`, not `web-app/`). Renderer entry is `web-app/src/studio/main.tsx` (`mountRenderer(element, client)`). It talks to the backend only over `fetch`/WebSocket to `/api/v1/*`. Never place server code here. Build gate: CI `check` job (`npm ci` + `npm run build:ci`); `zeta serve` serves `web-app/dist`. |
| **Frozen Web snapshot** | repo root `web-ui/` | OMP Web snapshot, **not** a root Bun workspace package; own package manager + lockfiles. **Frozen 2026-11-05** — `web_ui_build` retired 2026-11-05, no new features. Legacy installs can still be served as the Next child, and its npm publish leg only runs with the `publish_web_ui` dispatch input. If a cherry-pick must touch it, `web-ui/AGENTS.md` still applies. |
| **Studio host** (`/health`, `/api/v1/{pair,session/revoke,bootstrap,query,command}`, `/api/v1/events` WS) | `packages/coding-agent/src/server/studio-host/` | The browser-facing contract the renderer speaks. `server.ts` owns auth (Origin allowlist, `studio_session` cookie, `X-Studio-CSRF` on mutations, 1 MiB body cap) and routing; `registry.ts` merges operation families and builds the capability manifest (a registered handler is what makes a surface reachable); `bootstrap.ts` builds `ClientBootstrap`; `ops/<family>.ts` maps one domain onto gateway routes; `gateway.ts` is the only path from an operation to Zeta state. `zeta-server.ts` classifies and dispatches — it never answers these routes itself. |
| **Renderer static serving** | `packages/coding-agent/src/server/studio-web-app.ts` | Serves `web-app/dist` with history fallback, immutable hashed assets, no-store `index.html`, and `STUDIO_RENDERER_CSP`; `ZETA_WEB_APP_DIR` overrides the build location. A missing build is the placeholder page, not an error. |
| **Server-side gateway** (REST API handlers behind `/api/*`) | `packages/coding-agent/src/server/web-gateway/` (one handler module per resource, e.g. `settings.ts`, `models.ts`, `open.ts`, `web-config.ts`, `terminal.ts`) | Bun runtime code. Route regexes live in `packages/coding-agent/src/server/web-gateway.ts` (`*_RE` constants + dispatch in `webGatewayFetch`). `terminal.ts` is the WS precedent (upgrade wiring in `zeta-server.ts`, one-time tickets for browser WS auth) — new WebSocket endpoints follow its pattern. Handler modules import from `packages/coding-agent/src/**` only. |
| **Channel / bot runtime** (WeChat/Feishu/Telegram, plan-image, workspace routing) | `packages/coding-agent/src/channels/` | Bun runtime, embedded in `zeta serve` (`packages/coding-agent/src/server/zeta-server.ts`). Channel tools (`channel_send`, `workspace_run`) live in `packages/coding-agent/src/tools/`. |
| **Config layer** (web.yml: tray/autostart/channels/remote) | `packages/coding-agent/src/config/web-config.ts` | Bun runtime, read by both the gateway and (via `zeta serve` HTTP) the desktop shell. |

**Dependency direction (never invert):**

```
web-app/ (Vite, browser) ──HTTP/WS /api/v1/*──▶ studio-host/ ──▶ gateway.ts ──▶ packages/coding-agent/src/**
web-ui/  (Next, frozen)     ──HTTP /api/*──────▶ webGatewayFetch ──▶ packages/coding-agent/src/server/web-gateway/
desktop/ (Electron, active) ──HTTP──▶ zeta serve
```

- **One renderer, one origin**: `zeta serve` is the whole product surface — the
  same origin answers `/api/*`, `/api/v1/*` and serves `web-app/dist`, so the
  Studio pairing cookie stays first-party and the browser needs no proxy.
- **Legacy chain (retired)**: `desktop/` used to embed a Next standalone build of
  `web-ui/` staged by `desktop/scripts/prepare-runtime.mjs`; `web-ui/` is frozen
  and the zetawork installer/archive chain was removed in 2026-11.
  `web_desktop_tests` still runs the desktop/launcher contracts. Do not extend
  the legacy chain; `desktop/` now packages Work Studio through `release_desktop`.
- **The renderer never shares code with the host**: only HTTP/WS. `web-app`
  imports its vendored `@linxiraos/studio-*` packages; it never imports
  `packages/coding-agent/**`.

**Hard rules:**
- React components/pages/hooks go in `web-app/src/studio/` — never in `web-ui/` (frozen), never in `packages/*`, never in `desktop/`.
- `/api/v1/*` semantics go in `studio-host/` (`ops/<family>.ts` for a new operation); never inline in `zeta-server.ts`, never in the renderer.
- Gateway REST handlers go in `packages/coding-agent/src/server/web-gateway/` and are registered in `web-gateway.ts` — never inline in `web-app/` or `desktop/`.
- `desktop/src/main.ts` owns `resolveServeCommand()`, `createWindow()`, `buildMenu()`, `boot()`, and the `WEB_UI_URL`/`STATS_URL` constants — do not extend it with the product surface (Work Studio owns the UI).
- `web-ui/` changes are cherry-picks from `omp-web-upstream` only (recorded in `document/upstream-sync.md`); no features.

**Catalog import convention**: code in this repo imports catalog _values_ (bundled models, model-thinking helpers, identity, descriptors, model manager/cache) from `@linxiraos/pi-catalog/<module>` — never via `@linxiraos/pi-ai`. The pi-ai barrel re-exports only the model/effort _types_ its own signatures use (`Model`, `Api`, `ThinkingConfig`, `Effort`, …); type-only imports of those from `@linxiraos/pi-ai` are fine.

---

### 路径归属：上游面 vs Zeta 自有面（2026-10-16 立规）

上游 tag↔tag 差异**只**落在这些路径：`packages/`、`crates/`、`docs/`、`sdk/`，
以及根锁文件与清单（`Cargo.toml`、`Cargo.lock`、`bun.lock`、
`MODULE.bazel.lock`）。下面这些顶层目录**永不参与合并计算**，是 **Zeta 自有面**：

| 自有面 | 是什么 |
|---|---|
| `termide/` | vendored TermIDE = `zetaide`（`@linxiraos/ide`），另有 Zeta 新增的 `termide-editor` bin |
| `editor/` | `@linxiraos/editor` 的 npm 面（载荷 = `termide-editor`） |
| `web-app/` | **产品渲染器**（Vite 7；`src/studio/`、`src/vendor/`、自己的 `package-lock.json`），2026-11-05 起取代 `web-ui` 的渲染层 |
| `web-ui/` | 冻结的 OMP Web 快照（仅 cherry-pick；`web_ui_build` 已于 2026-11-05 退役，不再有独立构建门禁——只有安装包 job 仍构建它） |
| `desktop/` | Work Studio 桌面版（Electron + 无浏览器引擎版；由 `release_desktop` 打包） |
| `.gitea/` | Gitea 本地 CI 镜像（见 `document/local-ci.md`） |

- 改/删这些目录**只按路径判定**：不需要与上游协商，也不会与同步分支冲突
  （判据是 `git diff --name-only <prev-tag> <tag> -- <path>` 为空）。
- 因此"一次只做一个集成分支"**只约束同一面内部**；Zeta 自有面的分支可以与上游
  同步并行（2026-10-16 用户裁决，当日四轨并行即按此执行）。
- `termide/crates/**` 是 vendored 面板库，只在此处维护；对 vendored
  快照的任何偏离都要在 `termide/VENDOR.md` 的偏离清单登记一行。
- 新增/删除一个 CI job 必须同步三处（`ci.yml` / `local-ci.yml` 或 `EXCLUDED` /
  `document/local-ci.md` 的 job map），见该文档的同步规则。
