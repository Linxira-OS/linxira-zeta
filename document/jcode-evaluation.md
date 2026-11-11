# jcode 评估：外部参考实现的候选清单（研究记录）

> 状态：**研究结论（2026-11-11 用户裁决）**。本文件只记录结论与候选项，**不含任何实现**。
> 所有候选一律为 `Deferred — not implementation`：本轮未新增代码、未加会话字段、未改运行时行为、
> 未开实现 PR。执行与排期登记在 [`roadmap.md`](./roadmap.md) 的 **Deferred Queue**。
>
> 一句话结论：jcode 值得研究的只有**工程纪律**（把启动/恢复/内存/代码规模变成进 CI 的预算）与
> **确定性安全闸门**；功能面全面落后于 OMP。**不重写、不替换运行时、不迁移实现**。

---

## 1. 事实：jcode 是什么

> **路径约定**：作为**证据**引用的路径都属于 **jcode 仓库**（以 `crates/`、`docs/`、`src/` 为主，
> 含 `scripts/bench_*.py`、`scripts/check_*.py`）。**Zeta 侧落点**写成 `packages/…`、
> `document/…` 或 Zeta 自己的 `scripts/check-*.ts`。两者同名目录（`docs/`、`scripts/`）含义不同。

### 1.1 形态

- 仓库：<https://github.com/1jehuang/jcode>，`master` @ **`e5bfa5b8307a14f0a44801bedba48ba9ed378e11`**（2026-11-10）。
- 自我描述：*"High performance coding agent harness written in Rust, built for heavy multi-agent dev workflows"*；
  官网 `https://jcode.sh`；YC S26。
- 形态：**单二进制 Rust TUI agent** + **常驻守护进程** `jcode serve`（Unix socket，`setsid` 脱离客户端）
  + 多类客户端（TUI / SDK / 手机 / 云端）。`jcode run` 例外：进程内直接跑 agent，不起 daemon。
- 进程模型（`docs/SERVER_ARCHITECTURE.md`）：**一个 server 托管 N 个 session，客户端只是视图**；
  `/reload` 用 `exec()` 换成新二进制、PID 不变、所有客户端自动重连。

### 1.2 许可

- **MIT**，标准全文，无附加条款（`LICENSE`，`Copyright (c) 2025 Jeremy Huang`）。
- Zeta 同为 MIT：**代码可移植并保留版权声明**。但**服务不是 MIT**——jcode.sh 订阅网关、
  OpenRouter «Jev» 记忆推理、sponsor discovery 都是它的商业化组件，不能照搬。

### 1.3 成熟度（GitHub API 实测，2026-11-11）

| 指标 | 值 |
|---|---|
| Star / Fork / Watch | 21,687 / 2,521 / 106 |
| 创建 | 2026-01-05（约 10 个月） |
| 最后 push | 2026-11-11（当日） |
| Open issues | **827** |
| 贡献者 | 52，其中 `1jehuang` **11,197** commits；第 2 名是 bot（145）；第 3 名 46 |
| Release | `v1.0.0-preview.394`（2026-11-10），同日还有 `.393`；11-06 `.199`、11-03 `.136` |

**结论：开发极活跃，但巴士因子 = 1、issue 积压 827。它不是可依赖的上游，只是可读的参考实现。**
所以本文件把它的价值限定在「读它的做法」，不涉及任何运行时依赖。

### 1.4 发布与二进制模型

- 每个 release 附**6 个平台包**（linux/macos/windows × x86_64/aarch64，`tar.gz`）+ `SHA256SUMS`；
  安装 `curl -fsSL https://jcode.sh/install | bash`。
- **版本三元解耦**：Cargo 包版本 `0.99.1`，release tag `v1.0.0-preview.N`，由
  `JCODE_BUILD_SEMVER` / `JCODE_BUILD_GIT_TAG` 注入（`docs/UPDATE_CHANNELS.md`）。
- 通道：`stable`（默认）/ `preview` / `main`；预览号 = workflow run number（允许跳号）；
  只认 `v1.0.0-preview.<正整数>`，必须过 checksum，**不允许降级**。
