# Zeta Development Rules

## Zeta Direction

Zeta is an OMP downstream distribution. The runtime tree, package layout, Bun
workflow, and internal `@linxiraos/*` package names intentionally follow OMP so
that OMP updates remain mergeable.

Zeta derives from four upstreams, each with a fixed role:

- **OMP (oh-my-pi, `omp-upstream`)** — the runtime tree, integrated only at
  official release tags (see OMP Release Sync Policy).
- **Pi (`pi-upstream`)** — semantic-port source for feature work, never a raw
  merge source.
- **OMP Web (`omp-web-upstream`)** — source of the `web-ui/` snapshot.
- **Pi Web (`pi-web-upstream`)** — semantic-port source for web features.

- `main` is the Zeta product branch.
- `sync/omp` tracks `omp-upstream/main` and must remain an unmodified OMP tree.
  Use short-lived `sync/omp-release/<release>` branches to integrate OMP
  releases into `main`.
- `pi-upstream` is a semantic-port source, never a raw merge source. Use
  `port/pi/<scope>` branches and preserve OMP behavior where the projects
  intentionally diverge.
- `web-ui/` is a standalone OMP Web snapshot. It has its own package manager,
  lockfiles, and development rules in `web-ui/AGENTS.md`; it is not a root Bun
  workspace package. Sync it from `omp-web-upstream`, and port Pi Web changes
  through `port/pi-web/<scope>` branches. It must never carry its own GitHub
  workflow — GitHub only executes workflows from the repository root, so all
  web-ui checks live in the root `.github/workflows/ci.yml` (see CI and
  Release below).
- `temp/` holds local reference clones only. It is ignored and must never be
  committed.

## OMP Release Sync Policy

Zeta integrates OMP only at complete, official OMP release tags. This is a
hard release-boundary rule, not a suggestion.

- The user must name the exact upstream tag (for example, `v17.2.11`). Never
  infer a "latest" release or substitute `omp-upstream/main`.
- Before any integration, fetch and verify the exact remote tag name and its
  peeled commit SHA with `git ls-remote --tags omp-upstream
  refs/tags/<tag>`. Record that immutable source SHA in the sync ledger.
  If a locally fetched tag disagrees with the remote, stop and escalate; do
  not force-update or silently accept a moved release tag.
- Product integration starts from `main` on a short-lived
  `sync/omp-release/<release>` branch (preferably in an isolated worktree) and
  uses a real non-squash Git merge of the verified tag. Afterward,
  `git merge-base --is-ancestor <tag-commit> HEAD` must succeed. This proves
  the full upstream release is present in history.
- Never integrate raw upstream commits, `omp-upstream/main`, arbitrary SHAs,
  individual files, partial diffs, cherry-picks, rebases, or squash merges.
  Do not skip incoming files to make a release sync easier.
- `sync/omp` is an unmodified mirror of `omp-upstream/main`, never a product
  integration branch. It may only be fast-forwarded from upstream; it is not
  merged into `main`.
- Resolve conflicts inside the complete tag merge. Preserve intentional Zeta
  behavior through documented conflict decisions, then make any required Zeta
  brand, package, Bun, CI, or product adaptations in separate commits after
  the merge. Do not use later untagged upstream work to resolve conflicts.
- **Tests must be merged as contract, not as ours-vs-theirs text.** When an
  upstream commit changes implementation AND its tests (or docs) together,
  accept the pair wholesale; keeping the Zeta-side old assertion next to the
  merged upstream behavior tears the contract (`v17.2.11` lesson:
  `38b61ae342` moved retry-after delay 30s → 200ms upstream while the merge
  kept our old `delayMs: 30_000` assertion, red CI). For every incoming test
  file touched by the merge, diff it against its `v<tag>` version and resolve
  per-file.
- **No `.omp` compatibility surface.** Zeta's config dir is `.zeta` and
  `~/.zeta` only; we do not maintain legacy `.omp` path aliases — the
  compatibility cost outweighs the value. Upstream tests or docs that carry
  `.omp` paths must be adapted to `.zeta` during the merge and that decision
  recorded in the ledger (e.g. `acp-agent.test.ts` wrote
  `path.join(cwd, ".omp", "agents")`; zeta resolves `.zeta/agents`).
- Treat the root `README.md`, Zeta logo assets, product name, homepage, install
  instructions, and public examples as Zeta-owned product surfaces. A release
  merge must never skip their upstream history; instead, follow the complete
  merge with a separate, documented Zeta branding-overlay commit that restores
  the approved product presentation. Do not let upstream README text become
  the default Zeta front door.
- Every release sync updates `document/upstream-sync.md` with the prior baseline,
  source tag, source SHA, Zeta starting commit, conflict decisions, checks,
  and final merge commit. A release sync reaches `main` only after its focused
  checks and required CI pass.
- Automation must require an explicit `--tag <tag>` argument, reject branch
  names and bare SHAs, verify the remote tag before merge, and produce a
  merge-tree/conflict report before changing a product branch.

Current baseline references and the sync procedure live in
`document/upstream-sync.md`. Before starting an upstream port, read that file and
the upstream OMP guide at `document/porting-from-pi-mono.md`.

## Zeta Brand Surface Registry (merge-protected)

Zeta owns its product brand surface. Each upstream OMP merge must re-check
this table row by row and restore the Zeta canonical form wherever the merge
pulled an OMP (`π` / `PI_LOGO` / `@oh-my-pi` / `.omp`) value back in. This is a
hard merge rule, not a suggestion — the v18.0.3 merge (c5ceed6285) silently
reverted the ζ CLI brand, which this registry exists to prevent.

