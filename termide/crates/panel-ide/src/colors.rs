//! The theme palette as a list: pick a colour, copy its hex.
//!
//! The panel exists so a colour in a stylesheet can be taken from the theme
//! instead of guessed. Colours are drawn as a real swatch, and Enter copies the
//! textual value — hex for RGB entries, the ANSI name otherwise.

use std::any::Any;

use crossterm::event::{KeyCode, MouseEvent, MouseEventKind};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use termide_core::event::PanelEvent;
use termide_core::key_chord::KeyChord;
use termide_core::panel::{Panel, RenderContext, ThemeColors};

/// One palette row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Swatch {
    pub name: &'static str,
    pub color: Color,
}

/// The palette, in the theme's declaration order.
pub fn palette(theme: &ThemeColors) -> Vec<Swatch> {
    vec![
        Swatch {
            name: "fg",
            color: theme.fg,
        },
        Swatch {
            name: "bg",
            color: theme.bg,
        },
        Swatch {
            name: "selection_bg",
            color: theme.selection_bg,
        },
        Swatch {
            name: "selection_fg",
            color: theme.selection_fg,
        },
        Swatch {
            name: "border",
            color: theme.border,
        },
        Swatch {
            name: "border_focused",
            color: theme.border_focused,
        },
        Swatch {
            name: "line_numbers",
            color: theme.line_numbers,
        },
        Swatch {
            name: "cursor",
            color: theme.cursor,
        },
        Swatch {
            name: "status_bar_bg",
            color: theme.status_bar_bg,
        },
        Swatch {
            name: "status_bar_fg",
            color: theme.status_bar_fg,
        },
        Swatch {
            name: "disabled",
            color: theme.disabled,
        },
        Swatch {
            name: "success",
            color: theme.success,
        },
        Swatch {
            name: "warning",
            color: theme.warning,
        },
        Swatch {
            name: "error",
            color: theme.error,
        },
        Swatch {
            name: "info",
            color: theme.info,
        },
    ]
}

/// What Enter copies for a colour: `#rrggbb` for RGB, the ANSI name otherwise.
pub fn text_for(color: Color) -> String {
    match color {
        Color::Rgb(red, green, blue) => format!("#{red:02x}{green:02x}{blue:02x}"),
        Color::Reset => "reset".to_owned(),
        Color::Black => "black".to_owned(),
        Color::Red => "red".to_owned(),
        Color::Green => "green".to_owned(),
        Color::Yellow => "yellow".to_owned(),
        Color::Blue => "blue".to_owned(),
        Color::Magenta => "magenta".to_owned(),
        Color::Cyan => "cyan".to_owned(),
        Color::Gray => "gray".to_owned(),
        Color::DarkGray => "darkgray".to_owned(),
        Color::LightRed => "lightred".to_owned(),
        Color::LightGreen => "lightgreen".to_owned(),
        Color::LightYellow => "lightyellow".to_owned(),
        Color::LightBlue => "lightblue".to_owned(),
        Color::LightMagenta => "lightmagenta".to_owned(),
        Color::LightCyan => "lightcyan".to_owned(),
        Color::White => "white".to_owned(),
        Color::Indexed(index) => format!("ansi{index}"),
    }
}

/// The palette as a panel.
#[derive(Default)]
pub struct ColorPickerPanel {
    swatches: Vec<Swatch>,
    selected: usize,
    /// The last copy result, shown under the list.
    message: Option<String>,
}

impl ColorPickerPanel {
    pub fn new(theme: &ThemeColors) -> Self {
        Self {
            swatches: palette(theme),
            selected: 0,
            message: None,
        }
    }

    pub fn swatches(&self) -> &[Swatch] {
        &self.swatches
    }

    fn move_by(&mut self, step: isize) {
        if self.swatches.is_empty() {
            return;
        }
        let last = self.swatches.len() - 1;
        self.selected = (self.selected as isize + step).clamp(0, last as isize) as usize;
    }

