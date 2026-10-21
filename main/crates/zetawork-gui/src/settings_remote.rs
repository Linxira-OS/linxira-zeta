// SPDX-License-Identifier: AGPL-3.0-only
//! 设置 → 远程访问: the pane, its worker jobs, and the pairing QR.
//!
//! The model and every wire rule live in [`crate::remote_access`]; this module
//! owns what a UI thread must: the last [`RemoteView`], a small set of
//! short-lived worker jobs (nothing here may block `update` on a socket), the
//! text drafts, the one-time rotated token, and the QR texture.
//!
//! The pane is read on open and after every write — never on a poll. Remote
//! access changes only when the user changes it, so a timer would repaint a
//! static page and re-dial the gateway for nothing.
//!
//! Secrets: the config's token is only ever a [`SecretState`]; the pairing
//! payload is handed straight to the encoder and never drawn; a rotate result
//! is shown once, with the sentence that says so, and is dropped on the next
//! read.

use std::{
	sync::mpsc::{self, Receiver, TryRecvError},
	time::Duration,
};

use egui::{Button, Color32, FontId, Layout, Rect, Sense, TextEdit, Ui, pos2, vec2};
use serde_json::Value;

use crate::{
	Shell,
	channels::{self, HttpTransport, QrImage, QrSource},
	remote_access::{self, Change, Pairing, RemoteView, SecretState},
	settings_ui::{head, hint, plain_row, switch},
	t, theme,
	widgets::truncated_text,
};

/// The step the QR raster is drawn at, matching the IM pane's code.
const QR_SIDE: f32 = 148.0;

/// A cached QR raster for one payload.
struct QrTexture {
	payload: String,
	texture: egui::TextureHandle,
}

/// The finished work of one worker thread.
enum Event {
	Loaded { result: Result<Box<RemoteView>, String>, from_write: bool },
	Rotated(Result<(String, Box<RemoteView>), String>),
}

/// The pane's state. `Default` is the inert panel a headless shell gets.
#[derive(Default)]
pub struct RemotePanel {
	view: Option<RemoteView>,
	/// The last read/write failure (a failed read keeps the old view).
	error: Option<String>,
	/// The last write's line: `true` = saved, `false` = the error text.
	notice: Option<(bool, String)>,
	/// What a write is doing, for the action labels.
	pending: Option<String>,
	jobs: Vec<Receiver<Event>>,
	visible: bool,
	was_visible: bool,
	/// `http://127.0.0.1:PORT` from `~/.zeta/serve.json`'s `webUrl`.
	origin: Option<String>,
	origin_error: Option<String>,
	/// Text-field drafts, keyed by a stable row id.
	edits: Vec<(String, String)>,
	/// The plaintext token a rotate returned, shown once.
	new_token: Option<String>,
	qr: Option<QrTexture>,
	qr_error: Option<String>,
}

