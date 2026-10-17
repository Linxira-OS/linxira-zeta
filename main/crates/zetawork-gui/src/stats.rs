// SPDX-License-Identifier: AGPL-3.0-only
//! Where the native stats page lives, and what the shell's embedded container
//! honestly cannot do yet.
//!
//! The left column's 用量 entry and the right column's 上下文用量 tab open the
//! same page: the dashboard served by `packages/stats`, whose `src/server.ts`
//! binds `127.0.0.1:3847` by default, answers the dashboard at `/` and the JSON
//! the panels aggregate under `/api/stats/*`. The live address is published by
//! `zetacode serve` in `~/.zeta/serve.json` (`statsUrl`, next to `webUrl`,
//! `gatewayUrl`, `version`, `pid`, …), so this module reads that file once and
//! turns it into a [`StatsEndpoint`]: the URL to load, and where it came from.
//!
//! What is real here: the file read ([`discover_in`] / [`discover`]), the
//! hand-rolled extraction of the five fields this module cares about
//! ([`parse_serve`] — no `serde_json` in this module and no new dependency), the
//! loopback check that keeps the container off remote pages
//! ([`StatsEndpoint::is_loopback`]), and the display line in
//! [`StatsEndpoint::describe`]. What is not: the embedded browser itself. egui
//! has no web view — see [`CONTAINER_OBSTACLE`] — so the container paints this
//! URL and its provenance, and no numbers.
//!
//! Everything degrades: a missing, unreadable, non-UTF-8 or malformed
//! `serve.json` yields [`DEFAULT_STATS_URL`] with [`EndpointSource::Default`].
//! Nothing here creates, writes or locks a file, and no function in this module
//! panics.

use std::path::{Path, PathBuf};

/// The port `packages/stats` binds when nothing says otherwise.
pub const DEFAULT_STATS_URL: &str = "http://127.0.0.1:3847";

/// The directory inside the user home that holds [`SERVE_FILE_NAME`].
const ZETA_DIR_NAME: &str = ".zeta";

/// The file `zetacode serve` publishes its live addresses in;
/// [`StatsEndpoint::describe`] shows it collapsed to `~`.
const SERVE_FILE_NAME: &str = "serve.json";

/// Deepest nesting [`Cursor::skip_value`] will walk before calling a body
/// malformed. `serve.json` is a flat object, so this only stops a hostile body
/// such as `[[[[…` from recursing until the stack overflows.
const MAX_NESTING: u32 = 32;

/// The fields of `~/.zeta/serve.json` this module cares about.
///
/// Everything is optional except [`ServeInfo::stats_url`]: `zetacode serve`
/// writes more (`startedAt`, `cwd`, `desktopOpenSecret`, …) and older or newer
/// builds may omit or add fields, none of which affects the dashboard address.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServeInfo {
	/// `statsUrl` — the dashboard origin, trimmed; never empty.
	pub stats_url: String,
	/// `webUrl` — the workbench web UI, when the build publishes one.
	pub web_url: Option<String>,
	/// `gatewayUrl` — the model gateway, when the build publishes one.
	pub gateway_url: Option<String>,
	/// `version` — the `zetacode serve` version string.
	pub version: Option<String>,
	/// `pid` — the serving process, when it is a plain non-negative integer
	/// that fits in a `u32`.
	pub pid: Option<u32>,
}

