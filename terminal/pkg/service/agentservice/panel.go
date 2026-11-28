// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentservice

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/acp"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

// PanelEventScope is the event scope used by the process-wide AI panel. The
// panel is not tied to a block, so it uses its own scope instead of block/tab
// scopes.
const PanelEventScope = "agent:panel"

const (
	panelHandshakeTimeout = 60 * time.Second
	panelSessionTimeout   = 5 * time.Minute
	panelDialTimeout      = 10 * time.Second
)

type panelConfigState struct {
	modes         any
	configOptions any
	commands      any
	agentInfo     any
}

// panelReplayCollector buffers session/update payloads replayed by a
// session/load call until the RPC returns.
type panelReplayCollector struct {
	SessionId string
	Updates   []any
}

// panelSession owns the single zetacode ACP child that serves the AI panel. It
// is process-wide: opening or closing the panel does not restart the agent,
// and a single session is shared by every panel instance in the window.
type panelSession struct {
	startLock  sync.Mutex
	statusLock sync.Mutex
	loadLock   sync.Mutex
	lock       sync.Mutex

	client      *acp.Client
	sessionId   string
	cwd         string
	status      acp.StatusData
	config      panelConfigState
	generation  int64
	version     int64
	stopping    bool
	loading     bool
	replay      *panelReplayCollector
	pendingPerm int
	pendingTurn int
	permissions map[string]*acp.PermissionRequestData
}

var agentPanel = &panelSession{}

func (p *panelSession) currentGeneration() int64 {
	p.lock.Lock()
	defer p.lock.Unlock()
	return p.generation
}

func (p *panelSession) isCurrent(gen int64) bool {
	p.lock.Lock()
	defer p.lock.Unlock()
	return p.generation == gen
}

func (p *panelSession) isRunning() bool {
	p.lock.Lock()
	defer p.lock.Unlock()
	return p.client != nil && p.sessionId != ""
}

func (p *panelSession) setStatus(status string, stopReason string, errText string) {
	p.statusLock.Lock()
	defer p.statusLock.Unlock()
	p.setStatusLocked(status, stopReason, errText)
}

// setStatusIfTurnActive avoids overwriting a prompt completion that raced the
// synchronous return of SendPrompt.
func (p *panelSession) setStatusIfTurnActive(status string, stopReason string, errText string) {
	p.statusLock.Lock()
	defer p.statusLock.Unlock()
	p.lock.Lock()
	active := p.pendingTurn > 0
	p.lock.Unlock()
	if !active {
		return
	}
	p.setStatusLocked(status, stopReason, errText)
}

func (p *panelSession) setStatusLocked(status string, stopReason string, errText string) {
	p.lock.Lock()
	if p.stopping && status != acp.StatusStopped {
		p.lock.Unlock()
		return
	}
	p.version++
	p.status.SessionId = p.sessionId
	p.status.Status = status
	p.status.StopReason = stopReason
	p.status.Error = errText
	p.status.Version = p.version
	data := p.status
	p.lock.Unlock()
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_AgentStatus,
		Scopes: []string{PanelEventScope},
		Data:   &data,
	})
}

func (p *panelSession) publishConfig(data *acp.ConfigData) {
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_AgentConfig,
		Scopes: []string{PanelEventScope},
		Data:   data,
	})
}

func (p *panelSession) currentConfig() *acp.ConfigData {
	p.lock.Lock()
	defer p.lock.Unlock()
	return &acp.ConfigData{
		SessionId:         p.sessionId,
		Modes:             p.config.modes,
		ConfigOptions:     p.config.configOptions,
		AvailableCommands: p.config.commands,
		AgentInfo:         p.config.agentInfo,
	}
}

func (p *panelSession) getClient() (*acp.Client, string) {
	p.lock.Lock()
	defer p.lock.Unlock()
	return p.client, p.sessionId
}

func (*AgentService) PanelStart_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "start the process-wide AI panel ACP session (cwd may be empty for the home directory)",
		ArgNames: []string{"ctx", "cwd"},
	}
}

func (*AgentService) PanelPrompt_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "send a prompt to the AI panel ACP session (starts it on demand)",
		ArgNames: []string{"ctx", "text"},
	}
}

