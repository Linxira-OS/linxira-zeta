// SPDX-License-Identifier: AGPL-3.0-only
//! The 用量 container: the stats the `packages/stats` server already holds.
//!
//! The left column's foot opens this container — the global roll-up. On Windows
//! the container body is a real WebView2 child window that loads the dashboard
//! `zetacode serve` serves (see [`crate::embed`]) and follows the container's
//! rectangle. This module is the *fallback*: when the child cannot attach —
//! another target, a missing WebView2 runtime, a failed attach — the same
//! endpoint's JSON is fetched and painted natively here, and the address bar
//! carries the reason in one line. The right column's 用量 tab is a different
//! page — the active conversation's own usage, see [`crate::conversation`].
//!
//! The data comes from the stats server `zetacode serve` runs on loopback —
//! the origin is discovered from `~/.zeta/serve.json` (see [`crate::stats`])
//! and the three requests are `/api/stats/overview`, `/api/stats/costs` and
//! `/api/status` (see [`api`], whose module docs carry the live response
//! shape).
//!
//! # No invented numbers
//!
//! The native panel is not a browser: it fetches the same JSON the dashboard's
//! client reads and paints cards, a token bar chart and an agent-type table
//! itself. The fetch runs on a worker thread and the last answer stays cached,
//! so opening the modal or switching ranges never blocks the window. When
//! nothing is listening, the body is one line — [`absent_line`] — naming
//! `zetacode serve` and the URL; there is no placeholder prose and no number
//! that did not come from the server.

mod api;

