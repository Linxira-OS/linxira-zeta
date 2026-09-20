package widgets

import (
	"github.com/gdamore/tcell/v3"
)

type TabbedWidget struct {
	BaseWidget
	Tabs     *TabsWidget
	Children []Widget
	OnChange func(index int)
	// Fill propagates a flexible (zero) height from the active child, so an
	// enclosing stack treats this container as greedy rather than fixed.
	Fill   bool
	active int
}

func NewTabbedWidget(tabs *TabsWidget, children []Widget) *TabbedWidget {
	tw := &TabbedWidget{
		Tabs:     tabs,
		Children: children,
	}
	if len(tabs.Config.Items) > 0 {
		tabs.Config.Items[0].Active = true
	}
	tabs.Config.OnTabClick = func(index int) {
		tw.SetActive(index)
	}
	return tw
}

func (t *TabbedWidget) WidgetChildren() []Widget {
	var out []Widget
	if c := t.ActiveChild(); c != nil {
		out = append(out, c)
	}
	if t.Tabs != nil {
		out = append(out, t.Tabs)
	}
	return out
}

func (t *TabbedWidget) SetActive(index int) {
	if index < 0 || index >= len(t.Children) {
		return
	}
	t.active = index
	for i := range t.Tabs.Config.Items {
		t.Tabs.Config.Items[i].Active = i == index
	}
	if t.OnChange != nil {
		t.OnChange(index)
	}
}

func (t *TabbedWidget) Height() int {
	// Opt-in: existing callers want a concrete height, so only a Fill container
	// forwards its child's "grow to fit" request upward.
	if t.Fill && t.active < len(t.Children) && t.Children[t.active].Height() == 0 {
		return 0
	}
	h := t.Tabs.Height() + t.BoxOverheadH()
	if t.active < len(t.Children) {
		h += t.Children[t.active].Height()
	}
	return h
}

func (t *TabbedWidget) Width() int { return 0 }

func (t *TabbedWidget) Render(surface Surface) {
	inner := t.RenderBox(surface)
	w, h := inner.Size()
	if w <= 0 || h <= 0 {
		return
	}

	r := t.GetRect()
	ox := t.Box.MarginLeft + t.Box.PaddingLeft
	oy := t.Box.MarginTop + t.Box.PaddingTop
	if t.Box.BorderLeft {
		ox++
	}
	if t.Box.BorderTop {
		oy++
	}

	tabH := t.Tabs.Height()
	tabSurface := inner.Sub(Rect{X: 0, Y: 0, W: w, H: tabH})
	t.Tabs.SetRect(Rect{X: r.X + ox, Y: r.Y + oy, W: w, H: tabH})
	t.Tabs.Render(tabSurface)

	contentH := h - tabH
	if contentH <= 0 || t.active >= len(t.Children) {
		return
	}

	child := t.Children[t.active]
	contentSurface := inner.Sub(Rect{X: 0, Y: tabH, W: w, H: contentH})
	child.SetRect(Rect{
		X: r.X + ox,
		Y: r.Y + oy + tabH,
		W: w,
		H: contentH,
	})
	child.Render(contentSurface)
}

func (t *TabbedWidget) HandleEvent(ev tcell.Event) EventResult {
	if t.Tabs.HandleEvent(ev) == EventConsumed {
		return EventConsumed
	}
	if t.active < len(t.Children) {
		return t.Children[t.active].HandleEvent(ev)
	}
	return EventIgnored
}

func (t *TabbedWidget) ActiveChild() Widget {
	if t.active < len(t.Children) {
		return t.Children[t.active]
	}
	return nil
}