| Surface | Canonical | Guard |
|---|---|---|
| CLI 终端标题品牌字符 | `ζ`（title-generator.ts） | 上游重引 `π` 即恢复 + 两测试 |
| CLI welcome/splash/outro 字符画 | `ZETA_LOGO`（ζ 形）+ wordmark `"Z e t a"` | 不接受上游 `PI_LOGO` |
| `icon.pi`（symbols.ts） | `π` | 保留——pi-provider 图标非品牌 |
| latex-to-unicode π 条目 | `π` | 保留——数学转换 |
| 配置目录 | `.zeta` / `~/.zeta` | 无 `.omp` 别名 |
| npm scope | `@linxiraos/*`（pi-coding-agent→zeta 等） | 上游 `@linxiraos/*` 全量改写 |
| Native 哨兵 | `__piNativesV1_X_Y` | 保留 Zeta 版本线 |
| `/language` `/tracking` | builtin-zeta.ts | 合并后恢复 registry spread |
| 插件清单目录 | `.omp-plugin` | 刻意保留——OMP/Claude 兼容面，勿 sweep |
| 中继/分享 URL | `my.omp.sh` | 共享 OMP 基础设施，不品牌化 |
| 安装提示 URL | `https://omp.sh/install` | 共享基础设施，勿改 |
| 产品前门（README/logo/名称/主页/安装文档） | Zeta 产品面 | 完整合并后单独 branding-overlay commit |

## Post-Merge Release-Surface Checklist (merge damage classes)

每次 OMP release 合并都反复砸坏同一批 release surface：merge 本身"成功"，
`main` 却已不可构建。推送 sync 分支前必须逐类检查（v18.0.9 全部命中）。

| # | 损伤类别 | 症状 / 规律 | 修复规则 |
|---|---|---|---|
| 1 | root `workspaces.catalog` 的 `@linxiraos/*` 键被覆盖：版本号被写成上游 OMP 版本（v18.0.9 把 8 个键写成 `18.0.9`），甚至键名被合并改回陈旧旧版名（`@linxiraos/hashline`/`omp-stats`/`pi-coding-agent`/`snapcompact`） | CI 每个 job 都死在 `Run ./.github/actions/bun-install`：`error: No version matching "18.0.9" found for specifier "@linxiraos/pi-natives" (but package exists)` —— 这是版本线损伤的指纹，不是测试失败 | 全部 14 个键必须是当前 Zeta 统一键名 + 当前 Zeta 版本线；跑 `bun scripts/check-version-consistency.ts` 验证 |
| 2 | Cargo workspace 版本 + natives 哨兵被合并拉回 OMP 线（`Cargo.toml` workspace version、`crates/pi-natives/src/lib.rs` 的 `__piNativesVX_Y_Z`、committed bindings `packages/natives/native/index.{js,d.ts}`） | `check-version-consistency.ts` 报 `expected 1.1.5` / `missing __piNativesV1_1_5` | 跑 `bun scripts/set-version.ts <当前 Zeta 版本>` 整线对齐，再 `bun install` 刷新 lockfile |
| 3 | OMP 包名经 scope 改写泄漏：上游自己的包名（`omptype` 等）被机械改写成 `@linxiraos/<omp-name>`，而 Zeta 发布名是 `@linxiraos/pi-omptype` | `bun check:ts` 报 `Cannot find module '@linxiraos/omptype'`；npm registry 无此包 | 全库 grep：每个 `@linxiraos/<name>` import 必须能在 `workspaces.catalog` / npm 找到；合并时对上游包名做映射改写，不是 scope 替换 |
| 4 | 冲突解决时静默丢弃 Zeta-only 代码。已知清单：AgentSession 会话层 mode API（`ModeId`/`getModeState`/`enterMode`/`exitMode`/`enterPlanMode`/`exitPlanMode`/`enterGoalMode`/`exitGoalMode`/`enterVibeMode`/`exitVibeMode`/`getStateVersion`/`bumpStateVersion`/`getPlanFileContent`/`resetModeTransientState`/`flushPendingModelSwitch`/`restorePlanPreviousModel` + `#stateVersion`/快照字段 + `state_version_changed` 事件）；`sdk.ts` 的 `channelSend`/`workspaceRun`/`imControl` sinks；IRC auto-reply（`setIrcAutoReplyListener` + `IrcBridgeHost.onAutoReply` 接线）；`utils/dirs.ts` tracking 路径 helpers | Zeta mode API 刻意存在于两层：`InteractiveMode`（CLI）**和** `AgentSession`（web-gateway/ACP 外部客户端，headless 无 InteractiveMode）。会话层丢失只让 `web-gateway/agents.ts`/`zeta-server.ts` 编译失败，测试跑不到那里——所以 `bun run check:ts` 是探测器 | 逐项恢复（上游无这些 API，恢复源是合并前 Zeta 基线），恢复后 `bun run check:ts` 必须零错误 |
| 5 | 本地预编译 natives `.node`（不入库）落后于合并后的 bindings：合并新增 natives 函数（如 `vcsGitDiscover`）后，本地旧二进制缺符号 | 本地测试报 `api().vcsGitDiscover is not a function`（status-line/mode 测试成批失败）；CI bazel 现场构建，无此问题——纯本地噪声 | 本地重建：`packages/natives` 里 `bun run build`（Windows 需 VS Build Tools 开发者 shell；WSL 路线：`pacman -S bun` + `glibc ≥ 2.44` + `ninja`，linux host 走本地 cargo/napi 无需 bazel；rustup 慢时用 `RUSTUP_DIST_SERVER=https://mirrors.ustc.edu.cn/rust-static`） |
| 6 | 上游测试携带 `.omp` 配置目录契约被原样合入（如 `dirs-cache` 的 `$XDG/omp/cache`、`acp-agent`/`mcp-config-scope-dedup`/`sdk-skills`/`tools/gh` 的 `.omp` fixture 路径），而源码只解析 `.zeta` | 这些测试只在 Linux/XDG 分支生效，Windows 本地测试全绿、push 到云端 Linux CI 才爆——`bun test` 全绿不代表合并适配完整 | 合并时对每个触碰的测试文件对照 `v<tag>` 版本逐文件 resolve；grep `"\.omp"`（排除刻意保留的 `.omp-plugin`）必须为 0 |

**Triage 指纹**：所有 CI job 死在 `Run ./.github/actions/bun-install` ⇒ 版本线/catalog 损伤（第 1、2 类），先跑 `bun scripts/check-version-consistency.ts`，不要去翻测试日志。

**推送 sync 分支前的最低门槛**：`bun scripts/check-version-consistency.ts` 零漂移 + `bun run check:ts` 零错误 + 第 3 类 grep 扫描通过。三者都绿才允许 push。

## Upstream Reference Hygiene

Zeta keeps upstream references minimal so the repository stays lean:

- Each upstream remote tracks only its `main` branch
  (`git remote set-branches <remote> main`): no upstream feature, farm, or CI
  snapshot branches are fetched or kept.
