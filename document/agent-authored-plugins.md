# Agent-authored plugins and the page-host protocol

> 状态：调查 + 设计稿（2026-11-02）。未实现；条目登记在
> [`roadmap.md`](./roadmap.md) 的 P1「Agent-authored plugins / page protocol」。
> 目标：让 agent 能在**不改仓库源码**的前提下创建、验证、加载、提升自己的
> 插件；同时给后端页面定一个版本化协议，而不是让每个插件自带一套 HTTP 服务。

## 0. 结论

1. **Claude Code 的 “mods” 不是开放标准**，是 Claude Code 自己的插件内
   TypeScript 事件中间件 API；能力很强，但明确不沙箱、按信任安装。
2. **真正的开放标准是 Agent Plugins 1.0.0**（`agent-plugins.org`）：可移植的
   `plugin.json` + `skills/` + `mcp.json`；Zeta 已经实现其 skills/MCP 发现
   （provider `agent-plugins`）。
3. Zeta 自己的插件系统已经覆盖 tools/commands/declarative panels/HTML pages；
   缺的是**agent 创作生命周期**（dev 目录、验证、热加载、逐文件批准、提升）
   和**页面宿主协议**。
4. 建议：打包对齐 Agent Plugins 1.0；运行面用 Zeta 插件；mods 只作为事件
   中间件的参考，不做兼容层，也不照搬“不沙箱”的信任模型。

## 1. 三个东西的边界

| 名称 | 是什么 | 是否标准 | 运行方式 | 信任模型 |
|---|---|---|---|---|
| Claude Code mods | 插件里的 `hooks/hooks.json` + `register.js`，`register(on)` 注册事件中间件 | 否，Claude 产品 API | 与 Claude Code 同进程；可改写提示、拦截工具、审批权限、画 UI；热重载 | 不沙箱，按来源信任；企业有 `sec-default` 管理 mod |
| Agent Plugins 1.0.0 | 可移植包：`plugin.json`、`skills/`、`mcp.json`、反向域名客户端扩展 | **是**，TSC 含 Amazon/Cursor/Microsoft/OpenAI/Vercel | 客户端各自加载 skills/MCP；分发/权限/UX 由客户端决定 | 由客户端决定 |
| Zeta plugin | `package.json` 的 `zeta` 块 + extension 模块；tools/commands/hooks；`plugin.json` 声明 panels；任意 `.html` 页面 | 否，Zeta 自有 | 会话进程加载扩展；GUI 原生画面板；页面在 iframe 里 | 安装即信任；当前无逐文件审批 |

### 1.1 Claude mods 的关键事实

- 文件：`.claude-plugin/plugin.json`、`hooks/hooks.json`（`modules` 指向代码）、
  `register.js` 导出 `register(on)`。
- 每个 hook 收到 `($, e, next)`：`$` 是 mods API（`$.command`、`$.ui`、
  `$.state` 等），`e` 是事件，`next` 交给下一个 mod/核心。
- 事件：`session.start`、`tool.call`、`command.run`、`ui.render` 等；可观察、
  可回答、可改写、可包裹。
- agent 可以自己写、安装、热重载；开发目录是
  `~/.claude/dev-mods/<session-id>/`，默认/acceptEdits 模式下逐文件批准；
  会话结束/过期清理；`claude plugin validate` 做静态分析。
- 明确不沙箱：“same access to your machine as Claude Code itself”。

结论：这是**产品级扩展 API**，不是可移植标准。可以借鉴事件中间件与逐文件
批准，但不能把“同进程、无沙箱”直接搬进 Zeta。

### 1.2 Agent Plugins 1.0.0 的关键事实

- 目录：`plugin.json`（声明目标版本）、`skills/<name>/SKILL.md`、`mcp.json`；
  客户端专有内容放反向域名命名空间（如 `com.example.client/`）。
- 只定义可移植的 skills 与 MCP；分发、安装、权限、UX 留给客户端。
- Zeta 已有 `agent-plugins` provider（priority 75），从 marketplace /
  `--plugin-dir` / extension roots 发现 skills 与 MCP；混合包仍可走旧 provider。

结论：**这是要跟的标准**。Zeta 应保证 Agent Plugins 1.0 包能被验证、列出、
加载；不需要为它再造一套安装器。

## 2. Zeta 现状与缺口

| 能力 | 现状 | 缺口 |
|---|---|---|
| 插件包 | `package.json` 的 `zeta`/`omp`/`pi` 块；`plugin.json` panels；`.html` pages | agent 没有“开发目录”概念 |
| 工具/命令 | extension 模块 `registerTool` / `registerCommand` | 注册发生在加载时；无热重载 |
| Hooks | extension hooks / capability hooks | 无逐文件批准与哈希 |
| UI | 声明式 `list/form/chart`（数据来自一次 tool call）；HTML iframe | HTML 页面没有版本化宿主桥 |
| 安装 | `plugin_manager`：list/install/uninstall/set_enabled；支持本地目录 | 安装后 `restartRequired`；无 `validate`/`load_dev`/`promote` |
| 验证 | marketplace source validation；`plugin doctor` 检查声明条目 | 不对 agent 新写的模块做导入/静态检查 |
| 清理 | 无 session dev 目录 | 需要过期清理与 discard |

## 3. 建议的 agent 创作生命周期

