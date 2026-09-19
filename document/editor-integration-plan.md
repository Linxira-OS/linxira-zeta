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
## 追加拍板（2026-09-19，维护者确认）

- **目录命名**：不叫 `ttt/`（不可读）。定名 **`editor/`**（与 desktop/、web-ui/ 功能命名
  惯例一致）；上游可识别性由目录内 `editor/VENDOR.md` 承载（来源 repo、tag、SHA、
  修改层清单）。命名最终待维护者点头后执行。
- **版权人**：统一 **Linxira-OS（组织名）**，年份 2026，四处一致。
- **不向上游提 PR**：Phase 4 原"上游 PR 优先"策略作废。改动自维护，**贴上游结构、
  最小侵入**（薄 i18n 层、少 diff），方便 bump 同步上游新特性。
- **patch 范围两项**：①汉化（zh 词条）；②**去上游品牌标识**（TTT Editor 名称/logo
  替换为 zeta 系）。品牌 patch 清单执行时逐项登记进 VENDOR.md。
- **发布**：ttt **并入 Zeta 下一个 release（1.1.17）**，不拆开发布；三平台二进制作为
  release assets 分发，release 构建由 Zeta CI 承担。
- **CI 迁移范围**：只迁**测试侧**（build/test/lint/vet job）；发布相关构建归 Zeta release。
- **Go 环境**：优先系统全局 Go（1.25+）；无则项目局部临时工具链（如 `temp/go-sdk/`），
  **禁止装进全局目录/系统 PATH**。
- **README**：`editor/README.md` 顶部描述这是什么（zeta 终端 IDE 面、上游 TTT Editor
  衍生、本仓库修改层概述）；根 README 的目录表在 Phase 1 同 PR 内加一行。

## Phase 1 — vendor 快照进仓库（不带 git 历史）

- 分支：`feat/vendor-ttt`（离线分支规矩，不直接动 main）。
- 来源：`temp/ttt` **checkout 到上游 tag v1.5.0**（当前 HEAD 在 v1.5.0+ 少量提交，
  以 tag 为准并记录 peeled SHA 到账目）。
- 复制到顶层 **`editor/`**（与 desktop/、web-ui/ 平级；上游可识别性由 `editor/VENDOR.md`
  承载，见追加拍板段）。
  排除：`.git/`、本地构建残留（`ttt.exe`、`smoke*.png`、`pty*.png`、`.mimosa/`）、`gocache`。
  实测体积：工作树（排除上述）约 **30MB**——一次性 add 会生成大 pack（接近 50MB 红线），
  push 时按 staging 分段推送执行（playbook 既有做法）。
  新增目录内文件：`editor/VENDOR.md`（来源 repo/tag/peeled SHA/出局方案/修改层清单）
  与 `editor/README.md`（这是什么 + 修改层概述，见追加拍板段）；根 README 目录表加一行。
- 周边登记（同一 PR 内）：
  - `.gitignore`：加 editor 树内构建产物（`editor/ttt.exe`、`editor/ttt`）。
  - `about.toml` + `THIRD-PARTY-NOTICES.txt`：登记 TTT Editor（MIT、上游 repo、v1.5.0、SHA）。
  - `AGENTS.md`：新增 editor/ 段落（角色=编辑器面；构建=go build/Makefile；更新=vendor bump
    单 commit 流程；CI 钩子；品牌与 i18n patch 边界）。
  - `document/upstream-sync.md` 或独立 vendor 账目：记录来源 tag/SHA/出局方案/决策。
- 验收：`diff -r` 干净树 vs 上游 tag 零差异（除排除项与 VENDOR/README 两个新增文件）；
  五门禁不受影响（version-consistency / check:ts / brand-check / check:tools 变更文件
  ——Go 文件不在 oxfmt/oxlint glob 内，天然豁免；cargo 不涉及）。

## Phase 2 — CI 嵌入

- 根 `.github/workflows/ci.yml` 加独立 `editor` job（照 desktop job 模式先例）：
  - `runs-on: ubuntu-22.04`（GitHub 云，禁 omp-kata 类 label）；
  - `setup-go` + `go-version-file: editor/go.mod`（当前 1.25.0）；
  - `working-directory: editor` 执行 `make build test lint vet`（chaos/docker 与 vitest 二期）；
  - paths 过滤：ci.yml 既有过滤位（`web-ui/**` 旁，以内容锚定不写行号）加 `editor/**`，
    vendor bump 才触发，不挂 check 主链。
  - 迁移范围 = **测试侧**（build/test/lint/vet）；发布相关构建归 Zeta release（见下）。
  - **不进 release gate**：editor job 失败不挡发版，跑稳一两个 release 后再评估入列。
