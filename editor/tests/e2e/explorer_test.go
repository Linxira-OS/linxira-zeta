package e2e

import (
	"testing"

	"github.com/gdamore/tcell/v3"
)

func TestExplorerKeyNavigation(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	h.exec("sidebar.explorer")

	if h.app.Explorer.Tree.ItemCount() < 3 {
		t.Skipf("expected at least 3 explorer items, got %d", h.app.Explorer.Tree.ItemCount())
	}

	h.app.Explorer.Tree.SetSelectedIndex(0)

	h.pressKey(tcell.KeyDown, tcell.ModNone)
	if h.app.Explorer.Tree.SelectedIndex() != 1 {
		t.Errorf("expected Selected 1 after Down, got %d", h.app.Explorer.Tree.SelectedIndex())
	}

	h.pressKey(tcell.KeyDown, tcell.ModNone)
	if h.app.Explorer.Tree.SelectedIndex() != 2 {
		t.Errorf("expected Selected 2 after second Down, got %d", h.app.Explorer.Tree.SelectedIndex())
	}

	h.pressKey(tcell.KeyUp, tcell.ModNone)
	if h.app.Explorer.Tree.SelectedIndex() != 1 {
		t.Errorf("expected Selected 1 after Up, got %d", h.app.Explorer.Tree.SelectedIndex())
	}

	h.app.Explorer.Tree.SetSelectedIndex(0)
	h.pressKey(tcell.KeyUp, tcell.ModNone)
	if h.app.Explorer.Tree.SelectedIndex() != 0 {
		t.Errorf("expected Selected 0 (clamped at top), got %d", h.app.Explorer.Tree.SelectedIndex())
	}
}

func TestExplorerDirExpandCollapse(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	h.exec("sidebar.explorer")

	h.app.Explorer.Tree.SetSelectedIndex(0)
	root := h.app.Explorer.Tree.FlatList()[0]
	if !root.Expandable {
		t.Fatal("expected root to be a directory")
	}

	initialCount := h.app.Explorer.Tree.ItemCount()

	h.pressKey(tcell.KeyLeft, tcell.ModNone)
	if root.Expanded {
		t.Error("expected root to be collapsed after Left")
	}
	if h.app.Explorer.Tree.ItemCount() >= initialCount {
		t.Error("expected fewer items after collapsing root")
	}

	h.pressKey(tcell.KeyRight, tcell.ModNone)
	if !root.Expanded {
		t.Error("expected root to be expanded after Right")
	}
	if h.app.Explorer.Tree.ItemCount() != initialCount {
		t.Errorf("expected %d items after re-expanding, got %d", initialCount, h.app.Explorer.Tree.ItemCount())
	}
}

func TestExplorerEnterOpensFile(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	h.exec("sidebar.explorer")

	fileIdx := -1
	for i, node := range h.app.Explorer.Tree.FlatList() {
		if !node.Expandable {
			fileIdx = i
			break
		}
	}
	if fileIdx < 0 {
		t.Skip("no file found in explorer")
	}

	h.app.Explorer.Tree.SetSelectedIndex(fileIdx)
	expectedPath := h.app.Explorer.Tree.FlatList()[fileIdx].ID

	h.pressKey(tcell.KeyEnter, tcell.ModNone)

	if h.app.EditorGroup.ActiveFilePath() != expectedPath {
		t.Errorf("expected editor to open %q, got %q", expectedPath, h.app.EditorGroup.ActiveFilePath())
	}
}

func TestExplorerEnterToggleDir(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	h.exec("sidebar.explorer")

	h.app.Explorer.Tree.SetSelectedIndex(0)
	root := h.app.Explorer.Tree.FlatList()[0]
	if !root.Expandable || !root.Expanded {
		t.Fatal("expected root to be an expanded directory")
	}

	h.pressKey(tcell.KeyEnter, tcell.ModNone)
	if root.Expanded {
		t.Error("expected root to be collapsed after Enter")
	}

	h.pressKey(tcell.KeyEnter, tcell.ModNone)
	if !root.Expanded {
		t.Error("expected root to be expanded after second Enter")
	}
}

func TestExplorerClickOpensFile(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	h.exec("sidebar.explorer")
	h.redraw()

	fileIdx := -1
	for i, node := range h.app.Explorer.Tree.FlatList() {
		if !node.Expandable {
			fileIdx = i
			break
		}
	}
	if fileIdx < 0 {
		t.Skip("no file found in explorer")
	}

	r := h.app.Explorer.Adapter.GetRect()
	clickY := r.Y + (fileIdx - h.app.Explorer.Tree.ScrollTop())
	h.click(r.X+5, clickY)

	if h.app.Explorer.Tree.SelectedIndex() != fileIdx {
		t.Errorf("expected Selected %d after click, got %d", fileIdx, h.app.Explorer.Tree.SelectedIndex())
	}

	expectedPath := h.app.Explorer.Tree.FlatList()[fileIdx].ID
	if h.app.EditorGroup.ActiveFilePath() != expectedPath {
		t.Errorf("expected editor to open %q, got %q", expectedPath, h.app.EditorGroup.ActiveFilePath())
	}
}

func TestExplorerScrollFollowing(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	h.exec("sidebar.explorer")

	itemCount := h.app.Explorer.Tree.ItemCount()
	if itemCount < 5 {
		t.Skipf("need at least 5 items for scroll test, got %d", itemCount)
	}

	h.app.Explorer.Tree.SetSelectedIndex(itemCount - 1)
	r := h.app.Explorer.Adapter.GetRect()
	contentH := r.H

	h.redraw()

	if contentH > 0 && itemCount > contentH {
		if h.app.Explorer.Tree.ScrollTop() == 0 {
			t.Error("expected ScrollTop > 0 when selected item is past visible area")
		}
	}
}
