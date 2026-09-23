package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Handoff is the payload zeta writes when it hands a session to the editor.
// Field names mirror plugins/official/pi-messenger/handoff.ts — the two sides
// are separate processes with no shared code, so the contract lives in both
// and must be changed in lock-step.
type Handoff struct {
	Cwd         string `json:"cwd"`
	GitRoot     string `json:"gitRoot"`
	SessionFile string `json:"sessionFile,omitempty"`
	File        string `json:"file,omitempty"`
	From        string `json:"from,omitempty"`
	Ts          int64  `json:"ts,omitempty"`
}

// handoffPath resolves ~/.zeta/handoff.json. ZETA_HANDOFF_PATH overrides it for
// tests; ZETA_CONFIG_DIR mirrors the zeta side's config-dir override.
func handoffPath() string {
	if override := os.Getenv("ZETA_HANDOFF_PATH"); override != "" {
		return override
	}
	base := os.Getenv("ZETA_CONFIG_DIR")
	if base == "" {
		if home, err := os.UserHomeDir(); err == nil {
			base = filepath.Join(home, ".zeta")
		}
	}
	if base == "" {
		return ""
	}
	return filepath.Join(base, "handoff.json")
}

// consumeHandoff reads and removes the handoff file. A missing or malformed
// file is not an error: the editor must start normally either way. Returns
// nil when there is nothing to apply.
func consumeHandoff() *Handoff {
	path := handoffPath()
	if path == "" {
		return nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	// Remove first: a crash between read and unlink would otherwise replay a
	// stale context on the next launch.
	_ = os.Remove(path)
	var h Handoff
	if err := json.Unmarshal(raw, &h); err != nil {
		return nil
	}
	if h.Cwd == "" {
		return nil
	}
	return &h
}

// ApplyHandoff consumes the handoff file (if any) and opens the context it
// describes. Called once during startup after Init so widgets and commands
// exist. Explicit command-line arguments always win — the handoff only fills
// in what the user did not ask for.
func (a *App) ApplyHandoff() {
	a.applyHandoff(consumeHandoff())
}

// applyHandoff opens the handed-off context: the directory as workspace root
// and the file target (path:line:col) as a tab with the cursor positioned.
// Explicit command-line arguments always win — the handoff only fills in what
// the user did not ask for.
func (a *App) applyHandoff(h *Handoff) {
	if h == nil {
		return
	}
	root := h.Cwd
	if root == "" {
		root = h.GitRoot
	}
	if root == "" {
		return
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		return
	}

	// Only replace the workspace when the current one is not already this
	// directory: launching `zeta-editor .` from the same folder must not tear
	// down open tabs.
	if len(a.Workspace.Paths()) == 0 || a.Workspace.Paths()[0] != root {
		a.Workspace.Folders = nil
		a.Workspace.AddFolder(root)
		a.refreshWorkspaceWidgets()
	}

	if h.File == "" {
		return
	}
	filePath, line, col := splitFileTarget(h.File)
	if filePath == "" {
		return
	}
	if !filepath.IsAbs(filePath) {
		filePath = filepath.Join(root, filePath)
	}
	a.EditorGroup.OpenFile(filePath)
	if line > 0 {
		a.EditorGroup.GoToLineCol(line, col)
	}
	a.FocusEditor()
}

// splitFileTarget splits "path:line:col" (line/col 1-based, optional). Windows
// drive letters contain a colon, so a colon only starts the position when the
// remainder is numeric.
func splitFileTarget(target string) (path string, line, col int) {
	trimmed := strings.TrimSpace(target)
	if trimmed == "" {
		return "", 0, 0
	}
	// Find the colon that starts the position. A drive letter (C:\...) has its
	// colon at index 1, so skip that one; everything before the first
	// qualifying colon is the path.
	search := 0
	if len(trimmed) > 1 && trimmed[1] == ':' {
		search = 2
	}
	idx := strings.Index(trimmed[search:], ":")
	if idx < 0 {
		return trimmed, 0, 0
	}
	idx += search
	rest := trimmed[idx+1:]
	linePart, colPart, hasCol := strings.Cut(rest, ":")
	line = atoiSafe(linePart)
	if line == 0 {
		return trimmed, 0, 0
	}
	if hasCol {
		col = atoiSafe(colPart)
	}
	return trimmed[:idx], line, col
}

// formatHandoffFileTarget builds "path:line:col" (1-based, matching the TS
// side's formatFileTarget) and omits positions that are not positive.
func formatHandoffFileTarget(path string, line, col int) string {
	if line <= 0 {
		return path
	}
	if col <= 0 {
		return path + ":" + itoa(line)
	}
	return path + ":" + itoa(line) + ":" + itoa(col)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	negative := n < 0
	if negative {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if negative {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// writeEditorHandoff is the editor→zeta half of the contract: same file, same
// fields, From marks the direction so the receiving side can tell them apart.
func writeEditorHandoff(cwd, file string) error {
	path := handoffPath()
	if path == "" {
		return errString("no handoff path (home directory unavailable)")
	}
	payload := Handoff{
		Cwd:     cwd,
		GitRoot: "", // TEMP-DEBUG
		File:    file,
		From:    "editor",
		Ts:      time.Now().UnixMilli(),
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	// Write-then-rename so a concurrent switch never reads a partial file.
	tmp := path + ".editor.tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func atoiSafe(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0
		}
		n = n*10 + int(r-'0')
	}
	return n
}
