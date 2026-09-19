package multicursor

import (
	"testing"

	"github.com/eugenioenko/ttt/internal/core/selection"
)

func TestNewMultiCursor(t *testing.T) {
	mc := New(5, 10)
	if len(mc.Cursors) != 1 {
		t.Fatalf("expected 1 cursor, got %d", len(mc.Cursors))
	}
	if mc.Cursors[0].Line != 5 || mc.Cursors[0].Col != 10 {
		t.Errorf("expected (5,10), got (%d,%d)", mc.Cursors[0].Line, mc.Cursors[0].Col)
	}
	if mc.IsMulti() {
		t.Error("single cursor should not be multi")
	}
}

func TestAddAndSort(t *testing.T) {
	mc := New(5, 10)
	mc.Add(2, 3)
	mc.Add(5, 5)
	if len(mc.Cursors) != 3 {
		t.Fatalf("expected 3 cursors, got %d", len(mc.Cursors))
	}
	if !mc.IsMulti() {
		t.Error("should be multi with 3 cursors")
	}
	if mc.Cursors[0].Line != 2 || mc.Cursors[0].Col != 3 {
		t.Errorf("first cursor should be (2,3), got (%d,%d)", mc.Cursors[0].Line, mc.Cursors[0].Col)
	}
	if mc.Cursors[1].Line != 5 || mc.Cursors[1].Col != 5 {
		t.Errorf("second cursor should be (5,5), got (%d,%d)", mc.Cursors[1].Line, mc.Cursors[1].Col)
	}
	if mc.Cursors[2].Line != 5 || mc.Cursors[2].Col != 10 {
		t.Errorf("third cursor should be (5,10), got (%d,%d)", mc.Cursors[2].Line, mc.Cursors[2].Col)
	}
	p := mc.PrimaryCursor()
	if p.Line != 5 || p.Col != 10 {
		t.Errorf("primary should remain (5,10), got (%d,%d)", p.Line, p.Col)
	}
}

func TestAddDuplicate(t *testing.T) {
	mc := New(1, 1)
	mc.Add(1, 1)
	if len(mc.Cursors) != 1 {
		t.Errorf("duplicate should not be added, got %d cursors", len(mc.Cursors))
	}
}

func TestRemoveLast(t *testing.T) {
	mc := New(1, 0)
	mc.Add(3, 0)
	mc.Add(5, 0)
	removed, ok := mc.RemoveLast()
	if !ok {
		t.Fatal("RemoveLast should succeed")
	}
	if removed.Line != 5 {
		t.Errorf("expected removed line 5, got %d", removed.Line)
	}
	if len(mc.Cursors) != 2 {
		t.Errorf("expected 2 cursors, got %d", len(mc.Cursors))
	}
	removed, ok = mc.RemoveLast()
	if !ok || removed.Line != 3 {
		t.Errorf("expected removed line 3, got line %d ok=%v", removed.Line, ok)
	}
	_, ok = mc.RemoveLast()
	if ok {
		t.Error("should not remove last remaining cursor")
	}
}

func TestCollapseToSingle(t *testing.T) {
	mc := New(1, 0)
	mc.Add(3, 5)
	mc.Add(7, 2)
	mc.CollapseToSingle()
	if len(mc.Cursors) != 1 {
		t.Fatalf("expected 1 cursor, got %d", len(mc.Cursors))
	}
	if mc.IsMulti() {
		t.Error("should not be multi after collapse")
	}
}

func TestDeduplicate(t *testing.T) {
	mc := New(1, 0)
	mc.Cursors = append(mc.Cursors, CursorState{Line: 1, Col: 0})
	mc.Cursors = append(mc.Cursors, CursorState{Line: 2, Col: 0})
	mc.Deduplicate()
	if len(mc.Cursors) != 2 {
		t.Errorf("expected 2 cursors after dedup, got %d", len(mc.Cursors))
	}
}

func TestAddWithSelection(t *testing.T) {
	mc := New(0, 0)
	sel := selection.Selection{Active: true, Anchor: selection.Position{Line: 1, Col: 0}}
	mc.AddWithSelection(1, 5, sel)
	if len(mc.Cursors) != 2 {
		t.Fatalf("expected 2 cursors, got %d", len(mc.Cursors))
	}
	if !mc.Cursors[1].Sel.Active {
		t.Error("second cursor should have active selection")
	}
}
