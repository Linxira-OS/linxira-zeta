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

// ButtonGesture tracks one mouse gesture by its initiating buttons. Under
// the same stale-bits condition as MouseEdgeTracker, tcell's Buttons() may
// never return ButtonNone after the physical release, so "gesture ends"
// must be detected as a FALLING edge of the initiating buttons (they leave
// the reported mask), not as an absolute Buttons()==ButtonNone test.
//
// Begin records only the pressed mouse-button bits of the gesture (never
// the whole mask — the phantom Button2 bit rides along in the press event
// and would pin the gesture forever); Ended reports whether every
// initiating button has left the mask and resets the gesture.
type ButtonGesture struct {
	buttons tcell.ButtonMask
}

// Begin records the initiating buttons of a gesture at its press edge.
// Pass the Rising() mask (or the raw pressed mask as a fallback when no
// edge was observed).
func (g *ButtonGesture) Begin(pressed tcell.ButtonMask) {
	g.buttons = pressed & (tcell.Button1 | tcell.Button2 | tcell.Button3)
}

// Ended reports whether the gesture's initiating buttons have all left the
// reported mask (their falling edge), resetting the gesture. A zero mask
// (true ButtonNone) naturally satisfies this.
func (g *ButtonGesture) Ended(btn tcell.ButtonMask) bool {
	if g.buttons != 0 && btn&g.buttons == 0 {
		g.buttons = 0
		return true
	}
	return false
}

// Reset clears the gesture without a falling edge (e.g. overlay removal).
func (g *ButtonGesture) Reset() { g.buttons = 0 }
