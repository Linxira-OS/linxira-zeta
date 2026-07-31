# Zeta — 缓存优先的 Coding Agent 产品计划

> 定位：**coding CLI，不是 life agent**。基于 pi-mono（MIT）全源码 fork，商业化产品
> 形态：CLI + 桌面（Electron）+ 服务器模式；引擎 npm 分发，桌面不捆绑引擎
> 核心卖点：缓存命中率优先引擎（移植自 omp），DeepSeek / OpenAI 双优先
> 状态：计划 v3（2026-07-31）— 引擎基底已切换为 pi-mono，迁移清单已定

---

## 0. 命名与品牌边界

### 名称（定稿）
- **品牌：Zeta Code**；CLI 命令：`zeta`（4 字母）——四科通识符号：数学（黎曼 ζ 函数）、物理/化学（ζ 电位）、生物（医药 ζ 电位）；ζ 函数自相似分形 = 自我迭代隐喻
- 命名否决记录：`linxira`(7 字母非词) → `linx`(国内公司撞车) → `lnra`(无法发音) → `lira`(npm 占+Fira Code 撞) → `linxra`(非词非短) → `cell`(Cell 期刊撞) → 最终 `zeta`
- 仓库：`Linxira-OS/linxira-zeta`（private，已改名）——单仓库全包
- npm：现在用个人账号（17380936778），后续注册正式组织（@linxira scope）；裸名已占，用 scope 发布
- 域名：linxira.com/.cn/.dev 未注册；`zeta.dev` / `zetacode.dev` 待核验

### 品牌边界（与组织内其他产品划界）
| 产品 | 技术栈 | 定位 | 关系 |
|---|---|---|---|
| **zeta**（本产品） | TS/Bun（pi-mono 引擎） | **coding agent**：CLI + 桌面 + 服务器，npm 分发 | 开发者工作流 |
| `linxira-pulse` | Rust | 系统级 AI 助手（Siri/小爱路线） | **不合并**；后续可能改名 |
| `linxira-skills` | JS | 跨运行时技能平台 | 协同：作为 agent 技能来源 |
| `linxira-os` | — | 发行版 | 品牌伞 |
| `extendai-lab-cli` | — | Reasonix fork 空壳占位 | 归档，品牌并入 zeta |

### 合规（MIT 商业化）
- pi-mono / omp / pi-web / omp-web 全部 MIT，版权人 Mario Zechner（badlogic）/ agegr——可闭源商用，**产物必须带 NOTICE 保留全部版权声明**
- 引擎层 MIT / 产品层（桌面、服务器、仪表盘）闭源；仓库 private 保护产品层

---

## 1. 技术决策（定案记录）

| 决策 | 结论 | 依据 |
|---|---|---|
| 引擎基底 | **pi-mono**（earendil-works，81k★，今日活跃，npm 0.83.0） | ① 上游活性碾压 omp（20.8k★）② pi 原生 C/S 架构（server/client/protocol 三包 = 我们要的服务器模式，omp 没有）③ pi-web 原生对接零适配 ④ 单一上游生态 |
| 缓存优先 | 从 omp **移植** append-only-context（348 行，MIT 同版权人，合法） | omp 独有引擎级机制（pi 0.83 无 StablePrefix/AppendOnlyLog/hashline/collab——已 grep npm 包验证） |
| web 基底 | **pi-web**（agegr，3375★，今日活跃）+ 品牌层 | 比 omp-web（1★ 冻结、依赖旧版 pi 0.82.1 包）功能全：i18n/ProjectTrust/PWA/小地图；omp 适配层 8 文件从 omp-web 移植 |
| 桌面 | Electron 壳，**npm 消费引擎**（不 fork） | 零同步负担 |
| 上游同步 | 改动最小化（引擎 1-2 文件）+ 上游化 PR | 详见 §4 |
| 架构事实 | pi 0.83 = harness 新架构（agent-harness.ts 1185 行分层）；omp = 旧架构（agent-loop.ts 2869 行巨型文件）；共享同名文件 100% 已改 | 移植在 harness 里重新落点，不 cherry-pick |

---

## 2. 仓库布局（Linxira-OS/linxira-zeta）

