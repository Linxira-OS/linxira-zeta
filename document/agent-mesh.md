# Agent mesh：工作区、渠道绑定、代理身份与团队编排的统一契约

本文件是**一套**能力的唯一架构说明。IM 机器人指令、渠道 ↔ 工作区绑定、主代理之间
的消息、agent-team 编排，全部是同一套身份/寻址/投递模型的不同入口；分开实现就会
出现"每个入口各有一套 workspace 概念"的老问题（2026-10-20 用户裁定：一条线讲完，
不允许再拆成互不相认的碎片）。

## 1. 术语（唯一口径）

| 术语 | 含义 | 真源 |
|---|---|---|
| **workspace** | 一个工作目录 + 其会话容器。别名（alias）是用户在 IM/GUI 里叫它的名字 | `web-config.ts` 的 `remote.workspaces`（`alias → 绝对目录`，:45-51）、`channels.workspaceRoot`（渠道默认） |
| **peer / chat** | IM 侧的一个对话（微信 wxid、飞书 chat_id、Telegram chat id） | `web-config.ts` 的 `remote.sessionMappings`（peer → alias，:54-70） |
| **agent** | 一次可寻址的运行实体，有 id、所属 workspace、角色（main / subagent / team member） | `src/registry/agent-registry.ts`（进程内）、本文件的 mesh 目录（跨进程） |
| **main agent** | 一个会话/工作区的顶层代理，id 为 `MAIN_AGENT_ID`（进程内唯一，见 §3） | `agent-registry.ts:16-17` |
| **team** | 由编排插件创建的一组 agent + 它们的任务与收件箱 | `document/agent-team-plugin.md` |
| **route** | (channel, peer) → workspace(alias) → session → agent 的解析结果 | `channels/session-router.ts` |

四者的关系是一条链，不是四套模型：

```
IM peer ──sessionMappings──▶ workspace(alias) ──session──▶ main agent ──mesh──▶ 另一个 main agent
                                                     └─team──▶ member agents
```

## 2. 现状（已存在，勿重写）

- 渠道运行时装在 `zeta serve` 进程内（`packages/channels`），三个适配器 WeChat /
  Feishu / Telegram；对外 REST：`/api/channels/status`、`/api/channels/wechat/{qrcode,
  reconnect,unbind}`、`/api/channels/send`（路由见 `server/web-gateway.ts:195-200`）。
- CLI 前端：普通会话（TUI 或 `--print`）在 web.yml 启用渠道或传 `--channels` 时
  直接托管同一份 `startChannels`（无 HTTP），`zetacode channels status|login|logout|
  enable|disable` 读写同一份 web.yml；`<agent dir>/run/channels.lock` 保证同一 bot
  只有一个宿主（先启动者胜出，后来者明确拒绝）。见 `docs/channels.md`。
- IM 工作区路由已完整：`SessionRouter`（`channels/session-router.ts:92`）支持
  `@workspace open <path> [alias]`、`@workspace use`、`*<alias>` 快捷方式，优先级
  运行期覆盖 → `remote.sessionMappings` → 渠道默认 `workspaceRoot`（同文件 :288-320），
  `bindingsForPlatform()` 供设置面列出绑定（:374）。
- 扩展面：`ctx.agents`（只读名册）+ `ctx.messaging`（send/wait/inbox），已随
  `feat/agent-interfaces` 落地（`registry/agent-directory.ts`、`irc/facade.ts`）。
- `agent://` 的写入在同一进程内解析（`internal-urls/agent-protocol.ts`），HTTP 旁路
  只有 `POST /api/agent/<sessionId>`（`web-gateway.ts:478-481`，loopback 或 remote
  token）。

## 3. 缺口（本文档要钉的层）

1. **跨进程总线**：`IrcBus.global()`、`AgentRegistry.global()` 是进程内单例，主代理
   身份是常量 `MAIN_AGENT_ID`。两个 `zeta serve`/两个工作区的主代理互相不可见。
2. **目录联邦**：每个进程只知道自己名下的 agent；`agent://<id>` 无法解析到别的进程。
3. **唤醒与投递语义**：对方进程里没有前台 loop 时，消息要落到持久收件箱并在对方下次
   醒来时送达（与 `parked` 子代理的既有语义对齐，`agent-lifecycle.ts:186-187`）。
4. **IM 与 agent 的桥**：`workspace_run` 能"在某个工作区跑一次"，但 IM 里的
   "把这个会话交给某个 agent / 某个 team"没有契约。

## 4. 设计（决策已定，按此实现）

### 4.1 身份与寻址

- agent id 全局格式：`<workspace-id>/<agent-id>`，workspace-id 默认取
  `sha1(realpath(workspaceRoot))[:12]`，可由 workspace 别名覆盖（别名唯一性由
  `web-config.workspaces` 保证）。进程内 id 保持稳定：进程的**第一个/唯一**顶层会话
  用 `MAIN_AGENT_ID`，之后每个顶层会话（`zeta serve` 的 bot 会话、web-UI 聊天、
  router 打开的工作区）用**自己的 session id**——同一进程内 id 永远唯一，
  `register()` 对重复 id 直接抛错而不是顶替上一个会话；子代理 id 与 parent 关系不变。
  加 workspace 前缀只发生在跨进程边界，`agent://` 写法因此向后兼容：无前缀即本进程；
  `agent://main` 解析到**调用方所在 workspace 的 main**（调用方自己就是 main 时为
  自投递错误，绝不命中别的 workspace 的同名 root），本进程没有该 main 时按
  `<workspace-id>/main` 走 mesh。
