package widgets

import (
	"github.com/eugenioenko/ttt/internal/term"
	"github.com/gdamore/tcell/v3"
)

type DividerConfig struct {
	Style term.Style `json:"-"`
}

type DividerWidget struct {
	BaseWidget
	Config DividerConfig
}

func NewDividerWidget(config DividerConfig) *DividerWidget {
	return &DividerWidget{Config: config}
}

func (d *DividerWidget) Height() int { return 1 + d.BoxOverheadH() }
func (d *DividerWidget) Width() int  { return 0 }

func (d *DividerWidget) Render(surface Surface) {
	inner := d.RenderBox(surface)
	w, _ := inner.Size()
	if w <= 0 {
		return
	}

	ch := d.Box.Borders.Horizontal
	if ch == 0 {
		ch = '─' // '─'
	}

	style := d.Config.Style
	if style == 0 {
		style = term.StyleBorder
	}

	for x := 0; x < w; x++ {
		inner.SetCell(x, 0, term.Cell{Ch: ch, Style: style})
	}
}

func (d *DividerWidget) HandleEvent(ev tcell.Event) EventResult {
	return EventIgnored
}
