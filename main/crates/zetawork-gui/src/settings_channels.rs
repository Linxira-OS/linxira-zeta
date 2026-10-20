// SPDX-License-Identifier: AGPL-3.0-only
//! 设置 → IM 渠道: the pane, its worker jobs, and the QR texture.
//!
//! The model and every wire rule live in [`crate::channels`]; this module owns
//! the four things a UI thread must: the last [`View`], a small set of
//! short-lived worker jobs (so no loopback request runs in `update`), the
//! drafts the text fields edit, and the QR texture.
//!
//! # The poll
//!
//! While the pane is open and WeChat is enabled, status + QR are read every two
//! seconds — the interval the web desktop's `useEffect` uses. `GET
//! /api/web-config` is read once when the pane opens and after every write,
//! never on the poll: a user typing a credential must not have the row
//! re-seeded under them, and the web UI behaves the same way.

use std::{
	sync::mpsc::{self, Receiver, TryRecvError},
	time::{Duration, Instant},
};

use egui::{
	Align, Button, Color32, CornerRadius, FontId, Layout, Rect, Sense, Stroke, TextEdit, Ui, pos2,
	vec2,
};
use serde_json::Value;

use crate::{
	Shell,
	channels::{
		self, Binding, ChannelId, HttpTransport, QrImage, QrStage, SendOutcome, Transport, View,
		Workspace,
	},
	settings_ui::{head, hint, small_button, switch},
	t, theme,
	widgets::truncated_text,
};

/// The QR/status poll interval (the web UI's `setInterval(poll, 2000)`).
const POLL: Duration = Duration::from_secs(2);

/// A full re-read cadence, so a pane left open does not show yesterday's
/// credentials after an IM command changed them.
const FULL_REFRESH: Duration = Duration::from_secs(60);

/// The QR raster the pane holds for the current URL.
struct QrTexture {
	url: String,
	texture: egui::TextureHandle,
	source: channels::QrSource,
}

/// The finished work of one worker thread.
enum Event {
	/// A full or live read, and whether a commit produced it.
	View { result: Result<Box<View>, String>, from_commit: bool, generation: u64 },
	/// A QR bitmap for `url`.
	Qr { url: String, result: Result<QrImage, String> },
	/// One send result.
	Sent(SendOutcome),
}

/// The pane's state. `Default` is the inert panel a headless shell gets.
#[derive(Default)]
pub struct ChannelsPanel {
	view: Option<View>,
	/// The last read/write failure (a poll that fails keeps the old view).
	error: Option<String>,
	/// The last commit's line: `true` = saved, `false` = the error text.
	notice: Option<(bool, String)>,
	/// What a save is doing, for the button label.
	pending: Option<String>,
	/// One receiver per worker thread; an empty vector means idle.
	jobs: Vec<Receiver<Event>>,
	visible: bool,
	was_visible: bool,
	next_poll: Option<Instant>,
	last_full: Option<Instant>,
	/// `http://127.0.0.1:PORT` from `~/.zeta/serve.json`'s `webUrl`.
	origin: Option<String>,
	origin_error: Option<String>,
	/// Text-field drafts, keyed by a stable row id.
	edits: Vec<(String, String)>,
	qr: Option<QrTexture>,
	/// Image bytes a worker decoded; the next `qr_texture` uploads them with
	/// the frame's context (a worker has none).
	qr_bytes: Option<(String, QrImage)>,
	qr_error: Option<String>,
	qr_pending: Option<String>,
	send_channel: Option<ChannelId>,
	send_peer: String,
	send_text: String,
	send_result: Option<SendOutcome>,
	binding_channel: Option<ChannelId>,
	/// Bumped by every authoritative read (full load, commit, action); a live
	/// poll that started under an older generation is discarded, so it cannot
	/// overwrite a newer config with its stale clone.
	generation: u64,
}

impl ChannelsPanel {
	pub fn view(&self) -> Option<&View> {
		self.view.as_ref()
	}

	pub fn error(&self) -> Option<&str> {
		self.error.as_deref()
	}

	pub fn notice(&self) -> Option<&(bool, String)> {
		self.notice.as_ref()
	}

	pub fn pending(&self) -> Option<&str> {
		self.pending.as_deref()
	}

	pub fn send_result(&self) -> Option<&SendOutcome> {
		self.send_result.as_ref()
	}

	/// The origin line, or the reason there is none.
	pub fn origin_line(&self) -> String {
		match (&self.origin, &self.origin_error) {
			(Some(origin), _) => origin.clone(),
			(None, Some(error)) => error.clone(),
			(None, None) => t!("未发现 ~/.zeta/serve.json 的 webUrl").to_owned(),
		}
	}

