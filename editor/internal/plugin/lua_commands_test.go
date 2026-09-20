package plugin

import (
	"testing"
)

func TestCommandRegistration(t *testing.T) {
	p, cleanup := newTestPluginBase(PermissionSet{Commands: true})
	defer cleanup()

	err := p.State.DoString(`
		local ttt = require("ttt")
		ttt.register({
			commands = {
				{ id = "test.hello", title = "Test: Hello", handler = function() end },
				{ id = "test.world", title = "Test: World", handler = function() end },
			},
		})
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}

	if len(p.Commands) != 2 {
		t.Fatalf("expected 2 commands, got %d", len(p.Commands))
	}
	if p.Commands[0].ID != "test.hello" {
		t.Errorf("expected id 'test.hello', got %q", p.Commands[0].ID)
	}
	if p.Commands[0].Title != "Test: Hello" {
		t.Errorf("expected title 'Test: Hello', got %q", p.Commands[0].Title)
	}
	if p.Commands[1].ID != "test.world" {
		t.Errorf("expected id 'test.world', got %q", p.Commands[1].ID)
	}
}

func TestCommandRegistrationWithoutPermission(t *testing.T) {
	p, cleanup := newTestPluginBase(PermissionSet{})
	defer cleanup()

	err := p.State.DoString(`
		local ttt = require("ttt")
		ttt.register({
			commands = {
				{ id = "test.hello", title = "Test: Hello", handler = function() end },
			},
		})
	`)
	if err == nil {
		t.Fatal("expected error when commands permission not granted")
	}
	if len(p.Commands) != 0 {
		t.Errorf("expected 0 commands, got %d", len(p.Commands))
	}
}

func TestCommandHandlerCallable(t *testing.T) {
	p, cleanup := newTestPluginBase(PermissionSet{Commands: true})
	defer cleanup()

	err := p.State.DoString(`
		local ttt = require("ttt")
		_G.called = false
		ttt.register({
			commands = {
				{ id = "test.run", title = "Test: Run", handler = function()
					_G.called = true
				end },
			},
		})
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}

	if len(p.Commands) != 1 {
		t.Fatalf("expected 1 command, got %d", len(p.Commands))
	}

	if err := p.Commands[0].Handler(); err != nil {
		t.Fatalf("error calling handler: %v", err)
	}

	if p.State.GetGlobal("called").String() != "true" {
		t.Error("expected handler to set called=true")
	}
}

func TestKeybindingRegistration(t *testing.T) {
	p, cleanup := newTestPluginBase(PermissionSet{Keybindings: true})
	defer cleanup()

	err := p.State.DoString(`
		local ttt = require("ttt")
		ttt.register({
			keybindings = {
				{ key = "ctrl+k d", command = "docker.restart" },
				{ key = "ctrl+k l", command = "docker.logs" },
			},
		})
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}

	if len(p.PluginKeybindings) != 2 {
		t.Fatalf("expected 2 keybindings, got %d", len(p.PluginKeybindings))
	}
	if p.PluginKeybindings[0].Key != "ctrl+k d" {
		t.Errorf("expected key 'ctrl+k d', got %q", p.PluginKeybindings[0].Key)
	}
	if p.PluginKeybindings[0].Command != "docker.restart" {
		t.Errorf("expected command 'docker.restart', got %q", p.PluginKeybindings[0].Command)
	}
}

func TestKeybindingRegistrationWithoutPermission(t *testing.T) {
	p, cleanup := newTestPluginBase(PermissionSet{})
	defer cleanup()

	err := p.State.DoString(`
		local ttt = require("ttt")
		ttt.register({
			keybindings = {
				{ key = "ctrl+k d", command = "test.cmd" },
			},
		})
	`)
	if err == nil {
		t.Fatal("expected error when keybindings permission not granted")
	}
	if len(p.PluginKeybindings) != 0 {
		t.Errorf("expected 0 keybindings, got %d", len(p.PluginKeybindings))
	}
}

func TestCommandSkipsInvalidEntries(t *testing.T) {
	p, cleanup := newTestPluginBase(PermissionSet{Commands: true})
	defer cleanup()

	err := p.State.DoString(`
		local ttt = require("ttt")
		ttt.register({
			commands = {
				{ id = "test.valid", title = "Valid", handler = function() end },
				{ id = "test.nohandler", title = "No Handler" },
				{ title = "No ID", handler = function() end },
				"not a table",
			},
		})
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}

	if len(p.Commands) != 1 {
		t.Fatalf("expected 1 valid command, got %d", len(p.Commands))
	}
	if p.Commands[0].ID != "test.valid" {
		t.Errorf("expected 'test.valid', got %q", p.Commands[0].ID)
	}
}
