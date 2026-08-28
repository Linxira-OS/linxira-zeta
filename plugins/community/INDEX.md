# Zeta 社区插件目录

> 社区（community）插件 = 外部第三方提交、或收录自 pi/OMP 上游、经 Zeta 验证
> 可用的插件。本目录**只放元数据指针文件**（`<plugin-id>.json` 或
> `<plugin-id>.toml`），不放代码。机器可读字段以 JSON 为主；TOML 用于偏配置/
> 人设类条目，两者等价、可互转。

## 指针文件字段

```jsonc
{
  "id": "<plugin-id>",
  "name": "<显示名>",
  "description": "<一句话描述>",
  "source": "<上游仓库 URL>",        // 从哪拉取
  "publish": "<@linxiraos/* 包名或空>", // 走 npm 时填写
  "install": "npm | github | release-zip",
  "compat": { "zeta": "^1.1.0" },
  "unuse": false,                    // true = 暂不启用（不展示/不安装）
  "category": "community"
}
```

## 收录登记

| 插件 id | 来源 | 拉取方式 | 依赖改写说明 | 准入 CI | 兼容记录 |
|---|---|---|---|---|---|
| （示例）`pi-foo` | https://github.com/… | npm | `@earendil-works/pi-ai` → `@linxiraos/pi-ai` | 通过 | Zeta 1.1.x 加载冒烟 OK |

## 社区准入流程

1. 外部贡献者提交 PR，携带插件指针文件 + 依赖改写说明。
2. 通过插件 CI（校验 `@earendil-works/*` → `@linxiraos/*` 改写、peer 解析、
   加载冒烟）。
3. CI 通过并评审后，才把插件描述加入本索引。

## 兼容记录写法

每行记录：插件 id、上游仓库与 commit/SHA、依赖改写映射表、在哪个 Zeta 版本上
验证过、已知不兼容点。上游插件升级时先在此更新记录，再同步指针文件。
