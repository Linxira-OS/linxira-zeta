package widgets

import (
	"testing"

	"github.com/eugenioenko/ttt/internal/term"
	"github.com/gdamore/tcell/v3"
)

// --- BoxWidget tests ---

func TestBoxHeightWidthWithChild(t *testing.T) {
	child := &fixedWidget{h: 5, w: 10}
	box := NewBoxWithBorder(term.SingleBorderSet())
	box.Child = child

	// Border adds 1 top + 1 bottom = 2 height overhead, 1 left + 1 right = 2 width overhead
	if got := box.Height(); got != 7 {
		t.Errorf("expected Height()=7 (5 child + 2 border), got %d", got)
	}
	if got := box.Width(); got != 12 {
		t.Errorf("expected Width()=12 (10 child + 2 border), got %d", got)
	}
}

func TestBoxHeightWidthWithPaddingAndChild(t *testing.T) {
	child := &fixedWidget{h: 4, w: 8}
	box := NewBoxWithPadding(2)
	box.Child = child

	// Padding adds 2 top + 2 bottom = 4 height overhead, 2 left + 2 right = 4 width overhead
	if got := box.Height(); got != 8 {
		t.Errorf("expected Height()=8 (4 child + 4 padding), got %d", got)
	}
	if got := box.Width(); got != 12 {
		t.Errorf("expected Width()=12 (8 child + 4 padding), got %d", got)
	}
}

func TestBoxHeightWidthWithBorderAndPadding(t *testing.T) {
	child := &fixedWidget{h: 3, w: 6}
	box := NewBoxWithBorderAndPadding(term.SingleBorderSet(), 1)
	box.Child = child

	// Border: 2 vertical + 2 horizontal, padding: 2 vertical + 2 horizontal
	// Total overhead: H = 1+1+1+1 = 4, W = 1+1+1+1 = 4
	if got := box.Height(); got != 7 {
		t.Errorf("expected Height()=7 (3 child + 4 overhead), got %d", got)
	}
	if got := box.Width(); got != 10 {
		t.Errorf("expected Width()=10 (6 child + 4 overhead), got %d", got)
	}
}

func TestBoxHeightWidthNilChild(t *testing.T) {
	box := NewBoxWithBorder(term.SingleBorderSet())
	// No child set

	if got := box.Height(); got != 0 {
		t.Errorf("expected Height()=0 with nil child, got %d", got)
	}
	if got := box.Width(); got != 0 {
		t.Errorf("expected Width()=0 with nil child, got %d", got)
	}
}

func TestBoxHeightWidthGrowChild(t *testing.T) {
	child := &fixedWidget{h: 0, w: 0} // grow child returns 0
	box := NewBoxWithBorder(term.SingleBorderSet())
	box.Child = child

	if got := box.Height(); got != 0 {
		t.Errorf("expected Height()=0 with grow child, got %d", got)
	}
	if got := box.Width(); got != 0 {
		t.Errorf("expected Width()=0 with grow child, got %d", got)
	}
}

func TestBoxEventPassthroughToChild(t *testing.T) {
	child := &fixedWidget{h: 5, w: 10, consume: true}
	box := NewBoxWithBorder(term.SingleBorderSet())
	box.Child = child

	ev := tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone)
	result := box.HandleEvent(ev)

	if result != EventConsumed {
		t.Error("expected EventConsumed when child consumes")
	}
	if child.lastEvent != ev {
		t.Error("event should be forwarded to child")
	}
}

func TestBoxEventIgnoredWhenChildIgnores(t *testing.T) {
	child := &fixedWidget{h: 5, w: 10, consume: false}
	box := NewBoxWithBorder(term.SingleBorderSet())
	box.Child = child

	ev := tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone)
	result := box.HandleEvent(ev)

	if result != EventIgnored {
		t.Error("expected EventIgnored when child ignores")
	}
}

func TestBoxEventIgnoredNilChild(t *testing.T) {
	box := NewBoxWithBorder(term.SingleBorderSet())

	ev := tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone)
	result := box.HandleEvent(ev)

	if result != EventIgnored {
		t.Errorf("expected EventIgnored with nil child, got %d", result)
	}
}