	/// The text field's draft: seeded once from `seed`, kept across frames.
	pub fn edit(&mut self, key: &str, seed: &str) -> &mut String {
		let index = match self.edits.iter().position(|(id, _)| id == key) {
			Some(index) => index,
			None => {
				self.edits.push((key.to_owned(), seed.to_owned()));
				self.edits.len() - 1
			},
		};
		&mut self.edits[index].1
	}

	pub fn send_channel(&mut self) -> ChannelId {
		*self.send_channel.get_or_insert(ChannelId::Wechat)
	}

	pub fn set_send_channel(&mut self, channel: ChannelId) {
		self.send_channel = Some(channel);
	}

	/// The add-binding row's channel (the send form has its own).
	pub fn binding_channel(&mut self) -> ChannelId {
		*self.binding_channel.get_or_insert(ChannelId::Wechat)
	}

	pub fn set_binding_channel(&mut self, channel: ChannelId) {
		self.binding_channel = Some(channel);
	}

	pub fn send_peer_mut(&mut self) -> &mut String {
		&mut self.send_peer
	}

	pub fn send_text_mut(&mut self) -> &mut String {
		&mut self.send_text
	}

	/// A headless fixture for the screenshot test: the pane draws exactly what
	/// a live read would have produced.
	pub fn show_fixture(&mut self, view: View) {
		self.view = Some(view);
		self.error = None;
		self.origin = Some("http://127.0.0.1:30141".to_owned());
		self.origin_error = None;
		self.last_full = Some(Instant::now());
		self.generation += 1;
	}

	/// The settings pane became (in)active.
	pub fn set_visible(&mut self, visible: bool) {
		self.visible = visible;
	}

	/// Per-frame work: drain finished jobs and start the next poll.
	pub fn tick(&mut self, ctx: &egui::Context, probe: bool) {
		self.drain();
		let opened = self.visible && !self.was_visible;
		self.was_visible = self.visible;
		if !self.visible || !probe {
			return;
		}
		if opened {
			// Opening the pane is a full read: it may have been changed by the
			// IM commands or another surface since the last time it was open.
			self.refresh();
		}
		let now = Instant::now();
		let due = self.next_poll.is_none_or(|at| now >= at);
		let stale = self
			.last_full
			.is_none_or(|at| now.duration_since(at) >= FULL_REFRESH);
		if self.jobs.is_empty() && due {
			if self.view.is_none() || stale {
				self.spawn_full(false);
			} else {
				self.spawn_live();
			}
			self.next_poll = Some(now + POLL);
		}
		let wechat_enabled = self
			.view
			.as_ref()
			.is_some_and(|view| view.channel(ChannelId::Wechat).enabled);
		if wechat_enabled {
			ctx.request_repaint_after(POLL);
		}
	}

	/// Re-read status + config + QR now.
	pub fn refresh(&mut self) {
		self.spawn_full(false);
	}

	/// `PUT` one path, then re-read.
	pub fn commit(&mut self, path: &str, value: Value) {
		self.commit_fields(vec![(path.to_owned(), value)]);
	}

	/// Several paths (one credential form), then one re-read.
	pub fn commit_fields(&mut self, fields: Vec<(String, Value)>) {
		if fields.is_empty() {
			return;
		}
		self.notice = None;
		let Some(origin) = self.ensure_origin() else {
			return;
		};
		self.pending = Some(t!("保存中…").to_owned());
		self.last_full = Some(Instant::now());
		self.generation += 1;
		let generation = self.generation;
		let (tx, rx) = mpsc::channel();
		self.jobs.push(rx);
		std::thread::spawn(move || {
			let result = match HttpTransport::new(&origin) {
				Ok(transport) => channels::commit_many(&transport, &fields),
				Err(error) => Err(error),
			};
			let _ =
				tx.send(Event::View { result: result.map(Box::new), from_commit: true, generation });
		});
	}

	/// 重新连接: a fresh WeChat QR login.
	pub fn reconnect(&mut self) {
		if let Some(view) = &mut self.view {
			view.qr.reconnect_requested();
		}
		self.drop_qr();
		self.action(channels::RECONNECT_PATH, t!("重新连接中…"));
	}

	/// 解绑: clear the WeChat credentials and peer bindings.
	pub fn unbind(&mut self) {
		if let Some(view) = &mut self.view {
			view.qr.unbind();
		}
		self.drop_qr();
		self.action(channels::UNBIND_PATH, t!("解绑中…"));
	}

	/// `POST /api/channels/send` for the pane's send form.
	pub fn send(&mut self, channel: ChannelId, peer: &str, text: &str) {
		let Some(origin) = self.ensure_origin() else {
			return;
		};
		let (tx, rx) = mpsc::channel();
		self.jobs.push(rx);
		let peer = peer.trim().to_owned();
		let text = text.trim().to_owned();
		std::thread::spawn(move || {
			let outcome = match HttpTransport::new(&origin) {
				Ok(transport) => channels::send(&transport, channel, &peer, &text),
				Err(error) => {
					SendOutcome { failure: Some(channels::SendFailure::Failed), detail: error }
				},
			};
			let _ = tx.send(Event::Sent(outcome));
		});
	}

