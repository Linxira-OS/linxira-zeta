// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package acp

import (
	"syscall"
)

func processSysProcAttr() *syscall.SysProcAttr {
	// A new session has no controlling terminal, so the agent and anything it
	// runs cannot open /dev/tty and interfere with the client.
	return &syscall.SysProcAttr{Setsid: true}
}

func attachProcessTree(pid int) (kill func(), cleanup func(), err error) {
	return func() {
			// Negative pid addresses the session/process group created by Setsid.
			_ = syscall.Kill(-pid, syscall.SIGKILL)
		}, func() {
		}, nil
}
