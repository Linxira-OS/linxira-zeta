# 默认工作区（bot 空间）与飞书场景：现状 + 缺口，一次讲完

本文的"默认工作区"就是用户说的 defeat/default workspace：**`~/.zeta/workspace`**
（`packages/coding-agent/src/server/zeta-server.ts:260-262` 的
`defaultCoordinatorWorkspace()`），它是 **relay coordinator** 的家，机器人默认落在这里。
写得不准的推测一律不写；下面每一条都带证据或明确标为"缺"。

## 1. 已经存在的（不许重写，只许接线）

| 能力 | 证据 |
|---|---|
| 默认工作区路径 + 预留接口 | `zeta-server.ts:260-262`；`zeta serve` 启动时建目录、把 coordinator 会话锚定在此（:548-600） |
| 旧安装迁移 | 老 `zeta-bot.jsonl` 迁到默认工作区并改写 web.yml 的 `relay` 登记（`zeta-server.ts:264-272`） |
| coordinator 是保留别名 | `session-router.ts:40`（`COORDINATOR_ALIAS`）、`web-config.ts:378`（`"main"` 为 relay 保留别名） |
| 会话路由三档 | `resolveRoute()`：运行期覆盖 → 持久映射 → 渠道默认 `workspaceRoot` → **relay coordinator**（`session-router.ts:285-301`） |
| 每会话 direct/relay 模式 | `chatBindings.mode: "direct" \| "relay"`（`web-config.ts:67-68`），relay 会话是登记表里不可删的一条（:77-86） |
| IM 指令切空间 | `@workspace open/use`、`*<alias>`（`session-router.ts:16`、:288-320） |
| bot 主动给用户发消息 | `channel_send` 工具（`tools/channel-send.ts`）+ `POST /api/channels/send`（`web-gateway.ts:199-200`） |
| 跨空间跑一次任务 | `workspace_run` 工具（`tools/workspace-run.ts`） |
| 记忆按项目隔离存储 | `getMemoryRoot(agentDir, cwd)` → `memories/<encoded project cwd>`（`memories/index.ts:1398-1400`） |
| 记忆开关是分层设置 | `memory.backend`（`memory-backend/settings.ts`，默认 `off`）；项目层 `<repo>/.zeta/settings.json` 可覆盖（`config/settings.ts:1180`） |
| 人设（有限版） | `personality` 设置（`settings-schema.ts:1533-1558`）：全局的沟通风格块，**不是**按工作区的人设文档 |

## 2. 真正的缺口（就是这次要做的）

1. **跨进程主代理寻址**：coordinator 与某个工作区的 main agent 之间没有地址
   （`registry`/`IrcBus` 都是进程内单例）。这就是"主代理向另一个主代理发话"缺的那层，
   详见 `document/agent-mesh.md`。
2. **按工作区的人设**：`personality` 是全局预设，默认工作区需要自己的**人设文档**
   （可编辑、随仓库走、只对默认工作区生效），并且不污染其他仓库。
3. **默认工作区记忆默认开、其他仓库不受影响**：存储已按项目隔离，缺的是
   (a) 默认工作区自带 `memory.backend` 的默认值；(b) 一道**隔离证明**测试——在默认
   工作区开着 memory 时，其他仓库的会话里 `learn`/recall 工具不存在、也不会写入任何
   记忆文件。
4. **汇报策略**：bot 收到子代理的汇报后"选择性/全量"转给用户——今天只有单条
   `channel_send`，没有策略（何时全量、何时只发摘要、何时只在失败时发）。

## 2b. 默认工作区自己是一个"仓库"，以及为什么它有记忆

- **它就是一个普通目录仓库**：`~/.zeta/workspace`。每台机器上只有它被当作"家"——
  没有选仓库的对话、IM bot 的对话都落在这里（`resolveRoute` 的 relay 分支）。
- **`memory.backend` 能只开给它**：该键是分层设置，用户层保持 `off`，只把
  `{"memory": {"backend": "mnemopi"}}` 写进 `~/.zeta/workspace/.zeta/settings.json`，
  于是只有 cwd 落在默认工作区的会话拿到记忆；存储本身按项目 cwd 编码
  （`memories/index.ts:1398`），别的仓库不会读到它的记忆，也不会因为它在开而变开。
  这条需要三件事同时成立才算"能"：机制（已有）、默认值（缺）、隔离证明（缺）。
- **默认初始化 git**：默认工作区首次创建时 `git init`（已存在则跳过，幂等），
  这样人设文档、AGENTS.md、长期记忆的沉淀都可 diff、可回滚。
- **官方 AGENTS.md**：默认工作区自带一份官方 agent 文档，写清它是"缺省落点"
  （无仓库对话 + IM bot 对话）以及它自己承载什么（人设、长期记忆、跨仓库派单），
  避免每次会话从零推断。

## 3. 场景（实现与验收以这些编号为准；每条给"今天的行为"）

