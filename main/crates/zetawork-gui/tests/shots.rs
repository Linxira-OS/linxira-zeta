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
//! The PNGs land in `<worktree>/shots/` (i.e. `temp/zetawork-gui-shell/shots/`),
//! which is inside the git-ignored `temp/` tree.

#[path = "support/raster.rs"]
mod raster;

use std::path::PathBuf;

use egui::{Color32, Rect, pos2, vec2};
use zetawork_gui::settings::Settings;
use zetawork_gui::state::{AppState, ViewMode};
use zetawork_gui::{Shell, fonts, theme};

/// The window size the screenshots pretend the user has.
const SIZE: [f32; 2] = [1440.0, 900.0];

/// Where the PNGs go: `<worktree>/shots`.
fn shots_dir() -> PathBuf {
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

/// A shell whose state is the shipped default: 本机 open, two panes, two
/// columns, right column on 文件 — plus the first pane switched to its editor
/// tab so one pane shows the editor and the other the terminal.
fn ready_shell() -> Shell {
	let cwd = std::env::current_dir().expect("cwd");
	let state = AppState::seeded(&cwd);
	Shell::with_state(state, Settings::default())
}

/// Render `frames` frames and return the PNG bytes of the last one.
fn shoot(shell: &mut Shell, frames: usize) -> Vec<u8> {
	let ctx = egui::Context::default();
	// The real look: the spec's tokens and the host's CJK face, exactly as
	// `Shell::new` installs them for the window.
	let settings = shell.settings;
	theme::apply(&ctx, &settings);
	fonts::install(&ctx, &settings);

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

/// `01-gui-mode.png` — the GUI view with a workspace open.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn gui_mode_screenshot() {
	let mut shell = ready_shell();
	shell.state.set_view(ViewMode::Gui);
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096, "a real frame is not a 4 KB PNG");
	write("01-gui-mode.png", &bytes);
}

/// `02-tui-mode.png` — the TUI view over the same state.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn tui_mode_screenshot() {
	let mut shell = ready_shell();
	shell.state.set_view(ViewMode::Tui);
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("02-tui-mode.png", &bytes);
}

/// `03-settings-modal.png` — the 设置 modal over the GUI view.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn settings_modal_screenshot() {
	let mut shell = ready_shell();
	shell.state.set_view(ViewMode::Gui);
	shell.state.open_settings();
	shell.state.settings_section = zetawork_gui::settings::Section::Appearance;
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("03-settings-modal.png", &bytes);
}

/// `04-plus-picker.png` — the `+` picker open over the workspace, listing this
/// host's shells and the four pages.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn picker_screenshot() {
	let mut shell = ready_shell();
	shell.state.set_view(ViewMode::Gui);
	let anchor = egui::Rect::from_min_size(pos2(240.0, 40.0), vec2(28.0, 28.0));
	let target = zetawork_gui::state::PickerTarget::Pane(shell.state.visible_panes()[0].id.clone());
	shell.open_picker(target, anchor);
	assert!(!shell.picker_entries.is_empty(), "the picker lists something");
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("04-plus-picker.png", &bytes);
}

/// `05-editor-diff-git.png` — three panes: the 编辑器 page with a real file open,
/// the 差异比较器 page with the workspace's real `git diff`, and the Git page.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn gui_pages_screenshot() {
	let mut shell = ready_shell();
	shell.state.set_view(ViewMode::Gui);
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
		.set_right_tab(zetawork_gui::state::RightTab::Context);
	shell.state.right_collapsed = false;
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("05-editor-diff-git.png", &bytes);
}

/// `06-usage-container.png` — the 用量 container: the address the stats page is
/// served from, and the frame it will be painted into.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn usage_container_screenshot() {
	let mut shell = ready_shell();
	shell.state.set_view(ViewMode::Gui);
	zetawork_gui::left::open_usage(&mut shell);
	assert!(shell.state.usage_view_open());
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("06-usage-container.png", &bytes);
}

/// `07-settings-zetacode.png` — the 编辑器 section with the zetacode rows, and
/// `08-settings-providers.png` — the 管理 section with the provider catalog.
#[test]
#[ignore = "writes PNG screenshots to the worktree's shots/ directory"]
fn settings_remote_sections_screenshot() {
	let mut shell = ready_shell();
	shell.state.set_view(ViewMode::Gui);
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

	// The provider rows read `~/.zeta/agent/models.yml`; in this headless run the
	// real catalog is read (read-only) and the drafts are seeded from it.
	shell.state.settings_section = zetawork_gui::settings::Section::Manage;
	let bytes = shoot(&mut shell, 3);
	assert!(bytes.len() > 4096);
	write("08-settings-providers.png", &bytes);
}
