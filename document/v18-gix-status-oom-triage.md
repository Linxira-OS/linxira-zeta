# v18 终端崩溃（out of memory / 页面文件太小）排查总结

- **日期**：2026-09-03（同日两次更新：上午初判，下午据事件日志修正归因）
- **状态**：机制已确证；上游修复已随 v18.1.1 发出、本机 18.1.5 已含但未经验证；zeta 待 sync
- **影响面**：OMP 18.0.x（Windows）确证崩溃；zeta ≥ v1.1.6 代码路径相同
- **结论一句话**：omp/zeta 的 bun.exe 进程在 Windows 上把提交内存吃到 64–72 GB 打穿 commit limit，pi-natives 内部线程（gix/tokio/brush）spawn 失败 panic 1455 直接杀死进程——所以终端里"软件直接不见了"。gix panic 是受害者不是元凶；囤内存的子系统在 18.0.x 上首要嫌疑是 gix status 尖峰（上游 #10247 同类实测 148 GB），终端相关性尚不能归因。

## 1. 现象

单一主代理会话（无子代理参与），长时间运行后进程消失或报错：

1. `out of memory`（Bun/JSC RangeError）
2. 「页面文件太小，无法完成操作」（Windows os error 1455 / ERROR_COMMITMENT_LIMIT——是"页面文件太小"，不是"内容太大"）
3. 更多时候无任何报错，**整个进程直接消失**（native panic abort，无遗言）

终端相关性（用户观察）：PowerShell / Windows 自带终端不易复现；**第三方终端管理器（本机为 Tabby）及其内嵌终端高频复现**。

## 2. 证据链（本机，2026-09-03）

### 崩溃残留（~/.omp/logs/native-panic-*.log，28 个文件）

| 线程 | 位置 | 消息 |
|---|---|---|
| `gix_status::index_as_worktree` / `gix::status::index_worktree::producer`（24 个） | `gix-features-0.48.1/src/parallel/in_parallel.rs:83:22` | 1455 页面文件太小 |
| `tokio-rt-worker`（3 个） | `tokio-1.53.1/src/fs/file.rs:1076`、`brush-core/src/commands.rs:469` | `OS can't spawn worker thread: 1455` |
| xargs（1 个，无关） | `pi-builtins/src/xargs.rs:379` | index out of bounds |

关键点：三种完全不同的线程在同一天因同一个 1455 死亡——**panic 线程身份是随机的"第一受害者"，证明是全局提交内存耗尽，而非单一模块缺陷**。

### 资源耗尽检测器（系统事件日志，Event ID 2004，资源耗尽检测器，今天 6 条）

| 时间 | 进程 | 提交内存 |
|---|---|---|
| 10:02 | **bun.exe (42068)** | **72.4 GB** |
| 10:36 | bun.exe (15676) | 68.3 GB |
| 11:06 / 11:19 / 11:23 | bun.exe (8984) | 67.4 / 65.3 / 64.0 GB |
| 11:31 | bun.exe (41988) | 66.2 GB |

- PIDs 与 native-panic 日志、当天 omp 日志一一对应
- **Tabby.exe 出现在全部 6 条事件中，稳定 ~1.0–1.1 GB**——不是吃内存者，但是崩溃会话的承载环境
- 机器 31.4 GB 物理 RAM；提交上限随 pagefile 动态扩张，bun.exe 一路吃到 64–72 GB 才打穿——**加大 pagefile 只会推迟崩溃，不是修复**

### 版本时间线（决定性）

- 崩溃会话（09:24 / 11:00 / 11:27 启动）运行的是 **npm 全局 OMP 18.0.x**（该目录 Aug 27 建立，早于 v18.1.x 发布）
- **今天 11:36 升级到 18.1.5**（最后一次崩溃 11:31 之后 5 分钟，应为崩溃后升级）
- 即：所有已观察到的崩溃都发生在**不含修复**的版本上；含修复的 18.1.5 尚无验证期

## 3. 根因分析

```
bun.exe（omp/zeta 主进程）提交内存持续增长，最终 64–72 GB
  → 打穿 commit limit（RAM + 动态 pagefile）
  → 进程内所有新线程分配/新进程 spawn 全部失败（os error 1455）
  → 谁先分配谁 panic：gix 线程 / tokio 工作线程 / brush shell spawn
  → pi-natives 写 native-panic 报告 → 进程终止（终端里表现为直接消失）
  → 若打穿前是 JSC 先分配失败 → Bun 报 out of memory（同一事件的不同面孔）
```

