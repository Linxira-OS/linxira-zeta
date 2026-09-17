# Web-UI Modernization — Design Spec (v1.1.7)

Durable spec for the approved web-ui redesign (roadmap P0 delivery-order
step 6). This document is the source of truth for details; `roadmap.md`
carries only the schedule pointer. Amend sections in place — never rewrite
the whole document.

Status: plan approved 2026-08-29. Remaining steps (3-10) land on fresh
`feat/<scope>` branches off current `main`（OMP v18.1.10 / 1.1.9 基线），
per the feature-branch workflow.

## 0. Decisions (locked with user)

| Decision | Choice |
| --- | --- |
| 落地节奏 | 一次到位（单分支 `feat/web-ui-modern`，10 个按序提交，每步绿 tsc+lint） |
| Terminal PTY | 本期做（gateway node-pty + WS） |
| 主题系统 | 全套：40 预设 JSON + 自定义生成器（oklch），现三主题移植为 zeta-* |
| 设置页 | 窗口化 + 搜索（数据层零改动：gateway settings + web.yml） |
| 默认主题 | `zeta-dark`，首开即深色（themeMode 默认 'dark'，不跟随 system） |
| tracking.enabled | 默认 false → **true**（评审可否决） |

## 1. 布局（Codex/ZCode 桌面式三栏）

```
AppShell（重构为 layout/ 组合）
├─ Sidebar 左栏（完整参考 openchamber packages/ui/src/components/session/sidebar/）
│   ├─ SidebarHeader 快捷操作行：新建会话 / 搜索(展开+计数+Esc 提示) / 多选切换 /
│   │   排序显示下拉（manual|a-z|z-a|date-added|recent；by-worktree|flat；Recent 分区开关）
│   │   ── 头部红线（2026-09-02 用户决议，已落地 feat/web-ui-sidebar）：
│   │      头部不得存在批量删除/归档按钮；新建会话是唯一创建入口（整宽行）；
│   │      上游 omp-web 快照若带回该头部按钮，合并时恢复 Zeta 布局
│   ├─ SidebarProjectsList：项目行（可折叠、manual 排序可拖拽、折叠时聚合状态点
│   │   active=--accent-primary/unread=--status-info，1.5px 圆点非数字）
│   │   → worktree 子分组（git-branch 图标 + 分支副标题 + hover 删除）
│   │   → 会话组（今天/更早、Recent/Active-now 分区初始 7 条 + show more、
│   │     sticky 头 + 渐变 mask + IntersectionObserver sentinel）
│   ├─ 底部：模型/技能/插件/设置入口行（现有功能，换新组件）
│   └─ 数据源不变：/api/sessions、/api/worktrees、/api/agent/running/events
├─ 中央列
│   ├─ Header：会话标题+项目徽章 + surface tabs（sortable-tabs-strip：
│   │   Chat/Trajectory/Git/Diff/Files/Terminal/Stats，可拖拽排序持久化）
│   │   + 上下文计数圈 + 分支导航 + 主题/语言 + token/cost
│   └─ 内容区：activeSurface 切换（keep-alive：Diff/Terminal/Files 隐藏不卸载）
├─ ContextPanelRail（w-11 垂直图标列表，36px 按钮，active=text-primary）
│   tab：session 信息/files/tracking(notes)/plugins/diff/git；dnd-kit 垂直排序
│   持久化（useUIStore 等价物）；git tab 变更数徽标（>99 显示 99+）；Tooltip 朝左
└─ ContextPanel（MIN 380 / DEFAULT 600 / MAX 1400，按 tab 记忆宽度
    widthByMode；左缘 3px handle + ghost guide + 100ms 节流写 CSS 变量；
    header=SortableTabsStrip(file tabs) 或模式名；Esc 关闭，terminal 聚焦时放行）
```

### 上下文计数圈（右上角，点击开关 ContextPanel）

照搬 openchamber `components/ui/ContextUsageDisplay.tsx`：SVG 环
（viewBox 0 0 20 20、rotate-90、stroke 3、r 8.5、strokeDashoffset =
周长×(1-pct/100)、transition-[stroke-dashoffset,stroke] duration-300）；
环色 `>=80 --status-error / >=50 --status-warning / 其余 --status-success`；
数据用现有 `pi-types.ts` ContextUsage（totalTokens/percentage/contextLimit/
outputLimit/cost）；tooltip 四行明细；仅 totalTokens>0 且 chat tab 激活时渲染。

### 折叠红线（重构时原样保留，来自 ChatWindow 现状分析）

