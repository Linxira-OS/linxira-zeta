# 极简化 UI 与 Plan/Tracking 呈现 — 执行梳理（2026-09-20）

> **状态盘点（2026-09-22）**：各节状态已就地标注（✅ 已落地 / ◐ 部分 /
> ❌ 未做）。A+B 级剩余项已由 feat/plan-surface-completion 落地
> （§11.1 全部完成，2026-09-22）；C 级大件（CM6/PTY/team agent/剩余
> skills/onboarding）另立后续计划（§11.2）。

状态：梳理定稿（方向经用户确认）。本文是接下来开发的执行清单来源；
`roadmap.md` 与 `web-ui-modernization.md` 的相应条目以本文为准收拢。
设计参考：temp/deepseek-harness 的 UI（**洁净室**——只学行为与美学，不复制代码/资产）。

## 0. 设计原则（locked）

1. **极简哲学**：主界面 = 一个对话框 + 左边一点内容。多余按钮全部砍掉；
   复杂度全部藏在后台/默认配置里——默认配置好，界面自然简洁。
2. **为什么**：界面东西多，用户用不懂、乱点还会点坏；简洁化本身就是产品力。
3. **设计美学对齐 dsh**：足够简单、标准圆角、标准方框、克制的设计美学。
4. **侧边栏功能（项目组、存储桶）不是砍掉，是梳理好做上**——功能在，
   视觉与交互负担归零。
5. **条件显示**：入口只在对应能力开启时出现（如 tracking 按钮只在
   `tracking.enabled` 时出现）。

## 1. 侧边栏与极简主界面（对齐 dsh 实测形态，2026-09-20 截图定稿）

> 状态（2026-09-22，plan-surface-completion 落地后）：§1.1 全部 ✅；
> §1.2 极简化 ✅（底部收敛/折叠 rail/双选择器/命令面板）；§1.3 ✅
> （/api/plan 端点 + 侧栏 Plan 卡 + tracking 条件入口）。

**目标形态（dsh 截图实测）**：主区域 = 纯对话框（居中 logo + 工作区选择器

- 模式选择器 + 大输入框 + 底行 [附件/语音/范围/模型/发送]），**无 tabs、
  无面板、无多余按钮**；左侧一列承载全部导航；其余一切藏进菜单与设置。

### 1.1 侧边栏功能对齐（此前"没开发完"的清单，全部落实）

| dsh 功能                             | Zeta 现状           | 落实                                               |
| ------------------------------------ | ------------------- | -------------------------------------------------- |
| 工作区树（工作区分组下挂会话）       | 项目组 + 存储桶已有 | ✅ 已落地（SidebarProjectsList worktree 分组）     |
| 会话/工作区行 hover `...` 菜单       | FloatingMenu 已有   | ✅ 已落地（行/项目双菜单）                         |
| 右键菜单：重命名 / **删除工作区**    | 部分有              | ✅ 已落地（rename/delete 接线）                    |
| 工作区行 `+` 快捷新建会话            | 无                  | ✅ 已落地                                          |
| 区头小图标组（搜索/筛选/新建工作区） | 搜索有、筛选/新建无 | ✅ 已落地（新建工作区本批补齐）                    |
| "新会话" 唯一大按钮                  | 已有                | ✅ 已落地（ze-btn-hero）                           |
| 底部唯一入口 = 设置                  | 底部有多入口        | ✅ 已落地（折叠为 rail 开关 + 设置）               |
| 折叠 rail（56px 图标列）             | 275px 固定折叠      | ✅ 已落地（桌面折叠态图标列，localStorage 持久化） |

裁决表（补充）：

| 块               | 裁决                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------- |
| HoverCard 预览卡 | 删除 — ✅ 已删（SessionHoverCard.tsx 及接线）                                             |
| BulkActionBar    | 仅多选时浮出 — ✅ 已落地（editMode 底栏形态）                                             |
| Pinned / Archive | 折叠为底部入口（设置旁）— ◐ 列表内折叠分区已落地；不强迁底部（2026-09-22 裁量，见 §11.2） |
| PathLabel        | 保留（弱化色）— ✅ 已落地；sidebar/PathLabel.tsx 死副本已删                               |

### 1.2 主界面极简化

> 状态（2026-09-22）：✅ —— 双选择器、命令面板 Ctrl+K、删常驻按钮已落地。

- 中央 = 欢迎态（logo + 产品名）+ 工作区/模式双选择器 + 大输入框 +
  底行工具组；会话进行中 = 对话流 + composer（现状保留）。
