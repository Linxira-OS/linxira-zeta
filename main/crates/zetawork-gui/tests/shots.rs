// SPDX-License-Identifier: AGPL-3.0-only
//! Headless screenshots of the shell.
//!
//! This renders the real shell — real theme, real fonts, real state, the same
//! `Shell::tick`/`Shell::draw` the window runs — into an offscreen egui context
//! and rasterizes the result with [`raster`]. **No window is created**, so the
//! run cannot steal focus: it is `Context::run` → tessellate → CPU rasterizer →
//! PNG (see `tests/support/raster.rs`).
//!
//! Run it explicitly, since it writes files:
//!
//! ```text
//! cargo +1.91.1-x86_64-pc-windows-gnu test -p zetawork-gui --test shots -- --ignored --nocapture
//! ```
//!
//! The PNGs land in `<worktree>/shots/` (i.e.
//! `temp/zetawork-gui-shell/shots/`), which is inside the git-ignored `temp/`
//! tree.

#[path = "support/raster.rs"]
mod raster;

use std::path::PathBuf;

use egui::{Color32, Rect, pos2, vec2};
use zetawork_gui::{Shell, fonts, settings::Settings, state::AppState, theme};

/// The window size the screenshots pretend the user has.
const SIZE: [f32; 2] = [1440.0, 900.0];

/// Where the PNGs go: `<worktree>/shots`.
///
/// `ZETA_SHOTS_DIR` overrides it. The PNGs are build output, not source, and
/// the worktree's `shots/` is **not** git-ignored, so pointing this at a
/// directory outside the checkout is how you generate them without leaving the
/// tree dirty.
fn shots_dir() -> PathBuf {
	if let Some(dir) = std::env::var_os("ZETA_SHOTS_DIR") {
		return PathBuf::from(dir);
	}
	let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
	// …/main/crates/zetawork-gui → the worktree root
	let root = manifest
		.parent()
		.and_then(|p| p.parent())
		.and_then(|p| p.parent())
		.map(PathBuf::from)
		.unwrap_or(manifest);
	root.join("shots")
}

/// A shell whose state is the shipped default: 本机 open, **one** pane in one
/// column (the maintainer's ruling: a fresh workspace is not pre-split), the
/// 总面板 as the selected 大标签页 and the right column on 用量.
fn ready_shell() -> Shell {
	let cwd = std::env::current_dir().expect("cwd");
	let state = AppState::seeded_with_registry(
		&cwd,
		workbench_projects::Registry::empty_at(
			std::env::temp_dir()
				.join(format!("zetawork-gui-shots-{}", std::process::id()))
				.join("projects.json"),
		),
	);
	Shell::with_state(state, Settings::default())
}

/// Select the active workspace's 大标签页, so a shot that is about the pane
/// grid shows the pane grid: the shipped default opens on 总面板 instead.
fn workspace_page(shell: &mut Shell) {
	shell
		.state
		.set_center_page(zetawork_gui::state::CenterPage::Workspace);
}

/// Render `frames` frames and return the PNG bytes of the last one.
fn shoot(shell: &mut Shell, frames: usize) -> Vec<u8> {
	let ctx = egui::Context::default();
	// The real look: the spec's tokens and the host's CJK face, exactly as
	// `Shell::new` installs them for the window.
	let settings = shell.settings.clone();
	theme::apply(&ctx, &settings);
	fonts::install(&ctx, &settings);

	// Render at 2x so the PNG is readable without zooming: the layout keeps the
	// window's logical size, only the raster is denser.
	ctx.set_pixels_per_point(2.0);
	let mut textures = raster::Textures::default();
	let mut shot = Vec::new();
	for frame in 0..frames {
		let input = egui::RawInput {
			screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(SIZE[0], SIZE[1]))),
			// egui fades a new overlay in over `animation_time`; without a clock
			// the fade never finishes and a modal would be shot half
			// transparent. 50 ms per frame settles every transition in this
			// shell well inside the frames each shot renders.
			time: Some(frame as f64 * 0.05),
			..Default::default()
		};
		let output = ctx.run(input, |ctx| {
			shell.tick(ctx);
			shell.draw(ctx);
		});
		textures.apply(&output.textures_delta);
		if frame + 1 == frames {
			let primitives = ctx.tessellate(output.shapes, output.pixels_per_point);
			let canvas = raster::render(
				&primitives,
				&textures,
				SIZE,
				output.pixels_per_point,
				Color32::from_rgb(0x0b, 0x0d, 0x11),
			);
			shot = canvas.to_png();
		}
	}
	shot
}

fn write(name: &str, bytes: &[u8]) -> PathBuf {
	let dir = shots_dir();
	std::fs::create_dir_all(&dir).expect("create shots dir");
	let path = dir.join(name);
	std::fs::write(&path, bytes).expect("write png");
	let absolute = path.canonicalize().unwrap_or(path);
	println!("[shot] {} · {} bytes", absolute.display(), bytes.len());
	absolute
}

