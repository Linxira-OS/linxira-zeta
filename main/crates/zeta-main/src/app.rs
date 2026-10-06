use std::{io::Stdout, time::Duration};

use anyhow::Result;
use crossterm::event::{
	self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEventKind,
};
use ratatui::{
	Terminal as RatuTerminal,
	backend::CrosstermBackend,
	layout::{Constraint, Layout, Rect},
	style::{Color, Modifier, Style},
	text::{Line, Span},
	widgets::{Block, BorderType, Borders, Clear, Paragraph, Wrap},
};
use termide_core::{KeyChord, Panel, PanelConfig, PanelEvent, RenderContext, ThemeColors};
use termide_keyboard::{KeyNormalizer, KeyboardCaps};

use crate::{
	help,
	layout::{Axis, PaneNode, Side},
	tab::{PaneClose, PaneKind, Tab, pane_close_target},
	tabs_ui::{MenuBar, MenuDropdown, TabBar, status_text, tab_layout_named, truncate},
	widgets::{self, WidgetState},
};

/// `a, b, c … +2` — the busy list a confirm dialog shows, capped so the
/// box stays one line.
fn summarize_busy(names: &[String]) -> String {
	if names.len() <= 3 {
		return names.join(", ");
	}
	let listed = names.iter().take(3).cloned().collect::<Vec<_>>().join(", ");
	format!("{listed} … +{}", names.len() - 3)
}

/// The busy-close confirm: a small opaque centered box — one message line
/// plus the key hints. Modal: input is swallowed until answered.
fn render_confirm_box(frame: &mut ratatui::Frame, area: Rect, message: &str) {
	let hint = " Y yes · N no ";
	let needed = Span::raw(message).width().max(Span::raw(hint).width()) as u16 + 4;
	let width = needed.min(area.width.saturating_sub(2)).max(12);
	let height = 4u16.min(area.height);
	if area.width < 14 || area.height < 4 {
		return;
	}
	let rect = Rect {
		x: area.x + (area.width - width) / 2,
		y: area.y + (area.height - height) / 2,
		width,
		height,
	};
	// Opaque surface: reset cells first so pane text never bleeds through
	// (the same rule as the menu dropdown).
	for row in rect.y..rect.bottom() {
		for col in rect.x..rect.right() {
			frame.buffer_mut()[(col, row)].reset();
		}
	}
	let block = Block::default()
		.borders(Borders::ALL)
		.border_type(BorderType::Rounded)
		.style(Style::default().fg(Color::Yellow));
	frame.render_widget(block, rect);
	let inner = Rect {
		x: rect.x + 1,
		y: rect.y + 1,
		width: rect.width.saturating_sub(2),
		height: rect.height.saturating_sub(2),
	};
	frame.render_widget(Paragraph::new(truncate(message, inner.width as usize)), inner);
	let hint_row = Rect { x: inner.x, y: inner.y + 1, width: inner.width, height: 1 };
	frame.render_widget(
		Paragraph::new(Line::from(Span::styled(hint, Style::default().fg(Color::DarkGray)))),
		hint_row,
	);
}

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
	DismissOverlay,
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
	PaneMinimize { pane: usize },
	DockChip { slot: usize },
	Pane { pane: usize },
	Boundary { axis: Axis, low: usize, high: usize },
	LayoutCycle,
	SettingRow(usize),
	Quit,
}

/// What a press-drag is currently doing. The drag layer runs while the
/// Settings toggle is on (default on) — a runtime switch, not a compile
/// flag. The 2026-10-01 investigation concluded the weighted-tree machinery
/// is sound: resize drags pin the flanking pane pair at press time and
/// track a single edge, so nested boundaries are never re-grabbed mid-drag.
enum Drag {
	/// Reordering tabs along the tab row.
	TabReorder(usize),
	/// Moving a pane; cursor tracked for the drop-zone overlay.
	PaneSwap { from: usize, cursor: (u16, u16) },
	/// Dragging a split boundary: the flanking pane pair is pinned at press
	/// time, `edge` is the boundary's current position (tree-truth, updated
	/// after every applied shift).
	Resize { axis: Axis, low: usize, high: usize, edge: u16 },
}

/// The modal surfaces — mutually exclusive (see `open_overlay`).
#[derive(Clone, Copy)]
enum Overlay {
	Settings,
	Doctor,
	Help,
}

/// The workspace: menu row, tab row, and a tree of panes per tab.
pub struct Workspace {
	tabs: Vec<Tab>,
	active_tab: usize,
	normalizer: KeyNormalizer,
	theme: termide_theme::Theme,
	config: std::sync::Arc<termide_config::Config>,
	help_open: bool,
	doctor_open: bool,
	settings_open: bool,
	notice: Option<String>,
	/// Hit regions recorded by the last draw, in paint order (later wins).
	hits: Vec<(Rect, Hit)>,
	/// (pane id, rect) of the active tab from the last frame.
	last_pane_areas: Vec<(usize, Rect)>,
	/// The pane canvas from the last frame (between the chrome and the
	/// dock/status rows) — the resize baseline, identical to what was drawn.
	last_content: Rect,
	open_menu: Option<usize>,
	/// Menu trigger boxes from the last frame, for dropdown placement.
	menu_boxes: Vec<(u16, u16)>,
	drag: Option<Drag>,
	last_frame: Rect,
	widgets: WidgetState,
	/// Pending close awaiting confirmation of busy panes (Yes replays it).
	confirm: Option<ConfirmClose>,
}

