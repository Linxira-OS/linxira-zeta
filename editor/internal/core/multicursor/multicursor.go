package multicursor

import (
	"sort"

	"github.com/eugenioenko/ttt/internal/core/selection"
)

type CursorState struct {
	Line, Col int
	Sel       selection.Selection
}

type MultiCursor struct {
	Cursors []CursorState
	Primary int
	history []CursorState
}

func New(line, col int) *MultiCursor {
	return &MultiCursor{
		Cursors: []CursorState{{Line: line, Col: col}},
		Primary: 0,
	}
}

func (mc *MultiCursor) IsMulti() bool {
	return len(mc.Cursors) > 1
}

func (mc *MultiCursor) PrimaryCursor() CursorState {
	if mc.Primary >= 0 && mc.Primary < len(mc.Cursors) {
		return mc.Cursors[mc.Primary]
	}
	return CursorState{}
}

func (mc *MultiCursor) Add(line, col int) {
	for _, c := range mc.Cursors {
		if c.Line == line && c.Col == col {
			return
		}
	}
	cs := CursorState{Line: line, Col: col}
	mc.history = append(mc.history, cs)
	mc.Cursors = append(mc.Cursors, cs)
	mc.Sort()
}

func (mc *MultiCursor) AddWithSelection(line, col int, sel selection.Selection) {
	for _, c := range mc.Cursors {
		if c.Line == line && c.Col == col {
			return
		}
	}
	cs := CursorState{Line: line, Col: col, Sel: sel}
	mc.history = append(mc.history, cs)
	mc.Cursors = append(mc.Cursors, cs)
	mc.Sort()
}

func (mc *MultiCursor) RemoveLast() (CursorState, bool) {
	if len(mc.history) == 0 || len(mc.Cursors) <= 1 {
		return CursorState{}, false
	}
	last := mc.history[len(mc.history)-1]
	mc.history = mc.history[:len(mc.history)-1]
	for i, c := range mc.Cursors {
		if c.Line == last.Line && c.Col == last.Col {
			mc.Cursors = append(mc.Cursors[:i], mc.Cursors[i+1:]...)
			if mc.Primary >= len(mc.Cursors) {
				mc.Primary = len(mc.Cursors) - 1
			}
			return last, true
		}
	}
	return last, false
}

func (mc *MultiCursor) CollapseToSingle() {
	if len(mc.Cursors) == 0 {
		return
	}
	primary := mc.PrimaryCursor()
	primary.Sel.Clear()
	mc.Cursors = []CursorState{primary}
	mc.Primary = 0
	mc.history = nil
}

func (mc *MultiCursor) Sort() {
	if mc.Primary < 0 || mc.Primary >= len(mc.Cursors) {
		mc.Primary = 0
		return
	}
	p := mc.Cursors[mc.Primary]
	sort.SliceStable(mc.Cursors, func(i, j int) bool {
		a, b := mc.Cursors[i], mc.Cursors[j]
		if a.Line != b.Line {
			return a.Line < b.Line
		}
		return a.Col < b.Col
	})
	for i, c := range mc.Cursors {
		if c.Line == p.Line && c.Col == p.Col {
			mc.Primary = i
			break
		}
	}
}

func (mc *MultiCursor) NormalizePrimary() {
	c := &mc.Cursors[mc.Primary]
	if !c.Sel.Active {
		return
	}
	start, end := c.Sel.Range(c.Line, c.Col)
	c.Sel.Anchor = start
	c.Line = end.Line
	c.Col = end.Col
}

func (mc *MultiCursor) Deduplicate() {
	if len(mc.Cursors) <= 1 {
		return
	}
	mc.Sort()
	p := mc.Cursors[mc.Primary]
	unique := mc.Cursors[:1]
	for i := 1; i < len(mc.Cursors); i++ {
		prev := unique[len(unique)-1]
		if mc.Cursors[i].Line != prev.Line || mc.Cursors[i].Col != prev.Col {
			unique = append(unique, mc.Cursors[i])
		}
	}
	mc.Cursors = unique
	mc.Primary = 0
	for i, c := range mc.Cursors {
		if c.Line == p.Line && c.Col == p.Col {
			mc.Primary = i
			break
		}
	}
}
