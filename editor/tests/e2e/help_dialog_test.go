package e2e

import (
	"testing"

	"github.com/gdamore/tcell/v3"
)

func TestExplorerHelpDialog(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	h.exec("explorer.help")

	h.assertContains("Explorer Shortcuts")
	h.assertContains("Open file or toggle folder")
	h.assertContains("Collapse folder")
	h.assertContains("Expand folder")

	// Dismiss with Escape
	h.pressKey(tcell.KeyEscape, tcell.ModNone)

	h.assertNotContains("Explorer Shortcuts")
}

func TestSearchHelpDialog(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	h.exec("search.help")

	h.assertContains("Search Shortcuts")
	h.assertContains("Toggle case sensitivity")
	h.assertContains("Toggle regex mode")
	h.assertContains("Next input field")

	// Dismiss with Enter
	h.pressKey(tcell.KeyEnter, tcell.ModNone)

	h.assertNotContains("Search Shortcuts")
}

func TestChangesHelpDialog(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	h.exec("changes.help")

	h.assertContains("Changes Shortcuts")
	h.assertContains("Toggle stage/unstage file")
	h.assertContains("Stage all files")
	h.assertContains("Discard selected file")
	h.assertContains("Open compact diff")

	// Dismiss with Escape
	h.pressKey(tcell.KeyEscape, tcell.ModNone)

	h.assertNotContains("Changes Shortcuts")
}
