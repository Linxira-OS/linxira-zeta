// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package acp implements the client half of the Agent Client Protocol (ACP)
// used by the Zeta Code agent. The agent speaks JSON-RPC 2.0 framed as
// newline-delimited JSON over stdin/stdout; stderr is diagnostic output only.
package acp

import (
	"encoding/json"
	"strconv"
)

// ProtocolVersion is the ACP protocol version this client implements.
const ProtocolVersion = 1

// Agent block status values. These are server-side lifecycle states, not ACP
// stop reasons.
const (
	StatusStarting          = "starting"
	StatusIdle              = "idle"
	StatusRunning           = "running"
	StatusWaitingPermission = "waiting_permission"
	StatusError             = "error"
	StatusStopped           = "stopped"
)

// Session config option ids advertised by zetacode's ACP server.
const (
	ConfigIdMode     = "mode"
	ConfigIdModel    = "model"
	ConfigIdThinking = "thinking"
)

// ACP method names used by this client.
const (
	MethodInitialize        = "initialize"
	MethodAuthenticate      = "authenticate"
	MethodNewSession        = "session/new"
	MethodLoadSession       = "session/load"
	MethodListSessions      = "session/list"
	MethodCloseSession      = "session/close"
	MethodPrompt            = "session/prompt"
	MethodCancel            = "session/cancel"
	MethodSetMode           = "session/set_mode"
	MethodSetConfigOption   = "session/set_config_option"
	MethodSessionUpdate     = "session/update"
	MethodRequestPermission = "session/request_permission"
	MethodCancelRequest     = "$/cancel_request"
)

// JSON-RPC error codes used by the transport.
const (
	RpcCodeMethodNotFound   = -32601
	RpcCodeInternalError    = -32603
	RpcCodeRequestCancelled = -32800
)

// RPCError is a JSON-RPC error returned by the agent or generated locally.
type RPCError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *RPCError) Error() string {
	if e == nil {
		return ""
	}
	if len(e.Data) > 0 {
		return e.Message + " (code " + strconv.Itoa(e.Code) + ", data " + string(e.Data) + ")"
	}
	return e.Message + " (code " + strconv.Itoa(e.Code) + ")"
}

// Implementation identifies a client or agent to the peer.
type Implementation struct {
	Name    string `json:"name"`
	Title   string `json:"title,omitempty"`
	Version string `json:"version"`
}

// AuthMethod is an authentication method advertised by the agent.
type AuthMethod struct {
	Type        string   `json:"type,omitempty"`
	Id          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Command     string   `json:"command,omitempty"`
	Args        []string `json:"args,omitempty"`
}

// InitializeResult is the agent's response to initialize.
type InitializeResult struct {
	ProtocolVersion   int             `json:"protocolVersion"`
	AgentCapabilities map[string]any  `json:"agentCapabilities,omitempty"`
	AuthMethods       []AuthMethod    `json:"authMethods,omitempty"`
	AgentInfo         *Implementation `json:"agentInfo,omitempty"`
}

// SessionSetup is the subset of session/new and session/load responses the
// client needs. Modes and ConfigOptions are kept as raw JSON so protocol
// additions pass through to the UI unchanged.
type SessionSetup struct {
	SessionId     string          `json:"sessionId,omitempty"`
	Modes         json.RawMessage `json:"modes,omitempty"`
	ConfigOptions json.RawMessage `json:"configOptions,omitempty"`
}

// SessionInfo is one stored session from session/list.
type SessionInfo struct {
	SessionId             string         `json:"sessionId"`
	Cwd                   string         `json:"cwd"`
	AdditionalDirectories []string       `json:"additionalDirectories,omitempty"`
	Title                 string         `json:"title,omitempty"`
	UpdatedAt             string         `json:"updatedAt,omitempty"`
	Meta                  map[string]any `json:"_meta,omitempty"`
}

// ListSessionsResponse is the agent's response to session/list.
type ListSessionsResponse struct {
	Sessions   []SessionInfo `json:"sessions"`
	NextCursor string        `json:"nextCursor,omitempty"`
}