/// `01-workspace-single-pane.png` — the GUI view with a workspace open (its
/// 大标签页 selected, so the pane grid is what the shot is of). The shipped
/// default is one terminal pane; 分屏 is what adds the second.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn workspace_screenshot() {
	let mut shell = ready_shell();
	workspace_page(&mut shell);
	assert_eq!(shell.state.visible_panes().len(), 1, "a fresh workspace opens one pane");
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096, "a real frame is not a 4 KB PNG");
	write("01-workspace-single-pane.png", &bytes);
}

/// `18-default-project-conversations.png` — the left column's three levels:
/// the pinned 默认项目 block (default workspace + its conversations) above the
/// scrolling project list, and 本机's workspace with its own conversations
/// below. The sessions are seeded, not fetched: a shot must not need
/// `zetacode serve`.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn default_project_conversations_screenshot() {
	use zetawork_gui::sessions::Conversation;

	let mut shell = ready_shell();
	workspace_page(&mut shell);
	let default = shell
		.state
		.default_workspace()
		.expect("the system project is seeded")
		.path
		.clone();
	let local = shell.state.projects[0].path.clone();
	let row = |id: &str, cwd: PathBuf, title: &str, modified_ms: i64, running: bool| Conversation {
		id: id.to_owned(),
		cwd,
		title: title.to_owned(),
		modified_ms,
		message_count: 4,
		running,
	};
	shell.state.set_conversations(vec![
		row(
			"sess-default-3",
			PathBuf::from(&default).join("notes"),
			"整理默认工作区的笔记",
			1_792_569_600_000,
			true,
		),
		row("sess-default-2", PathBuf::from(&default), "初始化默认工作区", 1_792_560_000_000, false),
		row("sess-default-1", PathBuf::from(&default), "欢迎使用 Zeta", 1_792_500_000_000, false),
		row("sess-local-1", local, "修复解析器", 1_792_400_000_000, false),
	]);
	shell.state.left_collapsed = false;
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("18-default-project-conversations.png", &bytes);
}

/// `03-settings-modal.png` — the 设置 modal over the GUI view.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn settings_modal_screenshot() {
	let mut shell = ready_shell();
	shell.state.open_settings();
	shell.state.settings_section = zetawork_gui::settings::Section::Appearance;
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("03-appearance-settings.png", &bytes);
}

/// `04-plus-picker.png` — the `+` picker open over the workspace, listing this
/// host's shells and the four pages.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn picker_screenshot() {
	let mut shell = ready_shell();
	let anchor = egui::Rect::from_min_size(pos2(240.0, 40.0), vec2(28.0, 28.0));
	let target = zetawork_gui::state::PickerTarget::Pane(shell.state.visible_panes()[0].id.clone());
	shell.open_picker(target, anchor);
	assert!(!shell.picker_entries.is_empty(), "the picker lists something");
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("04-new-pane-picker.png", &bytes);
}

/// `05-editor-diff-git.png` — three panes: the 编辑器 page with a real file
/// open, the 差异比较器 page with the workspace's real `git diff`, and the Git
/// page.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn gui_pages_screenshot() {
	let mut shell = ready_shell();
	workspace_page(&mut shell);
	shell.state.act(|state| state.set_cols(3));
	let panes: Vec<String> = shell
		.state
		.visible_panes()
		.iter()
		.map(|pane| pane.id.clone())
		.collect();
	// Pane 1: the editor, over this crate's own manifest — a real file.
	let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
	let notice = shell.state.open_file(&panes[0], &manifest);
	assert!(notice.0.is_empty(), "{}", notice.0);
	// Pane 2: the diff page (real `git diff` of the worktree it runs in).
	assert!(
		shell
			.state
			.open_page(&panes[1], zetawork_gui::state::SessionKind::Diff)
			.0
			.is_empty()
	);
	// Pane 3: the Git page.
	assert!(
		shell
			.state
			.open_page(&panes[2], zetawork_gui::state::SessionKind::Git)
			.0
			.is_empty()
	);
	shell
		.state
		.set_right_tab(zetawork_gui::state::RightTab::Usage);
	shell.state.right_collapsed = false;
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("05-editor-diff-git-status.png", &bytes);
}

/// `06-usage-container.png` — the 用量 panel: the real cards, token chart and
/// agent-type table decoded from the captured `/api/stats/overview` fixture,
/// with the live `/api/status` and `/api/stats/costs` bodies beside it. No
/// socket is opened: [`UsageCache::fixture`] is the headless path.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn usage_container_screenshot() {
	let mut shell = ready_shell();
	shell.usage = zetawork_gui::usage::UsageCache::fixture(
		include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/usage/fixtures/overview-24h.json")),
		include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/usage/fixtures/costs-24h.json")),
		include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/usage/fixtures/status.json")),
		zetawork_gui::usage::Range::Today,
	)
	.expect("the captured fixtures decode");
	zetawork_gui::left::open_usage(&mut shell);
	assert!(shell.state.usage_view_open());
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("06-context-usage-overlay.png", &bytes);
}

