package widgets

import (
	"github.com/eugenioenko/ttt/internal/term"
	"github.com/gdamore/tcell/v3"
)

type LabelConfig struct {
	Text  string     `json:"text"`
	Badge string     `json:"badge,omitempty"`
	Style term.Style `json:"-"`
}

type LabelWidget struct {
	BaseWidget
	Config     LabelConfig
	FixedWidth int
}

func NewLabelWidget(config LabelConfig) *LabelWidget {
	return &LabelWidget{Config: config}
}

func (l *LabelWidget) Height() int { return 1 + l.BoxOverheadH() }
func (l *LabelWidget) Width() int {
	if l.FixedWidth > 0 {
		return l.FixedWidth
	}
	return 0
}

func (l *LabelWidget) Render(surface Surface) {
	inner := l.RenderBox(surface)
	w, _ := inner.Size()
	if w <= 0 {
		return
	}
	style := l.Config.Style
	if style == 0 {
		style = term.StyleDefault
	}
	maxTextW := w
	if l.Config.Badge != "" {
		badgeRunes := []rune(l.Config.Badge)
		bx := w - len(badgeRunes)
		if bx > 0 {
			maxTextW = bx - 1
			inner.DrawText(bx, 0, l.Config.Badge, w, term.StyleMuted)
		}
	}
	inner.DrawText(0, 0, l.Config.Text, maxTextW, style)
}

func (l *LabelWidget) HandleEvent(ev tcell.Event) EventResult {
	return EventIgnored
}
