package term

import "github.com/gdamore/tcell/v3"

// KeyRune returns the first rune carried by a key event, or 0 if none.
// Isolates the tcell v2 EventKey.Rune() / v3 EventKey.Str() difference.
// Multi-rune strings (grapheme clusters from IME or advanced keyboards)
// are truncated to their first rune; use KeyStr when the full string matters.
func KeyRune(ev *tcell.EventKey) rune {
	rs := []rune(ev.Str())
	if len(rs) > 0 {
		return rs[0]
	}
	return 0
}

// KeyStr returns the full string carried by a key event. Under tcell v3 a
// single key event can deliver a multi-rune grapheme cluster; callers that
// forward text (PTY input, paste accumulation) should prefer this over
// KeyRune to avoid dropping runes.
func KeyStr(ev *tcell.EventKey) string {
	return ev.Str()
}
