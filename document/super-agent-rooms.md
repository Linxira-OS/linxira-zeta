# Super agent rooms: contacts, ordered chat, and resident agents

> 状态：实验性实现（source-only，见 `docs/rooms.md`）；本设计仍为产品/边界依据。适用范围：Zeta 的 super agent / 多仓库协作层。
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
  （2026-11-06 澄清：§5.2 的 serial/parallel/mention 是**消息投递顺序**，模块名固定为
  `rooms/delivery.ts`；它不是 2026-11-01 裁决禁止的"核心里的第二条任务调度器"，扇出仍归
  `task`/`workpool`。此前 §7 把它写成 `rooms/scheduler.ts` 是措辞越界，已改。）

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

## 12. 初步诊断（2026-11-05）：呈现、基建缺口、契约面与上游起点

> 本节是初步诊断，不改写 §1–§11 的任何裁决。证据取自 `web-app/` 与
> `packages/coding-agent/src/server/studio-host/` 已经存在的那条在制品分支
> （`feat/web-ui-studio-migration`）；`main` 上还没有这两个目录，所以下文
> 路径都以该树为准。不能从这棵树验证的判断标 `[INFERENCE]`。

### 12.1 呈现决定（初步）：Room 住在哪一页、每页看到什么

**位置**：新增次级路由 `rooms`，与 `agent-hub` 同级，且**同样不进顶栏**。

- `Route` 联合类型、`isSecondary`、`SECONDARY_META` 三处各加一项
  （`web-app/src/studio/App.tsx:331`、`:334`、`:338`），页面主体挂进同一个
  `showPage` 分支（`App.tsx:8826` 的 `agent-hub` 分支旁）。
- **不**加入 `PAGE_NAV_DEFS`（`web-app/src/studio/HomePage.tsx:44-52`）和
  `isAppRoute`（`:54`）。这正是 `agent-hub` 今天的待遇：它不在顶栏定义里，
  只能从 File 菜单（`App.tsx:8722`）和 `go("agent-hub")` 进入。实验性表面
  不占主导航的位置，可用之后再升，而不是先占一个 tab。
- 入口：File 菜单 "Agent Hub" 旁加一条 "Rooms"；侧栏运行时菜单块
  （`App.tsx:2893-2895`）加一条；`ui === "rooms"` 的深链按 `agent-hub`
  的同一写法处理（`App.tsx:7807` 旁）。
- 房间列表是**页面内部**的左栏（`SecondaryPage` 的两栏内容，`HomePage.tsx:54`），
  不是应用侧栏的会话列表（`App.tsx:2391` 一带）。侧栏继续只属于 session。

**每个房间看到什么**

| 区域 | 内容 | 今日来源 / 复用点 |
|---|---|---|
| 有序日志 | 按宿主 `seq` 排列的事件；`replyTo` 渲染成引用，`mentions` 高亮 | 虚拟化复用 `ConversationVirtualList`（`web-app/src/studio/conversation/ConversationVirtualList.tsx`，只吃 `itemKeys` + `renderItem`）；行渲染器是新写的（事件不是 `ConversationItemView` 的形状） |
| 常驻成员条 | 成员卡片：仓库、角色、状态、当前动作、模型 | 复用 `AgentCard`（`AgentHub.tsx:1031`）、`StatusDot`（`:947`）、`FlagChips`（`:956`）；状态词汇 `running\|idle\|parked\|aborted`（`:75`） |
| park / revive | 仅 parked 可 revive；按钮的可用性由 manifest 决定 | 复用 `capsFor`/`missingCap`（`AgentHub.tsx:806-935`）；今天按钮显示 "Revive（暂未实现）"（`:226-235`），因为宿主没注册该命令，见 §12.2 第 3 行 |
| 每房间 telemetry | 成员会话 token/cost 之和、最近一轮耗时；不定义新的成本模型 | 形状复用 `SessionTelemetrySnapshot`（`studio-host/protocol/contracts/telemetry.ts:4-35`）；`session.telemetry.read` 今天只声明未注册 |
| 输入框 | 发一条 user 事件，可 @ 成员、可切本轮调度模式 | 文本域复用 `ComposerInput`（`web-app/src/studio/ComposerInput.tsx:25`）；提交走 `room.post`，**不走** `core.prompt` |

**Web UI 不能变成什么**

