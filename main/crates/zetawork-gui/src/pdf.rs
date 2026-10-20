// SPDX-License-Identifier: AGPL-3.0-only
//! The GUI's PDF page: a real PDF rasterized into egui textures.
//!
//! The renderer is [`hayro`], a pure-Rust PDF rasterizer (Apache-2.0 OR MIT,
//! no C/C++ build step, no dynamic library). Pages are rendered on the UI
//! thread the first time they are shown at a given page/zoom, then kept as
//! GPU textures, so moving the mouse or scrolling never re-rasterizes.
//!
//! One page is one texture. The page geometry comes from the PDF itself
//! (`render_dimensions`, in points); zoom multiplies that, and the raster
//! resolution additionally follows the display's pixel density so a HiDPI
//! screen does not get a soft 1× bitmap. [`MAX_PIXELS`] caps one raster so a
//! large sheet at high zoom cannot allocate unbounded memory.
//!
//! The TUI never renders PDF — see `zeta-main`'s `tab.rs`, which refuses a
//! `.pdf` path and never grows a PDF page.

use std::{
	collections::HashMap,
	path::{Path, PathBuf},
	time::{Duration, Instant},
};

use egui::{
	Align2, Color32, CornerRadius, FontId, Layout, Rect, Sense, Stroke, TextureHandle, Ui, pos2,
	vec2,
};

use crate::{
	Shell,
	icons::{Icon, icon_button},
	state::SessionTab,
	t, theme,
	widgets::{empty_note, truncated_mono},
};

/// Smallest zoom the toolbar allows.
pub const MIN_ZOOM: f32 = 0.5;
/// Largest zoom the toolbar allows.
pub const MAX_ZOOM: f32 = 3.0;
/// One click of `＋` / `－`.
pub const ZOOM_STEP: f32 = 0.25;
/// Ceiling for one rasterized page, in pixels. A 4 Mpx page is ~16 MB of
/// premultiplied RGBA — the budget keeps a zoomed poster from eating the
/// process.
pub const MAX_PIXELS: f32 = 4_000_000.0;

/// The page toolbar's height.
const BAR: f32 = 34.0;
/// The footer's height.
const FOOT: f32 = 24.0;
/// Padding around the sheet inside the scroll area.
const PAD: f32 = 18.0;

/// One rasterized page, straight from the renderer.
pub struct Raster {
	/// Pixel width of the bitmap.
	pub width: u32,
	/// Pixel height of the bitmap.
	pub height: u32,
	/// Premultiplied RGBA8, row-major, `width * height * 4` bytes.
	rgba: Vec<u8>,
	/// How long the raster paid for itself.
	pub elapsed: Duration,
}

impl Raster {
	/// The pixels, premultiplied RGBA8.
	pub fn rgba(&self) -> &[u8] {
		&self.rgba
	}

	/// The colour of one pixel, or `None` outside the bitmap.
	pub fn pixel(&self, x: u32, y: u32) -> Option<[u8; 4]> {
		if x >= self.width || y >= self.height {
			return None;
		}
		let at = ((y * self.width + x) * 4) as usize;
		Some([self.rgba[at], self.rgba[at + 1], self.rgba[at + 2], self.rgba[at + 3]])
	}
}

/// Rasterize page `index` of `pdf` at `scale` pixels per PDF point.
///
/// This is the whole rendering contract: a malformed document that parsed but
/// has no such page, or a page hayro cannot paint, comes back as an error
/// string instead of an empty bitmap, so the page can say what happened.
pub fn rasterize(
	pdf: &hayro::hayro_syntax::Pdf,
	index: usize,
	scale: f32,
) -> Result<Raster, String> {
	let Some(page) = pdf.pages().get(index) else {
		return Err(t!("没有第 {} 页", index + 1));
	};
	let scale = scale.clamp(0.05, 8.0);
	let started = Instant::now();
	let pixmap = hayro::render(
		page,
		&hayro::RenderCache::new(),
		&hayro::hayro_interpret::InterpreterSettings::default(),
		&hayro::RenderSettings::default(),
		&hayro::PixmapSettings {
			x_scale: scale,
			y_scale: scale,
			bg_color: hayro::vello_cpu::color::palette::css::WHITE,
		},
	);
	let elapsed = started.elapsed();
	let (width, height) = (u32::from(pixmap.width()), u32::from(pixmap.height()));
	let rgba = pixmap.take_rgba8(hayro::vello_cpu::peniko::ImageAlphaType::AlphaPremultiplied);
	Ok(Raster { width, height, rgba, elapsed })
}

