// SPDX-License-Identifier: AGPL-3.0-only
//! The 用量 container's WebView2 child: a real browser child window inside an
//! egui panel.
//!
//! `packages/stats` already serves the dashboard the 用量 entry wants, so the
//! container embeds it instead of redrawing it. `wry`'s
//! `WebViewBuilder::build_as_child` takes the HWND of the eframe window (from
//! [`eframe::Frame`], which implements `HasWindowHandle`), and
//! `WebView::set_bounds` is re-issued every frame from the container body's
//! rectangle scaled to physical pixels — so the dashboard tracks window
//! resizes, follows the container, and is unmapped again when the container
//! closes (a mapped child would keep keyboard focus).
//!
//! The address is resolved first ([`page_url`]): the URL `zetacode serve`
//! publishes in `~/.zeta/serve.json` when it is a loopback `http(s)` page,
//! otherwise the built-in [`crate::stats::DEFAULT_STATS_URL`]. A child window
//! must never load a remote page, so a `serve.json` pointing off-machine is
//! refused and the default is used.
//!
//! On every target other than Windows this module still compiles: `wry` is a
//! `cfg(windows)` dependency and [`EmbedHost`] is a stub that refuses to
//! attach, so the Linux leg of CI never builds GTK/WebKit. [`EmbedState`] is
//! the small state machine the container drives; without a child (another
//! target, a missing WebView2 runtime, a failed attach) it reports one line and
//! the container draws the native [`crate::usage`] panel instead.
//!
//! # What cannot be exercised headlessly
//!
//! Every test in this repository runs without a native window, so attach /
//! bounds / navigate cannot be tested: a headless egui context has no
//! `RawWindowHandle`, and WebView2 needs a real HWND plus the installed
//! runtime. What is tested is the pure part — points → physical pixels, which
//! URL wins — plus the non-Windows stub refusing to attach. The real path is
//! verified by running the binary on Windows and watching the dashboard render
//! inside the container and resize with it.

use crate::stats::{self, StatsEndpoint};

/// The longest platform error the container shows before eliding it. The panel
/// has one line, not a log.
const MAX_REASON: usize = 120;

/// What [`EmbedState::failure`] says when nothing even tried to attach — a
/// headless frame (the screenshot tests, `draw` without a window) never runs
/// [`EmbedState::prepare`], so there is no platform error to quote.
const NO_WINDOW: &str = "WebView2 子窗口未附加（没有可用的原生窗口）";

/// The page the child window loads for a discovered endpoint.
///
/// Precedence: a loopback `http(s)` URL (what `zetacode serve` publishes in
/// `~/.zeta/serve.json`) wins; everything else — no file, a malformed one, or
/// an address that is not served by this machine — falls back to
/// [`stats::DEFAULT_STATS_URL`].
pub fn page_url(endpoint: &StatsEndpoint) -> &str {
	if endpoint.is_loopback() {
		endpoint.usage_url()
	} else {
		stats::DEFAULT_STATS_URL
	}
}

/// A pixel rectangle in the eframe window's client area.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PixelRect {
	pub x: i32,
	pub y: i32,
	pub width: u32,
	pub height: u32,
}

impl PixelRect {
	/// A child can be created before it is placed; the first `set_bounds`
	/// moves it where the container is.
	pub const EMPTY: Self = Self { x: 0, y: 0, width: 0, height: 0 };

	/// The child window's physical pixels for an egui rectangle in points.
	///
	/// Both edges are rounded *after* scaling, so a fractional
	/// `pixels_per_point` cannot grow the width by one pixel per frame. An
	/// inverted rectangle collapses to zero instead of wrapping.
	pub fn from_points(rect: egui::Rect, pixels_per_point: f32) -> Self {
		let scale = pixels_per_point.max(0.0);
		let x = (rect.min.x * scale).round() as i32;
		let y = (rect.min.y * scale).round() as i32;
		let right = (rect.max.x * scale).round() as i32;
		let bottom = (rect.max.y * scale).round() as i32;
		Self { x, y, width: (right - x).max(0) as u32, height: (bottom - y).max(0) as u32 }
	}

