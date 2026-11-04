# Zetawork UI / 功能缺陷修复报告（下一版本）

- **日期**：2026-11-04
- **范围**：`main/crates/zetawork-gui/`、相关 gateway session API、主题/控件、托盘与后台驻留
- **方法**：5 个只读子审计并行检查（会话删除、分栏/页脚、托盘、视觉系统、其他交互）
- **状态**：**P0/P1 与可验证的 P2 已实施**，代码在当前工作树，尚未提交。本文件作为下一版本（建议 `1.4.10`）的修复记录。
- **明确不做**：TSP host / TSP 协议实现；本报告只处理现有 UI 与本地交互。

---

## 0. 执行摘要

用户直接报告的 5 个问题全部确认：

1. 会话删除在 GUI 中**完全不存在**；默认项目行还被结构性置顶，容易被读成“不可删除”。
2. 左右栏拖拽只生效一瞬，松手回弹到最小宽度。
3. 左下 footer 在允许的最小宽度下必然重叠；`用量` 与 `帮助` 实测相交。
4. 托盘左键、菜单“显示窗口”、菜单“退出”在窗口隐藏后全部失效，根因之一是**隐藏窗口不再出帧**；菜单事件还漏了唤醒。
5. 视觉上主面是零圆角通铺 + 发丝线，没有浮岛层级；同时存在浅色主题不可读、modal 点击穿透、右栏页签重叠等确定性问题。

### 建议修复批次

| 批次 | 内容 | 目标 |
|---|---|---|
| P0-A | 托盘/后台驻留：隐藏出帧、菜单唤醒、左键菜单、最小化恢复 | 托盘可用、退出可用、不忙等 |
| P0-B | 分栏 resize、footer 布局、右栏页签布局 | 拖拽持久、无重叠 |
| P0-C | 会话删除：DELETE 传输、UI、二次确认、pin/tab 清理 | 默认/普通会话都能删 |
| P1 | modal 点击盾、picker 高度、标签溢出、工作树徽章、禁用按钮、i18n/焦点/裁剪 | 交互正确 |
| P2 | 浮岛 token、圆角/描边/高度/阴影/行样式统一；浅色主题 | 现代、可读、一致 |

**修复完成判据**：P0 全部有回归测试或桌面冒烟；P1 全部有 headless/几何测试；P2 有 1440×900 与 900×560 截图基线；`cargo test -p zetawork-gui --features tray,os-notify` 必须纳入门禁（当前 tray 测试实际上不编译）。

---

## 实施进度（2026-11-04）

- 工作树：`temp/ui-audit-fixes`；分支：`fix/ui-audit-p0`。**未提交、未推送。**
- 验证：`cargo test -p zetawork-gui --features tray,os-notify` 通过（370 lib + 32 integration + doc tests）；`cargo clippy --workspace --all-targets -- -D warnings` 通过；`cargo check --workspace --all-targets` 通过。
- 截图：`ZETA_SHOTS_DIR=temp/ui-shots cargo test ... --test shots -- --ignored` 通过；新增 `22-git-ship.png`，验证提交/推送行与真实 changed-file 列表。
- 说明：`UI-011` 是产品范围决定，不是遗漏；归档删除需要新的 gateway 端点。`UI-029..034` 已落地可验证的 token/结构改动，但仍是本轮的**部分完成**项，不能宣称整套视觉系统完成。

