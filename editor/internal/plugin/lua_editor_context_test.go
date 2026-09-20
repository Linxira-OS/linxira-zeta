package plugin

import (
	"testing"
)

func TestRegisterContextMenuStoresProvider(t *testing.T) {
	mock := &mockEditorAPI{}
	p, cleanup := setupTestPluginWithEditor(PermissionSet{EditorRead: true}, mock)
	defer cleanup()

	err := p.State.DoString(`
		local editor = require("ttt.editor")
		editor.register_context_menu(function(line, col, word)
			return {
				{ label = "Add '" .. word .. "'", on_select = function() _G.picked = word end },
				{ separator = true },
				{ label = "Ignore" },
			}
		end)
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if p.EditorContextProvider == nil {
		t.Fatal("expected provider to be stored")
	}

	entries := p.EditorContextMenuItems(4, 2, "teh")
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}
	if entries[0].Label != "Add 'teh'" {
		t.Errorf("entry0 label: got %q", entries[0].Label)
	}
	if entries[0].OnSelect == nil {
		t.Error("entry0 should have OnSelect")
	}
	if !entries[1].Separator {
		t.Error("entry1 should be a separator")
	}
	if entries[2].Label != "Ignore" || entries[2].OnSelect != nil {
		t.Errorf("entry2: got label=%q hasSelect=%v", entries[2].Label, entries[2].OnSelect != nil)
	}

	// Invoking OnSelect runs the stored Lua closure.
	entries[0].OnSelect()
	if got := p.State.GetGlobal("picked").String(); got != "teh" {
		t.Errorf("expected on_select to set picked='teh', got %q", got)
	}
}

func TestEditorContextMenuItemsNoProvider(t *testing.T) {
	mock := &mockEditorAPI{}
	p, cleanup := setupTestPluginWithEditor(PermissionSet{EditorRead: true}, mock)
	defer cleanup()

	if entries := p.EditorContextMenuItems(1, 1, ""); entries != nil {
		t.Errorf("expected nil entries with no provider, got %v", entries)
	}
}

func TestRegisterContextMenuRequiresRead(t *testing.T) {
	mock := &mockEditorAPI{}
	p, cleanup := setupTestPluginWithEditor(PermissionSet{}, mock)
	defer cleanup()

	err := p.State.DoString(`
		local editor = require("ttt.editor")
		editor.register_context_menu(function() return {} end)
	`)
	if err == nil {
		t.Fatal("expected error when editor.read not granted")
	}
}
