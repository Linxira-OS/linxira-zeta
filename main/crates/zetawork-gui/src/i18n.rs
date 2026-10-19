// SPDX-License-Identifier: AGPL-3.0-only
//! UI language: the Chinese source string is the key, English is the column.
//!
//! Every user-visible string in this crate stays written in Chinese at its
//! call site and is wrapped in [`t!`]. In [`Lang::Zh`] the wrapper is the
//! identity: the exact literal the code wrote is what the UI draws, so the
//! Chinese output is byte-identical to the pre-i18n build. In [`Lang::En`] the
//! same literal is looked up in [`EN`] and the English column is drawn.
//!
//! # Why content-keyed
//!
//! Invented key names (`settings.close.label`) drift from the text they name
//! and make a review of a UI change read two files. Keeping the Chinese text
//! as the key means the source stays the source of truth: changing the wording
//! changes the key, and a missing translation falls back to Chinese instead of
//! to a placeholder key.
//!
//! # Templates
//!
//! Templates use positional `{}` placeholders. [`tf`] substitutes the
//! pre-formatted arguments into the translated template; when the translation
//! has a different number of placeholders than the Chinese source it falls
//! back to formatting the Chinese template, so a bad row can never eat an
//! argument. `${}` style, named placeholders, and format specs are not
//! supported by [`tf`]; those few call sites format their values first and
//! pass the resulting strings.

use std::{
	collections::HashMap,
	sync::{LazyLock, RwLock},
};

/// The language the UI is drawn in.
///
/// Chinese is the default: it is the language every literal is authored in,
/// and an absent `lang` key in `~/.zeta/zetawork.toml` must reproduce the
/// historical output exactly.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Lang {
	/// 中文（默认）.
	#[default]
	Zh,
	/// English.
	En,
}

impl Lang {
	/// The language all [`t!`] call sites resolve against.
	pub fn current() -> Self {
		*SLOT.read().unwrap_or_else(|poisoned| poisoned.into_inner())
	}

	/// Switch the language for every subsequent frame.
	pub fn set_current(lang: Lang) {
		*SLOT
			.write()
			.unwrap_or_else(|poisoned| poisoned.into_inner()) = lang;
	}

	/// The value written to `~/.zeta/zetawork.toml`.
	pub fn key(self) -> &'static str {
		match self {
			Self::Zh => "zh",
			Self::En => "en",
		}
	}

	/// The value the file's `lang = …` line names, or `None` for anything else.
	pub fn from_key(key: &str) -> Option<Self> {
		match key.trim().trim_matches('"').to_ascii_lowercase().as_str() {
			"zh" | "cn" | "chinese" | "中文" => Some(Self::Zh),
			"en" | "english" => Some(Self::En),
			_ => None,
		}
	}

	/// The language's own name, for the switch menu. Never translated.
	pub fn label(self) -> &'static str {
		match self {
			Self::Zh => "中文",
			Self::En => "English",
		}
	}

	/// Flip to the other language.
	pub fn toggled(self) -> Self {
		match self {
			Self::Zh => Self::En,
			Self::En => Self::Zh,
		}
	}
}

/// The one process-wide language cell.
static SLOT: LazyLock<RwLock<Lang>> = LazyLock::new(|| RwLock::new(Lang::Zh));

