package plugin

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadRegistryMissing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "plugins.ttt.json")
	r, err := LoadRegistry(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(r.Entries) != 0 {
		t.Errorf("expected empty registry, got %d entries", len(r.Entries))
	}
}

func TestRegistryRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "plugins.ttt.json")
	r := &Registry{path: path}
	r.AddOrUpdate("test", "Test Plugin", "github.com/test/test", "", "1.0.0", PermissionSet{PanelSidebar: true})

	if err := r.Save(); err != nil {
		t.Fatalf("save error: %v", err)
	}

	r2, err := LoadRegistry(path)
	if err != nil {
		t.Fatalf("load error: %v", err)
	}
	if len(r2.Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(r2.Entries))
	}
	if r2.Entries[0].Name != "test" {
		t.Errorf("expected name test, got %s", r2.Entries[0].Name)
	}
	if r2.Entries[0].DisplayName != "Test Plugin" {
		t.Errorf("expected displayName to round-trip, got %q", r2.Entries[0].DisplayName)
	}
	if r2.Entries[0].Title() != "Test Plugin" {
		t.Errorf("expected Title() to use displayName, got %q", r2.Entries[0].Title())
	}
	if !r2.Entries[0].Permissions.PanelSidebar {
		t.Error("expected panel.sidebar to be true")
	}
}

func TestRegistryFind(t *testing.T) {
	path := filepath.Join(t.TempDir(), "plugins.ttt.json")
	r := &Registry{path: path}
	r.AddOrUpdate("alpha", "", "", "", "1.0", PermissionSet{})
	r.AddOrUpdate("beta", "", "", "", "2.0", PermissionSet{})

	if r.Find("alpha") == nil {
		t.Error("expected to find alpha")
	}
	if r.Find("gamma") != nil {
		t.Error("expected nil for gamma")
	}
}

func TestRegistrySetEnabled(t *testing.T) {
	path := filepath.Join(t.TempDir(), "plugins.ttt.json")
	r := &Registry{path: path}
	r.AddOrUpdate("test", "", "", "", "1.0", PermissionSet{})

	r.SetEnabled("test", false)
	entry := r.Find("test")
	if entry.Enabled {
		t.Error("expected disabled")
	}
}

func TestRegistryUpdatePermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "plugins.ttt.json")
	r := &Registry{path: path}
	r.AddOrUpdate("test", "", "", "", "1.0", PermissionSet{})

	r.UpdatePermissions("test", PermissionSet{Commands: true})
	entry := r.Find("test")
	if !entry.Permissions.Commands {
		t.Error("expected commands to be true after update")
	}
}

func TestLoadRegistryInvalidJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "plugins.ttt.json")
	os.WriteFile(path, []byte("not json"), 0644)

	_, err := LoadRegistry(path)
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}
