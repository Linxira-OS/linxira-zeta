// SPDX-License-Identifier: AGPL-3.0-only
//! IM 渠道: the state behind the 设置 modal's fourth remote target.
//!
//! The web desktop already edits this surface (`web-ui/components/settings/
//! shared.tsx`); this module is the GUI's port of its behaviour, not a second
//! design:
//!
//! * `GET /api/channels/status` → `{channels:[{id,running}]}` tells which
//!   runtime exists in the `zetacode serve` process;
//! * `GET /api/web-config` → the same `~/.zeta/agent/web.yml` the web UI reads,
//!   with secrets masked as `••••`;
//! * `PUT /api/web-config` → `{path, value}` writes one dot path, exactly like
//!   the web UI's `onCommit`;
//! * `GET /api/channels/wechat/qrcode` → the pending WeChat QR payload polled
//!   every two seconds while the channel is enabled;
//! * `POST /api/channels/wechat/{reconnect,unbind}` → the two session actions;
//! * `POST /api/channels/send` → the one IM write entry, with the three failure
//!   kinds the gateway already distinguishes.
//!
//! # Why a trait
//!
//! One loopback HTTP client is all this crate needs, and it already has
//! hand-rolled ones ([`crate::usage::api`], [`crate::notify`]). The `Transport`
//! trait keeps every model rule (status mapping, QR lifecycle, masked secrets,
//! workspace/binding edits) testable without a socket; [`HttpTransport`] is the
//! only production implementation.
//!
//! # The QR
//!
//! `qrcodeUrl` is either a direct image (`data:image/…` or a `.png`-style URL)
//! or a page URL the scanner has to visit (`liteapp.weixin.qq.com/…`). The web
//! UI renders the former as `<img>` and falls back to an external QR service
//! for the latter. Here the fallback is local: [`qrcodegen`] encodes the URL,
//! so the GUI never asks a third-party service to render a login code.

use std::{
	io::{Read, Write},
	net::ToSocketAddrs as _,
	path::Path,
	time::Duration,
};

use serde_json::{Value, json};

use crate::t;

/// `GET /api/channels/status` — which runtimes exist in `zetacode serve`.
pub const STATUS_PATH: &str = "/api/channels/status";
/// `GET /api/channels/wechat/qrcode` — the pending QR, polled while enabled.
pub const QR_PATH: &str = "/api/channels/wechat/qrcode";
/// `POST /api/channels/wechat/reconnect` — start a fresh QR login.
pub const RECONNECT_PATH: &str = "/api/channels/wechat/reconnect";
/// `POST /api/channels/wechat/unbind` — clear credentials and peer bindings.
pub const UNBIND_PATH: &str = "/api/channels/wechat/unbind";
/// `POST /api/channels/send` — the IM write entry.
pub const SEND_PATH: &str = "/api/channels/send";
/// `GET`/`PUT /api/web-config` — `~/.zeta/agent/web.yml`, secrets masked.
pub const CONFIG_PATH: &str = "/api/web-config";
/// `POST /api/channels/credentials` — validate, then save, a pasted credential.
pub const CREDENTIALS_PATH: &str = "/api/channels/credentials";

/// How long one loopback request may take. The gateway answers these routes
/// in-process; the same 3 s budget keeps a wedged listener from freezing the
/// worker for long.
const TIMEOUT: Duration = Duration::from_secs(3);

/// One of the three messaging channels.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ChannelId {
	Wechat,
	Feishu,
	Telegram,
}

impl ChannelId {
	pub const ALL: [Self; 3] = [Self::Wechat, Self::Feishu, Self::Telegram];

	/// The gateway's `channelId` (`ChannelId` in `packages/channels`).
	pub fn key(self) -> &'static str {
		match self {
			Self::Wechat => "wechat",
			Self::Feishu => "feishu",
			Self::Telegram => "telegram",
		}
	}

	/// The name the user knows it by.
	pub fn label(self) -> &'static str {
		match self {
			Self::Wechat => t!("微信"),
			Self::Feishu => t!("飞书"),
			Self::Telegram => "Telegram",
		}
	}

	/// The index in [`Self::ALL`] and in [`View`]'s arrays.
	pub fn index(self) -> usize {
		match self {
			Self::Wechat => 0,
			Self::Feishu => 1,
			Self::Telegram => 2,
		}
	}

	pub fn from_key(key: &str) -> Option<Self> {
		Self::ALL.into_iter().find(|channel| channel.key() == key)
	}

	/// The `web.yml` path prefix for this channel's own settings.
	pub fn config_prefix(self) -> String {
		format!("channels.{}", self.key())
	}
}

/// One channel's runtime state, as far as the gateway can tell us.
///
/// `/api/channels/status` only reports `running`. A channel that the config
/// enables but the status list omits is not "stopped" — the runtime failed to
/// start (usually a missing credential), so it is surfaced as an error rather
/// than hidden behind a stopped switch.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Runtime {
	Running,
	#[default]
	Stopped,
	Error(String),
}

impl Runtime {
	/// The text the row shows. Never colour alone: the state is a word.
	pub fn label(&self) -> String {
		match self {
			Self::Running => t!("运行中").to_owned(),
			Self::Stopped => t!("已停止").to_owned(),
			Self::Error(why) => t!("错误：{}", why),
		}
	}

	pub fn is_running(&self) -> bool {
		matches!(self, Self::Running)
	}
}

/// Whether a masked secret is stored.
///
/// `GET /api/web-config` never reveals a secret: a non-empty value comes back
/// as `••••`. The GUI therefore only needs the two states, and its draft for a
/// secret starts empty ("leave blank to keep") so the real value never passes
/// through a widget.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SecretState {
	#[default]
	Unset,
	Stored,
}

impl SecretState {
	pub fn parse(value: Option<&Value>) -> Self {
		match value.and_then(Value::as_str) {
			Some(text) if !text.trim().is_empty() => Self::Stored,
			_ => Self::Unset,
		}
	}

	/// The placeholder a secret field shows.
	pub fn label(self) -> &'static str {
		match self {
			Self::Unset => t!("未设置"),
			Self::Stored => t!("已保存（留空则不修改）"),
		}
	}
}

/// One channel's slice of `~/.zeta/agent/web.yml`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChannelConfig {
	pub enabled: bool,
	/// Absolute default directory for this channel's messages; empty = the
	/// coordinator session.
	pub workspace_root: String,
	pub app_id: String,
	pub app_secret: SecretState,
	pub bot_token: SecretState,
	/// `feishu` or `lark`; only Feishu reads it.
	pub domain: String,
}

impl Default for ChannelConfig {
	fn default() -> Self {
		Self {
			enabled: false,
			workspace_root: String::new(),
			app_id: String::new(),
			app_secret: SecretState::Unset,
			bot_token: SecretState::Unset,
			domain: "feishu".to_owned(),
		}
	}
}

impl ChannelConfig {
	fn parse(value: Option<&Value>) -> Self {
		let Some(object) = value.and_then(Value::as_object) else {
			return Self::default();
		};
		let text = |key: &str| {
			object
				.get(key)
				.and_then(Value::as_str)
				.map(str::trim)
				.unwrap_or_default()
				.to_owned()
		};
		let domain = match text("domain").as_str() {
			"lark" => "lark",
			_ => "feishu",
		};
		Self {
			enabled: object
				.get("enabled")
				.and_then(Value::as_bool)
				.unwrap_or(false),
			workspace_root: text("workspaceRoot"),
			app_id: text("appId"),
			app_secret: SecretState::parse(object.get("appSecret")),
			bot_token: SecretState::parse(object.get("botToken")),
			domain: domain.to_owned(),
		}
	}
}

/// The bot identity a platform reported after validating a credential.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CredentialIdentity {
	pub id: String,
	pub name: String,
	/// Telegram `@username`, without the `@`.
	pub username: Option<String>,
}

impl CredentialIdentity {
	fn parse(value: Option<&Value>) -> Self {
		let text = |key: &str| {
			value
				.and_then(|object| object.get(key))
				.and_then(Value::as_str)
				.map(str::trim)
				.unwrap_or_default()
				.to_owned()
		};
		let username = text("username");
		Self {
			id: text("id"),
			name: text("name"),
			username: (!username.is_empty()).then_some(username),
		}
	}

	/// The identity line the pane shows; it never contains a secret.
	pub fn label(&self) -> String {
		let name = if self.name.is_empty() { &self.id } else { &self.name };
		match &self.username {
			Some(username) => format!("{name} (@{username})"),
			None if !self.id.is_empty() && self.id != *name => format!("{name} ({})", self.id),
			None => name.clone(),
		}
	}
}

