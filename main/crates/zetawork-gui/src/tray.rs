// SPDX-License-Identifier: AGPL-3.0-only
//! 托盘: the icon and its menu.
//!
//! Compiled only with the `tray` feature (see the crate manifest). Without it
//! [`compiled_in`] is false, [`Tray::new`] returns a tray that records why it
//! is not there, and **closing the window still goes to the background** — the
//! tray is an extra way back, never the only one. [`crate::lifecycle`] is the
//! way back that always works.
//!
//! # Why the event handlers only wake the shell
//!
//! `tray-icon` delivers its menu and click events on its own thread, so the
//! handler cannot touch `AppState`. It pushes the clicked menu id onto a queue
//! and calls [`egui::Context::request_repaint`], which is `Send + Sync`; the id
//! is applied on the next frame by [`poll`], on the main thread. That is the
//! whole reason the queue exists — not an optimisation.
//!
//! # The degrade chain
//!
//! `TrayIconBuilder::build` fails where there is no host for it: Linux without
//! `libayatana-appindicator3` or without a StatusNotifier host, and any
//! headless session. The failure is recorded in [`Tray::note`] and shown in
//! 设置 → 常规, so "there is no tray" is visible in the product instead of
//! being a mystery.

/// The menu's first item: bring the window back.
pub const ID_SHOW: &str = "zetawork-show";

/// The menu's second item: how many terminal pages are open. Disabled — it is
/// a status line, not a button.
pub const ID_SESSIONS: &str = "zetawork-sessions";

/// The menu's third item: quit for real. By ruling this is an **explicit** quit
/// and never asks.
pub const ID_QUIT: &str = "zetawork-quit";

/// Why there is no tray, when the feature is off.
pub const NOTE_NO_FEATURE: &str =
	"本构建未启用 tray：没有托盘图标（关窗仍然后台驻留，再运行一次 zetawork 即可唤回窗口）";

/// Is the tray compiled into this build?
pub fn compiled_in() -> bool {
	cfg!(feature = "tray")
}

/// Menu ids clicked since the last drain.
#[cfg(feature = "tray")]
pub fn drain_clicks() -> Vec<String> {
	match CLICKS.lock() {
		Ok(mut queue) => std::mem::take(&mut *queue),
		Err(_) => Vec::new(),
	}
}

/// The menu queue, shared with the event handler `tray-icon` runs on its own
/// thread. One static, initialised where it is declared: nothing has to call an
/// `init`.
#[cfg(feature = "tray")]
static CLICKS: std::sync::LazyLock<std::sync::Mutex<Vec<String>>> =
	std::sync::LazyLock::new(|| std::sync::Mutex::new(Vec::new()));

/// Without the feature there is nothing to drain.
#[cfg(not(feature = "tray"))]
pub fn drain_clicks() -> Vec<String> {
	Vec::new()
}

/// The tray, or the reason there is none.
pub struct Tray {
	#[cfg(feature = "tray")]
	icon: Option<tray_icon::TrayIcon>,
	#[cfg(feature = "tray")]
	sessions: Option<tray_icon::menu::MenuItem>,
	#[cfg(feature = "tray")]
	shown_count: Option<usize>,
	/// Why there is no tray (the feature is off, or building it failed).
	pub note: Option<String>,
}

impl Tray {
	/// Did this process actually get a tray icon?
	///
	/// A different question from [`compiled_in`]: the feature can be compiled in
	/// and the icon still fail to appear (no StatusNotifier host, no
	/// `libayatana-appindicator3`, a headless session). 设置 → 常规 must say
	/// *that* instead of claiming the build has no tray support.
	pub fn available(&self) -> bool {
		self.note.is_none()
	}
}

#[cfg(not(feature = "tray"))]
impl Tray {
	/// No tray in this build.
	pub fn new(_ctx: &egui::Context) -> Self {
		Self { note: Some(crate::i18n::tr(NOTE_NO_FEATURE).to_owned()) }
	}

	/// The headless constructor: identical, and named for the caller's intent.
	pub fn disabled() -> Self {
		Self { note: Some(crate::i18n::tr(NOTE_NO_FEATURE).to_owned()) }
	}
}

#[cfg(feature = "tray")]
impl Tray {
	/// Build the tray. Every failure path ends in `note`, never in a panic: a
	/// missing StatusNotifier host must not stop the workbench from running.
	pub fn new(ctx: &egui::Context) -> Self {
		use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};

		let mut tray = Self { icon: None, sessions: None, shown_count: None, note: None };

		let show = MenuItem::with_id(ID_SHOW, t!("显示窗口"), true, None);
		let sessions = MenuItem::with_id(ID_SESSIONS, t!("运行中会话 0"), false, None);
		let quit = MenuItem::with_id(ID_QUIT, t!("退出 zetawork"), true, None);
		let menu =
			match Menu::with_items(&[&show, &sessions, &PredefinedMenuItem::separator(), &quit]) {
				Ok(menu) => menu,
				Err(error) => {
					tray.note = Some(t!("托盘菜单建不起来（{}）", error));
					return tray;
				},
			};