- OMP merge 验收清单追加一项：**editor job 与 `editor/**` paths 在 merge 后仍在**（workflow
  为历史损伤高发区，损伤类别 #7）。
- **release（tag run）三平台构建：升级为一期必做**——并入 Zeta 下一个 release（1.1.17），
  不再"随 zeta ide 分发立项"。ttt 三平台二进制（ttt-windows-x64 / ttt-linux-x64 /
  ttt-darwin-arm64 等，命名执行时定）作为 release assets 分发，与 Zeta CLI/desktop 产物
  同一 release、不拆开发布。

## Phase 3 — MIT 版权方补全（关键合规项）

原则：**只追加版权行，绝不改写/删除上游版权行**（MIT 保留义务 + AGENTS 品牌/上游规则）。

| 对象 | 现状 | 动作 |
|---|---|---|
| 根 `LICENSE`（zeta 主项目） | 三行版权人：Mario Zechner (2025)、Can Bölük (2025-2026)、Stencil Labs, Inc. (2026) | 追加一行新版权方（见下） |
| `web-ui/` | OMP Web 快照，LICENSE 版权人为上游 | 核查独立 LICENSE 文件后**追加**新版权方行 |
| `desktop/` | 同上（快照衍生） | 同上 |
| `editor/`（vendor） | eugenioenko 原 LICENSE | **原样保留不动**；目录内加 NOTICE 类文件声明修改层与来源 |

- 新版权方名称：**Linxira-OS（组织名，已拍板）**，年份 2026，四处统一。

- 同步核对 `about.toml` 的版权声明字段与各 `package.json` 的 `author`（如需）。

## Phase 4 — i18n 轻量层（en/zh 双语）

- **原则（已拍板）：不向上游提 PR；改动自维护、贴上游结构、最小侵入**——薄 patch 层，
  每处改动登记进 `editor/VENDOR.md` 修改层清单，bump 时 diff 对账，方便同步上游新特性。
- 蓝本：zeta CLI i18n（`packages/coding-agent/src/i18n/`：扁平 key + 每语言完整目录 +
  miss 回落 en + "只翻用户可见面，错误/日志保持英文"的边界哲学）。
- Go 化落点：`internal/i18n/` —— `en.go` / `zh.go` 两份 map + `T(key)` 查表（miss→en→key）。
  仅两语种，不引入框架。
- key 前缀：`menu.*` `cmd.*` `panel.*` `dialog.*` `status.*`。
- 语言选择：`settings.json` `general.language: "en"|"zh"`（执行前先查证 ttt 是否已有
  settings/config 基础设施——没有则先落最小配置层）+ 语言检测**双路径**：`LANG` 环境变量
  **及 Windows 系统 UI language 回退**（`golang.org/x/sys/windows`；ttt 主打 Windows，
  `LANG` 在 Windows 常为空，仅靠它会漏检）。
- 覆盖面（2026-09-19 实测）：menus.go 74 条 Label + commands/widgets 243 处
  Description/Title/Placeholder + 状态栏/对话框，合计约 400–600 条。
- **两项 patch 工作**：①汉化（zh 词条全集）；②**去上游品牌**——TTT Editor 名称/logo/
  关于页等品牌标识替换为 zeta 系，逐项登记进 `editor/VENDOR.md` 修改层清单。
- 文案统一：zh 词条以 zeta `i18n/zh.ts` 既有译法为基准（同一概念两边同文案，
  如 Terminal/终端、Changes/更改）。
- 远期联动：`zeta ide` spawn ttt 时注入语言设置，实现"一边切换、另一边自动跟随"。

## Phase 5+（占位，不在本计划范围）

`zeta ide` 子命令；EmbeddedTerminalComponent（pi-natives PTY + kitty-vt-wasm + gutter）；
`--listen` 通道对接 agent 工具层；品牌 overlay。

## 完成动作

Phase 1–4 全部落地且 **1.1.17 release 含 editor 三平台产物**并验收后：删除本文件；持久
结论（editor 目录规则、vendor 账目、i18n 与品牌 patch 约定、版权方登记）分别沉淀至
`AGENTS.md` / `document/upstream-sync.md` / `document/roadmap.md`。
