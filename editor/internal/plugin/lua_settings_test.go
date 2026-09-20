package plugin

import (
	"testing"
)

type mockSettingsAPI struct {
	store map[string]any
}

func (m *mockSettingsAPI) Get(key string) (any, bool) {
	v, ok := m.store[key]
	return v, ok
}

func (m *mockSettingsAPI) Set(key string, value any) error {
	if value == nil {
		delete(m.store, key)
	} else {
		m.store[key] = value
	}
	return nil
}

func setupTestPluginWithSettings(perms PermissionSet, api SettingsAPI) (*Plugin, func()) {
	p := &Plugin{
		Granted:  perms,
		Settings: api,
	}
	p.State = NewSandbox()
	setupSettingsModule(p.State, p)
	setupJSONModule(p.State)
	return p, func() { p.State.Close() }
}

func TestSettingsGetString(t *testing.T) {
	api := &mockSettingsAPI{store: map[string]any{"formatters.go": "gofmt"}}
	p, cleanup := setupTestPluginWithSettings(
		PermissionSet{Settings: true, SettingsKeys: []string{"formatters.*"}},
		api,
	)
	defer cleanup()

	err := p.State.DoString(`
		local settings = require("ttt.settings")
		result = settings.get("formatters.go")
	`)
	if err != nil {
		t.Fatalf("DoString: %v", err)
	}
	val := p.State.GetGlobal("result").String()
	if val != "gofmt" {
		t.Errorf("expected 'gofmt', got %q", val)
	}
}

func TestSettingsGetNil(t *testing.T) {
	api := &mockSettingsAPI{store: map[string]any{}}
	p, cleanup := setupTestPluginWithSettings(
		PermissionSet{Settings: true, SettingsKeys: []string{"formatters.*"}},
		api,
	)
	defer cleanup()

	err := p.State.DoString(`
		local settings = require("ttt.settings")
		result = settings.get("formatters.py")
	`)
	if err != nil {
		t.Fatalf("DoString: %v", err)
	}
	val := p.State.GetGlobal("result").String()
	if val != "nil" {
		t.Errorf("expected 'nil', got %q", val)
	}
}

func TestSettingsSetString(t *testing.T) {
	api := &mockSettingsAPI{store: map[string]any{}}
	p, cleanup := setupTestPluginWithSettings(
		PermissionSet{Settings: true, SettingsKeys: []string{"formatters.*"}},
		api,
	)
	defer cleanup()

	err := p.State.DoString(`
		local settings = require("ttt.settings")
		settings.set("formatters.js", "prettier --stdin-filepath {file}")
	`)
	if err != nil {
		t.Fatalf("DoString: %v", err)
	}
	if api.store["formatters.js"] != "prettier --stdin-filepath {file}" {
		t.Errorf("expected prettier command, got %v", api.store["formatters.js"])
	}
}

func TestSettingsGetTable(t *testing.T) {
	api := &mockSettingsAPI{store: map[string]any{
		"lsp.servers.go": map[string]any{
			"command": []any{"gopls"},
		},
	}}
	p, cleanup := setupTestPluginWithSettings(
		PermissionSet{Settings: true, SettingsKeys: []string{"lsp.*"}},
		api,
	)
	defer cleanup()

	err := p.State.DoString(`
		local settings = require("ttt.settings")
		local srv = settings.get("lsp.servers.go")
		result_cmd = srv.command[1]
	`)
	if err != nil {
		t.Fatalf("DoString: %v", err)
	}
	val := p.State.GetGlobal("result_cmd").String()
	if val != "gopls" {
		t.Errorf("expected 'gopls', got %q", val)
	}
}

func TestSettingsSetTable(t *testing.T) {
	api := &mockSettingsAPI{store: map[string]any{}}
	p, cleanup := setupTestPluginWithSettings(
		PermissionSet{Settings: true, SettingsKeys: []string{"lsp.*"}},
		api,
	)
	defer cleanup()

	err := p.State.DoString(`
		local settings = require("ttt.settings")
		settings.set("lsp.servers.go", {command = {"gopls"}})
	`)
	if err != nil {
		t.Fatalf("DoString: %v", err)
	}
	srv, ok := api.store["lsp.servers.go"].(map[string]any)
	if !ok {
		t.Fatalf("expected map, got %T", api.store["lsp.servers.go"])
	}
	cmd, ok := srv["command"].([]any)
	if !ok || len(cmd) != 1 || cmd[0] != "gopls" {
		t.Errorf("expected [gopls], got %v", srv["command"])
	}
}

func TestSettingsSetNilDeletesKey(t *testing.T) {
	api := &mockSettingsAPI{store: map[string]any{"formatters.go": "gofmt"}}
	p, cleanup := setupTestPluginWithSettings(
		PermissionSet{Settings: true, SettingsKeys: []string{"formatters.*"}},
		api,
	)
	defer cleanup()

	err := p.State.DoString(`
		local settings = require("ttt.settings")
		settings.set("formatters.go", nil)
	`)
	if err != nil {
		t.Fatalf("DoString: %v", err)
	}
	if _, exists := api.store["formatters.go"]; exists {
		t.Errorf("expected key to be deleted, but it still exists with value %v", api.store["formatters.go"])
	}
}