| ID | 状态 | 本轮落点 |
|---|---|---|
| UI-001 | 已修 | `eframe`/`egui` 升到 0.34.3，迁移到 `App::logic` + `App::ui`；隐藏窗口仍出帧 |
| UI-002 | 已修 | `tray::enqueue` 统一入队并 `request_repaint` |
| UI-003 | 已修 | `with_menu_on_left_click(false)` |
| UI-004 | 已修 | `show()` 先 `Minimized(false)`，再 `Visible`/`Focus` |
| UI-005 | 已修 | 左右栏 `take_available_width()`，PanelState 记录实际宽度 |
| UI-006 | 已修 | footer 按可用宽度布局，窄宽退化为图标 + tooltip |
| UI-007 | 已修 | DELETE 传输、路径、Admin 二次确认、pin/tab/agent 清理 |
| UI-008 | 已修 | 默认项目行不再显示用户置顶开关 |
| UI-009 | 已修 | 运行中会话禁用删除并给 tooltip |
| UI-010 | 已修 | gateway JSON 错误解析为本地化句子 |
| UI-011 | 保留 | 归档页仍只有恢复；删除活会话端点不处理归档 id |
| UI-012 | 已修 | `widgets::click_shield` 用于全部主要 modal/popup |
| UI-013 | 已修 | 运行时 palette；浅色/系统主题不再黑底黑字 |
| UI-014 | 已修 | 右栏页签按可用宽度缩放，并为折叠按钮预留右缘 |
| UI-015 | 已修 | picker 头高统一 34，内容滚动并夹在屏幕内 |
| UI-016 | 已修 | pane 标签与 `.termsub` chip 横向滚动，不再 `break` 丢弃 |
| UI-017 | 已修 | 工作树徽章放进固定子 UI，不再占下一行 |
| UI-018 | 已修 | 禁用“发给 agent”不再响应点击 |
| UI-019 | 已修 | `tr(CONST)` 常量补齐英文并加守卫 |
| UI-020 | 已修 | Agent 状态改用 `运行中/空闲` |
| UI-021 | 已修 | 分支名 112pt、上游从 +143 起，不再叠画 |
| UI-022 | 已修 | `group(Option<bool>)`；不可折叠组不画箭头 |
| UI-023 | 已修 | `SessionTab::display_title()` 按当前语言重渲染终端序号 |
| UI-024 | 已修 | `✎` 换成 `Icon::Pencil`，并加入 tofu 守卫 |
| UI-025 | 已修 | 新建工作区首帧聚焦名称输入 |
| UI-026 | 已修 | palette 高度按窗口夹紧，列表高度随对话框 |
| UI-027 | 已修 | tick 按分钟边界请求重绘 |
| UI-028 | 已修 | 超过 500 条时列表底部显示截断提示 |
| UI-029 | 部分 | 左右栏已有 ground gap + 圆角卡；中栏/状态栏仍是整条 |
| UI-030 | 部分 | `R_CONTROL/R_PANEL/R_MODAL` = 6/10/14，主要控件/描边已收拢；仍有个别 3/5/11 手写值 |
| UI-031 | 部分 | 左右列头已统一到 40pt；模态头 46/52 尚未完全收拢 |
| UI-032 | 部分 | 主要 modal 加统一阴影/遮罩，session-admin 尺寸夹紧；部分手绘浮层仍无阴影 |
| UI-033 | 已修 | 设置导航与用量地址栏均改用 control token 圆角 |
| UI-034 | 部分 | agent 行/行内星标已圆角；workspace 行仍有通栏高亮 |
| UI-035 | 已修 | 列数分段控件外框/选中格使用 control token |
| UI-036 | 已修 | 左栏重复的 zetawork/在线点已删除 |

**门禁**：`.github/workflows/ci.yml` 新增 `Run zetawork tests with release features`，确保 `tray` 测试真正编译运行。

**附带功能（非 UI bug）**：Git 面板新增“提交全部更改 / 推送”闭环——`git add -A` + `git commit -m`，无上游时 `git push -u origin HEAD`；结果复用 `git_notice`，测试覆盖了真实仓库的 commit 与首次 push。逐文件暂存、hunk 暂存、PR 与合并冲突 UI 仍未实现，也不画占位按钮。

---

## 1. P0：阻断与高风险

### UI-001 隐藏到后台后 eframe 不再出帧，托盘、退出、二次启动、后台保活全部失效

- **严重度**：Blocker
- **证据**：
  - `lifecycle.rs:434-438`：`hide()` 只发送 `ViewportCommand::Visible(false)`。
  - `lib.rs:1693-1706`：注释写明 hidden window 不再有 redraw；`lifecycle.poll` / `tray::poll` 只在 `tick` 中运行（`lib.rs:1573-1574`）。
  - eframe 0.33.3 `native/run.rs` 只在 `RedrawRequested` 时 `run_ui_and_paint`；Windows 对 `SW_HIDE` 窗口不产生 WM_PAINT。0.34 才加入 invisible/minimized 直接绘制。
  - 隐藏后事件循环还可能转入忙等，占满一个核。
- **根因**：`Visible(false)` 后没有帧；`request_repaint*` 最终是 `request_redraw`，Windows 隐藏窗口不派发。`[Windows confirmed；Linux needs runtime check]`
- **建议修复**：升级 eframe/egui 到 ≥0.34（根因修复）；升级前不要只调 `request_repaint` 充当修复。同步复核 `egui-winit`、`wgpu` 版本兼容。
- **回归测试**：Windows 桌面冒烟：隐藏后向单实例端口发 `zetawork-activate/1`，断言窗口可见；隐藏 5 秒 CPU < 5%。加一个 `#[ignore]` 集成测试，隐藏后 `request_repaint()` 必须再次进入 `update`。
- **状态**：见「实施进度」表

### UI-002 托盘菜单事件只入队、不唤醒窗口

- **严重度**：High
- **证据**：`tray.rs:140-145` 的 `MenuEvent` handler 只有 `queue.push(...)`，没有 `request_repaint`；对比 `tray.rs:146-164` 的 icon handler 有 `repaint.request_repaint()`。
- **根因**：漏写唤醒；可见时也要等下一次输入/动画，隐藏时叠加 UI-001 永远不处理。
- **建议修复**：抽取 `push_and_wake(id, ctx)`，两个 handler 共用；菜单事件后立即唤醒。不要只唤醒 `Move/Enter/Leave`。
- **回归测试**：`ctx.run` 内调用 `enqueue` 后断言 `ctx.has_requested_repaint()` 且 `drain_clicks()` 含 id；`cargo test --features tray` 必须真正编译。
- **状态**：见「实施进度」表

