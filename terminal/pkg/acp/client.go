// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	closeSessionTimeout = 750 * time.Millisecond
	processExitGrace    = 2 * time.Second
	stderrHistoryLines  = 20
)

// ClientOptions configures a client and its event callbacks. Callbacks run on
// transport goroutines and must return quickly.
type ClientOptions struct {
	Command    string
	Args       []string
	Dir        string
	Env        []string
	ClientInfo Implementation

	OnUpdate              func(sessionId string, update json.RawMessage)
	OnPermission          func(req *PermissionRequestData)
	OnPermissionCancelled func(requestId string)
	OnPromptDone          func(done PromptDone)
	OnStderr              func(line string)
	OnExit                func(err error)
}

type permissionReply struct {
	optionId       string
	cancelled      bool
	protocolCancel bool
}

type permissionWaiter struct {
	options map[string]bool
	reply   chan permissionReply
}

// Client owns one `zetacode acp` child process and its JSON-RPC connection.
type Client struct {
	conn *Conn
	proc *childProcess
	opts ClientOptions

	stopping  atomic.Bool
	closeOnce sync.Once
	done      chan struct{}

	sessionMu sync.Mutex
	sessionId string

	permMu      sync.Mutex
	permissions map[string]*permissionWaiter

	stderrMu   sync.Mutex
	stderrRing []string
}

// StartProcess spawns the agent and starts its read loop. The caller must call
// Close to reap the process and all goroutines.
func StartProcess(opts ClientOptions) (*Client, error) {
	proc, err := startChildProcess(ProcessConfig{
		Command: opts.Command,
		Args:    opts.Args,
		Dir:     opts.Dir,
		Env:     opts.Env,
	})
	if err != nil {
		return nil, err
	}
	c := newClient(proc.stdout, proc.stdin, opts)
	c.proc = proc
	c.done = make(chan struct{})
	c.conn.SetNotificationHandler(c.handleNotification)
	c.conn.Start()
	go c.readStderr()
	go c.waitProcess()
	go c.watchTransport()
	return c, nil
}

// newClient wires a transport over an arbitrary stdio pair. It is used by
// StartProcess and by unit tests that drive a fake agent over pipes.
func newClient(reader io.ReadCloser, writer io.WriteCloser, opts ClientOptions) *Client {
	c := &Client{
		opts:        opts,
		permissions: make(map[string]*permissionWaiter),
	}
	c.conn = NewConn(reader, writer, c.handleRequest)
	return c
}

func (c *Client) readStderr() {
	if c.proc == nil || c.proc.stderr == nil {
		return
	}
	br := bufio.NewReaderSize(c.proc.stderr, 32*1024)
	for {
		line, err := readDiagnosticLine(br)
		if len(line) > 0 {
			c.rememberStderr(line)
			if c.opts.OnStderr != nil {
				c.opts.OnStderr(line)
			}
		}
		if err != nil {
			return
		}
	}
}

func readDiagnosticLine(r *bufio.Reader) (string, error) {
	var buf []byte
	for {
		chunk, err := r.ReadSlice('\n')
		if len(buf) < 8*1024 {
			room := 8*1024 - len(buf)
			if len(chunk) > room {
				buf = append(buf, chunk[:room]...)
			} else {
				buf = append(buf, chunk...)
			}
		}
		if err == nil {
			break
		}
		if err == bufio.ErrBufferFull {
			continue
		}
		return strings.TrimRight(string(buf), "\r\n"), err
	}
	return strings.TrimRight(string(buf), "\r\n"), nil
}

func (c *Client) rememberStderr(line string) {
	c.stderrMu.Lock()
	defer c.stderrMu.Unlock()
	c.stderrRing = append(c.stderrRing, line)
	if len(c.stderrRing) > stderrHistoryLines {
		c.stderrRing = c.stderrRing[len(c.stderrRing)-stderrHistoryLines:]
	}
}

