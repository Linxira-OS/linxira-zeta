# Web UI 左栏 + 桌面大修执行计划(下一次发布前的硬性门)

> 状态:生效执行计划。分支:**`feat/webui-sidebar-overhaul`**(自 `main` 切出,
> 按 AGENTS.md Feature Branch Workflow:本地完成 → merge main → 本地门禁 →
> push → PR → CI 绿 → 合并)。
>
> **发布门(用户裁决,硬性)**:下一次 release CI 之前必须完成本计划全部批次,
> 否则绝不许上线。本门优先于任何其他发布计划。
>
> **与 `plan-zeta-ui-carryover.md` 的关系**:该文(2026-09-28,`dev/main` 批次
> 计划)中涉及 web-ui 左栏/侧栏的批次自本计划生效起以本文为准。按 `document/`
> 内部规范「新计划生效即删旧计划、一律不并存」,实施者开工前须由维护者裁断
> 旧计划的去留(将被取代的批次合并进本文或删除该文)。本次调查为只读,未
> 改动旧文件。

---

## 1. 目标(一句话)

把 Zeta Web 左栏从「一坨扁平会话列表 + 常驻按钮堆」改造成参考产品的信息架构:
**按项目分组的侧栏(项目 = 工作目录),「项目」分组标题行右侧悬停浮现 +
新建入口、移开消失**;会话条目有清晰的命名/副标题规则,空会话不再污染列表。

## 2. 现状盘点(file:line 级,基线 = main @ 调查日,v1.1.23 与 main 的侧栏代码一致)

### 2.1 侧栏渲染栈

主组件 `web-ui/components/SessionSidebar.tsx`(3802 行巨石,含全部状态与渲染)。
渲染顺序(`return` 自 L1584 起):

| # | 区块 | 位置 | 说明 |
|---|---|---|---|
| 1 | Header:`SidebarHeader` | L1604-1627 | `ZetaWebTitle`(L556-615)+ 新建工作区图标 + 显示设置下拉 + 搜索开关 + 编辑模式开关 |
| 2 | Action row | L1629-1725 | hero「新建会话」大按钮(`openDraft(selectedProject)`)+「打开工作区」+ skills 三个常驻按钮 |
| 3 | 计划卡 planCard | L1727-1780 | 条件渲染 |
| 4 | 搜索行 | L1782-1879 | 条件渲染;搜索时列表退化为平铺树(L2250-2276) |
| 5 | 置顶区 `PinnedSection` | L1882-1899 | localStorage 置顶 id,置顶会话脱离项目组浮顶 |
| 6 | 运行中区 | L1900-1965 | 轮询 `/api/agent/running`(2.5s,L830-889),≤6 条 |
| 7 | 使用量微行 | L1966-1995 | 今日 cost/token |
| 8 | 临时会话区 | L1997-2114 | `temp`(cwd 在 OS temp 目录)会话,默认折叠(`tempOpen` L700);行用内联旧组件 `SessionItem`(L3284) |
| 9 | 项目分组列表 `SidebarProjectsList` | L2171-2249 | 分组数据 `workspaceGroups`(L1342-1396),组内树 `projectTrees`(L1468-1494) |
| 10 | 批量操作条 `BulkActionBar` | L2278-2286 | 编辑模式 |
| 11 | 归档区 `ArchiveSection` | L2287-2291 | 底部折叠 |
| 12 | 文件浏览器 + git 变更 | L2292-2634 | 下半区,本次不动 |
| 13 | 打开工作区对话框 | L2634-2978 | 项目列表 + 默认工作区 + 浏览/自选路径 |
| 14 | 新建会话草稿 `NewSessionDialog` | L2978-3002 | 项目→工作树→分支的创建流程 |
| 15 | portal 浮动菜单/确认框 | L3002 起 | 行菜单/项目菜单/排序菜单/danger confirm/SearchDialog |

子组件目录 `web-ui/components/sidebar/`:`ArchiveSection`、`BulkActionBar`、
`FloatingMenu`、`NewSessionDialog`、`PinnedSection`、`SessionGroupSection`、
`SessionNodeItem`、`SidebarHeader`、`SidebarProjectsList`、`sidebar-shared.ts`、
`useSessionMultiSelect.ts`。

### 2.2 数据模型与网关端点(全部已存在,本次零新增)

- `GET /api/sessions` → `SessionInfo[]`(`web-ui/lib/types.ts` L285-307):
  `path/id/cwd/name/created/modified/messageCount/firstMessage/parentSessionId/
  projectRoot/worktreeBranch/tag/temp`。网关实现
  `packages/coding-agent/src/server/web-gateway/sessions.ts` L152-198:
  `name = s.title`(标题槽显式标题,含 CLI 自动生成标题)、
  `firstMessage` 空时字面量 `"(no messages)"`(L190)、
  `projectRoot` 由 `resolveProject` 归并 worktree、`temp` 由 `isTempCwd`(L144-150)。
- 路由常量:`packages/coding-agent/src/server/web-gateway.ts` L98-108
  (sessions 家族全部网关直营)。
- 项目解析:`packages/coding-agent/src/server/web-gateway/projects.ts` L48-94
  (worktree toplevel 归并主仓;子目录保持独立项目身份;60s 缓存)。
- 变更端点:`PATCH /api/sessions/:id`(重命名,L618-637)、
  `DELETE /api/sessions/:id`(L639-700,含子会话重挂)、
  `POST /:id/archive|unarchive`(`archive.ts`)、
  `DELETE /api/projects`(级联按 cwd 前缀删,`{path}` 或 `{tempOnly:true}`,
  L863-893)、`GET/POST/DELETE /api/worktrees`、`POST /api/cwd/validate`、
  `POST /api/default-cwd`(→ `~/.zeta/workspace`,`web-ui/lib/default-workspace.ts`)、
  `POST /api/open`(终端)。
- 会话文件:`~/.zeta/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`;
  标题槽 256B(`src/session/session-title-slot.ts`);显示名回退链
  显式标题→首条用户消息→`Untitled · 时间`(`src/session/session-listing.ts`
  L144-155,CLI 侧)。

### 2.3 偏好存储(现状两套并行)

- P1 散键:`components/sidebar/sidebar-shared.ts`
  (`SIDEBAR_COLLAPSED_PROJECTS_KEY`/`SIDEBAR_DISPLAY_KEY`/别名/项目置顶/会话置顶)。
