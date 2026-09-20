package widgets

import (
	"testing"

	"github.com/gdamore/tcell/v3"
)

// fixedWidget is a test helper with configurable fixed height/width.
// Height()==0 or Width()==0 means "grow" (fill remaining space).
type fixedWidget struct {
	BaseWidget
	h, w      int
	lastEvent tcell.Event
	consume   bool // whether HandleEvent returns EventConsumed
}

func (f *fixedWidget) Height() int { return f.h }
func (f *fixedWidget) Width() int  { return f.w }
func (f *fixedWidget) Render(surface Surface) {
	// Store the rect that was set by the parent layout
}
func (f *fixedWidget) HandleEvent(ev tcell.Event) EventResult {
	f.lastEvent = ev
	if f.consume {
		return EventConsumed
	}
	return EventIgnored
}

// --- VStackWidget tests ---

func TestVStackHeightFixedChildren(t *testing.T) {
	a := &fixedWidget{h: 3, w: 10}
	b := &fixedWidget{h: 5, w: 10}
	vs := NewVStackWidget(a, b)

	if got := vs.Height(); got != 8 {
		t.Errorf("expected Height()=8, got %d", got)
	}
}

func TestVStackHeightWithGap(t *testing.T) {
	a := &fixedWidget{h: 3, w: 10}
	b := &fixedWidget{h: 5, w: 10}
	c := &fixedWidget{h: 2, w: 10}
	vs := NewVStackWidget(a, b, c)
	vs.Gap = 2

	// 3 + 5 + 2 = 10 fixed, plus 2 gaps * 2 = 4
	if got := vs.Height(); got != 14 {
		t.Errorf("expected Height()=14, got %d", got)
	}
}

func TestVStackHeightZeroWhenGrowChild(t *testing.T) {
	a := &fixedWidget{h: 3, w: 10}
	b := &fixedWidget{h: 0, w: 10} // grow child
	vs := NewVStackWidget(a, b)

	if got := vs.Height(); got != 0 {
		t.Errorf("expected Height()=0 (has grow child), got %d", got)
	}
}

func TestVStackHeightEmpty(t *testing.T) {
	vs := NewVStackWidget()
	if got := vs.Height(); got != 0 {
		t.Errorf("expected Height()=0 for empty vstack, got %d", got)
	}
}

func TestVStackLayoutFixedChildren(t *testing.T) {
	a := &fixedWidget{h: 3, w: 10}
	b := &fixedWidget{h: 5, w: 10}
	vs := NewVStackWidget(a, b)

	renderWidget(vs, 0, 0, 20, 8)

	ra := a.GetRect()
	rb := b.GetRect()

	if ra.Y != 0 || ra.H != 3 {
		t.Errorf("child A: expected Y=0 H=3, got Y=%d H=%d", ra.Y, ra.H)
	}
	if ra.W != 20 {
		t.Errorf("child A: expected W=20, got W=%d", ra.W)
	}
	if rb.Y != 3 || rb.H != 5 {
		t.Errorf("child B: expected Y=3 H=5, got Y=%d H=%d", rb.Y, rb.H)
	}
}

func TestVStackLayoutFixedChildrenWithGap(t *testing.T) {
	a := &fixedWidget{h: 3, w: 10}
	b := &fixedWidget{h: 4, w: 10}
	vs := NewVStackWidget(a, b)
	vs.Gap = 2

	renderWidget(vs, 0, 0, 20, 9)

	ra := a.GetRect()
	rb := b.GetRect()

	if ra.Y != 0 || ra.H != 3 {
		t.Errorf("child A: expected Y=0 H=3, got Y=%d H=%d", ra.Y, ra.H)
	}
	// gap=2, so B starts at 3+2=5
	if rb.Y != 5 || rb.H != 4 {
		t.Errorf("child B: expected Y=5 H=4, got Y=%d H=%d", rb.Y, rb.H)
	}
}

