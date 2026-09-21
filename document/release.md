<!-- 本文由 AGENTS.md 规整拆分而来（2026-09），随 merge-playbook/release 流程维护。 -->

# Release & Upstream References

CI/发布机制参考：唯一 workflow、trigger discipline、CI watching discipline、release tag 与 update log、版本线工具，以及上游引用卫生（远端/tag/分支保留策略）。硬性合并规则与品牌注册表见根 `AGENTS.md`；合并操作手册见 `document/merge-playbook.md`；日常编码约定见 `document/dev-conventions.md`。

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
  trusted publishing).
- **Trusted-publisher 配置是逐包的**（v1.1.9 教训：`@linxiraos/pi-natives-win32-arm64`
  首发时 npm 侧无匹配 trusted publisher，OIDC 静默回退到 `NODE_AUTH_TOKEN`，而该
  token 无新包首发权限 → `PUT 404`）。新包第一次发布前，在 npmjs.com 上为该包
  （或账号级默认）配置 Publishing access：Repository `Linxira-OS/linxira-zeta`、
  Workflow filename `.github/workflows/ci.yml`、Environment 留空。逐包清单 =
  `workspaces.catalog` 的 `@linxiraos/*` 13 个键 + 6 个 `pi-natives-<tag>` leaf +
  `zeta-web` / `pi-messenger`（独立线）。新 leaf 包出现时同步补 npm 配置。
  editor（vendored TTT）三包 `@linxiraos/editor` /
  `@linxiraos/editor-windows-x64` / `@linxiraos/editor-linux-x64`（1.1.16 起，
  短期仅编译 linux-x64 + win32-x64；macOS 任何版本与任何设备的 ARM 构建
  暂停——目标系统上这类设备量很少，恢复时 revert 平台裁剪提交即可）已配置
  并随 release tag 经 `release_editor_packages` job 发布
  （`ci-release-publish.ts --editor`）；版本随 release 线由 `release-v2.ts`
  Step 2f bump。

  同一决定落在 CI：`desktop_mac` / `release_binary_hosted` /
  `release_github_verify` / `release_brew` 四个 job 删除，darwin/ARM 矩阵
  leg 与 leaf tag 全部移除。`desktop_linux` / `desktop_windows` **恢复为常驻
  发布 job**（v1.1.16 起桌面安装包是 release 的固定资产：win zip+nsis-exe、
  linux tar.gz+deb+AppImage；`release_github` 依赖两个 desktop job 的产物，
  见下方损伤类别 5）。

  **方向注记（未实施）**：CLI 与桌面将来可能拆分版本线独立发布——桌面追稳定
  （低频、大版本），CLI 高频快跑。届时 tag/repo 级拆分（如 `cli-vX.Y.Z` 与
  `desktop-vX.Y.Z` 分列 release）需重新推导损伤类别 5 的 needs 链与 preflight
  期待，不要沿用本文件的单 release 假设。
- The `check` job also runs the brand-residue guard
  (`bun scripts/brand/brand-check.ts`, see `document/merge-playbook.md`).

### Trigger discipline (push is a quality gate, never a publish path)

- `push` to `main` runs quality checks only (check + test suites); it never
  publishes. Only a release run — a `v*` tag at HEAD detected by
  `release_metadata` — enters the build/publish chain.
- `.github/**` is deliberately **excluded** from the `on.push` /
  `on.pull_request` path filters: CI/workflow config changes never self-trigger
  a full run. They are verified by `workflow_dispatch` instead (using
  `skip_npm` as needed). Before any dispatch, the change must
  be functionally complete and locally validated — never dispatch half-done
  work, and never trigger CI for a simple documentation/config push.
- Release runs are entered only through two channels:
  1. `bun scripts/release-v2.ts <version>` — atomic bump commit + `v*` tag push
     on `main`; the push run detects the tag and runs the full gate
     (tests + build + publish).
  2. `gh workflow run ci.yml --ref main` with `skip_npm` — a release-only
     dispatch that skips publishing.
- Publish jobs (`release_github`, `release_native_leaves`, `release_npm`) are
  gated on `release_gate` (full test/build validation) plus
  `release_binary` / `release_binary_hosted` (all release artifacts present)
  and `!inputs.skip_npm`.
- Test-suite failures in a push run are environment flakes (e.g. singleton
  `broker-idle-shutdown`, julia prelude kernel) unless proven otherwise; a
  release run gates on its own test results, never on unrelated push runs.