| 禁止 | 原因 |
|---|---|
| 第二个 transcript 渲染器（工具卡、上下文检查器、计划评审卡、审批卡） | 那些是 workbench 会话视图的职责（`conversation/ConversationPane.tsx`、`InteractionDeck.tsx`）；房间只显示事件正文、发送者与 seq。"打开底层会话"是跳转（`setHubIntent`，`AgentHub.tsx:241`），不是就地重画 |
| 与会话视图并列的第二个聊天产品 | 一个房间是一份有序事件日志；它不得写进任何 session transcript，也不得把 `conversation.changed` 当自己的存储（`contract/lifecycle.ts:228-240` 明确那是另一个命名空间） |
| 调度器面板 | 只有 pass / stop / correct 与宿主预算；不给每个成员单独的 retry / queue / steer 控件（§5.3 的预算归宿主） |
| 任意联系人管理器 | 联系人是仓库、主代理、resident；不是人类通讯录 |
| 普通视图里出现 session id | §9.1 的既有裁决：只在"高级 → 打开底层会话"暴露 |
| 侧栏里再长出一份会话/房间双列表 | 侧栏是 session 的家；房间的多栏结构留在房间页内部 |

**复用 vs 新增**

| 项 | 复用 / 新增 | 证据 |
|---|---|---|
| 页面壳、路由元数据、转场 | 复用 | `SecondaryPage`（`HomePage.tsx:54`）、`SECONDARY_META`（`App.tsx:338`）、`pageTransition.ts` |
| 能力门（manifest 检查） | 复用惯用法 | `capabilities.some(cap => cap.id === … && cap.grade !== "unavailable")`（`AgentHub.tsx:806`、`App.tsx:8858`）——渲染器**没有**全局路由门，每处自己查 |
| 成员卡片与状态点 | 复用 | `AgentHub.tsx:947`、`:956`、`:1031` |
| 长列表虚拟化 | 复用 | `conversation/ConversationVirtualList.tsx` |
| 输入框外壳、魔法词高亮 | 复用 | `ComposerInput.tsx:25` |
| 会话 telemetry 形状 | 复用 | `protocol/contracts/telemetry.ts:4` |
| i18n 文案 | 复用机制 | `en.ts` + `zh.ts` 两本字典，按语言动态加载（`i18n/I18nContext.tsx:21-29`，由 `i18n/lazyLocales.test.ts` 守住） |
| `RoomsPage`（路由体）、`RoomList`（左栏）、`RoomLogRow`、`RoomResidentStrip`、`RoomComposer` | 新增 | 今日全树没有 room 相关组件（`grep -ri room web-app/src/studio` 只命中布局注释） |
| 客户端房间 store（按 `roomId` 存事件、`seenThroughSeq`） | 新增 | 既有的 `state.clientState.entities.residents` 是 broker 会话行（`App.tsx:2047`、`contract/read-models.ts:219-238`），不是房间成员 |
| `ops/rooms.ts` + `room.*` 操作 | 新增 | `STUDIO_FAMILIES` 今日九族无 rooms（`studio-host/ops/index.ts:18-28`） |

### 12.2 基础设施缺口（逐原语映射到今日代码）

