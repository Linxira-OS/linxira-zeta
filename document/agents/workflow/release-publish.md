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
  2026-11-05 冻结，`release_web_ui_packages` 只在 `publish_web_ui` 输入为真时运行。
  `@linxiraos/main`（zetawork）已于 2026-11 从树中移除：`release_main_packages`、
  `publish_zetawork` 与 `main-publish.yml` 均已删除，npm 上的已发布版本保持
  deprecated/reserved。"链路已接线"不等于"每轮发布"。
- **产品渲染器不单独发 npm**：`web-app`（`@linxiraos/zeta-web-app`，`private`）
  随 `zeta serve` / 安装包分发；它的构建门禁在 CI `check` job，不在发布链。