- Fetching never auto-follows tags (`remote.<name>.tagOpt = --no-tags` on all
  upstream remotes). Verify integration tags with `git ls-remote` per the
  sync policy, and fetch a specific tag explicitly only when a release sync
  needs it: `git fetch omp-upstream tag v17.2.12`.
- Local tags are curated: OMP tags only for the two most recent versions
  (currently `v18.0.3`, `v18.0.4`), plus `baseline/*` markers and Zeta
  product release tags. All other upstream history is preserved through the
  SHAs recorded in `document/upstream-sync.md`, not through tag refs.
- `origin` (the GitHub remote) is the product truth: the Zeta `main` branch,
  the `sync/omp` mirror, and short-lived `sync/omp-release/<release>` or
  `port/<scope>` integration branches. `temp/` reference clones and local
  scratch branches never reach `origin`.
- Zeta product versions are Zeta-semver, decoupled from OMP version numbers.
  OMP tags are integration baselines recorded in `document/upstream-sync.md`;
  `bun scripts/release-v2.ts <version>` bumps Zeta package versions, not
  OMP-derived ones. See **Version line tooling** below.
- **Cloud backup of upstream refs.** `origin` keeps a `backup/` namespace so a
  corrupted local clone can be rebuilt without re-fetching upstream history:
  `backup/<remote>/main` mirrors each upstream `main`, and
  `backup/omp-tag/<tag>` holds the peeled commit of each OMP release tag.
  Refresh these after every sync (`git push origin
  refs/remotes/<remote>/main:refs/heads/backup/<remote>/main` and the peeled
  tag SHAs). `backup/*` never feeds product work; it exists only for
  disaster recovery.
- **Branch/tag hygiene (local and remote).** Keep the branch and tag surface
  minimal — the same rule applies to local refs and `origin`:
  - Local branches are limited to `main`, the `sync/omp` mirror (fast-forward
    to `omp-upstream/main` only), and long-lived product/version branches
    (e.g. `zeta/v1.1.10-17.3.8`). Nothing else is kept locally.
  - Short-lived integration branches (`sync/omp-release/<release>`,
    `port/<scope>`, `port/pi-web/<scope>`, `feat/<scope>`) are deleted —
    local and remote — as soon as they are merged into `main`. Do not leave
    merged branches around "just in case"; their commits are already on
    `main`.
  - Outdated OMP version tags (`v17.x`, older) are deleted locally and never
    pushed to `origin`; `origin` carries only Zeta product release tags
    (`v1.x.x`) plus the `backup/*` namespace.

### Branch naming & retention

Every ref has a fixed shape and a fixed lifetime. The same rules apply to
local refs and `origin`.

**Long-lived (kept indefinitely):**

| Ref | Shape | Notes |
|---|---|---|
| Product trunk | `main` | sole integration target |
| Upstream mirror | `sync/omp` | fast-forward to `omp-upstream/main` only, never edited |
| Stable/version branch | `zeta/v<zeta>-<omp>` (e.g. `zeta/v1.1.10-17.3.8`) | one per shipped Zeta version; kept forever |
| Backup namespace | `backup/<remote>/main`, `backup/omp-tag/<tag>` | disaster recovery; see below |

**Short-lived (delete on merge, local + remote):**

| Ref | Shape | Notes |
|---|---|---|
| OMP release sync | `sync/omp-release/<release>` | deleted as soon as merged to `main` |
| Pi semantic port | `port/<scope>` / `port/pi-web/<scope>` | deleted as soon as merged |
| Feature branch | `feat/<scope>` | deleted as soon as merged |

**Development branches (time-stamped, 3-month retention):**

A real development branch that cannot land quickly is named
`dev/<scope>/<YYYY-MM>` — the third field is the creation period, used to
decide when the branch is stale:

- Example: `dev/web-ui/2026-05`, `dev/gateway/2026-08`.
- Default retention is **3 months** from the creation period. A branch older
  than 3 months that is not merged and not actively worked is deleted
  (local + remote). When a dev branch is abandoned mid-flight, delete it
  rather than leaving it to rot.
- The exception is `dev/longtime/<scope>` — explicitly agreed long-lived
  development work that survives past 3 months. Keep it only when its
  retention was consciously decided; do not use `dev/longtime/` as a default.

**Backup retention:**

`backup/omp-tag/<tag>` keeps only the **recent stable OMP release baselines**
(the same two most recent tags that exist locally, currently `v18.0.3` and
`v18.0.4`). Older `backup/omp-tag/v17.x` entries are removed once the release
is superseded; full history stays reachable through `backup/omp/main`, which
mirrors `omp-upstream/main`.

## Documentation Layout

Two documentation trees, plus product surfaces, with strict boundaries:

- `docs/` — **runtime documentation, packaged with the product.** Embedded
  into binaries and the npm bundle (`PI_DOCS_EMBED`) and served to agents over
  `omp://docs/` (from a source checkout it reads the live tree). Covers tools,
  tool-call conversion, skills, protocols, configuration, and Zeta features.
- `document/` — **internal development and product-process documentation,
  never packaged**: `roadmap.md`, `upstream-sync.md`, `porting-from-pi-mono.md`,
  native/plumbing internals. Root `README.md` is the product front door and
  links both trees; `web-ui/README.md` is the web-ui front door.
- Moving a file from `docs/` to `document/` automatically removes it from the
  packaged corpus — no build change needed (`generate-docs-index.ts` globs
  only `docs/`). When moving, update every cross-reference (AGENTS.md,
  README.md, DEVELOPMENT.md, in-repo doc links); released CHANGELOG entries
  are immutable and keep their old links.

**Quick rule of thumb**: if a markdown file describes how the *code* works or
how to *use* the product (survives in the shipped binary) it belongs in
`docs/`; if it captures *why* decisions were made, dev process, release
mechanics, or internal plans (never shipped) it belongs in `document/`.
`roadmap.md` lives in `document/` — do not recreate it under `docs/`.

## CI and Release

- `.github/workflows/ci.yml` is the **only** workflow GitHub executes. It
  covers the Bun workspace, crates, desktop, install methods, and web-ui
  checks. `web-ui/` must never add its own `.github/` workflow (subdirectory
  workflows are never triggered); new web-ui checks go into the root CI.
