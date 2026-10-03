//! OSC 8 hyperlink support: resolving emitter-provided URIs to local
//! targets and finding the screen region a hyperlink covers.
//!
//! Cells carry the link id stamped while the hyperlink was open (see
//! [`crate::terminal::Cell::link`]); the id indexes the URI intern table on
//! [`TerminalScreen`]. This module turns a clicked cell back into the
//! hyperlink's URI, the highlighted region, and — for `file://` and
//! `zeta-open://` URIs — a local `path` plus optional `line`/`col`.

use std::path::PathBuf;

use crate::link_detection::HighlightSegment;
use crate::terminal::TerminalScreen;

/// Safety cap on how far a hyperlink region may expand across rows.
const MAX_REGION_ROWS: usize = 200;

/// A hyperlink URI resolved to a local open target.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HyperlinkTarget {
    pub path: PathBuf,
    pub line: Option<u32>,
    pub col: Option<u32>,
}

/// Percent-decode a URI component (`%XX` byte triples).
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 3 <= bytes.len() {
            // Slice bytes (never mid-char), then validate as ASCII hex.
            if let Some(b) = std::str::from_utf8(&bytes[i + 1..i + 3])
                .ok()
                .and_then(|hex| u8::from_str_radix(hex, 16).ok())
            {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `file://` and `zeta-open://` hierarchies put a drive-letter path behind an
/// extra slash (`file:///C:/x` → `/C:/x`); drop it so the result spells a
/// Windows path again.
fn strip_drive_slash(path: &str) -> &str {
    let bytes = path.as_bytes();
    if bytes.len() >= 3 && bytes[0] == b'/' && bytes[1].is_ascii_alphabetic() && bytes[2] == b':' {
        &path[1..]
    } else {
        path
    }
}

/// Parse a hyperlink URI into a local target. Recognizes `file://` and the
/// workbench's `zeta-open://` scheme (same hierarchy, plus optional
/// `?line=L&col=C` query). Other schemes (remote hosts, `https://`) are not
/// locally openable and yield `None`.
pub fn parse_hyperlink_uri(uri: &str) -> Option<HyperlinkTarget> {
    let (scheme, rest) = uri.split_once("://")?;
    if scheme != "file" && scheme != "zeta-open" {
        return None;
    }

    let (hierarchy, query) = match rest.split_once('?') {
        Some((hierarchy, query)) => (hierarchy, Some(query)),
        None => (rest, None),
    };

    let path_part = match hierarchy.split_once('/') {
        // Empty authority: `file:///abs/path` — everything after the slash
        // triplet is the path, leading slash included.
        Some(("", path)) => format!("/{path}"),
        // Hand-rolled Windows forms: `zeta-open://C:/x` or `zeta-open://C:\x`
        // — the drive letter landed in the authority slot.
        Some((authority, path)) if is_drive_authority(authority) => {
            format!("{authority}/{path}")
        }
        // `file://localhost/abs/path` — localhost means this machine.
        Some((authority, path)) if authority.eq_ignore_ascii_case("localhost") => {
            format!("/{path}")
        }
        // A remote host's files are not openable here.
        Some((_remote, _)) => return None,
        // No slash after the authority: `file://C:\x`.
        None => hierarchy.to_string(),
    };

    let decoded = percent_decode(strip_drive_slash(&path_part));
    if decoded.is_empty() {
        return None;
    }

    let mut line = None;
    let mut col = None;
    if let Some(query) = query {
        for pair in query.split('&') {
            match pair.split_once('=') {
                Some(("line", value)) => line = value.parse().ok(),
                Some(("col", value)) => col = value.parse().ok(),
                _ => {}
            }
        }
    }

    Some(HyperlinkTarget {
        path: PathBuf::from(decoded),
        line,
        col,
    })
}

fn is_drive_authority(authority: &str) -> bool {
    let bytes = authority.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// Split a trailing `:line:col` (both numeric) off display text — the
/// position an emitter wrote into the link's visible text when the URI
/// itself carries none. A single trailing number is deliberately not
/// accepted: `C:\repo\2024` must not read as line 2024.
pub fn split_display_line_col(text: &str) -> Option<(&str, u32, Option<u32>)> {
    let text = text.trim_end_matches(':');
    let (head, col_text) = text.rsplit_once(':')?;
    let col = col_text.parse::<u32>().ok()?;
    let (path, line_text) = head.rsplit_once(':')?;
    let line = line_text.parse::<u32>().ok()?;
    if path.is_empty() {
        return None;
    }
    Some((path, line, Some(col)))
}

/// Resolve a hyperlink to its open target: the URI is authoritative for the
/// path; when the URI carries no position, a trailing `:line:col` in the
/// link's visible text fills `line`/`col` in.
pub fn resolve_hyperlink_target(uri: &str, region_text: &str) -> Option<HyperlinkTarget> {
    let mut target = parse_hyperlink_uri(uri)?;
    if target.line.is_none() {
        if let Some((_, line, col)) = split_display_line_col(region_text) {
            target.line = Some(line);
            target.col = col;
        }
    }
    Some(target)
}

/// The hyperlink region under a cell: the link id plus one highlight segment
/// (abs_row, start_col, end_col) per contiguous run of cells carrying that
/// id. Rows connect when the row above ends its text inside the link and the
/// row below starts its text inside it — true for both soft-wrapped and
/// hard-newline-spanning links.
pub(crate) fn osc8_region_at(
    screen: &TerminalScreen,
    abs_row: usize,
    col: usize,
) -> Option<(u32, Vec<HighlightSegment>)> {
    let id = screen.get_line_by_absolute(abs_row)?.get(col)?.link?;

    let mut top = abs_row;
    while top > 0 && abs_row - top < MAX_REGION_ROWS && rows_connected(screen, top - 1, top, id) {
        top -= 1;
    }
    let mut bottom = abs_row;
    while bottom - abs_row < MAX_REGION_ROWS && rows_connected(screen, bottom, bottom + 1, id) {
        bottom += 1;
    }

    let mut segments = Vec::new();
    for row in top..=bottom {
        let Some(line) = screen.get_line_by_absolute(row) else {
            continue;
        };
        let mut start: Option<usize> = None;
        for (idx, cell) in line.iter().enumerate() {
            if cell.link == Some(id) {
                start.get_or_insert(idx);
            } else if let Some(run_start) = start.take() {
                segments.push((row, run_start, idx));
            }
        }
        if let Some(run_start) = start {
            segments.push((row, run_start, line.len()));
        }
    }
    Some((id, segments))
}

/// Whether `upper`'s linked text reaches its row end while `lower`'s linked
/// text starts at its row top — the row-boundary condition for one region.
fn rows_connected(screen: &TerminalScreen, upper: usize, lower: usize, id: u32) -> bool {
    let (Some(upper_line), Some(lower_line)) = (
        screen.get_line_by_absolute(upper),
        screen.get_line_by_absolute(lower),
    ) else {
        return false;
    };
    let upper_ends_linked = upper_line
        .iter()
        .rposition(|cell| cell.link == Some(id) && cell.ch != ' ')
        .is_some();
    let lower_starts_linked = lower_line
        .iter()
        .position(|cell| cell.link == Some(id) && cell.ch != ' ')
        .is_some();
    upper_ends_linked && lower_starts_linked
}

/// The visible text a hyperlink region covers, in row order.
pub(crate) fn region_text(screen: &TerminalScreen, segments: &[HighlightSegment]) -> String {
    let mut text = String::new();
    for &(row, start, end) in segments {
        let Some(line) = screen.get_line_by_absolute(row) else {
            continue;
        };
        for cell in line.iter().take(end.min(line.len())).skip(start) {
            cell.push_text(&mut text);
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::{Cell, CellStyle};

    fn linked_row(text: &str, link: Option<u32>) -> Vec<Cell> {
        text.chars()
            .map(|ch| Cell {
                ch,
                style: CellStyle::default(),
                extra: None,
                link,
            })
            .collect()
    }

    #[test]
    fn percent_decode_unescapes_reserved_and_utf8_bytes() {
        assert_eq!(percent_decode("a%20b%23c"), "a b#c");
        assert_eq!(percent_decode("%C3%A4.rs"), "ä.rs");
        // A lone percent stays literal.
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn parses_file_uri_with_drive_letter_and_spaces() {
        let target = parse_hyperlink_uri("file:///C:/Users/x%20y/a%23b.rs").unwrap();
        assert_eq!(target.path.to_string_lossy(), "C:/Users/x y/a#b.rs");
        assert_eq!(target.line, None);
        assert_eq!(target.col, None);
    }

    #[test]
    fn parses_unix_file_uri_and_localhost_authority() {
        let target = parse_hyperlink_uri("file:///home/u/a.rs").unwrap();
        assert_eq!(target.path.to_string_lossy(), "/home/u/a.rs");

        let target = parse_hyperlink_uri("file://localhost/home/u/a.rs").unwrap();
        assert_eq!(target.path.to_string_lossy(), "/home/u/a.rs");
    }

    #[test]
    fn parses_zeta_open_query_position() {
        let target = parse_hyperlink_uri("zeta-open:///C:/repo/src/app.rs?line=42&col=7").unwrap();
        assert_eq!(target.path.to_string_lossy(), "C:/repo/src/app.rs");
        assert_eq!(target.line, Some(42));
        assert_eq!(target.col, Some(7));

        let target = parse_hyperlink_uri("zeta-open:///home/u/a.rs?line=3").unwrap();
        assert_eq!(target.line, Some(3));
        assert_eq!(target.col, None);
    }

    #[test]
    fn rejects_remote_and_unknown_schemes() {
        assert!(parse_hyperlink_uri("file://other-host/share/a.rs").is_none());
        assert!(parse_hyperlink_uri("https://example.com/a.rs").is_none());
        assert!(parse_hyperlink_uri("plain/path").is_none());
    }

    #[test]
    fn splits_both_numeric_line_col_only() {
        assert_eq!(
            split_display_line_col(r"C:\repo\a.rs:42:7"),
            Some((r"C:\repo\a.rs", 42, Some(7)))
        );
        // A single trailing number is ambiguous with directory names.
        assert_eq!(split_display_line_col(r"C:\repo\2024"), None);
        assert_eq!(split_display_line_col("https://x.io/a"), None);
    }

    #[test]
    fn resolution_prefers_uri_position_and_falls_back_to_display_text() {
        let target =
            resolve_hyperlink_target("zeta-open:///repo/a.rs?line=9&col=1", "a.rs:42:7").unwrap();
        assert_eq!(target.line, Some(9));

        let target = resolve_hyperlink_target("file:///repo/a.rs", "a.rs:42:7").unwrap();
        assert_eq!(target.path.to_string_lossy(), "/repo/a.rs");
        assert_eq!(target.line, Some(42));
        assert_eq!(target.col, Some(7));

        let target = resolve_hyperlink_target("file:///repo/a.rs", "a.rs").unwrap();
        assert_eq!(target.line, None);
    }

    #[test]
    fn region_covers_soft_wrapped_rows() {
        let mut screen = TerminalScreen::new(4, 10);
        *screen.lines.get_mut(0).unwrap() = linked_row("0123456789", Some(0));
        *screen.lines.get_mut(1).unwrap() = linked_row("abc", Some(0));
        *screen.lines.get_mut(2).unwrap() = linked_row("plain text", None);

        let (id, segments) = osc8_region_at(&screen, 1, 1).unwrap();
        assert_eq!(id, 0);
        assert_eq!(segments, vec![(0, 0, 10), (1, 0, 3)]);
    }

    #[test]
    fn region_covers_hard_newline_spanning_link() {
        let mut screen = TerminalScreen::new(4, 20);
        *screen.lines.get_mut(0).unwrap() = linked_row("first half link", Some(3));
        *screen.lines.get_mut(1).unwrap() = linked_row("second half", Some(3));
        *screen.lines.get_mut(2).unwrap() = linked_row("unrelated", None);

        let (id, segments) = osc8_region_at(&screen, 0, 4).unwrap();
        assert_eq!(id, 3);
        assert_eq!(segments, vec![(0, 0, 15), (1, 0, 11)]);
    }

    #[test]
    fn region_stops_at_unlinked_gap() {
        let mut screen = TerminalScreen::new(4, 20);
        *screen.lines.get_mut(0).unwrap() = linked_row("link one", Some(1));
        *screen.lines.get_mut(1).unwrap() = linked_row("plain", None);
        *screen.lines.get_mut(2).unwrap() = linked_row("link two", Some(1));

        // The id reappears two rows down but a plain row separates the regions.
        let (_, segments) = osc8_region_at(&screen, 0, 0).unwrap();
        assert_eq!(segments, vec![(0, 0, 8)]);
        let (_, segments) = osc8_region_at(&screen, 2, 0).unwrap();
        assert_eq!(segments, vec![(2, 0, 8)]);
    }

    #[test]
    fn region_text_joins_segments_in_order() {
        let mut screen = TerminalScreen::new(4, 20);
        *screen.lines.get_mut(0).unwrap() = linked_row("first:42:", Some(0));
        // ':7' lives on the wrapped second row.
        *screen.lines.get_mut(1).unwrap() = linked_row("7 tail", Some(0));

        let (_, segments) = osc8_region_at(&screen, 0, 0).unwrap();
        assert_eq!(region_text(&screen, &segments), "first:42:7 tail");
    }
}