func (*AgentService) PanelCancel_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "cancel the active AI panel turn",
		ArgNames: []string{"ctx"},
	}
}

func (*AgentService) PanelSetModel_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "change the AI panel session model (config option \"model\")",
		ArgNames: []string{"ctx", "modelId"},
	}
}

func (*AgentService) PanelSetConfigOption_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "change any advertised AI panel session config option",
		ArgNames: []string{"ctx", "configId", "value"},
	}
}

func (*AgentService) PanelStatus_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "get the last published AI panel status",
		ArgNames: []string{"ctx"},
	}
}

func (*AgentService) PanelConfig_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "get the AI panel session modes and config options",
		ArgNames: []string{"ctx"},
	}
}

func (*AgentService) PanelPendingPermissions_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "list unanswered AI panel permission requests (for panel reloads)",
		ArgNames: []string{"ctx"},
	}
}

func (*AgentService) PanelListSessions_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "list stored ACP sessions for the AI panel cwd",
		ArgNames: []string{"ctx"},
	}
}

func (*AgentService) PanelLoadSession_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "switch the AI panel to a stored ACP session and return its replayed transcript",
		ArgNames: []string{"ctx", "sessionId"},
	}
}

func (*AgentService) PanelRespondPermission_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "answer an AI panel permission request with an optionId, or an empty string to deny",
		ArgNames: []string{"ctx", "requestId", "optionId"},
	}
}

// PanelStart ensures the process-wide AI panel session is running. A running
// session is reused; its cwd is fixed by the first successful start.
func (*AgentService) PanelStart(ctx context.Context, cwd string) error {
	return agentPanel.start(ctx, cwd)
}

// PanelPrompt sends a prompt to the panel session, starting it on demand.
func (*AgentService) PanelPrompt(ctx context.Context, text string) error {
	return agentPanel.prompt(ctx, text)
}

// PanelCancel requests cancellation of the active panel turn.
func (*AgentService) PanelCancel(ctx context.Context) error {
	return agentPanel.cancel()
}

// PanelSetModel changes the panel session model config option.
func (*AgentService) PanelSetModel(ctx context.Context, modelId string) error {
	return agentPanel.setModel(ctx, modelId)
}

// PanelSetConfigOption changes any config option the panel session advertises
// (model, thinking, mode, ...). The service layer stays config-id agnostic; the
// agent rejects unknown ids/values.
func (*AgentService) PanelSetConfigOption(ctx context.Context, configId string, value string) error {
	return agentPanel.setConfigOption(ctx, configId, value)
}

// PanelStatus returns the last published panel status for reconnect/render.
func (*AgentService) PanelStatus(ctx context.Context) (*acp.StatusData, error) {
	return agentPanel.statusSnapshot(), nil
}

// PanelConfig returns the panel session modes and config options.
func (*AgentService) PanelConfig(ctx context.Context) (*acp.ConfigData, error) {
	return agentPanel.currentConfig(), nil
}

// PanelListSessions lists stored sessions for the panel cwd.
func (*AgentService) PanelListSessions(ctx context.Context) (*acp.ListSessionsResponse, error) {
	return agentPanel.listSessions(ctx)
}

// PanelLoadSession switches the panel to a stored session and returns the
// session/update payloads the agent replayed for it.
func (*AgentService) PanelLoadSession(ctx context.Context, sessionId string) (*acp.LoadSessionResult, error) {
	return agentPanel.loadSession(ctx, sessionId)
}

// PanelPendingPermissions returns permission requests that are still waiting
// for an answer. The panel calls it after a reload so an open dialog can be
// restored.
func (*AgentService) PanelPendingPermissions(ctx context.Context) ([]*acp.PermissionRequestData, error) {
	return agentPanel.pendingPermissionList(), nil
}

// PanelRespondPermission answers a pending panel permission request.
func (*AgentService) PanelRespondPermission(ctx context.Context, requestId string, optionId string) error {
	return agentPanel.respondPermission(requestId, optionId)
}

