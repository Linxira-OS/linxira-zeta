package widgets

import (
	"testing"

	"github.com/eugenioenko/ttt/internal/term"
	"github.com/gdamore/tcell/v3"
)

func TestProgressRenderZero(t *testing.T) {
	p := NewProgressWidget(ProgressConfig{Value: 0})
	s := renderWidget(p, 0, 0, 20, 1)

	// All cells should be unfilled ('░' with StyleMuted)
	for x := 0; x < 20; x++ {
		if s.cells[0][x].Ch != '░' {
			t.Errorf("x=%d: expected '░', got '%c'", x, s.cells[0][x].Ch)
		}
		if s.cells[0][x].Style != term.StyleMuted {
			t.Errorf("x=%d: expected StyleMuted, got %v", x, s.cells[0][x].Style)
		}
	}
}

func TestProgressRenderFull(t *testing.T) {
	p := NewProgressWidget(ProgressConfig{Value: 1.0})
	s := renderWidget(p, 0, 0, 20, 1)

	// All cells should be filled ('▄' with StyleSuccess)
	for x := 0; x < 20; x++ {
		if s.cells[0][x].Ch != '▄' {
			t.Errorf("x=%d: expected '▄', got '%c'", x, s.cells[0][x].Ch)
		}
		if s.cells[0][x].Style != term.StyleSuccess {
			t.Errorf("x=%d: expected StyleSuccess, got %v", x, s.cells[0][x].Style)
		}
	}
}

func TestProgressRenderHalf(t *testing.T) {
	p := NewProgressWidget(ProgressConfig{Value: 0.5})
	w := 20
	s := renderWidget(p, 0, 0, w, 1)

	filled := int(0.5 * float64(w)) // 10
	for x := 0; x < filled; x++ {
		if s.cells[0][x].Ch != '▄' {
			t.Errorf("filled x=%d: expected '▄', got '%c'", x, s.cells[0][x].Ch)
		}
		if s.cells[0][x].Style != term.StyleSuccess {
			t.Errorf("filled x=%d: expected StyleSuccess, got %v", x, s.cells[0][x].Style)
		}
	}
	for x := filled; x < w; x++ {
		if s.cells[0][x].Ch != '░' {
			t.Errorf("unfilled x=%d: expected '░', got '%c'", x, s.cells[0][x].Ch)
		}
		if s.cells[0][x].Style != term.StyleMuted {
			t.Errorf("unfilled x=%d: expected StyleMuted, got %v", x, s.cells[0][x].Style)
		}
	}
}

func TestProgressDefaultChar(t *testing.T) {
	p := NewProgressWidget(ProgressConfig{Value: 1.0})
	s := renderWidget(p, 0, 0, 10, 1)

	if s.cells[0][0].Ch != '▄' {
		t.Errorf("default char should be '▄', got '%c'", s.cells[0][0].Ch)
	}
}

func TestProgressCustomChar(t *testing.T) {
	p := NewProgressWidget(ProgressConfig{Value: 1.0, Char: '#'})
	s := renderWidget(p, 0, 0, 10, 1)

	for x := 0; x < 10; x++ {
		if s.cells[0][x].Ch != '#' {
			t.Errorf("x=%d: expected '#', got '%c'", x, s.cells[0][x].Ch)
		}
	}
}

func TestProgressDefaultStyleIsSuccess(t *testing.T) {
	p := NewProgressWidget(ProgressConfig{Value: 1.0})
	s := renderWidget(p, 0, 0, 10, 1)

	if s.cells[0][0].Style != term.StyleSuccess {
		t.Errorf("default style should be StyleSuccess, got %v", s.cells[0][0].Style)
	}
}

func TestProgressCustomStyle(t *testing.T) {
	p := NewProgressWidget(ProgressConfig{Value: 1.0, Style: term.StyleDanger})
	s := renderWidget(p, 0, 0, 10, 1)

	if s.cells[0][0].Style != term.StyleDanger {
		t.Errorf("custom style should be StyleDanger, got %v", s.cells[0][0].Style)
	}
}

