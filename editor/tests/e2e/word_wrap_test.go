package e2e

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gdamore/tcell/v3"
)

func TestWordWrapToggle(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	if h.app.Settings.Editor.WordWrap {
		t.Fatal("word wrap should be disabled by default")
	}

	h.exec("options.toggleWordWrap")

	if !h.app.Settings.Editor.WordWrap {
		t.Error("word wrap should be enabled after toggle")
	}
	if !h.app.EditorGroup.WordWrap {
		t.Error("editor group word wrap should be enabled after toggle")
	}
	if !h.app.EditorGroup.Editor.WordWrap {
		t.Error("editor pane word wrap should be enabled after toggle")
	}

	h.exec("options.toggleWordWrap")

	if h.app.Settings.Editor.WordWrap {
		t.Error("word wrap should be disabled after second toggle")
	}
	if h.app.EditorGroup.WordWrap {
		t.Error("editor group word wrap should be disabled after second toggle")
	}
	if h.app.EditorGroup.Editor.WordWrap {
		t.Error("editor pane word wrap should be disabled after second toggle")
	}
}

func TestWordWrapRendersLongLine(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	longLine := strings.Repeat("abcde", 20)
	path := filepath.Join(h.dir, "wrap.txt")
	os.WriteFile(path, []byte(longLine), 0644)

	h.app.EditorGroup.OpenFile(path)
	h.redraw()

	screenBefore := h.screenText()

	h.exec("options.toggleWordWrap")
	h.redraw()

	screenAfter := h.screenText()

	countBefore := strings.Count(screenBefore, "abcdeabcde")
	countAfter := strings.Count(screenAfter, "abcdeabcde")

	if countAfter <= countBefore {
		t.Errorf("wrapped screen should show more content: unwrapped has %d occurrences, wrapped has %d",
			countBefore, countAfter)
	}
}

func TestWordWrapLineNumbersOnlyOnFirstRow(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	longLine := strings.Repeat("x", 200)
	path := filepath.Join(h.dir, "wrapnum.txt")
	os.WriteFile(path, []byte(longLine+"\nsecondline"), 0644)

	h.app.EditorGroup.OpenFile(path)
	h.redraw()

	h.exec("options.toggleWordWrap")
	h.redraw()

	editor := h.app.EditorGroup.Editor
	r := editor.GetRect()
	gutterW := editor.GutterWidth()

	lineNumCount := 0
	for y := 0; y < r.H; y++ {
		screenY := r.Y + y
		row := h.screenRow(screenY)
		if r.X+gutterW > len([]rune(row)) {
			continue
		}
		runes := []rune(row)
		gutter := string(runes[r.X : r.X+gutterW])
		trimmed := strings.TrimSpace(gutter)
		if trimmed != "" && len(trimmed) > 0 && trimmed[0] >= '1' && trimmed[0] <= '9' {
			lineNumCount++
		}
	}

	bufLines := len(editor.Buf.Lines)
	if lineNumCount != bufLines {
		t.Errorf("expected %d line numbers (one per buffer line), got %d", bufLines, lineNumCount)
	}

	totalEditorRows := r.H
	if lineNumCount >= totalEditorRows {
		t.Error("line numbers should appear on fewer rows than total editor rows (proving some rows are continuation)")
	}
}

func TestWordWrapCursorPosition(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	longLine := strings.Repeat("abcde", 20)
	path := filepath.Join(h.dir, "wrapcur.txt")
	os.WriteFile(path, []byte(longLine), 0644)

	h.app.EditorGroup.OpenFile(path)
	h.redraw()

	h.exec("options.toggleWordWrap")
	h.redraw()

	editor := h.app.EditorGroup.Editor
	editor.Cursor.Col = 0
	h.redraw()

	startY := editor.CursorY

	editorW := editor.Viewport.Width
	moveCount := editorW + 5
	for i := 0; i < moveCount; i++ {
		h.pressKey(tcell.KeyRight, 0)
	}
	h.redraw()

	if editor.Cursor.Col != moveCount {
		t.Errorf("expected cursor col %d, got %d", moveCount, editor.Cursor.Col)
	}

	if editor.CursorY <= startY {
		t.Errorf("cursor should have moved to a wrapped row, startY=%d, curY=%d", startY, editor.CursorY)
	}
}

func TestWordWrapDisablesHorizontalScroll(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	longLine := strings.Repeat("x", 200)
	path := filepath.Join(h.dir, "nohscroll.txt")
	os.WriteFile(path, []byte(longLine), 0644)

	h.app.EditorGroup.OpenFile(path)
	h.redraw()

	h.exec("options.toggleWordWrap")
	h.redraw()

	editor := h.app.EditorGroup.Editor
	if editor.Viewport.LeftCol != 0 {
		t.Errorf("expected LeftCol=0 with word wrap, got %d", editor.Viewport.LeftCol)
	}
}
