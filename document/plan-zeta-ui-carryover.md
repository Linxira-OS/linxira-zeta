# Zeta 端 + UI 端接入调整 — 统一执行计划(2026-09-28)

> **取代** `plan-surface-c-track.md` 与 `simplify-and-plan-surface.md`
> (均已删;前者未完成范围全部收编进本计划,后者已完成项见「已落地不再重做」、
> 在途设计已内联各批)。UI 迁移路线与三约束的设计底稿:
> `temp/zcode-ui-research.md`(本地参考,不入库)。
>
> **分支策略(用户已裁决)**:直接在 `dev/main` 上按批推进,每批独立 commit
> 序列 + 全量门禁 + CI 绿后进下一批;不另开 feat 分支。批间不并行。

## 硬约束(全程有效)

1. **渐进迁移**:现有桌面状态不做一次性替换;每批改一个区域,可独立回退。
2. **精简模式保留并收尾**:精简模式是自研面(ZCode 无对应物),迁移只动
   完整模式表现层;精简模式现状未收尾,单列专项批(见批 T)。
3. **复用现有元件为基**:布局参考只决定"现有元件摆哪里、哪些新做";
   样式走 Zeta theme token,数据走 `/api/*` gateway,品牌 ζ。

## 已落地不再重做(核实于 2026-09-28)

- `--mode json` NDJSON 事件流(`flag-tables.ts:123` + `print-mode.ts`);
- `--append-system-prompt`(`flag-tables.ts:172`);
- crew 底座插件 `plugins/official/pi-messenger/`(crew/agents/handlers 完整);
- `skills/official/` 首批 4 个(docx/pdf/pptx/xlsx)+ official-skills 内嵌/
  seed/覆盖链路;`skills.enableOfficial` 开关。

## 批次总览(默认顺序;Z 系 = Zeta 端,U 系 = UI 端,同批 = 两端配套)

