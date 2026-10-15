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
use zetawork_gui::state::{AppState, ViewMode};
use zetawork_gui::settings::Settings;
use zetawork_gui::{Shell, fonts, theme};

/// The window size the screenshots pretend the user has.
const SIZE: [f32; 2] = [1440.0, 900.0];

/// Where the PNGs go: `<worktree>/shots`.
fn shots_dir() -> PathBuf {
	let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
	// …/main/crates/zetawork-gui → the worktree root
	let root = manifest.parent().and_then(|p| p.parent()).and_then(|p| p.parent()).map(PathBuf::from).unwrap_or(manifest);
	root.join("shots")
}

/// A shell whose state is the shipped default: 本机 open, two panes, two
/// columns, right column on 文件 — plus the first pane switched to its editor
/// tab so one pane shows the editor and the other the terminal.
fn ready_shell() -> Shell {
	let cwd = std::env::current_dir().expect("cwd");
	let state = AppState::seeded(&cwd);
	let mut shell = Shell::with_state(state, Settings::default());
	if let Some(workspace) = shell.state.active_workspace() {
		let pane = workspace.panes[0].clone();
		if let Some(editor) = pane.tabs.iter().find(|tab| tab.title.ends_with(".rs")) {
			let (pane_id, tab_id) = (pane.id.clone(), editor.id.clone());
			shell.state.select_tab(&pane_id, &tab_id);
		}
	}
	shell
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