func (p *panelSession) start(ctx context.Context, cwd string) error {
	p.startLock.Lock()
	defer p.startLock.Unlock()

	if p.isRunning() {
		return nil
	}

	gen := p.currentGeneration() + 1
	p.lock.Lock()
	p.generation = gen
	p.stopping = false
	p.loading = false
	p.replay = nil
	p.sessionId = ""
	p.pendingPerm = 0
	p.pendingTurn = 0
	p.permissions = make(map[string]*acp.PermissionRequestData)
	p.lock.Unlock()
	p.closeClient()
	p.setStatus(acp.StatusStarting, "", "")

	displayCwd, err := resolvePanelCwd(cwd)
	if err != nil {
		p.failStart(gen, err)
		return err
	}
	command, args, err := resolvePanelCommand()
	if err != nil {
		p.failStart(gen, err)
		return err
	}
	client, err := acp.StartProcess(acp.ClientOptions{
		Command:    command,
		Args:       args,
		Dir:        displayCwd,
		Env:        os.Environ(),
		ClientInfo: acp.Implementation{Name: "zeta", Title: "Zeta Code", Version: wavebase.WaveVersion},
		OnUpdate: func(sessionId string, update json.RawMessage) {
			p.onUpdate(gen, sessionId, update)
		},
		OnPermission: func(req *acp.PermissionRequestData) {
			p.onPermission(gen, req)
		},
		OnPermissionCancelled: func(requestId string) {
			p.onPermissionCancelled(gen, requestId)
		},
		OnPromptDone: func(done acp.PromptDone) {
			p.onPromptDone(gen, done)
		},
		OnStderr: func(line string) {
			log.Printf("agent[panel] stderr: %s", line)
		},
		OnExit: func(exitErr error) {
			p.onProcessExit(gen, exitErr)
		},
	})
	if err != nil {
		p.failStart(gen, err)
		return err
	}

	p.lock.Lock()
	if p.generation != gen || p.stopping {
		p.lock.Unlock()
		_ = client.Close()
		return fmt.Errorf("panel session was stopped while starting")
	}
	p.client = client
	p.cwd = displayCwd
	p.lock.Unlock()

	handshakeCtx, cancel := context.WithTimeout(ctx, panelHandshakeTimeout)
	defer cancel()
	initRes, err := client.Initialize(handshakeCtx)
	if err != nil {
		p.abortClient(gen, client, fmt.Errorf("initialize failed: %w", err))
		return err
	}
	if err := client.Authenticate(handshakeCtx, "agent"); err != nil {
		p.abortClient(gen, client, fmt.Errorf("authenticate failed: %w", err))
		return err
	}

	sessionCtx, sessionCancel := context.WithTimeout(ctx, panelSessionTimeout)
	defer sessionCancel()
	setup, err := client.NewSession(sessionCtx, displayCwd)
	if err != nil {
		p.abortClient(gen, client, fmt.Errorf("session/new failed: %w", err))
		return err
	}
	if !p.isCurrent(gen) {
		return fmt.Errorf("panel session was stopped while starting")
	}
	p.applySetup(setup, initRes.AgentInfo)
	p.setStatus(acp.StatusIdle, "", "")
	return nil
}

// prompt starts the session on demand so a restored panel with a stale
// process can still send its first message.
func (p *panelSession) prompt(ctx context.Context, text string) error {
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("prompt is empty")
	}
	if !p.isRunning() {
		p.lock.Lock()
		cwd := p.cwd
		p.lock.Unlock()
		if err := p.start(ctx, cwd); err != nil {
			return err
		}
	}
	client, sessionId := p.getClient()
	if client == nil || sessionId == "" {
		return fmt.Errorf("panel session is not running")
	}
	p.lock.Lock()
	if p.loading {
		p.lock.Unlock()
		return fmt.Errorf("panel session is switching")
	}
	if p.stopping {
		p.lock.Unlock()
		return fmt.Errorf("panel session is stopped")
	}
	p.pendingTurn++
	p.lock.Unlock()
	if _, err := client.SendPrompt(sessionId, text); err != nil {
		p.lock.Lock()
		if p.pendingTurn > 0 {
			p.pendingTurn--
		}
		p.lock.Unlock()
		return err
	}
	p.setStatusIfTurnActive(acp.StatusRunning, "", "")
	return nil
}