- The `check` job runs `bun run ci:check:full` plus the web build. Desktop
  jobs install web-ui with `npm ci`, which resolves `@linxiraos/pi-*` from the npm
  registry — so **the `@linxiraos` npm publish chain is a hard dependency of
  desktop CI**.
- **npm publishing uses trusted publishing (OIDC)**: `permissions:
  id-token: write` in the workflow, cloud-hosted runners, npm CLI ≥ 11.5.1,
  Node ≥ 22.14 (runners already force Node 24). The trusted-publisher entry on
  npmjs.com must match the workflow filename exactly (`.github/workflows/ci.yml`)
  and the repo (Linxira-OS/linxira-zeta). OIDC publishes automatically attach
  provenance. Long-lived `NPM_TOKEN`/`NODE_AUTH_TOKEN` are a temporary
  fallback only: npm now requires 2FA for all publishes, bypass-2FA granular
  tokens lose direct publish in January 2027, and staged publishing (`npm
  stage publish` + maintainer 2FA approval) is the recommended pairing for
  CI-originated publishes. Every published package uses the `@linxiraos/*` name —
  no `@linxiraos/*` or legacy names, and no `.omp` compatibility packages.
- **The `@linxiraos` publish chain is live** (v1.0.9 published 2026-08-19 via
  trusted publishing; `web-ui` depends on `@linxiraos/pi-agent-core` etc. at
  `1.0.0`, which 404s until those are first published — align versions at
  first web-ui release).

### Trigger discipline (push is a quality gate, never a publish path)

- `push` to `main` runs quality checks only (check + test suites); it never
  publishes. Only a release run — a `v*` tag at HEAD detected by
  `release_metadata` — enters the build/publish chain.
- `.github/**` is deliberately **excluded** from the `on.push` /
  `on.pull_request` path filters: CI/workflow config changes never self-trigger
  a full run. They are verified by `workflow_dispatch` instead (using
  `skip_tests` / `build_only` as needed). Before any dispatch, the change must
  be functionally complete and locally validated — never dispatch half-done
  work, and never trigger CI for a simple documentation/config push.
- Release runs are entered only through two channels:
  1. `bun scripts/release-v2.ts <version>` — atomic bump commit + `v*` tag push
     on `main`; the push run detects the tag and runs the full gate
     (tests + build + publish).
  2. `gh workflow run ci.yml --ref main` with `skip_tests` / `build_only` —
     release-only dispatches that skip the test suites and/or skip publishing.
- Publish jobs (`release_github`, `release_native_leaves`, `release_npm`) are
  gated on `release_quality_gate` (tests, `skip_tests`-exempt) and
  `release_build_gate` (all release artifacts present). `build_only=true`
  builds artifacts without publishing.
- Test-suite failures in a push run are environment flakes (e.g. singleton
  `broker-idle-shutdown`, julia prelude kernel) unless proven otherwise; a
  release run gates on its own test results, never on unrelated push runs.

### Release tags require an update log

- Every Zeta release tag (`v*`) MUST update the root `UPDATE-LOG.md` in the
  same release: version, date, added/fixed/removed items, and the OMP sync
  baseline (which OMP tag the release is based on, or "not synced"). This is a
  release-blocking rule — do not tag a version without its `UPDATE-LOG.md`
  entry, mirroring the per-package `CHANGELOG.md` requirement.
- `UPDATE-LOG.md` entries are written at release time and committed with (or
  before) the version bump.

### Version line tooling (lockstep bump)

Zeta rides **one** version line across every published surface. Never hand-edit
a version: the number lives in more than a dozen places, and any drift is a
release-blocking bug — `zeta update` pins every package to the release version,
so a straggler fails with `ETARGET` (the 1.0.6/1.0.7 era shipped
`natives@1.0.2/1.0.4` while `zeta` rode 1.0.6/1.0.7 and broke the updater).

Always move the version with a script:

| Script | Purpose |
|---|---|
| `bun scripts/set-version.ts <version> [--dry-run]` | Move the whole version line. Touches the 14 published `@linxiraos/*` packages, the root `workspaces.catalog` keys, the Cargo workspace version, the `__piNativesVX_Y_Z` sentinel (lib.rs + committed bindings), `desktop/package.json` + its lockfile, and `web-ui/package.json` (`zeta-web` version **and** its `@linxiraos/*` ranges, kept as `^<version>`). **Does not** touch changelogs, commit, tag or push. |
| `bun scripts/sync-versions.ts` | Re-sync every `@linxiraos/*` dependency range to the current package versions. |
| `bun scripts/check-version-consistency.ts` | Verify the line is consistent (packages, catalog, Rust workspace, natives sentinel, desktop app, README badge). Run before tagging. |
| `bun scripts/release-v2.ts <version>` | The real release: preflight, bump, changelog, consistency check, fixed-subject commit, atomic `v*` tag push. |

Rules:

- Use `set-version.ts` when the version line must move **without** a release
  (local test build, pre-alignment). Use `release-v2.ts` for anything that
  reaches `origin` — it is the only path that produces the
  `chore: bump version to X.Y.Z` subject that CI's release-run concurrency
  group and `selectLatestZetaTag` match on.
- `release-v2.ts` takes an **explicit** version (`1.1.6`); it runs
  `validateExplicitVersion`, so words like `patch`/`minor`/`canary` are not
  valid input there.
- After `set-version.ts`, regenerate the lockfile (`bun install`) or let
  `release-v2.ts` do it — a stale `bun.lock` is the usual npm-publish hazard.
- `scripts/release.ts` is the v1 script, retained only for its shared helpers
  (`selectLatestZetaTag`, `validateExplicitVersion`, `watchCI`) and its
  `watch` mode. Do not use it to cut a release.

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
3. Push the branch to `origin`, open a PR, and only merge after CI passes.
4. Merge to `main` on the remote (cloud), then merge the same branch into
   local `main` to keep them in sync.
5. Delete the branch after the merge (both remote and local).

`main` stays reserved for released/stable work; a new direction only lands on
`main` via this merge path, never by committing directly to it.

## Code Quality

