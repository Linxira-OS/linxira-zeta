// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/acp"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/utilds"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	DefaultAgentMaxFileSize = 8 * 1024 * 1024
	agentHandshakeTimeout   = 60 * time.Second
	agentSessionTimeout     = 5 * time.Minute
	agentDialTimeout        = 10 * time.Second
)

type agentConfigState struct {
	modes         any
	configOptions any
	commands      any
	agentInfo     any
}

// AgentController owns one zetacode ACP child process for an agent block. It
// streams session updates into the block's "agent" blockfile and publishes
// agent:status, agent:permission, and agent:config events.
type AgentController struct {
	Lock *sync.Mutex

	TabId    string
	BlockId  string
	ConnName string

	ProcStatus   string
	ProcExitCode int
	VersionTs    utilds.VersionTs

	client          *acp.Client
	stream          *acp.Stream
	cancelHandshake context.CancelFunc
	started         bool
	stopped         bool
	stopOnce        sync.Once
	sessionId       string
	status          acp.StatusData
	config          agentConfigState
	pendingPrompts  int
	pendingPerms    int
}

func MakeAgentController(tabId string, blockId string, connName string) Controller {
	return &AgentController{
		Lock:       &sync.Mutex{},
		TabId:      tabId,
		BlockId:    blockId,
		ConnName:   connName,
		ProcStatus: Status_Init,
		status: acp.StatusData{
			BlockId: blockId,
			Status:  acp.StatusStarting,
		},
	}
}

// GetAgentController returns the agent controller for a block, or nil when the
// block is not running an agent controller.
func GetAgentController(blockId string) *AgentController {
	controller := getController(blockId)
	if controller == nil {
		return nil
	}
	agent, _ := controller.(*AgentController)
	return agent
}

func (ac *AgentController) Start(ctx context.Context, blockMeta waveobj.MetaMapType, rtOpts *waveobj.RuntimeOpts, force bool) error {
	if !conncontroller.IsLocalConnName(ac.ConnName) {
		return fmt.Errorf("agent blocks require a local connection (got %q)", ac.ConnName)
	}
	ac.Lock.Lock()
	if ac.started || ac.stopped {
		ac.Lock.Unlock()
		return nil
	}
	ac.started = true
	ac.ProcStatus = Status_Running
	startCtx, cancel := context.WithCancel(context.Background())
	ac.cancelHandshake = cancel
	ac.Lock.Unlock()

	ac.prepareBlockFile()
	ac.setStatus(acp.StatusStarting, "", "")
	go ac.run(startCtx, blockMeta)
	return nil
}

func (ac *AgentController) prepareBlockFile() {
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()
	err := filestore.WFS.MakeFile(ctx, ac.BlockId, wavebase.BlockFile_Agent, nil, wshrpc.FileOpts{
		MaxSize:  DefaultAgentMaxFileSize,
		Circular: true,
	})
	if err != nil && !errors.Is(err, fs.ErrExist) {
		log.Printf("agent[%s]: could not create blockfile: %v", ac.BlockId, err)
	}
	ac.truncateBlockFile()
	stream := acp.NewStream(func(data []byte) error {
		if err := HandleAppendBlockFile(ac.BlockId, wavebase.BlockFile_Agent, data); err != nil {
			log.Printf("agent[%s]: blockfile append failed: %v", ac.BlockId, err)
			return err
		}
		return nil
	})
	ac.Lock.Lock()
	if ac.stopped {
		ac.Lock.Unlock()
		stream.Close()
		return
	}
	ac.stream = stream
	ac.Lock.Unlock()
}

func (ac *AgentController) truncateBlockFile() {
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()
	if err := filestore.WFS.WriteFile(ctx, ac.BlockId, wavebase.BlockFile_Agent, nil); err != nil && !errors.Is(err, fs.ErrNotExist) {
		log.Printf("agent[%s]: could not truncate blockfile: %v", ac.BlockId, err)
		return
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_BlockFile,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, ac.BlockId).String()},
		Data: &wps.WSFileEventData{
			ZoneId:   ac.BlockId,
			FileName: wavebase.BlockFile_Agent,
			FileOp:   wps.FileOp_Truncate,
		},
	})
}

