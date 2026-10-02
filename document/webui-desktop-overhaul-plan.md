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

**D2 创建入口收敛**:删除 hero action row(`SessionSidebar.tsx` L1629-1725
整块删除)与 `SidebarHeader` 新建工作区图标(L71-96)。全侧栏创建路径只剩:
「项目」header 的 `+`(跨项目草稿)、项目组头 `+`(定项目草稿)、临时区 `+`
(免选项目草稿)。三者都走既有 `NewSessionDialog`。AppShell 56px 折叠 rail
的 `+`(AppShell.tsx L918 起)保持「立即按 activeCwd 建会话」不变(非目标)。

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
| `web-ui/components/sidebar/PinnedSection.tsx` `ArchiveSection.tsx` `BulkActionBar.tsx` `FloatingMenu.tsx` `NewSessionDialog.tsx` `useSessionMultiSelect.ts` | 保留,按新顺序挂载;`NewSessionDialog` 成为唯一创建流程 |
| `web-ui/lib/i18n/messages/en.ts` `zh-CN.ts` | 增删 key(D10);跑既有 i18n 校验测试 |
| `web-ui/components/SessionSidebar.test.mjs` `lib/sidebar-groups.test.mjs` `lib/sidebar-prefs.test.mjs` | 同步更新:删死导出断言、补空会话过滤/命名回退/`projectSort` 写 P2 的用例 |
| `web-ui/components/AppShell.tsx` | **不改**(SessionSidebar props 不变;rail 行为不变) |

复用的 gateway 端点(全部既有,零新增):
`GET /api/sessions`、`PATCH/DELETE /api/sessions/:id`、
`POST /api/sessions/:id/(un)archive`、`GET /api/sessions/archived`、
`DELETE /api/projects({path}|{tempOnly})`、`GET/POST/DELETE /api/worktrees`、
`POST /api/cwd/validate`、`POST /api/default-cwd`、`GET /api/home`、
`POST /api/open`、`GET /api/agent/running`、`GET /api/web-config`、
`GET /api/stats/overview`。

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

1. 侧栏自上而下 = §4 表顺序;hero「新建会话」/「打开工作区」按钮与
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
9. 新建入口统一:项目 header `+`、组头 `+`、临时区 `+` 均打开
   NewSessionDialog 且项目预填正确。
10. `web-ui`:`node_modules/.bin/tsc --noEmit` 0 错;`npm run lint` 0 错;
    `npm test`(node --test 全套)绿。
11. i18n en/zh-CN 无缺 key、无死 key(i18n 测试绿)。
12. 仓库根 `bun scripts/brand/brand-check.ts` 归零(exit 0)。
13. 桌面:`desktop` `npm test` 绿;`npm run dist` 成功;产物启动冒烟
    (§6.3)通过。

## 8. 发布门(硬性,下一次 release CI 之前)

1. §5 全部文件落地、§7 验收 1-13 全绿,且已按 Feature Branch Workflow 合入
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

## 10. 实施顺序(每批独立 commit,批间可回退)

| 批 | 内容 | 门 |
|---|---|---|
| 0 | 切 `feat/webui-sidebar-overhaul`;merge main;基线截图(现状留档) | 干净工作树 |
| 1 | IA 重排:删 action row/死代码;新增 `ProjectsSection`;组头 hover 化 + bug 修复;去时间桶;临时区行换实现 | 验收 1-4、8-11 |
| 2 | 命名/副标题规则 + `EmptySessionsFold` 空会话策略 | 验收 5-6 |
| 3 | 偏好统一 P2(`sidebar-shared` 缩减、显示菜单裁剪) | 验收 8 |
| 4 | i18n 增删 + 测试同步 + lint/tsc/brand-check | 验收 10-12 |
| 5 | merge main → push → PR → CI 绿 → 桌面 dist 冒烟 → 合并 | 验收 13、§8 全部 |

风险与回滚:批内独立 commit 可单批回退;空会话「清理」是唯一不可逆操作,
已用「仅 0 消息 + >24h + 二次确认」三重约束兜底;AppShell 接口不变使回归
面集中在 SessionSidebar 内部。