- P2 统一键:`lib/sidebar-prefs.ts`(`zeta-web:sidebar-preferences-v2`,
  含从 P1 的迁移逻辑;`SessionMeta.manualTitle/readAt`、`ProjectMeta.name/
  pinned/collapsed/order`、`projectSort`、`sessionView.sort`)。
- 纯函数层 `lib/sidebar-groups.ts`:`splitZones/timeGroups/foldVisible/metaEntry`
  仅被自身测试引用,组件只 import 了 `sortSessions, sortProjects`(L46),
  而 `sortProjects` 在组件内**从未调用**(死 import)。

### 2.4 桌面壳

`desktop/src/main.ts`(790 行):仅 `loadURL(http://127.0.0.1:30141)`(L33、
L451),frameless 自绘标题栏(L430-491)、托盘(L588-643)、会话完成监视
(5s 轮询 `/api/agent/running` + 系统通知,L145-203;通知标题取
`/api/sessions` 的 `name`)、`ensureDefaultWorkspace`(L393-400)。
桌面不 import 任何 `packages/*`/`web-ui/*` 源码;嵌入构建走
`desktop/scripts/prepare-runtime.mjs`(web-ui `NEXT_OUTPUT_STANDALONE=1` →
`.next/standalone` 与 zeta 二进制一起折叠进 Electron 包,
`bundledServeCommand` L246-267)。**侧栏与桌面壳零代码耦合。**

## 3. 根因:为什么丑

1. **创建入口三处并存、位置全错**。hero「新建会话」+「打开工作区」常驻按钮行
   (`SessionSidebar.tsx` L1629-1725)+ `SidebarHeader` 的新建工作区图标
   (`SidebarHeader.tsx` L71-96)+ 项目行 +(`SidebarProjectsList.tsx` L195-209)。
   用户裁决的「项目分组标题行 hover 浮现 + 」不存在。
2. **项目标题行按钮常驻不消失**。
   - `SidebarProjectsList.tsx` L70-85:每个项目行都渲染常驻 `↑↓` 排序符;
   - L189-244:+/终端/删除按钮组挂在 `className="sidebar-group-actions"`
     上——该类在 web-ui 全库**没有任何 CSS 定义**(仅此一处使用),
     因此按钮**永远可见**(且仅当前项目行有);
   - `SessionSidebar.tsx` L456-461:`ProjectHeaderMenu` 的 ⋯ 按钮
     `opacity: open ? 1 : 0` 且只有 `onMouseEnter` 置 1、**没有 onMouseLeave
     复位**,悬停一次即永久显示。
   多排常驻图标 + 无淡入淡出 = 视觉噪点的主源。
3. **会话名截断**。`SessionNodeItem.tsx` L154
   `title = session.name || session.firstMessage.slice(0, 50) || id`,
   单行 ellipsis(L430-439)。`name` 多为 CLI 自动生成的短标题(如
   "pi-adviso…"),撑满即截;54px 高的两行行内主标题只有一行可用。
4. **0 消息空会话成排**。网关把 `~/.zeta/agent/sessions/` 全树每个 `.jsonl`
   都列为会话(CLI 一次性运行、fork 副本、eval/worker 子进程、channel
   bot/relay 草稿都留 0 消息文件),UI 无任何过滤;空会话的 `firstMessage`
   是字面量 `"(no messages)"`(gateway L190),前端直接把它当标题渲染
   (L154 该串为真值)→ 一排 "(no messages)"。
5. **双层分组头噪音 + 死设置**。项目组内再套「今天/昨天/本周/更早」时间桶头
   (`SessionGroupSection.tsx` L134-145),项目内条目被二次切碎;而显示菜单里
   的「按 worktree 分组/flat」「显示最近」「项目排序」单选
   (`SidebarHeader.tsx` L148-238)写的是 P1 `display` 对象——渲染层
   **完全没有引用**(SessionSidebar 全文无 `sessionGrouping`/`showRecent`
   使用;`display.projectSort` 与真实生效的 P2 `projSort`(L1342-1396)是
   两套,菜单里那套是死的)。`sessionSort` 状态(L706)只被 `groupedTree`
   memo(L1433-1464)消费,而该 memo 的**值**从未被渲染(仅作
   `groupedTree !== null` 的搜索态开关,L2171)——会话排序 UI 是死的。
6. **重复实现**。`SessionSidebar.tsx` 内还留着拆分前的旧副本:
   `SessionTreeItem`(L3150,仅自我递归引用,彻底死代码)与 `SessionItem`
   (L3284,临时会话区在用,与 `SessionNodeItem` 平行重复)。
7. v1.1.23 发布版与 main 的侧栏代码逐字节一致(`git diff v1.1.23 HEAD --
   web-ui/components/SessionSidebar.tsx web-ui/components/sidebar/` 为空)——
   即用户看到的现状就是上述代码的真实渲染,不存在「新代码未发布」的缓冲。

## 4. 目标信息架构(决策表)

侧栏纵向结构,自上而下(序号即渲染顺序):

| # | 区块 | 决策 |
|---|---|---|
| 1 | 侧栏头 `SidebarHeader` | 保留品牌标题(`ZetaWebTitle`)+ 搜索开关 + 编辑模式开关 + 显示设置;**删除**新建工作区图标(D2);显示菜单裁剪见 D6 |
| 2 | 计划卡 | 保留(条件) |
| 3 | 搜索行 | 保留(条件;搜索时平铺结果,现状) |
| 4 | 置顶区 | 保留在顶(置顶会话全局浮出,现状语义) |
| 5 | 运行中区 | 保留(≤6,现状) |
| 6 | **「项目」section header(新)** | 文案「项目」(i18n `sidebar.projectsSection`);右侧操作簇**仅 hover/focus-within 时浮现**:`⊞`(打开/添加项目 → 既有打开工作区对话框)+ `+`(新建会话 → `NewSessionDialog` 草稿,`openDraft(null)`,经「浏览目录」即覆盖新建项目面)。鼠标移开即淡出 |
| 7 | 项目分组列表 | 分组键 = `projectRoot`(现状,gateway 已归并 worktree);组头 = 文件夹图标 + 名称(别名优先)+ 会话计数 + chevron;**组头操作簇(↑↓ 排序 / + 项目内新建 / 终端 / 删除全部 / ⋯ 菜单)全部 hover 浮现**(D3);组内会话**平铺**,无时间桶(D6),>10 条折叠 + load more(现状) |
| 8 | 临时会话区 | 保留,默认折叠,样式与「项目」header 同级的 section header;操作(↑↓/+ /清空)同样 hover 化;清空仍走 `DELETE /api/projects {tempOnly:true}` + 二次确认(现状) |
| 9 | 归档区 | 保留底部折叠(现状) |
| 10 | 批量操作条 / 使用量微行 / 文件浏览器 | 保留(现状) |

