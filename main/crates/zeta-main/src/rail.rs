// SPDX-License-Identifier: AGPL-3.0-only
//! The left rail: the workbench's builtin-view column.
//!
//! Top-down the column is the button strip — one button per visible builtin
//! slot, in the configured order — and the `+` that opens the slot manager
//! (`app::Overlay::Slots`). The project/workspace/session tree of the full
//! design lands in a later slice; it grows in the space under the strip, which
//! is why the geometry helper is the single source for both drawing and
//! hit-testing.
//!
//! Pressing a button switches the pane canvas to that builtin view. P0 ships
//! the switch and the frame: the bodies are data work owned by later slices, so
//! [`render_view`] names the view's data source instead of drawing content the
//! workbench cannot back up.

use ratatui::{
	Frame,
	layout::Rect,
	style::{Color, Modifier, Style},
	text::{Line, Span},
	widgets::{Block, BorderType, Borders, Clear, Paragraph, Wrap},
};
use unicode_width::UnicodeWidthStr;

use crate::slots::Slot;

/// Column width when the frame has room. The design's left column is 26–58
/// columns wide; the button strip only needs its label, and the tree slice
/// will widen this.
pub const WIDTH: u16 = 24;
/// Narrower than this and the strip is dropped rather than truncated to
/// gibberish — the panes get the whole frame back.
pub const MIN_WIDTH: u16 = 14;

/// What the strip drew: the button rects (with the builtin each one switches
/// to) and the `+` row. The app registers hits from exactly this.
pub struct Strip {
	pub buttons: Vec<(Rect, usize)>,
	pub plus: Rect,
}

/// The rail's share of a frame this wide, before the [`MIN_WIDTH`] check.
pub fn width(frame_width: u16) -> u16 {
	WIDTH.min(frame_width / 3)
}

/// Split a content row into the rail and the pane canvas. Too narrow a frame
/// drops the rail and the panes keep the whole row — the strip is never
/// truncated into gibberish.
pub fn split(content: Rect) -> (Option<Rect>, Rect) {
	let rail_width = width(content.width);
	if rail_width < MIN_WIDTH {
		return (None, content);
	}
	(
		Some(Rect { x: content.x, y: content.y, width: rail_width, height: content.height }),
		Rect {
			x: content.x + rail_width,
			y: content.y,
			width: content.width - rail_width,
			height: content.height,
		},
	)
}

/// Draw the strip and return the geometry. `active` is the builtin currently
/// owning the pane canvas, if any.
pub fn render(frame: &mut Frame, area: Rect, slots: &[Slot], active: Option<usize>) -> Strip {
	if area.height == 0 || area.width == 0 {
		return Strip { buttons: Vec::new(), plus: Rect::default() };
	}
	let shown = crate::slots::visible(slots);
	// The `+` sits directly under the button block (the design's "bottom of the
	// button area"): the space below it belongs to the project tree slice. Its
	// row is reserved first, so a short column never pushes it out of the area.
	let plus_row = area.bottom() - 1;
	let mut buttons = Vec::new();
	let mut lines = Vec::new();
	let mut y = area.y;
	for slot in shown {
		if y >= plus_row {
			break;
		}
		buttons.push((Rect { x: area.x, y, width: area.width, height: 1 }, slot.builtin));
		lines.push(button_line(slot, active == Some(slot.builtin), area.width));
		y += 1;
	}
	lines.push(padded(" +  manage buttons", area.width, Style::default().fg(Color::DarkGray)));
	frame.render_widget(
		Paragraph::new(lines).style(Style::default().bg(Color::Reset)),
		Rect { x: area.x, y: area.y, width: area.width, height: y - area.y + 1 },
	);
	Strip { buttons, plus: Rect { x: area.x, y, width: area.width, height: 1 } }
}

