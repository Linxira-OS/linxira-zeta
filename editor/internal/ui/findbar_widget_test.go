package ui

import "testing"

func TestFindInLines(t *testing.T) {
	lines := []string{"hello world", "foo bar", "hello again"}
	matches, err := FindInLines(lines, "hello", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 2 {
		t.Fatalf("expected 2 matches, got %d", len(matches))
	}
	if matches[0].Line != 0 || matches[0].Col != 0 {
		t.Fatalf("match 0 wrong: %+v", matches[0])
	}
	if matches[1].Line != 2 || matches[1].Col != 0 {
		t.Fatalf("match 1 wrong: %+v", matches[1])
	}
}

func TestFindInLinesCaseInsensitive(t *testing.T) {
	lines := []string{"Hello World", "HELLO"}
	matches, _ := FindInLines(lines, "hello", SearchOptions{})
	if len(matches) != 2 {
		t.Fatalf("expected 2 matches, got %d", len(matches))
	}
}

func TestFindInLinesCaseSensitive(t *testing.T) {
	lines := []string{"Hello World", "HELLO", "hello"}
	matches, _ := FindInLines(lines, "hello", SearchOptions{CaseSensitive: true})
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
	if matches[0].Line != 2 {
		t.Fatalf("expected match on line 2, got %d", matches[0].Line)
	}
}

func TestFindInLinesRegex(t *testing.T) {
	lines := []string{"foo123", "bar456", "baz"}
	matches, err := FindInLines(lines, `\d+`, SearchOptions{UseRegex: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 2 {
		t.Fatalf("expected 2 matches, got %d", len(matches))
	}
	if matches[0].Len != 3 || matches[1].Len != 3 {
		t.Fatalf("wrong match lengths: %+v", matches)
	}
}

func TestFindInLinesRegexCaseInsensitive(t *testing.T) {
	lines := []string{"Hello", "HELLO", "hello"}
	matches, _ := FindInLines(lines, "hello", SearchOptions{UseRegex: true})
	if len(matches) != 3 {
		t.Fatalf("expected 3 matches (case insensitive regex), got %d", len(matches))
	}
}

func TestFindInLinesRegexCaseSensitive(t *testing.T) {
	lines := []string{"Hello", "HELLO", "hello"}
	matches, _ := FindInLines(lines, "hello", SearchOptions{UseRegex: true, CaseSensitive: true})
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
}

func TestFindInLinesRegexInvalid(t *testing.T) {
	lines := []string{"hello"}
	_, err := FindInLines(lines, "[invalid", SearchOptions{UseRegex: true})
	if err == nil {
		t.Fatal("expected error for invalid regex")
	}
}

func TestFindInLinesMultiplePerLine(t *testing.T) {
	lines := []string{"abcabc"}
	matches, _ := FindInLines(lines, "abc", SearchOptions{})
	if len(matches) != 2 {
		t.Fatalf("expected 2 matches, got %d", len(matches))
	}
	if matches[0].Col != 0 || matches[1].Col != 3 {
		t.Fatalf("unexpected cols: %d, %d", matches[0].Col, matches[1].Col)
	}
}

func TestFindInLinesEmpty(t *testing.T) {
	lines := []string{"hello"}
	matches, _ := FindInLines(lines, "", SearchOptions{})
	if len(matches) != 0 {
		t.Fatalf("expected 0 matches for empty query, got %d", len(matches))
	}
}

func TestFindInLinesNoMatch(t *testing.T) {
	lines := []string{"hello world"}
	matches, _ := FindInLines(lines, "xyz", SearchOptions{})
	if len(matches) != 0 {
		t.Fatalf("expected 0 matches, got %d", len(matches))
	}
}
