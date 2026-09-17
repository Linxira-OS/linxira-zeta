# Zeta agent-team 插件开发规格

状态：设计定稿（本文档只定契约与行为，不含实现代码）。分发/清单/安装的通用规则见
[plugin-system.md](./plugin-system.md)，本文不重复其内容，仅引用。

## 1. 定位

- `plugin-system.md` 已把 agent-team 定为 P0 官方插件、依赖头（P1 桌宠 / P2 科学
  插件均依赖同一套插件基础设施）。本文是 agent-team 的完整开发规格。
- 场景一（多代理任务编排，crew 编排）与场景二（人设群聊，Neuro 系）共用同一份
  crew 成员配置、同一套 `team_*` 工具、同一个 Web 显示面。
- 明确不做：不改 AgentSession 核心（mode API / session 层零改动）；不动 sync 树；
  所有 `@linxiraos/*` peer 依赖遵守 plugin-system.md 的依赖规则。

## 2. 架构：编排层跑在现有基座之上

CLI 侧三大件已存在（Agent Hub 已消费），agent-team 只做**编排层 + 工具暴露**：

| 基座 | 位置 | agent-team 的用法 |
|---|---|---|
| AgentRegistry | `packages/coding-agent/src/registry/agent-registry.ts`（`list(): AgentRef[]`） | crew 成员 = registry 里的 subagent；`team_spawn` 通过既有 task 派发路径创建 |
| AgentLifecycleManager | `packages/coding-agent/src/registry/agent-lifecycle.ts` | 成员生命周期（启动/退场/异常回收）复用生命周期管理，插件不另造进程模型 |
| IrcBus | `packages/coding-agent/src/irc/bus.ts` | 成员间消息 = IRC 总线消息；`team_chat` 工具是总线投递的封装 |

新增的只有一层薄编排器（`plugins/official/agent-team/` 内）：

```
plugins/official/agent-team/
├── manifest.json            # plugin-system.md manifest v2，含 pages（见 §5）
├── crew/
│   ├── teams/*.json         # 每个 crew 的成员名单 + 调度配置
│   └── personas/*.md        # 成员人设（frontmatter: name/model/prompt 锁定标记）
├── src/
│   ├── orchestrator.ts      # plan → work → review 调度循环（§3）
│   ├── tools.ts             # team_* 工具注册（§4）
│   └── irc-bridge.ts        # IrcBus 收发封装（发言限速、提及路由）
└── pages/                   # manifest v2 pages 的静态资源（§5）
```

## 3. 行为规格

### 3.1 调度循环（plan → work → review）

1. **plan**：`team_plan` 收到目标后，编排器生成任务 DAG（阶段/依赖/验收标准），
   持久化到 crew 工作目录（`crew-state.json`）。
2. **work**：按 DAG 拓扑序派发任务——每个任务经既有 task 路径 spawn 一个 subagent，
   系统提示 = persona 锁定段 + 任务正文。
3. **review**：任务完成后由 review 角色成员（配置里 `role: "reviewer"`）校验产出；
   通过 → 依赖解锁；拒绝 → 带理由重新入队（次数上限后升级为人工介入消息）。
4. **终止条件**：DAG 全部完成 / 显式 `team_cancel` / 重试上限触发人工介入。

### 3.2 场景二（人设群聊）

- 同一调度器，退化为"无 DAG"模式：成员按 IRC 总线消息驱动发言。
- **人设漂移防护（硬规则）**：persona 的系统提示段每轮重建时字节级重放
  （锁定标记 `locked: true` 的段落禁止运行期改写）；成员历史裁剪只裁对话轮，
  不裁锁定段。
- 发言限速（每成员每分钟 N 条，配置在 crew json）+ 提及路由（@name 才唤醒，
  防止全员每轮齐转）。

### 3.3 成员配置文件

- `crew/teams/*.json`：`{ name, members: [{ name, persona, role, model?, toolPolicy? }], pacing }`。
- `crew/personas/*.md`：frontmatter（`name` / `model` / `locked: true` 段标记）+ 正文
  人设。模板遵循 plugin-system.md 的人设模板约定。

## 4. 工具面（`team_*`）

| 工具 | 作用 | 备注 |
|---|---|---|
| `team_spawn` | 按 crew 配置 spawn 全体成员（经 task 路径） | 幂等：已在场的成员跳过 |
| `team_plan` | 生成/更新任务 DAG | 写 `crew-state.json` |
| `team_dispatch` | 派发单个任务给指定成员 | 复用 task 派发路径 |
| `team_chat` | 向总线投递成员消息（@提及路由） | IrcBus 封装 |
| `team_status` | 输出 DAG 进度 / 成员状态 | 复用 AgentRegistry.list() |
| `team_cancel` | 取消 crew（成员退场走 lifecycle） | |

工具描述走 i18n 目录（与 CLI /命令汉化同一 `M` 体系），新增键进
`packages/coding-agent/src/i18n/{en,zh}.ts` 的 team 分区。

## 5. Web 显示面（manifest v2 `pages`）

- 走 plugin-system.md 已定的 manifest v2 `pages` + gateway `/api/plugin-assets`
  iframe 方案。页面三块：成员名册、消息流（IRC 总线投影）、任务看板（DAG 投影）。
- **前置依赖（已核实缺失，列为 Milestone 0）**：manifest v2 `pages` 机制与
  gateway `/api/plugin-assets` 路由均不存在。
  - M0：plugin-system.md 的 pages 契约落地（gateway 路由 + manifest 解析 +
    静态资源挂载）。
  - M1：team-agent 核心（编排器 + `team_*` 工具 + crew 配置加载）。
  - M2：Web 页面三块（名册 / 消息流 / 看板）。
  - M3：人设群聊模式（场景二全量）。

## 6. CLI/TUI 查看面

- **不新建 CLI 查看器**。Agent Hub（现有）+ AgentTranscriptViewer 已覆盖单
  agent 对话查看（`agent-hub.ts` openChat → `agent-transcript-viewer.ts` 读
  sessionFile JSONL）；team-agent 复用 Hub 的 tree 视图（`t` 键 by-parent 分组），
  成员即 subagent 节点。
- `team_status` 工具的文本输出面向无 TUI 场景（ACP/远程客户端）。

## 7. 兼容与测试

| 测试 | 断言 |
|---|---|
| crew 编排确定性 | 固定 mock 模型下，同一 DAG 派发顺序稳定；重试上限触发人工介入 |
| IRC 总线注入 | `team_chat` 消息按提及路由到达目标成员；限速生效 |
| manifest 校验 | pages 声明与 `pages/` 资源一致；缺资源 → 安装期失败 |
| persona 锁定 | locked 段在 N 轮对话后字节级不变 |
| `team_cancel` | 成员退场走 lifecycle，registry 无泄漏 |
