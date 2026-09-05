# Zeta Development Rules

## Zeta Direction

Zeta is an OMP downstream distribution. The runtime tree, package layout, Bun
workflow, and internal `@linxiraos/*` package names intentionally follow OMP so
that OMP updates remain mergeable. Four upstreams, fixed roles:

- **OMP (oh-my-pi, `omp-upstream`)** — the runtime tree, integrated only at
  official release tags (see OMP Release Sync Policy below).
- **Pi (`pi-upstream`)** — semantic-port source for feature work, never a raw
  merge source (`port/pi/<scope>` branches; preserve intentional OMP
  divergence).
- **OMP Web (`omp-web-upstream`)** — source of the `web-ui/` snapshot.
- **Pi Web (`pi-web-upstream`)** — semantic-port source for web features
  (`port/pi-web/<scope>` branches).

- `main` is the Zeta product branch.
- `sync/omp` tracks `omp-upstream/main` and must remain an unmodified OMP
  tree; OMP releases integrate into `main` only through short-lived
  `sync/omp-release/<release>` branches.
- `web-ui/` is a standalone OMP Web snapshot with its own package manager,
  lockfiles, and rules (`web-ui/AGENTS.md`); it is not a root Bun workspace
  package. It must never carry its own GitHub workflow — GitHub only executes
  workflows from the repository root, so all web-ui checks live in the root
  `.github/workflows/ci.yml` (see `document/release.md`).
- `temp/` holds local reference clones only. It is ignored and must never be
  committed.

## OMP Release Sync Policy

Zeta integrates OMP only at complete, official OMP release tags. This is a
hard release-boundary rule, not a suggestion.

- The user must name the exact upstream tag (for example, `v17.2.11`). Never
  infer a "latest" release or substitute `omp-upstream/main`.
- Before integration, verify the exact remote tag name and its peeled commit
  SHA with `git ls-remote --tags omp-upstream refs/tags/<tag>` and record that
  immutable SHA in the sync ledger. If a locally fetched tag disagrees with
  the remote, stop and escalate — never force-update or silently accept a
  moved release tag.
- Integration starts from `main` on a short-lived `sync/omp-release/<release>`
  branch (preferably in an isolated worktree) as a real non-squash merge of
  the verified tag; afterward `git merge-base --is-ancestor <tag-commit> HEAD`
  must succeed, proving the full upstream release is in history.
- Never integrate raw upstream commits, `omp-upstream/main`, arbitrary SHAs,
  individual files, partial diffs, cherry-picks, rebases, or squash merges;
  never skip incoming files to ease a sync. `sync/omp` is an unmodified mirror
  — fast-forward from upstream only, never merged into `main`.
- Resolve conflicts inside the complete tag merge through documented
  decisions; Zeta brand/package/Bun/CI/product adaptations are separate
  commits after the merge. Never use later untagged upstream work to resolve
  conflicts.
- **Tests are merged as contract, not as ours-vs-theirs text.** When an
  upstream commit changes implementation AND its tests (or docs), accept the
  pair wholesale; keeping a Zeta-side old assertion next to merged upstream
  behavior tears the contract (v17.2.11: `38b61ae342` moved retry-after delay
  30s → 200ms while the merge kept our old `delayMs: 30_000` — red CI). Every
  incoming test file touched by the merge is diffed against its `v<tag>`
  version and resolved per-file.
- **No `.omp` compatibility surface.** Zeta's config dir is `.zeta` and
  `~/.zeta` only; upstream tests/docs carrying `.omp` paths are adapted to
  `.zeta` during the merge and the decision recorded in the ledger.
- The product front door (root `README.md`, logo assets, product name,
  homepage, install instructions, public examples) is Zeta-owned: never skip
  its upstream history; follow the complete merge with a separate, documented
  Zeta branding-overlay commit that restores the approved presentation.
- Every release sync updates `document/upstream-sync.md` with the prior
  baseline, source tag, source SHA, Zeta starting commit, conflict decisions,
  checks, and final merge commit. A release sync reaches `main` only after
  its focused checks and required CI pass.
