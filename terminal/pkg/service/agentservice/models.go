// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentservice

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
)

const modelsCacheTTL = 30 * time.Second

var modelsCache struct {
	sync.Mutex
	at   time.Time
	data string
}

func (*AgentService) ListModels_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "list Zeta Code models as the JSON payload of `zetacode models --json`",
		ArgNames: []string{"ctx"},
	}
}

// ListModels returns the catalog JSON the settings page renders. The CLI owns
// provider discovery, credentials and model metadata; wavesrv only caches the
// last answer briefly so opening settings does not spawn a process per render.
func (*AgentService) ListModels(ctx context.Context) (string, error) {
	modelsCache.Lock()
	if modelsCache.data != "" && time.Since(modelsCache.at) < modelsCacheTTL {
		data := modelsCache.data
		modelsCache.Unlock()
		return data, nil
	}
	modelsCache.Unlock()

	command := os.Getenv("ZETACODE_PATH")
	if command == "" {
		command = "zetacode"
	}
	cmd := exec.CommandContext(ctx, command, "models", "--json", "--kind", "chat")
	hideConsoleWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && len(exitErr.Stderr) > 0 {
			return "", fmt.Errorf("zetacode models failed: %s", string(exitErr.Stderr))
		}
		return "", fmt.Errorf("zetacode models failed: %w", err)
	}
	data := string(out)
	modelsCache.Lock()
	modelsCache.at = time.Now()
	modelsCache.data = data
	modelsCache.Unlock()
	return data, nil
}