```
linxira-zeta/
├── (根 = pi-mono fork 原样路径，保持上游路径/CI/Dockerfile/docs 零破坏)
│   ├── packages/{agent,ai,coding-agent,tui,client,server,protocol,storage,evals}
│   └── bun.lock / LICENSE (原样保留)
├── web-ui/                 ← fork agegr/pi-web（Next.js，品牌层改造）
│   └── ...（自带 package.json/lockfile，独立构建，不并入 bun workspace）
├── desktop/                ← Electron 壳（产品层，闭源，npm 消费引擎）
├── scripts/                ← 构建/发布/上游同步编排
├── patches/                ← 引擎私有补丁（缓存移植，目标 ≤2 文件）
└── README.md / NOTICE / AGENTS.md
```

### 外线品牌改造边界（第一批只改这些）
- **改**：根 package.json 的 name/bin/description（发 npm 元数据）、README 品牌段、TUI 启动横幅（packages/tui）、CLI help 首行、web-ui 品牌文案
- **不改**：`PI_*`/`OMP_*` 环境变量、`~/.pi` 目录、`@earendil-works/*` 内部 import、crates 路径、docs/ 内链
- **零冲突发布法**：源码里 package.json name 保持官方原样，发布脚本发布前改写 name 再 pack（避免与上游 version bump 冲突）

### 分发链路（桌面不捆绑引擎）
```
npm 包 @linxira/zeta（待注册）
  → npx zeta / npm i -g zeta          ← CLI
  → 桌面安装流程：
      检查 npm → 缺失引导安装（winget install OpenJS.NodeJS.LTS）
      → npm i -g @linxira/zeta@latest
      → 本地 spawn `zeta serve`，Electron 内嵌 Web UI 连 localhost
  → 远程场景：桌面配置远端 server 地址直连（profile 切换）
```

---

## 3. omp 功能迁移清单

> 原则：能插件的走插件（pi extension/skills 正式机制），必须改引擎的压到最小，独立包按需迁

| 层级 | 功能 | 来源文件（omp） | 目标落点（pi 0.83） | 工作量 | 状态 |
|---|---|---|---|---|---|
| **L2 引擎级（必迁）** | 缓存优先 append-only | `agent/src/append-only-context.ts`（348 行） | harness compaction/session 构建点 | 2-3 周（含新架构适配） | ⬜ |
| L2 | message-cache / compaction-v2-streaming | `agent/src/compaction/` | harness/compaction/compaction.ts（880 行） | 1-2 周 | ⬜ 可选 |
| L2.5 独立包 | TUI 终端打磨（kitty-graphics/tmux/mouse/latex/desktop-notify/tab-bar） | `packages/tui/` | `packages/tui/`（同源，增量 merge） | 1 周 | ⬜ 可选 |
| L1 插件层 | 权限门 / git checkpoint / 安全扫描等工具 | omp 工具（extension 可覆盖） | `~/.pi/agent/extensions/*.ts` | 按需 | ⬜ |
| L0 配置 | skills（两代同格式 SKILL.md，直接搬）、prompt-templates | `.omp/skills/` | `~/.pi/skills/` | 0 | ✅ 原生兼容 |
| L3 暂缓 | hashline / collab / natives / browser / computer / eval / DAP / LSP / ssh / irc / mnemopi / TTS-STT / 图片 | omp 各包 | 独立包或插件 | — | ⏸ 立项再评 |

### 缓存移植接口勘察（第一步任务）
读 pi harness 三处定落点：
1. `harness/session/session.ts`（570 行）— history 构建/追加点
2. `harness/compaction/compaction.ts`（880 行）— 压缩保前缀点（omp replaceTail 对应物）
3. `harness/agent-harness.ts`（1185 行）— 上下文组装点（StablePrefix 注入）