/// `07-settings-zetacode.png` — the 编辑器 section with the zetacode rows, and
/// `08-settings-providers.png` — the 管理 section with the provider catalog.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn settings_remote_sections_screenshot() {
	let mut shell = ready_shell();
	// The remote caches are seeded from a fixture and a temp catalog so the two
	// screenshots show the real controls without spawning `zetacode` or writing
	// the user's files.
	let fixture = r#"{
		"edit.mode": {"value": "hashline", "type": "enum", "description": "…"},
		"autoResume": {"value": true, "type": "boolean", "description": "…"},
		"readLineNumbers": {"value": true, "type": "boolean", "description": "…"},
		"display.showTokenUsage": {"value": true, "type": "boolean", "description": "…"},
		"colorBlindMode": {"value": false, "type": "boolean", "description": "…"}
	}"#;
	let options = zetawork_gui::zetacode::parse_config_list(fixture).expect("fixture");
	shell.remote = zetawork_gui::settings_ui::ZetacodeCache::loaded(options);

	shell.state.open_settings();
	shell.state.settings_section = zetawork_gui::settings::Section::Editor;
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("07-settings-zetacode.png", &bytes);

	// The provider rows read `~/.zeta/agent/models.yml`; in this headless run
	// the real catalog is read (read-only) and the drafts are seeded from it.
	shell.state.settings_section = zetawork_gui::settings::Section::Manage;
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("08-settings-providers.png", &bytes);
}

/// `09-total-panel.png` — 总面板, the strip's first 大标签页 and what the shell
/// opens on: every project in one table, with the 状态 column from the
/// contract's 状态词表.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn total_panel_screenshot() {
	let mut shell = ready_shell();
	assert_eq!(
		shell.state.center_page,
		zetawork_gui::state::CenterPage::Total,
		"总面板 is the first big tab, so it is what opens"
	);
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("09-total-panel-projects.png", &bytes);
}

/// `10-usage-page-latest.png` — the right column's 用量 page following the
/// active conversation: the fixture journal's id, title, token rows, cost,
/// model, context bar and last-entry time, with the `最新会话` source badge.
/// `10-usage-page-empty.png` — the same page with no session under the active
/// workspace: the one-line empty state.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn usage_page_screenshot() {
	const FIXTURE: &str = include_str!("../src/usage/fixtures/session-usage.jsonl");
	let home = tempfile::tempdir().expect("home");
	let project = home.path().join("project");
	std::fs::create_dir_all(&project).expect("project");
	let state = AppState::seeded_with_registry(
		&project,
		workbench_projects::Registry::empty_at(home.path().join("projects.json")),
	);
	let roots =
		zetawork_gui::conversation::SessionRoots::at(home.path().to_path_buf(), std::env::temp_dir());
	let directory = roots.project_dir(&project);
	std::fs::create_dir_all(&directory).expect("session directory");
	std::fs::write(directory.join("2026-10-18T09-00-00-000Z_fixture-conv.jsonl"), FIXTURE)
		.expect("fixture journal");
	let mut shell = Shell::with_state(state, Settings::default());
	shell.conversation.set_roots(Some(roots));
	workspace_page(&mut shell);
	assert_eq!(
		shell.state.right_tab,
		zetawork_gui::state::RightTab::Usage,
		"用量 is the right column's default page"
	);
	shell.state.right_collapsed = false;
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("10-usage-page-latest.png", &bytes);

	// The same page with no journal under the active workspace.
	let empty_home = tempfile::tempdir().expect("empty home");
	let empty_project = empty_home.path().join("project");
	std::fs::create_dir_all(&empty_project).expect("empty project");
	let state = AppState::seeded_with_registry(
		&empty_project,
		workbench_projects::Registry::empty_at(empty_home.path().join("projects.json")),
	);
	let mut empty = Shell::with_state(state, Settings::default());
	empty
		.conversation
		.set_roots(Some(zetawork_gui::conversation::SessionRoots::at(
			empty_home.path().to_path_buf(),
			std::env::temp_dir(),
		)));
	workspace_page(&mut empty);
	empty.state.right_collapsed = false;
	let bytes = shoot(&mut empty, 3);
	assert!(bytes.len() > 4096);
	write("10-usage-page-empty.png", &bytes);
}

/// `11-lifecycle-settings.png` — 设置 → 常规: 关闭窗口时 / 开机自启 / 通知, the
/// residency's own status line, and the two triggers that have no signal source
/// yet, named rather than offered as dead controls.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn lifecycle_settings_screenshot() {
	let mut shell = ready_shell();
	shell.state.open_settings();
	shell.state.settings_section = zetawork_gui::settings::Section::General;
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("11-settings-lifecycle.png", &bytes);
}

/// `12-close-ask.png` — the 每次询问 modal: three buttons and **one** checkbox.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn close_ask_screenshot() {
	let mut shell = ready_shell();
	workspace_page(&mut shell);
	// 关闭窗口时 = 每次询问, plus the modal's own state, so the shot shows
	// exactly what the ruling describes: three buttons and one checkbox.
	shell.settings.close_action = zetawork_gui::settings::CloseAction::Ask;
	shell.lifecycle.ask = Some(zetawork_gui::lifecycle::AskState { remember: true });
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("12-close-behaviour.png", &bytes);
}

