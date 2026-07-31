# Zeta 架构方案对比（执行决策用）

> 状态：多方案待选，执行时按代码难度勘察结果定案（2026-07-31）
> 前提共识：fork 必漂移；"以插件形式把 pi 改造为我们的产品" 是主基调
> 三个决策变量：① 引擎基底（pi-mono / omp）② 缓存实现（引擎补丁 / extension）③ 产品层（插件化 / 搬包 / 全量 fork）

---

## 方案 1：pi 底线 + 引擎缓存补丁（主流推荐）

```
linxira-zeta/
├── (根 = pi-mono fork,几乎零改动)
│   └── packages/agent/src/...  ← 唯一补丁:append-only-context 移植
├── patches/append-only-context/ ← 348 行 + harness 落点适配
├── packages/zeta-toolkit/        ← 产品层插件包(extension 注册工具)
├── zeta CLI 品牌壳
├── web-ui/ = pi-web fork + 品牌
└── desktop/ = Electron(npm 消费)
```

| 维度 | 表现 |
|---|---|
| 同步成本 | **最低**：引擎 1-2 文件改动，tag 小步 merge 分钟级 |
| 缓存卖点 | 完整：StablePrefix + AppendOnlyLog 全量移植（2-3 周） |
| 功能密度 | 起步低：插件层按需补 |
| web 集成 | 原生：pi-web + 未来 C/S 直连 |
| 上游化 | 缓存补丁 PR 回 pi-mono → 漂移归零 |

**代码难度勘察点**：harness 三处落点（session.ts 570 行 / compaction.ts 880 行 / agent-harness.ts 1185 行）接口是否稳定 → 定移植工程量

---

## 方案 2：pi 底线 + 纯插件化（零引擎改动，激进）

```
pi-mono 核心零源码改动（只有品牌层）
├── ~/.pi/extensions/zeta-cache.ts   ← extension 实现缓存（注入稳定 context + 自定义 compaction）
├── zeta-toolkit（extension 工具包）
└── web-ui / desktop 同方案 1
```

| 维度 | 表现 |
|---|---|
| 同步成本 | **零**：引擎 100% 跟上游一致 |
| 缓存卖点 | **打折**：extension 能注入稳定 context 块 + 自定义 compaction，但控制不了引擎内部 prompt 布局（system prompt/工具 schema 渲染顺序是引擎的事）——命中前缀只有"我们的稳定块"，引擎部分不保证字节稳定 |
| 可移植性 | 最强：整个产品层是插件包，可搬到任何引擎 |
| 成本 | extension 简版缓存 1 周（不是 2-3 周） |

**关键决策点**：先做 1-2 天验证——extension 注入稳定块后实测缓存命中率（DeepSeek 字节稳定即命中）。若命中率 ≥ 预期 → 方案 2 起步；不足 → 方案 2 只作第一阶段，补丁跟进（方案 1）

---

## 方案 3：omp 底线 + web 适配层（功能现成）

```
(根 = omp fork v17.2.1,缓存现成 + hashline/browser/DAP 全有)
├── web-ui/ = pi-web + 8 文件适配层（从 omp-web 移植）
└── 双上游：omp(can1357) + pi-web(agegr)
```

| 维度 | 表现 |
|---|---|
| 同步成本 | **最高**：双上游；omp 已漂移 50 模块 vs pi 6，继承漂移 + 再漂 |
| 缓存卖点 | 现成（零移植） |
| 功能密度 | 最高：100+ 工具直接有 |
| web 集成 | 适配层永久维护；web 内跑的 agent 是 pi 不是 omp（两个 agent 并存） |
| 适用 | 仅当"缓存必须零成本立刻上线"且接受双上游漂移 |

---

## 方案 4：pi 底线 + 搬 omp 独立包（功能密度优先）

```
方案 1 基础上,额外:
├── vendor/omp-packages/hashline/   ← omp 独立包直接搬(检查依赖图)
├── vendor/omp-packages/collab-wire/
└── ... 按依赖图逐个评估
```

