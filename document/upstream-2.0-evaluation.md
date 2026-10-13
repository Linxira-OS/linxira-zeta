# 上游 2.0 评估：统一后端 与 内核换代（决策记录）

> 状态：**已拍板**（2026-10-13）。本文件是决策记录，不是实现计划。
> 背景：把「多端是否共享一个统一后端」与「是否把 OMP 内核换成 PI 内核」这一轮评估
> 落成内部结论。执行细节、待办与候选项登记在
> [`roadmap.md`](./roadmap.md) 的 **Deferred Queue**；本文件只回答「结论 / 决定 / 代价 / 被推迟项」。
>
> 一句话结论：**统一后端走「局部对齐 + 发现即复用」，不自建完整统一后端；
> PI 内核不换，只保留「档 1 反向 cherry-pick」作为候选；桌面重建随下一次 release。**

---

## 1. 背景与问题

Zeta 是 OMP 下游发行版：运行时、包布局与内部 `@linxiraos/*` 命名都刻意贴住 OMP，
以便上游 release 仍可合并。本轮评估要回答三个互相纠缠的问题：

1. **多端一致性**：CLI / Web（`zeta serve` 网关）/ 桌面 / IM 频道四类客户端如何读同一份
   durable 会话，又不各自造一套运行时？
2. **统一后端**：要不要像 opencode 2.0 那样，做一个「全机共享 daemon + 固定端口 +
   服务发现 + HTTP/SSE」的常驻后端，让所有客户端 attach 同一个进程？
3. **是否换内核**：OMP 内核与 PI（`earendil-works/pi`）同源，是否可以「不做 2.0、
   直接把 PI 内核拉到上游版本」？

五个只读侦察报告已交付（路径见 §6），本文件只汇总其结论。

---

## 2. 事实（数字与证据）

### 2.1 上游三条产品线各自的「统一后端」现状

| 产品线 | Ref / 版本 | 统一后端现状 | 关键证据 |
| --- | --- | --- | --- |
| **OMP v18**（已发布） | `omp-upstream/main` = `c8913466dd7`，version `18.10.2` | **无统一后端**。宣传是 "Same engine, four wrappers"——共享的是**引擎代码**，不是后端进程；无 `serve` 子命令、无会话 HTTP/SSE、无第一方桌面 | `README.md:498-500`；命令全表 `packages/coding-agent/src/cli-commands.ts:27`；第三方桌面（Electron / Tauri）各自 spawn 一个 RPC 子进程 |
| **omp²**（开发中） | 分支 `omp2` = `2f92f3b5aa2`，workspace `version = "0.1.0"`（pre-release） | **它才是真统一后端**：GUI 与 TUI 共享同一 chat projection，单一会话权威（`omp-session`）+ `.oms` journal 持久化，项目环境经 attach-or-start 单例守护共享 | `crates/app/src/gui.rs:34-37`（GUI/TUI 同一 `Snapshot + Event` 契约，"kernel/session ownership stays in the application controller task"）；官网徽标 "omp², soon!" 即指向此分支 |
| **PI / Pi Durable** | `pi-upstream/main` = `7d75a0e3eb2`；tag `pi-v1.2.0` = `06a4669` | **今天没有统一后端**。旧的 `packages/{protocol,server,client}`（CBOR 协议 + unix socket 发现 + 多 presentation attach）已于 **2026-10-12** 提交 `7472cda` 整体删除（−21,561 行）；多端能力迁进**实验包** `@earendil-works/pi-durable` | `docs/rpc.md:3`（RPC = 长活单客户端 stdio），`packages/env/docs/protocol.md:3-4`（`pi-env` 是 stdio over ssh 的**非监听**守护）；pi-durable 自述 "**One process owns a storage at a time, and other clients attach to that process**" |

要点：**三家都朝「多端共享同一会话」走，但落点不同**——OMP v18 只有 Collab 中继（WS + E2E 加密，
可实时加入运行中会话，但形态与「本地服务发现 + HTTP」完全不同）；omp² 与 pi-durable 是
「单进程持有权威 + 其他客户端 attach」，且**都未发布**（omp² pre-release，pi-durable 标注 Experimental）。

### 2.2 内核血统与规模（`kernel-report.md`）

- **共同祖先** = `15d5120b6a5`（pi-monorepo `0.9.4`，2025-11-26）。OMP 与 pi 自此后
  **各自重写内核，从未 merge**；pi 自己也在分叉点 267 个包文件中只保留了 73 个。