- 本地多通道目录：`~/.jcode/builds/{versions/<ver>, current, stable, canary, shared-server}`，
  `~/.local/bin/jcode` 只是 launcher 符号链接（`AGENTS.md`）。
- 发布门禁（`RELEASING.md`）：tag 对应 commit 的 CI 必须全绿 + 6 产物齐备才发布；
  push 后有 15 分钟静默期；发布前再校验一次 SHA；`--prerelease --latest=false`。
- 构建档位分离：本地 `[profile.release]` 是 `opt-level=1, codegen-units=256, incremental=true`
  （为编译速度牺牲运行时）；正式发布走 `release-lto`，workflow 再强制
  `CARGO_PROFILE_RELEASE_OPT_LEVEL=3`（`docs/PUBLIC_RELEASE_BUILDS.md`）。

### 1.5 规模与 crate 地图（本次精确统计）

- **2,076 个 `.rs`**（全仓）；检出并统计 **1,901 个 = 950,391 行**，其中**测试 299,758 行（31.5%）**。
- 工作区 **92 个 member** = 根 crate + 2 个 vendored ratatui fork + **89 个 crate**。
- `Cargo.lock` **1,010 个包**（自家 `jcode*` 90 个）→ **约 920 个外部依赖**；默认 features = `pdf` + `bedrock`。
- 对照：Zeta `bun.lock` 约 **496 个解析条目**。jcode 的依赖面约为 Zeta 的 2 倍——这是它编译慢、
  并因此长出一堆编译/体积预算脚本的根因，不是优点。

| crate | LOC | 占比 | 说明 |
|---|---:|---:|---|
| `jcode-tui` | 289,728 | 30.5% | TUI 主程序（546 文件），`tui/app/*` 巨量状态 |
| `jcode-app-core` | 193,337 | 20.3% | agent 循环、server、工具（420 文件） |
| `jcode-base` | 168,126 | 17.7% | provider / auth / session / memory / config |
| 根 `src/` | 52,542 | 5.5% | CLI 与入口 |
| `jcode-provider-openai-runtime` | 15,981 | 1.7% | |
| `jcode-provider-openrouter-runtime` | 12,505 | 1.3% | |
| `jcode-provider-core` | 11,795 | 1.2% | |
| `jcode-tui-mermaid` | 11,561 | 1.2% | |
| `jcode-harness-api-server` | 11,502 | 1.2% | SDK 桥接（`translate.rs` 3,518 行） |
| `jcode-sdk` | 11,429 | 1.2% | |

**前 3 个 crate 占 68.5%。89 个 crate 是「编译增量驱动」的产物，不是架构清晰度的产物**：
20 多个 `*-types` crate 只有 `Cargo.toml + src/lib.rs`。作者自己的
`docs/CRATE_OWNERSHIP_BOUNDARIES.md` 写的是 *"Primary goal: make normal development and selfdev
builds faster by shrinking the root crate's recompilation surface"*，并记录了最大单文件
`server/client_lifecycle.rs` **3,484 行**（`scripts/code_size_budget.json`）——**他们自己在压这份债**。

### 1.6 评估方法与限制（重要：不要把本文当独立复现）

| 项 | 状态 |
|---|---|
| 克隆 | **部分克隆**（`--depth 1 --filter=blob:none --sparse`，52MB，只取 `docs/ crates/*/src src/ scripts/ *.md *.toml`）在 `temp/jcode-eval`；完整浅克隆与 tarball 均因带宽限速超时（460MB 仓库，约 0.15–0.5MB/min） |
| 未检出 | `tests/ vendor/ changelog/ sdk/ .github/` —— **`.github/workflows/*.yml` 未读原文**，发布结论来自 `RELEASING.md` / `docs/PUBLIC_RELEASE_BUILDS.md` / `docs/UPDATE_CHANNELS.md` |
| 二进制 | **未运行** jcode，未复现其 benchmark |
| 数字来源 | 其文档/脚本自述，或本次从源码推导；推导处标 `[推断]` |
| Zeta 侧 | 基于本次定向 `grep` 与局部阅读，写「未发现」而非「不存在」 |

