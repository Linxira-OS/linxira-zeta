// SPDX-License-Identifier: AGPL-3.0-only
//! The model behind 设置 → 远程访问.
//!
//! The gateway already owns this surface: `GET /api/web-config` returns
//! `~/.zeta/agent/web.yml` with the remote token masked, `PUT /api/web-config`
//! writes one dot path, `GET /api/remote/pairing` returns the pairing payload
//! and its QR SVG, and `POST /api/remote/token/{rotate,revoke}` mint or drop
//! tokens. This module is the GUI's port of those rules — no second file, no
//! second definition of a default.
//!
//! # Secrets
//!
//! `GET /api/web-config` never returns the token: a configured one comes back
//! as `••••`, which [`Display`] renders as [`SecretState`]'s word. The
//! pairing response does carry the token and a payload that embeds it; the
//! payload is kept only because the QR must encode it, never rendered as text,
//! and [`Pairing`]'s `Debug` redacts it. A rotate answer is the one time the
//! plaintext token exists in this process; the pane shows it once and drops it
//! on the next read.
//!
//! # Requests
//!
//! [`load`] reads the config and, separately, the pairing code: a 409 there
//! means "no token configured yet", which is a state the pane describes rather
//! than an error. Every write is `PUT` of one path, then a fresh [`load`].

use std::fmt;

use serde_json::{Value, json};

use crate::{channels::Transport, t};

/// `GET`/`PUT /api/web-config` — `~/.zeta/agent/web.yml`, secrets masked.
pub const CONFIG_PATH: &str = "/api/web-config";
/// `GET /api/remote/pairing` — `{url, token, payload, svg}`.
pub const PAIRING_PATH: &str = "/api/remote/pairing";
/// `POST /api/remote/token/rotate` — mint a new token, revoke the old one.
pub const ROTATE_PATH: &str = "/api/remote/token/rotate";
/// `POST /api/remote/token/revoke` — `{ all: true }` or `{ token }`.
pub const REVOKE_PATH: &str = "/api/remote/token/revoke";

/// Whether a token is stored, mirroring [`crate::channels::SecretState`]'s
/// two states without coupling the two panes.
pub use crate::channels::SecretState;

/// The pairing code a phone scans. `payload` embeds the token, so it is
/// deliberately not `Debug`-printed and has no accessor that turns it into a
/// user-visible string.
#[derive(Clone, PartialEq, Eq)]
pub struct Pairing {
	/// The URL the code points at (shown above the QR).
	pub url: String,
	/// The code's content — the only thing the QR encodes.
	pub payload: String,
}

impl fmt::Debug for Pairing {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.debug_struct("Pairing")
			.field("url", &self.url)
			.field("payload", &"<redacted>")
			.finish()
	}
}

/// One `GET /api/web-config` + `GET /api/remote/pairing` snapshot.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RemoteView {
	/// `remote.host` — the bind address; empty means serve's own default.
	pub host: String,
	/// `remote.publicUrl` — the base a phone reaches, never used for binding.
	pub public_url: String,
	/// `remote.tls.enabled`.
	pub tls_enabled: bool,
	/// `remote.tls.cert` — a PEM path, not a secret.
	pub tls_cert: String,
	/// `remote.tls.key` — a PEM path, not a secret (the file's contents are
	/// never read by the gateway or this pane).
	pub tls_key: String,
	/// `remote.allowPlainHttp` — the opt-in for a non-loopback HTTP bind.
	pub allow_plain_http: bool,
	/// `remote.token`, masked by the gateway.
	pub token: SecretState,
	/// `remote.tokenUpdatedAt`, informational.
	pub token_updated_at: Option<String>,
	/// The pairing code, `None` when no token is configured (a 409) or the
	/// route failed. `pairing_error` says which.
	pub pairing: Option<Pairing>,
	/// Why there is no pairing code, when the route answered but could not
	/// produce one.
	pub pairing_error: Option<String>,
}

