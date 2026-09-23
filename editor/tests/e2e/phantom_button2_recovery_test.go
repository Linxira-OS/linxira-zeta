package e2e

import (
	"strings"

	"testing"

	"github.com/gdamore/tcell/v3"
)

// Regression for v1.1.19: terminals with quirky SGR release sequences
// (observed on Tabby/Windows after dismissing a file dialog) replace the
// expected Button1 release with a stale Button2-only event. tcell keeps
// that phantom bit in btnsDown, so Buttons() never returns ButtonNone and
// every ButtonNone-keyed latch (root capture, editor mouseDown, menubar
// wasPressed, ...) stayed latched forever — the left click went dead
// everywhere. The falling-edge fix must keep a plain left click working
// right after such a phantom flow.
func TestExplorerClickSurvivesPhantomButton2Release(t *testing.T) {
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
	downX, downY := r.X+5, r.Y+2

	// A normal left press: the editor pane claims pointer capture and
	// latches mouseDown, exactly like any real click.
	down := tcell.NewEventMouse(downX, downY, tcell.Button1, tcell.ModNone)
	h.app.Root.HandleEvent(down)

	// The phantom: instead of the paired Button1 release, the terminal
	// reports a stale Button2-only event. Pre-fix, the ButtonNone-keyed
	// release never fired and the capture was pinned for good.
	phantom := tcell.NewEventMouse(downX, downY, tcell.Button2, tcell.ModNone)
	h.app.Root.HandleEvent(phantom)
	h.flushOnChange()
	h.redraw()
	// The phantom Button2 press opens the explorer context menu (that is the
	// v1.1.18 nuisance itself); dismiss it like a real user would.
	h.pressKey(tcell.KeyEscape, tcell.ModNone)
	h.flushOnChange()
	h.redraw()
	t.Logf("diag after phantom: selected=%d", h.app.Explorer.Tree.SelectedIndex())

	clickY := r.Y + 2 + (fileIdx - h.app.Explorer.Tree.ScrollTop())

	// A plain left click on a file must still open one. The exact row may
	// shift by one if the phantom press left the selection on the clicked
	// line, and the first click may be consumed dismissing the phantom's
	// own context menu — so click twice. "untitled" after both means the
	// left click died.
	h.click(r.X+5, clickY)
	h.click(r.X+5, clickY)

	got := h.app.EditorGroup.ActiveFilePath()
	if got == "" || strings.HasSuffix(got, "untitled") {
		t.Errorf("left click dead after phantom Button2 release: editor still shows %q", got)
	}
}
