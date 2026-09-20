package ui

import "testing"

func TestFuzzyMatchExactSubstring(t *testing.T) {
	ok, score := fuzzyMatch("open", "File: Open")
	if !ok {
		t.Fatal("expected 'open' to match 'File: Open'")
	}
	if score < 1000 {
		t.Fatalf("exact substring should score >= 1000, got %d", score)
	}
}

func TestFuzzyMatchInitials(t *testing.T) {
	ok, _ := fuzzyMatch("oc", "Open Changes")
	if !ok {
		t.Fatal("expected 'oc' to match 'Open Changes'")
	}
}

func TestFuzzyMatchPartialWords(t *testing.T) {
	// "ttu" matches T-r-a-n-s-f-o-r-m (skip) t-o (skip) U-ppercase
	ok, _ := fuzzyMatch("ttu", "Transform to Uppercase")
	if !ok {
		t.Fatal("expected 'ttu' to match 'Transform to Uppercase'")
	}
}

func TestFuzzyMatchNoMatchMissingChar(t *testing.T) {
	// "tul" should NOT match "Transform to Uppercase" -- no 'l' in the candidate
	ok, _ := fuzzyMatch("tul", "Transform to Uppercase")
	if ok {
		t.Fatal("expected 'tul' to NOT match 'Transform to Uppercase' (no 'l' in candidate)")
	}
}

func TestFuzzyMatchCaseInsensitive(t *testing.T) {
	ok, _ := fuzzyMatch("FILE", "File: Save")
	if !ok {
		t.Fatal("expected case-insensitive match")
	}
}

func TestFuzzyMatchEmptyQuery(t *testing.T) {
	ok, score := fuzzyMatch("", "anything")
	if !ok {
		t.Fatal("empty query should match everything")
	}
	if score != 0 {
		t.Fatalf("empty query should score 0, got %d", score)
	}
}

func TestFuzzyMatchNoMatch(t *testing.T) {
	ok, _ := fuzzyMatch("xyz", "File: Open")
	if ok {
		t.Fatal("expected 'xyz' to not match 'File: Open'")
	}
}

func TestFuzzyMatchOutOfOrder(t *testing.T) {
	ok, _ := fuzzyMatch("po", "Open")
	if ok {
		t.Fatal("expected 'po' to not match 'Open' (out of order)")
	}
}

func TestFuzzyMatchSubstringScoresHigherThanFuzzy(t *testing.T) {
	_, substringScore := fuzzyMatch("to", "Toggle Sidebar")
	_, fuzzyScore := fuzzyMatch("to", "Transform to Uppercase")

	// "to" is a substring of "Toggle..." (at position 0: "To") and also "Transform to..."
	// Both are substrings, but "Toggle" starts with "to"
	if substringScore <= fuzzyScore {
		t.Fatalf("start-of-string substring (%d) should score higher than mid-string (%d)",
			substringScore, fuzzyScore)
	}
}

func TestFuzzyMatchConsecutiveBonus(t *testing.T) {
	_, scoreConsec := fuzzyMatch("spl", "Split Editor Right")
	_, scoreSpread := fuzzyMatch("spr", "Split Editor Right")

	// "spl" is a substring match (higher score), "spr" is fuzzy
	if scoreConsec <= scoreSpread {
		t.Fatalf("consecutive match (%d) should score higher than spread match (%d)",
			scoreConsec, scoreSpread)
	}
}

func TestFuzzyMatchWordBoundaryBonus(t *testing.T) {
	// "fs" matching "File: Save" (both at word boundaries) vs "File: Sufs" (if it existed)
	ok, _ := fuzzyMatch("fs", "File: Save")
	if !ok {
		t.Fatal("expected 'fs' to match 'File: Save'")
	}
}

func TestFuzzyMatchFilePath(t *testing.T) {
	ok, _ := fuzzyMatch("pw", "internal/ui/palette_widget.go")
	if !ok {
		t.Fatal("expected 'pw' to match file path")
	}
}

func TestFuzzyMatchSingleChar(t *testing.T) {
	ok, _ := fuzzyMatch("s", "Split Editor Right")
	if !ok {
		t.Fatal("single char should match")
	}
}

func TestFuzzyMatchExactMatch(t *testing.T) {
	ok, score := fuzzyMatch("File: Save", "File: Save")
	if !ok {
		t.Fatal("exact match should work")
	}
	if score < 1000 {
		t.Fatalf("exact match should have high score, got %d", score)
	}
}

func TestFuzzyMatchStartOfString(t *testing.T) {
	_, scoreStart := fuzzyMatch("file", "File: Save")
	_, scoreMid := fuzzyMatch("save", "File: Save")

	if scoreStart <= scoreMid {
		t.Fatalf("start-of-string match (%d) should score higher than mid-string (%d)",
			scoreStart, scoreMid)
	}
}