    fn copy_selected(&mut self) {
        let Some(swatch) = self.swatches.get(self.selected) else {
            return;
        };
        let text = text_for(swatch.color);
        self.message = Some(match termide_clipboard::copy(&text) {
            Ok(()) => format!("copied {text}"),
            Err(error) => format!("copy failed: {error}"),
        });
    }
}

impl Panel for ColorPickerPanel {
    fn name(&self) -> &'static str {
        "colors"
    }

    fn title(&self) -> String {
        "Colors".to_owned()
    }

    fn render(&mut self, area: Rect, buf: &mut Buffer, ctx: &RenderContext) {
        buf.set_style(area, Style::default().bg(ctx.theme.bg).fg(ctx.theme.fg));
        if area.height == 0 {
            return;
        }
        let rows = area.height as usize - usize::from(self.message.is_some());
        for row in 0..rows {
            let Some(swatch) = self.swatches.get(row) else {
                break;
            };
            let selected = row == self.selected;
            let background = if selected {
                ctx.theme.selection_bg
            } else {
                ctx.theme.bg
            };
            // The swatch itself: two cells painted with the colour.
            let swatch_style = Style::default().bg(swatch.color).fg(swatch.color);
            buf.set_stringn(area.x, area.y + row as u16, "  ", 2, swatch_style);
            let label = format!("  {:<16}{}", swatch.name, text_for(swatch.color));
            let style = Style::default()
                .bg(background)
                .fg(if selected {
                    ctx.theme.selection_fg
                } else {
                    ctx.theme.fg
                })
                .add_modifier(if selected {
                    Modifier::BOLD
                } else {
                    Modifier::empty()
                });
            buf.set_stringn(
                area.x + 2,
                area.y + row as u16,
                &label,
                area.width.saturating_sub(2) as usize,
                style,
            );
        }
        if let Some(message) = self.message.as_deref() {
            let row = area.y + area.height - 1;
            buf.set_stringn(
                area.x,
                row,
                message,
                area.width as usize,
                Style::default().fg(ctx.theme.fg),
            );
        }
    }

    fn handle_key(&mut self, chord: KeyChord) -> Vec<PanelEvent> {
        match chord.raw.code {
            KeyCode::Up | KeyCode::Char('k') => {
                self.move_by(-1);
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::Down | KeyCode::Char('j') => {
                self.move_by(1);
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::Enter => {
                self.copy_selected();
                vec![PanelEvent::NeedsRedraw]
            }
            _ => Vec::new(),
        }
    }

    fn handle_mouse(&mut self, event: MouseEvent, panel_area: Rect) -> Vec<PanelEvent> {
        if matches!(event.kind, MouseEventKind::Down(_))
            && panel_area.contains((event.column, event.row).into())
        {
            let index = (event.row - panel_area.y) as usize;
            if index < self.swatches.len() {
                self.selected = index;
                return vec![PanelEvent::NeedsRedraw];
            }
        }
        Vec::new()
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_palette_covers_every_theme_field_in_order() {
        let theme = ThemeColors::default();
        let swatches = palette(&theme);
        assert_eq!(swatches.len(), 15);
        assert_eq!(swatches[0].name, "fg");
        assert_eq!(swatches[0].color, theme.fg);
        assert_eq!(swatches[14].name, "info");
    }

    #[test]
    fn rgb_colours_copy_as_hex_and_names_copy_as_words() {
        assert_eq!(text_for(Color::Rgb(0x12, 0x34, 0x56)), "#123456");
        assert_eq!(text_for(Color::DarkGray), "darkgray");
        assert_eq!(text_for(Color::Indexed(7)), "ansi7");
    }

    #[test]
    fn the_selection_moves_within_the_palette() {
        let mut panel = ColorPickerPanel::new(&ThemeColors::default());
        panel.move_by(-1);
        assert_eq!(panel.selected, 0, "cannot go above the first row");
        panel.move_by(100);
        assert_eq!(
            panel.selected,
            panel.swatches().len() - 1,
            "clamps at the last row"
        );
    }
}
