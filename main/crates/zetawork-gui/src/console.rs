// SPDX-License-Identifier: AGPL-3.0-only
//! Console plumbing for a GUI-subsystem binary.
//!
//! `#![windows_subsystem = "windows"]` means Windows does not allocate a
//! console, so the process starts with invalid std handles and `println!`
//! silently goes nowhere. Commands that answer on the terminal (`--version`,
//! and error text printed before a window exists) must first attach to the
//! console of the process that launched them — `cmd.exe`/PowerShell own one,
//! Explorer does not.

/// Print one line the way a GUI-subsystem process has to.
///
/// `println!` cannot be used here: with `windows_subsystem = "windows"` the
/// process starts without a console, and Rust's cached std handle is invalid
/// even when the launcher redirected the stream. Write through `WriteFile` on
/// the handle the launcher gave us (a file or pipe under `>`, a console under
/// an interactive shell); only when there is no usable handle at all do we
/// attach to the parent's console and write there.
#[cfg(windows)]
pub fn emit_line(text: &str) {
	use std::io::Write;
	use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
	use windows_sys::Win32::Storage::FileSystem::WriteFile;
	use windows_sys::Win32::System::Console::{
		ATTACH_PARENT_PROCESS, AttachConsole, GetStdHandle, STD_OUTPUT_HANDLE,
	};

	let mut line = String::with_capacity(text.len() + 2);
	line.push_str(text);
	line.push_str("\r\n");

	// SAFETY: writes from a live buffer to a handle owned by the process.
	unsafe fn write(handle: *mut core::ffi::c_void, bytes: &[u8]) -> bool {
		let mut written = 0u32;
		let ok =
			WriteFile(handle, bytes.as_ptr(), bytes.len() as u32, &mut written, std::ptr::null_mut());
		ok != 0 && written as usize == bytes.len()
	}

	// SAFETY: no pointers; report-only.
	let handle = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
	if !handle.is_null() && !std::ptr::eq(handle, INVALID_HANDLE_VALUE) {
		// SAFETY: the handle came from the launcher and the buffer outlives the call.
		if unsafe { write(handle, line.as_bytes()) } {
			return;
		}
	}

	// SAFETY: associates with the parent's console when it has one.
	unsafe {
		AttachConsole(ATTACH_PARENT_PROCESS);
	}
	if let Ok(mut console) = std::fs::OpenOptions::new().write(true).open("CONOUT$") {
		let _ = console.write_all(line.as_bytes());
		let _ = console.flush();
	}
}

/// Non-Windows builds have a working stdio.
#[cfg(not(windows))]
pub fn emit_line(text: &str) {
	println!("{text}");
}

/// Give the process a stable taskbar identity.
///
/// Without it Windows groups the window under the executable path, so a
/// pinned Start-Menu shortcut and the running app can appear as two entries,
/// and toast notifications are attributed to "zetawork-gui". The id is the
/// product's, not a path — changing it later splits the grouping.
#[cfg(windows)]
pub fn set_app_user_model_id(id: &str) {
	use std::os::windows::ffi::OsStrExt;
	let wide: Vec<u16> = std::ffi::OsStr::new(id)
		.encode_wide()
		.chain(std::iter::once(0))
		.collect();
	// SAFETY: the pointer is a NUL-terminated UTF-16 string that outlives the call.
	unsafe {
		windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(
			windows_sys::core::PCWSTR::from(wide.as_ptr()),
		);
	}
}

/// Non-Windows builds have a console-capable process already.
#[cfg(not(windows))]
pub fn attach_parent_console() {}

/// Non-Windows desktops derive grouping from the .desktop file's
/// `StartupWMClass`; there is nothing to set here.
#[cfg(not(windows))]
pub fn set_app_user_model_id(_id: &str) {}