- `lib/message-display.ts` 的 `splitFinalAssistantBlocks`（text/image=最终答案）
  语义不变；
- 分组锚点 = user 消息 **或 compaction custom 消息**（`isGroupAnchor` 兜底不能丢）；
- `isLiveTail` 三条件（sessionBusy||isStreaming && 到列表尾部 && 最后锚点）流式不折叠；
- `ProcessDetailsGroup` 默认折叠 + 本地 state；过程块克隆 `omitUsage:true`；
  messageRefs 可见序号映射保留；
- `lib/trajectory.ts`、`useAgentSession`（2067 行数据层）不动。

## 2. 设计语言迁移（openchamber packages/ui → web-ui）

1. **Token 层**：`styles/design-system.css`（oklch 色板、radius、
   `--padding-scale` 密度缩放、玻璃拟态 oc-glass-*、z-layer token）+
   `styles/typography.css`（typography-ui-header/ui-label/meta/micro/
   settings-page-title 等语义类）→ `web-ui/styles/`；`app/globals.css` 重构为
   Tailwind v4 CSS-first（`@theme inline`），废除 1629 行硬编码三主题与内联样式堆叠。
2. **主题系统（全套）**：`types/theme.ts` + `lib/theme/themes/*.json`（40 预设
   全量：flexoki/gruvbox/catppuccin/tokyonight/nord/dracula…）+
   `lib/theme/cssGenerator.ts`（hex→oklch，764 行）+ `ThemeSystemContext`
   （剥离 desktop/VSCode/remote 分支）→ `web-ui/lib/theme/` + `components/theme/`。
   现有三主题移植为 `zeta-light.json`/`zeta-dark.json`/`zeta-starfield.json`；
   `DEFAULT_DARK_THEME_ID='zeta-dark'`、`DEFAULT_LIGHT_THEME_ID='zeta-light'`；
   themeMode 默认 'dark'。持久化新 localStorage 键（themeMode/lightThemeId/
   darkThemeId/密度/圆角/字体）；跨 tab storage 事件同步。
   **字体约束（roadmap 硬规则）**：默认系统 UI 栈 + CJK fallback（ui-sans-serif,
   system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI",
   "PingFang SC", "Noto Sans CJK SC", sans-serif）；openchamber 的远程字体加载
   （fontOptions CDN）必须剥离；可选字体仅限可再分发许可的本地打包。
3. **代码块配色**：主题 JSON `syntax.*` 十色 → cssGenerator 生成 `--syntax-*`
   → `markdownShikiThemeDefinition` 全部 tokenColors 引用 `var(--md-syntax-*)`
   （换主题零重排，worker 内 Shiki tokenize，行数上限 1200）+ 代码块 chrome
   （rounded-2xl 容器、语言标签、复制/换行按钮、flash check 2s）；替换
   react-syntax-highlighter；CodeMirror 用 HighlightStyle 引用主题变量。