**D2 创建交互重设计(草稿直开,弹窗降级;2026-10-02 修订)**:删除 hero
action row(`SessionSidebar.tsx` L1629-1725 整块删除)与 `SidebarHeader`
新建工作区图标(L71-96)。创建语义对齐两参考项目的收敛模式(deepseek-harness
note 2026-07-24「New Session clears to empty state」+ zcode
`workbenchNewTaskTarget.ts:25-54`):**任何 + 入口不再弹 NewSessionDialog,
直接把主区切到空态 hero 并聚焦输入框**;「项目」header 的 ⊞ 保留既有打开
工作区对话框(路径添加面)。
- 空态 hero = `ChatWindow.tsx` L1038 欢迎分支改造:居中 `DraftContextBar`
  (D11)+ hero 形态输入卡;同一 `ChatInput` 组件只做位置迁移,不换组件
  (harness `InputBar.module.css:8-19`「one InputBar moves position rather
  than swapping components」)。
- 会话创建时机维持现状(`useAgentSession.ts` L488 `isNew`、L891 起
  首发消息才落盘;草稿持久化 `lib/draft-store.ts`)——零网关改动。
- 入口→草稿 cwd 映射:「项目」header `+`=上次活跃 cwd;组头 `+`=该项目
  projectRoot;临时区 `+`=上次 temp cwd;**解析不到工作区时一律保底落到默认
  工作区**(用户裁决 2026-10-02:`~/.zeta/workspace`,即 `POST /api/default-cwd`
  /`lib/default-workspace.ts` 的位置)——不存在无 cwd 草稿态,新对话的默认
  位置就是默认工作区,chip 可改;仅当默认工作区也不可用时才整卡降级为
  选择触发器(harness `.cardWorkspaceTrigger` 模式,
  `InputBar.module.css:92-130`)。
- **删除 `NewSessionDialog.tsx`(496 行)**:项目列表能力并入工作区 chip
  下拉(D11),worktree/分支并入分支 chip;其 L165 恒真 checkout 条件
  (`worktree !== branch` 用路径比分支名)随删除消灭。AppShell 56px 折叠
  rail 的 `+`(AppShell.tsx L918 起)保持「立即按 activeCwd 建会话」不变
  (非目标)。

**D3 hover 范式实现规则(全侧栏统一)**:
- 触发行容器 `:hover` / `:focus-within` 时操作簇 `opacity: 0→1`
  (`transition: opacity 0.12s`);默认 `opacity: 0; pointer-events: none`,
  浮现时 `pointer-events: auto`。
- 操作簇**预留固定宽度**(沿用 `SessionNodeItem.tsx` L553-564 的 68px 预留
  模式),杜绝行宽抖动。
- 修复 `ProjectHeaderMenu` ⋯ 无 `onMouseLeave` 复位的 bug(补 leave 复位,
  或改为容器 hover 驱动)。
- 删除无定义的 `sidebar-group-actions` 类;↑↓/终端/删除/⋯ 一律进 hover 簇,
  任何项目行(不只当前行)均可在 hover 后操作。

**D4 会话条目命名/副标题规则**(`SessionNodeItem.tsx`):
- 主标题(单行):`name`(显式标题,含用户重命名)> 净化后的首条用户消息
  (截 60 字符)> 「新会话 · HH:mm」(created 时间)。**`"(no messages)"`
  字面量与 uuid 永不直接显示**(把 `"(no messages)"` 视为无标题)。
- 副标题(单行):相对时间 · N 条消息;运行中→计时器、未读→脉冲点(现状);
  worktree 分支徽章、`tag` chip 保留。**cwd 段从常规行移除**(项目上下文由
  组头表达);仅搜索结果的平铺模式保留 cwd 段(彼时无项目上下文)。
- 不做自动重命名:`manualTitle` 语义不动,用户重命名永远优先。

**D5 空会话(0 消息)呈现策略**:
- 定义:`messageCount === 0` 且 非运行中、非置顶、`modified` 距今 > 24h。
- 此类会话**不进常规列表**;所在项目组尾部渲染一条 ghost 折叠行
  「N 个空会话」(新组件 `EmptySessionsFold`):点击展开为灰显行(可单删),
  行尾「清理」按钮批量删除(前端循环既有 `DELETE /api/sessions/:id`,二次
  确认)。删除是唯一动数据的操作,且仅限满足上述定义的会话。
- 24h 内 / 运行中 / 置顶的空会话正常渲染(标题按 D4 显示「新会话」)——
  用户刚建的草稿不能被藏掉。
- 临时会话区不参与(整组默认折叠已是策略);网关不删任何数据,过滤纯 UI。

**D6 分组与排序**:
- 项目组内**移除时间桶头**(今天/昨天/本周/更早):单层分组(项目→会话),
  组内 `updatedAt` 降序。`SessionGroupSection` 退化为平铺列表 + load-more。
- 项目组排序:默认最近活跃;显示菜单保留 manual/a-z/z-a/date-added/recent,
  **改为写 P2 `sidebar-prefs.projectSort`**(现状 ↑↓ 入口已写 P2,菜单并入
  同一状态)。
- 删除死设置:显示菜单的 projectSort 单选(P1 副本)、sessionGrouping、
  showRecent(`SidebarHeader.tsx` L148-238)与 `SidebarDisplaySettings` 中
  对应字段;删除死状态 `sessionSort`、死 memo `groupedTree`(L1433-1464,
  搜索态开关改为布尔)、死 import `sortProjects`、死组件 `SessionTreeItem`
  (L3150)、`SessionItem`(L3284,临时区行改用 `SessionNodeItem` 或抽
  `TempSessionRow` 薄壳复用之)。
- 偏好统一到 P2:collapse/别名/项目置顶从 P1 散键迁入
  `sidebar-prefs.projectMeta.{collapsed,name,pinned,order}`(迁移逻辑已有,
  补齐写入路径);`sidebar-shared.ts` 仅保留仍被引用的会话置顶 helper,
  其余删除。