### CI watching discipline (no polling)

A full release run takes 1.5–2.5 hours. Watching it must not cost agent time
proportional to that: **tight-loop polling is forbidden** — never loop
`gh run view` / `gh api` on a short sleep (60 s or similar) against a running
release; it burns the session on a wall-clock wait and produces no
intermediate decisions.

Allowed patterns, in order of preference:

1. **`run_watch` device (preferred).** In agent sessions with the GitHub
   tool device available, write `{"op": "run_watch", "run": "<run-id>"}` to
   `xd://github` (`{"op": "run_watch", "branch": "main"}` resolves the latest
   run on a branch). It fast-fails on the first failed job and saves full
   failed-job logs to a session artifact for immediate triage — no shell
   polling at all. Retry once on transient `HTTP 502`.
2. **Blocking watch, then detach.** Fire `gh run watch <run-id> --exit-status`
   once (optionally in a background task), stop attending, and act on its
   final output. `gh run watch` long-polls server-side and exits the moment
   the run completes — the sanctioned "stare" tool when the device is not
   available.
3. **Deferred one-shot checks.** If a delay-based approach is used, it must be
   coarse: at most **two ~3500 s deferred tasks per run**, each waking to read
   the run state exactly once (`gh run view --json status,conclusion`) — never
   a repeating short-interval loop.
4. **Respect the tool's real cap.** If the runtime reports that long-delay or
   long-running background tasks are not permitted, chain multiple single
   delays at the maximum duration the tool actually allows (same one-read
   rule per wake), or skip watching entirely.
5. **Default: don't watch at all.** CI failure notifications arrive by email;
   the human forwards the verdict. After dispatching or pushing a release,
   report what is in flight and stop. Re-engage only on the human's report or
   the completion of a sanctioned watch.

Diagnose a finished run with `gh run view <run-id> --json jobs` (job-level
conclusions first, `--log-failed` second) — one call, not a loop.

### Release tags require an update log

- Every Zeta release tag (`v*`) MUST update the root `UPDATE-LOG.md` in the
  same release: version, date, added/fixed/removed items, and the OMP sync
  baseline (which OMP tag the release is based on, or "not synced"). This is a
  release-blocking rule — do not tag a version without its `UPDATE-LOG.md`
  entry, mirroring the per-package `CHANGELOG.md` requirement.
- `UPDATE-LOG.md` entries are written at release time and committed with (or
  before) the version bump.

### Release-surface damage checklist (pre-tag gate)

每次 release 合并后、push tag 前逐类核对（v1.1.9 首跑即验证：每一类都曾打断发布链）。
按 v1.1.9 实际断裂点编码为机械检查，写入 AGENTS.md Post-Merge Checklist 的 release 面补充：

| # | 损伤类别 | 症状 | 机械守卫 |
|---|---|---|---|
| 1 | Release asset 名漂移：build 脚本改名（如 `omp-browser-relay-extension.zip` → `zeta-browser-relay-extension.zip`）而 ci.yml 仍引旧名 | `Generate checksums` 步骤 ENOENT，GH Release 不创建，下游 verify/brew/npm 全 skipped | checksums 前的 `Preflight release assets` 步骤；改名任何 release asset 时全库 grep 旧名 |
| 2 | Artifact 名漂移：upload/download 的 artifact key（`zeta-binary-*`、`native-addons-*`）两侧不一致 | download 步骤空集或 digest 错误 | upload/download `pattern` 成对核对 |
| 3 | 新 leaf 包（`@linxiraos/pi-natives-<tag>`）首次发布时 npm 侧无 trusted publisher / 无权限 → `PUT 404` | `Publish native leaf packages` 失败；主包因 `optionalDependencies` 锁步被 gating 全部不发 | 发版前 npmjs.com 逐包配置 trusted publisher；本地补发用 `scripts/publish-missing-packages.ts` |
| 4 | 版本线漂移（旧病，保留）：catalog/manifest/sentinel 版本不一致 | `bun-install` 全 job 死 / `check-version-consistency` 报错 | `bun scripts/check-version-consistency.ts` + `bun run check:ts`（AGENTS.md 门槛已覆盖） |
| 5 | desktop 组装竞态（v1.1.16）：`release_github` 未依赖 desktop jobs，启动时 `zeta-desktop-*` artifacts 尚未上传，下载 0 个安装包，preflight 报 `found 0` | `Preflight release assets` 报 `Expected at least 5 zeta-desktop-*, found 0`，GH Release 不创建 | `release_github.needs` 必须含 `desktop_linux` + `desktop_windows`；desktop jobs 改动时核对该 needs 链 |
| 6 | preflight 期待与矩阵脱节：裁剪/恢复平台时只改构建侧，未同步校验侧 | 稳定报 `Expected at least N ..., found M`；或更糟——校验被删后**静默缺资产**发布 | 裁剪/恢复任何平台时三处同步：preflight 期待数、checksums glob、release `files:` glob；**严禁删除校验来让发布链通过**（v1.1.16 曾误删 desktop 校验，掩盖断链并漏发桌面版） |
| 7 | 手动版本 bump 漏 editor 平台包（v1.1.16）：只 bump launcher，`editor-windows-x64`/`-linux-x64` 与 launcher `optionalDependencies` pins 留在旧版 | `release_editor_packages` 重发已存在版本 → npm 409，run 红 | `release-v2.ts` Step 2f 是唯一权威 bump 路径；手动 bump 必须三包 + 两条 pins 全改 |

