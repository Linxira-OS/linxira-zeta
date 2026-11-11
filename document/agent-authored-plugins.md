# Agent-authored plugins and the page-host protocol

> 状态：调查 + 设计稿（2026-11-02）。本文的 §1–§4.1 保留当时的调查与
> 设计建议，**不代表全部已实现**；其中逐文件批准、headless 一律禁止、
> TUI/TSP `ui.slots`/`ui.pages`/`ui.actions` 等仍是历史建议。REQ-055 的
> 当前实现边界以 [ADR 0026](./adr/tentative0026-agent-authored-plugins.md)
> 与 [`docs/plugins.md`](../docs/plugins.md)、[`writing-a-plugin.md`](../docs/writing-a-plugin.md)
> 为准。
>
> 实施状态（2026-11-12）：session-local dev 生命周期、用户 CLI
> promote/export、网关 manifest 页面与受控资产、Studio `window.__zetaPage`
> v1 页面桥、`plugins.callTool` allowlist 已落地；TSP 槽位/页面/动作协议
> **未实现**，本文只把 §4.1 作为后续设计记录。dev 页面采用 promote 后预览，
> 不为 live dev 页面扩大新的 TSP/页面契约。
>
> 原始目标（2026-11-02）：让 agent 在不改仓库源码的前提下创建、验证、
> 加载、提升自己的插件，并给 HTML 页面定一个版本化宿主协议。

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

| 名称                | 是什么                                                                                                           | 是否标准                                             | 运行方式                                                             | 信任模型                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| Claude Code mods    | 插件里的 `hooks/hooks.json` + `register.js`，`register(on)` 注册事件中间件                                       | 否，Claude 产品 API                                  | 与 Claude Code 同进程；可改写提示、拦截工具、审批权限、画 UI；热重载 | 不沙箱，按来源信任；企业有 `sec-default` 管理 mod |
| Agent Plugins 1.0.0 | 可移植包：`plugin.json`、`skills/`、`mcp.json`、反向域名客户端扩展                                               | **是**，TSC 含 Amazon/Cursor/Microsoft/OpenAI/Vercel | 客户端各自加载 skills/MCP；分发/权限/UX 由客户端决定                 | 由客户端决定                                      |
| Zeta plugin         | `package.json` 的 `zeta` 块 + extension 模块；tools/commands/hooks；`plugin.json` 声明 panels；任意 `.html` 页面 | 否，Zeta 自有                                        | 会话进程加载扩展；GUI 原生画面板；页面在 iframe 里                   | 安装即信任；当前无逐文件审批                      |

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

| 能力      | 现状                                                                        | 缺口                                                         |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 插件包    | `package.json` 的 `zeta`/`omp`/`pi` 块；`plugin.json` panels；`.html` pages | agent 没有“开发目录”概念                                     |
| 工具/命令 | extension 模块 `registerTool` / `registerCommand`                           | 注册发生在加载时；无热重载                                   |
| Hooks     | extension hooks / capability hooks                                          | 无逐文件批准与哈希                                           |
| UI        | 声明式 `list/form/chart`（数据来自一次 tool call）；HTML iframe             | HTML 页面没有版本化宿主桥                                    |
| 安装      | `plugin_manager`：list/install/uninstall/set_enabled；支持本地目录          | 安装后 `restartRequired`；无 `validate`/`load_dev`/`promote` |
| 验证      | marketplace source validation；`plugin doctor` 检查声明条目                 | 不对 agent 新写的模块做导入/静态检查                         |
| 清理      | 无 session dev 目录                                                         | 需要过期清理与 discard                                       |

## 3. 建议的 agent 创作生命周期

目录（用户目录，不写仓库）：

```text
<agentDir>/plugins-dev/<sessionId>/<plugin-name>/
  package.json          # zeta manifest + extension entry
  plugin.json           # optional panels / Agent Plugins schema
  index.ts              # extension factory
  pages/…               # optional HTML
```