func TestVStackLayoutGrowChild(t *testing.T) {
	a := &fixedWidget{h: 3, w: 10}
	b := &fixedWidget{h: 0, w: 10} // grow
	vs := NewVStackWidget(a, b)

	renderWidget(vs, 0, 0, 20, 10)

	ra := a.GetRect()
	rb := b.GetRect()

	if ra.Y != 0 || ra.H != 3 {
		t.Errorf("child A: expected Y=0 H=3, got Y=%d H=%d", ra.Y, ra.H)
	}
	// Grow child gets remaining: 10 - 3 = 7
	if rb.Y != 3 || rb.H != 7 {
		t.Errorf("child B (grow): expected Y=3 H=7, got Y=%d H=%d", rb.Y, rb.H)
	}
}

func TestVStackLayoutMultipleGrowChildren(t *testing.T) {
	a := &fixedWidget{h: 0, w: 10} // grow
	b := &fixedWidget{h: 0, w: 10} // grow
	c := &fixedWidget{h: 0, w: 10} // grow
	vs := NewVStackWidget(a, b, c)

	renderWidget(vs, 0, 0, 20, 10)

	ra := a.GetRect()
	rb := b.GetRect()
	rc := c.GetRect()

	// 10 / 3 = 3 remainder 1. First grow child gets the extra pixel.
	if ra.H != 4 {
		t.Errorf("child A (grow): expected H=4, got H=%d", ra.H)
	}
	if rb.H != 3 {
		t.Errorf("child B (grow): expected H=3, got H=%d", rb.H)
	}
	if rc.H != 3 {
		t.Errorf("child C (grow): expected H=3, got H=%d", rc.H)
	}

	// Verify Y positions are contiguous
	if ra.Y != 0 {
		t.Errorf("child A: expected Y=0, got Y=%d", ra.Y)
	}
	if rb.Y != 4 {
		t.Errorf("child B: expected Y=4, got Y=%d", rb.Y)
	}
	if rc.Y != 7 {
		t.Errorf("child C: expected Y=7, got Y=%d", rc.Y)
	}
}

func TestVStackLayoutMultipleGrowEvenDivision(t *testing.T) {
	a := &fixedWidget{h: 0, w: 10} // grow
	b := &fixedWidget{h: 0, w: 10} // grow
	vs := NewVStackWidget(a, b)

	renderWidget(vs, 0, 0, 20, 10)

	ra := a.GetRect()
	rb := b.GetRect()

	if ra.H != 5 || rb.H != 5 {
		t.Errorf("expected even split H=5/5, got H=%d/%d", ra.H, rb.H)
	}
}

func TestVStackAlignCenter(t *testing.T) {
	a := &fixedWidget{h: 2, w: 10}
	b := &fixedWidget{h: 2, w: 10}
	vs := NewVStackWidget(a, b)
	vs.Align = "center"

	// Total children height = 4, container height = 10
	// Centered offset = (10 - 4) / 2 = 3
	renderWidget(vs, 0, 0, 20, 10)

	ra := a.GetRect()
	rb := b.GetRect()

	if ra.Y != 3 {
		t.Errorf("child A centered: expected Y=3, got Y=%d", ra.Y)
	}
	if rb.Y != 5 {
		t.Errorf("child B centered: expected Y=5, got Y=%d", rb.Y)
	}
}

func TestVStackAlignBottom(t *testing.T) {
	a := &fixedWidget{h: 2, w: 10}
	b := &fixedWidget{h: 3, w: 10}
	vs := NewVStackWidget(a, b)
	vs.Align = "bottom"

	// Total children height = 5, container height = 10
	// Bottom offset = 10 - 5 = 5
	renderWidget(vs, 0, 0, 20, 10)

	ra := a.GetRect()
	rb := b.GetRect()

	if ra.Y != 5 {
		t.Errorf("child A bottom: expected Y=5, got Y=%d", ra.Y)
	}
	if rb.Y != 7 {
		t.Errorf("child B bottom: expected Y=7, got Y=%d", rb.Y)
	}
}

func TestVStackAlignCenterIgnoredWithGrowChildren(t *testing.T) {
	a := &fixedWidget{h: 2, w: 10}
	b := &fixedWidget{h: 0, w: 10} // grow
	vs := NewVStackWidget(a, b)
	vs.Align = "center"

	renderWidget(vs, 0, 0, 20, 10)

	ra := a.GetRect()

	// With a grow child, alignment is ignored (grow fills space)
	if ra.Y != 0 {
		t.Errorf("with grow child, first child should start at Y=0, got Y=%d", ra.Y)
	}
}