/// The builtin view whose button was pressed. Renders the slot's identity and
/// where its data will come from — never invented content: the numbers and the
/// lists are the business of the slice that owns the data.
pub fn render_view(frame: &mut Frame, area: Rect, slot: &Slot) {
	let block = Block::default()
		.borders(Borders::ALL)
		.border_type(BorderType::Rounded)
		.border_style(Style::default().fg(Color::DarkGray))
		.title(Line::from(Span::styled(
			format!(" {} {} ", slot.icon, slot.title),
			Style::default()
				.fg(Color::White)
				.add_modifier(Modifier::BOLD),
		)));
	let inner = block.inner(area);
	let facts = format!(
		" rail slot · id={} · where={} · kind={} · order={} · visible={}",
		slot.id(),
		crate::slots::WHERE,
		crate::slots::KIND,
		slot.order,
		if slot.visible { "yes" } else { "no" },
	);
	let lines = vec![
		Line::from(Span::styled(facts, Style::default().fg(Color::Gray))),
		Line::from(""),
		Line::from(Span::styled("data source", Style::default().fg(Color::White))),
		Line::from(format!("  {}", slot.source())),
		Line::from(""),
		Line::from(Span::styled(
			"P0 frame: the rail switch and this frame are wired; the view body is not — it lands \
			 with the slice that owns the data above.",
			Style::default().fg(Color::DarkGray),
		)),
		Line::from(""),
		Line::from(Span::styled(
			"press Esc, or the rail button again, to go back to the panes",
			Style::default().fg(Color::DarkGray),
		)),
	];
	frame.render_widget(Clear, area);
	frame.render_widget(block, area);
	frame.render_widget(
		Paragraph::new(lines)
			.wrap(Wrap { trim: false })
			.style(Style::default().bg(Color::Reset)),
		inner,
	);
}

/// The 本机 row: the directory the workbench was started in and its branch.
///
/// The GUI synthesises the same pseudo-project (`seed::local_project`) instead
/// of reading a registration, so both surfaces name the same workspace the same
/// way even when `~/.zeta/projects.json` does not exist yet.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalWorkspace {
	pub dir: std::path::PathBuf,
	/// `None` when the directory is not a repository (or git is absent).
	pub branch: Option<String>,
}

impl LocalWorkspace {
	/// Read the row for `dir` — path and branch, both real.
	pub fn read(dir: std::path::PathBuf) -> Self {
		let branch = branch_of(&dir);
		Self { dir, branch }
	}

	/// The workspace's own name: the directory's leaf, or its full path for a
	/// drive root.
	pub fn name(&self) -> String {
		match self.dir.file_name() {
			Some(leaf) => leaf.to_string_lossy().into_owned(),
			None => self.dir.display().to_string(),
		}
	}

	/// What the table shows for the branch column.
	pub fn branch_label(&self) -> &str {
		self.branch.as_deref().unwrap_or("—")
	}
}

/// `git rev-parse --abbrev-ref HEAD` in `dir`. `None` when it is not a
/// repository, has no commits yet, or git is not installed — the row then shows
/// `—` instead of inventing a branch. No console window on Windows.
pub fn branch_of(dir: &std::path::Path) -> Option<String> {
	use std::process::{Command, Stdio};

	let mut command = Command::new("git");
	command
		.arg("-C")
		.arg(dir)
		.args(["rev-parse", "--abbrev-ref", "HEAD"])
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::null());
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt as _;
		command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
	}
	let output = command.output().ok()?;
	if !output.status.success() {
		return None;
	}
	let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
	// A detached HEAD reports `HEAD`, which is not a branch name.
	if text.is_empty() || text == "HEAD" {
		return None;
	}
	Some(text)
}

