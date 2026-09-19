package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEditorConfigBasic(t *testing.T) {
	dir := t.TempDir()
	ec := filepath.Join(dir, ".editorconfig")
	os.WriteFile(ec, []byte(`
root = true

[*]
indent_style = space
indent_size = 2

[*.go]
indent_size = 4
tab_width = 4

[Makefile]
indent_style = tab
`), 0644)

	props := LoadEditorConfig(filepath.Join(dir, "main.go"))
	if props.IndentStyle != "space" {
		t.Errorf("expected indent_style 'space', got %q", props.IndentStyle)
	}
	if props.IndentSize != 4 {
		t.Errorf("expected indent_size 4, got %d", props.IndentSize)
	}
	props = LoadEditorConfig(filepath.Join(dir, "Makefile"))
	if props.IndentStyle != "tab" {
		t.Errorf("expected indent_style 'tab', got %q", props.IndentStyle)
	}

	props = LoadEditorConfig(filepath.Join(dir, "readme.md"))
	if props.IndentSize != 2 {
		t.Errorf("expected indent_size 2 from [*], got %d", props.IndentSize)
	}
}

func TestEditorConfigBraceExpansion(t *testing.T) {
	dir := t.TempDir()
	ec := filepath.Join(dir, ".editorconfig")
	os.WriteFile(ec, []byte(`
root = true

[*.{json,yaml,yml}]
indent_size = 2
`), 0644)

	props := LoadEditorConfig(filepath.Join(dir, "config.json"))
	if props.IndentSize != 2 {
		t.Errorf("expected indent_size 2, got %d", props.IndentSize)
	}

	props = LoadEditorConfig(filepath.Join(dir, "config.yaml"))
	if props.IndentSize != 2 {
		t.Errorf("expected indent_size 2, got %d", props.IndentSize)
	}

	props = LoadEditorConfig(filepath.Join(dir, "main.go"))
	if props.IndentSize != 0 {
		t.Errorf("expected indent_size 0 (unset), got %d", props.IndentSize)
	}
}

func TestEditorConfigNoFile(t *testing.T) {
	dir := t.TempDir()
	props := LoadEditorConfig(filepath.Join(dir, "test.go"))
	if props.IndentSize != 0 {
		t.Errorf("expected unset indent_size, got %d", props.IndentSize)
	}
}

func TestGlobMatch(t *testing.T) {
	tests := []struct {
		pattern, name string
		want          bool
	}{
		{"*", "anything", true},
		{"*.go", "main.go", true},
		{"*.go", "main.rs", false},
		{"Makefile", "Makefile", true},
		{"Makefile", "makefile", false},
		{"*.{js,ts}", "app.js", true},
		{"*.{js,ts}", "app.ts", true},
		{"*.{js,ts}", "app.go", false},
	}
	for _, tt := range tests {
		got := matchGlob(tt.pattern, tt.name)
		if got != tt.want {
			t.Errorf("matchGlob(%q, %q) = %v, want %v", tt.pattern, tt.name, got, tt.want)
		}
	}
}

func TestLoadEditorConfigMJS(t *testing.T) {
	dir := t.TempDir()
	ec := filepath.Join(dir, ".editorconfig")
	os.WriteFile(ec, []byte("root = true\n\n[*]\nindent_style = tab\nindent_size = 4\n"), 0644)
	f := filepath.Join(dir, "astro.config.mjs")
	os.WriteFile(f, []byte(""), 0644)
	props := LoadEditorConfig(f)
	if props.IndentStyle != "tab" {
		t.Errorf("expected indent_style=tab, got %q", props.IndentStyle)
	}
	if props.IndentSize != 4 {
		t.Errorf("expected indent_size=4, got %d", props.IndentSize)
	}
}
