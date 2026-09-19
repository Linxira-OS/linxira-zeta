package widgets

import (
	"testing"

	"github.com/eugenioenko/ttt/internal/term"
	"github.com/gdamore/tcell/v3"
)

func TestDrawerDefaultWidth(t *testing.T) {
	d := NewDrawerWidget(DrawerConfig{})
	if d.width != 40 {
		t.Errorf("expected default width=40, got %d", d.width)
	}
	if d.Config.MinWidth != 20 {
		t.Errorf("expected default MinWidth=20, got %d", d.Config.MinWidth)
	}
}

func TestDrawerCustomWidth(t *testing.T) {
	d := NewDrawerWidget(DrawerConfig{Width: 50, MinWidth: 30})
	if d.width != 50 {
		t.Errorf("expected width=50, got %d", d.width)
	}
	if d.Config.MinWidth != 30 {
		t.Errorf("expected MinWidth=30, got %d", d.Config.MinWidth)
	}
}

func TestDrawerHeightAndWidthReturnZero(t *testing.T) {
	d := NewDrawerWidget(DrawerConfig{})
	if d.Height() != 0 {
		t.Errorf("expected Height()=0, got %d", d.Height())
	}
	if d.Width() != 0 {
		t.Errorf("expected Width()=0, got %d", d.Width())
	}
}

func TestDrawerReset(t *testing.T) {
	d := NewDrawerWidget(DrawerConfig{Width: 50})
	d.width = 100
	d.Reset()
	if d.width != 50 {
		t.Errorf("after Reset(), expected width=50, got %d", d.width)
	}
}

func TestDrawerRenderBorders(t *testing.T) {
	borders := term.BorderSet{
		TopLeft:     '+',
		TopRight:    '+',
		BottomLeft:  '+',
		BottomRight: '+',
		Horizontal:  '-',
		Vertical:    '|',
	}
	d := NewDrawerWidget(DrawerConfig{Width: 10, MinWidth: 5, Borders: borders})
	s := renderWidget(d, 0, 0, 20, 10)

	// Drawer renders on the right side: x = sw - w = 20 - 10 = 10
	// Top-left corner at (10, 0)
	if s.cells[0][10].Ch != '+' {
		t.Errorf("expected top-left border '+' at (10,0), got '%c'", s.cells[0][10].Ch)
	}
	// Top-right corner at (19, 0)
	if s.cells[0][19].Ch != '+' {
		t.Errorf("expected top-right border '+' at (19,0), got '%c'", s.cells[0][19].Ch)
	}
	// Bottom-left corner at (10, 9)
	if s.cells[9][10].Ch != '+' {
		t.Errorf("expected bottom-left border '+' at (10,9), got '%c'", s.cells[9][10].Ch)
	}
	// Bottom-right corner at (19, 9)
	if s.cells[9][19].Ch != '+' {
		t.Errorf("expected bottom-right border '+' at (19,9), got '%c'", s.cells[9][19].Ch)
	}
	// Horizontal border at (11, 0)
	if s.cells[0][11].Ch != '-' {
		t.Errorf("expected horizontal border '-' at (11,0), got '%c'", s.cells[0][11].Ch)
	}
	// Vertical border at (10, 1)
	if s.cells[1][10].Ch != '|' {
		t.Errorf("expected vertical border '|' at (10,1), got '%c'", s.cells[1][10].Ch)
	}
}

func TestDrawerRenderContent(t *testing.T) {
	d := NewDrawerWidget(DrawerConfig{Width: 10, MinWidth: 5})
	label := NewLabelWidget(LabelConfig{Text: "Hello"})
	d.SetContent(label)

	renderWidget(d, 0, 0, 20, 10)

	// Content should have a non-zero rect inside the drawer borders
	r := label.GetRect()
	if r.W <= 0 || r.H <= 0 {
		t.Fatalf("content rect should be non-zero, got %+v", r)
	}
	// Content X should be inside the border: drawer at x=10, inner at x=11
	if r.X != 11 {
		t.Errorf("expected content X=11, got %d", r.X)
	}
}

