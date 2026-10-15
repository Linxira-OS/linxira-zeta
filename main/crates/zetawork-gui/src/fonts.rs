//! Font loading: the CJK face the interface needs, and the editor's mono face.
//!
//! egui's stock fonts carry **no CJK glyphs**: without a face loaded, every
//! Chinese character in the spec's interface renders as a tofu box. The shell
//! therefore loads a CJK face explicitly and binds it three ways:
//!
//! * as a fallback in the proportional and monospace families, so interface
//!   text (and any CJK inside it) renders;
//! * as the whole of the named editor family, after the mono face the user
//!   picked in 设置 → 编辑器 → 等宽字体; and
//! * as the whole of the grid family [`crate::blit::GRID_FAMILY`], whose ASCII
//!   advance is half its full-width advance — the property the terminal blit's
//!   column math depends on.
//!
//! Faces are taken from the host, because this repository ships no licensed
//! face. **Shipping the product needs a licensed CJK face bundled as an
//! asset**; the 关于 section names whichever file was actually used, so a
//! missing face is visible rather than silent.

use std::path::PathBuf;
use std::sync::Arc;

use egui::{FontData, FontDefinitions, FontFamily};

use crate::settings::{MonoFont, Settings};

/// The editor code pane's family: the chosen mono face, then the CJK fallback.
pub const EDITOR_FAMILY: &str = "zetawork-editor";

/// What was loaded, for the 关于 section.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Fonts {
	/// The CJK face, and the index inside its file.
	pub cjk: Option<(PathBuf, u32)>,
	/// The mono face the editor and terminal panes use.
	pub mono: Option<PathBuf>,
	/// The mono face the user asked for, when it is not the one loaded.
	pub mono_missing: Option<String>,
}

impl Fonts {
	/// One line for 关于: the CJK face.
	pub fn cjk_line(&self) -> String {
		match &self.cjk {
			Some((path, index)) => format!("CJK 字体：{}（face {index}）", path.display()),
			None => "CJK 字体：未找到（中文会显示为方块；产品需内置一款授权字体）".to_owned(),
		}
	}

	/// One line for 关于: the editor's mono face.
	pub fn mono_line(&self) -> String {
		match (&self.mono, &self.mono_missing) {
			(Some(path), _) => format!("等宽字体：{}", path.display()),
			(None, Some(wanted)) => {
				format!("等宽字体：{wanted} 未安装，回退到 CJK 网格字体")
			},
			(None, None) => "等宽字体：回退到 CJK 网格字体".to_owned(),
		}
	}
}

/// CJK candidates, in preference order.
pub fn cjk_candidates() -> Vec<(PathBuf, u32)> {
	let mut candidates = Vec::new();
	#[cfg(windows)]
	{
		for path in [
			r"C:\Windows\Fonts\msyh.ttc",
			r"C:\Windows\Fonts\simhei.ttf",
			r"C:\Windows\Fonts\Deng.ttf",
			r"C:\Windows\Fonts\NotoSansSC-VF.ttf",
			r"C:\Windows\Fonts\simsun.ttc",
		] {
			candidates.push((PathBuf::from(path), 0));
		}
	}
	#[cfg(target_os = "linux")]
	{
		for path in [
			"/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
			"/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
			"/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
			"/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
			"/usr/share/fonts/truetype/arphic/uming.ttc",
		] {
			candidates.push((PathBuf::from(path), 0));
		}
	}
	#[cfg(target_os = "macos")]
	{
		for path in ["/System/Library/Fonts/PingFang.ttc", "/Library/Fonts/Arial Unicode.ttf"] {
			candidates.push((PathBuf::from(path), 0));
		}
	}
	candidates
}

/// The editor/code font: the family [`install`] bound, or egui's monospace
/// before the first `set_fonts` takes effect (asking for an unbound
/// `FontFamily::Name` panics, so the first frame has to fall back).
pub fn editor_font_for(ctx: &egui::Context, size: f32) -> egui::FontId {
	let named = FontFamily::Name(EDITOR_FAMILY.into());
	let bound = ctx.fonts_mut(|fonts| fonts.definitions().families.contains_key(&named));
	if bound {
		egui::FontId::new(size, named)
	} else {
		egui::FontId::monospace(size)
	}
}