func TestProgressClampNegative(t *testing.T) {
	p := NewProgressWidget(ProgressConfig{Value: -0.5})
	s := renderWidget(p, 0, 0, 10, 1)

	// All unfilled
	for x := 0; x < 10; x++ {
		if s.cells[0][x].Ch != '░' {
			t.Errorf("x=%d: negative value should clamp to 0, expected '░', got '%c'", x, s.cells[0][x].Ch)
		}
	}
}

func TestProgressClampAboveOne(t *testing.T) {
	p := NewProgressWidget(ProgressConfig{Value: 2.5})
	s := renderWidget(p, 0, 0, 10, 1)

	// All filled
	for x := 0; x < 10; x++ {
		if s.cells[0][x].Ch != '▄' {
			t.Errorf("x=%d: value > 1 should clamp to 1, expected '▄', got '%c'", x, s.cells[0][x].Ch)
		}
	}
}

func TestProgressHeight(t *testing.T) {
	p := NewProgressWidget(ProgressConfig{Value: 0.5})
	if p.Height() != 1 {
		t.Errorf("default height should be 1, got %d", p.Height())
	}
}

func TestProgressHeightWithBoxModel(t *testing.T) {
	p := NewProgressWidget(ProgressConfig{Value: 0.5})
	p.Box.MarginTop = 1
	p.Box.MarginBottom = 1
	p.Box.PaddingTop = 2
	p.Box.PaddingBottom = 2

	// Height = 1 + BoxOverheadH = 1 + (1+1+2+2) = 7
	expected := 1 + p.BoxOverheadH()
	if p.Height() != expected {
		t.Errorf("height with box model should be %d, got %d", expected, p.Height())
	}
}

func TestProgressWidthIsZero(t *testing.T) {
	p := NewProgressWidget(ProgressConfig{Value: 0.5})
	if p.Width() != 0 {
		t.Errorf("width should be 0 (fills parent), got %d", p.Width())
	}
}

func TestProgressHandleEventIgnored(t *testing.T) {
	p := NewProgressWidget(ProgressConfig{Value: 0.5})
	ev := tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone)
	if p.HandleEvent(ev) != EventIgnored {
		t.Error("progress widget should ignore all events")
	}
}

func TestProgressUnfilledStyleMuted(t *testing.T) {
	p := NewProgressWidget(ProgressConfig{Value: 0.0})
	s := renderWidget(p, 0, 0, 5, 1)

	for x := 0; x < 5; x++ {
		if s.cells[0][x].Style != term.StyleMuted {
			t.Errorf("x=%d: unfilled portion should use StyleMuted, got %v", x, s.cells[0][x].Style)
		}
		if s.cells[0][x].Ch != '░' {
			t.Errorf("x=%d: unfilled portion should use '░', got '%c'", x, s.cells[0][x].Ch)
		}
	}
}

func TestProgressRenderWithBoxModel(t *testing.T) {
	p := NewProgressWidget(ProgressConfig{Value: 1.0})
	p.Box.MarginLeft = 2
	p.Box.MarginRight = 2

	s := renderWidget(p, 0, 0, 14, 1)

	// Inner width = 14 - 2 - 2 = 10
	// Cells at margin positions should be empty (zero rune)
	if s.cells[0][0].Ch == '▄' {
		t.Error("margin area should not have filled char")
	}
	// Cells inside inner area (offset by margin) should be filled
	if s.cells[0][2].Ch != '▄' {
		t.Errorf("inner area should be filled, got '%c'", s.cells[0][2].Ch)
	}
}

func TestProgressZeroWidth(t *testing.T) {
	// Should not panic when rendered with zero-width surface
	p := NewProgressWidget(ProgressConfig{Value: 0.5})
	renderWidget(p, 0, 0, 0, 1)
}
