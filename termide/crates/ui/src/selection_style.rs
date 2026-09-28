//! Selection styling utilities.
//!
//! Provides consistent styling for selected/unselected items across panels.

use ratatui::style::{Color, Modifier, Style};

/// Selection state for an item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SelectionState {
    /// Whether the item is selected (cursor is on it).
    pub selected: bool,
    /// Whether the panel is focused.
    pub focused: bool,
}

impl SelectionState {
    /// Create a new selection state.
    pub fn new(selected: bool, focused: bool) -> Self {
        Self { selected, focused }
    }

    /// Item is selected and panel is focused.
    pub fn is_active(&self) -> bool {
        self.selected && self.focused
    }
}

/// Theme colors for selection styling.
#[derive(Debug, Clone, Copy)]
pub struct SelectionColors {
    /// Foreground color for normal items.
    pub fg: Color,
    /// Background color for panel.
    pub bg: Color,
    /// Foreground color when selected and focused.
    pub selection_fg: Color,
    /// Background color when selected and focused.
    pub selection_bg: Color,
    /// Color for selected but unfocused items.
    pub selected_unfocused: Color,
}

impl Default for SelectionColors {
    fn default() -> Self {
        Self {
            fg: Color::White,
            bg: Color::Black,
            selection_fg: Color::Black,
            selection_bg: Color::White,
            selected_unfocused: Color::Yellow,
        }
    }
}

/// Compute style for an item based on selection state.
///
/// Pattern used across panels:
/// - Selected + focused: inverted colors (fg=bg, bg=custom) + BOLD
/// - Selected + unfocused: custom foreground
/// - Not selected: normal foreground
pub fn item_style(state: SelectionState, colors: &SelectionColors) -> Style {
    if state.selected && state.focused {
        Style::default()
            .fg(colors.selection_fg)
            .bg(colors.selection_bg)
            .add_modifier(Modifier::BOLD)
    } else if state.selected {
        Style::default().fg(colors.selected_unfocused)
    } else {
        Style::default().fg(colors.fg)
    }
}

/// Compute style for an item with custom foreground color.
///
/// Like `item_style` but allows specifying a custom base foreground color
/// (e.g., for colored git status indicators).
pub fn item_style_colored(
    state: SelectionState,
    base_fg: Color,
    colors: &SelectionColors,
) -> Style {
    if state.selected && state.focused {
        Style::default()
            .fg(colors.bg)
            .bg(base_fg)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(base_fg)
    }
}

/// Style for inverted cursor (used in dropdown menus).
pub fn cursor_style(is_cursor: bool, colors: &SelectionColors) -> Style {
    if is_cursor {
        Style::default()
            .fg(colors.bg)
            .bg(colors.fg)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(colors.fg)
    }
}

/// Style for buttons (selected vs normal).
pub fn button_style(is_selected: bool, colors: &SelectionColors) -> Style {
    if is_selected {
        Style::default()
            .fg(colors.bg)
            .bg(colors.fg)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(colors.fg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_selection_state() {
        let state = SelectionState::new(true, true);
        assert!(state.is_active());

        let state = SelectionState::new(true, false);
        assert!(!state.is_active());

        let state = SelectionState::new(false, true);
        assert!(!state.is_active());
    }

    #[test]
    fn test_item_style_selected_focused() {
        let colors = SelectionColors::default();
        let state = SelectionState::new(true, true);
        let style = item_style(state, &colors);
        assert_eq!(style.fg, Some(colors.selection_fg));
        assert_eq!(style.bg, Some(colors.selection_bg));
    }

    #[test]
    fn test_item_style_selected_unfocused() {
        let colors = SelectionColors::default();
        let state = SelectionState::new(true, false);
        let style = item_style(state, &colors);
        assert_eq!(style.fg, Some(colors.selected_unfocused));
        assert_eq!(style.bg, None);
    }

    #[test]
    fn test_item_style_not_selected() {
        let colors = SelectionColors::default();
        let state = SelectionState::new(false, false);
        let style = item_style(state, &colors);
        assert_eq!(style.fg, Some(colors.fg));
        assert_eq!(style.bg, None);
    }
}