/// A close the user still has to confirm: which panes are busy, and what
/// executes on Yes.
struct ConfirmClose {
	message: String,
	action: PendingClose,
}

enum PendingClose {
	/// Close pane `usize` — or cascade per [`pane_close_target`].
	Pane(usize),
	/// Close the active tab.
	Tab,
	/// Quit the workspace.
	Quit,
}

pub fn run() -> Result<()> {
	crate::settings::init();
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
		let cwd = launch_cwd();
		let first = Tab::new_shell(cwd)?;
		Ok(Self {
			tabs: vec![first],
			active_tab: 0,
			normalizer: KeyNormalizer::new(KeyboardCaps::default()),
			theme: plain_theme(),
			config: std::sync::Arc::new(termide_config::Config::default()),
			help_open: false,
			doctor_open: false,
			settings_open: false,
			notice: None,
			hits: Vec::new(),
			last_pane_areas: Vec::new(),
			last_content: Rect::default(),
			open_menu: None,
			menu_boxes: Vec::new(),
			drag: None,
			last_frame: Rect::default(),
			widgets: WidgetState::default(),
			confirm: None,
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

	/// Open one modal surface and close the others — overlays are mutually
	/// exclusive; they render independently and would stack into a nested
	/// mess if two were ever live together.
	fn open_overlay(&mut self, which: Overlay) {
		self.settings_open = false;
		self.doctor_open = false;
		self.help_open = false;
		match which {
			Overlay::Settings => self.settings_open = true,
			Overlay::Doctor => self.doctor_open = true,
			Overlay::Help => self.help_open = true,
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
	/// tools self-install in the new slot. Returns `false` when the split
	/// failed (the notice then carries the error).
	fn split_pane(&mut self, pane: usize, kind: PaneKind, axis: Option<Axis>) -> bool {
		self.active().active = pane;
		let rect = self
			.last_pane_areas
			.iter()
			.find(|(id, _)| *id == pane)
			.map(|(_, r)| *r)
			.unwrap_or_else(|| self.focused_rect());
		let axis = axis.unwrap_or_else(|| Axis::for_rect(rect));
		let cwd = launch_cwd();
		let kind = match kind.install_kind() {
			Some(install) => {
				self.notice =
					Some(format!("{} not on PATH — installing in the new pane", kind.label()));
				install
			},
			None => kind,
		};
		match self.active().add_pane(pane, kind, cwd, rect, axis) {
			Ok(()) => {
				self.notice = None;
				true
			},
			Err(error) => {
				self.notice = Some(format!("split failed: {error}"));
				false
			},
		}
	}

	/// Hotkey/menu entry: split whatever pane currently holds focus.
	fn split_active(&mut self, kind: PaneKind, axis: Option<Axis>) -> bool {
		let focused = self.active().active;
		self.split_pane(focused, kind, axis)
	}

	/// Returns `true` when the workspace should quit.
	fn handle_key(&mut self, key: KeyEvent) -> Result<bool> {
		// The busy-close confirm is modal: Yes replays the pending close,
		// No dismisses, everything else is swallowed while it shows.
		if self.confirm.is_some() {
			let confirmed = match key.code {
				KeyCode::Char('y') | KeyCode::Char('Y') | KeyCode::Enter => true,
				KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc => false,
				_ => return Ok(false),
			};
			let pending = self.confirm.take();
			if confirmed {
				if let Some(pending) = pending {
					match pending.action {
						PendingClose::Pane(idx) => self.execute_pane_close(idx),
						PendingClose::Tab => self.execute_tab_close(),
						PendingClose::Quit => return Ok(true),
					}
				}
			}
			return Ok(false);
		}
		if self.help_open || self.doctor_open || self.settings_open {
			self.help_open = false;
			self.doctor_open = false;
			self.settings_open = false;
			if matches!(key.code, KeyCode::Esc) {
				return Ok(false);
			}
		}
		if key.modifiers.contains(KeyModifiers::ALT) {
			match key.code {
				KeyCode::Char('q') | KeyCode::Char('Q') => {
					if self.confirm_quit() {
						return Ok(false);
					}
					return Ok(true);
				},
				KeyCode::Char('t') | KeyCode::Char('T') => self.new_tab(),
				KeyCode::Char('w') | KeyCode::Char('W') => {
					if self.tabs.len() > 1 {
						if self.confirm_tab_close() {
							return Ok(false);
						}
						self.execute_tab_close();
					} else {
						if self.confirm_quit() {
							return Ok(false);
						}
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
					self.split_active(PaneKind::Shell, None);
				},
				KeyCode::Char('c') | KeyCode::Char('C') => {
					self.split_active(PaneKind::Agent, None);
				},
				KeyCode::Char('e') | KeyCode::Char('E') => {
					self.split_active(PaneKind::Editor, None);
				},
				KeyCode::Char('i') | KeyCode::Char('I') => {
					self.split_active(PaneKind::Ide, None);
				},
				KeyCode::Char('d') | KeyCode::Char('D') => {
					self.split_active(PaneKind::Time, None);
				},
				KeyCode::Char('p') | KeyCode::Char('P') => {
					self.split_active(PaneKind::Pomodoro, None);
				},
				KeyCode::Char('l') | KeyCode::Char('L') => self.cycle_preset(),
				KeyCode::Char('o') | KeyCode::Char('O') => {
					let tab = self.active();
					if !tab.panes.is_empty() {
						tab.active = (tab.active + 1) % tab.panes.len();
					}
				},
				KeyCode::Char('x') | KeyCode::Char('X') => {
					let idx = self.active().active;
					self.close_pane_at(idx);
				},
				KeyCode::Char('m') | KeyCode::Char('M') => {
					let tab = self.active();
					let idx = tab.active;
					tab.minimize_pane(idx);
				},
				KeyCode::Char('b') | KeyCode::Char('B') => self.promote_pane_to_tab(),
				_ => {},
			}
			return Ok(false);
		}
		if matches!(key.code, KeyCode::F(1)) {
			self.open_overlay(Overlay::Help);
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

	/// One click: open an install pane for every suite tool missing from
	/// PATH. What to install comes from the suite table (`suite::SUITE`) —
	/// the status line lists the same canonical commands `zeta doctor`
	/// prints. The summary lands after the splits: each split rewrites the
	/// notice while opening (those intermediate writes are never rendered —
	/// one draw per event), so only the last assignment survives.
	fn install_missing_tools(&mut self) {
		let missing = crate::suite::missing_tools();
		let Some(summary) = crate::suite::install_batch_line(&missing) else {
			self.notice = Some("all suite tools are installed — `zeta doctor` for details".into());
			return;
		};
		let mut failed: Option<String> = None;
		for tool in missing {
			if !self.split_active(tool.kind.clone(), None) && failed.is_none() {
				failed = self.notice.take();
			}
		}
		// A failed split's error explains itself; otherwise show the plan.
		self.notice = Some(failed.unwrap_or(summary));
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
				let cwd = launch_cwd();
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
			MouseEventKind::Moved => self.handle_mouse_moved(mouse),
			_ => false,
		}
	}

	/// The drag layer runs while the Settings toggle is on.
	fn drag_enabled(&self) -> bool {
		crate::settings::snapshot().drag
	}

	/// Focus follows the hover when the setting is on — suppressed while a
	/// menu, an overlay, or a drag owns the pointer.
	fn handle_mouse_moved(&mut self, mouse: crossterm::event::MouseEvent) -> bool {
		let settings = crate::settings::snapshot();
		if !settings.focus_follows_mouse
			|| self.open_menu.is_some()
			|| self.help_open
			|| self.doctor_open
			|| self.settings_open
			|| self.drag.is_some()
		{
			return false;
		}
		let position = ratatui::layout::Position { x: mouse.column, y: mouse.row };
		if let Some(pane) = self
			.last_pane_areas
			.iter()
			.find(|(_, a)| a.contains(position))
			.map(|(p, _)| *p)
		{
			if self.active().panes.get(pane).is_some() {
				self.active().active = pane;
			}
		}
		false
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
			Hit::DismissOverlay => {
				// Any click closes the modal — overlays must never depend on
				// keys alone (an active IME can swallow those entirely).
				self.settings_open = false;
				self.doctor_open = false;
				self.help_open = false;
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
				if self.drag_enabled() {
					self.drag = Some(Drag::TabReorder(idx));
				}
			},
			Hit::TabClose => {
				if self.tabs.len() > 1 {
					self.tabs.remove(self.active_tab);
					self.active_tab = self.active_tab.min(self.tabs.len() - 1);
				} else {
					return true;
				}
			},
			Hit::SplitRow { pane } => {
				self.split_pane(pane, PaneKind::Shell, Some(Axis::Row));
			},
			Hit::SplitCol { pane } => {
				self.split_pane(pane, PaneKind::Shell, Some(Axis::Column));
			},
			Hit::PagePlus { pane } => {
				self.active().active = pane;
				let cwd = launch_cwd();
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
					// The pane's last page went with the click — the pane
					// must go too. This used to call close_pane, whose
					// last-pane guard silently refused on a single-pane tab
					// and left the page-less pane as a dead shell (black
					// content, `[]` label); the cascade below heals it.
					self.close_pane_at(pane);
				}
			},
			Hit::PaneMinimize { pane } => {
				self.active().minimize_pane(pane);
			},
			Hit::Boundary { axis, low, high } => {
				// The shared border itself was pressed — the resize drag
				// starts right here (the position bar renders while it is
				// live). The flanking pair is pinned for the whole drag.
				if self.drag_enabled() {
					if let Some((_, r)) = self.last_pane_areas.iter().find(|(id, _)| *id == low) {
						let edge = match axis {
							Axis::Row => r.right(),
							Axis::Column => r.bottom(),
						};
						self.drag = Some(Drag::Resize { axis, low, high, edge });
					}
				}
			},
			Hit::DockChip { slot } => {
				// Replant beside the focused pane, split across its longer
				// side (same rule as a fresh auto split).
				let rect = self.focused_rect();
				let side = if rect.width >= rect.height {
					Side::Left
				} else {
					Side::Top
				};
				self.active().restore_pane(slot, side);
			},
			Hit::SettingRow(idx) => {
				crate::settings::update(|s| match idx {
					0 => s.shell = s.shell.next(),
					1 => s.drag = !s.drag,
					2 => s.focus_follows_mouse = !s.focus_follows_mouse,
					_ => {},
				});
			},
			Hit::PaneTitle { pane } => {
				self.active().active = pane;
				if self.drag_enabled() {
					self.drag = Some(Drag::PaneSwap { from: pane, cursor: (mouse.column, mouse.row) });
				}
			},
			Hit::Pane { pane } => {
				// A shared split boundary near the cursor starts a resize
				// drag: the flanking pair is pinned here, the edge follows
				// the cursor one-to-one for the whole drag.
				if self.drag_enabled() {
					if let Some((axis, low, high)) =
						crate::layout::boundary_pair(&self.last_pane_areas, mouse.column, mouse.row, 1)
					{
						let edge = self.last_pane_areas.iter().find(|(id, _)| *id == low).map(
							|(_, r)| match axis {
								Axis::Row => r.right(),
								Axis::Column => r.bottom(),
							},
						);
						if let Some(edge) = edge {
							self.drag = Some(Drag::Resize { axis, low, high, edge });
							return false;
						}
					}
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
					Some(PaneKind::Time) => {
						if widgets::calendar_nav_click(&mut self.widgets, inner, mouse.column, mouse.row)
						{
							return false;
						}
						if widgets::calendar_day_click(&mut self.widgets, inner, mouse.column, mouse.row)
						{
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
			Hit::Quit => {
				if self.confirm_quit() {
					return false;
				}
				return true;
			},
		}
		false
	}

	fn handle_mouse_drag(&mut self, mouse: crossterm::event::MouseEvent) -> bool {
		match self.drag.as_mut() {
			Some(Drag::PaneSwap { cursor, .. }) => {
				*cursor = (mouse.column, mouse.row);
			},
			Some(Drag::Resize { axis, low, edge, .. }) => {
				let (axis, low, mut edge) = (*axis, *low, *edge);
				let position = match axis {
					Axis::Row => mouse.column,
					Axis::Column => mouse.row,
				};
				let delta = position as i32 - edge as i32;
				if delta != 0 {
					let content = self.last_content;
					self.active().tree.resize_at(content, axis, edge, delta);
					// Re-measure the edge from the tree itself — never from
					// the screen — so back-to-back drag events between two
					// frames still accumulate exactly.
					if let Some((_, rect)) = self
						.active()
						.tree
						.leaf_rects(content)
						.into_iter()
						.find(|(id, _)| *id == low)
					{
						edge = match axis {
							Axis::Row => rect.right(),
							Axis::Column => rect.bottom(),
						};
					}
					if let Some(Drag::Resize { edge: stored, .. }) = self.drag.as_mut() {
						*stored = edge;
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
				let names = self.tab_display_names();
				let layout =
					tab_layout_named(self.last_frame.width, self.tabs.len(), usize::MAX, &names);
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
						self.tabs.push(Tab {
							panes: vec![pane],
							minimized: Vec::new(),
							active: 0,
							tree: PaneNode::single(0),
						});
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
			(1, 0) => {
				self.split_active(PaneKind::Shell, None);
			},
			(1, 1) => {
				self.split_active(PaneKind::Agent, None);
			},
			(1, 2) => {
				self.split_active(PaneKind::Editor, None);
			},
			(1, 3) => {
				self.split_active(PaneKind::Ide, None);
			},
			(1, 4) => {
				self.split_active(PaneKind::Time, None);
			},
			(1, 5) => {
				self.split_active(PaneKind::Pomodoro, None);
			},
			(1, 6) => {
				self.split_active(PaneKind::Clipboard, None);
			},
			(1, 7) => {
				let cwd = launch_cwd();
				let tab = self.active();
				if let Some(pane) = tab.panes.get_mut(tab.active) {
					let _ = pane.open_page(PaneKind::Shell, 24, 80, cwd);
				}
			},
			(1, 8) => {
				let tab = self.active();
				let idx = tab.active;
				tab.minimize_pane(idx);
			},
			(1, 9) => self.promote_pane_to_tab(),
			(1, 10) => {
				let idx = self.active().active;
				self.close_pane_at(idx);
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
			(3, 0..=5) => {
				let (_, tree) = PaneNode::presets()[item].clone();
				let cwd = launch_cwd();
				match self.active().apply_preset(tree, cwd) {
					Ok(()) => self.notice = None,
					Err(error) => self.notice = Some(format!("{error}")),
				}
			},
			(3, 6) => self.active().tree.equalize(),
			(3, 7) => {
				let tab = self.active();
				if !tab.panes.is_empty() {
					tab.active = (tab.active + 1) % tab.panes.len();
				}
			},
			(3, 8) => self.install_missing_tools(),
			// Settings
			(4, 0) => {
				self.open_overlay(Overlay::Settings);
			},
			(4, 1) => {
				self.open_overlay(Overlay::Doctor);
			},
			(4, 2) => self.open_overlay(Overlay::Help),
			(4, 3) => {
				let enabled = !crate::settings::snapshot().close_confirmation;
				crate::settings::update(|s| s.close_confirmation = enabled);
				self.notice =
					Some(format!("close confirmation {}", if enabled { "on" } else { "off" }));
			},
			_ => {},
		}
		false
	}

	fn apply_events(&mut self, events: Vec<PanelEvent>) {
		for event in events {
			match event {
				PanelEvent::Quit => return,
				PanelEvent::RunCommand { command, .. } => {
					self.split_active(PaneKind::Command(command), None);
				},
				PanelEvent::OpenPath { path, select_file, line, col } => {
					self.open_path_in_ide(path, select_file, line, col);
				},
				_ => {},
			}
		}
	}

	/// A clicked terminal link (OSC 8 hyperlink or scraped file path) opens
	/// the suite IDE in a new pane to the right of the focused one — the
	/// same split a hand press of `[↔]` performs. zeta-editor backs zeta-ide
	/// up; with neither installed the notice carries the error.
	fn open_path_in_ide(
		&mut self,
		path: std::path::PathBuf,
		select_file: Option<std::ffi::OsString>,
		line: Option<u32>,
		col: Option<u32>,
	) {
		// Scraped file-path clicks report the parent directory plus the file
		// to select inside it; the IDE wants the file itself.
		let path = match select_file {
			Some(file) => path.join(file),
			None => path,
		};
		let shell = crate::shell::pick_shell(crate::settings::snapshot().shell);
		let target = crate::tab::link_target_text(&path, line, col);
		match crate::tab::ide_open_command(&shell, &target) {
			Some(command) => {
				self.split_active(PaneKind::Command(command), Some(Axis::Row));
			},
			None => {
				self.notice =
					Some("no zeta-ide or zeta-editor on PATH — install one to open links".into());
			},
		}
	}

	fn new_tab(&mut self) {
		let cwd = launch_cwd();
		match Tab::new_shell(cwd) {
			Ok(tab) => {
				self.tabs.push(tab);
				self.active_tab = self.tabs.len() - 1;
			},
			Err(error) => self.notice = Some(format!("new tab failed: {error}")),
		}
	}

	/// Break the focused pane out into its own top-level tab: appended last
	/// and focused, while the old tab focuses a surviving sibling. The Pane
	/// object moves — its PTY pages keep running (a restart would lose the
	/// session); the PTY pages resize from the old slot's grid to the full
	/// tab. The last pane of a tab cannot leave (the tab would vanish):
	/// no-op, and the notice says so.
	fn promote_pane_to_tab(&mut self) {
		let pane_index = self.active().active;
		let Some(pane) = self.active().take_pane(pane_index) else {
			self.notice = Some("cannot move the last pane — a tab needs at least one".into());
			return;
		};
		let mut tab = Tab::with_pane(pane);
		tab.resize(
			self.last_content.height.saturating_sub(2).max(1),
			self.last_content.width.saturating_sub(2).max(1),
		);
		self.tabs.push(tab);
		self.active_tab = self.tabs.len() - 1;
	}

	/// The one pane-close pipeline every path shares (pane ✕, page ✕ on the
	/// last page, Alt+X, the menu entry, a pane's process exiting): detach
	/// the leaf and collapse the tree; the tab's last leaf closes the whole
	/// tab — focus moves to the right neighbor, else the left; the last
	/// tab's last pane is replaced in place by a fresh default shell. A tab
	/// therefore always keeps at least one live pane, and closing panes
	/// never quits the app. The dropped pane's PTY child is reaped by
	/// `Terminal`'s Drop.
	fn close_pane_at(&mut self, pane_index: usize) {
		if let Some(confirm) = self.confirm_pane_close(pane_index) {
			self.confirm = Some(confirm);
			return;
		}
		self.execute_pane_close(pane_index);
	}

	/// The confirmation to show before closing pane `pane_index` — `None`
	/// proceeds (idle pane, or confirmation toggled off).
	fn confirm_pane_close(&self, pane_index: usize) -> Option<ConfirmClose> {
		if !crate::settings::snapshot().close_confirmation {
			return None;
		}
		let tab = &self.tabs[self.active_tab];
		if !self.pane_busy(tab, pane_index) {
			return None;
		}
		let name = tab.pane_display_name(pane_index);
		let what = match pane_close_target(tab.panes.len(), self.tabs.len()) {
			PaneClose::Pane => format!("close `{name}` anyway?"),
			PaneClose::Tab => {
				format!("its last pane `{name}` runs a program — close the tab anyway?")
			},
			PaneClose::FreshShell => {
				format!("close `{name}` anyway? The slot becomes a fresh shell.")
			},
		};
		Some(ConfirmClose {
			message: format!("`{name}` is running a program — {what}"),
			action: PendingClose::Pane(pane_index),
		})
	}

	/// The close pipeline proper — no questions asked.
	fn execute_pane_close(&mut self, pane_index: usize) {
		match pane_close_target(self.active().panes.len(), self.tabs.len()) {
			PaneClose::Pane => self.active().close_pane(pane_index),
			PaneClose::Tab => {
				let index = self.active_tab;
				self.tabs.remove(index);
				self.active_tab = self.active_tab.min(self.tabs.len().saturating_sub(1));
			},
			PaneClose::FreshShell => match Tab::new_shell(launch_cwd()) {
				Ok(tab) => self.tabs[self.active_tab] = tab,
				Err(error) => self.notice = Some(format!("new tab failed: {error}")),
			},
		}
	}

	/// The tab-close pipeline proper (Alt+W): remove the tab and focus the
	/// right neighbor, else the left.
	fn execute_tab_close(&mut self) {
		self.tabs.remove(self.active_tab);
		self.active_tab = self.active_tab.min(self.tabs.len().saturating_sub(1));
	}

	/// Whether one pane's any PTY page runs a shell with live child
	/// processes (zetacode, vim, git, …). Widget pages are never busy.
	fn pane_busy(&self, tab: &Tab, pane_index: usize) -> bool {
		let Some(pane) = tab.panes.get(pane_index) else {
			return false;
		};
		pane.pages.iter().any(|page| match &page.body {
			crate::tab::PaneBody::Pty(term) => crate::busy::pane_is_busy(term.shell_pid()),
			crate::tab::PaneBody::Widget => false,
		})
	}

	/// Whether any pane in the tab is busy.
	fn tab_busy(&self, tab: &Tab) -> bool {
		(0..tab.panes.len()).any(|idx| self.pane_busy(tab, idx))
	}

	fn any_pane_busy(&self) -> bool {
		self.tabs.iter().any(|tab| self.tab_busy(tab))
	}

	/// Open the confirmation before a tab close when any of its panes is
	/// busy. `true` means the dialog opened and the close is paused.
	fn confirm_tab_close(&mut self) -> bool {
		if !crate::settings::snapshot().close_confirmation {
			return false;
		}
		let tab_index = self.active_tab;
		let busy: Vec<usize> = (0..self.tabs[tab_index].panes.len())
			.filter(|idx| self.pane_busy(&self.tabs[tab_index], *idx))
			.collect();
		if busy.is_empty() {
			return false;
		}
		let names: Vec<String> = {
			let tab = self.active();
			busy.iter().map(|idx| tab.pane_display_name(*idx)).collect()
		};
		self.confirm = Some(ConfirmClose {
			message: format!("{} — close the tab anyway?", summarize_busy(&names)),
			action: PendingClose::Tab,
		});
		true
	}

	/// Open the confirmation before quitting when anything runs anywhere.
	/// `true` means the dialog opened and the quit is paused.
	fn confirm_quit(&mut self) -> bool {
		if !crate::settings::snapshot().close_confirmation || !self.any_pane_busy() {
			return false;
		}
		let mut names: Vec<String> = Vec::new();
		for (idx, tab) in self.tabs.iter().enumerate() {
			for pane_idx in 0..tab.panes.len() {
				if self.pane_busy(tab, pane_idx) {
					names.push(self.tabs[idx].pane_display_name(pane_idx));
				}
			}
		}
		self.confirm = Some(ConfirmClose {
			message: format!("{} — quit anyway?", summarize_busy(&names)),
			action: PendingClose::Quit,
		});
		true
	}

	fn resize(&mut self, rows: u16, cols: u16) {
		for tab in &mut self.tabs {
			tab.resize(rows.saturating_sub(3), cols);
		}
	}

	/// Tab-bar names: `<tab number>:<focused pane title>` — the focused
	/// pane's OSC 0/2 title when the child named itself, else its numbered
	/// default label. Browser-style float-up of the focused pane's name;
	/// the number keeps renumbering itself as tabs come and go.
	fn tab_display_names(&self) -> Vec<String> {
		self
			.tabs
			.iter()
			.enumerate()
			.map(|(idx, tab)| format!("{}:{}", idx + 1, tab.pane_title_base(tab.active)))
			.collect()
	}

	fn tick(&mut self) {
		self.widgets.pomodoro.tick();
		let mut notices = Vec::new();
		let mut dead_tabs: Vec<usize> = Vec::new();
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
				if tab.panes.len() > 1 {
					tab.close_pane(idx);
				} else {
					// The tab's last pane lost its page (its process exited):
					// the whole tab goes through the cascade below — a fresh
					// shell replaces the active one, never a dead shell.
					dead_tabs.push(tab_idx);
					break;
				}
			}
		}
		for tab_idx in dead_tabs.into_iter().rev() {
			let was_active = tab_idx == self.active_tab;
			self.tabs.remove(tab_idx);
			if was_active {
				// The active tab's last pane died: a fresh default shell
				// takes its slot (numbering continues), the app stays up.
				match Tab::new_shell(launch_cwd()) {
					Ok(tab) => {
						let index = tab_idx.min(self.tabs.len());
						self.tabs.insert(index, tab);
						self.active_tab = index;
					},
					Err(error) => self.notice = Some(format!("new tab failed: {error}")),
				}
			} else {
				self.active_tab = self.active_tab.min(self.tabs.len().saturating_sub(1));
			}
		}
		if let Some(last) = notices.pop() {
			self.notice = Some(last);
		}
	}

	fn draw(&mut self, frame: &mut ratatui::Frame) {
		let size = frame.area();
		self.last_frame = size;
		self.hits.clear();
		let dock_h = if self.tabs[self.active_tab].minimized.is_empty() {
			0
		} else {
			1
		};
		let rows = Layout::vertical([
			Constraint::Length(1),      // menu bar
			Constraint::Length(1),      // tab bar
			Constraint::Min(3),         // panes
			Constraint::Length(dock_h), // minimized dock
			Constraint::Length(1),      // status
		])
		.split(size);
		self.last_content = rows[2];

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
		let tab_names = self.tab_display_names();
		let layout = tab_layout_named(size.width, self.tabs.len(), self.active_tab, &tab_names);
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
				let display_name = tab.pane_display_name(pane_id);
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
					let label: String = if page_idx == pane.page {
						// The active page carries the pane's display name:
						// OSC title when the child named itself, else the
						// numbered default.
						display_name.clone()
					} else {
						pane
							.pages
							.get(page_idx)
							.map(|p| p.kind.label())
							.unwrap_or_default()
					};
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
				const CONTROLS: &str = " +  ↔  ↕  –  ✕ ";
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
					Hit::PaneMinimize { pane: pane_id },
				);
				push_deferred(
					Rect { x: controls_x + 12, y: area.y, width: 3, height: 1 },
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
						Some(PaneKind::Time) => {
							widgets::render_time_calendar(&widgets_state, inner, frame.buffer_mut())
						},
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
				// A pane whose pages were all reaped this tick (child exit)
				// can reach the draw between reap and close — render it as an
				// empty body instead of panicking.
				if let Some(term) = pane.as_terminal() {
					term.prepare_render(&self.theme, &self.config);
					term.render(inner, frame.buffer_mut(), &ctx);
				}
			}

			// Boundary grab zones: shared border columns/rows. Claimed
			// before the deferred flush so title-bar controls keep
			// priority where they overlap the strip.
			for (axis, low, high, rect) in crate::layout::boundary_grabs(&rects) {
				self.push_hit(rect, Hit::Boundary { axis, low, high });
			}
			for (rect, hit) in deferred {
				self.push_hit(rect, hit);
			}
		}

		// Resize position bar: while a boundary drag is live, its edge
		// renders as a bright strip across the shared span — the splitter
		// affordance that shows exactly where the divide sits.
		if let Some(Drag::Resize { axis, low, high, .. }) = self.drag {
			let rect_of = |id: usize| {
				self
					.last_pane_areas
					.iter()
					.find(|(pid, _)| *pid == id)
					.map(|(_, r)| *r)
			};
			if let (Some(a), Some(b)) = (rect_of(low), rect_of(high)) {
				let (left, top) = (a.left().max(b.left()), a.top().max(b.top()));
				let (right, bottom) = (a.right().min(b.right()), a.bottom().min(b.bottom()));
				let bar = match axis {
					Axis::Row => Rect {
						x: a.right().saturating_sub(1),
						y: top,
						width: 2,
						height: bottom.saturating_sub(top),
					},
					Axis::Column => Rect {
						x: left,
						y: a.bottom().saturating_sub(1),
						width: right.saturating_sub(left),
						height: 2,
					},
				};
				let buffer = frame.buffer_mut();
				for row in bar.y..bar.bottom() {
					for col in bar.x..bar.right() {
						buffer[(col, row)]
							.set_symbol(" ")
							.set_style(Style::default().bg(Color::White));
					}
				}
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

		// Minimized dock: one chip per docked pane of THIS tab — click to
		// replant it beside the focused pane.
		if dock_h == 1 {
			let mut spans = vec![Span::styled(" minimized:", Style::default().fg(Color::DarkGray))];
			let mut cursor = rows[3].x + Span::raw(" minimized:").width() as u16;
			for slot in 0..self.tabs[self.active_tab].minimized.len() {
				let label = format!(" ▢ {} ", self.tabs[self.active_tab].minimized[slot].label());
				let width = Span::raw(label.clone()).width() as u16;
				spans.push(Span::styled(label, Style::default().fg(Color::White)));
				self.push_hit(
					Rect { x: cursor, y: rows[3].y, width, height: 1 },
					Hit::DockChip { slot },
				);
				cursor += width;
			}
			frame.render_widget(
				Paragraph::new(Line::from(spans)).style(Style::default().fg(Color::DarkGray)),
				rows[3],
			);
		}

		// Status row.
		let tab = &self.tabs[self.active_tab];
		let pane_label = tab.pane_display_name(tab.active);
		let leaves = count_leaves(&tab.tree);
		let status = self.notice.clone().unwrap_or_else(|| {
			status_text(&pane_label, &leaves.to_string(), tab.active, tab.panes.len())
		});
		frame.render_widget(
			Paragraph::new(status).style(Style::default().fg(Color::DarkGray)),
			rows[4],
		);
		const STATUS_TOOLS: &str = "[layout] [quit]";
		let tools_width = Span::raw(STATUS_TOOLS).width() as u16;
		if rows[4].width > tools_width {
			let start = rows[4].right() - tools_width - 1;
			frame.render_widget(
				Paragraph::new(Line::from(vec![
					Span::styled("[layout]", Style::default().fg(Color::White)),
					Span::styled(" ", Style::default()),
					Span::styled("[quit]", Style::default().fg(Color::White)),
				])),
				Rect { x: start, y: rows[4].y, width: tools_width, height: 1 },
			);
			self.push_hit(Rect { x: start, y: rows[4].y, width: 8, height: 1 }, Hit::LayoutCycle);
			self.push_hit(Rect { x: start + 9, y: rows[4].y, width: 6, height: 1 }, Hit::Quit);
		}

		if let Some(confirm) = &self.confirm {
			render_confirm_box(frame, rows[2], &confirm.message);
		}

		if self.doctor_open {
			// Full-frame dismiss beneath the panel: any click closes —
			// overlays must never depend on keys alone (an active IME can
			// swallow those entirely).
			self.push_hit(size, Hit::DismissOverlay);
			let overlay = Paragraph::new(crate::suite::doctor())
				.block(
					Block::default()
						.borders(Borders::ALL)
						.border_type(BorderType::Rounded)
						.title(" zeta suite status — click anywhere to close "),
				)
				.style(Style::default().bg(Color::Reset));
			let area = centered_rect(size, 56, 40);
			frame.render_widget(Clear, area);
			frame.render_widget(overlay, area);
		}

		if self.help_open {
			self.push_hit(size, Hit::DismissOverlay);
			let overlay = Paragraph::new(help::overlay_text())
				.block(
					Block::default()
						.borders(Borders::ALL)
						.border_type(BorderType::Rounded)
						.title(" zeta help — click anywhere to close "),
				)
				.wrap(Wrap { trim: false })
				.style(Style::default().bg(Color::Reset));
			let area = centered_rect(size, 62, 40);
			frame.render_widget(Clear, area);
			frame.render_widget(overlay, area);
		}

		// Settings overlay: one clickable row per setting; a click applies
		// (and persists) immediately, a click anywhere else closes.
		if self.settings_open {
			// Dismiss beneath, rows above: clicks outside the rows close,
			// clicks on a row apply. Never key-only — an active IME can
			// swallow keys entirely.
			self.push_hit(size, Hit::DismissOverlay);
			let s = crate::settings::snapshot();
			let value = |on: bool| if on { "on" } else { "off" };
			let rows = [
				format!(
					" default shell        {:<9}  ← click to cycle  (auto · powershell · pwsh 7 · git \
					 bash)",
					s.shell.label()
				),
				format!(
					" drag                 {:<9}  ← click to toggle (border resize · pane swap · tab \
					 reorder)",
					value(s.drag)
				),
				format!(" focus follows mouse  {:<9}  ← click to toggle", value(s.focus_follows_mouse)),
			];
			let lines: Vec<Line> = rows.iter().map(|row| Line::from(row.clone())).collect();
			let overlay = Paragraph::new(lines)
				.block(
					Block::default()
						.borders(Borders::ALL)
						.border_type(BorderType::Rounded)
						.title(" zeta settings — click outside to close "),
				)
				.style(Style::default().bg(Color::Reset));
			// Fixed 5-row panel (3 settings + borders) centered — a percent
			// height would cramp below ~30 terminal rows.
			let width = (size.width * 72 / 100).clamp(46, size.width.saturating_sub(2).max(46));
			let height = 5u16.min(size.height);
			let area = Rect {
				x: size.x + (size.width.saturating_sub(width)) / 2,
				y: size.y + (size.height.saturating_sub(height)) / 2,
				width,
				height,
			};
			frame.render_widget(Clear, area);
			frame.render_widget(overlay, area);
			for (idx, _) in rows.iter().enumerate() {
				self.push_hit(
					Rect {
						x: area.x + 1,
						y: area.y + 1 + idx as u16,
						width: area.width.saturating_sub(2),
						height: 1,
					},
					Hit::SettingRow(idx),
				);
			}
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

/// The working directory new panes inherit. GUI launches (Start menu, some
/// terminal profiles) inherit C:\Windows — a directory no one wants as a
/// pane's home — so a system-directory cwd falls back to the user profile.
fn launch_cwd() -> Option<std::path::PathBuf> {
	let dir = std::env::current_dir().ok()?;
	let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
	if dir.starts_with(system_root) {
		return std::env::var_os("USERPROFILE").map(std::path::PathBuf::from);
	}
	Some(dir)
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