**囤内存的子系统（未最终定罪，两个嫌疑）**：

1. **gix status 尖峰**（18.0.x 主路径即 gix）——上游 #10247 实测同类场景 omp.exe 提交飙至 ~148 GB，量级与本机 64–72 GB 吻合。上游修复 c901f632fa 已把 status 主路径改为 git CLI 有界流式 + gix 降为 git 缺失时的 fallback。
2. **TUI 渲染/回放路径**——与"第三方终端崩、原生终端不崩"的观察方向一致（慢消费背压、resize 触发全量 re-fit、transcript 渲染缓存滞留 #4820）。注意 #4820 的修复（farm f6a646d305）至今未合入上游 main。stdout backlog 已有界（91bac496cc，v17.2 前已入主线，18.0.x 已含）。

**终端相关性（Tabby 崩 / PowerShell-WT 不崩）尚未归因**：Tabby 自身内存稳定（~1 GB），非元凶；可能是渲染路径贡献，也可能只是长会话恰好都开在 Tabby 里（使用偏差）。判定方法见 §6。

## 4. 上游动态（截至 2026-09-03）

| Issue | 内容 | 状态 |
|---|---|---|
| #10102 | gix index_worktree 1455 panic + ~20 GB | open，wontfix 标签 |
| #10247 | gix status 致提交内存飙至 ~148 GB | open |
| #10330 | 「进程崩溃退出」（1455 + native panic） | open（dup of #10102） |
| #8324 | Windows 并发工具运行耗尽 commit | open |

**修复发布线**：`c901f632fa`（status 走 git CLI 有界流式 + VCS 操作 catch_panic + gix 仅作 fallback）
- **已包含在 v18.1.1**（v18.1.0 打 tag 比该提交早 2 小时，未含）
- 本机 18.1.5 ⊇ 18.1.1 ⊇ c901f632fa
- 局限：catch_panic 只包 VCS 操作；tokio/brush 等非 VCS 线程的 1455 panic 不在其防护范围内，且它治的是"panic 杀进程"，不治"内存被囤积"本身

## 5. zeta 影响面

- zeta main（v18.0.11 基线，版本线 1.1.7）：带 `gix-features 0.48.1` + `crates/pi-vcs/src/git/read.rs`，**status 主路径仍为 gix**，无 c901f632fa
- 解决点：下次 OMP release sync，所选 tag 必须 ⊇ v18.1.1（含 c901f632fa）
- sync 前本机 18.1.5 的表现是最便宜的验证信号（见 §6）

## 6. 观察与判定计划（不做代码改动）

1. **主实验**：18.1.5 在 Tabby 里跑同样的长会话/大 worktree 工作，`Get-Process bun` 周期性看提交内存——
   - 稳在 ~1 GB 量级 → 元凶是 gix status，c901f632fa 有效，zeta 下次 sync 即解
   - 仍涨向几十 GB → 囤内存者在 TUI/会话层且终端相关，追 #4820 类渲染滞留（farm 修复未合并），并回头查本机 Tabby 特有路径
2. **事件日志复查**：后续再出现 Event ID 2004 即直接定罪（看 PIDs 与当时版本）
3. **临时缓解**（不等验证）：控制单会话时长（长会话定期重开）；避免在构建/批量文件变动期间持有大 worktree 会话；pagefile 扩容仅作缓冲
4. 崩溃后先查 `~/.omp/logs/` / `~/.zeta/logs/` 的 `native-panic-*.log` + 事件日志 2004，不需要从渲染层盲目排查

## 7. 关键引用

- 上游引入：`2a7db5855d` pi-vcs crate（2026-08-28，随 v18.0.10 发布）
- 上游修复：`c901f632fa`（2026-09-01，**随 v18.1.1 发布**）
- 上游 issues：#10102 / #10247 / #10330 / #8324；#4820（transcript 渲染滞留，farm 修复 f6a646d305 未合并）
- 本地证据：`~/.omp/logs/native-panic-*.log`（28 个）；系统事件日志 Resource-Exhaustion-Detector ID 2004（2026-09-03 六条）
- 本机环境：OMP 18.1.5（npm 全局，2026-09-03 11:36 升级）；Tabby 为常用第三方终端管理器