| 步骤     | 触发              | 行为                                                                          | 批准              |
| -------- | ----------------- | ----------------------------------------------------------------------------- | ----------------- |
| scaffold | agent 请求        | 在 dev 目录建最小包；不写仓库                                                 | 文件创建逐项批准  |
| validate | agent 请求        | 检查 manifest、入口存在、路径 containment、Agent Plugins schema、导入静态分析 | 只读              |
| load_dev | agent 请求        | 会话内加载；注册 tools/commands/hooks；失败不影响主会话                       | 逐文件批准 + 哈希 |
| reload   | 回合结束/文件变更 | 重新 import 并替换注册；失败保留上一版                                        | 仅已批准文件      |
| promote  | **用户**操作      | 复制到 `~/.zeta/agent/plugins/<name>` 或导出 zip；可发布 marketplace          | 显式确认          |
| discard  | agent/用户        | 删除 dev 目录；会话结束按 `cleanupPeriodDays` 清理                            | —                 |

安全规则：

- 只在交互式、受信任工作区启用；`-p`/headless/`--safe-mode`/无 TTY 一律不加载。
- 逐文件批准；文件哈希变化重新批准；`hooks`/`tools` 明确标注“会执行代码”。
- 路径 containment：只能写 dev 目录、插件 `ctx.storage`、项目 `.zeta/`；不能写仓库源码。
- agent 不能 promote、不能安装 marketplace、不能改核心；promote 必须用户确认。
- 与工具档位一致：`plugin_manager` 默认不在 minimal/standard；agent 通过
  `read xd://plugin_manager` 请求启用，批准后才能创作。

### 3.1 实际实施（2026-11-12，ADR 0026）

上表的“逐文件批准 + 哈希”是设计建议，未作为新的 approval 层实现。实际
运行时复用会话既有工具审批与 YOLO 默认值，不增加插件级审批或沙箱。

- 目录固定为 `<agentDir>/plugins-dev/<session-id>/<name>/`；路径校验同时做
  词法和 `realpath` containment。session 根、插件根或 manifest 入口若是
  junction/symlink 指向 dev 根之外，validate/scaffold 直接拒绝；相对 import
  也按真实路径检查。
- `plugin_manager` 暴露 `list_dev`、`scaffold`、`validate`、`load_dev`、
  `reload`、`discard`。仅交互式主会话使用；print/RPC/headless/subagent
  会话拒绝。`load_dev` 通过既有 `ExtensionRunner`/late-tool 订阅注册，
  不维护第二套工具注册表。
- dev 包必须声明至少一个 `extensions` 入口。`tools`/`hooks` 是已安装插件
  的 provider，`load_dev` 不绑定它们；validate 对 tools/hooks-only manifest
  返回明确错误，对同时声明 extensions 的给出 warning。
- reload 在 import/绑定成功后才移除旧 runner 引用并卸载旧工具；失败保留
  上一版。移除使用 runner 的 `removeExtensions`，删除同时清理
  `#loadOrder`/suspended 集合，不在同一 runner 里累积旧对象。
- `promote`/`export` 只由用户 CLI 执行；`load_dev` 和工具面没有路径。
- dev 页面只做静态校验；页面宿主从已安装/promote 的包目录列出页面。
  dev 页面在 promote 前不预览，promote 后页面清单立即可见（扩展工具仍需
  新会话加载）。

## 4. 页面宿主协议

现状：HTML 页面在 chrome-free iframe 中，同源，可直接 `fetch("/api/*")`；
声明式面板的数据源是**一次 tool call**，不是 HTTP 路由。缺一个稳定的宿主桥。

建议分两层：

| 层                 | 用途                                   | 协议                                                        |
| ------------------ | -------------------------------------- | ----------------------------------------------------------- |
| 声明式面板（默认） | 列表/表单/图表；大多数 agent 生成的 UI | 不需要新协议：`plugin.json` 的 `ui.panels` + tool `details` |
| HTML 页面（高级）  | 需要自定义交互的页面                   | 版本化 `window.zeta` postMessage 桥，`1.0`                  |