	/// The QR texture for `url`, generating it on first use.
	///
	/// Headless frames (the screenshot test) encode a page URL inline — the
	/// encoder is pure and fast — while a live shell fetches an image URL on a
	/// worker thread.
	pub fn qr_texture(
		&mut self,
		ctx: &egui::Context,
		url: &str,
		probe: bool,
	) -> Option<(egui::TextureHandle, channels::QrSource)> {
		if let Some(cached) = &self.qr {
			if cached.url == url {
				return Some((cached.texture.clone(), cached.source));
			}
			self.qr = None;
			self.qr_error = None;
		}
		if !probe && !channels::looks_like_image(url) {
			if let Ok(image) = channels::encode_qr(url) {
				self.qr = Some(upload(ctx, url, image));
				return self
					.qr
					.as_ref()
					.map(|cached| (cached.texture.clone(), cached.source));
			}
		}
		if !probe {
			return None;
		}
		if let Some((pending, image)) = self.qr_bytes.take() {
			if pending == url {
				self.qr = Some(upload(ctx, url, image));
				return self
					.qr
					.as_ref()
					.map(|cached| (cached.texture.clone(), cached.source));
			}
		}
		if self.qr_pending.as_deref() == Some(url) {
			return None;
		}
		{
			let origin = self.ensure_origin()?;
			let (tx, rx) = mpsc::channel();
			self.jobs.push(rx);
			self.qr_pending = Some(url.to_owned());
			let url = url.to_owned();
			std::thread::spawn(move || {
				let result = match HttpTransport::new(&origin) {
					Ok(transport) => channels::qr_image(&url, &transport),
					Err(error) => Err(error),
				};
				let _ = tx.send(Event::Qr { url, result });
			});
		}
		None
	}

	pub fn qr_error(&self) -> Option<&str> {
		self.qr_error.as_deref()
	}

	/// Which raster the pane currently holds (the screenshot test checks that
	/// a page URL really produced the local encoder's QR).
	pub fn qr_source(&self) -> Option<channels::QrSource> {
		self.qr.as_ref().map(|cached| cached.source)
	}

	fn action(&mut self, path: &'static str, label: &str) {
		let Some(origin) = self.ensure_origin() else {
			return;
		};
		self.pending = Some(label.to_owned());
		self.notice = None;
		self.last_full = Some(Instant::now());
		self.generation += 1;
		let generation = self.generation;
		let (tx, rx) = mpsc::channel();
		self.jobs.push(rx);
		std::thread::spawn(move || {
			let result = (|| {
				let transport = HttpTransport::new(&origin)?;
				let reply = transport.request("POST", path, Some("{}"))?;
				if !(200..300).contains(&reply.status) {
					return Err(crate::t!("网关返回 {}：{}", reply.status, reply.body));
				}
				channels::load(&transport)
			})();
			let _ =
				tx.send(Event::View { result: result.map(Box::new), from_commit: true, generation });
		});
	}

	fn ensure_origin(&mut self) -> Option<String> {
		if let Some(origin) = &self.origin {
			return Some(origin.clone());
		}
		// Retry on each call: `zetacode serve` may have started since the last
		// attempt, and the file is small.
		match crate::stats::discover().info.and_then(|info| info.web_url) {
			Some(url) => match HttpTransport::new(&url) {
				Ok(_) => {
					let origin = url.trim_end_matches('/').to_owned();
					self.origin = Some(origin.clone());
					self.origin_error = None;
					Some(origin)
				},
				Err(error) => {
					self.origin_error = Some(error.clone());
					self.error = Some(error);
					None
				},
			},
			None => {
				let error = t!("未发现 ~/.zeta/serve.json 的 webUrl").to_owned();
				self.origin_error = Some(error.clone());
				self.error = Some(error);
				None
			},
		}
	}

	fn spawn_full(&mut self, from_commit: bool) {
		if !self.jobs.is_empty() {
			// A commit in flight already refreshes at the end; a full read on
			// top of it would only duplicate the three GETs.
			return;
		}
		let Some(origin) = self.ensure_origin() else {
			return;
		};
		self.last_full = Some(Instant::now());
		self.generation += 1;
		let generation = self.generation;
		let (tx, rx) = mpsc::channel();
		self.jobs.push(rx);
		std::thread::spawn(move || {
			let result = match HttpTransport::new(&origin) {
				Ok(transport) => channels::load(&transport),
				Err(error) => Err(error),
			};
			let _ = tx.send(Event::View { result: result.map(Box::new), from_commit, generation });
		});
	}

