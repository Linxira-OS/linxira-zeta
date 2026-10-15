//! Nail 4: a WebView2 child window embedded in a dock panel.
//!
//! `gpui-wry` (Longbridge, Apache-2.0) wraps `wry`/`lb-wry` (tauri's wry,
//! Apache-2.0 OR MIT) which uses WebView2 on Windows. The webview is a *native
//! child window* of the GPUI window: GPUI positions it from the panel's paint
//! bounds every frame (`gpui_wry::WebViewElement::prepaint` → `set_bounds`), so
//! it follows the panel and never participates in the GPUI scene.

use std::path::PathBuf;

use gpui_kit::component::dock::{BasePanel, Panel, PanelEvent};
use gpui_kit::*;
use gpui_wry::WebView;
use raw_window_handle::HasWindowHandle;

use crate::panels::{PANEL_BG, PANEL_FG};

/// The `chrome=none` page shipped inside the binary and written to disk on
/// startup, so the spike proves *local* HTML rather than a network fetch.
const DEMO_HTML: &str = include_str!("../assets/embed_demo.html");

/// Write the demo page to the temp dir and return its `file:///` URL.
pub fn materialise_demo_page() -> anyhow::Result<String> {
	let dir = std::env::temp_dir().join("zetawork-gpui-spike");
	std::fs::create_dir_all(&dir)?;
	let path = dir.join("embed_demo.html");
	std::fs::write(&path, DEMO_HTML)?;
	Ok(file_url(&path))
}

fn file_url(path: &PathBuf) -> String {
	let slashed = path.to_string_lossy().replace('\\', "/");
	if slashed.starts_with('/') {
		format!("file://{slashed}")
	} else {
		format!("file:///{slashed}")
	}
}

pub struct WebViewPanel {
	focus_handle: FocusHandle,
	webview: Entity<WebView>,
	url: SharedString,
}

impl WebViewPanel {
	/// Build the panel, or return the reason the WebView2 child could not be
	/// created (missing runtime, no window handle, …) so the caller can show a
	/// fallback panel instead of dying.
	pub fn new(window: &mut Window, cx: &mut App) -> anyhow::Result<Entity<Self>> {
		let url = materialise_demo_page()?;
		let url_for_view = url.clone();
		let handle = window
			.window_handle()
			.map_err(|err| anyhow::anyhow!("window handle: {err}"))?;
		let raw = wry::WebViewBuilder::new()
			.with_url(url.clone())
			.with_devtools(cfg!(debug_assertions))
			.build_as_child(&handle)
			.map_err(|err| anyhow::anyhow!("WebView2 build_as_child: {err}"))?;
		println!("[zeta-spike] webview2 child window created for {url_for_view}");

		let webview = cx.new(|cx| WebView::new(raw, window, cx));

		Ok(cx.new(|cx| Self { focus_handle: cx.focus_handle(), webview, url: url_for_view.into() }))
	}

	pub fn set_visible(&self, visible: bool, cx: &mut App) {
		self.webview.update(cx, |webview, _| {
			if visible {
				webview.show();
			} else {
				// A native child window is outside the GPUI scene: leaving the
				// dock's active tab must hide it explicitly or it floats over
				// the other big tab.
				webview.hide();
			}
		});
	}

	pub fn url(&self) -> &SharedString {
		&self.url
	}
}

impl EventEmitter<PanelEvent> for WebViewPanel {}

impl Focusable for WebViewPanel {
	fn focus_handle(&self, _: &App) -> FocusHandle {
		self.focus_handle.clone()
	}
}

impl BasePanel for WebViewPanel {
	fn panel_name(&self) -> &'static str {
		"WebView2Panel"
	}
}

impl Panel for WebViewPanel {
	fn title(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
		div()
			.text_sm()
			.font_weight(FontWeight::MEDIUM)
			.child("WebView2 · 本地 HTML")
	}

	fn tab_name(&self, _: &App) -> Option<SharedString> {
		Some("WebView2".into())
	}
}

impl Render for WebViewPanel {
	fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
		div()
			.size_full()
			.bg(rgb(PANEL_BG))
			.text_color(rgb(PANEL_FG))
			.child(self.webview.clone())
	}
}