		// One handler per process, and it only queues the id.
		MenuEvent::set_event_handler(Some(|event: MenuEvent| {
			if let Ok(mut queue) = CLICKS.lock() {
				queue.push(event.id().0.clone());
			}
		}));
		let repaint = ctx.clone();
		tray_icon::TrayIconEvent::set_event_handler(Some(move |_event| {
			repaint.request_repaint();
		}));

		let icon = match tray_icon::Icon::from_rgba(mark_rgba(MARK_SIZE), MARK_SIZE, MARK_SIZE) {
			Ok(icon) => icon,
			Err(error) => {
				tray.note = Some(t!("托盘图标画不出来（{}）", error));
				return tray;
			},
		};
		match tray_icon::TrayIcon::builder()
			.with_id("zetawork")
			.with_tooltip(t!("zetawork — 工作台在后台运行"))
			.with_icon(icon)
			.with_menu(Box::new(menu))
			.build()
		{
			Ok(built) => {
				tray.icon = Some(built);
				tray.sessions = Some(sessions);
			},
			Err(error) => {
				// Linux without libayatana-appindicator3 / a StatusNotifier
				// host lands here, and so does a headless session.
				tray.note = Some(t!("托盘图标建不起来（{}）", error));
			},
		}
		tray
	}

	/// The headless constructor: no tray, and a note saying so.
	pub fn disabled() -> Self {
		Self {
			icon: None,
			sessions: None,
			shown_count: None,
			note: Some(crate::i18n::tr(NOTE_NO_FEATURE).to_owned()),
		}
	}

	/// Keep the 运行中会话数 line current. Only writes when the number moved, so
	/// a per-frame call costs nothing.
	fn sync_sessions(&mut self, count: usize) {
		if self.shown_count == Some(count) {
			return;
		}
		if let Some(item) = self.sessions.as_ref() {
			item.set_text(t!("运行中会话 {}", count));
		}
		self.shown_count = Some(count);
	}
}

/// The tray icon's size, in pixels.
#[cfg(feature = "tray")]
const MARK_SIZE: u32 = 32;

/// The tray icon: the same gradient mark the title bar draws, at 32×32.
///
/// Generated rather than shipped as a file, so there is no asset to keep in
/// sync with [`crate::theme::BRAND_A`].
#[cfg(feature = "tray")]
fn mark_rgba(size: u32) -> Vec<u8> {
	let mix = |from: u8, to: u8, t: f32| {
		(f32::from(from) + (f32::from(to) - f32::from(from)) * t).round() as u8
	};
	let mut pixels = Vec::with_capacity((size * size * 4) as usize);
	for y in 0..size {
		for x in 0..size {
			// The CSS mark is a 150° gradient; a diagonal ramp reads the same
			// at 32 px.
			let t = (x + y) as f32 / (2.0 * (size - 1).max(1) as f32);
			pixels.push(mix(crate::theme::BRAND_A.r(), crate::theme::BRAND_B.r(), t));
			pixels.push(mix(crate::theme::BRAND_A.g(), crate::theme::BRAND_B.g(), t));
			pixels.push(mix(crate::theme::BRAND_A.b(), crate::theme::BRAND_B.b(), t));
			pixels.push(255);
		}
	}
	pixels
}

/// Apply whatever the tray's threads queued, and keep its status line current.
///
/// A free function rather than a method: it needs both the tray and the shell,
/// and the tray is a field of the shell.
pub fn poll(ctx: &egui::Context, shell: &mut crate::Shell) {
	for id in drain_clicks() {
		match id.as_str() {
			ID_SHOW => shell.lifecycle.show(ctx),
			// 显式退出: by ruling the tray's 退出 never asks.
			ID_QUIT => {
				shell.lifecycle.quitting = true;
				ctx.send_viewport_cmd(egui::ViewportCommand::Close);
			},
			_ => {},
		}
	}
	#[cfg(feature = "tray")]
	{
		let count = shell.running_sessions();
		shell.tray.sync_sessions(count);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_menu_ids_are_distinct() {
		assert_ne!(ID_SHOW, ID_SESSIONS);
		assert_ne!(ID_SHOW, ID_QUIT);
		assert_ne!(ID_SESSIONS, ID_QUIT);
	}

	#[test]
	fn without_the_feature_there_is_no_tray_but_there_is_a_reason() {
		if compiled_in() {
			return;
		}
		let tray = Tray::disabled();
		assert!(tray.note.is_some(), "no tray has to say why");
		assert!(drain_clicks().is_empty());
	}
}
