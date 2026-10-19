// SPDX-License-Identifier: AGPL-3.0-only
//! A CPU rasterizer for egui's tessellated output.
//!
//! The screenshots in `tests/shots.rs` must not open a window (a window would
//! steal focus), and they must not need a GPU adapter, so this walks the same
//! data a GPU backend gets and draws it in software:
//!
//! ```text
//! Context::run → FullOutput { shapes, textures_delta }
//!              → Context::tessellate → ClippedPrimitive (Mesh: vertices + u32 indices)
//!              → triangles → pixels (barycentric fill, bilinear texture sample)
//! ```
//!
//! One texture is enough: egui tessellates *everything* against the font atlas
//! — untextured fills point at [`egui::epaint::WHITE_UV`], which is a white
//! texel of that same atlas — so `Textures` only has to accumulate the atlas
//! deltas egui emits.
//!
//! Colour handling matches epaint: vertex colours and texels are sRGBA with
//! **premultiplied** alpha, the shader multiplies them component-wise, and the
//! framebuffer blend is `dst = src + dst * (1 - src.a)`.

use std::collections::HashMap;

use egui::{
	Color32, ColorImage, ImageData, TexturesDelta,
	epaint::{ClippedPrimitive, Primitive, TextureId, Vertex},
};

/// The textures egui has handed out so far (only the font atlas, in practice).
#[derive(Default)]
pub struct Textures {
	images: HashMap<TextureId, ColorImage>,
}

impl Textures {
	/// Apply one frame's `TexturesDelta`, accumulating patches (`pos: Some`)
	/// into the textures they belong to.
	pub fn apply(&mut self, delta: &TexturesDelta) {
		for (id, image_delta) in &delta.set {
			let ImageData::Color(patch) = &image_delta.image;
			match image_delta.pos {
				None => {
					self.images.insert(*id, (**patch).clone());
				},
				Some([x0, y0]) => {
					if let Some(target) = self.images.get_mut(id) {
						for y in 0..patch.size[1] {
							for x in 0..patch.size[0] {
								let (tx, ty) = (x0 + x, y0 + y);
								if tx < target.size[0] && ty < target.size[1] {
									target.pixels[ty * target.size[0] + tx] =
										patch.pixels[y * patch.size[0] + x];
								}
							}
						}
					}
				},
			}
		}
		for id in &delta.free {
			self.images.remove(id);
		}
	}

	fn get(&self, id: TextureId) -> Option<&ColorImage> {
		self.images.get(&id)
	}
}

/// An RGBA8 image, premultiplied, row-major from the top.
pub struct Canvas {
	pub width: usize,
	pub height: usize,
	pub pixels: Vec<[u8; 4]>,
}

impl Canvas {
	pub fn new(width: usize, height: usize, background: Color32) -> Self {
		Self {
			width,
			height,
			pixels: vec![
				[background.r(), background.g(), background.b(), background.a()];
				width * height
			],
		}
	}

	/// `src` is premultiplied sRGBA in 0..=255, blended as
	/// `dst = src + dst * (1 - src.a)`.
	fn blend(&mut self, x: usize, y: usize, src: [f32; 4]) {
		let index = y * self.width + x;
		let dst = &mut self.pixels[index];
		// The alpha is in 0..=255 like the colour channels, so it has to be
		// normalised before it can scale the destination.
		let inv = 1.0 - src[3] / 255.0;
		for channel in 0..4 {
			let value = src[channel] + f32::from(dst[channel]) * inv;
			dst[channel] = value.clamp(0.0, 255.0).round() as u8;
		}
	}

	/// Encode as PNG (RGBA8).
	pub fn to_png(&self) -> Vec<u8> {
		let mut raw = Vec::with_capacity(self.pixels.len() * 4);
		for pixel in &self.pixels {
			raw.extend_from_slice(pixel);
		}
		let mut out = Vec::new();
		{
			let mut encoder = png::Encoder::new(&mut out, self.width as u32, self.height as u32);
			encoder.set_color(png::ColorType::Rgba);
			encoder.set_depth(png::BitDepth::Eight);
			let mut writer = encoder.write_header().expect("png header");
			writer.write_image_data(&raw).expect("png data");
			writer.finish().expect("png finish");
		}
		out
	}
}

/// Draw every primitive onto a fresh canvas of `size_points` (scaled by `ppp`).
#[allow(clippy::chunks_exact_to_as_chunks)]
pub fn render(
	primitives: &[ClippedPrimitive],
	textures: &Textures,
	size_points: [f32; 2],
	ppp: f32,
	background: Color32,
) -> Canvas {
	let width = (size_points[0] * ppp).round().max(1.0) as usize;
	let height = (size_points[1] * ppp).round().max(1.0) as usize;
	let mut canvas = Canvas::new(width, height, background);
	for primitive in primitives {
		let Primitive::Mesh(mesh) = &primitive.primitive else {
			continue;
		};
		let texture = textures.get(mesh.texture_id);
		// The clip rectangle is in points; the canvas is in device pixels.
		let clip = primitive.clip_rect;
		let clip = [
			(clip.min.x * ppp).floor(),
			(clip.min.y * ppp).floor(),
			(clip.max.x * ppp).ceil(),
			(clip.max.y * ppp).ceil(),
		];
		for triangle in mesh.indices.chunks_exact(3) {
			let (a, b, c) = (
				mesh.vertices[triangle[0] as usize],
				mesh.vertices[triangle[1] as usize],
				mesh.vertices[triangle[2] as usize],
			);
			fill(&mut canvas, texture, clip, ppp, a, b, c);
		}
	}
	canvas
}