---

## 2. 功能矩阵结论

**总判断：作为 agent 产品，jcode 全面落后于 OMP/Zeta；它系统性领先的只有运维层。**
不存在「迁移到 jcode 能力面」的选项，因此本文件不产生任何替换类候选。

| 能力 | jcode | Zeta/OMP | 结论 |
|---|---|---|---|
| Agent loop | `turn_streaming_mpsc.rs`（1,851 行）：流式、cancel registry、缺 `tool_result` 修复、超限重试、空响应续跑 | `packages/agent/*` + live-steering / speculative-execution / output-budget | OMP 更厚；jcode 只有两处细节值得看（见 §4） |
| 工具 | ~30 内置（`crates/jcode-app-core/src/tool/mod.rs:414-540`）+ MCP 动态工具 | 更广更深（ast_edit / eval / debug / lsp / browser relay / computer / Work Studio） | OMP 显著更强 |
| MCP | stdio + Streamable HTTP + legacy SSE、OAuth、schema 缓存、进程池（`docs/MCP_REMOTE.md`） | `src/mcp/*` | 相当 |
| Sessions/resume | 快照 + journal、崩溃恢复、resume picker（增量搜索 + 预览缓存）、reload 预热 | `session/*` + `resume/*` + `snapcompact` | 相当；jcode 的延迟工程更细 |
| Subagents | **只有 swarm**：仅 root 派生、**单层 fan-out**、共享 plan、DM/channel | `task` + `team/` + `agent/` + `mesh/` + `irc/` | OMP 明显更强（jcode 的限制是刻意设计） |
| Providers | anthropic / openai(+WS) / openrouter / gemini / copilot / cursor / antigravity / bedrock / azure / grok-build / 自家网关 | `packages/ai` + catalog + auth | 相当 |
| Permissions | 两级安全模型**仅 ambient 使用**（`docs/SAFETY_SYSTEM.md` 仍是 `Status: Design`）；交互侧主要是 bash 的确定性危险命令闸门 + justification 反思 | `approvalMode`/`autoApprove` + 工具级审批 | 各有侧重；jcode 的闸门值得借（P0-5），但它没有 per-tool 审批矩阵 |
| IDE / editor | **ACP server**（`src/cli/acp.rs`）；**无 LSP、无 DAP**（全仓 `lsp_`/`dap_` grep 为空） | ACP + `lsp/`（per-project mux）+ `dap/` | Zeta 强得多 |
| 图片 | kitty / sixel / iTerm 图元、内联截图、PDF | `kitty-graphics.ts` / `sixel.ts` / `ImageBudget` | 相当 |
| Web | webfetch + websearch（DDG/Bing/SearXNG/Kagi/custom，per-session 代理） | `web/` + `browser-relay` | 相当 |
| 插件 | hooks（8 个生命周期事件）+ skills + codemode + applets + **self-dev**（改自己源码→编译→reload） | 插件市场 + hooks + custom tools/commands | OMP 强得多 |
| Team | swarm + ambient + overnight | `team/`（lead/secretary/rooms/hub）+ mesh | OMP 更强 |
| 记忆 | 本地 JSON 图谱 + **远程 «Jev» 决策模型**打分 | `mnemopi` + `sharpshooter` + `hindsight` | 方向不同；jcode 有隐私代价（§5） |
| 测试 | 29.9 万行（31.5%）+ `tests/e2e/*` 真二进制 | 同等规模、CI 分片 | 相当 |

---

## 3. 性能：结构性优势 vs 可移植设计

### 3.1 它自述的数字（`README.md`，脚本 `scripts/bench_headless_memory.py` / `scripts/bench_startup.py`）

RAM per additional session（headless，PSS 全进程树求和）：

| 工具 | 首个会话 | 每增一个 | 相对 |
|---|---:|---:|---:|
| jcode | 71.3 MB | **~3.3 MB** | baseline |
| OpenCode（serve 模型） | 637.1 MB | ~5.9 MB | 1.8× |
| pi | 84.0 MB | ~79.6 MB | 24.1× |
| Claude Code | 272.9 MB | ~169.3 MB | 51.3× |
| Codex CLI | 398.6 MB | ~194.1 MB | 58.8× |

