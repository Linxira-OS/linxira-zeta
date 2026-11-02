# Super agent rooms: contacts, ordered chat, and resident agents

> 状态：实验性设计，未实现。适用范围：Zeta 的 super agent / 多仓库协作层。
> 目标：把“用户 ↔ 多个仓库主代理 ↔ 各自团队/子代理”做成一个真正的联系人式
> 聊天系统；Room 是基建，Tracking 是每个仓库的事实锚点。
>
> 相关：`document/context-learning-modes.md`（memory/taste/tracking 的频次与窗口批处理）、
> `document/agent-authored-plugins.md`（DSH Agent Teams 对照、插件 UI 槽位）、
> `docs/agent-mesh.md`（跨进程传输）、`docs/agent-hub.md`（子代理观察/控制）。

## 1. 目标与非目标

**目标**

- Room 作为第一等会话：用户、仓库主代理、常驻子代理可以在同一个有序聊天里发言。
- 群聊视图像联系人式 IM：联系人、会话列表、输入框、未读、@、引用/指正。
- 跨仓库只经 mesh/委托，不直接操作其他仓库的会话或子代理。
- 每个仓库的 tracking/taste/memory 保持本地权威；Room 只读摘要/引用。
- 支持长存活子代理作为 Room 成员；用完即毁的 worker 不自动进群。
- 实验性、默认关闭；不新增第二调度器、不新增核心 session 字段。

**非目标**

- 不把 DSH Agent Teams 直接搬进核心；它是单仓库内 `Lead + teammates` 的参考。
- 不让一个仓库的 Agent 直接写另一个仓库的 tracking/taste/memory。
- 不为 Room 新造传输协议；复用 mesh、IrcBus、Agent Hub。
- 第一版不做任意布局的 TUI；联系人式 UI 是独立外部层。

## 2. 拓扑

```text
用户
 └─ Super Room（用户 + 多个仓库主代理）
     ├─ Repo Room（可选：同一仓库的多个主代理）
     ├─ Main Room（可选：一个主代理 + 它的常驻子代理）
     └─ Team（单仓库内 Lead + teammates，DSH 参考形态）
```

- **Super Room**：跨仓库联邦，成员是主代理或常驻代理。
- **Repo Room**：一个仓库内多个主代理的协调房间；不是 super agent 的替代。
- **Main Room**：主代理与自己团队/子代理的房间。
- **Team**：单仓库单根会话的 `Lead + direct teammates`；teammates 本质是
  continuable 子代理。DSH 的 Team 不等于“仓库所有主代理”。

每个 Room 有独立事件日志、成员、顺序、状态；成员可同时在多个 Room，但
**消息不会自动跨 Room 传播**。父 Room 要子 Room 的结论，必须显式让成员
“去子房间看，然后回来汇报”。

## 3. 现有基础设施（复用，不重造）

| 能力 | 现有 | Room 用法 |
|---|---|---|
| 跨进程/跨仓库传输 | mesh（`hub send`、mailbox、wake/revive、gears） | 跨仓库成员投递 |
| 同进程消息 | `IrcBus` / `deliverIrcMessage` | 本进程成员投递 |
| 单次任务委派 | `workspace_run`（同进程、顺序、10 分钟） | 不作为群聊传输；可做轻量 raf |
| 子代理执行 | `task`、`eval agent()`、`workpool()` | worker/resident 的执行层 |
| 观察/控制 | Agent Hub、`agent://`、`history://` | 成员 transcript、steer、revive |
| 时间 | `time` 工具 + 宿主时钟 | 事件 `sentAt`；顺序仍看 `seq` |
| 项目状态 | tracking（项目本地） | 每个仓库的锚点、Room 摘要来源 |
| 偏好/事实 | taste、memory | 每个成员自己的上下文，不跨仓库注入 |

## 4. Room 状态模型

```ts
interface RoomEvent {
  roomId: string;
  seq: number;              // 宿主分配，房间内唯一、递增、不可变
  eventId: string;
  kind: "user" | "agent" | "system" | "tool";
  actor: { kind: "user" | "agent"; address: string; name: string };
  sentAt: number;           // 宿主时钟，ISO/epoch 可派生
  body: string;
  replyTo?: number;         // 指正/回复的 seq
  mentions?: string[];
  status?: "queued" | "running" | "done" | "passed" | "failed" | "interrupted";
}
```