/// Parse a `serve.json` body.
///
/// The body must be a JSON object whose top-level `statsUrl` is a non-empty
/// string after trimming; anything else — a non-object, a truncated body, a
/// `statsUrl` of the wrong type or an empty one, trailing garbage after the
/// object — is `None`. The other four fields are read when they have the
/// expected type and silently dropped when they do not, so one odd `pid` cannot
/// hide a usable `statsUrl`.
///
/// This is a deliberately small reader for one known file, not a JSON library:
/// it understands the grammar the file uses (objects, arrays, strings with
/// escapes, numbers, `true`/`false`/`null`), skips every field it does not
/// read, and never looks past the top level.
pub fn parse_serve(json: &str) -> Option<ServeInfo> {
	let mut cursor = Cursor::new(json);
	cursor.skip_ws();
	if !cursor.eat(b'{') {
		return None;
	}
	let mut stats_url = None;
	let mut web_url = None;
	let mut gateway_url = None;
	let mut version = None;
	let mut pid = None;
	cursor.skip_ws();
	if !cursor.eat(b'}') {
		loop {
			let key = cursor.string()?;
			cursor.skip_ws();
			if !cursor.eat(b':') {
				return None;
			}
			cursor.skip_ws();
			match key.as_str() {
				"statsUrl" => stats_url = cursor.optional_string(),
				"webUrl" => web_url = cursor.optional_string(),
				"gatewayUrl" => gateway_url = cursor.optional_string(),
				"version" => version = cursor.optional_string(),
				"pid" => pid = cursor.optional_uint(),
				_ => {
					cursor.skip_value(1)?;
				},
			}
			cursor.skip_ws();
			if cursor.eat(b',') {
				cursor.skip_ws();
				continue;
			}
			if cursor.eat(b'}') {
				break;
			}
			return None;
		}
	}
	cursor.skip_ws();
	if cursor.pos != cursor.text.len() {
		return None;
	}
	let stats_url = stats_url?.trim().to_string();
	if stats_url.is_empty() {
		return None;
	}
	Some(ServeInfo { stats_url, web_url, gateway_url, version, pid })
}

/// Where the URL came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EndpointSource {
	/// Read from a `serve.json` that parsed: `zetacode serve` is (or was) live
	/// on that address.
	ServeFile,
	/// Nothing usable was found, so the built-in [`DEFAULT_STATS_URL`] is used.
	Default,
}

/// The endpoint the embedded pages load, plus where it came from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatsEndpoint {
	/// The dashboard URL, exactly as `statsUrl` published it (or
	/// [`DEFAULT_STATS_URL`]).
	pub url: String,
	/// Which of those two it is.
	pub source: EndpointSource,
	/// The parsed file, kept so the UI can name the version and process behind
	/// the address; `None` for [`EndpointSource::Default`].
	pub info: Option<ServeInfo>,
}

impl StatsEndpoint {
	/// The dashboard page the container loads: `packages/stats` serves it at the
	/// root `/`, and a URL without a path resolves to exactly that page, so the
	/// endpoint's own URL *is* the page URL.
	pub fn usage_url(&self) -> &str {
		&self.url
	}

	/// Scheme and authority only — `http://127.0.0.1:3847` for a URL carrying a
	/// path, query or fragment. This is the part shared with the JSON the panels
	/// read under `/api/stats/*`.
	pub fn origin(&self) -> &str {
		url_origin(&self.url)
	}

	/// One line for the UI: the URL plus where it came from, naming the serving
	/// `zetacode serve` version and pid when the file published them.
	///
	/// The default wording is “未发现 ~/.zeta/serve.json”, which covers a missing
	/// file *and* one that is present but unreadable or malformed — the endpoint
	/// does not record which of those it hit.
	pub fn describe(&self) -> String {
		let mut text = format!("{} · ", self.url);
		match (self.source, self.info.as_ref()) {
			(EndpointSource::ServeFile, Some(info)) => {
				text.push_str("来自 ~/.zeta/serve.json");
				let mut parts: Vec<String> = Vec::new();
				match (info.version.as_deref(), info.pid) {
					(Some(version), _) => parts.push(format!("zetacode serve v{version}")),
					(None, Some(_)) => parts.push("zetacode serve".to_string()),
					(None, None) => {},
				}
				if let Some(pid) = info.pid {
					parts.push(format!("pid {pid}"));
				}
				if !parts.is_empty() {
					text.push('（');
					text.push_str(&parts.join("，"));
					text.push('）');
				}
			},
			_ => text.push_str("默认端口（未发现 ~/.zeta/serve.json）"),
		}
		text
	}

	/// True only for a page this machine serves itself: host `127.0.0.1`,
	/// `localhost` or `[::1]`, over `http` or `https`.
	///
	/// The container must never load a remote page, so everything else is
	/// refused — a LAN or public address, a hostname that merely *contains*
	/// `127.0.0.1`, a URL with no authority, and non-web schemes such as `file:`
	/// or `javascript:`.
	pub fn is_loopback(&self) -> bool {
		if !scheme_of(&self.url).is_some_and(is_web_scheme) {
			return false;
		}
		match authority_of(&self.url).map(host_of) {
			Some(host) => {
				host == "127.0.0.1" || host == "::1" || host.eq_ignore_ascii_case("localhost")
			},
			None => false,
		}
	}
}

