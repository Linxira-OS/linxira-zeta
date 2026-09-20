package app

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/eugenioenko/ttt/internal/lsp"
	"github.com/eugenioenko/ttt/internal/term"
	"github.com/eugenioenko/ttt/internal/ui"
	"github.com/eugenioenko/ttt/internal/widgets"
)

type SymbolsPanel struct {
	Tree    *widgets.TreeWidget
	Adapter *ui.WidgetAdapter
	// Path is the file the current outline content belongs to; used to
	// clear stale content when the active file changes.
	Path string

	// OnReveal fires while navigating the tree (selection change); it moves
	// the editor cursor without taking focus. OnJump fires on activate
	// (enter/click on a leaf) and also hands focus to the editor.
	OnReveal func(line, col int)
	OnJump   func(line, col int)
}

func NewSymbolsPanel() *SymbolsPanel {
	sp := &SymbolsPanel{}
	// Indent 3 keeps leaf labels visually nested past their parent's label
	// (leaves render no chevron, so indent 2 would align them with it).
	sp.Tree = widgets.NewTreeWidget(widgets.TreeConfig{
		Indent:    3,
		EmptyText: "No symbols",
		OnSelect: func(node *widgets.TreeNode) {
			sp.notify(node, sp.OnReveal)
		},
		OnCommand: func(cmd string, node *widgets.TreeNode) {
			if cmd == "activate" {
				sp.notify(node, sp.OnJump)
			}
		},
	})
	sp.Adapter = ui.NewWidgetAdapter(sp.Tree)
	return sp
}

func (sp *SymbolsPanel) SetSymbols(symbols []lsp.DocumentSymbol) {
	sp.Tree.Config.EmptyText = "No symbols"
	sp.Tree.SetItems(symbolNodes(symbols))
}

// SetStatus clears the outline and shows a message in place of items,
// e.g. why symbols are unavailable for the current file.
func (sp *SymbolsPanel) SetStatus(msg string) {
	sp.Tree.Config.EmptyText = msg
	sp.Tree.SetItems(nil)
}

func (sp *SymbolsPanel) Clear() {
	sp.SetStatus("No symbols")
}

func (sp *SymbolsPanel) notify(node *widgets.TreeNode, cb func(line, col int)) {
	if node == nil || cb == nil {
		return
	}
	line, col, ok := nodePos(node.ID)
	if !ok {
		return
	}
	cb(line, col)
}

// SelectNearest moves the tree selection to the last symbol starting at or
// before the given buffer line, keeping the outline in sync with the cursor.
func (sp *SymbolsPanel) SelectNearest(line int) {
	best, bestLine := -1, -1
	for i, node := range sp.Tree.FlatList() {
		l, _, ok := nodePos(node.ID)
		if !ok {
			continue
		}
		if l <= line && l >= bestLine {
			best, bestLine = i, l
		}
	}
	if best >= 0 {
		sp.Tree.SetSelectedIndex(best)
	}
}

func nodePos(id string) (line, col int, ok bool) {
	sep := strings.IndexByte(id, ':')
	if sep < 0 {
		return 0, 0, false
	}
	line, err := strconv.Atoi(id[:sep])
	if err != nil {
		return 0, 0, false
	}
	col, err = strconv.Atoi(id[sep+1:])
	if err != nil {
		return 0, 0, false
	}
	return line, col, true
}

func symbolNodes(symbols []lsp.DocumentSymbol) []*widgets.TreeNode {
	nodes := make([]*widgets.TreeNode, 0, len(symbols))
	for _, s := range symbols {
		icon, style := symbolIcon(s.Kind)
		node := &widgets.TreeNode{
			ID:        fmt.Sprintf("%d:%d", s.SelectionRange.Start.Line, s.SelectionRange.Start.Character),
			Label:     s.Name,
			Icon:      icon,
			IconStyle: style,
			Children:  symbolNodes(s.Children),
		}
		if len(node.Children) > 0 {
			node.Expandable = true
			node.Expanded = true
		}
		nodes = append(nodes, node)
	}
	return nodes
}

