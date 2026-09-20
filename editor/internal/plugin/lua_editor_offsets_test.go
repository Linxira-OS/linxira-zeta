package plugin

import (
	"strconv"
	"testing"

	lua "github.com/yuin/gopher-lua"
)

// runOffsetLua evaluates a Lua snippet against a plugin with editor.read granted
// and returns the numeric global "result".
func runOffsetLua(t *testing.T, script string) int {
	t.Helper()
	mock := &mockEditorAPI{}
	p, cleanup := setupTestPluginWithEditor(PermissionSet{EditorRead: true}, mock)
	defer cleanup()
	if err := p.State.DoString(script); err != nil {
		t.Fatalf("lua error: %v", err)
	}
	return int(lua.LVAsNumber(p.State.GetGlobal("result")))
}

// TestEditorByteToColMultibyte verifies byte offsets around a multi-byte char
// (em-dash) map to the correct rune columns. Line: "pane — adn".
// Bytes:  p(1) a(2) n(3) e(4) space(5) — (6,7,8) space(9) a(10) d(11) n(12)
// Runes:  p(1) a(2) n(3) e(4) space(5) —(6)      space(7) a(8) d(9) n(10)
func TestEditorByteToColMultibyte(t *testing.T) {
	// "adn" starts at byte 10, which is rune column 8.
	if col := runOffsetLua(t, `
		local editor = require("ttt.editor")
		_G.result = editor.byte_to_col("pane \226\128\148 adn", 10)
	`); col != 8 {
		t.Errorf("expected col 8 for byte 10, got %d", col)
	}

	// The em-dash itself starts at byte 6, rune column 6.
	if col := runOffsetLua(t, `
		local editor = require("ttt.editor")
		_G.result = editor.byte_to_col("pane \226\128\148 adn", 6)
	`); col != 6 {
		t.Errorf("expected col 6 for byte 6, got %d", col)
	}
}

func TestEditorColToByteMultibyte(t *testing.T) {
	// Rune column 8 ("adn") starts at byte 10.
	if b := runOffsetLua(t, `
		local editor = require("ttt.editor")
		_G.result = editor.col_to_byte("pane \226\128\148 adn", 8)
	`); b != 10 {
		t.Errorf("expected byte 10 for col 8, got %d", b)
	}

	// The space after the em-dash is rune column 7, byte 9.
	if b := runOffsetLua(t, `
		local editor = require("ttt.editor")
		_G.result = editor.col_to_byte("pane \226\128\148 adn", 7)
	`); b != 9 {
		t.Errorf("expected byte 9 for col 7, got %d", b)
	}
}

func TestEditorOffsetASCII(t *testing.T) {
	// ASCII-only: byte == col for every position, both directions.
	for _, pos := range []int{1, 3, 6} {
		if col := runOffsetLua(t, `
			local editor = require("ttt.editor")
			_G.result = editor.byte_to_col("hello", `+strconv.Itoa(pos)+`)
		`); col != pos {
			t.Errorf("byte_to_col ascii byte %d: expected %d, got %d", pos, pos, col)
		}
		if b := runOffsetLua(t, `
			local editor = require("ttt.editor")
			_G.result = editor.col_to_byte("hello", `+strconv.Itoa(pos)+`)
		`); b != pos {
			t.Errorf("col_to_byte ascii col %d: expected %d, got %d", pos, pos, b)
		}
	}
}

func TestEditorOffsetEdges(t *testing.T) {
	// byte_to_col: offset past the end clamps to runeCount+1.
	// "pane — adn" has 10 runes; #text is 12 bytes; byte 13 -> col 11.
	if col := runOffsetLua(t, `
		local editor = require("ttt.editor")
		_G.result = editor.byte_to_col("pane \226\128\148 adn", 13)
	`); col != 11 {
		t.Errorf("expected col 11 for end offset, got %d", col)
	}

	// col_to_byte: column past the end clamps to #text+1 (13).
	if b := runOffsetLua(t, `
		local editor = require("ttt.editor")
		_G.result = editor.col_to_byte("pane \226\128\148 adn", 11)
	`); b != 13 {
		t.Errorf("expected byte 13 for end col, got %d", b)
	}

	// Below-range inputs clamp to 1.
	if col := runOffsetLua(t, `
		local editor = require("ttt.editor")
		_G.result = editor.byte_to_col("hello", 0)
	`); col != 1 {
		t.Errorf("expected col 1 for byte 0, got %d", col)
	}
	if b := runOffsetLua(t, `
		local editor = require("ttt.editor")
		_G.result = editor.col_to_byte("hello", 0)
	`); b != 1 {
		t.Errorf("expected byte 1 for col 0, got %d", b)
	}
}

func TestEditorOffsetRoundTrip(t *testing.T) {
	// For a rune-start byte (what Lua string functions return),
	// col_to_byte(byte_to_col(b)) == b. Byte 10 starts "adn".
	if b := runOffsetLua(t, `
		local editor = require("ttt.editor")
		_G.result = editor.col_to_byte("pane \226\128\148 adn", editor.byte_to_col("pane \226\128\148 adn", 10))
	`); b != 10 {
		t.Errorf("round-trip byte 10: expected 10, got %d", b)
	}
	// The em-dash lead byte (byte 6) also round-trips.
	if b := runOffsetLua(t, `
		local editor = require("ttt.editor")
		_G.result = editor.col_to_byte("pane \226\128\148 adn", editor.byte_to_col("pane \226\128\148 adn", 6))
	`); b != 6 {
		t.Errorf("round-trip byte 6: expected 6, got %d", b)
	}
}
