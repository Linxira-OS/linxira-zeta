# 编辑器集成执行计划（ttt）

> 立项日期：2026-09-19。本文件是临时执行计划（非 roadmap）：**全部阶段落地后删除本文件**，
> 持久结论沉淀进 `AGENTS.md`（ttt 段落）与 `document/roadmap.md`。

## 背景与已定决策（不再复议）

- 选型：**ttt**（TTT Editor，Go，MIT，VS Code 级终端 IDE）。Windows 全链路已于 2026-09-19
  本地验证通过（`temp/ttt/ttt.exe` 构建零错误、headless 渲染冒烟、Ctrl+T 集成终端 ConPTY 正常）。
- 出局记录：fresh（GPL-2.0，臂长引用价值不足）；termide（MIT 但功能差一档：无多光标/插件）；
  subtree 全历史（ttt/.git 实测 57MB，超 squash-sync 50MB 红线）；submodule（树不可改、
  force-push 场景易碎）。
- 架构：zeta TUI 主进程 + ttt 为 PTY 子进程；`--listen`（POST /exec）作为程序化控制通道。
  ttt 无 agent 内核，与 zeta 零功能重叠（2026-09-19 源码查证：所有 "agent" 命中均为
  Magenta 颜色名误报，无 LLM/agent 代码）。

## Phase 1 — vendor 快照进仓库（不带 git 历史）

- 分支：`feat/vendor-ttt`（离线分支规矩，不直接动 main）。
- 来源：`temp/ttt` **checkout 到上游 tag v1.5.0**（当前 HEAD 在 v1.5.0+ 少量提交，
  以 tag 为准并记录 peeled SHA 到账目）。
- 复制到顶层 **`ttt/`**（与 desktop/、web-ui/ 平级；命名如需改在执行时定，不影响后续阶段）。
  排除：`.git/`、本地构建残留（`ttt.exe`、`smoke*.png`、`pty*.png`）、`gocache`。
- 周边登记（同一 PR 内）：
  - `.gitignore`：加 ttt 树内构建产物（`ttt/ttt.exe`、`ttt/ttt`）。
  - `about.toml` + `THIRD-PARTY-NOTICES.txt`：登记 TTT Editor（MIT、上游 repo、v1.5.0、SHA）。
  - `AGENTS.md`：新增 ttt/ 段落（角色=编辑器面；构建=go build/Makefile；更新=vendor bump
    单 commit 流程；CI 钩子；品牌与 i18n patch 边界）。
  - `document/upstream-sync.md` 或独立 vendor 账目：记录来源 tag/SHA/出局方案/决策。
- 验收：`diff -r` 干净树 vs 上游 tag 零差异（除排除项）；五门禁不受影响
  （version-consistency / check:ts / brand-check / biome 变更文件；cargo 不涉及）。

## Phase 2 — CI 嵌入

- 根 `.github/workflows/ci.yml` 加独立 `ttt` job（照 desktop job 模式，ci.yml:508 先例）：
  - `runs-on: ubuntu-22.04`（GitHub 云，禁 omp-kata 类 label）；
  - `setup-go` + `go-version-file: ttt/go.mod`（当前 1.25.0）；
  - `working-directory: ttt` 执行 `make build test lint vet`（chaos/docker 与 vitest 二期）；
  - paths 过滤：ci.yml 两处既有过滤位（第 9/40 行 `web-ui/**` 旁）加 `ttt/**`，
    vendor bump 才触发，不挂 check 主链。
- OMP merge 验收清单追加一项：**ttt job 与 `ttt/**` paths 在 merge 后仍在**（workflow 为
  历史损伤高发区，损伤类别 #7）。
- release（tag run）三平台构建与产物聚合：二期，随 `zeta ide` 分发立项。

## Phase 3 — MIT 版权方补全（关键合规项）

原则：**只追加版权行，绝不改写/删除上游版权行**（MIT 保留义务 + AGENTS 品牌/上游规则）。

| 对象 | 现状 | 动作 |
|---|---|---|
| 根 `LICENSE`（zeta 主项目） | 三行版权人：Mario Zechner (2025)、Can Bölük (2025-2026)、Stencil Labs, Inc. (2026) | 追加一行新版权方（见下） |
| `web-ui/` | OMP Web 快照，LICENSE 版权人为上游 | 核查独立 LICENSE 文件后**追加**新版权方行 |
| `desktop/` | 同上（快照衍生） | 同上 |
| `ttt/`（vendor） | eugenioenko 原 LICENSE | **原样保留不动**；目录内加 NOTICE 类文件声明修改层与来源 |

- 新版权方名称：默认 **Linxira-OS**（组织名）；执行时向维护者最终确认实体全称
  （组织名 / 公司名 / 个人名，三选一），四处统一使用同一名称与年份（2026）。
- 同步核对 `about.toml` 的版权声明字段与各 `package.json` 的 `author`（如需）。

## Phase 4 — i18n 轻量层（en/zh 双语）

- 蓝本：zeta CLI i18n（`packages/coding-agent/src/i18n/`：扁平 key + 每语言完整目录 +
  miss 回落 en + "只翻用户可见面，错误/日志保持英文"的边界哲学）。
- Go 化落点：`internal/i18n/` —— `en.go` / `zh.go` 两份 map + `T(key)` 查表（miss→en→key）。
  仅两语种，不引入框架。
- key 前缀：`menu.*` `cmd.*` `panel.*` `dialog.*` `status.*`。
- 语言选择：`settings.json` `general.language: "en"|"zh"` + `LANG` 环境检测（含 zh 自动中文）。
- 覆盖面（2026-09-19 实测）：menus.go 74 条 Label + commands/widgets 243 处
  Description/Title/Placeholder + 状态栏/对话框，合计约 400–600 条。
- **策略优先级：先向 ttt 上游提 PR**（作者活跃，8 个月合 622 PR；轻量 i18n 层符合其
  工程化路线）。上游接受 → 我们仅维护 `zh.go` 词条；拒绝 → 落回自维护结构 patch，
  bump 时 diff 对账。
- 文案统一：zh 词条以 zeta `i18n/zh.ts` 既有译法为基准（同一概念两边同文案，
  如 Terminal/终端、Changes/更改）。
- 远期联动：`zeta ide` spawn ttt 时注入语言设置，实现"一边切换、另一边自动跟随"。

## Phase 5+（占位，不在本计划范围）

`zeta ide` 子命令；EmbeddedTerminalComponent（pi-natives PTY + kitty-vt-wasm + gutter）；
`--listen` 通道对接 agent 工具层；品牌 overlay。

## 完成动作

Phase 1–4 全部落地并验收后：删除本文件；持久结论（ttt 目录规则、vendor 账目、i18n 约定、
版权方登记）分别沉淀至 `AGENTS.md` / `document/upstream-sync.md` / `document/roadmap.md`。