	fn spawn_live(&mut self) {
		let Some(mut view) = self.view.clone() else {
			self.spawn_full(false);
			return;
		};
		let Some(origin) = self.ensure_origin() else {
			return;
		};
		let generation = self.generation;
		let (tx, rx) = mpsc::channel();
		self.jobs.push(rx);
		std::thread::spawn(move || {
			let result = match HttpTransport::new(&origin) {
				Ok(transport) => channels::refresh_live(&transport, &mut view).map(|()| view),
				Err(error) => Err(error),
			};
			let _ =
				tx.send(Event::View { result: result.map(Box::new), from_commit: false, generation });
		});
	}

	fn drain(&mut self) {
		let mut index = 0;
		while index < self.jobs.len() {
			let finished = match self.jobs[index].try_recv() {
				Ok(event) => {
					self.apply(event);
					false
				},
				Err(TryRecvError::Empty) => false,
				Err(TryRecvError::Disconnected) => true,
			};
			if finished {
				self.jobs.swap_remove(index);
			} else {
				index += 1;
			}
		}
	}

	fn apply(&mut self, event: Event) {
		match event {
			Event::View { result, from_commit, generation } => {
				if generation != self.generation {
					// A newer read (a commit or full load) superseded this one.
					return;
				}
				if from_commit {
					self.pending = None;
				}
				match result {
					Ok(view) => {
						let view = *view;
						// A confirmed QR writes the WeChat bot token into
						// web.yml; the live poll does not re-read the config, so
						// ask for one full read on the next idle tick.
						let was_connected = self
							.view
							.as_ref()
							.is_some_and(|view| view.wechat_stage() == QrStage::Connected);
						if view.wechat_stage() == QrStage::Connected && !was_connected {
							self.last_full = None;
						}
						self.view = Some(view);
						self.error = None;
						if from_commit {
							self.edits.clear();
							self.notice = Some((true, t!("已保存").to_owned()));
						}
					},
					Err(error) => {
						self.error = Some(error.clone());
						if from_commit {
							self.notice = Some((false, t!("保存失败：{}", error)));
						}
					},
				}
			},
			Event::Qr { url, result } => {
				if self.qr_pending.as_deref() == Some(url.as_str()) {
					self.qr_pending = None;
				}
				match result {
					Ok(image) => {
						if self
							.view
							.as_ref()
							.and_then(|view| view.qr.url.as_deref())
							.is_some_and(|current| current == url)
						{
							self.qr_bytes = Some((url, image));
							self.qr_error = None;
						}
					},
					Err(error) => {
						if self
							.view
							.as_ref()
							.and_then(|view| view.qr.url.as_deref())
							.is_some_and(|current| current == url)
						{
							self.qr_error = Some(error);
						}
					},
				}
			},
			Event::Sent(outcome) => self.send_result = Some(outcome),
		}
	}

	fn drop_qr(&mut self) {
		self.qr = None;
		self.qr_bytes = None;
		self.qr_error = None;
		self.qr_pending = None;
	}
}

/// Upload a QR image into a texture on the UI thread.
fn upload(ctx: &egui::Context, url: &str, image: QrImage) -> QrTexture {
	let color = egui::ColorImage::from_rgba_unmultiplied(
		[image.width as usize, image.height as usize],
		&image.rgba,
	);
	let texture =
		ctx.load_texture(format!("zetawork-im-qr-{url}"), color, egui::TextureOptions::LINEAR);
	QrTexture { url: url.to_owned(), texture, source: image.source }
}

// ── the pane ──────────────────────────────────────────────────────────────

/// Draw 设置 → IM 渠道.
pub fn section(ui: &mut Ui, shell: &mut Shell) {
	head(ui, t!("IM 渠道"));
	hint(ui, t!("由 zetacode serve 的网关读取 ~/.zeta/agent/web.yml；秘密字段只显示是否已保存。"));
	compact_note(ui, &t!("网关：{}", shell.channels.origin_line()));
	if let Some(pending) = shell.channels.pending().map(str::to_owned) {
		compact_note(ui, &pending);
	}
	if let Some(notice) = shell.channels.notice().cloned() {
		compact_note_colored(ui, &notice.1, if notice.0 { theme::TEXT_2 } else { theme::WARN });
	}
	if let Some(error) = shell.channels.error().map(str::to_owned) {
		compact_note_colored(ui, &t!("渠道加载失败：{}", error), theme::WARN);
	}

	let Some(view) = shell.channels.view().cloned() else {
		hint(ui, t!("正在读取渠道状态…"));
		return;
	};

	head(ui, t!("渠道"));
	for id in ChannelId::ALL {
		channel_row(ui, shell, &view, id);
	}

	wechat_login(ui, shell, &view);
	routing(ui, shell, &view);
	credentials(ui, shell, &view);
	send_test(ui, shell);
	ui.add_space(16.0);
}

