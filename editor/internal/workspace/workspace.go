package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type Folder struct {
	Path   string
	IsRepo bool
}

type Workspace struct {
	Folders  []Folder
	FilePath string
}

type workspaceFile struct {
	Folders []workspaceFolder `json:"folders"`
}

type workspaceFolder struct {
	Path string `json:"path"`
}

func ExpandPath(path string) string {
	if path == "~" {
		if home, err := os.UserHomeDir(); err == nil {
			return home
		}
	}
	if strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, path[2:])
		}
	}
	return path
}

func New(paths []string) *Workspace {
	w := &Workspace{}
	for _, p := range paths {
		w.AddFolder(p)
	}
	return w
}

func (w *Workspace) AddFolder(path string) {
	abs, err := filepath.Abs(ExpandPath(path))
	if err != nil {
		abs = path
	}
	for _, f := range w.Folders {
		if f.Path == abs {
			return
		}
	}
	w.Folders = append(w.Folders, Folder{
		Path:   abs,
		IsRepo: isGitRepo(abs),
	})
}

func (w *Workspace) RemoveFolder(path string) {
	abs, err := filepath.Abs(ExpandPath(path))
	if err != nil {
		abs = path
	}
	for i, f := range w.Folders {
		if f.Path == abs {
			w.Folders = append(w.Folders[:i], w.Folders[i+1:]...)
			return
		}
	}
}

func (w *Workspace) Paths() []string {
	paths := make([]string, len(w.Folders))
	for i, f := range w.Folders {
		paths[i] = f.Path
	}
	return paths
}

func (w *Workspace) FolderForFile(absPath string) *Folder {
	var best *Folder
	bestLen := 0
	for i := range w.Folders {
		prefix := w.Folders[i].Path + string(filepath.Separator)
		if strings.HasPrefix(absPath, prefix) && len(prefix) > bestLen {
			best = &w.Folders[i]
			bestLen = len(prefix)
		}
	}
	return best
}

func (w *Workspace) Primary() string {
	if len(w.Folders) == 0 {
		return ""
	}
	return w.Folders[0].Path
}

func LoadFile(path string) (*Workspace, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var wf workspaceFile
	if err := json.Unmarshal(data, &wf); err != nil {
		return nil, err
	}
	dir := filepath.Dir(path)
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	var paths []string
	for _, f := range wf.Folders {
		p := f.Path
		if !filepath.IsAbs(p) {
			p = filepath.Join(dir, p)
		}
		paths = append(paths, p)
	}
	ws := New(paths)
	ws.FilePath = abs
	return ws, nil
}

func (w *Workspace) SaveFile(path string) error {
	dir := filepath.Dir(path)
	var wf workspaceFile
	for _, f := range w.Folders {
		rel, err := filepath.Rel(dir, f.Path)
		if err != nil {
			rel = f.Path
		}
		wf.Folders = append(wf.Folders, workspaceFolder{Path: rel})
	}
	data, err := json.MarshalIndent(wf, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0644)
}

func isGitRepo(path string) bool {
	info, err := os.Stat(filepath.Join(path, ".git"))
	if err != nil {
		return false
	}
	return info.IsDir()
}