- Sync automation must require an explicit `--tag <tag>`, reject branch names
  and bare SHAs, verify the remote tag before merge, and produce a
  merge-tree/conflict report before changing a product branch.

Baseline references, the sync procedure, and the upstream OMP porting guide
live in `document/upstream-sync.md` and `document/porting-from-pi-mono.md`.

### 六阶段管线（摘要）

完整 tag 合并 → 结构修复（scope/catalog/sentinel/lockfile；gate:
`check-version-consistency` + `check:ts`）→ 品牌 overlay（`bun scripts/brand/
brand-overlay.ts`，脚本已入库）→ 逐 bucket 测试契约 resolve → brand-check 归零
+ 全测试绿 → 归纳回规则表/AGENTS。逐阶段执行细节见 `document/merge-playbook.md`。

## Zeta Brand Surface Registry (merge-protected)

Zeta owns its product brand surface. Each upstream OMP merge must re-check
this table row by row and restore the Zeta canonical form wherever the merge
pulled an OMP (`π` / `PI_LOGO` / `@oh-my-pi` / `.omp`) value back in. This is
a hard merge rule — the v18.0.3 merge (c5ceed6285) silently reverted the ζ CLI
brand, which this registry exists to prevent. Mechanical enforcement lives in
`scripts/brand/` (usage: `document/merge-playbook.md`).

| Surface | Canonical | Guard |
|---|---|---|
| CLI 终端标题品牌字符 | `ζ`（title-generator.ts） | 上游重引 `π` 即恢复 + 两测试 |
| CLI welcome/splash/outro 字符画 | `ZETA_LOGO`（ζ 形）+ wordmark `"Z e t a"` | 不接受上游 `PI_LOGO` |
| `icon.omp` unicode 预设（symbols.ts） | `ζ`（ascii 预设 `zeta`） | 重引 `π`/`pi` 即恢复；nerd 预设 `U+F0D57` 保留（v18.0.10 决议） |
| `icon.pi`（symbols.ts） | `π` | 保留——pi-provider 图标非品牌 |
| latex-to-unicode π 条目 | `π` | 保留——数学转换 |
| 配置目录 | `.zeta` / `~/.zeta` | 无 `.omp` 别名 |
| npm scope | `@linxiraos/*`（pi-coding-agent→zeta 等） | 上游 `@linxiraos/*` 全量改写 |
| Native 哨兵 | `__piNativesV1_X_Y` | 保留 Zeta 版本线 |
| Native Tokio 安装导出 | `__ompInstallTokioRuntime` | crate/index.js/loader 三方一致；勿 sweep 成 `__zeta*`（v18.0.10 改断，Tokio 静默不装） |
| `/language` `/tracking` | builtin-zeta.ts | 合并后恢复 registry spread |
| 插件清单目录 | `.omp-plugin` | 刻意保留——OMP/Claude 兼容面，勿 sweep |
| 中继/分享 URL | `my.omp.sh` | 共享 OMP 基础设施，不品牌化 |
| 安装提示 URL | `https://omp.sh/install` | 共享基础设施，勿改 |
| 品牌残留守卫 | `bun scripts/brand/brand-check.ts`（已进 CI check job） | 机械规则进 `scripts/brand/brand-rules.ts`，散文只留判断 |
| 产品前门（README/logo/名称/主页/安装文档） | Zeta 产品面 | 完整合并后单独 branding-overlay commit |

## Post-Merge Release-Surface Checklist (merge damage classes)

每次 OMP release 合并都反复砸坏同一批 release surface：merge 本身"成功"，`main`
却已不可构建。推送 sync 分支前必须逐类检查（v18.0.9 全部命中）。

