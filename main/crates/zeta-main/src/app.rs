use crate::help;
use crate::layout::{Axis, PaneNode};
use crate::tab::{PaneKind, Tab};
use crate::tabs_ui::{TabBar, status_text, tab_bar_hits};
use crate::widgets::{self, WidgetState};
use anyhow::Result;
use crossterm::event::{
	self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEventKind,
};
use ratatui::Terminal as RatuTerminal;
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph, Wrap};
use std::io::Stdout;
use std::time::Duration;
use termide_core::{KeyChord, Panel, PanelConfig, PanelEvent, RenderContext, ThemeColors};
use termide_keyboard::{KeyNormalizer, KeyboardCaps};

/// Colorless theme: inherit the terminal's own colors wherever possible, so
/// panes render on the terminal's own background instead of a palette.
fn plain_theme() -> termide_theme::Theme {
	termide_theme::Theme {
		name: "zeta-plain",
		bg: Color::Reset,
		fg: Color::Reset,
		accented_bg: Color::Reset,
		accented_fg: Color::White,
		selected_bg: Color::DarkGray,
		selected_fg: Color::White,
		disabled: Color::DarkGray,
		success: Color::Green,
		warning: Color::Yellow,
		error: Color::Red,
		is_light: Some(false),
	}
}

/// What a press-drag is currently doing.
enum Drag {
	/// Reordering tabs along the tab row.
	TabReorder(usize),
	/// Moving a pane onto another pane (swap on release).
	PaneSwap { from: usize },
	/// Dragging a split boundary; `line` is the boundary coordinate the drag
	/// started on, `last` the cursor position it was last seen at.
	Resize { axis: Axis, last: u16 },
}

/// Clickable controls rendered on a pane's title row: `[+]` split,
/// page numbers, `✕` close. Coordinates are absolute frame positions.
#[derive(Clone)]
struct PaneControls {
	pane: usize,
	row: u16,
	plus: (u16, u16),
	pages: Vec<(u16, u16)>,
	close: (u16, u16),
}

impl PaneControls {
	fn hits(&self, column: u16, row: u16) -> Option<Control> {
		if row != self.row {
			return None;
		}
		let in_box = |b: (u16, u16)| column >= b.0 && column < b.0 + b.1;
		if in_box(self.plus) {
			return Some(Control::Split);
		}
		for (page, b) in self.pages.iter().enumerate() {
			if in_box(*b) {
				return Some(Control::Page(page));
			}
		}
		if in_box(self.close) {
			return Some(Control::Close);
		}
		None
	}
}

enum Control {
	Split,
	Page(usize),
	Close,
}

/// The workspace: top-level tabs, each tab a tiled tree of panes.
pub struct Workspace {
	tabs: Vec<Tab>,
	active_tab: usize,
	normalizer: KeyNormalizer,
	theme: termide_theme::Theme,
	config: std::sync::Arc<termide_config::Config>,
	help_open: bool,
	/// One-line notice shown in the status bar (tool missing, actions done).
	notice: Option<String>,
	/// (pane id, rect) of the active tab as laid out in the last frame —
	/// the hit-test source for mouse routing.
	last_pane_areas: Vec<(usize, Rect)>,
	/// Title-row controls per pane from the last frame.
	last_controls: Vec<PaneControls>,
	/// Clickable right-edge segments of the status bar: (x, width) of
	/// `[layout]` and `[quit]`, plus the row they live on.
	status_hits: ((u16, u16), (u16, u16), u16),
	/// Index of the currently open top menu, when any.
	open_menu: Option<usize>,
	/// Active press-drag, when any.
	drag: Option<Drag>,
	/// Frame size from the last draw — mouse hit geometry needs it.
	last_frame: Rect,
	/// Interactive widget state (pomodoro, clipboard history).
	widgets: WidgetState,
}

pub fn run() -> Result<()> {
	let mut stdout = std::io::stdout();
	crossterm::terminal::enable_raw_mode()?;
	crossterm::execute!(
		stdout,
		crossterm::terminal::EnterAlternateScreen,
		crossterm::event::EnableMouseCapture
	)?;
	let backend = CrosstermBackend::new(stdout);
	let mut terminal = RatuTerminal::new(backend)?;
	let result = event_loop(&mut terminal);
	crossterm::terminal::disable_raw_mode()?;
	crossterm::execute!(
		terminal.backend_mut(),
		crossterm::terminal::LeaveAlternateScreen,
		crossterm::event::DisableMouseCapture
	)?;
	terminal.show_cursor()?;
	result
}