func TestDrawerEscapeDismisses(t *testing.T) {
	dismissed := false
	d := NewDrawerWidget(DrawerConfig{
		OnDismiss: func() { dismissed = true },
	})

	ev := tcell.NewEventKey(tcell.KeyEscape, "", tcell.ModNone)
	result := d.HandleEvent(ev)

	if result != EventConsumed {
		t.Error("escape should be consumed")
	}
	if !dismissed {
		t.Error("escape should call OnDismiss")
	}
}

func TestDrawerKeyEventDelegatedToContent(t *testing.T) {
	content := &fixedWidget{h: 5, w: 10, consume: true}
	d := NewDrawerWidget(DrawerConfig{})
	d.SetContent(content)

	ev := tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone)
	result := d.HandleEvent(ev)

	if result != EventConsumed {
		t.Error("key event should be delegated to content")
	}
	if content.lastEvent != ev {
		t.Error("content should receive the key event")
	}
}

func TestDrawerKeyEventWithoutContent(t *testing.T) {
	d := NewDrawerWidget(DrawerConfig{})

	ev := tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone)
	result := d.HandleEvent(ev)

	if result != EventIgnored {
		t.Errorf("non-escape key without content should be ignored, got %v", result)
	}
}

func TestDrawerClickOutsideDismisses(t *testing.T) {
	dismissed := false
	d := NewDrawerWidget(DrawerConfig{
		Width:     10,
		MinWidth:  5,
		OnDismiss: func() { dismissed = true },
	})

	// Set rect so HandleEvent can compute positions
	d.SetRect(Rect{X: 0, Y: 0, W: 20, H: 10})

	// Drawer occupies right side: x = 20 - 10 = 10, so borderX = 10
	// Click at x=5 is outside (left of border), should dismiss
	click := mouseClick(5, 5)
	result := d.HandleEvent(click)

	if result != EventConsumed {
		t.Error("click outside drawer should be consumed")
	}
	if !dismissed {
		t.Error("click outside drawer should call OnDismiss")
	}
}

func TestDrawerDragResizes(t *testing.T) {
	d := NewDrawerWidget(DrawerConfig{Width: 10, MinWidth: 5})
	d.SetRect(Rect{X: 0, Y: 0, W: 30, H: 10})

	// borderX = 0 + 30 - 10 = 20. Click on border at x=20 to start drag
	click := mouseClick(20, 5)
	result := d.HandleEvent(click)
	if result != EventConsumed {
		t.Error("click on border should be consumed to start drag")
	}
	if !d.dragging {
		t.Error("should be in dragging state after click on border")
	}

	// Drag to x=15: newW = 0 + 30 - 15 = 15
	drag := tcell.NewEventMouse(15, 5, tcell.Button1, tcell.ModNone)
	d.HandleEvent(drag)
	if d.width != 15 {
		t.Errorf("expected width=15 after drag, got %d", d.width)
	}

	// Release stops drag
	release := mouseRelease(15, 5)
	d.HandleEvent(release)
	if d.dragging {
		t.Error("should stop dragging on release")
	}
}

func TestDrawerDragRespectsMinWidth(t *testing.T) {
	d := NewDrawerWidget(DrawerConfig{Width: 10, MinWidth: 8})
	d.SetRect(Rect{X: 0, Y: 0, W: 30, H: 10})

	// Start drag
	click := mouseClick(20, 5)
	d.HandleEvent(click)

	// Drag far right: newW = 0 + 30 - 28 = 2, clamped to minWidth=8
	drag := tcell.NewEventMouse(28, 5, tcell.Button1, tcell.ModNone)
	d.HandleEvent(drag)
	if d.width != 8 {
		t.Errorf("expected width clamped to minWidth=8, got %d", d.width)
	}
}

func TestDrawerSmallSurfaceNoRender(t *testing.T) {
	d := NewDrawerWidget(DrawerConfig{Width: 10})
	// Surface too small (4 wide, needs > 4)
	s := renderWidget(d, 0, 0, 4, 2)
	// Should not panic; cells remain zero-valued
	_ = s
}
