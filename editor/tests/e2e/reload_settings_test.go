package e2e

import (
	"testing"

	"github.com/eugenioenko/ttt/internal/config"
)

func TestReloadSettingsCommand(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	// Verify defaults: line numbers on, tab size 4, gutter style compact
	if !h.app.EditorGroup.LineNumbers {
		t.Fatal("expected line numbers enabled by default")
	}
	if h.app.EditorGroup.Editor.LineNumbers != true {
		t.Fatal("expected editor pane line numbers enabled by default")
	}
	if h.app.EditorGroup.TabSize != 4 {
		t.Fatal("expected tab size 4 by default")
	}
	if h.app.EditorGroup.GutterStyle != "compact" {
		t.Fatalf("expected gutter style 'compact' by default, got %q", h.app.EditorGroup.GutterStyle)
	}

	// Create modified settings and apply them via ApplySettings
	s := config.DefaultSettings()
	s.Editor.LineNumbers = false
	s.Editor.TabSize = 2
	s.Editor.GutterStyle = "minimal"
	s.Editor.InsertFinalNewline = false
	s.Editor.TrimTrailingWhitespace = true
	s.Search.Debounce = 500

	h.app.ApplySettings(s)
	h.redraw()

	// Verify editor group settings updated
	if h.app.EditorGroup.LineNumbers {
		t.Error("expected line numbers disabled after apply")
	}
	if h.app.EditorGroup.Editor.LineNumbers {
		t.Error("expected editor pane line numbers disabled after apply")
	}
	if h.app.EditorGroup.TabSize != 2 {
		t.Errorf("expected tab size 2 after apply, got %d", h.app.EditorGroup.TabSize)
	}
	if h.app.EditorGroup.Editor.TabSize != 2 {
		t.Errorf("expected editor pane tab size 2 after apply, got %d", h.app.EditorGroup.Editor.TabSize)
	}
	if h.app.EditorGroup.GutterStyle != "minimal" {
		t.Errorf("expected gutter style 'minimal' after apply, got %q", h.app.EditorGroup.GutterStyle)
	}
	if h.app.EditorGroup.Editor.GutterStyle != "minimal" {
		t.Errorf("expected editor pane gutter style 'minimal' after apply, got %q", h.app.EditorGroup.Editor.GutterStyle)
	}
	if h.app.EditorGroup.InsertFinalNewline {
		t.Error("expected InsertFinalNewline false after apply")
	}
	if !h.app.EditorGroup.TrimTrailingWhitespace {
		t.Error("expected TrimTrailingWhitespace true after apply")
	}
	if h.app.Search.Debounce.DelayMs != 500 {
		t.Errorf("expected search debounce 500 after apply, got %d", h.app.Search.Debounce.DelayMs)
	}

	// Verify the settings pointer was updated
	if h.app.Settings.Editor.LineNumbers {
		t.Error("expected Settings.Editor.LineNumbers false after apply")
	}
	if h.app.Settings.Editor.TabSize != 2 {
		t.Errorf("expected Settings.Editor.TabSize 2 after apply, got %d", h.app.Settings.Editor.TabSize)
	}
}

func TestReloadSettingsCommandRegistered(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	// Verify command is registered
	cmd, ok := h.reg.Get("settings.reload")
	if !ok {
		t.Fatal("expected settings.reload command to be registered")
	}
	if cmd.Title != "Reload Settings" {
		t.Errorf("expected title 'Reload Settings', got %q", cmd.Title)
	}
}

func TestApplySettingsRestoresDefaults(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	// Modify settings to non-default values
	modified := config.DefaultSettings()
	modified.Editor.LineNumbers = false
	modified.Editor.TabSize = 8
	modified.Editor.GutterStyle = "extended"
	h.app.ApplySettings(modified)

	if h.app.EditorGroup.LineNumbers {
		t.Error("expected line numbers disabled after first apply")
	}

	// Apply defaults back and verify restoration
	defaults := config.DefaultSettings()
	h.app.ApplySettings(defaults)

	if !h.app.EditorGroup.LineNumbers {
		t.Error("expected line numbers re-enabled after applying defaults")
	}
	if h.app.EditorGroup.TabSize != 4 {
		t.Errorf("expected tab size 4 after applying defaults, got %d", h.app.EditorGroup.TabSize)
	}
	if h.app.EditorGroup.GutterStyle != "compact" {
		t.Errorf("expected gutter style 'compact' after applying defaults, got %q", h.app.EditorGroup.GutterStyle)
	}
}