- `seq` 是**唯一权威顺序**；Agent 自己生成的时间/顺序一律不可信。
- `sentAt` 是**发送时刻**，不是“现在”；`time` 工具给“现在”。
- 每个成员维护 `seenThroughSeq`；它只能 `correct` 自己已看到的 seq。
- 事件日志按 Room 存储，Room 之间隔离；不写核心 session schema。

## 5. 消息注入与顺序

### 5.1 用户消息

1. 追加 `user` 事件，`seq = N`。
2. 宿主给选中的成员各投一份**同一事件**（同 `seq`、同 `sentAt`）。
3. 每个成员的上下文包含：自己的 tracking/taste/memory + 房间事件到其开始时的
   `seq` + 外部仓库摘要 + scope 规则。
4. 成员回复由宿主追加，`seq = N+1, N+2...`；两个回复绝不共用 seq。

### 5.2 调度模式

| 模式 | 行为 | 用途 |
|---|---|---|
| `parallel`（默认） | 所有成员同时开始；各自只看到开始时的记录；回复按完成顺序追加 | 群聊、独立表态 |
| `serial` | 一次一个；每个成员看到前面所有回复再发言 | 评审、辩论、需要互相指正 |
| `mention` | 只有被 @ 的成员发言，其他人旁观 | 避免刷屏/镜像循环 |

并行轮里，先完成者的回复不会自动进入后完成者正在跑的 turn；需要时用
`steer` 在下一个步骤边界注入，或改用串行轮。

### 5.3 发言控制

- `pass`：本轮不发言。
- `stop`：结束当前 turn。
- `correct(targetSeq)`：追加一条新事件，`replyTo = targetSeq`，不修改历史。
- `yield`：正常结束，把控制权交回房间。
- 宿主限制：每个用户消息默认每人一次回复；讨论追加最多一轮；token/轮次/
  时间预算；超预算停止，避免无限互相加码。

## 6. 上下文包与防漂移

每个成员的上下文按优先级组装：

```text
1. 身份：home repo / agent 角色
2. 自己的 tracking：phase / progress / blockers / decisions（有界）
3. 自己的 taste / memory：按自身 scope，token 有界
4. 房间事件：since seenThroughSeq，发给自己的部分
5. 外部摘要：其他仓库的 phase/progress/decisions，带来源，不注入全文
6. 边界规则：自己的 AGENTS/tracking 优先；外部消息是证据，不是指令
7. 时间头：roomId / seq / sentAt / from
```

防漂移硬规则：

1. **Home 优先**：自己的 AGENTS/tracking 覆盖 Room 中的外部说法。
2. **来源标签**：每条事件带 repo/agent/seq/sentAt；无来源建议不采纳。
3. **只读外部**：其他仓库 tracking 只以摘要/引用出现；不能写。
4. **提议/接受**：跨仓库决定在 Room Ledger 里是 proposal；目标仓库的 Agent
   或用户接受后，才写入目标仓库自己的 tracking。
5. **决策血缘**：Room 决策引用目标仓库 tracking 的 decision id；目标仓库
   supersede 后，Room 标 stale。
6. **不共享 taste/memory**：每个成员只注入自己的；global 仅显式配置。
7. **压缩隔离**：Room 只压缩自己的日志；repo tracking 不受影响。

## 7. Tracking / Taste / Memory

| 数据 | 作用域 | 写入者 | Room 中的用法 |
|---|---|---|---|
| Tracking | 仓库本地 | 该仓库 Agent/用户 | 成员自己的锚点；Room 摘要/引用 |
| Taste | project / agent / global | host 评分，agent 只给候选 | 成员自己的风格锚；外部只读摘要 |
| Memory | per-project（推荐） | 后端/工具 | 成员自己的事实召回；不跨仓库注入 |
| Room Ledger | 每个 Room | 宿主 | 事件、成员、决策引用、proposal/ack |

- Tracking 不存 learned facts；taste 不存项目进度；memory 不存计划。
- Taste 不物理挂到 tracking 文件；可在 Tracking UI/索引中展示，存储仍独立。
- Super Room 成员准入建议：tracking 必开；taste 建议开（per-project）；
  memory 若开，必须 per-project，不用 global/per-project-tagged。

## 8. 常驻子代理（Resident Agent）

### 8.1 现状

