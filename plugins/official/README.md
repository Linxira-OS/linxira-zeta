# 官方插件标准模板

官方插件位于 `plugins/official/<plugin-id>/`，每个插件必须携带以下文件
（`locales/` 除外：预留目录，机制未实现，见下）。
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
├── locales/{zh,en}.json         # i18n 字符串表（预留目录：宿主 i18n 机制未实现，见下）
├── README.md / CHANGELOG.md
└── tests/
```

## `locales/` 与宿主 i18n（预留；机制未实现）

标准模板里的 `locales/{zh,en}.json` 是**预留目录**。宿主 i18n 机制——宿主注入
`t()`（`ExtensionContext.t()`）+ 清单 `locales` 字段 + loader 读取
`locales/*.json`——**尚未实现**，仓库内只有文档约定（本文件、
`document/plugin-system.md`）。因此：

- 新建插件**可选**携带 `locales/{zh,en}.json`，为机制落地做准备；
- 存量插件**豁免**：`plugins/official/pi-messenger` 的用户可见字符串目前仍是英文
  硬编码（overlay / 命令 / 工具描述 / handler 文案），尚未抽出。

机制本身登记在 `document/roadmap.md` 的 Deferred Queue。**在机制落地之前，
"必须携带 locales" 不是插件准入的硬要求**，`INDEX.md` 的登记表也不因缺少
`locales/` 而拒绝收录。

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