impl RemoteView {
	/// Decode `GET /api/web-config`.
	pub fn decode(config: &str) -> Result<Self, String> {
		let value: Value =
			serde_json::from_str(config).map_err(|error| t!("web-config 不是 JSON：{}", error))?;
		let object = value
			.as_object()
			.ok_or_else(|| t!("web-config 的顶层不是对象").to_owned())?;
		let remote = object.get("remote").and_then(Value::as_object);
		let text = |key: &str| {
			remote
				.and_then(|remote| remote.get(key))
				.and_then(Value::as_str)
				.map(str::trim)
				.unwrap_or_default()
				.to_owned()
		};
		let tls = remote
			.and_then(|remote| remote.get("tls"))
			.and_then(Value::as_object);
		let tls_text = |key: &str| {
			tls.and_then(|tls| tls.get(key))
				.and_then(Value::as_str)
				.map(str::trim)
				.unwrap_or_default()
				.to_owned()
		};
		let updated = remote
			.and_then(|remote| remote.get("tokenUpdatedAt"))
			.and_then(Value::as_str)
			.filter(|value| !value.is_empty())
			.map(str::to_owned);
		Ok(Self {
			host: text("host"),
			public_url: text("publicUrl"),
			tls_enabled: tls
				.and_then(|tls| tls.get("enabled"))
				.and_then(Value::as_bool)
				.unwrap_or(false),
			tls_cert: tls_text("cert"),
			tls_key: tls_text("key"),
			allow_plain_http: remote
				.and_then(|remote| remote.get("allowPlainHttp"))
				.and_then(Value::as_bool)
				.unwrap_or(false),
			token: SecretState::parse(remote.and_then(|remote| remote.get("token"))),
			token_updated_at: updated,
			pairing: None,
			pairing_error: None,
		})
	}

	/// Attach a `GET /api/remote/pairing` answer. A body without a payload is
	/// reported in `pairing_error` instead of producing an empty QR.
	pub fn with_pairing(mut self, body: &str) -> Self {
		match decode_pairing(body) {
			Ok(pairing) => {
				self.pairing = Some(pairing);
				self.pairing_error = None;
			},
			Err(error) => {
				self.pairing = None;
				self.pairing_error = Some(error);
			},
		}
		self
	}

	/// `remote.host` as the row's value: an empty host is serve's default.
	pub fn host_label(&self) -> String {
		if self.host.is_empty() {
			t!("跟随 serve 默认（本机回环）").to_owned()
		} else {
			self.host.clone()
		}
	}

	/// The TLS state as a sentence, never a colour alone.
	pub fn tls_label(&self) -> &'static str {
		if self.tls_enabled {
			t!("已启用")
		} else {
			t!("未启用")
		}
	}

	/// The plain-HTTP state as a sentence.
	pub fn plain_label(&self) -> &'static str {
		if self.allow_plain_http {
			t!("允许（仅在明确知道风险时）")
		} else {
			t!("拒绝明文非回环访问")
		}
	}
}

/// Decode `GET /api/remote/pairing`. `token` is deliberately ignored: the
/// payload already carries it, and the pane has no reason to hold a second
/// copy of a plaintext secret.
pub fn decode_pairing(body: &str) -> Result<Pairing, String> {
	let value: Value =
		serde_json::from_str(body).map_err(|error| t!("配对码不是 JSON：{}", error))?;
	if let Some(error) = value.get("error").and_then(Value::as_str) {
		return Err(error.to_owned());
	}
	let payload = value
		.get("payload")
		.and_then(Value::as_str)
		.map(str::trim)
		.filter(|payload| !payload.is_empty())
		.ok_or_else(|| t!("配对码缺少 payload").to_owned())?;
	let url = value
		.get("url")
		.and_then(Value::as_str)
		.map(str::trim)
		.filter(|url| !url.is_empty())
		.unwrap_or_default();
	Ok(Pairing { url: url.to_owned(), payload: payload.to_owned() })
}

/// One dot path and the value to `PUT`.
pub type Change = (String, Value);

/// The changes a TLS edit commits: the three paths that belong together.
///
/// Kept as one constructor so a test asserts the exact wire paths, and so a
/// form cannot write `remote.tls.cert` without saying whether TLS is on.
pub fn tls_fields(enabled: bool, cert: &str, key: &str) -> Vec<Change> {
	vec![
		("remote.tls.enabled".to_owned(), json!(enabled)),
		("remote.tls.cert".to_owned(), json!(cert.trim())),
		("remote.tls.key".to_owned(), json!(key.trim())),
	]
}

/// The changes the bind row commits.
pub fn host_fields(host: &str, public_url: &str) -> Vec<Change> {
	vec![
		("remote.host".to_owned(), json!(host.trim())),
		("remote.publicUrl".to_owned(), json!(public_url.trim())),
	]
}

/// `GET` one route and require a 2xx answer.
fn get(transport: &dyn Transport, path: &str) -> Result<String, String> {
	let reply = transport.request("GET", path, None)?;
	if (200..300).contains(&reply.status) {
		Ok(reply.body)
	} else {
		Err(reply_error(&reply))
	}
}

/// `PUT` one dot path; a non-2xx answer becomes the gateway's own message.
fn put(transport: &dyn Transport, path: &str, value: &Value) -> Result<(), String> {
	let body = json!({ "path": path, "value": value }).to_string();
	let reply = transport.request("PUT", CONFIG_PATH, Some(&body))?;
	if (200..300).contains(&reply.status) {
		Ok(())
	} else {
		Err(reply_error(&reply))
	}
}