| # | 损伤类别 | 症状 / 规律 | 修复规则 |
|---|---|---|---|
| 1 | root `workspaces.catalog` 的 `@linxiraos/*` 键被覆盖：版本写成上游 OMP 版本（v18.0.9 曾写 8 个键为 `18.0.9`），或键名被改回陈旧旧名（`hashline`/`omp-stats`/`pi-coding-agent`/`snapcompact`） | CI 每个 job 死在 `Run ./.github/actions/bun-install`：`No version matching "18.0.9" found for specifier "@linxiraos/pi-natives"` —— 版本线损伤指纹，不是测试失败 | 全部 14 个键 = 当前 Zeta 统一键名 + 版本线；`bun scripts/check-version-consistency.ts` 验证 |
| 2 | Cargo workspace 版本 + natives 哨兵被拉回 OMP 线（`Cargo.toml` workspace version、`crates/pi-natives/src/lib.rs` 的 `__piNativesVX_Y_Z`、committed bindings `packages/natives/native/index.{js,d.ts}`） | `check-version-consistency.ts` 报 `expected 1.1.5` / `missing __piNativesV1_1_5` | `bun scripts/set-version.ts <当前 Zeta 版本>` 整线对齐，再 `bun install` 刷新 lockfile |
| 3 | OMP 包名经机械 scope 改写泄漏（上游包名 `omptype` → `@linxiraos/omptype`，而 Zeta 发布名是 `@linxiraos/pi-omptype`） | `bun check:ts` 报 `Cannot find module '@linxiraos/omptype'`；npm registry 无此包 | 全库 grep：每个 `@linxiraos/<name>` import 必须能在 `workspaces.catalog`/npm 找到；对上游包名做映射改写，不是 scope 替换 |
| 4 | 冲突解决时静默丢弃 Zeta-only 代码。已知清单：AgentSession 会话层 mode API（`ModeId`/`getModeState`/`enterMode`/`exitMode`/`enterPlanMode`/`exitPlanMode`/`enterGoalMode`/`exitGoalMode`/`enterVibeMode`/`exitVibeMode`/`getStateVersion`/`bumpStateVersion`/`getPlanFileContent`/`resetModeTransientState`/`flushPendingModelSwitch`/`restorePlanPreviousModel` + `#stateVersion`/快照字段 + `state_version_changed` 事件）；`sdk.ts` 的 `channelSend`/`workspaceRun`/`imControl` sinks；IRC auto-reply（`setIrcAutoReplyListener` + `IrcBridgeHost.onAutoReply` 接线）；`utils/dirs.ts` tracking 路径 helpers | mode API 刻意存在两层：`InteractiveMode`（CLI）**和** `AgentSession`（web-gateway/ACP 外部客户端，headless）。会话层丢失只让 `web-gateway/agents.ts`/`zeta-server.ts` 编译失败，测试跑不到——`bun run check:ts` 是探测器 | 逐项恢复（上游无这些 API，源是合并前 Zeta 基线），恢复后 `check:ts` 零错误 |
| 5 | 本地预编译 natives `.node`（不入库）落后于合并后 bindings（合并新增 natives 函数如 `vcsGitDiscover`，本地旧二进制缺符号） | 本地测试报 `api().vcsGitDiscover is not a function`（status-line/mode 测试成批失败）；CI bazel 现场构建，无此问题——纯本地噪声 | 本地重建：`packages/natives` `bun run build`（Windows 需 VS Build Tools 开发者 shell；WSL：`pacman -S bun` + glibc ≥ 2.44 + ninja；rustup 慢用 `RUSTUP_DIST_SERVER=https://mirrors.ustc.edu.cn/rust-static`） |
| 6 | 上游测试携带 `.omp` 配置目录契约原样合入（`dirs-cache` 的 `$XDG/omp/cache`、`acp-agent`/`mcp-config-scope-dedup`/`sdk-skills`/`tools/gh` 的 fixture 路径），源码只解析 `.zeta` | 只在 Linux/XDG 分支生效：Windows 本地全绿，push 云端 Linux CI 才爆——`bun test` 全绿 ≠ 合并适配完整 | 每个触碰的测试文件对照 `v<tag>` 版本逐文件 resolve；grep `"\.omp"`（排除刻意保留的 `.omp-plugin`）必须为 0 |
| 7 | 上游 CI 基础设施原样合入：`runs-on: omp-kata`（上游自有 runner label，Zeta 仓库无此 runner）及上游产物命名（如 release 矩阵的 `binaries/omp-*`，v18.1.10 曾致 darwin/linux binary job 首个 tag run 即崩） | 非 tag run 跳过受影响 job 时全绿；tag release run 的 job 无限排队（runner 不存在）或冒烟步骤找不到产物 | `runs-on` 一律 GitHub 云（`ubuntu-22.04`/`macos-14`）；产物命名以 `scripts/ci-release-build-binaries.ts` 与安装器（`zeta-cli-*`）为准；守卫：`grep omp-kata .github/workflows/ci.yml` 只允许注释，`bun scripts/brand/brand-check.ts` 归零 |

