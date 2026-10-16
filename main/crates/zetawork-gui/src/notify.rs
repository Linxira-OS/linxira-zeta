//! 通知: which background edge reaches the user, by what route, and what happens
//! when the route is not there.
//!
//! # The three triggers
//!
//! | # | trigger | signal today |
//! |---|---|---|
//! | ① | a pane went busy → idle while the window is not in front | **the edge detector is real** ([`crate::lifecycle::BusyEdges`]); no pane has a shell pid yet, so no edge can fire — see [`MISSING_SIGNALS`] |
//! | ② | a session needs the user | **no signal**: nothing in the GUI's state machine records "waiting for the user", and zetacode's approval events are not wired in. Deliberately not guessed at. |
//! | ③ | a session failed or ended | **no signal**: there is no session event stream yet. |
//!
//! ② and ③ keep their [`Trigger`] variants and the delivery path they would
//! take, and are listed in [`MISSING_SIGNALS`] so the shell can *say* they are
//! missing instead of drawing a control that does nothing.
//!
//! # The fallback chain
//!
//! [`emit`] tries, in order:
//!
//! 1. **系统通知** — Windows toast / Linux `org.freedesktop.Notifications`
//!    (compiled only with the `os-notify` feature; see the crate manifest).
//! 2. **IM 渠道** — `POST /api/channels/send` on the serve instance
//!    `~/.zeta/serve.json` published, the gateway's write entry for the WeChat /
//!    飞书 / Telegram senders ([`MESSAGING_SOURCES`]). The route needs the chat as
//!    well as the address, and the chat is pairing data this shell does not read
//!    yet — see [`MISSING_TARGET`] — so this step runs only once a
//!    [`MessagingTarget`] exists.
//! 3. **状态栏留痕** — always available: the status bar shows `通知：<标题>` and
//!    clicking it goes to the workspace the notification was about.
//!
//! Every step is additive: a route that is unavailable hands over to the next
//! one, and the trace always happens, so a notification is never silently lost.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

use crate::settings::NotifyPolicy;
use crate::stats::{authority_of, host_of, scheme_of};

/// Why the IM step cannot run yet: the gateway's write entry needs `channelId`
/// and `to`, and this shell has no pairing data to fill them with. The peer
/// bindings belong to the serve process — `~/.zeta/web.yml` holds
/// `channels.wechat.peerTokens` and the bot-session registry — and nothing in
/// this build reads that file, so the fallback stops at the status bar's trace
/// rather than sending the user's session state to a guessed recipient. Drawn in
/// 设置 → 常规 next to [`MISSING_SIGNALS`].
pub const MISSING_TARGET: &str =
	"缺 channelId + to（渠道与 peer 的配对信息由 serve 进程持有：~/.zeta/web.yml，本壳未读）";

/// Why a notification exists.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trigger {
	/// A pane stopped working while the window was not in front of the user.
	Idle,
	/// A session is waiting for the user. **No signal source yet.**
	NeedsInput,
	/// A session failed or ended. **No signal source yet.**
	Failed,
}

impl Trigger {
	pub fn label(self) -> &'static str {
		match self {
			Self::Idle => "后台任务已空闲",
			Self::NeedsInput => "等待你的输入",
			Self::Failed => "会话失败或结束",
		}
	}

	/// The trigger's own name, for the tests and the trace's tooltip.
	pub fn key(self) -> &'static str {
		match self {
			Self::Idle => "idle",
			Self::NeedsInput => "needs-input",
			Self::Failed => "failed",
		}
	}
}

/// The triggers that cannot fire yet, and what each one is waiting for. Drawn in
/// 设置 → 常规 so the gap is visible in the product rather than only in a commit
/// message.
pub const MISSING_SIGNALS: [(Trigger, &str); 2] = [
	(Trigger::NeedsInput, "GUI 侧还没有「等待用户输入」状态（zetacode 审批事件未接入）"),
	(Trigger::Failed, "还没有会话事件流（会话失败/结束没有信号源）"),
];