func (ac *AgentController) run(ctx context.Context, blockMeta waveobj.MetaMapType) {
	cwd, err := resolveAgentCwd(blockMeta)
	if err != nil {
		ac.failStart(err)
		return
	}
	command, args, err := resolveAgentCommand()
	if err != nil {
		ac.failStart(err)
		return
	}
	extraEnv, err := resolveEnvMap(ac.BlockId, blockMeta, ac.ConnName)
	if err != nil {
		ac.failStart(fmt.Errorf("resolving block environment: %w", err))
		return
	}

	client, err := acp.StartProcess(acp.ClientOptions{
		Command:    command,
		Args:       args,
		Dir:        cwd,
		Env:        buildAgentEnv(extraEnv),
		ClientInfo: acp.Implementation{Name: "zeta", Title: "Zeta Code", Version: wavebase.WaveVersion},
		OnUpdate:   ac.onSessionUpdate,
		OnPermission: func(req *acp.PermissionRequestData) {
			ac.onPermissionRequest(req)
		},
		OnPermissionCancelled: ac.onPermissionCancelled,
		OnPromptDone:          ac.onPromptDone,
		OnStderr: func(line string) {
			log.Printf("agent[%s] stderr: %s", ac.BlockId, line)
		},
		OnExit: ac.onProcessExit,
	})
	if err != nil {
		ac.failStart(err)
		return
	}

	ac.Lock.Lock()
	if ac.stopped {
		ac.Lock.Unlock()
		_ = client.Close()
		return
	}
	ac.client = client
	ac.Lock.Unlock()

	handshakeCtx, cancel := context.WithTimeout(ctx, agentHandshakeTimeout)
	defer cancel()
	initRes, err := client.Initialize(handshakeCtx)
	if err != nil {
		ac.abortClient(client, fmt.Errorf("initialize failed: %w", err))
		return
	}
	if err := client.Authenticate(handshakeCtx, "agent"); err != nil {
		ac.abortClient(client, fmt.Errorf("authenticate failed: %w", err))
		return
	}
	ac.setAgentInfo(initRes.AgentInfo)

	setup, err := ac.openSession(ctx, client, blockMeta, cwd)
	if err != nil {
		ac.abortClient(client, err)
		return
	}
	ac.applySessionSetup(setup)
	ac.persistSessionMeta(client.SessionId(), cwd)
	ac.setStatus(acp.StatusIdle, "", "")
}

// openSession resumes the persisted session when possible, otherwise starts a
// new one. A partial replay from a failed load is discarded before falling
// back to session/new.
func (ac *AgentController) openSession(ctx context.Context, client *acp.Client, blockMeta waveobj.MetaMapType, cwd string) (*acp.SessionSetup, error) {
	sessionId := blockMeta.GetString(waveobj.MetaKey_AgentSessionId, "")
	if sessionId != "" {
		loadCtx, cancel := context.WithTimeout(ctx, agentSessionTimeout)
		setup, err := client.LoadSession(loadCtx, sessionId, cwd)
		cancel()
		if err == nil {
			return setup, nil
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		log.Printf("agent[%s]: could not load session %s (starting new session): %v", ac.BlockId, sessionId, err)
		if stream := ac.getStream(); stream != nil {
			stream.AddReset(ac.BlockId)
		}
	}
	newCtx, cancel := context.WithTimeout(ctx, agentSessionTimeout)
	defer cancel()
	return client.NewSession(newCtx, cwd)
}

func (ac *AgentController) abortClient(client *acp.Client, err error) {
	errText := err.Error()
	if stderr := client.LastStderr(); len(stderr) > 0 {
		tail := stderr
		if len(tail) > 5 {
			tail = tail[len(tail)-5:]
		}
		errText += "\n" + strings.Join(tail, "\n")
	}
	ac.Lock.Lock()
	if ac.client == client {
		ac.client = nil
	}
	ac.ProcStatus = Status_Done
	ac.Lock.Unlock()
	ac.setStatus(acp.StatusError, "", errText)
	_ = client.Close()
}

func (ac *AgentController) failStart(err error) {
	log.Printf("agent[%s]: %v", ac.BlockId, err)
	ac.Lock.Lock()
	ac.ProcStatus = Status_Done
	ac.Lock.Unlock()
	ac.setStatus(acp.StatusError, "", err.Error())
}

func (ac *AgentController) onProcessExit(err error) {
	ac.Lock.Lock()
	stopped := ac.stopped
	ac.ProcStatus = Status_Done
	ac.Lock.Unlock()
	if stopped {
		return
	}
	errText := ""
	if err != nil {
		errText = err.Error()
	}
	ac.setStatus(acp.StatusError, "", errText)
}

func (ac *AgentController) onSessionUpdate(sessionId string, update json.RawMessage) {
	stream := ac.getStream()
	if stream != nil {
		stream.AddUpdate(sessionId, update)
	}
	var probe struct {
		SessionUpdate     string          `json:"sessionUpdate"`
		CurrentModeId     string          `json:"currentModeId"`
		ConfigOptions     json.RawMessage `json:"configOptions"`
		AvailableCommands json.RawMessage `json:"availableCommands"`
	}
	if err := json.Unmarshal(update, &probe); err != nil {
		return
	}
	switch probe.SessionUpdate {
	case "current_mode_update":
		ac.updateConfig(func(c *agentConfigState) {
			c.modes = withCurrentMode(c.modes, probe.CurrentModeId)
		})
	case "config_option_update":
		if len(probe.ConfigOptions) > 0 {
			options := decodeJSON(probe.ConfigOptions)
			ac.updateConfig(func(c *agentConfigState) { c.configOptions = options })
		}
	case "available_commands_update":
		if len(probe.AvailableCommands) > 0 {
			commands := decodeJSON(probe.AvailableCommands)
			ac.updateConfig(func(c *agentConfigState) { c.commands = commands })
		}
	}
}

func (ac *AgentController) onPermissionRequest(req *acp.PermissionRequestData) {
	req.BlockId = ac.BlockId
	ac.Lock.Lock()
	ac.pendingPerms++
	sessionId := ac.sessionId
	ac.Lock.Unlock()
	if req.SessionId == "" {
		req.SessionId = sessionId
	}
	stream := ac.getStream()
	if stream != nil {
		stream.AddPermission(req)
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_AgentPermission,
		Scopes: ac.eventScopes(),
		Data:   req,
	})
	ac.setStatus(acp.StatusWaitingPermission, "", "")
}

