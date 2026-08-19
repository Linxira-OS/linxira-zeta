# Zeta 更新日志

## v1.0.10（未发布）

### 同步基线

- 当前基于 **OMP 17.3.8**（`858f7dd91f`）。
- 完整合并 OMP 17.3.8 官方 tag（分支 `zeta/v1.1.10-17.3.8`，合并提交 `2bf455c9c3`，`git merge-base --is-ancestor` 已验证），59 个冲突按 AGENTS.md 政策表解决：
  - 保留 Zeta 包名/版本（`@linxiraos/*` @ 1.0.9、workspace 1.0.9、native sentinel `__piNativesV1_0_9`）。
  - 接受上游依赖图（`bun.lock` 以 `@linxiraos/*` 名重新生成、`Cargo.lock` 经 `cargo metadata` 对齐）。
  - 上游实现 + Zeta 覆盖（i18n 键、`.zeta` 路径、`@linxiraos` 导入、Zeta 特性）逐文件保留；测试按 tests-as-contract 成对接受并适配 `.omp` → `.zeta`。
  - `issue-887-repro.test.ts` 保留（上游删除），其 qwen3.7-max 断言随 17.3.8 `models.json` 路由更新。
- 合并分支已并入 `main`（合并提交 `76588be094`，无冲突；跟随修复提交 `82309f384d` 在其上保留）。
- 跟随修复（Phase 1-8，见各包 `CHANGELOG.md`）：stats 独立窗口导航、更新流程（checking 态 / 已是最新提示 / CLI 交互确认与 `--yes`）、微信 v1 API 登录与 peer 持久化及解绑、飞书首聊 onboarding、`allowedPeers` 白名单、web-ui `/plan` 进入计划模式、models 配置卡片去重、desktop 二次点击恢复、桌面菜单 i18n、设置面板新增可编辑项。

## v1.0.9（2026-08-19）

### 新增

- 远程 `@plan <题目>`：IM 渠道（Telegram / 飞书 / 微信）向协调者发起计划模式，计划完成后以图片（无 Chromium 环境降级为文本）发送到手机，回复 1 执行 / 2 压缩后执行 / 3 新会话执行 / 4 取消。
- Web UI 设置面板新增"关于 / 使用"文档页：用户手册、Web UI 架构、网关 API 三份文档，语言跟随界面，章节目录可点击定位。
- 网关新增 `GET /api/docs/<path>`：随包 Markdown 文档（编译二进制 / npm 包内嵌，源码目录开发兜底）。
- Web UI 会话新增计划审批卡片（PlanApproval）：`get_state` 返回计划内容，可在界面上直接选择执行方式。
- 随包中英双语文档：`docs/web-ui/architecture`、`docs/web-ui/api`、`docs/user-guide`。

### 修复

- CI `setup-system-deps` apt 镜像挂死：改用规范镜像、带 kill-after 的超时、有界重试；`install_methods` 任务设超时上限。
- `update-cli` 恢复提示对齐 Zeta 安装地址。
- **CI 发布链拆分修复**：`release_gate` 拆为 `release_quality_gate`（测试门，`skip_tests` 时豁免）与 `release_build_gate`（产物门），发布作业分别受两门控制；`build_only` 新增（只构建不发布）。
- **browser-relay 扩展包文件名修复**：构建输出从 `omp-browser-relay-extension.zip` 改为 `zeta-browser-relay-extension.zip`，修复 GitHub Release 生成时 checksums 找不到文件（ENOENT）导致发布失败的问题。

### 发布与 CI 纪律

- 触发纪律（已写入 `AGENTS.md`）：`push` 只做质量检查、永不发布；`.github/**` 不再自我触发完整 CI（CI 改动走 `workflow_dispatch` 手动验证）；发布只走 `release-v2` 原子推送或 `workflow_dispatch`（`skip_tests` / `build_only`）。
- 凡发布 tag 必须同步更新本文件（`UPDATE-LOG.md`），与各包 `CHANGELOG.md` 同等级别的发布门禁。
- v1.0.9 npm 包已发布（trusted publishing）；GitHub Release 资产在修复后重新发布中。

### 同步基线

- 当前基于 **OMP 17.3.5**。
- **尚未同步 OMP 17.3.7 / 17.3.8**（OMP Release Sync Policy 要求官方 tag 完整验证后合并，待后续版本跟进）。

## 早期版本（v1.0.8）

- 桌面版与系统托盘（关闭窗口后常驻托盘）。
- 独立的追踪文档功能（默认关闭，`tracking.enabled`）。

更早版本记录见各包 `packages/*/CHANGELOG.md`。