/// The projects view: the shared registry as a project → workspace tree.
///
/// The registry stores registrations, not workspaces, so each project's child
/// line is the default workspace every project opens over its own path — the
/// same one the GUI's project `+` creates. `selected` is the row `j`/`k`
/// moved; `x`/Delete removes that registration (never the directory).
pub fn render_projects(
	frame: &mut Frame,
	area: Rect,
	local: &LocalWorkspace,
	registry: &workbench_projects::Registry,
	error: Option<&str>,
	selected: usize,
) {
	let block = Block::default()
		.borders(Borders::ALL)
		.border_type(BorderType::Rounded)
		.border_style(Style::default().fg(Color::DarkGray))
		.title(Line::from(Span::styled(
			" 📁 projects ",
			Style::default()
				.fg(Color::White)
				.add_modifier(Modifier::BOLD),
		)));
	let inner = block.inner(area);
	frame.render_widget(Clear, area);
	frame.render_widget(block, area);
	let mut lines = vec![Line::from(Span::styled(
		format!(" ~/.zeta/projects.json · {} 个项目", registry.len()),
		Style::default().fg(Color::Gray),
	))];
	if let Some(error) = error {
		lines.push(Line::from(Span::styled(
			format!(" 读取失败：{error}"),
			Style::default().fg(Color::Red),
		)));
	}
	lines.push(Line::from(""));
	// 本机 first, exactly like the GUI's left column: the directory this
	// workbench runs in, with its branch. It is not a registration.
	lines.push(Line::from(Span::styled(
		format!(" ▏📁 本机 · {}", local.name()),
		Style::default()
			.fg(Color::White)
			.add_modifier(Modifier::BOLD),
	)));
	lines.push(Line::from(Span::styled(
		format!("     {} · {}", local.dir.display(), local.branch_label()),
		Style::default().fg(Color::DarkGray),
	)));
	lines.push(Line::from(""));
	if registry.is_empty() {
		lines.push(Line::from(Span::styled(" 尚未注册项目。", Style::default().fg(Color::DarkGray))));
		lines.push(Line::from(Span::styled(
			" 在 GUI 的 项目 一节按目录添加。",
			Style::default().fg(Color::DarkGray),
		)));
	}
	for (index, project) in registry.list().iter().enumerate() {
		let active = index == selected;
		lines.push(Line::from(Span::styled(
			format!("{} 📁 {}", if active { "▏" } else { " " }, project.name),
			if active {
				Style::default()
					.fg(Color::White)
					.add_modifier(Modifier::BOLD)
			} else {
				Style::default().fg(Color::Gray)
			},
		)));
		lines.push(Line::from(Span::styled(
			format!("     {}", project.path.display()),
			Style::default().fg(Color::DarkGray),
		)));
		lines.push(Line::from(Span::styled(
			"     └ 默认工作区 · zetacode",
			Style::default().fg(Color::DarkGray),
		)));
	}
	lines.push(Line::from(""));
	lines.push(Line::from(Span::styled(
		" j/k 选择 · x 移除注册（目录保留）",
		Style::default().fg(Color::DarkGray),
	)));
	frame.render_widget(
		Paragraph::new(lines)
			.wrap(Wrap { trim: false })
			.style(Style::default().bg(Color::Reset)),
		inner,
	);
}

/// One button row: the active marker, the icon and the title, padded to the
/// column so the highlight reads as a row and not as a label.
fn button_line(slot: &Slot, active: bool, width: u16) -> Line<'static> {
	let marker = if active { "▏" } else { " " };
	let label = format!("{marker} {} {}", slot.icon, slot.title);
	let style = if active {
		Style::default()
			.fg(Color::White)
			.add_modifier(Modifier::BOLD)
	} else {
		Style::default().fg(Color::Gray)
	};
	padded(&label, width, style)
}

fn padded(label: &str, width: u16, style: Style) -> Line<'static> {
	let padding = (width as usize).saturating_sub(label.width());
	Line::from(Span::styled(format!("{label}{}", " ".repeat(padding)), style))
}

#[cfg(test)]
mod tests {
	use ratatui::{Terminal, backend::TestBackend};

	use super::*;
	use crate::slots;

