# Zeta 更新日志

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

### 同步基线

- 当前基于 **OMP 17.3.5**。
- **尚未同步 OMP 17.3.7**（OMP Release Sync Policy 要求官方 tag 完整验证后合并，待后续版本跟进）。

## 早期版本（v1.0.8）

- 桌面版与系统托盘（关闭窗口后常驻托盘）。
- 独立的追踪文档功能（默认关闭，`tracking.enabled`）。

更早版本记录见各包 `packages/*/CHANGELOG.md`。