| 原语（§） | 今日状态 | 归属文件 | 最小端到端切片 |
|---|---|---|---|
| 独立事件日志 + 宿主 `seq`/`sentAt`（§4） | **缺失**。最接近的三样都不是房间日志：`ClientEventBase.cursor` 是 per-authority-epoch 的投递游标（`contract/lifecycle.ts:188-198`），`conversation.changed.eventSeq` 是另一个命名空间（`:228-240`），`IrcBus` 只有进程序号（`irc/bus.ts:30-33`、`:131`） | 新建 `packages/coding-agent/src/rooms/log.ts`（该目录今日不存在） | 一个房间追加两条事件，重启 `zeta serve` 后 `room.log.read` 仍返回 `[1,2]` 且 `sentAt` 不变 |
| parallel / serial / mention 投递顺序（§5.2） | **缺失**。今日只有两类近似：`task`/`workpool` 扇出；`workspace_run` 串行中继（单回复路径、10 分钟上限，`channels/session-router.ts:12-16`、`:57`） | `rooms/delivery.ts`（**只决定房间内一条事件的投递顺序与收件人**，不调度任务）；扇出仍走既有 `task`/`workpool`，投递仍走 `IrcBus`/`deliverIrcMessage` | 同一房间两个 resident：serial 下 B 的上下文含 A 的回复 `seq`；切 mention 后只有被 @ 的一个进入 running |
| resident park / revive（§8） | **运行时已有，宿主侧没有**。生命周期在 `registry/agent-lifecycle.ts:1-19`、`:125`，空闲 TTL 默认 420000（`task/settings.ts:465-471`）；但 `agent.send\|kill\|revive\|release\|spawn` 只在契约里声明（`contract/operations.ts:492-515`），`ops/` 下**零注册**，manifest 不广告，Agent Hub 因此显示 "暂未实现"（`AgentHub.tsx:226-235`、`:818`） | `ops/session.ts`（注册命令）+ `rooms/membership.ts` | 只注册 `agent.revive`：Hub 的 revive 解锁；把空闲 resident park 掉、投一条房间事件，观察冷启动复活且回复仍落回宿主 `seq` |
| 房间成员资格与 home repo 隔离（§6、§8.2） | **缺失**。`residents.list` 已声明（`contract/operations.ts:113`）但未注册；`ResidentsReadModel` 描述的是 broker 里的 Runtime 会话（`contract/read-models.ts:219-238`），不是"谁在这个房间" | `ops/rooms.ts` + `rooms/membership.ts` | A 仓的 resident 加入房间 R，组装出的上下文标 home=A；把 B 仓 tracking 塞进事件正文，也只能以引用摘要出现，不能成为指令 |
| 跨仓库 proposal / ack / 决策血缘（§6.4） | **缺失**。最接近的是 IM 多工作区中继与 `sessionMapping` 绑定（`channels/session-router.ts:12-16`）；没有 proposal、ack、stale 对象 | `rooms/ledger.ts` | 针对 B 仓的 proposal 不写 B 的 tracking；B 的 agent ack 后 `.zeta/tracking/` 才出现一条带房间 `seq` 溯源的决定；B 自己 supersede 后房间里那条标 stale |
| 跨进程投递与房间寻址（§1 非目标：不新造协议） | **传输已有，寻址没有**。mesh 信封有 message/wake/ack（`mesh/types.ts:46`），离线邮箱按 `sentAt` 排序、至少一次投递（`mesh/mailbox.ts:1-10`）；但没有任何 room 地址 | `rooms/transport.ts`，只包装 `IrcBus`（`irc/bus.ts:51`）与 mesh | 第二个进程里的成员收到房间事件，回复以宿主 `seq` 落回同一日志 |
| 设备配对 + 2FA（§9.2） | **部分**。已有配对码 + `studio_session` cookie + `x-studio-csrf`（`studio-host/server.ts:42-57`、`:160-216`），二维码把 token 放在 fragment（`server/pairing.ts:1-14`），远端 token 轮换/吊销与失败限速（`web-gateway/remote-access.ts:1-34`）。没有设备密钥、按设备吊销、TOTP/桌面确认（`packages/coding-agent/src` 下无 totp/2fa 实现） | `studio-host/server.ts` 的会话记录 + `utils/remote-token.ts` | 第二台设备配对得到独立 device id 并在设置里可见；吊销该 id 只让它的 cookie 失效；一条"敏感"房间命令在没有桌面确认时被拒 |
| 每房间 telemetry | **部分**：per-session 形状在（`protocol/contracts/telemetry.ts:4-35`），`session.telemetry.read` 声明却未注册，房间聚合完全没有 | `ops/usage.ts`（per-session 落地）+ `rooms/telemetry.ts`（求和） | 一个两成员房间的 token/cost 等于两条 `session.telemetry.read` 之和，且没有新增成本模型 |

### 12.3 契约面

- **族**：`rooms`。在 `STUDIO_FAMILIES`（`studio-host/ops/index.ts:18-28`）里加一项，
  一个家族一个文件：`ops/rooms.ts`，`StudioFamily.id = "rooms"`。
- **查询（读、幂等）**：`rooms.list`、`room.get`、`room.log.read`、
  `room.telemetry.read`、`room.ledger.read`。
- **命令（写、必须 ack）**：`room.create`、`room.post`、`room.correct`、
  `room.member.add`、`room.member.remove`、`room.round.stop`、
  `room.resident.promote`、`room.resident.park`、`room.resident.revive`、
  `room.proposal.create`、`room.proposal.respond`。
- 命名沿用已注册的 `family.verb` 风格（`session.state`、`session.fork`、
  `session.tree.navigate`，见 `ops/session.ts:1156-1423`）。
- **查询/命令的分界由 `registry.ts` 决定**：查询返回
  `{ok:true, queryName, result}` 或 `{ok:false, queryName, error}`
  （`registry.ts:147-171`）；命令返回 `{accepted, result}`，未知名字抛
  `StudioOpError`，HTTP 层答 400 加同一个错误信封（`registry.ts:173-204`、
  `:73-79`）。对 `room.post` 的直接后果：**accepted 回执里没有 seq**，
  `seq` 只能从随后的 `command.receipt` 得到，渲染器不得乐观编号。
