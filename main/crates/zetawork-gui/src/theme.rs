// SPDX-License-Identifier: AGPL-3.0-only
//! The spec's design tokens, and the egui `Style` derived from them.
//!
//! Every colour here is copied from the `:root` block the two design drafts
//! share — `spec-v22-opendesign.html` (the GUI/information-surface draft, the
//! same bytes as `Downloads/index.html`) and `spec-v22-tui-workspace.html` (the
//! workspace-organising draft, the same bytes as `Downloads/workspace-v2.html`)
//! declare an identical `:root`, so a token rename in either is a one-line
//! change in this file. The shell never hard-codes a colour anywhere else.
//!
//! # The other palette, and why only one value is taken from it
//!
//! `mock.css` — the older `desktop.html` family's stylesheet, **not linked by
//! either draft** — declares a second set. Its names and values are recorded
//! here as the mapping, so a ruling in its favour is a mechanical edit:
//!
//! | this file (drafts' `:root`) | `mock.css :root` | value there |
//! |---|---|---|
//! | `GROUND` | `--bg` | `#0a0a0a` |
//! | `PANEL` | `--bg2` | `#171717` |
//! | `PANEL_3` | `--bg3` | `#1f1f1f` |
//! | `PANEL_4` | `--bg4` | `#2a2a2a` |
//! | `TEXT` | `--fg` | `#ededed` |
//! | `TEXT_2` | `--muted` | `#a1a1aa` |
//! | `TEXT_3` | `--dim` | `#71717a` |
//! | `BORDER` | `--border` | `#242424` |
//! | `BORDER_2` | `--border2` | `#333333` |
//! | `ACCENT` | `--accent` | `#5b9cf8` |
//! | `ADD` | `--ok` | `#4ac26b` |
//! | `WARN` | `--warn` | `#d8a534` |
//! | `DEL` | `--err` | `#f0645c` |
//! | `PURPLE` | `--purple` | `#b083f0` |
//! | `R_PANEL` | `--radius` | `10px` |
//!
//! Exactly one value is taken from it — [`PURPLE`] — because the drafts have no
//! purple at all and the contract's 状态词表 needs one for `◇ monitoring`.

use egui::{Color32, CornerRadius, FontFamily, FontId, Margin, Stroke, TextStyle};

use crate::settings::{Settings, Theme};

/// `--ground`
pub const GROUND: Color32 = Color32::from_rgb(0x0b, 0x0d, 0x11);
/// `--panel`
pub const PANEL: Color32 = Color32::from_rgb(0x0f, 0x12, 0x16);
/// `--panel-2`
pub const PANEL_2: Color32 = Color32::from_rgb(0x12, 0x15, 0x1b);
/// `--panel-3`
pub const PANEL_3: Color32 = Color32::from_rgb(0x17, 0x1b, 0x22);
/// `--panel-4`
pub const PANEL_4: Color32 = Color32::from_rgb(0x1c, 0x21, 0x29);
/// `--border`
pub const BORDER: Color32 = Color32::from_rgb(0x24, 0x2a, 0x34);
/// `--border-2`
pub const BORDER_2: Color32 = Color32::from_rgb(0x2f, 0x37, 0x42);
/// `--text`
pub const TEXT: Color32 = Color32::from_rgb(0xe7, 0xea, 0xf0);
/// `--text-2`
pub const TEXT_2: Color32 = Color32::from_rgb(0xaa, 0xb2, 0xc0);
/// `--text-3`
pub const TEXT_3: Color32 = Color32::from_rgb(0x8b, 0x93, 0xa1);
/// `--accent`
pub const ACCENT: Color32 = Color32::from_rgb(0x5b, 0x8d, 0xef);
/// `--accent-2`
pub const ACCENT_2: Color32 = Color32::from_rgb(0x7e, 0xa9, 0xf5);
/// `--accent-dim`
pub const ACCENT_DIM: Color32 = Color32::from_rgb(0x22, 0x31, 0x4d);
/// `--add`
pub const ADD: Color32 = Color32::from_rgb(0x3f, 0xb9, 0x50);
/// `--del`
pub const DEL: Color32 = Color32::from_rgb(0xf8, 0x51, 0x49);
/// `--warn`
pub const WARN: Color32 = Color32::from_rgb(0xd2, 0x99, 0x22);
/// `--cyan`
pub const CYAN: Color32 = Color32::from_rgb(0x39, 0xc5, 0xcf);

/// The ink for `◇ monitoring`, and the only token here that comes from
/// `mock.css`'s `:root` (`--purple`, applied by its `.d-mon` dot rule) rather
/// than from the drafts': neither draft declares a purple, and
/// [`crate::status::RunState`] needs one so the seven run states are seven
/// distinguishable colours. See the module doc for the full mapping.
pub const PURPLE: Color32 = Color32::from_rgb(0xb0, 0x83, 0xf0);