fn event_loop(terminal: &mut RatuTerminal<CrosstermBackend<Stdout>>) -> Result<()> {
	let mut ws = Workspace::new()?;
	loop {
		terminal.draw(|frame| ws.draw(frame))?;
		if event::poll(Duration::from_millis(50))? {
			match event::read()? {
				Event::Key(key) => {
					if key.kind == KeyEventKind::Release {
						continue;
					}
					if ws.handle_key(key)? {
						return Ok(());
					}
				},
				Event::Mouse(mouse) => {
					if ws.handle_mouse(mouse) {
						return Ok(());
					}
				},
				Event::Resize(cols, rows) => ws.resize(rows, cols),
				_ => {},
			}
		} else {
			ws.tick();
		}
	}
}

impl Workspace {
	fn new() -> Result<Self> {
		let cwd = std::env::current_dir().ok();
		let first = Tab::new_shell(cwd)?;
		Ok(Self {
			tabs: vec![first],
			active_tab: 0,
			normalizer: KeyNormalizer::new(KeyboardCaps::default()),
			theme: plain_theme(),
			config: std::sync::Arc::new(termide_config::Config::default()),
			help_open: false,
			notice: None,
			last_pane_areas: Vec::new(),
			last_controls: Vec::new(),
			status_hits: ((0, 0), (0, 0), 0),
			open_menu: None,
			drag: None,
			last_frame: Rect::default(),
			widgets: WidgetState::default(),
		})
	}

	fn active(&mut self) -> &mut Tab {
		&mut self.tabs[self.active_tab]
	}

	/// The focused pane's last known rect (Alt-key splits need it).
	fn focused_rect(&self) -> Rect {
		let tab = &self.tabs[self.active_tab];
		let active = tab.active;
		self
			.last_pane_areas
			.iter()
			.find(|(id, _)| *id == active)
			.map(|(_, r)| *r)
			.unwrap_or_else(|| Rect { x: 0, y: 2, width: self.last_frame.width.max(4), height: 10 })
	}

	/// Split the focused pane and open `kind` in the new slot. Missing suite
	/// tools self-install in the slot instead (see `PaneKind`).
	fn split_active(&mut self, kind: PaneKind) {
		let rect = self.focused_rect();
		let cwd = std::env::current_dir().ok();
		let kind = match kind.install_command() {
			Some(install) => {
				self.notice =
					Some(format!("{} not on PATH — installing in the new pane", kind.label()));
				PaneKind::Command(install)
			},
			None => kind,
		};
		match self.active().add_pane(kind, cwd, rect) {
			Ok(()) => self.notice = None,
			Err(error) => self.notice = Some(format!("split failed: {error}")),
		}
	}