`window.zeta` 1.0 最小消息集：

| 消息               | 方向        | 作用                                                     |
| ------------------ | ----------- | -------------------------------------------------------- |
| `ready`            | page → host | 页面加载完成，声明协议版本与所需能力                     |
| `callTool`         | page → host | 调用本插件已注册的 tool；host 按 tool 的 approval 走审批 |
| `getContext`       | page → host | 只读上下文（主题、语言、cwd、插件 id）                   |
| `subscribe`        | page → host | 订阅本插件声明的事件（如 `tool.call` 的只读投影）        |
| `notify`           | page → host | 宿主通知/toast                                           |
| `resize`           | page → host | 内容高度变化                                             |
| `result` / `error` | host → page | 请求结果；错误带 code                                    |

约束：origin 校验、按插件 id 隔离、能力白名单、版本协商；页面不能直接拿
任意 host 权限；不提供任意 HTTP 服务。HTTP `/api/*` 继续作为只读数据面，
写操作必须走 `callTool`。

### 4.0 已实现契约（2026-11-12，REQ-055）

- 注入的全局名是 `window.__zetaPage`（不是设计稿里的 `window.zeta`），
  协议版本 v1。实现入口：`web-app/src/studio/plugins/bridge.ts` 与
  `PluginPageHost.tsx`；Studio App 负责挂载 `/plugins/view/<plugin>/<entry>`。
- 页面必须由 `plugin.json` 的 `ui.panels`（`kind: "html"`）声明；网关
  `GET /api/plugin-pages` 列出清单，`GET|HEAD /api/plugin-assets/<plugin>/<path>`
  只服务清单入口和扩展名 allowlist 内的包内静态资源。资源 URL 带
  `?cwd=<project>`，供 iframe 导航在缺少 `x-zeta-cwd` header 时仍能解析
  项目级插件根。
- 已支持 `ready`/`callTool`/`getContext`/`notify`/`resize` 与 host 的
  `init`/`context`/`result`/`error`。`subscribe` 按当前实现返回
  `UNSUPPORTED_SUBSCRIPTION`；没有 permissionless 事件投影，也不声称事件会到达。
- `callTool` 只接受本插件注册、在当前 live session 的 active set 中、且
  注册来源 realpath 属于该插件包根的工具；执行仍走会话既有 tool wrapper
  与 YOLO 审批，不新增插件审批/沙箱。
- dev 插件页面只做 validate 的静态入口检查；页面宿主只扫描已安装/promote
  的包。dev 页面在 promote 前不预览，promote 后页面清单可见；扩展工具
  仍需新会话加载。没有为此新增 TSP/live-dev 页面契约。

### 4.1 TUI/TSP 的可改性（设计稿，尚未实现）

Claude mods 能改桌面布局，是因为宿主是 DOM 应用，mod 直接参与渲染树。
Zeta 的 TUI 走 Tern Surface Protocol（TSP）：组件把语义节点树交给 Tern
渲染，终端只认节点，不认任意 ANSI/DOM。这个边界不能破，否则原生终端
失去可移植性与安全边界。要做的是**把可扩展点协议化**：

| 能力            | 现状                                                 | 建议                                                                                         |
| --------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| header/footer   | `ctx.ui.setHeader/setFooter`                         | 保留；增加按名字注册的命名槽                                                                 |
| sidebar         | `registerSidebarWidget` + `describe()` 返回 TSP 节点 | 保留；增加 slot 能力声明                                                                     |
| 全屏页面/对话框 | `ctx.ui.custom()`（临时组件）                        | 增加可注册的命名 page，按命令打开                                                            |
| 布局槽位        | 无（核心固定）                                       | `ui.slots`：`sidebar`、`header`、`footer`、`transcript.before/after`、`tool.card`、`overlay` |
| 按钮/动作       | 节点里有 `button`，但动作由核心绑定                  | 动作 id → 扩展命令/tool；宿主统一分发与审批                                                  |
| 事件            | 扩展事件总线（session/tool 等）                      | 增加只读 UI 事件投影（选择、提交、页面打开）                                                 |
| 页面            | 无                                                   | `ui.pages`：插件声明页面，TSP 渲染节点树                                                     |