### UI-003 托盘左键默认同时弹菜单，“左键显示窗口”被菜单覆盖

- **严重度**：Medium
- **证据**：`tray.rs:179-184` builder 未设置 `menu_on_left_click`；`tray-icon 0.26.1` 默认 `true`，Windows 后端在 `WM_LBUTTONUP` 时弹菜单；同时 `tray.rs:146-164` 仍 push `ID_SHOW`。
- **根因**：未显式 `.with_menu_on_left_click(false)`。
- **建议修复**：显式关闭左键菜单；左键只做 show；右键保留菜单。Linux 无此设置，保持原行为。
- **回归测试**：桌面冒烟：左键不出菜单且窗口可见；右键菜单仍可打开。
- **状态**：见「实施进度」表

### UI-004 “显示窗口”不恢复最小化窗口

- **严重度**：Medium
- **证据**：`lifecycle.rs:442-447` 的 `show()` 只发 `Visible(true)` + `Focus`；Windows `focus_window` 对最小化窗口跳过。`chrome.rs:132-135` 最小化发 `Minimized(true)`。
- **根因**：缺少 `ViewportCommand::Minimized(false)`；可见窗口再发 `Visible(true)` 是空操作。
- **建议修复**：`show()` 先 `Minimized(false)`，再 `Visible(true)`/`Focus`；`poll` 的激活分支复用 `show()`。
- **回归测试**：headless 检查 `FullOutput.viewport_output` 的 commands 含 `Minimized(false)`、`Visible(true)`、`Focus`。
- **状态**：见「实施进度」表

### UI-005 左右栏拖拽松手回弹到最小宽度

- **严重度**：High
- **证据**：
  - `lib.rs:1903-1909` / `1919-1925`：`SidePanel.default_width(...).width_range(...).resizable(true)`。
  - `left.rs:53-84` / `right.rs:38-90`：内容全是 `ui.new_child(...)`，没有分配/填满 panel 宽度。
  - egui 0.33.3 `panel.rs:296` 只保证到 `MIN_WIDTH`；`panel.rs:300/345` 把 `inner_response.response.rect` 存进 `PanelState`，下一帧用它覆盖宽度。内容自然宽只有 `MIN_WIDTH`，所以每帧回到 200/280。
- **根因**：SidePanel 内容未 `take_available_space`，PanelState 记录的是内容 rect。
- **建议修复**：`left_column` / `right_column` 开头 `ui.take_available_width()`（或 `set_min_width(ui.max_rect().width())`）。同时确认拖拽后中心区跟随。
- **回归测试**：headless 两帧断言 `PanelState` 宽度等于默认宽度；拖拽序列后松手再一帧，宽度保留拖后值。重跑 1440×900 截图基线。
- **状态**：见「实施进度」表

### UI-006 左下 footer 两组按钮重叠

- **严重度**：High
- **证据**：
  - `left.rs:803-807` 右组硬编码 `inner.max.x - 62.0`；`widgets.rs:116-124` 空标签按钮 30px；`theme.rs:175` 间距 6px → 实际 66px，已少 4px。
  - 左组中文固有宽约 132、英文约 160；`left.rs:33` `MIN_WIDTH=200`，footer 最小需求中文约 214、英文约 240。
  - 当前 200 宽下 `用量` 与 `帮助` 相交约 14px；点击重叠区命中的是后绘制的 `帮助`。
- **根因**：两个绝对矩形、硬编码预留和固定标签，没有统一布局/响应式折叠。
- **建议修复**：抽 `foot_layout(width, labels) -> (left_rect, right_rect)`；右组宽度用 `2*30 + item_spacing`；不足时设置/用量退化为图标 + tooltip；`foot_button` 增加 tooltip 参数。或把 `MIN_WIDTH` 提高到 ≥226，但英文仍需折叠。
- **回归测试**：对 `foot_layout` 遍历 `W ∈ {200,214,248}` × `{zh,en}`，断言两组不相交且按钮在 inner 内；加 900×560 截图。
- **状态**：见「实施进度」表

### UI-007 会话删除在 GUI 四层全部缺失

- **严重度**：High
- **证据**：
  - 网关已就绪：`web-gateway.ts:396-402` → `sessions.ts:690-750`，成功 200 `{ok:true}`，软删到 `~/.zeta/trash/sessions`。
  - GUI 传输层：`usage/api.rs:294-305` 只有 GET/POST；`usage/mod.rs:39-40` 只导出 get/post；全仓无 `"DELETE"`。
  - 路径/操作层：`session_admin.rs:7-17` 明确“modal never deletes”；`Event` 只有 archive/unarchive；`request(... bool)` 无法表达删除。
  - UI：`session_admin.rs:480-513` 行动作只有 置顶/归档/恢复；`left.rs:777-787` 与 `history.rs:219-290` 只有单击打开。
  - 默认项目行被结构置顶：`state.rs:954-956`；modal 的 `pinned` 只读用户 pin（`session_admin.rs:432`，`state.rs:2069-2072`）。