/// The English column: (Chinese source, English).
///
/// The key is the *exact* literal passed to [`t!`] (before formatting), so a
/// template row keeps its `{}` placeholders. Rows are grouped by the module
/// that owns the text; duplicates are rejected by a unit test.
static EN: &[(&str, &str)] = &[
	(" · {} 个未能删除", " · {} could not be deleted"),
	(" · {} 条未定价", " · {} unpriced"),
	("30 天", "30 days"),
	("7 天", "7 days"),
	("Agent {} 失败或结束", "Agent {} failed or ended"),
	("Agent {} 已跑完", "Agent {} finished"),
	("Agent {} 等待你的输入", "Agent {} is waiting for your input"),
	("Agent 会话", "Agent sessions"),
	(
		"CJK 字体：未找到（中文会显示为方块；产品需内置一款授权字体）",
		"CJK font: not found (Chinese renders as boxes; the product needs a bundled licensed face)",
	),
	("CJK 字体：界面 {} · 等宽 {}", "CJK font: UI {} · mono {}"),
	(
		"CJK 字体：界面 {} · 等宽 未找到固定宽度中文字体（全角对齐可能漂移）",
		"CJK font: UI {} · no fixed-pitch CJK face (full-width alignment may drift)",
	),
	(
		"CJK 字体：界面 未找到（中文会显示为方块） · 等宽 {}",
		"CJK font: no UI face (Chinese renders as boxes) · mono {}",
	),
	("D-Bus 会话总线：{}", "D-Bus session bus: {}"),
	(
		"GUI 与 TUI 读同一份注册表。移除只删除注册，不删除目录，也不删除会话历史。",
		"The GUI and TUI read the same registry. Removing deletes the registration only — not the directory, not the session history.",
	),
	("Git for Windows 附带的 bash", "bash shipped with Git for Windows"),
	("Git 状态", "Git status"),
	("sysmon（CPU / 内存 / GPU / 进程）", "sysmon (CPU / memory / GPU / processes)"),
	("内存", "Memory"),
	("名称", "Name"),
	("正在采样…", "Sampling…"),
	("没有可用的 GPU 探针", "No GPU probe answered"),
	("还没有可读的进程", "No process could be read"),
	("资源", "Resources"),
	("进程（按 CPU）", "Processes (by CPU)"),
	("IM 渠道", "IM channel"),
	("MSYS/Cygwin/Git 附带的 bash", "bash shipped with MSYS/Cygwin/Git"),
	("WSL 发行版宿主", "WSL distro host"),
	("WebSocket 写锁已中毒", "WebSocket write lock poisoned"),
	("WebSocket 帧过大：{} 字节", "WebSocket frame too large: {} bytes"),
	("WebSocket 握手头提前结束", "WebSocket handshake headers ended early"),
	("WebSocket 握手没有应答", "WebSocket handshake got no reply"),
	("Windows PowerShell 5.1（系统自带）", "Windows PowerShell 5.1 (built in)"),
	("\nIM 回落失败：{}", "\nIM fallback failed: {}"),
	(
		"\nIM 回落：已由网关 POST /api/channels/send 投出（{}）",
		"\nIM fallback: posted by the gateway via POST /api/channels/send ({})",
	),
	("\n系统通知不可用：{}", "\nSystem notification unavailable: {}"),
	("costs 不是 JSON：{}", "costs is not JSON: {}"),
	("costs 的顶层不是对象", "costs top level is not an object"),
	("git diff --no-color HEAD（只读）", "git diff --no-color HEAD (read-only)"),
	("git status / log / rev-list（只读）", "git status / log / rev-list (read-only)"),
	("git status / log（只读）", "git status / log (read-only)"),
	("models.yml 里没有 providers 条目", "models.yml has no providers entries"),
	("overview 不是 JSON：{}", "overview is not JSON: {}"),
	("overview 的顶层不是对象", "overview top level is not an object"),
	("overview 缺少 overall 对象", "overview has no overall object"),
	("serve 拒绝 WebSocket 升级：{}", "serve refused the WebSocket upgrade: {}"),
	("serve 拒绝 resize（{}）：{}", "serve refused resize ({}): {}"),
	("serve 拒绝终端 attach（{}）：{}", "serve refused terminal attach ({}): {}"),
	("serve 未应答，已回落本地 PTY", "serve did not answer; fell back to a local PTY"),
	(
		"serve 的 Sec-WebSocket-Accept 与客户端密钥不匹配",
		"serve's Sec-WebSocket-Accept does not match the client key",
	),
	(
		"serve 的握手应答缺少 Connection: Upgrade",
		"serve's handshake reply is missing Connection: Upgrade",
	),
	(
		"serve 的握手应答缺少 Sec-WebSocket-Accept",
		"serve's handshake reply is missing Sec-WebSocket-Accept",
	),
	(
		"serve 的握手应答缺少 Upgrade: websocket",
		"serve's handshake reply is missing Upgrade: websocket",
	),
	("serve 的终端 WebSocket 已关闭", "serve's terminal WebSocket closed"),
	("serve 的终端 attach 应答没有 id：{}", "serve's terminal attach reply has no id: {}"),
	("serve 终端已退出", "serve terminal exited"),
	("serve 终端已退出（code {}）", "serve terminal exited (code {})"),
	("serve 终端结束（{}）", "serve ended the terminal ({})"),
	("serve 结束了终端会话（{}）", "serve ended the terminal session ({})"),
	("stats 应答无法解析：{}", "stats reply could not be parsed: {}"),
	(
		"stats 服务未启动：zetacode serve 未在监听 {}",
		"stats service is not running: zetacode serve is not listening on {}",
	),
	("stats 返回 HTTP {}", "stats returned HTTP {}"),
	("stats 返回 HTTP {}：{}", "stats returned HTTP {}: {}"),
	("status 不是 JSON：{}", "status is not JSON: {}"),
	("status 的顶层不是对象", "status top level is not an object"),
	("token 用量 · {}", "token usage · {}"),
	(
		"zetacode serve 的 SSE 会话流（/api/agent/<id>/events）",
		"zetacode serve SSE session stream (/api/agent/<id>/events)",
	),
	(
		"zetacode 会话存储（~/.zeta/agent/agent.db）",
		"zetacode session store (~/.zeta/agent/agent.db)",
	),
	("zetacode 的选项", "zetacode options"),
	("zetacode 选项 · ~/.zeta/agent/config.yml", "zetacode options · ~/.zeta/agent/config.yml"),
	("zetacode 选项未读取", "zetacode options not read"),
	("zetawork — 工作台在后台运行", "zetawork — workbench running in the background"),
	("zetawork 自己", "zetawork itself"),
	("{} · baseUrl 写回 models.yml", "{} · baseUrl written back to models.yml"),
	("{} · {} token · {} 次请求 · {}", "{} · {} tokens · {} requests · {}"),
	("{} · {} · {} · 编辑器 {}px · 终端 {}px", "{} · {} · {} · editor {}px · terminal {}px"),
	("{} · {} 已空闲", "{} · {} idle"),
	("{} · {} 已退出", "{} · {} exited"),
	("{} · {}（未保存）", "{} · {} (unsaved)"),
	("{} · 嵌入不可用：{}", "{} · embed unavailable: {}"),
	("{} 不是 http 地址", "{} is not an http address"),
	(
		"{} 不是 http:// 地址（本机网关不走 TLS）",
		"{} is not an http:// address (the local gateway does not use TLS)",
	),
	("{} 不是以 / 开头的路径", "{} is not a path starting with /"),
	("{} 不是本机 http 地址，未投递", "{} is not a local http address; not delivered"),
	("{} 不是本机回环地址", "{} is not a loopback address"),
	("{} 个工作区", "{} workspaces"),
	("{} 个文件 · {} 个目录", "{} files · {} directories"),
	("{} 个模型", "{} models"),
	("{} 是目录，编辑器只打开文件", "{} is a directory; the editor only opens files"),
	("{} 没有 scheme", "{} has no scheme"),
	("{} 没有主机名", "{} has no host name"),
	("{} 没有值（未设置）", "{} has no value (unset)"),
	("{} 没有端口", "{} has no port"),
	("{} 的 IPv6 地址不完整", "{} has an incomplete IPv6 address"),
	("{} 的 stats 汇总", "stats summary for {}"),
	("{} 的应答没有状态行", "{} reply has no status line"),
	("{} 的端口不是数字", "{} port is not a number"),
	("{} 行", "{} lines"),
	("{} 读取", "Read at {}"),
	("{}:{} 没有可用地址", "{}:{} has no usable address"),
	("{}×{} 格 · 单元 {}×{}pt · 字体 {}pt", "{}×{} grid · cell {}×{}pt · font {}pt"),
	("三列", "Three columns"),
	("上一条分片消息尚未结束", "the previous fragmented message is still open"),
	("上下文", "Context"),
	("上文 {}%", "Ctx {}%"),
	("上文 —", "Ctx —"),
	("不在 ~/.zeta 内，已跳过", "not under ~/.zeta; skipped"),
	("不支持的 WebSocket opcode {}", "unsupported WebSocket opcode {}"),
	("不是 git 仓库", "not a git repository"),
	("与 HEAD 没有差异", "No diff against HEAD"),
	(
		"与上游的差异（git rev-list --left-right）",
		"Diff against upstream (git rev-list --left-right)",
	),
	("两列", "Two columns"),
	(
		"个别 provider 没有 baseUrl：models.yml 里的 apiKey 指向环境变量，缺项不补默认值。",
		"Some providers have no baseUrl: models.yml points apiKey at environment variables, and missing entries get no default.",
	),
	("中途被打断", "Interrupted"),
	("主题", "Theme"),
	(
		"事件流已关闭（serve 未返回 200，或连接提前断开）",
		"Event stream closed (serve did not return 200, or the connection dropped early)",
	),
	("事件流已结束", "Event stream ended"),
	("仅后台", "Background only"),
	("今天", "Today"),
	("从侧边栏中选择一个工作区开始", "Pick a workspace from the sidebar to start"),
	("从注册表移除", "Remove from registry"),
	("会话", "Session"),
	("会话 id", "Session id"),
	("会话 id 为空", "session id is empty"),
	(
		"会话与后台任务仍在运行，选择怎么处理这个窗口。",
		"Sessions and background tasks are still running. How should this window close?",
	),
	("会话失败或结束", "Session failed or ended"),
	("会话日志里还没有 usage 条目", "No usage entries in the session log yet"),
	("你：", "You:"),
	("保存", "Save"),
	("保存失败：{}", "Save failed: {}"),
	("信息密度", "Density"),
	("先打开一个工作区", "Open a workspace first"),
	("先打开一个工作区，再打开文件", "Open a workspace before opening a file"),
	("先选择一个项目", "Pick a project first"),
	("关", "Off"),
	("关于", "About"),
	("关闭", "Close"),
	("关闭 WebSocket 失败：{}", "Close WebSocket failed: {}"),
	("关闭右侧栏", "Hide right sidebar"),
	("关闭标签页", "Close tab"),
	("关闭窗口", "Close window"),
	("关闭窗口时", "On window close"),
	("关闭面板", "Close pane"),
	("关闭面板与列表的过渡动画", "Turn off panel and list transitions"),
	("写入 WebSocket 失败：{}", "Write to WebSocket failed: {}"),
	("写入 zetacode 配置失败：{}", "Writing zetacode settings failed: {}"),
	("写入失败：{}", "Write failed: {}"),
	("减少动态效果", "Reduce motion"),
	("分块应答缺少长度行", "chunked reply has no length line"),
	("分块比声明的长度短", "chunk is shorter than declared"),
	("分块长度 {} 无效", "chunk length {} is invalid"),
	("分块长度不是 ASCII", "chunk length is not ASCII"),
	("分屏", "Split"),
	("分支 {}", "Branch {}"),
	("创建大标签页", "New big tab"),
	("创建工作区", "New workspace"),
	(
		"删除 {} 个路径：~/.zeta/zetawork/workspaces 与各项目会话日志；保留 projects.json、项目目录与 agent 配置",
		"Delete {} paths: ~/.zeta/zetawork/workspaces and each project's session log; projects.json, project directories and agent config are kept",
	),
	("刷新失败：{}（显示上次数据）", "Refresh failed: {} (showing the previous data)"),
	("助手：", "Assistant:"),
	("区间", "Range"),
	("区间总费用", "Range total cost"),
	("单列", "One column"),
	("单实例锁文件写不进（{}）", "cannot write the single-instance lock ({})"),
	("历史 · Agent 对话", "History · Agent chat"),
	("原因：{}", "Reason: {}"),
	("发送 WebSocket 握手失败：{}", "Send WebSocket handshake failed: {}"),
	("发送 {} 失败：{}", "Send {} failed: {}"),
	("发送请求失败：{}", "Send request failed: {}"),
	("取消", "Cancel"),
	(
		"另一个 zetawork 刚刚启动（单实例竞态）",
		"another zetawork just started (single-instance race)",
	),
	("另有 {} 类未显示", "{} more kinds not shown"),
	(
		"只有注册项目的首个标签页会持久化命名（本机与新建标签页仅在本次运行有效）",
		"Only the first tab of a registered project persists its name (local and new tabs last only this run)",
	),
	("只读", "read-only"),
	("同步 {}{}", "Sync {}{}"),
	("同步错误 {}", "Sync error {}"),
	("后台任务已空闲", "Background task idle"),
	(
		"后台任务空闲、需要输入或失败时的提示；仅后台 = 只在窗口不在前台时提示",
		"Shown when a background task idles, needs input, or fails; background only = only while the window is not in front",
	),
	("后台值守（等外部信号 / 定时任务）", "Background watch (waits for external signals / timers)"),
	("后端：serve", "Backend: serve"),
	("后端：serve · 会话已结束", "Backend: serve · session ended"),
	("后端：serve · 连接中…", "Backend: serve · connecting…"),
	("后端：本地 PTY", "Backend: local PTY"),
	("向下还原", "Restore down"),
	("命令提示符", "Command Prompt"),
	("回到首页", "Back to home"),
	("回环端口 {} 绑定失败（{}）", "cannot bind loopback port {} ({})"),
	("在左侧显示行号栏", "Show the gutter on the left"),
	("在文件管理器中打开", "Open in file manager"),
	(
		"在等你批准（最高优先级，盖过其它）",
		"Waiting for your approval (highest priority, overrides the rest)",
	),
	("地址不可读取：{}", "address unreadable: {}"),
	("复制 API 根", "Copy API root"),
	("复制 WebSocket 套接字失败：{}", "Clone WebSocket socket failed: {}"),
	("复制地址", "Copy address"),
	("外观", "Appearance"),
	(
		"外观 / 编辑器 / 终端 / 快捷键 四节写 ~/.zeta/zetawork.toml",
		"Appearance / Editor / Terminal / Keys write ~/.zeta/zetawork.toml",
	),
	("大标签页 {}/{} · 子页上限 {}", "Big tabs {}/{} · pane limit {}"),
	("失败", "Failed"),
	("字号", "Font size"),
	("完成且已确认", "Done and confirmed"),
	("容器", "Container"),
	("宽松", "Spacious"),
	("展开左侧栏", "Show left sidebar"),
	("展开状态栏", "Expand status bar"),
	("工作区目录（本地 read_dir）", "Workspace directory (local read_dir)"),
	("工作区里的真实文件（读 + 写）", "Real files in the workspace (read + write)"),
	("工具：", "Tool:"),
	(
		"左栏底部的 用量 打开 stats 页面容器（地址来自 ~/.zeta/serve.json）",
		"Usage at the bottom-left opens the stats container (address from ~/.zeta/serve.json)",
	),
	("差异比较器", "Diff"),
	("已从注册表移除 {}（目录未删除）", "Removed {} from the registry (directory not deleted)"),
	("已保存 {}", "Saved {}"),
	("已保存 {} 个文件", "Saved {} files"),
	("已写入 models.yml：{}.baseUrl", "Wrote models.yml: {}.baseUrl"),
	("已写入 zetacode 配置：{} = {}", "Wrote zetacode settings: {} = {}"),
	("已打开「{}」", "Opened “{}”"),
	("已添加项目：{}", "Added project: {}"),
	(
		"已清除 {} 个路径 · {} 个文件 · {} 个目录 · {}",
		"Cleared {} paths · {} files · {} directories · {}",
	),
	("已聚焦当前窗口", "Focused the current window"),
	("已读取 {} 项 zetacode 选项", "Read {} zetacode options"),
	("已连接", "Connected"),
	("已重命名为 {}", "Renamed to {}"),
	("已重命名为 {}（仅本次运行）", "Renamed to {} (this run only)"),
	(
		"帮助：⌘K 搜索 · ⌘B 切换侧栏 · 设置内可管理项目",
		"Help: Ctrl K search · Ctrl B sidebar · manage projects in Settings",
	),
	("常规", "General"),
	("平均吞吐", "Avg throughput"),
	("应答不是 UTF-8：{}", "reply is not UTF-8: {}"),
	("应答没有状态行", "reply has no status line"),
	("应答没有空行分隔的头部与正文", "reply has no blank line between headers and body"),
	("开机自启", "Start at login"),
	("快捷键", "Shortcuts"),
	("总是", "Always"),
	("总计", "Total"),
	("总面板", "Overview"),
	("成功 {} · 失败 {}", "{} ok · {} failed"),
	("打不开文件：{}", "Cannot open file: {}"),
	("打开 Git 状态", "Open Git status"),
	("打开设置", "Open settings"),
	("托盘图标 + 第二次运行", "Tray icon + second launch"),
	("托盘图标建不起来（{}）", "Cannot build the tray icon ({})"),
	("托盘图标画不出来（{}）", "Cannot draw the tray icon ({})"),
	("托盘菜单建不起来（{}）", "Cannot build the tray menu ({})"),
	(
		"找不到用户目录（USERPROFILE / HOME 都为空）",
		"Cannot find the home directory (USERPROFILE / HOME are both empty)",
	),
	(
		"找不到用户目录（USERPROFILE / HOME 都为空），无法定位 ~/.zeta",
		"Cannot find the home directory (USERPROFILE / HOME are both empty), so ~/.zeta cannot be located",
	),
	("拆分面板", "Split pane"),
	("按 Agent 类型", "By agent type"),
	("控制面板与列表的行距", "Row spacing of panels and lists"),
	("提交", "Commits"),
	("收到没有起始帧的 continuation", "received a continuation without a start frame"),
	("收起左侧栏", "Hide left sidebar"),
	("收起状态栏", "Collapse status bar"),
	("改动", "Changes"),
	("数据与存储", "Data & storage"),
	("数据与存储 · ~/.zeta", "Data & storage · ~/.zeta"),
	("文件树", "File tree"),
	("断开", "Disconnect"),
	("新工作区 {}", "New workspace {}"),
	("新建大标签页", "New big tab"),
	("新建大标签页 · 选择要打开的内容", "New big tab · pick what to open"),
	("新建工作区", "New workspace"),
	("新建标签页", "New tab"),
	("新建标签页 · 选择要打开的内容", "New tab · pick what to open"),
	("新建终端", "New terminal"),
	("新建终端会话", "New terminal session"),
	("新建终端时启动的程序（本机探测）", "Program a new terminal starts (detected on this machine)"),
	("无上游分支", "No upstream branch"),
	("无模型", "No model"),
	(
		"无法启动随包的 zetacode：{}（PTY 创建失败）",
		"Cannot start the bundled zetacode: {} (PTY creation failed)",
	),
	("无法定位运行目录", "Cannot locate the run directory"),
	("无法定位运行目录（{}）", "Cannot locate the run directory ({})"),
	("无法读取 git diff：{}", "Cannot read git diff: {}"),
	("无法读取 git 状态：{}", "Cannot read git status: {}"),
	("显示窗口", "Show window"),
	("显示行号", "Show line numbers"),
	("更改", "Changed"),
	("最后一条", "Last message"),
	("最多分屏 {} 列", "At most {} split columns"),
	("最大化", "Maximize"),
	("最小化", "Minimize"),
	("最小化到后台", "Minimize to background"),
	("最近一次请求", "Last request"),
	("服务商配置 · ~/.zeta/agent/models.yml", "Provider config · ~/.zeta/agent/models.yml"),
	("未发现 ~/.zeta/serve.json 的 webUrl", "webUrl not found in ~/.zeta/serve.json"),
	("未定价", "Unpriced"),
	("未定价 {} 次", "{} unpriced"),
	("未打开文件", "No file open"),
	("未找到", "Not found"),
	("未找到随包的 {}：{}", "Bundled {} not found: {}"),
	("未知错误", "Unknown error"),
	("未跟踪文件", "Untracked files"),
	("未连接", "Disconnected"),
	("未选择工作区", "No workspace selected"),
	("本地时间", "Local time"),
	(
		"本实现按 temp/zetawork-ui-mock 的 v2 规格绘制",
		"This build follows the v2 spec of temp/zetawork-ui-mock",
	),
	("本机 Shell", "Local Shell"),
	(
		"本机 shell（真实 PTY：本进程或 zetacode serve）",
		"Local shell (real PTY: this process or zetacode serve)",
	),
	(
		"本机 是当前目录，不在项目注册表里",
		"Local is the current directory, not in the project registry",
	),
	(
		"本机把规格里的 ⌘ 映射为 Ctrl；TUI 视图用 Tab 切换面板、q 退出。",
		"This host maps the spec's ⌘ to Ctrl; the TUI view uses Tab to switch panes and q to quit.",
	),
	("本机没有探测到任何 shell", "No shell detected on this machine"),
	("本机默认", "Local default"),
	(
		"本构建未启用 os-notify（或该系统没有实现）",
		"This build has no os-notify (or this system does not implement it)",
	),
	("本进程常驻内存（sysinfo）", "Resident memory of this process (sysinfo)"),
	("标准", "Standard"),
	("标签页名不能为空", "Tab name cannot be empty"),
	("标题", "Title"),
	(
		"标题栏关闭键的行为；最小化到后台时会话与后台任务继续运行",
		"What the title bar's close button does; minimizing to the background keeps sessions and background tasks running",
	),
	("桌面应用的服务商配置", "Desktop app provider config"),
	("模型", "Model"),
	("正在写入 {} = {}…", "Writing {} = {}…"),
	("正在后台运行", "Running in background"),
	("正在干", "Working"),
	("正在读取 git 状态…", "Reading git status…"),
	("正在读取 zetacode 选项…", "Reading zetacode options…"),
	("正在读取 {} …", "Reading {} …"),
	("正在读取…", "Reading…"),
	("此区间没有 agent 类型记录", "No agent-type records in this range"),
	("此区间没有 token 记录", "No token records in this range"),
	("每个面板最多 {} 个子页（子页上限 {}）", "At most {} subpages per pane (subpage limit {})"),
	("每个项目最多 {} 个工作区（大标签页）", "At most {} workspaces per project (big tabs)"),
	("每个项目至少保留一个工作区", "Each project keeps at least one workspace"),
	("每次询问", "Ask every time"),
	(
		"没有找到工作区记忆（工作区状态与项目会话日志都已为空）",
		"No workspace memory found (workspace state and project session logs are both empty)",
	),
	("没有权限", "Permission denied"),
	("没有这个工作区：{}", "No such workspace: {}"),
	("没有这个面板：{}", "No such pane: {}"),
	("没有这个项目：{}", "No such project: {}"),
	("注册表里没有这个项目：{}", "The registry has no such project: {}"),
	("活动会话的日志（~/.zeta/agent/sessions）", "Active session log (~/.zeta/agent/sessions)"),
	("流已结束", "Stream ended"),
	("浅色", "Light"),
	("深色（默认）", "Dark (default)"),
	("添加", "Add"),
	("添加项目", "Add project"),
	("添加项目失败：{}", "Add project failed: {}"),
	("清除所有工作区记忆", "Clear all workspace memory"),
	("清除读超时失败：{}", "Clear read timeout failed: {}"),
	("版本 {} · 纯 Rust 桌面工作台", "Version {} · pure-Rust desktop workbench"),
	("状态栏已展开", "Status bar expanded"),
	("状态栏已收起", "Status bar collapsed"),
	("状态栏留痕", "Status bar trace"),
	("用量", "Usage"),
	("用量统计", "Usage stats"),
	("界面与等宽中文字形来源", "Interface and mono CJK face sources"),
	("界面整体配色方案", "Overall color scheme"),
	("界面规格", "UI spec"),
	(
		"登录时启动 zetawork（需要安装自启项，本构建只记录这个选择）",
		"Start zetawork at login (needs an autostart entry; this build only records the choice)",
	),
	("目录不存在", "Directory does not exist"),
	("移除", "Remove"),
	("移除项目失败：{}", "Remove project failed: {}"),
	("窗口在前台", "Window in front"),
	("窗口未知，不显示占比", "Window unknown; share not shown"),
	(
		"第二次运行 zetawork（托盘图标没建起来，见下面的驻留提示）",
		"Second zetawork launch (the tray icon was not built; see the residency note below)",
	),
	("第二次运行 zetawork（本构建没有编译托盘）", "Second zetawork launch (this build has no tray)"),
	("等宽字体", "Mono font"),
	("等宽字体：{}", "Mono font: {}"),
	(
		"等宽字体：{} 未安装，回退到 CJK 等宽字体",
		"Mono font: {} is not installed; falling back to the CJK mono face",
	),
	("等宽字体：回退到 CJK 等宽字体", "Mono font: falling back to the CJK mono face"),
	("等待你的输入", "Waiting for your input"),
	("管理", "Manage"),
	(
		"管理 一节里的 providers，写 ~/.zeta/agent/models.yml",
		"providers under Manage write ~/.zeta/agent/models.yml",
	),
	("管理项目与工作区", "Manage projects and workspaces"),
	("类型", "Type"),
	("系统通知", "System notification"),
	("紧凑", "Compact"),
	("终端", "Terminal"),
	("终端 ", "Terminal "),
	("终端 {}", "Terminal {}"),
	("终端子进程已结束", "The terminal child process ended"),
	("终端字号", "Terminal font size"),
	("终端没有启动", "Terminal did not start"),
	("终端输出文本大小", "Terminal output text size"),
	(
		"经 zetacode config list --json 读取（Node CLI，约 1.5 秒）",
		"Read via zetacode config list --json (Node CLI, about 1.5s)",
	),
	("缓存写 {}", "Cache write {}"),
	("缓存读 {}", "Cache read {}"),
	("编辑器", "Editor"),
	(
		"编辑器 一节里的 5 项，经 zetacode config set 写 ~/.zeta/agent/config.yml",
		"The 5 rows under Editor write ~/.zeta/agent/config.yml via zetacode config set",
	),
	("编辑器与终端使用的字体", "Font used by the editor and terminal"),
	("编辑器文本大小", "Editor text size"),
	("编辑器等宽字体", "Editor mono font"),
	("网关返回 {}", "Gateway returned {}"),
	("网关返回 {}：{}", "Gateway returned {}: {}"),
	("自动换行", "Wrap long lines"),
	("自动检测的 shell", "Auto-detected shell"),
	("至少保留一个小标签页", "Keep at least one small tab"),
	("至少保留一个面板", "Keep at least one pane"),
	("行 {}, 列 {}", "Line {}, column {}"),
	("解析 {}:{} 失败：{}", "Parse {}:{} failed: {}"),
	("记住我的选择，不再询问", "Remember my choice and stop asking"),
	("设置", "Settings"),
	("设置保存失败：{}", "Saving settings failed: {}"),
	("设置写超时失败：{}", "Set write timeout failed: {}"),
	("设置握手写超时失败：{}", "Set handshake write timeout failed: {}"),
	("设置握手读超时失败：{}", "Set handshake read timeout failed: {}"),
	("设置读超时失败：{}", "Set read timeout failed: {}"),
	("该面板的子进程都退出了", "All child processes of this pane have exited"),
	(
		"说自己干完了，但没验证 —— 不等于 done",
		"Says it is done, but has not verified — not the same as done",
	),
	("请求", "Requests"),
	("请输入项目目录", "Enter a project directory"),
	("读写", "read/write"),
	("读取 WebSocket 失败：{}", "Read WebSocket failed: {}"),
	("读取 WebSocket 帧头失败：{}", "Read WebSocket frame header failed: {}"),
	("读取 WebSocket 帧长失败：{}", "Read WebSocket frame length failed: {}"),
	("读取 WebSocket 掩码失败：{}", "Read WebSocket mask failed: {}"),
	("读取 WebSocket 握手头失败：{}", "Read WebSocket handshake headers failed: {}"),
	("读取 WebSocket 握手应答失败：{}", "Read WebSocket handshake reply failed: {}"),
	("读取 WebSocket 载荷失败：{}", "Read WebSocket payload failed: {}"),
	("读取 stats 失败：{}", "Reading stats failed: {}"),
	("读取 zetacode 选项", "Read zetacode options"),
	("读取 zetacode 选项失败：{}", "Reading zetacode options failed: {}"),
	("读取 {} 应答失败：{}", "Read {} reply failed: {}"),
	("读取失败：{}", "Read failed: {}"),
	("读取应答失败：{}", "Reading reply failed: {}"),
	("读取线程提前结束", "reader thread ended early"),
	("费用", "Cost"),
	("跟随系统", "Follow system"),
	("输入", "Input"),
	("输入 token", "Input tokens"),
	("输出", "Output"),
	("输出 token", "Output tokens"),
	("运行中会话 0", "Sessions running 0"),
	("运行中会话 {}", "Sessions running {}"),
	("近 24 小时", "24 hours"),
	("近 30 天", "30 days"),
	("近 7 天", "7 days"),
	("还没有 ~/.zeta", "No ~/.zeta yet"),
	("还没有会话状态", "No session state yet"),
	(
		"还没有会话记录；新的 durable entry 会出现在这里。",
		"No session records yet; new durable entries appear here.",
	),
	("还没有对话记录", "No conversation yet"),
	("还没有打开文件", "No file open yet"),
	("还没有提交", "No commits yet"),
	(
		"还没有注册项目。左侧 项目 一节的 ＋ 可以选择一个目录。",
		"No projects registered yet. The ＋ next to Projects on the left picks a directory.",
	),
	("还没有连接会话", "No session connected yet"),
	("这一轮跑完了", "This turn finished"),
	("这个标签页已经关闭", "This tab is already closed"),
	("这个标签页没有打开文件", "This tab has no open file"),
	("这个页面没有 zetacode 程序", "This page has no zetacode program"),
	("连接", "Connect"),
	("连接 {}:{} 失败：{}", "Connect {}:{} failed: {}"),
	("连接中", "Connecting"),
	("连接失败", "Connection failed"),
	("连接失败：{}", "Connection failed: {}"),
	("退出 zetawork", "Quit zetawork"),
	("退出应用", "Quit application"),
	("通知", "Notifications"),
	("通知：{}", "Notification: {}"),
	("重命名", "Rename"),
	("重命名、打开或移除已注册的项目", "Rename, open or remove registered projects"),
	("重命名失败：{}", "Rename failed: {}"),
	("重新读取 git 状态", "Re-read git status"),
	("重新读取会话用量", "Re-read session usage"),
	("重新读取用量", "Re-read usage"),
	("重新读取目录", "Re-read directory"),
	("错误：", "Error:"),
	("长行在视口内折行显示", "Wrap long lines inside the viewport"),
	("降级", "Degraded"),
	(
		"随包的 zetacode（packages/coding-agent/dist/zeta）",
		"Bundled zetacode (packages/coding-agent/dist/zeta)",
	),
	("页面", "Page"),
	("项目", "Project"),
	("项目名不能为空", "Project name cannot be empty"),
	("项目注册表 · ~/.zeta/projects.json", "Project registry · ~/.zeta/projects.json"),
	("项目注册表读取失败：{}", "Reading the project registry failed: {}"),
	("项目目录", "Project directory"),
	("首字 {} ms", "TTFT {} ms"),
	("首字 —", "TTFT —"),
	("驻留提示", "Residency note"),
	("驻留状态", "Residency state"),
	("默认 Shell", "Default Shell"),
	("（无）", "(none)"),
	("（未命名会话）", "(unnamed session)"),
	("（未设置）", "(unset)"),
	("语言：{}", "Language: {}"),
	("飞书", "Feishu"),
	("{} · {} · 目标：{}", "{} · {} · target: {}"),
];

