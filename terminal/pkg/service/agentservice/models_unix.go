//go:build !windows

package agentservice

import "os/exec"

func hideConsoleWindow(_ *exec.Cmd) {}