- **根因**：功能缺口，不是后端拦截；不是“默认项目会话被禁止删除”。
- **建议修复**：
  1. `usage/api.rs` 增加 `delete(origin,path)`（内部 `request(origin,"DELETE",path,None)`），导出 `http_delete`。
  2. `session_admin.rs` 增加 `delete_path(id)`，`encode_segment` 复用。
  3. `Admin` 增加删除操作/`DidDelete`；复用 origin/busy/empty-id 校验。
  4. Active 行加“删除”，二次确认（复用 `board.rs` 的 `confirm_delete` 约定）；`busy || running` 时禁用；动作区从 168 扩到约 232，标题预留相应减少，避免第三按钮压标题。
  5. 成功后：刷新会话列表；移除 pin 并持久化；新增 `AppState::detach_session(id)` 清理打开的 Agent tab（只剩一个 tab 时清 session/title，而不是强行关 tab）。
  6. 归档页不要加删除：DELETE 只认活会话树，归档 id 会 404；需要先单独加归档删除端点。
- **回归测试**：`delete_path` 编码；`usage/api` 请求行是 `DELETE /api/sessions/x`；`Admin` 校验；默认项目/普通会话删除；运行中禁用；pin/tab 清理；新增 i18n 英文行；网关 404/relay-400 契约。
- **状态**：见「实施进度」表

### UI-008 “默认项目固定”与用户 pin 是两套语义

- **严重度**：Medium
- **证据**：`state.rs:954-956` 的 `ConversationEntry.pinned` 按项目归属；`state.rs:989-996` 用它画固定块；modal 的 `pinned` 只读 `pinned_sessions`（`session_admin.rs:432`）；点“取消置顶”不会移出固定块。
- **根因**：结构置顶与用户 pin 共用“置顶”文案，来源不同。
- **建议修复**：默认项目行不显示置顶开关，分组标题写“默认项目”；或合并成单一 pin 模型（工程更大）。不要只改 `is_pinned`，否则会把系统行写进 pin 文件。
- **回归测试**：默认项目行 `entry.pinned=true`、`is_pinned=false`；modal 不渲染其 pin 按钮；普通行仍可 pin/unpin。
- **状态**：见「实施进度」表

### UI-009 删除运行中会话没有保护

- **严重度**：Medium
- **证据**：`sessions.ts:742` 只 `removeRunningSession`，随后 rename 到 trash；`running-sessions.ts:28-30` 仅从 Set 删除；GUI 有 `Conversation.running`（`sessions.rs:74,155-166`）但删除路径未用。
- **根因**：后端没有运行中 409；GUI 若直接放行，Windows 上可能 rename 失败变 500，或删掉正在写入的转录。
- **建议修复**：GUI 在 `running` 时禁用删除并提示先停止；后端另加工单加 409。`[Windows rename half needs runtime check]`
- **回归测试**：`row.running == true` 时 delete action 返回 Disabled 且不发请求。
- **状态**：见「实施进度」表

### UI-010 删除/归档错误直接把 JSON 原文贴进 notice

- **严重度**：Low
- **证据**：`session_admin.rs:590-597` 的 `describe` 对 `FetchError::Status` 直接拼 `body`；relay 删除返回 `{"error":"relay 会话不可删除","code":"relay-protected"}`。
- **根因**：没有解析 gateway 错误 shape。
- **建议修复**：解析 `code`/`error`，映射 relay-protected、404 等；解析失败再回退原文；404 同时刷新列表。
- **回归测试**：`describe` 单测断言输出不含 `{`；relay/404 文案。
- **状态**：见「实施进度」表

### UI-011 已归档会话无法用 DELETE 删除

- **严重度**：Low
- **证据**：归档列表在 `~/.zeta/agent/archive/sessions`（`archive.ts:6-9,42-44`），DELETE 的 `resolveSessionPath` 只找活会话树（`sessions.ts:692-695`）；归档 id 恒 404。
- **根因**：删除与归档是两棵树。
- **建议修复**：本版本归档页只保留“恢复”；不要在 UI 加删除。若产品需要，另加归档删除/恢复端点。
- **回归测试**：断言 archived tab 动作集只有 restore；网关 DELETE archived id → 404。
- **状态**：见「实施进度」表

### UI-012 所有 modal 的空白处点击会穿透并关闭弹窗

- **严重度**：High
- **证据**：`composer.rs:40-48`、`settings_ui.rs:60-68`、`usage/mod.rs:275-283`、`session_admin.rs:308-310` 先分配全屏 `Sense::click()` 遮罩；`egui::Frame::show` 只占 `Sense::hover`，对话框空白处没有 click shield，遮罩成为最上层点击目标。
- **根因**：缺少 dialog 自身点击盾；点击标题/说明/字段间空白会关闭并可能丢输入。
- **建议修复**：在 dialog rect 上加 `ui.interact(dialog, id.with("dialog-shield"), Sense::click())`，或统一改用 `egui::Modal`。
- **回归测试**：headless 打开 usage/settings/composer，把 press+release 放在 dialog 空白/图表中心，断言仍打开；点击 dialog 外仍关闭。
- **状态**：见「实施进度」表