/// One channel's enable row: name, runtime as words, and the switch.
fn channel_row(ui: &mut Ui, shell: &mut Shell, view: &View, id: ChannelId) {
	let enabled = view.channel(id).enabled;
	let runtime = view.runtime(id).label();
	field_row(
		ui,
		id.label(),
		&runtime,
		|ui, shell| {
			let mut next = enabled;
			if switch(ui, &mut next) && next != enabled {
				shell
					.channels
					.commit(&format!("channels.{}.enabled", id.key()), Value::Bool(next));
			}
		},
		shell,
	);
}

/// The WeChat QR card: the image (or the stage), the stage word, and the two
/// session actions.
fn wechat_login(ui: &mut Ui, shell: &mut Shell, view: &View) {
	let stage = view.wechat_stage();
	let url = view.qr.url.clone();
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 108.0), Sense::hover());
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.max.y - 0.5), pos2(rect.max.x, rect.max.y - 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	ui.painter().text(
		pos2(rect.min.x, rect.min.y + 4.0),
		egui::Align2::LEFT_TOP,
		t!("微信登录"),
		FontId::new(12.5, egui::FontFamily::Proportional),
		theme::TEXT,
	);

	let qr_rect = Rect::from_min_size(pos2(rect.min.x, rect.min.y + 18.0), vec2(88.0, 88.0));
	match url {
		Some(url) => {
			if let Some((texture, _source)) = shell.channels.qr_texture(ui.ctx(), &url, shell.probe) {
				ui.painter().image(
					texture.id(),
					qr_rect,
					Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
					Color32::WHITE,
				);
			} else {
				ui.painter()
					.rect_filled(qr_rect, CornerRadius::same(6), theme::PANEL_3);
				ui.painter().text(
					qr_rect.center(),
					egui::Align2::CENTER_CENTER,
					t!("二维码加载中…"),
					FontId::new(10.5, egui::FontFamily::Proportional),
					theme::TEXT_3,
				);
			}
		},
		None => {
			ui.painter()
				.rect_filled(qr_rect, CornerRadius::same(6), theme::PANEL_3);
		},
	}

	let text_left = qr_rect.max.x + 14.0;
	let stage_line = stage.label();
	ui.painter().text(
		pos2(text_left, rect.min.y + 30.0),
		egui::Align2::LEFT_CENTER,
		stage_line,
		FontId::new(12.0, egui::FontFamily::Proportional),
		if stage == QrStage::Connected {
			theme::TEXT
		} else {
			theme::TEXT_2
		},
	);
	if let Some(error) = shell.channels.qr_error().map(str::to_owned) {
		truncated_text(
			ui,
			pos2(text_left, rect.min.y + 48.0),
			&t!("读取二维码失败：{}", error),
			10.5,
			theme::WARN,
			rect.max.x - text_left,
		);
	}
	let button_width = 84.0;
	let reconnect =
		Rect::from_min_size(pos2(text_left, rect.min.y + 62.0), vec2(button_width, 24.0));
	if ui
		.put(reconnect, Button::new(egui::RichText::new(t!("重新连接")).size(11.0)))
		.clicked()
	{
		shell.channels.reconnect();
	}
	let unbind = Rect::from_min_size(
		pos2(text_left + button_width + 8.0, rect.min.y + 62.0),
		vec2(button_width, 24.0),
	);
	if ui
		.put(unbind, Button::new(egui::RichText::new(t!("解绑")).size(11.0)))
		.clicked()
	{
		shell.channels.unbind();
	}
}

/// Workspace routing: per-channel default roots, the alias registry, and the
/// per-chat bindings.
fn routing(ui: &mut Ui, shell: &mut Shell, view: &View) {
	head(ui, t!("工作区路由"));
	hint(
		ui,
		t!("别名 → 目录。IM 里用 @workspace use <别名> 或 *<别名> 切换；绑定优先于渠道默认目录。"),
	);
	for id in ChannelId::ALL {
		let current = view.channel(id).workspace_root.clone();
		let key = format!("root.{}", id.key());
		field_row(
			ui,
			&t!("默认目录 · {}", id.label()),
			"workspaceRoot",
			move |ui, shell| {
				let save = small_button(ui, t!("保存"));
				text_field(ui, shell, &key, &current, false, 220.0, "/abs/path");
				if save.clicked() {
					let value = shell.channels.edit(&key, &current).trim().to_owned();
					shell
						.channels
						.commit(&format!("channels.{}.workspaceRoot", id.key()), Value::String(value));
				}
			},
			shell,
		);
	}

	compact_note(ui, t!("工作区注册表 · remote.workspaces"));
	for (index, workspace) in view.workspaces.iter().enumerate() {
		workspace_row(ui, shell, index, workspace);
	}
	add_workspace_row(ui, shell, &view.workspaces);

	compact_note(ui, t!("会话绑定 · remote.sessionMappings"));
	for binding in &view.bindings {
		binding_row(ui, shell, binding);
	}
	add_binding_row(ui, shell, view);
}