/// `.term` / `.diff` background (`#080a0d`).
pub const TERM_BG: Color32 = Color32::from_rgb(0x08, 0x0a, 0x0d);
/// `.termsub` background (`#0c0f13`).
pub const TERM_SUB_BG: Color32 = Color32::from_rgb(0x0c, 0x0f, 0x13);
/// `.term` text (`#c8d0db`).
pub const TERM_TEXT: Color32 = Color32::from_rgb(0xc8, 0xd0, 0xdb);
/// `.coderow .ln` / `.drow .dln` gutter (`#4c5563`).
pub const GUTTER: Color32 = Color32::from_rgb(0x4c, 0x55, 0x63);
/// `.tui-box` background (`#070a0e`).
pub const TUI_BOX: Color32 = Color32::from_rgb(0x07, 0x0a, 0x0e);
/// `.tui` background (`#05070a`).
pub const TUI_GROUND: Color32 = Color32::from_rgb(0x05, 0x07, 0x0a);
/// `.tui-term` background (`#04060a`).
pub const TUI_TERM_BG: Color32 = Color32::from_rgb(0x04, 0x06, 0x0a);
/// `.tui-term pre` text (`#b9c2ce`).
pub const TUI_TERM_TEXT: Color32 = Color32::from_rgb(0xb9, 0xc2, 0xce);
/// The composer accent (`#2b6cf6`).
pub const BRAND_A: Color32 = Color32::from_rgb(0x2b, 0x6c, 0xf6);
/// The mark gradient's other end.
pub const BRAND_B: Color32 = CYAN;
/// `.prbtn` (`#238636`).
pub const PR_GREEN: Color32 = Color32::from_rgb(0x23, 0x86, 0x36);

/// Syntax colours from the spec's `.tk-*` rules.
pub mod syntax {
	use egui::Color32;

	pub const KEYWORD: Color32 = Color32::from_rgb(0xc7, 0x92, 0xea);
	pub const STRING: Color32 = Color32::from_rgb(0xc3, 0xe8, 0x8d);
	pub const NUMBER: Color32 = Color32::from_rgb(0xf7, 0x8c, 0x6c);
	pub const COMMENT: Color32 = Color32::from_rgb(0x5c, 0x67, 0x73);
	pub const IDENT: Color32 = Color32::from_rgb(0xc8, 0xd0, 0xdb);
}

/// `.tui-row .tag` / `--cyan`.
pub const TAG: Color32 = CYAN;
/// `.tui-row.is-active` text (`#dce7ff`).
pub const TUI_ACTIVE_TEXT: Color32 = Color32::from_rgb(0xdc, 0xe7, 0xff);
/// `.tui-row.is-active` border (`#2c4877`).
pub const TUI_ACTIVE_BORDER: Color32 = Color32::from_rgb(0x2c, 0x48, 0x77);

/// `.chip.branch` — the branch chip's ink and surface.
pub const CHIP_BRANCH_INK: Color32 = CYAN;
pub const CHIP_BRANCH_BG: Color32 = Color32::from_rgb(0x10, 0x20, 0x1f);
pub const CHIP_BRANCH_BORDER: Color32 = Color32::from_rgb(0x1f, 0x3a, 0x3d);

/// Panel/control radii (`--r-ctl`, `--r-panel`, `--r-modal`).
pub const R_CONTROL: u8 = 4;
pub const R_PANEL: u8 = 6;
pub const R_MODAL: u8 = 8;

/// The title bar's height. The right column starts below it (the top-right
/// strip belongs to the window controls).
pub const TITLE_BAR_H: f32 = 36.0;
/// `.ws-topbar`
pub const TOPBAR_H: f32 = 40.0;
/// `.ws-toolstrip`
pub const TOOLSTRIP_H: f32 = 34.0;
/// `.tabstrip`
pub const TABSTRIP_H: f32 = 35.0;
/// `.statusbar`
pub const STATUSBAR_H: f32 = 30.0;
/// `.term` text size (`12.5px`) scaled to egui points at the shell's default
/// zoom.
pub const MONO_SIZE: f32 = 12.5;

/// The 24×24 viewBox every spec icon is drawn in, mapped into a button rect.
pub const ICON_BOX: f32 = 24.0;

/// Set the global style: colours, spacing, text styles, animation.
///
/// Called once at startup and again whenever a setting changes, so every
/// control (including egui's own scrollbars and selects) picks the change up on
/// the next frame.
pub fn apply(ctx: &egui::Context, settings: &Settings) {
	let mut style = (*ctx.style()).clone();
	style.visuals = visuals(settings.theme);
	style.text_styles = text_styles();
	let (spacing, padding) = settings.density.spacing();
	style.spacing.item_spacing = egui::vec2(6.0, spacing);
	style.spacing.button_padding = egui::vec2(padding, (padding - 1.0).max(1.0));
	style.spacing.menu_margin = Margin::same(6);
	style.spacing.interact_size = egui::vec2(28.0, 28.0);
	style.spacing.combo_width = 150.0;
	style.spacing.scroll.bar_width = 10.0;
	style.animation_time = if settings.reduce_motion { 0.0 } else { 0.16 };
	ctx.set_style(style);
}

