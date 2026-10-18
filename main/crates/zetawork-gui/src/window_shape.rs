// SPDX-License-Identifier: AGPL-3.0-only
//! The window's own corners.
//!
//! Every card, modal and control inside the shell is rounded
//! ([`crate::theme::R_CONTROL`] → [`crate::theme::R_MODAL`]), but the shell is
//! frameless (`decorations: false`), so the OS hands it a square rectangle and
//! the outer silhouette contradicted the inner one. This module makes the
//! frame follow the same language. The radius itself is the platform's
//! (`DWMWCP_ROUND`), so the shell does not invent one.
//!
//! One mechanism, applied **once**: **DWM corner preference**
//! (`DWMWA_WINDOW_CORNER_PREFERENCE`, Windows 11 build 22000+). The compositor
//! draws an antialiased corner and keeps the drop shadow — the result the
//! platform gives a decorated window.
//!
//! A rounded `SetWindowRgn` was tried first as the pre-22000 fallback and is
//! deliberately gone: re-applying a region every frame made winit's window
//! procedure fail with `0xC000041D` (fatal user-callback exception) about a
//! minute into a session, killing the shell. A build that ignores the DWM
//! attribute keeps square corners — the safe side of that trade.
//!
//! Design intent (2026-10-18): the GUI is egui, not the HTML draft, so the two
//! are **not** expected to match pixel for pixel — the shared thing is that
//! every surface the user sees has a corner radius; inner surfaces take a token
//! from the scale (control 4 / panel 6 / modal 8) and the window follows the
//! platform.
//!
//! Nothing here is testable headlessly: the harness has no window. The pure
//! part ([`region_diameter`]) is unit-tested; the rest is verified by running
//! the binary and looking at the frame.

use crate::embed::NativeWindow;

/// The corner state of the shell's window, kept across frames so the syscalls
/// run once per change instead of once per frame.
#[derive(Default)]
pub struct Corners {
	/// Set on the first frame that has a window. It gates the call itself:
	/// repeating `DwmSetWindowAttribute` every frame makes the compositor
	/// restyle the frame continuously and takes the window procedure down
	/// (`0xC000041D`) a minute or two in. Windows-only, like the call it gates:
	/// on other targets nothing would ever read it (`-D warnings` says so).
	#[cfg(windows)]
	applied: bool,
	/// Whether the compositor accepted the preference. A fact, not a gate — a
	/// build that refuses it keeps square corners and must not be retried.
	pub rounded: bool,
}

impl Corners {
	/// Round the window behind `window`, if this target has corners to round.
	///
	/// The call happens once: the compositor keeps the preference for the
	/// window's lifetime, and repeating it every frame is what made a rounded
	/// region fatal to winit's window procedure.
	pub fn apply(&mut self, window: &impl NativeWindow) {
		#[cfg(windows)]
		self.apply_windows(window);
		#[cfg(not(windows))]
		{
			let _ = window;
		}
	}

	#[cfg(windows)]
	fn apply_windows(&mut self, window: &impl NativeWindow) {
		use wry::raw_window_handle::RawWindowHandle;

		if self.applied {
			return;
		}
		let Ok(handle) = window.window_handle() else {
			return;
		};
		let RawWindowHandle::Win32(win32) = handle.as_raw() else {
			return;
		};
		let hwnd = win32.hwnd.get() as windows_sys::Win32::Foundation::HWND;
		self.applied = true;
		self.rounded = unsafe { prefer_round_corners(hwnd) };
	}
}

/// Ask DWM to round the window's corners. `true` when the compositor accepted
/// the request (Windows 11 22000+); `false` on anything older.
#[cfg(windows)]
unsafe fn prefer_round_corners(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
	use windows_sys::Win32::Graphics::Dwm::{DWMWA_WINDOW_CORNER_PREFERENCE, DwmSetWindowAttribute};

	/// `DWMWCP_ROUND`: the platform's standard rounded corner.
	const DWMWCP_ROUND: u32 = 2;
	let preference = DWMWCP_ROUND;
	let result = DwmSetWindowAttribute(
		hwnd,
		DWMWA_WINDOW_CORNER_PREFERENCE as u32,
		&preference as *const u32 as *const core::ffi::c_void,
		core::mem::size_of::<u32>() as u32,
	);
	result == 0
}
