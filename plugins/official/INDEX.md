# Zeta 官方插件目录

> 官方（official）插件 = Zeta 第一方移植/维护的开源插件（MIT、Apache-2.0 等）
> 或 Zeta 自研插件。来源与依赖改写（`@earendil-works/*` → `@linxiraos/*`）都由
> Zeta 负责，保证正确。本文件是官方插件的追踪文档，随构建期快照打包分发。

## 登记表

| 插件 id | 名称 | 类别 | 来源 | 兼容记录 | 状态 |
|---|---|---|---|---|---|
| `pi-messenger` | Messenger | inter-agent messaging | https://github.com/nicobailon/pi-messenger | peer/源码改写为 `@linxiraos/*`；Zeta 1.1.x | 已迁入 `plugins/official/pi-messenger/` |

## 类别

官方插件按设计决议分三档（详见 `document/plugin-system.md`）：

- **P0 基座**（无 UI）：agent-team 多代理任务编排 / 人设群聊，前置中的前置。
- **P1 桌宠助手**（带 UI）：系统级桌面悬浮，Linux 首发，依赖 P0。
- **P2 科学插件**（带 UI）：定时文献扫描 / pipeline，依赖 P0。

## 加入官方目录的要求

1. 插件源码受版本控制，位于 `plugins/official/<plugin-id>/`（不再使用
   `temp/` 等 gitignored 路径）。
2. 携带标准模板文件：`plugin.json`/`plugin.toml`、`package.json`（peer 全部
   指向 `@linxiraos/*`）、`src/`（registerTool / registerCommand）、`crew/`、
   `skills/`、`locales/`、`README.md`、`CHANGELOG.md`、`tests/`。
3. `package.json` 与全部源码 import 已常驻 `@linxiraos/*`（`@earendil-works/*`
   改写是常驻构建步骤，不依赖发布时临时改写）。
4. 版本线跟随 Zeta 发布版本；经 `scripts/publish-missing-packages.ts` 统一发布。

## 兼容记录写法

每行记录：插件 id、所基于的上游 commit/SHA、依赖改写映射表、在哪个 Zeta
版本上做过加载/工具注册冒烟、已知不兼容点。上游插件升级时先在此更新记录，
再同步源码。