/// The IM senders the fallback reaches, by the names the user knows them by.
/// The gateway's `channelId` for the first one is `wechat` — see
/// [`MessagingTarget`].
pub const MESSAGING_SOURCES: [&str; 3] = ["WeChat", "飞书", "Telegram"];

/// One notification.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Message {
	pub trigger: Trigger,
	pub title: String,
	pub body: String,
	/// The workspace the notification is about, so a click can go there.
	pub target: Option<String>,
}

impl Message {
	/// The `通知：…` line the status bar shows.
	pub fn trace_line(&self) -> String {
		format!("通知：{}", self.title)
	}

	/// The text an IM channel carries: the title and the body, which is what a
	/// chat reader wants. The gateway's request body is built from this by
	/// [`send_body`].
	pub fn im_text(&self) -> String {
		format!("{}\n{}", self.title, self.body)
	}
}

/// Where the IM fallback posts: the gateway origin `zetacode serve` published,
/// and the chat to send to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MessagingTarget {
	/// Scheme + authority as published, `http://127.0.0.1:30141`.
	pub origin: String,
	/// The channel id the gateway knows the sender by: `wechat`, `feishu` or
	/// `telegram` (`ChannelId`, `packages/channels/src/channel.ts`).
	pub channel_id: String,
	/// The peer inside that channel (WeChat: the user id the bot replies to;
	/// the others: the chat id).
	pub to: String,
}

impl MessagingTarget {
	/// A target on `origin`, or `None` when this shell must not post there.
	///
	/// A notification body is the user's own session state, so the destination is
	/// restricted the way the 用量 container's page is: plain `http`, loopback
	/// host (`127.0.0.1` / `localhost` / `[::1]`), explicit port. A remote host, a
	/// TLS origin (this crate has no TLS client), a bare host with no port and a
	/// non-web scheme are all refused here rather than dialled.
	pub fn new(origin: &str, channel_id: &str, to: &str) -> Option<Self> {
		let (_, _, authority) = post_endpoint(origin)?;
		if channel_id.trim().is_empty() || to.trim().is_empty() {
			return None;
		}
		Some(Self {
			// The authority as published — brackets and all, so an IPv6
			// loopback keeps its `[ ]` when the target is read back.
			origin: format!("http://{authority}"),
			channel_id: channel_id.trim().to_owned(),
			to: to.trim().to_owned(),
		})
	}
}

/// How a notification actually went out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Delivery {
	/// The OS notification service took it.
	Os,
	/// The gateway's IM write entry took it.
	Im,
	/// The status bar's trace is carrying it (no other route worked).
	Trace,
}

impl Delivery {
	pub fn label(self) -> &'static str {
		match self {
			Self::Os => "系统通知",
			Self::Im => "IM 渠道",
			Self::Trace => "状态栏留痕",
		}
	}
}

/// A notification that was raised, and how far it got.
#[derive(Clone, Debug)]
pub struct Trace {
	pub message: Message,
	pub delivery: Delivery,
	/// Why the OS route was not used, when it was not.
	pub detail: String,
	/// What the IM step did: the gateway's answer, or why there was none. `None`
	/// when the step did not run — the OS route took the notification, or the
	/// shell has no [`MessagingTarget`].
	pub im: Option<Result<(), String>>,
	pub at: Instant,
}

/// Should a trigger fire at all?
///
/// The policy is the whole decision — `仅后台` means "only when the user is not
/// already looking at it", which is why the answer depends on `foreground`
/// rather than on the trigger.
pub fn should_fire(policy: NotifyPolicy, foreground: bool) -> bool {
	policy.allows(foreground)
}

/// Raise one notification and return the trace to keep.
///
/// Never fails: with the OS route unavailable this returns a [`Delivery::Trace`]
/// carrying the reason — and, when `target` is given, the IM step's own answer —
/// so the shell always has something to show.
pub fn emit(message: Message, target: Option<&MessagingTarget>) -> Trace {
	let os = os_notify(&message);
	// The IM step is the OS route's fallback, so it is not attempted once the
	// toast went out.
	let im = match &os {
		Ok(()) => None,
		Err(_) => target.map(|target| deliver_via_im(&message, target)),
	};
	let (delivery, detail) = route(&os, &im);
	Trace { message, delivery, detail, im, at: Instant::now() }
}

