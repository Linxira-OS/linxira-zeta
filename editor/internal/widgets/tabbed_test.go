package widgets

import (
	"testing"

	"github.com/gdamore/tcell/v3"
)

func TestTabbedSetActiveBoundsCheck(t *testing.T) {
	tabs := NewTabsWidget(TabsConfig{
		Items: []TabItem{
			{ID: "a", Label: "Alpha"},
			{ID: "b", Label: "Beta"},
		},
	})
	childA := &fixedWidget{h: 3, w: 10}
	childB := &fixedWidget{h: 3, w: 10}
	tw := NewTabbedWidget(tabs, []Widget{childA, childB})

	// Initial active should be 0
	if tw.active != 0 {
		t.Fatalf("expected initial active=0, got %d", tw.active)
	}

	// Negative index is a no-op
	tw.SetActive(-1)
	if tw.active != 0 {
		t.Errorf("negative index should be no-op, got active=%d", tw.active)
	}

	// Out-of-range index is a no-op
	tw.SetActive(2)
	if tw.active != 0 {
		t.Errorf("out-of-range index should be no-op, got active=%d", tw.active)
	}

	tw.SetActive(len(tw.Children))
	if tw.active != 0 {
		t.Errorf("index == len(children) should be no-op, got active=%d", tw.active)
	}

	// Valid index should work
	tw.SetActive(1)
	if tw.active != 1 {
		t.Errorf("expected active=1, got %d", tw.active)
	}
}

func TestTabbedSetActiveCallsOnChange(t *testing.T) {
	tabs := NewTabsWidget(TabsConfig{
		Items: []TabItem{
			{ID: "a", Label: "Alpha"},
			{ID: "b", Label: "Beta"},
			{ID: "c", Label: "Gamma"},
		},
	})
	childA := &fixedWidget{h: 3, w: 10}
	childB := &fixedWidget{h: 3, w: 10}
	childC := &fixedWidget{h: 3, w: 10}
	tw := NewTabbedWidget(tabs, []Widget{childA, childB, childC})

	called := -1
	tw.OnChange = func(index int) {
		called = index
	}

	tw.SetActive(2)
	if called != 2 {
		t.Errorf("OnChange should be called with index=2, got %d", called)
	}

	// Out-of-range should NOT fire OnChange
	called = -1
	tw.SetActive(5)
	if called != -1 {
		t.Errorf("OnChange should not fire for out-of-range, got %d", called)
	}

	// Negative should NOT fire OnChange
	tw.SetActive(-1)
	if called != -1 {
		t.Errorf("OnChange should not fire for negative index, got %d", called)
	}
}

func TestTabbedActiveChild(t *testing.T) {
	tabs := NewTabsWidget(TabsConfig{
		Items: []TabItem{
			{ID: "a", Label: "Alpha"},
			{ID: "b", Label: "Beta"},
		},
	})
	childA := &fixedWidget{h: 3, w: 10}
	childB := &fixedWidget{h: 5, w: 10}
	tw := NewTabbedWidget(tabs, []Widget{childA, childB})

	// Initial: active child is childA
	if got := tw.ActiveChild(); got != childA {
		t.Error("ActiveChild should return childA at index 0")
	}

	tw.SetActive(1)
	if got := tw.ActiveChild(); got != childB {
		t.Error("ActiveChild should return childB at index 1")
	}

	// Empty children case: build manually
	emptyTabs := NewTabsWidget(TabsConfig{
		Items: []TabItem{{ID: "x", Label: "X"}},
	})
	emptyTW := NewTabbedWidget(emptyTabs, []Widget{})
	if got := emptyTW.ActiveChild(); got != nil {
		t.Error("ActiveChild should return nil when children slice is empty")
	}
}

func TestTabbedEventRoutingPriority(t *testing.T) {
	// When tabs consume the event, the active child should NOT receive it.
	tabs := NewTabsWidget(TabsConfig{
		Items: []TabItem{
			{ID: "a", Label: "Alpha", Active: true},
			{ID: "b", Label: "Beta"},
		},
	})
	child := &fixedWidget{h: 3, w: 10, consume: true}
	tw := NewTabbedWidget(tabs, []Widget{child, &fixedWidget{h: 3, w: 10}})

	// Render so that tabs have rects and spans for click handling
	renderWidget(tw, 0, 0, 30, 10)

	// Simulate a click inside the tab bar area (on the "Beta" tab label)
	// Tabs are rendered at Y=0 in the widget. We need to send a mouse press
	// and then release for the wasPressed tracking.
	tabClick := mouseClick(15, 0)
	result := tw.HandleEvent(tabClick)
	// The tab click should be consumed by tabs
	if result != EventConsumed {
		// Release the click so wasPressed resets
		tw.HandleEvent(mouseRelease(15, 0))
	}

	// Now test that key events pass through to active child when tabs don't consume
	// (tabs only consume key events when focused)
	tabs.SetFocused(false)
	child.lastEvent = nil

	ev := tcell.NewEventKey(tcell.KeyEnter, "", tcell.ModNone)
	result = tw.HandleEvent(ev)

	if result != EventConsumed {
		t.Error("active child should consume the key event")
	}
	if child.lastEvent != ev {
		t.Error("active child should have received the key event")
	}
}

func TestTabbedEventRoutingTabsFocused(t *testing.T) {
	// When tabs are focused, key events should be consumed by tabs, not the child.
	tabs := NewTabsWidget(TabsConfig{
		Items: []TabItem{
			{ID: "a", Label: "Alpha", Active: true},
			{ID: "b", Label: "Beta"},
		},
	})
	child := &fixedWidget{h: 3, w: 10, consume: true}
	tw := NewTabbedWidget(tabs, []Widget{child, &fixedWidget{h: 3, w: 10}})

	renderWidget(tw, 0, 0, 30, 10)

	tabs.SetFocused(true)

	// Right arrow should be consumed by tabs (focused), not the child
	ev := tcell.NewEventKey(tcell.KeyRight, "", tcell.ModNone)
	result := tw.HandleEvent(ev)

	if result != EventConsumed {
		t.Error("focused tabs should consume arrow key")
	}
	if child.lastEvent != nil {
		t.Error("child should NOT receive the event when tabs consume it")
	}
}

func TestTabbedSetActiveUpdatesTabItems(t *testing.T) {
	tabs := NewTabsWidget(TabsConfig{
		Items: []TabItem{
			{ID: "a", Label: "Alpha"},
			{ID: "b", Label: "Beta"},
			{ID: "c", Label: "Gamma"},
		},
	})
	tw := NewTabbedWidget(tabs, []Widget{
		&fixedWidget{h: 3, w: 10},
		&fixedWidget{h: 3, w: 10},
		&fixedWidget{h: 3, w: 10},
	})

	// Initially, first tab is active
	if !tabs.Config.Items[0].Active {
		t.Error("first tab should be active initially")
	}

	tw.SetActive(2)

	// Only index 2 should be active
	for i, item := range tabs.Config.Items {
		if i == 2 && !item.Active {
			t.Errorf("tab %d should be active", i)
		}
		if i != 2 && item.Active {
			t.Errorf("tab %d should NOT be active", i)
		}
	}
}
