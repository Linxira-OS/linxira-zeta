//! Screenshot evidence.
//!
//! Two different captures, because they prove different things:
//!
//! * [`save_scene`] uses GPUI's own `Window::render_to_image`, i.e. the
//!   *scene* the DirectX renderer draws. Exact, headless-ish, and it cannot
//!   contain the WebView2 child window (a separate HWND).
//! * [`save_window`] uses Win32 `PrintWindow(PW_RENDERFULLCONTENT)` on **our
//!   own window** — the same process, the handle we were handed — which is the
//!   only way to get the WebView2 pixels into a PNG. No other process is
//!   touched, nothing is enumerated by name, no input is synthesised.

use std::path::Path;

use gpui_kit::Window;

/// Render the GPUI scene of `window` into `path`.
pub fn save_scene(window: &Window, path: &Path) -> anyhow::Result<()> {
	let image = window.render_to_image()?;
	if let Some(parent) = path.parent() {
		std::fs::create_dir_all(parent)?;
	}
	image.save(path)?;
	println!("[shot] scene {}x{} -> {}", image.width(), image.height(), path.display());
	Ok(())
}

#[cfg(windows)]
mod win32 {
	use std::ffi::c_void;

	#[repr(C)]
	#[derive(Default, Clone, Copy)]
	pub struct Rect {
		pub left: i32,
		pub top: i32,
		pub right: i32,
		pub bottom: i32,
	}

	#[repr(C)]
	#[derive(Default, Clone, Copy)]
	pub struct BitmapInfoHeader {
		pub size: u32,
		pub width: i32,
		pub height: i32,
		pub planes: u16,
		pub bit_count: u16,
		pub compression: u32,
		pub size_image: u32,
		pub x_pels_per_meter: i32,
		pub y_pels_per_meter: i32,
		pub clr_used: u32,
		pub clr_important: u32,
	}

	#[repr(C)]
	#[derive(Default, Clone, Copy)]
	pub struct RgbQuad {
		pub blue: u8,
		pub green: u8,
		pub red: u8,
		pub reserved: u8,
	}

	#[repr(C)]
	#[derive(Clone, Copy)]
	pub struct BitmapInfo {
		pub header: BitmapInfoHeader,
		pub colors: [RgbQuad; 1],
	}

	#[link(name = "user32")]
	unsafe extern "system" {
		pub fn GetWindowRect(hwnd: *mut c_void, rect: *mut Rect) -> i32;
		/// `flags = 2` is `PW_RENDERFULLCONTENT`, which asks DWM for the
		/// composed window instead of a client-area BitBlt.
		pub fn PrintWindow(hwnd: *mut c_void, hdc: *mut c_void, flags: u32) -> i32;
		pub fn GetWindowDC(hwnd: *mut c_void) -> *mut c_void;
		pub fn ReleaseDC(hwnd: *mut c_void, hdc: *mut c_void) -> i32;
	}

	#[link(name = "gdi32")]
	unsafe extern "system" {
		pub fn CreateCompatibleDC(hdc: *mut c_void) -> *mut c_void;
		pub fn CreateCompatibleBitmap(hdc: *mut c_void, width: i32, height: i32) -> *mut c_void;
		pub fn SelectObject(hdc: *mut c_void, object: *mut c_void) -> *mut c_void;
		pub fn DeleteObject(object: *mut c_void) -> i32;
		pub fn DeleteDC(hdc: *mut c_void) -> i32;
		pub fn GetDIBits(
			hdc: *mut c_void,
			bitmap: *mut c_void,
			start: u32,
			lines: u32,
			bits: *mut c_void,
			info: *mut BitmapInfo,
			usage: u32,
		) -> i32;
	}
}

/// Capture our own window, WebView2 included, into `path`.
#[cfg(windows)]
pub fn save_window(window: &Window, path: &Path) -> anyhow::Result<()> {
	use raw_window_handle::RawWindowHandle;
	use win32::*;

	let handle = raw_window_handle::HasWindowHandle::window_handle(window)?;
	let RawWindowHandle::Win32(win) = handle.as_raw() else {
		anyhow::bail!("not a Win32 window handle");
	};
	let hwnd = win.hwnd.get() as *mut std::ffi::c_void;

	if let Some(parent) = path.parent() {
		std::fs::create_dir_all(parent)?;
	}

	unsafe {
		let mut rect = Rect::default();
		anyhow::ensure!(GetWindowRect(hwnd, &mut rect) != 0, "GetWindowRect failed");
		let width = rect.right - rect.left;
		let height = rect.bottom - rect.top;
		anyhow::ensure!(width > 0 && height > 0, "window has no size yet");

		let screen_dc = GetWindowDC(hwnd);
		anyhow::ensure!(!screen_dc.is_null(), "GetWindowDC failed");
		let mem_dc = CreateCompatibleDC(screen_dc);
		let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
		anyhow::ensure!(!mem_dc.is_null() && !bitmap.is_null(), "GDI allocation failed");
		let previous = SelectObject(mem_dc, bitmap);

		let printed = PrintWindow(hwnd, mem_dc, 2);

		let mut info = BitmapInfo {
			header: BitmapInfoHeader {
				size: std::mem::size_of::<BitmapInfoHeader>() as u32,
				width,
				height: -height, // top-down
				planes: 1,
				bit_count: 32,
				compression: 0, // BI_RGB
				..Default::default()
			},
			colors: [RgbQuad::default()],
		};
		let mut bits = vec![0u8; (width as usize) * (height as usize) * 4];
		let lines = GetDIBits(
			mem_dc,
			bitmap,
			0,
			height as u32,
			bits.as_mut_ptr().cast(),
			&mut info,
			0, // DIB_RGB_COLORS
		);

		SelectObject(mem_dc, previous);
		DeleteObject(bitmap);
		DeleteDC(mem_dc);
		ReleaseDC(hwnd, screen_dc);

		anyhow::ensure!(lines == height, "GetDIBits returned {lines} of {height} lines");
		for pixel in bits.as_chunks_mut::<4>().0 {
			pixel.swap(0, 2); // BGRA -> RGBA
			pixel[3] = 255;
		}
		let image = image::RgbaImage::from_raw(width as u32, height as u32, bits)
			.ok_or_else(|| anyhow::anyhow!("DIB size mismatch"))?;
		image.save(path)?;
		println!("[shot] PrintWindow {}x{} ok={} -> {}", width, height, printed != 0, path.display());
	}
	Ok(())
}

#[cfg(not(windows))]
pub fn save_window(_window: &Window, _path: &Path) -> anyhow::Result<()> {
	anyhow::bail!("PrintWindow capture is Windows-only")
}
