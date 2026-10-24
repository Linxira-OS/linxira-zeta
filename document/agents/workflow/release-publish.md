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

