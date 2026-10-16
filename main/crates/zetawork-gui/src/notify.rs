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
//! 2. **状态栏留痕** — always available: the status bar shows `通知：<标题>` and
//!    clicking it goes to the workspace the notification was about.
//! 3. **IM 渠道** — `packages/channels`' WeChat / 飞书 / Telegram senders, called
//!    through their existing HTTP or CLI surface. Not called this round: it needs
//!    an endpoint read out of that package (listed in [`MESSAGING_SOURCES`]) and
//!    there is no HTTP client in this crate's dependency set. Recording the trace
//!    is what keeps this from being a dead end — the wording and the target are
//!    already in [`Trace`], so a sender only has to post it.
//!
//! Every step is additive: a route that is unavailable hands over to the next
//! one, and the trace always happens, so a notification is never silently lost.

use std::time::Instant;

use crate::settings::NotifyPolicy;

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

/// The `packages/channels` senders the IM fallback would use. Named here so the
/// report and the tooltip can point at the real surface without this crate
/// reaching into `packages/`.
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

	/// The payload an IM channel would post: the same fields, as JSON, so the
	/// sender in `packages/channels` has nothing to invent.
	pub fn payload(&self) -> String {
		format!(
			"{{\"trigger\":\"{}\",\"title\":{},\"body\":{},\"target\":{}}}",
			self.trigger.key(),
			json_string(&self.title),
			json_string(&self.body),
			match self.target.as_deref() {
				Some(id) => json_string(id),
				None => "null".to_owned(),
			}
		)
	}
}

/// A minimal JSON string encoder — enough for the payload above, and no
/// dependency for three fields.
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

/// How a notification actually went out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Delivery {
	/// The OS notification service took it.
	Os,
	/// The status bar's trace is carrying it (the OS route was unavailable).
	Trace,
}

impl Delivery {
	pub fn label(self) -> &'static str {
		match self {
			Self::Os => "系统通知",
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
/// Never fails: with the OS route unavailable this returns a
/// [`Delivery::Trace`] carrying the reason, so the shell always has something to
/// show.
pub fn emit(message: Message) -> Trace {
	match os_notify(&message) {
		Ok(()) => {
			Trace { message, delivery: Delivery::Os, detail: String::new(), at: Instant::now() }
		},
		Err(detail) => Trace { message, delivery: Delivery::Trace, detail, at: Instant::now() },
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
	text.push_str(&format!("\nIM 回落渠道（尚未接入）：{}", MESSAGING_SOURCES.join(" / ")));
	text
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

	fn message() -> Message {
		Message {
			trigger: Trigger::Idle,
			title: "会话 1 已空闲".to_owned(),
			body: "pane 2 的子进程都退出了".to_owned(),
			target: Some("ws-local".to_owned()),
		}
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
		// Without the `os-notify` feature (the default build) this is exactly
		// the fallback path: the trace carries it and says why.
		let trace = emit(message());
		assert_eq!(trace.message.trigger, Trigger::Idle);
		if trace.delivery == Delivery::Trace {
			assert!(!trace.detail.is_empty(), "falling back has to say why");
		}
		assert_eq!(trace.message.trace_line(), "通知：会话 1 已空闲");
		assert!(trace_hint(&trace).contains("WeChat"), "the IM fallback is named");
	}

	#[test]
	fn the_payload_carries_every_field() {
		let payload = message().payload();
		assert!(payload.contains("\"trigger\":\"idle\""));
		assert!(payload.contains("\"target\":\"ws-local\""));
		let bare = Message {
			trigger: Trigger::Failed,
			title: "x".to_owned(),
			body: "y".to_owned(),
			target: None,
		};
		assert!(bare.payload().contains("\"target\":null"));
	}

	#[test]
	fn json_strings_are_escaped() {
		assert_eq!(json_string("a\"b\\c"), "\"a\\\"b\\\\c\"");
		assert_eq!(json_string("行\n行"), "\"行\\n行\"");
	}

	#[test]
	fn the_missing_triggers_are_named() {
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
	}
}