use crate::t;
use std::{
	sync::mpsc::{Receiver, TryRecvError, channel},
	time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

/// The one loopback `GET` this crate owns, shared with the conversation page's
/// live-window probe (`crate::conversation`).
pub(crate) use api::get as http_get;
pub use api::{CostRow, Costs, FetchError, Overview, Range, SeriesPoint, ServiceStatus, Snapshot};
use egui::{
	Align, Align2, Color32, CornerRadius, FontId, Layout, Order, Rect, Sense, Stroke, pos2, vec2,
};

use crate::{
	Shell,
	icons::{Icon, icon_button},
	theme,
	widgets::{truncated_text, truncated_text_center, truncated_text_right},
};

/// The dialog's size, clamped to the window.
const DIALOG: [f32; 2] = [980.0, 620.0];

/// A cached answer younger than this is shown as-is; older than this, opening
/// (or keeping) the modal starts a refresh.
pub const FRESH_FOR: Duration = Duration::from_secs(30);

/// After a failed read, wait this long before the open modal tries again — a
/// refused loopback connection is instant, but retrying every frame would spawn
/// one thread per frame.
const RETRY_AFTER: Duration = Duration::from_secs(5);

/// At most this many buckets are closed into a contiguous axis. A pathological
/// timestamp must not make the chart loop for years.
const MAX_BARS: i64 = 400;

/// The one line the panel shows when nothing is listening.
pub fn absent_line(url: &str) -> String {
	t!("stats 服务未启动：zetacode serve 未在监听 {}", url)
}

/// The URL this panel reads.
pub fn url(shell: &Shell) -> &str {
	shell.stats.usage_url()
}

/// One line naming the endpoint and where it came from, for the address bar and
/// for the tests.
pub fn endpoint_line(shell: &Shell) -> String {
	shell.stats.describe()
}

/// The worker's answer: a full snapshot or the reason there is none.
type Job = Result<Snapshot, FetchError>;

/// The last answer, the range it belongs to, and the one worker allowed at a
/// time.
///
/// [`Self::poll`] takes a finished answer once per frame; [`Self::ensure`]
/// starts a read when the cache is empty, belongs to another range, or is older
/// than [`FRESH_FOR`]. Nothing here touches a socket on the UI thread.
#[derive(Default)]
pub struct UsageCache {
	range: Range,
	job: Option<Receiver<Job>>,
	snapshot: Option<Snapshot>,
	error: Option<FetchError>,
	last_attempt: Option<Instant>,
}

impl UsageCache {
	/// A cache over captured response bodies (the screenshot test and the
	/// headless checks); no socket, no thread. The overview is required.
	pub fn fixture(overview: &str, costs: &str, status: &str, range: Range) -> Option<Self> {
		let overview = api::decode_overview(overview).ok()?;
		Some(Self {
			range,
			job: None,
			snapshot: Some(Snapshot {
				overview,
				costs: api::decode_costs(costs).ok(),
				status: api::decode_status(status).ok(),
				range,
				fetched_at: SystemTime::now(),
			}),
			error: None,
			last_attempt: None,
		})
	}

	/// The selected range.
	pub fn range(&self) -> Range {
		self.range
	}

	/// True while a worker is reading.
	pub fn loading(&self) -> bool {
		self.job.is_some()
	}

	/// The answer for the selected range, if it has landed.
	pub fn snapshot(&self) -> Option<&Snapshot> {
		self
			.snapshot
			.as_ref()
			.filter(|snapshot| snapshot.range == self.range)
	}

	/// The last failure, cleared when a read starts.
	pub fn error(&self) -> Option<&FetchError> {
		self.error.as_ref()
	}

	/// Select a range; a different one starts a read immediately.
	pub fn select(&mut self, range: Range, origin: &str) {
		if range == self.range {
			return;
		}
		self.range = range;
		self.start(origin);
	}

	/// Start a read if the cache is empty, from another range, or stale. Called
	/// once per frame while the modal is open.
	pub fn ensure(&mut self, origin: &str) {
		if self.job.is_some() {
			return;
		}
		let fresh = self
			.snapshot
			.as_ref()
			.is_some_and(|snapshot| snapshot.range == self.range && age(snapshot) < FRESH_FOR);
		if fresh {
			return;
		}
		let due = match &self.snapshot {
			Some(snapshot) if snapshot.range == self.range => true,
			_ => self
				.last_attempt
				.is_none_or(|at| at.elapsed() >= RETRY_AFTER),
		};
		if due {
			self.start(origin);
		}
	}

	/// Read again now — the reload button. An in-flight read is left alone.
	pub fn reload(&mut self, origin: &str) {
		if self.job.is_none() {
			self.start(origin);
		}
	}

	/// Take a finished answer. Returns true when the cache changed.
	pub fn poll(&mut self) -> bool {
		let Some(receiver) = self.job.as_ref() else {
			return false;
		};
		match receiver.try_recv() {
			Ok(Ok(snapshot)) => {
				self.job = None;
				self.snapshot = Some(snapshot);
				self.error = None;
				true
			},
			Ok(Err(error)) => {
				self.job = None;
				self.error = Some(error);
				true
			},
			Err(TryRecvError::Empty) => false,
			Err(TryRecvError::Disconnected) => {
				self.job = None;
				self.error = Some(FetchError::Io(t!("读取线程提前结束").to_owned()));
				true
			},
		}
	}

	fn start(&mut self, origin: &str) {
		let (sender, receiver) = channel();
		let origin = origin.to_owned();
		let range = self.range;
		self.job = Some(receiver);
		self.error = None;
		self.last_attempt = Some(Instant::now());
		std::thread::spawn(move || {
			let _ = sender.send(api::load(&origin, range));
		});
	}
}

/// How long ago `snapshot` landed; a clock that jumped backwards counts as
/// infinitely old, so the panel refreshes instead of trusting it.
fn age(snapshot: &Snapshot) -> Duration {
	snapshot.fetched_at.elapsed().unwrap_or(Duration::MAX)
}

/// What a click in the dialog asked for; `container` applies it after the
/// frame, when the cache is no longer borrowed by the painter.
#[derive(Default)]
struct Action {
	close: bool,
	reload: bool,
	select: Option<Range>,
	/// The container body in physical pixels; `Some` means the WebView2 child
	/// drew it and must be placed there.
	embed: Option<crate::embed::PixelRect>,
}

/// Draw the container, if it is open.
pub fn container(ctx: &egui::Context, shell: &mut Shell) {
	if !shell.state.usage_view_open() {
		// Unmap the WebView2 child: a hidden container must not leave a child
		// window holding keyboard focus.
		shell.embed.hide();
		return;
	}
	let _ = shell.usage.poll();
	let origin = shell.stats.origin().to_owned();
	let url = shell.stats.usage_url().to_owned();
	let address = shell.stats.describe();
	// `None` while the child window is live; otherwise the one line saying why
	// the native panel is drawing instead.
	let fallback = shell.embed.failure().map(str::to_owned);
	let embedded = fallback.is_none();
	let address = match &fallback {
		Some(reason) => t!("{} · 嵌入不可用：{}", address, reason),
		None => address,
	};
	shell.usage.ensure(&origin);
	let usage = &shell.usage;
	if usage.loading() {
		ctx.request_repaint_after(Duration::from_millis(100));
	}

	let screen = ctx.content_rect();
	let mut action = Action::default();
	egui::Area::new(egui::Id::new("zetawork-usage"))
		.order(Order::Foreground)
		.fixed_pos(screen.min)
		.show(ctx, |ui| {
			let (backdrop, backdrop_response) = ui.allocate_exact_size(screen.size(), Sense::click());
			ui.painter().rect_filled(
				backdrop,
				CornerRadius::ZERO,
				Color32::from_rgba_unmultiplied(3, 5, 8, 158),
			);
			if backdrop_response.clicked() {
				action.close = true;
			}
			let size =
				vec2(DIALOG[0].min(screen.width() - 48.0), DIALOG[1].min(screen.height() - 48.0));
			let dialog = Rect::from_center_size(screen.center(), size);
			let mut dialog_ui = ui.new_child(egui::UiBuilder::new().max_rect(dialog));
			egui::Frame::new()
				.fill(theme::PANEL)
				.stroke(Stroke::new(1.0_f32, theme::BORDER_2))
				.corner_radius(CornerRadius::same(theme::R_MODAL))
				.show(&mut dialog_ui, |ui| {
					let rect = ui.max_rect();
					ui.painter()
						.rect_filled(rect, CornerRadius::same(theme::R_MODAL), theme::PANEL);
					let head = Rect::from_min_size(rect.min, vec2(rect.width(), 52.0));
					ui.painter().line_segment(
						[pos2(head.min.x, head.max.y - 0.5), pos2(head.max.x, head.max.y - 0.5)],
						Stroke::new(1.0_f32, theme::BORDER),
					);
					ui.painter().text(
						pos2(head.min.x + 14.0, head.center().y),
						Align2::LEFT_CENTER,
						t!("用量统计"),
						FontId::new(14.0, egui::FontFamily::Proportional),
						theme::TEXT,
					);
					let range_hint = t!("{} 的 stats 汇总", usage.range().window());
					ui.painter().text(
						pos2(head.min.x + 86.0, head.center().y),
						Align2::LEFT_CENTER,
						range_hint,
						FontId::new(11.0, egui::FontFamily::Proportional),
						theme::TEXT_3,
					);
					let mut head_right = ui.new_child(
						egui::UiBuilder::new()
							.max_rect(head.shrink2(vec2(10.0, 12.0)))
							.layout(Layout::right_to_left(Align::Center)),
					);
					if icon_button(&mut head_right, Icon::X, 28.0, false, t!("关闭")).clicked() {
						action.close = true;
					}
					if icon_button(&mut head_right, Icon::Refresh, 28.0, false, t!("重新读取用量"))
						.clicked()
					{
						action.reload = true;
					}

					// The address bar: the real endpoint and its provenance.
					let bar =
						Rect::from_min_size(pos2(rect.min.x, head.max.y), vec2(rect.width(), 46.0));
					ui.painter()
						.rect_filled(bar, CornerRadius::ZERO, theme::PANEL_2);
					ui.painter().line_segment(
						[pos2(bar.min.x, bar.max.y - 0.5), pos2(bar.max.x, bar.max.y - 0.5)],
						Stroke::new(1.0_f32, theme::BORDER),
					);
					truncated_text(
						ui,
						pos2(bar.min.x + 14.0, bar.center().y - 8.0),
						&url,
						12.0,
						theme::TEXT,
						(bar.width() - 330.0).max(80.0),
					);
					truncated_text(
						ui,
						pos2(bar.min.x + 14.0, bar.center().y + 8.0),
						&address,
						11.0,
						theme::TEXT_3,
						(bar.width() - 330.0).max(80.0),
					);
					let mut bar_right = ui.new_child(
						egui::UiBuilder::new()
							.max_rect(Rect::from_min_max(
								pos2(bar.max.x - 300.0, bar.min.y),
								pos2(bar.max.x - 10.0, bar.max.y),
							))
							.layout(Layout::right_to_left(Align::Center)),
					);
					if copy_button(&mut bar_right, t!("复制地址")).clicked() {
						ui.ctx().copy_text(url.clone());
					}
					if copy_button(&mut bar_right, t!("复制 API 根")).clicked() {
						ui.ctx().copy_text(format!("{}/api/stats", origin));
					}

					let body = Rect::from_min_max(pos2(rect.min.x, bar.max.y), rect.max);
					let inner = body.shrink2(vec2(14.0, 14.0));
					ui.painter()
						.rect_filled(inner, CornerRadius::same(theme::R_PANEL), theme::GROUND);
					ui.painter().rect_stroke(
						inner,
						CornerRadius::same(theme::R_PANEL),
						Stroke::new(1.0_f32, theme::BORDER),
						egui::StrokeKind::Inside,
					);
					if embedded {
						// The child covers the body; one point of the drawn
						// border is left visible around it.
						action.embed = Some(crate::embed::PixelRect::from_points(
							inner.shrink(1.0),
							ui.ctx().pixels_per_point(),
						));
					} else {
						let mut body_ui = ui.new_child(egui::UiBuilder::new().max_rect(inner));
						panel(
							&mut body_ui,
							inner.shrink2(vec2(12.0, 10.0)),
							usage,
							&origin,
							&url,
							&mut action,
						);
					}
				});
		});
	// Place/hide the child after the frame has computed the body rectangle.
	// `set_bounds` runs every frame; the host skips it when the rect is
	// unchanged.
	match action.embed {
		Some(rect) => shell.embed.show(rect),
		None => shell.embed.hide(),
	}
	if let Some(range) = action.select {
		shell.usage.select(range, &origin);
	}
	if action.reload {
		shell.refresh_stats();
	}
	if action.close {
		shell.state.close_usage();
	}
}

/// The body: range selector, then either the answer or the one honest line
/// explaining that there is none.
fn panel(
	ui: &mut egui::Ui,
	rect: Rect,
	usage: &UsageCache,
	origin: &str,
	url: &str,
	action: &mut Action,
) {
	let mut y = rect.min.y;

	// Range selector (left) and where the answer came from (right).
	let row = Rect::from_min_size(pos2(rect.min.x, y), vec2(rect.width(), 26.0));
	ui.painter().text(
		pos2(row.min.x, row.center().y),
		Align2::LEFT_CENTER,
		t!("区间"),
		FontId::new(11.5, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	let mut buttons = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_size(
				pos2(row.min.x + 38.0, row.min.y),
				vec2(220.0, row.height()),
			))
			.layout(Layout::left_to_right(Align::Center)),
	);
	for range in Range::ALL {
		if range_button(&mut buttons, range.label(), usage.range() == range).clicked() {
			action.select = Some(range);
		}
		buttons.add_space(6.0);
	}
	if let Some(snapshot) = usage.snapshot() {
		ui.painter().text(
			pos2(row.max.x, row.center().y),
			Align2::RIGHT_CENTER,
			status_line(snapshot),
			FontId::new(10.5, egui::FontFamily::Proportional),
			theme::TEXT_3,
		);
	} else if usage.loading() {
		ui.painter().text(
			pos2(row.max.x, row.center().y),
			Align2::RIGHT_CENTER,
			t!("正在读取…"),
			FontId::new(10.5, egui::FontFamily::Proportional),
			theme::TEXT_3,
		);
	}
	y += 34.0;

	let cards_h = 78.0;
	let chart_h = 150.0_f32.min(rect.max.y - y - 120.0).max(90.0);
	let footer_h = 16.0;
	let cards = Rect::from_min_size(pos2(rect.min.x, y), vec2(rect.width(), cards_h));
	y += cards_h + 10.0;
	let chart = Rect::from_min_size(pos2(rect.min.x, y), vec2(rect.width(), chart_h));
	y += chart_h + 10.0;
	let table_h = (rect.max.y - footer_h - y).max(52.0);
	let table = Rect::from_min_size(pos2(rect.min.x, y), vec2(rect.width(), table_h));

	match usage.snapshot() {
		Some(snapshot) => {
			summary_cards(ui, cards, &snapshot.overview);
			chart_panel(ui, chart, &snapshot.overview.time_series, usage.range());
			agent_table(ui, table, &snapshot.overview);
			let source = format!(
				"GET /api/stats/overview?range={} · GET /api/stats/costs?range={} · GET /api/status",
				usage.range().query(),
				usage.range().query()
			);
			ui.painter().text(
				pos2(rect.min.x, rect.max.y - 4.0),
				Align2::LEFT_BOTTOM,
				source,
				FontId::new(10.0, egui::FontFamily::Monospace),
				theme::TEXT_3,
			);
			if let Some(error) = usage.error() {
				truncated_text_right(
					ui,
					rect.max.x,
					rect.max.y - 4.0,
					&t!("刷新失败：{}（显示上次数据）", error.message()),
					10.0,
					theme::WARN,
					rect.width() * 0.5,
				);
			}
		},
		None => {
			// No answer yet: an empty surface and one honest line. Zero cards
			// here would read as the server's numbers, which they are not.
			let surface = Rect::from_min_size(
				pos2(rect.min.x, y),
				vec2(rect.width(), (rect.max.y - y - 6.0).max(40.0)),
			);
			ui.painter()
				.rect_filled(surface, CornerRadius::same(theme::R_PANEL), theme::PANEL_2);
			ui.painter().rect_stroke(
				surface,
				CornerRadius::same(theme::R_PANEL),
				Stroke::new(1.0_f32, theme::BORDER),
				egui::StrokeKind::Inside,
			);
			let (line, color) = match usage.error() {
				Some(error) if error.is_absent() => (absent_line(url), theme::TEXT_2),
				Some(error) => (t!("读取 stats 失败：{}", error.message()), theme::WARN),
				None => (t!("正在读取 {} …", origin), theme::TEXT_3),
			};
			truncated_text_center(
				ui,
				surface.center().x,
				surface.center().y,
				&line,
				12.0,
				color,
				surface.width() - 40.0,
			);
		},
	}
}

/// `serve v4 · 同步 idle · 07:04:56 读取`.
fn status_line(snapshot: &Snapshot) -> String {
	let mut parts = Vec::new();
	if let Some(status) = snapshot.status.as_ref() {
		parts.push(format!("serve v{}", status.version));
		if !status.sync.phase.is_empty() {
			let progress = if status.sync.total > 0 {
				format!(" {}/{}", status.sync.current, status.sync.total)
			} else {
				String::new()
			};
			parts.push(t!("同步 {}{}", status.sync.phase, progress));
		}
		if let Some(error) = status.sync.error.as_ref() {
			parts.push(t!("同步错误 {}", error));
		}
	}
	let at = snapshot
		.fetched_at
		.duration_since(UNIX_EPOCH)
		.ok()
		.and_then(|since| chrono::DateTime::from_timestamp(since.as_secs() as i64, 0))
		.map(|utc| {
			utc.with_timezone(&chrono::Local)
				.format("%H:%M:%S")
				.to_string()
		})
		.unwrap_or_else(|| "—".to_owned());
	parts.push(t!("{} 读取", at));
	parts.join(" · ")
}

/// Five cards: tokens in/out, requests, cost, average throughput.
fn summary_cards(ui: &mut egui::Ui, rect: Rect, overview: &Overview) {
	let overall = &overview.overall;
	let gap = 8.0;
	let width = (rect.width() - gap * 4.0) / 5.0;
	let cost = cost_text(overall.total_cost, overall.unpriced_requests);
	let throughput = match overall.avg_tokens_per_second {
		Some(value) => format!("{value:.1} tok/s"),
		None => "—".to_owned(),
	};
	let ttft = match overall.avg_ttft_ms {
		Some(value) => t!("首字 {} ms", format!("{value:.0}")),
		None => t!("首字 —").to_owned(),
	};
	let cards: [(&str, String, String); 5] = [
		(
			t!("输入 token"),
			compact(overall.total_input_tokens as f64),
			t!("缓存读 {}", compact(overall.total_cache_read_tokens as f64)),
		),
		(
			t!("输出 token"),
			compact(overall.total_output_tokens as f64),
			t!("缓存写 {}", compact(overall.total_cache_write_tokens as f64)),
		),
		(
			t!("请求"),
			format!("{}", overall.total_requests),
			t!("成功 {} · 失败 {}", overall.successful_requests, overall.failed_requests),
		),
		(
			t!("费用"),
			cost,
			if overall.unpriced_requests > 0 {
				t!("未定价 {} 次", overall.unpriced_requests)
			} else {
				t!("区间总费用").to_owned()
			},
		),
		(t!("平均吞吐"), throughput, ttft),
	];
	for (index, (label, value, sub)) in cards.iter().enumerate() {
		let card_rect = Rect::from_min_size(
			pos2(rect.min.x + index as f32 * (width + gap), rect.min.y),
			vec2(width, rect.height()),
		);
		draw_card(ui, card_rect, label, value, sub);
	}
}

/// One summary card.
fn draw_card(ui: &egui::Ui, rect: Rect, label: &str, value: &str, sub: &str) {
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_PANEL), theme::PANEL_2);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(theme::R_PANEL),
		Stroke::new(1.0_f32, theme::BORDER),
		egui::StrokeKind::Inside,
	);
	ui.painter().text(
		pos2(rect.min.x + 10.0, rect.min.y + 12.0),
		Align2::LEFT_TOP,
		label,
		FontId::new(10.5, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	truncated_text(
		ui,
		pos2(rect.min.x + 10.0, rect.min.y + 40.0),
		value,
		19.0,
		theme::TEXT,
		rect.width() - 20.0,
	);
	truncated_text(
		ui,
		pos2(rect.min.x + 10.0, rect.min.y + 62.0),
		sub,
		10.0,
		theme::TEXT_3,
		rect.width() - 20.0,
	);
}

/// One bucket of the chart; gaps in the server's sparse series are closed with
/// zero buckets so the axis stays contiguous.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bar {
	pub timestamp: i64,
	pub tokens: u64,
	pub requests: u64,
	pub cost: f64,
}

