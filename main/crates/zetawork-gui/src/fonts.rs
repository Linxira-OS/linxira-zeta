// SPDX-License-Identifier: AGPL-3.0-only
//! Font loading: the CJK faces the interface needs, and the editor's mono face.
//!
//! egui's stock fonts carry **no CJK glyphs**: without a face loaded, every
//! Chinese character in the spec's interface renders as a tofu box. The shell
//! therefore loads two CJK faces explicitly:
//!
//! * a **UI** face — proportional, the interface face (Microsoft YaHei, Noto
//!   Sans SC, …) — as the fallback in the proportional family; and
//! * a **fixed-pitch** face — SimSun/NSimSun, Sarasa Mono SC, Noto Sans Mono
//!   CJK, … — ahead of the UI face in the monospace family, the editor's
//!   fallback stack and the grid family [`crate::blit::GRID_FAMILY`], whose
//!   ASCII advance is exactly half its full-width advance.
//!
//! The split matters. A proportional CJK glyph has a variable advance, so CJK
//! inside monospace text (status lines, log/diff rows, grid cells) is uneven
//! and a full-width glyph is not two half-width cells. The fixed-pitch face
//! restores the 1:2 advance rule the terminal blit's column math depends on;
//! the UI face stays bound behind it as a last resort, and 关于 says so when no
//! fixed-pitch face was found.
//!
//! Faces are taken from the host, because this repository ships no licensed
//! face. **Shipping the product needs a licensed CJK face bundled as an
//! asset**; the 关于 section names whichever files were actually used, so a
//! missing face is visible rather than silent.

use std::path::PathBuf;
use std::sync::Arc;

use egui::{FontData, FontDefinitions, FontFamily};

use crate::settings::{MonoFont, Settings};

/// The editor code pane's family: the chosen mono face, then the CJK fallback.
pub const EDITOR_FAMILY: &str = "zetawork-editor";

/// egui font-data name of the UI (proportional) CJK face.
const CJK_UI_FACE: &str = "cjk-ui";

/// egui font-data name of the fixed-pitch CJK face.
const CJK_MONO_FACE: &str = "cjk-mono";

/// Windows faces, in preference order. SimSun and NSimSun live in the same
/// collection (face 0 and 1); both have a uniform 128/256 adv for ASCII/CJK.
#[cfg(windows)]
const FIXED_PITCH_CJK: &[(&str, u32)] = &[
	(r"C:\Windows\Fonts\simsun.ttc", 0), // SimSun
	(r"C:\Windows\Fonts\simsun.ttc", 1), // NSimSun
	(r"C:\Windows\Fonts\SarasaMonoSC-Regular.ttf", 0),
	(r"C:\Windows\Fonts\NotoSansMonoCJKsc-Regular.otf", 0),
];

