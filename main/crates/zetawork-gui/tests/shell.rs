//! The shell's acceptance tests, against the public surface only.
//!
//! Four things the brief calls out are checked here end to end:
//!
//! * the settings file round-trips, and a corrupt one falls back per key;
//! * the caps hold — a seventh 大标签页 is refused, a pane keeps a session tab,
//!   a workspace keeps a pane;
//! * the CJK width rule (`中a文b` → the `a` lands two columns later);
//! * the GUI and the TUI read the same state.

use zetawork_gui::blit;
use zetawork_gui::settings::{self, Density, MonoFont, Settings, Theme};
use zetawork_gui::state::{AppState, MAX_WORKSPACES_PER_PROJECT, ViewMode};
use zetawork_gui::{Shell, tui_view};

fn shell() -> Shell {
	let cwd = std::env::current_dir().expect("cwd");
	Shell::with_state(AppState::seeded(&cwd), Settings::default())
}

/// Every piece of state a view is expected to show, as comparable strings.
fn fingerprint(state: &AppState) -> Vec<String> {
	let mut out = Vec::new();
	out.push(format!("project:{}", state.active_project.clone().unwrap_or_default()));
	out.push(format!("workspace:{}", state.active_workspace.clone().unwrap_or_default()));
	out.push(format!("branch:{}", state.branch_label()));
	out.push(format!("cols:{}", state.active_cols()));
	for pane in state.visible_panes() {
		out.push(format!("pane:{}", pane.id));
		for tab in &pane.tabs {
			out.push(format!(
				"tab:{}:{:?}:{}{}",
				tab.id,
				tab.kind,
				tab.title,
				if tab.id == pane.active { ":active" } else { "" }
			));
		}
	}
	out.push(format!("right:{:?}", state.right_tab));
	out.push(format!("collapsed:{}/{}", state.left_collapsed, state.right_collapsed));
	out
}

