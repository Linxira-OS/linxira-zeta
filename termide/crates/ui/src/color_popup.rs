//! Hex color preview popup.
//!
//! Shows a small popup with a color swatch when the user Ctrl+clicks
//! on a hex color value in the editor or terminal.

use std::sync::LazyLock;

use ratatui::{
    buffer::Buffer,
    layout::Rect,
    style::{Color, Style},
};
use regex::Regex;

static HEX_COLOR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b").unwrap());

/// Find a hex color in `text` covering grapheme column `col`.
///
/// Returns `(r, g, b, original_match)` or `None`.
pub fn extract_hex_color_at_col(text: &str, col: usize) -> Option<(u8, u8, u8, String)> {
    use unicode_segmentation::UnicodeSegmentation;

    for m in HEX_COLOR_RE.find_iter(text) {
        // Convert byte offset to grapheme column
        let prefix = &text[..m.start()];
        let match_str = m.as_str();
        let start_col = prefix.graphemes(true).count();
        let end_col = start_col + match_str.graphemes(true).count();

        if col >= start_col && col < end_col {
            let hex_digits = match_str.trim_start_matches('#');
            let (r, g, b) = if hex_digits.len() == 3 {
                let r = u8::from_str_radix(&hex_digits[0..1].repeat(2), 16).ok()?;
                let g = u8::from_str_radix(&hex_digits[1..2].repeat(2), 16).ok()?;
                let b = u8::from_str_radix(&hex_digits[2..3].repeat(2), 16).ok()?;
                (r, g, b)
            } else {
                let r = u8::from_str_radix(&hex_digits[0..2], 16).ok()?;
                let g = u8::from_str_radix(&hex_digits[2..4], 16).ok()?;
                let b = u8::from_str_radix(&hex_digits[4..6], 16).ok()?;
                (r, g, b)
            };
            return Some((r, g, b, match_str.to_string()));
        }
    }
    None
}

/// State for an active hex color preview popup.
pub struct ColorPreview {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    /// Original matched text (e.g. `"#abc"` or `"#aabbcc"`)
    pub hex: String,
    /// Screen row of the click
    pub screen_row: u16,
    /// Screen column of the click
    pub screen_col: u16,
}

impl ColorPreview {
    /// Render the popup into `buf`, constrained to `panel_area`.
    ///
    /// Layout (3 rows):
    /// ```text
    /// ┌────────────┐
    /// │ ██ #aabbcc │
    /// └────────────┘
    /// ```
    pub fn render(&self, buf: &mut Buffer, panel_area: Rect) {
        let hex_len = self.hex.len() as u16;
        // width = │ + space + ██ + space + hex + space + │
        //        = 1 + 1 + 2 + 1 + hex_len + 1 + 1 = hex_len + 7
        let popup_width = hex_len + 7;
        let popup_height: u16 = 3;

        if panel_area.width < popup_width || panel_area.height < popup_height {
            return;
        }

        // Place 1 row above the click, or below if there's no room
        let raw_y = if self.screen_row >= panel_area.y + popup_height {
            self.screen_row - popup_height
        } else {
            self.screen_row + 1
        };
        // Clamp x so popup stays inside panel
        let popup_x = self
            .screen_col
            .saturating_sub(2)
            .min(panel_area.x + panel_area.width.saturating_sub(popup_width))
            .max(panel_area.x);
        // Clamp y
        let popup_y = raw_y
            .min(panel_area.y + panel_area.height.saturating_sub(popup_height))
            .max(panel_area.y);

        let bx = popup_x;
        let by = popup_y;

        let buf_area = buf.area;
        let in_buf = |x: u16, y: u16| -> bool {
            x >= buf_area.left()
                && x < buf_area.right()
                && y >= buf_area.top()
                && y < buf_area.bottom()
        };

        let border_style = Style::default().fg(Color::DarkGray).bg(Color::Black);
        let content_style = Style::default().fg(Color::White).bg(Color::Black);
        let color = Color::Rgb(self.r, self.g, self.b);
        let swatch_style = Style::default().fg(color).bg(color);

        // Top border row
        if in_buf(bx, by) {
            buf[(bx, by)].set_char('┌').set_style(border_style);
        }
        for col in 1..popup_width - 1 {
            if in_buf(bx + col, by) {
                buf[(bx + col, by)].set_char('─').set_style(border_style);
            }
        }
        if in_buf(bx + popup_width - 1, by) {
            buf[(bx + popup_width - 1, by)]
                .set_char('┐')
                .set_style(border_style);
        }

        // Content row
        let cy = by + 1;
        if in_buf(bx, cy) {
            buf[(bx, cy)].set_char('│').set_style(border_style);
        }
        if in_buf(bx + 1, cy) {
            buf[(bx + 1, cy)].set_char(' ').set_style(content_style);
        }
        for i in 0..2u16 {
            if in_buf(bx + 2 + i, cy) {
                buf[(bx + 2 + i, cy)].set_char('█').set_style(swatch_style);
            }
        }
        if in_buf(bx + 4, cy) {
            buf[(bx + 4, cy)].set_char(' ').set_style(content_style);
        }
        for (i, ch) in self.hex.chars().enumerate() {
            let x = bx + 5 + i as u16;
            if in_buf(x, cy) {
                buf[(x, cy)].set_char(ch).set_style(content_style);
            }
        }
        if in_buf(bx + 5 + hex_len, cy) {
            buf[(bx + 5 + hex_len, cy)]
                .set_char(' ')
                .set_style(content_style);
        }
        if in_buf(bx + popup_width - 1, cy) {
            buf[(bx + popup_width - 1, cy)]
                .set_char('│')
                .set_style(border_style);
        }

        // Bottom border row
        let by2 = by + 2;
        if in_buf(bx, by2) {
            buf[(bx, by2)].set_char('└').set_style(border_style);
        }
        for col in 1..popup_width - 1 {
            if in_buf(bx + col, by2) {
                buf[(bx + col, by2)].set_char('─').set_style(border_style);
            }
        }
        if in_buf(bx + popup_width - 1, by2) {
            buf[(bx + popup_width - 1, by2)]
                .set_char('┘')
                .set_style(border_style);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_6digit() {
        let (r, g, b, hex) = extract_hex_color_at_col("color: #aabbcc;", 7).unwrap();
        assert_eq!((r, g, b), (0xaa, 0xbb, 0xcc));
        assert_eq!(hex, "#aabbcc");
    }

    #[test]
    fn test_extract_3digit() {
        let (r, g, b, hex) = extract_hex_color_at_col("color: #abc;", 9).unwrap();
        assert_eq!((r, g, b), (0xaa, 0xbb, 0xcc));
        assert_eq!(hex, "#abc");
    }

    #[test]
    fn test_no_match_outside() {
        // col=0 is on 'c', not the hex color
        assert!(extract_hex_color_at_col("color: #abc;", 0).is_none());
    }

    #[test]
    fn test_match_at_boundary() {
        // col on '#' itself
        let result = extract_hex_color_at_col("#ff0000", 0);
        assert!(result.is_some());
        let (r, g, b, _) = result.unwrap();
        assert_eq!((r, g, b), (0xff, 0x00, 0x00));
    }

    #[test]
    fn test_no_match_plain_text() {
        assert!(extract_hex_color_at_col("hello world", 3).is_none());
    }
}