目录（用户目录，不写仓库）：

```text
<agentDir>/plugins-dev/<sessionId>/<plugin-name>/
  package.json          # zeta manifest + extension entry
  plugin.json           # optional panels / Agent Plugins schema
  index.ts              # extension factory
  pages/…               # optional HTML
```

| 步骤 | 触发 | 行为 | 批准 |
|---|---|---|---|
| scaffold | agent 请求 | 在 dev 目录建最小包；不写仓库 | 文件创建逐项批准 |
| validate | agent 请求 | 检查 manifest、入口存在、路径 containment、Agent Plugins schema、导入静态分析 | 只读 |
| load_dev | agent 请求 | 会话内加载；注册 tools/commands/hooks；失败不影响主会话 | 逐文件批准 + 哈希 |
| reload | 回合结束/文件变更 | 重新 import 并替换注册；失败保留上一版 | 仅已批准文件 |
| promote | **用户**操作 | 复制到 `~/.zeta/agent/plugins/<name>` 或导出 zip；可发布 marketplace | 显式确认 |
| discard | agent/用户 | 删除 dev 目录；会话结束按 `cleanupPeriodDays` 清理 | — |

安全规则：

- 只在交互式、受信任工作区启用；`-p`/headless/`--safe-mode`/无 TTY 一律不加载。
- 逐文件批准；文件哈希变化重新批准；`hooks`/`tools` 明确标注“会执行代码”。
- 路径 containment：只能写 dev 目录、插件 `ctx.storage`、项目 `.zeta/`；不能写仓库源码。
- agent 不能 promote、不能安装 marketplace、不能改核心；promote 必须用户确认。
- 与工具档位一致：`plugin_manager` 默认不在 minimal/standard；agent 通过
  `read xd://plugin_manager` 请求启用，批准后才能创作。

## 4. 页面宿主协议

现状：HTML 页面在 chrome-free iframe 中，同源，可直接 `fetch("/api/*")`；
声明式面板的数据源是**一次 tool call**，不是 HTTP 路由。缺一个稳定的宿主桥。

建议分两层：

| 层 | 用途 | 协议 |
|---|---|---|
| 声明式面板（默认） | 列表/表单/图表；大多数 agent 生成的 UI | 不需要新协议：`plugin.json` 的 `ui.panels` + tool `details` |
| HTML 页面（高级） | 需要自定义交互的页面 | 版本化 `window.zeta` postMessage 桥，`1.0` |

`window.zeta` 1.0 最小消息集：

| 消息 | 方向 | 作用 |
|---|---|---|
| `ready` | page → host | 页面加载完成，声明协议版本与所需能力 |
| `callTool` | page → host | 调用本插件已注册的 tool；host 按 tool 的 approval 走审批 |
| `getContext` | page → host | 只读上下文（主题、语言、cwd、插件 id） |
| `subscribe` | page → host | 订阅本插件声明的事件（如 `tool.call` 的只读投影） |
| `notify` | page → host | 宿主通知/toast |
| `resize` | page → host | 内容高度变化 |
| `result` / `error` | host → page | 请求结果；错误带 code |

约束：origin 校验、按插件 id 隔离、能力白名单、版本协商；页面不能直接拿
任意 host 权限；不提供任意 HTTP 服务。HTTP `/api/*` 继续作为只读数据面，
写操作必须走 `callTool`。

## 5. 守护面

| 守卫 | 检查 |
|---|---|
| `check-plugin-dev-root` | dev 目录在 agentDir 内；插件不能写仓库源码 |
| `check-plugin-approval` | headless/untrusted 不加载 dev 插件；哈希变化重批准 |
| `check-page-bridge` | 协议版本、origin、能力白名单 |
| `check-agent-plugin-conformance` | Agent Plugins 1.0 `plugin.json`/skills/mcp 校验 |
| `check-plugin-capabilities` | 插件声明的 tools/commands/hooks 与运行时注册一致 |

## 6. 实施阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 | dev 目录 + scaffold + validate + load_dev + 逐文件批准 | agent 能在会话内创建并加载一个只读工具插件；仓库无新文件 |
| P2 | reload + promote/export + cleanup | 回合结束重载；promote 后重启仍可用；dev 目录可清理 |
| P3 | 页面宿主桥 1.0 + 声明式面板优先 | 一个 HTML 页面能 `callTool` 并拿到结果；无新 HTTP 服务 |
| P4 | Agent Plugins 1.0 验证/列出 | 标准包 skills/MCP 可被 `plugin validate` 识别 |
| P5 | 事件中间件（可选） | 只有出现明确需求才做；不实现 Claude mods 兼容层 |

## 7. 未决

| # | 问题 | 建议 |
|---|---|---|
| 1 | dev 插件目录放用户目录还是会话目录 | 用户目录 + session 子目录，便于清理与审计 |
| 2 | 是否允许 agent 直接 `load_dev` | 允许，但必须逐文件批准；headless 禁止 |
| 3 | HTML 页面桥用 postMessage 还是 HTTP JSON-RPC | postMessage；HTTP 只读 |
| 4 | 是否兼容 Claude mods 格式 | 不兼容；只借鉴事件中间件与逐文件批准 |
| 5 | Agent Plugins 1.0 是否作为唯一打包格式 | 作为可移植子集；Zeta 自有扩展继续用 `zeta` 块 |