	/// Too small to be a page: the container is clipped away, so the child is
	/// hidden rather than squeezed to a sliver.
	pub fn is_empty(&self) -> bool {
		self.width < 2 || self.height < 2
	}
}

/// The native window a [`EmbedHost`] attaches to.
///
/// On Windows this is exactly `wry::raw_window_handle::HasWindowHandle` (the
/// same crate version eframe uses), so [`eframe::Frame`] satisfies it. The
/// alias keeps that target-specific bound out of [`EmbedState::prepare`] and
/// out of the callers.
#[cfg(windows)]
pub trait NativeWindow: wry::raw_window_handle::HasWindowHandle {}
#[cfg(windows)]
impl<T: wry::raw_window_handle::HasWindowHandle + ?Sized> NativeWindow for T {}

/// On targets without `wry` every borrowed value qualifies: the stub refuses
/// to attach regardless of the window.
#[cfg(not(windows))]
pub trait NativeWindow {}
#[cfg(not(windows))]
impl<T: ?Sized> NativeWindow for T {}

/// The 用量 container's child window: attach once, then keep it in step.
///
/// The container calls [`Self::prepare`] once per frame while it is open, and
/// [`Self::show`] with the rectangle it drew the body at; [`Self::hide`] is
/// what the closed container calls so no unmapped-but-focused child remains.
#[derive(Default)]
pub struct EmbedState {
	host: Option<EmbedHost>,
	/// Whether the child is currently mapped.
	visible: bool,
	/// Why the container must draw the native panel, collapsed to one line.
	failure: Option<String>,
	/// The 刷新 button asked for a fresh navigation, and for a failed attach to
	/// be retried once; [`Self::prepare`] consumes it.
	pending_reload: bool,
}

impl EmbedState {
	/// The 刷新 button: navigate the attached child to the freshly discovered
	/// URL, or retry the attach if there is no child yet.
	pub fn reload(&mut self) {
		self.pending_reload = true;
		// The endpoint was just re-read; the runtime may have started since the
		// last attempt, so give it one more chance.
		self.failure = None;
	}

	/// One line for the UI when the container is drawing the native panel,
	/// `None` while the child window is live.
	pub fn failure(&self) -> Option<&str> {
		if self.host.is_some() && self.failure.is_none() {
			return None;
		}
		Some(self.failure.as_deref().unwrap_or(NO_WINDOW))
	}

	/// True when the child window is attached and owns the container body.
	pub fn is_live(&self) -> bool {
		self.failure().is_none()
	}

	/// Attach the child the first time the container is shown, or navigate it
	/// when the endpoint changed or 刷新 asked for a fresh load.
	///
	/// A failure is reported once, not retried every frame: the container then
	/// draws the native panel. [`Self::reload`] clears it and allows one retry.
	pub fn prepare<W: NativeWindow>(&mut self, window: &W, url: &str) {
		let retrying = std::mem::take(&mut self.pending_reload);
		if self.failure.is_some() && !retrying {
			return;
		}
		let outcome;
		if let Some(host) = self.host.as_mut() {
			// The dashboard may post nothing, but the channel must not grow
			// across a long-lived child.
			while host.try_recv().is_some() {}
			outcome = if retrying || host.url != url {
				host.navigate(url)
			} else {
				Ok(())
			};
		} else {
			match EmbedHost::attach(window, url.to_owned(), PixelRect::EMPTY) {
				Ok(host) => {
					self.host = Some(host);
					outcome = Ok(());
				},
				Err(err) => outcome = Err(err),
			}
		}
		match outcome {
			Ok(()) => self.failure = None,
			Err(err) => {
				self.failure = Some(one_line(&err));
				self.hide();
			},
		}
	}