/// `20-backend-banner.png` — the backend state banner after a simulated
/// crash: the sentence names the dead process and the retry that resolves it,
/// instead of a pane freezing on a socket that will never answer.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn backend_banner_screenshot() {
	let mut shell = ready_shell();
	workspace_page(&mut shell);
	shell
		.backend
		.observe(zetawork_gui::backend::Signal::Starting);
	shell
		.backend
		.observe(zetawork_gui::backend::Signal::Crashed("后台进程已退出（pid 4812）".to_owned()));
	assert!(shell.backend.banner().is_some(), "a crash keeps the banner on screen");
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("20-backend-banner.png", &bytes);
}

/// `13-workspace-state-words.png` — the 状态词表 two ways at once: the left
/// column's rows (dot plus word) for the open project, and the 总面板's 状态
/// column behind them. Nothing in this build observes a workspace, so the
/// honest value is `—`; the shot shows that, not an invented sample state.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn workspace_state_words_screenshot() {
	let mut shell = ready_shell();
	shell.state.left_collapsed = false;
	// 本机 is the only project without registrations; its row carries `—`.
	let notice = shell.state.select_project("p-local");
	assert!(notice.0.is_empty(), "{}", notice.0);
	// The centre stays on 总面板, so one shot shows both surfaces.
	shell.state.show_total();
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("13-workspace-state-words.png", &bytes);
}

/// `15-resources-page.png` — the right column's 资源 page: the live CPU /
/// memory gauges and the process table, sampled by `sysmon`. The shot waits
/// for the worker's first reading (it lands after sysinfo's minimum CPU
/// interval) instead of drawing the empty state.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn resources_page_screenshot() {
	let mut shell = ready_shell();
	workspace_page(&mut shell);
	shell
		.state
		.set_right_tab(zetawork_gui::state::RightTab::Resources);
	assert!(!shell.state.right_collapsed, "opening the tab expands the column");
	let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
	while shell.resources.refresh().is_none() {
		assert!(std::time::Instant::now() < deadline, "the resource sampler published no snapshot");
		std::thread::sleep(std::time::Duration::from_millis(25));
	}
	assert!(
		shell
			.resources
			.snapshot()
			.is_some_and(|snapshot| !snapshot.processes.is_empty()),
		"the process table has real rows"
	);
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("15-resources-page.png", &bytes);
}

/// `16-board-page.png` — the right column's 看板 page over a project that has
/// real cards on disk: three columns (Todo / Doing / Done) and at least one
/// card with its tags, owner and due. The cards are hand-written markdown, so
/// the shot also proves the page reads the same files an editor would.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn board_page_screenshot() {
	let home = tempfile::tempdir().expect("home");
	let project = home.path().join("project");
	let board = project.join(".zeta").join("board");
	std::fs::create_dir_all(&board).expect("board dir");
	std::fs::write(
		board.join("fix-the-parser.md"),
		"---\ntitle: Fix the parser\ncolumn: todo\ntags: [rust, parser]\nassignee: user\ndue: 2026-11-01\n---\n\nHand this one to an agent.\n",
	)
	.expect("todo card");
	std::fs::write(
		board.join("ship-the-board.md"),
		"---\ntitle: Ship the board\ncolumn: doing\ntags: [ui]\nassignee: agent\n---\n\nGUI + TUI + gateway.\n",
	)
	.expect("doing card");
	std::fs::write(
		board.join("docs-card.md"),
		"---\ntitle: Document the format\ncolumn: done\nassignee: user\n---\n",
	)
	.expect("done card");

	let state = AppState::seeded_with_registry(
		&project,
		workbench_projects::Registry::empty_at(home.path().join("projects.json")),
	);
	let mut shell = Shell::with_state(state, Settings::default());
	workspace_page(&mut shell);
	shell
		.state
		.set_right_tab(zetawork_gui::state::RightTab::Board);
	assert!(!shell.state.right_collapsed, "opening the tab expands the column");
	shell.board.refresh(&project, std::time::Instant::now());
	assert_eq!(shell.board.cards().len(), 3, "the three hand-written cards load");
	assert_eq!(
		shell
			.board
			.cards()
			.iter()
			.filter(|card| card.column == termide_panel_ide::board::Column::Doing)
			.count(),
		1,
		"a card lives in Doing"
	);
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("16-board-page.png", &bytes);
}