/// The credential form's state machine: empty → validating → saved/failed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CredentialStage {
	#[default]
	Empty,
	Validating,
	Saved,
	Failed,
}

/// What one channel's credential form is doing, in words.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CredentialForm {
	pub stage: CredentialStage,
	pub identity: Option<CredentialIdentity>,
	pub error: Option<String>,
}

impl CredentialForm {
	/// A second click while the platform is being asked must not start a
	/// second validation.
	pub fn can_submit(&self) -> bool {
		self.stage != CredentialStage::Validating
	}

	pub fn begin(&mut self) {
		self.stage = CredentialStage::Validating;
		self.identity = None;
		self.error = None;
	}

	pub fn saved(&mut self, identity: CredentialIdentity) {
		self.stage = CredentialStage::Saved;
		self.identity = Some(identity);
		self.error = None;
	}

	pub fn failed(&mut self, error: impl Into<String>) {
		self.stage = CredentialStage::Failed;
		self.identity = None;
		self.error = Some(error.into());
	}

	pub fn reset(&mut self) {
		*self = Self::default();
	}

	/// The one line under the form: the state word, plus identity or reason.
	pub fn line(&self) -> String {
		match self.stage {
			CredentialStage::Empty => t!("未验证").to_owned(),
			CredentialStage::Validating => t!("验证中…").to_owned(),
			CredentialStage::Saved => match &self.identity {
				Some(identity) => t!("已验证：{}", identity.label()),
				None => t!("已验证").to_owned(),
			},
			CredentialStage::Failed => match &self.error {
				Some(error) => t!("验证失败：{}", error),
				None => t!("验证失败").to_owned(),
			},
		}
	}
}

/// The WeChat QR-login lifecycle.
///
/// `pending` payloads carry `status: "wait" | "scaned" | "confirmed" |
/// "expired"`; a `{pending:false}` answer means there is no login in progress.
/// Unbind is the GUI's own edge — it clears the QR and stays visible until the
/// next pending payload, so "已解绑" does not disappear on the next poll.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum QrStage {
	#[default]
	Idle,
	Pending,
	Scanned,
	Connected,
	Expired,
	Unbound,
}

impl QrStage {
	pub fn label(self) -> &'static str {
		match self {
			Self::Idle => t!("未开始"),
			Self::Pending => t!("待扫码"),
			Self::Scanned => t!("已扫码，请在手机上确认"),
			Self::Connected => t!("已连接"),
			Self::Expired => t!("二维码已过期，请重新连接"),
			Self::Unbound => t!("已解绑"),
		}
	}
}

/// One `/api/channels/wechat/qrcode` answer.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct QrPayload {
	pub pending: bool,
	pub qrcode_url: Option<String>,
	pub status: String,
}

/// The QR login state kept between polls.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct QrState {
	pub stage: QrStage,
	pub url: Option<String>,
}

impl QrState {
	/// Apply one gateway payload.
	pub fn apply(&mut self, payload: &QrPayload) {
		if !payload.pending {
			// "已解绑" is a user action, not a poll result: keep it until the
			// gateway starts a new login.
			if self.stage == QrStage::Unbound {
				self.url = None;
				return;
			}
			self.stage = QrStage::Idle;
			self.url = None;
			return;
		}
		self.url = payload
			.qrcode_url
			.clone()
			.filter(|url| !url.trim().is_empty());
		self.stage = match payload.status.as_str() {
			"confirmed" => QrStage::Connected,
			"scaned" => QrStage::Scanned,
			"expired" => QrStage::Expired,
			_ => QrStage::Pending,
		};
	}

	/// 重新连接 was pressed: a fresh QR is on its way.
	pub fn reconnect_requested(&mut self) {
		self.stage = QrStage::Pending;
		self.url = None;
	}

	/// 解绑 was pressed, or the gateway confirmed it.
	pub fn unbind(&mut self) {
		self.stage = QrStage::Unbound;
		self.url = None;
	}
}

/// One `remote.workspaces` entry (alias → absolute directory).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Workspace {
	pub alias: String,
	pub path: String,
}

/// One `remote.sessionMappings` entry: a chat routed to a workspace alias.
///
/// `raw` keeps every field the GUI does not edit (`sessionId`, `lang`, `mode`,
/// `connectionId`, `chatType`, …) so rewriting the array for one alias edit
/// cannot silently erase the router's own state.
#[derive(Clone, Debug, PartialEq)]
pub struct Binding {
	pub platform: ChannelId,
	pub chat_id: String,
	pub user_id: Option<String>,
	pub workspace_alias: String,
	pub raw: Value,
}

impl Binding {
	/// The peer text the row shows: the chat id plus the optional user id.
	pub fn peer_label(&self) -> String {
		match self.user_id.as_deref() {
			Some(user) if !user.is_empty() => format!("{} · {user}", self.chat_id),
			_ => self.chat_id.clone(),
		}
	}
}

/// Everything the 设置 pane draws, from three GETs.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct View {
	pub channels: [ChannelConfig; 3],
	pub runtime: [Runtime; 3],
	pub workspaces: Vec<Workspace>,
	pub bindings: Vec<Binding>,
	pub qr: QrState,
}

impl View {
	pub fn channel(&self, id: ChannelId) -> &ChannelConfig {
		&self.channels[id.index()]
	}

	pub fn runtime(&self, id: ChannelId) -> &Runtime {
		&self.runtime[id.index()]
	}

	/// The WeChat row's stage: the QR payload wins; with no login pending, a
	/// stored bot token means the account is already linked.
	pub fn wechat_stage(&self) -> QrStage {
		match self.qr.stage {
			QrStage::Idle if self.channel(ChannelId::Wechat).bot_token == SecretState::Stored => {
				QrStage::Connected
			},
			stage => stage,
		}
	}
}

/// The HTTP answers the model needs, abstracted for the tests.
pub trait Transport {
	/// One request; `body` is already JSON-encoded. Non-2xx answers are
	/// returned, not turned into errors — the caller maps the status.
	fn request(&self, method: &str, path: &str, body: Option<&str>) -> Result<HttpReply, String>;
	/// `GET` an absolute `http://` image URL (a QR image).
	fn get_bytes(&self, url: &str) -> Result<Vec<u8>, String>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HttpReply {
	pub status: u16,
	pub body: String,
}

/// The real transport: one loopback origin, hand-rolled HTTP/1.1.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HttpTransport {
	origin: String,
}

impl HttpTransport {
	/// `origin` must be a plain `http://` loopback URL with an explicit port.
	/// Everything else is refused before a socket opens (no TLS client here).
	pub fn new(origin: &str) -> Result<Self, String> {
		endpoint(origin)?;
		Ok(Self { origin: origin.trim_end_matches('/').to_owned() })
	}
}

impl Transport for HttpTransport {
	fn request(&self, method: &str, path: &str, body: Option<&str>) -> Result<HttpReply, String> {
		if !path.starts_with('/') {
			return Err(t!("{} 不是以 / 开头的路径", path));
		}
		let (host, port, authority) = endpoint(&self.origin)?;
		let mut request = format!(
			"{method} {path} HTTP/1.1\r\nHost: {authority}\r\nAccept: application/json\r\nConnection: close\r\n"
		);
		match body {
			Some(body) => {
				request.push_str("Content-Type: application/json\r\n");
				request.push_str(&format!("Content-Length: {}\r\n\r\n", body.len()));
				request.push_str(body);
			},
			None => request.push_str("\r\n"),
		}
		let bytes = exchange(&host, port, request.as_bytes())?;
		let (status, body) = split_response(&bytes);
		Ok(HttpReply { status, body: String::from_utf8_lossy(&body).into_owned() })
	}

	fn get_bytes(&self, url: &str) -> Result<Vec<u8>, String> {
		let (host, port, authority, path) = absolute_http(url)?;
		let request = format!(
			"GET {path} HTTP/1.1\r\nHost: {authority}\r\nAccept: image/*\r\nConnection: close\r\n\r\n"
		);
		let bytes = exchange(&host, port, request.as_bytes())?;
		let (status, body) = split_response(&bytes);
		if status != 200 {
			return Err(t!("二维码图片返回 HTTP {}", status));
		}
		Ok(body)
	}
}