	/// Place the child at the container body, in physical pixels.
	///
	/// The first call maps it (it is attached hidden), so the child never
	/// flashes at a stale rectangle.
	pub fn show(&mut self, rect: PixelRect) {
		if rect.is_empty() {
			self.hide();
			return;
		}
		let Some(host) = self.host.as_mut() else {
			return;
		};
		if let Err(err) = host.set_bounds(rect) {
			let line = one_line(&err);
			let _ = host.set_visible(false);
			self.visible = false;
			self.failure = Some(line);
			return;
		}
		if self.visible {
			return;
		}
		match host.set_visible(true) {
			Ok(()) => self.visible = true,
			Err(err) => {
				self.failure = Some(one_line(&err));
				self.visible = false;
			},
		}
	}

	/// Unmap the child — the container closed, or it shrank to nothing. The
	/// host stays attached so reopening does not pay for a second WebView2.
	pub fn hide(&mut self) {
		if !self.visible {
			return;
		}
		if let Some(host) = self.host.as_ref() {
			let _ = host.set_visible(false);
		}
		self.visible = false;
	}
}

/// Collapse a platform error to the single line the panel shows: first line
/// only, trimmed, and elided past [`MAX_REASON`] characters.
fn one_line(reason: &str) -> String {
	let first = reason.lines().next().unwrap_or_default().trim();
	let first = if first.is_empty() {
		"未知错误"
	} else {
		first
	};
	let mut line: String = first.chars().take(MAX_REASON).collect();
	if first.chars().count() > MAX_REASON {
		line.push('…');
	}
	line
}

#[cfg(windows)]
pub use win::EmbedHost;

#[cfg(windows)]
mod win {
	use std::sync::{
		Arc,
		atomic::{AtomicBool, Ordering},
		mpsc::Receiver,
	};

	use super::{NativeWindow, PixelRect};

	/// A live WebView2 child window plus the page-load flag and IPC channel.
	pub struct EmbedHost {
		webview: wry::WebView,
		rx: Receiver<String>,
		loaded: Arc<AtomicBool>,
		/// The URL the child was last told to show; [`super::EmbedState`]
		/// compares against it every frame.
		pub url: String,
		bounds: Option<PixelRect>,
	}

	impl EmbedHost {
		/// Attach to `window` (the eframe window), hidden, at `rect`.
		pub fn attach<W: NativeWindow>(
			window: &W,
			url: String,
			rect: PixelRect,
		) -> Result<Self, String> {
			let (sender, rx) = std::sync::mpsc::channel::<String>();
			let loaded = Arc::new(AtomicBool::new(false));
			let finished = Arc::clone(&loaded);
			let webview = wry::WebViewBuilder::new()
				.with_url(url.clone())
				.with_bounds(wry_rect(rect))
				// Unmapped until `set_bounds` has placed it; a visible child at
				// the placeholder rectangle would flash over the first frame.
				.with_visible(false)
				// The stats dashboard's dark background (`#1c2128`), so the
				// child does not flash white before the page paints.
				.with_background_color((28, 33, 40, 255))
				.with_ipc_handler(move |request: wry::http::Request<String>| {
					let _ = sender.send(request.into_body());
				})
				.with_on_page_load_handler(move |event, _url| {
					if matches!(event, wry::PageLoadEvent::Finished) {
						finished.store(true, Ordering::Relaxed);
					}
				})
				.build_as_child(window)
				.map_err(|err| format!("wry build_as_child: {err}"))?;
			Ok(Self { webview, rx, loaded, url, bounds: Some(rect) })
		}

		pub fn try_recv(&self) -> Option<String> {
			self.rx.try_recv().ok()
		}

		/// True once the page load finished; the dashboard has no handshake, so
		/// this is only a diagnostic.
		pub fn page_loaded(&self) -> bool {
			self.loaded.load(Ordering::Relaxed)
		}