### UI-013 浅色/跟随系统主题不可读且半深半浅

- **严重度**：High
- **证据**：`theme.rs:255-256` 的 `weak_bg_fill = PANEL_2` 没有 light 分支；egui Button 用 `weak_bg_fill`，浅色下文字 `#1a1d23` 配深色底，对比度约 1.05:1；`theme.rs:202` `Theme::System => true` 永远深色。手绘面板全用 `theme::PANEL` 常量（left/right/center/statusbar），浅色只把 egui 控件刷白。
- **根因**：主题只作用到 egui 基色；面板绕过 palette；`weak_bg_fill` 漏分支。
- **建议修复**：引入 `Palette` 由 `theme::palette(theme)` 返回，所有手绘面取 palette；`weak_bg_fill` 同分支；`System` 读系统暗色；若本版本不做，先把浅色/跟随系统置灰，不要交付半成品。
- **回归测试**：`visuals(Theme::Light)` 对比度 ≥4.5；`Theme::System` 浅色 ctx；浅色截图 fixture。
- **状态**：见「实施进度」表

---

## 2. P1：交互与布局

### UI-014 右栏 9 个页签在最小宽度下被折叠按钮压住/裁掉

- **严重度**：Medium
- **证据**：`right.rs:47-70` 头 44、9 个 26px 页签 + 8 个 6px 间距 = 282，加左 6 = 288；折叠按钮 `head.max.x - 32`，`MIN_WIDTH=280` 时重叠约 40px；默认 324 也只剩 4px。后绘制的折叠按钮会截获页签点击。
- **根因**：页签固定尺寸，不与折叠按钮共享布局。
- **建议修复**：页签尺寸按可用宽度压缩/横向滚动；或折叠成“当前页签 + 更多”；最小宽度覆盖“9 页签 + 收起”的固有宽度。
- **回归测试**：几何纯函数在 280 宽断言不相交；点击“插件”不被折叠按钮截获。
- **状态**：见「实施进度」表

### UI-015 `＋` 选择器高度少算 22px，最后一行越界且无滚动

- **严重度**：Medium
- **证据**：`picker.rs:69-72` 用 `12 + 2*24 + 34*n`，内容从 `rect.min.y + 34` 开始；实际需要 34 头 + 分组 + 行；`picker.rs` 无 ScrollArea。
- **根因**：头高常量 12/34 不一致；无高度夹紧/滚动。
- **建议修复**：统一 `HEADER_H=34`，计算高度；行区加 `ScrollArea`，按 screen 夹紧。
- **回归测试**：`popup_height(entries, groups)` 纯函数；最后一行 rect 在 panel 内且可点击。
- **状态**：见「实施进度」表

### UI-016 子页标签溢出直接 `break`，没有滚动/更多入口

- **严重度**：Medium
- **证据**：`center.rs:487-489` 超出就 break；每栏约 289px、`reserved=60`，第三个标签起不绘制；`.termsub` chip 行同样无滚动。
- **根因**：标签条固定宽度逐行，超出丢弃。
- **建议修复**：横向 ScrollArea，或 `+N` 溢出菜单；`.termsub` 同样可滚动/截断。
- **回归测试**：3 标签页全部可点击；或纯函数返回覆盖所有标签/溢出数。
- **状态**：见「实施进度」表

### UI-017 工作树徽章在行后额外占一行

- **严重度**：Medium
- **证据**：`worktrees.rs:243-244` 先分配整行 40px，`:281-289` 再调用会分配空间的 `chip()`；纵向布局多出 18px，徽章不在行右端。
- **根因**：用了会分配布局的控件画行内徽章。
- **建议修复**：用 `ui.put` 固定 rect 或 painter 画到行内右侧；不向上分配。
- **回归测试**：相邻行 rect 固定相差 40px，徽章包含于行 rect。
- **状态**：见「实施进度」表

### UI-018 “发给 agent”禁用只改视觉，仍响应点击

- **严重度**：Medium
- **证据**：`center.rs:1424-1429` 用 `enabled` 只决定填充/颜色，`:1451-1460` 仍用 `send.clicked()` 保存/清空注释并关闭编辑器；`agent_target=None` 时灰按钮仍生效。
- **根因**：禁用未进入点击路径。
- **建议修复**：`ui.add_enabled(enabled, ...)` 或所有 `clicked`/关闭逻辑共享 `enabled` 条件。
- **回归测试**：`agent_target=None` 点击后 `diff_note_at` 仍为 Some、notes 不变。
- **状态**：见「实施进度」表