	/// Returns `true` when the workspace should quit.
	fn handle_key(&mut self, key: KeyEvent) -> Result<bool> {
		if self.help_open {
			// The overlay never traps the workspace: Esc dismisses, plain
			// typing falls through to the focused pane, Alt combos stay live.
			self.help_open = false;
			if matches!(key.code, KeyCode::Esc) {
				return Ok(false);
			}
		}
		if key.modifiers.contains(KeyModifiers::ALT) {
			match key.code {
				KeyCode::Char('q') | KeyCode::Char('Q') => return Ok(true),
				KeyCode::Char('t') | KeyCode::Char('T') => self.new_tab(),
				KeyCode::Char('w') | KeyCode::Char('W') => {
					if self.tabs.len() > 1 {
						self.tabs.remove(self.active_tab);
						self.active_tab = self.active_tab.min(self.tabs.len() - 1);
					} else {
						return Ok(true);
					}
				},
				KeyCode::Char(n @ '1'..='9') => {
					let idx = (n as u8 - b'1') as usize;
					if idx < self.tabs.len() {
						self.active_tab = idx;
					}
				},
				KeyCode::Left => {
					self.active_tab = if self.active_tab == 0 {
						self.tabs.len() - 1
					} else {
						self.active_tab - 1
					};
				},
				KeyCode::Right => {
					self.active_tab = (self.active_tab + 1) % self.tabs.len();
				},
				KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Char('s') | KeyCode::Char('S') => {
					self.split_active(PaneKind::Shell)
				},
				KeyCode::Char('c') | KeyCode::Char('C') => self.split_active(PaneKind::Agent),
				KeyCode::Char('e') | KeyCode::Char('E') => self.split_active(PaneKind::Editor),
				KeyCode::Char('i') | KeyCode::Char('I') => self.split_active(PaneKind::Ide),
				KeyCode::Char('d') | KeyCode::Char('D') => self.split_active(PaneKind::Time),
				KeyCode::Char('p') | KeyCode::Char('P') => self.split_active(PaneKind::Pomodoro),
				KeyCode::Char('l') | KeyCode::Char('L') => self.cycle_preset(),
				KeyCode::Char('o') | KeyCode::Char('O') => {
					let tab = self.active();
					if !tab.panes.is_empty() {
						tab.active = (tab.active + 1) % tab.panes.len();
					}
				},
				KeyCode::Char('x') | KeyCode::Char('X') => {
					let tab = self.active();
					let idx = tab.active;
					tab.close_pane(idx);
				},
				_ => {},
			}
			return Ok(false);
		}
		if matches!(key.code, KeyCode::F(1)) {
			self.help_open = true;
			return Ok(false);
		}
		// Everything else belongs to the focused pane (widget pages have no
		// child to type into).
		let chord = KeyChord::new(key, &self.normalizer);
		let events = {
			let tab = self.active();
			let Some(pane) = tab.panes.get_mut(tab.active) else {
				return Ok(false);
			};
			let Some(term) = pane.as_terminal() else {
				return Ok(false);
			};
			term.handle_key(chord)
		};
		self.apply_events(events);
		Ok(false)
	}

	/// Cycle the layout presets (1x1 → 1x2 → 2x2 → 1x1 …), creating fresh
	/// shell panes for new slots.
	fn cycle_preset(&mut self) {
		let presets = PaneNode::presets();
		let cwd = std::env::current_dir().ok();
		// Next preset whose slot count fits the live panes, wrapping once.
		let len = presets.len();
		let current = self.tabs[self.active_tab]
			.tree
			.leaf_rects(Rect::default())
			.len();
		let start = presets.iter().position(|(_, t)| count_leaves(t) == current);
		let mut chosen = None;
		for offset in 1..=len {
			let idx = (start.unwrap_or(0) + offset) % len;
			let (_, tree) = &presets[idx];
			if count_leaves(tree) <= self.tabs[self.active_tab].panes.len() {
				chosen = Some(idx);
				break;
			}
		}
		let idx = chosen.unwrap_or(0);
		let (_, tree) = presets[idx].clone();
		if let Err(error) = self.active().apply_preset(tree, cwd) {
			self.notice = Some(format!("{error}"));
		}
	}

	/// Mouse routing. Returns `true` when the workspace should quit.
	fn handle_mouse(&mut self, mouse: crossterm::event::MouseEvent) -> bool {
		// Open menu swallows clicks anywhere until dismissed.
		if self.open_menu.is_some() {
			return self.handle_menu_mouse(mouse);
		}
		match mouse.kind {
			MouseEventKind::Down(MouseButton::Left) => self.handle_mouse_down(mouse),
			MouseEventKind::Drag(MouseButton::Left) => self.handle_mouse_drag(mouse),
			MouseEventKind::Up(MouseButton::Left) => self.handle_mouse_up(mouse),
			_ => false,
		}
	}

	/// A menu is open: clicking an item dispatches it, clicking anywhere else
	/// closes the menu. Returns true only for Quit.
	fn handle_menu_mouse(&mut self, mouse: crossterm::event::MouseEvent) -> bool {
		let menu = self.open_menu.take();
		let Some(menu) = menu else {
			return false;
		};
		if mouse.kind != MouseEventKind::Down(MouseButton::Left) {
			self.open_menu = Some(menu); // only act on clicks
			return false;
		}
		let rect = crate::tabs_ui::dropdown_hits(self.last_frame.width, menu, self.last_menu_x(menu));
		let inside_item = mouse.row > rect.y
			&& mouse.row < rect.bottom() - 1
			&& mouse.column >= rect.x
			&& mouse.column < rect.right();
		if !inside_item {
			return false; // click outside: just close
		}
		let item = (mouse.row - rect.y - 1) as usize;
		self.run_menu_action(menu, item)
	}