Time to first input（10 次交互启动，键入到屏幕出现）：

jcode **19.1ms** / pi 596.4ms / Codex 905.8ms / OpenCode 1047.9ms / Claude Code 3512.8ms。

> `pi` 很可能是 Zeta 的同源上游（Zeta 包名 `@linxiraos/pi-*`，且有大量 `legacy-pi-*` 兼容层），
> **若如此，它是 Zeta 运行时最接近的可比参照**（596ms、79.6MB/会话）——但这是 `[推断]`，
> 本次**未测 Zeta 自身**。

### 3.2 拆解：19.1ms 是怎么来的

1. **原生静态二进制**：Rust 进程启动本身极快。**这部分 Zeta 拿不到**——Bun 运行时 + 模块图初始化的固有成本不是设计能消掉的。
2. **客户端先画、后水合**：`docs/SERVER_ARCHITECTURE.md` 明确 TUI 只是瘦客户端。
   但它自己的 `docs/RELOAD_STORM_LATENCY.md` 实测 `Client exec startup before connect: p50 151ms, max 535ms`
   ——**高负载下冷客户端启动是 151ms 量级**（与 19.1ms 是不同构建/负载口径，不能相减）。
   19.1ms 测的是 *README* 定义的「键入字符到屏幕出现」，即 **TTY 已可接纳输入**，会话内容随后异步到达。
3. **Zeta 的结构性差异**：`packages/coding-agent/src/main.ts`（约 L2841）在挂载交互界面**之前**
   `await createSession({...})`——该调用连带建工具、LSP、MCP、模型发现。也就是说 **Zeta 的「可输入」
   被会话构建阻塞，jcode 不是**。

**可移植的是「先出可输入首帧、会话异步水合」，不是「Rust 快」**。`[推断]`：把 createSession 挪出
首帧关键路径后，Zeta 的「可输入」可望进入 100ms 量级；能否到 19ms 取决于 Bun 进程启动成本。

### 3.3 内存：哪些是真优势

| 机制 | 可移植 | 说明 |
|---|---|---|
| 单守护进程托管 N 会话，客户端只是视图 | ✅ 概念可移植，工程量大 | Zeta 已有 `serve` + `SessionManager` + `AgentRegistry`（`src/server/zeta-server.ts`），但**交互式 TUI 仍是每窗口一个 Bun 进程**——这才是最大内存差距来源 |
| Rust 无 GC + jemalloc | ❌ | Bun/JSC 基线天然更高 |
| 空闲休眠：释放派生缓存、保留权威状态（`docs/SESSION_HIBERNATION.md`） | ✅ | 见 P0-3 |
| `OnceLock` 缓存工具注册表、按会话 Arc 克隆（`tool/mod.rs:414`） | ✅ | 避免每会话重建工具对象 |

**诚实提醒**：休眠收益很不均匀。受控 64MiB daemon 缓存夹具释放 66,015,232 字节；**一个真实小 TUI 夹具只释放 278,528 字节**。
所以「休眠 = 省几百 MB」是错的，它省的是渲染过的长 transcript + 解码图片这类派生数据。

### 3.4 渲染

- jcode 的帧策略：动画局部重绘（`crates/jcode-tui/src/tui/app/idle_animation_repaint.rs`，只拷贝一个 `Rect` 的 cell）、
  chrome 250ms 全帧节流、`idle_heap_release.rs` 用 `malloc_trim` 治 glibc arena 滞留（**Rust/Linux 专属**）。
- **它自己承认首帧 wrap 未解决**（`docs/RELOAD_STORM_LATENCY.md`）：
  *"The frame that first paints the transcript still builds the whole body … per-message rendering is 85-95% (130-750ms)"*；
  150 轮冷预览 61ms（`docs/benchmarks/resume-experience-latency-2026-11-02.md`），
  并明写 *"Faster first render needs viewport-first or incremental wrapping"*。
