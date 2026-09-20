package plugin

import (
	"testing"
)

func TestNotifyLevels(t *testing.T) {
	cases := []struct {
		name      string
		lua       string
		wantMsg   string
		wantLevel string
	}{
		{"default", `require("ttt").notify("hi")`, "hi", "info"},
		{"info", `require("ttt").notify("hi", "info")`, "hi", "info"},
		{"warn", `require("ttt").notify("careful", "warn")`, "careful", "warn"},
		{"error", `require("ttt").notify("boom", "error")`, "boom", "error"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, cleanup := newTestPluginBase(PermissionSet{})
			defer cleanup()

			var gotMsg, gotLevel string
			var called bool
			p.Notify = func(message, level string) {
				gotMsg = message
				gotLevel = level
				called = true
			}

			if err := p.State.DoString(tc.lua); err != nil {
				t.Fatalf("error: %v", err)
			}
			if !called {
				t.Fatal("expected Notify to be called")
			}
			if gotMsg != tc.wantMsg || gotLevel != tc.wantLevel {
				t.Errorf("got msg=%q level=%q, want msg=%q level=%q", gotMsg, gotLevel, tc.wantMsg, tc.wantLevel)
			}
		})
	}
}