**D7 临时会话组与项目组的关系**:互斥归属——`temp === true` 的会话永不进
项目组(网关按 OS temp 目录判定),置顶会话浮出项目组(现状
`sidebar-groups.ts splitZones` 语义,在组件内继续成立)。临时区固定在项目
列表之后、归档之前,默认折叠。

**D8 Gateway:零新增端点、零 DTO 变更**。分组、空会话识别、命名所需的
全部字段已在 `GET /api/sessions` 载荷;批量删除复用既有 DELETE;服务端
过滤(会话 >500 的性能问题)不在本次范围(见非目标)。

**D9 桌面壳代码零改动**;配合项见 §6。

**D10 品牌与 i18n**:文案全部走 i18n(`lib/i18n/messages/en.ts` +
`zh-CN.ts` 双语都要加/删 key);新增 `sidebar.projectsSection`、
`sidebar.emptySessionsFold`、`sidebar.emptySessionCleanup`、
`sidebar.newSessionFallback` 等;删除不再引用的
`sidebar.display.grouping.*`、`sidebar.display.showRecent`、
`sidebar.display.sort.*`(若确认无引用)、`sidebar.actions.newSession`、
`sidebar.openWorkspace`(按最终去留核对);不引入 `omp` 裸字样
(`bun scripts/brand/brand-check.ts` 必须保持归零)。

**D11 草稿上下文条 `DraftContextBar`(2026-10-02 新增;新组件)**:渲染于
composer 卡上方,hero 形态与 docked 草稿态共用,两个 chip:
- **工作区 chip**(必现):label=草稿 cwd 叶名(默认=默认工作区);点开向上
  弹层(数据源复用「打开工作区」对话框:`GET /api/home`+最近项目),内含
  「浏览目录…」走既有 `POST /api/cwd/validate`;cwd 解析链=入口指定→
  默认工作区保底(`lib/default-workspace.ts`)→(两者皆不可用才)整卡降级
  为选择触发器(harness `InputBar.module.css:92-130`
  `.cardWorkspaceTrigger` 模式)。
- **分支 chip**(条件:cwd 是 git 仓库):数据 `GET /api/git/branches?cwd=`
  (`NewSessionDialog.tsx` L140 现成端点);**仅显式切换分支才**
  `POST /api/git/checkout`,绝不自动 checkout(消灭 L165 恒真 bug 的语义);
  脏树 409 错误内联展示。
- 首条消息发出=会话创建,`DraftContextBar` 随之隐藏;换工作区=开新草稿
  (draft 迁移不做——非目标)。

**D12 上游兼容面与死代码删除(2026-10-02 新增;用户裁决:兼容面除产品面板
外全删)**:纯残留 11 项本批全删——`lib/omp-models.ts`、`lib/omp-auth.ts`
(+其测试)、`lib/models-cache.ts`(+其测试)、`empty-models.json`、
`lib/custom-ui-terminal.ts`(+其测试)、`lib/utils.ts`(唯一消费者是死目录
icon)、`components/icon/` 整目录、`SettingsPanel.tsx` 内 `SettingsPanel`
组件本体(L1742 起;共享层 `SettingsTabBody/useSettingsData/
useWebConfigState/inputStyle/SettingsHighlight` 移至 `settings/` 保留)、
损坏测试 `lib/omp-web-options.test.mjs`(改指 `bin/zeta-web-options.js`)、
`NEXT_PUBLIC_OMP_VERSION` 回退环节(ChatWindow L997、SessionSidebar L562)、
`docs/release.md`(上游 pi-web 发布清单,重写为 zeta-web 简述或删除)。
env/lockfile 迁移期项(`OMP_WEB_*` env 回退、`pi-cwd-*` 目录扫描、P1 五键、
旧主题/语言键、`bash-output` 旧文件名读取)保留至下一版本,登记 §12 不动。
`NEXT_PUBLIC_PI_VERSION` 改名 `NEXT_PUBLIC_ZETA_VERSION`(next.config.ts
L119 + ChatWindow L998 + SessionSidebar L562)。web-ui 自有文档
(README*.md/CONTRIBUTING/SECURITY/docs/worktrees*)的 omp-web 残留同批
改品牌(`npx @linxiraos/zeta-web@latest` 等)。

**D13 i18n 债清偿(2026-10-02 新增)**:i18n 品牌残留=0(en/zh 裸 omp/π 均
无);实际文案债是硬编码英文绕过 i18n。本批全部接线
`lib/i18n/messages/en.ts`+`zh-CN.ts`:AppShell 顶栏 title("Stats dashboard"
L1587、"Open in app" L1623、Update 组 L1672-1718 与 alert L427、"System
prompt" L1871-1872)、ChatInput("Retrying upstream request" L1518、
Steer/Follow-up title L2162-2241)、StatsDashboard 空态句 L29-31、
DraftContextBar/空会话折叠行等全部新文案。i18n 测试补死 key 检测。

**D14 设置面现代化(2026-10-02 追加;用户截图裁决「按钮太诡异/不现代」)**:
`components/settings/**`(SettingsWindow+各 tab+`settings/shared.tsx`)全套
控件 primitives 现代化——**开关重做**:轨道+滑块双层结构,ON=主题强调色轨道
+对比滑块,OFF=中性轨道,disabled 灰化,150ms 过渡(现状 ON=全白药丸、滑块
无对比,状态可辨但无细节);输入框/下拉/卡片容器对齐参考控件规范(zcode
DESIGN.md:输入 bg-input+hover/focus 三态边框、控件高 h-6~h-9、菜单紧凑行、
"Do not promote every action to primary");分区导航列表紧凑化;危险操作
(解除绑定/重置)用 destructive 变体;全部文案走 i18n。只动
`components/settings/**` 与其 i18n key,**不改** `useSettingsData`/
web.yml 字段契约与 gateway 端点。

## 5. 组件级改造清单