/// Close `series` into contiguous `bucket_ms` buckets between its first and
/// last timestamp. A series longer than [`MAX_BARS`] (or an unsorted one) is
/// returned as the points the server sent.
pub fn bars(series: &[SeriesPoint], bucket_ms: i64) -> Vec<Bar> {
	let (Some(first), Some(last)) = (
		series.iter().map(|point| point.timestamp).min(),
		series.iter().map(|point| point.timestamp).max(),
	) else {
		return Vec::new();
	};
	let bucket_ms = bucket_ms.max(1);
	let count = (last - first) / bucket_ms + 1;
	if count <= 1 || count > MAX_BARS {
		let mut points: Vec<Bar> = series
			.iter()
			.map(|point| Bar {
				timestamp: point.timestamp,
				tokens: point.tokens,
				requests: point.requests,
				cost: point.cost,
			})
			.collect();
		points.sort_by_key(|point| point.timestamp);
		return points;
	}
	let by_time: std::collections::BTreeMap<i64, &SeriesPoint> = series
		.iter()
		.map(|point| (point.timestamp, point))
		.collect();
	(0..count)
		.map(|index| {
			let timestamp = first + index * bucket_ms;
			match by_time.get(&timestamp) {
				Some(point) => {
					Bar { timestamp, tokens: point.tokens, requests: point.requests, cost: point.cost }
				},
				None => Bar { timestamp, tokens: 0, requests: 0, cost: 0.0 },
			}
		})
		.collect()
}

