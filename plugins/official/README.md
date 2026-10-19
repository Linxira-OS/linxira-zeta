# 官方插件标准模板

官方插件位于 `plugins/official/<plugin-id>/`，每个插件必须携带以下文件
（`locales/` 为可选的 i18n 字符串表，机制已实现，见下）。
完整目录说明见 `document/plugin-system.md`；登记表见 `INDEX.md`。
安装、启用与在会话中如何生效的运行期文档见 [`docs/plugins.md`](../../docs/plugins.md)，
`pi-messenger` 的逐插件使用页见 [`docs/plugins/pi-messenger.md`](../../docs/plugins/pi-messenger.md)。

```
plugins/official/<plugin-id>/
├── plugin.json / plugin.toml    # 清单：id/name/description/source/publish/install/compat/category
├── package.json                 # @linxiraos/<plugin-id>，peer 全部指向 @linxiraos/*
├── src/ 或入口 index.ts         # 扩展工厂：registerTool / registerCommand
├── crew/agents/*.md             # 团队代理定义（agent-team 等）
├── skills/                      # 自带 skills
├── locales/{zh,en}.json         # 可选：i18n 字符串表，经宿主 ctx.t() 读取（见下）
├── README.md / CHANGELOG.md
└── tests/
```

## `locales/` 与宿主 i18n（已实现）

标准模板里的 `locales/{zh,en}.json` 是**插件宿主 i18n 的字符串表**：插件在
`package.json` 的 `zeta`（或 `omp`/`pi`）清单里声明路径，宿主把
`ctx.t(key, fallback?)` 注入给该插件扩展的 event handler / tool / command /
shortcut 上下文。

```json
// package.json
{
  "name": "@linxiraos/example-plugin",
  "version": "1.0.0",
  "zeta": {
    "version": "1.0.0",
    "extensions": ["./index.ts"],
    "locales": { "zh": "locales/zh.json", "en": "locales/en.json" }
  }
}
```

```json
// locales/zh.json —— 平坦的 Record<string, string>
{ "greeting": "你好" }
```

```ts
export default function (pi: ExtensionAPI) {
  pi.registerCommand("greet", {
    // Command descriptions are read at registration time; use ctx.t in the handler.
    description: "Greet the user",
    handler: async (_args, ctx) => {
      ctx.ui.notify(ctx.t("greeting", "Hello"));
    },
  });
}
```

约定与边界：

- 清单 `locales` 的值是相对插件根的字符串路径；非字符串/空值/未知语言标签会被
  loader 判为无效并给出明确错误。省略该字段时，宿主回落到约定的
  `locales/zh.json`、`locales/en.json`，所以按标准模板放文件即可生效。
- 文件必须是平坦 `Record<string, string>`。缺失文件静默回落；JSON 损坏或值不是
  字符串时记 warning 并跳过该语言的表，插件照常加载。
- 查找顺序：当前宿主语言 → `en` → `fallback` → `key`。语言每次调用实时读取，
  `/language` 切换立即生效，无需重载插件。
- 字符串表按插件隔离：插件 A 的扩展看不到插件 B 的条目。非插件来源的扩展
  （`settings.extensions`、`-e`、inline factory）没有字符串表，`t()` 直接返回
  `fallback` 或键名。
- 新建插件**推荐**携带 `locales/{zh,en}.json`；存量插件（如
  `plugins/official/pi-messenger`）**豁免**，其英文硬编码文案的抽取仍按计划推进。
  "必须携带 locales" 仍不是插件准入的硬要求，`INDEX.md` 登记表不因缺少
  `locales/` 而拒绝收录。

运行期说明见 [`docs/plugins.md`](../../docs/plugins.md#plugin-i18n-ct)，
设计契约见 [`document/plugin-system.md`](../../document/plugin-system.md#插件宿主-i18n已实现)。

## 依赖改写（常驻构建步骤）

源码与 `package.json` 直接持有 `@linxiraos/*` 引用，不再使用上游
`@earendil-works/*`。改写映射（按包名）：

| 上游 | Zeta |
|---|---|
| `@earendil-works/pi-coding-agent` | `@linxiraos/pi-coding-agent`（zeta） |
| `@earendil-works/pi-ai` | `@linxiraos/pi-ai` |
| `@earendil-works/pi-agent-core` | `@linxiraos/pi-agent-core` |
| `@earendil-works/pi-tui` | `@linxiraos/pi-tui` |

`scripts/publish-missing-packages.ts` 的 `rewriteEarendilDeps` 保留为发布兜底，
但官方插件源码内已常驻 `@linxiraos/*`。

## 发布腿

官方插件随 Zeta 发布线发布，腿在 `ci.yml` 的 `release_plugin_packages`
（`bun run ci:release:publish-plugin` → `ci-release-publish.ts --plugin
plugins/official/<id>`），把插件目录**原样打包**（`index.ts` 入口、`crew/**`、
`skills/**`、`bin` → `install.mjs`），不跑 workspace `packages` 表那条
declaration emit 路径——插件发布的是宿主加载器要 transpile 的 TS 源码。
`plugins/official/pi-messenger` 于 2026-10-14 接上该腿（此前只有本地手工补发）。

新增官方插件的两处必改：`package.json` 的 `ci:release:publish-plugin` 目标目录，
以及 `scripts/brand/ci-surface-registry.ts` 中 `release_plugin_packages` 的登记
（一个 job 发一个插件；再增插件时扩 `--plugin` 调用点）。npm 侧 trusted
publisher 必须绑 `.github/workflows/ci.yml`（见 `document/release.md`）。

## 清单示例

```jsonc
{
  "id": "<plugin-id>",
  "name": "<显示名>",
  "description": "<一句话描述>",
  "source": "<上游仓库 URL>",
  "publish": "@linxiraos/<plugin-id>",
  "install": "npm",
  "compat": { "zeta": "^1.1.0" },
  "unuse": false,
  "category": "official"
}
```