协议形状（`tsp.ui/1`）：

- 插件 manifest 声明 `ui.slots` / `ui.pages` / `ui.actions`；
- 宿主在 session 进程里调用扩展的 `describeSlot(slot, ctx)`，返回纯 TSP
  节点（JSON，无 ANSI、无函数）；宿主校验节点类型/深度/尺寸后下发；
- 节点里的 `action` 是字符串 id，宿主查表分发给扩展注册的 handler；
  handler 只能调用已授权的 command/tool；
- 能力：`ui:slot:<name>`、`ui:page:<name>`、`ui:action:<id>`；按插件授予；
- 版本协商；未知节点/动作丢弃并告警，不崩终端。

结论：**TUI 不做“任意布局”**；用槽位 + 动作覆盖 80% 的“加按钮/加页面/
加附加功能”。真正需要自由布局、复杂组件、图表、富交互的 mod，放到
Web UI 宿主（§4 的 `__zetaPage` 桥）——这也是后面 Web UI 要补的宿主面。

本节是后续设计记录：REQ-055 **没有实现** `ui.slots` / `ui.pages` /
`ui.actions` 或 `describeSlot`，也没有第二个 TSP 渲染器；不要把本节当作
已交付契约。

## 5. 守护面

| 守卫                             | 检查                                               |
| -------------------------------- | -------------------------------------------------- |
| `check-plugin-dev-root`          | dev 目录在 agentDir 内；插件不能写仓库源码         |
| `check-plugin-approval`          | headless/untrusted 不加载 dev 插件；哈希变化重批准 |
| `check-page-bridge`              | 协议版本、origin、能力白名单                       |
| `check-agent-plugin-conformance` | Agent Plugins 1.0 `plugin.json`/skills/mcp 校验    |
| `check-plugin-capabilities`      | 插件声明的 tools/commands/hooks 与运行时注册一致   |
| `check-tsp-ui-slots`             | TSP 槽位/页面/动作的版本、节点类型、深度、能力     |

## 6. 实施阶段

| 阶段 | 内容                                                   | 验收                                                         |
| ---- | ------------------------------------------------------ | ------------------------------------------------------------ |
| P1   | dev 目录 + scaffold + validate + load_dev + 逐文件批准 | agent 能在会话内创建并加载一个只读工具插件；仓库无新文件     |
| P2   | reload + promote/export + cleanup                      | 回合结束重载；promote 后重启仍可用；dev 目录可清理           |
| P3   | 页面宿主桥 1.0 + TSP 槽位/页面/动作                    | 一个 HTML 页面能 `callTool`；一个 TSP 插件能加按钮并触发命令 |
| P4   | Agent Plugins 1.0 验证/列出                            | 标准包 skills/MCP 可被 `plugin validate` 识别                |
| P5   | 事件中间件（可选）                                     | 只有出现明确需求才做；不实现 Claude mods 兼容层              |

### 6.1 实际状态（2026-11-12）

- P1/P2 与 P3 的 HTML 页面桥已实现；per-file approval 未实现，运行时
  沿用会话既有审批/YOLO，headless/subagent 仅拒绝 dev 工具面。
- P3 的 TSP `ui.slots`/`ui.pages`/`ui.actions` 未实现，`check-tsp-ui-slots`
  也不是当前守卫；不要按本表推断 TSP 已交付。
- P4 的 Agent Plugins 1.0 skills/MCP 发现是本轮之前既有能力；本轮不新增
  P4/P5。

