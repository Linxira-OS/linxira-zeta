package widgets

import (
	"testing"

	"github.com/gdamore/tcell/v3"
)

// The settings form nests focusable controls inside HStack rows inside a
// VStack inside a ScrollView; every container on that path must expose its
// children or the controls become keyboard-unreachable.
func TestNestedControlsAreKeyboardReachable(t *testing.T) {
	sel := NewSelectWidget(SelectConfig{
		Items:       []SelectItem{{ID: "a", Label: "A"}, {ID: "b", Label: "B"}},
		Collapsible: true,
	})
	cb := NewCheckboxWidget(CheckboxConfig{Label: "cb"})

	row1 := NewHStackWidget(NewLabelWidget(LabelConfig{Text: "Sel"}), sel)
	row1.FixedHeight = 1
	row2 := NewHStackWidget(NewLabelWidget(LabelConfig{Text: "Cb"}), cb)
	row2.FixedHeight = 1

	stack := NewVStackWidget(row1, row2)
	stack.MeasureGrow = true
	sv := NewScrollViewWidget(stack)

	fm := NewFocusManager()
	fm.Collect(sv)
	fm.SetActive(true)

	if len(fm.items) != 3 {
		t.Fatalf("expected scrollview + select + checkbox in the focus ring, got %d", len(fm.items))
	}

	fm.FocusNext()
	if !sel.IsFocused() {
		t.Error("select did not take focus")
	}
	fm.FocusNext()
	if !cb.IsFocused() {
		t.Error("checkbox did not take focus")
	}
	if sel.IsFocused() {
		t.Error("select kept focus after moving on")
	}
}

func TestSelectSetSelectedIDShowsCurrentValue(t *testing.T) {
	sel := NewSelectWidget(SelectConfig{
		Items:       []SelectItem{{ID: "a", Label: "Alpha"}, {ID: "b", Label: "Beta"}},
		Collapsible: true,
	})
	sel.SetSelectedID("b")

	if got := sel.selectedID(); got != "b" {
		t.Errorf("selectedID() = %q, want \"b\"", got)
	}
	if sel.input.Config.Placeholder != "Beta" {
		t.Errorf("placeholder = %q, want \"Beta\"", sel.input.Config.Placeholder)
	}
}

func TestCollapsedSelectOpensAndCloses(t *testing.T) {
	sel := NewSelectWidget(SelectConfig{
		Items:       []SelectItem{{ID: "a", Label: "Alpha"}, {ID: "b", Label: "Beta"}},
		Collapsible: true,
	})
	sel.SetFocused(true)

	if sel.HasPopup() {
		t.Error("a collapsed select should start closed")
	}

	// Down opens the list before it starts navigating.
	sel.HandleEvent(tcell.NewEventKey(tcell.KeyDown, "", tcell.ModNone))
	if !sel.HasPopup() {
		t.Fatal("Down should open the list")
	}
	if sel.selectedID() != "a" {
		t.Errorf("opening should not move the selection, got %q", sel.selectedID())
	}

	sel.HandleEvent(tcell.NewEventKey(tcell.KeyDown, "", tcell.ModNone))
	sel.HandleEvent(tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone))
	if sel.HasPopup() {
		t.Error("Enter should close the list")
	}
	if sel.selectedID() != "b" {
		t.Errorf("selectedID = %q, want \"b\"", sel.selectedID())
	}

	sel.HandleEvent(tcell.NewEventKey(tcell.KeyDown, "", tcell.ModNone))
	sel.HandleEvent(tcell.NewEventKey(tcell.KeyEscape, "", tcell.ModNone))
	if sel.HasPopup() {
		t.Error("Escape should close the list")
	}

	sel.HandleEvent(tcell.NewEventKey(tcell.KeyDown, "", tcell.ModNone))
	sel.SetFocused(false)
	if sel.HasPopup() {
		t.Error("losing focus should close the list")
	}
}

