package widgets

import (
	"github.com/eugenioenko/ttt/internal/term"
	"github.com/gdamore/tcell/v3"
)

type ProgressConfig struct {
	Value float64
	Style term.Style
	Char  rune
}

type ProgressWidget struct {
	BaseWidget
	Config ProgressConfig
}

func NewProgressWidget(config ProgressConfig) *ProgressWidget {
	return &ProgressWidget{Config: config}
}

func (p *ProgressWidget) Height() int { return 1 + p.BoxOverheadH() }
func (p *ProgressWidget) Width() int  { return 0 }

func (p *ProgressWidget) Render(surface Surface) {
	inner := p.RenderBox(surface)
	w, _ := inner.Size()
	if w <= 0 {
		return
	}

	style := p.Config.Style
	if style == 0 {
		style = term.StyleSuccess
	}

	value := p.Config.Value
	if value < 0 {
		value = 0
	} else if value > 1 {
		value = 1
	}

	ch := p.Config.Char
	if ch == 0 {
		ch = '▄'
	}

	filled := int(value * float64(w))
	for x := 0; x < filled; x++ {
		inner.SetCell(x, 0, term.Cell{Ch: ch, Style: style})
	}
	for x := filled; x < w; x++ {
		inner.SetCell(x, 0, term.Cell{Ch: '░', Style: term.StyleMuted})
	}
}

func (p *ProgressWidget) HandleEvent(ev tcell.Event) EventResult {
	return EventIgnored
}