func (p *panelSession) cancel() error {
	client, sessionId := p.getClient()
	if client == nil || sessionId == "" {
		return fmt.Errorf("panel session is not running")
	}
	return client.Cancel(sessionId)
}

func (p *panelSession) setModel(ctx context.Context, modelId string) error {
	return p.setConfigOption(ctx, acp.ConfigIdModel, modelId)
}

func (p *panelSession) setConfigOption(ctx context.Context, configId string, value string) error {
	if strings.TrimSpace(configId) == "" {
		return fmt.Errorf("config id is empty")
	}
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("config value is empty")
	}
	p.lock.Lock()
	loading := p.loading
	p.lock.Unlock()
	if loading {
		return fmt.Errorf("panel session is switching")
	}
	client, sessionId := p.getClient()
	if client == nil || sessionId == "" {
		return fmt.Errorf("panel session is not running")
	}
	dialCtx, cancel := context.WithTimeout(ctx, panelDialTimeout)
	defer cancel()
	options, err := client.SetConfigOption(dialCtx, sessionId, configId, value)
	if err != nil {
		return err
	}
	if len(options) > 0 {
		p.lock.Lock()
		p.config.configOptions = decodePanelJSON(options)
		p.lock.Unlock()
	}
	p.publishConfig(p.currentConfig())
	return nil
}

func (p *panelSession) statusSnapshot() *acp.StatusData {
	p.lock.Lock()
	defer p.lock.Unlock()
	data := p.status
	data.SessionId = p.sessionId
	return &data
}

func (p *panelSession) respondPermission(requestId string, optionId string) error {
	client, _ := p.getClient()
	if client == nil {
		return fmt.Errorf("panel session is not running")
	}
	applied, err := client.RespondPermission(requestId, optionId)
	if err != nil {
		return err
	}
	p.lock.Lock()
	delete(p.permissions, requestId)
	p.lock.Unlock()
	p.publishPermissionResolution(&acp.PermissionResolutionData{
		RequestId: requestId,
		OptionId:  applied,
		Cancelled: applied == "",
	})
	p.finishPermission()
	return nil
}

func (p *panelSession) applySetup(setup *acp.SessionSetup, info *acp.Implementation) {
	p.applySetupState(setup, info)
	p.publishConfig(p.currentConfig())
}

func (p *panelSession) applySetupState(setup *acp.SessionSetup, info *acp.Implementation) {
	p.lock.Lock()
	p.sessionId = setup.SessionId
	p.config.modes = decodePanelJSON(setup.Modes)
	p.config.configOptions = decodePanelJSON(setup.ConfigOptions)
	if info != nil {
		p.config.agentInfo = info
	}
	p.lock.Unlock()
}

func (p *panelSession) listSessions(ctx context.Context) (*acp.ListSessionsResponse, error) {
	if !p.isRunning() {
		p.lock.Lock()
		cwd := p.cwd
		p.lock.Unlock()
		if err := p.start(ctx, cwd); err != nil {
			return nil, err
		}
	}
	client, _ := p.getClient()
	if client == nil {
		return nil, fmt.Errorf("panel session is not running")
	}
	p.lock.Lock()
	cwd := p.cwd
	p.lock.Unlock()
	dialCtx, cancel := context.WithTimeout(ctx, panelHandshakeTimeout)
	defer cancel()
	return client.ListSessions(dialCtx, cwd, "")
}