/// The token bar chart, with the hovered bucket's numbers in its title row.
fn chart_panel(ui: &mut egui::Ui, rect: Rect, series: &[SeriesPoint], range: Range) {
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_PANEL), theme::PANEL_2);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(theme::R_PANEL),
		Stroke::new(1.0_f32, theme::BORDER),
		egui::StrokeKind::Inside,
	);
	let bucket_ms = range.bucket_ms();
	let bars = bars(series, bucket_ms);
	ui.painter().text(
		pos2(rect.min.x + 10.0, rect.min.y + 8.0),
		Align2::LEFT_TOP,
		t!("token 用量 · {}", range.window()),
		FontId::new(11.5, egui::FontFamily::Proportional),
		theme::TEXT_2,
	);
	let plot = Rect::from_min_max(
		pos2(rect.min.x + 46.0, rect.min.y + 32.0),
		pos2(rect.max.x - 10.0, rect.max.y - 18.0),
	);
	let max = bars.iter().map(|bar| bar.tokens).max().unwrap_or(0);
	for level in 0..=2 {
		let y = plot.max.y - plot.height() * level as f32 / 2.0;
		ui.painter().line_segment(
			[pos2(plot.min.x, y), pos2(plot.max.x, y)],
			Stroke::new(1.0_f32, theme::BORDER),
		);
		let value = (max as f64) * level as f64 / 2.0;
		ui.painter().text(
			pos2(plot.min.x - 6.0, y),
			Align2::RIGHT_CENTER,
			compact(value),
			FontId::new(9.5, egui::FontFamily::Monospace),
			theme::TEXT_3,
		);
	}
	if bars.is_empty() || max == 0 {
		ui.painter().text(
			plot.center(),
			Align2::CENTER_CENTER,
			t!("此区间没有 token 记录"),
			FontId::new(11.0, egui::FontFamily::Proportional),
			theme::TEXT_3,
		);
		return;
	}
	let slot = plot.width() / bars.len() as f32;
	let bar_width = (slot * 0.62).clamp(2.0, 26.0);
	let response = ui.interact(plot, ui.id().with("usage-chart"), Sense::hover());
	let hovered = response.hover_pos().map(|pointer| {
		let index = ((pointer.x - plot.min.x) / slot).floor();
		(index.max(0.0) as usize).min(bars.len() - 1)
	});
	let mut detail = None;
	for (index, bar) in bars.iter().enumerate() {
		let height = plot.height() * (bar.tokens as f32 / max as f32);
		let centre = plot.min.x + slot * (index as f32 + 0.5);
		if hovered == Some(index) {
			ui.painter().rect_filled(
				Rect::from_min_max(
					pos2(plot.min.x + slot * index as f32, plot.min.y),
					pos2(plot.min.x + slot * (index as f32 + 1.0), plot.max.y),
				),
				CornerRadius::ZERO,
				theme::PANEL_3,
			);
			detail = Some(t!(
				"{} · {} token · {} 次请求 · {}",
				bucket_text(bar.timestamp, bucket_ms),
				compact(bar.tokens as f64),
				bar.requests,
				cost_text(bar.cost, 0)
			));
		}
		let bar_rect = Rect::from_min_max(
			pos2(centre - bar_width / 2.0, plot.max.y - height.max(1.0)),
			pos2(centre + bar_width / 2.0, plot.max.y),
		);
		ui.painter().rect_filled(
			bar_rect,
			CornerRadius::same(2),
			if hovered == Some(index) {
				theme::ACCENT_2
			} else {
				theme::ACCENT
			},
		);
	}
	if let Some(detail) = detail {
		truncated_text_right(
			ui,
			rect.max.x - 10.0,
			rect.min.y + 15.0,
			&detail,
			10.5,
			theme::TEXT_2,
			rect.width() * 0.6,
		);
	}
	let first = bars[0].timestamp;
	let last = bars[bars.len() - 1].timestamp;
	ui.painter().text(
		pos2(plot.min.x, rect.max.y - 8.0),
		Align2::LEFT_CENTER,
		bucket_text(first, bucket_ms),
		FontId::new(9.5, egui::FontFamily::Monospace),
		theme::TEXT_3,
	);
	if bars.len() > 1 {
		ui.painter().text(
			pos2(plot.max.x, rect.max.y - 8.0),
			Align2::RIGHT_CENTER,
			bucket_text(last, bucket_ms),
			FontId::new(9.5, egui::FontFamily::Monospace),
			theme::TEXT_3,
		);
	}
}

