package widgets

import (
	"testing"

	"github.com/eugenioenko/ttt/internal/term"
)

func TestBuildLabel(t *testing.T) {
	data := []byte(`{"type":"label","text":"Hello World"}`)
	w, err := BuildFromJSON(data, BuildContext{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	lbl, ok := w.(*LabelWidget)
	if !ok {
		t.Fatalf("expected *LabelWidget, got %T", w)
	}
	if lbl.Config.Text != "Hello World" {
		t.Errorf("expected text='Hello World', got %q", lbl.Config.Text)
	}
}

func TestBuildButton(t *testing.T) {
	data := []byte(`{"type":"button","label":"OK","command":"confirm"}`)
	w, err := BuildFromJSON(data, BuildContext{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	btn, ok := w.(*ButtonWidget)
	if !ok {
		t.Fatalf("expected *ButtonWidget, got %T", w)
	}
	if btn.Config.Label != "OK" {
		t.Errorf("expected label='OK', got %q", btn.Config.Label)
	}
	if btn.Config.Command != "confirm" {
		t.Errorf("expected command='confirm', got %q", btn.Config.Command)
	}
}

func TestBuildVStack(t *testing.T) {
	data := []byte(`{
		"type":"vstack",
		"gap":2,
		"children":[
			{"type":"label","text":"A"},
			{"type":"label","text":"B"}
		]
	}`)
	w, err := BuildFromJSON(data, BuildContext{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	vs, ok := w.(*VStackWidget)
	if !ok {
		t.Fatalf("expected *VStackWidget, got %T", w)
	}
	if len(vs.Children) != 2 {
		t.Fatalf("expected 2 children, got %d", len(vs.Children))
	}
	if vs.Gap != 2 {
		t.Errorf("expected gap=2, got %d", vs.Gap)
	}
}

func TestBuildUnknownType(t *testing.T) {
	data := []byte(`{"type":"nonexistent"}`)
	_, err := BuildFromJSON(data, BuildContext{})
	if err == nil {
		t.Fatal("expected error for unknown widget type")
	}
}

func TestBuildNestedVStackWithLabels(t *testing.T) {
	data := []byte(`{
		"type":"vstack",
		"children":[
			{"type":"label","text":"First"},
			{"type":"vstack","children":[
				{"type":"label","text":"Nested"}
			]}
		]
	}`)
	w, err := BuildFromJSON(data, BuildContext{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	vs, ok := w.(*VStackWidget)
	if !ok {
		t.Fatalf("expected *VStackWidget, got %T", w)
	}
	if len(vs.Children) != 2 {
		t.Fatalf("expected 2 children, got %d", len(vs.Children))
	}

	// First child is a label
	lbl, ok := vs.Children[0].(*LabelWidget)
	if !ok {
		t.Fatalf("expected first child to be *LabelWidget, got %T", vs.Children[0])
	}
	if lbl.Config.Text != "First" {
		t.Errorf("expected first label text='First', got %q", lbl.Config.Text)
	}

	// Second child is a nested VStack
	inner, ok := vs.Children[1].(*VStackWidget)
	if !ok {
		t.Fatalf("expected second child to be *VStackWidget, got %T", vs.Children[1])
	}
	if len(inner.Children) != 1 {
		t.Fatalf("expected 1 nested child, got %d", len(inner.Children))
	}
	nestedLbl, ok := inner.Children[0].(*LabelWidget)
	if !ok {
		t.Fatalf("expected nested child to be *LabelWidget, got %T", inner.Children[0])
	}
	if nestedLbl.Config.Text != "Nested" {
		t.Errorf("expected nested label text='Nested', got %q", nestedLbl.Config.Text)
	}
}

func TestBuildInvalidJSON(t *testing.T) {
	data := []byte(`{invalid json}`)
	_, err := BuildFromJSON(data, BuildContext{})
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestBuildInput(t *testing.T) {
	data := []byte(`{"type":"input","prefix":"> ","placeholder":"Type here","bordered":false}`)
	w, err := BuildFromJSON(data, BuildContext{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	inp, ok := w.(*InputWidget)
	if !ok {
		t.Fatalf("expected *InputWidget, got %T", w)
	}
	if inp.Config.Prefix != "> " {
		t.Errorf("expected prefix='> ', got %q", inp.Config.Prefix)
	}
	if inp.Config.Placeholder != "Type here" {
		t.Errorf("expected placeholder='Type here', got %q", inp.Config.Placeholder)
	}
	if inp.Config.Bordered {
		t.Error("expected bordered=false")
	}
}

func TestBuildBoxModel(t *testing.T) {
	data := []byte(`{
		"type":"label",
		"text":"padded",
		"paddingTop":2,
		"paddingLeft":3,
		"marginBottom":1,
		"borderTop":true
	}`)
	borders := term.BorderSet{Horizontal: '-', Vertical: '|'}
	w, err := BuildFromJSON(data, BuildContext{Borders: borders})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	lbl, ok := w.(*LabelWidget)
	if !ok {
		t.Fatalf("expected *LabelWidget, got %T", w)
	}
	if lbl.Box.PaddingTop != 2 {
		t.Errorf("expected PaddingTop=2, got %d", lbl.Box.PaddingTop)
	}
	if lbl.Box.PaddingLeft != 3 {
		t.Errorf("expected PaddingLeft=3, got %d", lbl.Box.PaddingLeft)
	}
	if lbl.Box.MarginBottom != 1 {
		t.Errorf("expected MarginBottom=1, got %d", lbl.Box.MarginBottom)
	}
	if !lbl.Box.BorderTop {
		t.Error("expected BorderTop=true")
	}
	if lbl.Box.Borders.Horizontal != '-' {
		t.Errorf("expected Borders from context, got %+v", lbl.Box.Borders)
	}
}

func TestBuildHStack(t *testing.T) {
	data := []byte(`{
		"type":"hstack",
		"gap":4,
		"align":"center",
		"children":[
			{"type":"button","label":"A"},
			{"type":"button","label":"B"}
		]
	}`)
	w, err := BuildFromJSON(data, BuildContext{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	hs, ok := w.(*HStackWidget)
	if !ok {
		t.Fatalf("expected *HStackWidget, got %T", w)
	}
	if len(hs.Children) != 2 {
		t.Fatalf("expected 2 children, got %d", len(hs.Children))
	}
	if hs.Gap != 4 {
		t.Errorf("expected gap=4, got %d", hs.Gap)
	}
	if hs.Align != "center" {
		t.Errorf("expected align='center', got %q", hs.Align)
	}
}
