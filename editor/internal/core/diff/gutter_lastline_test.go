package diff

import (
	"strings"
	"testing"
)

func TestGutterUnchangedFileNoFalseAdded(t *testing.T) {
	headContent := "hello\nworld\n"
	oldLines := strings.Split(headContent, "\n")
	newLines := []string{"hello", "world", ""}

	changes := ComputeGutterChanges(oldLines, newLines)

	for i, c := range changes {
		if c != LineUnchanged {
			t.Errorf("line %d: expected unchanged, got %d", i, c)
		}
	}
}

func TestGutterNoTrailingNewlineInHead(t *testing.T) {
	headContent := "hello\nworld"
	oldLines := strings.Split(headContent, "\n")
	newLines := []string{"hello", "world", ""}

	changes := ComputeGutterChanges(oldLines, newLines)

	if changes[0] != LineUnchanged {
		t.Errorf("line 0: expected unchanged, got %d", changes[0])
	}
	if changes[1] != LineUnchanged {
		t.Errorf("line 1: expected unchanged, got %d", changes[1])
	}
	if changes[2] != LineAdded {
		t.Errorf("line 2: expected added (new trailing newline), got %d", changes[2])
	}
}