/// One alias registry row: alias, directory, save, remove.
fn workspace_row(ui: &mut Ui, shell: &mut Shell, index: usize, workspace: &Workspace) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 30.0), Sense::hover());
	ui.painter().text(
		pos2(rect.min.x, rect.center().y),
		egui::Align2::LEFT_CENTER,
		t!("工作区 {}", index + 1),
		FontId::new(11.5, egui::FontFamily::Proportional),
		theme::TEXT,
	);
	let alias_key = format!("workspace.{index}.alias");
	let path_key = format!("workspace.{index}.path");
	let mut child = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_size(
				pos2(rect.min.x + 120.0, rect.min.y + 3.0),
				vec2(rect.width() - 120.0, 24.0),
			))
			.layout(Layout::left_to_right(Align::Center)),
	);
	text_field(&mut child, shell, &alias_key, &workspace.alias, false, 72.0, t!("别名"));
	text_field(&mut child, shell, &path_key, &workspace.path, false, 220.0, t!("目录"));
	if small_button(&mut child, t!("保存")).clicked() {
		let alias = shell
			.channels
			.edit(&alias_key, &workspace.alias)
			.trim()
			.to_owned();
		let path = shell
			.channels
			.edit(&path_key, &workspace.path)
			.trim()
			.to_owned();
		match channels::replace_workspace(
			&shell
				.channels
				.view()
				.map(|v| v.workspaces.clone())
				.unwrap_or_default(),
			index,
			&alias,
			&path,
		) {
			Ok(entries) => shell
				.channels
				.commit("remote.workspaces", channels::workspaces_value(&entries)),
			Err(error) => shell.state.show(crate::state::Notice(error)),
		}
	}
	if small_button(&mut child, t!("移除")).clicked() {
		let entries = channels::remove_workspace(
			&shell
				.channels
				.view()
				.map(|v| v.workspaces.clone())
				.unwrap_or_default(),
			&workspace.alias,
		);
		shell
			.channels
			.commit("remote.workspaces", channels::workspaces_value(&entries));
	}
}

/// The alias registry's add row.
fn add_workspace_row(ui: &mut Ui, shell: &mut Shell, workspaces: &[Workspace]) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 30.0), Sense::hover());
	let mut child = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_size(
				pos2(rect.min.x + 120.0, rect.min.y + 3.0),
				vec2(rect.width() - 120.0, 24.0),
			))
			.layout(Layout::left_to_right(Align::Center)),
	);
	text_field(&mut child, shell, "workspace.new.alias", "", false, 72.0, t!("别名"));
	text_field(&mut child, shell, "workspace.new.path", "", false, 220.0, t!("目录"));
	if small_button(&mut child, t!("添加")).clicked() {
		let alias = shell
			.channels
			.edit("workspace.new.alias", "")
			.trim()
			.to_owned();
		let path = shell
			.channels
			.edit("workspace.new.path", "")
			.trim()
			.to_owned();
		match channels::upsert_workspace(workspaces, &alias, &path) {
			Ok(entries) => {
				shell
					.channels
					.commit("remote.workspaces", channels::workspaces_value(&entries));
				shell.channels.edit("workspace.new.alias", "").clear();
				shell.channels.edit("workspace.new.path", "").clear();
			},
			Err(error) => shell.state.show(crate::state::Notice(error)),
		}
	}
}

/// One chat binding row: channel, peer, alias, remove.
fn binding_row(ui: &mut Ui, shell: &mut Shell, binding: &Binding) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 28.0), Sense::hover());
	let label = format!(
		"{} · {} → {}",
		binding.platform.label(),
		binding.peer_label(),
		binding.workspace_alias
	);
	truncated_text(
		ui,
		pos2(rect.min.x, rect.center().y),
		&label,
		11.5,
		theme::TEXT_2,
		rect.width() - 64.0,
	);
	let remove = Rect::from_min_size(pos2(rect.max.x - 58.0, rect.min.y + 3.0), vec2(56.0, 22.0));
	if ui
		.put(remove, Button::new(egui::RichText::new(t!("移除")).size(10.5)))
		.clicked()
	{
		let entries = channels::remove_binding(
			shell.channels.view().unwrap_or(&View::default()),
			binding.platform,
			&binding.chat_id,
			binding.user_id.as_deref(),
		);
		shell
			.channels
			.commit("remote.sessionMappings", channels::bindings_value(&entries));
	}
}