/// `16-plugin-panels.png` — the right column's 插件 page: the shipped example
/// plugin's `list` panel, drawn natively from the same `plugin.json` the parser
/// validates and the same `data/tasks.json` the plugin's tool reads.
///
/// The data is seeded, not fetched: a screenshot run has no `zetacode` to spawn,
/// so the shot proves the *rendering* path (`decode` → rows → native rows). The
/// tool call itself is covered by
/// `packages/coding-agent/test/plugin-example-panel.test.ts`.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn plugin_panels_screenshot() {
	let mut shell = ready_shell();
	workspace_page(&mut shell);
	let plugin_root =
		PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../plugins/official/example-panel");
	let manifest =
		std::fs::read_to_string(plugin_root.join("plugin.json")).expect("example plugin.json");
	let panels = zetawork_gui::plugin_panels::parse_manifest(&manifest, "example-panel")
		.expect("the declaration parses");
	assert_eq!(panels.len(), 4, "list, form, chart, html");
	let data =
		std::fs::read_to_string(plugin_root.join("data/tasks.json")).expect("example tasks.json");
	let tasks: serde_json::Value = serde_json::from_str(&data).expect("tasks json");
	let rows = serde_json::json!({
		"rows": tasks.get("tasks").cloned().unwrap_or_default(),
	});
	let decoded =
		zetawork_gui::plugin_panels::decode(&panels[0], &rows).expect("the list panel decodes");
	shell.plugins.panels = panels;
	shell.plugin_data.seed("example-panel/tasks", Ok(decoded));
	shell
		.state
		.set_right_tab(zetawork_gui::state::RightTab::Plugin);
	assert!(!shell.state.right_collapsed);
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("16-plugin-panels.png", &bytes);

	// The chart panel is the second native drawing the shot proves: switch to
	// it and count the same data by state, exactly what the tool returns.
	let chart = zetawork_gui::plugin_panels::decode(
		&shell.plugins.panels[2],
		&serde_json::json!({"points":[{"label":"todo","value":2},{"label":"doing","value":2},{"label":"done","value":2}]}),
	)
	.expect("the chart panel decodes");
	shell
		.plugin_data
		.seed("example-panel/throughput", Ok(chart));
	shell.plugin_selection.panel = Some("throughput".to_owned());
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("17-plugin-chart.png", &bytes);
}

/// `14-about.png` — 设置 → 关于: the desktop mark the window and taskbar use,
/// the version, and the scope rows.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn about_settings_screenshot() {
	let mut shell = ready_shell();
	shell.state.open_settings();
	shell.state.settings_section = zetawork_gui::settings::Section::About;
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("14-about.png", &bytes);
}

/// `16-im-channels.png` — 设置 → IM 渠道: the three channel rows, the WeChat
/// QR (encoded locally from a page URL, the gateway's non-image form), the
/// workspace registry and bindings, and the credential editors.
///
/// The view is a fixture, not a live gateway: the shot must not need
/// `zetacode serve`. It is the exact wire shape `GET /api/channels/status` +
/// `GET /api/web-config` + `GET /api/channels/wechat/qrcode` produce.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn im_channels_settings_screenshot() {
	let status = r#"{"channels":[
		{"id":"wechat","running":true},
		{"id":"feishu","running":true},
		{"id":"telegram","running":true}
	]}"#;
	let config = r#"{
		"channels":{
			"wechat":{"enabled":true,"workspaceRoot":"/work/alpha","botToken":"••••"},
			"feishu":{"enabled":true,"workspaceRoot":"/work/beta","appId":"cli_a1b2","appSecret":"••••","domain":"feishu"},
			"telegram":{"enabled":true,"workspaceRoot":"/work/gamma","botToken":"••••"}
		},
		"remote":{
			"workspaces":[
				{"alias":"alpha","path":"/work/alpha"},
				{"alias":"beta","path":"/work/beta"},
				{"alias":"gamma","path":"/work/gamma"}
			],
			"sessionMappings":[
				{"platform":"feishu","chatId":"oc_alpha","workspaceAlias":"alpha"},
				{"platform":"telegram","chatId":"42","workspaceAlias":"beta"},
				{"platform":"wechat","chatId":"wx_gamma","workspaceAlias":"gamma"}
			]
		}
	}"#;
	// A page URL, not an image: the exact fallback the web UI's external QR
	// renderer covers, here encoded by `qrcodegen` and drawn by the pane.
	let qr =
		r#"{"pending":true,"qrcodeUrl":"https://liteapp.weixin.qq.com/q/7b1a","status":"wait"}"#;
	let view = zetawork_gui::channels::decode_view(status, config, Some(qr))
		.expect("the fixture is the gateway's shape");
	let mut shell = ready_shell();
	shell.state.open_settings();
	shell.state.settings_section = zetawork_gui::settings::Section::Channels;
	shell.channels.show_fixture(view);
	let bytes = shoot(&mut shell, 4);
	assert!(bytes.len() > 4096);
	// The QR is a real raster, not a placeholder rectangle: the fixture's page
	// URL has no image bytes, so this is the local encoder's output.
	assert!(
		shell.channels.qr_error().is_none(),
		"QR generation failed: {:?}",
		shell.channels.qr_error()
	);
	assert_eq!(
		shell.channels.qr_source(),
		Some(zetawork_gui::channels::QrSource::Encoded),
		"the fixture's page URL must render through the local encoder"
	);
	write("16-im-channels.png", &bytes);
}

