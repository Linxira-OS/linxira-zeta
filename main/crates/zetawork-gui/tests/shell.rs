//! Spike evidence, all headless (no GPU, no window).
//!
//! `egui_kittest` is deliberately absent: its wgpu renderer does not compile
//! for `x86_64-pc-windows-gnu` (wgpu-hal's D3D12 backend needs `windows`
//! features the GNU target lacks), so the layout PNGs are produced by the
//! native app's `--capture` (live GL framebuffer) and the assertions here run
//! against `egui::Context::run` directly.

use egui_dock::{DockState, NodeIndex};
use serde::{Deserialize, Serialize};
use zetawork_gui::blit;
use zetawork_gui::{ShellApp, Tab};

/// Minimal stand-in for `egui_kittest::Harness`: drive the real app closure
/// with a fixed viewport and injectable events.
struct Harness {
	ctx: egui::Context,
	app: ShellApp,
	raw: egui::RawInput,
}

impl Harness {
	fn new(size: egui::Vec2) -> Self {
		let raw = egui::RawInput {
			screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, size)),
			..Default::default()
		};
		Self { ctx: egui::Context::default(), app: ShellApp::new_headless(), raw }
	}

	fn step(&mut self) {
		let events = std::mem::take(&mut self.raw.events);
		let mut raw = self.raw.clone();
		raw.events = events;
		let ctx = self.ctx.clone();
		let _ = ctx.run(raw, |ctx| self.app.draw(ctx));
	}

	fn run(&mut self, steps: usize) {
		for _ in 0..steps {
			self.step();
		}
	}

	fn event(&mut self, event: egui::Event) {
		self.raw.events.push(event);
	}
}

/// A tab payload for the synthetic 3-area layout (left rail / centre stack /
/// right panel) — any `Serialize` type works, which is the point.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
enum Pane {
	Rail,
	Session,
	Editor,
	Context,
}

/// Renders the synthetic panes just enough for the dock to assign rects.
struct PaneViewer;

impl egui_dock::TabViewer for PaneViewer {
	type Tab = Pane;

	fn title(&mut self, tab: &mut Self::Tab) -> egui::WidgetText {
		format!("{tab:?}").into()
	}

	fn ui(&mut self, ui: &mut egui::Ui, tab: &mut Self::Tab) {
		ui.label(format!("{tab:?}"));
	}
}