/// Parse the three read routes into one [`View`]. `qr` is optional: a failed
/// QR poll must not blank the rest of the pane.
pub fn decode_view(status: &str, config: &str, qr: Option<&str>) -> Result<View, String> {
	let running = parse_running(status)?;

	let config: Value =
		serde_json::from_str(config).map_err(|error| t!("web-config 不是 JSON：{}", error))?;
	let config = config
		.as_object()
		.ok_or_else(|| t!("web-config 的顶层不是对象").to_owned())?;
	let channel_objects = config.get("channels").and_then(Value::as_object);
	let channels: [ChannelConfig; 3] = std::array::from_fn(|index| {
		let id = ChannelId::ALL[index];
		ChannelConfig::parse(channel_objects.and_then(|object| object.get(id.key())))
	});
	let runtime = map_runtime(&running, &channels);

	let remote = config.get("remote").and_then(Value::as_object);
	let workspaces = decode_workspaces(remote.and_then(|remote| remote.get("workspaces")));
	let bindings = decode_bindings(remote.and_then(|remote| remote.get("sessionMappings")));
	let mut qr_state = QrState::default();
	if let Some(body) = qr {
		if let Ok(payload) = decode_qr(body) {
			qr_state.apply(&payload);
		}
	}
	Ok(View { channels, runtime, workspaces, bindings, qr: qr_state })
}

/// Which channels the status body reports running (`None` = not listed).
fn parse_running(status: &str) -> Result<[Option<bool>; 3], String> {
	let status: Value =
		serde_json::from_str(status).map_err(|error| t!("status 不是 JSON：{}", error))?;
	let status = status
		.as_object()
		.ok_or_else(|| t!("status 的顶层不是对象").to_owned())?;
	let mut running = [None::<bool>; 3];
	if let Some(entries) = status.get("channels").and_then(Value::as_array) {
		for entry in entries {
			let Some(object) = entry.as_object() else {
				continue;
			};
			let Some(id) = object
				.get("id")
				.and_then(Value::as_str)
				.and_then(ChannelId::from_key)
			else {
				continue;
			};
			running[id.index()] = object.get("running").and_then(Value::as_bool);
		}
	}
	Ok(running)
}

/// `running` + the config's `enabled` → the row's [`Runtime`].
fn map_runtime(running: &[Option<bool>; 3], channels: &[ChannelConfig; 3]) -> [Runtime; 3] {
	std::array::from_fn(|index| match running[index] {
		Some(true) => Runtime::Running,
		Some(false) => Runtime::Stopped,
		None if channels[index].enabled => {
			Runtime::Error(t!("已启用，但网关没有这个渠道的运行时").to_owned())
		},
		None => Runtime::Stopped,
	})
}

/// `remote.workspaces`: current `{alias,path}` objects and legacy bare paths.
fn decode_workspaces(value: Option<&Value>) -> Vec<Workspace> {
	let Some(entries) = value.and_then(Value::as_array) else {
		return Vec::new();
	};
	entries
		.iter()
		.filter_map(|entry| match entry {
			Value::String(path) => {
				let path = path.trim();
				if path.is_empty() {
					return None;
				}
				Some(Workspace { alias: basename(path), path: path.to_owned() })
			},
			Value::Object(object) => {
				let path = object.get("path").and_then(Value::as_str)?.trim();
				if path.is_empty() {
					return None;
				}
				let alias = object
					.get("alias")
					.and_then(Value::as_str)
					.map(str::trim)
					.filter(|alias| !alias.is_empty())
					.map(str::to_owned)
					.unwrap_or_else(|| basename(path));
				Some(Workspace { alias, path: path.to_owned() })
			},
			_ => None,
		})
		.collect()
}

/// `remote.sessionMappings`: only the three channel platforms; other platforms
/// are not this pane's business and stay in the file.
fn decode_bindings(value: Option<&Value>) -> Vec<Binding> {
	let Some(entries) = value.and_then(Value::as_array) else {
		return Vec::new();
	};
	entries
		.iter()
		.filter_map(|entry| {
			let object = entry.as_object()?;
			let platform = object
				.get("platform")
				.and_then(Value::as_str)
				.and_then(ChannelId::from_key)?;
			let chat_id = object.get("chatId").and_then(Value::as_str)?.trim();
			let workspace_alias = object.get("workspaceAlias").and_then(Value::as_str)?.trim();
			if chat_id.is_empty() || workspace_alias.is_empty() {
				return None;
			}
			let user_id = object
				.get("userId")
				.and_then(Value::as_str)
				.map(str::to_owned)
				.filter(|user| !user.is_empty());
			Some(Binding {
				platform,
				chat_id: chat_id.to_owned(),
				user_id,
				workspace_alias: workspace_alias.to_owned(),
				raw: entry.clone(),
			})
		})
		.collect()
}

/// One `/api/channels/wechat/qrcode` body.
pub fn decode_qr(body: &str) -> Result<QrPayload, String> {
	let value: Value =
		serde_json::from_str(body).map_err(|error| t!("二维码应答不是 JSON：{}", error))?;
	let object = value
		.as_object()
		.ok_or_else(|| t!("二维码应答的顶层不是对象").to_owned())?;
	Ok(QrPayload {
		pending: object
			.get("pending")
			.and_then(Value::as_bool)
			.unwrap_or(false),
		qrcode_url: object
			.get("qrcodeUrl")
			.and_then(Value::as_str)
			.map(str::to_owned)
			.filter(|url| !url.trim().is_empty()),
		status: object
			.get("status")
			.and_then(Value::as_str)
			.unwrap_or_default()
			.to_owned(),
	})
}

/// The full read: status + config + the optional QR payload.
pub fn load(transport: &dyn Transport) -> Result<View, String> {
	let status = transport.request("GET", STATUS_PATH, None)?;
	ensure_ok(&status)?;
	let config = transport.request("GET", CONFIG_PATH, None)?;
	ensure_ok(&config)?;
	let qr = transport
		.request("GET", QR_PATH, None)
		.ok()
		.filter(|reply| reply.status == 200)
		.map(|reply| reply.body);
	decode_view(&status.body, &config.body, qr.as_deref())
}

/// The two-second poll: status + QR only, merged into the existing config.
///
/// The web UI polls only `/api/channels/wechat/qrcode`; reading the status in
/// the same round keeps "运行中 / 已停止" honest after a toggle without
/// re-reading credentials the user may be editing.
pub fn refresh_live(transport: &dyn Transport, view: &mut View) -> Result<(), String> {
	let status = transport.request("GET", STATUS_PATH, None)?;
	ensure_ok(&status)?;
	let running = parse_running(&status.body)?;
	view.runtime = map_runtime(&running, &view.channels);
	if let Ok(reply) = transport.request("GET", QR_PATH, None) {
		if reply.status == 200 {
			if let Ok(payload) = decode_qr(&reply.body) {
				view.qr.apply(&payload);
			}
		}
	}
	Ok(())
}

/// `PUT` one dot path, then re-read the whole config.
///
/// The route answers `{ok:true}` (not the new config), so "refresh from the
/// response" is a second `GET` — the same commit path the web UI takes.
pub fn commit(transport: &dyn Transport, path: &str, value: Value) -> Result<View, String> {
	commit_many(transport, &[(path.to_owned(), value)])
}

/// Several paths in order (a credential form's fields), one re-read at the end.
///
/// If one write fails the earlier ones stay written — the gateway has already
/// applied them — but the view is not refreshed, so the row keeps its draft
/// and the error is visible instead of pretending nothing happened.
pub fn commit_many(transport: &dyn Transport, fields: &[(String, Value)]) -> Result<View, String> {
	for (path, value) in fields {
		let body = json!({ "path": path, "value": value }).to_string();
		let reply = transport.request("PUT", CONFIG_PATH, Some(&body))?;
		ensure_ok(&reply)?;
	}
	load(transport)
}

/// The value a workspace list writes: `{alias, path}` objects.
pub fn workspaces_value(entries: &[Workspace]) -> Value {
	Value::Array(
		entries
			.iter()
			.map(|entry| json!({ "alias": entry.alias, "path": entry.path }))
			.collect(),
	)
}

/// The value a binding list writes, preserving every field the GUI did not
/// edit. `workspaceAlias` is the one field this pane owns.
pub fn bindings_value(entries: &[Binding]) -> Value {
	Value::Array(
		entries
			.iter()
			.map(|entry| {
				let mut object = entry.raw.as_object().cloned().unwrap_or_default();
				object.insert("platform".to_owned(), Value::String(entry.platform.key().to_owned()));
				object.insert("chatId".to_owned(), Value::String(entry.chat_id.clone()));
				object
					.insert("workspaceAlias".to_owned(), Value::String(entry.workspace_alias.clone()));
				Value::Object(object)
			})
			.collect(),
	)
}