/// The per-agent-type table from `byAgentType`.
fn agent_table(ui: &mut egui::Ui, rect: Rect, overview: &Overview) {
	ui.painter().text(
		pos2(rect.min.x, rect.min.y + 4.0),
		Align2::LEFT_TOP,
		t!("按 Agent 类型"),
		FontId::new(11.5, egui::FontFamily::Proportional),
		theme::TEXT_2,
	);
	let header = Rect::from_min_size(pos2(rect.min.x, rect.min.y + 20.0), vec2(rect.width(), 18.0));
	let columns = [
		(t!("类型"), 0.0, Align2::LEFT_CENTER),
		(t!("请求"), 0.46, Align2::RIGHT_CENTER),
		(t!("输入"), 0.62, Align2::RIGHT_CENTER),
		(t!("输出"), 0.78, Align2::RIGHT_CENTER),
		(t!("费用"), 1.0, Align2::RIGHT_CENTER),
	];
	for (label, fraction, align) in columns {
		let x = rect.min.x + rect.width() * fraction;
		ui.painter().text(
			pos2(x, header.center().y),
			align,
			label,
			FontId::new(9.5, egui::FontFamily::Proportional),
			theme::TEXT_3,
		);
	}
	ui.painter().line_segment(
		[pos2(rect.min.x, header.max.y), pos2(rect.max.x, header.max.y)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let pointer = ui.ctx().pointer_hover_pos();
	let row_h = 22.0;
	let available = ((rect.max.y - header.max.y) / row_h).floor().max(0.0) as usize;
	let rows = &overview.by_agent_type;
	if rows.is_empty() {
		ui.painter().text(
			pos2(rect.center().x, header.max.y + 22.0),
			Align2::CENTER_CENTER,
			t!("此区间没有 agent 类型记录"),
			FontId::new(10.5, egui::FontFamily::Proportional),
			theme::TEXT_3,
		);
		return;
	}
	for (index, row) in rows.iter().take(available).enumerate() {
		let y = header.max.y + row_h * index as f32;
		let row_rect = Rect::from_min_size(pos2(rect.min.x, y), vec2(rect.width(), row_h));
		if pointer.is_some_and(|pointer| row_rect.contains(pointer)) {
			ui.painter()
				.rect_filled(row_rect, CornerRadius::same(3), theme::PANEL_2);
		}
		let centre = row_rect.center().y;
		truncated_text(
			ui,
			pos2(rect.min.x, centre),
			if row.agent_type.is_empty() {
				"—"
			} else {
				row.agent_type.as_str()
			},
			11.0,
			theme::TEXT_2,
			rect.width() * 0.28,
		);
		ui.painter().text(
			pos2(rect.min.x + rect.width() * 0.46, centre),
			Align2::RIGHT_CENTER,
			format!("{}", row.total_requests),
			FontId::new(10.5, egui::FontFamily::Monospace),
			theme::TEXT,
		);
		ui.painter().text(
			pos2(rect.min.x + rect.width() * 0.62, centre),
			Align2::RIGHT_CENTER,
			compact(row.total_input_tokens as f64),
			FontId::new(10.5, egui::FontFamily::Monospace),
			theme::TEXT_2,
		);
		ui.painter().text(
			pos2(rect.min.x + rect.width() * 0.78, centre),
			Align2::RIGHT_CENTER,
			compact(row.total_output_tokens as f64),
			FontId::new(10.5, egui::FontFamily::Monospace),
			theme::TEXT_2,
		);
		ui.painter().text(
			pos2(rect.max.x, centre),
			Align2::RIGHT_CENTER,
			cost_text(row.total_cost, 0),
			FontId::new(10.5, egui::FontFamily::Monospace),
			theme::TEXT_2,
		);
	}
	let hidden = rows.len().saturating_sub(available);
	if hidden > 0 {
		ui.painter().text(
			pos2(rect.min.x, rect.max.y - 6.0),
			Align2::LEFT_BOTTOM,
			t!("另有 {} 类未显示", hidden),
			FontId::new(9.5, egui::FontFamily::Proportional),
			theme::TEXT_3,
		);
	}
}

/// `2.0M`, `1.5k`, `999` — the dashboard client's compact notation.
fn compact(value: f64) -> String {
	let magnitude = value.abs();
	if magnitude >= 1e9 {
		format!("{:.1}B", value / 1e9)
	} else if magnitude >= 1e6 {
		format!("{:.1}M", value / 1e6)
	} else if magnitude >= 1e3 {
		format!("{:.1}k", value / 1e3)
	} else if value.fract() == 0.0 {
		format!("{value:.0}")
	} else {
		format!("{value:.1}")
	}
}

/// `$6.00`, `$0`, or `N/A` when the spend exists but could not be priced —
/// the same rule `formatEstimatedCost` in the dashboard client applies.
fn cost_text(value: f64, unpriced: u64) -> String {
	if value == 0.0 {
		return if unpriced > 0 {
			"N/A".to_owned()
		} else {
			"$0".to_owned()
		};
	}
	if value.abs() < 0.01 {
		format!("${value:.4}")
	} else {
		format!("${value:.2}")
	}
}

/// `12-01 08:00` for hour buckets, `12-01` for day buckets, in local time.
fn bucket_text(timestamp: i64, bucket_ms: i64) -> String {
	let Some(utc) = chrono::DateTime::from_timestamp_millis(timestamp) else {
		return "—".to_owned();
	};
	let local = utc.with_timezone(&chrono::Local);
	if bucket_ms < 86_400_000 {
		local.format("%m-%d %H:%M").to_string()
	} else {
		local.format("%m-%d").to_string()
	}
}

/// A range button: 今天 / 7 天 / 30 天.
fn range_button(ui: &mut egui::Ui, label: &str, active: bool) -> egui::Response {
	let font = FontId::new(11.0, egui::FontFamily::Proportional);
	let galley = ui
		.painter()
		.layout_no_wrap(label.to_owned(), font.clone(), theme::TEXT_2);
	let (rect, response) =
		ui.allocate_exact_size(vec2(galley.size().x + 22.0, 24.0), Sense::click());
	let (ink, fill, border) = if active {
		(theme::ACCENT_2, theme::ACCENT_DIM, theme::BORDER_2)
	} else if response.hovered() {
		(theme::TEXT, theme::PANEL_3, theme::BORDER_2)
	} else {
		(theme::TEXT_2, theme::PANEL_2, theme::BORDER)
	};
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), fill);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(theme::R_CONTROL),
		Stroke::new(1.0_f32, border),
		egui::StrokeKind::Inside,
	);
	ui.painter()
		.text(rect.center(), Align2::CENTER_CENTER, label, font, ink);
	response
}