	/// Dispatch a menu action. Returns true for Quit.
	fn run_menu_action(&mut self, menu: usize, item: usize) -> bool {
		match (menu, item) {
			// File: New tab / Close tab / Quit
			(0, 0) => self.new_tab(),
			(0, 1) => {
				if self.tabs.len() > 1 {
					self.tabs.remove(self.active_tab);
					self.active_tab = self.active_tab.min(self.tabs.len() - 1);
				} else {
					return true;
				}
			},
			(0, 2) => return true,
			// Pane: split kinds / widgets / subtab / close
			(1, 0) => self.split_active(PaneKind::Shell),
			(1, 1) => self.split_active(PaneKind::Agent),
			(1, 2) => self.split_active(PaneKind::Editor),
			(1, 3) => self.split_active(PaneKind::Ide),
			(1, 4) => self.split_active(PaneKind::Time),
			(1, 5) => self.split_active(PaneKind::Pomodoro),
			(1, 6) => self.split_active(PaneKind::Clipboard),
			(1, 7) => {
				let cwd = std::env::current_dir().ok();
				let tab = self.active();
				if let Some(pane) = tab.panes.get_mut(tab.active) {
					let _ = pane.open_page(PaneKind::Shell, 24, 80, cwd);
				}
			},
			(1, 8) => {
				let tab = self.active();
				let idx = tab.active;
				tab.close_pane(idx);
			},
			// Tab: next / previous
			(2, 0) => self.active_tab = (self.active_tab + 1) % self.tabs.len(),
			(2, 1) => {
				self.active_tab = if self.active_tab == 0 {
					self.tabs.len() - 1
				} else {
					self.active_tab - 1
				}
			},
			// Tools: presets / equalize / focus next
			(3, 0..=2) => {
				let (_, tree) = PaneNode::presets()[item].clone();
				let cwd = std::env::current_dir().ok();
				if let Err(error) = self.active().apply_preset(tree, cwd) {
					self.notice = Some(format!("{error}"));
				}
			},
			(3, 3) => self.active().tree.equalize(),
			(3, 4) => {
				let tab = self.active();
				if !tab.panes.is_empty() {
					tab.active = (tab.active + 1) % tab.panes.len();
				}
			},
			// Settings: settings (placeholder notice) / help
			(4, 0) => {
				self.notice =
					Some("Settings surface is on the roadmap — keybindings, theme, default shell".into())
			},
			(4, 1) => self.help_open = true,
			_ => {},
		}
		false
	}