// LastStderr returns buffered diagnostic output, oldest first.
func (c *Client) LastStderr() []string {
	c.stderrMu.Lock()
	defer c.stderrMu.Unlock()
	out := make([]string, len(c.stderrRing))
	copy(out, c.stderrRing)
	return out
}

func (c *Client) waitProcess() {
	exitErr := c.proc.wait()
	if !c.stopping.Load() {
		reason := ErrConnClosed
		if exitErr != nil {
			reason = fmt.Errorf("agent process exited: %w", exitErr)
		} else {
			reason = fmt.Errorf("agent process exited")
		}
		c.conn.shutdown(reason)
		if c.opts.OnExit != nil {
			c.opts.OnExit(reason)
		}
	}
	close(c.done)
}

func (c *Client) watchTransport() {
	select {
	case <-c.conn.Closed():
		if !c.stopping.Load() {
			// The agent stopped speaking (crash or closed stdout) without
			// exiting; make sure it cannot linger.
			c.proc.kill()
		}
	case <-c.proc.exited:
	}
}

// Done is closed once the child process has exited.
func (c *Client) Done() <-chan struct{} {
	if c.done == nil {
		return c.conn.Closed()
	}
	return c.done
}

// SessionId returns the session most recently created or loaded.
func (c *Client) SessionId() string {
	c.sessionMu.Lock()
	defer c.sessionMu.Unlock()
	return c.sessionId
}

func (c *Client) SetSessionId(id string) {
	c.sessionMu.Lock()
	defer c.sessionMu.Unlock()
	c.sessionId = id
}

// Initialize performs the ACP handshake.
func (c *Client) Initialize(ctx context.Context) (*InitializeResult, error) {
	params := map[string]any{
		"protocolVersion":    ProtocolVersion,
		"clientCapabilities": map[string]any{},
		"clientInfo":         c.opts.ClientInfo,
	}
	raw, err := c.conn.Call(ctx, MethodInitialize, params)
	if err != nil {
		return nil, err
	}
	var res InitializeResult
	if err := json.Unmarshal(raw, &res); err != nil {
		return nil, fmt.Errorf("acp: invalid initialize response: %w", err)
	}
	return &res, nil
}

// Authenticate selects one of the methods advertised by Initialize.
func (c *Client) Authenticate(ctx context.Context, methodId string) error {
	_, err := c.conn.Call(ctx, MethodAuthenticate, map[string]any{"methodId": methodId})
	return err
}

// NewSession creates an agent session in cwd.
func (c *Client) NewSession(ctx context.Context, cwd string) (*SessionSetup, error) {
	raw, err := c.conn.Call(ctx, MethodNewSession, map[string]any{
		"cwd":        cwd,
		"mcpServers": []any{},
	})
	if err != nil {
		return nil, err
	}
	var res SessionSetup
	if err := json.Unmarshal(raw, &res); err != nil {
		return nil, fmt.Errorf("acp: invalid session/new response: %w", err)
	}
	if res.SessionId == "" {
		return nil, fmt.Errorf("acp: session/new returned an empty session id")
	}
	c.SetSessionId(res.SessionId)
	return &res, nil
}

// LoadSession restores a persisted session. The agent replays its history as
// session/update notifications before the call returns.
func (c *Client) LoadSession(ctx context.Context, sessionId string, cwd string) (*SessionSetup, error) {
	raw, err := c.conn.Call(ctx, MethodLoadSession, map[string]any{
		"sessionId":  sessionId,
		"cwd":        cwd,
		"mcpServers": []any{},
	})
	if err != nil {
		return nil, err
	}
	var res SessionSetup
	if err := json.Unmarshal(raw, &res); err != nil {
		return nil, fmt.Errorf("acp: invalid session/load response: %w", err)
	}
	c.SetSessionId(sessionId)
	res.SessionId = sessionId
	return &res, nil
}

