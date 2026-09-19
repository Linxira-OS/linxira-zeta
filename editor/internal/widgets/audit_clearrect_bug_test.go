package widgets

import (
	"testing"
	"time"

	"github.com/eugenioenko/ttt/internal/term"
)

// Repro for BUG-052 from audit/2026-07-12-ux-bug-audit.md (branch audit/bug-hunt). Asserts the
// CORRECT behavior and is skipped while the bug exists — remove the
// t.Skip when fixing, and delete the audit entry.
//
// A plugin can call p:clear(x, y, w, h) with arbitrary dimensions. The
// raw-cell ClearRect loops h*w times with no clamp to the surface size,
// so p:clear(0,0,100000,100000) iterates 1e10 times and freezes the
// render/event loop. ClearRect must clamp w/h to the surface bounds.
//
// The work runs in a goroutine guarded by a timeout so this test FAILS
// fast rather than hanging the suite when the bug is present.
func TestClearRectClampsToSurfaceBounds(t *testing.T) {
	t.Skip("BUG-052, see audit/2026-07-12-ux-bug-audit.md — ClearRect has no bound check; huge w/h freezes the UI")

	vs := newVirtualSurface(20, 10)

	done := make(chan struct{})
	go func() {
		vs.ClearRect(0, 0, 100000, 100000, term.StyleDefault)
		close(done)
	}()

	select {
	case <-done:
		// Clamped correctly — returned promptly.
	case <-time.After(2 * time.Second):
		t.Fatal("ClearRect did not return within 2s for a 20x10 surface — no bound check on w/h")
	}
}