- 目录记录字段：`{ id, workspaceId, workspaceAlias, workspaceRoot, pid, endpoint,
  role, status, updatedAt }`。status ∈ `running | idle | parked | gone`。
  实现另加两个**可选**字段（向后兼容，不改变上面的口径）：`agents?: {id, role,
  status}[]` 给 `@agent list` 提供 per-agent 状态；`waits?: {agentId, on, since}[]`
  给 S6 的互等探测提供跨进程视图。

### 4.2 传输

- 每个进程起一个 **loopback-only** Unix socket（POSIX）/ 命名管道（Windows），
  路径 `<config>/run/mesh-<workspaceId>.sock`。POSIX 权限 0600；Windows 命名管道
  是机器全局的，路径改为 `\\.\pipe\zeta-mesh-<meshRoot摘要>-<workspaceId>`，避免
  两个隔离的 config root 撞名。
- "未认证即拒"的机制：启动时生成 `<config>/run/mesh/<workspaceId>.token`（0600），
  客户端必须在该连接的第一帧 `hello` 里携带它；缺失/错误即关闭连接。token 只在
  owner 可读的文件里，不写进目录记录。
- 目录文件 `<config>/run/mesh/<workspaceId>.json`，进程启动写、心跳刷新（10 s）、
  退出删除；陈旧条目（心跳超过 60 s 或 pid 不存在）按 `gone` 处理并在下次枚举时清掉。
- 信封：`{ v: 1, id, from, to, kind: "message" | "wake" | "ack", body, sentAt,
  replyTo? }`。投递是 at-least-once，收端按 `id` 去重；`ack` 只用于 send 的同步返回，
  inbox 语义不依赖它。
- 跨机（远程工作区）不在本期：endpoint 字段预留 `tcp://`，但只允许在 `remote.token`
  配置存在时开启，且默认关闭。
- `ZETA_MESH_ROOT` 可以把整个运行时面（`run/` 与 `mailboxes/`）指向一个共享目录，
  让 config root 不同的两个 `serve` 仍能互相发现；不设时就是 config root。

### 4.3 投递与唤醒

- `send`：目标 `running|idle` → 直投 socket 并等 `ack`；`parked|gone` → 写对方收件箱
  `<config>/mailboxes/<workspaceId>/<agentId>/`（一消息一文件，原子 rename），并投
  `wake`，回 `queued`。**口径修正**：原稿对 `gone` 写"报错并返回候选"，但 S3 的
  "进程退出、目录条目还在"正是 `gone`，验收要求它 `queued`；"未知 workspace" 才
  报错并返回候选。两者冲突时以 S3 的可恢复语义为准。
- 收件箱在 agent 下次启动/醒来时按 `sentAt` 顺序注入，注入后移到 `delivered/`；
  `delivered/` 同时是按 `id` 去重的凭据。`gone` 超过 30 天的收件箱按策略清理并记日志。
- 既有 `ctx.messaging` 的 API 面不变：`send/wait/inbox` 只是 mesh 之上的本地代理；
  单进程时零额外 I/O（走原 `IrcBus` 快路径）。

### 4.4 与 IM 的桥（behaviour contract）

IM 指令面在 `SessionRouter` 现有的 `@workspace` 族上加两条，语义与 CLI 一致：

| IM 指令 | 行为 |
|---|---|
| `@agent list` | 列出可见 agent（本工作区 + 已登记的其他工作区），带 `role/status` |
| `@agent use <id>` | 把当前 (channel, peer) 的后续消息路由到该 agent（写入运行时覆盖，同 `@workspace use` 的优先级）；不带 id = 清除覆盖、回落到 workspace 绑定 |
| `@team <name>` | 交给该团队的主持 agent（成员与任务由编排插件管理） |

桥的落点是 mesh 的 `send`，不是另写一条路径：IM 消息 → router 解析出目标 agent →
mesh 投递。目标不存在或别名有歧义时按 §4.3 的候选列表回话；未知 team 回可用 team
列表（team 插件尚未落地时该列表为空）。

### 4.5 teamagent（编排层）

`document/agent-team-plugin.md` 是它的规格，实现必须只用 `ctx.agents` /
`ctx.messaging` + §4.4 的桥，不读 mesh 的私有文件。团队的主持 agent 自身就是一个普通
main agent（有自己的 workspace 归属），成员是它的子代理；团队与 IM 的关系只有"某个
peer 绑到某个 team"这一条，通过 `@team <name>` 复用同一套路由。

## 5. 验证与边界

- 单进程行为必须与现状**逐字一致**（现有 IRC/registry 测试全绿是硬门槛），mesh 只在
  跨进程时介入。
- 安全：socket 0600 + 目录文件仅 owner 可读；不接受 `to` 里的路径片段；envelope 有
  大小上限（1 MiB）与 `v` 版本门。
- 崩溃恢复：进程崩溃留下的 socket/目录条目由下一次枚举清理；收件箱不会因崩溃丢失
  （写入是原子 rename）。实现把"陈旧"定义为心跳超过 60 s 或 pid 不存在。
- 不做：跨机隧道、agent 迁移、按 agent 的细粒度权限（用户 YOLO 默认不变）。
