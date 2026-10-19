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
	let settings = shell.settings;
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