	fn handle_mouse_down(&mut self, mouse: crossterm::event::MouseEvent) -> bool {
		// Tab bar row: ‹/› steppers, tab switch/drag start, active-tab ×, `+`, menus.
		if mouse.row == 0 {
			let titles: Vec<String> = self.tabs.iter().map(tab_title).collect();
			let hits = tab_bar_hits(self.last_frame.width, &titles, self.active_tab);
			let in_box = |b: (u16, u16)| mouse.column >= b.0 && mouse.column < b.0 + b.1;
			if in_box(hits.prev) {
				self.active_tab = if self.active_tab == 0 {
					self.tabs.len() - 1
				} else {
					self.active_tab - 1
				};
			} else if let Some(idx) = hits.tabs.iter().position(|b| in_box(*b)) {
				self.active_tab = idx;
				self.drag = Some(Drag::TabReorder(idx));
			} else if hits.closes[self.active_tab].is_some_and(in_box) {
				if self.tabs.len() > 1 {
					self.tabs.remove(self.active_tab);
					self.active_tab = self.active_tab.min(self.tabs.len() - 1);
				} else {
					return true;
				}
			} else if in_box(hits.next) {
				self.active_tab = (self.active_tab + 1) % self.tabs.len();
			} else if in_box(hits.plus) {
				self.new_tab();
			} else if let Some(menu) = hits.menus.iter().position(|b| in_box(*b)) {
				self.open_menu = Some(menu);
			}
			return false;
		}
		// Status bar right edge: [layout] cycles, [quit] exits.
		let (layout_box, quit_box, status_row) = self.status_hits;
		if status_row != 0 && mouse.row == status_row {
			if mouse.column >= layout_box.0 && mouse.column < layout_box.0 + layout_box.1 {
				self.cycle_preset();
			} else if mouse.column >= quit_box.0 && mouse.column < quit_box.0 + quit_box.1 {
				return true;
			}
			return false;
		}
		// Pane title-row controls: [+] split, page numbers, ✕ close page.
		for controls in self.last_controls.clone() {
			let hits = PaneControls {
				pane: controls.pane,
				row: controls.row,
				plus: controls.plus,
				pages: controls.pages.clone(),
				close: controls.close,
			};
			if let Some(action) = hits.hits(mouse.column, mouse.row) {
				match action {
					Control::Split => self.split_active(PaneKind::Shell),
					Control::Page(page) => {
						let tab = self.active();
						if let Some(pane) = tab.panes.get_mut(controls.pane) {
							pane.page = page.min(pane.pages.len().saturating_sub(1));
						}
					},
					Control::Close => {
						let close_pane = {
							let tab = self.active();
							pane_close_page(tab, controls.pane)
						};
						if close_pane {
							self.active().close_pane(controls.pane);
						}
					},
				}
				return false;
			}
		}
		let position = ratatui::layout::Position { x: mouse.column, y: mouse.row };
		let areas = self.pane_area_map();
		// A shared split boundary near the cursor starts a resize drag.
		if let Some((axis, line)) = find_boundary(&areas, mouse.column, mouse.row) {
			self.drag = Some(Drag::Resize {
				axis,
				last: if matches!(axis, Axis::Row) {
					mouse.column
				} else {
					mouse.row
				},
			});
			let _ = line;
			return false;
		}
		if let Some((pane, area)) = areas
			.iter()
			.find(|(_, a)| a.contains(position))
			.map(|(p, a)| (*p, *a))
		{
			// Title row (not on controls): start a pane swap drag.
			if mouse.row == area.y {
				self.drag = Some(Drag::PaneSwap { from: pane });
				self.active().active = pane;
				return false;
			}
			self.active().active = pane;
			// Interactive widgets get first refusal on the click.
			let inner = Rect {
				x: area.x + 1,
				y: area.y + 1,
				width: area.width.saturating_sub(2),
				height: area.height.saturating_sub(2),
			};
			let kind = self
				.active()
				.panes
				.get(pane)
				.and_then(|p| p.active_page())
				.map(|p| p.kind.clone());
			match kind {
				Some(PaneKind::Pomodoro) => {
					if widgets::pomodoro_click(
						&mut self.widgets.pomodoro,
						inner,
						mouse.column,
						mouse.row,
					) {
						return false;
					}
				},
				Some(PaneKind::Clipboard) => {
					if let Some(rect) = widgets::clipboard_capture_rect(inner) {
						if rect.contains(position) {
							widgets::clipboard_capture(&mut self.widgets);
							return false;
						}
					}
				},
				_ => {},
			}
			let events = match self
				.active()
				.panes
				.get_mut(pane)
				.and_then(|p| p.as_terminal())
			{
				Some(term) => term.handle_mouse(mouse, area),
				None => Vec::new(),
			};
			self.apply_events(events);
		}
		false
	}

	fn handle_mouse_drag(&mut self, mouse: crossterm::event::MouseEvent) -> bool {
		let resize_drag = match self.drag.as_ref() {
			Some(Drag::Resize { axis, last }) => Some((*axis, *last)),
			_ => None,
		};
		if let Some((axis, last)) = resize_drag {
			let position = cursor_axis(mouse, axis);
			let delta = position as i32 - last as i32;
			if delta != 0 {
				let rects = self.pane_area_map();
				if let Some((_, line)) = find_boundary(&rects, mouse.column, mouse.row) {
					let content = self.content_rect();
					self.active().tree.resize_at(content, axis, line, delta);
				}
				if let Some(Drag::Resize { last, .. }) = self.drag.as_mut() {
					*last = position;
				}
			}
		}
		false
	}

