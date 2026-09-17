# 官方插件标准模板

官方插件位于 `plugins/official/<plugin-id>/`，每个插件必须携带以下文件。
完整目录说明见 `document/plugin-system.md`；登记表见 `INDEX.md`。

```
plugins/official/<plugin-id>/
├── plugin.json / plugin.toml    # 清单：id/name/description/source/publish/install/compat/category
├── package.json                 # @linxiraos/<plugin-id>，peer 全部指向 @linxiraos/*
├── src/ 或入口 index.ts         # 扩展工厂：registerTool / registerCommand
├── crew/agents/*.md             # 团队代理定义（agent-team 等）
├── skills/                      # 自带 skills
├── locales/{zh,en}.json         # i18n 字符串表（宿主注入 t()）
├── README.md / CHANGELOG.md
└── tests/
```

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