		/// Reposition/resize the child to the container body's pixel rect.
		pub fn set_bounds(&mut self, rect: PixelRect) -> Result<(), String> {
			if self.bounds == Some(rect) {
				return Ok(());
			}
			self
				.webview
				.set_bounds(wry_rect(rect))
				.map_err(|err| format!("set_bounds: {err}"))?;
			self.bounds = Some(rect);
			Ok(())
		}

		pub fn set_visible(&self, visible: bool) -> Result<(), String> {
			self
				.webview
				.set_visible(visible)
				.map_err(|err| format!("set_visible: {err}"))
		}

		/// Load `url` in the existing child (刷新), or after the endpoint moved.
		pub fn navigate(&mut self, url: &str) -> Result<(), String> {
			self
				.webview
				.load_url(url)
				.map_err(|err| format!("load_url: {err}"))?;
			self.url.clear();
			self.url.push_str(url);
			self.loaded.store(false, Ordering::Relaxed);
			// Re-issue the bounds on the next frame: a navigation may reload the
			// document, and the container's rectangle is authoritative anyway.
			self.bounds = None;
			Ok(())
		}
	}

	fn wry_rect(rect: PixelRect) -> wry::Rect {
		wry::Rect {
			position: wry::dpi::PhysicalPosition::new(rect.x, rect.y).into(),
			size: wry::dpi::PhysicalSize::new(rect.width, rect.height).into(),
		}
	}
}

#[cfg(not(windows))]
pub use stub::EmbedHost;

#[cfg(not(windows))]
mod stub {
	use super::PixelRect;

	/// The one line the container shows instead of a child window here.
	pub const REASON: &str =
		"WebView2 embedding is Windows-only in this build (wry is a cfg(windows) dependency)";

	/// Non-Windows stub: the crate builds and the UI runs, but the 用量
	/// container falls back to the native panel.
	pub struct EmbedHost {
		pub url: String,
	}

	impl EmbedHost {
		pub fn attach<W>(_window: &W, url: String, _rect: PixelRect) -> Result<Self, String> {
			Err(format!("{REASON}; would have loaded {url}"))
		}

		pub fn try_recv(&self) -> Option<String> {
			None
		}

		pub fn page_loaded(&self) -> bool {
			false
		}

		pub fn set_bounds(&mut self, _rect: PixelRect) -> Result<(), String> {
			Ok(())
		}

		pub fn set_visible(&self, _visible: bool) -> Result<(), String> {
			Ok(())
		}