impl RemotePanel {
	pub fn view(&self) -> Option<&RemoteView> {
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

	pub fn new_token(&self) -> Option<&str> {
		self.new_token.as_deref()
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

	/// Replace one draft (a successful save re-seeds from the gateway).
	pub fn set_edit(&mut self, key: &str, value: &str) {
		match self.edits.iter_mut().find(|(id, _)| id == key) {
			Some((_, draft)) => *draft = value.to_owned(),
			None => self.edits.push((key.to_owned(), value.to_owned())),
		}
	}

	/// A headless fixture for the screenshot test: the pane draws exactly what
	/// a live read would have produced.
	pub fn show_fixture(&mut self, view: RemoteView) {
		self.view = Some(view);
		self.error = None;
		self.origin = Some("http://127.0.0.1:30141".to_owned());
		self.origin_error = None;
	}

	/// The settings pane became (in)active.
	pub fn set_visible(&mut self, visible: bool) {
		self.visible = visible;
	}

	/// Per-frame work: drain finished jobs and read the pane when it opens.
	pub fn tick(&mut self, ctx: &egui::Context, probe: bool) {
		let changed = self.drain();
		if changed {
			ctx.request_repaint();
		}
		// A job runs on a worker; keep frames coming so its answer is applied
		// as soon as it lands, without a poll timer.
		if !self.jobs.is_empty() {
			ctx.request_repaint_after(Duration::from_millis(100));
		}
		let opened = self.visible && !self.was_visible;
		self.was_visible = self.visible;
		if !opened || !probe {
			return;
		}
		self.refresh();
	}

	/// Re-read config + pairing now.
	pub fn refresh(&mut self) {
		self.spawn_load(false);
	}

	/// `PUT` the changed paths, then re-read.
	pub fn save(&mut self, changes: Vec<Change>) {
		if changes.is_empty() {
			return;
		}
		let Some(origin) = self.ensure_origin() else {
			return;
		};
		self.notice = None;
		self.pending = Some(t!("保存中…").to_owned());
		let (tx, rx) = mpsc::channel();
		self.jobs.push(rx);
		std::thread::spawn(move || {
			let result = match HttpTransport::new(&origin) {
				Ok(transport) => remote_access::commit(&transport, &changes),
				Err(error) => Err(error),
			};
			let _ = tx.send(Event::Loaded { result: result.map(Box::new), from_write: true });
		});
	}

	/// Mint a new token; the answer's plaintext is the only copy this process
	/// keeps, and it is shown once.
	pub fn rotate(&mut self) {
		let Some(origin) = self.ensure_origin() else {
			return;
		};
		self.pending = Some(t!("轮换中…").to_owned());
		self.notice = None;
		self.new_token = None;
		let (tx, rx) = mpsc::channel();
		self.jobs.push(rx);
		std::thread::spawn(move || {
			let result = (|| {
				let transport = HttpTransport::new(&origin)?;
				let token = remote_access::rotate(&transport)?;
				let view = remote_access::load(&transport)?;
				Ok((token, Box::new(view)))
			})();
			let _ = tx.send(Event::Rotated(result));
		});
	}

	/// Revoke every token, then re-read (the QR disappears with it).
	pub fn revoke(&mut self) {
		let Some(origin) = self.ensure_origin() else {
			return;
		};
		self.pending = Some(t!("撤销中…").to_owned());
		self.notice = None;
		self.new_token = None;
		let (tx, rx) = mpsc::channel();
		self.jobs.push(rx);
		std::thread::spawn(move || {
			let result = match HttpTransport::new(&origin) {
				Ok(transport) => remote_access::revoke_all(&transport),
				Err(error) => Err(error),
			};
			let _ = tx.send(Event::Loaded { result: result.map(Box::new), from_write: true });
		});
	}

	/// Forget the one-time token (the row's 知道了 action).
	pub fn dismiss_token(&mut self) {
		self.new_token = None;
	}

	/// The QR texture for a pairing payload, encoded locally on first use.
	pub fn qr_texture(&mut self, ctx: &egui::Context, payload: &str) -> Option<egui::TextureHandle> {
		if let Some(cached) = &self.qr {
			if cached.payload == payload {
				return Some(cached.texture.clone());
			}
		}
		match channels::encode_qr(payload) {
			Ok(image) => {
				let texture = upload(ctx, payload, image);
				self.qr = Some(QrTexture { payload: payload.to_owned(), texture });
				self.qr_error = None;
				self.qr.as_ref().map(|cached| cached.texture.clone())
			},
			Err(error) => {
				self.qr = None;
				self.qr_error = Some(error);
				None
			},
		}
	}

	pub fn qr_source(&self) -> Option<QrSource> {
		self.qr.as_ref().map(|_| QrSource::Encoded)
	}

	pub fn qr_error(&self) -> Option<&str> {
		self.qr_error.as_deref()
	}

	fn spawn_load(&mut self, from_write: bool) {
		if !self.jobs.is_empty() {
			return;
		}
		let Some(origin) = self.ensure_origin() else {
			return;
		};
		let (tx, rx) = mpsc::channel();
		self.jobs.push(rx);
		std::thread::spawn(move || {
			let result = match HttpTransport::new(&origin) {
				Ok(transport) => remote_access::load(&transport),
				Err(error) => Err(error),
			};
			let _ = tx.send(Event::Loaded { result: result.map(Box::new), from_write });
		});
	}

	fn drain(&mut self) -> bool {
		let mut changed = false;
		let mut index = 0;
		while index < self.jobs.len() {
			let finished = match self.jobs[index].try_recv() {
				Ok(event) => {
					self.apply(event);
					changed = true;
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
		changed
	}

	fn apply(&mut self, event: Event) {
		match event {
			Event::Loaded { result, from_write } => {
				if from_write {
					self.pending = None;
				}
				match result {
					Ok(view) => {
						let view = *view;
						// Re-seed the drafts from the gateway's answer, so the
						// rows never show text the file no longer holds.
						for (key, value) in [
							("host", &view.host),
							("public-url", &view.public_url),
							("tls-cert", &view.tls_cert),
							("tls-key", &view.tls_key),
						] {
							if self.edits.iter().any(|(id, _)| id == key) {
								self.set_edit(key, value);
							}
						}
						self.view = Some(view);
						self.error = None;
						// Any newer read supersedes the rotate answer's one-time
						// token; it must not outlive the view it belonged to.
						self.new_token = None;
						if from_write {
							self.notice = Some((true, t!("已保存").to_owned()));
						}
						// A stale QR belongs to the previous payload.
						self.qr = None;
					},
					Err(error) => {
						self.error = Some(error.clone());
						if from_write {
							self.notice = Some((false, t!("保存失败：{}", error)));
						}
					},
				}
			},
			Event::Rotated(result) => {
				self.pending = None;
				match result {
					Ok((token, view)) => {
						self.view = Some(*view);
						self.error = None;
						self.notice = Some((true, t!("已轮换令牌；旧令牌立即失效").to_owned()));
						self.new_token = Some(token);
						self.qr = None;
					},
					Err(error) => {
						self.error = Some(error.clone());
						self.notice = Some((false, t!("轮换失败：{}", error)));
					},
				}
			},
		}
	}

	fn ensure_origin(&mut self) -> Option<String> {
		if let Some(origin) = &self.origin {
			return Some(origin.clone());
		}
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
}

/// Upload a QR raster into a texture.
fn upload(ctx: &egui::Context, payload: &str, image: QrImage) -> egui::TextureHandle {
	let color = egui::ColorImage::from_rgba_unmultiplied(
		[image.width as usize, image.height as usize],
		&image.rgba,
	);
	ctx.load_texture(
		format!("zetawork-remote-qr-{}", payload.len()),
		color,
		egui::TextureOptions::NEAREST,
	)
}

// ── the pane ──────────────────────────────────────────────────────────────

/// Draw 设置 → 远程访问.
pub fn section(ui: &mut Ui, shell: &mut Shell) {
	head(ui, t!("远程访问"));
	hint(
		ui,
		t!(
			"由 zetacode serve 的网关读写 ~/.zeta/agent/web.yml；令牌只显示是否已保存，明文只在轮换时出现一次。"
		),
	);
	compact_note(ui, &t!("网关：{}", shell.remote_access.origin_line()));
	if let Some(pending) = shell.remote_access.pending().map(str::to_owned) {
		compact_note(ui, &pending);
	}
	if let Some(notice) = shell.remote_access.notice().cloned() {
		compact_note_colored(ui, &notice.1, if notice.0 { theme::TEXT_2 } else { theme::WARN });
	}
	if let Some(error) = shell.remote_access.error().map(str::to_owned) {
		compact_note_colored(ui, &t!("远程访问加载失败：{}", error), theme::WARN);
	}

	let Some(view) = shell.remote_access.view().cloned() else {
		hint(ui, t!("正在读取远程访问配置…"));
		return;
	};

	bind_section(ui, shell, &view);
	tls_section(ui, shell, &view);
	plain_http_row(ui, shell, &view);
	token_section(ui, shell, &view);
	pairing_section(ui, shell, &view);
	ui.add_space(16.0);
}

/// 绑定: the bind host and the public URL a phone reaches.
fn bind_section(ui: &mut Ui, shell: &mut Shell, view: &RemoteView) {
	head(ui, t!("绑定"));
	text_row(ui, shell, "host", t!("绑定地址"), &view.host, t!("留空 = serve 默认（仅本机回环）"));
	text_row(
		ui,
		shell,
		"public-url",
		t!("公网地址"),
		&view.public_url,
		t!("手机访问的基址（反向代理 / 隧道）；不用于绑定"),
	);
	let host = shell.remote_access.edit("host", &view.host).clone();
	let public_url = shell
		.remote_access
		.edit("public-url", &view.public_url)
		.clone();
	if save_button(
		ui,
		t!("保存绑定"),
		(host.as_str(), public_url.as_str()) != (view.host.as_str(), view.public_url.as_str()),
	) {
		shell
			.remote_access
			.save(remote_access::host_fields(&host, &public_url));
	}
}

/// TLS: enablement plus the PEM and key paths.
fn tls_section(ui: &mut Ui, shell: &mut Shell, view: &RemoteView) {
	head(ui, t!("TLS"));
	let mut enabled = view.tls_enabled;
	if field_row(
		ui,
		t!("启用 TLS"),
		view.tls_label(),
		|ui, _shell| {
			switch(ui, &mut enabled);
			enabled != view.tls_enabled
		},
		shell,
	) {
		shell
			.remote_access
			.save(vec![("remote.tls.enabled".to_owned(), Value::Bool(enabled))]);
	}
	text_row(ui, shell, "tls-cert", t!("证书（PEM）"), &view.tls_cert, t!("证书文件路径"));
	text_row(ui, shell, "tls-key", t!("私钥（PEM）"), &view.tls_key, t!("私钥文件路径"));
	let cert = shell.remote_access.edit("tls-cert", &view.tls_cert).clone();
	let key = shell.remote_access.edit("tls-key", &view.tls_key).clone();
	let changed = (cert.as_str(), key.as_str()) != (view.tls_cert.as_str(), view.tls_key.as_str());
	if save_button(ui, t!("保存 TLS"), changed) {
		shell
			.remote_access
			.save(remote_access::tls_fields(view.tls_enabled, &cert, &key));
	}
}

/// 明文 HTTP: the one opt-in that lets a non-loopback bind serve HTTP.
fn plain_http_row(ui: &mut Ui, shell: &mut Shell, view: &RemoteView) {
	let mut allow = view.allow_plain_http;
	if field_row(
		ui,
		t!("允许明文 HTTP"),
		view.plain_label(),
		|ui, _shell| {
			switch(ui, &mut allow);
			allow != view.allow_plain_http
		},
		shell,
	) {
		shell
			.remote_access
			.save(vec![("remote.allowPlainHttp".to_owned(), Value::Bool(allow))]);
	}
}

/// 令牌: whether one is stored, when it changed, and the two lifecycle actions.
fn token_section(ui: &mut Ui, shell: &mut Shell, view: &RemoteView) {
	head(ui, t!("令牌"));
	let state = match view.token {
		SecretState::Stored => t!("已保存"),
		SecretState::Unset => t!("未设置"),
	};
	plain_row(ui, t!("远程令牌"), state, t!("GET /api/web-config 只返回掩码"));
	if let Some(updated) = &view.token_updated_at {
		plain_row(ui, t!("更新时间"), updated, t!("最近一次轮换或撤销"));
	}
	ui.horizontal(|ui| {
		if ui.add(Button::new(t!("轮换令牌"))).clicked() {
			shell.remote_access.rotate();
		}
		if ui.add(Button::new(t!("撤销全部令牌"))).clicked() {
			shell.remote_access.revoke();
		}
	});
	if let Some(token) = shell.remote_access.new_token().map(str::to_owned) {
		hint(ui, t!("新令牌只显示这一次；请现在保存，离开后不会再显示。"));
		let mut shown = token.clone();
		ui.horizontal(|ui| {
			ui.add(
				TextEdit::singleline(&mut shown)
					.desired_width(320.0)
					.font(FontId::new(11.0, egui::FontFamily::Monospace))
					.interactive(false),
			);
			if ui.add(Button::new(t!("复制"))).clicked() {
				ui.ctx().copy_text(token.clone());
			}
			if ui.add(Button::new(t!("知道了"))).clicked() {
				shell.remote_access.dismiss_token();
			}
		});
	}
}

/// 配对码: the payload's QR, encoded locally, and the URL it points at.
fn pairing_section(ui: &mut Ui, shell: &mut Shell, view: &RemoteView) {
	head(ui, t!("配对码"));
	let Some(pairing) = view.pairing.clone() else {
		if let Some(error) = &view.pairing_error {
			hint(ui, &t!("配对码不可用：{}", error));
		} else if view.token == SecretState::Unset {
			hint(ui, t!("先轮换或配置令牌，配对码才有内容。"));
		} else {
			hint(ui, t!("正在读取配对码…"));
		}
		return;
	};
	let texture = shell.remote_access.qr_texture(ui.ctx(), &pairing.payload);
	match texture {
		Some(texture) => {
			let (rect, _) = ui.allocate_exact_size(vec2(QR_SIDE, QR_SIDE), Sense::hover());
			ui.painter().image(
				texture.id(),
				rect,
				Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
				Color32::WHITE,
			);
			ui.add_space(6.0);
			pairing_url(ui, &pairing);
		},
		None => {
			if let Some(error) = shell.remote_access.qr_error() {
				hint(ui, &t!("配对码无法生成：{}", error));
			}
		},
	}
}

/// The URL a phone should reach, shown beside the code.
fn pairing_url(ui: &mut Ui, pairing: &Pairing) {
	if pairing.url.is_empty() {
		return;
	}
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 20.0), Sense::hover());
	truncated_text(
		ui,
		pos2(rect.min.x + 2.0, rect.center().y),
		&pairing.url,
		11.0,
		theme::TEXT_2,
		rect.width() - 4.0,
	);
}

/// One label + hint row with a text field.
fn text_row(ui: &mut Ui, shell: &mut Shell, key: &str, label: &str, seed: &str, hint_text: &str) {
	let width = 300.0;
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 34.0), Sense::hover());
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.max.y - 0.5), pos2(rect.max.x, rect.max.y - 0.5)],
		egui::Stroke::new(1.0_f32, theme::BORDER),
	);
	ui.painter().text(
		pos2(rect.min.x, rect.min.y + 3.0),
		egui::Align2::LEFT_TOP,
		label,
		FontId::new(12.0, egui::FontFamily::Proportional),
		theme::TEXT,
	);
	truncated_text(
		ui,
		pos2(rect.min.x, rect.min.y + 24.0),
		hint_text,
		9.5,
		theme::TEXT_3,
		rect.width() - width - 10.0,
	);
	let control_rect =
		Rect::from_min_size(pos2(rect.max.x - width, rect.min.y + 4.0), vec2(width, 26.0));
	let mut child = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(control_rect)
			.layout(Layout::right_to_left(egui::Align::Center)),
	);
	child.add(
		TextEdit::singleline(shell.remote_access.edit(key, seed))
			.desired_width(width)
			.font(FontId::new(11.0, egui::FontFamily::Monospace)),
	);
}