/// One open PDF tab: the document, where the reader is, and the texture of the
/// page currently on screen.
pub struct PdfDoc {
	path: PathBuf,
	/// The parsed document, or the sentence explaining why there is none.
	document: Result<hayro::hayro_syntax::Pdf, String>,
	page: usize,
	zoom: f32,
	texture: Option<Cached>,
	/// Why the current page could not be painted (the document still parses).
	render_error: Option<String>,
	last_render: Option<Duration>,
}

/// The texture of one (page, zoom, pixel-density) combination.
struct Cached {
	page: usize,
	zoom: f32,
	pixels_per_point: f32,
	texture: TextureHandle,
}

impl PdfDoc {
	/// Read and parse `path`. A failure is recorded, never fatal: the page
	/// then shows [`Self::error`] instead of a sheet.
	pub fn open(path: &Path) -> Self {
		let document = match std::fs::read(path) {
			Ok(bytes) => match hayro::hayro_syntax::Pdf::new(bytes) {
				Ok(pdf) => Ok(pdf),
				Err(error) => Err(t!("不是有效的 PDF（{}）：{}", format!("{error:?}"), path.display())),
			},
			Err(error) => Err(t!("打不开 PDF：{}", format!("{}: {error}", path.display()))),
		};
		Self {
			path: path.to_path_buf(),
			document,
			page: 0,
			zoom: 1.0,
			texture: None,
			render_error: None,
			last_render: None,
		}
	}

	/// The file this page shows.
	pub fn path(&self) -> &Path {
		&self.path
	}

	/// The file's name, for the page head.
	pub fn name(&self) -> String {
		self
			.path
			.file_name()
			.map(|name| name.to_string_lossy().into_owned())
			.unwrap_or_else(|| self.path.display().to_string())
	}

	/// The load/parse error, when there is no usable document.
	pub fn error(&self) -> Option<&str> {
		match &self.document {
			Ok(_) => None,
			Err(message) => Some(message),
		}
	}

	/// Why the current page could not be rasterized.
	pub fn render_error(&self) -> Option<&str> {
		self.render_error.as_deref()
	}

	/// The last raster's render time, when a page has been drawn.
	pub fn last_render(&self) -> Option<Duration> {
		self.last_render
	}

	/// How many pages the document has; `0` when it did not parse.
	pub fn page_count(&self) -> usize {
		self.document.as_ref().map_or(0, |pdf| pdf.pages().len())
	}

	/// The page on screen, zero-based.
	pub fn page(&self) -> usize {
		self.page
	}

	/// The page's size in PDF points.
	pub fn page_size(&self) -> Option<egui::Vec2> {
		let page = self.document.as_ref().ok()?.pages().get(self.page)?;
		let (width, height) = page.render_dimensions();
		(width > 0.0 && height > 0.0).then(|| vec2(width, height))
	}

	/// The current zoom factor.
	pub fn zoom(&self) -> f32 {
		self.zoom
	}

	/// Go to a page, clamped to the document.
	pub fn set_page(&mut self, page: usize) {
		let last = self.page_count().saturating_sub(1);
		self.page = page.min(last);
	}

	/// The next page, if there is one.
	pub fn next_page(&mut self) -> bool {
		if self.page + 1 < self.page_count() {
			self.page += 1;
			return true;
		}
		false
	}

	/// The previous page, if there is one.
	pub fn previous_page(&mut self) -> bool {
		if self.page > 0 {
			self.page -= 1;
			return true;
		}
		false
	}

	/// Set the zoom, clamped to [`MIN_ZOOM`]..=[`MAX_ZOOM`].
	pub fn set_zoom(&mut self, zoom: f32) {
		self.zoom = zoom.clamp(MIN_ZOOM, MAX_ZOOM);
	}

	/// One step in.
	pub fn zoom_in(&mut self) {
		self.set_zoom(self.zoom + ZOOM_STEP);
	}

	/// One step out.
	pub fn zoom_out(&mut self) {
		self.set_zoom(self.zoom - ZOOM_STEP);
	}

