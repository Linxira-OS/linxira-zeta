# Zeta 官方插件目录

> 官方（official）插件 = Zeta 第一方移植/维护的开源插件（MIT、Apache-2.0 等）
> 或 Zeta 自研插件。来源与依赖改写（`@earendil-works/*` → `@linxiraos/*`）都由
> Zeta 负责，保证正确。本文件是官方插件的追踪文档，随构建期快照打包分发。

插件如何安装、启用并在会话中生效（运行期文档，随产品打包）：[`docs/plugins.md`](../../docs/plugins.md)；
`pi-messenger` 的逐插件使用页：[`docs/plugins/pi-messenger.md`](../../docs/plugins/pi-messenger.md)。

## 随产品分发（内置 `official` 目录）

内置 `official` 目录由**清单本身**派生，不另有人工维护的 id 列表：

- `plugin.json` 声明 `"distribution": "bundled"` 的插件才进入内置目录（当前只有
  `pi-messenger`；`example-panel` 是教学示例，不随产品分发）。
- 版本取该插件 `package.json` 的 `version`（`plugin.json` 未写版本时）。
- 构建期 `packages/coding-agent/scripts/official-plugins.ts` 读取这些清单，按插件自己的
  `package.json#files` 复制其发布内容到 `packages/coding-agent/dist/official-plugins/<id>`
  （总是带上 `plugin.json`/`package.json`；`tests/`、`node_modules/` 永不复制），并写出
  `dist/official-plugins.generated.json` 清单快照，两者都经 `package.json` 的 `files`
  发布；`prepack`（`bun run gen:bundle`）负责生成。独立二进制内嵌同一份快照
  （`ZETA_OFFICIAL_PLUGINS_EMBED`），只有清单、没有源码。
- 运行期：首次 `zetacode plugin list` / `discover` / `enable` 把内置插件**离线**安装进
  插件缓存，写入 `installed_plugins.json`（id 为 `<id>@official`）且 `enabled: false`；
  启用始终是显式的 `zetacode plugin enable <id>`。一次性记录在
  `<plugins>/.official-plugins-seeded.json`，因此卸载过的插件不会被下一次运行重新装回。
- 新增一个随产品分发的官方插件：在其 `plugin.json` 加 `"distribution": "bundled"`，
  并登记到本文件的表格；无需改动任何代码或清单列表。

## 登记表

| 插件 id | 名称 | 类别 | 来源 | 兼容记录 | 状态 |
|---|---|---|---|---|---|
| `example-panel` | Example Panel | 教学示例（三层插件：工具 + 声明式面板 + web 页） | 仓内自研（`plugins/official/example-panel`） | 三层产物齐全：工具 `example_panel_data`、`plugin.json` 的 `list`/`form`/`chart` 面板、`pages/index.html`；i18n `locales/{en,zh}.json` 键完全对齐；冒烟：`bun test packages/coding-agent/test/plugin-example-panel.test.ts`（真实扩展加载器 + 真实 locale loader）；可分发环境：`bun scripts/build-example-plugin-zip.ts` | 已收录；随发布线上传 `zeta-plugin-example-<version>.zip` |
| `pi-messenger` | Messenger | inter-agent messaging | https://github.com/nicobailon/pi-messenger | 上游 commit/SHA：`a704e7202fa5`（2026-10-30，release 仍为 `v0.15.2`）；改写：`@earendil-works/pi-coding-agent`→`@linxiraos/zeta`，其余 `@earendil-works/*`→`@linxiraos/*`（逐名映射见 `README.md`）；上游 `#41`（`ctx.ui.theme` 缺失时回退纯文本）与 `#42`（`session_shutdown` 用 `state.cwd`，别读已失效的 ctx）已移植；`#40`（Windows 不 spawn `pi.cmd`）由本移植自己的 `getCliSpawnCommand`（`crew/agents.ts`，只解析 `zetacode`、拒绝 `.cmd`）覆盖，不重复移植；加载/工具注册冒烟：`bun test packages/coding-agent/test/plugin-pi-messenger.test.ts`（宿主真实 `loadExtensions` → `pi_messenger` + `teamagent`/`editor`/`messenger`）；已知不兼容：web/桌面（`!ctx.hasUI`）无 overlay 显示面，需独立显示面 | 已迁入 `plugins/official/pi-messenger/`（独立插件包，不在根 workspace 内；版本随 Zeta 发布线；npm `@linxiraos/pi-messenger@1.4.7` 已发布，`plugin link`/`install` 可装，但不随产品默认安装） |

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
   `skills/`、`README.md`、`CHANGELOG.md`、`tests/`。
   `locales/` 不在此列：它是**预留目录**——宿主 i18n 机制
   （`ExtensionContext.t()` + 清单 `locales` 字段 + loader 读取 `locales/*.json`）
   尚未实现（见 `README.md`、`document/plugin-system.md`；机制登记在
   `document/roadmap.md` Deferred Queue），新建插件可选携带，存量插件豁免。
3. `package.json` 与全部源码 import 已常驻 `@linxiraos/*`（`@earendil-works/*`
   改写是常驻构建步骤，不依赖发布时临时改写）。
4. 版本线跟随 Zeta 发布版本；经 `ci.yml` 的 `release_plugin_packages`
   （`ci-release-publish.ts --plugin plugins/official/<plugin-id>`，原样打包插件
   目录）发布，本地补发仍可用 `scripts/publish-missing-packages.ts`。
5. 要随产品分发（进入内置 `official` 目录、默认安装但禁用）的插件，须在其
   `plugin.json` 声明 `"distribution": "bundled"`，并且 `package.json` 带可用的
   `version` 与 `name`；否则它只是本仓插件，不出现在 `zetacode plugin marketplace`
   的内置目录里。详见上文「随产品分发」。

## 兼容记录写法

每行记录：插件 id、所基于的上游 commit/SHA、依赖改写映射表、在哪个 Zeta
版本上做过加载/工具注册冒烟、已知不兼容点。上游插件升级时先在此更新记录，
再同步源码。
