# C 级执行计划 — plan-surface 后续批（2026-09-22）

> 状态：执行规格（待用户裁决顺序与两项 scope 裁决后生效）。
> 设计来源：[simplify-and-plan-surface.md](./simplify-and-plan-surface.md) §11.2、
> §4（team agent）、§10（skills/onboarding）、附录 A §3/§4。本文只做执行编排，
> 不复制设计；冲突时以 simplify-and-plan-surface.md 为准。
> 纪律：每批一个独立分支（`feat/c-track-<scope>`）+ 绿 CI 后合并；
> 批内文件域互不重叠时可并行派工。

## 批次总览与依赖

| 批  | 分支                                       | 内容                                                               | 依赖                        |
| --- | ------------------------------------------ | ------------------------------------------------------------------ | --------------------------- |
| 0   | `feat/c-track-cleanup`                     | 小活清欠（ttt 探测、AGENTS File Map、滚动条感知、windows CI 评估） | 无                          |
| 1   | `feat/c-track-ui-primitives`               | ui/ 基础件 + ContextUsageDisplay + ContextPanelRail 改造           | 无                          |
| 2   | `feat/c-track-git-diff`                    | GitView + DiffView                                                 | 批 1（rail tab 挂载）       |
| 3   | `feat/c-track-cm6`                         | CM6 Files/编辑器 tab + PUT /api/files                              | 批 1                        |
| 4   | `feat/c-track-pty`                         | 终端 PTY WebSocket + TerminalView                                  | 批 1                        |
| 5   | `feat/c-track-team-m0`                     | manifest v2 `pages` + `/api/plugin-assets`                         | 无                          |
| 6   | `feat/c-track-team-m1`                     | `team_*` 工具 + crews 配置                                         | 批 5                        |
| 7   | `feat/c-track-team-m2`                     | 场景二 + Web 三页面                                                | 批 6                        |
| 8   | `feat/c-track-skills-*`（每 skill 一分支） | 剩余 7 个官方 skills                                               | 无（机制已验证）            |
| 9   | `feat/c-track-onboarding`                  | uiMode 双模式引导                                                  | 批 1（appearance 组挂开关） |

批 0/1/5/8 无相互依赖，可最先并行；2/3/4 依赖批 1；5→6→7 串行。
**默认推进顺序：0 → 1 → {2 ∥ 3 ∥ 4} → 5 → 6 → 7 → 8（穿插）→ 9。**

## 批 0 — 小活清欠

1. `/api/open` ttt 探测：`packages/coding-agent/src/server/web-gateway/open.ts`
   `EDITOR_CLIS`(:39-45) 追加 `ttt` / `zeta-editor`（`--version` 探测同现有条目）；
   契约测试加一条（§7.3 守护扩容）。~2 行 + 测试。
2. `web-ui/AGENTS.md` File Map 重写：按现状列 app/api 实有路由（worktrees/
   tracking/home/git/status+diff/fs/directories/files/file-index/default-cwd/cwd）、
   lib/、components/（含 sidebar/ 9 文件、icon/、settings/）、hooks/、contexts/；
   CSS 变量章节更新为 design-system token 双轨（legacy --bg + 新 --surface/
   --md-syntax）。
3. 滚动条指针感知（§1.4）：全局滚动条 hover/scroll 显隐——`overflow` 容器加
   pointer-tracking class（进入 2s 内常显，离开淡出），尊重
   `prefers-reduced-motion`；作用于侧栏、chat、dock 三处容器。
4. web_ui_build windows-2022 恢复评估：跟踪 vercel/next.js#40760 家族上游修复，
   修复后 revert matrix 裁剪提交。

验收：`/api/open editor:ttt` 契约测试绿；File Map 与实际文件树一致（抽查）；
AGENTS.md File Map 章节无已删文件引用。

## 批 1 — 组件库地基 + 右栏改造

1. `components/ui/` 子集（按需，不为建而建）：tooltip、select、dialog、
   skeleton、scroll-area——优先包装既有直接引用的 radix 包；C 类视图
   （GitView/FilesView/TerminalView）统一从这里取件。