	/// Fit the page's width into `available` (clamped like any other zoom).
	pub fn fit_width(&mut self, available: f32) {
		let Some(size) = self.page_size() else {
			return;
		};
		if size.x > 0.0 {
			self.set_zoom(available / size.x);
		}
	}

	/// Re-read the file from disk, keeping the reader's place.
	pub fn reload(&mut self) {
		let page = self.page;
		let zoom = self.zoom;
		let fresh = Self::open(&self.path);
		*self = fresh;
		self.zoom = zoom;
		self.set_page(page);
	}

	/// The texture of the current page at the current zoom and pixel density,
	/// rasterizing on first use. `None` when the document is unusable.
	pub fn texture(&mut self, ctx: &egui::Context) -> Option<&TextureHandle> {
		let pixels_per_point = ctx.pixels_per_point().max(1.0);
		let fresh = self.texture.as_ref().is_some_and(|cached| {
			cached.page == self.page
				&& cached.zoom == self.zoom
				&& cached.pixels_per_point == pixels_per_point
		});
		if fresh {
			return self.texture.as_ref().map(|cached| &cached.texture);
		}
		let raster = {
			let Ok(pdf) = &self.document else {
				return None;
			};
			let (width, height) = pdf.pages().get(self.page)?.render_dimensions();
			let scale = render_scale(width, height, self.zoom, pixels_per_point);
			rasterize(pdf, self.page, scale)
		};
		let raster = match raster {
			Ok(raster) => raster,
			Err(message) => {
				self.render_error = Some(message);
				self.texture = None;
				return None;
			},
		};
		self.render_error = None;
		self.last_render = Some(raster.elapsed);
		let image = egui::ColorImage::from_rgba_premultiplied(
			[raster.width as usize, raster.height as usize],
			raster.rgba(),
		);
		let texture = ctx.load_texture(
			format!("zetawork-pdf-{}-{}", self.path.display(), self.page),
			image,
			egui::TextureOptions::LINEAR,
		);
		self.texture = Some(Cached { page: self.page, zoom: self.zoom, pixels_per_point, texture });
		self.texture.as_ref().map(|cached| &cached.texture)
	}
}

/// The raster scale for a page: the zoom at the display's density, capped so
/// one page never exceeds [`MAX_PIXELS`].
fn render_scale(width: f32, height: f32, zoom: f32, pixels_per_point: f32) -> f32 {
	let points = (width * height).max(1.0);
	let budget = (MAX_PIXELS / points).sqrt();
	(zoom * pixels_per_point).min(budget).max(0.05)
}

/// Every PDF tab's open document, keyed by session-tab id.
///
/// A tab carries the path (so the strip can name it and a fresh draw can
/// reopen it); the parsed document and its textures live here, because a
/// [`hayro::hayro_syntax::Pdf`] is neither small nor `Clone`.
#[derive(Default)]
pub struct PdfCache {
	docs: HashMap<String, PdfDoc>,
}

impl PdfCache {
	/// The document of `tab`, opening (or reopening) `path` when this is the
	/// first draw of the tab or the tab's file changed.
	pub fn ensure(&mut self, tab: &str, path: &Path) -> &mut PdfDoc {
		let stale = self.docs.get(tab).is_none_or(|doc| doc.path() != path);
		if stale {
			self.docs.insert(tab.to_owned(), PdfDoc::open(path));
		}
		self
			.docs
			.get_mut(tab)
			.expect("the document was just inserted")
	}

	/// A document without opening anything.
	pub fn get(&self, tab: &str) -> Option<&PdfDoc> {
		self.docs.get(tab)
	}

	/// Drop the documents of tabs that no longer exist.
	pub fn retain(&mut self, open: &[String]) {
		self.docs.retain(|tab, _| open.iter().any(|id| id == tab));
	}
}