/// A small outlined button, as the address bar's actions use.
fn copy_button(ui: &mut egui::Ui, label: &str) -> egui::Response {
	let font = FontId::new(11.5, egui::FontFamily::Proportional);
	let galley = ui
		.painter()
		.layout_no_wrap(label.to_owned(), font.clone(), theme::TEXT_2);
	let (rect, response) =
		ui.allocate_exact_size(vec2(galley.size().x + 20.0, 26.0), Sense::click());
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(theme::R_CONTROL),
		Stroke::new(1.0_f32, theme::BORDER_2),
		egui::StrokeKind::Inside,
	);
	ui.painter().text(
		rect.center(),
		Align2::CENTER_CENTER,
		label,
		font,
		if response.hovered() {
			theme::TEXT
		} else {
			theme::TEXT_2
		},
	);
	response
}

/// The container's own icon, so the two entries that open it look alike.
pub fn entry_icon() -> Icon {
	Icon::List
}

#[cfg(test)]
mod tests {
	use super::*;

	const OVERVIEW: &str = include_str!("fixtures/overview-24h.json");
	const COSTS: &str = include_str!("fixtures/costs-24h.json");
	const STATUS: &str = include_str!("fixtures/status.json");

	#[test]
	fn the_fixture_cache_exposes_the_selected_range() {
		let cache = UsageCache::fixture(OVERVIEW, COSTS, STATUS, Range::Today).expect("fixture");
		assert_eq!(cache.range(), Range::Today);
		assert!(!cache.loading());
		let snapshot = cache.snapshot().expect("today's answer");
		assert_eq!(snapshot.overview.overall.total_requests, 2);
		assert!(snapshot.costs.is_some());
		assert_eq!(snapshot.status.as_ref().map(|status| status.version), Some(4));
	}