	/// Draw the strip through a real `TestBackend` and read the frame back as
	/// one string per row — the same path the workbench draws through. A
	/// double-width glyph leaves its second cell blank, so every row is
	/// whitespace-normalized before assertions compare it.
	fn draw(slots: &[Slot], active: Option<usize>, width: u16, height: u16) -> (Vec<String>, Strip) {
		let mut terminal = Terminal::new(TestBackend::new(width, height)).expect("terminal");
		let mut strip = None;
		terminal
			.draw(|frame| {
				let area = frame.area();
				strip = Some(render(frame, area, slots, active));
			})
			.expect("draw");
		let buffer = terminal.backend().buffer().clone();
		let lines = buffer
			.content
			.chunks(buffer.area.width as usize)
			.map(|row| {
				row.iter()
					.map(|cell| cell.symbol())
					.collect::<String>()
					.split_whitespace()
					.collect::<Vec<_>>()
					.join(" ")
			})
			.collect();
		(lines, strip.expect("strip"))
	}

	fn button_titles(lines: &[String], strip: &Strip) -> Vec<String> {
		strip
			.buttons
			.iter()
			.map(|(rect, _)| {
				lines[rect.y as usize]
					.trim()
					.trim_start_matches('▏')
					.trim()
					.to_string()
			})
			.collect()
	}

	#[test]
	fn the_default_rail_draws_four_buttons_then_the_plus() {
		let registry = slots::default_registry();
		let (lines, strip) = draw(&registry, None, 60, 20);
		assert_eq!(strip.buttons.len(), 4, "exactly the four default slots");
		assert_eq!(strip.plus.y, 4, "the `+` sits directly under the buttons");
		assert!(lines[strip.plus.y as usize].contains("+ manage buttons"));
		assert_eq!(
			button_titles(&lines, &strip),
			["🔍 search", "☰ tasks", "⏱ automation", "📁 projects"],
			"drawn top-down in config order"
		);
		assert!(
			!lines.iter().any(|line| line.contains("mobile")),
			"the hidden mobile slot is not drawn"
		);
	}

	#[test]
	fn hiding_a_slot_drops_its_button_and_moves_the_plus_up() {
		let mut registry = slots::default_registry();
		let index = registry
			.iter()
			.position(|slot| slot.id() == "automation")
			.expect("builtin");
		registry[index].visible = false;
		let (lines, strip) = draw(&registry, None, 60, 20);
		assert_eq!(strip.buttons.len(), 3);
		assert_eq!(button_titles(&lines, &strip), ["🔍 search", "☰ tasks", "📁 projects"]);
		assert_eq!(strip.plus.y, 3);
		assert!(!lines.iter().any(|line| line.contains("automation")));
	}

	#[test]
	fn the_button_order_follows_the_configured_order() {
		let mut registry = slots::default_registry();
		// `mobile` starts hidden: reordering must not need it visible first.
		let index = registry
			.iter()
			.position(|slot| slot.id() == "mobile")
			.expect("builtin");
		assert!(slots::move_up(&mut registry, index));
		assert!(slots::move_up(&mut registry, index - 1));
		registry[index - 2].visible = true;
		let (lines, strip) = draw(&registry, Some(registry[index - 2].builtin), 60, 20);
		assert_eq!(
			button_titles(&lines, &strip),
			["🔍 search", "📱 mobile", "☰ tasks", "⏱ automation", "📁 projects"],
			"the strip is the master list filtered by visibility, not the builtin table order"
		);
		assert!(
			lines[strip.buttons[1].0.y as usize].starts_with('▏'),
			"the active slot carries the marker"
		);
		assert_eq!(slots::visible(&registry)[1].id(), "mobile", "the registry keeps that order");
	}

	#[test]
	fn the_view_frame_names_the_slots_source() {
		let registry = slots::default_registry();
		let mobile = registry
			.iter()
			.find(|slot| slot.id() == "mobile")
			.expect("builtin");
		let mut terminal = Terminal::new(TestBackend::new(80, 16)).expect("terminal");
		terminal
			.draw(|frame| {
				let area = frame.area();
				render_view(frame, area, mobile);
			})
			.expect("draw");
		let buffer = terminal.backend().buffer().clone();
		let text: String = buffer
			.content
			.chunks(buffer.area.width as usize)
			.map(|row| {
				row.iter()
					.map(|cell| cell.symbol())
					.collect::<String>()
					.split_whitespace()
					.collect::<Vec<_>>()
					.join(" ")
			})
			.collect::<Vec<_>>()
			.join("\n");
		assert!(text.contains("📱 mobile"), "the frame is titled by the slot");
		assert!(text.contains("id=mobile"), "and states the slot it belongs to");
		assert!(text.contains("a zeta web page (web-ui)"), "with its real data source");
		assert!(text.contains("the view body is not"), "and says plainly that P0 draws no body");
	}