/// The PDF page's body: a toolbar, the sheet, and a footer.
pub fn body(ui: &mut Ui, shell: &mut Shell, tab: &SessionTab) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL);
	let bar = Rect::from_min_size(rect.min, vec2(rect.width(), BAR));
	ui.painter()
		.rect_filled(bar, CornerRadius::ZERO, theme::PANEL_2);
	ui.painter().line_segment(
		[pos2(bar.min.x, bar.max.y - 0.5), pos2(bar.max.x, bar.max.y - 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let Some(path) = tab.pdf.clone() else {
		truncated_mono(
			ui,
			pos2(bar.min.x + 10.0, bar.center().y),
			t!("PDF"),
			11.0,
			theme::TEXT_3,
			bar.width() - 20.0,
		);
		empty_note(ui, t!("这个标签页没有打开 PDF"));
		return;
	};
	let doc = shell.pdfs.ensure(&tab.id, &path);
	let title = format!("{} · {}", doc.name(), path.display());
	let foot = Rect::from_min_size(pos2(rect.min.x, rect.max.y - FOOT), vec2(rect.width(), FOOT));
	let sheet = Rect::from_min_max(pos2(rect.min.x, bar.max.y), pos2(rect.max.x, foot.min.y));
	truncated_mono(
		ui,
		pos2(bar.min.x + 10.0, bar.center().y),
		&title,
		11.0,
		theme::TEXT_3,
		(bar.width() - 360.0).max(60.0),
	);
	toolbar(ui, bar, doc, (sheet.width() - PAD * 2.0).max(1.0));

	if let Some(error) = doc.error().or_else(|| doc.render_error()) {
		let mut area = ui.new_child(egui::UiBuilder::new().max_rect(sheet.shrink2(vec2(10.0, 10.0))));
		empty_note(&mut area, error);
		footer(ui, foot, doc, None);
		return;
	}
	let Some(size) = doc.page_size() else {
		empty_note(ui, t!("这一页没有可渲染的内容"));
		return;
	};
	let zoom = doc.zoom();
	let texture = doc.texture(ui.ctx()).cloned();
	let Some(texture) = texture else {
		let mut area = ui.new_child(egui::UiBuilder::new().max_rect(sheet.shrink2(vec2(10.0, 10.0))));
		empty_note(&mut area, t!("这一页渲染失败"));
		footer(ui, foot, doc, Some(size));
		return;
	};
	let id = tab.id.clone();
	let page = doc.page();
	let mut area = ui.new_child(egui::UiBuilder::new().max_rect(sheet));
	area
		.painter()
		.rect_filled(sheet, CornerRadius::ZERO, theme::GROUND);
	egui::ScrollArea::both()
		.id_salt(("zetawork-pdf-scroll", id.as_str(), page))
		.auto_shrink([false, false])
		.show(&mut area, |ui| {
			let display = vec2(size.x * zoom, size.y * zoom);
			let width = display.x.max(ui.available_width() - PAD * 2.0);
			let (row, _) = ui.allocate_exact_size(vec2(width, display.y + PAD * 2.0), Sense::hover());
			let sheet_rect = Rect::from_min_size(
				pos2(row.min.x + (row.width() - display.x) / 2.0, row.min.y + PAD),
				display,
			);
			ui.painter().rect_filled(
				sheet_rect.translate(vec2(0.0, 2.0)).expand(4.0),
				CornerRadius::same(2),
				Color32::from_black_alpha(90),
			);
			ui.painter().image(
				texture.id(),
				sheet_rect,
				Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
				Color32::WHITE,
			);
		});
	footer(ui, foot, doc, Some(size));
}

/// The page toolbar: prev/next, the page counter, zoom out/in with the
/// percentage, 适应宽度 and 重新读取.
fn toolbar(ui: &mut Ui, bar: Rect, doc: &mut PdfDoc, sheet_width: f32) {
	let mut tools = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_max(pos2(bar.max.x - 350.0, bar.min.y), bar.max))
			.layout(Layout::right_to_left(egui::Align::Center)),
	);
	if icon_button(&mut tools, Icon::Refresh, 22.0, false, t!("重新读取 PDF")).clicked() {
		doc.reload();
	}
	if label_button(&mut tools, t!("适应宽度"), doc.page_size().is_some()).clicked() {
		doc.fit_width(sheet_width);
	}
	if label_button(&mut tools, "＋", doc.zoom() < MAX_ZOOM).clicked() {
		doc.zoom_in();
	}
	let percent = format!("{}%", (doc.zoom() * 100.0).round() as i32);
	text_slot(&mut tools, &percent, 44.0);
	if label_button(&mut tools, "－", doc.zoom() > MIN_ZOOM).clicked() {
		doc.zoom_out();
	}
	let count = doc.page_count();
	let next = icon_button(&mut tools, Icon::ChevronRight, 22.0, false, t!("下一页"));
	if next.clicked() {
		doc.next_page();
	}
	let label = if count == 0 {
		"—".to_owned()
	} else {
		t!("{} / {}", doc.page() + 1, count)
	};
	text_slot(&mut tools, &label, 52.0);
	let previous = icon_button(&mut tools, Icon::ChevronLeft, 22.0, false, t!("上一页"));
	if previous.clicked() {
		doc.previous_page();
	}
}