	fn handle_mouse_up(&mut self, mouse: crossterm::event::MouseEvent) -> bool {
		match self.drag.take() {
			Some(Drag::TabReorder(from)) => {
				let titles: Vec<String> = self.tabs.iter().map(tab_title).collect();
				let hits = tab_bar_hits(self.last_frame.width, &titles, usize::MAX);
				if let Some(target) = hits
					.tabs
					.iter()
					.position(|b| mouse.column >= b.0 && mouse.column < b.0 + b.1)
				{
					if target != from && from < self.tabs.len() {
						let tab = self.tabs.remove(from);
						self.tabs.insert(target.min(self.tabs.len()), tab);
						self.active_tab = target.min(self.tabs.len() - 1);
					}
				}
			},
			Some(Drag::PaneSwap { from }) => {
				let position = ratatui::layout::Position { x: mouse.column, y: mouse.row };
				if let Some((target, _)) = self
					.pane_area_map()
					.iter()
					.find(|(_, a)| a.contains(position))
					.map(|(p, a)| (*p, *a))
				{
					if target != from {
						self.active().tree.swap(from, target);
						self.active().active = target;
					}
				}
			},
			_ => {},
		}
		self.drag = None;
		false
	}

	fn apply_events(&mut self, events: Vec<PanelEvent>) {
		for event in events {
			if matches!(event, PanelEvent::Quit) {
				return;
			}
			if let PanelEvent::RunCommand { command, .. } = event {
				self.split_active(PaneKind::Command(command));
			}
		}
	}

	fn new_tab(&mut self) {
		let cwd = std::env::current_dir().ok();
		match Tab::new_shell(cwd) {
			Ok(tab) => {
				self.tabs.push(tab);
				self.active_tab = self.tabs.len() - 1;
			},
			Err(error) => self.notice = Some(format!("new tab failed: {error}")),
		}
	}

	fn resize(&mut self, rows: u16, cols: u16) {
		for tab in &mut self.tabs {
			tab.resize(rows.saturating_sub(2), cols);
		}
	}

	fn tick(&mut self) {
		self.widgets.pomodoro.tick();
		let mut notices = Vec::new();
		for (tab_idx, tab) in self.tabs.iter_mut().enumerate() {
			// Reap dead PTY pages; a pane whose last page died closes.
			let mut dead_panes = Vec::new();
			for pane in tab.panes.iter_mut() {
				let mut dead_pages = Vec::new();
				for (page_idx, page) in pane.pages.iter_mut().enumerate() {
					if let crate::tab::PaneBody::Pty(term) = &mut page.body {
						for event in term.tick() {
							if matches!(event, PanelEvent::Quit) {
								dead_pages.push(page_idx);
							}
						}
						if !term.is_alive() {
							dead_pages.push(page_idx);
						}
					}
				}
				dead_pages.sort_unstable();
				dead_pages.dedup();
				for idx in dead_pages.into_iter().rev() {
					if tab_idx == self.active_tab {
						notices.push(format!("page exited: {}", pane.pages[idx].kind.label()));
					}
					if pane.close_page(idx) {
						dead_panes.push(idx);
					}
				}
			}
			dead_panes.sort_unstable();
			dead_panes.dedup();
			for idx in dead_panes.into_iter().rev() {
				tab.close_pane(idx);
			}
		}
		if self.tabs.len() > 1 {
			let before = self.tabs.len();
			self.tabs.retain(|tab| !tab.panes.is_empty());
			if self.tabs.len() < before {
				self.active_tab = self.active_tab.min(self.tabs.len() - 1);
			}
		}
		if let Some(last) = notices.pop() {
			self.notice = Some(last);
		}
	}

	/// (pane id, rect) of the active tab from the last frame.
	fn pane_area_map(&self) -> Vec<(usize, Rect)> {
		self.last_pane_areas.clone()
	}

	/// Content area (between the tab row and the status row) of the last frame.
	fn content_rect(&self) -> Rect {
		Rect {
			x: 1,
			y: 1,
			width: self.last_frame.width.saturating_sub(2),
			height: self.last_frame.height.saturating_sub(3),
		}
	}

	/// X of a menu trigger from the last frame's geometry.
	fn last_menu_x(&self, menu: usize) -> u16 {
		let titles: Vec<String> = self.tabs.iter().map(tab_title).collect();
		crate::tabs_ui::tab_bar_hits(self.last_frame.width, &titles, self.active_tab)
			.menus
			.get(menu)
			.map(|(x, _)| *x)
			.unwrap_or(0)
	}