- **Zeta 渲染层不落后**：`packages/tui/src/tui.ts` 已是差分渲染（row diff、`#altPreviousLines`、慢帧自适应节流），
  `frame-rate.ts` 有 `maxFps` 上限，`render/composite.ts` 单趟 overlay 拼接，`ImageBudget` 控图。
  **渲染层没有可抄的东西**，唯一有价值的是它的度量方法（§6）。

---

## 4. 候选矩阵（全部 `Deferred — not implementation`）

**状态口径**：本表所有条目**只登记、不实现**。本轮没有代码改动、没有 PR 落地、没有行为变化。
每项的「Zeta 目标」是**将来若做**的落点，不是承诺。

### P0（若启动，优先做；成本低、收益可量）

| # | 候选 | jcode 证据 | Zeta 目标 | 状态 |
|---|---|---|---|---|
| 1 | 首帧先行 + 会话异步水合 | `docs/SERVER_ARCHITECTURE.md`；§3.2 拆解 | `packages/coding-agent/src/main.ts`（`createSession` await 位置）、`startup-splash.ts` | `Deferred — not implementation` |
| 2 | 启动/恢复预算门禁进 CI | `scripts/bench_startup.py --check`（help/version ≤20ms、server ready ≤80ms、cold total ≤150ms、app_new ≤20ms） | 新增 `scripts/check-startup-budget.ts`，接入 `ci:check:full` | `Deferred — not implementation` |
| 3 | 空闲休眠：释放派生缓存、保留权威状态 | `docs/SESSION_HIBERNATION.md` + `tui/app/idle_hibernation.rs`（有界 last-frame、唤醒必须处理第一个字符） | `packages/tui/src/tui.ts` 渲染缓存 + `session/idle-maintenance.ts` 的 settle 语义 | `Deferred — not implementation` |
| 4 | 大会话后台预热解析 | `crates/jcode-base/src/session/prewarm.rs`：最大优先、2 worker、TTL 30s、`len+mtime` 校验、一次性消费 | `resume/` + `session/agent-storage.ts` 的加载路径 | `Deferred — not implementation` |
| 5 | 确定性危险命令闸门 + justification 反思 | `tool/bash_destructive_gate.rs` + `crates/jcode-command-risk/{assess,gate}.rs`：静态爆炸半径 → 拒绝一次 → 要求 ≥25 字符 justification，原样重试必失败；不引入第二个模型 | `tools/bash.ts`（已有 `rm -rf /` 解析防护，可作 stage 1 起点）+ 新 `security/command-risk.ts` | `Deferred — not implementation` |

### P1（需先测量/评估）

| # | 候选 | jcode 证据 | Zeta 目标 | 状态 |
|---|---|---|---|---|
| 6 | 并发 agent 的「文件触碰」冲突通知 | `server/file_touch_service.rs`（正排 path→accesses、倒排 session→paths）+ `server/file_activity.rs` | `server/` 新增服务 + `wire` 事件 + `team/` 渲染（本次未发现 Zeta 侧等价机制） | `Deferred — not implementation` |
| 7 | 质量棘轮预算：文件 LOC / panic / 吞异常 / wildcard 导出 | `scripts/{code_size_budget,panic_budget,swallowed_error_budget,wildcard_reexport_budget}.json` + 对应 `check_*.py`；阈值 1,200 行/文件，只许持平或下降 | 新增 `scripts/check-budgets.ts`，接入 `ci:check:full` | `Deferred — not implementation` |
| 8 | provider 预连接放在压缩/prompt 构建之前 | `agent/turn_streaming_mpsc.rs`：`prewarm()` 先于 `messages_for_provider()`（可能触发压缩） | `packages/agent/src/agent-loop.ts` + `session/cache-warmer.ts` | `Deferred — not implementation` |
| 9 | resume picker：合并帧 + 预览 LRU + 去抖 | `docs/benchmarks/resume-experience-latency-2026-11-02.md`：逐帧 63.5ms vs 合并 6.3ms（10×）；已准备预览保留 8 条，命中 <0.5ms；搜索去抖 150ms | `resume/view-model.ts` + `tui/overlays/*` 会话选择器 | `Deferred — not implementation` |
| 10 | 每会话持久化的 compaction ceiling | `docs/HARNESS.md`「Session context ceilings」：有效预算 = min(模型窗口, 会话上限)，随会话持久化，`token_usage` 带 `effective_budget` | `session/context-settings.ts` | `Deferred — not implementation` |