// Filtering narrows `filtered`, so the highlighted index means something
// different once the query is cleared on close. Without re-resolving it, the
// next Enter silently commits whatever now sits at that index.
func TestSelectKeepsValueAfterFilteringAndClosing(t *testing.T) {
	sel := NewSelectWidget(SelectConfig{
		Collapsible: true,
		Items: []SelectItem{
			{ID: "", Label: "Default"},
			{ID: "dark", Label: "dark"},
			{ID: "light", Label: "light"},
			{ID: "zenburn", Label: "zenburn"},
		},
	})
	sel.SetFocused(true)
	sel.SetSelectedID("")

	// Open, filter down to a single match, and pick it.
	sel.HandleEvent(tcell.NewEventKey(tcell.KeyDown, "", tcell.ModNone))
	for _, r := range "zen" {
		sel.HandleEvent(tcell.NewEventKey(tcell.KeyRune, string(r), tcell.ModNone))
	}
	sel.HandleEvent(tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone))

	if got := sel.selectedID(); got != "zenburn" {
		t.Fatalf("SelectedID after picking = %q, want \"zenburn\"", got)
	}

	// Reopening and confirming without typing must keep the same value.
	sel.HandleEvent(tcell.NewEventKey(tcell.KeyDown, "", tcell.ModNone))
	sel.HandleEvent(tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone))
	if got := sel.selectedID(); got != "zenburn" {
		t.Errorf("value reverted after reopen+confirm: %q, want \"zenburn\"", got)
	}
}

// A value written by hand into settings.json that is not in the item list must
// still be displayed rather than rendering blank.
func TestSelectShowsUnknownValue(t *testing.T) {
	sel := NewSelectWidget(SelectConfig{
		Collapsible: true,
		Items:       []SelectItem{{ID: "a", Label: "Alpha"}},
	})
	sel.SetSelectedID("handwritten")

	if sel.input.Config.Placeholder != "handwritten" {
		t.Errorf("placeholder = %q, want the raw value shown", sel.input.Config.Placeholder)
	}
}

// Only one dropdown may be open at a time; owners wire OnOpen to enforce it.
func TestOnOpenLetsOwnerCloseSiblings(t *testing.T) {
	items := []SelectItem{{ID: "a", Label: "Alpha"}, {ID: "b", Label: "Beta"}}
	var all []*SelectWidget
	for range 3 {
		var s *SelectWidget
		s = NewSelectWidget(SelectConfig{
			Items:       items,
			Collapsible: true,
			OnOpen: func() {
				for _, other := range all {
					if other != s {
						other.ClosePopup()
					}
				}
			},
		})
		all = append(all, s)
	}

	for _, s := range all {
		s.SetFocused(true)
	}

	all[0].HandleEvent(tcell.NewEventKey(tcell.KeyDown, "", tcell.ModNone))
	all[2].HandleEvent(tcell.NewEventKey(tcell.KeyDown, "", tcell.ModNone))

	open := 0
	for _, s := range all {
		if s.HasPopup() {
			open++
		}
	}
	if open != 1 {
		t.Errorf("%d dropdowns open, want exactly 1", open)
	}
	if !all[2].HasPopup() {
		t.Error("the most recently opened dropdown should be the open one")
	}
}

// A collapsed select near the bottom edge must open upward instead of
// rendering off screen.
func TestSelectPopupFlipsUpNearBottom(t *testing.T) {
	items := make([]SelectItem, 8)
	for i := range items {
		items[i] = SelectItem{ID: string(rune('a' + i)), Label: string(rune('a' + i))}
	}
	sel := NewSelectWidget(SelectConfig{Items: items, Collapsible: true})

	bounds := Rect{X: 0, Y: 0, W: 40, H: 20}
	sel.SetPopupBounds(bounds)

	sel.SetRect(Rect{X: 0, Y: 2, W: 20, H: 1})
	if got := sel.PopupRect(); got.Y != 3 {
		t.Errorf("popup near the top should open downward at y=3, got y=%d", got.Y)
	}

	sel.SetRect(Rect{X: 0, Y: 18, W: 20, H: 1})
	popup := sel.PopupRect()
	if popup.Y >= 18 {
		t.Errorf("popup near the bottom should open upward, got y=%d", popup.Y)
	}
	if popup.Y < bounds.Y {
		t.Errorf("popup escaped the top of its bounds: y=%d", popup.Y)
	}
}
