// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentservice

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/acp"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type AgentService struct{}

var AgentServiceInstance = &AgentService{}

func (as *AgentService) getController(blockId string) (*blockcontroller.AgentController, error) {
	agent := blockcontroller.GetAgentController(blockId)
	if agent == nil {
		return nil, fmt.Errorf("no agent controller for block %q", blockId)
	}
	return agent, nil
}

func (*AgentService) Start_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "ensure an agent controller and ACP session are running for a block",
		ArgNames: []string{"ctx", "blockId"},
	}
}

func (*AgentService) Stop_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "stop the agent controller and terminate its process tree",
		ArgNames: []string{"ctx", "blockId"},
	}
}

func (*AgentService) Prompt_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "send a prompt to the agent session (returns when the request is written)",
		ArgNames: []string{"ctx", "blockId", "text"},
	}
}

func (*AgentService) Cancel_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "cancel the active agent turn",
		ArgNames: []string{"ctx", "blockId"},
	}
}

func (*AgentService) RespondPermission_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "answer a permission request with an optionId from its options, or an empty string to deny",
		ArgNames: []string{"ctx", "blockId", "requestId", "optionId"},
	}
}

func (*AgentService) SetMode_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "change the agent session mode",
		ArgNames: []string{"ctx", "blockId", "modeId"},
	}
}

func (*AgentService) SetModel_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "change the agent session model config option",
		ArgNames: []string{"ctx", "blockId", "modelId"},
	}
}

func (*AgentService) SetConfigOption_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "change any advertised agent session config option",
		ArgNames: []string{"ctx", "blockId", "configId", "value"},
	}
}

func (*AgentService) GetStatus_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "get the last published agent status",
		ArgNames: []string{"ctx", "blockId"},
	}
}

// Start ensures the block has a running agent controller. The call returns as
// soon as the controller has started its handshake; progress and errors arrive
// as agent:status events.
func (as *AgentService) Start(ctx context.Context, blockId string) error {
	if blockId == "" {
		return fmt.Errorf("blockid is required")
	}
	agent := blockcontroller.GetAgentController(blockId)
	if agent != nil && agent.GetRuntimeStatus().ShellProcStatus == blockcontroller.Status_Running {
		return nil
	}
	tabId, err := wstore.DBFindTabForBlockId(ctx, blockId)
	if err != nil {
		return fmt.Errorf("error finding tab for block: %w", err)
	}
	return blockcontroller.ResyncController(ctx, tabId, blockId, nil, false)
}

// Stop destroys the agent controller and terminates its process tree.
func (as *AgentService) Stop(ctx context.Context, blockId string) error {
	if blockId == "" {
		return fmt.Errorf("blockid is required")
	}
	blockcontroller.DestroyBlockController(blockId)
	return nil
}

// Prompt sends a user prompt. It returns once the request is written; the
// turn streams through the agent blockfile and agent:status events.
func (as *AgentService) Prompt(ctx context.Context, blockId string, text string) error {
	agent, err := as.getController(blockId)
	if err != nil {
		return err
	}
	return agent.Prompt(text)
}

// Cancel requests cancellation of the active turn.
func (as *AgentService) Cancel(ctx context.Context, blockId string) error {
	agent, err := as.getController(blockId)
	if err != nil {
		return err
	}
	return agent.Cancel()
}

// RespondPermission answers a session/request_permission request. Pass an
// optionId from the request's options, or the empty string to deny/cancel.
func (as *AgentService) RespondPermission(ctx context.Context, blockId string, requestId string, optionId string) error {
	agent, err := as.getController(blockId)
	if err != nil {
		return err
	}
	return agent.RespondPermission(requestId, optionId)
}

// SetMode changes the session mode (config option "mode").
func (as *AgentService) SetMode(ctx context.Context, blockId string, modeId string) error {
	agent, err := as.getController(blockId)
	if err != nil {
		return err
	}
	return agent.SetMode(modeId)
}

// SetModel changes the session model (config option "model").
func (as *AgentService) SetModel(ctx context.Context, blockId string, modelId string) error {
	agent, err := as.getController(blockId)
	if err != nil {
		return err
	}
	return agent.SetModel(modelId)
}

// SetConfigOption changes any advertised session config option.
func (as *AgentService) SetConfigOption(ctx context.Context, blockId string, configId string, value string) error {
	agent, err := as.getController(blockId)
	if err != nil {
		return err
	}
	return agent.SetConfigOption(configId, value)
}

// GetStatus returns the last published agent status for reconnect/render.
func (as *AgentService) GetStatus(ctx context.Context, blockId string) (*acp.StatusData, error) {
	agent, err := as.getController(blockId)
	if err != nil {
		return nil, err
	}
	return agent.GetStatus(), nil
}