func TestVStackEventDelegationFirstConsumerWins(t *testing.T) {
	a := &fixedWidget{h: 3, w: 10, consume: true}
	b := &fixedWidget{h: 3, w: 10, consume: true}
	vs := NewVStackWidget(a, b)

	ev := tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone)
	result := vs.HandleEvent(ev)

	if result != EventConsumed {
		t.Error("expected EventConsumed")
	}
	if a.lastEvent != ev {
		t.Error("first child should receive the event")
	}
	if b.lastEvent != nil {
		t.Error("second child should NOT receive event when first consumed")
	}
}

func TestVStackEventDelegationFallthrough(t *testing.T) {
	a := &fixedWidget{h: 3, w: 10, consume: false}
	b := &fixedWidget{h: 3, w: 10, consume: true}
	vs := NewVStackWidget(a, b)

	ev := tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone)
	result := vs.HandleEvent(ev)

	if result != EventConsumed {
		t.Error("expected EventConsumed from second child")
	}
	if a.lastEvent != ev {
		t.Error("first child should still receive the event")
	}
	if b.lastEvent != ev {
		t.Error("second child should receive event when first ignores")
	}
}

func TestVStackEventDelegationNoneConsume(t *testing.T) {
	a := &fixedWidget{h: 3, w: 10, consume: false}
	b := &fixedWidget{h: 3, w: 10, consume: false}
	vs := NewVStackWidget(a, b)

	ev := tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone)
	result := vs.HandleEvent(ev)

	if result != EventIgnored {
		t.Error("expected EventIgnored when no child consumes")
	}
}

func TestVStackLayoutAtOffset(t *testing.T) {
	a := &fixedWidget{h: 3, w: 10}
	b := &fixedWidget{h: 4, w: 10}
	vs := NewVStackWidget(a, b)

	renderWidget(vs, 10, 20, 30, 7)

	ra := a.GetRect()
	rb := b.GetRect()

	// Children rects should include parent offset
	if ra.X != 10 || ra.Y != 20 {
		t.Errorf("child A: expected X=10 Y=20, got X=%d Y=%d", ra.X, ra.Y)
	}
	if rb.X != 10 || rb.Y != 23 {
		t.Errorf("child B: expected X=10 Y=23, got X=%d Y=%d", rb.X, rb.Y)
	}
}

// --- HStackWidget tests ---

func TestHStackLayoutFixedWidthChildren(t *testing.T) {
	a := &fixedWidget{h: 10, w: 5}
	b := &fixedWidget{h: 10, w: 8}
	hs := NewHStackWidget(a, b)

	renderWidget(hs, 0, 0, 20, 10)

	ra := a.GetRect()
	rb := b.GetRect()

	if ra.X != 0 || ra.W != 5 {
		t.Errorf("child A: expected X=0 W=5, got X=%d W=%d", ra.X, ra.W)
	}
	if rb.X != 5 || rb.W != 8 {
		t.Errorf("child B: expected X=5 W=8, got X=%d W=%d", rb.X, rb.W)
	}
	// Both children get full height
	if ra.H != 10 || rb.H != 10 {
		t.Errorf("children should get full height, got H=%d/%d", ra.H, rb.H)
	}
}

func TestHStackLayoutFixedWidthChildrenWithGap(t *testing.T) {
	a := &fixedWidget{h: 10, w: 5}
	b := &fixedWidget{h: 10, w: 8}
	hs := NewHStackWidget(a, b)
	hs.Gap = 3

	renderWidget(hs, 0, 0, 20, 10)

	ra := a.GetRect()
	rb := b.GetRect()

	if ra.X != 0 || ra.W != 5 {
		t.Errorf("child A: expected X=0 W=5, got X=%d W=%d", ra.X, ra.W)
	}
	// gap=3, so B starts at 5+3=8
	if rb.X != 8 || rb.W != 8 {
		t.Errorf("child B: expected X=8 W=8, got X=%d W=%d", rb.X, rb.W)
	}
}

