//! WebView2 embedding: a real browser child window inside an egui panel.
//!
//! The spike question is whether an egui/eframe window can host a WebView2
//! child that loads a `chrome=none` page and follows the panel's rectangle
//! while the panel is resized. The answer (evidence in the PR body) is yes on
//! Windows: `wry`'s `WebViewBuilder::build_as_child` takes the HWND of the
//! eframe window (obtained from `eframe::CreationContext`, which implements
//! `HasWindowHandle`) and `WebView::set_bounds` is re-issued every frame from
//! the panel rect reported by the dock tab, so the web content tracks dock
//! splits, tab switches and window resizes.
//!
//! On every other target this module still compiles: the host is a stub that
//! refuses to attach, so the Linux leg of `Test main workspace` builds it
//! (`wry` is a `cfg(windows)` dependency precisely so GTK/WebKit is never
//! pulled in).

/// The `chrome=none` prototype page, embedded so the binary is self-contained.
pub const EMBED_HTML: &str = include_str!("../assets/embed-session.html");

/// Page → shell message for the "ready" handshake (design §3.2).
pub const READY_TYPE: &str = "zeta-embed-ready";

/// Shell → page: measured from inside the page, including the shell message
/// the page last received, so one probe proves *both* directions of the
/// `postMessage` bridge.
pub const PROBE_SCRIPT: &str = r#"(function () {
	const measure = function (text) {
		const el = document.createElement('span');
		el.style.font = '15px monospace';
		el.style.position = 'absolute';
		el.style.whiteSpace = 'pre';
		el.textContent = text;
		document.body.appendChild(el);
		const w = el.getBoundingClientRect().width;
		el.remove();
		return Math.round(w * 1000) / 1000;
	};
	const probe = {
		type: 'zeta-probe',
		inner: [window.innerWidth, window.innerHeight],
		dpr: window.devicePixelRatio,
		title: document.title,
		ready: document.readyState,
		href: window.location.href,
		cjk_cell_px: measure('中'),
		ascii_cell_px: measure('0'),
		shellMessage: window.__zeta_last_shell_message || null,
		messageTypes: window.__zeta_log || []
	};
	window.ipc.postMessage(JSON.stringify(probe));
})();"#;

/// Shell → page: read back the bridge globals and the document URL, so a run
/// shows *why* a message would not arrive.
pub const DIAG_SCRIPT: &str = "JSON.stringify({ipc: typeof window.ipc, webview: !!(window.chrome && window.chrome.webview), href: location.href, errors: window.__zeta_errors || []})";

/// A loopback HTTP server for the embedded page.
///
/// The page is loaded over `http://127.0.0.1:<port>/embed/<view>?chrome=none`
/// rather than `file://`: that is the shape the design mandates (design §3.1),
/// and it is also what makes the `postMessage` bridge work at all. `wry` wraps
/// every page → host message in an `http::Request` whose URI is the page URL
/// (`wry-0.57.0 src/webview2/mod.rs:952-978`); with a `file://` source URI that
/// `Request::builder().uri(..)` fails and the message is dropped before the
/// host ever sees it (observed in this spike: zero page → shell messages over
/// `file://`, all of them over `http://`).
pub struct EmbedServer {
	pub port: u16,
	requests: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
}

impl EmbedServer {
	/// Bind an ephemeral loopback port and serve [`EMBED_HTML`] on `/embed/*`.
	pub fn start() -> std::io::Result<Self> {
		use std::io::{Read as _, Write as _};
		let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
		let port = listener.local_addr()?.port();
		let requests = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
		let log = std::sync::Arc::clone(&requests);
		std::thread::spawn(move || {
			for stream in listener.incoming() {
				let Ok(mut stream) = stream else { continue };
				let mut buffer = [0u8; 2048];
				let read = stream.read(&mut buffer).unwrap_or(0);
				let head = String::from_utf8_lossy(&buffer[..read]).to_string();
				let request_line = head.lines().next().unwrap_or_default().to_owned();
				let embed = request_line.starts_with("GET /embed/");
				if let Ok(mut log) = log.lock() {
					log.push(request_line.clone());
				}
				let (status, body): (&str, &[u8]) = if embed {
					("200 OK", EMBED_HTML.as_bytes())
				} else {
					("404 Not Found", b"not found")
				};
				let response = format!(
					"HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
					body.len()
				);
				let _ = stream.write_all(response.as_bytes());
				let _ = stream.write_all(body);
				let _ = stream.flush();
			}
		});
		Ok(Self { port, requests })
	}

	/// The `chrome=none` URL for a view, as web-ui would serve it.
	pub fn url(&self, view: &str, session: &str) -> String {
		format!(
			"http://127.0.0.1:{}/embed/{view}?chrome=none&theme=dark&session={session}",
			self.port
		)
	}

	/// Request lines Chromium actually issued (evidence that the page loaded).
	pub fn requests(&self) -> Vec<String> {
		self
			.requests
			.lock()
			.map(|log| log.clone())
			.unwrap_or_default()
	}
}

/// A pixel rectangle in the eframe window's client area.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PixelRect {
	pub x: i32,
	pub y: i32,
	pub width: u32,
	pub height: u32,
}

impl PixelRect {
	pub fn is_empty(&self) -> bool {
		self.width < 2 || self.height < 2
	}
}

/// The page the shell serves, for the panel's "what is loaded" line.
pub fn embed_page_bytes() -> usize {
	EMBED_HTML.len()
}

