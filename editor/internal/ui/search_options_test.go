package ui

import "testing"

func TestApplyReplacements(t *testing.T) {
	lines := []string{"hello world", "foo hello bar"}
	matches := []SearchMatch{
		{FilePath: "test.go", LineNum: 1, ColStart: 0, ColEnd: 5, LineText: "hello world"},
		{FilePath: "test.go", LineNum: 2, ColStart: 4, ColEnd: 9, LineText: "foo hello bar"},
	}
	result := ApplyReplacements(lines, matches, "hi", SearchOptions{})
	if result[0] != "hi world" {
		t.Errorf("expected 'hi world', got %q", result[0])
	}
	if result[1] != "foo hi bar" {
		t.Errorf("expected 'foo hi bar', got %q", result[1])
	}
}

func TestBuildReplaceDiff(t *testing.T) {
	lines := []string{"hello world", "foo bar"}
	matches := []SearchMatch{
		{FilePath: "test.go", LineNum: 1, ColStart: 0, ColEnd: 5, LineText: "hello world"},
	}
	fd := BuildReplaceDiff("test.go", lines, matches, "hi", SearchOptions{})
	if len(fd.Hunks) == 0 {
		t.Fatal("expected at least 1 hunk in replace diff")
	}
}