/// One honest paragraph naming exactly what is missing for a real embedded
/// browser in this shell.
///
/// Rendered verbatim by the 用量 and 上下文用量 panes, next to the URL from
/// [`StatsEndpoint::describe`], so the placeholder explains itself instead of
/// inventing numbers.
pub const CONTAINER_OBSTACLE: &str = "egui/eframe 没有网页视图控件：窗口里的一切都是 egui 在单块 GPU 表面上自绘的，没有控件能渲染 HTML；要在本窗口内显示 \
	packages/stats 的看板，必须挂一个系统原生浏览器控件——Windows 上就是 WebView2，用 webview2-com / wry 把它的 HWND 以子窗口方式挂到 eframe 窗口上（\
	CreateCoreWebView2Controller + put_ParentWindow）——而本 crate 没有链接 WebView2 绑定或 wry 一类的封装（Cargo.toml 里只有 egui/eframe/ratatui/\
	sysinfo/chrono/serde_json/png/unicode-width）。窗口还是无边框的，标题栏由 chrome 模块用 egui 自绘，所以原生子窗口得自己在每帧和每次缩放时避开这条标题栏，\
	并自行处理层级、裁剪与 DPI，还要目标机装有 WebView2 运行时——这些都还没实现。因此 用量 和 上下文用量 两个入口目前只画出发现的地址、它的来源和它本该显示的内容，\
	没有编造的统计数字。";

/// The endpoint for a given user home; the file read is
/// `<home>/.zeta/serve.json`.
///
/// Read-only in the strict sense: the file is opened for reading only, and
/// when it is missing, unreadable, not UTF-8 or malformed the result is
/// [`DEFAULT_STATS_URL`] with [`EndpointSource::Default`]. No directory or file
/// is ever created, written or locked.
pub fn discover_in(home: &Path) -> StatsEndpoint {
	let path = home.join(ZETA_DIR_NAME).join(SERVE_FILE_NAME);
	match std::fs::read_to_string(&path) {
		Ok(body) => match parse_serve(&body) {
			Some(info) => StatsEndpoint {
				url: info.stats_url.clone(),
				source: EndpointSource::ServeFile,
				info: Some(info),
			},
			None => default_endpoint(),
		},
		Err(_) => default_endpoint(),
	}
}

/// [`discover_in`] against the real user home: `USERPROFILE` on Windows, `HOME`
/// everywhere else.
///
/// When that variable is unset or empty there is no home to look in, and the
/// endpoint degrades to [`DEFAULT_STATS_URL`] just as if the file were missing.
pub fn discover() -> StatsEndpoint {
	match home_dir() {
		Some(home) => discover_in(&home),
		None => default_endpoint(),
	}
}

/// The endpoint used whenever no usable `serve.json` was found.
fn default_endpoint() -> StatsEndpoint {
	StatsEndpoint { url: DEFAULT_STATS_URL.to_string(), source: EndpointSource::Default, info: None }
}

/// The user home directory from the environment, `None` when the variable is
/// unset or empty.
fn home_dir() -> Option<PathBuf> {
	#[cfg(windows)]
	let key = "USERPROFILE";
	#[cfg(not(windows))]
	let key = "HOME";
	let value = std::env::var_os(key)?;
	if value.is_empty() {
		return None;
	}
	Some(PathBuf::from(value))
}

/// The scheme of a URL (`http` in `http://host/path`), `None` when there is no
/// plausible `scheme://` at the front.
pub(crate) fn scheme_of(url: &str) -> Option<&str> {
	let end = url.find("://")?;
	let scheme = &url[..end];
	let plausible = !scheme.is_empty()
		&& scheme
			.bytes()
			.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.'));
	if plausible { Some(scheme) } else { None }
}

/// True for the two schemes a WebView2 child could load.
fn is_web_scheme(scheme: &str) -> bool {
	scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https")
}

/// The authority of a URL (`127.0.0.1:3847` in `http://127.0.0.1:3847/x`), with
/// any `user@` prefix removed. `None` when there is no scheme or the authority
/// is empty.
pub(crate) fn authority_of(url: &str) -> Option<&str> {
	let start = url.find("://")? + 3;
	let rest = &url[start..];
	let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
	let authority = &rest[..end];
	let authority = match authority.rfind('@') {
		Some(at) => &authority[at + 1..],
		None => authority,
	};
	if authority.is_empty() {
		None
	} else {
		Some(authority)
	}
}