	#[test]
	fn switching_range_hides_the_other_ranges_answer() {
		let mut cache = UsageCache::fixture(OVERVIEW, COSTS, STATUS, Range::Today).expect("fixture");
		// `select` to a listening socket is not what this test is about; point it
		// at a closed port and check only what `snapshot` promises.
		cache.select(Range::ThirtyDays, "http://127.0.0.1:1");
		assert_eq!(cache.range(), Range::ThirtyDays);
		assert!(cache.loading());
		assert!(cache.snapshot().is_none(), "the 24h answer is not shown as 30d");
	}

	#[test]
	fn bars_close_the_gaps_between_sparse_buckets() {
		let series = [
			SeriesPoint { timestamp: 0, requests: 1, errors: 0, tokens: 10, cost: 1.0 },
			SeriesPoint { timestamp: 7_200_000, requests: 2, errors: 0, tokens: 20, cost: 2.0 },
		];
		let closed = bars(&series, 3_600_000);
		assert_eq!(closed.len(), 3);
		assert_eq!(closed[1].tokens, 0, "the missing hour is a zero bucket");
		assert_eq!(closed[2].tokens, 20);
		assert!(bars(&[], 3_600_000).is_empty());
	}

	#[test]
	fn an_empty_overview_draws_zeros_not_invented_rows() {
		let overview = api::decode_overview(
			r#"{"overall":{"totalRequests":0},"byAgentType":[],"timeSeries":[]}"#,
		)
		.expect("decodes");
		assert!(overview.is_empty());
		assert_eq!(cost_text(overview.overall.total_cost, 0), "$0");
		assert_eq!(compact(overview.overall.total_input_tokens as f64), "0");
	}