### UI-019 常量经 `tr(CONST)` 使用，缺英文行且 i18n 守卫扫不到

- **严重度**：Medium
- **证据**：`conversation.rs:43-49` 的 `NO_SESSION/PANE_SOURCE/LATEST_SOURCE` 经 `tr()` 使用；`i18n.rs` 无对应英文；同类 `CONTEXT_HINT`、`APP_SUBTITLE`、`LOCAL_PROJECT`、`NOTE`、`GIT_HINT`、`NO_WINDOW`。守卫 `i18n.rs:1555-1584` 只扫 `t!("…")`。
- **根因**：内容键翻译表只覆盖宏调用点。
- **建议修复**：补齐英文；守卫扫描 `tr(` 常量或逐常量断言英文不等于中文。
- **回归测试**：新增 `constants_used_with_tr_have_english_rows`。
- **状态**：见「实施进度」表

### UI-020 Agent 页头协议状态写死英文

- **严重度**：Low
- **证据**：`center.rs:1499-1504` 直接输出 `"running"` / `"not-running"`；其他 Link 状态都走 `label()`。
- **根因**：未经过 i18n，和 `AgentPane::status_line()` 重复。
- **建议修复**：复用 `status_line()`，用 `t!("运行中")`/`t!("空闲")`。
- **回归测试**：中文模式断言不含 ASCII `running`。
- **状态**：见「实施进度」表

### UI-021 Git 分支名与上游文字重叠

- **严重度**：Low
- **证据**：`right.rs:980` 分支名从 +23 起、宽 150；`:989-996` 上游从 +23+120 起；超过约 120px 的分支名会叠画。
- **根因**：两列独立硬编码。
- **建议修复**：`upstream_x = branch_x + branch_width + 8`，共享布局函数。
- **回归测试**：长分支名布局纯函数，断言上游起点 ≥ 分支右边界 + gap。
- **状态**：见「实施进度」表

### UI-022 分组箭头永远向下，“更改”组箭头点击无动作

- **严重度**：Low
- **证据**：`right.rs:1012-1020` 只画 `ChevronDown`；`right.rs:349-363` “更改”组传 `chevron=true` 但丢弃返回 head，没有 toggle。
- **根因**：箭头是装饰，组状态未参与。
- **建议修复**：`group(open: Option<bool>)`；`None` 不画箭头；始终展开的组不传箭头。
- **回归测试**：折叠/展开截图；纯函数箭头选择。
- **状态**：见「实施进度」表

### UI-023 切换语言后自动页签名不重译，出现 `Terminal 终端 1`

- **严重度**：Low
- **证据**：`state.rs:872/858/1616`、`seed.rs:180` 创建时把翻译写入 `tab.title`；`center.rs:723` 又用当前语言 `trim_start_matches(t!("终端 "))` 再拼前缀。
- **根因**：把翻译后的 UI 文案当数据保存，再二次拼接。
- **建议修复**：只存序号/种类，渲染时统一 `t!("终端 {}", n)`。
- **回归测试**：中文创建 `终端 1`，切英文后为 `Terminal 1`，不含 `终端`。
- **状态**：见「实施进度」表

### UI-024 行注释标记 `✎` 未纳入 tofu 守卫

- **严重度**：Low
- **证据**：`center.rs:1390` 绘制 `"✎"`；`tests/no_tofu_glyphs.rs:24` 的 `BANNED` 未包含它；`✓/✗` 已有方块风险注释。
- **根因**：`[INFERENCE]` 字体可能缺 U+270E。
- **建议修复**：改用 `icons.rs` 铅笔图标，或加入 `BANNED` 并替换。
- **回归测试**：加入 BANNED；shots 目检。
- **状态**：见「实施进度」表（needs runtime check）

### UI-025 新建工作区弹窗打开后不聚焦名称输入

- **严重度**：Low
- **证据**：`composer.rs:85-97` 添加两个 TextEdit 后没有 `request_focus()`；对照 `palette.rs:530-533`、`session_admin.rs:368-371`。
- **根因**：缺首次焦点请求。
- **建议修复**：`NewWorkspaceForm.focus_once`，打开后 focus `name`。
- **回归测试**：headless 打开后 `ctx.memory(|m| m.focused())` 是名称输入。
- **状态**：见「实施进度」表

### UI-026 命令面板固定 540px 高，最小窗口底部被裁

- **严重度**：Low
- **证据**：`palette.rs:468-469` `y=96, height=540`，窗口最小 560 → 636 > 560；`palette.rs:624-627` 底部提示在屏幕外；列表只占约 348px。
- **根因**：固定高度，未按 screen 夹紧。
- **建议修复**：`height = 540.min(screen.height()-y-12)`；列表用剩余高度。
- **回归测试**：900×560 下提示 rect 在 screen 内。
- **状态**：见「实施进度」表

### UI-027 状态栏时钟空闲不刷新