#[cfg(windows)]
pub use win::EmbedHost;

#[cfg(windows)]
mod win {
	use std::sync::Arc;
	use std::sync::atomic::{AtomicBool, Ordering};
	use std::sync::mpsc::{Receiver, Sender};
	use std::time::Instant;

	use super::{PROBE_SCRIPT, PixelRect};

	/// A live WebView2 child window plus the message plumbing around it.
	pub struct EmbedHost {
		webview: wry::WebView,
		rx: Receiver<String>,
		diag_rx: Receiver<String>,
		diag_tx: Sender<String>,
		loaded: Arc<AtomicBool>,
		pub url: String,
		pub attach_ms: f64,
		pub bounds: Option<PixelRect>,
		pub bounds_updates: u32,
		pub diagnostics: Vec<String>,
	}

	impl EmbedHost {
		/// Attach to `window` (the eframe window) and load `url` at `rect`.
		///
		/// `window` only has to implement `HasWindowHandle`; passing the
		/// `eframe::CreationContext` therefore needs no `raw-window-handle`
		/// import in the caller.
		pub fn attach<W>(window: &W, url: String, rect: PixelRect) -> Result<Self, String>
		where
			W: wry::raw_window_handle::HasWindowHandle,
		{
			let (tx, rx) = std::sync::mpsc::channel::<String>();
			let (diag_tx, diag_rx) = std::sync::mpsc::channel::<String>();
			let loaded = Arc::new(AtomicBool::new(false));
			let loaded_flag = Arc::clone(&loaded);
			let started = Instant::now();
			let webview = wry::WebViewBuilder::new()
				.with_url(url.clone())
				.with_bounds(wry_rect(rect))
				.with_visible(true)
				.with_background_color((28, 33, 40, 255))
				.with_ipc_handler(move |request| {
					let _ = tx.send(request.into_body());
				})
				.with_on_page_load_handler(move |event, _url| {
					if matches!(event, wry::PageLoadEvent::Finished) {
						loaded_flag.store(true, Ordering::Relaxed);
					}
				})
				.build_as_child(window)
				.map_err(|err| format!("wry build_as_child: {err}"))?;
			Ok(Self {
				webview,
				rx,
				diag_rx,
				diag_tx,
				loaded,
				url,
				attach_ms: started.elapsed().as_secs_f64() * 1000.0,
				bounds: Some(rect),
				bounds_updates: 0,
				diagnostics: Vec::new(),
			})
		}

		pub fn try_recv(&self) -> Option<String> {
			self.rx.try_recv().ok()
		}

		pub fn page_loaded(&self) -> bool {
			self.loaded.load(Ordering::Relaxed)
		}

		/// Reposition/resize the child window to the egui panel's pixel rect.
		pub fn set_bounds(&mut self, rect: PixelRect) -> Result<(), String> {
			if self.bounds == Some(rect) {
				return Ok(());
			}
			self
				.webview
				.set_bounds(wry_rect(rect))
				.map_err(|err| format!("set_bounds: {err}"))?;
			self.bounds = Some(rect);
			self.bounds_updates += 1;
			Ok(())
		}

		pub fn set_visible(&self, visible: bool) -> Result<(), String> {
			self
				.webview
				.set_visible(visible)
				.map_err(|err| format!("set_visible: {err}"))
		}

		pub fn probe(&self) -> Result<(), String> {
			self.eval(PROBE_SCRIPT)
		}

		pub fn send_to_page(&self, message: &str) -> Result<(), String> {
			self.eval(&format!("window.__zetaReceive && window.__zetaReceive({message});"))
		}

		/// Ask the page to report its bridge globals (`evaluate_script` alone
		/// cannot return a value).
		pub fn diagnose(&self) -> Result<(), String> {
			let diag_tx = self.diag_tx.clone();
			self
				.webview
				.evaluate_script_with_callback(super::DIAG_SCRIPT, move |result| {
					let _ = diag_tx.send(result);
				})
				.map_err(|err| format!("evaluate_script_with_callback: {err}"))
		}

		pub fn try_recv_diag(&self) -> Option<String> {
			self.diag_rx.try_recv().ok()
		}

		fn eval(&self, script: &str) -> Result<(), String> {
			self
				.webview
				.evaluate_script(script)
				.map_err(|err| format!("evaluate_script: {err}"))
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

	/// Non-Windows stub: the crate builds and the UI runs, but the embed panel
	/// reports why there is no browser child window.
	pub struct EmbedHost {
		pub url: String,
		pub attach_ms: f64,
		pub bounds: Option<PixelRect>,
		pub bounds_updates: u32,
		pub diagnostics: Vec<String>,
	}

	impl EmbedHost {
		pub fn attach<W>(_window: &W, url: String, rect: PixelRect) -> Result<Self, String>
		where
			W: Sized,
		{
			let _ = rect;
			Err(format!(
				"WebView2 embedding is Windows-only in this spike (wry is a cfg(windows) dependency); \
				 would have served {url}"
			))
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

		pub fn probe(&self) -> Result<(), String> {
			Err("no webview host on this target".to_owned())
		}

		pub fn send_to_page(&self, _message: &str) -> Result<(), String> {
			Err("no webview host on this target".to_owned())
		}

		pub fn diagnose(&self) -> Result<(), String> {
			Err("no webview host on this target".to_owned())
		}

		pub fn try_recv_diag(&self) -> Option<String> {
			None
		}
	}
}