	#[test]
	fn compact_and_cost_match_the_dashboard_client() {
		assert_eq!(compact(2_000_000.0), "2.0M");
		assert_eq!(compact(1_500.0), "1.5k");
		assert_eq!(compact(999.0), "999");
		assert_eq!(compact(0.0), "0");
		assert_eq!(cost_text(6.0, 0), "$6.00");
		assert_eq!(cost_text(0.0, 0), "$0");
		assert_eq!(cost_text(0.0, 2), "N/A");
		assert_eq!(cost_text(0.004, 0), "$0.0040");
	}

	#[test]
	fn the_absent_state_is_one_line_naming_the_url() {
		let error = FetchError::Connect("连接 127.0.0.1:3847 失败：拒绝".to_owned());
		assert!(error.is_absent());
		assert_eq!(
			absent_line("http://127.0.0.1:3847"),
			"stats 服务未启动：zetacode serve 未在监听 http://127.0.0.1:3847"
		);
	}

	#[test]
	fn a_finished_worker_lands_in_the_cache() {
		// A canned server answering all three paths from the captured bodies.
		let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
		let port = listener.local_addr().unwrap().port();
		let server = std::thread::spawn(move || {
			for stream in listener.incoming().take(3) {
				let Ok(mut stream) = stream else { break };
				let mut request = [0_u8; 512];
				let read = std::io::Read::read(&mut stream, &mut request).unwrap_or(0);
				let request = String::from_utf8_lossy(&request[..read]);
				let body = if request.starts_with("GET /api/stats/overview") {
					OVERVIEW
				} else if request.starts_with("GET /api/stats/costs") {
					COSTS
				} else {
					STATUS
				};
				let response = format!(
					"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \
					 {}\r\nConnection: close\r\n\r\n{body}",
					body.len()
				);
				let _ = std::io::Write::write_all(&mut stream, response.as_bytes());
			}
		});
		let mut cache = UsageCache::default();
		cache.select(Range::SevenDays, &format!("http://127.0.0.1:{port}"));
		let deadline = Instant::now() + Duration::from_secs(5);
		while !cache.poll() && Instant::now() < deadline {
			std::thread::sleep(Duration::from_millis(10));
		}
		let snapshot = cache.snapshot().expect("the worker answered");
		assert_eq!(snapshot.range, Range::SevenDays, "the selector re-fetched its range");
		assert_eq!(snapshot.overview.overall.total_requests, 2);
		assert!(cache.error().is_none());
		server.join().expect("listener stops");
	}
}