// loadSession switches the panel to a stored ACP session. History replay is
// captured from session/update notifications and returned with the RPC result
// so the UI never has to race the live event stream. On failure the active
// session, config, transcript, and status are left untouched.
func (p *panelSession) loadSession(ctx context.Context, sessionId string) (*acp.LoadSessionResult, error) {
	sessionId = strings.TrimSpace(sessionId)
	if sessionId == "" {
		return nil, fmt.Errorf("session id is empty")
	}

	p.loadLock.Lock()
	defer p.loadLock.Unlock()

	if !p.isRunning() {
		p.lock.Lock()
		cwd := p.cwd
		p.lock.Unlock()
		if err := p.start(ctx, cwd); err != nil {
			return nil, err
		}
	}
	client, _ := p.getClient()
	if client == nil {
		return nil, fmt.Errorf("panel session is not running")
	}

	p.lock.Lock()
	if p.pendingTurn > 0 || p.pendingPerm > 0 {
		p.lock.Unlock()
		return nil, fmt.Errorf("panel session is busy; stop the current turn before switching sessions")
	}
	p.loading = true
	cwd := p.cwd
	previousModel := panelConfigOptionValue(p.config.configOptions, acp.ConfigIdModel)
	previousThinking := panelConfigOptionValue(p.config.configOptions, acp.ConfigIdThinking)
	p.lock.Unlock()
	defer func() {
		p.lock.Lock()
		p.loading = false
		p.lock.Unlock()
	}()

	replay := p.beginReplay(sessionId)
	loadCtx, loadCancel := context.WithTimeout(ctx, panelSessionTimeout)
	setup, err := client.LoadSession(loadCtx, sessionId, cwd)
	loadCancel()
	updates := p.endReplay(replay)
	if err != nil {
		return nil, err
	}

	// Keep the panel's model/effort selection across the switch when the
	// loaded session advertises the same values.
	p.applySetupState(setup, nil)
	p.restoreConfigOption(ctx, client, sessionId, acp.ConfigIdModel, previousModel)
	p.restoreConfigOption(ctx, client, sessionId, acp.ConfigIdThinking, previousThinking)
	p.lock.Lock()
	p.permissions = make(map[string]*acp.PermissionRequestData)
	p.pendingPerm = 0
	p.pendingTurn = 0
	p.lock.Unlock()
	p.publishConfig(p.currentConfig())
	p.setStatus(acp.StatusIdle, "", "")

	config := p.currentConfig()
	return &acp.LoadSessionResult{
		SessionId:     config.SessionId,
		ConfigOptions: config.ConfigOptions,
		Modes:         config.Modes,
		Updates:       updates,
	}, nil
}

func (p *panelSession) beginReplay(sessionId string) *panelReplayCollector {
	collector := &panelReplayCollector{SessionId: sessionId}
	p.lock.Lock()
	p.replay = collector
	p.lock.Unlock()
	return collector
}

func (p *panelSession) endReplay(collector *panelReplayCollector) []any {
	p.lock.Lock()
	if p.replay == collector {
		p.replay = nil
	}
	updates := collector.Updates
	p.lock.Unlock()
	if updates == nil {
		return []any{}
	}
	return updates
}

type panelConfigOptionSelection struct {
	Id           string `json:"id"`
	CurrentValue any    `json:"currentValue"`
	Options      []struct {
		Value any `json:"value"`
	} `json:"options"`
}

func panelConfigOptionSelections(options any) []panelConfigOptionSelection {
	if options == nil {
		return nil
	}
	raw, err := json.Marshal(options)
	if err != nil {
		return nil
	}
	var selections []panelConfigOptionSelection
	if err := json.Unmarshal(raw, &selections); err != nil {
		return nil
	}
	return selections
}

func panelConfigOptionValue(options any, configId string) string {
	for _, selection := range panelConfigOptionSelections(options) {
		if selection.Id != configId {
			continue
		}
		if value, ok := selection.CurrentValue.(string); ok {
			return value
		}
	}
	return ""
}

func panelConfigOptionSupports(options any, configId string, value string) bool {
	for _, selection := range panelConfigOptionSelections(options) {
		if selection.Id != configId {
			continue
		}
		if current, ok := selection.CurrentValue.(string); ok && current == value {
			return true
		}
		for _, option := range selection.Options {
			if candidate, ok := option.Value.(string); ok && candidate == value {
				return true
			}
		}
	}
	return false
}

