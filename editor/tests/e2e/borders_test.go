package e2e

import (
	"testing"
)

func TestTerminalPanelBordersSet(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	if h.app.TerminalPanel.Borders == nil {
		t.Fatal("TerminalPanel.Borders should not be nil")
	}
	if h.app.TerminalPanel.Borders != h.app.Borders {
		t.Fatal("TerminalPanel.Borders should point to the same BorderSet as app.Borders")
	}
}

func TestWidgetBordersConsistency(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	a := h.app
	borders := a.Borders

	// Verify all structural widgets share the same Borders pointer
	checks := []struct {
		name string
		got  interface{}
	}{
		{"EditorGroup", a.EditorGroup.Borders},
		{"ContentSplit", a.ContentSplit.Borders},
		{"Sidebar", a.Sidebar.Borders},
		{"SplitPanel", a.SplitPanel.Borders},
		{"TerminalPanel", a.TerminalPanel.Borders},
	}

	for _, c := range checks {
		if c.got == nil {
			t.Errorf("%s.Borders is nil, expected app.Borders", c.name)
		} else if c.got != borders {
			t.Errorf("%s.Borders does not point to app.Borders", c.name)
		}
	}
}