## 7. 未决

| #   | 问题                                         | 建议                                          |
| --- | -------------------------------------------- | --------------------------------------------- |
| 1   | dev 插件目录放用户目录还是会话目录           | 用户目录 + session 子目录，便于清理与审计     |
| 2   | 是否允许 agent 直接 `load_dev`               | 允许，但必须逐文件批准；headless 禁止         |
| 3   | HTML 页面桥用 postMessage 还是 HTTP JSON-RPC | postMessage；HTTP 只读                        |
| 4   | 是否兼容 Claude mods 格式                    | 不兼容；只借鉴事件中间件与逐文件批准          |
| 5   | Agent Plugins 1.0 是否作为唯一打包格式       | 作为可移植子集；Zeta 自有扩展继续用 `zeta` 块 |

> 2026-11-12 实施注记：第 2 行的“逐文件批准”没有落地，实际是现有
> YOLO/approval 语义；dev 工具面只在交互式主会话开放。其余研究项保留。

## 8. 参考项目的性能教训

调查对象是一个 MIT 的桌面控制台（不记名字）。它界面完整，但实际使用卡、
内存高；原因不是单点 bug，而是结构性的：

| 结构           | 观察到的事实                                                                                                   | 代价                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Electron + SPA | Chromium 主/渲染/GPU/utility 多进程；窗口越多，基线越高                                                        | 空载就比浏览器页面重                                             |
| 单体渲染树     | `App.tsx` 9,288 行、145 个 `useState`、73 个 `useEffect`；renderer 630 个源文件                                | 顶层状态变化牵动大树，流式更新容易全树 reconcile                 |
| 全功能工作台   | 41 个 renderer 依赖；xterm、CodeMirror、Mermaid、three/x_ite、ReactMarkdown/rehype-highlight、浏览器观测、媒体 | 编辑器/终端/3D 上下文常驻；隐藏面板也不一定卸载                  |
| 高频事件       | 22 个 `setInterval`；流式 token、IPC、轮询（1s/1.5s/5s）                                                       | 持续 CPU 与唤醒；Electron IPC 还要序列化大对象                   |
| 数据保留       | 每个会话 2,000 行 / 24 MiB；长会话、多会话叠加                                                                 | 虚拟列表只限制挂载 DOM（120 行），不限制字符串/图片/工具输出常驻 |
| 富文本渲染     | markdown + 高亮 + Mermaid + 图片/截图                                                                          | 单条大消息的解析/布局尖峰；已完成消息也可能重算                  |

它已经做了不少正确的事：rAF 批处理、后台发布、行高缓存、高亮 worker、
虚拟列表、120 行挂载上限。仍然卡，说明这些是**补救**，不是架构本身轻。
Zeta 的 Web UI 走 Next 服务端/客户端拆分、7 个运行时依赖、无 Electron，
所以同样开很多标签时内存低；但 Zeta 自己的 `ModelsConfig`/`ChatInput` 也有
十几万字节的单文件，不能假设永远轻。

给 Zeta Web UI 的硬规则：

- 路由级代码分割；重面板（编辑器、终端、3D、图表）懒加载并在隐藏时卸载。
- 会话数据有界（行数 + 字节），虚拟列表与数据保留分开治理。
- 不允许一个巨型 App 组件持有全部状态；按 session/panel 分 store。
- 流式更新走 rAF/批处理；高亮/Mermaid 放 worker；IPC 只传增量。
- 插件页面/面板一律 iframe 隔离；插件崩溃不拖垮主界面。
- 核心不引入 3D/终端/重型图形依赖；这些只作为可选插件。

## 9. 案例：DSH Agent Teams（官方插件组合）

DeepSeek Harness 的 Agent Teams 是一个可运行的“官方插件组合”样本。它由四个
npm 包组成，默认关闭，通过 profile bundle 一起启用：