	fn draw(&mut self, frame: &mut ratatui::Frame) {
		let size = frame.area();
		self.last_frame = size;
		let rows = Layout::vertical([
			Constraint::Length(1), // tab bar + menus
			Constraint::Min(3),    // panes
			Constraint::Length(1), // status
		])
		.split(size);

		let open_menu = self.open_menu;
		let titles: Vec<String> = self.tabs.iter().map(tab_title).collect();
		frame.render_widget(TabBar { titles: &titles, active: self.active_tab, open_menu }, rows[0]);
		if let Some(menu) = open_menu {
			let trigger_x = self.last_menu_x(menu);
			let dropdown = crate::tabs_ui::MenuDropdown {
				menu,
				area: Rect { x: trigger_x, y: rows[0].y, width: 1, height: 1 },
			};
			frame.render_widget(dropdown, size);
		}

		let content = rows[1];
		let panel_config = PanelConfig::default();
		let rects: Vec<(usize, Rect)> = {
			let tab = &self.tabs[self.active_tab];
			tab.tree.leaf_rects(content)
		};
		self.last_pane_areas = rects.clone();
		let widgets = self.widgets.clone();
		self.last_controls.clear();
		let tab = &mut self.tabs[self.active_tab];
		for (pane_id, area) in rects.iter().map(|(id, r)| (*id, *r)) {
			let Some(pane) = tab.panes.get_mut(pane_id) else {
				continue;
			};
			let inner_cols = area.width.saturating_sub(2).max(1);
			let inner_rows = area.height.saturating_sub(2).max(1);
			let is_widget = pane.is_widget();
			if !is_widget {
				if let Some(term) = pane.as_terminal() {
					let _ = term.resize(inner_rows, inner_cols);
				}
			}
			let focused = pane_id == tab.active;
			let pane_style = if focused {
				Style::default()
					.fg(Color::White)
					.add_modifier(Modifier::BOLD)
			} else {
				Style::default().fg(Color::DarkGray)
			};
			// Title-row controls: [+] pages ✕ — geometry stored for clicks.
			let mut control_spans: Vec<Span> = vec![Span::styled(" + ", Style::default())];
			let mut page_boxes = Vec::new();
			if pane.pages.len() > 1 || true {
				for page_idx in 0..pane.pages.len() {
					let label = format!("{} ", page_idx + 1);
					page_boxes.push((0u16, Span::raw(&label).width() as u16));
					control_spans.push(if page_idx == pane.page {
						Span::styled(label, Style::default().add_modifier(Modifier::UNDERLINED))
					} else {
						Span::styled(label, Style::default().fg(Color::DarkGray))
					});
				}
			}
			control_spans.push(Span::styled(" ✕ ", Style::default()));
			let total: u16 = control_spans.iter().map(|s| s.width() as u16).sum();
			let start = area.right().saturating_sub(total + 1);
			// Resolve the stored (0, w) boxes to absolute x once width is known.
			plus_box = (start, 3);
			let mut cursor = start + 3;
			for (box_, w) in page_boxes.iter_mut() {
				*box_ = cursor;
				cursor += *w;
			}
			let close_box = (cursor, 3);
			self.last_controls.push(PaneControls {
				pane: pane_id,
				row: area.y,
				plus: plus_box,
				pages: page_boxes,
				close: close_box,
			});
			let mut block = Block::default()
				.borders(Borders::ALL)
				.border_type(BorderType::Rounded)
				.title(Span::styled(format!(" {} ", pane.label()), pane_style))
				.border_style(pane_style)
				.title(Line::from(control_spans.clone()).right_aligned());
			let _ = &mut block;
			let inner = block.inner(area);
			frame.render_widget(block, area);
			if is_widget {
				match pane.active_page().map(|p| &p.kind) {
					Some(PaneKind::Time) => widgets::render_time_calendar(inner, frame.buffer_mut()),
					Some(PaneKind::Pomodoro) => {
						widgets::render_pomodoro(&widgets.pomodoro, inner, frame.buffer_mut())
					},
					Some(PaneKind::Clipboard) => {
						widgets::render_clipboard(&widgets, inner, frame.buffer_mut())
					},
					_ => {},
				}
				continue;
			}
			let colors = ThemeColors::from(&self.theme);
			let ctx = RenderContext {
				theme: &colors,
				config: &panel_config,
				is_focused: focused,
				panel_index: pane_id,
				terminal_width: size.width,
				terminal_height: size.height,
				border_right_x: Some(area.right().saturating_sub(1)),
				border_bottom_y: Some(area.bottom().saturating_sub(1)),
			};
			let term = pane.as_terminal().expect("non-widget pane holds a PTY");
			term.prepare_render(&self.theme, &self.config);
			term.render(inner, frame.buffer_mut(), &ctx);
		}

		let pane_label = tab
			.panes
			.get(tab.active)
			.map(|p| p.label())
			.unwrap_or_default();
		let leaves = tab.tree.leaf_rects(content).len();
		let status = self.notice.clone().unwrap_or_else(|| {
			status_text(&pane_label, &leaves.to_string(), tab.active, tab.panes.len())
		});
		frame.render_widget(
			Paragraph::new(status).style(Style::default().fg(Color::DarkGray)),
			rows[2],
		);
		const STATUS_TOOLS: &str = "[layout] [quit]";
		let tools_width = Span::raw(STATUS_TOOLS).width() as u16;
		if rows[2].width > tools_width {
			let start = rows[2].right() - tools_width - 1;
			frame.render_widget(
				Paragraph::new(Line::from(vec![
					Span::styled("[layout]", Style::default().fg(Color::White)),
					Span::styled(" ", Style::default()),
					Span::styled("[quit]", Style::default().fg(Color::White)),
				])),
				Rect { x: start, y: rows[2].y, width: tools_width, height: 1 },
			);
			self.status_hits = ((start, 8), (start + 9, 6), rows[2].y);
		}

		if self.help_open {
			let overlay = Paragraph::new(help::overlay_text())
				.block(
					Block::default()
						.borders(Borders::ALL)
						.border_type(BorderType::Rounded)
						.title(" zeta help "),
				)
				.wrap(Wrap { trim: false })
				.style(Style::default().bg(Color::Reset));
			let area = centered_rect(size, 62, 40);
			frame.render_widget(Clear, area);
			frame.render_widget(overlay, area);
		}
	}
}

