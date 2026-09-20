package term

import (
	"strings"

	"github.com/gdamore/tcell/v3"
)

// CollectPasteText reconstructs text from a sequence of tcell key events
// delivered during a bracketed paste. tcell delivers \r as KeyEnter and
// \n as KeyCtrlJ; CRLF line endings produce both in sequence. This function
// normalizes all line endings to \n.
func CollectPasteText(events []*tcell.EventKey) string {
	var buf strings.Builder
	for _, ev := range events {
		switch ev.Key() {
		case tcell.KeyRune:
			if ev.Modifiers()&tcell.ModCtrl != 0 {
				// tcell v3 legacy mode delivers raw control bytes that have
				// no KeyCtrl* letter code (NUL, 0x1C-0x1F) as KeyRune with
				// ModCtrl and a shifted-up string (" ", "\\", "]", "^", "_").
				// Drop them like the KeyCtrl* codes are dropped.
				continue
			}
			buf.WriteString(KeyStr(ev))
		case tcell.KeyEnter:
			buf.WriteRune('\r')
		case tcell.KeyCtrlJ:
			buf.WriteRune('\n')
		case tcell.KeyTab:
			buf.WriteRune('\t')
		}
	}
	text := buf.String()
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return text
}