- No `any` unless absolutely necessary.
- **NEVER use `ReturnType<>`** — use the actual type name.
- **NEVER use inline imports** — no `await import()`, no `import("pkg").Type` in type positions, no dynamic type imports. Always top-level.
- Check `node_modules` for external API types instead of guessing.
- **Barrel exports**: prefer `export * from "./module"` over named re-exports, including `export type { ... } from`. In pure `index.ts` barrels, use star re-exports even for single-specifier cases. If stars create ambiguity, remove the redundant export path; do not keep duplicates.
- **Class privacy**: use ES `#private` fields; leave externally accessible members bare. **No `private`/`protected`/`public` keyword on fields or methods**, except on **constructor parameter properties** where TypeScript requires it (e.g. `constructor(private readonly session: ToolSession)`).
- **Promises**: use `Promise.withResolvers()` instead of `new Promise((resolve, reject) => ...)`.
- **Prompts**: never build prompts in code (no inline strings, template literals, or concatenation). Prompts live in static `.md` files; use Handlebars for dynamic content. Import them via `import content from "./prompt.md" with { type: "text" }` — not `readFile`.
- **Worker scripts**: workers re-enter the CLI entrypoint; never spawn separate worker entry modules. `cli.ts` declares itself as the worker host at startup (`declareWorkerHostEntry()` from `@linxiraos/pi-utils/env`) and dispatches hidden argv selectors (`__omp_worker_stats_sync`, `__omp_worker_tab`, `__omp_worker_js_eval`, `__omp_worker_tiny_inference`) before loading the command registry. Spawn sites use:
  ```ts
  import { workerHostEntry } from "@linxiraos/pi-utils";
  const hostEntry = workerHostEntry();
  const worker = hostEntry
  	? new Worker(hostEntry, { type: "module", argv: ["__omp_worker_<name>"] })
  	: new Worker(new URL("./<worker>.ts", import.meta.url).href, { type: "module" });
  ```
  When the process was started from the omp CLI — source `cli.ts`, npm-bundle `dist/cli.js`, or compiled binary — `workerHostEntry()` is `Bun.main` and the worker re-enters the single entry module, so no per-worker `--compile` entrypoints or bundle entries exist. Outside a CLI host (`bun test`, SDK embedding, standalone `omp-stats`) it returns `null` and the direct-module fallback loads the worker source. New worker kinds MUST add their selector to the dispatch table in `cli.ts` and keep the fallback branch.
  History: `with { type: "file" }` only copied the entry as a raw asset (workers crashed silently in compiled binaries — issues #1011, #1027), and the later literal-path + extra-entrypoint pattern required keeping spawn literals and two build scripts in sync (issue #1150). The smoke probe below is the live validation of this contract.
  Validate any new worker with the dedicated smoke probe: `omp --smoke-test` spawns the stats sync worker and the tiny-model subprocess, pings them, and exits — it's wired into `ci:test:smoke` and `scripts/install-tests/run-ci.sh` so binary, source-link, and tarball installs all exercise it. Add a sibling smoke if the new worker is on a different module graph.

## Central Utilities

Before writing a helper, check whether one already exists — `packages/coding-agent/src/utils/`, `@linxiraos/pi-utils`, `@linxiraos/pi-tui`, and the domain modules next to your callsite. This applies to **everything**: VCS wrappers, formatting/truncation/path-display helpers, image handling, clipboard, streams, temp files, caching. The central versions carry hardening a fresh copy always loses (timeouts, output caps, non-interactive env, lock avoidance, caching, TUI sanitization).

- Search first: `grep` for the operation before implementing it. Two implementations of the same thing is a bug even when both work.
- Examples of the pattern: git/jj access goes through the `pi-vcs` native addon (`import * as vcs from "@linxiraos/pi-natives/vcs"`, e.g. `vcs.gitInfo(dir)`, `vcs.git(dir)?.worktreeRemove(path, force)`) — never hand-spawn via `$`/`Bun.spawn`. The old `src/utils/git.ts` / `src/utils/jj.ts` wrappers were removed upstream in v18.0.9; rendering goes through the helpers in TUI Sanitization below (`replaceTabs`, `truncateToWidth`, `shortenPath`, `PREVIEW_LIMITS`) rather than ad-hoc string math.
- Missing capability? Extend the central helper (new option, new sub-function on the namespace) and call it — don't fork its logic locally.

## Bun Over Node

Use Bun APIs where they provide a cleaner alternative; fall back to `node:*` only for what Bun doesn't cover. **Never spawn shell commands for operations with proper APIs** (e.g., don't `Bun.spawnSync(["mkdir", "-p", dir])` — use `mkdirSync`).

### Quick reference

| Operation       | Use                                       | Not                                |
| --------------- | ----------------------------------------- | ---------------------------------- |
| File read/write | `Bun.file()`, `Bun.write()`               | `readFileSync`, `writeFileSync`    |
| Spawn process   | `` $`cmd` ``, `Bun.spawn()`               | `child_process`                    |
| Sleep           | `Bun.sleep(ms)`                           | `setTimeout` promise               |
| Binary lookup   | `$which("git")` from `@linxiraos/pi-utils` | `spawnSync(["which", "git"])`      |
| HTTP server     | `Bun.serve()`                             | `http.createServer()`              |
| SQLite          | `bun:sqlite`                              | `better-sqlite3`                   |
| Hashing         | `Bun.hash()`, `Bun.password.*`, WebCrypto | `node:crypto`                      |
| Path resolution | `import.meta.dir`, `import.meta.path`     | `fileURLToPath` dance              |
| JSON5           | `Bun.JSON5.parse()` / `.stringify()`      | `json5` package                    |
| JSONL           | `Bun.JSONL.parse()` / `.parseChunk()`     | `text.split("\n").map(JSON.parse)` |
| String width    | `Bun.stringWidth()`                       | `get-east-asian-width`, custom     |
| Text wrapping   | `Bun.wrapAnsi()`                          | custom ANSI-aware wrappers         |

### Process execution

Prefer Bun Shell (`` $`cmd` ``) for simple commands:

```typescript
import { $ } from "bun";

const result = await $`git status`.cwd(dir).quiet().nothrow();
if (result.exitCode === 0) {
	const text = result.text();
}

$`do-stuff ${tmpFile}`.quiet().nothrow(); // fire and forget
```

Methods: `.quiet()`, `.nothrow()`, `.text()`, `.cwd(path)`.

Use `Bun.spawn`/`Bun.spawnSync` only for: long-running processes (LSP, kernels), streaming stdin/stdout/stderr (SSE, JSON-RPC), or process control (signals, kill, complex lifecycle).