/// Which route carried the notification, from what each route did.
///
/// `im` is `None` both when the shell has no target and when the OS route
/// already took the message, so this is the whole chain in one place: ① 系统通知
/// → ② IM 渠道 → ③ 状态栏留痕, which is the trace every caller holds anyway.
fn route(os: &Result<(), String>, im: &Option<Result<(), String>>) -> (Delivery, String) {
	match os {
		Ok(()) => (Delivery::Os, String::new()),
		Err(reason) => match im {
			Some(Ok(())) => (Delivery::Im, reason.clone()),
			_ => (Delivery::Trace, reason.clone()),
		},
	}
}

/// The status bar's tooltip for a trace.
pub fn trace_hint(trace: &Trace) -> String {
	let mut text = format!(
		"{} · {} · 目标：{}",
		trace.message.trigger.label(),
		trace.delivery.label(),
		trace.message.target.as_deref().unwrap_or("（无）")
	);
	if !trace.detail.is_empty() {
		text.push_str(&format!("\n系统通知不可用：{}", trace.detail));
	}
	match &trace.im {
		Some(Ok(())) => text.push_str(&format!(
			"\nIM 回落：已由网关 POST /api/channels/send 投出（{}）",
			MESSAGING_SOURCES.join(" / ")
		)),
		Some(Err(why)) => text.push_str(&format!("\nIM 回落失败：{why}")),
		None => text.push_str(&format!(
			"\nIM 回落未发起（{}）：{MISSING_TARGET}",
			MESSAGING_SOURCES.join(" / ")
		)),
	}
	text
}

/// Deliver through a channel by posting the notification to the gateway's IM
/// write entry — `POST {origin}/api/channels/send`.
///
/// The request body is exactly the route's three required fields
/// (`{channelId, to, text}`), which are the runtime `ChatChannel.sendText(to,
/// text)` arguments it was built for. Errors are the caller's to record: the
/// chain never turns a delivery failure into silence, because the status bar's
/// trace still carries the notification.
pub fn deliver_via_im(message: &Message, target: &MessagingTarget) -> Result<(), String> {
	post_im_message(&target.origin, &send_body(target, &message.im_text()))
}

/// The gateway's request body for one send: its three required fields, and
/// nothing else (an extra key is one more shape to keep in sync).
fn send_body(target: &MessagingTarget, text: &str) -> String {
	format!(
		"{{\"channelId\":{},\"to\":{},\"text\":{}}}",
		json_string(&target.channel_id),
		json_string(&target.to),
		json_string(text)
	)
}