func (p *panelSession) restoreConfigOption(ctx context.Context, client *acp.Client, sessionId string, configId string, value string) {
	if value == "" || panelConfigOptionValue(p.currentConfig().ConfigOptions, configId) == value {
		return
	}
	if !panelConfigOptionSupports(p.currentConfig().ConfigOptions, configId, value) {
		return
	}
	dialCtx, cancel := context.WithTimeout(ctx, panelDialTimeout)
	defer cancel()
	options, err := client.SetConfigOption(dialCtx, sessionId, configId, value)
	if err != nil {
		log.Printf("agent[panel]: preserve %s=%q across session switch: %v", configId, value, err)
		return
	}
	if len(options) > 0 {
		p.lock.Lock()
		p.config.configOptions = decodePanelJSON(options)
		p.lock.Unlock()
	}
}

func (p *panelSession) onUpdate(gen int64, sessionId string, update json.RawMessage) {
	if !p.isCurrent(gen) {
		return
	}
	decoded := decodePanelJSON(update)
	p.lock.Lock()
	if p.replay != nil && p.replay.SessionId == sessionId {
		p.replay.Updates = append(p.replay.Updates, decoded)
	}
	p.lock.Unlock()
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_AgentUpdate,
		Scopes: []string{PanelEventScope},
		Data: &acp.UpdateData{
			SessionId: sessionId,
			Update:    decoded,
		},
	})
	var probe struct {
		SessionUpdate     string          `json:"sessionUpdate"`
		CurrentModeId     string          `json:"currentModeId"`
		ConfigOptions     json.RawMessage `json:"configOptions"`
		AvailableCommands json.RawMessage `json:"availableCommands"`
	}
	if err := json.Unmarshal(update, &probe); err != nil {
		return
	}
	changed := false
	p.lock.Lock()
	switch probe.SessionUpdate {
	case "current_mode_update":
		p.config.modes = withPanelMode(p.config.modes, probe.CurrentModeId)
		changed = true
	case "config_option_update":
		if len(probe.ConfigOptions) > 0 {
			p.config.configOptions = decodePanelJSON(probe.ConfigOptions)
			changed = true
		}
	case "available_commands_update":
		if len(probe.AvailableCommands) > 0 {
			p.config.commands = decodePanelJSON(probe.AvailableCommands)
			changed = true
		}
	}
	p.lock.Unlock()
	if changed {
		p.publishConfig(p.currentConfig())
	}
}

func (p *panelSession) onPermission(gen int64, req *acp.PermissionRequestData) {
	if !p.isCurrent(gen) {
		return
	}
	req.BlockId = ""
	if req.SessionId == "" {
		_, sessionId := p.getClient()
		req.SessionId = sessionId
	}
	p.lock.Lock()
	p.pendingPerm++
	if p.permissions == nil {
		p.permissions = make(map[string]*acp.PermissionRequestData)
	}
	p.permissions[req.RequestId] = req
	p.lock.Unlock()
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_AgentPermission,
		Scopes: []string{PanelEventScope},
		Data:   req,
	})
	p.setStatus(acp.StatusWaitingPermission, "", "")
}

func (p *panelSession) onPermissionCancelled(gen int64, requestId string) {
	if !p.isCurrent(gen) {
		return
	}
	p.lock.Lock()
	delete(p.permissions, requestId)
	p.lock.Unlock()
	p.publishPermissionResolution(&acp.PermissionResolutionData{
		RequestId: requestId,
		Cancelled: true,
	})
	p.finishPermission()
}

func (p *panelSession) publishPermissionResolution(data *acp.PermissionResolutionData) {
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_AgentPermissionDone,
		Scopes: []string{PanelEventScope},
		Data:   data,
	})
}

func (p *panelSession) pendingPermissionList() []*acp.PermissionRequestData {
	p.lock.Lock()
	defer p.lock.Unlock()
	if len(p.permissions) == 0 {
		return []*acp.PermissionRequestData{}
	}
	result := make([]*acp.PermissionRequestData, 0, len(p.permissions))
	for _, request := range p.permissions {
		copied := *request
		result = append(result, &copied)
	}
	return result
}

func (p *panelSession) finishPermission() {
	p.lock.Lock()
	if p.pendingPerm > 0 {
		p.pendingPerm--
	}
	permissions := p.pendingPerm
	turns := p.pendingTurn
	p.lock.Unlock()
	if permissions > 0 {
		p.setStatus(acp.StatusWaitingPermission, "", "")
		return
	}
	if turns > 0 {
		p.setStatus(acp.StatusRunning, "", "")
		return
	}
	p.setStatus(acp.StatusIdle, "", "")
}