func TestSettingsGetBool(t *testing.T) {
	api := &mockSettingsAPI{store: map[string]any{"editor.wordWrap": true}}
	p, cleanup := setupTestPluginWithSettings(
		PermissionSet{Settings: true, SettingsKeys: []string{"editor.*"}},
		api,
	)
	defer cleanup()

	err := p.State.DoString(`
		local settings = require("ttt.settings")
		result = settings.get("editor.wordWrap")
	`)
	if err != nil {
		t.Fatalf("DoString: %v", err)
	}
	val := p.State.GetGlobal("result").String()
	if val != "true" {
		t.Errorf("expected 'true', got %q", val)
	}
}

func TestSettingsGetNumber(t *testing.T) {
	api := &mockSettingsAPI{store: map[string]any{"editor.tabSize": float64(4)}}
	p, cleanup := setupTestPluginWithSettings(
		PermissionSet{Settings: true, SettingsKeys: []string{"editor.*"}},
		api,
	)
	defer cleanup()

	err := p.State.DoString(`
		local settings = require("ttt.settings")
		result = settings.get("editor.tabSize")
	`)
	if err != nil {
		t.Fatalf("DoString: %v", err)
	}
	val := p.State.GetGlobal("result").String()
	if val != "4" {
		t.Errorf("expected '4', got %q", val)
	}
}

func TestSettingsPermissionDenied(t *testing.T) {
	api := &mockSettingsAPI{store: map[string]any{}}
	p, cleanup := setupTestPluginWithSettings(
		PermissionSet{Settings: true, SettingsKeys: []string{"formatters.*"}},
		api,
	)
	defer cleanup()

	err := p.State.DoString(`
		local settings = require("ttt.settings")
		settings.get("editor.tabSize")
	`)
	if err == nil {
		t.Fatal("expected permission error")
	}
}

func TestSettingsNoPermission(t *testing.T) {
	api := &mockSettingsAPI{store: map[string]any{}}
	p, cleanup := setupTestPluginWithSettings(
		PermissionSet{},
		api,
	)
	defer cleanup()

	err := p.State.DoString(`
		local settings = require("ttt.settings")
		settings.get("formatters.go")
	`)
	if err == nil {
		t.Fatal("expected permission error")
	}
}

func TestSettingsExactKeyMatch(t *testing.T) {
	api := &mockSettingsAPI{store: map[string]any{"formatters.go": "gofmt"}}
	p, cleanup := setupTestPluginWithSettings(
		PermissionSet{Settings: true, SettingsKeys: []string{"formatters.go"}},
		api,
	)
	defer cleanup()

	err := p.State.DoString(`
		local settings = require("ttt.settings")
		result = settings.get("formatters.go")
	`)
	if err != nil {
		t.Fatalf("DoString: %v", err)
	}
	val := p.State.GetGlobal("result").String()
	if val != "gofmt" {
		t.Errorf("expected 'gofmt', got %q", val)
	}

	err = p.State.DoString(`
		local settings = require("ttt.settings")
		settings.get("formatters.py")
	`)
	if err == nil {
		t.Fatal("expected permission error for non-matching exact key")
	}
}

func TestOnUninstallCallback(t *testing.T) {
	api := &mockSettingsAPI{store: map[string]any{"formatters.go": "gofmt"}}
	p, cleanup := setupTestPluginWithSettings(
		PermissionSet{Settings: true, SettingsKeys: []string{"formatters.*"}},
		api,
	)
	defer cleanup()

	setupTTTModule(p.State, p)

	err := p.State.DoString(`
		local ttt = require("ttt")
		local settings = require("ttt.settings")
		settings.set("formatters.go", "gofmt")
		ttt.on_uninstall(function()
			settings.set("formatters.go", nil)
		end)
	`)
	if err != nil {
		t.Fatalf("DoString: %v", err)
	}

	if p.UninstallFunc == nil {
		t.Fatal("expected UninstallFunc to be set")
	}

	if api.store["formatters.go"] != "gofmt" {
		t.Errorf("expected 'gofmt' before uninstall, got %v", api.store["formatters.go"])
	}

	if err := p.CallLuaFunc(p.UninstallFunc); err != nil {
		t.Fatalf("uninstall callback: %v", err)
	}

	if api.store["formatters.go"] != nil {
		t.Errorf("expected nil after uninstall, got %v", api.store["formatters.go"])
	}
}

func TestCheckSettingsKey(t *testing.T) {
	tests := []struct {
		name    string
		keys    []string
		key     string
		wantErr bool
	}{
		{"wildcard match", []string{"formatters.*"}, "formatters.go", false},
		{"wildcard no match", []string{"formatters.*"}, "editor.tabSize", true},
		{"exact match", []string{"formatters.go"}, "formatters.go", false},
		{"exact no match", []string{"formatters.go"}, "formatters.py", true},
		{"no settings permission", nil, "formatters.go", true},
		{"star wildcard allows any", []string{"*"}, "vim.enabled", false},
		{"star wildcard allows nested", []string{"*"}, "any.deep.key", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ps := PermissionSet{Settings: len(tt.keys) > 0, SettingsKeys: tt.keys}
			err := ps.CheckSettingsKey(tt.key)
			if (err != nil) != tt.wantErr {
				t.Errorf("CheckSettingsKey(%q) error = %v, wantErr = %v", tt.key, err, tt.wantErr)
			}
		})
	}
}