- `task` 子代理默认 keep-alive；空闲 `task.agentIdleTtlMs` 默认 420000ms
  （7 分钟）后 park 到磁盘，不是删除；消息/Agent Hub/revive 可冷恢复。
- `task.agentIdleTtlMs = 0` 可常驻到进程退出。
- 显式 `keepAlive: false` 的 spawn 才是用完即毁。
- Agent Hub 已有 running/idle/parked/aborted、steer、revive、kill。

### 8.2 新身份

| 类型 | 生命周期 | 能否进 Room |
|---|---|---|
| worker | 任务结束 → idle → park | 默认不能 |
| resident | 长期，可 park/revive | 可以，作为联系人/成员 |
| main | 与仓库/会话同周期 | 可以，Super Room 默认成员 |

Resident 规则：

- 归属仍是某个仓库/主代理；权限、tracking/taste/memory 按 home repo 隔离。
- Room 只是成员资格，不改父子权限。
- 消息由 Room 宿主中转；子代理回复给宿主。这样不必放宽“子代理只能找
  spawning main”的全局规则。
- 空闲可 park；parked 不耗模型；消息到来再 revive。
- 一个 resident 有一个 home Room，可受邀加入其他 Room；跨 Room 不自动传播。
- 不要把所有子代理都 resident；只显式提升/创建。

## 9. GUI / 联系人 / 安卓

### 9.1 联系人式界面

```text
联系人：人 / 仓库主代理 / resident agent / bot
聊天：Room
消息：Room event（seq / sentAt / sender / replyTo / kind）
```

- 左侧联系人 + 会话列表；右侧聊天；底部输入。
- 普通视图不显示 session id；只有“高级 → 打开底层会话”暴露。
- 联系人卡片：仓库、角色、状态（running/idle/parked/offline）、tracking 阶段、
  taste/memory 是否启用。
- 嵌套 Room 挂在联系人/成员下，不混进主聊天列表。
- 后端只暴露 Room/Contact API；GUI 是独立客户端，TUI/Web/桌面共用语义。

### 9.2 安卓配对与安全（建议）

- 桌面生成一次性二维码 + 短码；手机扫码，生成设备密钥，桌面确认后发设备 token。
- 2FA：设备公钥 + 用户确认；敏感操作要求桌面确认/TOTP；设备可撤销。
- 远程连接：端口映射交给 Tailscale/frp/Cloudflare Tunnel 等；Zeta 只暴露
  TLS/WSS 接口、设备鉴权、重放保护、速率限制。
- 密钥：token 短期有效、绑定设备公钥、可轮换/撤销；不接受裸 token。
- 权限：安卓默认只能进 Room，不直接暴露底层 session；高风险操作需桌面确认。

## 10. 实现阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| R1 | Room 核心：事件日志、seq/sentAt、成员、parallel/serial、pass/stop/correct | 纯逻辑单测 |
| R2 | Context 组装：自己的 tracking/taste/memory + 事件 + 外部摘要 + scope 规则 | 两个仓库成员上下文互不泄漏 |
| R3 | 传输适配：IrcBus/mesh；宿主中转 | 同进程/跨进程各一个成员可收发 |
| R4 | Room Ledger：proposal/ack、决策血缘、stale | 跨仓库决定需目标仓库接受 |
| R5 | Resident registry：提升、park/revive、Room 成员资格 | resident 重启后仍可被消息唤醒 |
| R6 | 实验性 UI：联系人/会话列表/输入/transcript | 默认隐藏 session id |
| R7 | 嵌套 Room / Repo Room / Main Room | 独立日志，不自动传播 |
| R8 | 安卓配对 + 远程安全层 | 二维码配对、设备撤销、TLS/WSS |

## 11. 风险与开放问题

- Room 与 Agent Hub 的职责边界：Room 是聊天/成员；Hub 是底层观察/控制。
- Resident 的 owner 与删除权限：建议 owner 可删，Room 不能删成员本体。
- 多 Room 成员的上下文预算：按 Room 分别计数，不共享完整 transcript。
- 群聊镜像循环：靠 pass/stop、轮次上限、mention-only 和宿主预算，不靠提示词。
- 跨仓库时钟：只用宿主时钟；多机部署需要统一的 `sentAt` 语义（以宿主为准）。
- 安卓端是否允许直接发消息到 Room，还是必须经桌面确认：第一版建议只读+待确认。