| 文件 | 动作 |
|---|---|
| `web-ui/components/SessionSidebar.tsx` | 大改:删 action row(L1629-1725);删死代码(L1433-1464 memo、L3150 `SessionTreeItem`、L3284 `SessionItem`、死状态 `sessionSort`/`display` 死字段、死 import `sortProjects`);渲染顺序重排为 §4 表;临时区行换实现;偏好统一 P2;**对外 Props 接口保持不变(AppShell 零适配)** |
| `web-ui/components/sidebar/ProjectsSection.tsx` | **新增**:「项目」section header 容器(label + hover 浮现 ⊞/+),含 D3 的 hover/focus-within 规则 |
| `web-ui/components/sidebar/SidebarProjectsList.tsx` | 改:组头重构——静态面只剩图标/名称/计数/chevron;↑↓/+ /终端/删除/⋯ 全部收进 hover 操作簇(预留宽);修 ⋯ mouse-leave bug;删 `sidebar-group-actions`;空项目提示保留 |
| `web-ui/components/sidebar/SessionGroupSection.tsx` | 改:删时间桶头,平铺 + 保留 10 条折叠 load-more(或由新 `ProjectSessionsFlat` 取代,实施者二选一,倾向前者小改) |
| `web-ui/components/sidebar/SessionNodeItem.tsx` | 改:D4 命名/副标题规则(`"(no messages)"` 视为无标题;cwd 段按 `showCwd` prop 仅搜索模式传 true) |
| `web-ui/components/sidebar/EmptySessionsFold.tsx` | **新增**:空会话折叠行(展开/单删/清理,二次确认走既有 danger confirm) |
| `web-ui/components/sidebar/SidebarHeader.tsx` | 改:删新建工作区按钮(L71-96);显示菜单裁剪为「项目排序」一组,写 P2 `projectSort` |
| `web-ui/components/sidebar/sidebar-shared.ts` | 缩减:collapse/别名/项目置顶 helper 迁 P2 后删除(保留仍被引用的会话置顶持久化) |
| `web-ui/lib/sidebar-prefs.ts` | 扩:成为唯一偏好源;补 `projectMeta.{collapsed,name,pinned,order}` 的写入口 |
| `web-ui/lib/sidebar-groups.ts` | 清理:删除未被组件引用的 `splitZones/timeGroups/foldVisible/metaEntry` 及其测试段(保留 `sortSessions/sortProjects`);或将其接线后保留——执行者按「删后无死代码」为准,**二选一必须落定** |
| `web-ui/components/sidebar/PinnedSection.tsx` `ArchiveSection.tsx` `BulkActionBar.tsx` `FloatingMenu.tsx` `useSessionMultiSelect.ts` | 保留,按新顺序挂载 |
| `web-ui/components/sidebar/NewSessionDialog.tsx` | **删除**(D2/D11);能力并入 DraftContextBar 两 chip;SessionSidebar 中的挂载与 openDraft 弹窗逻辑移除 |
| `web-ui/components/DraftContextBar.tsx` | **新增**(D11):工作区 chip + 分支 chip;hero/docked 草稿态共用 |
| `web-ui/components/ChatWindow.tsx` | 改:L1038 欢迎分支改造成空态 hero(居中 DraftContextBar + hero 输入卡);L997-998 版本回退链换 `NEXT_PUBLIC_ZETA_VERSION` |
| `web-ui/components/ChatInput.tsx` | 改:hero/docked 两形态(位置迁移,组件不换);工具栏七控件全保留(附件/模型/thinking/preset/压缩/声音/发送,已核实无死控件),窄宽度收纳进既有 ⋯ 菜单;硬编码英文接 i18n(D13) |
| `web-ui/lib/i18n/messages/en.ts` `zh-CN.ts` | 增删 key(D10);跑既有 i18n 校验测试 |
| `web-ui/components/SessionSidebar.test.mjs` `lib/sidebar-groups.test.mjs` `lib/sidebar-prefs.test.mjs` | 同步更新:删死导出断言、补空会话过滤/命名回退/`projectSort` 写 P2 的用例 |
| `web-ui/components/AppShell.tsx` | **不改**(SessionSidebar props 不变;rail 行为不变) |

复用的 gateway 端点(全部既有,零新增):
`GET /api/sessions`、`PATCH/DELETE /api/sessions/:id`、
`POST /api/sessions/:id/(un)archive`、`GET /api/sessions/archived`、
`DELETE /api/projects({path}|{tempOnly})`、`GET/POST/DELETE /api/worktrees`、
`POST /api/cwd/validate`、`POST /api/default-cwd`、`GET /api/home`、
`POST /api/open`、`GET /api/agent/running`、`GET /api/web-config`、
`GET /api/stats/overview`、`GET /api/git/branches?cwd=`、
`POST /api/git/checkout`(仅显式换分支时调用)。

## 6. 桌面壳配合项(desktop/)

代码零改动。必须做的配合:

1. **重建嵌入**:发布前 `desktop/scripts/prepare-runtime.mjs` 现有流程即可
   (web-ui `npm run build` + `NEXT_OUTPUT_STANDALONE=1` → staging →
   `electron-builder`);禁止手拷旧 `.next` 产物。
2. **契约测试**:`desktop` 内 `npm test`(平台契约)不受本计划影响,但发布
   前必须重跑确认绿。
3. **冒烟**:`npm run dist` 产物启动后,按 §7 验收清单 1-9 逐条在桌面窗口里
   过一遍(桌面与浏览器同一 web-ui,重点确认 frameless 标题栏与侧栏新头部
   不重叠、托盘通知标题仍显示会话名)。
4. **通知链路回归**:`desktop/src/main.ts` 的 `sessionDisplayName`(L193-203)
   继续消费 `/api/sessions` 的 `name`——D4 未改该字段语义,预期零影响,冒烟
   时验证一条完成通知即可。

## 7. 验收清单

1. 侧栏自上而下 = §4 表顺序;action row「新建会话」/「打开工作区」按钮与
   SidebarHeader 新建图标不复存在。
2. 「项目」标题行:hover 浮现 ⊞ 与 +,移开淡出;键盘 Tab 聚焦时同样可见
   (focus-within)。
3. 项目组标题行:静态只显示图标+名称+计数+chevron;hover 才出现
   ↑↓/+ /终端/删除/⋯;⋯ 菜单打开后鼠标移开能自动收起(bug 修复验证);
   非当前项目行 hover 也有操作簇。
4. 项目组内无时间桶头;组内 >10 条出现 load-more,展开可见全部。
5. 会话行主标题永不出现 `"(no messages)"` 或 uuid;无标题会话显示
   「新会话 · HH:mm」;副标题 = 相对时间 · N 条消息;常规行不再重复 cwd;
   搜索结果行保留 cwd 段。
6. >24h 的 0 消息会话从常规列表消失,出现在组尾「N 个空会话」折叠行;
   「清理」二次确认后删除成功且列表即时刷新;24h 内/运行中/置顶的空会话
   仍正常显示。