func (ac *AgentController) onPermissionCancelled(requestId string) {
	stream := ac.getStream()
	if stream != nil {
		stream.AddPermissionResolved(&acp.PermissionResolutionData{
			BlockId:   ac.BlockId,
			RequestId: requestId,
			Cancelled: true,
		})
	}
	ac.finishPermission()
}

func (ac *AgentController) finishPermission() {
	ac.Lock.Lock()
	if ac.pendingPerms > 0 {
		ac.pendingPerms--
	}
	pending := ac.pendingPerms
	prompts := ac.pendingPrompts
	ac.Lock.Unlock()
	if pending > 0 {
		ac.setStatus(acp.StatusWaitingPermission, "", "")
		return
	}
	if prompts > 0 {
		ac.setStatus(acp.StatusRunning, "", "")
		return
	}
	ac.setStatus(acp.StatusIdle, "", "")
}

func (ac *AgentController) onPromptDone(done acp.PromptDone) {
	ac.Lock.Lock()
	if ac.pendingPrompts > 0 {
		ac.pendingPrompts--
	}
	remaining := ac.pendingPrompts
	ac.Lock.Unlock()
	if done.Err != nil {
		ac.setStatus(acp.StatusError, "", done.Err.Error())
		return
	}
	if remaining > 0 {
		return
	}
	ac.setStatus(acp.StatusIdle, done.StopReason, "")
}

func (ac *AgentController) setAgentInfo(info *acp.Implementation) {
	if info == nil {
		return
	}
	ac.updateConfig(func(c *agentConfigState) { c.agentInfo = info })
}

func (ac *AgentController) applySessionSetup(setup *acp.SessionSetup) {
	ac.Lock.Lock()
	ac.sessionId = setup.SessionId
	ac.config.modes = decodeJSON(setup.Modes)
	ac.config.configOptions = decodeJSON(setup.ConfigOptions)
	ac.Lock.Unlock()
	ac.publishConfig()
}

func (ac *AgentController) updateConfig(fn func(*agentConfigState)) {
	ac.Lock.Lock()
	fn(&ac.config)
	ac.Lock.Unlock()
	ac.publishConfig()
}

func (ac *AgentController) publishConfig() {
	ac.Lock.Lock()
	data := &acp.ConfigData{
		BlockId:           ac.BlockId,
		SessionId:         ac.sessionId,
		Modes:             ac.config.modes,
		ConfigOptions:     ac.config.configOptions,
		AvailableCommands: ac.config.commands,
		AgentInfo:         ac.config.agentInfo,
	}
	stream := ac.stream
	ac.Lock.Unlock()
	if stream != nil {
		stream.AddConfig(data)
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_AgentConfig,
		Scopes: ac.eventScopes(),
		Data:   data,
	})
}

