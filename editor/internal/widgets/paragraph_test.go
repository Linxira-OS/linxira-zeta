package widgets

import (
	"testing"

	"github.com/eugenioenko/ttt/internal/term"
	"github.com/gdamore/tcell/v3"
)

func TestParagraphHeight(t *testing.T) {
	p := NewParagraphWidget("line one\nactually one long line that wraps")
	// Before render, lastWidth is 0 so Height returns 0
	if h := p.Height(); h != 0 {
		t.Fatalf("expected height 0 before render, got %d", h)
	}

	// After render with width 40, text fits in 1 line (no newline splitting — wrapText wraps by width)
	renderWidget(p, 0, 0, 40, 10)
	h := p.Height()
	if h <= 0 {
		t.Fatalf("expected positive height after render, got %d", h)
	}
}

func TestParagraphHeightForWidth(t *testing.T) {
	p := NewParagraphWidget("hello world")
	// Width 6: "hello" fits with word break at space => ["hello", "world"] = 2 lines
	if h := p.HeightForWidth(6); h != 2 {
		t.Fatalf("expected HeightForWidth(6)=2 for 'hello world', got %d", h)
	}
	// Width 20: fits in 1 line
	if h := p.HeightForWidth(20); h != 1 {
		t.Fatalf("expected HeightForWidth(20)=1 for 'hello world', got %d", h)
	}
}

func TestParagraphWidthReturnsZero(t *testing.T) {
	p := NewParagraphWidget("any text")
	if w := p.Width(); w != 0 {
		t.Fatalf("expected Width()=0 (grow), got %d", w)
	}
}

func TestParagraphSingleLineRender(t *testing.T) {
	p := NewParagraphWidget("Hello")
	s := renderWidget(p, 0, 0, 20, 5)

	// Verify "Hello" appears in row 0
	for i, ch := range []rune("Hello") {
		if s.cells[0][i].Ch != ch {
			t.Errorf("cell[0][%d]: expected %c, got %c", i, ch, s.cells[0][i].Ch)
		}
	}
}

func TestParagraphMultiLineRender(t *testing.T) {
	// With width 6, "hello world" wraps at space => ["hello", "world"]
	p := NewParagraphWidget("hello world")
	s := renderWidget(p, 0, 0, 6, 5)

	// Row 0: "hello"
	for i, ch := range []rune("hello") {
		if s.cells[0][i].Ch != ch {
			t.Errorf("row 0 cell[%d]: expected %c, got %c", i, ch, s.cells[0][i].Ch)
		}
	}
	// Row 1: "world"
	for i, ch := range []rune("world") {
		if s.cells[1][i].Ch != ch {
			t.Errorf("row 1 cell[%d]: expected %c, got %c", i, ch, s.cells[1][i].Ch)
		}
	}
}

func TestParagraphEmptyText(t *testing.T) {
	p := NewParagraphWidget("")
	// HeightForWidth returns 1 for empty text (wrapText returns [""])
	if h := p.HeightForWidth(10); h != 1 {
		t.Fatalf("expected HeightForWidth(10)=1 for empty text, got %d", h)
	}
	// Should not crash on render
	renderWidget(p, 0, 0, 10, 5)
}

func TestParagraphHandleEventIgnored(t *testing.T) {
	p := NewParagraphWidget("test")
	ev := tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone)
	if r := p.HandleEvent(ev); r != EventIgnored {
		t.Fatalf("expected EventIgnored, got %d", r)
	}
}

func TestParagraphUsesStyle(t *testing.T) {
	p := NewParagraphWidget("Hi")
	p.Style = term.StyleScrollbar // arbitrary non-default style
	s := renderWidget(p, 0, 0, 10, 5)

	if s.cells[0][0].Style != term.StyleScrollbar {
		t.Errorf("expected style %d, got %d", term.StyleScrollbar, s.cells[0][0].Style)
	}
}

func TestParagraphDefaultStyle(t *testing.T) {
	p := NewParagraphWidget("Hi")
	// Style field is 0 (unset) => should use StyleDefault
	s := renderWidget(p, 0, 0, 10, 5)

	if s.cells[0][0].Style != term.StyleDefault {
		t.Errorf("expected StyleDefault (%d), got %d", term.StyleDefault, s.cells[0][0].Style)
	}
}