	#[test]
	fn the_projects_view_reads_the_shared_registry() {
		fn text_of(local: &LocalWorkspace, registry: &workbench_projects::Registry) -> String {
			let mut terminal = Terminal::new(TestBackend::new(64, 14)).expect("terminal");
			terminal
				.draw(|frame| {
					let area = frame.area();
					render_projects(frame, area, local, registry, None, 0);
				})
				.expect("draw");
			let buffer = terminal.backend().buffer().clone();
			buffer
				.content
				.chunks(buffer.area.width as usize)
				.map(|row| row.iter().map(|cell| cell.symbol()).collect::<String>())
				.collect::<Vec<_>>()
				.join("\n")
		}

		let dir = tempfile::tempdir().expect("temp dir");
		let path = dir.path().join("projects.json");
		std::fs::write(
			&path,
			"{\"version\":1,\"projects\":[{\"id\":\"p1\",\"name\":\"演示\",\"path\":\"C:/work/demo\",\
			 \"addedAt\":1}]}",
		)
		.expect("write registry");
		let registry = workbench_projects::Registry::load_from(&path).expect("load");
		// A wide glyph leaves its second buffer cell blank, so compare with
		// every space removed — the same normalization the strip tests use.
		let local = LocalWorkspace {
			dir: std::path::PathBuf::from("C:/work/demo"),
			branch: Some("main".into()),
		};
		let text: String = text_of(&local, &registry)
			.chars()
			.filter(|ch| !ch.is_whitespace())
			.collect();
		assert!(text.contains("📁projects"), "the frame is titled by the view:\n{text}");
		assert!(text.contains("~/.zeta/projects.json"), "and names the shared file");
		assert!(text.contains("演示"), "the registered name is drawn");
		assert!(text.contains("work") && text.contains("demo"), "so is its path");
		assert!(text.contains("默认工作区·zetacode"), "with the workspace child line");
		assert!(text.contains("x移除注册"), "and the remove key");
		// 本机 comes first, unregistered, with its own branch — the row the GUI's
		// left column always shows.
		assert!(text.contains("📁本机·demo"), "本机 is drawn with its directory name:\n{text}");
		assert!(text.contains("main"), "and its branch");

		let empty = workbench_projects::Registry::empty_at(dir.path().join("none.json"));
		let text: String = text_of(&local, &empty)
			.chars()
			.filter(|ch| !ch.is_whitespace())
			.collect();
		assert!(text.contains("尚未注册项目"), "an empty registry says so: {text}");
	}

	#[test]
	fn a_frame_too_narrow_for_the_strip_is_dropped() {
		assert_eq!(width(120), WIDTH);
		assert_eq!(width(60), 20, "a third of the frame, so narrow panes survive");
		assert!(width(30) < MIN_WIDTH, "the app then keeps the full width for the panes");
	}

	#[test]
	fn the_rail_takes_the_left_edge_of_the_content_row() {
		let content = Rect { x: 0, y: 2, width: 100, height: 30 };
		let (rail_area, canvas) = split(content);
		let rail_area = rail_area.expect("a 100-column frame has room for the strip");
		assert_eq!((rail_area.x, rail_area.width), (0, WIDTH), "the strip is the left edge");
		assert_eq!((canvas.x, canvas.width), (WIDTH, 100 - WIDTH), "the canvas gets the rest");
		assert_eq!(canvas.union(rail_area), content, "and the two cover the row exactly");

		let (dropped, canvas) = split(Rect { width: 30, ..content });
		assert_eq!(dropped, None);
		assert_eq!(canvas.width, 30, "a narrow frame keeps the panes full width");
	}
}
