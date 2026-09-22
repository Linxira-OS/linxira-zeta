package ui

import "github.com/gdamore/tcell/v3"

// MouseEdgeTracker collapses raw tcell button bitmasks into press edges.
//
// Terminals with quirky SGR release sequences (observed with Tabby after
// dismissing a file dialog) can leave a stale bit inside tcell's btnsDown
// set; tcell then re-reports that bit as pressed on every subsequent motion
// event, so merely moving the pointer re-opened context menus (v1.1.18
// damage). Edge detection is immune: a stale bit never rises, because it
// was already present in the previous mask.
type MouseEdgeTracker struct {
	last tcell.ButtonMask
}

// Rising returns the bits newly pressed in btn compared to the previously
// seen mask, recording btn for the next call. Feed it every mouse event
// for the widget, including motion events, or edges will be mis-ordered.
func (m *MouseEdgeTracker) Rising(btn tcell.ButtonMask) tcell.ButtonMask {
	rising := btn &^ m.last
	m.last = btn
	return rising
}
