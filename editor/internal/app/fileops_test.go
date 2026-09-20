package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestContainingFolder(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "note.txt")
	if err := os.WriteFile(file, []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}

	if got := containingFolder(file); got != dir {
		t.Errorf("file: got %q, want %q", got, dir)
	}
	if got := containingFolder(dir); got != dir {
		t.Errorf("dir: got %q, want %q", got, dir)
	}

	// Non-existent path falls back to filepath.Dir.
	missing := filepath.Join(dir, "sub", "gone.txt")
	if got := containingFolder(missing); got != filepath.Dir(missing) {
		t.Errorf("missing: got %q, want %q", got, filepath.Dir(missing))
	}
}
