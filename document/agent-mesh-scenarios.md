# 主代理之间发话：场景清单（实现前先钉死的口径）

目标：**任何一个主代理，都能向另一个主代理发话**——不管对方在哪个仓库、哪个工作区、
哪个进程。飞书/微信机器人只是这条链最外层的一个入口，链不通就是 bot 做不出来。
本文件只写场景与验收，不写实现（实现在 `document/agent-mesh.md`）。

## 0. 今天到底哪里断了（可复现的证据）

| 事实 | 证据 |
|---|---|
| agent 名册是进程内单例 | `packages/coding-agent/src/registry/agent-registry.ts:131-135`（`AgentRegistry.global()`） |
| 消息总线是进程内单例 | `packages/coding-agent/src/irc/bus.ts:39-46`（`IrcBus.global()`） |
| 主代理身份是单一常量 | `agent-registry.ts:16-17`（`MAIN_AGENT_ID`），每个顶层会话都叫它 |
| IRC 层没有跨进程通道 | `src/irc/` 下 grep `socket\|net.connect\|process.send\|BroadcastChannel` 零命中 |
| `agent://` 写入本地解析 | `internal-urls/agent-protocol.ts:149,172-192` |
| 唯一的进程外旁路 | `POST /api/agent/<sessionId>`（`server/web-gateway.ts:478-481`），需要知道 sessionId 且只对 loopback/token 开放 |

结论：**今天"另一个工作区的主代理"在协议上不存在**——不是难用，是没有任何地址。
所以下面 7 个场景里，S1–S5 目前全部失败，S6/S7 会以超时或"找不到 agent"收场。

## 1. 场景（每条都要有对应的自动化测试）

### S1 飞书 → 另一个仓库的工作区（跨进程，对方在跑）
- 触发：飞书群里用户发「帮我在 zeta 仓库查一下 CI 为什么红」。
- 解析：`(channel=feishu, peer=chat_123)` → `remote.sessionMappings` → `workspaceAlias=zeta`
  → 该 workspace 的 main agent（id `zeta/<MAIN_AGENT_ID>`）。
- 投递：mesh 直投（对方 `status=running|idle`），等 `ack`。
- 用户看到：飞书里先有「已转给 zeta 的主代理」，处理完原会话收到回答。
- 失败：目标工作区没有登记 → 回「未知工作区 zeta，可选：…」；目标 agent 不在 →
  回候选列表。
- 验收：`mesh-cross-process.test.ts` — 起两个进程，A 的 main 发给 B 的 main，
  B 收到并回话，A 的 inbox 有一条；两端 id 带各自 workspace 前缀。

### S2 GUI 工作区 A → 工作区 B（同一台机，两个 `zeta serve`）
- 触发：GUI 的 A 会话里，用户让 A 的主代理「去问 B 那边主代理它的构建脚本在哪」。
- 解析：A 的主代理按 workspace 别名寻址；若用户只给了仓库名，按别名/目录名解析，
  解析不到要求明确报错，不许猜。
- 投递：mesh 直投 + 回话；A 的对话里显示「发给 b 的主代理 / 收到回复」两条记录。
- 验收：`mesh-address-resolution.test.ts` — 别名、目录名、`<workspaceId>/<agentId>`
  三种写法都能解析；歧义（两个同目录名的工作区）必须报歧义而不是选一个。

### S3 对方进程没在跑（parked / gone）
- 触发：同上，但 B 的 `zeta serve` 已退出，目录条目还在。
- 行为：写 B 的收件箱（`<config>/mailboxes/<workspaceId>/<agentId>/`，原子落盘），
  然后投 `wake`；B 下次启动时按 `sentAt` 顺序注入，用户得到「B 已离线，消息已排队，
  它起来后会处理」。
- 失败：`gone` 超过保留期（30 天）的收件箱按策略清理并在日志里写明。
- 验收：`mesh-offline-mailbox.test.ts` — 停掉 B，A 发送返回 `queued`；重启 B，
  B 的会话里出现该消息且只出现一次（at-least-once + `id` 去重）。

### S4 IM 会话改绑目标（`@agent use`）
- 触发：飞书里 `@agent list` 看到两个工作区，`@agent use zeta/<main>`。
- 行为：写运行时覆盖，优先级高于 `remote.sessionMappings` 与渠道默认（与
  `session-router.ts:288-320` 既有顺序一致）；之后该 peer 的消息都投给新目标；
  `@agent use` 不带参数 = 清回默认。
- 验收：`session-router-agent-target.test.ts` — 覆盖生效、清除回落、非法 id 报候选。

### S5 团队：一个 peer 绑到一个 team
- 触发：飞书里 `@team build`，该团队主持 agent 拆任务给自己的成员（成员可以跨工作区）。
- 行为：`@team` 只是把 peer 路由到主持 agent；成员之间的消息仍是 mesh 消息，
  不新增第二套投递。
- 验收：`team-routing.test.ts` — 主持收到一条、成员各收到各自任务、最终汇总回同一 peer。

### S6 互等不能死锁
- 触发：A 问 B、B 反问 A（同一时刻两个会话都在等对方）。
- 行为：`wait` 有超时与「对方正在等我」的检测；超时返回明确的
  `peer-waiting-on-you` 状态而不是干等。
- 验收：`mesh-mutual-wait.test.ts` — 互相等一定时间内返回该状态，且双方都还能继续工作。

### S7 安全与崩溃
- socket/命名管道仅本机、目录文件仅 owner；信封 1 MiB 上限；`to` 里的路径片段拒绝。
- 进程被 kill：陈旧目录条目（心跳 >60 s / pid 不在）在下一次枚举时清掉，收件箱不丢。
- 验收：`mesh-security.test.ts`、`mesh-crash-recovery.test.ts`。

## 2. 不作为

- 不做跨机隧道（远程工作区只在 `remote.token` 配置存在时按 `tcp://` 预留，默认关）。
- 不做 agent 迁移、不做按 agent 的权限门（YOLO 默认不变）。
- 不把 IM 渠道运行时做成第二个总线：bot 只是 mesh 的一个客户端。

## 3. 与其它在途工作的关系

- `feat/gui-im-channels`：GUI 的「IM 渠道」页负责配置与扫码；它读的是同一份
  `web-config`（`workspaces` / `remote.sessionMappings`），不引入第二份真源。
- `document/agent-team-plugin.md`：编排层规格，只用 `ctx.agents` / `ctx.messaging`。
- 本文件的 S1–S7 是验收口径；改口径必须先改这里。

## 4. 实现备注（不改验收口径）

- S1–S4、S6、S7 的自动化测试随本次落地；S5 的 `team-routing.test.ts` 与 team 插件
  同批，本次只钉住 seam（`@team` → 主持 agent 的解析 + 假 host agent 测试）。
- 运行时面默认在 config root 下（`run/`、`mailboxes/`）；config root 不同的进程可
  用 `ZETA_MESH_ROOT` 指向同一个共享目录。Windows 命名管道名带 mesh-root 摘要。
- 目录记录额外携带 `agents` / `waits` 两个可选字段（`@agent list` 与 S6 探测需要）。
- `parked|gone` 都回 `queued`（S3 要求）；"未知 workspace" 才是报错 + 候选。