7. 临时会话区默认折叠,hover 出排序/+/清空;清空走二次确认。
8. 项目排序(含 manual/a-z/z-a/date-added/recent)生效且刷新后保持;置顶
   会话/置顶项目/项目别名/组折叠状态刷新后保持;全部落在单一
   `zeta-web:sidebar-preferences-v2` key。
9. 新建交互(草稿直开):任何 `+` 入口直接进空态 hero,无弹窗;解析不到
   工作区时草稿保底落到默认工作区(`~/.zeta/workspace`),仅当其不可用时
   整卡才降级为选择触发器;工作区 chip 可换 cwd(含「浏览目录」);分支 chip
   仅显式切换才 checkout,脏树 409 内联报错;首条消息发出即创建会话且
   DraftContextBar 消失。
10. `web-ui`:`node_modules/.bin/tsc --noEmit` 0 错;`npm run lint` 0 错;
    `npm test`(node --test 全套)绿。
11. i18n en/zh-CN 无缺 key、无死 key(i18n 测试绿)。
12. 仓库根 `bun scripts/brand/brand-check.ts` 归零(exit 0)。
13. 桌面:`desktop` `npm test` 绿;`npm run dist` 成功;产物启动冒烟
    (§6.3)通过。
14. 兼容面删除(D12)全部落地:`npm run build` 绿;grep 无
    `omp-models|omp-auth|models-cache|custom-ui-terminal|empty-models|NEXT_PUBLIC_OMP_VERSION`
    残留;`NEXT_PUBLIC_ZETA_VERSION` 接线生效。
15. i18n(D13)清零:上述硬编码英文全部走 `t()`;en/zh key 集合相等测试绿;
    死 key 检测通过。
16. ChatInput 工具栏七控件(附件/模型/thinking/preset/压缩/声音/发送)与
    Steer/Follow-up 行为回归不变;hero↔docked 切换时草稿文本不丢
    (`lib/draft-store.ts` 按 draftKey 恢复)。
17. 仓库根 `bun scripts/brand/brand-check.ts` 与 `bun scripts/check-ci-surface.ts`
    归零(随 §8 门禁复跑)。
18. 设置面(D14):开关 ON/OFF/disabled 三态视觉可辨(强调色轨道+滑块,非全白
    药丸);输入/下拉/卡片对齐参考控件规范;危险操作 destructive 变体;文案
    全 i18n;`useSettingsData`/web.yml 契约零改动。
19. Open 面(D15):菜单带图标与「(默认)」标注,split-button 一键默认打开;
    检测到 `zeta-ide`/`zeta-editor` 时可一键在终端 IDE/编辑器打开当前
    工作区;Windows 终端按 pwsh→Git Bash→powershell 链解析,Linux 用
    $SHELL;默认目标刷新后保持;desktop 桥 `npm test` 回归绿。

    **D15 Open 面重设计与默认打开链(2026-10-02 追加;用户截图裁决「Open 页面
    很烂/不现代」,参考 ZCode split-button 与 dsh 菜单)**:
    - **UI**:顶栏 Open 改 split-button(左半=一键用默认目标打开,右半=下拉);
      菜单每项带图标,当前默认目标标「(默认)」+勾选(对齐 dsh
      「文件资源管理器(默认)」形态);默认目标记忆(localStorage,菜单内切换)。
    - **新目标(用户裁决)**:我们自己的终端编辑器/IDE——gateway 检测 PATH 上的
      `zeta-ide`/`zeta-editor`,存在即作为打开目标(cwd=当前工作区启动)。
    - **终端解析链(用户裁决)**:Windows=`pwsh`(PowerShell 7+,优先高版本)→
      Git Bash(更稳)→系统自带 `powershell.exe`;Linux/macOS=`$SHELL`→bash。
      解析在 gateway 侧做,`GET /api/open/options` 返回 terminal 解析结果与
      全部可用目标,`POST /api/open` 按目标类型启动。
    - **实现面**:gateway `server/web-gateway/open.ts` 扩展目标枚举与检测;
      AppShell Open 菜单重写;desktop 桥 `getDesktopOpenTargets` 同步核对。
      **本条显式突破 §9「不改 gateway」非目标——范围仅 open 端点,依赖方向
      (web-ui 只经 fetch)不破。**

## 8. 发布门(硬性,下一次 release CI 之前)

1. §5 全部文件落地、§7 验收 1-17 全绿,且已按 Feature Branch Workflow 合入
   `main`(PR CI 绿,含 `check-version-consistency`/`check:ts`/
   `brand-check`/`check-ci-surface` 全套根门禁)。
2. 桌面链路(desktop_linux/desktop_windows)在包含本计划的 commit 上跑绿;
   tag release run 的 desktop 产物必须内嵌新 web-ui(冒烟步骤断言「项目」
   section 文案存在)。
3. 上述未满足前,不得打任何 release tag;判定 CI 绿必须核对 run 的 jobs 数
   (1-job run 是 flake 评估器,见 AGENTS.md 损伤类别 10)。

## 9. 非目标

- **不改依赖方向**:web-ui 仅经 `fetch("/api/*")` 访问网关;不在 web-ui 放
  服务端代码;desktop 不 import `packages/*`/`web-ui/*` 源码
  (web-ui/AGENTS.md「Architecture」「Gateway ownership」与根 AGENTS.md
  「Code Location Rules」原文有效)。
- **不改 gateway**:无新 handler、无新路由、`lib/types.ts` DTO 契约不动;
  服务端会话过滤/分页留待会话规模实测超标后另立计划。
  **例外(D15,2026-10-02 用户追加)**:`server/web-gateway/open.ts` 允许扩展
  目标枚举与终端解析链,不新增路由前缀。
- **不做会话自动改名**:标题回退规则只影响显示,不写盘;`manualTitle`
  语义不动。
- **不动 AppShell 布局骨架**:折叠 rail、可拖宽度、移动端抽屉、标题栏、
  TabBar 均不变;rail 的 + 行为不变。
- **不动桌面壳代码**:`desktop/src/main.ts` 的窗口/托盘/启动/通知逻辑不改。
- **不引入新依赖**:无组件库、无 CSS 框架、无虚拟列表(列表性能实测出问题
  再另立计划);沿用 inline style + `styles/` 主题 token。
- **不动上游冻结策略**:omp-web-upstream 仍冻结,本工作为 Zeta 自有演进,
  不产生 cherry-pick 台账项。