### P2（先测量再决定）

| # | 候选 | jcode 证据 | 前提 | 状态 |
|---|---|---|---|---|
| 11 | 动画局部重绘 | `tui/app/idle_animation_repaint.rs`（只拷贝一个 Rect） | 须先证明 Zeta 空闲时全帧重绘占比高；已有 `maxFps` + 差分渲染，可能不需要 | `Deferred — not implementation` |
| 12 | 会话 ownership lease | `crates/jcode-storage/src/session_lease.rs` + `active_pids/` | 可复用 `channels/instance-lock.ts` 思路 | `Deferred — not implementation` |
| 13 | SDK 能力广告 + schema parity 测试 | `harness_api_tests/{capability_coverage,schema_snapshot}.rs` + `sdk/typescript/test/schema-parity.test.ts` | 仅在对外 SDK 立项时 | `Deferred — not implementation` |

**共同约束（任何一项开工前必须满足）**：不新增第二条调度器；不改同步树
（`packages/**` 上游对齐面）；不引入新运行时；改动必须能作为 Zeta overlay 提交。

---

## 5. 不借鉴清单

| 项 | 原因 |
|---|---|
| `exec()` 热重载 / self-dev「改自己源码→编译→reload」 | 强绑 Rust 单二进制 + 编译链；对 Zeta 是「构建期自锁」风险。附带证据：它的 `AGENTS.md` 专门警告本地 `cargo build` 产物是**惰性**的，真正在跑的是 `~/.jcode/builds/shared-server/` 符号链接指向的版本 |
| 89 个 crate 的拆分 | 动机是 Cargo 增量编译；Zeta/Bun 无此成本模型，照搬只会得到 89 个转发出口 |
| `malloc_trim` / jemalloc arena 调优 | glibc 专属；16MiB/300s 这类阈值在 JSC 下无意义 |
| 本地 `opt-level=1` release profile | 是「日常构建快」的取舍，不是性能优化；Zeta 解释执行无对应物 |
| «Jev» 远程记忆召回（`memory_jev.rs`） | 把 query + 候选记忆发给第三方决策模型；隐私面扩大、依赖付费 entitlement、失败无回退 |
| `docs/SAFETY_SYSTEM.md` 整体 | 文档头是 `Status: Design`，实际只有 ambient 消费；其邮件/SMS/webhook 审批渠道对 Zeta 不适用 |
| `docs/MULTI_SESSION_CLIENT_ARCHITECTURE.md` | `Status: Proposed`，且自述「暂不支持同一会话多交互 owner」；抄结论即可（一会话一活跃 surface） |
| swarm 单层 fan-out 限制 | 是它的产品取舍（"bounded by construction"）；OMP `task`/`team` 已更灵活，不应回退 |
| 巨文件风格 | `client_lifecycle.rs` 3,484 行等，他们自己在压 |
| sponsor / `integration_tools` 增长机制 | 与 Zeta 无关 |
| 一天多个 preview 的发布节奏 | 单人主导 + 自动发布，是风险不是标杆；可借的是**门禁**（exact-sha CI + 全产物齐备 + checksum），不是频率 |

---

## 6. 度量边界经验（本次最值钱的部分）

jcode 的性能文档有一个 Zeta 应当照抄的写法：**每个数字都同时写清「测的是什么边界」和「哪里还没测」**。

可直接借用的三条规则：

1. **测得的阶段必须命名到端点**。例：它不是笼统写「resume 很快」，而是分
   `服务端 exec → 写出 History`（106–216ms）、`客户端 History → 已应用`（2–266ms）、
   `客户端 exec 启动`（p50 151ms，max 535ms），并注明端到端 p50 421ms / p90 454ms / max 750ms（11 个窗口）。