func symbolIcon(kind lsp.SymbolKind) (string, term.Style) {
	switch kind {
	case lsp.SKFunction, lsp.SKConstructor:
		return "ƒ", term.StyleSyntaxFunction
	case lsp.SKMethod:
		return "ƒ", term.StyleSyntaxBuiltin
	case lsp.SKClass, lsp.SKStruct, lsp.SKEnum:
		return "◆", term.StyleSyntaxType
	case lsp.SKInterface:
		return "◇", term.StyleSyntaxType
	case lsp.SKModule, lsp.SKNamespace, lsp.SKPackage, lsp.SKFile:
		return "▤", term.StyleSyntaxComment
	case lsp.SKField, lsp.SKProperty, lsp.SKKey, lsp.SKEnumMember:
		return "▪", term.StyleSyntaxTag
	case lsp.SKConstant:
		return "●", term.StyleSyntaxNumber
	case lsp.SKVariable, lsp.SKObject:
		return "●", term.StyleSyntaxVariable
	case lsp.SKString:
		return "§", term.StyleSyntaxKeyword
	default:
		return "•", term.StyleSyntaxComment
	}
}

// fallbackSymbols provides a built-in outline for languages ttt can parse
// itself; used when no language server is configured or the request fails.
func (a *App) fallbackSymbols(path, lang string) []lsp.DocumentSymbol {
	if !a.EditorGroup.IsEditorActive() || a.EditorGroup.ActiveFilePath() != path {
		return nil
	}
	lines := a.EditorGroup.Editor.Buf.Lines
	switch {
	case isMarkdown(path, lang):
		return markdownSymbols(lines)
	case isGoFile(path, lang):
		return goSymbols(strings.Join(lines, "\n"))
	}
	return nil
}

func isMarkdown(path, lang string) bool {
	if strings.EqualFold(lang, "markdown") {
		return true
	}
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".md" || ext == ".markdown"
}

func isGoFile(path, lang string) bool {
	return strings.EqualFold(lang, "go") || strings.ToLower(filepath.Ext(path)) == ".go"
}

type mdHeading struct {
	level int
	title string
	line  int
}

// markdownSymbols builds an outline from ATX headings for markdown buffers
// when no language server is available. Headings nest by level.
func markdownSymbols(lines []string) []lsp.DocumentSymbol {
	var headings []mdHeading
	inFence := false
	var fenceChar byte
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
			// A fence only closes on the same marker character it opened with.
			if !inFence {
				inFence = true
				fenceChar = trimmed[0]
			} else if trimmed[0] == fenceChar {
				inFence = false
			}
			continue
		}
		if inFence || !strings.HasPrefix(trimmed, "#") {
			continue
		}
		level := 0
		for level < len(trimmed) && trimmed[level] == '#' {
			level++
		}
		if level > 6 || level >= len(trimmed) || trimmed[level] != ' ' {
			continue
		}
		title := strings.TrimSpace(trimmed[level:])
		if title == "" {
			continue
		}
		headings = append(headings, mdHeading{level: level, title: title, line: i})
	}
	symbols, _ := headingTree(headings, 0, 0)
	return symbols
}

func headingTree(headings []mdHeading, start, minLevel int) ([]lsp.DocumentSymbol, int) {
	var out []lsp.DocumentSymbol
	i := start
	for i < len(headings) && headings[i].level >= minLevel {
		h := headings[i]
		children, next := headingTree(headings, i+1, h.level+1)
		pos := lsp.Position{Line: h.line, Character: 0}
		out = append(out, lsp.DocumentSymbol{
			Name:           h.title,
			Kind:           lsp.SKString,
			Range:          lsp.Range{Start: pos, End: pos},
			SelectionRange: lsp.Range{Start: pos, End: pos},
			Children:       children,
		})
		i = next
	}
	return out, i
}