fn text_styles() -> std::collections::BTreeMap<TextStyle, FontId> {
	let mut styles = std::collections::BTreeMap::new();
	styles.insert(TextStyle::Body, FontId::new(13.0, FontFamily::Proportional));
	styles.insert(TextStyle::Button, FontId::new(13.0, FontFamily::Proportional));
	styles.insert(TextStyle::Small, FontId::new(11.0, FontFamily::Proportional));
	styles.insert(TextStyle::Heading, FontId::new(15.0, FontFamily::Proportional));
	styles.insert(TextStyle::Monospace, FontId::new(MONO_SIZE, FontFamily::Monospace));
	styles
}

/// The spec's dark palette as egui `Visuals`. `Light` and `System` keep the
/// same accent and radii on egui's light base, because the spec only defines
/// the dark tokens; `System` follows egui's own dark/light preference.
fn visuals(theme: Theme) -> egui::Visuals {
	let dark = match theme {
		Theme::Dark => true,
		Theme::Light => false,
		Theme::System => true,
	};
	let mut visuals = if dark {
		egui::Visuals::dark()
	} else {
		egui::Visuals::light()
	};
	let (panel, text, text_weak, border, hover, active) = if dark {
		(PANEL, TEXT, TEXT_2, BORDER, PANEL_3, PANEL_4)
	} else {
		(
			Color32::from_rgb(0xf6, 0xf7, 0xf9),
			Color32::from_rgb(0x1a, 0x1d, 0x23),
			Color32::from_rgb(0x4a, 0x51, 0x5c),
			Color32::from_rgb(0xd7, 0xdb, 0xe1),
			Color32::from_rgb(0xec, 0xee, 0xf2),
			Color32::from_rgb(0xdf, 0xe3, 0xe9),
		)
	};
	visuals.dark_mode = dark;
	visuals.panel_fill = panel;
	visuals.window_fill = panel;
	visuals.window_stroke = Stroke::new(1.0_f32, border);
	visuals.window_corner_radius = CornerRadius::same(R_MODAL);
	visuals.menu_corner_radius = CornerRadius::same(R_PANEL);
	visuals.extreme_bg_color = if dark { GROUND } else { Color32::WHITE };
	visuals.faint_bg_color = if dark {
		PANEL_2
	} else {
		Color32::from_rgb(0xef, 0xf1, 0xf4)
	};
	visuals.code_bg_color = if dark {
		PANEL_2
	} else {
		Color32::from_rgb(0xef, 0xf1, 0xf4)
	};
	visuals.text_edit_bg_color = Some(if dark { PANEL_2 } else { Color32::WHITE });
	visuals.override_text_color = Some(text);
	visuals.weak_text_color = Some(text_weak);
	visuals.selection.bg_fill = ACCENT_DIM;
	visuals.selection.stroke = Stroke::new(1.0_f32, ACCENT_2);
	visuals.hyperlink_color = ACCENT_2;
	visuals.warn_fg_color = WARN;
	visuals.error_fg_color = DEL;
	visuals.button_frame = true;

	let line = Stroke::new(1.0_f32, border);
	visuals.widgets.noninteractive.bg_fill = panel;
	visuals.widgets.noninteractive.weak_bg_fill = panel;
	visuals.widgets.noninteractive.bg_stroke = line;
	visuals.widgets.noninteractive.fg_stroke = Stroke::new(1.0_f32, text_weak);
	visuals.widgets.noninteractive.corner_radius = CornerRadius::same(R_CONTROL);

	visuals.widgets.inactive.bg_fill = if dark { PANEL_2 } else { Color32::WHITE };
	visuals.widgets.inactive.weak_bg_fill = PANEL_2;
	visuals.widgets.inactive.bg_stroke = Stroke::new(1.0_f32, if dark { BORDER_2 } else { border });
	visuals.widgets.inactive.fg_stroke = Stroke::new(1.0_f32, text);
	visuals.widgets.inactive.corner_radius = CornerRadius::same(R_CONTROL);

	visuals.widgets.hovered.bg_fill = hover;
	visuals.widgets.hovered.weak_bg_fill = hover;
	visuals.widgets.hovered.bg_stroke = Stroke::new(1.0_f32, BORDER_2);
	visuals.widgets.hovered.fg_stroke = Stroke::new(1.0_f32, text);
	visuals.widgets.hovered.corner_radius = CornerRadius::same(R_CONTROL);

	visuals.widgets.active.bg_fill = active;
	visuals.widgets.active.weak_bg_fill = active;
	visuals.widgets.active.bg_stroke = Stroke::new(1.0_f32, BORDER_2);
	visuals.widgets.active.fg_stroke = Stroke::new(1.0_f32, text);
	visuals.widgets.active.corner_radius = CornerRadius::same(R_CONTROL);

	visuals.widgets.open.bg_fill = active;
	visuals.widgets.open.weak_bg_fill = active;
	visuals.widgets.open.bg_stroke = Stroke::new(1.0_f32, BORDER_2);
	visuals.widgets.open.fg_stroke = Stroke::new(1.0_f32, text);
	visuals.widgets.open.corner_radius = CornerRadius::same(R_CONTROL);
	visuals
}