/// Linux faces, in preference order.
#[cfg(target_os = "linux")]
const FIXED_PITCH_CJK: &[(&str, u32)] = &[
	("/usr/share/fonts/truetype/sarasa-gothic/SarasaMonoSC-Regular.ttf", 0),
	("/usr/share/fonts/opentype/sarasa-gothic/SarasaMonoSC-Regular.ttf", 0),
	("/usr/share/fonts/opentype/noto/NotoSansMonoCJKsc-Regular.otf", 0),
	("/usr/share/fonts/truetype/noto/NotoSansMonoCJKsc-Regular.otf", 0),
	("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 1), // WenQuanYi Zen Hei Mono
];

/// macOS has no bundled fixed-pitch CJK face; Sarasa may be installed.
#[cfg(target_os = "macos")]
const FIXED_PITCH_CJK: &[(&str, u32)] = &[
	("/Library/Fonts/SarasaMonoSC-Regular.ttf", 0),
	("/Library/Fonts/SarasaMonoSC-Regular.otf", 0),
];

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
const FIXED_PITCH_CJK: &[(&str, u32)] = &[];

/// The interface (proportional) faces, in preference order. These are the
/// host's UI faces; the list was the whole CJK fallback before the split.
#[cfg(windows)]
const UI_CJK: &[(&str, u32)] = &[
	(r"C:\Windows\Fonts\msyh.ttc", 0),
	(r"C:\Windows\Fonts\simhei.ttf", 0),
	(r"C:\Windows\Fonts\Deng.ttf", 0),
	(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 0),
	(r"C:\Windows\Fonts\simsun.ttc", 0),
];

#[cfg(target_os = "linux")]
const UI_CJK: &[(&str, u32)] = &[
	("/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc", 0),
	("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
	("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", 0),
	("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 0),
	("/usr/share/fonts/truetype/arphic/uming.ttc", 0),
];

#[cfg(target_os = "macos")]
const UI_CJK: &[(&str, u32)] = &[
	("/System/Library/Fonts/PingFang.ttc", 0),
	("/Library/Fonts/Arial Unicode.ttf", 0),
];

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
const UI_CJK: &[(&str, u32)] = &[];

/// Which family a CJK fallback chain is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CjkRole {
	/// Interface text: the proportional family takes the UI face alone.
	Ui,
	/// Monospace text, the editor fallback, and the grid: fixed-pitch first.
	Mono,
}

/// What was loaded, for the 关于 section.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Fonts {
	/// The UI (proportional) CJK face, and the index inside its file.
	pub cjk_ui: Option<(PathBuf, u32)>,
	/// The fixed-pitch CJK face, and the index inside its file. `None` means
	/// the monospace/grid families fell back to the UI face.
	pub cjk_mono: Option<(PathBuf, u32)>,
	/// The mono face the editor and terminal panes use.
	pub mono: Option<PathBuf>,
	/// The mono face the user asked for, when it is not the one loaded.
	pub mono_missing: Option<String>,
}

impl Fonts {
	/// One line for 关于: both CJK faces, and a warning when no fixed-pitch
	/// face was found (full-width alignment may then drift).
	pub fn cjk_line(&self) -> String {
		let ui = face_name(self.cjk_ui.as_ref());
		match (self.cjk_ui.as_ref(), self.cjk_mono.as_ref()) {
			(None, None) => {
				"CJK 字体：未找到（中文会显示为方块；产品需内置一款授权字体）".to_owned()
			},
			(Some(_), None) => {
				format!("CJK 字体：界面 {ui} · 等宽 未找到固定宽度中文字体（全角对齐可能漂移）")
			},
			(None, Some(_)) => format!(
				"CJK 字体：界面 未找到（中文会显示为方块） · 等宽 {}",
				face_name(self.cjk_mono.as_ref())
			),
			(Some(_), Some(_)) => format!(
				"CJK 字体：界面 {ui} · 等宽 {}",
				face_name(self.cjk_mono.as_ref())
			),
		}
	}

	/// One line for 关于: the editor's mono face.
	pub fn mono_line(&self) -> String {
		match (&self.mono, &self.mono_missing) {
			(Some(path), _) => format!("等宽字体：{}", path.display()),
			(None, Some(wanted)) => {
				format!("等宽字体：{wanted} 未安装，回退到 CJK 等宽字体")
			},
			(None, None) => "等宽字体：回退到 CJK 等宽字体".to_owned(),
		}
	}
}

fn face_name(face: Option<&(PathBuf, u32)>) -> String {
	match face {
		Some((path, index)) => format!("{}（face {index}）", path.display()),
		None => "未找到".to_owned(),
	}
}

fn candidates(entries: &[(&str, u32)]) -> Vec<(PathBuf, u32)> {
	entries.iter().map(|(path, index)| (PathBuf::from(path), *index)).collect()
}

/// The UI (proportional) CJK candidates, in preference order.
pub fn cjk_ui_candidates() -> Vec<(PathBuf, u32)> {
	candidates(UI_CJK)
}

/// The fixed-pitch CJK candidates, in preference order.
///
/// Only faces with a uniform CJK advance belong here: the grid's column math
/// assumes the ASCII advance is exactly half the full-width advance.
pub fn fixed_pitch_cjk_candidates() -> Vec<(PathBuf, u32)> {
	candidates(FIXED_PITCH_CJK)
}

/// The monospace/grid CJK candidates: fixed-pitch first, then the UI list as
/// the last resort.
pub fn cjk_mono_candidates() -> Vec<(PathBuf, u32)> {
	let mut candidates = fixed_pitch_cjk_candidates();
	candidates.extend(cjk_ui_candidates());
	candidates
}

/// The CJK fallback chain for `role`, given which faces loaded.
///
/// The monospace chain puts the fixed-pitch face first so the 1:2 advance rule
/// holds; the UI face stays behind it as the last resort. The proportional
/// chain uses the UI face alone — a fixed-pitch face there would make interface
/// Latin look monospaced.
pub fn cjk_fallbacks(role: CjkRole, ui_loaded: bool, mono_loaded: bool) -> Vec<&'static str> {
	match role {
		CjkRole::Ui if ui_loaded => vec![CJK_UI_FACE],
		CjkRole::Ui => Vec::new(),
		CjkRole::Mono => {
			let mut faces = Vec::new();
			if mono_loaded {
				faces.push(CJK_MONO_FACE);
			}
			if ui_loaded {
				faces.push(CJK_UI_FACE);
			}
			faces
		},
	}
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
	// The interface face: proportional, for interface text.
	if let Some((bytes, index, path)) = load_first(&cjk_ui_candidates()) {
		definitions.font_data.insert(
			CJK_UI_FACE.to_owned(),
			Arc::new(FontData { font: bytes.into(), index, tweak: Default::default() }),
		);
		report.cjk_ui = Some((path, index));
	}
	// The fixed-pitch face: the monospace and grid families need its uniform
	// advance, so it is loaded from its own list, never smuggled in as the UI
	// face.
	if let Some((bytes, index, path)) = load_first(&fixed_pitch_cjk_candidates()) {
		definitions.font_data.insert(
			CJK_MONO_FACE.to_owned(),
			Arc::new(FontData { font: bytes.into(), index, tweak: Default::default() }),
		);
		report.cjk_mono = Some((path, index));
	}

	let ui_loaded = report.cjk_ui.is_some();
	let mono_loaded = report.cjk_mono.is_some();
	let ui_faces = cjk_fallbacks(CjkRole::Ui, ui_loaded, mono_loaded);
	let mono_faces = cjk_fallbacks(CjkRole::Mono, ui_loaded, mono_loaded);

	// Proportional: the UI face after egui's stock interface fonts.
	{
		let family = definitions.families.entry(FontFamily::Proportional).or_default();
		family.extend(ui_faces.iter().map(|name| (*name).to_owned()));
	}
	// Monospace: the fixed-pitch face first, then the UI face as last resort.
	{
		let family = definitions.families.entry(FontFamily::Monospace).or_default();
		family.extend(mono_faces.iter().map(|name| (*name).to_owned()));
	}

	// The editor's mono face, if the host has it, then the CJK fallbacks.
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
	editor_stack.extend(mono_faces.iter().map(|name| (*name).to_owned()));
	editor_stack.push("Hack".to_owned());
	definitions
		.families
		.insert(FontFamily::Name(EDITOR_FAMILY.into()), editor_stack);
	// The grid family is fixed-pitch first: its ASCII advance is half its
	// full-width advance, which is the property `blit` advances cells with.
	// The UI face trails as the last resort so CJK still renders (with the
	// drift 关于 warns about) when no fixed-pitch face is installed.
	if !mono_faces.is_empty() {
		definitions.families.insert(
			FontFamily::Name(crate::blit::GRID_FAMILY.into()),
			mono_faces.iter().map(|name| (*name).to_owned()).collect(),
		);
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
			assert!(!cjk_ui_candidates().is_empty());
			assert!(!fixed_pitch_cjk_candidates().is_empty());
			assert!(!cjk_mono_candidates().is_empty());
		}
		assert!(!mono_candidates(MonoFont::CascadiaCode).is_empty());
	}

	#[test]
	fn the_mono_list_is_fixed_pitch_first_and_the_ui_list_last() {
		let mono = cjk_mono_candidates();
		let fixed = fixed_pitch_cjk_candidates();
		let ui = cjk_ui_candidates();
		assert_eq!(mono.len(), fixed.len() + ui.len());
		assert_eq!(&mono[..fixed.len()], &fixed[..], "fixed-pitch faces lead");
		assert_eq!(&mono[fixed.len()..], &ui[..], "the UI list is the tail");
	}

	#[cfg(windows)]
	#[test]
	fn windows_fixed_pitch_candidates_start_with_simsun_then_nsimsun() {
		let fixed = fixed_pitch_cjk_candidates();
		assert_eq!(
			fixed[0],
			(PathBuf::from(r"C:\Windows\Fonts\simsun.ttc"), 0),
			"SimSun is first"
		);
		assert_eq!(
			fixed[1],
			(PathBuf::from(r"C:\Windows\Fonts\simsun.ttc"), 1),
			"then NSimSun from the same collection"
		);
		let names: Vec<String> = fixed
			.iter()
			.map(|(path, _)| path.file_name().unwrap().to_string_lossy().to_ascii_lowercase())
			.collect();
		let sarasa = names.iter().position(|name| name.contains("sarasamono"));
		let noto = names.iter().position(|name| name.contains("notosansmono"));
		if let (Some(sarasa), Some(noto)) = (sarasa, noto) {
			assert!(sarasa < noto, "Sarasa Mono SC precedes Noto Sans Mono CJK");
		}
	}

	#[cfg(target_os = "linux")]
	#[test]
	fn linux_fixed_pitch_candidates_are_sarasa_then_noto_then_wqy() {
		let fixed = fixed_pitch_cjk_candidates();
		let names: Vec<String> = fixed
			.iter()
			.map(|(path, _)| path.file_name().unwrap().to_string_lossy().to_ascii_lowercase())
			.collect();
		assert!(names[0].contains("sarasamono"));
		let sarasa = names.iter().position(|name| name.contains("sarasamono")).unwrap();
		let noto = names.iter().position(|name| name.contains("notosansmono"));
		let wqy = names.iter().position(|name| name.contains("wqy-zenhei"));
		if let Some(noto) = noto {
			assert!(sarasa < noto, "Noto Sans Mono CJK follows Sarasa Mono SC");
		}
		if let Some(wqy) = wqy {
			assert!(noto.is_none_or(|noto| noto < wqy), "WenQuanYi Zen Hei Mono is last");
		}
	}

	#[test]
	fn the_fixed_pitch_face_leads_mono_bindings_and_the_ui_face_is_the_last_resort() {
		assert_eq!(cjk_fallbacks(CjkRole::Mono, true, true), vec![CJK_MONO_FACE, CJK_UI_FACE]);
		assert_eq!(
			cjk_fallbacks(CjkRole::Mono, true, false),
			vec![CJK_UI_FACE],
			"without a fixed-pitch face the UI face is the fallback"
		);
		assert_eq!(cjk_fallbacks(CjkRole::Mono, false, true), vec![CJK_MONO_FACE]);
		assert!(cjk_fallbacks(CjkRole::Mono, false, false).is_empty());
		assert_eq!(cjk_fallbacks(CjkRole::Ui, true, true), vec![CJK_UI_FACE]);
		assert!(
			cjk_fallbacks(CjkRole::Ui, false, true).is_empty(),
			"the proportional family never takes the fixed-pitch face"
		);
	}

	#[test]
	fn a_missing_face_is_reported_not_faked() {
		let fonts = Fonts::default();
		assert!(fonts.cjk_ui.is_none());
		assert!(fonts.cjk_mono.is_none());
		assert!(fonts.cjk_line().contains("未找到"));
		let fonts = Fonts {
			cjk_ui: Some((PathBuf::from("C:/Windows/Fonts/msyh.ttc"), 0)),
			cjk_mono: Some((PathBuf::from("C:/Windows/Fonts/simsun.ttc"), 1)),
			mono: None,
			mono_missing: Some("Cascadia Code".to_owned()),
		};
		assert!(fonts.cjk_line().contains("msyh.ttc"));
		assert!(fonts.cjk_line().contains("simsun.ttc"));
		assert!(fonts.mono_line().contains("Cascadia Code"));
	}

	#[test]
	fn a_missing_fixed_pitch_face_warns_that_full_width_alignment_may_drift() {
		let fonts = Fonts {
			cjk_ui: Some((PathBuf::from("C:/Windows/Fonts/msyh.ttc"), 0)),
			cjk_mono: None,
			mono: None,
			mono_missing: None,
		};
		let line = fonts.cjk_line();
		assert!(line.contains("msyh.ttc"), "the UI face is still reported");
		assert!(line.contains("固定宽度") && line.contains("漂移"));
	}

	#[test]
	fn loading_a_candidate_that_does_not_exist_is_none() {
		let missing = vec![(PathBuf::from("definitely-not-a-font.ttf"), 0)];
		assert!(load_first(&missing).is_none());
	}
}