- **为什么 manifest 会自动把它们藏起来**：manifest 只由已注册的 handler id
  生成，profile 固定 `"limited"`、每条 `grade:"stable"`（`registry.ts:121-146`），
  未注册的名字答 `unsupported`。所以房间表面"注册即出现、删掉即消失"，
  不需要 feature flag；反过来，入口必须自己查 manifest（§12.1 的复用惯用法），
  因为渲染器没有全局路由门。
- **订阅**：`SubscriptionScope` 今天只有 `all`/`runtime`/`thread`/`command`
  （`contract/lifecycle.ts:256-260`）。房间流需要加 `{scope:"room", roomId}`；
  WS 升级通道已经就绪（`zeta-server.ts:1332-1338`）。在加 scope 之前，
  房间按 `room.log.read` 的 `seq` 做增量拉取。
- **重复维护点**：同一批 147 个操作名今天存在三份——宿主
  `studio-host/contract/operations.ts`、渲染器 `web-app/src/protocol/contract/operations.ts`、
  vendored `web-app/src/vendor/client-contract/src/operations.ts`；名字集合一致
  （42 query + 105 command，已注册 67）。新增 `room.*` 必须三处同改，没有生成器。
  这笔债值得在房间落地前收掉，但它不属于本节的决定。

### 12.4 起点门槛（对上游）

**当前基线**：账本第 3 行的 `## Integrated through: v18.15.0` 与
`## Current Baselines`（`document/upstream-sync.md:3`、`:2688-2695`）都还写
`v18.15.0`，但同一文件的 v18.16.0 条目记录：该 tag 已并入 `main`
（`1ea59944579`）、随 `v1.4.9` 发布（`04fe9e6e0c5`，见 `:44-160`）。本树
`git merge-base --is-ancestor v18.16.0 HEAD` 成立，版本行已到 1.4.10。
**结论：有效基线是 `v18.16.0`，账本可机读的那一行落后一轮。** 引用当前基线时
不要写 `v18.15.0`；下一轮 `check-merge-lineage` 审计读的正是这一行
（`:980`、`:1196`）。

**"从哪个上游版本开始"**：账本回答了基线与节奏（按需同步，`:5-8`），但
明确拒绝点名未来 tag——2026-11-03 的探测结论是"不要并 `main`，等下一个
正式 tag"（`:33-40`）。所以对 Room 来说**没有**一个"必须等到的上游版本"。
`[INFERENCE]` 房间表面在上游没有对应物：v18.15.0→v18.16.0 窗口里，
`web-app/`、`studio-host/`、`mesh/`、`channels/`、`server/`、`tools/hub/`
这些路径在上游 `v18.16.0` 树里根本不存在（`git ls-tree v18.16.0 <path>`
全为空）。Room 真正踩在上游拥有代码上的只有两个面：`irc/`
（`IrcBus` 的信封与投递，本窗口 0 文件变动）和 `registry/`、`task/`
（resident 的 park/revive 生命周期）。能把版本钉住的条件就是：**某个未来 tag
改动了 `irc/` 的投递/信封语义，或 `registry/`、`task/` 的 park/revive 契约**——
那时门槛变成"先并那个 tag，再在合并后的传输上设计房间日志"，钉住的是账本
当时记录的那个 tag，永远不是 `main`。

**开跑前必须为真的四件事**：

1. 账本 `Integrated through` 更新到 `v18.16.0`（或写明为何保留 `v18.15.0`），
   否则本轮所有 tag-to-tag 审计都对着旧基线。
2. 宿主契约稳定：`/api/v1` 的配对 cookie + CSRF 全绿、`buildBootstrap` 的
   manifest 非空，并且 `agent.*` 控制命令已注册——resident 成员资格今天在
   宿主侧没有任何落点（0 注册）。
3. 渲染器已出货：`web-app/dist` 由 `zeta serve` 带 history fallback 提供
   （`server/zeta-server.ts:208-230` 的 `webapp` 分支），`agent-hub` 路由在
   生产可达；Rooms 复用同一个壳。
4. 顺序权威先定死：房间 `seq` 必须是独立命名空间（像 `eventSeq`），不能
   复用 authority `cursor`，否则一次重连/resync 就会把房间顺序与投递游标
   搅在一起。

**一条未决矛盾**：账本 v18.16 风险图要求
`packages/coding-agent/src/collab/**` 不得复活（`document/upstream-sync.md:103-105`），
但这棵树里该目录是被跟踪的（最后改动 `98b7b94fe78`）。若将来有人想把房间
日志架在 collab 上，先解决这个矛盾；按 §1 的非目标，默认就不该走那条路。