- **严重度**：Low
- **证据**：`statusbar.rs:147-149` 每帧取 `Local::now()`，但无定时重绘；空闲时没有帧，`HH:MM` 停在最后输入时间。
- **根因**：文本按帧取值但没有帧时钟。
- **建议修复**：`tick` 末尾按分钟边界 `request_repaint_after`。
- **回归测试**：headless 检查重绘请求 ≤60s；时钟文本随时间变化。
- **状态**：见「实施进度」表（needs runtime check）

### UI-028 历史页静默截断到 500 条

- **严重度**：Low
- **证据**：`history.rs:36` `MAX_ROWS=500`，`:67-68` `.take(MAX_ROWS)`；模块文档称“whole list”，无提示。
- **根因**：截断未反馈。
- **建议修复**：超出时底部显示“仅显示最近 500 条”，或去掉上限依赖滚动。
- **回归测试**：600 条时提示存在。
- **状态**：见「实施进度」表

---

## 3. P2：浮岛圆角视觉系统

### UI-029 主面零圆角通铺 + 发丝线，没有浮岛结构

- **严重度**：Medium
- **证据**：`left.rs:55-60`、`right.rs:40-45`、`center.rs:290-295`、`statusbar.rs:21-26`、`chrome.rs:30-35` 都是 `rect_filled(..., CornerRadius::ZERO)` + `line_segment`；`lib.rs:1866` 所有面板 `Margin::ZERO`，面板间无 gap。
- **根因**：版式模型是“列 = 通栏面板”，没有 surface/gap/elevation token。
- **建议修复**：根底 `GROUND` + 左/右/中各一张 `PANEL_2` 圆角卡（gap 8、内边距 10），去掉列边缘线；发丝线只留密集表格/设置行。
- **回归测试**：源码门禁只允许背景/dev 面板用零圆角；1440×900 截图基线。
- **状态**：见「实施进度」表

### UI-030 圆角/描边没有唯一来源

- **严重度**：Medium
- **证据**：token 只有 4/6/8，但实际 0/1/2/3/4/5/6/8/11 都在用（`widgets.rs:104`、`statusbar.rs:131`、`center.rs:179/1837`、`settings_ui.rs:1439`、`left.rs:203`、`center.rs:332`）；`chip` 写死 4；`right.rs:795` 用 `StrokeKind::Middle`，别处用 `Inside`。
- **根因**：小控件觉得 4 太方，各自加数值；无约定。
- **建议修复**：`R_CONTROL=6`、`R_PANEL=10`、`R_MODAL=14`、`R_PILL` 助手；全部控件取 token；`StrokeKind::Inside`。
- **回归测试**：源码扫描 `CornerRadius::same(<数字>)` 只允许 token；禁止 `StrokeKind::Middle`。
- **状态**：见「实施进度」表

### UI-031 头部/条带高度各自为政，跨列错位

- **严重度**：Medium
- **证据**：标题栏 36、TOPBAR 40、TOOLSTRIP 34、TABSTRIP 35、STATUSBAR 30；left/right head 44；center 34/34/26；modal head 46/52。左右第一条横线 y=44、中栏 y=40。
- **根因**：各模块自带常量。
- **建议修复**：`H_BAR=30`、`H_STRIP=34`、`H_HEAD=44`、`H_MODAL_HEAD=52`，跨列共用。
- **回归测试**：常量相等断言；截图。
- **状态**：见「实施进度」表

### UI-032 浮层层级语言不一致；会话管理固定尺寸会被最小窗口裁切

- **严重度**：Medium
- **证据**：手绘 modal 全无 shadow，egui 菜单默认重阴影；标题边距 14/16；遮罩 alpha 40/60/70/158；`settings_ui.rs:186-187` 只水平内缩；`session_admin.rs:297` 固定 680×540，900×560 内容高约 494 时上下裁约 23；遮罩从 `rect.min` 起算只盖右下。
- **根因**：8 个浮层复制粘贴，无 `modal_frame`/elevation/scrim token。
- **建议修复**：统一 `widgets::modal_frame()`（fill PANEL_3、stroke BORDER_2、R_MODAL、shadow、四边 16）；统一 `SCRIM=black α150`；尺寸 `min(size, screen-48)`；遮罩从 `screen.min` 铺满。
- **回归测试**：`modal_frame().shadow != NONE`；900×560 所有浮层 rect 在 screen 内。
- **状态**：见「实施进度」表

### UI-033 设置导航方角切进圆角，底边穿透

- **严重度**：Medium
- **证据**：`settings_ui.rs:130-140` nav 从 body.min 铺到 body.height，`CornerRadius::ZERO`；对话框 `R_MODAL=8`；左下角直角缺口。`usage/mod.rs:333-340` 地址栏同样。
- **根因**：内部面板零圆角铺到父级边缘。
- **建议修复**：nav/bar 作为内嵌 island（内缩 8–10 + R_PANEL），或按父圆角裁剪。
- **回归测试**：`shots/03` 左下角像素断言；nav 不延伸到 rect.max.y。
- **状态**：见「实施进度」表

