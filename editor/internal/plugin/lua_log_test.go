package plugin

import (
	"fmt"
	"testing"
)

func TestLogInfo(t *testing.T) {
	p, cleanup := newTestPluginBase(PermissionSet{})
	defer cleanup()

	var logged []struct{ level, message string }
	p.Log = func(level, message string) {
		logged = append(logged, struct{ level, message string }{level, message})
	}

	err := p.State.DoString(`
		local ttt = require("ttt")
		ttt.log("hello world")
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}

	if len(logged) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(logged))
	}
	if logged[0].level != "info" {
		t.Errorf("expected level 'info', got %q", logged[0].level)
	}
	if logged[0].message != "hello world" {
		t.Errorf("expected message 'hello world', got %q", logged[0].message)
	}
}

func TestLogWithLevel(t *testing.T) {
	p, cleanup := newTestPluginBase(PermissionSet{})
	defer cleanup()

	var logged []struct{ level, message string }
	p.Log = func(level, message string) {
		logged = append(logged, struct{ level, message string }{level, message})
	}

	err := p.State.DoString(`
		local ttt = require("ttt")
		ttt.log("warn", "something is off")
		ttt.log("error", "something broke")
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}

	if len(logged) != 2 {
		t.Fatalf("expected 2 log entries, got %d", len(logged))
	}
	if logged[0].level != "warn" || logged[0].message != "something is off" {
		t.Errorf("unexpected entry 0: %+v", logged[0])
	}
	if logged[1].level != "error" || logged[1].message != "something broke" {
		t.Errorf("unexpected entry 1: %+v", logged[1])
	}
}

func TestLogWithoutCallback(t *testing.T) {
	p, cleanup := newTestPluginBase(PermissionSet{})
	defer cleanup()

	err := p.State.DoString(`
		local ttt = require("ttt")
		ttt.log("no callback set")
	`)
	if err != nil {
		t.Fatalf("should not error when Log callback is nil: %v", err)
	}
}

func TestLogNoPermissionNeeded(t *testing.T) {
	p, cleanup := newTestPluginBase(PermissionSet{})
	defer cleanup()

	var called bool
	p.Log = func(level, message string) {
		called = true
	}

	err := p.State.DoString(`
		local ttt = require("ttt")
		ttt.log("works without any permissions")
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !called {
		t.Error("expected Log callback to be called")
	}
}

func TestLogErrorRouting(t *testing.T) {
	p, cleanup := newTestPluginBase(PermissionSet{})
	defer cleanup()

	var logged []struct{ level, message string }
	p.Log = func(level, message string) {
		logged = append(logged, struct{ level, message string }{level, message})
	}

	p.logError("test context", fmt.Errorf("test error"))

	if len(logged) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(logged))
	}
	if logged[0].level != "error" {
		t.Errorf("expected level 'error', got %q", logged[0].level)
	}
	if logged[0].message != "test context: test error" {
		t.Errorf("expected 'test context: test error', got %q", logged[0].message)
	}
}
