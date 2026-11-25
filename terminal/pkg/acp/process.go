// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package acp

import (
	"fmt"
	"io"
	"os/exec"
	"sync"
)

// ProcessConfig describes the child process to spawn. The command is executed
// directly: no shell, no PTY, and with exactly the supplied environment.
type ProcessConfig struct {
	Command string
	Args    []string
	Dir     string
	Env     []string
}

type childProcess struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr io.ReadCloser

	killOnce sync.Once
	killTree func()
	cleanup  func()

	exited  chan struct{}
	waitErr error
}

func startChildProcess(cfg ProcessConfig) (*childProcess, error) {
	if cfg.Command == "" {
		return nil, fmt.Errorf("acp: empty command")
	}
	cmd := exec.Command(cfg.Command, cfg.Args...)
	cmd.Dir = cfg.Dir
	cmd.Env = cfg.Env
	cmd.SysProcAttr = processSysProcAttr()

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("acp: stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("acp: stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("acp: stderr pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("acp: starting %q: %w", cfg.Command, err)
	}

	killTree, cleanup, treeErr := attachProcessTree(cmd.Process.Pid)
	if treeErr != nil {
		// The process is still usable; cleanup degrades to killing the direct
		// child instead of its whole tree.
		killTree = func() { _ = cmd.Process.Kill() }
		cleanup = func() {}
	}
	p := &childProcess{
		cmd:      cmd,
		stdin:    stdin,
		stdout:   stdout,
		stderr:   stderr,
		killTree: killTree,
		cleanup:  cleanup,
		exited:   make(chan struct{}),
	}
	return p, nil
}

// wait must be called exactly once. It reaps the process and releases any
// platform process-tree handle.
func (p *childProcess) wait() error {
	err := p.cmd.Wait()
	p.waitErr = err
	close(p.exited)
	p.cleanup()
	return err
}

func (p *childProcess) kill() {
	p.killOnce.Do(func() {
		if p.killTree != nil {
			p.killTree()
		}
	})
}