/// A minimal JSON string encoder — enough for the body above, and no dependency
/// for three fields.
fn json_string(value: &str) -> String {
	let mut out = String::with_capacity(value.len() + 2);
	out.push('"');
	for ch in value.chars() {
		match ch {
			'"' => out.push_str("\\\""),
			'\\' => out.push_str("\\\\"),
			'\n' => out.push_str("\\n"),
			'\r' => out.push_str("\\r"),
			'\t' => out.push_str("\\t"),
			ch if (ch as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", ch as u32)),
			ch => out.push(ch),
		}
	}
	out.push('"');
	out
}

/// How long a notification may wait on the gateway.
///
/// The post happens on the UI thread (a notification is raised from `tick`), so
/// the budget is the same 1 s the single-instance handshake uses: the gateway
/// answers this route in-process, and a wedged listener must not freeze the
/// window on top of failing.
const IM_TIMEOUT: Duration = Duration::from_secs(1);

/// `(host, port, authority)` this shell may POST to, `None` for anything else:
/// plain `http`, a loopback host, an explicit port.
fn post_endpoint(origin: &str) -> Option<(&str, u16, &str)> {
	if !scheme_of(origin).is_some_and(|scheme| scheme.eq_ignore_ascii_case("http")) {
		return None;
	}
	let authority = authority_of(origin)?;
	let host = host_of(authority);
	if !(host == "127.0.0.1" || host == "::1" || host.eq_ignore_ascii_case("localhost")) {
		return None;
	}
	let (_, port) = authority.rsplit_once(':')?;
	if port.ends_with(']') {
		return None;
	}
	Some((host, port.parse::<u16>().ok()?, authority))
}

/// One HTTP/1.1 POST, hand-rolled over `TcpStream`.
///
/// This crate has no HTTP client, and one request to a loopback address that
/// closes the connection does not justify adding one (the same trade
/// [`crate::lifecycle`] makes for the handshake and [`crate::stats`] for
/// `serve.json`). Only the status line decides the outcome; the gateway's error
/// text is carried along so the trace can say what it said.
fn post_im_message(origin: &str, body: &str) -> Result<(), String> {
	let (host, port, authority) =
		post_endpoint(origin).ok_or_else(|| format!("{origin} 不是本机 http 地址，未投递"))?;
	let mut stream = TcpStream::connect((host, port))
		.map_err(|error| format!("连接 {host}:{port} 失败：{error}"))?;
	stream
		.set_write_timeout(Some(IM_TIMEOUT))
		.map_err(|error| format!("设置写超时失败：{error}"))?;
	stream
		.set_read_timeout(Some(IM_TIMEOUT))
		.map_err(|error| format!("设置读超时失败：{error}"))?;
	let request = format!(
		"POST /api/channels/send HTTP/1.1\r\nHost: {authority}\r\n\
		 Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
		body.len()
	);
	stream
		.write_all(request.as_bytes())
		.map_err(|error| format!("发送请求失败：{error}"))?;
	// `Connection: close` + a read to EOF: the answer's length is never guessed.
	let mut response = String::new();
	stream
		.read_to_string(&mut response)
		.map_err(|error| format!("读取应答失败：{error}"))?;
	let status = status_of(&response).ok_or_else(|| "应答没有状态行".to_owned())?;
	if status == 200 {
		return Ok(());
	}
	Err(match error_of(&response) {
		Some(why) => format!("网关返回 {status}：{why}"),
		None => format!("网关返回 {status}"),
	})
}

/// The status code on an HTTP response's first line.
fn status_of(response: &str) -> Option<u16> {
	let line = response.lines().next()?;
	let code = line.split_whitespace().nth(1)?;
	code.parse::<u16>().ok()
}

/// The `error` string of the gateway's JSON body, when the answer carried one.
fn error_of(response: &str) -> Option<String> {
	let body = response.split_once("\r\n\r\n")?.1.trim();
	let at = body.find("\"error\"")?;
	let rest = &body[at..];
	let open = rest.find(':')? + 1;
	let rest = rest[open..].trim_start().strip_prefix('"')?;
	let end = rest.find('"')?;
	Some(rest[..end].replace("\\\"", "\""))
}

/// Deliver through the platform's notification service.
///
/// Compiled only with the `os-notify` feature **and** a platform that has an
/// implementation; otherwise the answer is a reason, which is what the fallback
/// chain is for.
#[cfg(all(feature = "os-notify", target_os = "windows"))]
fn os_notify(message: &Message) -> Result<(), String> {
	let toast =
		tauri_winrt_notification::Toast::new(tauri_winrt_notification::Toast::POWERSHELL_APP_ID)
			.title(&message.title)
			.text1(&message.body);
	toast
		.show()
		.map_err(|error| format!("WinRT toast：{error}"))
}

/// Linux: straight onto the session bus, `org.freedesktop.Notifications`.
///
/// The `Notify` call is the one every desktop implements; `timeout` of `-1`
/// means "the daemon's default". A missing daemon (no `DBUS_SESSION_BUS_ADDRESS`,
/// no notification host) fails here and hands over to the trace.
#[cfg(all(feature = "os-notify", target_os = "linux"))]
fn os_notify(message: &Message) -> Result<(), String> {
	let connection =
		zbus::blocking::Connection::session().map_err(|error| format!("D-Bus 会话总线：{error}"))?;
	let _: () = connection
		.call_method(
			Some("org.freedesktop.Notifications"),
			"/org/freedesktop/Notifications",
			Some("org.freedesktop.Notifications"),
			"Notify",
			&(
				"zetawork",
				0u32,
				"",
				message.title.as_str(),
				message.body.as_str(),
				Vec::<&str>::new(),
				std::collections::HashMap::<&str, zbus::zvariant::Value<'_>>::new(),
				-1i32,
			),
		)
		.map_err(|error| format!("org.freedesktop.Notifications：{error}"))?;
	Ok(())
}

/// Every other configuration: say why, so the caller falls back.
#[cfg(not(all(feature = "os-notify", any(target_os = "windows", target_os = "linux"))))]
fn os_notify(_message: &Message) -> Result<(), String> {
	Err("本构建未启用 os-notify（或该系统没有实现）".to_owned())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::net::TcpListener;
	use std::sync::mpsc;

	fn message() -> Message {
		Message {
			trigger: Trigger::Idle,
			title: "会话 1 已空闲".to_owned(),
			body: "pane 2 的子进程都退出了".to_owned(),
			target: Some("ws-local".to_owned()),
		}
	}

	/// A loopback listener that answers one request with `status` and reports the
	/// request it read. The notification's HTTP path is one of the few things in
	/// this crate a headless test can exercise end to end.
	fn fake_gateway(status: &'static str, body: &'static str) -> (String, mpsc::Receiver<String>) {
		let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
		let port = listener.local_addr().expect("local addr").port();
		let (tx, rx) = mpsc::channel();
		std::thread::spawn(move || {
			if let Ok((mut stream, _)) = listener.accept() {
				let mut request: Vec<u8> = Vec::new();
				let mut buffer = [0u8; 1024];
				let mut body_start: Option<usize> = None;
				let mut declared = 0usize;
				// Read until the declared body length is in hand, not until a
				// guess about packet boundaries holds.
				loop {
					match stream.read(&mut buffer) {
						Ok(0) | Err(_) => break,
						Ok(read) => {
							request.extend_from_slice(&buffer[..read]);
							if body_start.is_none() {
								if let Some(at) = headers_end(&request) {
									body_start = Some(at);
									declared = content_length(&request[..at]).unwrap_or(0);
								}
							}
							if let Some(at) = body_start {
								if request.len() - at >= declared {
									break;
								}
							}
						},
					}
				}
				let _ = tx.send(String::from_utf8_lossy(&request).into_owned());
				let answer = format!(
					"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
					body.len()
				);
				let _ = stream.write_all(answer.as_bytes());
			}
		});
		(format!("http://127.0.0.1:{port}"), rx)
	}

	/// Offset just past a request's blank line, `None` until the headers are all in.
	fn headers_end(bytes: &[u8]) -> Option<usize> {
		bytes
			.windows(4)
			.position(|window| window == b"\r\n\r\n")
			.map(|at| at + 4)
	}

	/// The `Content-Length` a request declared.
	fn content_length(headers: &[u8]) -> Option<usize> {
		let text = String::from_utf8_lossy(headers).to_ascii_lowercase();
		let at = text.find("content-length:")? + "content-length:".len();
		text[at..]
			.trim_start()
			.split(|ch: char| !ch.is_ascii_digit())
			.next()?
			.parse()
			.ok()
	}

	#[test]
	fn only_background_stays_quiet_when_the_user_is_looking() {
		assert!(should_fire(NotifyPolicy::BackgroundOnly, false), "hidden: fire");
		assert!(!should_fire(NotifyPolicy::BackgroundOnly, true), "in front: stay quiet");
		assert!(should_fire(NotifyPolicy::Always, true));
		assert!(should_fire(NotifyPolicy::Always, false));
		assert!(!should_fire(NotifyPolicy::Off, false), "关 means off, even in the background");
		assert!(!should_fire(NotifyPolicy::Off, true));
	}

	#[test]
	fn a_notification_is_never_dropped() {
		// Without a target (the shell's state today — see MISSING_TARGET) the
		// chain can only run the OS route and then the trace.
		let trace = emit(message(), None);
		assert_eq!(trace.message.trigger, Trigger::Idle);
		assert_ne!(trace.delivery, Delivery::Im, "no target: no IM step");
		if trace.delivery == Delivery::Trace {
			assert!(!trace.detail.is_empty(), "falling back has to say why");
		}
		assert_eq!(trace.message.trace_line(), "通知：会话 1 已空闲");
		let hint = trace_hint(&trace);
		assert!(hint.contains("WeChat"), "the IM fallback is named");
		assert!(hint.contains(MISSING_TARGET), "and says what it is missing");
	}

	#[test]
	fn the_im_step_posts_the_gateways_body_to_the_serve_origin() {
		let (origin, requests) = fake_gateway("200 OK", r#"{"ok":true}"#);
		let target = MessagingTarget::new(&origin, "wechat", "wx-peer").expect("loopback target");
		assert_eq!(deliver_via_im(&message(), &target), Ok(()));

		let request = requests
			.recv_timeout(Duration::from_secs(5))
			.expect("the request");
		assert!(request.starts_with("POST /api/channels/send HTTP/1.1\r\n"), "{request}");
		let (_, body) = request.split_once("\r\n\r\n").expect("headers");
		assert!(body.contains(r#""channelId":"wechat""#), "{body}");
		assert!(body.contains(r#""to":"wx-peer""#), "{body}");
		// `text` is the readable line the chat gets: title, then body. The JSON
		// escapes the newline, so the body is one line.
		assert!(body.contains(r#""text":"会话 1 已空闲\npane 2 的子进程都退出了""#), "{body}");
	}

	#[test]
	fn a_gateway_that_refuses_says_so_in_the_reason() {
		let (origin, requests) =
			fake_gateway("404 Not Found", r#"{"error":"Channel not enabled: wechat"}"#);
		let target = MessagingTarget::new(&origin, "wechat", "wx-peer").expect("loopback target");
		let reason = deliver_via_im(&message(), &target).expect_err("404 is a failure");
		assert!(reason.contains("404"), "{reason}");
		assert!(reason.contains("Channel not enabled: wechat"), "{reason}");
		let _ = requests
			.recv_timeout(Duration::from_secs(5))
			.expect("the request");
	}

	#[test]
	fn the_chain_never_uses_a_second_route_after_the_first_one_worked() {
		let ok: Result<(), String> = Ok(());
		let refused = Err("no daemon".to_owned());
		let im_ok: Option<Result<(), String>> = Some(Ok(()));
		let im_failed: Option<Result<(), String>> = Some(Err("连接 127.0.0.1:30141 失败".to_owned()));
		assert_eq!(route(&ok, &None), (Delivery::Os, String::new()));
		// The OS route winning means the IM step never ran, target or not.
		assert_eq!(route(&ok, &im_ok), (Delivery::Os, String::new()));
		assert_eq!(route(&refused, &im_ok), (Delivery::Im, "no daemon".to_owned()));
		assert_eq!(route(&refused, &im_failed), (Delivery::Trace, "no daemon".to_owned()));
		assert_eq!(route(&refused, &None), (Delivery::Trace, "no daemon".to_owned()));
	}

	#[test]
	fn the_trace_says_which_im_route_was_travelled() {
		let delivered = Trace {
			message: message(),
			delivery: Delivery::Im,
			detail: "本构建未启用 os-notify".to_owned(),
			im: Some(Ok(())),
			at: Instant::now(),
		};
		let hint = trace_hint(&delivered);
		assert!(hint.contains("IM 回落：已由网关 POST /api/channels/send 投出"), "{hint}");
		assert!(hint.contains("系统通知不可用：本构建未启用 os-notify"), "{hint}");

		let failed = Trace {
			message: message(),
			delivery: Delivery::Trace,
			detail: "本构建未启用 os-notify".to_owned(),
			im: Some(Err("连接 127.0.0.1:30141 失败".to_owned())),
			at: Instant::now(),
		};
		assert!(trace_hint(&failed).contains("IM 回落失败：连接 127.0.0.1:30141 失败"));
	}

	#[test]
	fn only_a_loopback_http_origin_with_a_port_is_a_target() {
		assert!(MessagingTarget::new("http://127.0.0.1:30141", "wechat", "peer").is_some());
		assert!(MessagingTarget::new("http://localhost:30141", "feishu", "chat").is_some());
		assert!(MessagingTarget::new("http://[::1]:30141", "telegram", "42").is_some());
		// A path is fine: only the scheme + authority are used.
		let with_path = MessagingTarget::new("http://127.0.0.1:30141/api/x", "wechat", "peer");
		assert_eq!(with_path.expect("target").origin, "http://127.0.0.1:30141");
		for refused in [
			"http://192.168.1.5:30141",
			"http://evil.example:30141",
			"https://127.0.0.1:30141",
			"http://127.0.0.1",
			"http://127.0.0.1:port",
			"file:///127.0.0.1:30141",
			"127.0.0.1:30141",
		] {
			assert!(MessagingTarget::new(refused, "wechat", "peer").is_none(), "{refused}");
		}
		// A target without a chat to send to is not a target.
		assert!(MessagingTarget::new("http://127.0.0.1:30141", "wechat", "  ").is_none());
		assert!(MessagingTarget::new("http://127.0.0.1:30141", "", "peer").is_none());
	}

	#[test]
	fn an_unreachable_gateway_is_a_reason_not_a_panic() {
		// Nothing listens on this port: the error has to name the address.
		let target =
			MessagingTarget::new("http://127.0.0.1:9", "wechat", "peer").expect("loopback target");
		let reason = deliver_via_im(&message(), &target).expect_err("nothing listens on :9");
		assert!(reason.contains("127.0.0.1:9"), "{reason}");
	}

	#[test]
	fn the_request_body_carries_every_field() {
		let target =
			MessagingTarget::new("http://127.0.0.1:30141", "wechat", "peer").expect("target");
		let body = send_body(&target, "行\n行");
		assert!(body.contains(r#""channelId":"wechat""#), "{body}");
		assert!(body.contains(r#""to":"peer""#), "{body}");
		assert!(body.contains(r#""text":"行\n行""#), "{body}");
	}

	#[test]
	fn json_strings_are_escaped() {
		assert_eq!(json_string("a\"b\\c"), "\"a\\\"b\\\\c\"");
		assert_eq!(json_string("行\n行"), "\"行\\n行\"");
	}

	#[test]
	fn the_gateway_status_line_and_error_body_are_read() {
		let ok = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}";
		assert_eq!(status_of(ok), Some(200));
		assert_eq!(error_of(ok), None);
		let refused = "HTTP/1.1 400 Bad Request\r\nContent-Length: 41\r\n\r\n{\"error\":\"Missing to: no peer to send to\"}";
		assert_eq!(status_of(refused), Some(400));
		assert_eq!(error_of(refused).as_deref(), Some("Missing to: no peer to send to"));
		assert_eq!(status_of("HTTP/1.1 204 No Content"), Some(204));
		assert_eq!(status_of(""), None);
		assert_eq!(status_of("garbage"), None);
	}

	#[test]
	fn the_missing_triggers_and_the_missing_target_are_named() {
		// The two triggers with no signal source are listed, so the settings
		// surface can say so instead of offering a dead toggle.
		assert_eq!(MISSING_SIGNALS.len(), 2);
		assert!(
			MISSING_SIGNALS
				.iter()
				.any(|(trigger, _)| *trigger == Trigger::NeedsInput)
		);
		assert!(
			MISSING_SIGNALS
				.iter()
				.any(|(trigger, _)| *trigger == Trigger::Failed)
		);
		assert!(MISSING_TARGET.contains("channelId"));
	}
}