2. **把「没有信号」写进结论**。`docs/benchmarks/resume-experience-latency-2026-11-02.md` 的
   *Still missing, deliberately* 一节列出：真实 SSH 延迟、冷页缓存、物理合成器 paint、
   真实键盘连按节奏、Enter-to-attach 可用性——**明确说这些不在结论内**。
3. **滚动直方图要与失败/被覆盖计数同屏**。它的 `/client:resume-latency` 保留每阶段 ≤256 样本，
   并把 cache hit/miss、superseded selections、selector failures 与延迟一起暴露，避免「中位数好看、
   体验很差」被掩盖。

推论（对 Zeta 的约束）：**任何将来的性能 PR，若不能给出「阶段 + 边界 + 未覆盖项」三件套，不应被当作改进**。

---

## 7. 复审条件（什么时候才动）

用户口径（2026-11-11）：**先只发布调研，不实现任何 P0；候选项推迟，若上游不补，Zeta 可自行实现。**

具体触发条件，按顺序判断：

1. **上游是否补上**：每次 release sync 时检查上游（can1357/linxira-zeta、earendil-works/pi）
   是否已在以下任一项有等价能力——首帧非阻塞启动、启动/恢复预算门禁、空闲派生缓存释放、
   大会话预热、确定性危险命令闸门。补齐即删掉对应候选，不重复造。
2. **Zeta 侧是否有真实痛点**：以可测证据为准（`PI_TIMING` 阶段的「可键入」时间、
   多窗口 RSS、resume 关键路径解析耗时）。**没有测量就没有立项**。
3. **是否与在飞的口径冲突**：任何一项都不得引入第二条调度器、不得改同步树、不得新增运行时。
4. **复审节奏**：与 release sync 同步检查；连续两个 sync 周期上游无动作且 Zeta 仍有痛点，
   才把对应条目从 Deferred Queue 移入执行计划。

---

## 8. 附录

### 8.1 本次核对过的关键文件

| 主题 | 路径 |
|---|---|
| 进程模型 | `docs/SERVER_ARCHITECTURE.md`、`docs/MULTI_SESSION_CLIENT_ARCHITECTURE.md` |
| 多 agent | `docs/SWARM_ARCHITECTURE.md`、`crates/jcode-app-core/src/server/swarm*.rs`、`server/file_touch_service.rs` |
| 启动/恢复 | `docs/SESSION_CREATION_LATENCY.md`、`docs/RELOAD_STORM_LATENCY.md`、`crates/jcode-base/src/session/prewarm.rs` |
| 内存 | `docs/SESSION_HIBERNATION.md`、`tui/app/{idle_hibernation,idle_heap_release,idle_animation_repaint}.rs` |
| Agent loop | `crates/jcode-app-core/src/agent/{turn_streaming_mpsc,turn_loops,compaction,streaming,tool_handoff}.rs` |
| 工具 | `crates/jcode-app-core/src/tool/mod.rs:414-540`、`tool/bash_destructive_gate.rs`、`crates/jcode-command-risk/src/gate.rs` |
| 会话持久化 | `crates/jcode-base/src/session/{persistence,journal,crash,resume_cache}.rs` |
| 质量门禁 | `scripts/{bench_startup.py,bench_headless_memory.py,check_code_size_budget.py,code_size_budget.json,panic_budget.json}` |
| 发布 | `RELEASING.md`、`docs/{UPDATE_CHANNELS,PUBLIC_RELEASE_BUILDS}.md`、`AGENTS.md` |
| 记忆 | `docs/MEMORY_ARCHITECTURE.md`、`crates/jcode-base/src/{jev,memory_jev,memory_agent}.rs` |

### 8.2 未覆盖（不要当成结论）

- 未运行 jcode 任何二进制，未复现其 benchmark；其数字可能存在选择偏差（自测、特定硬件、`selfdev` = `opt-level 0`）。
- 未读 `tests/e2e/*`、`changelog/`（100 个文件）、`.github/workflows/*`（本次未检出）。
- 未评估其云端/移动端（`docs/CLOUD_*.md`、`docs/IOS_APP.md`）的实现质量。