- **规模**：OMP 内核包族 `src` = **1,029,759 行**，是 pi 1.2.0 同族 **131,747 行**的 **7.8 倍**；
  反过来，OMP 全部内核 TS 源码 923,378 行中，与 pi 有 **≥50% 行级重合的只有 1,355 行（0.15%）**，
  逐字节相同仅 **2 个 vendored 第三方 `*.min.js`**。
- **谱系成立但内容不成立**：内核旗舰文件里 pi 的标识符仍有 53%–98% 存活
  （对照组 zeta↔OMP 同源文件为 92%–100%，随机基线中位 0.113），说明 OMP 保留的是 pi 的**骨架**，
  字面代码只剩约两成；且 OMP 文件普遍是 pi 的 1.1–15 倍大（`agent-loop.ts` 4.5×、`read.ts` 13×）。
- **「插件层」其实是内核的运行时基座**，不是外挂：上游 OMP 侧，
  `@oh-my-pi/pi-natives` / `pi-catalog` / `omptype` / `pi-wire` 分别被
  **291 / 955 / 355 / 230** 个文件 import（含 `packages/agent`、`packages/ai`、`packages/tui` 内核包）。
  zeta 侧对应为 `259 / 958 / 362 / 214`（`pi-swap-report.md` §3.1）。

### 2.3 真实 merge 试验（`pi-swap-report.md`，一次性 scratch worktree）

以 zeta `origin/main` = `9e258a35337` 为基线，实测 `git merge pi-v1.2.0`：

| 口径 | 实测值 |
| --- | --- |
| 冲突文件 | **201**（其中 `packages/` 内 **181**；命中内核全部旗舰文件） |
| 冲突块（`<<<<<<<`） | **1,263** |
| 其中「规范化后两边完全相同」的纯机械块 | **17（1.3%）** → **真语义块 1,246（98.7%）** |
| pi 静默灌入（自动纳管） | **1,683 文件 / 369,204 行** = **7 个新包**（`durable`/`chord`/`env`/`codemode`/`mcp`/`evals`/`telemetry`，431 文件 121,684 行）+ **28 个新第三方依赖** |
| 需「产品级二选一」的设计决策点 | **≥ 30**（≥10 个主题，每个都是两套实现择一） |

冲突分桶：**A 桶 32 个**（Zeta 侧专有，pi 删/迁走，取我方或接受删除，无行级冲突）、
**B 桶 145 个**（真语义冲突：agent 循环整文件重写、会话/工具契约分歧、provider 层形态不同、
TUI native 化、host/RPC 层重构……）、**C 桶 24 个**（CI/flake/tsconfig/README 纯机械）。

**分档量级（agent-日，`[推断]`，以规模外推）**：

- **档 1：反向 cherry-pick**（以最后同步点 `b21b42d0`=pi `0.61.1` 为起点，只挑不依赖内核重构的能力）——
  `0` merge 冲突，欠账 `3,562` 提交 / `95` 个版本条目，**8–20 agent-日**，可搭一个 release。
- **档 2：内核对齐 + 重挂 OMP 层**（以 pi 为基座）——**400–900 agent-日**，不能塞进一个 release。
- **档 3：完全换内核**——**500–1,200 agent-日**，等于重做一个产品。

**最大单点风险**：换内核会同时判死 pi 侧**没有对应物**的三层——`natives`（+`crates/` 1.44M 行 Rust）、
`catalog`、`omptype`——它们是内核的实际运行时基座而非可选插件；且这种能力回退是**静默**的：
本仓库已有先例，整取上游 `session/agent-session.ts` **静默丢掉 45 个成员（整个 mode API）**，
且三方 merge「0 冲突」仍丢 API（`document/upstream-sync.md:47-58`，"A clean conflict count is not
evidence of a clean merge"）。

---

## 3. 可选路线与代价

### 3.1 统一后端：四个选项

| 选项 | 形态 | 代价 / 结论 |
| --- | --- | --- |
| **(a) 维持现状** | 每端自带运行时；Web 走 `zeta serve` 网关，桌面 spawn 自己的 serve | 最低，但重复起服务、多实例、会话/端口各自为政 |
| **(b) 局部对齐（选定）** | 保留「每端自带运行时」，按 opencode 的「**发现即复用**」做服务发现与复用：注册文件 + 同版本复用 + 桌面优先复用 | 小、增量、可增量验证；**不引入常驻 daemon**，不重写会话存储 |
| **(c) 自建完整统一后端** | 全机共享 daemon + 固定端口 + HTTP/SSE + 服务发现（opencode 2.0 形态） | 大，等价于造一个新运行时；**被推迟**（见 §5） |
| **(d) 跟进 omp² / pi-durable** | 直接采用上游的「单进程持权威 + attach」模型 | 不可对接：omp² 是 pre-release（无发布物），pi-durable 是 Experimental 库、无网络外壳；**被推迟**（见 §5） |

