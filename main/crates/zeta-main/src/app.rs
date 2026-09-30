use crate::help;
use crate::layout::{Axis, PaneNode, Side};
use crate::tab::{PaneKind, Tab};
use crate::tabs_ui::{MenuBar, MenuDropdown, TabBar, status_text, tab_layout, truncate};
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

/// Colorless theme: inherit the terminal's own colors wherever possible.
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

/// A clickable region recorded during draw. Mouse events resolve against the
/// registry — the geometry is exactly what was rendered (the fresh-ui lesson:
/// derive hit paths from rendered geometry, never re-derive them).
#[derive(Clone, Copy, Debug)]
enum Hit {
	Menu(usize),
	MenuItem { menu: usize, item: usize },
	DismissMenu,
	TabPrev,
	TabNext,
	TabPlus,
	Tab(usize),
	TabClose,
	SplitRow { pane: usize },
	SplitCol { pane: usize },
	PagePlus { pane: usize },
	PageTab { pane: usize, page: usize },
	PageClose { pane: usize },
	PaneTitle { pane: usize },
	Pane { pane: usize },
	LayoutCycle,
	Quit,
}

/// What a press-drag is currently doing.
enum Drag {
	/// Reordering tabs along the tab row.
	TabReorder(usize),
	/// Moving a pane; cursor tracked for the drop-zone overlay.
	PaneSwap { from: usize, cursor: (u16, u16) },
	/// Dragging a split boundary.
	Resize { axis: Axis, last: u16 },
}

