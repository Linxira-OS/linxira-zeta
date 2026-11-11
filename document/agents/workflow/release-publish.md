<!-- 从根 AGENTS.md 原文移出（2026-10-25 精简，未改写）。npm 发布面（trusted publishing 握手、新包引导顺序）。 -->

# 发布面：npm trusted publishing

> 硬约束：仓库里不存在 npm token，一律 OIDC trusted publishing。
> 发布链 job 清单与 tag 流程：`document/release.md`。

## npm 发布（2026-10-19 裁定：无 token）

- **仓库里不存在 npm token。** `NPM_TOKEN` / `NODE_AUTH_TOKEN` 一律不得写进
  workflow、脚本或文档；所有发布走 **trusted publishing（GitHub OIDC，
  `id-token: write`）**。理由：npm 自 2026-08 起收紧 2FA，绕过 2FA 的 token
  2027-01 起不能直接发布；长期 token 是没人能安全轮换的凭据。
- **trusted publisher 是逐包的两步握手。** 在 npm 后台新增条目后状态是
  `Pending validation` 并带截止时间，必须在窗口内成功发布一次才会生效；逾期
  变 `Expired`。发布失败表现为 `404 Not Found - PUT ...`（v1.3.0 的
  `@linxiraos/pi-messenger` 即此）。条目里的仓库与 workflow 文件名必须精确匹配
  （`.github/workflows/ci.yml`）。
- **新包的引导顺序固定**：先由维护者**手动**发第一个版本（npm 后台 + 2FA），
  再在 npm 后台为该包配置 repository + workflow，之后才允许 CI 自动发布。
  缺任一步，CI 侧只会得到 404。
- **workspace 发布清单**在 `scripts/ci-release-publish.ts` 的 `packages`
  （2026-11-05 改名后：`packages/omptype` 发 `@linxiraos/zeta-schema`、
  `packages/snapcompact` 发 `@linxiraos/zeta-compact`）；以包内 `name` 为准，
  目录名不随包名改。
- **冻结 / 暂停面只在 dispatch 时发**：`web-ui`（`@linxiraos/zeta-web`）自
  2026-11-05 冻结，`release_web_ui_packages` 只在 `publish_web_ui` 输入为真时运行；
  `@linxiraos/main`（zetawork）暂停，`release_main_packages` 只在
  `publish_zetawork` 为真时派发 `main-publish.yml`。"链路已接线"不等于"每轮发布"。
- **产品渲染器不单独发 npm**：`web-app`（`@linxiraos/zeta-web-app`，`private`）
  随 `zeta serve` / 安装包分发；它的构建门禁在 CI `check` job，不在发布链。

## GitHub Packages（结论：不启用）

**不启用 `npm.pkg.github.com`，也不新增第二发布源。** 结论依据：

- 公开安装面已经是 **npmjs 的 `@linxiraos/*`**，发布走 OIDC trusted publishing；
  仓库里没有 `.npmrc`、`publishConfig.registry` 或 `npm.pkg.github.com` 引用。
- `Linxira-OS/packages` 是 Arch Linux 的 PKGBUILD 构建仓，`Linxira-OS/linxira-packages`
  是签名的 `[linxira]` pacman 仓库（GitHub Pages）；两者都不是 JavaScript registry，
  不能替代 npm。
- 同组织的 LKB 只发布 GitHub Release 资产与 GHCR 镜像
  （`ghcr.io/linxira-os/linxira-knowledge-base`），没有 npm / crates.io 发布腿；
  当前没有被要求镜像到 GitHub Packages 的包。
- GitHub Packages 的 npm registry 即使对 public 包也要求认证，会给
  `npm i -g @linxiraos/zeta` 增加 token / `.npmrc` 门槛，同时复制一套 provenance
  与发布链，收益为零。

只有在出现**已证实的**需求时再评估：npm 侧无法承载的内部私有包，或 npm 发布被
阻断且 GitHub Packages 能解决。届时先记录证据与迁移成本，不预先接线。