/// Close the active page of `pane`; returns true when the pane ran out of
/// pages and must be closed.
fn pane_close_page(tab: &mut Tab, pane: usize) -> bool {
	tab.panes
		.get_mut(pane)
		.map(|p| p.close_page(p.page))
		.unwrap_or(false)
}

fn count_leaves(node: &PaneNode) -> usize {
	match node {
		PaneNode::Leaf(_) => 1,
		PaneNode::Split { children, .. } => children.iter().map(|(_, n)| count_leaves(n)).sum(),
	}
}

fn cursor_axis(mouse: crossterm::event::MouseEvent, axis: Axis) -> u16 {
	match axis {
		Axis::Row => mouse.column,
		Axis::Column => mouse.row,
	}
}

/// Shared boundary between two panes nearest to the cursor: `None` when no
/// boundary is within grab range. Returns (axis, line).
fn find_boundary(areas: &[(usize, Rect)], column: u16, row: u16) -> Option<(Axis, u16)> {
	let mut best: Option<(i32, Axis, u16)> = None;
	for (_, r) in areas {
		// Vertical boundary: this pane's right edge is another's left edge.
		for (line, axis) in [(r.right(), Axis::Row), (r.bottom(), Axis::Column)] {
			if areas.iter().any(|(_, o)| {
				matches!(axis, Axis::Row) && o.left() == line && o.left() != 0
					|| matches!(axis, Axis::Column) && o.top() == line && o.top() != 0
			}) {
				let cursor = match axis {
					Axis::Row => column,
					Axis::Column => row,
				};
				let dist = (cursor as i32 - line as i32).abs();
				if dist <= 1 && best.map(|(d, _, _)| dist < d).unwrap_or(true) {
					best = Some((dist, axis, line));
				}
			}
		}
	}
	best.map(|(_, axis, line)| (axis, line))
}

fn centered_rect(area: Rect, percent_x: u16, percent_y: u16) -> Rect {
	let v = Layout::vertical([
		Constraint::Percentage((100 - percent_y) / 2),
		Constraint::Percentage(percent_y),
		Constraint::Percentage((100 - percent_y) / 2),
	])
	.split(area);
	let h = Layout::horizontal([
		Constraint::Percentage((100 - percent_x) / 2),
		Constraint::Percentage(percent_x),
		Constraint::Percentage((100 - percent_x) / 2),
	])
	.split(v[1]);
	h[1]
}

fn tab_title(tab: &Tab) -> String {
	tab.panes
		.get(tab.active)
		.map(|p| p.label())
		.unwrap_or_else(|| "shell".into())
}