/// The lookup table, built once from [`EN`].
fn table() -> &'static HashMap<&'static str, &'static str> {
	static TABLE: LazyLock<HashMap<&'static str, &'static str>> =
		LazyLock::new(|| EN.iter().copied().collect());
	&TABLE
}

/// Translate a fixed string.
///
/// In [`Lang::Zh`] this returns the input unchanged — the same `&'static str`
/// the code wrote, so the Chinese rendering is byte-identical. An English
/// lookup that misses also falls back to the Chinese source.
pub fn tr(zh: &'static str) -> &'static str {
	tr_in(Lang::current(), zh)
}

/// [`tr`] with the language supplied instead of read from the global cell.
fn tr_in(lang: Lang, zh: &'static str) -> &'static str {
	if lang == Lang::Zh {
		return zh;
	}
	table().get(zh).copied().unwrap_or(zh)
}

/// Translate a `{}`-bearing template and substitute `args` positionally.
///
/// The translated template is used only when it has the same number of `{}`
/// placeholders as the Chinese source; otherwise the Chinese template is
/// formatted, matching the briefing's fallback rule.
pub fn tf(zh: &'static str, args: &[String]) -> String {
	tf_in(Lang::current(), zh, args)
}

/// [`tf`] with the language supplied instead of read from the global cell.
fn tf_in(lang: Lang, zh: &'static str, args: &[String]) -> String {
	if lang == Lang::Zh {
		return fill(zh, args);
	}
	match table().get(zh).copied() {
		Some(en) if placeholders(en) == placeholders(zh) => fill(en, args),
		_ => fill(zh, args),
	}
}

/// Count the positional `{}` placeholders, ignoring `{{`/`}}` escapes.
fn placeholders(template: &str) -> usize {
	let mut count = 0;
	let mut chars = template.chars().peekable();
	while let Some(ch) = chars.next() {
		match ch {
			'{' if chars.peek() == Some(&'{') => {
				chars.next();
			},
			'{' => count += 1,
			'}' if chars.peek() == Some(&'}') => {
				chars.next();
			},
			_ => {},
		}
	}
	count
}

/// Substitute the arguments into the `{}` slots, left to right.
///
/// Extra arguments are appended in parentheses rather than silently dropped;
/// that only happens when a caller forgets about a fallback, and losing the
/// value would hide the bug.
fn fill(template: &str, args: &[String]) -> String {
	let mut out = String::with_capacity(template.len() + 16);
	let mut rest = template;
	let mut used = 0;
	while let Some(index) = rest.find("{}") {
		out.push_str(&rest[..index]);
		match args.get(used) {
			Some(arg) => out.push_str(arg),
			None => out.push_str("{}"),
		}
		used += 1;
		rest = &rest[index + 2..];
	}
	out.push_str(rest);
	if used < args.len() {
		out.push_str(" (");
		for (index, arg) in args[used..].iter().enumerate() {
			if index > 0 {
				out.push_str(", ");
			}
			out.push_str(arg);
		}
		out.push(')');
	}
	out
}

/// The `Display` rendering the [`t!`] macro passes as a format argument.
///
/// Taking the argument by reference lets the macro accept both owned values
/// and expressions without moving them twice.
#[doc(hidden)]
pub fn arg<T: std::fmt::Display + ?Sized>(value: &T) -> String {
	value.to_string()
}

/// Translate a Chinese UI string, with optional positional format arguments.
///
/// ```text
/// use zetawork_gui::t;
/// let label = t!("等待你的输入");
/// let line = t!("Agent {} 已跑完", 7);
/// assert_eq!(label, "等待你的输入");
/// assert_eq!(line, "Agent 7 已跑完");
/// ```
#[macro_export]
macro_rules! t {
	($zh:literal $(,)?) => {
		$crate::i18n::tr($zh)
	};
	($zh:literal, $($arg:expr),+ $(,)?) => {
		$crate::i18n::tf($zh, &[$($crate::i18n::arg(&$arg)),+])
	};
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn chinese_is_the_identity() {
		assert_eq!(tr_in(Lang::Zh, "等待你的输入"), "等待你的输入");
		assert_eq!(tf_in(Lang::Zh, "Agent {} 已跑完", &["7".to_owned()]), "Agent 7 已跑完");
	}

	#[test]
	fn english_uses_the_table_and_falls_back() {
		assert_eq!(tr_in(Lang::En, "等待你的输入"), "Waiting for your input");
		assert_eq!(tr_in(Lang::En, "设置"), "Settings");
		assert_eq!(tf_in(Lang::En, "Agent {} 已跑完", &["7".to_owned()]), "Agent 7 finished");
		assert_eq!(tr_in(Lang::En, "未在表里"), "未在表里");
	}

	#[test]
	fn placeholders_are_counted_without_escapes() {
		assert_eq!(placeholders("a {} b {}"), 2);
		assert_eq!(placeholders("{{}} {}"), 1);
		assert_eq!(placeholders("no slots"), 0);
	}

	#[test]
	fn fill_substitutes_left_to_right() {
		assert_eq!(fill("{} + {} = {}", &["1".into(), "2".into(), "3".into()]), "1 + 2 = 3");
	}

	#[test]
	fn every_row_is_unique() {
		let mut seen = std::collections::HashSet::new();
		for (zh, _) in EN {
			assert!(seen.insert(*zh), "duplicate translation row for {zh:?}");
		}
	}

	#[test]
	fn translations_keep_the_placeholder_count() {
		for (zh, en) in EN {
			assert_eq!(placeholders(zh), placeholders(en), "placeholder drift in {zh:?} → {en:?}");
			assert!(!en.is_empty(), "empty translation for {zh:?}");
		}
	}

	#[test]
	fn the_language_round_trips_through_its_key() {
		for lang in [Lang::Zh, Lang::En] {
			assert_eq!(Lang::from_key(lang.key()), Some(lang));
		}
		assert_eq!(Lang::from_key("klingon"), None);
	}
}