// LoadSessionResult is returned by the panel session-switch RPC. Updates are
// the session/update payloads the agent replayed while session/load ran, so
// the panel can restore the transcript deterministically instead of racing the
// live event stream.
type LoadSessionResult struct {
	SessionId     string `json:"sessionid"`
	ConfigOptions any    `json:"configoptions,omitempty"`
	Modes         any    `json:"modes,omitempty"`
	Updates       []any  `json:"updates"`
}

// PromptResponse is the agent's response to session/prompt.
type PromptResponse struct {
	StopReason string          `json:"stopReason"`
	Usage      json.RawMessage `json:"usage,omitempty"`
}

// PromptDone reports the completion of one prompt request.
type PromptDone struct {
	RequestId  int64
	StopReason string
	Usage      json.RawMessage
	Err        error
}

// ToolCallInfo mirrors the fields of an ACP ToolCall/ToolCallUpdate that the
// permission UI needs.
type ToolCallInfo struct {
	ToolCallId string `json:"toolCallId"`
	Title      string `json:"title,omitempty"`
	Name       string `json:"name,omitempty"`
	Kind       string `json:"kind,omitempty"`
	Status     string `json:"status,omitempty"`
	Content    any    `json:"content,omitempty"`
	Locations  any    `json:"locations,omitempty"`
	RawInput   any    `json:"rawInput,omitempty"`
	RawOutput  any    `json:"rawOutput,omitempty"`
}

// PermissionOption is one choice offered by session/request_permission.
type PermissionOption struct {
	OptionId string `json:"optionId"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
}

// PermissionRequest is the wire shape of session/request_permission.
type PermissionRequest struct {
	SessionId string             `json:"sessionId"`
	ToolCall  ToolCallInfo       `json:"toolCall"`
	Options   []PermissionOption `json:"options"`
}

// PermissionRequestData is published as the agent:permission event and
// appended to the blockfile stream so a reloaded UI can restore the dialog.
type PermissionRequestData struct {
	BlockId   string             `json:"blockid"`
	SessionId string             `json:"sessionid"`
	RequestId string             `json:"requestid"`
	ToolCall  ToolCallInfo       `json:"toolcall"`
	Options   []PermissionOption `json:"options"`
}

// PermissionResolutionData is appended to the stream when a permission
// request is answered or cancelled.
type PermissionResolutionData struct {
	BlockId   string `json:"blockid"`
	RequestId string `json:"requestid"`
	OptionId  string `json:"optionid,omitempty"`
	Cancelled bool   `json:"cancelled"`
}

// StatusData is published as the agent:status event and appended to the
// blockfile stream.
type StatusData struct {
	BlockId    string `json:"blockid"`
	SessionId  string `json:"sessionid,omitempty"`
	Status     string `json:"status"`
	StopReason string `json:"stopreason,omitempty"`
	Error      string `json:"error,omitempty"`
	Version    int64  `json:"version"`
}

// ConfigData is published as the agent:config event and appended to the
// blockfile stream. Raw protocol payloads (modes, config options, available
// commands) are passed through as decoded JSON so new fields need no client
// change.
type ConfigData struct {
	BlockId           string `json:"blockid"`
	SessionId         string `json:"sessionid,omitempty"`
	Modes             any    `json:"modes,omitempty"`
	ConfigOptions     any    `json:"configoptions,omitempty"`
	AvailableCommands any    `json:"availablecommands,omitempty"`
	AgentInfo         any    `json:"agentinfo,omitempty"`
}

// UpdateData is published as the agent:update event for the process-wide AI
// panel session. It carries one raw ACP session/update notification.
type UpdateData struct {
	SessionId string `json:"sessionid,omitempty"`
	Update    any    `json:"update"`
}

// StreamItem is one line in the agent blockfile stream. Update is either a
// verbatim ACP SessionUpdate (for kind values matching sessionUpdate) or one
// of the synthetic payloads above (agent_status, agent_config,
// permission_request, permission_resolved).
type StreamItem struct {
	Seq       int64           `json:"seq"`
	Id        string          `json:"id"`
	SessionId string          `json:"sessionid,omitempty"`
	Ts        int64           `json:"ts"`
	Kind      string          `json:"kind"`
	Update    json.RawMessage `json:"update"`
}