#[test]
fn dock_layout_persistence_round_trip() {
	// 1) A synthetic layout with two splits, laid out by a real frame first
	//    (`Rect::NOTHING` does not survive serde — see caveat (a) below).
	let mut dock: DockState<Pane> = DockState::new(vec![Pane::Session, Pane::Editor]);
	dock
		.main_surface_mut()
		.split_left(NodeIndex::root(), 0.21, vec![Pane::Rail]);
	dock
		.main_surface_mut()
		.split_right(NodeIndex::root(), 0.72, vec![Pane::Context]);
	let laid_out_ctx = egui::Context::default();
	let laid_out_raw = egui::RawInput {
		screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(1440.0, 900.0))),
		..Default::default()
	};
	let mut pane_viewer = PaneViewer;
	for _ in 0..3 {
		let raw = laid_out_raw.clone();
		let _ = laid_out_ctx.run(raw, |ctx| {
			egui::CentralPanel::default().show(ctx, |ui| {
				egui_dock::DockArea::new(&mut dock).show_inside(ui, &mut pane_viewer);
			});
		});
	}

	let json = serde_json::to_string_pretty(&dock).expect("serialize");
	println!("[dock] synthetic 3-area layout, {} bytes:\n{json}", json.len());
	assert!(json.contains("\"fraction\": 0.21"), "left split size is persisted");
	assert!(json.contains("\"fraction\": 0.72"), "right split size is persisted");
	assert!(json.contains("\"Rail\""), "tab payload is persisted");
	// `Options` (focused_node/focused_surface) may legitimately be null; node
	// rects may not — a null rect is `Rect::NOTHING` and cannot be read back.
	assert!(!json.contains("\"rect\": null"), "a laid-out dock has real rects");

	let restored: DockState<Pane> = serde_json::from_str(&json).expect("deserialize");
	assert_eq!(
		serde_json::to_string_pretty(&restored).expect("re-serialize"),
		json,
		"round-trip must be loss-free (topology + tab order + sizes + active tab)"
	);

	// 2) The app's real dock, through the crate's helpers, after one frame so
	//    the rects are finite.
	let mut harness = Harness::new(egui::vec2(1440.0, 900.0));
	harness.run(2);
	let app_json = zetawork_gui::dock_to_json(&harness.app.dock).expect("serialize app dock");
	println!("[dock] app dock, {} bytes:\n{app_json}", app_json.len());
	let app_restored = zetawork_gui::dock_from_json(&app_json).expect("deserialize app dock");
	assert_eq!(zetawork_gui::dock_to_json(&app_restored).expect("re-serialize"), app_json);
	assert!(app_json.contains("\"fraction\": 0.5"), "the centre split keeps its size");

	// 3) The restored tree is usable: every sub-page is still reachable.
	let mut app = ShellApp::new_headless();
	app.dock = app_restored;
	for tab in [Tab::Termide, Tab::Conversation, Tab::WebEmbed, Tab::Diff] {
		assert!(app.focus_tab(tab), "{tab:?} survived the round-trip");
	}

	// 4) Two caveats, both with evidence.
	//    (a) A dock that has never been drawn carries `Rect::NOTHING`, which
	//        egui serializes as `null` and *cannot* deserialize: a save must
	//        happen after at least one frame, and a never-laid-out blob has to
	//        be treated as corrupt.
	let raw =
		serde_json::to_string_pretty(&zetawork_gui::default_dock()).expect("serialize fresh dock");
	let fresh = zetawork_gui::dock_from_json(&raw);
	println!("[dock] never-laid-out dock round-trip = {fresh:?}");
	assert!(fresh.is_err(), "a never-laid-out dock must not be trusted");
	//    (b) No version field, no field defaults: a *missing* field is a hard
	//        error (unknown extra fields are ignored by serde's default).
	assert!(zetawork_gui::dock_from_json("{ not a layout").is_err(), "garbage must not load");
	let tampered = app_json.replacen("\"fraction\"", "\"not_a_field\"", 1);
	assert!(
		zetawork_gui::dock_from_json(&tampered).is_err(),
		"a missing required field must not silently yield a layout"
	);
	let fallback = zetawork_gui::dock_from_json_or_default("{ not a layout");
	assert_eq!(
		fallback.main_surface().num_tabs(),
		4,
		"corrupt input falls back to the default layout"
	);
	for tab in [Tab::Termide, Tab::Conversation, Tab::WebEmbed, Tab::Diff] {
		assert!(fallback.main_surface().find_tab(&tab).is_some(), "{tab:?} present in the fallback");
	}
}