When using `pipe` mode, cast the stream:

```typescript
const child = Bun.spawn(["cmd"], { stdout: "pipe", stderr: "pipe" });
const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
```

### Node module imports

Always use **namespace imports** for `node:fs`, `node:path`, `node:os`:

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
```

- Async-only file → `node:fs/promises`.
- Needs both sync and async → `node:fs`, then `fs.promises.xxx` for async.

### File I/O

Prefer Bun:

```typescript
const text = await Bun.file(path).text();
const data = await Bun.file(path).json();
await Bun.write(path, data); // auto-creates parent dirs
```

Use `node:fs/promises` for directory ops (`fs.mkdir`, `fs.rm`, `fs.readdir`) — Bun has no native directory APIs. Avoid sync APIs in async flows; use sync only when forced by a synchronous interface.

**Anti-patterns:**

- `existsSync`/`readFileSync`/`writeFileSync` in async code → `Bun.file()` APIs.
- `mkdir(dirname(path), …)` before `Bun.write(path, …)` → redundant; `Bun.write` handles it.
- `if (await file.exists()) { await file.json() }` → two syscalls plus race. Use try-catch with `isEnoent`:
  ```typescript
  import { isEnoent } from "@linxiraos/pi-utils";
  try {
  	return await Bun.file(path).json();
  } catch (err) {
  	if (isEnoent(err)) return null;
  	throw err;
  }
  ```
- Multiple `Bun.file(path)` handles for the same path (including across `checkX`/`loadX` helpers).
- `Buffer.from(await Bun.file(x).arrayBuffer())` → `await fs.readFile(path)`.
- Existence check + try-catch around the same read → drop the existence check.

### Streams

Prefer centralized helpers:

```typescript
import { readStream, readLines } from "./utils/stream";
const text = await readStream(child.stdout);
for await (const line of readLines(stream)) {
	/* ... */
}
```

Manual reader loops only when the protocol requires it (SSE, streaming JSON-RPC).

### Misc

- **Sleep**: `await Bun.sleep(ms)`, never `new Promise(r => setTimeout(r, ms))`.
- **Password hashing**: `Bun.password.hash(pw, "bcrypt")` / `Bun.password.verify(pw, hash)`.
- **String width**: `Bun.stringWidth(text, { countAnsiEscapeCodes?: false })`.
- **Wrapping**: `Bun.wrapAnsi(text, width, { wordWrap, hard, trim })`.

## Generated Files

**NEVER edit `packages/catalog/src/models.json` directly.** It is generated from upstream sources (stencil.so, provider catalog discovery, OpenCode docs) by `packages/catalog/scripts/generate-models.ts` and the descriptors/resolvers in `packages/catalog/src/provider-models/`. Hand-edits get overwritten on the next regen.

To change an entry, fix the source:

- **Resolution rules / per-id overrides** → relevant resolver in `packages/catalog/src/provider-models/openai-compat.ts` (e.g. `createOpenCodeApiResolution`'s id-override map).
- **Provider catalog entries** (default model, discovery factory/flags) → the `CATALOG_PROVIDERS` table in `packages/catalog/src/provider-models/descriptors.ts`.
- **Generator-level fixups** (premium multipliers, codex pricing fallback, fallback models, post-processing) → `packages/catalog/scripts/generate-models.ts`.
- **Thinking metadata / generated policies** → `packages/catalog/src/model-thinking.ts` (`applyGeneratedModelPolicies`); model-id classification (family/version parsing) lives in `packages/catalog/src/identity/classify.ts`.

Regenerate with `bun run gen:models` and commit `models.json` alongside the source change. Add a regression test against the **resolver/descriptor**, not the bundled JSON, so it survives upstream metadata shifts.

## Logging and CLI Output

Code that may run while the TUI, RPC, SDK, workers, or background runtimes are active MUST NOT use `console.log`/`error`/`warn`; it corrupts rendering or protocols. Use the centralized logger:

```typescript
import { logger } from "@linxiraos/pi-utils";

logger.error("MCP request failed", { url, method });
logger.warn("Theme file invalid, using fallback", { path });
logger.debug("LSP fallback triggered", { reason });
```

Logs go to `~/.zeta/logs/omp.YYYY-MM-DD.log` with automatic rotation. Standalone CLI commands that exit without entering the TUI MAY use `console.*` or process streams for intentional user-facing output. Keep structured stdout clean. This exception is semantic, not filename-based; shared code must use `logger` or an explicit output sink.

## TUI Sanitization

All text displayed in tool renderers must be sanitized. Raw content (file contents, error messages, tool output) breaks terminal rendering: tabs → visual holes, long lines → overflow, paths → leak home directory.

**Rules:**

- **Tabs → spaces** via `replaceTabs()` (from `@linxiraos/pi-tui` or `../tools/render-utils`).
- **Truncate** lines with `truncateToWidth()` / `ui.truncate()`. Use `TRUNCATE_LENGTHS` constants.
- **Shorten paths** with `shortenPath()` (replaces home with `~`).
- **Preview limits** from `PREVIEW_LIMITS`. No ad-hoc numbers.

**Apply to every render path**, not just the happy one:

- Success output (file previews, command output, search results).
- **Error messages** — these often embed file content (e.g., patch failure messages include unmatched lines). If a message contains file content, it needs `replaceTabs()`.
- Diff content (added and removed).
- Streaming previews.

### Streaming tool previews

Tool-call previews can have **multiple render paths**. If you add preview-only fields or depend on partially streamed args, update every path — not only the final renderer. Streamed argument buffers decode into display args via `decodeStreamedToolArgs` / `ToolArgsRevealController` (`modes/controllers/tool-args-reveal.ts`); both the live event path and transcript rebuilds must go through them — never spread provider-parsed `arguments` next to a raw `__partialJson` (parsed args lag the stream by a throttled parse window).

For the bash tool specifically:

- The pending preview may need raw `partialJson`, not just parsed `arguments`. Parsed args lag until a JSON object closes, which makes inline env assignments appear only at the end.
- Preserve preview-only fields (e.g. `__partialJson`) through `event-controller.ts`, transcript rebuilds in `ui-helpers.ts`, and merged call/result rendering in `tool-execution.ts`. Missing one path causes inconsistent previews.
- `ToolExecutionComponent.#buildRenderContext()` for bash must work even before a result exists — the renderer uses call args plus render context to show the command preview while streaming.
- Verify both live streaming and rebuilt transcript paths after any bash preview change. A fix in one path does not fix the other.

