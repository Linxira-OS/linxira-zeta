//! Replies to the standard queries a hosted TUI asks before it rasterizes.
//!
//! Both backends that paint this terminal's output answer from here: the
//! in-process emulator (`terminal::vt100_parser`) and the GUI's serve backend
//! (`zetawork-gui/src/terminal_service.rs`), which parses a remote PTY's bytes
//! itself. Keeping the bytes in one place is what makes a pane answer
//! identically whichever backend owns the PTY — a second, hand-written copy is
//! exactly how the two drift apart.

/// Primary device attributes (DA1): VT100 with advanced video.
pub const PRIMARY_DA: &[u8] = b"\x1b[?1;2c";

/// XTVERSION: the DCS form every emulator uses, naming the terminal a client
/// is really talking to (the workbench, not whatever launched it).
pub fn xtversion() -> String {
    format!("\x1bP>|zetawork({})\x1b\\", env!("CARGO_PKG_VERSION"))
}

/// Answer `CSI <param> t` (window manipulation) when this terminal has an
/// answer, using the renderer's **device-pixel** cell size.
///
/// `14 t` reports the window's pixels, `16 t` the cell itself, `18 t` the text
/// area in character cells. Pixel reports stay unanswered while no renderer
/// has measured a cell (`(0, 0)`): silence is honest, and the client keeps its
/// own fallback instead of being told a lie.
pub fn window_report(param: u16, rows: usize, cols: usize, cell_px: (u16, u16)) -> Option<String> {
    let (cell_w, cell_h) = cell_px;
    let known = cell_w > 0 && cell_h > 0;
    match param {
        14 if known => Some(format!(
            "\x1b[4;{};{}t",
            rows as u32 * u32::from(cell_h),
            cols as u32 * u32::from(cell_w)
        )),
        16 if known => Some(format!("\x1b[6;{};{}t", cell_h, cell_w)),
        18 => Some(format!("\x1b[8;{};{}t", rows, cols)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cell_geometry_reports_use_the_renderers_cell() {
        assert_eq!(
            window_report(16, 24, 80, (12, 24)).as_deref(),
            Some("\x1b[6;24;12t")
        );
        assert_eq!(
            window_report(14, 24, 80, (12, 24)).as_deref(),
            Some("\x1b[4;576;960t")
        );
        assert_eq!(
            window_report(18, 24, 80, (12, 24)).as_deref(),
            Some("\x1b[8;24;80t")
        );
    }

    #[test]
    fn pixel_reports_stay_silent_until_a_cell_is_known() {
        assert_eq!(window_report(16, 24, 80, (0, 0)), None);
        assert_eq!(window_report(14, 24, 80, (0, 0)), None);
        assert_eq!(
            window_report(18, 24, 80, (0, 0)).as_deref(),
            Some("\x1b[8;24;80t"),
            "the character grid is known even when pixels are not"
        );
        assert_eq!(window_report(21, 24, 80, (12, 24)), None);
    }

    #[test]
    fn the_identity_names_the_workbench_with_this_crates_version() {
        assert_eq!(
            xtversion(),
            format!("\x1bP>|zetawork({})\x1b\\", env!("CARGO_PKG_VERSION"))
        );
        assert_eq!(PRIMARY_DA, b"\x1b[?1;2c");
    }
}
