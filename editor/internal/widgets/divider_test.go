package widgets

import "testing"

func TestDividerWidgetHeight(t *testing.T) {
	d := NewDividerWidget(DividerConfig{})

	if h := d.Height(); h != 1 {
		t.Errorf("expected Height() = 1 with no box model, got %d", h)
	}

	d.SetBoxModel(BoxModel{
		BorderTop:    true,
		BorderBottom: true,
		PaddingTop:   1,
		MarginBottom: 2,
	})
	// overhead = borderTop(1) + borderBottom(1) + paddingTop(1) + marginBottom(2) = 5
	want := 1 + 5
	if h := d.Height(); h != want {
		t.Errorf("expected Height() = %d with box overhead, got %d", want, h)
	}
}

func TestDividerWidgetWidth(t *testing.T) {
	d := NewDividerWidget(DividerConfig{})
	if w := d.Width(); w != 0 {
		t.Errorf("expected Width() = 0, got %d", w)
	}

	// Width should remain 0 even with box model set
	d.SetBoxModel(BoxModel{
		BorderLeft:  true,
		BorderRight: true,
		PaddingLeft: 2,
	})
	if w := d.Width(); w != 0 {
		t.Errorf("expected Width() = 0 with box model, got %d", w)
	}
}