/// Barycentric triangle fill with per-vertex colour and bilinear texturing.
fn fill(
	canvas: &mut Canvas,
	texture: Option<&ColorImage>,
	clip: [f32; 4],
	ppp: f32,
	a: Vertex,
	b: Vertex,
	c: Vertex,
) {
	let pa = [a.pos.x * ppp, a.pos.y * ppp];
	let pb = [b.pos.x * ppp, b.pos.y * ppp];
	let pc = [c.pos.x * ppp, c.pos.y * ppp];
	let area = edge(pa, pb, pc);
	if area.abs() < 1e-6 {
		return;
	}
	let min_x = pa[0].min(pb[0]).min(pc[0]).max(clip[0]).max(0.0) as usize;
	let max_x = (pa[0]
		.max(pb[0])
		.max(pc[0])
		.min(clip[2])
		.min(canvas.width as f32) as usize)
		.min(canvas.width);
	let min_y = pa[1].min(pb[1]).min(pc[1]).max(clip[1]).max(0.0) as usize;
	let max_y = (pa[1]
		.max(pb[1])
		.max(pc[1])
		.min(clip[3])
		.min(canvas.height as f32) as usize)
		.min(canvas.height);
	let inv_area = 1.0 / area;
	for y in min_y..max_y {
		for x in min_x..max_x {
			let p = [x as f32 + 0.5, y as f32 + 0.5];
			let wa = edge(pb, pc, p) * inv_area;
			let wb = edge(pc, pa, p) * inv_area;
			let wc = edge(pa, pb, p) * inv_area;
			if wa < 0.0 || wb < 0.0 || wc < 0.0 {
				continue;
			}
			let uv =
				[wa * a.uv.x + wb * b.uv.x + wc * c.uv.x, wa * a.uv.y + wb * b.uv.y + wc * c.uv.y];
			let texel = texture.map(|image| sample(image, uv)).unwrap_or([1.0; 4]);
			let mut vertex = [0.0f32; 4];
			let (ca, cb, cc) = (a.color, b.color, c.color);
			for (channel, value) in vertex.iter_mut().enumerate() {
				let va = f32::from(component(ca, channel));
				let vb = f32::from(component(cb, channel));
				let vc = f32::from(component(cc, channel));
				*value = wa * va + wb * vb + wc * vc;
			}
			let src = [
				vertex[0] * texel[0] / 255.0,
				vertex[1] * texel[1] / 255.0,
				vertex[2] * texel[2] / 255.0,
				vertex[3] * texel[3] / 255.0,
			];
			canvas.blend(x, y, src);
		}
	}
}

fn component(color: Color32, channel: usize) -> u8 {
	match channel {
		0 => color.r(),
		1 => color.g(),
		2 => color.b(),
		_ => color.a(),
	}
}

/// Twice the signed area of the triangle `(a, b, p)`.
fn edge(a: [f32; 2], b: [f32; 2], p: [f32; 2]) -> f32 {
	(p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])
}

/// Bilinear sample of a premultiplied RGBA texture, in normalized coordinates.
fn sample(image: &ColorImage, uv: [f32; 2]) -> [f32; 4] {
	let (w, h) = (image.size[0], image.size[1]);
	if w == 0 || h == 0 {
		return [1.0; 4];
	}
	let x = (uv[0] * w as f32 - 0.5).clamp(0.0, w as f32 - 1.0);
	let y = (uv[1] * h as f32 - 0.5).clamp(0.0, h as f32 - 1.0);
	let x0 = x.floor() as usize;
	let y0 = y.floor() as usize;
	let x1 = (x0 + 1).min(w - 1);
	let y1 = (y0 + 1).min(h - 1);
	let tx = x - x0 as f32;
	let ty = y - y0 as f32;
	let mut out = [0.0f32; 4];
	for (channel, value) in out.iter_mut().enumerate() {
		let p00 = f32::from(component(image.pixels[y0 * w + x0], channel));
		let p10 = f32::from(component(image.pixels[y0 * w + x1], channel));
		let p01 = f32::from(component(image.pixels[y1 * w + x0], channel));
		let p11 = f32::from(component(image.pixels[y1 * w + x1], channel));
		let top = p00 + (p10 - p00) * tx;
		let bottom = p01 + (p11 - p01) * tx;
		*value = top + (bottom - top) * ty;
	}
	out
}