| 批 | 端 | 内容 | 备注 |
|---|---|---|---|
| U1 | UI | 工具调用渲染器注册表 + ToolLayout | 研究报告批 1 |
| U2 | UI | 中文排版增强 | ✅ 已落地(9e7c4e4251f) |
| U3 | UI | 输入区工具条(context 用量 + thinking 级别) | 研究报告批 4;精简模式隐藏 toolbar |
| U4 | UI | 侧栏分组 + 未读 + footer 徽章 | 研究报告批 3 |
| U5 | UI | 聊天流原子化(先 code/confirmation/attachments) | 研究报告批 2 |
| U6 | UI | 统一 SidePane tab 框架(整合 DocsPanel/TrajectoryInspector) | 研究报告批 5 |
| U7 | UI | 启动门控收口(AppShell) | 研究报告批 6 |
| Z1 | Zeta | `PUT /api/files`(allow-list + realpath 校验 + 契约测试) | U8 前置 |
| U8 | UI | CM6 编辑器 + FilesView + 编辑 tab | 原 C-track 批 3 |
| Z2 | Zeta | PTY websocket `/api/terminal/ws`(node-pty + 环形缓冲 + 鉴权) | U9 前置 |
| U9 | UI | TerminalView(xterm)+ rail 挂载 | 原 C-track 批 4 |
| U10 | UI | GitView + DiffView(@pierre/diffs,删自研 diffLines) | 原 C-track 批 2;/api/git/* 已有,纯 UI 批 |
| T | 两端 | **精简模式收尾专项**:盘点现状 → 补齐 → 与完整模式共存验证 | 见下文专项节 |
| Z3 | Zeta | C-track 批 0 小活清欠(ttt 探测 2 行 + 测试;File Map 重写) | 穿插任意批后 |
| Z4 | Zeta | team M0 收尾:getPiCommand→zeta、manifest v2 pages、plugin-assets 路由 + 穿越拒绝测试 | 原 C-track 批 5 残留 |
| Z5+U11 | 两端 | team M1/M2:`team_*` 工具、`team.enabled`(默认 false)、M2 三页面 | 原 C-track 批 6/7;默认关闭不阻塞任何批 |
| Z6 | Zeta | 批 8:剩余 7 个官方 skills(markdown-export/charts/diagrams/doc-cleanup/translate-polish/release-notes/data-extract) | 纯加文件,穿插 |

**原批 9(uiMode 双模式引导)砍除**:引导层由 U7 启动门控统一处理,
双模式入口归精简模式专项 T;不再单独立批。

## 批次要点(决策完备,执行者自上而下无需再决策)

### U1 工具渲染器注册表(参考 ZCode `ToolCallBlocks/`)
- 新建 `web-ui/components/tool-renderers/`:`ToolLayout.tsx`(统一 summary/body
  骨架)+ `renderers/`(每工具一文件)+ `resolveRenderer.ts`(工具名 → renderer,
  未命中回落通用 Markdown)。
- 接入:`MessageView.tsx` 的工具结果分支改为 `resolveRenderer(toolName)` 调用;
  首批只接 `bash`/`read`/`edit`/`grep`/`glob`/`find` 六类,其余走回落。
- 精简模式:同一渲染器,精简态只渲染 summary 行(layout 参数 `compact`)。

### U3 输入区工具条
- `web-ui/components/ChatInput.tsx` 上沿加单行 toolbar:左 = context 用量
  计数圈(附录 A §1 规格:SVG viewBox 0 0 20 20、r 8.5、stroke 3、
  strokeDashoffset = 周长×(1-pct/100)、环色 80/50 阈值取 `--status-*`);
  右 = thinking 级别循环键。
- 数据:`/api` 既有 context usage 源(pi-types `ContextUsage`),无新 gateway。
- 精简模式:toolbar 整行不渲染。

### U4 侧栏分组(参考 ZCode `WorkspaceSidebar.tsx` 的 section 结构)
- `SessionSidebar.tsx` 内部分组:置顶(pinned)/今天/更早/归档,折叠态持久化
  localStorage;item 行新增未读点;底部 footer 一行用量徽章(复用 U3 数据源)。
- 不引入 dnd(研究批 3 的排序需求推迟到 SidePane 批一起评估)。

### U5 聊天流原子化
- 从 `MessageView.tsx` 拆 `components/chat/`:`CodeBlock.tsx`、
  `Confirmation.tsx`、`Attachments.tsx` 三件先行(参考 ZCode
  `ai-elements/{code-block,confirmation,attachments}.tsx` 的**结构**,
  样式走自家 token);MessageView 保留编排壳。
- 验收:三组件被 MessageView 与 TrajectoryInspector 双方复用,零循环引用。

### U6 SidePane 框架(参考 ZCode `app-shell/SidePaneTabTrigger.tsx`)
- 新容器 `components/side-pane/`(tab 触发器 + 面板宿主,keep-alive),
  DocsPanel/TrajectoryInspector 迁入为两个 tab;不再各自挂浮层。

### U7 启动门控收口(参考 ZCode `lib/rootStartupGate.js`)
- `AppShell.tsx` 的启动顺序判断(会话恢复、provider 状态、首帧 loading)
  提取为 `lib/startup-gate.ts` 纯函数 + 单测;AppShell 只消费布尔结果。

### Z1+U8 CM6 编辑器(原 C-track 批 3,规格不变)
- Zeta 端:`app/api/files/[...path]/route.ts` 加 `PUT`——同 GET/POST 的
  allow-list + 写前 realpath 校验,返回新 mtime/size;契约测试:allow-list
  外 403、symlink 逃逸拒绝、写后重读一致。
- UI 端:`views/FilesView.tsx`(文件树复用 FileExplorer 数据链)+
  `components/editor/Cm6Editor.tsx`(basic-setup,语言包动态 import,
  HighlightStyle 全部引用 `--syntax-*`/`--md-syntax-*`;Cmd/Ctrl+S → PUT;
  dirty 指示);编辑 tab 挂 TabBar。
- **精简模式**:FilesView/编辑 tab 在精简态隐藏入口(完整模式专属)。

### Z2+U9 终端 PTY(原 C-track 批 4,规格不变)
- Zeta 端:`server/web-gateway/terminal.ts`:node-pty 会话管理 + ws 升级
  `/api/terminal/ws`;127.0.0.1 + origin 校验 + authorizedForAccess;64KB
  环形缓冲重放;resize/kill 协议;并发上限 4;`web-gateway.ts` 一行注册。
- 契约测试三条:鉴权拒绝/缓冲重放/会话回收。
- UI 端:`lib/terminal-client.ts` + `hooks/useTerminal.ts` +
  `views/TerminalView.tsx`(@xterm/xterm + addon-fit);`NEXT_PUBLIC_TERMINAL`
  软开关默认开;**精简模式无终端入口**。

### U10 GitView + DiffView(原 C-track 批 2)
- `views/GitView.tsx`(BranchSelector + ChangesPanel + CommitSection,
  数据源 `/api/git/{branches,status,diff}` 全部现成);
  `views/DiffView.tsx` 用 @pierre/diffs 渲染,`FileViewer.tsx` 内自研
  diffLines 删除,零残留引用;两视图挂 U6 的 rail tab。

### T 精简模式收尾专项(自研,无参考)
1. **盘点**(本批第一步,产出写回本节):枚举精简模式现有面(入口、布局、
   隐藏清单)与极简化计划的 ✅/◐/❌ 差集(设计要点已由本计划各批内联),
   列出未完成项。
2. 收尾原则:精简态 = 完整态的子集(同一组件树 + `compact` layout 参数),
   不允许出现"精简独有组件";每个 U 系批落地时同步声明精简态行为
   (默认:toolbar/FilesView/终端/GitView 入口隐藏,聊天流与侧栏保留)。
3. 验收:完整/精简双态各跑一遍 U 系全部批的验收项。

### Z3 小活清欠(原 C-track 批 0)
- `server/web-gateway/open.ts` `EDITOR_CLIS` 追加 `ttt`/`zeta-editor` + 契约
  测试一条;`web-ui/AGENTS.md` File Map 按现状重写(U 批动过的目录一并覆盖);
  windows-2022 构建评估:跟踪 next.js 上游修复,可修则恢复 matrix。
- 滚动条指针感知移入 U6(同属容器改造,不单列)。

### Z4 team M0 收尾(原 C-track 批 5 残留)
- `plugins/official/pi-messenger/crew/agents.ts` `getPiCommand()` 返回
  `zeta`/`zeta.cmd`(一行);`extensibility/plugins/types.ts` PluginManifest
  加 `pages?: PluginPagesDeclaration` + loader 校验;新增
  `server/web-gateway/plugin-assets.ts`(静态资源路由,根 = 校验通过的
  插件声明目录,拒绝穿越)+ `web-gateway.ts` 一行注册;穿越 403 测试。

### Z5+U11 team M1/M2(原 C-track 批 6/7,契约内联如下,默认关闭)

- **M1(Zeta 端)**:`team_spawn/plan/dispatch/chat/status/cancel` 六工具 =
  pi_messenger action API(join/plan/work/send/status/cancel)的 Zeta 化薄
  封装(crew 底座,不自研编排);crews 配置 `teams/*.json` +
  `personas/*.md`(frontmatter `locked` 段),发现根与 skill 同款(用户/
  项目两层);工具 prompt 进 `prompts/tools/`;`tracking.enabled` 时 spawn
  记 actions.jsonl(复用 v2 日志)。
- **M2(UI 端)**:persona `locked` 段字节级重放、发言限速、@提及路由
  (crew lobby/mesh 之上补 Zeta 语义);成员名册/消息流/任务看板三页面,
  经 Z4 的 plugin-assets 路由 iframe 进 web-ui(web-ui 只做壳与导航)。
- **门禁**:`team.enabled` settings 项(默认 **false**)gating 全部
  `team_*` 工具注册、crew 自动拉起与 M2 入口;关闭时编排层零行为差异。
- **验收**:crew 从 teams/*.json 拉起 → plan → work → review 全链(集成
  测试打真 crew worker);`team_status` 反映 DAG 状态;@提及命中预期
  persona;限速生效;三页面浏览器可用。

### Z6 官方 skills 批 8(纯加文件)
- 7 个 `skills/official/<name>/SKILL.md`(+可选 scripts/),构建内嵌链路
  已核实零操作;每 skill 独立 commit,验收 = bundle 后 embed 含新条目。

## 门禁与节奏

- 每批 push 前:根门禁五件套(check-version-consistency / check:ts /
  brand-check / zeta-sentinels / 相关套件本地绿)+ `web-ui` 侧
  `tsc --noEmit` + `npm run lint` + 既有 `*.test.mjs`。
- web-ui 无自动化覆盖的视图批(U4/U6/U8-U10):每批附手工验收清单
  (浏览器 + 桌面壳各一遍,双主题 + 中英文)。
- CI 全绿才算批完成;不带断点进下一批。

## 与既有文档的关系

- 取代并删除 `plan-surface-c-track.md` 与 `simplify-and-plan-surface.md`
  (文档规范:旧计划随新计划生效即删;后期规划进 roadmap,架构设计单独成文)。
- `temp/zcode-ui-research.md` 是 UI 参考底稿(不入库,路径仅本地有效);
  其批号与本计划 U 系的映射已写进上表备注。
