# Context learning modes: sliding windows, memory, taste, tracking

> 状态：设计稿（2026-11-03）。目标：明确“滑动窗口压缩”与 memory/taste/tracking
> 的频率、成本、作用域，并定义可选的窗口批处理模式。
>
> 相关：`document/super-agent-rooms.md`、`docs/compaction.md`、`docs/memory.md`、
> `docs/tools/time.md`、`packages/coding-agent/src/taste/`。

## 1. 术语：滑动窗口压缩

“后台压缩”更准确叫**滑动窗口压缩**：

- 当前活动上下文是一个窗口。
- 达到阈值后，旧区域被摘要/归档，保留最近一段，形成新的独立窗口。
- 旧窗口的原始消息仍在会话日志（session entries）里；只是不再进入活动上下文。
- 多个旧窗口可以分别用于 memory、taste、tracking 的归纳。

“后台”指摘要可能提前在后台投机执行；不代表 memory/taste 也跟着后台跑。

## 2. 压缩机制（现状）

默认方法顺序：

```text
remote → snapcompact → handoff → shake → soft
```

| 方法 | 行为 | 摘要模型 |
|---|---|---|
| `remote` | 提供商原生压缩（OpenAI Responses compact、Anthropic beta、Bedrock） | 提供商侧 |
| `snapcompact` | 旧历史渲染成图片归档；视觉模型读回 | 不用；需视觉模型 |
| `handoff` | 生成交接文档作为压缩摘要 | 用 |
| `shake` | 大工具结果/代码块替换为 `artifact://` | 不用 |
| `soft` | 本地模型就地总结 | 用 |

默认与旋钮：

- `compaction.enabled = true`
- `compaction.asyncEnabled = true`：阈值前区间
  `[threshold − lead, threshold)`，`lead = clamp(threshold × 12.5%, 8192, 32000)`；
  后台对分支快照摘要，越线时提交。
- `compaction.midTurnEnabled = true`
- `compaction.idleEnabled = false`；空闲阈值 200000，延迟 300s。
- `compaction.keepRecentTokens = 20000`
- `compaction.autoContinue = true`
- `compaction.thresholdPercent = -1` / `thresholdTokens = -1`；按 reserve 计算。
- `compaction.reserveTokens` 未设置；有效 reserve 约 15% 窗口。
- `branchSummary.enabled = false`（分支摘要，不是压缩）。

压缩后活动上下文 = system + 摘要/归档 + 最近保留消息 + 新消息。旧窗口原始
消息仍在磁盘日志中。

## 3. Memory 的真实触发

**Memory 不跟压缩绑定。** 压缩摘要写入的是会话摘要；tracking 开启时把压缩
摘要镜像到 tracking 的 `summaries/`，这不是 memory。

| 后端 | 触发 | 额外模型 |
|---|---|---|
| **mnemopi** | `autoRetain` 默认 true；agent_end 检查，默认每 **4 个用户轮次** retain 未处理消息 | `llmMode=smol` 用 `memory` 角色；`none` 不用 LLM |
| **hindsight** | `autoRetain` 默认 true；默认每 **3 个用户轮次** retain；首轮 auto recall；会话边界 | 远端服务 |
| **local** | 会话启动/后台 consolidation | 摘要模型 |
| **sharpshooter** | 每个用户提示抽取；每 `intervalMinutes`（默认 5）合并 | `sharpshooter.model`，空则 `smol` |
| **taste** | 每个用户提示抽取；每 `intervalMinutes`（默认 5）合并 | 抽取 `memory` → `smol`；语义判断 `taste` → `judge` → `smol` |

### 3.1 mnemopi 的窗口读取

`extractMessages` 遍历 session entries，只保留 user/assistant 文本，**跳过
compaction 条目**。旧窗口的原始消息仍在 entries 里，因此 memory 可以读到
旧窗口；但它按“未 retain 的用户轮次”切片，不按窗口边界。

因此当前不存在“每个窗口自动做一次 memory”的配置。

### 3.2 额外模型成本

- `mnemopi` 的 `memory` 角色只服务 LLM 抽取/补全；召回走 FTS/embedding。
- `llmMode: none` 可以完全去掉额外模型。
- taste 抽取使用 `memory`/`smol`；`taste`/`judge` 只用于可选的语义判断。
- sharpshooter 与 taste 在 style 上重叠；不建议同时开。
- 后台抽取读取独立上下文，通常没有主对话缓存命中；比主模型工具调用更贵。

## 4. Taste 的真实触发

- 抽取：`message_start` 的 user 消息；主会话才跑，子代理不跑；短于
  `taste.minPromptLength`（默认 16 字）跳过；**每个提示都触发**，不是每 N 轮。
- 合并：60s tick；距上次合并超过 `taste.intervalMinutes`（默认 5 分钟）才跑。
- 候选：模型只给 statement/category/polarity/evidence；**不给 confidence**。
- 证据：`evidenceText` 必须是用户消息的 verbatim substring。
- 置信：host 的 Beta/Weibull；可选 judge 只给伪计数，不能直接抬到 1。
- 注入：base system prompt 重建时，最多 `taste.injectionTokenLimit`（默认 600）。

## 5. Tracking 的真实提醒

Tracking **没有固定轮次提醒**，也没有后台模型。

- todo 某个 phase 完全完成 → 一次 `tracking-phase-nudge`，要求 `tracking_update`
  的 `sync_todo`。