func (p *panelSession) onPromptDone(gen int64, done acp.PromptDone) {
	if !p.isCurrent(gen) {
		return
	}
	p.lock.Lock()
	if p.pendingTurn > 0 {
		p.pendingTurn--
	}
	remaining := p.pendingTurn
	p.lock.Unlock()
	if done.Err != nil {
		p.setStatus(acp.StatusError, "", done.Err.Error())
		return
	}
	if remaining > 0 {
		return
	}
	p.setStatus(acp.StatusIdle, done.StopReason, "")
}

func (p *panelSession) onProcessExit(gen int64, err error) {
	if !p.isCurrent(gen) {
		return
	}
	p.lock.Lock()
	stopping := p.stopping
	p.lock.Unlock()
	if stopping {
		return
	}
	errText := ""
	if err != nil {
		errText = err.Error()
	}
	p.setStatus(acp.StatusError, "", errText)
}

func (p *panelSession) failStart(gen int64, err error) {
	log.Printf("agent[panel]: %v", err)
	if !p.isCurrent(gen) {
		return
	}
	p.setStatus(acp.StatusError, "", err.Error())
}

func (p *panelSession) abortClient(gen int64, client *acp.Client, err error) {
	if !p.isCurrent(gen) {
		_ = client.Close()
		return
	}
	p.lock.Lock()
	if p.client == client {
		p.client = nil
		p.sessionId = ""
	}
	p.lock.Unlock()
	errText := err.Error()
	if stderr := client.LastStderr(); len(stderr) > 0 {
		tail := stderr
		if len(tail) > 5 {
			tail = tail[len(tail)-5:]
		}
		errText += "\n" + strings.Join(tail, "\n")
	}
	p.setStatus(acp.StatusError, "", errText)
	_ = client.Close()
}

func (p *panelSession) closeClient() {
	p.lock.Lock()
	client := p.client
	p.client = nil
	p.sessionId = ""
	p.lock.Unlock()
	if client != nil {
		_ = client.Close()
	}
}

// shutdown is used by tests and process teardown.
func (p *panelSession) shutdown() {
	p.lock.Lock()
	p.stopping = true
	p.generation++
	client := p.client
	p.client = nil
	p.sessionId = ""
	p.lock.Unlock()
	if client != nil {
		_ = client.Close()
	}
}

func resolvePanelCwd(cwd string) (string, error) {
	if cwd == "" {
		cwd = wavebase.GetHomeDir()
	}
	expanded, err := wavebase.ExpandHomeDir(cwd)
	if err != nil {
		return "", fmt.Errorf("invalid panel cwd %q: %w", cwd, err)
	}
	if !filepath.IsAbs(expanded) {
		abs, err := filepath.Abs(expanded)
		if err != nil {
			return "", fmt.Errorf("invalid panel cwd %q: %w", cwd, err)
		}
		expanded = abs
	}
	info, err := os.Stat(expanded)
	if err != nil {
		return "", fmt.Errorf("panel cwd %q is not usable: %w", expanded, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("panel cwd %q is not a directory", expanded)
	}
	return expanded, nil
}

func resolvePanelCommand() (string, []string, error) {
	if custom := os.Getenv("ZETACODE_PATH"); custom != "" {
		if isPanelScriptWrapper(custom) {
			return "", nil, fmt.Errorf("ZETACODE_PATH points at %q; a native zetacode executable is required (the ACP client never runs commands through a shell)", custom)
		}
		return custom, []string{"acp"}, nil
	}
	for _, name := range []string{"zetacode", "zetacode.exe"} {
		if path, err := exec.LookPath(name); err == nil {
			if isPanelScriptWrapper(path) {
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

func isPanelScriptWrapper(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".cmd", ".bat", ".ps1":
		return true
	}
	return false
}

func decodePanelJSON(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return string(raw)
	}
	return value
}

func withPanelMode(modes any, currentModeId string) any {
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