/// `18-remote-access.png` — 设置 → 远程访问: the bind host + public URL, the
/// TLS switch and its two PEM paths, the plain-HTTP opt-in, the token state
/// (never the token) and the pairing QR encoded locally from the payload.
///
/// The view is a fixture, not a live gateway: the shot must not need
/// `zetacode serve`. It is the exact shape `GET /api/web-config` +
/// `GET /api/remote/pairing` produce, with the token already masked.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn remote_access_settings_screenshot() {
	let config = r#"{
		"remote":{
			"host":"0.0.0.0",
			"publicUrl":"https://zeta.example",
			"token":"••••",
			"tokenUpdatedAt":"2026-10-01T00:00:00.000Z",
			"allowPlainHttp":false,
			"tls":{"enabled":true,"cert":"C:/certs/cert.pem","key":"C:/certs/key.pem"}
		}
	}"#;
	let pairing = r#"{
		"url":"https://zeta.example",
		"token":"·",
		"payload":"zeta://pair?u=https%3A%2F%2Fzeta.example&t=fixture",
		"svg":"<svg/>"
	}"#;
	let view = zetawork_gui::remote_access::RemoteView::decode(config)
		.expect("the fixture is the gateway's shape")
		.with_pairing(pairing);
	let mut shell = ready_shell();
	shell.state.open_settings();
	shell.state.settings_section = zetawork_gui::settings::Section::Remote;
	shell.remote_access.show_fixture(view);
	let bytes = shoot(&mut shell, 4);
	assert!(bytes.len() > 4096);
	assert!(
		shell.remote_access.qr_error().is_none(),
		"QR generation failed: {:?}",
		shell.remote_access.qr_error()
	);
	assert_eq!(
		shell.remote_access.qr_source(),
		Some(zetawork_gui::channels::QrSource::Encoded),
		"the pairing payload must render through the local encoder"
	);
	// The pane never renders the token, configured or rotated.
	let view = shell
		.remote_access
		.view()
		.expect("the fixture view is kept");
	assert_eq!(view.token, zetawork_gui::remote_access::SecretState::Stored);
	write("18-remote-access.png", &bytes);
}

/// `16-pdf-viewer.png` — the PDF page over the committed fixture: page one of
/// the two-page A4 sheet, rasterized by hayro and painted as an egui texture.
///
/// The assertion that matters is the PNG, not the tab: the shell draws the
/// real texture produced by [`zetawork_gui::pdf`], and `shoot` rasterizes the
/// real frame. A viewer that only claimed to render would produce a blank
/// sheet here.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn pdf_viewer_screenshot() {
	let mut shell = ready_shell();
	workspace_page(&mut shell);
	let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/two-pages.pdf");
	let pane = shell.state.visible_panes()[0].id.clone();
	let notice = shell.state.open_file(&pane, &fixture);
	assert!(notice.0.is_empty(), "{}", notice.0);
	let tab = shell.state.visible_panes()[0]
		.active_tab()
		.expect("the PDF tab is active");
	assert_eq!(tab.kind, zetawork_gui::state::SessionKind::Pdf);
	assert_eq!(tab.pdf.as_deref(), Some(fixture.as_path()));
	let tab_id = tab.id.clone();
	let bytes = shoot(&mut shell, 4);
	assert!(bytes.len() > 4096);
	// The page really rasterized: the shell kept the document and measured its
	// first render.
	let doc = shell
		.pdfs
		.get(&tab_id)
		.expect("the tab's document is cached");
	assert!(doc.error().is_none(), "{:?}", doc.error());
	assert_eq!(doc.page_count(), 2);
	assert!(
		doc.last_render()
			.is_some_and(|took| took.as_secs_f64() < 10.0),
		"the fixture rendered: {:?}",
		doc.last_render()
	);
	println!(
		"[pdf] open fixture: {} bytes, first render {:?}",
		std::fs::metadata(&fixture).expect("fixture").len(),
		doc.last_render()
	);
	write("16-pdf-viewer.png", &bytes);
}

/// `16-settings-all-en.png` / `17-settings-all-zh.png` — the schema-driven
/// 全部设置 section, once per language, over the real catalog the gateway
/// publishes (ten tabs, every control kind, a masked credential). The two
/// shots exist to make the two claims visible: labels/groups/options are
/// fetched in the UI language, and the schema surface is wider than the eight
/// hand-built sections (`> 8` tabs below).
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn settings_all_schema_screenshots() {
	for (lang, body, name) in [
		(
			zetawork_gui::i18n::Lang::En,
			include_str!("fixtures/settings-catalog-en.json"),
			"16-settings-all-en.png",
		),
		(
			zetawork_gui::i18n::Lang::Zh,
			include_str!("fixtures/settings-catalog-zh.json"),
			"17-settings-all-zh.png",
		),
	] {
		let mut shell = ready_shell();
		shell.schema = zetawork_gui::settings_schema::SchemaCache::fixture(body, lang)
			.expect("the catalog fixture parses");
		{
			let catalog = shell.schema.catalog().expect("the fixture parses");
			assert_eq!(catalog.tabs.len(), 10, "the schema has ten tabs");
			assert!(
				catalog.tabs.len() >= zetawork_gui::settings::Section::ALL.len() - 1,
				"the schema surface is at least as wide as the hand-built sections"
			);
			assert!(catalog.entries.len() > 300, "the real catalog is not a toy fixture");
		}
		shell.settings.lang = lang;
		zetawork_gui::i18n::Lang::set_current(lang);
		shell.state.open_settings();
		shell.state.settings_section = zetawork_gui::settings::Section::All;
		shell.schema.tab = Some("appearance".to_owned());
		let bytes = shoot(&mut shell, 3);
		assert!(bytes.len() > 4096);
		write(name, &bytes);
	}
	zetawork_gui::i18n::Lang::set_current(zetawork_gui::i18n::Lang::Zh);
}