// SendPrompt submits a prompt and returns immediately. Completion is reported
// through ClientOptions.OnPromptDone.
func (c *Client) SendPrompt(sessionId string, text string) (int64, error) {
	params := map[string]any{
		"sessionId": sessionId,
		"prompt": []any{
			map[string]any{"type": "text", "text": text},
		},
	}
	return c.conn.CallAsync(MethodPrompt, params, func(raw json.RawMessage, err error) {
		done := PromptDone{Err: err}
		if err == nil {
			var res PromptResponse
			if jerr := json.Unmarshal(raw, &res); jerr != nil {
				done.Err = fmt.Errorf("acp: invalid session/prompt response: %w", jerr)
			} else {
				done.StopReason = res.StopReason
				done.Usage = res.Usage
			}
		}
		if c.opts.OnPromptDone != nil {
			c.opts.OnPromptDone(done)
		}
	})
}

// Cancel cancels the active prompt. Open permission dialogs are answered
// "cancelled" so the agent can finish its abort path.
func (c *Client) Cancel(sessionId string) error {
	c.cancelPendingPermissions()
	return c.conn.Notify(MethodCancel, map[string]any{"sessionId": sessionId})
}

// SetMode changes the session mode.
func (c *Client) SetMode(ctx context.Context, sessionId string, modeId string) error {
	_, err := c.conn.Call(ctx, MethodSetMode, map[string]any{
		"sessionId": sessionId,
		"modeId":    modeId,
	})
	return err
}

// SetConfigOption changes a session config option (model, thinking, ...).
func (c *Client) SetConfigOption(ctx context.Context, sessionId string, configId string, value string) (json.RawMessage, error) {
	raw, err := c.conn.Call(ctx, MethodSetConfigOption, map[string]any{
		"sessionId": sessionId,
		"configId":  configId,
		"value":     value,
	})
	if err != nil {
		return nil, err
	}
	var res struct {
		ConfigOptions json.RawMessage `json:"configOptions"`
	}
	if err := json.Unmarshal(raw, &res); err != nil {
		return nil, fmt.Errorf("acp: invalid session/set_config_option response: %w", err)
	}
	return res.ConfigOptions, nil
}

// RespondPermission answers a pending session/request_permission request.
// It returns the option that was actually sent to the agent: an empty or
// unknown optionId is a denial and returns "" after answering with the ACP
// "cancelled" outcome.
func (c *Client) RespondPermission(requestId string, optionId string) (string, error) {
	c.permMu.Lock()
	waiter := c.permissions[requestId]
	if waiter != nil {
		delete(c.permissions, requestId)
	}
	c.permMu.Unlock()
	if waiter == nil {
		return "", fmt.Errorf("acp: no pending permission request %q", requestId)
	}
	if optionId != "" && !waiter.options[optionId] {
		optionId = ""
	}
	select {
	case waiter.reply <- permissionReply{optionId: optionId, cancelled: optionId == ""}:
	default:
	}
	return optionId, nil
}

func (c *Client) cancelPendingPermissions() {
	c.permMu.Lock()
	waiters := c.permissions
	c.permissions = make(map[string]*permissionWaiter)
	c.permMu.Unlock()
	for id, waiter := range waiters {
		select {
		case waiter.reply <- permissionReply{cancelled: true}:
		default:
		}
		if c.opts.OnPermissionCancelled != nil {
			c.opts.OnPermissionCancelled(id)
		}
	}
}

func (c *Client) handleNotification(method string, params json.RawMessage) {
	switch method {
	case MethodSessionUpdate:
		var notif struct {
			SessionId string          `json:"sessionId"`
			Update    json.RawMessage `json:"update"`
		}
		if err := json.Unmarshal(params, &notif); err != nil || len(notif.Update) == 0 {
			return
		}
		if c.opts.OnUpdate != nil {
			c.opts.OnUpdate(notif.SessionId, notif.Update)
		}
	case MethodCancelRequest:
		c.handleCancelRequest(params)
	}
}

