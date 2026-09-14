# Changelog

## [Unreleased]

## [1.1.14] - 2026-09-12

- Web 网关新增模型目录三端点(`/api/models-config/catalog|discover|metadata`),ModelsConfig 支持在线模型目录、按 API 类型的发现与元数据;补 `/api/agent/running` 字面路由。
- CLI 侧边栏改为插件式 widget 注册表(`ctx.ui.registerSidebarWidget`),第三方 widget 由 `tui.sidebarWidgets` 开关控制(默认关);移除与状态行重复的 Session 面板。
- `/settings reset [confirm|<key>]`:支持全部重置(二次确认)与单键重置。

## [1.1.13] - 2026-09-10

- 上游 v18.1.16 同步:任务执行器 AgentBusyError、事件循环 keepalive、idle 封装截止时间、上下文笔记等。
- 修复中文界面设置布尔项无法关闭的问题(显示文案误入机器值匹配)。
- `/language` 切换后斜杠命令描述即时刷新,无需重启。
- Plan/Plan-ultra/Vibe/Goal 模式横幅与 attach 模式提示接入 i18n;`/loop`、`/rename` 描述进目录。

## [1.1.12] - 2026-09-10

- Brand token sweep across the shipped VM protocol families: eval JS/Python kernel symbols (`__zeta_prelude__`, `__zeta_display__`, `__zeta_magic`/`__zeta_shell`), browser/computer bridge protocol names, and the shell snapshot helper now use the zeta naming; retained interop surfaces (`.omp-plugin`, `mcp__omp__`, the persisted silent-abort marker, `__ompInstallTokioRuntime`) are unchanged per the brand registry.
- Fixed legacy-pi extension hot reload on Windows: module specifiers now keep the `?mtime` cache-busting query (plain slash paths), so edited extension source takes effect on reload instead of being pinned to the first load.
- Web UI sidebar: default off with persisted toggle state, overlap with the status line fixed, plus running-session pin, usage line, and quick actions.

## [1.1.11] - 2026-09-08

### Added

- Muse Code provider support end to end: subscription sign-in with credential refresh, inference, live account-scoped model discovery, and quota reporting in `/usage` with durable rate-limit backoff; Muse Code sessions send a compact hashline edit description (~3 KB less per request), all other providers keep the full prompt.