/// The footer: page size, the last raster's time, and the renderer's name.
fn footer(ui: &mut Ui, foot: Rect, doc: &PdfDoc, size: Option<egui::Vec2>) {
	ui.painter()
		.rect_filled(foot, CornerRadius::ZERO, theme::PANEL_2);
	ui.painter().line_segment(
		[pos2(foot.min.x, foot.min.y + 0.5), pos2(foot.max.x, foot.min.y + 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let mut parts: Vec<String> = Vec::new();
	if let Some(size) = size {
		parts.push(t!("{} × {} pt", size.x.round(), size.y.round()));
	}
	if let Some(took) = doc.last_render() {
		parts.push(t!("渲染 {} ms", took.as_millis()));
	}
	parts.push(format!("{}%", (doc.zoom() * 100.0).round() as i32));
	parts.push(t!("hayro（纯 Rust 光栅化）").to_owned());
	let mut x = foot.min.x + 12.0;
	for part in &parts {
		let galley = ui.painter().layout_no_wrap(
			part.clone(),
			FontId::new(11.0, egui::FontFamily::Monospace),
			theme::TEXT_3,
		);
		ui.painter().galley(
			pos2(x, foot.center().y - galley.size().y / 2.0),
			galley.clone(),
			theme::TEXT_3,
		);
		x += galley.size().x + 18.0;
	}
}

/// A small clickable label with the panel's control styling.
fn label_button(ui: &mut Ui, label: &str, enabled: bool) -> egui::Response {
	let font = FontId::new(11.0, egui::FontFamily::Monospace);
	let galley = ui
		.painter()
		.layout_no_wrap(label.to_owned(), font.clone(), theme::TEXT_2);
	let size = vec2(galley.size().x + 14.0, 22.0);
	let (rect, response) = ui.allocate_exact_size(
		size,
		if enabled {
			Sense::click()
		} else {
			Sense::hover()
		},
	);
	let (fill, ink) = if !enabled {
		(theme::PANEL_3, theme::TEXT_3)
	} else if response.hovered() {
		(theme::PANEL_4, theme::TEXT)
	} else {
		(theme::PANEL_3, theme::TEXT_2)
	};
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), fill);
	ui.painter()
		.text(rect.center(), Align2::CENTER_CENTER, label, font, ink);
	response
}

/// A non-interactive label of a fixed width, so the toolbar's numbers do not
/// make the row jump as they change.
fn text_slot(ui: &mut Ui, label: &str, width: f32) {
	let (rect, _) = ui.allocate_exact_size(vec2(width, 22.0), Sense::hover());
	ui.painter().text(
		rect.center(),
		Align2::CENTER_CENTER,
		label,
		FontId::new(11.0, egui::FontFamily::Monospace),
		theme::TEXT_2,
	);
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The committed fixture: two A4 pages, ~1.8 KB, text + vector fills.
	fn fixture() -> PathBuf {
		PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/two-pages.pdf")
	}

	#[test]
	fn the_fixture_loads_as_a_two_page_document() {
		let started = Instant::now();
		let doc = PdfDoc::open(&fixture());
		let open = started.elapsed();
		println!("[pdf] PdfDoc::open (read + parse): {open:?}");
		assert!(doc.error().is_none(), "{:?}", doc.error());
		assert_eq!(doc.page_count(), 2);
		assert_eq!(doc.page(), 0);
		assert_eq!(doc.zoom(), 1.0);
		let size = doc.page_size().expect("page one has a size");
		assert!((size.x - 612.0).abs() < 1.0, "A4 width in points: {size:?}");
		assert!((size.y - 792.0).abs() < 1.0, "A4 height in points: {size:?}");
	}

	#[test]
	fn a_missing_file_is_a_recorded_error() {
		let missing = std::env::temp_dir()
			.join(format!("zetawork-pdf-missing-{}", std::process::id()))
			.join("nope.pdf");
		let doc = PdfDoc::open(&missing);
		let error = doc.error().expect("a missing file is an error");
		assert!(error.contains("nope.pdf"), "the path is in the sentence: {error}");
		assert_eq!(doc.page_count(), 0, "no pages to draw");
		assert!(doc.page_size().is_none());
	}

	#[test]
	fn malformed_bytes_are_a_recorded_error() {
		let dir = std::env::temp_dir().join(format!("zetawork-pdf-bad-{}", std::process::id()));
		std::fs::create_dir_all(&dir).expect("temp dir");
		let path = dir.join("broken.pdf");
		std::fs::write(&path, b"%PDF-1.7\ntrailer << /Size 0 >>\nthis is not a pdf\n")
			.expect("write fixture");
		let doc = PdfDoc::open(&path);
		let error = doc.error().expect("a malformed file is an error");
		assert!(error.contains("broken.pdf"), "the path is in the sentence: {error}");
		assert_eq!(doc.page_count(), 0);
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn the_fixture_rasterizes_real_ink() {
		let doc = PdfDoc::open(&fixture());
		let pdf = doc.document.as_ref().expect("parsed");
		let started = Instant::now();
		let raster = rasterize(pdf, 0, 1.5).expect("page one renders");
		println!(
			"[pdf] first page: {}×{} px, {} ms wall, {} ms in the rasterizer",
			raster.width,
			raster.height,
			started.elapsed().as_millis(),
			raster.elapsed.as_millis()
		);
		assert!(
			raster.width > 800 && raster.height > 1000,
			"bitmap is {}×{} px",
			raster.width,
			raster.height
		);
		// The fixture paints a near-black panel over most of the page, so a
		// rendered page is decidedly not a blank white sheet.
		let ink = (0..raster.width)
			.step_by(7)
			.flat_map(|x| (0..raster.height).step_by(7).map(move |y| (x, y)))
			.filter(|&(x, y)| {
				raster
					.pixel(x, y)
					.is_some_and(|p| p[0] < 0x80 && p[1] < 0x80)
			})
			.count();
		assert!(ink > 100, "the page has real dark ink: {ink} sampled dark pixels");
	}

	#[test]
	fn page_navigation_and_zoom_are_clamped() {
		let mut doc = PdfDoc::open(&fixture());
		assert!(doc.next_page());
		assert_eq!(doc.page(), 1);
		assert!(!doc.next_page(), "there is no third page");
		assert!(doc.previous_page());
		assert!(!doc.previous_page(), "there is no page before the first");
		doc.set_page(99);
		assert_eq!(doc.page(), 1, "set_page clamps to the last page");

		doc.set_zoom(99.0);
		assert_eq!(doc.zoom(), MAX_ZOOM);
		doc.set_zoom(0.0);
		assert_eq!(doc.zoom(), MIN_ZOOM);
		doc.set_zoom(1.0);
		doc.zoom_in();
		assert_eq!(doc.zoom(), 1.25);
		doc.zoom_out();
		assert_eq!(doc.zoom(), 1.0);

		doc.fit_width(306.0);
		assert_eq!(doc.zoom(), 0.5, "half the page's width is the minimum zoom");
	}

	#[test]
	fn the_raster_budget_caps_one_page() {
		let scale = render_scale(612.0, 792.0, 3.0, 2.0);
		assert!((612.0 * 792.0 * scale * scale) <= MAX_PIXELS * 1.001);
		assert_eq!(render_scale(612.0, 792.0, 1.0, 1.0), 1.0);
	}

	#[test]
	fn the_cache_drops_closed_tabs() {
		let mut cache = PdfCache::default();
		cache.ensure("tab-a", &fixture());
		cache.ensure("tab-b", &fixture());
		assert!(cache.get("tab-a").is_some());
		cache.retain(&["tab-b".to_owned()]);
		assert!(cache.get("tab-a").is_none());
		assert!(cache.get("tab-b").is_some());
	}

	#[test]
	fn a_new_path_replaces_the_old_document() {
		let mut cache = PdfCache::default();
		cache.ensure("tab-a", &fixture());
		let other =
			std::env::temp_dir().join(format!("zetawork-pdf-other-{}.pdf", std::process::id()));
		std::fs::write(&other, b"not a pdf").expect("write file");
		let doc = cache.ensure("tab-a", &other);
		assert!(doc.error().is_some(), "the reopened path is parsed again");
		assert_eq!(doc.path(), other.as_path());
		let _ = std::fs::remove_file(&other);
	}
}