| 维度 | 表现 |
|---|---|
| 同步成本 | 中：pi 上游 + N 个 omp 包（不常更新即可 pin） |
| 功能密度 | 高：hashline 结构化编辑等独立包直接可用 |
| 缓存卖点 | 同方案 1 |
| 风险 | omp 包深度耦合 omp 引擎内部的话搬不动——**每个包先查依赖图** |

---

## 差异矩阵

| | 方案 1 pi+补丁 | 方案 2 pi+纯插件 | 方案 3 omp | 方案 4 pi+搬包 |
|---|---|---|---|---|
| 引擎同步 | 低（1-2 文件） | **零** | 高（双上游） | 低+包级 |
| 缓存卖点 | 完整（2-3 周） | 打折（1 周） | 现成 | 完整 |
| 功能密度 | 低→插件补 | 低→插件补 | 最高 | 高（按包） |
| web 集成 | 原生 | 原生 | 适配层永久 | 原生 |
| 产品可移植性 | 中 | **最强** | 差 | 中 |
| 首期工作量 | 3-5 周 | **1-2 周** | 0-1 周 | 3-5 周 |
| 核心风险 | 补丁适配超预算 | 卖点打折 | 漂移失控 | 包耦合搬不动 |

---

## 执行决策树（新路径按此顺序干活）

**Step 0 骨架（所有方案都要，0.5 天）**
```
git clone git@github.com:Linxira-OS/linxira-zeta.git
# pi-mono 源码进根（若选 omp 则替换）:
#   git remote add upstream https://github.com/badlogic/pi-mono.git
#   git fetch upstream && git merge --allow-unrelated-histories upstream/main
# web-ui subtree:
#   git subtree add --prefix=web-ui https://github.com/agegr/pi-web.git main
# scripts/ + README + LICENSE + NOTICE + AGENTS.md
```

**Step 1 勘察（决定方案，1-3 天，顺序即优先级）**
1. 读 pi `packages/coding-agent/docs/extensions.md` 全篇 + `examples/extensions/` → 输出 **extension 能力矩阵**（能否注入稳定 context？能否控制 compaction？边界在哪）→ 决定**方案 2** 可行性
2. 读 harness 三处（session.ts / compaction.ts / agent-harness.ts）history 构建接口 → 输出**缓存补丁落点纪要** → 决定**方案 1** 工程量（2 周 or 4 周）
3. 查 omp 独立包依赖图（hashline / wire / collab-web 等，`grep "from \"@oh-my-pi"`）→ 输出**可搬包清单** → 决定**方案 4** 增量

**Step 2 组合定案（勘察后选）**
- 推荐组合：**方案 2 起步（1 周出简版缓存）+ 方案 1 补丁跟进（2-3 周）+ 方案 4 按需**——卖点最快见效，再补齐完整版
- 备选：勘察发现 extension 命中率足够 → **纯方案 2**（零引擎污染）
- 兜底：缓存必须立刻完整 → 方案 3（接受双上游）

**Step 3 品牌层（所有方案相同）**
根 package.json name 保持官方原样（发布时脚本改写，避免 merge 冲突）；TUI 横幅/README/CLI help 改 Zeta；`~/.pi` 目录与 `PI_*` env 不动。

---

## 验收线（无论哪个方案）
- 缓存：50 轮/200k 历史命中率 ≥ omp 基线 ~85%，输入成本 ≤ Reasonix 基线
- 同步：pi 发版 tag merge 冲突 < 30 分钟
- web：web-ui 读到本机 zeta 会话（`~/.pi/agent/sessions/**/*.jsonl`）

## 参考（本地克隆）
- `C:\Users\ETPau\AppData\Local\Temp\opencode\pi-mono`（harness 0.83）
- `C:\Users\ETPau\AppData\Local\Temp\opencode\omp`（缓存来源 v17.2.1）
- `C:\Users\ETPau\AppData\Local\Temp\opencode\pi-web` / `omp-web`（web 基底 / 适配层参考）