/// The workspace: menu row, tab row, and a tree of panes per tab.
pub struct Workspace {
	tabs: Vec<Tab>,
	active_tab: usize,
	normalizer: KeyNormalizer,
	theme: termide_theme::Theme,
	config: std::sync::Arc<termide_config::Config>,
	help_open: bool,
	notice: Option<String>,
	/// Hit regions recorded by the last draw, in paint order (later wins).
	hits: Vec<(Rect, Hit)>,
	/// (pane id, rect) of the active tab from the last frame.
	last_pane_areas: Vec<(usize, Rect)>,
	/// Clickable right-edge segments of the status bar.
	status_hits: ((u16, u16), (u16, u16), u16),
	open_menu: Option<usize>,
	/// Menu trigger boxes from the last frame, for dropdown placement.
	menu_boxes: Vec<(u16, u16)>,
	drag: Option<Drag>,
	last_frame: Rect,
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
			hits: Vec::new(),
			last_pane_areas: Vec::new(),
			status_hits: ((0, 0), (0, 0), 0),
			open_menu: None,
			menu_boxes: Vec::new(),
			drag: None,
			last_frame: Rect::default(),
			widgets: WidgetState::default(),
		})
	}

	fn active(&mut self) -> &mut Tab {
		&mut self.tabs[self.active_tab]
	}

	fn push_hit(&mut self, rect: Rect, hit: Hit) {
		if rect.width > 0 && rect.height > 0 {
			self.hits.push((rect, hit));
		}
	}

	/// Topmost hit at the point, if any (later paint wins).
	fn hit_at(&self, column: u16, row: u16) -> Option<Hit> {
		self
			.hits
			.iter()
			.rev()
			.find(|(r, _)| r.contains(ratatui::layout::Position { x: column, y: row }))
			.map(|(_, h)| *h)
	}

	/// The focused pane's last known rect.
	fn focused_rect(&self) -> Rect {
		let tab = &self.tabs[self.active_tab];
		let active = tab.active;
		self
			.last_pane_areas
			.iter()
			.find(|(id, _)| *id == active)
			.map(|(_, r)| *r)
			.unwrap_or(Rect { x: 1, y: 2, width: self.last_frame.width.max(4), height: 10 })
	}

	/// Split `pane` — the pane whose button was pressed becomes the active
	/// pane first, then the split lands there (never on some other focus).
	/// Explicit axis from the ↔/↕ controls, auto from the menu; missing suite
	/// tools self-install in the new slot.
	fn split_pane(&mut self, pane: usize, kind: PaneKind, axis: Option<Axis>) {
		self.active().active = pane;
		let rect = self
			.last_pane_areas
			.iter()
			.find(|(id, _)| *id == pane)
			.map(|(_, r)| *r)
			.unwrap_or_else(|| self.focused_rect());
		let axis = axis.unwrap_or_else(|| Axis::for_rect(rect));
		let cwd = std::env::current_dir().ok();
		let kind = match kind.install_command() {
			Some(install) => {
				self.notice =
					Some(format!("{} not on PATH — installing in the new pane", kind.label()));
				PaneKind::Command(install)
			},
			None => kind,
		};
		match self.active().add_pane(pane, kind, cwd, rect, axis) {
			Ok(()) => self.notice = None,
			Err(error) => self.notice = Some(format!("split failed: {error}")),
		}
	}

	/// Hotkey/menu entry: split whatever pane currently holds focus.
	fn split_active(&mut self, kind: PaneKind, axis: Option<Axis>) {
		let focused = self.active().active;
		self.split_pane(focused, kind, axis);
	}

	/// Returns `true` when the workspace should quit.
	fn handle_key(&mut self, key: KeyEvent) -> Result<bool> {
		if self.help_open {
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
					self.split_active(PaneKind::Shell, None)
				},
				KeyCode::Char('c') | KeyCode::Char('C') => self.split_active(PaneKind::Agent, None),
				KeyCode::Char('e') | KeyCode::Char('E') => self.split_active(PaneKind::Editor, None),
				KeyCode::Char('i') | KeyCode::Char('I') => self.split_active(PaneKind::Ide, None),
				KeyCode::Char('d') | KeyCode::Char('D') => self.split_active(PaneKind::Time, None),
				KeyCode::Char('p') | KeyCode::Char('P') => self.split_active(PaneKind::Pomodoro, None),
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

	/// Cycle layout presets upward, creating fresh shells for new slots.
	fn cycle_preset(&mut self) {
		let presets = PaneNode::presets();
		let panes = self.tabs[self.active_tab].panes.len();
		let current = count_leaves(&self.tabs[self.active_tab].tree);
		let start = presets
			.iter()
			.position(|(_, t)| count_leaves(t) == current)
			.unwrap_or(0);
		let len = presets.len();
		for offset in 1..=len {
			let idx = (start + offset) % len;
			if count_leaves(&presets[idx].1) >= panes {
				let (_, tree) = presets[idx].clone();
				let cwd = std::env::current_dir().ok();
				match self.active().apply_preset(tree, cwd) {
					Ok(()) => self.notice = None,
					Err(error) => self.notice = Some(format!("{error}")),
				}
				return;
			}
		}
		self.notice = Some("close panes to reach a smaller preset".into());
	}

	fn handle_mouse(&mut self, mouse: crossterm::event::MouseEvent) -> bool {
		match mouse.kind {
			MouseEventKind::Down(MouseButton::Left) => self.handle_mouse_down(mouse),
			MouseEventKind::ScrollUp | MouseEventKind::ScrollDown => self.handle_mouse_scroll(mouse),
			MouseEventKind::Drag(MouseButton::Left) => self.handle_mouse_drag(mouse),
			MouseEventKind::Up(MouseButton::Left) => self.handle_mouse_up(mouse),
			_ => false,
		}
	}

	fn handle_mouse_scroll(&mut self, mouse: crossterm::event::MouseEvent) -> bool {
		let up = matches!(mouse.kind, MouseEventKind::ScrollUp);
		if mouse.row <= 1 {
			// Over chrome rows: wheel flips tabs.
			self.active_tab = if up {
				if self.active_tab == 0 {
					self.tabs.len() - 1
				} else {
					self.active_tab - 1
				}
			} else {
				(self.active_tab + 1) % self.tabs.len()
			};
			return false;
		}
		// Over a pane: forward to its terminal (scrollback).
		let position = ratatui::layout::Position { x: mouse.column, y: mouse.row };
		if let Some((pane, area)) = self
			.last_pane_areas
			.iter()
			.find(|(_, a)| a.contains(position))
			.map(|(p, a)| (*p, *a))
		{
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

	fn handle_mouse_down(&mut self, mouse: crossterm::event::MouseEvent) -> bool {
		let Some(hit) = self.hit_at(mouse.column, mouse.row) else {
			return false;
		};
		match hit {
			Hit::DismissMenu => {
				self.open_menu = None;
			},
			Hit::Menu(menu) => {
				self.open_menu = if self.open_menu == Some(menu) {
					None
				} else {
					Some(menu)
				};
			},
			Hit::MenuItem { menu, item } => {
				self.open_menu = None;
				return self.run_menu_action(menu, item);
			},
			Hit::TabPrev => {
				self.active_tab = if self.active_tab == 0 {
					self.tabs.len() - 1
				} else {
					self.active_tab - 1
				};
			},
			Hit::TabNext => {
				self.active_tab = (self.active_tab + 1) % self.tabs.len();
			},
			Hit::TabPlus => self.new_tab(),
			Hit::Tab(idx) => {
				self.active_tab = idx;
				self.drag = Some(Drag::TabReorder(idx));
			},
			Hit::TabClose => {
				if self.tabs.len() > 1 {
					self.tabs.remove(self.active_tab);
					self.active_tab = self.active_tab.min(self.tabs.len() - 1);
				} else {
					return true;
				}
			},
			Hit::SplitRow { pane } => self.split_pane(pane, PaneKind::Shell, Some(Axis::Row)),
			Hit::SplitCol { pane } => self.split_pane(pane, PaneKind::Shell, Some(Axis::Column)),
			Hit::PagePlus { pane } => {
				self.active().active = pane;
				let cwd = std::env::current_dir().ok();
				if let Some(p) = self.active().panes.get_mut(pane) {
					let _ = p.open_page(PaneKind::Shell, 24, 80, cwd);
				}
			},
			Hit::PageTab { pane, page } => {
				self.active().active = pane;
				if let Some(p) = self.active().panes.get_mut(pane) {
					p.page = page.min(p.pages.len().saturating_sub(1));
				}
			},
			Hit::PageClose { pane } => {
				let close_pane = {
					let tab = self.active();
					tab.panes
						.get_mut(pane)
						.map(|p| p.close_page(p.page))
						.unwrap_or(false)
				};
				if close_pane {
					self.active().close_pane(pane);
				}
			},
			Hit::PaneTitle { pane } => {
				self.active().active = pane;
				self.drag = Some(Drag::PaneSwap { from: pane, cursor: (mouse.column, mouse.row) });
			},
			Hit::Pane { pane } => {
				// A shared split boundary near the cursor starts a resize drag.
				if let Some((axis, _)) =
					find_boundary(&self.last_pane_areas, mouse.column, mouse.row, 1)
				{
					self.drag = Some(Drag::Resize {
						axis,
						last: match axis {
							Axis::Row => mouse.column,
							Axis::Column => mouse.row,
						},
					});
					return false;
				}
				self.active().active = pane;
				let Some(area) = self
					.last_pane_areas
					.iter()
					.find(|(id, _)| *id == pane)
					.map(|(_, r)| *r)
				else {
					return false;
				};
				let inner = Rect {
					x: area.x + 1,
					y: area.y + 1,
					width: area.width.saturating_sub(2),
					height: area.height.saturating_sub(2),
				};
				let position = ratatui::layout::Position { x: mouse.column, y: mouse.row };
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
			},
			Hit::LayoutCycle => self.cycle_preset(),
			Hit::Quit => return true,
		}
		false
	}

	fn handle_mouse_drag(&mut self, mouse: crossterm::event::MouseEvent) -> bool {
		match self.drag.as_mut() {
			Some(Drag::PaneSwap { cursor, .. }) => {
				*cursor = (mouse.column, mouse.row);
			},
			Some(Drag::Resize { axis, last }) => {
				let axis = *axis;
				let position = match axis {
					Axis::Row => mouse.column,
					Axis::Column => mouse.row,
				};
				let delta = position as i32 - *last as i32;
				if delta != 0 {
					if let Some((_, line)) =
						find_boundary(&self.last_pane_areas, mouse.column, mouse.row, 8)
					{
						let content = self.content_rect();
						self.active().tree.resize_at(content, axis, line, delta);
					}
					if let Some(Drag::Resize { last, .. }) = self.drag.as_mut() {
						*last = position;
					}
				}
			},
			_ => {},
		}
		false
	}

	fn handle_mouse_up(&mut self, mouse: crossterm::event::MouseEvent) -> bool {
		match self.drag.take() {
			Some(Drag::TabReorder(from)) => {
				let layout = tab_layout(self.last_frame.width, self.tabs.len(), usize::MAX);
				let target = layout
					.tabs
					.iter()
					.position(|(_, x, w)| mouse.column >= *x && mouse.column < x + w);
				if let Some(target) = target {
					if target != from && from < self.tabs.len() {
						let tab = self.tabs.remove(from);
						self.tabs.insert(target.min(self.tabs.len()), tab);
						self.active_tab = target.min(self.tabs.len() - 1);
					}
				}
			},
			Some(Drag::PaneSwap { from, .. }) => {
				// Drop on the chrome rows → the pane becomes its own tab.
				if mouse.row <= 1 {
					if let Some(pane) = self.active().take_pane(from) {
						self
							.tabs
							.push(Tab { panes: vec![pane], active: 0, tree: PaneNode::single(0) });
						self.active_tab = self.tabs.len() - 1;
					}
					return false;
				}
				let position = ratatui::layout::Position { x: mouse.column, y: mouse.row };
				if let Some((target, rect)) = self
					.last_pane_areas
					.iter()
					.find(|(_, a)| a.contains(position))
					.map(|(p, a)| (*p, *a))
				{
					if target != from {
						match drop_side(rect, mouse.column, mouse.row) {
							None => {
								// Center: swap in place.
								self.active().tree.swap(from, target);
								self.active().active = target;
							},
							Some(side) => self.active().move_pane_relative(from, target, side),
						}
					}
				}
			},
			_ => {},
		}
		self.drag = None;
		false
	}

	/// Dispatch a menu action. Returns true for Quit.
	fn run_menu_action(&mut self, menu: usize, item: usize) -> bool {
		match (menu, item) {
			// File
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
			// Pane
			(1, 0) => self.split_active(PaneKind::Shell, None),
			(1, 1) => self.split_active(PaneKind::Agent, None),
			(1, 2) => self.split_active(PaneKind::Editor, None),
			(1, 3) => self.split_active(PaneKind::Ide, None),
			(1, 4) => self.split_active(PaneKind::Time, None),
			(1, 5) => self.split_active(PaneKind::Pomodoro, None),
			(1, 6) => self.split_active(PaneKind::Clipboard, None),
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
			// Tab
			(2, 0) => self.active_tab = (self.active_tab + 1) % self.tabs.len(),
			(2, 1) => {
				self.active_tab = if self.active_tab == 0 {
					self.tabs.len() - 1
				} else {
					self.active_tab - 1
				}
			},
			// Tools
			(3, 0..=2) => {
				let (_, tree) = PaneNode::presets()[item].clone();
				let cwd = std::env::current_dir().ok();
				match self.active().apply_preset(tree, cwd) {
					Ok(()) => self.notice = None,
					Err(error) => self.notice = Some(format!("{error}")),
				}
			},
			(3, 3) => self.active().tree.equalize(),
			(3, 4) => {
				let tab = self.active();
				if !tab.panes.is_empty() {
					tab.active = (tab.active + 1) % tab.panes.len();
				}
			},
			// Settings
			(4, 0) => {
				self.notice =
					Some("Settings surface is on the roadmap — keybindings, theme, default shell".into())
			},
			(4, 1) => self.help_open = true,
			_ => {},
		}
		false
	}

	fn apply_events(&mut self, events: Vec<PanelEvent>) {
		for event in events {
			if matches!(event, PanelEvent::Quit) {
				return;
			}
			if let PanelEvent::RunCommand { command, .. } = event {
				self.split_active(PaneKind::Command(command), None);
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
			tab.resize(rows.saturating_sub(3), cols);
		}
	}

	fn tick(&mut self) {
		self.widgets.pomodoro.tick();
		let mut notices = Vec::new();
		for (tab_idx, tab) in self.tabs.iter_mut().enumerate() {
			// Reap dead PTY pages; a pane whose last page died closes.
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
					pane.close_page(idx);
				}
			}
			let to_close: Vec<usize> = tab
				.panes
				.iter()
				.enumerate()
				.filter(|(_, p)| p.pages.is_empty())
				.map(|(idx, _)| idx)
				.collect();
			for idx in to_close.into_iter().rev() {
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

	fn content_rect(&self) -> Rect {
		Rect {
			x: 1,
			y: 2,
			width: self.last_frame.width.saturating_sub(2),
			height: self.last_frame.height.saturating_sub(4),
		}
	}

	fn draw(&mut self, frame: &mut ratatui::Frame) {
		let size = frame.area();
		self.last_frame = size;
		self.hits.clear();
		let rows = Layout::vertical([
			Constraint::Length(1), // menu bar
			Constraint::Length(1), // tab bar
			Constraint::Min(3),    // panes
			Constraint::Length(1), // status
		])
		.split(size);

		// Row 0: menu bar — render and hit geometry from the same helper.
		frame.render_widget(MenuBar { open: self.open_menu }, rows[0]);
		for (idx, (_, x, w)) in crate::tabs_ui::menu_layout(size.width)
			.into_iter()
			.enumerate()
		{
			self.push_hit(Rect { x, y: rows[0].y, width: w, height: 1 }, Hit::Menu(idx));
		}
		self.menu_boxes = crate::tabs_ui::menu_layout(size.width)
			.into_iter()
			.map(|(_, x, w)| (x, w))
			.collect();

		// Row 1: tab bar.
		let layout = tab_layout(size.width, self.tabs.len(), self.active_tab);
		frame
			.render_widget(TabBar { layout: clone_layout(&layout), active: self.active_tab }, rows[1]);
		let (prev, prev_w) = layout.prev;
		self.push_hit(Rect { x: prev, y: rows[1].y, width: prev_w, height: 1 }, Hit::TabPrev);
		for (idx, (_, x, w)) in layout.tabs.iter().enumerate() {
			self.push_hit(Rect { x: *x, y: rows[1].y, width: *w, height: 1 }, Hit::Tab(idx));
		}
		if let Some((x, w)) = layout.active_close {
			self.push_hit(Rect { x, y: rows[1].y, width: w, height: 1 }, Hit::TabClose);
		}
		let (next_x, next_w) = layout.next;
		self.push_hit(Rect { x: next_x, y: rows[1].y, width: next_w, height: 1 }, Hit::TabNext);
		let (plus_x, plus_w) = layout.plus;
		self.push_hit(Rect { x: plus_x, y: rows[1].y, width: plus_w, height: 1 }, Hit::TabPlus);

		// Panes.
		let content = rows[2];
		let panel_config = PanelConfig::default();
		let rects: Vec<(usize, Rect)> = {
			let tab = &self.tabs[self.active_tab];
			tab.tree.leaf_rects(content)
		};
		self.last_pane_areas = rects.clone();
		{
			let mut deferred: Vec<(Rect, Hit)> = Vec::new();
			let mut push_deferred = |rect: Rect, hit: Hit| deferred.push((rect, hit));
			let widgets_state = self.widgets.clone();
			let tab = &mut self.tabs[self.active_tab];
			for (pane_id, area) in rects.iter().copied() {
				let Some(pane) = tab.panes.get_mut(pane_id) else {
					continue;
				};
				let pre_inner = Rect {
					x: area.x + 1,
					y: area.y + 1,
					width: area.width.saturating_sub(2).max(1),
					height: area.height.saturating_sub(2).max(1),
				};
				let is_widget = pane.is_widget();
				if !is_widget {
					if let Some(term) = pane.as_terminal() {
						let _ = term.resize(pre_inner.height, pre_inner.width);
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
				// Title row: page tabs left, fixed controls right.
				let mut left_spans: Vec<Span> = Vec::new();
				let mut page_boxes: Vec<(u16, u16)> = Vec::new();
				let mut cursor = area.x + 1;
				for page_idx in 0..pane.pages.len() {
					let label: String = pane
						.pages
						.get(page_idx)
						.map(|p| p.kind.label())
						.unwrap_or_default();
					let label = format!(" {} ", truncate(&label, 12));
					let w = Span::raw(label.clone()).width() as u16;
					page_boxes.push((cursor, w));
					left_spans.push(if page_idx == pane.page {
						Span::styled(
							label,
							Style::default().add_modifier(Modifier::BOLD | Modifier::UNDERLINED),
						)
					} else {
						Span::styled(label, Style::default().fg(Color::DarkGray))
					});
					cursor += w;
				}
				const CONTROLS: &str = " +  ↔  ↕  ✕ ";
				let controls_w = Span::raw(CONTROLS).width() as u16;
				let controls_x = area.right().saturating_sub(controls_w + 1);
				push_deferred(
					Rect { x: controls_x, y: area.y, width: 3, height: 1 },
					Hit::PagePlus { pane: pane_id },
				);
				push_deferred(
					Rect { x: controls_x + 3, y: area.y, width: 3, height: 1 },
					Hit::SplitRow { pane: pane_id },
				);
				push_deferred(
					Rect { x: controls_x + 6, y: area.y, width: 3, height: 1 },
					Hit::SplitCol { pane: pane_id },
				);
				push_deferred(
					Rect { x: controls_x + 9, y: area.y, width: 3, height: 1 },
					Hit::PageClose { pane: pane_id },
				);
				for (idx, (x, w)) in page_boxes.iter().enumerate() {
					push_deferred(
						Rect { x: *x, y: area.y, width: *w, height: 1 },
						Hit::PageTab { pane: pane_id, page: idx },
					);
				}
				let left_end = page_boxes.last().map(|(x, w)| x + w).unwrap_or(area.x + 1);
				if controls_x > left_end {
					push_deferred(
						Rect { x: left_end, y: area.y, width: controls_x - left_end, height: 1 },
						Hit::PaneTitle { pane: pane_id },
					);
				}
				push_deferred(pre_inner, Hit::Pane { pane: pane_id });

				let block = Block::default()
					.borders(Borders::ALL)
					.border_type(BorderType::Rounded)
					.border_style(pane_style)
					.title(Line::from(left_spans))
					.title(
						Line::from(Span::styled(
							CONTROLS,
							if focused {
								Style::default().fg(Color::White)
							} else {
								Style::default().fg(Color::DarkGray)
							},
						))
						.right_aligned(),
					);
				let inner = block.inner(area);
				frame.render_widget(block, area);
				if is_widget {
					match pane.active_page().map(|p| &p.kind) {
						Some(PaneKind::Time) => widgets::render_time_calendar(inner, frame.buffer_mut()),
						Some(PaneKind::Pomodoro) => {
							widgets::render_pomodoro(&widgets_state.pomodoro, inner, frame.buffer_mut())
						},
						Some(PaneKind::Clipboard) => {
							widgets::render_clipboard(&widgets_state, inner, frame.buffer_mut())
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

			for (rect, hit) in deferred {
				self.push_hit(rect, hit);
			}
		}

		// Pane-swap drop-zone overlay.
		if let Some(Drag::PaneSwap { cursor, .. }) = self.drag {
			let position = ratatui::layout::Position { x: cursor.0, y: cursor.1 };
			if let Some((_, rect)) = self
				.last_pane_areas
				.iter()
				.find(|(_, a)| a.contains(position))
				.map(|(p, a)| (*p, *a))
			{
				if let Some(zone) = drop_zone_rect(rect, cursor.0, cursor.1) {
					frame.render_widget(
						Paragraph::new(Span::styled(
							"▒".repeat(zone.width as usize),
							Style::default().fg(Color::DarkGray),
						)),
						zone,
					);
				}
			}
		}

		// Dropdown renders above panes; a full-frame dismiss hit sits beneath
		// its items.
		if let Some(menu) = self.open_menu {
			let trigger_x = self.menu_boxes.get(menu).map(|(x, _)| *x).unwrap_or(1);
			let dropdown = MenuDropdown { menu, trigger_x };
			self.push_hit(size, Hit::DismissMenu);
			for (item, rect) in dropdown.item_rects(size).into_iter().enumerate() {
				self.push_hit(rect, Hit::MenuItem { menu, item });
			}
			frame.render_widget(dropdown, size);
		}

		// Status row.
		let tab = &self.tabs[self.active_tab];
		let pane_label = tab
			.panes
			.get(tab.active)
			.map(|p| p.label())
			.unwrap_or_default();
		let leaves = count_leaves(&tab.tree);
		let status = self.notice.clone().unwrap_or_else(|| {
			status_text(&pane_label, &leaves.to_string(), tab.active, tab.panes.len())
		});
		frame.render_widget(
			Paragraph::new(status).style(Style::default().fg(Color::DarkGray)),
			rows[3],
		);
		const STATUS_TOOLS: &str = "[layout] [quit]";
		let tools_width = Span::raw(STATUS_TOOLS).width() as u16;
		if rows[3].width > tools_width {
			let start = rows[3].right() - tools_width - 1;
			frame.render_widget(
				Paragraph::new(Line::from(vec![
					Span::styled("[layout]", Style::default().fg(Color::White)),
					Span::styled(" ", Style::default()),
					Span::styled("[quit]", Style::default().fg(Color::White)),
				])),
				Rect { x: start, y: rows[3].y, width: tools_width, height: 1 },
			);
			self.push_hit(Rect { x: start, y: rows[3].y, width: 8, height: 1 }, Hit::LayoutCycle);
			self.push_hit(Rect { x: start + 9, y: rows[3].y, width: 6, height: 1 }, Hit::Quit);
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

/// Which drop region of `rect` does the point land in: edge quarters move
/// beside the target, the middle swaps.
fn drop_side(rect: Rect, column: u16, row: u16) -> Option<Side> {
	let quarter_w = rect.width / 4;
	let quarter_h = rect.height / 4;
	if quarter_w == 0 || quarter_h == 0 {
		return None;
	}
	if column < rect.x + quarter_w {
		Some(Side::Left)
	} else if column >= rect.right().saturating_sub(quarter_w) {
		Some(Side::Right)
	} else if row < rect.y + quarter_h {
		Some(Side::Top)
	} else if row >= rect.bottom().saturating_sub(quarter_h) {
		Some(Side::Bottom)
	} else {
		None // center = swap
	}
}

/// The overlay strip visualizing a drop zone.
fn drop_zone_rect(rect: Rect, column: u16, row: u16) -> Option<Rect> {
	match drop_side(rect, column, row) {
		Some(Side::Left) => Some(Rect {
			x: rect.x + 1,
			y: rect.y + 1,
			width: rect.width / 4,
			height: rect.height.saturating_sub(2),
		}),
		Some(Side::Right) => Some(Rect {
			x: rect.right().saturating_sub(1 + rect.width / 4),
			y: rect.y + 1,
			width: rect.width / 4,
			height: rect.height.saturating_sub(2),
		}),
		Some(Side::Top) => Some(Rect {
			x: rect.x + 1,
			y: rect.y + 1,
			width: rect.width.saturating_sub(2),
			height: rect.height / 4,
		}),
		Some(Side::Bottom) => Some(Rect {
			x: rect.x + 1,
			y: rect.bottom().saturating_sub(1 + rect.height / 4),
			width: rect.width.saturating_sub(2),
			height: rect.height / 4,
		}),
		None => Some(Rect {
			x: rect.x + 1,
			y: rect.y + 1,
			width: rect.width.saturating_sub(2),
			height: rect.height.saturating_sub(2),
		}),
	}
}

/// Shared boundary between two panes nearest to the cursor.
fn find_boundary(
	areas: &[(usize, Rect)],
	column: u16,
	row: u16,
	tolerance: i32,
) -> Option<(Axis, u16)> {
	let mut best: Option<(i32, Axis, u16)> = None;
	for (_, r) in areas {
		for (line, axis) in [(r.right(), Axis::Row), (r.bottom(), Axis::Column)] {
			let shared = areas.iter().any(|(_, o)| {
				matches!(axis, Axis::Row) && o.left() == line && line != 0
					|| matches!(axis, Axis::Column) && o.top() == line && line != 0
			});
			if shared {
				let cursor = match axis {
					Axis::Row => column,
					Axis::Column => row,
				};
				let dist = (cursor as i32 - line as i32).abs();
				if dist <= tolerance && best.map(|(d, _, _)| dist < d).unwrap_or(true) {
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

fn count_leaves(node: &PaneNode) -> usize {
	match node {
		PaneNode::Leaf(_) => 1,
		PaneNode::Split { children, .. } => children.iter().map(|(_, n)| count_leaves(n)).sum(),
	}
}

fn clone_layout(layout: &crate::tabs_ui::TabLayout) -> crate::tabs_ui::TabLayout {
	crate::tabs_ui::TabLayout {
		prev: layout.prev,
		tabs: layout.tabs.clone(),
		active_close: layout.active_close,
		next: layout.next,
		plus: layout.plus,
	}
}
