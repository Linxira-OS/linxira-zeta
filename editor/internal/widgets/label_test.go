package widgets

import (
	"testing"

	"github.com/eugenioenko/ttt/internal/term"
)

func TestLabelWidgetHeight(t *testing.T) {
	lbl := NewLabelWidget(LabelConfig{Text: "Hello"})
	if lbl.Height() != 1 {
		t.Errorf("expected height 1, got %d", lbl.Height())
	}

	lbl.SetBoxModel(BoxModel{
		BorderTop:    true,
		BorderBottom: true,
		PaddingTop:   1,
	})
	// overhead: borderTop(1) + borderBottom(1) + paddingTop(1) = 3
	expected := 1 + 3
	if lbl.Height() != expected {
		t.Errorf("expected height %d with box model, got %d", expected, lbl.Height())
	}
}

func TestLabelWidgetWidth(t *testing.T) {
	lbl := NewLabelWidget(LabelConfig{Text: "Hello"})
	if lbl.Width() != 0 {
		t.Errorf("expected width 0 (grow to fill), got %d", lbl.Width())
	}
}

func TestLabelWidgetConstructor(t *testing.T) {
	cfg := LabelConfig{Text: "Status: OK", Style: term.StyleDefault}
	lbl := NewLabelWidget(cfg)

	if lbl.Config.Text != "Status: OK" {
		t.Errorf("expected text %q, got %q", "Status: OK", lbl.Config.Text)
	}
	if lbl.Config.Style != term.StyleDefault {
		t.Errorf("expected style %v, got %v", term.StyleDefault, lbl.Config.Style)
	}
}
