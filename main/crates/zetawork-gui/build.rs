// SPDX-License-Identifier: AGPL-3.0-only
//! Windows resources: the PE icon and the per-monitor-v2 DPI manifest.
//!
//! Release builds target `x86_64-pc-windows-gnu`, whose toolchain ships
//! `windres`; compiling the resource script here avoids an extra crate and
//! works offline. MSVC development builds skip this step (the resource is
//! cosmetic there), as does every non-Windows target.
//!
//! The window icon at runtime (`icons::app_icon`) only affects the live
//! window; Explorer, the Start Menu and the installer read the PE resource
//! that this script embeds.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
	println!("cargo:rerun-if-changed=assets/zetawork-gui.rc");
	println!("cargo:rerun-if-changed=assets/zetawork-gui.manifest");
	println!("cargo:rerun-if-changed=assets/icon.ico");

	if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
		return;
	}
	if env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("gnu") {
		return;
	}

	let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
	let script = manifest_dir.join("assets").join("zetawork-gui.rc");
	let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
	let object = out_dir.join("zetawork-gui-resource.o");

	let windres = env::var("WINDRES").unwrap_or_else(|_| default_windres());
	if let Err(error) = compile(&windres, &script, &object, &manifest_dir) {
		// A missing windres must not break a developer's `cargo check`; the
		// release pipeline has it and the failure is visible there.
		println!("cargo:warning=could not compile the Windows resources: {error}");
		return;
	}
	println!("cargo:rustc-link-arg={}", object.display());
}

/// The mingw `windres` matching the linker this workspace already uses.
fn default_windres() -> String {
	if let Ok(prefix) = env::var("CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER") {
		// The linker is `…/x86_64-w64-mingw32-gcc`; windres sits beside it.
		if let Some(dir) = Path::new(&prefix).parent() {
			let candidate = dir.join("windres");
			if candidate.exists() {
				return candidate.display().to_string();
			}
		}
	}
	"windres".to_owned()
}

fn compile(windres: &str, script: &Path, object: &Path, cwd: &Path) -> Result<(), String> {
	let status = Command::new(windres)
		.arg("--input")
		.arg(script)
		.arg("--output")
		.arg(object)
		.arg("--output-format=coff")
		.arg(format!("--include-dir={}", cwd.join("assets").display()))
		.current_dir(cwd)
		.status()
		.map_err(|error| format!("{windres}: {error}"))?;
	if !status.success() {
		return Err(format!("{windres} exited with {status}"));
	}
	Ok(())
}
