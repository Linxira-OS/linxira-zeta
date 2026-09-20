package diff

import (
	"testing"
)

func TestComputeGutterChanges_Identical(t *testing.T) {
	lines := []string{"a", "b", "c"}
	got := ComputeGutterChanges(lines, lines)
	for i, k := range got {
		if k != LineUnchanged {
			t.Errorf("line %d: expected LineUnchanged, got %d", i, k)
		}
	}
}

func TestComputeGutterChanges_AddedLines(t *testing.T) {
	old := []string{"a", "c"}
	new := []string{"a", "b", "c"}
	got := ComputeGutterChanges(old, new)
	if len(got) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(got))
	}
	if got[0] != LineUnchanged {
		t.Errorf("line 0: expected Unchanged, got %d", got[0])
	}
	if got[1] != LineAdded {
		t.Errorf("line 1: expected Added, got %d", got[1])
	}
	if got[2] != LineUnchanged {
		t.Errorf("line 2: expected Unchanged, got %d", got[2])
	}
}

func TestComputeGutterChanges_DeletedLine(t *testing.T) {
	old := []string{"a", "b", "c"}
	new := []string{"a", "c"}
	got := ComputeGutterChanges(old, new)
	if len(got) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(got))
	}
	if got[0] != LineUnchanged {
		t.Errorf("line 0: expected Unchanged, got %d", got[0])
	}
	// Line "c" should be marked as having a deletion above it
	if got[1] != LineDeleted {
		t.Errorf("line 1: expected Deleted, got %d", got[1])
	}
}

func TestComputeGutterChanges_ModifiedLine(t *testing.T) {
	old := []string{"a", "b", "c"}
	new := []string{"a", "B", "c"}
	got := ComputeGutterChanges(old, new)
	if len(got) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(got))
	}
	if got[0] != LineUnchanged {
		t.Errorf("line 0: expected Unchanged, got %d", got[0])
	}
	if got[1] != LineModified {
		t.Errorf("line 1: expected Modified, got %d", got[1])
	}
	if got[2] != LineUnchanged {
		t.Errorf("line 2: expected Unchanged, got %d", got[2])
	}
}

func TestComputeGutterChanges_TrailingDeletion(t *testing.T) {
	old := []string{"a", "b", "c"}
	new := []string{"a"}
	got := ComputeGutterChanges(old, new)
	if len(got) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(got))
	}
	// Last line should show deletion indicator since "b" and "c" were removed after it
	if got[0] != LineDeleted {
		t.Errorf("line 0: expected Deleted, got %d", got[0])
	}
}

func TestComputeGutterChanges_NewFile(t *testing.T) {
	old := []string{}
	new := []string{"a", "b"}
	got := ComputeGutterChanges(old, new)
	if len(got) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(got))
	}
	for i, k := range got {
		if k != LineAdded {
			t.Errorf("line %d: expected Added, got %d", i, k)
		}
	}
}

func TestComputeGutterChanges_EmptyNew(t *testing.T) {
	old := []string{"a", "b"}
	got := ComputeGutterChanges(old, nil)
	if got != nil {
		t.Errorf("expected nil for empty newLines, got %v", got)
	}
}

func TestComputeGutterChanges_MixedChanges(t *testing.T) {
	old := []string{"a", "b", "c", "d", "e"}
	new := []string{"a", "B", "x", "e"}
	got := ComputeGutterChanges(old, new)
	if len(got) != 4 {
		t.Fatalf("expected 4 entries, got %d", len(got))
	}
	if got[0] != LineUnchanged {
		t.Errorf("line 0: expected Unchanged, got %d", got[0])
	}
	// "b" -> "B" is a modification
	if got[1] != LineModified {
		t.Errorf("line 1: expected Modified, got %d", got[1])
	}
	// "c","d" were replaced by "x" -- "c"->"x" is a modification, "d" was
	// deleted. The deletion indicator falls on the next context line ("e").
	if got[3] != LineDeleted {
		t.Errorf("line 3: expected Deleted (deletion above), got %d", got[3])
	}
}