/// The binding add row: channel, peer, alias, add.
fn add_binding_row(ui: &mut Ui, shell: &mut Shell, view: &View) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 30.0), Sense::hover());
	let mut child = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_size(
				pos2(rect.min.x + 120.0, rect.min.y + 3.0),
				vec2(rect.width() - 120.0, 24.0),
			))
			.layout(Layout::left_to_right(Align::Center)),
	);
	let mut channel = shell.channels.binding_channel();
	egui::ComboBox::from_id_salt("binding-channel")
		.selected_text(channel.label())
		.width(84.0)
		.show_ui(&mut child, |ui| {
			for id in ChannelId::ALL {
				ui.selectable_value(&mut channel, id, id.label());
			}
		});
	shell.channels.set_binding_channel(channel);
	text_field(&mut child, shell, "binding.new.peer", "", false, 96.0, t!("对端"));
	text_field(&mut child, shell, "binding.new.alias", "", false, 78.0, t!("别名"));
	if small_button(&mut child, t!("添加")).clicked() {
		let peer = shell
			.channels
			.edit("binding.new.peer", "")
			.trim()
			.to_owned();
		let alias = shell
			.channels
			.edit("binding.new.alias", "")
			.trim()
			.to_owned();
		match channels::add_binding(view, channel, &peer, None, &alias) {
			Ok(entries) => {
				shell
					.channels
					.commit("remote.sessionMappings", channels::bindings_value(&entries));
				shell.channels.edit("binding.new.peer", "").clear();
				shell.channels.edit("binding.new.alias", "").clear();
			},
			Err(error) => shell.state.show(crate::state::Notice(error)),
		}
	}
}

/// Feishu and Telegram credentials, with one explicit save.
fn credentials(ui: &mut Ui, shell: &mut Shell, view: &View) {
	head(ui, t!("凭据"));
	hint(ui, t!("保存后经 PUT /api/web-config 写入，再从 GET 重新读取；留空的秘密字段保持不变。"));

	let feishu = view.channel(ChannelId::Feishu).clone();
	compact_note(ui, t!("飞书 / Lark"));
	let app_id_seed = feishu.app_id.clone();
	field_row(
		ui,
		t!("App ID"),
		"channels.feishu.appId",
		move |ui, shell| {
			text_field(ui, shell, "feishu.appId", &app_id_seed, false, 220.0, "cli_…");
		},
		shell,
	);
	let secret_hint = feishu.app_secret.label();
	field_row(
		ui,
		t!("App Secret"),
		secret_hint,
		|ui, shell| {
			text_field(ui, shell, "feishu.appSecret", "", true, 220.0, "••••");
		},
		shell,
	);
	let domain_seed = feishu.domain.clone();
	field_row(
		ui,
		t!("域名"),
		"feishu · lark",
		move |ui, shell| {
			let mut value = shell.channels.edit("feishu.domain", &domain_seed).clone();
			egui::ComboBox::from_id_salt("feishu-domain")
				.selected_text(value.clone())
				.width(180.0)
				.show_ui(ui, |ui| {
					ui.selectable_value(&mut value, "feishu".to_owned(), t!("飞书"));
					ui.selectable_value(&mut value, "lark".to_owned(), "Lark");
				});
			let draft = shell.channels.edit("feishu.domain", &domain_seed);
			draft.clear();
			draft.push_str(&value);
		},
		shell,
	);
	if credential_save_row(ui, t!("保存飞书凭据")) {
		let app_id = shell
			.channels
			.edit("feishu.appId", &feishu.app_id)
			.trim()
			.to_owned();
		let secret = shell
			.channels
			.edit("feishu.appSecret", "")
			.trim()
			.to_owned();
		let domain = shell
			.channels
			.edit("feishu.domain", &feishu.domain)
			.trim()
			.to_owned();
		let mut fields: Vec<(String, Value)> = Vec::new();
		if app_id != feishu.app_id {
			fields.push(("channels.feishu.appId".to_owned(), Value::String(app_id)));
		}
		if !secret.is_empty() {
			fields.push(("channels.feishu.appSecret".to_owned(), Value::String(secret)));
		}
		if domain != feishu.domain {
			fields.push(("channels.feishu.domain".to_owned(), Value::String(domain)));
		}
		shell.channels.commit_fields(fields);
	}

	let telegram = view.channel(ChannelId::Telegram).clone();
	compact_note(ui, "Telegram");
	field_row(
		ui,
		t!("Bot Token"),
		telegram.bot_token.label(),
		move |ui, shell| {
			text_field(ui, shell, "telegram.botToken", "", true, 220.0, "123:ABC");
		},
		shell,
	);
	if credential_save_row(ui, t!("保存 Telegram 凭据")) {
		let token = shell
			.channels
			.edit("telegram.botToken", "")
			.trim()
			.to_owned();
		if !token.is_empty() {
			shell
				.channels
				.commit("channels.telegram.botToken", Value::String(token));
		}
	}
}

