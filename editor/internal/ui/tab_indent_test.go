package ui

import "testing"

func TestBufColToVisualCol(t *testing.T) {
	tests := []struct {
		name   string
		line   string
		bufCol int
		tabW   int
		want   int
	}{
		{"no tabs", "hello", 3, 4, 3},
		{"tab at start", "\thello", 1, 4, 4},
		{"two tabs", "\t\thello", 2, 4, 8},
		{"tab then text", "\tabc", 3, 4, 6},
		{"spaces only", "    abc", 4, 4, 4},
		{"mixed tab space", "\t  x", 3, 4, 6},
		{"tab width 2", "\tx", 1, 2, 2},
		{"tab after text", "ab\tc", 3, 4, 4},
		{"empty line", "", 0, 4, 0},
		{"at end of line", "abc", 3, 4, 3},
		{"cyrillic full", "Привет", 6, 4, 6},
		{"cyrillic partial", "Привет", 3, 4, 3},
		{"cyrillic with tab", "\tПривет", 4, 4, 7},
		{"mixed ascii cyrillic", "hiПривет", 5, 4, 5},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := bufColToVisualCol(tt.line, tt.bufCol, tt.tabW)
			if got != tt.want {
				t.Errorf("bufColToVisualCol(%q, %d, %d) = %d, want %d", tt.line, tt.bufCol, tt.tabW, got, tt.want)
			}
		})
	}
}

func TestVisualColToBufCol(t *testing.T) {
	tests := []struct {
		name      string
		line      string
		targetVis int
		tabW      int
		want      int
	}{
		{"no tabs", "hello", 3, 4, 3},
		{"click on tab expansion", "\thello", 2, 4, 0},
		{"click at tab boundary", "\thello", 4, 4, 1},
		{"click past tab", "\thello", 5, 4, 2},
		{"click past line end", "abc", 10, 4, 3},
		{"two tabs click between", "\t\thello", 5, 4, 1},
		{"spaces", "    abc", 4, 4, 4},
		{"cyrillic click", "Привет", 3, 4, 3},
		{"cyrillic click end", "Привет", 6, 4, 6},
		{"cyrillic click past", "Привет", 10, 4, 6},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := visualColToBufCol(tt.line, tt.targetVis, tt.tabW)
			if got != tt.want {
				t.Errorf("visualColToBufCol(%q, %d, %d) = %d, want %d", tt.line, tt.targetVis, tt.tabW, got, tt.want)
			}
		})
	}
}

func TestLeadingIndentWidth(t *testing.T) {
	tests := []struct {
		name    string
		line    string
		tabSize int
		want    int
	}{
		{"tab char", "\thello", 4, 1},
		{"spaces", "    hello", 4, 4},
		{"two spaces tab3", "  hello", 3, 2},
		{"no indent", "hello", 4, 0},
		{"empty line", "", 4, 0},
		{"partial spaces", "  hello", 4, 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := leadingIndentWidth(tt.line, tt.tabSize)
			if got != tt.want {
				t.Errorf("leadingIndentWidth(%q, %d) = %d, want %d", tt.line, tt.tabSize, got, tt.want)
			}
		})
	}
}

func TestIndentUnit(t *testing.T) {
	e := newTestEditor()
	e.TabSize = 4
	e.UseTabs = false
	if got := e.indentUnit(); got != "    " {
		t.Errorf("indentUnit() with spaces = %q, want %q", got, "    ")
	}

	e.UseTabs = true
	if got := e.indentUnit(); got != "\t" {
		t.Errorf("indentUnit() with tabs = %q, want %q", got, "\t")
	}

	e.UseTabs = false
	e.TabSize = 2
	if got := e.indentUnit(); got != "  " {
		t.Errorf("indentUnit() with 2 spaces = %q, want %q", got, "  ")
	}
}
