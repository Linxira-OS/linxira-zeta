package e2e

import (
	"testing"
)

func TestNewFileCreatesSecondTab(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	// Start with default untitled tab, type something
	h.exec("file.new")
	h.pressRune('x')

	if !h.app.EditorGroup.IsActiveVirtual() {
		t.Fatal("expected virtual tab")
	}
	firstPath := h.app.EditorGroup.ActiveFilePath()

	// New file should create a second tab, not reuse the one with content
	h.exec("file.new")
	secondPath := h.app.EditorGroup.ActiveFilePath()

	if !h.app.EditorGroup.IsActiveVirtual() {
		t.Fatal("expected virtual tab")
	}
	if firstPath == secondPath {
		t.Fatalf("new file reused existing tab %q instead of creating a new one", firstPath)
	}

	// New buffer should be empty
	buf := h.app.EditorGroup.ActiveBuffer()
	if buf == nil {
		t.Fatal("expected active buffer")
	}
	if len(buf.Lines) != 1 || buf.Lines[0] != "" {
		t.Errorf("expected empty buffer, got %v", buf.Lines)
	}
}

func TestNewFileOnEmptyUntitledStillCreates(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	// Even on an empty untitled buffer, new file creates another tab
	first := h.app.EditorGroup.ActiveFilePath()
	h.exec("file.new")
	second := h.app.EditorGroup.ActiveFilePath()

	if first == second {
		t.Fatal("expected new file to create a distinct tab even when current is empty")
	}
}
