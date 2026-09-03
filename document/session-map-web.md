# Web 会话地图（session-map-web）设计规格

状态：设计定稿（本文只定契约与交互，不含实现代码）。衔接 roadmap P0 step 6
（web-ui 现代化）的中央列 surface 体系；参考 `temp/dsh-synapse` 的投影架构。

## 1. 定位

- web-ui 高阶页：surface tab **「地图」**，挂在中央列 surface tabs 体系内
  （与 Chat / Trajectory / Git / Diff / Files / Terminal / Stats 同级）。
- 两块内容：
  1. **fork 可视化**——会话级 fork 链 + 轮内分支（entry 级 tree）的图状投影；
  2. **team agent 对话投影**——agent-team（见
     [agent-team-plugin.md](./agent-team-plugin.md)）成员消息流的地图视图，
     属 M2，本期只定数据面契约（§6）。
- 边界（红线一致）：**不建第二套会话历史**；删除/归档操作不进地图；
  私有浏览/本地存储失败不阻塞会话操作（dsh-synapse 语义）。

## 2. 数据源（全部现有，零后端新面起步）

| 数据 | 来源 | 说明 |
|---|---|---|
| 会话 fork 链 | `GET /api/sessions` DTO 的 `parentSessionId`（sessions.ts DTO 组装处，`parentSessionPath → pathToId` 投影） | 会话级父链 |
| 轮内分支 | `GET /api/sessions/:id` 的 `tree` 字段（`sm.getTree()` 投影） | entry 级分支；`navigate_tree`/`fork` op 已有 |
| 运行状态 | SSE `/api/agent/running/events` | running 高亮（与侧栏同一事件源） |
| 会话详情/切换 | 现有 `onSelectSession` 体系 | 点击卡片跳转 |

## 3. 投影模型（照 dsh-synapse 架构边界）

- **只读投影**：地图只读已提交事件；原生会话文件是唯一事实源，地图不回写。
- **卡片**：一个节点 = 一个会话（会话级视图）或一个 entry 分支点（entry 级视图）。
  文本 cap 8000 字符 + 截断标记语义（尾部 `…已截断` 徽标）；工具调用按 callId
  折叠进所属回复卡片。
- **边**：`parentSessionId` → fork 边；`tree` 的兄弟分支 → 分叉边。边不携带状态，
  状态（running/unread）只落在节点上。

## 4. 交互

- 可拖拽卡片 + fork 边连接（dnd-kit 已在 web-ui devDependencies）。
- 布局持久化 localStorage（`zeta-web:session-map-layout`），失败静默降级为
  自动布局——不阻塞会话操作。
- 卡片点击 → 跳转对应会话（复用 `onSelectSession`，isRestore 语义同侧栏）。
- entry 级分支查看 → 现有 BranchNavigator / trajectory 体系，不重做查看器。

## 5. Milestone

| 阶段 | 内容 | 依赖 |
|---|---|---|
| SM0 | surface tab 注册 + 只读投影（fork 链 + tree 分支） | 无（数据面已存在） |
| SM1 | 拖拽布局 + localStorage 持久化 + running/unread 节点状态 | SM0 |
| SM2 | team agent 对话投影 | agent-team M0/M1（见 §6） |

## 6. team agent 对话投影的数据面契约（本期不实现）

**现状差距（已核实）**：CLI 已可看 subagent 对话（Agent Hub →
AgentTranscriptViewer 读 sessionFile JSONL）；Web 无法看——gateway 无
subagent 列表 / transcript 路由，`GET /api/sessions` DTO 无 agent 维度字段。

SM2 前置的 gateway 契约（定形状，不实现）：

- `GET /api/agents` → `AgentRef[]`（`AgentRegistry.list()`，
  `registry/agent-registry.ts:269` 已有该方法）：`[{ id, name?, state, parent? }]`。
- `GET /api/agents/:id/transcript` → 增量 JSONL range 读：语义照
  AgentTranscriptViewer 的 `readFileIncremental`（按字节 range 追加，服务端
  不缓存会话状态）；响应 `{ entries: [...], nextCursor?: number }`。
- SSE 增量：复用 running 事件源的订阅模式；transcript 追加事件按 agentId
  分流（`/api/agent/running/events` 扩展或并列端点，实现期定）。
- 权限与路由归属：与 `/api/sessions` 同级鉴权（web-gateway 现有 auth 中间层）。

## 7. 明确不做

- 不做会话编辑/删除/归档入口（红线：删除操作不进地图）。
- 不做第二套会话历史存储；不做跨设备布局同步（localStorage 即可）。
- 不重做 BranchNavigator / trajectory 查看器（地图节点点击跳转到既有体系）。