/// The host inside an authority: `[::1]:3847` → `::1`, `host:3847` → `host`,
/// `host` → `host`. An unterminated bracket or an empty host yields `""`, which
/// matches nothing.
pub(crate) fn host_of(authority: &str) -> &str {
	if let Some(rest) = authority.strip_prefix('[') {
		return match rest.find(']') {
			Some(end) => &rest[..end],
			None => "",
		};
	}
	match authority.rfind(':') {
		Some(colon) => &authority[..colon],
		None => authority,
	}
}

/// The scheme-and-authority prefix of a URL, or the whole string when it has no
/// path, query or fragment to cut at.
fn url_origin(url: &str) -> &str {
	let start = url.find("://").map(|at| at + 3).unwrap_or(0);
	match url[start..].find(['/', '?', '#']) {
		Some(offset) => &url[..start + offset],
		None => url,
	}
}

/// A byte cursor over one JSON body, enough for the flat object [`parse_serve`]
/// reads — no dependency, no general-purpose JSON value.
struct Cursor<'a> {
	/// The whole body; the cursor never holds a byte outside it.
	text: &'a str,
	/// Byte offset of the next unread byte, always on a character boundary.
	pos: usize,
}

impl<'a> Cursor<'a> {
	/// A cursor at the start of `text`.
	fn new(text: &'a str) -> Self {
		Self { text, pos: 0 }
	}

	/// The byte at the cursor, `None` at the end of the body.
	fn peek(&self) -> Option<u8> {
		self.text.as_bytes().get(self.pos).copied()
	}

	/// Advance past `byte` when it is next, reporting whether it was.
	fn eat(&mut self, byte: u8) -> bool {
		if self.peek() == Some(byte) {
			self.pos += 1;
			true
		} else {
			false
		}
	}

	/// Skip JSON whitespace: the four bytes the grammar allows.
	fn skip_ws(&mut self) {
		while matches!(self.peek(), Some(b' ' | b'\t' | b'\r' | b'\n')) {
			self.pos += 1;
		}
	}

	/// Read one JSON string starting at the cursor's `"`, decoding its escapes.
	/// `None` on a missing quote, a bad escape or a raw control byte.
	fn string(&mut self) -> Option<String> {
		if !self.eat(b'"') {
			return None;
		}
		let mut out = String::new();
		loop {
			let byte = self.peek()?;
			self.pos += 1;
			match byte {
				b'"' => return Some(out),
				b'\\' => {
					let escape = self.peek()?;
					self.pos += 1;
					match escape {
						b'"' => out.push('"'),
						b'\\' => out.push('\\'),
						b'/' => out.push('/'),
						b'b' => out.push('\u{8}'),
						b'f' => out.push('\u{c}'),
						b'n' => out.push('\n'),
						b'r' => out.push('\r'),
						b't' => out.push('\t'),
						b'u' => out.push(self.unicode_escape()?),
						_ => return None,
					}
				},
				control if control < 0x20 => return None,
				ascii if ascii < 0x80 => out.push(ascii as char),
				_ => {
					// A leading byte of a multi-byte character: take the whole
					// character, so `out` stays valid UTF-8.
					self.pos -= 1;
					let character = self.text[self.pos..].chars().next()?;
					self.pos += character.len_utf8();
					out.push(character);
				},
			}
		}
	}

	/// The four hex digits after a `\u`, combined with the following low
	/// surrogate when this one is a high surrogate.
	fn unicode_escape(&mut self) -> Option<char> {
		let high = self.hex4()?;
		if (0xD800..=0xDBFF).contains(&high) {
			if !(self.eat(b'\\') && self.eat(b'u')) {
				return None;
			}
			let low = self.hex4()?;
			if !(0xDC00..=0xDFFF).contains(&low) {
				return None;
			}
			return char::from_u32(0x1_0000 + ((high - 0xD800) << 10) + (low - 0xDC00));
		}
		// `None` for a lone low surrogate, which no well-formed body contains.
		char::from_u32(high)
	}