| 包                     | 作用                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `agent-team`           | `ctx.agentTeams` 服务：durable roster、共享 task board、inbox 消息、wait/interrupt |
| `tool-agent-team`      | 9 个 scoped 模型工具：spawn/send/list/wait/interrupt + 4 个 task board 工具        |
| `client-ui-agent-team` | Web 客户端插件：在会话 header 注册 slot，画面板、roster、任务板、成员会话导航      |
| `agent-team-profile`   | bundle patch：组合前三者，禁用同名旧 subagent 控件，默认关闭                       |

### 9.1 它比 subagent 高在哪

它不是“更聪明的子代理”，而是**在 continuable subagent 之上加了一层协作状态**：

| 维度     | 普通 subagent / `task`                                                        | DSH Agent Teams                                                |
| -------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 生命周期 | 一次任务；可 background/revive，但父级按 child 管理                           | 具名 teammate，持久 roster；inactive 可冷恢复                  |
| 寻址     | 父 ↔ child；Zeta subagent 同 workspace 可经 IRC 互发，跨 workspace 经 spawner | 任意成员 ↔ 任意成员；inbox + steer                             |
| 协调     | 父级收集结果                                                                  | 共享 task DAG：`blockedBy`、owner、`writeScopes`、revision CAS |
| 控制     | 父级 kill/steer；Zeta Agent Hub 可看 transcript                               | Lead-only spawn/interrupt；`wait_agent` 等下一条团队变化       |
| UI       | 父会话里看 child                                                              | header slot：roster、任务板、点进成员会话                      |
| 运行时   | 子代理运行时                                                                  | **还是同一套 continuable children**；没有第二调度器            |

所以“群聊”只是表象；真正的增量是 **roster + 共享任务板 + peer inbox + 团队 UI**。
它比子代理“高级”在协调状态，不在模型或执行内核。

### 9.2 与 Zeta 现状对照

Zeta 其实已经有半边：

- `task` 支持 fresh/fork、background、worktree 隔离、persisted/revive；
- Agent Hub 有 live roster、transcript、steer、revive、kill；
- `agent://` / mesh 有 mailbox、跨进程寻址、离线队列。

缺的是团队域：

- subagent 的 IRC/inbox 已可用：同一 workspace 的兄弟可互相发消息，跨 workspace 只能经 spawner 或主 Agent（§9.2 旧表述已更正）；
- 没有共享 task board（依赖、owner、revision CAS、write scope 警告）；
- 没有 team-scoped roster 与“团队”UI；
- 没有 Lead-only 的 spawn/interrupt 语义。

因此不要把 DSH 的团队能力直接塞进核心。正确的落点是官方插件：

- `plugins/official/agent-team/`：服务/状态 + 9 个工具 + 声明式面板；
- 团队消息走**插件自己的 team-scoped 通道**，不修改全局“subagent 只能找 main”的规则；
- task board 状态放会话/tracking，不进核心 schema；
- UI 用 TSP `ui.slots`（header/sidebar/page）和 Web UI header slot；
- 默认关闭，显式启用；共享 cwd，`writeScopes` 只做警告，不假装文件锁；
- 编排仍落在 `task`/`agent()`/`workpool()`/`wait()`，不写第二条调度器。

### 9.3 不要照搬的点

- 不自动建 worktree：worktree/branch/merge 是部署选择，DSH 也明确拒绝自动创建。
- 不把 task owner 或 write scope 当锁：Bash/formatter/外部 writer 会绕过。
- 不为团队新增核心会话字段或私有协议；团队状态归插件。
- 不默认开启：团队工具会给每个成员增加固定 policy + schema token，简单任务不该付这个成本。

## 10. 相关设计

- [`super-agent-rooms.md`](./super-agent-rooms.md) — Room/contacts/resident agent 的完整设计。
- [`context-learning-modes.md`](./context-learning-modes.md) — 滑动窗口压缩与 memory/taste/tracking 频率、窗口批处理。