/// `11-kitty-image.png` — a terminal image, drawn end to end through the
/// emulator the pane runs.
///
/// A hosted TUI (zetacode) transmits its raster as a kitty APC; the emulator
/// decodes it, places it in cells and reports where it goes in device pixels;
/// the pane's own painter ([`paint_images`], the same call `center.rs` makes)
/// draws it. The PNG is the artifact — the pixel assertions are the evidence
/// that the painted rectangle covers exactly the device pixels the emulator
/// measured: 10 × 5 cells of 12 × 24 px at 2× DPI, anchored at the cell the
/// cursor was parked on (row 4, column 6 in the client's 1-based CSI).
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn kitty_image_shot() {
	use std::io::{Result as IoResult, Write};
	use std::sync::{Arc, Mutex, RwLock};

	use base64::Engine;
	use zetawork_gui::blit::{GridMetrics, ImageTextures, grid_font_for, paint_images};

	/// Writes back whatever the emulator replies (nothing, for `q=2`).
	struct Capture(Arc<Mutex<Vec<u8>>>);
	impl Write for Capture {
		fn write(&mut self, buf: &[u8]) -> IoResult<usize> {
			self.0.lock().unwrap().extend_from_slice(buf);
			Ok(buf.len())
		}
		fn flush(&mut self) -> IoResult<()> {
			Ok(())
		}
	}

	/// The committed 2×2 PNG: red, green / blue, white.
	const PNG: &[u8] = include_bytes!("../testdata/kitty-2x2.png");
	/// The device-pixel cell the GUI reports (`GridMetrics` × pixels-per-point).
	const CELL: (u16, u16) = (12, 24);
	const PX: [f32; 2] = [240.0, 160.0];

	let replies = Arc::new(Mutex::new(Vec::new()));
	let screen = Arc::new(RwLock::new(termide_panel_terminal::TerminalScreen::new(24, 80)));
	screen.write().unwrap().cell_px = CELL;
	let writer =
		Arc::new(Mutex::new(Box::new(Capture(Arc::clone(&replies))) as Box<dyn Write + Send>));
	let mut stream = termide_panel_terminal::StreamParser::new(writer, Arc::clone(&screen));

	let data = base64::engine::general_purpose::STANDARD.encode(PNG);
	stream.feed(b"\x1b[4;6H");
	stream.feed(format!("\x1b_Ga=T,f=100,i=7,c=10,r=5,q=2;{data}\x1b\\").as_bytes());
	stream.flush();
	assert!(replies.lock().unwrap().is_empty(), "q=2 asks for no reply");

	let placements = screen.read().unwrap().graphics.placements();
	assert_eq!(placements.len(), 1, "the emulator placed the transmitted image");
	let (placement, image) = &placements[0];
	assert_eq!((image.width, image.height), (2, 2), "the PNG decoded");
	let rect = placement.rect(image, CELL);
	assert_eq!((rect.x, rect.y, rect.width, rect.height), (60, 72, 120, 120));

	// The pane's painter, at the window's own scale.
	let ctx = egui::Context::default();
	let settings = Settings::default();
	theme::apply(&ctx, &settings);
	fonts::install(&ctx, &settings);
	// `Context::pixels_per_point()` only reports the applied scale after a
	// frame, so the shot owns the scale it asked for.
	const PP: f32 = 2.0;
	ctx.set_pixels_per_point(PP);
	// A pane's grid: where the painter put it, its cell metrics, and the size
	// it was given. The font needs the first frame, so the metrics are built in
	// it (as `center.rs` does from a live `Ui`).
	const ORIGIN: (f32, f32) = (10.0, 20.0);
	let mut cache = ImageTextures::default();
	let mut textures = raster::Textures::default();
	let output = ctx.run(
		egui::RawInput {
			screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(PX[0], PX[1]))),
			..Default::default()
		},
		|ctx| {
			let painter = ctx.layer_painter(egui::LayerId::background());
			painter.rect_filled(
				Rect::from_min_size(pos2(0.0, 0.0), vec2(PX[0], PX[1])),
				0.0,
				theme::TERM_BG,
			);
			let metrics = GridMetrics {
				origin: pos2(ORIGIN.0, ORIGIN.1),
				font: grid_font_for(ctx, 13.0),
				cell_w: 8.0,
				cell_h: 16.0,
				cols: 80,
				rows: 24,
				font_size: 13.0,
			};
			let pass =
				zetawork_gui::blit::ImagePass { grid: &metrics, cell_px: CELL, pixels_per_point: PP };
			paint_images(&painter, &mut cache, "shot", &placements, pass, false);
		},
	);
	textures.apply(&output.textures_delta);
	assert_eq!(output.pixels_per_point, PP, "the frame renders at the scale the shot asked for");
	let primitives = ctx.tessellate(output.shapes, output.pixels_per_point);
	let canvas = raster::render(&primitives, &textures, PX, PP, theme::TERM_BG);

	// Device pixels: the grid origin is in points, the placement in device px.
	let origin = (ORIGIN.0 * PP, ORIGIN.1 * PP);
	assert_eq!((origin.0 + rect.x as f32, origin.1 + rect.y as f32), (80.0, 112.0));
	let at = |x: usize, y: usize| canvas.pixels[y * canvas.width + x];
	// 2×2 source scaled with NEAREST: four 60×60 quadrants, no filtering.
	assert_eq!(at(90, 120), [255, 0, 0, 255], "top-left quadrant is red");
	assert_eq!(at(190, 120), [0, 255, 0, 255], "top-right quadrant is green");
	assert_eq!(at(90, 220), [0, 0, 255, 255], "bottom-left quadrant is blue");
	assert_eq!(at(190, 220), [255, 255, 255, 255], "bottom-right quadrant is white");
	// One pixel outside each edge is the pane's own background: the image is
	// clipped to its rect, not smeared past it.
	let bg = [theme::TERM_BG.r(), theme::TERM_BG.g(), theme::TERM_BG.b(), 255];
	assert_eq!(at(79, 120), bg, "nothing paints left of the rect");
	assert_eq!(at(200, 120), bg, "nothing paints right of the rect");
	assert_eq!(at(120, 111), bg, "nothing paints above the rect");
	assert_eq!(at(120, 232), bg, "nothing paints below the rect");

	let bytes = canvas.to_png();
	assert!(bytes.len() > 256, "a real raster is not a handful of bytes");
	write("11-kitty-image.png", &bytes);
}

