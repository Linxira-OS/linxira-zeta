package ui

import "github.com/gdamore/tcell/v3"

type BaseWidget struct {
	rect Rect
}

func (b *BaseWidget) Height() int                            { return 0 }
func (b *BaseWidget) Width() int                             { return 0 }
func (b *BaseWidget) SetRect(r Rect)                         { b.rect = r }
func (b *BaseWidget) GetRect() Rect                          { return b.rect }
func (b *BaseWidget) HandleEvent(ev tcell.Event) EventResult { return EventIgnored }
func (b *BaseWidget) Render(surface Surface)                 {}
func (b *BaseWidget) SetBoxModel(bm BoxModel)                {}
