package plugin

import (
	"testing"

	"github.com/eugenioenko/ttt/internal/term"
)

func TestDiagnosticsPublish(t *testing.T) {
	p, cleanup := newTestPluginBase(PermissionSet{EditorDiagnostics: true})
	defer cleanup()

	var gotPath string
	var gotItems []DiagnosticItem
	p.PublishDiagnostics = func(path string, items []DiagnosticItem) {
		gotPath = path
		gotItems = items
	}

	err := p.State.DoString(`
		local diag = require("ttt.diagnostics")
		diag.publish("/tmp/x.txt", {
			{ line = 3, col = 5, end_line = 3, end_col = 10, severity = "error", message = "boom", source = "spell" },
			{ line = 1, col = 2, style = "warning" },
		})
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}

	if gotPath != "/tmp/x.txt" {
		t.Errorf("expected path /tmp/x.txt, got %q", gotPath)
	}
	if len(gotItems) != 2 {
		t.Fatalf("expected 2 items, got %d", len(gotItems))
	}

	// First item: full range, 1-based -> 0-based conversion.
	i0 := gotItems[0]
	if i0.StartLine != 2 || i0.StartCol != 4 || i0.EndLine != 2 || i0.EndCol != 9 {
		t.Errorf("item0 coords: got (%d,%d)-(%d,%d)", i0.StartLine, i0.StartCol, i0.EndLine, i0.EndCol)
	}
	if i0.Severity != 1 {
		t.Errorf("item0 severity: expected 1 (error), got %d", i0.Severity)
	}
	if i0.Message != "boom" || i0.Source != "spell" {
		t.Errorf("item0 message/source: got %q/%q", i0.Message, i0.Source)
	}
	if i0.Style != 0 {
		t.Errorf("item0 style: expected 0 (unset), got %v", i0.Style)
	}

	// Second item: defaults for end_line/end_col, default severity warning, style set.
	i1 := gotItems[1]
	if i1.StartLine != 0 || i1.StartCol != 1 {
		t.Errorf("item1 start: got (%d,%d)", i1.StartLine, i1.StartCol)
	}
	// end_line defaults to line (=1 -> 0-based 0); end_col defaults to col+1 (=3 -> 0-based 2).
	if i1.EndLine != 0 || i1.EndCol != 2 {
		t.Errorf("item1 end defaults: got (%d,%d)", i1.EndLine, i1.EndCol)
	}
	if i1.Severity != 2 {
		t.Errorf("item1 severity: expected 2 (warning default), got %d", i1.Severity)
	}
	wantStyle, _ := StyleByName("warning")
	if i1.Style != wantStyle || wantStyle == term.StyleDefault {
		t.Errorf("item1 style: expected resolved warning style, got %v", i1.Style)
	}
}

func TestDiagnosticsClearWithPath(t *testing.T) {
	p, cleanup := newTestPluginBase(PermissionSet{EditorDiagnostics: true})
	defer cleanup()

	var clearedPath string
	var called bool
	p.ClearDiagnostics = func(path string) {
		clearedPath = path
		called = true
	}

	err := p.State.DoString(`
		local diag = require("ttt.diagnostics")
		diag.clear("/tmp/x.txt")
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !called || clearedPath != "/tmp/x.txt" {
		t.Errorf("expected clear with /tmp/x.txt, got called=%v path=%q", called, clearedPath)
	}
}

func TestDiagnosticsClearAll(t *testing.T) {
	p, cleanup := newTestPluginBase(PermissionSet{EditorDiagnostics: true})
	defer cleanup()

	var clearedPath string
	var called bool
	p.ClearDiagnostics = func(path string) {
		clearedPath = path
		called = true
	}

	err := p.State.DoString(`
		local diag = require("ttt.diagnostics")
		diag.clear()
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !called || clearedPath != "" {
		t.Errorf("expected clear-all (empty path), got called=%v path=%q", called, clearedPath)
	}
}

func TestDiagnosticsWithoutPermission(t *testing.T) {
	p, cleanup := newTestPluginBase(PermissionSet{})
	defer cleanup()

	err := p.State.DoString(`
		local diag = require("ttt.diagnostics")
		diag.publish("/tmp/x.txt", {})
	`)
	if err == nil {
		t.Fatal("expected error when editor.diagnostics not granted")
	}
}