- **删除主区域一切常驻面板按钮**（模型/技能/插件/设置收进侧栏底部
  设置或命令面板）。
- 命令面板（Ctrl+K）承载全部低频能力——极简界面 + 完整能力不冲突。

### 1.3 新增两块（本轮重点）

> 状态（2026-09-22）：✅ —— GET /api/plan 白名单端点、侧栏 Plan 卡、
> tracking.enabled 条件入口均已落地。

- **Plan 区**：侧边栏显示 agent 的 plan（`local://` 会话工件路径解析；
  `tracking.enabled` 时镜像 tracking/plans/）。gateway 白名单读端点 +
  web markdown 渲染。
- **Tracking 入口（条件显示）**：仅 `tracking.enabled` 时出现。tracking
  文档三读者：人 / agent / 协作者。

### 1.4 dsh 行为迁移（洁净室）

> 状态（2026-09-22）：◐ —— 折叠 rail ✅；滚动条指针感知未排期（§11.2）。

- 滚动条指针感知（离开 ~2s 后隐藏）
- 折叠 rail 图标列
- 标准圆角/方框、克制色彩（zeta-* 主题 token）

### 1.5 远期路线：GPUI（Zed 团队 Rust UI 框架）

agent 本体已占大内存，web-ui 再占一份——**远期**考虑 GPUI 原生客户端
替换 web-ui（性能路线）。**执行纪律**：先把 web-ui 该做的做完（本计划），
GPUI 是 web-ui 收敛后的最后路线，不与当前开发并行。

## 2. Plan 生命周期 Web 呈现（本轮核心新增）

> 状态（2026-09-22）：✅（组合结构除外）—— 四按钮审阅面 ✅（web-ui/components/PlanApproval.tsx，
> preserve/compact/fresh/cancel 经 ChatWindow plan_approve 下发）；
> plan-ultra workflow 徽章 ✅；todo 经 get_state todos 暴露 ✅；
> 组合结构延后（无结构化子 plan 数据源，§11.2）。

CLI 的 plan 出口 prompt 已齐全：`plan-mode-approved.md`（含
`contextPreserved` 分支）、`plan-yolo-handoff.md`、
`plan-mode-compact-instructions.md`、`plan-mode-ultra-active.md`。
**Web 呈现层**：

- **审阅面**：plan-mode 下 agent 产出 plan 后，web 显示 plan 全文
  （markdown 渲染，来自 §1 的 plan 端点）+ 四个操作按钮：
   1. **当前对话直接开始**（不压缩，`contextPreserved` 路径）
   2. **新开会话开始**（yolo handoff / 新会话携带 plan 路径）
   3. **压缩当前上下文后开始**（compact-instructions 路径）
   4. **打回**（用户补充信息，agent 修订 plan）
- 按钮经 gateway 下发对应 CLI 动作（复用既有 slash/exitMode 路径，
  不新造协议）。
- **plan-ultra 识别**：`/plan-ultra` 产出为多个小 plan 组合的超长
  plan（组合复制体）。web 审阅面须识别 ultra 产物（workflow 标记），
  展示组合结构（子 plan 列表 → 合成大 plan），并提供与普通 plan
  相同的四按钮。存量行为是否"做对了"随本项一并核验。
- **todo 呈现**：执行期 `todo` 工具状态经 gateway 暴露（现有 SSE 流
  扩展或复用 tracking sync_todo），web 显示执行进度并与 plan 步骤
  对应（Tracking v2 §5 的 todo 绑定在此汇合）。

## 3. Tracking v2（与 web-ui-modernization §5 合流）

> 状态（2026-09-22）：✅ 核心 —— sync_todo、index-template 三读者模板、
> tracking-index 对象数组、status stage/phases/lastSessionId、plan 镜像、
> phase 完成 nudge 接线、todo gateway 暴露、docs v2、条件入口全部落地。
> tracking.enabled 默认仍为 false（opt-in 设计不变）。

- todo 绑定、compaction 自动摘要钩子、Next API 升级、面板——按
  web-ui-modernization §5 原设计执行。
- 本轮补充：**三读者定位**写进 tracking 模板（人 / agent / 协作者）；
  面板入口条件显示（§1）。

## 4. team agent（crew 底座，方向已定）

> 状态（2026-09-22）：◐ —— crew 底座 + 上游 0.15.2/1.1.2 同步 ✅（§5）；
> M0/M1/场景二/M2 ❌ C 级另立（§11.2）。

