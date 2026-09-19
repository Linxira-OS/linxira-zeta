package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type EditorConfigProps struct {
	IndentStyle        string // "tab" or "space"
	IndentSize         int    // 0 means unset
	TrimTrailingWS     bool
	TrimTrailingWSSet  bool
	InsertFinalNewline bool
	InsertFinalNLSet   bool
}

type editorConfigSection struct {
	pattern string
	props   map[string]string
}

func LoadEditorConfig(filePath string) EditorConfigProps {
	var result EditorConfigProps
	dir := filepath.Dir(filePath)
	name := filepath.Base(filePath)

	var files []string
	for {
		ec := filepath.Join(dir, ".editorconfig")
		if _, err := os.Stat(ec); err == nil {
			files = append(files, ec)
		}
		if isRoot(ec) {
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}

	// Process from outermost to innermost (later overrides earlier)
	for i := len(files) - 1; i >= 0; i-- {
		sections := parseEditorConfigFile(files[i])
		for _, sec := range sections {
			if matchGlob(sec.pattern, name) {
				applyProps(&result, sec.props)
			}
		}
	}

	return result
}

func isRoot(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || line[0] == '#' || line[0] == ';' {
			continue
		}
		if line[0] == '[' {
			return false
		}
		k, v := parseKV(line)
		if strings.ToLower(k) == "root" && strings.ToLower(v) == "true" {
			return true
		}
	}
	return false
}

func parseEditorConfigFile(path string) []editorConfigSection {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var sections []editorConfigSection
	var current *editorConfigSection

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || line[0] == '#' || line[0] == ';' {
			continue
		}
		if line[0] == '[' && line[len(line)-1] == ']' {
			pattern := line[1 : len(line)-1]
			sections = append(sections, editorConfigSection{
				pattern: pattern,
				props:   make(map[string]string),
			})
			current = &sections[len(sections)-1]
			continue
		}
		if current != nil {
			k, v := parseKV(line)
			if k != "" {
				current.props[strings.ToLower(k)] = v
			}
		}
	}
	return sections
}

func parseKV(line string) (string, string) {
	idx := strings.IndexAny(line, "=:")
	if idx < 0 {
		return "", ""
	}
	return strings.TrimSpace(line[:idx]), strings.TrimSpace(line[idx+1:])
}

func applyProps(result *EditorConfigProps, props map[string]string) {
	if v, ok := props["indent_style"]; ok {
		result.IndentStyle = strings.ToLower(v)
	}
	if v, ok := props["indent_size"]; ok {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			result.IndentSize = n
		}
	}
	if v, ok := props["trim_trailing_whitespace"]; ok {
		result.TrimTrailingWS = strings.ToLower(v) == "true"
		result.TrimTrailingWSSet = true
	}
	if v, ok := props["insert_final_newline"]; ok {
		result.InsertFinalNewline = strings.ToLower(v) == "true"
		result.InsertFinalNLSet = true
	}
}

// matchGlob matches a filename against an editorconfig glob pattern.
// Supports: *, ?, {a,b}, and bare extensions like *.go
func matchGlob(pattern, name string) bool {
	if pattern == "*" {
		return true
	}

	// Handle {a,b,c} alternation by expanding
	if idx := strings.Index(pattern, "{"); idx >= 0 {
		end := strings.Index(pattern[idx:], "}")
		if end > 0 {
			prefix := pattern[:idx]
			suffix := pattern[idx+end+1:]
			alts := strings.Split(pattern[idx+1:idx+end], ",")
			for _, alt := range alts {
				if matchGlob(prefix+alt+suffix, name) {
					return true
				}
			}
			return false
		}
	}

	return globMatch(pattern, name)
}

func globMatch(pattern, name string) bool {
	px, nx := 0, 0
	starPx, starNx := -1, -1

	for nx < len(name) {
		if px < len(pattern) && pattern[px] == '*' {
			starPx = px
			starNx = nx
			px++
			continue
		}
		if px < len(pattern) && (pattern[px] == '?' || pattern[px] == name[nx]) {
			px++
			nx++
			continue
		}
		if starPx >= 0 {
			px = starPx + 1
			starNx++
			nx = starNx
			continue
		}
		return false
	}

	for px < len(pattern) && pattern[px] == '*' {
		px++
	}
	return px == len(pattern)
}