2. ContextUsageDisplay 计数圈（附录 A §1 规格照搬）：SVG 环
   viewBox 0 0 20 20、rotate-90、stroke 3、r 8.5、strokeDashoffset =
   周长×(1-pct/100)、transition 300ms；环色 `>=80 --status-error /
   > =50 --status-warning / 其余 --status-success`；数据 `pi-types.ts`
   > ContextUsage；tooltip 四行明细；仅 totalTokens>0 且 chat tab 激活时渲染；
   > 点击开关 dock session 窗。挂顶栏（替换现有 ctxStr 文本形态）。
3. ContextPanelRail 改造：现 40px 常驻 rail 升级——dnd-kit 垂直排序
   （顺序持久化 localStorage）、tab 前置图标 tooltip 朝左、git tab 变更数
   徽标（>99 显示 99+，数据 /api/git/status 轮询复用 FileExplorer 的节流）。

验收：计数圈随流式更新平滑；rail 拖拽排序刷新后保持；tsc/build/test 绿。

## 批 2 — GitView + DiffView

- `web-ui/views/GitView.tsx`：BranchSelector（/api/git/branches + checkout）、
  ChangesPanel（/api/git/status，复用 FileExplorer 的 gitStatusByPath 数据源）、
  CommitSection 形态按附录 A §3。
- `web-ui/views/DiffView.tsx`：@pierre/diffs 渲染 /api/git/diff 与工具结果
  patch（FileViewer 内部自研 diffLines 迁移到 @pierre，删自研实现）。
- 两者作为 rail tab 挂载（批 1 的排序容器内），keep-alive 隐藏不卸载。

验收：切换分支/查看 diff 全链可用；自研 diffLines 零残留引用。

## 批 3 — CM6 编辑器（§8 步骤 2，编辑器三端的 web/桌面本体）

1. Next `PUT /api/files`：现有 `app/api/files/[...path]/route.ts`（GET+POST
   upload 已有 allow-list + realpath 防 symlink）加 PUT——同 allow-list、
   写前再次 realpath 校验、返回新 mtime/size；契约测试覆盖 allow-list 外
   403 与 symlink 逃逸拒绝。