func TestHStackLayoutGrowChildren(t *testing.T) {
	a := &fixedWidget{h: 10, w: 5}
	b := &fixedWidget{h: 10, w: 0} // grow
	hs := NewHStackWidget(a, b)

	renderWidget(hs, 0, 0, 20, 10)

	ra := a.GetRect()
	rb := b.GetRect()

	if ra.X != 0 || ra.W != 5 {
		t.Errorf("child A: expected X=0 W=5, got X=%d W=%d", ra.X, ra.W)
	}
	// Grow child gets remaining: 20 - 5 = 15
	if rb.X != 5 || rb.W != 15 {
		t.Errorf("child B (grow): expected X=5 W=15, got X=%d W=%d", rb.X, rb.W)
	}
}

func TestHStackLayoutMultipleGrowChildren(t *testing.T) {
	a := &fixedWidget{h: 10, w: 0} // grow
	b := &fixedWidget{h: 10, w: 0} // grow
	c := &fixedWidget{h: 10, w: 0} // grow
	hs := NewHStackWidget(a, b, c)

	renderWidget(hs, 0, 0, 10, 10)

	ra := a.GetRect()
	rb := b.GetRect()
	rc := c.GetRect()

	// 10 / 3 = 3 remainder 1. First grow child gets the extra pixel.
	if ra.W != 4 {
		t.Errorf("child A (grow): expected W=4, got W=%d", ra.W)
	}
	if rb.W != 3 {
		t.Errorf("child B (grow): expected W=3, got W=%d", rb.W)
	}
	if rc.W != 3 {
		t.Errorf("child C (grow): expected W=3, got W=%d", rc.W)
	}

	if ra.X != 0 {
		t.Errorf("child A: expected X=0, got X=%d", ra.X)
	}
	if rb.X != 4 {
		t.Errorf("child B: expected X=4, got X=%d", rb.X)
	}
	if rc.X != 7 {
		t.Errorf("child C: expected X=7, got X=%d", rc.X)
	}
}

func TestHStackAlignCenter(t *testing.T) {
	a := &fixedWidget{h: 10, w: 3}
	b := &fixedWidget{h: 10, w: 3}
	hs := NewHStackWidget(a, b)
	hs.Align = "center"

	// Total children width = 6, container width = 20
	// Centered offset = (20 - 6) / 2 = 7
	renderWidget(hs, 0, 0, 20, 10)

	ra := a.GetRect()
	rb := b.GetRect()

	if ra.X != 7 {
		t.Errorf("child A centered: expected X=7, got X=%d", ra.X)
	}
	if rb.X != 10 {
		t.Errorf("child B centered: expected X=10, got X=%d", rb.X)
	}
}

func TestHStackAlignRight(t *testing.T) {
	a := &fixedWidget{h: 10, w: 3}
	b := &fixedWidget{h: 10, w: 4}
	hs := NewHStackWidget(a, b)
	hs.Align = "right"

	// Total children width = 7, container width = 20
	// Right offset = 20 - 7 = 13
	renderWidget(hs, 0, 0, 20, 10)

	ra := a.GetRect()
	rb := b.GetRect()

	if ra.X != 13 {
		t.Errorf("child A right: expected X=13, got X=%d", ra.X)
	}
	if rb.X != 16 {
		t.Errorf("child B right: expected X=16, got X=%d", rb.X)
	}
}

func TestHStackAlignCenterIgnoredWithGrowChildren(t *testing.T) {
	a := &fixedWidget{h: 10, w: 3}
	b := &fixedWidget{h: 10, w: 0} // grow
	hs := NewHStackWidget(a, b)
	hs.Align = "center"

	renderWidget(hs, 0, 0, 20, 10)

	ra := a.GetRect()

	// With a grow child, alignment is ignored
	if ra.X != 0 {
		t.Errorf("with grow child, first child should start at X=0, got X=%d", ra.X)
	}
}

