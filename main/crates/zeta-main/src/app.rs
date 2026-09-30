use crate::help;
use crate::layout::{pane_areas, Template};
use crate::tab::{PaneKind, Tab};
use crate::tabs_ui::{menu_bar_text, status_text, TabBar};
use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Modifier, Style};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};
use ratatui::Terminal as RatuTerminal;
use std::io::Stdout;
use std::time::Duration;
use termide_core::{KeyChord, Panel, PanelConfig, PanelEvent, RenderContext, ThemeColors};
use termide_keyboard::{KeyNormalizer, KeyboardCaps};

/// The workspace: top-level tabs, each tab a tiled set of PTY panes.
pub struct Workspace {
	tabs: Vec<Tab>,
	active_tab: usize,
	normalizer: KeyNormalizer,
	theme: termide_theme::Theme,
	config: std::sync::Arc<termide_config::Config>,
	help_open: bool,
	/// One-line notice shown in the status bar (tool missing, actions done).
	notice: Option<String>,
}

pub fn run() -> Result<()> {
	let mut stdout = std::io::stdout();
	crossterm::terminal::enable_raw_mode()?;
	crossterm::execute!(stdout, crossterm::terminal::EnterAlternateScreen, crossterm::event::EnableMouseCapture)?;
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
				}
				Event::Mouse(mouse) => ws.handle_mouse(mouse),
				Event::Resize(cols, rows) => ws.resize(rows, cols),
				_ => {}
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
			theme: termide_theme::Theme::default(),
			config: std::sync::Arc::new(termide_config::Config::default()),
			help_open: false,
			notice: None,
		})
	}

	fn active(&mut self) -> &mut Tab {
		&mut self.tabs[self.active_tab]
	}

	/// Returns `true` when the workspace should quit.
	fn handle_key(&mut self, key: KeyEvent) -> Result<bool> {
		if self.help_open {
			if matches!(key.code, KeyCode::F(1) | KeyCode::Esc) {
				self.help_open = false;
			}
			return Ok(false);
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
				}
				KeyCode::Char(n @ '1'..='9') => {
					let idx = (n as u8 - b'1') as usize;
					if idx < self.tabs.len() {
						self.active_tab = idx;
					}
				}
				KeyCode::Left => {
					self.active_tab = if self.active_tab == 0 { self.tabs.len() - 1 } else { self.active_tab - 1 };
				}
				KeyCode::Right => {
					self.active_tab = (self.active_tab + 1) % self.tabs.len();
				}
				KeyCode::Char('n') | KeyCode::Char('N') => self.add_pane(PaneKind::Shell)?,
				KeyCode::Char('c') | KeyCode::Char('C') => self.add_pane(PaneKind::Agent)?,
				KeyCode::Char('e') | KeyCode::Char('E') => self.add_pane(PaneKind::Editor)?,
				KeyCode::Char('s') | KeyCode::Char('S') => self.add_pane(PaneKind::Shell)?,
				KeyCode::Char('l') | KeyCode::Char('L') => {
					let tab = self.active();
					tab.template = tab.template.next();
					self.reflow_active();
				}
				KeyCode::Char('o') | KeyCode::Char('O') => {
					let tab = self.active();
					if !tab.panes.is_empty() {
						tab.active = (tab.active + 1) % tab.panes.len();
					}
				}
				KeyCode::Char('x') | KeyCode::Char('X') => {
					let tab = self.active();
					let idx = tab.active;
					tab.close_pane(idx);
					self.reflow_active();
				}
				_ => {}
			}
			return Ok(false);
		}
		if matches!(key.code, KeyCode::F(1)) {
			self.help_open = true;
			return Ok(false);
		}
		// Everything else belongs to the focused pane.
		let chord = KeyChord::new(key, &self.normalizer);
		let events = {
			let tab = self.active();
			if tab.panes.is_empty() {
				return Ok(false);
			}
			tab.panes[tab.active].term.handle_key(chord)
		};
		self.apply_events(events);
		Ok(false)
	}

	fn handle_mouse(&mut self, mouse: crossterm::event::MouseEvent) {
		let position = ratatui::layout::Position { x: mouse.column, y: mouse.row };
		let areas = self.pane_area_map();
		if areas.is_empty() {
			// v1 routes focus by keyboard; without a computed area map there is
			// nothing to hit-test yet.
			return;
		}
		if let Some((idx, area)) = areas
			.iter()
			.enumerate()
			.find(|(_, a)| a.contains(position))
			.map(|(i, a)| (i, *a))
		{
			self.active().active = idx;
			let events = self.active().panes[idx].term.handle_mouse(mouse, area);
			self.apply_events(events);
		}
	}

	fn apply_events(&mut self, events: Vec<PanelEvent>) {
		for event in events {
			if matches!(event, PanelEvent::Quit) {
				return;
			}
			if let PanelEvent::RunCommand { command, .. } = event {
				let _ = self.add_pane(PaneKind::Command(command));
			}
		}
	}

	fn new_tab(&mut self) {
		let cwd = std::env::current_dir().ok();
		match Tab::new_shell(cwd) {
			Ok(tab) => {
				self.tabs.push(tab);
				self.active_tab = self.tabs.len() - 1;
			}
			Err(error) => self.notice = Some(format!("new tab failed: {error}")),
		}
	}

	fn add_pane(&mut self, kind: PaneKind) -> Result<()> {
		let label = kind.label();
		let cwd = std::env::current_dir().ok();
		let result = self.active().add_pane(kind, cwd);
		match &result {
			Ok(()) => {
				self.notice = None;
				self.reflow_active();
			}
			Err(error) => self.notice = Some(format!("{label}: {error}")),
		}
		result
	}

	/// Recompute pane sizes after layout/template/pane-count changes. The
	/// authoritative resize happens in draw(), where each pane's on-screen
	/// slot is known; reflow only triggers a redraw.
	fn reflow_active(&mut self) {}

	fn resize(&mut self, rows: u16, cols: u16) {
		for tab in &mut self.tabs {
			tab.resize(rows.saturating_sub(4), cols.saturating_sub(2));
		}
	}

	fn tick(&mut self) {
		let mut notices = Vec::new();
		for (tab_idx, tab) in self.tabs.iter_mut().enumerate() {
			let mut dead = Vec::new();
			for (idx, pane) in tab.panes.iter_mut().enumerate() {
				for event in pane.term.tick() {
					if matches!(event, PanelEvent::Quit) {
						dead.push(idx);
					}
				}
				if !pane.term.is_alive() {
					dead.push(idx);
				}
			}
			dead.sort_unstable();
			dead.dedup();
			for idx in dead.into_iter().rev() {
				if tab_idx == self.active_tab {
					notices.push(format!("pane exited: {}", tab.panes[idx].kind.label()));
				}
				if tab.panes.len() > 1 {
					tab.panes.remove(idx);
					tab.active = tab.active.min(tab.panes.len() - 1);
				}
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

	/// Current content-area rect and the per-pane rects of the active tab.
	/// Mouse routing uses this in a later iteration; panes are keyboard-focus
	/// driven in v1.
	#[allow(dead_code)]
	fn pane_area_map(&self) -> Vec<ratatui::layout::Rect> {
		Vec::new()
	}

	fn draw(&mut self, frame: &mut ratatui::Frame) {
		let size = frame.area();
		let rows = Layout::vertical([
			Constraint::Length(1), // tab bar
			Constraint::Length(1), // menu strip
			Constraint::Min(3),    // panes
			Constraint::Length(1), // status
		])
		.split(size);

		let titles: Vec<String> = self.tabs.iter().map(tab_title).collect();
		frame.render_widget(TabBar { titles: &titles, active: self.active_tab }, rows[0]);
		frame.render_widget(Paragraph::new(menu_bar_text()), rows[1]);

		let content = rows[2];
		let _colors = ThemeColors::from(&self.theme);
		let panel_config = PanelConfig::default();
		let tab = &mut self.tabs[self.active_tab];
		let areas = pane_areas(content, tab.template, tab.panes.len());
		for (idx, pane) in tab.panes.iter_mut().enumerate() {
			let Some(area) = areas.get(idx).copied() else { continue };
			// Keep the PTY grid in sync with its on-screen slot (2 columns and
			// 2 rows are consumed by the pane border).
			let inner_cols = area.width.saturating_sub(2).max(1);
			let inner_rows = area.height.saturating_sub(2).max(1);
			let _ = pane.term.resize(inner_rows, inner_cols);
			let focused = idx == tab.active;
			let block = Block::default().borders(Borders::ALL).title(format!(" {} ", pane.kind.label())).border_style(
				if focused {
					Style::default().add_modifier(Modifier::BOLD)
				} else {
					Style::default()
				},
			);
			let inner = block.inner(area);
			frame.render_widget(block, area);
			let colors = ThemeColors::from(&self.theme);
			let ctx = RenderContext {
				theme: &colors,
				config: &panel_config,
				is_focused: focused,
				panel_index: idx,
				terminal_width: size.width,
				terminal_height: size.height,
				border_right_x: Some(area.right().saturating_sub(1)),
				border_bottom_y: Some(area.bottom().saturating_sub(1)),
			};
			pane.term.prepare_render(&self.theme, &self.config);
			pane.term.render(inner, frame.buffer_mut(), &ctx);
		}

		let status = self
			.notice
			.clone()
			.unwrap_or_else(|| {
				let tab = &self.tabs[self.active_tab];
				let pane = tab.panes.get(tab.active);
				let label = pane.map(|p| p.kind.label()).unwrap_or_default();
				status_text(&label, tab.template.label(), tab.active, tab.panes.len())
			});
		frame.render_widget(Paragraph::new(status), rows[3]);

		if self.help_open {
			let area = centered_rect(size, 70, 60);
			frame.render_widget(Clear, area);
			frame.render_widget(
				Paragraph::new(help::overlay_text())
					.block(Block::default().borders(Borders::ALL).title(" help "))
					.wrap(Wrap { trim: false }),
				area,
			);
		}
	}
}

fn tab_title(tab: &Tab) -> String {
	match tab.panes.first() {
		Some(pane) => pane.kind.label(),
		None => "empty".into(),
	}
}

fn centered_rect(size: ratatui::layout::Rect, percent_x: u16, percent_y: u16) -> ratatui::layout::Rect {
	let vertical = Layout::vertical([
		Constraint::Percentage((100 - percent_y) / 2),
		Constraint::Percentage(percent_y),
		Constraint::Percentage((100 - percent_y) / 2),
	])
	.split(size);
	let horizontal = Layout::horizontal([
		Constraint::Percentage((100 - percent_x) / 2),
		Constraint::Percentage(percent_x),
		Constraint::Percentage((100 - percent_x) / 2),
	])
	.split(vertical[1]);
	horizontal[1]
}

/// Silence unused warnings for helpers reserved by later iterations.
#[allow(dead_code)]
fn _reserved(t: Template) -> Template {
	t.next()
}