2. `web-ui/views/FilesView.tsx`：文件树复用 FileExplorer 数据链
   （/api/fs/directories + /api/files/*），节点点击 → 编辑 tab。
3. CM6 编辑器组件：@codemirror/* 22 包已在依赖（零引用现状）——
   basic-setup + 语言包按需动态 import + HighlightStyle 全部引用
   `var(--syntax-*)`/`var(--md-syntax-*)` 主题变量（切主题零重排，
   与 Shiki 同约定）；保存 Cmd/Ctrl+S → PUT；dirty 指示。
4. 编辑 tab 接入：FileViewer 加编辑态（source 态切换 editable）或独立
   EditorTab 挂 TabBar；Chat 不入 tab 维持现状；桌面端同源生效
   （CM6 是 web 侧能力，桌面嵌 web-ui 自动可用）。

验收：allow-list 内文件可编辑保存（E2E：改一行 → PUT → 重读一致）；
allow-list 外 403；语言高亮与主题联动；`npx tsc` 零引用债务清零
（@codemirror 从"零引用依赖"变为在用）。

## 批 4 — 终端 PTY（附录 A §4）

- gateway `server/web-gateway/terminal.ts`：node-pty（N-API，Bun 可加载）
  会话管理 + websocket 升级 `/api/terminal/ws`；127.0.0.1 绑定 + origin
  校验 + remote token 鉴权（复用 authorizedForAccess）；输出环形缓冲
  （重连重放最近 N KB，默认 64KB 可调）；resize/kill 消息协议；并发会话
  上限（默认 4）；注册进 `web-gateway.ts` 路由表（一行）。
- `bun test` 三契约：鉴权拒绝 / 缓冲重放 / 会话回收。
- 前端：`lib/terminal-client.ts` + `hooks/useTerminal.ts` +
  `views/TerminalView.tsx`（@xterm/xterm + addon-fit 已在依赖）；rail tab
  挂载；`NEXT_PUBLIC_TERMINAL` 软开关（默认开）。
- 会话 cwd 默认当前项目 cwd；会话回收兜底 30min 空闲。

验收：三契约绿；E2E 打开终端跑 `echo`/`exit`；重连重放；软开关关闭时
rail 无终端入口。

## 批 5 — team agent M0（前置中的前置）

- plugin-system manifest v2：`extensibility/plugins/types.ts` PluginManifest
  追加 `pages?: PluginPagesDeclaration`（路径 + 入口 + 标题白名单形状），
  loader 校验 + 透传。
- gateway `web-gateway/plugin-assets.ts`：静态资源路由，根 =
  已注册插件的声明目录（manifest pages 校验通过才可服务），禁止路径穿越；
  `web-gateway.ts` 一行注册（§7.2 纪律：新文件 + 一行注册）。
- 守护测试（§7.3）：plugin-assets 路由穿越拒绝 + manifest v2 校验两条进
  merge-gate 自有功能守护。

验收：pi-messenger 假 manifest（fixture）声明一个页面，gateway 可取其
静态资源；穿越用例 403。

## 批 6 — team agent M1

- `team_*` 工具集：`team_spawn/plan/dispatch/chat/status/cancel` ——
  `pi_messenger` action API（join/plan/work/send/status/cancel）的 Zeta 化
  薄封装（`plugins/official/pi-messenger` 1.1.2 crew 底座），不自研编排。
- crews 配置对齐规格：`teams/*.json` + `personas/*.md`（frontmatter
  `locked` 段）；发现根与 skill 同款（用户/项目两层）。
- 工具 prompt 进 `prompts/tools/`；`tracking.enabled` 时 spawn 记
  actions.jsonl（复用 v2 日志）。

验收：crew 从 teams/*.json 拉起 → plan → work → review 全链
（集成测试打真 crew worker）；`team_status` 反映 DAG 状态。

## 批 7 — 场景二（人设群聊）+ M2 三页面

- persona `locked` 段字节级重放、发言限速、@提及路由（crew lobby/mesh
  之上补 Zeta 语义）。
- M2 三页面：成员名册 / 消息流 / 任务看板——M0 pages 路由 iframe 进
  web-ui（页面本体在插件 assets，web-ui 只做壳与导航）。

验收：@提及路由命中预期 persona；限速生效；三页面在浏览器可用。

## 批 8 — 剩余 7 个官方 skills（每 skill 一 PR，可并行）

`markdown-export` / `charts` / `diagrams` / `doc-cleanup` /
`translate-polish` / `release-notes` / `data-extract`——每个 =
`skills/official/<name>/SKILL.md`（name/description/SOP）+ 可选 `scripts/`

- 样例输出；`ZETA_OFFICIAL_SKILLS_EMBED` 自动打包（机制已验证，无代码
  改动）；文档类依赖（python-docx/openpyxl/pandoc/echarts）在 SKILL.md 内
  给安装指引。规格详见 §10.2 表。

验收：每 skill 首启 seed 后 `/skills` 可见并可执行样例任务。

## 批 9 — onboarding 双模式（§10.1）

- 偏好标志 `uiMode: "minimal" | "engineering"`（settings + ThemeSystemContext
  本地持久化，appearance 组加切换）；minimal 隐藏批量操作/高级设置展开/
  编辑 tab 等工程面，engineering 全量；同一引擎，只动显示层。
- 首启引导：首次进入 web-ui 时一次性选择卡片（可跳过，默认 minimal）；
  不做 code/work 模式功能分叉。

验收：切换即时生效且跨会话持久；首启卡片仅出现一次。

## 两项 scope 裁决（待用户）

1. **sprite 图标全量替换**（附录 A §2.5，~800 内联 SVG）：改造量大、
   视觉收益密度低。建议降级为「新组件一律用 `components/icon/` sprite，
   存量内联 SVG 不迁移」，从 C 类移除全量替换项。
2. **PTC 模式**（§4 远期，Code Mode SDK）：维持 P3 探索，不进本计划。

## 明确不做（本计划边界外）

- GPUI 原生客户端（§1.5 远期，web-ui 收敛后最后路线）。
- plan-ultra 子 plan 组合结构（等 plan-ultra 产出结构化子 plan 数据源）。
- 多 chat tab / 分屏（roadmap P0 注记为独立设计）。

## 修订记录

- 2026-09-22: 初版（批次编排依据 simplify-and-plan-surface §11.2 +
  §8 顺序纪律；四路盘点结论作为现状基线）。