/// A row whose control reports whether it changed this frame.
fn field_row(
	ui: &mut Ui,
	label: &str,
	hint_text: &str,
	control: impl FnOnce(&mut Ui, &mut Shell) -> bool,
	shell: &mut Shell,
) -> bool {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 34.0), Sense::hover());
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.max.y - 0.5), pos2(rect.max.x, rect.max.y - 0.5)],
		egui::Stroke::new(1.0_f32, theme::BORDER),
	);
	ui.painter().text(
		pos2(rect.min.x, rect.min.y + 3.0),
		egui::Align2::LEFT_TOP,
		label,
		FontId::new(12.0, egui::FontFamily::Proportional),
		theme::TEXT,
	);
	truncated_text(
		ui,
		pos2(rect.min.x, rect.min.y + 24.0),
		hint_text,
		9.5,
		theme::TEXT_3,
		rect.width() - 150.0,
	);
	let control_rect =
		Rect::from_min_size(pos2(rect.max.x - 120.0, rect.min.y + 4.0), vec2(120.0, 26.0));
	let mut child = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(control_rect)
			.layout(Layout::right_to_left(egui::Align::Center)),
	);
	control(&mut child, shell)
}

/// A right-aligned save button; disabled while nothing changed.
fn save_button(ui: &mut Ui, label: &str, changed: bool) -> bool {
	ui.horizontal(|ui| ui.add_enabled(changed, Button::new(label)).clicked())
		.inner
}

/// A small non-row note.
fn compact_note(ui: &mut Ui, text: &str) {
	compact_note_colored(ui, text, theme::TEXT_3);
}

fn compact_note_colored(ui: &mut Ui, text: &str, color: Color32) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 18.0), Sense::hover());
	truncated_text(ui, pos2(rect.min.x, rect.center().y), text, 10.5, color, rect.width());
}