### UI-034 列表行高亮三种样式并存

- **严重度**：Low
- **证据**：左栏 workspace/conversation 行通栏 `R_CONTROL` 圆角（`left.rs:499-511/745-755`），文件树同（`right.rs:196-200`）；agent 行 `CornerRadius::ZERO`（`left.rs:643-651`）；设置 nav 行缩进 8（`settings_ui.rs:145-159`）。
- **根因**：行 rect 直接用 available_width，无共享缩进。
- **建议修复**：统一 8pt 侧缩进 + R_CONTROL；agent 行改圆角。
- **回归测试**：行 rect min.x≥8 且 max.x≤width-8。
- **状态**：见「实施进度」表

### UI-035 工具条内圆角按钮与方角分段控件并排

- **严重度**：Low
- **证据**：`center.rs:358-370` 圆角按钮 + 1px 边框；`center.rs:319-335` 列数切换 Frame 无圆角、选中格 `CornerRadius::ZERO`。
- **根因**：分段控件手写，未复用 token。
- **建议修复**：分段控件外框 R_CONTROL/pill，内格 R_CONTROL-2，同高同底。
- **回归测试**：几何单测 + 截图。
- **状态**：见「实施进度」表

### UI-036 标题栏与左栏重复品牌/在线点

- **严重度**：Low
- **证据**：`chrome.rs:66-84` 画 zetawork + 绿点 + 工作台；`left.rs:89-101` 再画 APP_TITLE + 第二个绿点；截图可见两个 zetawork/两个点。
- **根因**：两处各自实现 brand/presence。
- **建议修复**：只保留一处品牌/在线点；左栏头只留会话管理/收起/项目标题。
- **回归测试**：截图基线。
- **状态**：见「实施进度」表

---

## 4. 浮岛 token 建议（最小实现）

| token | 现值 | 建议 |
|---|---:|---:|
| `R_CONTROL` | 4 | **6** |
| `R_PANEL` | 6 | **10** |
| `R_MODAL` | 8 | **14** |
| `R_PILL` | — | `h/2` 助手 |
| `GAP_ISLAND` | — | **8** |
| `INSET_ISLAND` | — | **10** |
| `H_BAR / H_STRIP / H_HEAD / H_MODAL_HEAD` | 30/34/35/40/44/46/52 混存 | **30 / 34 / 44 / 52** |
| `SHADOW_ISLAND` | 无 | `offset [0,6] blur 16 spread 0, black α110` |
| `SCRIM` | α40/60/70/158 | **black α150** |
| surface | PANEL→PANEL_2 只差 3–5 阶 | 岛面比底亮一档；hover/active 两级 |

优先改：

1. `theme.rs`：半径、inset、高度、间距、`visuals`（阴影、`weak_bg_fill`、System）。
2. `lib.rs:1865-1900`：列外包 island、gap、去 `no_margin`。
3. `left.rs` / `right.rs` / `center.rs`：列面、页签头、工具条、行、footer。
4. `settings_ui.rs` / `composer.rs` / `usage/mod.rs` / `update_ui.rs` / `lifecycle.rs` / `picker.rs` / `session_admin.rs` / `palette.rs`：统一 `modal_frame`。
5. `widgets.rs`：chip/badge 半径、`foot_button` tooltip/图标 hover、行高亮助手。

---

## 5. 回归门禁与验收

### 必须新增/修正

- `cargo test -p zetawork-gui --features tray,os-notify` 纳入 CI；当前 `cargo test --workspace` 默认 features 为空，tray 测试根本不编译。
- `tests/shots.rs`：1440×900 与 900×560；footer 200pt、右栏 280pt、设置 modal、会话管理三按钮。
- headless 指针测试：modal 空白不关闭、拖拽宽度持久、footer 不相交、picker 最后一行可点。
- 单元测试：`delete_path`、DELETE 请求行、`describe` 错误映射、`foot_layout`、页签几何、行 rect 缩进。
- i18n：所有新增中文 `t!` 必须有英文行；常量 `tr()` 路径纳入守卫。

### 发布前冒烟

- 关闭窗口到后台 → 托盘左键显示；右键菜单显示；菜单退出真正退出。
- 隐藏 5 秒 CPU 不应忙等。
- 默认项目会话与普通会话都能删除；二次确认；删除后列表/tab/pin 一致。
- 左右栏拖拽松手保持宽度；最小宽度下 footer/页签无重叠。
- 浅色/跟随系统主题可读（若本版本不修，则先禁用入口）。

---

## 6. 不在本报告范围

- TSP host / TSP 协议实现；本报告不引入 TSP。
- 归档会话的删除端点；当前只支持恢复。
- 托盘/通知的 Linux 桌面环境兼容性实测；本报告结论以源码和 Windows 行为为主，标注了 `needs runtime check` 的项需实机确认。
- 大规模视觉重构；本报告只给 token 级最小方向，不做信息架构重排。