/// `19-history-page.png` — the right column's 历史 page: the gateway's session
/// list, newest first, grouped by day, with the search box. The rows are
/// seeded (a shot must not need `zetacode serve`); the page itself reads the
/// same cache the left column does.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn history_page_screenshot() {
	use zetawork_gui::sessions::Conversation;

	let mut shell = ready_shell();
	workspace_page(&mut shell);
	let default = shell
		.state
		.default_workspace()
		.expect("the system project is seeded")
		.path
		.clone();
	let local = shell.state.projects[0].path.clone();
	let now = chrono::Local::now().timestamp_millis();
	let row = |id: &str, cwd: PathBuf, title: &str, ago: i64, running: bool| Conversation {
		id: id.to_owned(),
		cwd,
		title: title.to_owned(),
		modified_ms: now - ago,
		message_count: 6,
		running,
	};
	shell.state.set_conversations(vec![
		row(
			"sess-history-1",
			PathBuf::from(&default).join("notes"),
			"整理默认工作区的笔记",
			12 * 60_000,
			true,
		),
		row("sess-history-2", PathBuf::from(&default), "初始化默认工作区", 3 * 3_600_000, false),
		row("sess-history-3", local, "修复解析器的历史会话", 30 * 3_600_000, false),
		row("sess-history-4", PathBuf::from(&default), "欢迎使用 Zeta", 3 * 86_400_000, false),
	]);
	shell.state.pinned_sessions = vec!["sess-history-2".to_owned()];
	shell
		.state
		.set_right_tab(zetawork_gui::state::RightTab::History);
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("19-history-page.png", &bytes);
}

/// `20-command-palette.png` — ⌘K open over the workspace, listing the shell's
/// own rows: actions, projects, workspaces, conversations and files.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn command_palette_screenshot() {
	let mut shell = ready_shell();
	workspace_page(&mut shell);
	shell.open_palette();
	if let Some(palette) = shell.state.palette_mut() {
		palette.selected = 1;
	}
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("20-command-palette.png", &bytes);
}

/// `19-workspace-agent-rows.png` — a workspace that holds an agent session: the
/// left column lists that session under the workspace row, and the prompt line
/// at the bottom of the column is aimed at it.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn agent_rows_screenshot() {
	let mut shell = ready_shell();
	workspace_page(&mut shell);
	let workspace = shell
		.state
		.active_workspace()
		.expect("a workspace is open")
		.id
		.clone();
	let notice =
		shell
			.state
			.attach_conversation(&workspace, "conv-2026-10-27", "Agent · diff review");
	assert!(notice.0.is_empty(), "{}", notice.0);
	let (pane, tab) = shell
		.state
		.workspace(&workspace)
		.expect("the workspace")
		.panes
		.iter()
		.flat_map(|pane| pane.tabs.iter().map(move |tab| (pane.id.clone(), tab)))
		.find(|(_, tab)| tab.kind == zetawork_gui::state::SessionKind::Agent)
		.map(|(pane, tab)| (pane, tab.id.clone()))
		.expect("the agent tab");
	// What a click on the row does, minus the mouse.
	shell.state.select_tab(&pane, &tab);
	shell.agent_target = Some((tab, "conv-2026-10-27".to_owned()));
	shell.agent_prompt = "看一下这次 diff".to_owned();
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096, "a real frame is not a 4 KB PNG");
	write("19-workspace-agent-rows.png", &bytes);
}