## Commands

- NEVER commit unless asked.
- Never use `tsc`/`npx tsc` — always `bun check`.
- Never run `cargo test` directly for Rust tests — use `bun run test:rs`. It runs `cargo nextest run` (config: `.config/nextest.toml`) followed by a `cargo test --doc` pass, because nextest does not execute doctests. The doctest pass currently executes nothing (pi-natives is a `cdylib`, which rustdoc skips; pi-builtins' examples are `ignore`d vendored uutils docs) and exists so the first runnable doctest added to a lib crate is actually run.
- Merge commits (maintainer merges of PRs) follow: `Merge PR #<number>: <conventional PR subject> (@<author>)` — e.g. `Merge PR #6386: feat(catalog): add native Meta Model API provider (@eggpeat)`.
## Rust Build Profiles

Profiles live in the root `Cargo.toml`; `.cargo/config.toml` carries the settings Cargo.toml cannot express. Both are committed, so no local `~/.cargo/config.toml` is required.

| Profile | Use |
| --- | --- |
| `dev` | Default. Line tables for our crates, no debuginfo for deps, deps at `opt-level = 2`. |
| `release` | Shipping build: fat LTO, 1 codegen unit, stripped. |
| `local` | Fast local release iteration: thin LTO, 16 codegen units, incremental. |
| `profiling` | `release` codegen with symbols kept, for `perf`/`samply`/Instruments. |
| `ci` | Thin LTO, no debuginfo, stripped. |

**Never set `split-debuginfo = "off"` on a profile that has debuginfo.** On Mach-O the linker never merges DWARF into the executable — it writes a debug map (`N_OSO`) pointing at the `.o` files, and `"unpacked"` is what keeps those files. With `"off"` every backtrace frame in our own crates silently loses `file:line`; the `panicked at foo.rs:3` header still prints (that is `#[track_caller]`, not debuginfo), which makes the loss easy to miss. `ci` may use `"off"` only because it sets `debug = false`.

`embed-metadata = false` (in `.cargo/config.toml`) keeps crate metadata in `.rmeta` instead of duplicating it into every rlib — measured 196 MB → 130 MB on a reqwest-sized graph at identical build times. Its accepted spelling is toolchain-coupled; keep it in sync with `rust-toolchain.toml`.

Rejected, with measurements, so nobody re-litigates them: **sccache** (cannot cache incremental, bin, or proc-macro crates — measured slower than not using it), **mold** (ELF-only; no Mach-O support), and **`panic = "abort"` on `dev`** (Cargo ignores `panic` for the test profile, so the whole dep graph builds twice — 131 MB → 214 MB).

## Testing Guidance

Test the contract the system exposes — not the easiest internal detail to assert.

- Every new test must defend one **concrete, externally observable contract**: behavior, output shape, state transition, error mapping, or a regression-prone parsing boundary. If you cannot name the contract, do not add the test.

### Good vs. bad test filter

- **Name the failure mode.** Every test MUST state what a consumer observes if it regresses. Cannot name one? NEVER add it.
- **Good: transformation.** One fixture MAY prove parse/render/normalize/encode/resolve behavior when output is computed, not echoed.
- **Good: branch or boundary.** Distinct inputs, empty values, malformed input, version/provider routing, and state transitions MUST prove distinct outcomes.
- **Good: external contract.** Exact bytes/shape MAY be asserted when a provider, parser, protocol, or persisted consumer reads them.
- **Good: precedence or negative contract.** Keep explicit `false`/override-wins assertions and required absence only when they prevent a documented leak, downgrade, 400, or incompatible wire field.
- **Good: regression.** A repro MUST trigger the prior real failure path and assert the corrected observable result.
- **Bad: static echo.** NEVER test a constructor/builder merely copied a fixture or baked constant into an in-memory config/metadata field.
- **Bad: success passthrough.** NEVER assert `fn(x) === x` when `x` was already supplied/declared valid; assert a transform, rejection, or downstream effect instead.
- **Bad: wording/defaults.** NEVER assert prompt/UI boilerplate, a default literal, object existence, non-empty output, or length growth without a consumer contract.
- **Bad: duplicate rows.** Parameterized/loop rows MUST each cover a distinct branch, provider/model path, or consumer contract; delete same-path duplicates.
- **Metadata exception.** Exact metadata, identity, ordering, or `undefined` MAY remain only when a downstream consumer depends on it and the test establishes branch, precedence, negative-contract, wire, or regression evidence.
- **Termination exception.** For cyclic/large inputs, assert a bounded output, surfaced error, or state change; bare `not.toThrow()` is insufficient.
- No placeholder tests, tautologies, or "the code ran" assertions (`expect(true).toBe(true)`, bare `not.toThrow()`, non-empty string checks, length-grew checks, "prompt exists" checks without semantic assertion).
- Prefer contract-level tests over implementation details. Avoid asserting internal helper wiring, field assignment, singleton identity, incidental ordering, prompt boilerplate, or passthrough option forwarding unless another component depends on that exact detail.
- Don't duplicate coverage across abstraction levels. If an integration test already proves the behavior, drop the narrower unit test that restates it through mocks.
- Tests **must be full-suite safe**, not just file-local safe. No long-lived file-wide mutations of `Bun.*`, `process.platform`, `process.env`, or `Bun.env` when a narrower seam exists. Prefer per-test `vi.spyOn(...)` with `vi.restoreAllMocks()` in `afterEach`. A test that passes alone but poisons later files is broken.
- **Never use `mock.module()`**. Bun's `mock.module()` mutates the global module registry and leaks across files ([oven-sh/bun#12823](https://github.com/oven-sh/bun/issues/12823)). Use `spyOn` on the imported module object instead. For pass deps, import the pass and spy on `.run`. For package deps, namespace-import and spy on the exported function.
- For lifecycle/stateful code, prefer one test per invariant or transition over several tiny tests asserting one field each from the same transition.
- For error handling, trigger the real failure path and assert the surfaced contract — don't instantiate error classes directly or inspect internal metadata.
- Smoke tests are acceptable only when they catch a failure mode narrower tests would miss. "Package boots" or "command starts" alone is not enough.
- Assert exact strings, ordering, and formatting only when downstream code parses or depends on the exact bytes. Otherwise assert semantic content.
- Compile-time guarantees → type checks/type tests, not runtime placeholders.
- **Never source-grep.** A test that reads an implementation file (`.ts`/`.rs`/build script) and asserts on its _text_ — `expect(src).toContain("someCall()")`, `.toMatch(/import .../)`, `.not.toContain("oldName")`, or "comment must say X" — is banned. It tests how code _looks_, not what it _does_: it breaks on harmless refactors (comment reflow, rename, import reorder) and passes while the behavior is broken. Assert the observable contract instead (run the code, check output/state/error), use the runtime smoke probe for wiring you cannot exercise in-process, and enforce structural invariants (no value-import of X, no self-import) with a type test or a lint/biome rule — never a string scan of the source. (Reading a file your code _wrote_ — apply-patch result, generated bundle, temp fixture — and asserting on that output is fine; that is behavior, not a source grep.)
- Don't add tests for tiny low-risk changes unless they protect a real contract or fix a regression-prone edge case.
- Prefer focused package-local verification for the changed area.

## Changelog

Location: `packages/*/CHANGELOG.md` (per package).

**Format** — sections under `## [Unreleased]`:

- `### Breaking Changes` (first if present)
- `### Added`
- `### Changed`
- `### Fixed`
- `### Removed`

**Rules:**

- New entries always go under `## [Unreleased]`.
- Entries are one line, brief, and user-facing: lead with what the user will see or can now do. Root-cause narration and implementation detail belong in the commit/PR, not the changelog.
- Never modify already-released sections (e.g., `## [0.12.2]`) — they are immutable.
- Don't flag changelog section order or formatting in reviews or PRs — `bun run release` runs `fix-changelogs` which normalizes everything automatically.

**Attribution:**

- Internal (from issues): `Fixed foo bar ([#123](https://github.com/can1357/oh-my-pi/issues/123))`.
- External contributions: `Added feature X ([#456](https://github.com/can1357/oh-my-pi/pull/456) by [@username](https://github.com/username))`.

### Release log completeness (pre-tag gate)

Every Zeta release tag (`v*`) MUST ship complete logs **before** the tag is
pushed; CI never fixes logs for you. `release-v2.ts` runs a preflight gate that
refuses to bump while any log is missing:

1. **Package CHANGELOGs keep ONLY the Zeta version line.** Each
   `packages/*/CHANGELOG.md` may only carry `[Unreleased]` and Zeta versions
   (`[1.0.x]`, `[1.1.x]`, …). Upstream OMP version sections (`[15.x]`–`[18.x]`)
   must never appear: OMP's changelog is a subset of Zeta's, so upstream
   changes are folded into the Zeta `[Unreleased]` entry at sync time, never
   kept under upstream version headers. The preflight fails while any package
   still matches `## [1[5-8].`.
2. **Every package `[Unreleased]` is non-empty at release time.** Each released
   package records its user-visible changes since the last release (sync or
   Zeta work) — an empty `[Unreleased]` is a pre-tag gate failure.
3. **`UPDATE-LOG.md` carries the release entry.** Version, date,
   added/fixed/removed items, and the OMP sync baseline under
   `## 下一版本（Unreleased）`; the sync baseline must be current. The preflight
   verifies the section is non-empty.
4. **README.md version badge stays in lock-step.** `badge/zeta-<version>-` is
   rewritten by `set-version.ts` and `release-v2.ts`; the version-line
   consistency check (`scripts/check-version-consistency.ts`, wired into CI)
   fails if it drifts.

The pre-tag gate in `release-v2.ts` runs before any bump:
- no `## [1[5-8].` upstream version sections in any `packages/*/CHANGELOG.md`
- every package `[Unreleased]` section has at least one entry line
- `UPDATE-LOG.md` `## 下一版本（Unreleased）` is non-empty

**Zeta uses one version line for everything.** All 13 published `@linxiraos/*`

**Zeta uses one version line for everything.** All 13 published `@linxiraos/*`
packages (the 10 core packages plus the 3 native leaves `natives`/`omptype`/`wire`)
ride the same release version, and the root `workspaces.catalog` (13 keys),
`Cargo.toml` workspace version, the `__piNativesVX_Y_Z` sentinel, and
`desktop/package.json` + `desktop/package-lock.json` follow in lock-step. There
is no separate leaf version — the 1.0.6/1.0.7 era shipped natives at
1.0.2/1.0.4 while zeta rode 1.0.6/1.0.7, which broke `zeta update` with
`ETARGET No matching version found for @linxiraos/pi-natives@1.0.7`. Never
introduce a second version line: any version drift across the 13 packages,
catalog, Cargo, or sentinel is a release-blocking bug.

Version bumps are a script operation, never hand edits:

1. Ensure all changes since last release are in each affected package's `[Unreleased]` section.
2. Run `bun scripts/release-v2.ts <version> [--watch]` (e.g. `bun scripts/release-v2.ts 1.0.8`).

The script bumps all 13 packages, Cargo.toml, and the pi-natives sentinel
(`__piNativesVX_Y_Z` in `crates/pi-natives/src/lib.rs` + the committed
bindings in `packages/natives/native/index.{js,d.ts}`), rewrites the 13 root
catalog keys, regenerates `bun.lock`, finalizes all 13 CHANGELOGs, runs
`check:ts`, then commits (`chore: bump version to <version>`), tags
(`v<version>`), and pushes atomically. The pushed commit triggers CI, which
runs the full gate and — because HEAD carries the tag — the release/publish
jobs. If a fix lands after a failed release run, commit the fix, then re-push
main **and** force-move the tag to the new HEAD in one command so
`release_metadata` sees `is-release=true`:

```
git push --force origin refs/heads/main:refs/heads/main "$(git rev-parse HEAD):refs/tags/v<version>"
```

`bun run release` (the legacy script) is deprecated: it moves the leaves to
the release version via blind regexes and is not the release path.

Related rule: Redis session-storage keys use the `zeta:sessions:` prefix
(see `packages/coding-agent/src/session/redis-session-storage.ts`). Do not
reintroduce `omp:` prefixed keys or Lua-script comments.