**Triage 指纹**：所有 CI job 死在 `Run ./.github/actions/bun-install` ⇒ 版本线/catalog 损伤（第 1、2 类），先跑 `bun scripts/check-version-consistency.ts`，不要去翻测试日志。tag run 的 binary/release job 崩或排队数小时 ⇒ 第 7 类，查 `runs-on` 与产物命名。

**推送 sync 分支前的最低门槛**：`bun scripts/check-version-consistency.ts` 零漂移 + `bun run check:ts` 零错误 + 第 3 类 grep 扫描通过 + `bun scripts/brand/brand-check.ts` 归零（exit 0）。四者都绿才允许 push。

## Documentation Layout

- `docs/` — **runtime documentation, packaged with the product**: embedded
  into binaries and the npm bundle (`PI_DOCS_EMBED`), served over
  `omp://docs/`. Covers tools, skills, protocols, configuration, Zeta
  features.
- `document/` — **internal development and process documentation, never
  packaged**: `roadmap.md`, `upstream-sync.md`, porting guides, merge
  playbook, architecture internals. Root `README.md` is the product front
  door and links both trees; `web-ui/README.md` is the web-ui front door.
- Moving a file `docs/` → `document/` removes it from the packaged corpus
  automatically (`generate-docs-index.ts` globs only `docs/`); update every
  cross-reference. Released CHANGELOG entries are immutable and keep their
  old links.
- Rule of thumb: how the *code* works or how to *use* the product → `docs/`;
  *why* decisions were made, dev process, release mechanics, internal plans →
  `document/`. `roadmap.md` lives in `document/` — do not recreate it under
  `docs/`.

## Planning Discipline

Agent sessions follow the product's plan-mode doctrine
(`packages/coding-agent/src/prompts/system/plan-mode-active.md`): a plan is an
**execution spec, not a design doc**. Decision-completeness > brevity — a plan
that leaves an implementer choice open has failed; padding sections
(Non-Goals / Alternatives / Risks) are noise, not rigor.

- **Decision-complete.** Every load-bearing choice (approach, exact target,
  signature, path, fallback) is stated; a fresh implementer executes
  top-to-bottom without re-deriving. Depth follows change. Multi-round plans
  are amended in place, never re-derived from memory.
- **Self-contained.** Never reference the planning conversation; a different
  task gets a new plan file.
- **Storage routing.** Plan artifacts are session-scoped product state,
  written under the userdata root (`local://` resolves to the session
  artifacts dir under `~/.zeta`), never into the repository working tree.
  With Tracking enabled, the tracking layer mirrors the durable plan into
  `<project>/.zeta/tracking/` (`document/web-ui-modernization.md` §5) — the
  only project-local copy.
- **Prune completed plans.** Once a plan's work has landed, its document is
  deleted; durable outcomes are encoded in AGENTS.md registries and the
  roadmap. `document/` stays lean: core references plus the one active spec
  per in-flight track.

## Default Context

This repo contains multiple packages, but **`packages/coding-agent/`** is the primary focus. Unless otherwise specified, assume work refers to this package.

