package fold

import (
	"testing"
)

func TestIndentRanges_Function(t *testing.T) {
	lines := []string{
		"func main() {",
		"    fmt.Println()",
		"    return",
		"}",
	}
	ranges := ComputeIndentRanges(lines)
	if len(ranges) != 1 {
		t.Fatalf("expected 1 range, got %d: %v", len(ranges), ranges)
	}
	if ranges[0].StartLine != 0 || ranges[0].EndLine != 2 {
		t.Errorf("expected {0, 2}, got {%d, %d}", ranges[0].StartLine, ranges[0].EndLine)
	}
}

func TestIndentRanges_Nested(t *testing.T) {
	lines := []string{
		"func main() {",
		"    if true {",
		"        doStuff()",
		"    }",
		"}",
	}
	ranges := ComputeIndentRanges(lines)
	if len(ranges) != 2 {
		t.Fatalf("expected 2 ranges, got %d: %v", len(ranges), ranges)
	}
	if ranges[0].StartLine != 0 || ranges[0].EndLine != 3 {
		t.Errorf("outer: expected {0, 3}, got {%d, %d}", ranges[0].StartLine, ranges[0].EndLine)
	}
	if ranges[1].StartLine != 1 || ranges[1].EndLine != 2 {
		t.Errorf("inner: expected {1, 2}, got {%d, %d}", ranges[1].StartLine, ranges[1].EndLine)
	}
}

func TestIndentRanges_BlankLines(t *testing.T) {
	lines := []string{
		"func main() {",
		"    a()",
		"",
		"    b()",
		"}",
	}
	ranges := ComputeIndentRanges(lines)
	if len(ranges) != 1 {
		t.Fatalf("expected 1 range, got %d: %v", len(ranges), ranges)
	}
	if ranges[0].StartLine != 0 || ranges[0].EndLine != 3 {
		t.Errorf("expected {0, 3}, got {%d, %d}", ranges[0].StartLine, ranges[0].EndLine)
	}
}

func TestIndentRanges_MinSize(t *testing.T) {
	lines := []string{
		"if true {",
		"    x()",
		"}",
	}
	ranges := ComputeIndentRanges(lines)
	if len(ranges) != 1 {
		t.Fatalf("expected 1 range (size 2 is ok), got %d", len(ranges))
	}
}

func TestIndentRanges_SingleLineBody(t *testing.T) {
	lines := []string{
		"a",
		"    b",
		"c",
	}
	ranges := ComputeIndentRanges(lines)
	if len(ranges) != 1 {
		t.Fatalf("expected 1 range, got %d: %v", len(ranges), ranges)
	}
	if ranges[0].StartLine != 0 || ranges[0].EndLine != 1 {
		t.Errorf("expected {0, 1}, got {%d, %d}", ranges[0].StartLine, ranges[0].EndLine)
	}
}

func TestIndentRanges_Tabs(t *testing.T) {
	lines := []string{
		"func main() {",
		"\tfmt.Println()",
		"\treturn",
		"}",
	}
	ranges := ComputeIndentRanges(lines)
	if len(ranges) != 1 {
		t.Fatalf("expected 1 range, got %d: %v", len(ranges), ranges)
	}
	if ranges[0].StartLine != 0 || ranges[0].EndLine != 2 {
		t.Errorf("expected {0, 2}, got {%d, %d}", ranges[0].StartLine, ranges[0].EndLine)
	}
}

func TestIndentRanges_FlatFile(t *testing.T) {
	lines := []string{
		"line 1",
		"line 2",
		"line 3",
	}
	ranges := ComputeIndentRanges(lines)
	if len(ranges) != 0 {
		t.Errorf("expected 0 ranges for flat file, got %d", len(ranges))
	}
}

func TestIndentRanges_EmptyFile(t *testing.T) {
	ranges := ComputeIndentRanges([]string{""})
	if len(ranges) != 0 {
		t.Errorf("expected 0 ranges for empty file, got %d", len(ranges))
	}
}