/// Register (or retarget) one alias. Mirrors `WebConfig.setWorkspaceEntry`.
pub fn upsert_workspace(
	entries: &[Workspace],
	alias: &str,
	path: &str,
) -> Result<Vec<Workspace>, String> {
	let alias = alias.trim();
	let path = path.trim();
	if alias.is_empty() {
		return Err(t!("别名不能为空").to_owned());
	}
	if alias == "main" {
		return Err(t!("“main” 是协调会话的保留别名").to_owned());
	}
	if !Path::new(path).is_absolute() {
		return Err(t!("目录必须是绝对路径").to_owned());
	}
	if let Some(existing) = entries.iter().find(|entry| entry.alias == alias) {
		if existing.path != path {
			return Err(t!("别名 {} 已绑定到 {}", alias, existing.path));
		}
	}
	let mut next: Vec<Workspace> = entries
		.iter()
		.filter(|entry| entry.alias != alias)
		.cloned()
		.collect();
	next.push(Workspace { alias: alias.to_owned(), path: path.to_owned() });
	Ok(next)
}

/// Drop one alias. Returns the new list, or the same list when absent.
pub fn remove_workspace(entries: &[Workspace], alias: &str) -> Vec<Workspace> {
	entries
		.iter()
		.filter(|entry| entry.alias != alias)
		.cloned()
		.collect()
}

/// Rewrite the entry at `index` (an alias rename and/or a new directory).
///
/// Unlike [`upsert_workspace`] — the add path, which keeps
/// `setWorkspaceEntry`'s "an alias is bound to one directory" rule — this is
/// the GUI's edit row and owns the whole array, so retargeting is allowed. The
/// same validation still applies: non-empty alias, absolute directory, no
/// `main`, and no collision with another row.
pub fn replace_workspace(
	entries: &[Workspace],
	index: usize,
	alias: &str,
	path: &str,
) -> Result<Vec<Workspace>, String> {
	let alias = alias.trim();
	let path = path.trim();
	if alias.is_empty() {
		return Err(t!("别名不能为空").to_owned());
	}
	if alias == "main" {
		return Err(t!("“main” 是协调会话的保留别名").to_owned());
	}
	if !Path::new(path).is_absolute() {
		return Err(t!("目录必须是绝对路径").to_owned());
	}
	if index >= entries.len() {
		return Err(t!("工作区行不存在").to_owned());
	}
	if let Some((_, existing)) = entries
		.iter()
		.enumerate()
		.find(|(at, entry)| *at != index && entry.alias == alias)
	{
		return Err(t!("别名 {} 已绑定到 {}", alias, existing.path));
	}
	let mut next = entries.to_vec();
	next[index] = Workspace { alias: alias.to_owned(), path: path.to_owned() };
	Ok(next)
}

/// Bind one chat to an alias. The alias must exist (or be `main`, the relay
/// coordinator), so a typo cannot create a binding that routes nowhere.
pub fn add_binding(
	view: &View,
	platform: ChannelId,
	chat_id: &str,
	user_id: Option<&str>,
	workspace_alias: &str,
) -> Result<Vec<Binding>, String> {
	let chat_id = chat_id.trim();
	let workspace_alias = workspace_alias.trim();
	if chat_id.is_empty() {
		return Err(t!("对端不能为空").to_owned());
	}
	if workspace_alias.is_empty() {
		return Err(t!("别名不能为空").to_owned());
	}
	if workspace_alias != "main"
		&& !view
			.workspaces
			.iter()
			.any(|entry| entry.alias == workspace_alias)
	{
		return Err(t!("工作区别名不存在：{}", workspace_alias));
	}
	let user_id = user_id
		.map(str::trim)
		.filter(|user| !user.is_empty())
		.map(str::to_owned);
	let mut next: Vec<Binding> = view
		.bindings
		.iter()
		.filter(|binding| {
			!(binding.platform == platform && binding.chat_id == chat_id && binding.user_id == user_id)
		})
		.cloned()
		.collect();
	let mut object = serde_json::Map::new();
	object.insert("platform".to_owned(), Value::String(platform.key().to_owned()));
	object.insert("chatId".to_owned(), Value::String(chat_id.to_owned()));
	if let Some(user) = &user_id {
		object.insert("userId".to_owned(), Value::String(user.clone()));
	}
	object.insert("workspaceAlias".to_owned(), Value::String(workspace_alias.to_owned()));
	next.push(Binding {
		platform,
		chat_id: chat_id.to_owned(),
		user_id,
		workspace_alias: workspace_alias.to_owned(),
		raw: Value::Object(object),
	});
	Ok(next)
}

/// Remove one binding by its identity (`platform`, `chatId`, `userId`).
pub fn remove_binding(
	view: &View,
	platform: ChannelId,
	chat_id: &str,
	user_id: Option<&str>,
) -> Vec<Binding> {
	view
		.bindings
		.iter()
		.filter(|binding| {
			!(binding.platform == platform
				&& binding.chat_id == chat_id
				&& binding.user_id.as_deref() == user_id)
		})
		.cloned()
		.collect()
}

/// Why a `POST /api/channels/send` did not go out, in the gateway's terms.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SendFailure {
	/// 404 — no such channel is running in this process.
	UnknownChannel,
	/// 400 — the channel is running but has no binding for that peer.
	Unpaired,
	/// 500 — the platform reached and refused it.
	Failed,
}

impl SendFailure {
	pub fn label(self) -> &'static str {
		match self {
			Self::UnknownChannel => t!("没有这个渠道（unknown-channel）"),
			Self::Unpaired => t!("未配对（unpaired），请先让对方给机器人发一条消息"),
			Self::Failed => t!("发送失败（failed）"),
		}
	}

	/// The mapping the route's status table fixes.
	fn from_status(status: u16) -> Self {
		match status {
			404 => Self::UnknownChannel,
			400 => Self::Unpaired,
			_ => Self::Failed,
		}
	}
}

/// One send result: the receipt line, or the failure and the gateway's text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SendOutcome {
	pub failure: Option<SendFailure>,
	pub detail: String,
}

impl SendOutcome {
	pub fn is_ok(&self) -> bool {
		self.failure.is_none()
	}

	/// One line for the pane.
	pub fn line(&self) -> String {
		match self.failure {
			None => t!("已发送：{}", self.detail),
			Some(kind) => format!("{}：{}", kind.label(), self.detail),
		}
	}
}

/// `POST /api/channels/send`, with the route's documented failure kinds.
pub fn send(transport: &dyn Transport, channel: ChannelId, peer: &str, text: &str) -> SendOutcome {
	let peer = peer.trim();
	let text = text.trim();
	if peer.is_empty() {
		return SendOutcome {
			failure: Some(SendFailure::Failed),
			detail: t!("对端不能为空").to_owned(),
		};
	}
	if text.is_empty() {
		return SendOutcome {
			failure: Some(SendFailure::Failed),
			detail: t!("消息不能为空").to_owned(),
		};
	}
	let body = json!({
		"channelId": channel.key(),
		"to": peer,
		"text": text,
	})
	.to_string();
	match transport.request("POST", SEND_PATH, Some(&body)) {
		Ok(reply) if reply.status == 200 => {
			let receipt = serde_json::from_str::<Value>(&reply.body)
				.ok()
				.and_then(|value| {
					let receipt = value.get("receipt")?;
					let to = receipt.get("to")?.as_str()?;
					let length = receipt.get("textLength")?.as_u64()?;
					Some(format!("{to} · {length} 字符"))
				})
				.unwrap_or_else(|| t!("网关已接收").to_owned());
			SendOutcome { failure: None, detail: receipt }
		},
		Ok(reply) => SendOutcome {
			failure: Some(SendFailure::from_status(reply.status)),
			detail: reply_error(&reply),
		},
		Err(error) => SendOutcome { failure: Some(SendFailure::Failed), detail: error },
	}
}

/// `POST /api/channels/credentials`: the gateway asks the platform, saves the
/// credential only when the platform accepted it, and answers the bot identity.
///
/// `fields` are the form's non-empty drafts keyed by the gateway's body names
/// (`appId`, `appSecret`, `domain`, `botToken`). Omitted fields fall back to the
/// stored credential, so a blank secret re-validates instead of erasing.
pub fn validate_credentials(
	transport: &dyn Transport,
	channel: ChannelId,
	fields: &[(String, Value)],
) -> Result<CredentialIdentity, String> {
	let mut body = serde_json::Map::new();
	body.insert("channel".to_owned(), Value::String(channel.key().to_owned()));
	for (key, value) in fields {
		body.insert(key.clone(), value.clone());
	}
	let reply = transport.request(
		"POST",
		CREDENTIALS_PATH,
		Some(&Value::Object(body).to_string()),
	)?;
	if !(200..300).contains(&reply.status) {
		return Err(reply_error(&reply));
	}
	let parsed: Value = serde_json::from_str(&reply.body)
		.map_err(|_| t!("网关返回的不是 JSON").to_owned())?;
	let identity = CredentialIdentity::parse(parsed.get("identity"));
	if identity.id.is_empty() && identity.name.is_empty() {
		return Err(t!("网关没有返回机器人身份").to_owned());
	}
	Ok(identity)
}