func (ac *AgentController) setStatus(status string, stopReason string, errText string) {
	ac.Lock.Lock()
	if ac.stopped && status != acp.StatusStopped {
		ac.Lock.Unlock()
		return
	}
	ac.status.BlockId = ac.BlockId
	ac.status.SessionId = ac.sessionId
	ac.status.Status = status
	ac.status.StopReason = stopReason
	ac.status.Error = errText
	ac.status.Version = ac.VersionTs.GetVersionTs()
	data := ac.status
	stream := ac.stream
	ac.Lock.Unlock()

	if stream != nil {
		stream.AddStatus(&data)
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_AgentStatus,
		Scopes: ac.eventScopes(),
		Data:   &data,
	})
}

func (ac *AgentController) eventScopes() []string {
	blockScope := waveobj.MakeORef(waveobj.OType_Block, ac.BlockId).String()
	if ac.TabId == "" {
		return []string{blockScope}
	}
	return []string{
		waveobj.MakeORef(waveobj.OType_Tab, ac.TabId).String(),
		blockScope,
	}
}

func (ac *AgentController) getStream() *acp.Stream {
	ac.Lock.Lock()
	defer ac.Lock.Unlock()
	return ac.stream
}

func (ac *AgentController) getClient() (*acp.Client, string) {
	ac.Lock.Lock()
	defer ac.Lock.Unlock()
	return ac.client, ac.sessionId
}

func (ac *AgentController) persistSessionMeta(sessionId string, cwd string) {
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_AgentSessionId: sessionId,
		waveobj.MetaKey_AgentCwd:       cwd,
	}
	if err := wstore.UpdateObjectMeta(ctx, waveobj.MakeORef(waveobj.OType_Block, ac.BlockId), meta, true); err != nil {
		log.Printf("agent[%s]: could not persist session meta: %v", ac.BlockId, err)
	}
}

// Prompt sends a prompt to the running session and returns as soon as the
// request is written. Completion arrives through agent:status and the
// blockfile stream.
func (ac *AgentController) Prompt(text string) error {
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("prompt is empty")
	}
	client, sessionId := ac.getClient()
	if client == nil || sessionId == "" {
		return fmt.Errorf("agent session is not running")
	}
	ac.Lock.Lock()
	if ac.stopped {
		ac.Lock.Unlock()
		return fmt.Errorf("agent controller is stopped")
	}
	ac.pendingPrompts++
	ac.Lock.Unlock()
	if _, err := client.SendPrompt(sessionId, text); err != nil {
		ac.Lock.Lock()
		if ac.pendingPrompts > 0 {
			ac.pendingPrompts--
		}
		ac.Lock.Unlock()
		return err
	}
	ac.setStatus(acp.StatusRunning, "", "")
	return nil
}

// Cancel requests cancellation of the active turn.
func (ac *AgentController) Cancel() error {
	client, sessionId := ac.getClient()
	if client == nil || sessionId == "" {
		return fmt.Errorf("agent session is not running")
	}
	return client.Cancel(sessionId)
}

// RespondPermission answers a pending permission dialog. An empty or unknown
// option denies the request.
func (ac *AgentController) RespondPermission(requestId string, optionId string) error {
	client, _ := ac.getClient()
	if client == nil {
		return fmt.Errorf("agent session is not running")
	}
	applied, err := client.RespondPermission(requestId, optionId)
	if err != nil {
		return err
	}
	stream := ac.getStream()
	if stream != nil {
		stream.AddPermissionResolved(&acp.PermissionResolutionData{
			BlockId:   ac.BlockId,
			RequestId: requestId,
			OptionId:  applied,
			Cancelled: applied == "",
		})
	}
	ac.finishPermission()
	return nil
}

// SetMode changes the session mode.
func (ac *AgentController) SetMode(modeId string) error {
	client, sessionId := ac.getClient()
	if client == nil || sessionId == "" {
		return fmt.Errorf("agent session is not running")
	}
	ctx, cancel := context.WithTimeout(context.Background(), agentDialTimeout)
	defer cancel()
	return client.SetMode(ctx, sessionId, modeId)
}

// SetModel changes the model config option.
func (ac *AgentController) SetModel(modelId string) error {
	return ac.SetConfigOption(acp.ConfigIdModel, modelId)
}

// SetConfigOption changes any session config option.
func (ac *AgentController) SetConfigOption(configId string, value string) error {
	client, sessionId := ac.getClient()
	if client == nil || sessionId == "" {
		return fmt.Errorf("agent session is not running")
	}
	ctx, cancel := context.WithTimeout(context.Background(), agentDialTimeout)
	defer cancel()
	options, err := client.SetConfigOption(ctx, sessionId, configId, value)
	if err != nil {
		return err
	}
	if len(options) > 0 {
		decoded := decodeJSON(options)
		ac.updateConfig(func(c *agentConfigState) { c.configOptions = decoded })
	}
	return nil
}