/// The blit's cell advance uses the same width function ratatui uses, so a wide
/// grapheme consumes exactly two columns and covered cells are never painted.
#[test]
fn ratatui_blit_wide_cell_geometry() {
	assert_eq!(unicode_width::UnicodeWidthStr::width("中"), 2, "UAX #11: 中 is two cells");
	let buffer = blit::layout_probe_buffer(24, 3);

	// ratatui's own convention (`Buffer::set_stringn`): wide glyph in one cell,
	// the covered cell reset to blank.
	assert_eq!(buffer[(2, 1)].symbol(), "中");
	assert_eq!(buffer[(3, 1)].symbol(), " ", "the cell under the second half is blank");
	assert_eq!(buffer[(4, 1)].symbol(), "a", "ASCII after a wide glyph lands two columns later");
	assert_eq!(buffer[(5, 1)].symbol(), "文");
	assert_eq!(buffer[(7, 1)].symbol(), "b");
	assert_eq!(buffer[(8, 1)].symbol(), "✓", "ambiguous-width marks stay one cell");
	assert_eq!(buffer[(21, 1)].symbol(), "|", "the row marker stays aligned after two wide glyphs");

	// What the blitter paints: (column, symbol, width). Blank cells are part of
	// the iteration too (they carry the background), so filter them out here.
	let painted: Vec<(u16, String, u16)> = blit::painted_cells(&buffer, 1, 24)
		.into_iter()
		.filter(|(_, cell, _)| cell.symbol() != " ")
		.map(|(col, cell, width)| (col, cell.symbol().to_owned(), width))
		.collect();
	println!("[blit] painted cells row 1 = {painted:?}");
	assert_eq!(
		painted,
		vec![
			(2, "中".to_owned(), 2),
			(4, "a".to_owned(), 1),
			(5, "文".to_owned(), 2),
			(7, "b".to_owned(), 1),
			(8, "✓".to_owned(), 1),
			(21, "|".to_owned(), 1),
		],
		"wide graphemes must advance two grid columns"
	);

	// termide's `Cell::skip` convention: a skipped cell is never painted.
	let mut with_skip = blit::layout_probe_buffer(24, 3);
	#[allow(deprecated)]
	{
		with_skip[(4, 1)].skip = true;
	}
	let painted: Vec<u16> = blit::painted_cells(&with_skip, 1, 24)
		.into_iter()
		.map(|(col, _, _)| col)
		.collect();
	assert!(!painted.contains(&4), "a skip-flagged cell must not be painted: {painted:?}");
}

/// CJK text needs an explicitly installed font: egui's default font set has no
/// CJK glyphs, and the grid font must be a CJK face whose ASCII advance is half
/// its CJK advance (otherwise the two columns do not line up).
#[test]
fn cjk_font_must_be_supplied_explicitly() {
	let ctx = egui::Context::default();
	let mut fresh = None;
	let mut installed = None;
	let _ = ctx.run(egui::RawInput::default(), |ctx| {
		fresh = Some(blit::probe_font(ctx, &egui::FontId::monospace(14.0)));
		zetawork_gui::install_grid_fonts(ctx);
	});
	println!("[cjk] default monospace probe = {:?}", fresh);
	let fresh = fresh.expect("one pass ran");
	assert!(
		!fresh.has_cjk_glyphs,
		"egui's stock fonts must not have CJK glyphs (that is why we bundle one)"
	);

	// The font install is applied on the next pass.
	let _ = ctx.run(egui::RawInput::default(), |ctx| {
		installed = Some(blit::probe_grid_font(ctx, 14.0));
	});
	let probe = installed.expect("second pass ran");
	println!(
		"[cjk] grid font probe = ascii {:.4} space {:.4} cjk {:.4} row {:.2} ratio {:.4} has_cjk {} cells {}",
		probe.ascii_advance,
		probe.space_advance,
		probe.cjk_advance,
		probe.row_height,
		probe.cjk_ratio(),
		probe.has_cjk_glyphs,
		probe.cjk_cells
	);
	if zetawork_gui::load_cjk_font().is_none() {
		eprintln!("[cjk] no CJK font file on this machine — the advance assertion is skipped");
		return;
	}
	assert!(probe.has_cjk_glyphs, "the bundled face must provide the CJK glyphs (no tofu)");
	assert_eq!(probe.cjk_cells, 2, "unicode-width reports 中 as two cells");
	assert!(probe.ascii_advance > 0.0, "ASCII advance must be measurable");
	assert!(
		(probe.cjk_ratio() - 2.0).abs() < 0.02,
		"CJK advance must be 2x the ASCII advance for grid alignment, got {}",
		probe.cjk_ratio()
	);
}