### 3.2 内核：三档（同 §2.3）

- **档 1 反向 cherry-pick（候选）**：8–20 agent-日，无 merge，走既有 `port/pi/<scope>` 分支范式。
- **档 2 内核对齐 + 重挂**：400–900 agent-日，必然能力回退。
- **档 3 完全换内核**：500–1,200 agent-日，重做一个产品。

---

## 4. 决定

**决定 1 —— 统一后端方向 = 先做「局部对齐」，不自建完整统一后端。**
保留「每端自带运行时」，按 opencode 的「发现即复用」做**服务发现 + 复用**：
`zeta serve` 写注册文件、同版本直接复用既有实例、桌面**优先复用**已运行的后端。
理由：完整统一后端（选项 c）是造一个新运行时，风险/工期与收益不匹配；而「发现即复用」能以增量方式
消掉重复起服务、提高多端一致性。**已开工**（`zeta serve` 注册文件 + 同版本复用 + 桌面优先复用）。

**决定 2 —— PI 内核不换。**
档 2/3 需 400–1,200 agent-日、真实 merge 试验中 **98.7% 是真语义冲突**、回退**静默**
（`document/upstream-sync.md:47` 先例），代价与风险不可接受。**只保留「档 1 反向 cherry-pick」
作为候选**（8–20 agent-日，具体项待挑）。

**决定 3 —— 桌面重建随下一次 release。**
桌面壳与其内嵌 Web 的重建**不单独发版**，随下一次正常 release 一起交付。

**决定 4 —— 被推迟项按仓库规则登记进 `roadmap.md` 的 Deferred Queue。**
不另立计划文。登记项见 §5。

---

## 5. 被推迟项（→ `document/roadmap.md` Deferred Queue）

以下三项已登记进 [`roadmap.md`](./roadmap.md) 的 **Deferred Queue**（本地未开工的后期规划）：

1. **自建完整统一后端**（上表选项 c；opencode 2.0 形态的全机 daemon + HTTP/SSE + 服务发现）——
   用户裁决先走「局部对齐」，此项押后，启动时再评估。
2. **跟进 omp² / pi-durable**（上表选项 d）——上游 omp² 分支仍在 pre-release、pi-durable 为
   Experimental 且无网络外壳；等上游发布/稳定后再评估对接。
3. **档 1 反向 cherry-pick 候选清单**——方向已定（保留为候选），但**具体挑哪些能力**尚未裁断，
   候选清单与逐项量级登记在此，开工时从 Deferred Queue 移入执行计划。

---

## 6. 参考

**评估报告（本次决策的取证来源；只读侦察产物，位于本地 `temp/.omp-tmp/`）：**

- `temp/.omp-tmp/omp-backend-report.md` —— 上游 OMP v18 无统一后端（"Same engine, four wrappers"）。
- `temp/.omp-tmp/pi-backend-report.md` —— PI 今天无统一后端；旧 `packages/{protocol,server,client}` 于 `7472cda` 删除。
- `temp/.omp-tmp/kernel-report.md` —— 内核血统、规模与耦合量化。
- `temp/.omp-tmp/pi-swap-report.md` —— 真实 merge 试验、冲突分桶与分档量级。
- `temp/.omp-tmp/upstream-claims-report.md` —— 上游宣称 vs 代码逐条核实（含 omp² 分支）。
- 仓库内既有记录：`document/upstream-sync.md`（同步台账 + 静默回退先例）、`document/porting-from-pi-mono.md`（移植范式）。

**上游 SHA / 分支（取证时点 2026-10-13）：**

| 对象 | SHA / 分支 |
| --- | --- |
| OMP v18（`omp-upstream/main`） | `c8913466dd7bf92040de911f8e00e30b8f4e48a2`（version `18.10.2`） |
| omp²（`omp-upstream` 分支 `omp2`） | `2f92f3b5aa2035d21c9f016f9ff6350795e5685a`（workspace `0.1.0` pre-release） |
| PI（`pi-upstream/main`） | `7d75a0e3eb2`；tag `pi-v1.2.0` = `06a466935536f8c9bcacb2d5efc0fc021be1bdff` |
| OMP 与 pi 共同祖先 | `15d5120b6a5dc757355b99d20d8d1885143d0865`（pi-monorepo `0.9.4`，2025-11-26） |
| OMP 最后同步点（内部文档） | `b21b42d032919de2f2e6920a76fa9a37c3920c0a`（= pi `0.61.1`，2026-03-22） |
| zeta 评估基线（本地试验用） | `origin/main` = `9e258a35337805841b04564d2fea92a0d85e7bc7` |
