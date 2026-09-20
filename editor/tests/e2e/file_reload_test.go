package e2e

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gdamore/tcell/v3"
)

// editorText returns the active buffer's contents joined by newlines.
func editorText(h *testHarness) string {
	return strings.Join(h.app.EditorGroup.Editor.Buf.Lines, "\n")
}

func TestExternalChangeReloadsCleanBuffer(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	path := filepath.Join(h.dir, "reload.txt")
	if err := os.WriteFile(path, []byte("original\n"), 0644); err != nil {
		t.Fatal(err)
	}
	h.app.EditorGroup.OpenFile(path)
	h.redraw()

	if !strings.Contains(editorText(h), "original") {
		t.Fatalf("expected editor to show original content, got %q", editorText(h))
	}

	modifyOnDisk(t, path, "updated externally\n")
	// Simulate the watcher firing for this path.
	h.app.HandleFileChanged(path)
	h.redraw()

	if !strings.Contains(editorText(h), "updated externally") {
		t.Errorf("expected clean buffer to auto-reload, got %q", editorText(h))
	}
}

func TestExternalChangeKeepsDirtyBuffer(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	path := filepath.Join(h.dir, "dirty.txt")
	if err := os.WriteFile(path, []byte("original\n"), 0644); err != nil {
		t.Fatal(err)
	}
	h.app.EditorGroup.OpenFile(path)
	h.app.Root.SetFocus(h.app.EditorGroup)
	h.redraw()

	// Make an unsaved edit so the buffer is dirty.
	h.pressRune('Z')
	if !h.app.EditorGroup.IsDirtyPath(path) {
		t.Fatalf("expected buffer to be dirty after typing")
	}
	dirtyBefore := editorText(h)

	modifyOnDisk(t, path, "updated externally\n")
	h.app.HandleFileChanged(path)
	h.redraw()

	// A dirty buffer must NOT be reloaded — the user's edits survive.
	if editorText(h) != dirtyBefore {
		t.Errorf("dirty buffer was overwritten by reload: %q", editorText(h))
	}
	if strings.Contains(editorText(h), "updated externally") {
		t.Errorf("dirty buffer should not have picked up disk content")
	}
}

func TestExternalChangeClampsCursor(t *testing.T) {
	h := newTestHarness(t, 80, 24)
	defer h.stop()

	path := filepath.Join(h.dir, "shrink.txt")
	if err := os.WriteFile(path, []byte("line1\nline2\nline3\nline4\n"), 0644); err != nil {
		t.Fatal(err)
	}
	h.app.EditorGroup.OpenFile(path)
	h.app.Root.SetFocus(h.app.EditorGroup)
	h.redraw()

	// Move the cursor down to a line that will not exist after the reload.
	for i := 0; i < 3; i++ {
		h.pressKey(tcell.KeyDown, tcell.ModNone)
	}

	modifyOnDisk(t, path, "only one line\n")
	h.app.HandleFileChanged(path)
	h.redraw()

	line, _ := h.app.EditorGroup.ActiveCursor()
	if line >= len(h.app.EditorGroup.Editor.Buf.Lines) {
		t.Errorf("cursor line %d out of bounds after reload (buffer has %d lines)",
			line, len(h.app.EditorGroup.Editor.Buf.Lines))
	}
}