// ── the QR ────────────────────────────────────────────────────────────────

/// Where a rendered QR came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QrSource {
	/// The gateway gave image bytes and `image` decoded them.
	Image,
	/// The URL was a page (or the image did not decode), so the URL itself is
	/// encoded — the web UI's external-renderer fallback, done locally.
	Encoded,
}

/// An RGBA raster ready for an egui texture.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QrImage {
	pub width: u32,
	pub height: u32,
	pub rgba: Vec<u8>,
	pub source: QrSource,
}

/// Does `url` name an image rather than a page to visit?
///
/// The web UI's `WeChatQrImage` uses the same test: a `data:` image, or an
/// `http(s)` URL whose path ends in an image extension.
pub fn looks_like_image(url: &str) -> bool {
	let lower = url.trim().to_ascii_lowercase();
	if lower.starts_with("data:image/") {
		return true;
	}
	let path = lower.split(['?', '#']).next().unwrap_or_default();
	[".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]
		.iter()
		.any(|extension| path.ends_with(extension))
}

/// Render the QR for a `qrcodeUrl`: image bytes when there are any, otherwise
/// a locally encoded QR of the URL.
pub fn qr_image(url: &str, transport: &dyn Transport) -> Result<QrImage, String> {
	let url = url.trim();
	if url.is_empty() {
		return Err(t!("二维码地址为空").to_owned());
	}
	if looks_like_image(url) {
		let bytes = if url.to_ascii_lowercase().starts_with("data:") {
			decode_data_url(url)
		} else {
			transport.get_bytes(url)
		};
		if let Ok(bytes) = bytes {
			if let Ok(image) = decode_image(&bytes) {
				return Ok(image);
			}
		}
	}
	encode_qr(url)
}

/// Decode PNG/JPEG bytes with the `image` crate.
fn decode_image(bytes: &[u8]) -> Result<QrImage, String> {
	let image =
		image::load_from_memory(bytes).map_err(|error| t!("二维码图片无法解码：{}", error))?;
	if image.width() == 0 || image.height() == 0 || image.width() > 2048 || image.height() > 2048 {
		return Err(t!("二维码图片尺寸异常：{}×{}", image.width(), image.height()));
	}
	let rgba = image.to_rgba8();
	Ok(QrImage {
		width: rgba.width(),
		height: rgba.height(),
		rgba: rgba.into_raw(),
		source: QrSource::Image,
	})
}

/// Encode `text` as a QR with a four-module quiet zone, black on white.
pub fn encode_qr(text: &str) -> Result<QrImage, String> {
	use qrcodegen::{QrCode, QrCodeEcc};
	const QUIET: i32 = 4;
	const SCALE: u32 = 4;
	let code = QrCode::encode_text(text, QrCodeEcc::Medium)
		.map_err(|error| t!("二维码生成失败：{}", error))?;
	let modules = code.size();
	let side = (modules as u32 + (QUIET as u32) * 2) * SCALE;
	let mut rgba = vec![255_u8; (side * side * 4) as usize];
	for y in 0..modules {
		for x in 0..modules {
			if !code.get_module(x, y) {
				continue;
			}
			let left = (x as u32 + QUIET as u32) * SCALE;
			let top = (y as u32 + QUIET as u32) * SCALE;
			for dy in 0..SCALE {
				for dx in 0..SCALE {
					let index = (((top + dy) * side) + left + dx) as usize * 4;
					rgba[index] = 0;
					rgba[index + 1] = 0;
					rgba[index + 2] = 0;
				}
			}
		}
	}
	Ok(QrImage { width: side, height: side, rgba, source: QrSource::Encoded })
}

/// The bytes inside a `data:image/…;base64,…` URL.
fn decode_data_url(url: &str) -> Result<Vec<u8>, String> {
	let (meta, data) = url
		.split_once(',')
		.ok_or_else(|| t!("data URL 缺少逗号").to_owned())?;
	if !meta.to_ascii_lowercase().contains(";base64") {
		return Err(t!("data URL 不是 base64").to_owned());
	}
	base64_decode(data)
}

/// Minimal standard-alphabet base64 (padded or not), for the one `data:` URL
/// form the gateway can return.
fn base64_decode(text: &str) -> Result<Vec<u8>, String> {
	let mut out = Vec::with_capacity(text.len() * 3 / 4);
	let mut accumulator = 0_u32;
	let mut bits = 0_u32;
	for byte in text.bytes() {
		let value = match byte {
			b'A'..=b'Z' => byte - b'A',
			b'a'..=b'z' => byte - b'a' + 26,
			b'0'..=b'9' => byte - b'0' + 52,
			b'+' => 62,
			b'/' => 63,
			b'=' => break,
			b'\r' | b'\n' | b' ' | b'\t' => continue,
			_ => return Err(t!("data URL 的 base64 含非法字符").to_owned()),
		};
		accumulator = (accumulator << 6) | u32::from(value);
		bits += 6;
		if bits >= 8 {
			bits -= 8;
			out.push((accumulator >> bits) as u8);
		}
	}
	Ok(out)
}

/// The file name of a path, for legacy bare-path workspace entries.
fn basename(path: &str) -> String {
	let trimmed = path.trim_end_matches(['/', '\\']);
	trimmed
		.rsplit(['/', '\\'])
		.next()
		.filter(|name| !name.is_empty())
		.unwrap_or(trimmed)
		.to_owned()
}

// ── HTTP plumbing ─────────────────────────────────────────────────────────

/// `(host, port, authority)` for a loopback `http` origin.
fn endpoint(origin: &str) -> Result<(String, u16, String), String> {
	let scheme = crate::stats::scheme_of(origin).ok_or_else(|| t!("{} 没有 scheme", origin))?;
	if !scheme.eq_ignore_ascii_case("http") {
		return Err(t!("{} 不是 http 地址（本机网关不走 TLS）", origin));
	}
	let authority = crate::stats::authority_of(origin)
		.ok_or_else(|| t!("{} 没有主机名", origin))?
		.to_owned();
	let host = crate::stats::host_of(&authority).to_owned();
	if !(host == "127.0.0.1" || host == "::1" || host.eq_ignore_ascii_case("localhost")) {
		return Err(t!("{} 不是本机回环地址", host));
	}
	let port = authority
		.rsplit_once(':')
		.and_then(|(_, port)| port.parse::<u16>().ok())
		.ok_or_else(|| t!("{} 没有端口", authority))?;
	Ok((host, port, authority))
}

/// `(host, port, authority, path)` for an absolute loopback `http` URL.
fn absolute_http(url: &str) -> Result<(String, u16, String, String), String> {
	let (host, port, authority) = endpoint(url)?;
	let start = url.find("://").map(|at| at + 3).unwrap_or(0) + authority.len();
	let path = &url[start..];
	let path = if path.is_empty() {
		"/".to_owned()
	} else if path.starts_with('/') {
		path.to_owned()
	} else {
		format!("/{path}")
	};
	Ok((host, port, authority, path))
}

/// Connect, write the request, read to EOF.
fn exchange(host: &str, port: u16, request: &[u8]) -> Result<Vec<u8>, String> {
	let addresses: Vec<std::net::SocketAddr> = (host, port)
		.to_socket_addrs()
		.map_err(|error| t!("解析 {}:{} 失败：{}", host, port, error))?
		.collect();
	if addresses.is_empty() {
		return Err(t!("{}:{} 没有可用地址", host, port));
	}
	// `localhost` may resolve to `::1` first while the server binds 127.0.0.1.
	let mut stream = None;
	let mut last = None;
	for address in addresses {
		match std::net::TcpStream::connect_timeout(&address, TIMEOUT) {
			Ok(connected) => {
				stream = Some(connected);
				break;
			},
			Err(error) => last = Some(error),
		}
	}
	let mut stream = stream.ok_or_else(|| {
		let error = last.map(|error| error.to_string()).unwrap_or_default();
		t!("连接 {}:{} 失败：{}", host, port, error)
	})?;
	stream
		.set_read_timeout(Some(TIMEOUT))
		.map_err(|error| t!("设置读超时失败：{}", error))?;
	stream
		.set_write_timeout(Some(TIMEOUT))
		.map_err(|error| t!("设置写超时失败：{}", error))?;
	stream
		.write_all(request)
		.map_err(|error| t!("发送请求失败：{}", error))?;
	let mut bytes = Vec::new();
	stream
		.read_to_end(&mut bytes)
		.map_err(|error| t!("读取应答失败：{}", error))?;
	Ok(bytes)
}

/// `(status, body)` from a raw HTTP/1.1 response.
fn split_response(bytes: &[u8]) -> (u16, Vec<u8>) {
	let Some(at) = bytes.windows(4).position(|window| window == b"\r\n\r\n") else {
		return (0, Vec::new());
	};
	let head = String::from_utf8_lossy(&bytes[..at]);
	let status = head
		.lines()
		.next()
		.and_then(|line| line.split_whitespace().nth(1))
		.and_then(|code| code.parse().ok())
		.unwrap_or(0);
	let body = &bytes[at + 4..];
	let body = if head
		.to_ascii_lowercase()
		.contains("transfer-encoding: chunked")
	{
		dechunk(body).unwrap_or_default()
	} else {
		body.to_vec()
	};
	(status, body)
}

/// Decode a chunked body (a proxy in front of the gateway may not set a
/// `Content-Length`).
fn dechunk(mut rest: &[u8]) -> Result<Vec<u8>, String> {
	let mut out = Vec::new();
	loop {
		let Some(line_end) = rest.windows(2).position(|window| window == b"\r\n") else {
			return Err(t!("分块应答缺少长度行").to_owned());
		};
		let hex = rest[..line_end]
			.split(|byte| *byte == b';')
			.next()
			.unwrap_or_default();
		let hex = std::str::from_utf8(hex).map_err(|_| t!("分块长度不是 ASCII").to_owned())?;
		let size = usize::from_str_radix(hex.trim(), 16).map_err(|_| t!("分块长度 {} 无效", hex))?;
		rest = &rest[line_end + 2..];
		if size == 0 {
			return Ok(out);
		}
		if rest.len() < size {
			return Err(t!("分块比声明的长度短").to_owned());
		}
		out.extend_from_slice(&rest[..size]);
		rest = &rest[size..];
		rest = rest.strip_prefix(b"\r\n".as_slice()).unwrap_or(rest);
	}
}

/// A 2xx answer is the only one the model treats as success.
fn ensure_ok(reply: &HttpReply) -> Result<(), String> {
	if (200..300).contains(&reply.status) {
		return Ok(());
	}
	Err(reply_error(reply))
}

/// The gateway's `error` string, or the bare status when it carried none.
fn reply_error(reply: &HttpReply) -> String {
	match serde_json::from_str::<Value>(&reply.body)
		.ok()
		.and_then(|value| {
			value
				.get("error")
				.and_then(Value::as_str)
				.map(str::to_owned)
		}) {
		Some(why) => t!("网关返回 {}：{}", reply.status, why),
		None => t!("网关返回 {}", reply.status),
	}
}

#[cfg(test)]
mod tests {
	use std::sync::Mutex;

	use super::*;

	/// A recording transport: canned replies per `METHOD path`, and a record of
	/// every request it saw.
	#[derive(Default)]
	struct Stub {
		replies: Mutex<Vec<(String, HttpReply)>>,
		requests: Mutex<Vec<(String, String, Option<String>)>>,
		images: Mutex<Vec<(String, Vec<u8>)>>,
	}

	impl Stub {
		/// Answer `method path` with `status`/`body`, first match wins.
		fn reply(self, method: &str, path: &str, status: u16, body: &str) -> Self {
			self
				.replies
				.lock()
				.unwrap()
				.push((format!("{method} {path}"), HttpReply { status, body: body.to_owned() }));
			self
		}

		fn image(self, url: &str, bytes: &[u8]) -> Self {
			self
				.images
				.lock()
				.unwrap()
				.push((url.to_owned(), bytes.to_vec()));
			self
		}

		fn seen(&self) -> Vec<(String, String, Option<String>)> {
			self.requests.lock().unwrap().clone()
		}
	}

	impl Transport for Stub {
		fn request(&self, method: &str, path: &str, body: Option<&str>) -> Result<HttpReply, String> {
			self.requests.lock().unwrap().push((
				method.to_owned(),
				path.to_owned(),
				body.map(str::to_owned),
			));
			let key = format!("{method} {path}");
			let mut replies = self.replies.lock().unwrap();
			let position = replies.iter().position(|(pattern, _)| *pattern == key);
			match position {
				Some(position) => Ok(replies.remove(position).1),
				None => Err(format!("stub has no reply for {key}")),
			}
		}

		fn get_bytes(&self, url: &str) -> Result<Vec<u8>, String> {
			self
				.images
				.lock()
				.unwrap()
				.iter()
				.find(|(pattern, _)| pattern == url)
				.map(|(_, bytes)| bytes.clone())
				.ok_or_else(|| format!("stub has no image for {url}"))
		}
	}

	const STATUS: &str = r#"{"channels":[
		{"id":"wechat","running":true},
		{"id":"feishu","running":false}
	]}"#;

	const CONFIG: &str = r#"{
		"channels":{
			"wechat":{"enabled":true,"workspaceRoot":"/work/wechat","botToken":"••••"},
			"feishu":{"enabled":true,"appId":"cli_1","appSecret":"••••","domain":"lark"},
			"telegram":{"enabled":true,"botToken":""}
		},
		"remote":{
			"workspaces":[
				{"alias":"alpha","path":"/work/alpha"},
				"/work/legacy"
			],
			"sessionMappings":[
				{"platform":"feishu","chatId":"oc_1","workspaceAlias":"alpha","lang":"zh","mode":"direct"},
				{"platform":"wechat","chatId":"wx_1","workspaceAlias":"main"}
			]
		}
	}"#;

	fn view() -> View {
		decode_view(STATUS, CONFIG, Some(r#"{"pending":false}"#)).expect("decodes")
	}

	#[test]
	fn the_status_route_maps_running_stopped_and_failed_to_start() {
		let view = view();
		assert_eq!(view.runtime(ChannelId::Wechat), &Runtime::Running);
		assert_eq!(view.runtime(ChannelId::Feishu), &Runtime::Stopped);
		// Enabled but absent from the status list: the runtime did not start.
		assert!(matches!(view.runtime(ChannelId::Telegram), Runtime::Error(_)));
		assert_eq!(view.runtime(ChannelId::Wechat).label(), "运行中");
		assert_eq!(view.runtime(ChannelId::Feishu).label(), "已停止");
		assert!(
			view
				.runtime(ChannelId::Telegram)
				.label()
				.starts_with("错误：")
		);
	}

	#[test]
	fn the_config_masks_secrets_and_keeps_the_domain() {
		let view = view();
		assert!(view.channel(ChannelId::Wechat).enabled);
		assert_eq!(view.channel(ChannelId::Wechat).bot_token, SecretState::Stored);
		assert_eq!(view.channel(ChannelId::Feishu).app_secret, SecretState::Stored);
		assert_eq!(view.channel(ChannelId::Feishu).app_id, "cli_1");
		assert_eq!(view.channel(ChannelId::Feishu).domain, "lark");
		assert_eq!(view.channel(ChannelId::Telegram).bot_token, SecretState::Unset);
		assert_eq!(SecretState::Stored.label(), "已保存（留空则不修改）");
		assert_eq!(SecretState::Unset.label(), "未设置");
	}

	#[test]
	fn legacy_workspace_paths_get_a_basename_alias() {
		let view = view();
		assert_eq!(
			view.workspaces,
			vec![
				Workspace { alias: "alpha".to_owned(), path: "/work/alpha".to_owned() },
				Workspace { alias: "legacy".to_owned(), path: "/work/legacy".to_owned() },
			]
		);
	}

	#[test]
	fn the_qr_stage_walks_pending_scanned_connected_and_unbound() {
		let mut qr = QrState::default();
		assert_eq!(qr.stage, QrStage::Idle);

		qr.apply(&QrPayload {
			pending: true,
			qrcode_url: Some("https://liteapp.weixin.qq.com/x".to_owned()),
			status: "wait".to_owned(),
		});
		assert_eq!(qr.stage, QrStage::Pending);
		assert_eq!(qr.stage.label(), "待扫码");
		assert_eq!(qr.url.as_deref(), Some("https://liteapp.weixin.qq.com/x"));

		qr.apply(&QrPayload {
			pending: true,
			qrcode_url: Some("https://liteapp.weixin.qq.com/x".to_owned()),
			status: "scaned".to_owned(),
		});
		assert_eq!(qr.stage, QrStage::Scanned);

		qr.apply(&QrPayload {
			pending: true,
			qrcode_url: Some("https://liteapp.weixin.qq.com/x".to_owned()),
			status: "confirmed".to_owned(),
		});
		assert_eq!(qr.stage, QrStage::Connected);
		assert_eq!(qr.stage.label(), "已连接");

		// A `{pending:false}` poll after confirmation returns to idle.
		qr.apply(&QrPayload::default());
		assert_eq!(qr.stage, QrStage::Idle);

		qr.unbind();
		assert_eq!(qr.stage, QrStage::Unbound);
		assert_eq!(qr.url, None);
		// Unbind survives the next poll, until a login actually starts.
		qr.apply(&QrPayload::default());
		assert_eq!(qr.stage, QrStage::Unbound);
		qr.apply(&QrPayload {
			pending: true,
			qrcode_url: Some("data:image/png;base64,AAAA".to_owned()),
			status: "wait".to_owned(),
		});
		assert_eq!(qr.stage, QrStage::Pending);

		qr.reconnect_requested();
		assert_eq!(qr.stage, QrStage::Pending);
		assert_eq!(qr.url, None);
	}

	#[test]
	fn an_expired_qr_is_its_own_stage() {
		let mut qr = QrState::default();
		qr.apply(&QrPayload {
			pending: true,
			qrcode_url: Some("x".to_owned()),
			status: "expired".to_owned(),
		});
		assert_eq!(qr.stage, QrStage::Expired);
		assert_eq!(qr.stage.label(), "二维码已过期，请重新连接");
	}

	#[test]
	fn a_page_url_falls_back_to_a_locally_encoded_qr() {
		let stub = Stub::default();
		assert!(!looks_like_image("https://liteapp.weixin.qq.com/x?k=1"));
		let image = qr_image("https://liteapp.weixin.qq.com/x?k=1", &stub).expect("encodes");
		assert_eq!(image.source, QrSource::Encoded);
		assert_eq!(image.width, image.height);
		assert!(image.width > 32);
		assert_eq!(image.rgba.len(), (image.width * image.height * 4) as usize);
		assert!(stub.seen().is_empty(), "a page URL must not be fetched");
	}

	#[test]
	fn image_urls_are_fetched_and_decoded_and_a_broken_image_falls_back() {
		let png = png_bytes();
		let url = "http://127.0.0.1:30141/qr.png";
		let stub = Stub::default().image(url, &png);
		let image = qr_image(url, &stub).expect("decodes");
		assert_eq!(image.source, QrSource::Image);
		assert_eq!((image.width, image.height), (2, 2));

		let broken = Stub::default().image(url, b"not an image");
		let image = qr_image(url, &broken).expect("falls back to a QR of the URL");
		assert_eq!(image.source, QrSource::Encoded);
	}

	#[test]
	fn data_urls_decode_without_a_socket() {
		let png = png_bytes();
		let encoded = base64_encode(&png);
		let url = format!("data:image/png;base64,{encoded}");
		let image = qr_image(&url, &Stub::default()).expect("decodes the data URL");
		assert_eq!(image.source, QrSource::Image);
		assert_eq!((image.width, image.height), (2, 2));
		assert_eq!(base64_decode("aGVsbG8=").unwrap(), b"hello");
	}

	#[test]
	fn a_credential_commit_writes_the_path_then_reloads_the_view() {
		let updated = CONFIG.replace("\"appId\":\"cli_1\"", "\"appId\":\"cli_2\"");
		let stub = Stub::default()
			.reply("GET", STATUS_PATH, 200, STATUS)
			.reply("GET", CONFIG_PATH, 200, &updated)
			.reply("GET", QR_PATH, 200, r#"{"pending":false}"#)
			.reply("PUT", CONFIG_PATH, 200, r#"{"ok":true}"#);
		let view =
			commit(&stub, "channels.feishu.appId", Value::String("cli_2".to_owned())).expect("commit");
		assert_eq!(view.channel(ChannelId::Feishu).app_id, "cli_2");
		let requests = stub.seen();
		let put = requests
			.iter()
			.find(|(method, path, _)| method == "PUT" && path == CONFIG_PATH)
			.expect("the PUT");
		let body: Value = serde_json::from_str(put.2.as_deref().expect("body")).expect("JSON");
		assert_eq!(body["path"], "channels.feishu.appId");
		assert_eq!(body["value"], "cli_2");
		assert_eq!(
			requests
				.iter()
				.filter(|(method, path, _)| method == "GET" && path == CONFIG_PATH)
				.count(),
			1,
			"the commit re-reads the config"
		);
	}

	#[test]
	fn a_secret_that_is_left_blank_is_not_written() {
		// The UI's save path: only non-empty drafts become fields. A stored
		// secret stays exactly as the masked GET reported it.
		let stub = Stub::default()
			.reply("GET", STATUS_PATH, 200, STATUS)
			.reply("GET", CONFIG_PATH, 200, CONFIG)
			.reply("GET", QR_PATH, 200, r#"{"pending":false}"#)
			.reply("PUT", CONFIG_PATH, 200, r#"{"ok":true}"#);
		let view = commit_many(
			&stub,
			&[
				("channels.feishu.appId".to_owned(), Value::String("cli_2".to_owned())),
				// Empty secret drafts are filtered before this call.
			],
		)
		.expect("commit");
		assert_eq!(view.channel(ChannelId::Feishu).app_secret, SecretState::Stored);
		let puts = stub
			.seen()
			.into_iter()
			.filter(|(method, _, _)| method == "PUT")
			.count();
		assert_eq!(puts, 1, "no second write for an untouched secret");
	}

	#[test]
	fn workspace_aliases_add_edit_and_remove_with_the_web_config_rules() {
		let entries = view().workspaces;
		let root = std::env::temp_dir().join("zetawork-channels-aliases");
		let beta = root.join("beta").display().to_string();
		let beta_2 = root.join("beta-2").display().to_string();
		let next = upsert_workspace(&entries, "beta", &beta).expect("adds");
		assert_eq!(next.len(), 3);
		assert!(
			next
				.iter()
				.any(|entry| entry.alias == "beta" && entry.path == beta)
		);

		let retarget = replace_workspace(&next, 2, "beta", &beta_2).expect("edits");
		assert!(
			retarget
				.iter()
				.any(|entry| entry.alias == "beta" && entry.path == beta_2)
		);
		let renamed = replace_workspace(&retarget, 2, "delta", &beta_2).expect("renames");
		assert!(renamed.iter().any(|entry| entry.alias == "delta"));
		assert!(!renamed.iter().any(|entry| entry.alias == "beta"));
		assert!(replace_workspace(&renamed, 0, "delta", &beta_2).is_err(), "duplicate alias");
		assert!(replace_workspace(&renamed, 9, "x", &beta_2).is_err(), "no such row");
		assert!(replace_workspace(&renamed, 0, "alpha", "relative/dir").is_err());

		assert!(
			upsert_workspace(&entries, "alpha", &root.join("other").display().to_string()).is_err()
		);
		assert!(
			upsert_workspace(&entries, "main", &root.join("main").display().to_string()).is_err()
		);
		assert!(upsert_workspace(&entries, "", &root.join("x").display().to_string()).is_err());
		assert!(upsert_workspace(&entries, "rel", "relative/dir").is_err());

		let removed = remove_workspace(&entries, "alpha");
		assert_eq!(removed.len(), 1);
	}

	#[test]
	fn workspace_and_binding_edits_round_trip_against_a_stubbed_http_layer() {
		let base = view();
		let beta = std::env::temp_dir()
			.join("zetawork-channels-roundtrip")
			.join("beta")
			.display()
			.to_string();
		let workspaces = upsert_workspace(&base.workspaces, "beta", &beta).expect("adds");
		let mut with_workspaces = base.clone();
		with_workspaces.workspaces = workspaces.clone();
		let bindings =
			add_binding(&with_workspaces, ChannelId::Telegram, "42", None, "beta").expect("binds");
		assert_eq!(bindings.len(), 3);
		let after_ws = config_json(&workspaces, &base.bindings);
		let after_bindings = config_json(&workspaces, &bindings);
		let stub = Stub::default()
			.reply("GET", STATUS_PATH, 200, STATUS)
			.reply("GET", STATUS_PATH, 200, STATUS)
			.reply("GET", CONFIG_PATH, 200, &after_ws)
			.reply("GET", CONFIG_PATH, 200, &after_bindings)
			.reply("GET", QR_PATH, 200, r#"{"pending":false}"#)
			.reply("GET", QR_PATH, 200, r#"{"pending":false}"#)
			.reply("PUT", CONFIG_PATH, 200, r#"{"ok":true}"#)
			.reply("PUT", CONFIG_PATH, 200, r#"{"ok":true}"#);

		let written = commit(&stub, "remote.workspaces", workspaces_value(&workspaces))
			.expect("workspace write");
		assert!(written.workspaces.iter().any(|entry| entry.alias == "beta"));
		let written_bindings =
			add_binding(&written, ChannelId::Telegram, "42", None, "beta").expect("binds");
		let after = commit(&stub, "remote.sessionMappings", bindings_value(&written_bindings))
			.expect("binding write");
		assert!(after.bindings.iter().any(
			|binding| binding.platform == ChannelId::Telegram && binding.workspace_alias == "beta"
		));

		// Every field the GUI does not edit survives the rewrite.
		let feishu = after
			.bindings
			.iter()
			.find(|binding| binding.platform == ChannelId::Feishu)
			.expect("the feishu binding");
		assert_eq!(feishu.raw["lang"], "zh");
		assert_eq!(feishu.raw["mode"], "direct");

		let puts: Vec<Value> = stub
			.seen()
			.into_iter()
			.filter(|(method, _, _)| method == "PUT")
			.map(|(_, _, body)| serde_json::from_str(&body.expect("body")).expect("JSON"))
			.collect();
		assert_eq!(puts.len(), 2);
		assert_eq!(puts[0]["path"], "remote.workspaces");
		assert_eq!(puts[1]["path"], "remote.sessionMappings");
		assert!(
			puts[0]["value"]
				.as_array()
				.unwrap()
				.iter()
				.any(|entry| entry["alias"] == "beta")
		);
		assert!(
			puts[1]["value"]
				.as_array()
				.unwrap()
				.iter()
				.any(|entry| entry["platform"] == "telegram")
		);
	}

	/// The config body a subsequent GET would return after writing `entries`.
	fn config_json(workspaces: &[Workspace], bindings: &[Binding]) -> String {
		let mut config: Value = serde_json::from_str(CONFIG).expect("the fixture parses");
		config["remote"]["workspaces"] = workspaces_value(workspaces);
		config["remote"]["sessionMappings"] = bindings_value(bindings);
		config.to_string()
	}

	#[test]
	fn a_binding_must_name_an_alias_that_exists() {
		let view = view();
		assert!(add_binding(&view, ChannelId::Feishu, "oc_2", None, "nope").is_err());
		assert!(add_binding(&view, ChannelId::Feishu, "  ", None, "alpha").is_err());
		assert!(add_binding(&view, ChannelId::Feishu, "oc_2", None, "main").is_ok());
		let removed = remove_binding(&view, ChannelId::Feishu, "oc_1", None);
		assert_eq!(removed.len(), 1);
	}

	#[test]
	fn a_send_failure_keeps_the_routes_three_kinds() {
		for (status, kind) in [
			(404, SendFailure::UnknownChannel),
			(400, SendFailure::Unpaired),
			(500, SendFailure::Failed),
		] {
			let stub = Stub::default().reply(
				"POST",
				SEND_PATH,
				status,
				r#"{"error":"Channel not enabled: wechat"}"#,
			);
			let outcome = send(&stub, ChannelId::Wechat, "wx-peer", "hi");
			assert_eq!(outcome.failure, Some(kind));
			assert!(outcome.line().contains("Channel not enabled"), "{}", outcome.line());
		}
		let ok = Stub::default().reply(
			"POST",
			SEND_PATH,
			200,
			r#"{"ok":true,"receipt":{"channelId":"feishu","to":"oc_1","textLength":2}}"#,
		);
		let outcome = send(&ok, ChannelId::Feishu, "oc_1", "hi");
		assert!(outcome.is_ok());
		assert!(outcome.line().contains("oc_1"));
	}

	#[test]
	fn the_credential_form_walks_empty_validating_saved_and_failed() {
		let mut form = CredentialForm::default();
		assert_eq!(form.stage, CredentialStage::Empty);
		assert_eq!(form.line(), "未验证");
		assert!(form.can_submit());

		form.begin();
		assert_eq!(form.stage, CredentialStage::Validating);
		assert!(!form.can_submit(), "a second click must not start a second check");
		assert_eq!(form.line(), "验证中…");

		form.saved(CredentialIdentity {
			id: "ou_1".to_owned(),
			name: "Zeta".to_owned(),
			username: None,
		});
		assert_eq!(form.stage, CredentialStage::Saved);
		assert!(form.can_submit());
		assert_eq!(form.line(), "已验证：Zeta (ou_1)");

		form.failed("app secret invalid");
		assert_eq!(form.stage, CredentialStage::Failed);
		assert!(form.line().starts_with("验证失败："));
		assert!(form.line().contains("app secret invalid"));

		form.reset();
		assert_eq!(form.stage, CredentialStage::Empty);
	}

	#[test]
	fn a_credential_validation_posts_the_drafts_and_reports_the_identity() {
		let stub = Stub::default().reply(
			"POST",
			CREDENTIALS_PATH,
			200,
			r#"{"ok":true,"channel":"telegram","state":"connected","identity":{"id":"42","name":"Zeta","username":"zeta_bot"},"credentialsPersisted":true}"#,
		);
		let identity = validate_credentials(
			&stub,
			ChannelId::Telegram,
			&[("botToken".to_owned(), Value::String("123:ABC".to_owned()))],
		)
		.expect("validates");
		assert_eq!(identity.label(), "Zeta (@zeta_bot)");

		let (method, path, body) = stub.seen().pop().expect("one request");
		assert_eq!((method.as_str(), path.as_str()), ("POST", CREDENTIALS_PATH));
		let body: Value = serde_json::from_str(body.as_deref().expect("body")).expect("JSON");
		assert_eq!(body["channel"], "telegram");
		assert_eq!(body["botToken"], "123:ABC");
	}

	#[test]
	fn a_rejected_credential_carries_the_gateways_reason() {
		let stub = Stub::default().reply(
			"POST",
			CREDENTIALS_PATH,
			400,
			r#"{"channel":"feishu","state":"error","error":"Feishu rejected the app credentials: app secret invalid"}"#,
		);
		let error = validate_credentials(&stub, ChannelId::Feishu, &[]).expect_err("rejected");
		assert!(error.contains("app secret invalid"));
	}

	#[test]
	fn only_a_loopback_http_origin_is_a_transport() {
		assert!(HttpTransport::new("http://127.0.0.1:30141").is_ok());
		assert!(HttpTransport::new("http://localhost:30141/").is_ok());
		assert!(HttpTransport::new("https://127.0.0.1:30141").is_err());
		assert!(HttpTransport::new("http://10.0.0.2:30141").is_err());
		assert!(HttpTransport::new("http://127.0.0.1").is_err());
	}

	/// A 2×2 PNG, decoded by the `image` crate in the fallback tests.
	fn png_bytes() -> Vec<u8> {
		use std::io::Cursor;
		let mut bytes = Vec::new();
		{
			let mut encoder = png::Encoder::new(Cursor::new(&mut bytes), 2, 2);
			encoder.set_color(png::ColorType::Rgba);
			encoder.set_depth(png::BitDepth::Eight);
			let mut writer = encoder.write_header().expect("png header");
			writer
				.write_image_data(&[0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255])
				.expect("png data");
		}
		bytes
	}

	fn base64_encode(bytes: &[u8]) -> String {
		const ALPHABET: &[u8; 64] =
			b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
		let mut out = String::new();
		for chunk in bytes.chunks(3) {
			let a = u32::from(chunk[0]);
			let b = chunk.get(1).copied().map(u32::from).unwrap_or(0);
			let c = chunk.get(2).copied().map(u32::from).unwrap_or(0);
			let triple = (a << 16) | (b << 8) | c;
			out.push(ALPHABET[(triple >> 18) as usize & 63] as char);
			out.push(ALPHABET[(triple >> 12) as usize & 63] as char);
			out.push(if chunk.len() > 1 {
				ALPHABET[(triple >> 6) as usize & 63] as char
			} else {
				'='
			});
			out.push(if chunk.len() > 2 {
				ALPHABET[triple as usize & 63] as char
			} else {
				'='
			});
		}
		out
	}
}