	/// Exactly four hex digits as a `u32`.
	fn hex4(&mut self) -> Option<u32> {
		let mut value = 0u32;
		for _ in 0..4 {
			let digit = (self.peek()? as char).to_digit(16)?;
			self.pos += 1;
			value = value * 16 + digit;
		}
		Some(value)
	}

	/// A string field, or `None` when the value has another type — which is
	/// skipped, so the rest of the object still parses.
	fn optional_string(&mut self) -> Option<String> {
		if self.peek() == Some(b'"') {
			return self.string();
		}
		self.skip_value(0)?;
		None
	}

	/// A non-negative integer field: `None` for any other value (which is
	/// skipped in full, `4.5` and `-1` included) and for one that overflows a
	/// `u32`.
	fn optional_uint(&mut self) -> Option<u32> {
		if !matches!(self.peek(), Some(b'-' | b'0'..=b'9')) {
			self.skip_value(0)?;
			return None;
		}
		let start = self.pos;
		self.skip_number();
		let token = &self.text[start..self.pos];
		if !token.bytes().all(|byte| byte.is_ascii_digit()) {
			return None;
		}
		token.parse::<u32>().ok()
	}

	/// Skip one JSON value of any kind, including the nested shapes the fields
	/// this module reads never use.
	fn skip_value(&mut self, depth: u32) -> Option<()> {
		if depth > MAX_NESTING {
			return None;
		}
		match self.peek()? {
			b'"' => self.string().map(|_| ()),
			b'{' => self.skip_object(depth),
			b'[' => self.skip_array(depth),
			b't' => self.literal("true"),
			b'f' => self.literal("false"),
			b'n' => self.literal("null"),
			b'-' | b'0'..=b'9' => {
				self.skip_number();
				Some(())
			},
			_ => None,
		}
	}

	/// Consume a bare `true`, `false` or `null`.
	fn literal(&mut self, word: &str) -> Option<()> {
		if self.text[self.pos..].starts_with(word) {
			self.pos += word.len();
			Some(())
		} else {
			None
		}
	}

	/// Skip one object, pair by pair.
	fn skip_object(&mut self, depth: u32) -> Option<()> {
		if !self.eat(b'{') {
			return None;
		}
		self.skip_ws();
		if self.eat(b'}') {
			return Some(());
		}
		loop {
			self.string()?;
			self.skip_ws();
			if !self.eat(b':') {
				return None;
			}
			self.skip_ws();
			self.skip_value(depth + 1)?;
			self.skip_ws();
			if self.eat(b',') {
				self.skip_ws();
				continue;
			}
			return if self.eat(b'}') { Some(()) } else { None };
		}
	}

	/// Skip one array, element by element.
	fn skip_array(&mut self, depth: u32) -> Option<()> {
		if !self.eat(b'[') {
			return None;
		}
		self.skip_ws();
		if self.eat(b']') {
			return Some(());
		}
		loop {
			self.skip_value(depth + 1)?;
			self.skip_ws();
			if self.eat(b',') {
				self.skip_ws();
				continue;
			}
			return if self.eat(b']') { Some(()) } else { None };
		}
	}