#[test]
fn settings_round_trip_and_corruption_fallback() {
	let dir = std::env::temp_dir().join(format!("zetawork-gui-acceptance-{}", std::process::id()));
	let _ = std::fs::remove_dir_all(&dir);
	std::fs::create_dir_all(&dir).unwrap();
	let path = dir.join("zetawork.toml");

	let wanted = Settings {
		theme: Theme::Light,
		density: Density::Compact,
		mono_font: MonoFont::Consolas,
		editor_size: 16,
		editor_wrap: false,
		terminal_size: 12,
		..Settings::default()
	};
	settings::save_to(&path, wanted).unwrap();
	assert_eq!(settings::load_from(&path), wanted, "round trip");

	// A corrupt file: invalid UTF-8, then a nonsense value next to a good one.
	std::fs::write(&path, [0x00, 0xff, 0xfe, 0x80]).unwrap();
	assert_eq!(settings::load_from(&path), Settings::default(), "binary file → defaults");
	std::fs::write(&path, "theme = ???\neditor_size = 99\ndensity = spacious\n").unwrap();
	let recovered = settings::load_from(&path);
	assert_eq!(recovered.theme, Theme::Dark, "bad value falls back");
	assert_eq!(recovered.editor_size, 13, "out-of-range value falls back");
	assert_eq!(recovered.density, Density::Spacious, "good value survives");
	let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn seventh_big_tab_is_refused() {
	let mut state = AppState::seeded(&std::env::current_dir().unwrap());
	let project = state.projects[0].id.clone();
	while state.projects[0].workspaces.len() < MAX_WORKSPACES_PER_PROJECT {
		let notice = state.new_workspace(&project);
		assert!(notice.0.is_empty(), "refused early: {}", notice.0);
	}
	let before = fingerprint(&state);
	let notice = state.new_workspace(&project);
	assert_eq!(state.projects[0].workspaces.len(), MAX_WORKSPACES_PER_PROJECT);
	assert!(notice.0.contains("最多"), "the refusal is visible: {notice:?}");
	assert_eq!(fingerprint(&state), before, "a refused tab leaves no residue");
}

#[test]
fn a_pane_and_a_workspace_keep_their_last_child() {
	let mut state = AppState::seeded(&std::env::current_dir().unwrap());
	let ws_id = state.active_workspace().unwrap().id.clone();
	let pane_id = state.workspace(&ws_id).unwrap().panes[0].id.clone();

	// All session tabs but one can go; the last is refused.
	loop {
		let pane = state.workspace(&ws_id).unwrap().panes[0].clone();
		if pane.tabs.len() == 1 {
			break;
		}
		let last = pane.tabs.last().unwrap().id.clone();
		assert!(state.close_tab(&pane_id, &last).0.is_empty());
	}
	let last = state.workspace(&ws_id).unwrap().panes[0].tabs[0].id.clone();
	let notice = state.close_tab(&pane_id, &last);
	assert_eq!(state.workspace(&ws_id).unwrap().panes[0].tabs.len(), 1);
	assert!(notice.0.contains("至少"), "{notice:?}");

	// Panes: down to one, then refused.
	let ids: Vec<String> = state
		.workspace(&ws_id)
		.unwrap()
		.panes
		.iter()
		.map(|p| p.id.clone())
		.collect();
	for id in ids.iter().skip(1) {
		assert!(state.close_pane(id).0.is_empty());
	}
	let notice = state.close_pane(&ids[0]);
	assert_eq!(state.workspace(&ws_id).unwrap().panes.len(), 1);
	assert!(notice.0.contains("至少"), "{notice:?}");

	// And a project keeps its last workspace.
	let project = state.project_of(&ws_id).unwrap().id.clone();
	let only = state.project(&project).unwrap().workspaces[0].id.clone();
	if state.project(&project).unwrap().workspaces.len() == 1 {
		let notice = state.close_workspace(&only);
		assert!(notice.0.contains("至少"), "{notice:?}");
	}
}

#[test]
fn three_columns_is_the_ceiling() {
	let mut state = AppState::seeded(&std::env::current_dir().unwrap());
	let ws_id = state.active_workspace().unwrap().id.clone();
	assert!(state.set_cols(3).0.is_empty());
	assert_eq!(state.visible_panes().len(), 3);
	assert!(state.new_pane().0.contains("最多"), "a fourth pane is refused");
	assert_eq!(state.workspace(&ws_id).unwrap().panes.len(), 3);
}

#[test]
fn a_wide_glyph_claims_two_cells_and_the_next_ascii_lands_on_column_two() {
	let (buffer, _, _) = blit::render(12, 2, |frame| {
		let area = frame.area();
		frame.render_widget(ratatui::widgets::Paragraph::new("中a文b"), area);
	});
	let row = blit::painted_cells(&buffer, 0, 12);
	let cells: Vec<(u16, &str, u16)> = row.iter().copied().take(4).collect();
	assert_eq!(cells, vec![(0, "中", 2), (2, "a", 1), (3, "文", 2), (5, "b", 1)]);
	// Which is also what ratatui's own diff does: the covered column is skipped
	// rather than painted as a blank.
	assert_eq!(blit::painted_cells(&buffer, 0, 1), vec![(0, "中", 2)]);
}

#[test]
fn the_gui_and_the_tui_read_the_same_state() {
	let mut shell = shell();
	let gui = fingerprint(&shell.state);
	shell.state.set_view(ViewMode::Tui);
	assert_eq!(fingerprint(&shell.state), gui, "switching views changes no data");

	let workspace = shell.state.workspace_label().to_owned();
	let branch = shell.state.branch_label().to_owned();
	let text = tui_view::snapshot(&shell, 150, 40);
	assert!(text.contains(&workspace), "the TUI shows the open workspace:\n{text}");
	assert!(text.contains(&branch), "the TUI shows the branch:\n{text}");
	assert!(text.contains("F1 文件"), "the sidebar tabs are drawn:\n{text}");
	assert!(text.contains("设置"), "the status line starts with 设置:\n{text}");
	for pane in shell.state.visible_panes() {
		for tab in &pane.tabs {
			if tab.id == pane.active {
				assert!(text.contains(&tab.title), "the focused tab is drawn:\n{text}");
			}
		}
	}

	// …and the GUI draws that same state without a window.
	let ctx = egui::Context::default();
	shell.state.set_view(ViewMode::Gui);
	render_frame(&ctx, &mut shell);
	assert_eq!(fingerprint(&shell.state), gui, "the GUI drew the same state");
}

#[test]
fn the_welcome_panel_appears_with_no_workspace_open() {
	let mut shell = shell();
	shell.state.go_home();
	assert!(shell.state.visible_panes().is_empty());
	let text = tui_view::snapshot(&shell, 150, 40);
	assert!(text.contains("选择左侧的项目或工作区"), "the TUI says so too:\n{text}");
	let ctx = egui::Context::default();
	render_frame(&ctx, &mut shell);
}

/// Draw one whole frame (title bar, both columns, centre, status bar) into a
/// headless egui context, the way `update` does — the tests have no window.
fn render_frame(ctx: &egui::Context, shell: &mut Shell) {
	for _ in 0..2 {
		// Twice: `set_fonts` and a couple of layout decisions only settle on
		// the second frame, and a panic there is what this test is for.
		shell.tick(ctx);
		let output = ctx.run(egui::RawInput::default(), |ctx| shell.draw(ctx));
		assert!(
			!output.shapes.is_empty(),
			"a frame must paint something ({} shapes)",
			output.shapes.len()
		);
	}
}

#[test]
fn the_whole_frame_draws_in_every_arrangement() {
	let ctx = egui::Context::default();
	let mut shell = shell();
	// Open, with both columns, in each view.
	render_frame(&ctx, &mut shell);
	shell.state.set_view(ViewMode::Tui);
	render_frame(&ctx, &mut shell);
	shell.state.set_view(ViewMode::Gui);
	// Collapsed columns (the rails) and the focus mode.
	shell.state.toggle_left();
	shell.state.toggle_right();
	render_frame(&ctx, &mut shell);
	// Every right-column panel, including the git one (real `git` output).
	for tab in [
		zetawork_gui::state::RightTab::Files,
		zetawork_gui::state::RightTab::History,
		zetawork_gui::state::RightTab::Git,
	] {
		shell.state.set_right_tab(tab);
		render_frame(&ctx, &mut shell);
	}
	// Every 设置 section, with the modal open over the frame.
	for section in zetawork_gui::settings::Section::ALL {
		shell.state.settings_section = section;
		shell.state.open_settings();
		render_frame(&ctx, &mut shell);
	}
	shell.state.close_modal();
	// 列数 1 · 2 · 3, and the welcome panel.
	for cols in [1u8, 2, 3] {
		shell.state.act(|state| state.set_cols(cols));
		render_frame(&ctx, &mut shell);
	}
	shell.state.go_home();
	render_frame(&ctx, &mut shell);
	// A toast, which draws over everything.
	shell.state.toast("测试提示");
	render_frame(&ctx, &mut shell);
}

#[test]
fn the_modal_and_the_view_switch_keep_their_order_under_escape() {
	let mut shell = shell();
	shell.state.set_view(ViewMode::Tui);
	shell.state.open_settings();
	assert!(shell.state.modal_open());
	assert!(shell.state.escape(), "escape closes the modal first");
	assert!(!shell.state.modal_open());
	assert_eq!(shell.state.view, ViewMode::Tui);
	assert!(shell.state.escape(), "then it leaves the TUI view");
	assert_eq!(shell.state.view, ViewMode::Gui);
}