func TestNewBoxWithBorderSetsBorderFlags(t *testing.T) {
	box := NewBoxWithBorder(term.SingleBorderSet())

	if !box.Box.BorderTop || !box.Box.BorderBottom || !box.Box.BorderLeft || !box.Box.BorderRight {
		t.Error("NewBoxWithBorder should set all border flags to true")
	}
	if box.Box.PaddingTop != 0 || box.Box.PaddingBottom != 0 || box.Box.PaddingLeft != 0 || box.Box.PaddingRight != 0 {
		t.Error("NewBoxWithBorder should not set padding")
	}
}

func TestNewBoxWithPaddingSetsPadding(t *testing.T) {
	box := NewBoxWithPadding(3)

	if box.Box.PaddingTop != 3 || box.Box.PaddingBottom != 3 || box.Box.PaddingLeft != 3 || box.Box.PaddingRight != 3 {
		t.Errorf("NewBoxWithPadding(3) should set all padding to 3, got top=%d bottom=%d left=%d right=%d",
			box.Box.PaddingTop, box.Box.PaddingBottom, box.Box.PaddingLeft, box.Box.PaddingRight)
	}
	if box.Box.BorderTop || box.Box.BorderBottom || box.Box.BorderLeft || box.Box.BorderRight {
		t.Error("NewBoxWithPadding should not set border flags")
	}
}

// --- ScrollViewWidget tests ---

// scrollableWidget is a mock implementing both Widget and ScrollableWidget.
type scrollableWidget struct {
	fixedWidget
	contentW, contentH int
}

func (s *scrollableWidget) ScrollSize() (int, int) {
	return s.contentW, s.contentH
}

func TestScrollViewClampScrollYToBounds(t *testing.T) {
	child := &scrollableWidget{
		fixedWidget: fixedWidget{h: 0, w: 0},
		contentW:    20,
		contentH:    50,
	}
	sv := NewScrollViewWidget(child)
	sv.SetRect(Rect{X: 0, Y: 0, W: 20, H: 10})

	// Render to trigger clamp
	surface := newTestSurface(20, 10)
	sv.Render(surface)

	// scrollY should be 0 initially
	if sv.scrollY != 0 {
		t.Errorf("expected initial scrollY=0, got %d", sv.scrollY)
	}

	// Set scrollY beyond max and render to trigger clamp
	sv.scrollY = 100
	sv.Render(surface)
	// viewportSize(20, 10, 20, 50): contentH>h -> vw=19; contentW(20)>vw(19) -> vh=9
	// maxY = contentH - viewH = 50 - 9 = 41
	if sv.scrollY != 41 {
		t.Errorf("expected scrollY clamped to 41, got %d", sv.scrollY)
	}

	// Set scrollY negative and render to trigger clamp
	sv.scrollY = -5
	sv.Render(surface)
	if sv.scrollY != 0 {
		t.Errorf("expected scrollY clamped to 0, got %d", sv.scrollY)
	}
}

func TestScrollViewClampScrollXToBounds(t *testing.T) {
	child := &scrollableWidget{
		fixedWidget: fixedWidget{h: 0, w: 0},
		contentW:    50,
		contentH:    5, // fits vertically, no vbar
	}
	sv := NewScrollViewWidget(child)
	sv.SetRect(Rect{X: 0, Y: 0, W: 20, H: 10})

	surface := newTestSurface(20, 10)

	// Set scrollX beyond max and render to trigger clamp
	sv.scrollX = 100
	sv.Render(surface)
	// maxX = contentW - viewW = 50 - 20 = 30
	// (content fits vertically so no vbar, but hbar takes 1 row, leaving viewH=9)
	// viewW = 20 (no vbar since contentH=5 < h=10)
	// maxX = 50 - 20 = 30
	if sv.scrollX != 30 {
		t.Errorf("expected scrollX clamped to 30, got %d", sv.scrollX)
	}

	sv.scrollX = -10
	sv.Render(surface)
	if sv.scrollX != 0 {
		t.Errorf("expected scrollX clamped to 0, got %d", sv.scrollX)
	}
}