4. **组件库**：`components/ui/` 子集（button/card/dialog/dropdown-menu/select/
   checkbox/switch/input/textarea/radio/collapsible/tooltip/scroll-area/
   command(cmdk)/sonner/skeleton/sortable-tabs-strip/overlay-scrollbar）；
   新依赖：@radix-ui/react-*、class-variance-authority、clsx、tailwind-merge、
   cmdk、sonner、motion、@dnd-kit/core+sortable、@tanstack/react-virtual、
   @pierre/diffs、xterm.js、@codemirror/*（版本对齐 openchamber bun.lock）。
5. **图标**：sprite 注入系统（components/icon/，RemixIcon 源）+ 800 文件类型
   图标资产；替换内联 SVG（保留 @lobehub/icons 仅 provider logo）。
6. **样式片段**：markdown 排版、滚动条、pill-tabs 指示条（cubic-bezier
   (0.22,1,0.36,1)）、容器查询渐进折叠、prefers-reduced-motion 降级、
   主题切换 .oc-theme-switching 防闪。

## 3. 视图与 API 对照（全部对接 Zeta gateway，连接层零迁移）

| 视图 | 实现 | API（✓现有 / ★新增） |
| --- | --- | --- |
| Chat | 现 ChatWindow 重排 | ✓ /api/agent/* SSE、/api/sessions/[id]/state |
| Trajectory | 现 TrajectoryView 重排 | ✓ entries 懒加载 |
| Git | 新 views/GitView（BranchSelector/ChangesPanel/CommitSection 形态） | ✓ /api/git/status、/api/git/diff |
| Diff | 新 views/DiffView，@pierre/diffs 渲染 | ✓ /api/git/diff + 工具结果 patch |
| Files | 新 views/FilesView + CM6 编辑器 | ✓ /api/fs/directories、/api/files/*；★ Next 侧 PUT /api/files（allow-list 内） |
| Terminal | 新 views/TerminalView（xterm.js） | ★ gateway PTY（§4） |
| Stats | StatsDashboard iframe 入 tab | ✓ :3847 |
| Tracking | TrackingPanel v2 入 ContextPanel notes tab | ✓ /api/tracking（升级，§5） |
| 命令面板 | cmdk：会话/文件//命令/设置项/模型切换 | ✓ 现有 API |
| Worktrees | 并入 Sidebar 项目区 + 新会话对话框 | ✓ /api/worktrees |

**明确不迁**（openchamber 连接层/无后端对应物）：sync/* 事件系统、
lib/opencode/* SDK、Express 后端、PermissionCard/QuestionCard（用我们
PlanApproval/ExtensionUI）、providers/agents/mcp/plugins 设置组（用我们
Models/Skills/Plugins 配置）、multirun、dictation/语音、relay 隧道、
remote-instances、scheduled-tasks、onboarding、PR/Walkthrough 视图、
update 流程（用我们 /api/update）。

## 4. Gateway 新增：终端 PTY WebSocket

- `packages/coding-agent/src/server/web-gateway/terminal.ts`：
  node-pty（N-API，Bun 可加载）会话管理 + `Bun.serve` websocket 升级
  `/api/terminal/ws`；127.0.0.1 绑定 + origin 校验 + remote token 鉴权；
  输出环形缓冲（重连重放最近 N KB）；resize/kill 消息协议；并发会话上限。
- 注册进 `web-gateway.ts` 路由表。
- `bun test` 三契约：鉴权拒绝 / 缓冲重放 / 会话回收。
- 前端 `lib/terminal-client.ts` + `hooks/useTerminal.ts`；
  `NEXT_PUBLIC_TERMINAL` 软开关（默认开，可关）。

## 5. Tracking v2（todo 绑定 + compaction 联动 + memory 互补）

**存储**：项目级 `<project>/.zeta/tracking/` 不变；全局索引
`~/.zeta/agent/tracking-index.json` 升级为对象数组
`{path,name,phase,progress,lastActiveSessionId,lastUpdated}`。

1. **结构化模板**：INDEX.md 固定模板（# Goal / # Architecture Key Points /
   # Key Decisions / # Current Phase / # Next Steps / # Open Questions），
   模板放 `src/prompts/tracking/index-template.md`（.md + handlebars，
   禁止代码内联 prompt）；`/tracking start` 与首次 tracking_update 自动落盘。
   status.json 增 `stage`（当前 todo phase 名）、`phases`（todo phases 镜像）、
   `lastSessionId`；新增 `summaries/compaction-<ts>.md`。
2. **Todo 绑定**：TodoTracker 已有 `phases` + `getCompletionTransitions`；
   TrackingTool 增 `sync_todo` 操作（phases 镜像写 status.json +
   actions.jsonl 记 phase_complete）；`plan-mode-approved.md` 追加
   "每完成一个 phase 必须调用 tracking_update"；TodoTracker mid-run nudge
   （12 次变更工具调用触发）在 phase 刚完成且 tracking.enabled 时插入
   tracking 提醒——make plan→do plan 循环按阶段定期总结落地。
   **prompt-cache 约束（roadmap P0）**：所有动态注入必须走 tracking 文档
   或既有 nudge 通道，保持 system prompt 字节稳定。
3. **Compaction 联动**：`session-maintenance.ts` `#commitCompactionEntry`
   后内部钩子 `TrackingRecorder.recordCompaction(compactionEntry)`
   （tracking.enabled 时）：从 CompactionEntry.summary（固定 section：
   Goal/Progress/Key Decisions/Next Steps）提取关键点写
   `summaries/compaction-<ts>.md`，并把 Progress/Next Steps 合并进
   INDEX.md + status.json——上下文压缩后长期记忆不丢。
4. **Memory 互补边界（roadmap P2 契约）**：tracking = 项目级工作状态
   （plan/progress/blockers/decisions），随项目走；memory = 跨项目学习事实
   （默认 off）。tracking 禁止存学习事实，跨引用按主题指向 memory。
   `/tracking start` 文案写明边界与 `tracking.enabled` 开关。
   修正 `docs/tools/tracking_update.md` "always available" 过期表述；
   重写 `docs/zeta-tracking.md` v2。
5. **Web UI**：`/api/tracking` 返回新结构（修掉现有 `.zeta` 重复 fallback
   bug）；TrackingPanel v2：概览(INDEX)/阶段(todo phases 进度条)/决策/
   日志(时间线)/压缩摘要列表。
6. **开关**：`tracking.enabled` 默认 false→true。
7. **Plan 落盘路由**：plan 文件默认留在产品自身 userdata 机制——`local://`
   解析到会话 artifacts 目录（`~/.zeta` 下会话目录/`local/<slug>-plan.md`），
   仓库之外，本次不改动该语义。`tracking.enabled` 时由 tracking 层把当前
   plan 镜像进 `<project>/.zeta/tracking/plans/<slug>-plan.md`（plan 批准时
   写入、phase 完成时刷新），INDEX.md 的 Current Phase 链接该文件；镜像只读
   plan 原文，不改写内容。禁止把 plan 默认写进仓库工作树。

## 6. 设置页（窗口化+搜索，数据层零改动）

- `components/settings/SettingsWindow.tsx` 替换 760px modal：页内搜索 +
  命中高亮 + 分组导航（openchamber SettingsWindow 形态）。
- 数据层原样：GET/PUT /api/settings（gateway 本地化 tabs + EDITABLE_TABS
  白名单）、/api/web-config、docs tab。
- appearance 组扩展：主题模式(默认 dark)/亮暗主题/密度/圆角/UI+等宽字体/
  代码块主题联动——读写 ThemeSystemContext 本地持久化，不碰 gateway。

## 7. i18n 与 CI

- 全部新文案进 `lib/i18n/messages/{en,zh-CN}.ts`（扁平 key + {param}），
  禁止硬编码字符串。
- 更新 `web-ui/AGENTS.md`（File Map 已过期：rpc-manager/app/api 家族
  早已归 gateway）+ 本文档状态。
- CI：新增 `web_ui_build` matrix job（ubuntu-22.04/windows-2022/macos-14，
  npm ci + build + tsc/lint 前置；无需 native_addons/bun-install）；
  顺带修 `check` job 重复两次的 collab:web:build 步骤。

## 8. 实施顺序（10 个提交，每步绿 tsc+lint）

1. 依赖 + Tailwind v4 CSS-first + token/typography + 图标 sprite（旧 UI 不破坏）✓ 已合并（8ba6971d27）
2. 主题系统（JSON 预设 + 生成器 + Provider + 选择器；zeta-* 三主题移植；首开 dark）✓ 已合并（8ba6971d27）
   · Sidebar 子集已先行落地（feat/web-ui-sidebar，2026-09-03）：头部红线执行、
     radix 显示设置下拉（排序/分组/Recent 开关，localStorage 持久化）、搜索切换
     （展开+计数+Esc）、整宽新会话行、项目折叠持久化（zeta-web:sidebar-collapsed-projects）
3. ui 原语子集替换高频内联样式
4. layout/ 三栏重构 + surface tabs + 计数圈 + ContextPanel/Rail（红线全保留）
5. Git/Diff/Files 视图 + CM6 + PUT /api/files
6. gateway PTY + TerminalView（软开关）+ 三契约测试
7. Tracking v2（模板/sync_todo/compaction 钩子/Next API 升级/面板/默认值/docs）
8. 命令面板 + 快捷键框架（Ctrl+K 面板、Ctrl+N 新会话、Ctrl+B 侧栏）
9. SettingsWindow + appearance 组
10. i18n 补全 + 文档 + 死代码清理

## 9. 验收

- 静态：web-ui tsc/lint；gateway bun check + PTY 三契约；
  `web_ui_build` 三平台绿。
- 功能冒烟（npm run dev + zeta serve 网关 30142）：会话/项目/worktree 分区、
  聊天收发 SSE、折叠行为、Trajectory、Git/Diff、文件浏览编辑保存、终端、
  Tracking 联动（todo 阶段 + compaction 自动摘要）、设置读写、主题/密度/
  圆角即时切换、首开深色 zeta-dark、代码块换主题零重排、中英双语。
- 视觉：主要页面 PNG 交 judge 评审通过后提 PR。

## 10. 修订记录

- 2026-08-29: 初版（从会话批准计划收拢全部细则；版本归属 v1.1.7）。
- 2026-08-29: §5 增第 7 条 Plan 落盘路由——plan 默认留 userdata（`local://`
  → 会话 artifacts 目录），tracking.enabled 时才镜像进
  `<project>/.zeta/tracking/plans/`，不写仓库工作树。
- 2026-09-03: §1 Sidebar 头部红线落地 + §8 步骤 1-2 合并标记（feat/web-ui-sidebar）。