// GetStatus returns the last published agent status.
func (ac *AgentController) GetStatus() *acp.StatusData {
	ac.Lock.Lock()
	defer ac.Lock.Unlock()
	data := ac.status
	data.BlockId = ac.BlockId
	data.SessionId = ac.sessionId
	return &data
}

func (ac *AgentController) GetConnName() string {
	return ac.ConnName
}

func (ac *AgentController) GetRuntimeStatus() *BlockControllerRuntimeStatus {
	ac.Lock.Lock()
	defer ac.Lock.Unlock()
	return &BlockControllerRuntimeStatus{
		BlockId:           ac.BlockId,
		Version:           ac.VersionTs.GetVersionTs(),
		ShellProcStatus:   ac.ProcStatus,
		ShellProcConnName: ac.ConnName,
		ShellProcExitCode: ac.ProcExitCode,
	}
}

func (ac *AgentController) SendInput(input *BlockInputUnion) error {
	return fmt.Errorf("agent blocks do not accept terminal input")
}

func (ac *AgentController) Stop(graceful bool, newStatus string, destroy bool) {
	ac.stopOnce.Do(func() {
		ac.Lock.Lock()
		ac.stopped = true
		cancel := ac.cancelHandshake
		client := ac.client
		ac.client = nil
		if newStatus == "" {
			newStatus = Status_Done
		}
		ac.ProcStatus = newStatus
		ac.Lock.Unlock()
		if cancel != nil {
			cancel()
		}
		ac.setStatus(acp.StatusStopped, "", "")
		if client != nil {
			_ = client.Close()
		}
		ac.Lock.Lock()
		stream := ac.stream
		ac.stream = nil
		ac.ProcStatus = newStatus
		ac.Lock.Unlock()
		if stream != nil {
			stream.Close()
		}
	})
}

func resolveAgentCwd(blockMeta waveobj.MetaMapType) (string, error) {
	cwd := blockMeta.GetString(waveobj.MetaKey_CmdCwd, "")
	if cwd == "" {
		cwd = blockMeta.GetString(waveobj.MetaKey_AgentCwd, "")
	}
	if cwd == "" {
		cwd = wavebase.GetHomeDir()
	}
	expanded, err := wavebase.ExpandHomeDir(cwd)
	if err != nil {
		return "", fmt.Errorf("invalid agent cwd %q: %w", cwd, err)
	}
	if !filepath.IsAbs(expanded) {
		abs, err := filepath.Abs(expanded)
		if err != nil {
			return "", fmt.Errorf("invalid agent cwd %q: %w", cwd, err)
		}
		expanded = abs
	}
	info, err := os.Stat(expanded)
	if err != nil {
		return "", fmt.Errorf("agent cwd %q is not usable: %w", expanded, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("agent cwd %q is not a directory", expanded)
	}
	return expanded, nil
}

func resolveAgentCommand() (string, []string, error) {
	if custom := os.Getenv("ZETACODE_PATH"); custom != "" {
		if isScriptWrapper(custom) {
			return "", nil, fmt.Errorf("ZETACODE_PATH points at %q; a native zetacode executable is required (the ACP client never runs commands through a shell)", custom)
		}
		return custom, []string{"acp"}, nil
	}
	for _, name := range []string{"zetacode", "zetacode.exe"} {
		if path, err := exec.LookPath(name); err == nil {
			if isScriptWrapper(path) {
				return "", nil, fmt.Errorf("found %q but a native zetacode executable is required (the ACP client never runs commands through a shell)", path)
			}
			return path, []string{"acp"}, nil
		}
	}
	if path, err := exec.LookPath("zetacode.cmd"); err == nil {
		return "", nil, fmt.Errorf("found %q but a native zetacode executable is required (the ACP client never runs commands through a shell)", path)
	}
	return "", nil, fmt.Errorf("zetacode CLI not found on PATH; install Zeta Code or set ZETACODE_PATH to the executable")
}

func isScriptWrapper(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".cmd", ".bat", ".ps1":
		return true
	}
	return false
}

func buildAgentEnv(extra map[string]string) []string {
	env := os.Environ()
	for key, value := range extra {
		env = append(env, key+"="+value)
	}
	return env
}

func decodeJSON(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return string(raw)
	}
	return value
}

func withCurrentMode(modes any, currentModeId string) any {
	m, ok := modes.(map[string]any)
	if !ok {
		return map[string]any{"currentModeId": currentModeId}
	}
	copied := make(map[string]any, len(m)+1)
	for key, value := range m {
		copied[key] = value
	}
	copied["currentModeId"] = currentModeId
	return copied
}