func TestScrollViewClampWhenContentFitsViewport(t *testing.T) {
	child := &scrollableWidget{
		fixedWidget: fixedWidget{h: 0, w: 0},
		contentW:    10,
		contentH:    5, // fits in viewport
	}
	sv := NewScrollViewWidget(child)
	sv.SetRect(Rect{X: 0, Y: 0, W: 20, H: 10})

	// Even if scrollY is set, it should clamp to 0 since content fits
	sv.scrollY = 5
	sv.scrollX = 3
	surface := newTestSurface(20, 10)
	sv.Render(surface)

	if sv.scrollY != 0 {
		t.Errorf("expected scrollY=0 when content fits, got %d", sv.scrollY)
	}
	if sv.scrollX != 0 {
		t.Errorf("expected scrollX=0 when content fits, got %d", sv.scrollX)
	}
}

func TestScrollViewEnsureVisibleBelow(t *testing.T) {
	child := &scrollableWidget{
		fixedWidget: fixedWidget{h: 0, w: 0},
		contentW:    20,
		contentH:    50,
	}
	sv := NewScrollViewWidget(child)
	sv.SetRect(Rect{X: 0, Y: 0, W: 20, H: 10})
	sv.scrollY = 0

	// Point at y=15 is below viewport (viewport shows rows 0..9)
	sv.EnsureVisible(5, 15)

	// viewportSize: contentH(50)>h(10)->vw=19; contentW(20)>vw(19)->vh=9
	// scrollY = 15 - 9 + 1 = 7
	if sv.scrollY != 7 {
		t.Errorf("expected scrollY=7 after EnsureVisible(5, 15), got %d", sv.scrollY)
	}
}

func TestScrollViewEnsureVisibleAbove(t *testing.T) {
	child := &scrollableWidget{
		fixedWidget: fixedWidget{h: 0, w: 0},
		contentW:    20,
		contentH:    50,
	}
	sv := NewScrollViewWidget(child)
	sv.SetRect(Rect{X: 0, Y: 0, W: 20, H: 10})
	sv.scrollY = 20

	// Point at y=5 is above viewport (viewport shows rows 20..29)
	sv.EnsureVisible(5, 5)

	if sv.scrollY != 5 {
		t.Errorf("expected scrollY=5 after EnsureVisible(5, 5), got %d", sv.scrollY)
	}
}

func TestScrollViewEnsureVisibleAlreadyVisible(t *testing.T) {
	child := &scrollableWidget{
		fixedWidget: fixedWidget{h: 0, w: 0},
		contentW:    20,
		contentH:    50,
	}
	sv := NewScrollViewWidget(child)
	sv.SetRect(Rect{X: 0, Y: 0, W: 20, H: 10})
	sv.scrollY = 10

	// Point at y=15 is within viewport (rows 10..19)
	sv.EnsureVisible(5, 15)

	if sv.scrollY != 10 {
		t.Errorf("expected scrollY unchanged at 10, got %d", sv.scrollY)
	}
}

func TestScrollViewEnsureVisibleHorizontal(t *testing.T) {
	child := &scrollableWidget{
		fixedWidget: fixedWidget{h: 0, w: 0},
		contentW:    50,
		contentH:    50,
	}
	sv := NewScrollViewWidget(child)
	sv.SetRect(Rect{X: 0, Y: 0, W: 20, H: 10})
	sv.scrollX = 0

	// Point at x=25 is beyond horizontal viewport
	sv.EnsureVisible(25, 5)

	// viewW is reduced by 1 for vbar (contentH > h), so viewW = 19
	// scrollX = 25 - 19 + 1 = 7
	if sv.scrollX != 7 {
		t.Errorf("expected scrollX=7 after EnsureVisible(25, 5), got %d", sv.scrollX)
	}
}

func TestScrollViewMouseWheelDown(t *testing.T) {
	child := &scrollableWidget{
		fixedWidget: fixedWidget{h: 0, w: 0},
		contentW:    20,
		contentH:    50,
	}
	sv := NewScrollViewWidget(child)
	sv.SetRect(Rect{X: 0, Y: 0, W: 20, H: 10})
	sv.scrollY = 0

	ev := tcell.NewEventMouse(5, 5, tcell.WheelDown, tcell.ModNone)
	result := sv.HandleEvent(ev)

	if result != EventConsumed {
		t.Error("expected EventConsumed for WheelDown")
	}
	if sv.scrollY != 3 {
		t.Errorf("expected scrollY=3 after WheelDown, got %d", sv.scrollY)
	}
}

