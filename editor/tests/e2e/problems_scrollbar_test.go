package e2e

import (
	"fmt"
	"testing"

	"github.com/eugenioenko/ttt/internal/ui"
)

func TestProblemsScrollbar(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	// Show the bottom panel with "problems" active
	h.app.ContentSplit.ShowBottom = true
	h.app.ContentSplit.BottomH = 6
	h.app.BottomPanel.SetActivePanel("problems")

	// Create enough problems to exceed the visible area (panel content area
	// is BottomH minus 1 for the tab bar = 5 rows)
	var items []ui.ProblemItem
	for i := 0; i < 20; i++ {
		items = append(items, ui.ProblemItem{
			File:     fmt.Sprintf("file%d.go", i),
			Line:     i + 1,
			Col:      0,
			Severity: ui.DiagError,
			Message:  fmt.Sprintf("error %d", i),
		})
	}
	h.app.Problems.SetItems(items)
	h.redraw()

	// The scrollbar should render on the rightmost column of the problems area.
	// The scrollbar uses '█' characters.
	screen := h.screenText()
	if !containsRune(screen, '█') {
		t.Errorf("expected scrollbar character '█' on screen when items exceed visible height, got:\n%s", screen)
	}

	// Now test with fewer items that fit — scrollbar should NOT appear
	shortItems := []ui.ProblemItem{
		{File: "a.go", Line: 1, Col: 0, Severity: ui.DiagError, Message: "err"},
	}
	h.app.Problems.SetItems(shortItems)
	h.redraw()

	screen = h.screenText()
	if containsRune(screen, '█') {
		t.Errorf("expected no scrollbar when items fit in visible area, got:\n%s", screen)
	}
}

func containsRune(s string, r rune) bool {
	for _, c := range s {
		if c == r {
			return true
		}
	}
	return false
}