**Terminology**: When the user says "agent" or asks "why is agent doing X", they mean the **coding-agent package implementation**, not you (the assistant). The coding-agent is a CLI tool — questions about its behavior refer to code in `packages/coding-agent/`, not your current session.

### Package Structure

| Package                 | Description                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `packages/ai`           | Multi-provider LLM client with streaming support                                        |
| `packages/catalog`      | Model catalog: bundled models.json, provider descriptors, model identity/classification |
| `packages/agent`        | Agent runtime with tool calling and state management                                    |
| `packages/coding-agent` | Main CLI application (primary focus)                                                    |
| `packages/tui`          | Terminal UI library with differential rendering                                         |
| `packages/natives`      | Bindings for native text/image/grep operations                                          |
| `packages/stats`        | Local observability dashboard (`omp stats`)                                             |
| `packages/omptype`      | ArkType-compatible schema validation with a lazy JIT runtime                            |
| `packages/utils`        | Shared utilities (logger, streams, temp files)                                          |
| `crates/pi-natives`     | Rust crate for performance-critical text/grep ops                                       |

### Code Location Rules — desktop vs web-ui vs gateway

Three top-level surfaces have **distinct homes**. Put code only where it belongs;
never guess from a feature's name. When a task spans surfaces, split the change
across the correct directories.

| Surface | Location | Engineering rules |
|---|---|---|
| **Desktop shell** (Electron: tray, autostart, window lifecycle, serving the built web-ui + stats) | repo root `desktop/` | Standalone Electron project, **not** a Bun workspace package. Own `package.json`, `package-lock.json`, `electron-builder.yml`, `scripts/`, `src/main.ts`. Install with `npm`/`npm ci`, build with `electron-builder`. Code here talks to the backend only over HTTP (`http://127.0.0.1:30141` web-ui, `http://127.0.0.1:3847` stats). It must never import from `packages/*` or `web-ui/*` source — it launches the built runtime via `resolveServeCommand()`. |
| **Web UI** (Next.js app: components, pages, client libraries) | repo root `web-ui/` | Standalone OMP Web snapshot, **not** a root Bun workspace package. Own package manager + lockfiles; read `web-ui/AGENTS.md` for its rules. All React components/pages/hooks/client helpers live here (`web-ui/components/`, `web-ui/lib/`, `web-ui/hooks/`). Talks to the backend only via `fetch` to the gateway `/api/*` on `http://127.0.0.1:30141`. Never place `.ts` server code or Electron code here. |
| **Server-side gateway** (REST API handlers behind the web-ui runtime) | `packages/coding-agent/src/server/web-gateway/` (one handler module per resource, e.g. `settings.ts`, `models.ts`, `open.ts`, `web-config.ts`) | Bun runtime code. Route regexes live in `packages/coding-agent/src/server/web-gateway.ts` (`*_RE` constants + dispatch in `webGatewayFetch`). Handler modules import from `packages/coding-agent/src/**` only. |
| **Channel / bot runtime** (WeChat/Feishu/Telegram, plan-image, workspace routing) | `packages/coding-agent/src/channels/` | Bun runtime, embedded in `zeta serve` (`packages/coding-agent/src/server/zeta-server.ts`). Channel tools (`channel_send`, `workspace_run`) live in `packages/coding-agent/src/tools/`. |
| **Config layer** (web.yml: tray/autostart/channels/remote) | `packages/coding-agent/src/config/web-config.ts` | Bun runtime, read by both the gateway and (via `zeta serve` HTTP) the desktop shell. |

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
- **CI** (`desktop_linux`/`desktop_windows`/`desktop_mac` jobs): `npm ci` (web-ui
  + desktop deps) → `npm test` (platform contracts) → `npm run dist` (= build +
  `prepare:runtime` + `package-desktop`) → smoke → upload `zeta-desktop-*` assets.