实现方向：**以 pi-messenger 的 crew 为底座**（3140 行 plan→work→review
DAG/审批/自主模式已在 `plugins/official/pi-messenger/crew/`），不自研
编排器。上游已同步 0.15.2。

- **M0 基建**：plugin-system manifest v2 `pages` 契约 + gateway
  `/api/plugin-assets` 静态资源路由（两者现不存在，前置中的前置）。
- **M1 team 面**：`team_*` 工具做成 `pi_messenger` action API 的 Zeta
  化薄封装（team_spawn/plan/dispatch/chat/status/cancel ↔
  join/plan/work/send/status/cancel）；crew 配置对齐规格的
  `teams/*.json` + `personas/*.md`（frontmatter `locked` 段）。
- **场景二（人设群聊）**：persona 锁定段字节级重放、发言限速、
  @提及路由——crew lobby/mesh 之上补 Zeta 语义。
- **M2 Web 三页面**：成员名册 / 消息流 / 任务看板（M0 pages 路由 iframe）。
- 远期学习项：dsh 的 **PTC 模式**（Code Mode SDK——模型写 TypeScript
  程序组合多步工具调用）。Zeta 暂无对应物；列为 P3 探索。

## 5. pi-messenger 上游同步（已完成 2026-09-20）

- fork 基点 0.15.1 → 上游 0.15.2（唯一修复：crew workers 保留扩展
  工具，去除 BUILTIN_TOOLS 白名单）；版本线 1.1.1 → 1.1.2。
- 后续每次同步核对上游 tags（当前节奏：小步补丁版）。

## 6. 编辑器三端矩阵与 `/api/open` 枢纽

> 状态（2026-09-22）：◐ —— CLI ttt ✅（zeta-editor 1.1.17 已发布，嵌套
> 布局修复生效）；CM6 ❌ C 级（§11.2）；`/api/open` ttt 探测一行小活未做
> （§11.3）。

| 面        | 编辑器                                             | 状态                                  |
| --------- | -------------------------------------------------- | ------------------------------------- |
| CLI / TUI | **ttt**（`ttt <file>[:line[:col]]`，OSC 8 已就绪） | `/api/open` 加探测即用                |
| Web UI    | **CodeMirror 6** Files/编辑器 tab                  | modernization 步骤 5 **提前为核心件** |
| 桌面      | 同一 web-ui（CM6 自动可用）+ 可选 spawn ttt.exe    | 跟随 Web                              |