### D1 用户第一次给飞书 bot 发消息
- 期望：落到**默认工作区**的 coordinator 会话；回复经飞书回来。
- 今天：可用（未绑定 peer → relay）。验收：`relay-default-route.test.ts`（已有行为，加断言）。

### D2 会话切换到某个仓库工作区
- 用户：`@workspace list` → `@workspace use zeta`。之后该 peer 的消息直接进 zeta 的
  main agent（`direct`），`@workspace use` 空参清回 relay。
- 今天：可用。验收：`session-router-workspace-switch.test.ts`（补：切回后 coordinator
  会话历史仍在）。

### D3 子 bot / 子代理干活，向主 bot 汇报
- 触发：coordinator 让 zeta 工作区的主代理调研 CI；zeta 侧再起子代理执行工具。
- 期望：子代理结果 → 该工作区 main agent → **coordinator**（一条 mesh 消息）→
  coordinator 决定是否打扰用户。
- 今天：**缺**（跨进程寻址不存在）。验收：`mesh-report-to-coordinator.test.ts`。

### D4 主 bot 把结果告诉用户（选择性 / 全量）
- 策略三档，按 peer 或全局配置：
  - `all`：每条汇报都转；
  - `summary`（默认）：只在阶段完成/出错时转一条合并后的摘要；
  - `silent`：只写内存/会话，用户问才说。
- 失败语义：发送失败不丢，进 outbox 并在下一轮重试；超过 TTL 记日志。
- 今天：**缺**（只有手工 `channel_send`）。验收：`relay-report-policy.test.ts`。

### D5 默认工作区的人设
- 内容：默认工作区自己的 `persona.md`（或等价文件），进入 coordinator 的系统提示；
  用户可在 GUI/CLI 编辑；**只对默认工作区生效**，其他仓库不继承。
- 与 `personality` 的关系：`personality` 是全局风格块，persona 是默认工作区的角色设定，
  两者叠加时 persona 在后、可覆盖风格。
- 今天：**缺**。验收：`default-workspace-persona.test.ts`（存在→注入；缺失→无副作用；
  其他仓库 cwd 下不注入）。

### D6 默认工作区的长期记忆
- 默认：默认工作区的 `memory.backend` 为 `mnemopi`（本地 SQLite），其他仓库保持 `off`
  除非各自显式开启。
- 隔离：记忆根按项目 cwd 编码（`memories/index.ts:1398`），默认工作区的记忆不会出现在
  其他仓库；在其他仓库会话里 `learn` 工具不可见（工具按 backend 门控）。
- 今天：**机制在、默认值与证明缺**。验收：`default-workspace-memory.test.ts`
  （默认工作区 backend=mnemopi 且写入只落在其根下；临时仓库会话 backend=off、
  `learn` 不存在、写入为零）。

### D7 记忆只开个别仓库
- 用户诉求："看看 memory 机制能不能只开个别仓库"——**能**：`memory.backend` 是分层
  键，写进 `<repo>/.zeta/settings.json` 只影响该仓库；用户层保持 `off`。
- 需要补的：设置面板要能区分"用户层 / 项目层"写入（今天 GUI 的记忆设置页只写用户层），
  以及一处文档说明该操作路径。
- 验收：`memory-project-scope.test.ts`（项目层开启后该仓库启用、兄弟仓库仍关闭；用户层
  仍是 off）。

### D8 bot 连的是哪个空间（可解释性）
- `@status`（或等价）要回答：本会话属于哪个工作区、route 是 direct 还是 relay、
  人设是否生效、memory backend 是什么、当前汇报策略。
- 今天：**缺**（信息散落，用户无法自查）。验收：`im-status-report.test.ts`。

### D8b 默认工作区的初始化（建仓/安装时）
- 触发：`zeta serve` 首次启动（等价于"安装后第一次跑"），默认工作区不存在。
- 行为：建目录 → `git init`（幂等）→ 写入 `.zeta/settings.json`（`memory.backend:
  mnemopi`）→ 写入官方 `AGENTS.md` 与人设文件 → 建首条提交。
- 幂等：目录已在、`.git` 已在、文件已在都不覆盖用户改动（只补缺）。
- 验收：`default-workspace-init.test.ts`（空目录→三样齐备且有提交；重复启动→零改动；
  用户改过的 AGENTS.md 不被覆盖）。

### D8c 落点规则可解释
- 无仓库的对话、IM bot 对话 → 默认工作区；用户显式选的仓库 → 该仓库；
  IM 里 `@workspace use` → 覆盖记录在该 peer 上。
- 验收：`landing-rules.test.ts` 覆盖三种来源，并把结论写进 `docs/`。

### D9 失败与安全
- 目标工作区不存在 / 未登记 → 明确列出可选别名，不猜。
- 未知 peer 不能切到非绑定工作区（切空间要落在该 peer 的映射里，不是全局改）。
- 记忆/人设文件路径做 owner 校验，写操作只落各自根目录。

## 4. 边界

- 跨机（远程工作区）不在本期，mesh 只预留 `tcp://` schema。
- 不改 YOLO 默认，不新增审批层。
- `personality` 全局预设保留，不废弃。
