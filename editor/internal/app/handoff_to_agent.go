package app

import (
	"os"
	"os/exec"
	"path/filepath"

	"github.com/eugenioenko/ttt/internal/command"
)

// Hand the session back to the agent CLI.
//
// This is the editor→zeta half of the handoff contract (see handoff.go): the
// editor writes the same file the CLI writes, then spawns `zeta` pointed at
// the workspace root so the agent resumes in the right repository. The
// session id is not carried — the editor does not own conversations — so the
// CLI opens its own resume picker over that directory.
//
// Spawn is detached (no wait, no stdio) so closing the editor never takes the
// agent down with it, mirroring OpenURL's fire-and-forget model.
func (a *App) SwitchToAgent(withCurrentFile bool) {
	if !a.Settings.Agent.IsEnabled() {
		a.StatusNotify("Agent handoff is disabled (Settings → Agent → Enabled)")
		return
	}
	// The per-call flag is an AND with the persistent setting: the menu offers
	// both variants, and a user who turned file handoff off gets neither.
	if withCurrentFile && !a.Settings.Agent.HandsOffFile() {
		withCurrentFile = false
	}
	cwd := a.Workspace.Primary()
	if cwd == "" {
		if wd, err := os.Getwd(); err == nil {
			cwd = wd
		}
	}

	file := ""
	if withCurrentFile {
		if p := a.EditorGroup.ActiveFilePath(); p != "" {
			line, col, ok := a.EditorGroup.CursorPosition()
			if ok {
				file = formatHandoffFileTarget(p, line+1, col+1)
			} else {
				file = p
			}
		}
	}

	if err := writeEditorHandoff(cwd, file); err != nil {
		a.StatusError("Could not write the agent handoff: " + err.Error())
		return
	}

	if err := spawnZeta(cwd); err != nil {
		a.StatusError("Could not start the agent CLI: " + err.Error())
		return
	}
	a.StatusNotify("Handed off to the agent CLI")
}

// spawnZeta launches the agent CLI detached in dir. PATH is consulted first
// (a global npm install), then the plugin install location, then the repo
// checkout's dev entry — the last covers running the editor from source.
func spawnZeta(dir string) error {
	home, _ := os.UserHomeDir()
	pluginBin := ""
	if home != "" {
		pluginBin = filepath.Join(home, ".zeta", "plugins", "node_modules", ".bin", "zeta")
	}
	candidates := []string{"zeta", "zeta.cmd"}
	if pluginBin != "" {
		if _, err := os.Stat(pluginBin); err == nil {
			candidates = append(candidates, pluginBin)
		}
	}
	for _, bin := range candidates {
		cmd := exec.Command(bin, "--resume")
		cmd.Dir = dir
		if err := cmd.Start(); err == nil {
			return nil
		}
	}
	return errZetaNotFound
}

var errZetaNotFound = errString("zeta CLI not found on PATH")

type errString string

func (e errString) Error() string { return string(e) }

// registerHandoffCommands exposes the editor→agent direction in the command
// registry (so the Agent menu, the palette and keybindings can all reach it).
func registerHandoffCommands(app *App) {
	reg := app.Reg
	reg.Register(command.Command{
		ID:       "handoff.toAgent",
		Title:    "Switch to Agent",
		Keywords: []string{"agent", "zeta", "switch", "handoff"},
		Handler:  func() { app.SwitchToAgent(false) },
	})
	reg.Register(command.Command{
		ID:       "handoff.toAgentWithFile",
		Title:    "Switch to Agent with Current File",
		Keywords: []string{"agent", "zeta", "switch", "file", "handoff"},
		Handler:  func() { app.SwitchToAgent(true) },
	})
}