- **不动 CLI/TUI 与渠道面**:本计划只覆盖 web-ui 左栏及其桌面嵌入链路。

## 10. 实施顺序(每批独立 commit,批间可回退;2026-10-02 重排)

| 批 | 内容 | 门 |
|---|---|---|
| 0 | 切 `feat/webui-sidebar-overhaul`;merge main;基线截图(现状留档) | 干净工作树 |
| 1 | 清场:D12 兼容面/死代码删除 + D13 i18n 债接线 + web-ui 文档品牌残留 | 验收 14-15、10-11 |
| 2 | IA 重排:删 action row/死代码;新增 `ProjectsSection`;组头 hover 化 + bug 修复;去时间桶;临时区行换实现 | 验收 1-4、8 |
| 3 | 草稿直开:空态 hero + `DraftContextBar`;删 `NewSessionDialog`;ChatInput hero/docked 形态 | 验收 9、16 |
| 3.5 | 设置面现代化(D14):开关/输入/卡片 primitives 重做 | 验收 18 |
| 3.6 | Open 面重设计 + 默认打开链(D15,gateway open 端点扩展) | 验收 19 |
| 3.7 | 输入区增强(carryover U3 残余收编):context 用量圈 + thinking 循环键,进 ChatInput 工具条 | 验收 16 扩 |
| 4 | 命名/副标题规则 + `EmptySessionsFold` 空会话策略 | 验收 5-6 |
| 5 | 偏好统一 P2(`sidebar-shared` 缩减、显示菜单裁剪) | 验收 8 |
| 6 | merge main → push → PR → CI 绿 → 桌面 dist 冒烟 → 合并 | 验收 13、§8 全部 |

风险与回滚:批内独立 commit 可单批回退;批 3(删 NewSessionDialog)是创建
主路径重构,风险最高,以验收 9 全条 + 草稿不丢(16)为门;空会话「清理」是
唯一不可逆操作,已用「仅 0 消息 + >24h + 二次确认」三重约束兜底;AppShell
接口不变使回归面集中在 SessionSidebar/ChatWindow 内部。

## 11. 参考基线(2026-10-02 修订;两参考项目模式收敛)

主参考 `temp/deepseek-harness`(dsh),副参考 `temp/zcode-ui-reference`(ZCode,
自带 DESIGN.md 设计系统)。本计划采纳的交互决策及证据:

| 决策 | dsh 证据 | zcode 证据 |
|---|---|---|
| 新建会话=清到空态,首发才建 | `.agents/notes/archived/feature/2026-07-24-new-session-clears-to-empty-state.md:9-24` | `v4/workbenchNewTaskTarget.ts:25-54` |
| 空态与 docked 态同一 composer,位置迁移不换组件 | `InputBar.module.css:8-19`;`ConversationRoot.tsx`(DOM 跨态存活) | `ChatPromptEditor.tsx`(插槽协议) |
| 工作区选择=chip,可跳过 | `ConversationRoot.tsx:75-135`(chip 解析链+`.cardWorkspaceTrigger`) | `ChatEmptyState.tsx:266-268`+`WorkspaceShellLayout.tsx:1180-1216` |
| 分支切换=chip/popover,非创建前置表单 | —(无分支概念) | `GitBranchSwitcher`(同上) |
| 行内 chrome 全 hover 渐显,CSS 实现 | `Rows.tsx:1-4`(folder↔chevron、time↔⋯ 全 CSS) | `task-row.tsx:347-356`(元数据让位操作) |
| 会话行单状态点,优先级合成 | `Rows.tsx:231-269`(交互>运行>完成) | `task-row.tsx:387-427`(优先级链) |
| 空会话特殊呈现 | `Rows.tsx:447-455`(无时间无菜单) | `draft-task-row.tsx:38-45`(虚线行) |
| hover card 承载路径/全状态 | `Rows.tsx:61-135` | `task-row.tsx:470-500` |
| 触发符管线(/ @)统一 combobox | `ui-input-trigger/controller.ts:1-11` | `promptInputTriggers.ts:1`(/ @ $ #) |
| 布局让步链+侧栏永不让步 | `columns.ts:20-77`(中栏保底 640) | `WorkspaceShellLayout.tsx:99-117` |
| token 三层/语义化,特性层禁字面色 | `docs/web-styling.md:7-23` | `styles.css`(@theme 语义 token) |
| 设计规范文档先行(改 UI 前必读) | `web-styling.md` 全文 32 行 | `DESIGN.md:7-19`(违规=缺陷) |

不采纳(记录理由):dsh 的 748px 内容轴/r22 圆角/业务蓝交互色为 dsh 品牌语言,
Zeta 沿用现有 `styles/` 主题 token 体系(§9 非目标:不引入新依赖/不换样式
框架);zcode 的用户自定义分组(颜色/拖拽排序)超出本次范围,登记 roadmap。

## 12. 兼容面判定全表(2026-10-02 盘点;D12 的执行依据)

**删除(11 项,批 1)**:`lib/omp-models.ts`;`lib/omp-auth.ts`+`omp-auth.test.mjs`;
`lib/models-cache.ts`+`models-cache.test.mjs`;`empty-models.json`;
`lib/custom-ui-terminal.ts`+测试;`lib/utils.ts`(随 icon 目录);
`components/icon/`(Icon.tsx/sprite.ts/icons.ts);`SettingsPanel.tsx` 的
`SettingsPanel` 组件本体(L1742 起,共享层五符号移 `settings/` 保留);
`lib/omp-web-options.test.mjs`(改指 zeta-web-options.js);
`NEXT_PUBLIC_OMP_VERSION` 回退环节;`docs/release.md`。
**迁移期保留(7 项,下一版本复审)**:`bin/zeta-web-options.js` L25-26
`OMP_WEB_*` env 回退;`lib/file-access.ts` L44-47 `^(omp|pi)-cwd-\d{8}$`
扫描;`sidebar-shared.ts` P1 五键(批 5 后降为只读迁移源);`zeta-theme`/
`zeta-lang` 旧键一次性迁移;`bash-output.ts` 旧 `pi-bash-*.log` 读兼容;
`bun.lock` 工作区名(随锁刷新消解);`next.config.ts` L41
omp-legacy-pi-modules 构建 stub(构建链必需,**永久保留**,见文件头注释)。
**产品功能误伤警示(勿删)**:`lib/request-security.ts`/`proxy.ts`;
`lib/file-access.ts` 主体;`lib/session-reader.ts`(上游 SDK 语义契约测试
是行为规格);`lib/pi-types.ts`/`pi-desktop.ts`/`pi-slash-commands.ts` 与
`@earendil-works/pi-*` 依赖(运行时协议非品牌残留);`/api/stats` rewrite+
`StatsDashboard`(用量面板本体);`ZetaWebTitle`。

## 13. CLI 指令面审计结论(2026-10-02;独立分支 `fix/cli-command-surface` 落地)

四产品 bin 接线层正确(npm 1.1.22/1.1.23 bins、3 个 launcher、
`CLI_BIN_NAME` 常量及 7 个 import 方全对)。病灶五处,修复在 web-ui 本计划
之外的独立分支进行:

1. **P0 提示错名**:`packages/coding-agent/src/utils/resume-command.ts:17`
   用 `APP_NAME`("zeta")插值,退出提示打出 `zeta --resume <id>`(裸 zeta 是
   Zetawork bin;`main/crates/zeta-main/src/main.rs:43` 对 `-` 开头参数静默
   吞掉进工作台)——2026-10-02 用户实测静默失败的元凶。修复:改
   `CLI_BIN_NAME`;伴生测试 `test/utils/resume-command.test.ts:14,:21` 同步;
   `interactive-mode.ts:6112` 硬编码英文改接既有死 i18n 键
   `imResumeHintFmt`(en/zh L1135,传 CLI_BIN_NAME)。
2. **P0 update 自更新链**:`update-cli.ts` :1970-2085 Windows shim takeover
   写/退休 **`zeta.exe`/`zeta{,.cmd,.ps1,.bat}`**——劫持 Zetawork 的 bin;
   :34/:288/:317 `REPO='can1357/oh-my-pi'` 与 :37 `MISE_TOOL` 指向上游;
   :1231 `$which(APP_NAME)` 回退+:1242 `zeta/` 前缀容忍可误抓工作台二进制。
   修复:shim 操作对象=本包真实 bin 名;REPO/MISE 指向 Zeta 仓库;删回退。
3. **P1 run-string 错名**(~18 文件):config-cli/plugin-cli/setup-cli/
   update-cli 提示/login-cli/shell-cli/web-search-cli/commands/
   help-extra/builtin-collaboration 全部 `${APP_NAME} x` → `CLI_BIN_NAME`;
   `launch-help.ts:122` `--alias omp-work` → `--alias zeta-work`。
4. **红线:空格形式展示违规(零容忍)**:根 `README.md:28-29,:255-257`
   (`zeta code`/`zeta editor`/`zeta ide`)、`main/crates/zeta-main/src/
   help.rs:12-15`(子命令 help 展示 `zeta work/code/editor/ide` 与全部
   别名)、`UPDATE-LOG.md:12`。展示一律 canonical
   (`zeta`/`zetawork`、`zetacode`、`zetaide`、`zetaeditor`);连字符别名
   (`zeta-work`/`zeta-c`/`zeta-cli`/`zeta-e`/`zeta-i`)内部可存、绝不展示;
   `zeta code|work|editor|ide` 内部 hand-off 语法保留但任何用户可见串不得
   出现。brand-rules 扩 MUST_NOT_CONTAIN 守卫(反引号空格形式+usage 上下文
   `${APP_NAME}` 插值)。
5. **P2 语料**:docs/ 30+ 文件裸 `omp` 命令名;`.github/ISSUE_TEMPLATE`
   `omp --version`;web-ui README `npx omp-web@latest`(随 D12 批 1 处理);
   `AGENTS.md:257` 上游对照残留。
6. **P3 卫生**:根目录游离文件 `im`(7600 行 interactive-mode 孤儿副本)
   删除;`editor/internal/app/handoff_to_agent.go:73` 与
   `desktop/src/main.ts:308-311` 的裸 `zeta` 回退候选收窄(防只装工作台的
   机器静默错路由);`profile-cli.test.ts` 的 `omp-work` fixtures 低优随扫。

## 14. 后续批次（自 plan-zeta-ui-carryover.md 收编，2026-10-02）

> 该计划文已按 document/ 规范删除，未完成批次原文收编如下（批号不变，规格仍决策完备）。
> 收编时状态：U4（侧栏分组）已由本计划取代并基本落地，原文删除；U3 的工具条位置/精简态
> 行为已并入本计划批 3/3.7，其 context 用量圈与 thinking 循环键已随批 3.7 落地；
> A+B、U2 已完成（见 roadmap DONE）；Z4 的 getPiCommand/信任门部分已由 PR #44 落地，
> 残余（PluginManifest pages、plugin-assets 端点）保留。硬约束与门禁节奏对收编批次继续有效。

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

## 15. 批次 4：桌面内置终端（Z2+U9，2026-10-03 立项）

> 架构调查：双标杆对标（opencode：server 持 PTY+REST 控制面+WS 数据面+ticket+缓冲重放；
> deepseek-harness：PTY 在服务端、浏览器只读 TerminalBlock、host.openPath 能力门控）。

### 架构

- **网关端点**（packages/coding-agent/src/server/web-gateway/terminal.ts 新文件）：
  REST 控制面 POST /api/terminal（创建，shell 沿 pwsh→Git Bash→powershell 链，cwd=会话 cwd）、
  DELETE /api/terminal/:id、POST /api/terminal/:id/resize；WS 数据面 GET /api/terminal/:id/ws
  （upgrade 复用网关既有授权 authorizedForAccess + x-zeta-token/Bearer）。
  PTY 用 node-pty；64KB 环形缓冲断线重放；并发上限 4（Z2 既有规格）。
- **前端**（web-ui/components/TerminalView.tsx 新文件）：xterm.js + addon-fit，挂既有 dock/rail
  体系（U9）；聊天文件路径 chip 点击 → TerminalView 窗格跑 `zeta-ide <file>[:line[:col]]`。
- **桌面壳零改动**：PTY 在网关进程，浏览器/桌面共用同一 WS。
- **安全**：全部复用网关既有授权，WS upgrade 同一 token 校验，不新增暴露面。

### 验收

创建/输入/resize/退出全链可用；断开重连恢复缓冲；并发第 5 会话拒绝有提示；
非授权 WS upgrade 被拒；聊天路径 chip → 终端窗格 zeta-ide 打通；
check:ts / web-ui 测试全绿。
