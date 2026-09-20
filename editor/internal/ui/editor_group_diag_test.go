package ui

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/eugenioenko/ttt/internal/term"
)

func openTabWithFile(t *testing.T, content string) (*EditorGroupWidget, string) {
	t.Helper()
	tmp := t.TempDir()
	path := filepath.Join(tmp, "test.txt")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write temp: %v", err)
	}
	g := NewEditorGroupWidget(nil, 4, false, "extended")
	g.OpenFile(path)
	if g.tabs[g.active].FilePath != path {
		t.Fatalf("expected active tab %s, got %s", path, g.tabs[g.active].FilePath)
	}
	return g, path
}

func TestSetDiagnosticsSourceMerges(t *testing.T) {
	g, path := openTabWithFile(t, "hello world")

	g.SetDiagnosticsSource("lsp", path, []Diagnostic{
		{StartLine: 0, StartCol: 0, EndLine: 0, EndCol: 5, Severity: DiagError},
	})
	g.SetDiagnosticsSource("plugin:x", path, []Diagnostic{
		{StartLine: 0, StartCol: 6, EndLine: 0, EndCol: 11, Severity: DiagWarning},
	})

	if got := len(g.tabs[g.active].Diagnostics); got != 2 {
		t.Fatalf("expected 2 merged diagnostics, got %d", got)
	}
	if got := len(g.Editor.Diagnostics); got != 2 {
		t.Fatalf("expected active editor to mirror 2 diagnostics, got %d", got)
	}
}

func TestClearDiagnosticsSourceRemovesOnlyThatSource(t *testing.T) {
	g, path := openTabWithFile(t, "hello world")

	g.SetDiagnosticsSource("lsp", path, []Diagnostic{
		{StartLine: 0, StartCol: 0, EndLine: 0, EndCol: 5, Severity: DiagError},
	})
	g.SetDiagnosticsSource("plugin:x", path, []Diagnostic{
		{StartLine: 0, StartCol: 6, EndLine: 0, EndCol: 11, Severity: DiagWarning},
	})

	g.ClearDiagnosticsSource("plugin:x")

	diags := g.tabs[g.active].Diagnostics
	if len(diags) != 1 {
		t.Fatalf("expected 1 diagnostic after clearing plugin source, got %d", len(diags))
	}
	if diags[0].Severity != DiagError {
		t.Errorf("expected remaining diagnostic to be the LSP error, got severity %d", diags[0].Severity)
	}
}

func TestSetDiagnosticsWrapsLspSource(t *testing.T) {
	g, path := openTabWithFile(t, "hello world")

	g.SetDiagnostics(path, []Diagnostic{
		{StartLine: 0, StartCol: 0, EndLine: 0, EndCol: 5, Severity: DiagError},
	})
	// SetDiagnostics must funnel through the "lsp" source so ClearDiagnosticsSource
	// can later remove it.
	g.ClearDiagnosticsSource("lsp")
	if got := len(g.tabs[g.active].Diagnostics); got != 0 {
		t.Fatalf("expected SetDiagnostics to use the lsp source, got %d after clear", got)
	}
}

func TestCustomStyleFlowsToDiagStyleAt(t *testing.T) {
	g, path := openTabWithFile(t, "hello world")

	custom := term.StyleSyntaxKeyword
	g.SetDiagnosticsSource("plugin:x", path, []Diagnostic{
		{StartLine: 0, StartCol: 0, EndLine: 0, EndCol: 5, Severity: DiagWarning, Style: custom},
	})

	if got := g.Editor.diagStyleAt(0, 2); got != custom {
		t.Errorf("expected custom style %v at (0,2), got %v", custom, got)
	}
}

func TestSeverityStyleWhenNoCustomStyle(t *testing.T) {
	g, path := openTabWithFile(t, "hello world")

	g.SetDiagnosticsSource("plugin:x", path, []Diagnostic{
		{StartLine: 0, StartCol: 0, EndLine: 0, EndCol: 5, Severity: DiagWarning},
	})

	if got := g.Editor.diagStyleAt(0, 2); got != term.StyleDiagWarning {
		t.Errorf("expected StyleDiagWarning at (0,2), got %v", got)
	}
}