		pub fn navigate(&mut self, _url: &str) -> Result<(), String> {
			Err(REASON.to_owned())
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::stats::{EndpointSource, ServeInfo};

	fn served(url: &str, source: EndpointSource) -> StatsEndpoint {
		StatsEndpoint {
			url: url.to_owned(),
			source,
			info: match source {
				EndpointSource::ServeFile => Some(ServeInfo {
					stats_url: url.to_owned(),
					web_url: None,
					gateway_url: None,
					version: Some("1.2.3".to_owned()),
					pid: Some(42),
				}),
				EndpointSource::Default => None,
			},
		}
	}

	#[test]
	fn a_points_rect_scales_to_physical_pixels() {
		let rect = egui::Rect::from_min_max(egui::pos2(10.0, 20.0), egui::pos2(110.0, 220.0));
		assert_eq!(
			PixelRect::from_points(rect, 1.5),
			PixelRect { x: 15, y: 30, width: 150, height: 300 }
		);
	}

	#[test]
	fn rounding_happens_after_scaling_so_edges_do_not_drift() {
		// 0.4 pt and 10.4 pt at 200% are 0.8 px and 20.8 px: the origin rounds
		// to 1 and the far edge to 21, so the width stays 20 px, not 21.
		let rect = egui::Rect::from_min_max(egui::pos2(0.4, 0.4), egui::pos2(10.4, 10.4));
		assert_eq!(
			PixelRect::from_points(rect, 2.0),
			PixelRect { x: 1, y: 1, width: 20, height: 20 }
		);
	}

	#[test]
	fn an_offscreen_rectangle_keeps_its_signed_origin() {
		let rect = egui::Rect::from_min_max(egui::pos2(-4.0, -2.0), egui::pos2(8.0, 10.0));
		let px = PixelRect::from_points(rect, 1.0);
		assert_eq!((px.x, px.y), (-4, -2));
		assert_eq!((px.width, px.height), (12, 12));
	}

	#[test]
	fn an_inverted_or_tiny_rect_is_empty() {
		let inverted = egui::Rect::from_min_max(egui::pos2(50.0, 10.0), egui::pos2(10.0, 5.0));
		let collapsed = PixelRect::from_points(inverted, 1.0);
		assert_eq!((collapsed.width, collapsed.height), (0, 0));
		assert!(collapsed.is_empty(), "an inverted rect has no area");
		assert!(PixelRect::EMPTY.is_empty());
		assert!(PixelRect { x: 0, y: 0, width: 1, height: 900 }.is_empty());
		assert!(!PixelRect { x: 0, y: 0, width: 2, height: 2 }.is_empty());
	}

	#[test]
	fn the_published_loopback_endpoint_wins() {
		let endpoint = served("http://127.0.0.1:4123", EndpointSource::ServeFile);
		assert_eq!(page_url(&endpoint), "http://127.0.0.1:4123");
		let endpoint = served("http://localhost:5000/stats", EndpointSource::ServeFile);
		assert_eq!(page_url(&endpoint), "http://localhost:5000/stats");
	}

	#[test]
	fn the_default_endpoint_is_used_without_a_serve_file() {
		let endpoint = served(stats::DEFAULT_STATS_URL, EndpointSource::Default);
		assert_eq!(page_url(&endpoint), stats::DEFAULT_STATS_URL);
	}

	#[test]
	fn a_remote_serve_file_url_is_refused() {
		// The child only ever loads a page this machine serves, so a serve.json
		// written for another host must not win.
		let endpoint = served("https://stats.example.com:3847", EndpointSource::ServeFile);
		assert_eq!(page_url(&endpoint), stats::DEFAULT_STATS_URL);
		let endpoint = served("file:///C:/stats/index.html", EndpointSource::ServeFile);
		assert_eq!(page_url(&endpoint), stats::DEFAULT_STATS_URL);
	}

	#[test]
	fn a_platform_reason_is_collapsed_to_one_line() {
		assert_eq!(one_line("first line\nsecond line"), "first line");
		assert_eq!(one_line("   "), "未知错误");
		let long = "x".repeat(MAX_REASON + 20);
		let line = one_line(&long);
		assert_eq!(line.chars().count(), MAX_REASON + 1);
		assert!(line.ends_with('…'));
	}

	#[test]
	fn a_state_that_never_prepared_reports_the_missing_window() {
		let state = EmbedState::default();
		assert!(!state.is_live());
		assert_eq!(state.failure(), Some(NO_WINDOW));
	}

	#[cfg(not(windows))]
	#[test]
	fn the_stub_refuses_to_attach_and_says_why() {
		let err = EmbedHost::attach(&(), "http://127.0.0.1:3847".to_owned(), PixelRect::EMPTY)
			.err()
			.expect("no wry on this target");
		assert!(err.contains("Windows-only"), "{err}");
		assert!(!err.contains('\n'), "one line: {err}");
	}

	#[cfg(not(windows))]
	#[test]
	fn preparing_on_a_wry_less_target_falls_back_without_panicking() {
		let mut state = EmbedState::default();
		state.prepare(&(), "http://127.0.0.1:3847");
		assert!(!state.is_live());
		let line = state.failure().expect("a reason");
		assert!(line.contains("Windows-only"), "{line}");
		// A second frame does not retry the doomed attach.
		state.prepare(&(), "http://127.0.0.1:3847");
		assert!(state.failure().is_some());
	}
}
