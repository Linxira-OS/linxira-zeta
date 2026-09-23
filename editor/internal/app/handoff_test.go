package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The handoff file is the only contract between the agent CLI (TypeScript,
// plugins/official/pi-messenger/handoff.ts) and this editor (Go). There is no
// shared code, so these tests pin the parsing rules the TS side relies on.

func TestSplitFileTarget(t *testing.T) {
	cases := []struct {
		in       string
		wantPath string
		wantLine int
		wantCol  int
	}{
		{"src/main.go:42", "src/main.go", 42, 0},
		{"src/main.go:42:7", "src/main.go", 42, 7},
		{"README.md", "README.md", 0, 0},
		{`C:\work\a.go:10`, `C:\work\a.go`, 10, 0},
		{`C:\work\a.go`, `C:\work\a.go`, 0, 0},
		{"a.go:0", "a.go:0", 0, 0},
		{"a.go:abc", "a.go:abc", 0, 0},
		{"", "", 0, 0},
	}
	for _, c := range cases {
		p, l, co := splitFileTarget(c.in)
		if p != c.wantPath || l != c.wantLine || co != c.wantCol {
			t.Errorf("splitFileTarget(%q) = %q,%d,%d; want %q,%d,%d", c.in, p, l, co, c.wantPath, c.wantLine, c.wantCol)
		}
	}
}

func TestConsumeHandoffRoundTrip(t *testing.T) {
	dir := t.TempDir()
	hf := filepath.Join(dir, "handoff.json")
	t.Setenv("ZETA_HANDOFF_PATH", hf)

	// Absent file is a normal start, not an error.
	if got := consumeHandoff(); got != nil {
		t.Fatalf("expected nil for absent file, got %+v", got)
	}

	payload, err := json.Marshal(Handoff{Cwd: dir, GitRoot: dir, File: "x.go:3:2", From: "zeta", Ts: 1})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(hf, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	got := consumeHandoff()
	if got == nil {
		t.Fatal("expected handoff")
	}
	if got.Cwd != dir || got.File != "x.go:3:2" || got.From != "zeta" {
		t.Fatalf("bad handoff: %+v", got)
	}

	// Read-once: the file must not replay its context on the next launch.
	if again := consumeHandoff(); again != nil {
		t.Fatalf("handoff not consumed: %+v", again)
	}

	// A malformed handoff must never block startup.
	if err := os.WriteFile(hf, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if bad := consumeHandoff(); bad != nil {
		t.Fatalf("expected nil for corrupt file, got %+v", bad)
	}

	// No cwd means there is nothing to open.
	empty, err := json.Marshal(Handoff{File: "a.go:1"})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(hf, empty, 0o644); err != nil {
		t.Fatal(err)
	}
	if e := consumeHandoff(); e != nil {
		t.Fatalf("expected nil for empty cwd, got %+v", e)
	}
}