/// Candidates for the editor's mono face, per 设置 → 编辑器 → 等宽字体.
pub fn mono_candidates(font: MonoFont) -> Vec<PathBuf> {
	let mut candidates = Vec::new();
	#[cfg(windows)]
	{
		let windows = PathBuf::from(r"C:\Windows\Fonts");
		match font {
			MonoFont::CascadiaCode => {
				candidates.push(windows.join("CascadiaCode.ttf"));
				candidates.push(windows.join("CascadiaMono.ttf"));
			},
			MonoFont::JetBrainsMono => {
				candidates.push(windows.join("JetBrainsMono-Regular.ttf"));
				candidates.push(PathBuf::from(r"C:\Program Files\JetBrains\JetBrainsMono-Regular.ttf"));
			},
			MonoFont::Consolas => {
				candidates.push(windows.join("consola.ttf"));
			},
		}
	}
	#[cfg(target_os = "linux")]
	{
		match font {
			MonoFont::CascadiaCode => candidates
				.push(PathBuf::from("/usr/share/fonts/truetype/cascadia-code/CascadiaCode.ttf")),
			MonoFont::JetBrainsMono => candidates.push(PathBuf::from(
				"/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf",
			)),
			MonoFont::Consolas => {},
		}
	}
	#[cfg(target_os = "macos")]
	{
		match font {
			MonoFont::CascadiaCode => {
				candidates.push(PathBuf::from("/Library/Fonts/CascadiaCode.ttf"))
			},
			MonoFont::JetBrainsMono => {
				candidates.push(PathBuf::from("/Library/Fonts/JetBrainsMono-Regular.ttf"))
			},
			MonoFont::Consolas => {},
		}
	}
	candidates
}

/// The first candidate that exists.
pub fn load_first(candidates: &[(PathBuf, u32)]) -> Option<(Vec<u8>, u32, PathBuf)> {
	for (path, index) in candidates {
		if let Ok(bytes) = std::fs::read(path) {
			return Some((bytes, *index, path.clone()));
		}
	}
	None
}

/// Install the fonts for `settings` and report what was used.
///
/// Re-running this is how a font change in 设置 takes effect: `set_fonts` is
/// applied at the start of the next frame.
pub fn install(ctx: &egui::Context, settings: &Settings) -> Fonts {
	let mut definitions = FontDefinitions::default();
	let mut report = Fonts::default();
	let cjk_name = "cjk".to_owned();
	if let Some((bytes, index, path)) = load_first(&cjk_candidates()) {
		definitions.font_data.insert(
			cjk_name.clone(),
			Arc::new(FontData { font: bytes.into(), index, tweak: Default::default() }),
		);
		for family in [FontFamily::Proportional, FontFamily::Monospace] {
			definitions
				.families
				.entry(family)
				.or_default()
				.push(cjk_name.clone());
		}
		report.cjk = Some((path, index));
	}
	// The editor's mono face, if the host has it.
	let mut editor_stack: Vec<String> = Vec::new();
	let mono_candidates: Vec<(PathBuf, u32)> = mono_candidates(settings.mono_font)
		.into_iter()
		.map(|path| (path, 0))
		.collect();
	if let Some((bytes, _index, path)) = load_first(&mono_candidates) {
		let name = "editor-mono".to_owned();
		definitions.font_data.insert(
			name.clone(),
			Arc::new(FontData { font: bytes.into(), index: 0, tweak: Default::default() }),
		);
		editor_stack.push(name);
		report.mono = Some(path);
	} else {
		report.mono_missing = Some(settings.mono_font.label().to_owned());
	}
	if report.cjk.is_some() {
		editor_stack.push(cjk_name.clone());
	}
	editor_stack.push("Hack".to_owned());
	definitions
		.families
		.insert(FontFamily::Name(EDITOR_FAMILY.into()), editor_stack.clone());
	// The grid family is the CJK face alone: its ASCII advance is half its
	// full-width advance, which is the property `blit` advances cells with.
	if report.cjk.is_some() {
		definitions
			.families
			.insert(FontFamily::Name(crate::blit::GRID_FAMILY.into()), vec![cjk_name]);
	}
	ctx.set_fonts(definitions);
	report
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn candidate_lists_are_platform_specific_and_non_empty_on_supported_targets() {
		if cfg!(any(windows, target_os = "linux", target_os = "macos")) {
			assert!(!cjk_candidates().is_empty());
		}
		assert!(!mono_candidates(MonoFont::CascadiaCode).is_empty());
	}

	#[test]
	fn a_missing_face_is_reported_not_faked() {
		let fonts = Fonts::default();
		assert!(fonts.cjk.is_none());
		assert!(fonts.cjk_line().contains("未找到"));
		let fonts = Fonts {
			cjk: Some((PathBuf::from("C:/Windows/Fonts/msyh.ttc"), 0)),
			mono: None,
			mono_missing: Some("Cascadia Code".to_owned()),
		};
		assert!(fonts.cjk_line().contains("msyh.ttc"));
		assert!(fonts.mono_line().contains("Cascadia Code"));
	}

	#[test]
	fn loading_a_candidate_that_does_not_exist_is_none() {
		let missing = vec![(PathBuf::from("definitely-not-a-font.ttf"), 0)];
		assert!(load_first(&missing).is_none());
	}
}