/// The gateway's `error` string, or its status.
fn reply_error(reply: &crate::channels::HttpReply) -> String {
	let detail = serde_json::from_str::<Value>(&reply.body)
		.ok()
		.and_then(|value| {
			value
				.get("error")
				.and_then(Value::as_str)
				.map(str::to_owned)
		})
		.unwrap_or_else(|| reply.body.trim().chars().take(160).collect());
	if detail.is_empty() {
		t!("网关返回 {}", reply.status).to_owned()
	} else {
		detail
	}
}

/// Read the whole pane: config, then the pairing code.
///
/// A pairing 409 is "no token configured", which is not an error for the
/// config reader; it becomes the pane's prompt to rotate one. Any other
/// failure is attached as `pairing_error` so the bind/TLS rows still draw.
pub fn load(transport: &dyn Transport) -> Result<RemoteView, String> {
	let view = RemoteView::decode(&get(transport, CONFIG_PATH)?)?;
	if view.token == SecretState::Unset {
		return Ok(view);
	}
	match transport.request("GET", PAIRING_PATH, None) {
		Ok(reply) if (200..300).contains(&reply.status) => Ok(view.with_pairing(&reply.body)),
		Ok(reply) => Ok(RemoteView { pairing_error: Some(reply_error(&reply)), ..view }),
		Err(error) => Ok(RemoteView { pairing_error: Some(error), ..view }),
	}
}

/// Write a form, then re-read the whole pane.
pub fn commit(transport: &dyn Transport, changes: &[Change]) -> Result<RemoteView, String> {
	for (path, value) in changes {
		put(transport, path, value)?;
	}
	load(transport)
}

/// Mint a new token. The returned string is the only plaintext copy; the
/// caller shows it once.
pub fn rotate(transport: &dyn Transport) -> Result<String, String> {
	let reply = transport.request("POST", ROTATE_PATH, Some("{}"))?;
	if !(200..300).contains(&reply.status) {
		return Err(reply_error(&reply));
	}
	let value: Value =
		serde_json::from_str(&reply.body).map_err(|error| t!("轮换应答不是 JSON：{}", error))?;
	value
		.get("token")
		.and_then(Value::as_str)
		.map(str::trim)
		.filter(|token| !token.is_empty())
		.map(str::to_owned)
		.ok_or_else(|| t!("轮换应答缺少 token").to_owned())
}