### 缓存优先改造点（移植完成后，按优先级）
| # | 改造项 | 动作 |
|---|---|---|
| 1 | 默认提示词瘦身 | cache-first profile：~4.9k → ~0.5-1.5k；保留完整模式 |
| 2 | 动态注入审计 | TTSR 流注入 / Hindsight / Advisor——若重写已发送消息则 cache-first 禁用或 pin 到会话启动 |
| 3 | MCP 重连策略 | invalidate 全量 miss → cache-first 下提示重启会话 |
| 4 | provider 缓存矩阵 | DeepSeek（字节稳定即命中，10x）、OpenAI（自动缓存 >1024 token）、Anthropic（cache_control 断点）、Gemini（隐式） |
| 5 | 跨会话前缀复用 | 提示词 profile 固定 + 工具排序固定，TTL 窗口内新会话同前缀布局 |
| 6 | 缓存仪表盘 | 每会话命中率/成本曲线/miss 热点（产品化卖点） |
| 7 | 缓存基准 | 命中率、每轮 miss token、任务成本对比 |

---

## 4. 上游同步机制（长期）

**核心认知**：fork 必漂移，漂移速率 = 上游活跃度 × 我们的改动面。omp 反例：全量 fork + 大改（50 模块 vs pi 6），漂移失控。我们的对策：

1. **改动最小化**：引擎私有补丁压到 1-2 文件（patches/ 记录），每次 merge 冲突分钟级
2. **上游化**：缓存机制按"可上游化"标准写（模块化/收益普适/可配置），**PR 回 pi-mono**——合入后我们与上游从"分叉"变"同步演进"，漂移归零
3. **节奏**：跟随 pi release tag 小步 merge（不让积压膨胀）；web-ui 只跟 pi-web 一家 merge
4. **插件层天然同步**：skills/extension 格式稳定，零负担

---

## 5. 里程碑

- **Phase 0 — 地基（1 周）**：仓库骨架（pi-mono 源码进根 + web-ui/ + scripts/ + 文档）；外线品牌改造；NOTICE；npm login 注册
- **Phase 1 — 缓存引擎（3-5 周）**：移植接口勘察 → append-only 移植 → cache-first profile → 缓存基准；验收线：命中率 ≥ omp 基线（~85%@50轮/200k）
- **Phase 2 — web 集成（2-3 周）**：web-ui 品牌层 + 会话读取打通 + 服务器模式评估（pi-server 实验性：接手加固或自建）
- **Phase 3 — 桌面（4-6 周）**：Electron 壳（npm 检查流 + 引擎拉取 + Web UI + 缓存成本仪表盘）
- **Phase 4 — 商业化（持续）**：open-core 分界；定价；商标检索；上游化 PR 上线

---

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| pi-server 实验性（"may change or be removed"） | 前期只依赖其协议/客户端做评估，控制平面自研兜底 |
| 缓存移植适配 harness 新架构超预算 | 348 行逻辑独立模块化，接口勘察先行（§3） |
| 上游发版冲突 | 补丁 ≤2 文件 + tag 小步 merge |
| Windows 构建（natives/Bazel） | pi-mono 无 Bazel（omp 才有），npm 官方包兜底 |
| pi-web 依赖 pi 包版本漂移 | 跟随 pi 0.83+ 线，发版节奏同步 |
| npm 名被抢 | 立即 npm login 注册 |

---

## 7. 立即待办（第一批）

1. [x] `gh repo create Linxira-OS/linxira-zeta --private`（已改名）
2. [ ] **仓库骨架**：clone → pi-mono 源码提交进根 → web-ui/ subtree 引入 pi-web → scripts/ + README + LICENSE + NOTICE + AGENTS.md
3. [ ] **外线品牌改造**（§2 边界清单）
4. [ ] **移植接口勘察**：读 harness session/compaction/agent-harness 三处，定 append-only 落点，输出接口纪要
5. [ ] append-only 移植 + 首条缓存基准
6. [ ] `npm login` 后注册 npm 名
7. [ ] 归档 extendai-lab-cli

---

## 8. 参考资料（本地克隆）

- `C:\Users\ETPau\AppData\Local\Temp\opencode\pi-mono` — pi-mono（harness 新架构，0.83）
- `C:\Users\ETPau\AppData\Local\Temp\opencode\omp` — can1357/oh-my-pi（缓存机制来源，v17.2.1）
- `C:\Users\ETPau\AppData\Local\Temp\opencode\pi-web` — agegr/pi-web（web 基底）
- `C:\Users\ETPau\AppData\Local\Temp\opencode\omp-web` — 用户 fork（适配层 8 文件参考源）