**Hard rules:**
- Electron/Tray/autostart code goes in `desktop/src/main.ts` — never in `web-ui/`, never in `packages/`, never in a new directory under `packages/coding-agent/desktop/` (that path does not exist).
- React components/pages/hooks go in `web-ui/` — never in `packages/*`, never in `desktop/`.
- Gateway REST handlers go in `packages/coding-agent/src/server/web-gateway/` and are registered in `web-gateway.ts` — never inline in `web-ui/` or `desktop/`.
- `desktop/src/main.ts` already owns `resolveServeCommand()`, `createWindow()`, `buildMenu()`, `boot()`, and the `WEB_UI_URL`/`STATS_URL` constants. Extend it in place; do not rewrite it wholesale.

**Catalog import convention**: code in this repo imports catalog _values_ (bundled models, model-thinking helpers, identity, descriptors, model manager/cache) from `@linxiraos/pi-catalog/<module>` — never via `@linxiraos/pi-ai`. The pi-ai barrel re-exports only the model/effort _types_ its own signatures use (`Model`, `Api`, `ThinkingConfig`, `Effort`, …); type-only imports of those from `@linxiraos/pi-ai` are fine.

## GitHub

Unless user tells you exactly what to write:

- **Never comment on GitHub** (issues, PRs, discussions).
- **Never create issues on GitHub**.

## Feature Branch Workflow (mandatory)

Any new-direction development (new features, new surfaces, refactors that are
not pure fixes to `main`) MUST follow the offline-branch workflow:

1. **Create a local offline branch first** — never develop new directions
   directly on `main`. The branch name MUST be designed up front when the
   feature plan is written (e.g. `feat/web-ui-next`, `feat/<scope>`); plans
   MUST name their branch.
2. Work and commit on that branch locally until functionally complete.
3. **Before EVERY push of an integration branch** (`sync/omp-release/*`,
   `port/*`, `feat/*`): merge the latest `main` into it first
   (`git merge main`), then run the local minimum gate —
   `bun scripts/check-version-consistency.ts`, `bun run check:ts`, biome on
   the changed files, plus a re-run of any suite that was red in the last CI
   round. Never push a branch that is behind `main`; a PR CI failure triage
   starts with "is this already fixed on `main`, and is `main` fully merged
   into this branch?" before touching the branch itself.
4. Push the branch to `origin`, open a PR, and only merge after CI passes.
5. Merge to `main` on the remote (cloud), then merge the same branch into
   local `main` to keep them in sync.
6. Delete the branch after the merge (both remote and local).

`main` stays reserved for released/stable work; a new direction only lands on
`main` via this merge path, never by committing directly to it.

## Commands

- NEVER commit unless asked.
- Never use `tsc`/`npx tsc` — always `bun check`.
- Never run `cargo test` directly for Rust tests — use `bun run test:rs`. It runs `cargo nextest run` (config: `.config/nextest.toml`) followed by a `cargo test --doc` pass, because nextest does not execute doctests. The doctest pass currently executes nothing (pi-natives is a `cdylib`, which rustdoc skips; pi-builtins' examples are `ignore`d vendored uutils docs) and exists so the first runnable doctest added to a lib crate is actually run.
- Merge commits (maintainer merges of PRs) follow: `Merge PR #<number>: <conventional PR subject> (@<author>)` — e.g. `Merge PR #6386: feat(catalog): add native Meta Model API provider (@eggpeat)`.

## 文档路由

三个参考文档由本文件拆分而来（2026-09），规则效力等同正文：

- `document/dev-conventions.md` — 日常编码约定：Code Quality、Central
  Utilities、Bun Over Node、模型策略 KDL、Generated Files、Logging and CLI
  Output、TUI Sanitization、Rust Build Profiles、Testing Guidance、Changelog
  （含 pre-tag gate）。
- `document/release.md` — CI and Release（trigger discipline、CI watching、
  release tag 与 update log、Version line tooling）+ Upstream Reference
  Hygiene（云端 backup、分支/tag 保留策略）。
- `document/merge-playbook.md` — OMP release 合并操作手册：六阶段管线细节、
  品牌 overlay 与守卫使用（`scripts/brand/`）、逐 bucket 测试契约 resolve、
  预存 main 欠账清单。