func TestScrollViewMouseWheelUp(t *testing.T) {
	child := &scrollableWidget{
		fixedWidget: fixedWidget{h: 0, w: 0},
		contentW:    20,
		contentH:    50,
	}
	sv := NewScrollViewWidget(child)
	sv.SetRect(Rect{X: 0, Y: 0, W: 20, H: 10})
	sv.scrollY = 10

	ev := tcell.NewEventMouse(5, 5, tcell.WheelUp, tcell.ModNone)
	result := sv.HandleEvent(ev)

	if result != EventConsumed {
		t.Error("expected EventConsumed for WheelUp")
	}
	if sv.scrollY != 7 {
		t.Errorf("expected scrollY=7 after WheelUp, got %d", sv.scrollY)
	}
}

func TestScrollViewMouseWheelUpFloorZero(t *testing.T) {
	child := &scrollableWidget{
		fixedWidget: fixedWidget{h: 0, w: 0},
		contentW:    20,
		contentH:    50,
	}
	sv := NewScrollViewWidget(child)
	sv.SetRect(Rect{X: 0, Y: 0, W: 20, H: 10})
	sv.scrollY = 1

	ev := tcell.NewEventMouse(5, 5, tcell.WheelUp, tcell.ModNone)
	result := sv.HandleEvent(ev)

	if result != EventConsumed {
		t.Error("expected EventConsumed for WheelUp")
	}
	if sv.scrollY != 0 {
		t.Errorf("expected scrollY=0 (floored), got %d", sv.scrollY)
	}
}

func TestScrollViewEventDelegationToChild(t *testing.T) {
	child := &scrollableWidget{
		fixedWidget: fixedWidget{h: 0, w: 0, consume: true},
		contentW:    20,
		contentH:    50,
	}
	sv := NewScrollViewWidget(child)

	ev := tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone)
	result := sv.HandleEvent(ev)

	if result != EventConsumed {
		t.Error("expected EventConsumed when child consumes non-scroll event")
	}
	if child.lastEvent != ev {
		t.Error("non-scroll event should be forwarded to child")
	}
}

func TestScrollViewEventIgnoredByChild(t *testing.T) {
	child := &scrollableWidget{
		fixedWidget: fixedWidget{h: 0, w: 0, consume: false},
		contentW:    20,
		contentH:    50,
	}
	sv := NewScrollViewWidget(child)

	ev := tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone)
	result := sv.HandleEvent(ev)

	if result != EventIgnored {
		t.Errorf("expected EventIgnored when child ignores, got %d", result)
	}
}

func TestScrollViewMultipleWheelDownAccumulates(t *testing.T) {
	child := &scrollableWidget{
		fixedWidget: fixedWidget{h: 0, w: 0},
		contentW:    20,
		contentH:    50,
	}
	sv := NewScrollViewWidget(child)
	sv.SetRect(Rect{X: 0, Y: 0, W: 20, H: 10})
	sv.scrollY = 0

	for i := 0; i < 3; i++ {
		ev := tcell.NewEventMouse(5, 5, tcell.WheelDown, tcell.ModNone)
		sv.HandleEvent(ev)
	}

	if sv.scrollY != 9 {
		t.Errorf("expected scrollY=9 after 3 WheelDown events, got %d", sv.scrollY)
	}
}

func TestScrollViewHeightWidthReturnZero(t *testing.T) {
	child := &scrollableWidget{
		fixedWidget: fixedWidget{h: 0, w: 0},
		contentW:    20,
		contentH:    50,
	}
	sv := NewScrollViewWidget(child)

	// ScrollViewWidget always returns 0 (grow behavior)
	if sv.Height() != 0 {
		t.Errorf("expected Height()=0, got %d", sv.Height())
	}
	if sv.Width() != 0 {
		t.Errorf("expected Width()=0, got %d", sv.Width())
	}
}