**发布完成的判定纪律（v1.1.16 教训）**：PR 会产生两个 run——真正的 CI run（约 21
jobs）和 "Evaluate flake" 的 1-job 轻量 run。**判断 CI 是否通过必须打开 run 核对
jobs 数量**：`jobs=1` 的 "success" 是 flake 评估器，不是 CI 绿。v1.1.16 前夕
#30/#31/#32 的"绿"全是 flake 评估器，embed 代码从未被完整验证，合并后 main 立即
三 bucket 红。

**版权面（发行物随带义务）**：根 `LICENSE` 保留上游版权行（Mario Zechner /
Can Bölük / Stencil Labs）并追加 `Copyright (c) 2026 Linxira-OS (Zeta
modifications and additions)`；`desktop/electron-builder.yml` 的
`copyright:` 与其保持同一主体；npm 包的 LICENSE 由 `ci-release-publish.ts`
从根 LICENSE 注入（`legalPayloadFiles`），修改随**下个发布版本**生效——已发布
版本不可覆盖。Vendored 上游目录（editor/TTT、uutils 组件等）自己的 LICENSE
文件原样保留，禁止追加或改写；我们的追加只出现在根 LICENSE 与
THIRD-PARTY-NOTICES 汇总。

**发布中断后的补发路径**：CI 发布链任何 job 失败后，未发布的包用
`bun scripts/publish-missing-packages.ts`（交互式，EOTP 时浏览器授权）在本地补发核心包；
新 leaf 包在 npmjs.com → package settings → Publishing access 配好 trusted publisher 后，
用 `gh workflow run ci.yml --ref main`（不打新 tag，HEAD 已带 tag 时视为 release）重跑，
已发版本会被 preflight 跳过。npm 源若为镜像，先切官方源再发布、发布后切回
（`npm config set registry https://registry.npmjs.org/` / 回 `https://registry.npmmirror.com/`）。

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

The changelog-side pre-tag gate (`[Unreleased]` completeness, no upstream
version sections, `UPDATE-LOG.md` entry) lives in
`document/dev-conventions.md` § Changelog.

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
  (currently `v18.0.11`, `v18.1.10`), plus `baseline/*` markers and Zeta
  product release tags. All other upstream history is preserved through the
  SHAs recorded in `document/upstream-sync.md`, not through tag refs.
- `origin` (the GitHub remote) is the product truth: the Zeta `main` branch,
  the `sync/omp` mirror, and short-lived `sync/omp-release/<release>` or
  `port/<scope>` integration branches. `temp/` reference clones and local
  scratch branches never reach `origin`.
- Zeta product versions are Zeta-semver, decoupled from OMP version numbers.
  OMP tags are integration baselines recorded in `document/upstream-sync.md`;
  `bun scripts/release-v2.ts <version>` bumps Zeta package versions, not
  OMP-derived ones. See **Version line tooling** above.
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
(the same two most recent tags that exist locally, currently `v18.1.13` and
`v18.1.14`). Older `backup/omp-tag/` entries are removed once the release
is superseded; full history stays reachable through `backup/omp/main`, which
mirrors `omp-upstream/main`.