fn credential_save_row(ui: &mut Ui, label: &str) -> bool {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 28.0), Sense::hover());
	ui.put(
		Rect::from_min_size(pos2(rect.min.x, rect.min.y + 2.0), vec2(120.0, 24.0)),
		Button::new(egui::RichText::new(label).size(11.0)),
	)
	.clicked()
}

/// Send a test message through `POST /api/channels/send`; the failure kind is
/// the route's own (`unknown-channel` / `unpaired` / `failed`).
fn send_test(ui: &mut Ui, shell: &mut Shell) {
	head(ui, t!("发送测试 · POST /api/channels/send"));
	hint(ui, t!("对端是渠道里的会话 id；未配对的会话不会被凭空建立。"));
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 32.0), Sense::hover());
	let mut child = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_size(
				pos2(rect.min.x + 120.0, rect.min.y + 4.0),
				vec2(rect.width() - 120.0, 24.0),
			))
			.layout(Layout::left_to_right(Align::Center)),
	);
	let mut channel = shell.channels.send_channel();
	egui::ComboBox::from_id_salt("send-channel")
		.selected_text(channel.label())
		.width(84.0)
		.show_ui(&mut child, |ui| {
			for id in ChannelId::ALL {
				ui.selectable_value(&mut channel, id, id.label());
			}
		});
	shell.channels.set_send_channel(channel);
	child.add(
		TextEdit::singleline(shell.channels.send_peer_mut())
			.desired_width(110.0)
			.font(FontId::new(11.0, egui::FontFamily::Monospace))
			.hint_text(t!("对端")),
	);
	child.add(
		TextEdit::singleline(shell.channels.send_text_mut())
			.desired_width(180.0)
			.font(FontId::new(11.0, egui::FontFamily::Monospace))
			.hint_text(t!("消息")),
	);
	if small_button(&mut child, t!("发送")).clicked() {
		let peer = shell.channels.send_peer_mut().clone();
		let text = shell.channels.send_text_mut().clone();
		shell.channels.send(channel, &peer, &text);
	}
	if let Some(outcome) = shell.channels.send_result() {
		compact_note_colored(
			ui,
			&outcome.line(),
			if outcome.is_ok() {
				theme::TEXT_2
			} else {
				theme::WARN
			},
		);
	}
}

// ── small layout helpers ──────────────────────────────────────────────────

/// Label + hint on the left, a right-aligned control, in 34 points.
fn field_row(
	ui: &mut Ui,
	label: &str,
	hint_text: &str,
	control: impl FnOnce(&mut Ui, &mut Shell),
	shell: &mut Shell,
) {
	let height = 34.0;
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), height), Sense::hover());
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.max.y - 0.5), pos2(rect.max.x, rect.max.y - 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	ui.painter().text(
		pos2(rect.min.x, rect.min.y + 3.0),
		egui::Align2::LEFT_TOP,
		label,
		FontId::new(12.0, egui::FontFamily::Proportional),
		theme::TEXT,
	);
	if !hint_text.is_empty() {
		truncated_text(
			ui,
			pos2(rect.min.x, rect.min.y + 24.0),
			hint_text,
			9.5,
			theme::TEXT_3,
			rect.width() - 310.0,
		);
	}
	let control_rect =
		Rect::from_min_size(pos2(rect.max.x - 300.0, rect.min.y + 4.0), vec2(300.0, 26.0));
	let mut child = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(control_rect)
			.layout(Layout::right_to_left(Align::Center)),
	);
	control(&mut child, shell);
}

/// One text draft in a row. `secret` masks the value; `seed` is used once.
fn text_field(
	ui: &mut Ui,
	shell: &mut Shell,
	key: &str,
	seed: &str,
	secret: bool,
	width: f32,
	placeholder: &str,
) {
	let mut edit = TextEdit::singleline(shell.channels.edit(key, seed))
		.desired_width(width)
		.font(FontId::new(11.0, egui::FontFamily::Monospace))
		.hint_text(placeholder);
	if secret {
		edit = edit.password(true);
	}
	ui.add(edit);
}

/// A small non-row note.
fn compact_note(ui: &mut Ui, text: &str) {
	compact_note_colored(ui, text, theme::TEXT_3);
}

fn compact_note_colored(ui: &mut Ui, text: &str, color: Color32) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 18.0), Sense::hover());
	truncated_text(ui, pos2(rect.min.x, rect.center().y), text, 10.5, color, rect.width());
}