	/// Scan one number token, sign, fraction and exponent included, without
	/// checking its digits. [`Self::optional_uint`] then reads the token back to
	/// decide whether it was a usable integer.
	fn skip_number(&mut self) {
		self.eat(b'-');
		while matches!(self.peek(), Some(b'0'..=b'9')) {
			self.pos += 1;
		}
		if self.eat(b'.') {
			while matches!(self.peek(), Some(b'0'..=b'9')) {
				self.pos += 1;
			}
		}
		if matches!(self.peek(), Some(b'e' | b'E')) {
			self.pos += 1;
			if !self.eat(b'+') {
				self.eat(b'-');
			}
			while matches!(self.peek(), Some(b'0'..=b'9')) {
				self.pos += 1;
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The shape of the real `~/.zeta/serve.json` on this machine — field for
	/// field, minus the `desktopOpenSecret` this module never reads — with its
	/// original tabs and Windows path escaping.
	const SERVE_FIXTURE: &str = "{
\t\"pid\": 29232,
\t\"webUrl\": \"http://127.0.0.1:30141\",
\t\"statsUrl\": \"http://127.0.0.1:3847\",
\t\"gatewayUrl\": \"http://127.0.0.1:30142\",
\t\"version\": \"1.2.1\",
\t\"startedAt\": \"2026-10-15T07:21:08.595Z\",
\t\"cwd\": \"C:\\\\Users\\\\ETPau\\\\AppData\\\\Local\\\\Programs\\\\Zeta\",
\t\"desktopOpenSecret\": \"AhBBQsYEboCIpvpZRhDF36cVcAHh15Hyg6XmSo40oBE\"
}";

	/// A scratch directory under the system temp dir, unique per test.
	fn scratch(tag: &str) -> PathBuf {
		std::env::temp_dir().join(format!("zetawork-gui-stats-{tag}-{}", std::process::id()))
	}

	/// Write `body` to `<home>/.zeta/serve.json`, creating the directories.
	fn seed_home(home: &Path, body: &str) {
		let dir = home.join(ZETA_DIR_NAME);
		std::fs::create_dir_all(&dir).unwrap();
		std::fs::write(dir.join(SERVE_FILE_NAME), body).unwrap();
	}

	/// An endpoint built from a URL alone, for the URL-parsing tests below.
	fn endpoint(url: &str) -> StatsEndpoint {
		StatsEndpoint { url: url.to_string(), source: EndpointSource::Default, info: None }
	}

	#[test]
	fn parse_serve_reads_the_real_fixture() {
		let info = parse_serve(SERVE_FIXTURE).expect("the real shape must parse");
		assert_eq!(info.stats_url, "http://127.0.0.1:3847");
		assert_eq!(info.web_url.as_deref(), Some("http://127.0.0.1:30141"));
		assert_eq!(info.gateway_url.as_deref(), Some("http://127.0.0.1:30142"));
		assert_eq!(info.version.as_deref(), Some("1.2.1"));
		assert_eq!(info.pid, Some(29232));
	}

	#[test]
	fn parse_serve_tolerates_odd_whitespace_and_escapes() {
		// Spaces, tabs, CRLF and newlines in every grammatical position.
		let body = "\r\n \t{\n\t \"statsUrl\"\t:  \"http://127.0.0.1:3847\" ,\r\n\
			\"pid\" :29232,\n\t\"version\":\"1.2.1\"\n } \t\n";
		let info = parse_serve(body).expect("whitespace must not matter");
		assert_eq!(info.stats_url, "http://127.0.0.1:3847");
		assert_eq!(info.pid, Some(29232));
		assert_eq!(info.version.as_deref(), Some("1.2.1"));
		assert_eq!(info.web_url, None);
		assert_eq!(info.gateway_url, None);

		// Escaped slashes decode to a plain URL, trailing slash and all.
		let escaped = parse_serve("{\"statsUrl\":\"http:\\/\\/127.0.0.1:3847\\/\"}")
			.expect("escapes must decode");
		assert_eq!(escaped.stats_url, "http://127.0.0.1:3847/");
		assert_eq!(endpoint(&escaped.stats_url).origin(), "http://127.0.0.1:3847");

		// Unknown fields of every kind are skipped, and a nested `statsUrl` is
		// not the top-level one.
		let crowded = "{\"startedAt\":\"2026-10-15T07:21:08.595Z\",\"nested\":{\"statsUrl\":\
			\"http://10.0.0.5:3847\"},\"list\":[1,-2.5e3,\"x\",{},[]],\"flag\":true,\"none\":null,\
			\"statsUrl\":\"http://127.0.0.1:3847\",\"pid\":29232}";
		let info = parse_serve(crowded).expect("skipping must reach the later statsUrl");
		assert_eq!(info.stats_url, "http://127.0.0.1:3847");
		assert_eq!(info.pid, Some(29232));
		assert_eq!(info.version, None);

		// A field of the wrong type is dropped without hiding a usable statsUrl,
		// and a pid that overflows a `u32` is simply absent.
		let mixed = parse_serve(
			"{\"pid\":4.5,\"version\":7,\"statsUrl\":\"http://127.0.0.1:3847\",\"webUrl\":null}",
		)
		.expect("a bad pid must not hide the url");
		assert_eq!(mixed.pid, None);
		assert_eq!(mixed.version, None);
		assert_eq!(mixed.web_url, None);
		assert_eq!(mixed.stats_url, "http://127.0.0.1:3847");

		let huge =
			parse_serve("{\"pid\":99999999999999999999,\"statsUrl\":\"http://127.0.0.1:3847\"}")
				.expect("an oversized pid must not hide the url");
		assert_eq!(huge.pid, None);
	}

	#[test]
	fn parse_serve_rejects_bodies_without_a_usable_stats_url() {
		for body in [
			"",
			"   ",
			"{",
			"{}",
			"[]",
			"\"http://127.0.0.1:3847\"",
			"{\"statsUrl\": 42}",
			"{\"statsUrl\": null}",
			"{\"statsUrl\": \"\"}",
			"{\"statsUrl\": \"   \"}",
			"{\"statsUrl\": \"http://127.0.0.1:3847\"",
			"{\"statsUrl\": \"http://127.0.0.1:3847\",}",
			"{\"statsUrl\": \"http://127.0.0.1:3847\"} trailing",
			"{\"pid\": 29232, \"statsU",
			"{\"statsUrl\": \"http://127.0.0.1:3847\"}x",
		] {
			assert!(parse_serve(body).is_none(), "must reject {body:?}");
		}
	}

	#[test]
	fn discover_in_reads_the_published_endpoint() {
		let home = scratch("published");
		let _ = std::fs::remove_dir_all(&home);
		seed_home(&home, SERVE_FIXTURE);

		let found = discover_in(&home);
		assert_eq!(found.source, EndpointSource::ServeFile);
		assert_eq!(found.url, "http://127.0.0.1:3847");
		assert_eq!(found.usage_url(), "http://127.0.0.1:3847");
		assert_eq!(found.origin(), "http://127.0.0.1:3847");
		assert!(found.is_loopback());
		assert_eq!(
			found.describe(),
			"http://127.0.0.1:3847 · 来自 ~/.zeta/serve.json（zetacode serve v1.2.1，pid 29232）"
		);
		assert_eq!(found.info.expect("info kept").version.as_deref(), Some("1.2.1"));

		// Whitespace is not significant to the discovery either.
		seed_home(&home, "{\n  \"statsUrl\" : \"http://127.0.0.1:3900\"\n}\n");
		let other = discover_in(&home);
		assert_eq!(other.source, EndpointSource::ServeFile);
		assert_eq!(other.url, "http://127.0.0.1:3900");
		assert_eq!(other.describe(), "http://127.0.0.1:3900 · 来自 ~/.zeta/serve.json");
		assert_eq!(other.info.expect("info kept").pid, None);

		std::fs::remove_dir_all(&home).unwrap();
	}

	#[test]
	fn discover_in_degrades_without_a_usable_file() {
		// No file at all — and nothing may be created by looking.
		let home = scratch("absent");
		let _ = std::fs::remove_dir_all(&home);
		std::fs::create_dir_all(&home).unwrap();
		let missing = discover_in(&home);
		assert_eq!(missing.source, EndpointSource::Default);
		assert_eq!(missing.url, DEFAULT_STATS_URL);
		assert_eq!(missing.usage_url(), DEFAULT_STATS_URL);
		assert_eq!(missing.info, None);
		assert!(missing.is_loopback());
		assert_eq!(
			missing.describe(),
			"http://127.0.0.1:3847 · 默认端口（未发现 ~/.zeta/serve.json）"
		);
		assert!(!home.join(ZETA_DIR_NAME).exists(), "discovery must not create .zeta");
		assert_eq!(std::fs::read_dir(&home).expect("home readable").count(), 0);

		// A truncated file, and one that is malformed rather than short.
		for body in ["{\"pid\": 29232, \"statsU", "{}", "{\"statsUrl\": 42}", "not json"] {
			seed_home(&home, body);
			let broken = discover_in(&home);
			assert_eq!(broken.source, EndpointSource::Default, "body {body:?}");
			assert_eq!(broken.url, DEFAULT_STATS_URL, "body {body:?}");
			assert_eq!(broken.info, None, "body {body:?}");
		}

		// A `serve.json` that is not a directory entry but a directory: still
		// read-only, still the default.
		let odd = scratch("dirserve");
		let _ = std::fs::remove_dir_all(&odd);
		std::fs::create_dir_all(odd.join(ZETA_DIR_NAME).join(SERVE_FILE_NAME)).unwrap();
		let unreadable = discover_in(&odd);
		assert_eq!(unreadable.source, EndpointSource::Default);
		assert_eq!(unreadable.url, DEFAULT_STATS_URL);

		std::fs::remove_dir_all(&home).unwrap();
		std::fs::remove_dir_all(&odd).unwrap();
	}

	#[test]
	fn is_loopback_allows_only_this_machine() {
		for url in [
			"http://127.0.0.1:3847",
			"http://localhost:3847",
			"http://[::1]:3847",
			"http://127.0.0.1:3847/dashboard",
			"http://LOCALHOST:3847",
			"https://127.0.0.1:3847/api/stats/overview",
			"http://[::1]",
		] {
			assert!(endpoint(url).is_loopback(), "{url} is this machine");
		}
		for url in [
			"http://10.0.0.5:3847",
			"https://example.com/stats",
			"http://127.0.0.1.evil.example:3847",
			"http://localhost.evil.example:3847",
			"http://[::2]:3847",
			"http://user@example.com:3847",
			"127.0.0.1:3847",
			"localhost",
			"file:///C:/stats.html",
			"javascript:alert(1)",
			"http://",
			"",
		] {
			assert!(!endpoint(url).is_loopback(), "{url} must be refused");
		}
	}

	#[test]
	fn usage_url_origin_and_describe_agree() {
		let found = discover_in(&std::env::temp_dir().join("zetawork-gui-stats-nowhere"));
		assert_eq!(found.usage_url(), found.url.as_str());
		assert_eq!(found.origin(), DEFAULT_STATS_URL);
		assert!(found.describe().starts_with(DEFAULT_STATS_URL));

		// origin drops whatever the URL carries after the authority; the page
		// URL keeps it.
		let with_path = endpoint("http://127.0.0.1:3847/dashboard?range=7d#top");
		assert_eq!(with_path.origin(), "http://127.0.0.1:3847");
		assert_eq!(with_path.usage_url(), "http://127.0.0.1:3847/dashboard?range=7d#top");

		// describe names the provenance, and drops the parts the file did not
		// publish.
		let full = StatsEndpoint {
			url: "http://127.0.0.1:3847".to_string(),
			source: EndpointSource::ServeFile,
			info: parse_serve(SERVE_FIXTURE),
		};
		assert_eq!(
			full.describe(),
			"http://127.0.0.1:3847 · 来自 ~/.zeta/serve.json（zetacode serve v1.2.1，pid 29232）"
		);

		let version_only = StatsEndpoint {
			url: "http://127.0.0.1:3847".to_string(),
			source: EndpointSource::ServeFile,
			info: parse_serve("{\"statsUrl\":\"http://127.0.0.1:3847\",\"version\":\"1.2.1\"}"),
		};
		assert_eq!(
			version_only.describe(),
			"http://127.0.0.1:3847 · 来自 ~/.zeta/serve.json（zetacode serve v1.2.1）"
		);

		let pid_only = StatsEndpoint {
			url: "http://127.0.0.1:3847".to_string(),
			source: EndpointSource::ServeFile,
			info: parse_serve("{\"statsUrl\":\"http://127.0.0.1:3847\",\"pid\":29232}"),
		};
		assert_eq!(
			pid_only.describe(),
			"http://127.0.0.1:3847 · 来自 ~/.zeta/serve.json（zetacode serve，pid 29232）"
		);

		let bare = StatsEndpoint {
			url: "http://127.0.0.1:3847".to_string(),
			source: EndpointSource::ServeFile,
			info: parse_serve("{\"statsUrl\":\"http://127.0.0.1:3847\"}"),
		};
		assert_eq!(bare.describe(), "http://127.0.0.1:3847 · 来自 ~/.zeta/serve.json");

		// A source of `Default` wins over a stray `info`, so the line never
		// claims a file it did not read.
		let stray = StatsEndpoint {
			url: DEFAULT_STATS_URL.to_string(),
			source: EndpointSource::Default,
			info: parse_serve(SERVE_FIXTURE),
		};
		assert_eq!(stray.describe(), "http://127.0.0.1:3847 · 默认端口（未发现 ~/.zeta/serve.json）");
	}

	#[test]
	fn container_obstacle_names_what_is_missing() {
		assert!(CONTAINER_OBSTACLE.len() > 80, "the paragraph explains itself");
		for expected in ["egui", "WebView2", "HWND", "无边框", "没有编造的统计数字"] {
			assert!(CONTAINER_OBSTACLE.contains(expected), "must name {expected}");
		}
	}
}