/// Revoke every token. Serve fails closed afterwards until a new one is
/// minted or configured.
pub fn revoke_all(transport: &dyn Transport) -> Result<RemoteView, String> {
	let reply = transport.request("POST", REVOKE_PATH, Some(r#"{"all":true}"#))?;
	if !(200..300).contains(&reply.status) {
		return Err(reply_error(&reply));
	}
	load(transport)
}

#[cfg(test)]
mod tests {
	use std::{cell::RefCell, collections::VecDeque};

	use super::*;
	use crate::channels::HttpReply;

	const CONFIG: &str = r#"{
		"remote": {
			"host": "0.0.0.0",
			"publicUrl": "https://zeta.example",
			"token": "••••",
			"tokenUpdatedAt": "2026-10-01T00:00:00.000Z",
			"allowPlainHttp": true,
			"tls": {"enabled": true, "cert": "C:/certs/cert.pem", "key": "C:/certs/key.pem"}
		}
	}"#;

	/// A transport that replays scripted answers and records each request.
	struct Stub {
		answers: RefCell<VecDeque<(u16, String)>>,
		requests: RefCell<Vec<(String, String, Option<String>)>>,
	}

	impl Stub {
		fn new(answers: &[(u16, &str)]) -> Self {
			Self {
				answers: RefCell::new(
					answers
						.iter()
						.map(|(status, body)| (*status, (*body).to_owned()))
						.collect(),
				),
				requests: RefCell::new(Vec::new()),
			}
		}
	}

	impl Transport for Stub {
		fn request(&self, method: &str, path: &str, body: Option<&str>) -> Result<HttpReply, String> {
			self.requests.borrow_mut().push((
				method.to_owned(),
				path.to_owned(),
				body.map(str::to_owned),
			));
			let (status, body) = self
				.answers
				.borrow_mut()
				.pop_front()
				.unwrap_or((500, "{}".to_owned()));
			Ok(HttpReply { status, body })
		}

		fn get_bytes(&self, _url: &str) -> Result<Vec<u8>, String> {
			Err("unused".to_owned())
		}
	}

	#[test]
	fn the_config_decodes_and_the_token_stays_masked() {
		let view = RemoteView::decode(CONFIG).expect("fixture parses");
		assert_eq!(view.host, "0.0.0.0");
		assert_eq!(view.public_url, "https://zeta.example");
		assert!(view.tls_enabled);
		assert_eq!(view.tls_cert, "C:/certs/cert.pem");
		assert_eq!(view.tls_key, "C:/certs/key.pem");
		assert!(view.allow_plain_http);
		assert_eq!(view.token, SecretState::Stored);
		assert_eq!(view.token_updated_at.as_deref(), Some("2026-10-01T00:00:00.000Z"));
		// Nothing the pane can print reveals the secret.
		assert!(!format!("{view:?}").contains("••••"), "the mask is state, not text");

		let empty = RemoteView::decode(r#"{"remote":{}}"#).expect("an empty remote block parses");
		assert_eq!(empty.token, SecretState::Unset);
		assert_eq!(empty.host_label(), "跟随 serve 默认（本机回环）");
		assert_eq!(empty.tls_label(), "未启用");
		assert!(RemoteView::decode("not json").is_err());
	}

	#[test]
	fn the_pairing_payload_is_kept_and_its_debug_redacts_it() {
		let body = r#"{"url":"https://zeta.example","token":"top-secret","payload":"zeta://pair?t=top-secret","svg":"<svg/>"}"#;
		let pairing = decode_pairing(body).expect("pairing parses");
		assert_eq!(pairing.url, "https://zeta.example");
		assert!(pairing.payload.contains("top-secret"));
		assert!(!format!("{pairing:?}").contains("top-secret"), "Debug must not leak the code");
		assert!(decode_pairing(r#"{"error":"No remote token is configured"}"#).is_err());
		assert!(decode_pairing(r#"{"url":"x"}"#).is_err());
	}

	#[test]
	fn form_paths_are_the_ones_web_yml_expects() {
		assert_eq!(
			tls_fields(true, " cert.pem ", "key.pem"),
			vec![
				("remote.tls.enabled".to_owned(), json!(true)),
				("remote.tls.cert".to_owned(), json!("cert.pem")),
				("remote.tls.key".to_owned(), json!("key.pem")),
			]
		);
		assert_eq!(
			host_fields("0.0.0.0", " https://zeta.example "),
			vec![
				("remote.host".to_owned(), json!("0.0.0.0")),
				("remote.publicUrl".to_owned(), json!("https://zeta.example")),
			]
		);
	}

	#[test]
	fn load_reads_the_config_and_the_pairing_code() {
		let pairing = r#"{"url":"https://zeta.example","token":"·","payload":"zeta://pair?t=x"}"#;
		let stub = Stub::new(&[(200, CONFIG), (200, pairing)]);
		let view = load(&stub).expect("load");
		assert!(view.pairing.is_some());
		let requests = stub.requests.borrow();
		assert_eq!(requests[0].0, "GET");
		assert_eq!(requests[0].1, CONFIG_PATH);
		assert_eq!(requests[1].1, PAIRING_PATH);
	}

	#[test]
	fn a_409_pairing_is_not_a_config_error() {
		let config = r#"{"remote":{}}"#;
		let stub = Stub::new(&[(200, config)]);
		let view = load(&stub).expect("load");
		assert_eq!(view.token, SecretState::Unset);
		assert!(view.pairing.is_none() && view.pairing_error.is_none(), "unset token skips pairing");
		assert_eq!(stub.requests.borrow().len(), 1);
	}

	#[test]
	fn rotate_returns_the_one_time_token_and_revoke_sends_all() {
		let stub = Stub::new(&[
			(200, r#"{"ok":true,"token":"new-token"}"#),
			(200, r#"{"ok":true,"activeTokenRevoked":true}"#),
			(200, r#"{"remote":{}}"#),
		]);
		let token = rotate(&stub).expect("rotate");
		assert_eq!(token, "new-token");
		assert_eq!(stub.requests.borrow()[0].1, ROTATE_PATH);
		assert_eq!(stub.requests.borrow()[0].0, "POST");

		let view = revoke_all(&stub).expect("revoke");
		assert_eq!(view.token, SecretState::Unset);
		let requests = stub.requests.borrow();
		assert_eq!(requests[1].1, REVOKE_PATH);
		assert_eq!(requests[1].2.as_deref(), Some(r#"{"all":true}"#));
		assert_eq!(requests[2].1, CONFIG_PATH, "revoke re-reads the view");
	}

	#[test]
	fn a_write_failure_carries_the_gateway_error() {
		let stub = Stub::new(&[(400, r#"{"error":"Unknown web config path: remote.host"}"#)]);
		let error = commit(&stub, &host_fields("0.0.0.0", "")).expect_err("a 400 is an error");
		assert!(error.contains("Unknown web config path"), "{error}");
		let requests = stub.requests.borrow();
		assert_eq!(requests[0].0, "PUT");
		assert_eq!(requests[0].1, CONFIG_PATH);
		let body: Value = serde_json::from_str(requests[0].2.as_deref().unwrap()).unwrap();
		assert_eq!(body["path"], "remote.host");
		assert_eq!(body["value"], "0.0.0.0");
	}
}