func (c *Client) handleCancelRequest(params json.RawMessage) {
	var req struct {
		RequestId json.RawMessage `json:"requestId"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return
	}
	key := canonicalId(req.RequestId)
	if key == "" {
		return
	}
	c.permMu.Lock()
	waiter := c.permissions[key]
	if waiter != nil {
		delete(c.permissions, key)
	}
	c.permMu.Unlock()
	if waiter == nil {
		return
	}
	select {
	case waiter.reply <- permissionReply{cancelled: true, protocolCancel: true}:
	default:
	}
	if c.opts.OnPermissionCancelled != nil {
		c.opts.OnPermissionCancelled(key)
	}
}

func (c *Client) handleRequest(id json.RawMessage, method string, params json.RawMessage) (any, *RPCError) {
	switch method {
	case MethodRequestPermission:
		return c.handlePermission(id, params)
	case MethodCancelRequest:
		c.handleCancelRequest(params)
		return map[string]any{}, nil
	default:
		return nil, &RPCError{Code: RpcCodeMethodNotFound, Message: "method not supported: " + method}
	}
}

func (c *Client) handlePermission(id json.RawMessage, params json.RawMessage) (any, *RPCError) {
	var req PermissionRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, &RPCError{Code: RpcCodeInternalError, Message: "invalid session/request_permission params: " + err.Error()}
	}
	key := canonicalId(id)
	waiter := &permissionWaiter{
		options: make(map[string]bool, len(req.Options)),
		reply:   make(chan permissionReply, 1),
	}
	for _, opt := range req.Options {
		waiter.options[opt.OptionId] = true
	}
	c.permMu.Lock()
	c.permissions[key] = waiter
	c.permMu.Unlock()

	if c.opts.OnPermission == nil {
		c.permMu.Lock()
		delete(c.permissions, key)
		c.permMu.Unlock()
		return permissionOutcome{Outcome: permissionOutcomeBody{Outcome: "cancelled"}}, nil
	}
	c.opts.OnPermission(&PermissionRequestData{
		SessionId: req.SessionId,
		RequestId: key,
		ToolCall:  req.ToolCall,
		Options:   req.Options,
	})

	select {
	case reply := <-waiter.reply:
		if reply.protocolCancel {
			return nil, &RPCError{Code: RpcCodeRequestCancelled, Message: "permission request cancelled"}
		}
		if reply.cancelled || reply.optionId == "" {
			return permissionOutcome{Outcome: permissionOutcomeBody{Outcome: "cancelled"}}, nil
		}
		return permissionOutcome{Outcome: permissionOutcomeBody{Outcome: "selected", OptionId: reply.optionId}}, nil
	case <-c.conn.Closed():
		return permissionOutcome{Outcome: permissionOutcomeBody{Outcome: "cancelled"}}, nil
	}
}

type permissionOutcomeBody struct {
	Outcome  string `json:"outcome"`
	OptionId string `json:"optionId,omitempty"`
}

type permissionOutcome struct {
	Outcome permissionOutcomeBody `json:"outcome"`
}

// Close stops the child gracefully (session/close, stdin EOF), then kills its
// process tree if it does not exit. It is safe to call more than once.
func (c *Client) Close() error {
	c.closeOnce.Do(func() {
		c.stopping.Store(true)
		c.cancelPendingPermissions()
		if sessionId := c.SessionId(); sessionId != "" {
			ctx, cancel := context.WithTimeout(context.Background(), closeSessionTimeout)
			_, _ = c.conn.Call(ctx, MethodCloseSession, map[string]any{"sessionId": sessionId})
			cancel()
		}
		if c.proc == nil {
			c.conn.Close()
			return
		}
		_ = c.proc.stdin.Close()
		select {
		case <-c.proc.exited:
		case <-time.After(processExitGrace):
			c.proc.kill()
			select {
			case <-c.proc.exited:
			case <-time.After(processExitGrace):
			}
		}
		c.conn.Close()
		<-c.done
	})
	return nil
}

func canonicalId(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var num json.Number
	if err := json.Unmarshal(raw, &num); err == nil {
		return num.String()
	}
	var str string
	if err := json.Unmarshal(raw, &str); err == nil {
		return str
	}
	return strings.TrimSpace(string(raw))
}