- 计划批准 → 镜像 plan。
- 其他时候靠工具提示词，要求模型在里程碑/决策/blocker 变化时主动调用。
- `tracking_update` 绑定会话 cwd，只能写当前仓库的 `.zeta/tracking/`。

## 6. 两套学习逻辑

### A. Agent 自维护模式（省额外模型）

- 主模型通过工具维护：`tracking_update`、`super_memory`、`retain`/`memory_edit`。
- 没有自动抽取模型；没有 per-prompt 后台调用；没有窗口扫描。
- 成本在主模型 token 内，通常共享主对话缓存。
- 依赖提示词/nudge 约束；适合成本敏感、可控性优先。

### B. 宿主后台模式（自动，但更贵）

- memory 自动 retain/抽取；taste 每提示抽取 + 可选 judge；sharpshooter
  每提示抽取。
- 需要 `memory` / `taste` / `sharpshooter` 模型配置。
- 独立上下文，无主对话缓存；高频时明显更贵。

### C. 窗口批处理（可选折中）

- 只在压缩提交后（或显式窗口边界/会话结束）对**被丢弃的旧区域**做一次批量抽取。
- 一次输入 → 多条 memory/taste 候选；关闭 per-prompt taste/sharpshooter 抽取。
- 没有缓存命中，但比每提示调用少很多次。
- 不是默认；需要新配置。

## 7. 窗口批处理设计

### 7.1 触发

- 压缩提交后（`compaction` entry commit）触发，处理本次丢弃区域。
- 兜底：会话结束，或显式 `window` 边界。
- 不处理当前活动窗口的尾部；最近 `keepRecentTokens` 不算“已丢弃”。

### 7.2 输入

```text
本次丢弃的旧区域消息（user/assistant 文本，保留必要 tool 摘要）
+ 本仓库 tracking 摘要
+ 本仓库已有 memory/taste 摘要（用于去重）
```

不注入其他仓库的 tracking/taste/memory。

### 7.3 输出

```text
memory candidates[]     // statement, evidence, category
taste candidates[]      // statement, category, polarity, evidence
project decisions[]     // 可进 tracking 的决策候选
```

模型只输出候选与 evidence；confidence、冲突、衰减、去重、tombstone 全部由
host 计算。

### 7.4 去重与作用域

- 每个仓库独立窗口；Room 只拿摘要。
- 按 `topicKey` 去重；同 topic 相反 polarity 进 conflict。
- 已在 tracking 的决策不重复写 taste/memory。
- 窗口批处理运行后，把窗口标记为已处理；重启不重复。

### 7.5 成本与缓存

- 全窗口输入每次唯一，基本没有缓存命中。
- 一次大输入 + 多输出，通常比每提示多次小输入便宜，但取决于模型价格。
- 如果使用压缩摘要模型顺便抽取，可省一次读；但 `remote`/`snapcompact`
  不一定提供可复用输入，且会耦合压缩实现。建议独立调用。
- 失败不阻塞会话；候选进入队列，下次重试。

## 8. 配置建议

新增（建议）：

```yaml
taste:
  extractionMode: prompt | window | off   # 默认 prompt
  windowBatchMaxTokens: 60000             # 可选
memory:
  extractionMode: auto | window | manual  # 默认 auto；window 复用压缩边界
```

现有可调：

```yaml
mnemopi:
  autoRetain: true
  retainEveryNTurns: 12    # 默认 4
  llmMode: none            # 去掉额外 memory 模型
hindsight:
  retainEveryNTurns: 10    # 默认 3
taste:
  minPromptLength: 32
  intervalMinutes: 15
sharpshooter:
  # 与 taste 重叠，建议关
```

Tracking 不需要频次配置；保持 phase 完成 nudge。

## 9. 推荐档位

| 档位 | Tracking | Memory | Taste | Compaction |
|---|---|---|---|---|
| 省成本 | 开 | mnemopi `llmMode=none`，manual/12 轮 | 关或 agent 手动 | async 可关；snapcompact |
| 平衡 | 开 | mnemopi per-project，12 轮 | `window` 模式或 prompt+高频阈值 | async 开 |
| 自动 | 开 | mnemopi `smol`，4 轮 | prompt + judge | async 开 |

Super Room 成员建议：至少“平衡”；不要 global memory / global taste。

## 10. 实现阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| C1 | 窗口边界模型：记录 compaction 丢弃区域/窗口 id | 能定位每个窗口的 raw entries |
| C2 | `extractionMode` 配置：prompt/window/off | 切换后 per-prompt 抽取停止 |
| C3 | 窗口批处理队列：压缩后入队、后台执行、去重 | 一次窗口产出多条候选 |
| C4 | host 评分/冲突/tombstone 复用现有 taste 逻辑 | 模型 confidence 不写库 |
| C5 | 会话结束/显式边界兜底 | 不压缩的短会话也能学习 |
| C6 | 成本计量：每窗口 token/调用统计 | 能对比 prompt vs window |

## 11. 开放问题

- 窗口批处理是否复用压缩摘要请求（省一次读）还是独立调用（简单、可移植）。
- 压缩方法为 `remote`/`snapcompact` 时，旧区域是否仍可完整取得。
- 窗口批处理的模型选择：`memory` / `taste` / 单独 `window` 角色。
- `window` 模式下 taste 的 evidence 是否仍要求用户原文；建议保持。
- 会话结束兜底是否只在交互式会话启用，避免后台/子代理频繁触发。
