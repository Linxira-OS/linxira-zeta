// SPDX-License-Identifier: AGPL-3.0-only
//! Embed the Zeta PE icon in the native Windows TUI (`zeta-work-*.exe`).
//!
//! The GUI has its own resource script (icon + DPI manifest). The TUI and the
//! vendored IDE are console applications, but Explorer and installers still
//! read the PE icon resource; without this they fall back to the generic
//! window/document icon. Release builds targeting `x86_64-pc-windows-gnu`
//! must fail rather than ship an iconless binary when `windres` is missing.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
	println!("cargo:rerun-if-changed=build.rs");
	println!("cargo:rerun-if-changed=assets/zeta-main.rc");
	println!("cargo:rerun-if-changed=../zetawork-gui/assets/icon.ico");

	if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
		return;
	}
	if env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("gnu") {
		return;
	}

	let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
	let script = manifest_dir.join("assets").join("zeta-main.rc");
	let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
	let object = out_dir.join("zeta-main-resource.o");

	match compile(&script, &object, &manifest_dir) {
		Ok(()) => println!("cargo:rustc-link-arg={}", object.display()),
		Err(error) => {
			if env::var("PROFILE").as_deref() == Ok("release")
				&& env::var("ZETA_ALLOW_MISSING_WINDOWS_ICON").is_err()
			{
				panic!("could not compile the Windows icon resource: {error}");
			}
			println!("cargo:warning=could not compile the Windows icon resource: {error}");
		},
	}
}

fn candidates() -> Vec<String> {
	let mut out = Vec::new();
	if let Ok(windres) = env::var("WINDRES") {
		out.push(windres);
	}
	if let Ok(linker) = env::var("CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER")
		.or_else(|_| env::var("CARGO_TARGET_AARCH64_PC_WINDOWS_GNU_LINKER"))
	{
		let path = Path::new(&linker);
		if let Some(dir) = path.parent() {
			if !dir.as_os_str().is_empty() {
				let sibling = dir.join("windres");
				if sibling.exists() {
					out.push(sibling.display().to_string());
				}
			}
		}
		if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
			if let Some(prefix) = name.strip_suffix("gcc") {
				out.push(format!("{prefix}windres"));
			}
		}
	}
	match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
		Ok("aarch64") => out.push("aarch64-w64-mingw32-windres".to_owned()),
		_ => out.push("x86_64-w64-mingw32-windres".to_owned()),
	}
	out.push("windres".to_owned());
	out.dedup();
	out
}

fn compile(script: &Path, object: &Path, cwd: &Path) -> Result<(), String> {
	let mut errors = Vec::new();
	for windres in candidates() {
		let status = Command::new(&windres)
			.arg("--input")
			.arg(script)
			.arg("--output")
			.arg(object)
			.arg("--output-format=coff")
			.arg(format!("--include-dir={}", cwd.join("assets").display()))
			.current_dir(cwd)
			.status();
		match status {
			Ok(status) if status.success() => return Ok(()),
			Ok(status) => errors.push(format!("{windres} exited with {status}")),
			Err(error) => errors.push(format!("{windres}: {error}")),
		}
	}
	Err(errors.join("; "))
}
