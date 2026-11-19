# 产品与平台

[English](product.md) · **简体中文**

本页说明对外的产品面与受支持的平台。安装命令见 [README](../README.md)；仓库结构、
构建/测试命令与覆盖率见[仓库与开发](development.zh-CN.md)。

## Zeta 是什么

Zeta 是一套 agent 工作区套件：**Z Work Studio**（由 CLI `zetacode serve` 托管的
浏览器工作台），加上编码 Agent（`zetacode`）、终端 IDE（`zetaide`）以及两者共用
的编辑器载荷。它是 **Agent 开发环境（ADE）**，不是“IDE 加聊天框”：会话是工作
单元，每个面板都是 agent 可以使用的工作面。

本套件是 [OMP](https://github.com/Linxira-OS/linxira-zeta) 的下游发行版，包含受维护的
[OMP Studio](https://github.com/the-snowpear/omp-studio) renderer 分支与 vendored
[TermIDE](https://github.com/termide/termide) 树。归属、集成 tag 与逐组件差异记录在
[维护与归属](ownership.zh-CN.md)和 [`NOTICE`](../NOTICE)。

## 套件

| 命令       | 包                 | 是什么                                             |
| ---------- | ------------------ | -------------------------------------------------- |
| `zetacode` | `@linxiraos/zeta`  | 编码 Agent CLI；`zetacode serve` 打开 Z Work Studio |
| `zetaide`  | `@linxiraos/ide`   | 终端 IDE（TermIDE，vendored Rust）                  |

每条命令都能独立启动，各有自己的 `--help`。`zetawork` / `zeta` 两个 bin 仍在
暂停的 `@linxiraos/main` 包里；名字保留给 main/super-agent 面，没有 Rust GUI 随它
出货。`@linxiraos/editor` 是预留包名，其载荷当前不发布：编辑器是工作台里的面板，
不是独立命令。

## Z Work Studio

Z Work Studio 是 `zetacode serve` 托管的浏览器工作台，也是出货的 Web 面；
渲染器构建随 `@linxiraos/zeta` 放在 `dist/web-app`，源码检出或自定义构建可用
`ZETA_WEB_APP_DIR` 指向另一个渲染器目录。`zetacode serve` 把渲染器与网关同源
提供，因此一个端口就够了。

- **会话优先** —— 首页、历史、工作台是同一棵会话树；打开旧会话或新建会话不切换
  运行时。
- **面板** —— 侧栏与底栏（资源管理器、变更/diff、走网关 PTY 流的终端、媒体/产物、
  统计、诊断、Agent Hub），布局按作用域记忆。
- **Agent 与审批** —— 带模型/模式选择器的输入框、排队消息、审批卡、工具体和
  agent 会话都在同一视图里。
- **单一宿主契约** —— 所有读取与动作都走 `/api/v1/*`（`pair`、CSRF、query、
  command、events）；为兼容仍提供旧 Web Gateway REST 面（`/api/*`）。CLI、浏览器
  与远程客户端看到同一份能力清单；未实现的操作不会出现在清单里。
- **没有 Rust UI** —— 旧的 egui/WebView2 工作台（`main/crates/zetawork-gui`）不是
  产品面；它的设计工作落在 `web-app/src/studio/`。

宿主契约与 serve 行为见 [`docs/zeta-serve-web.md`](../docs/zeta-serve-web.md) 与
[`docs/web-ui/api.md`](../docs/web-ui/api.md)；运行时功能索引见
[`docs/zeta-features.md`](../docs/zeta-features.md)。

## 桌面版

Z Work Studio 以桌面应用形式出货，由同一份 staged 运行时构建两个版本：

| 版本 | 打包内容 | 平台 |
| --- | --- | --- |
| **完整版（Electron）** | Chromium、内核、渲染器、托盘与窗口 chrome | Windows x64、Linux x64 |
| **浏览器版** | 仅内核与渲染器；不带浏览器引擎 | Windows x64、Linux x64 |

两个版本都携带 Zeta 自己的内核——编译后的 `zeta` 二进制（与 `zetacode` 同一个
CLI）、原生 addon 和 Z Work Studio 渲染器（`web-app/dist`）——因此目标机器无需
Bun 或 Node。Electron 壳启动随包的 `zetacode serve` 并在窗口中加载；浏览器版的
启动器启动同一个服务器并把 URL 交给默认浏览器。两者都复用独立 serve 现有的 HTTP
认证。不存在 Rust 桌面 UI，也没有任何桌面资产来自暂停的 `main/` 工作台。

外壳与渲染器显示 **Z Work Studio**；运行时标识为 **Zeta**。打包布局、外壳契约与
本地构建步骤见 [`docs/desktop-app.md`](../docs/desktop-app.md)。

## 编码 Agent

`zetacode` 是编码 CLI，基于 OMP 运行时构建：

- 终端编码工作区，包含文件读取、搜索、补丁、shell、git、任务委派和结构化工具
  输出；
- 多提供商模型访问、本地配置、OAuth 流程、模型发现、会话恢复和可控的重试行为；
- 本地 Web 工作台（`zetacode serve` → Z Work Studio）嵌入同一运行时——同一会话树、
  同一设置模型、同一宿主契约（`/api/v1/*`，`/api/*` 在其后）；
- 宿主平台支持时提供原生文本、图像、终端、浏览器和桌面能力。

## Agent 开发环境（ADE）

这套件不是“IDE 加个聊天框”，而是 **ADE——Agent Development Environment
（Agent 开发环境）**；它与 IDE（Integrated Development Environment，集成开发
环境）结构相同，只把第一个词从 *Integrated* 换成 *Agent*。

| | IDE | ADE（本套件） |
| --- | --- | --- |
| 重心 | 打开的文件 | agent 会话 |
| 谁驱动工具 | 编辑器驱动 LSP、构建、调试器 | agent 驱动工具；编辑器与终端是它的工作面 |
| 工作单元 | 一个缓冲区 | 一次会话：上下文、工具、子代理、验证 |
| 循环在哪 | 写 → 构建 → 调试 | 规划 → 执行 → 验证，人负责掌舵 |

Zeta 保留 IDE 的形态——窗格、标签页、真实 PTY、LSP、编辑器面板、终端 IDE
（`zetaide`）——因为 agent 需要一个工作的地方。移动的是中心：`zetacode` 会话、
子代理编排、mesh（`agent://`）、扩展与技能都是一等公民；编辑器、终端和文件管理器
是 agent 操作的环境。人仍然可以直接驱动任何窗格；套件只是假定 agent 是主要
工作者，窗格是它观察和改变世界的方式。

## Zeta 自有能力

除 OMP 运行时谱系之外，Zeta 还提供自己的能力。每个链接都是该产品面的运行时文档：

- **Z Work Studio**（`web-app/`）—— 浏览器工作台：会话历史与工作台面板、PTY
  终端、diff、产物/媒体视图、统计与 Agent Hub，由 `zetacode serve` 从随包的
  `dist/web-app` 提供；其宿主（`studio-host`，`/api/v1/*`）是 Zeta 自己的实现。
- **Web 网关** —— 浏览器背后的 `/api/*` REST 面，每个资源一个处理模块，由
  Z Work Studio 与远程客户端消费。
- **项目 tracking** —— `.zeta/tracking/` 里可选的跨会话记录（进度、决策、动作、
  计划），通过 `tracking_update` 写入；见
  [`docs/zeta-tracking.md`](../docs/zeta-tracking.md)。
- **Taste 层** —— 每个提示抽取偏好候选，带校准判断与有上限的系统提示注入；见
  [`docs/memory.md`](../docs/memory.md#taste-layer)。
- **Ultra plan** —— `/plan-ultra` 在 plan mode 上增加 fan-out 侦察与增量写计划；
  见 [`docs/plan-approval.md`](../docs/plan-approval.md)。
- **通道运行时** —— 嵌入 `zetacode serve` 的微信/飞书/Telegram 桥接，带
  plan-image 路由和工作区作用域的执行工具；见
  [`docs/channels.md`](../docs/channels.md)。
- **用量与统计扩展** —— `/api/usage/daily` 与 `usage.*` 宿主操作供给 Z Work Studio
  面板；上游的 stats 数据库与 `zetacode stats` 仪表板仍是底座。
- **桌面打包** —— 由同一份 staged 运行时构建 Electron 与浏览器版；见
  [`docs/desktop-app.md`](../docs/desktop-app.md)。
- **继承自上游**（非 Zeta 原创）：`autoresearch` 实验循环、自定义工具与
  TypeScript 命令、斜杠命令市场、ACP 支持，在本仓库带品牌适配出货——见
  [`docs/custom-tools.md`](../docs/custom-tools.md)、
  [`docs/marketplace.md`](../docs/marketplace.md) 与
  [`docs/slash-command-internals.md`](../docs/slash-command-internals.md)。

## 平台支持

Linux 是主力平台（Linxira OS，基于 Arch）；Windows x64 是受支持的开发与目标
平台；不构建 macOS。

| 形态 | Linux | Windows | macOS |
| --- | --- | --- | --- |
| `zetacode` CLI | x64, arm64 | x64 | — |
| `zetaide`（`@linxiraos/ide`） | x64 | x64 | — |
| Z Work Studio（`zetacode serve`，随 `@linxiraos/zeta` 出货） | x64, arm64 | x64 | — |
| Z Work Studio 桌面版 | x64 | x64 | — |

从源码构建时，原生文本/grep 和图像能力需要平台 C/C++ 工具链；发布的二进制内置
预构建原生模块。

## 界面语言

CLI 提供简体中文和英文两套目录。活动语言按以下顺序解析：

1. 设置文件中的 `language`（`~/.zeta/settings.json`）—— 显式选择，由
   `/language` 写入。
2. `ZETA_LANG` / `LC_ALL` / `LC_MESSAGES` / `LANG` —— shell 区域设置。
3. 操作系统 UI 语言（`Intl`）—— 因此中文 Windows 无需任何配置即显示中文。
4. 都不匹配时使用英文。

`/language` 即时切换：斜杠命令描述、输入框和每个本地化面板在下一次渲染时重新
解析，无需重启。两套目录都是完整的，因此该选择是按安装而非按构建——插件可以
通过同一来源注册自己的文本。

## 相关仓库

- [Linxira Knowledge Base（`lkb`）](https://github.com/Linxira-OS/linxira-knowledge-base)
  —— 同组织的自托管分层知识库。它提供 MCP server 与 OpenAPI 3.1 接口，Zeta agent
  可作为外部工具查询。它是独立产品、有独立发布线：不随 Zeta 打包，也不是构建
  依赖。客户端边界（委派身份、检索、维护作用域、审计归因、写入审批）记录在
  [`document/lkb-integration.md`](../document/lkb-integration.md)。

[English](product.md) · **简体中文**