func TestHStackEventDelegationFirstConsumerWins(t *testing.T) {
	a := &fixedWidget{h: 10, w: 5, consume: true}
	b := &fixedWidget{h: 10, w: 5, consume: true}
	hs := NewHStackWidget(a, b)

	ev := tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone)
	result := hs.HandleEvent(ev)

	if result != EventConsumed {
		t.Error("expected EventConsumed")
	}
	if a.lastEvent != ev {
		t.Error("first child should receive the event")
	}
	if b.lastEvent != nil {
		t.Error("second child should NOT receive event when first consumed")
	}
}

func TestHStackEventDelegationNoneConsume(t *testing.T) {
	a := &fixedWidget{h: 10, w: 5, consume: false}
	b := &fixedWidget{h: 10, w: 5, consume: false}
	hs := NewHStackWidget(a, b)

	ev := tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone)
	result := hs.HandleEvent(ev)

	if result != EventIgnored {
		t.Error("expected EventIgnored when no child consumes")
	}
}

func TestHStackLayoutAtOffset(t *testing.T) {
	a := &fixedWidget{h: 10, w: 5}
	b := &fixedWidget{h: 10, w: 8}
	hs := NewHStackWidget(a, b)

	renderWidget(hs, 10, 20, 30, 10)

	ra := a.GetRect()
	rb := b.GetRect()

	// Children rects should include parent offset
	if ra.X != 10 || ra.Y != 20 {
		t.Errorf("child A: expected X=10 Y=20, got X=%d Y=%d", ra.X, ra.Y)
	}
	if rb.X != 15 || rb.Y != 20 {
		t.Errorf("child B: expected X=15 Y=20, got X=%d Y=%d", rb.X, rb.Y)
	}
}

func TestVStackGrowWithFixedAndGap(t *testing.T) {
	a := &fixedWidget{h: 2, w: 10}
	b := &fixedWidget{h: 0, w: 10} // grow
	c := &fixedWidget{h: 3, w: 10}
	vs := NewVStackWidget(a, b, c)
	vs.Gap = 1

	// total = 20, fixed = 2+3 = 5, gaps = 2*1 = 2, remaining = 20-5-2 = 13
	renderWidget(vs, 0, 0, 20, 20)

	ra := a.GetRect()
	rb := b.GetRect()
	rc := c.GetRect()

	if ra.Y != 0 || ra.H != 2 {
		t.Errorf("child A: expected Y=0 H=2, got Y=%d H=%d", ra.Y, ra.H)
	}
	// A ends at 2, gap=1 -> B starts at 3
	if rb.Y != 3 || rb.H != 13 {
		t.Errorf("child B (grow): expected Y=3 H=13, got Y=%d H=%d", rb.Y, rb.H)
	}
	// B ends at 16, gap=1 -> C starts at 17
	if rc.Y != 17 || rc.H != 3 {
		t.Errorf("child C: expected Y=17 H=3, got Y=%d H=%d", rc.Y, rc.H)
	}
}

func TestHStackGrowWithFixedAndGap(t *testing.T) {
	a := &fixedWidget{h: 10, w: 4}
	b := &fixedWidget{h: 10, w: 0} // grow
	c := &fixedWidget{h: 10, w: 6}
	hs := NewHStackWidget(a, b, c)
	hs.Gap = 2

	// total = 30, fixed = 4+6 = 10, gaps = 2*2 = 4, remaining = 30-10-4 = 16
	renderWidget(hs, 0, 0, 30, 10)

	ra := a.GetRect()
	rb := b.GetRect()
	rc := c.GetRect()

	if ra.X != 0 || ra.W != 4 {
		t.Errorf("child A: expected X=0 W=4, got X=%d W=%d", ra.X, ra.W)
	}
	// A ends at 4, gap=2 -> B starts at 6
	if rb.X != 6 || rb.W != 16 {
		t.Errorf("child B (grow): expected X=6 W=16, got X=%d W=%d", rb.X, rb.W)
	}
	// B ends at 22, gap=2 -> C starts at 24
	if rc.X != 24 || rc.W != 6 {
		t.Errorf("child C: expected X=24 W=6, got X=%d W=%d", rc.X, rc.W)
	}
}