统一枢纽：所有路径点击走 `/api/open`。Web/桌面默认开**内置 CM6 tab**；
外部编辑器（vscode/cursor/**ttt** 经 `zeta-editor` launcher）才 spawn。
ttt 无法 web 化（Go 全屏 TUI）——CM6 就是 web/桌面的编辑器本体。

CLI 侧联动：`EDITOR_CLIS` 加 ttt 探测（`ttt`/`zeta-editor` --version）、
`local://` 路径解析绝对路径后包 OSC 8、桌面内置终端链接点击走 desktop
open bridge 到 `/api/open editor:ttt`。

**定位**：agent 是产品本体且兼容任何模型/agent；web-ui 是 workbench；
desktop 是壳；编辑器 = ttt（终端）+ CM6（web/桌面）。

## 7. 上游合并边界（战略红线）

做了这轮，Zeta 在产品面上**分层独立**——不是整体脱离上游，而是三块
**天然不在 sync 树**的产品面自走 + sync 树内最小 hook 纪律：

### 7.1 天然独立面（零合并负担，放手做）

- **web-ui/**：frozen 独立快照（omp-web 已不是 merge 源）。极简化、CM6、
  plan 审阅面、tracking 面板全部在此——随便改。
- **plugins/official/**：Zeta 自有目录（pi-messenger fork、agent-team），
  上游无此结构。
- **editor/**：vendored TTT Editor + npm 分发，自有目录。

### 7.2 sync 树内的改动（唯一需要纪律的地方）

| 改动                                                      | 文件                                      | 冲突面           | 纪律                                               |
| --------------------------------------------------------- | ----------------------------------------- | ---------------- | -------------------------------------------------- |
| gateway 新端点（plan 白名单读、files PUT、plugin-assets） | `server/web-gateway/` **新 handler 模块** | 极小（新增文件） | 一端点一文件，路由注册只在 `web-gateway.ts` 加一行 |
| `/api/open` 编辑器表加 ttt                                | `open.ts` EDITOR_CLIS 加一行              | 一行             | 可接受                                             |
| hashline truncation-notice JS fallback                    | `packages/tui`（已合）                    | 小（additive）   | 上游改同文件时按"上游 wins + 重应用"               |
| worktree 预算测试双态断言                                 | test 契约                                 | 上游若改同测试   | 按合并契约规则逐文件 resolve                       |
| tracking 条件入口数据源                                   | gateway settings 只读投影（如有）         | 小               | 新文件优先                                         |

**硬规则**：产品逻辑永不写进 sync 树既有模块深处；需要 sync 树配合时，
以"新文件 + 既有文件一行注册"为上限。违反此条 = 合并债务。

### 7.3 守护

- merge-gate（增量合并规程）的**自有功能守护测试**扩容：plugin-assets
  路由、`/api/open` ttt、plan 白名单端点各加一条，上游合并后跑绿才算
  合并完成。
- `document/merge-playbook.md` 冲突决策表补记：web-gateway 注册行、
  open.ts、hashline fallback 为"Zeta surface 重应用"清单项。

## 8. 实施顺序

> 状态（2026-09-22）：步骤 1 大部落地（本批收尾）、3/4 本批、2/5 未动、
> 6 小活未动（§11.3）；每步独立分支 + 绿 CI 纪律继续有效。

1. 侧边栏极简化（§1 裁决表 + dsh 行为迁移）——web-ui 单线
2. **Files + CM6 编辑器**（modernization 步骤 5 提前——web/桌面编辑器地基）
3. Plan 白名单端点 + 审阅面四按钮 + plan-ultra 识别（§2，建在 CM6 之上）
4. Tracking 条件入口 + tracking v2 汇合（§3）
5. team agent M0（pages + plugin-assets）→ M1（team_* 薄封装）→ 场景二 → M2（§4）
6. `/api/open` ttt 探测 + `local://` OSC 8 链接化（§6，小活穿插）

## 附录 A — Web-UI 现代化细则（收编自 web-ui-modernization.md，2026-08-29 批准）

> 以下为已批准设计的**未完成部分**细则（原 §0–§7）。步骤 1–2 已合并
> （8ba6971d27 + feat/web-ui-sidebar）；§8 旧顺序作废，以本计划 §8 为准。
>
> 状态盘点（2026-09-22）：主题系统（43 预设 + cssGenerator +
> ThemeSystemProvider + bootstrap 防闪）、design-system/typography token 层、
> 侧边栏基础件族 ✅；Shiki 替换 / SettingsWindow 窗口化 / i18n 清欠 /
> web_ui_build CI 本批执行；CM6、PTY 终端、components/ui/ 组件库、sprite
> 全量替换、ContextUsageDisplay、GitView/DiffView、ContextPanelRail dnd-kit
> 改造 ❌ C 级另立（§11.2）。

## 0. Decisions (locked with user)

| Decision         | Choice                                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| 落地节奏         | 一次到位（单分支 `feat/web-ui-modern`，10 个按序提交，每步绿 tsc+lint） |
| Terminal PTY     | 本期做（gateway node-pty + WS）                                         |
| 主题系统         | 全套：40 预设 JSON + 自定义生成器（oklch），现三主题移植为 zeta-*       |
| 设置页           | 窗口化 + 搜索（数据层零改动：gateway settings + web.yml）               |
| 默认主题         | `zeta-dark`，首开即深色（themeMode 默认 'dark'，不跟随 system）         |
| tracking.enabled | 默认 false → **true**（评审可否决）                                     |

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
   新依赖：@radix-ui/react-_、class-variance-authority、clsx、tailwind-merge、
   cmdk、sonner、motion、@dnd-kit/core+sortable、@tanstack/react-virtual、
   @pierre/diffs、xterm.js、@codemirror/_（版本对齐 openchamber bun.lock）。
5. **图标**：sprite 注入系统（components/icon/，RemixIcon 源）+ 800 文件类型
   图标资产；替换内联 SVG（保留 @lobehub/icons 仅 provider logo）。
6. **样式片段**：markdown 排版、滚动条、pill-tabs 指示条（cubic-bezier
   (0.22,1,0.36,1)）、容器查询渐进折叠、prefers-reduced-motion 降级、
   主题切换 .oc-theme-switching 防闪。

## 3. 视图与 API 对照（全部对接 Zeta gateway，连接层零迁移）

| 视图       | 实现                                                               | API（✓现有 / ★新增）                                                           |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Chat       | 现 ChatWindow 重排                                                 | ✓ /api/agent/* SSE、/api/sessions/[id]/state                                   |
| Trajectory | 现 TrajectoryView 重排                                             | ✓ entries 懒加载                                                               |
| Git        | 新 views/GitView（BranchSelector/ChangesPanel/CommitSection 形态） | ✓ /api/git/status、/api/git/diff                                               |
| Diff       | 新 views/DiffView，@pierre/diffs 渲染                              | ✓ /api/git/diff + 工具结果 patch                                               |
| Files      | 新 views/FilesView + CM6 编辑器                                    | ✓ /api/fs/directories、/api/files/*；★ Next 侧 PUT /api/files（allow-list 内） |
| Terminal   | 新 views/TerminalView（xterm.js）                                  | ★ gateway PTY（§4）                                                            |
| Stats      | StatsDashboard iframe 入 tab                                       | ✓ :3847                                                                        |
| Tracking   | TrackingPanel v2 入 ContextPanel notes tab                         | ✓ /api/tracking（升级，§5）                                                    |
| 命令面板   | cmdk：会话/文件//命令/设置项/模型切换                              | ✓ 现有 API                                                                     |
| Worktrees  | 并入 Sidebar 项目区 + 新会话对话框                                 | ✓ /api/worktrees                                                               |

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

## 9. 修订记录

- 2026-09-20: 初版（用户方向确认：极简哲学、crew 底座、条件显示、
  plan 四按钮审阅面、plan-ultra web 识别）。
- 2026-09-20: §6 编辑器三端矩阵与 `/api/open` 枢纽；§7 上游合并边界
  （分层独立战略红线）；§8 实施顺序（CM6 提前）。收编
  web-ui-modernization.md 剩余细则为附录 A；editor-integration-plan.md
  已全部落地，按 planning discipline 删除。
- 2026-09-20: §1 重写——按 dsh 截图实测形态定稿（工作区树 + 行级
  `...`/`+` 菜单 + 右键重命名/删除工作区 + 区头图标组 + 底部设置唯一
  入口 + 主区纯对话框）；补记此前"没开发完"的侧边栏功能清单；§1.5
  GPUI 远期路线（web-ui 收敛后的最后路线）。
- 2026-09-22: 全文状态盘点（四路代码审计）；Pinned/Archive 裁量更新
  （保持列表内折叠分区，不强迁底部）；新增 §11 剩余工作清单
  （A+B 本批 / C 级另立 / 小活）；顺带修正两处笔误与重复修订条目。
- 2026-09-22: feat/plan-surface-completion 落地 §11.1 全部 A+B 级项
  （极简收尾、命令面板、Shiki、SettingsWindow、i18n 清欠、Tracking v2、
  plan 端点/Plan 卡/条件入口、web_ui_build CI）；状态标注刷新为终态。

## 10. 官方默认 Skills 套装 + 安装引导

> 状态（2026-09-22）：◐ —— §10.2 机制全链 ✅（`ZETA_OFFICIAL_SKILLS_EMBED`
> 打包内嵌 + 首启 seed + `zeta-official` provider，priority 10）；
> docx/pptx/xlsx/pdf 四 skill ✅；其余 7 个 ❌ C 级（§11.2）。
> §10.1 onboarding ❌ C 级（§11.2）。

### 10.1 安装引导（onboarding）

- 新用户安装后首次启动：二选一引导——**极简模式**（默认：主界面纯对话
  框 + 侧栏导航，多余入口全藏）/**工程模式**（全功能面：面板、批量操
  作、高级设置展开）。区别只在 UI 显示层（一个偏好标志驱动条件显示），
  引擎能力完全一致；随时可在设置切换。
- 不做 code 模式 / work 模式那类功能分叉——**同一引擎，两种皮**。

### 10.2 官方默认 skills 套装（提案清单）

机制：新增 bundled 官方 provider（发现根 `skills/official/`，打包内嵌
`PI_SKILLS_EMBED` 同款逻辑 + 首启 seed 到 `~/.zeta/agent/skills/`），
优先级与 managed 同层（用户/项目 authored skill 同名覆盖）。每个 skill =
`SKILL.md`（name/description/SOP）+ 可选 `scripts/`（文档类依赖
python-docx / python-pptx / openpyxl / pandoc，SKILL.md 内含安装指引）。

文档排版/办公（用户点名优先）：

| skill             | 覆盖                                                          |
| ----------------- | ------------------------------------------------------------- |
| `docx`            | Word 创建/改写/格式化：报告、公文、合同模板；样式/目录/页眉脚 |
| `pptx`            | PPT 创建与美化：版式、母版、图表、演讲者备注                  |
| `xlsx`            | Excel：公式、条件格式、透视、图表                             |
| `pdf`             | 生成/合并/拆分/表单填写/文本提取                              |
| `markdown-export` | MD → 带样式 HTML/PDF/Word 发布导出                            |

视觉/图表：

| skill      | 覆盖                                               |
| ---------- | -------------------------------------------------- |
| `charts`   | 出版级数据图（matplotlib/echarts 模板 + 配色规范） |
| `diagrams` | 架构图/流程图（mermaid/graphviz 美学规则）         |

内容/通用：

| skill              | 覆盖                                     |
| ------------------ | ---------------------------------------- |
| `doc-cleanup`      | 格式清理统一（标点/全半角/术语一致性）   |
| `translate-polish` | 翻译 + 润色工作流（术语表一致）          |
| `release-notes`    | 版本说明撰写（复用 Zeta changelog 规范） |
| `data-extract`     | 网页/PDF → 结构化表格（csv/json）        |

实施：每 skill 一个 PR（SKILL.md + 脚本 + 样例输出）。docx/pptx/xlsx/pdf
四个已落地（机制验证完成）；剩余 7 个按同机制批量补齐（§11.2）。

## 11. 剩余工作 — 本批与后续（2026-09-22 盘点收口）

### 11.1 本批执行（feat/plan-surface-completion，A+B 级）— ✅ 已全部落地（2026-09-22）

- **波 2 极简收尾** ✅：底部入口收敛为 rail 开关 + 设置唯一；HoverCard +
  PathLabel 死副本已删；区头新建工作区按钮；侧栏折叠 56px 图标列；
  欢迎态工作区/模式双选择器；顶栏重复 files 按钮已删。
- **波 3** ✅：命令面板 Ctrl+K（cmdk：动作 + 会话搜索）；Shiki 替换
  react-syntax-highlighter（纯 CSS 变量主题，切主题零重排）；SettingsWindow
  窗口化（搜索 + 高亮 + 分组导航 + appearance 组）；i18n 清欠
  （TrackingPanel/ChatInput/LanguagePicker/formatRelativeTime/SettingsPanel
  硬编码入 messages，en/zh 同步）。
- **波 4 Plan/Tracking** ✅：GET /api/plan 白名单端点；侧栏 Plan 卡；
  dock tracking 入口 tracking.enabled gating；Tracking v2（sync_todo、
  index-template.md、对象数组索引、stage/phases/lastSessionId、plan 镜像
  tracking/plans/、phase 完成 nudge、三读者模板、todos get_state 暴露、
  docs v2）。
- **波 5** ✅：react-syntax-highlighter 依赖移除；CI web_ui_build matrix
  job（ubuntu/macos 绿；windows-2022 暂缓——runner profile junction 触发
  Next 上游 compile 阶段 EPERM，见 ci.yml 注释，上游修复后补回）。
  （原列「修 check job 重复 collab:web:build」已不适用——该步骤现仅出现
  一次。）

### 11.2 C 级另立（不在本批）— 执行编排见 [plan-surface-c-track.md](./plan-surface-c-track.md)

- CM6 Files/编辑器 tab（附录 A §3 FilesView + Next PUT /api/files）。
- 终端 PTY WebSocket（附录 A §4 全链）。
- team agent M0（manifest v2 pages + /api/plugin-assets）→ M1（team_*
  薄封装 + teams/personas 配置）→ 场景二 → M2 三页面（§4）。
- 剩余 7 个官方 skills（markdown-export/charts/diagrams/doc-cleanup/
  translate-polish/release-notes/data-extract）。
- onboarding 双模式引导（§10.1）。
- plan-ultra 组合结构 web 展示（等 plan-ultra 产出结构化子 plan 数据源）。
- ContextUsageDisplay 计数圈、ContextPanelRail（dnd-kit 排序 + 变更数
  徽标）、GitView、DiffView（@pierre/diffs）、components/ui/ 组件库、
  sprite 图标全量替换。
- 滚动条指针感知（§1.4）。
- web-ui/AGENTS.md File Map 重写（§7；引用已删 rpc-manager/npx 等，
  缺 sidebar//icon/ 等 20+ 组件）。

### 11.3 小活（可穿插任意批次）

- `/api/open` EDITOR_CLIS 加 ttt/zeta-editor 探测（§6，约两行 + 契约测试）。
- `docs/` 中 tracking 文档之外残留 `.omp` 路径表述的巡检。