/// The `Event::Ime` path an OS IME drives: Preedit → Commit lands in the egui
/// TextEdit and is journalled by the app.
#[test]
fn ime_preedit_and_commit_reach_the_composer() {
	let mut harness = Harness::new(egui::vec2(1440.0, 900.0));
	harness.run(3);
	assert!(harness.app.focus_tab(Tab::Conversation));
	harness.app.state.composer_focus_requested = true;
	harness.run(3);
	harness.event(egui::Event::Ime(egui::ImeEvent::Preedit("zhongwenshuruc".to_owned())));
	harness.run(2);
	let after_preedit = harness.app.state.composer.clone();
	harness
		.event(egui::Event::Ime(egui::ImeEvent::Commit("中文输入测试：宽字符占两格 ✓".to_owned())));
	harness.run(2);

	let composer = harness.app.state.composer.clone();
	let journal: Vec<String> = harness
		.app
		.state
		.ime
		.iter()
		.map(|entry| format!("{}={}", entry.kind, entry.text))
		.collect();
	println!("[ime] after preedit = {after_preedit:?}");
	println!("[ime] composer = {composer:?}");
	println!("[ime] journal = {journal:?}");
	assert_eq!(after_preedit, "zhongwenshuruc", "preedit text shows up while composing");
	assert_eq!(composer, "中文输入测试：宽字符占两格 ✓", "IME commit replaced the preedit");
	assert!(
		journal
			.iter()
			.any(|entry| entry == "Preedit=zhongwenshuruc"),
		"Preedit journalled"
	);
	assert!(
		journal
			.iter()
			.any(|entry| entry == "Commit=中文输入测试：宽字符占两格 ✓"),
		"Commit journalled"
	);
}

/// One headless pass over the whole shell: the rail, the dock, the blit pane,
/// the right context column and the web panel all lay out with real rects.
#[test]
fn shell_layout_headless_smoke() {
	let mut harness = Harness::new(egui::vec2(1440.0, 900.0));
	harness.run(3);

	// Left rail: the four default-visible builtin slots (design §2).
	let visible = harness
		.app
		.state
		.rail
		.iter()
		.filter(|slot| slot.visible)
		.count();
	assert_eq!(visible, 4, "left rail ships four builtin buttons by default");

	// Centre dock: two leaves, four sub-pages, all reachable.
	assert_eq!(harness.app.dock.main_surface().num_tabs(), 4, "four sub-page tabs");
	let nodes: Vec<String> = harness
		.app
		.dock
		.main_surface()
		.iter()
		.map(|node| format!("{node:?}"))
		.collect();
	println!("[layout] dock nodes ({}) = {nodes:?}", nodes.len());
	assert!(nodes.len() >= 3, "root split plus two leaf nodes");
	assert!(
		harness
			.app
			.dock
			.main_surface()
			.find_tab(&Tab::Termide)
			.is_some()
	);
	assert!(
		harness
			.app
			.dock
			.main_surface()
			.find_tab(&Tab::WebEmbed)
			.is_some()
	);

	// The termide pane rendered a real ratatui grid (rect + cell metrics).
	let grid = harness
		.app
		.state
		.grid_rect
		.expect("blit pane reported a rect");
	println!("[layout] blit rect = {grid:?} · {}", harness.app.state.blit_report);
	assert!(grid.width() > 200.0 && grid.height() > 100.0, "blit pane has a usable rect");
	assert!(harness.app.state.blit_report.contains('×'), "grid metrics were computed");
	assert!(harness.app.state.font_probe.is_some(), "fonts were measured on the second pass");
	assert!(
		harness.app.state.font_report.contains("CJK"),
		"font report names the CJK face: {}",
		harness.app.state.font_report
	);

	// Right context column: the five categories of the context report add up to
	// `usedTokens` (the API guarantee the panel relies on).
	let context = &harness.app.state.context;
	let sum: u64 = context
		.categories
		.iter()
		.map(|category| category.tokens)
		.sum();
	assert_eq!(sum, context.used, "categories[].tokens must sum to usedTokens");
	assert_eq!(context.categories.len(), 5, "five fixed categories");

	// The web sub-page reports the rect the WebView2 child window would cover.
	assert!(harness.app.focus_tab(Tab::WebEmbed));
	harness.run(2);
	let web = harness
		.app
		.state
		.embed_rect
		.expect("web pane reported a rect");
	println!("[layout] web panel rect = {web:?} status = {}", harness.app.state.embed_status);
	assert!(web.width() > 200.0 && web.height() > 100.0, "web pane has a usable rect");
}
