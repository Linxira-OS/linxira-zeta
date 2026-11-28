// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentservice

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/acp"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

const fakePanelAgentEnv = "GO_WANT_ACP_PANEL_AGENT"

func TestMain(m *testing.M) {
	if os.Getenv(fakePanelAgentEnv) == "1" {
		runFakePanelAgent()
		return
	}
	os.Exit(m.Run())
}

type fakePanelMessage struct {
	Jsonrpc string          `json:"jsonrpc"`
	Id      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
	Result  json.RawMessage `json:"result"`
	Error   json.RawMessage `json:"error"`
}

func runFakePanelAgent() {
	reader := bufio.NewReader(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()
	write := func(value any) {
		raw, err := json.Marshal(value)
		if err != nil {
			return
		}
		_, _ = writer.Write(append(raw, '\n'))
		_ = writer.Flush()
	}
	respond := func(id json.RawMessage, result any) {
		write(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
	}
	notify := func(method string, params any) {
		write(map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
	}
	var pendingPrompt json.RawMessage
	fakeModel := "fake/basic"
	fakeThinking := "off"
	configOptions := func() []any {
		return []any{
			map[string]any{
				"id":           "model",
				"name":         "Model",
				"category":     "model",
				"type":         "select",
				"currentValue": fakeModel,
				"options": []any{
					map[string]any{"value": "fake/basic", "name": "Fake Basic"},
					map[string]any{"value": "fake/advanced", "name": "Fake Advanced"},
				},
			},
			map[string]any{
				"id":           "thinking",
				"name":         "Thinking",
				"category":     "thought_level",
				"type":         "select",
				"currentValue": fakeThinking,
				"options": []any{
					map[string]any{"value": "off", "name": "Off"},
					map[string]any{"value": "high", "name": "High"},
				},
			},
		}
	}
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			var msg fakePanelMessage
			if json.Unmarshal(line, &msg) == nil {
				if msg.Method == "" {
					// A response from the client (currently only a permission reply).
					if pendingPrompt != nil {
						respond(pendingPrompt, map[string]any{"stopReason": "end_turn"})
						pendingPrompt = nil
					}
				} else {
					switch msg.Method {
					case acp.MethodInitialize:
						respond(msg.Id, map[string]any{
							"protocolVersion": acp.ProtocolVersion,
							"agentInfo":       map[string]any{"name": "fake-zeta", "version": "1.0.0"},
						})
					case acp.MethodAuthenticate:
						respond(msg.Id, map[string]any{})
					case acp.MethodNewSession:
						respond(msg.Id, map[string]any{
							"sessionId":     "panel-session",
							"configOptions": configOptions(),
						})
					case acp.MethodListSessions:
						cwd, _ := os.Getwd()
						respond(msg.Id, map[string]any{
							"sessions": []any{
								map[string]any{
									"sessionId": "older-session",
									"cwd":       cwd,
									"title":     "Older Chat",
									"updatedAt": "2026-11-01T10:00:00Z",
									"_meta":     map[string]any{"messageCount": 4},
								},
								map[string]any{
									"sessionId": "panel-session",
									"cwd":       cwd,
									"title":     "Current Chat",
									"updatedAt": "2026-11-02T10:00:00Z",
									"_meta":     map[string]any{"messageCount": 2},
								},
							},
							"nextCursor": "",
						})
					case acp.MethodLoadSession:
						var params struct {
							SessionId string `json:"sessionId"`
						}
						_ = json.Unmarshal(msg.Params, &params)
						if params.SessionId != "older-session" {
							write(map[string]any{
								"jsonrpc": "2.0",
								"id":      msg.Id,
								"error": map[string]any{
									"code":    acp.RpcCodeInternalError,
									"message": "ACP session not found: " + params.SessionId,
								},
							})
							continue
						}
						fakeModel = "fake/basic"
						fakeThinking = "off"
						notify(acp.MethodSessionUpdate, map[string]any{
							"sessionId": params.SessionId,
							"update": map[string]any{
								"sessionUpdate": "user_message_chunk",
								"content":       map[string]any{"type": "text", "text": "old question"},
								"messageId":     "replay-user",
							},
						})
						notify(acp.MethodSessionUpdate, map[string]any{
							"sessionId": params.SessionId,
							"update": map[string]any{
								"sessionUpdate": "agent_message_chunk",
								"content":       map[string]any{"type": "text", "text": "old answer"},
								"messageId":     "replay-assistant",
							},
						})
						respond(msg.Id, map[string]any{
							"configOptions": configOptions(),
						})
					case acp.MethodSetConfigOption:
						var params struct {
							ConfigId string `json:"configId"`
							Value    string `json:"value"`
						}
						_ = json.Unmarshal(msg.Params, &params)
						switch params.ConfigId {
						case "model":
							fakeModel = params.Value
						case "thinking":
							fakeThinking = params.Value
						}
						respond(msg.Id, map[string]any{
							"configOptions": configOptions(),
						})
					case acp.MethodPrompt:
						pendingPrompt = append(json.RawMessage(nil), msg.Id...)
						notify(acp.MethodSessionUpdate, map[string]any{
							"sessionId": "panel-session",
							"update": map[string]any{
								"sessionUpdate": "agent_message_chunk",
								"content":       map[string]any{"type": "text", "text": "hello from fake acp"},
							},
						})
						notify(acp.MethodSessionUpdate, map[string]any{
							"sessionId": "panel-session",
							"update": map[string]any{
								"sessionUpdate": "tool_call",
								"toolCallId":    "tool-1",
								"title":         "Reading a file",
								"kind":          "read",
								"status":        "pending",
							},
						})
						write(map[string]any{
							"jsonrpc": "2.0",
							"id":      99,
							"method":  acp.MethodRequestPermission,
							"params": map[string]any{
								"sessionId": "panel-session",
								"toolCall":  map[string]any{"toolCallId": "tool-1", "title": "Reading a file", "kind": "read"},
								"options": []any{
									map[string]any{"optionId": "allow_once", "name": "Allow", "kind": "allow_once"},
									map[string]any{"optionId": "reject_once", "name": "Reject", "kind": "reject_once"},
								},
							},
						})
					case acp.MethodCancel:
						if pendingPrompt != nil {
							respond(pendingPrompt, map[string]any{"stopReason": "cancelled"})
							pendingPrompt = nil
						}
					case acp.MethodCloseSession:
						respond(msg.Id, map[string]any{})
					default:
						write(map[string]any{
							"jsonrpc": "2.0",
							"id":      msg.Id,
							"error":   map[string]any{"code": acp.RpcCodeMethodNotFound, "message": "fake agent does not implement " + msg.Method},
						})
					}
				}
			}
		}
		if err != nil {
			return
		}
	}
}

type recordingEventClient struct {
	events chan wps.WaveEvent
}

func (c *recordingEventClient) SendEvent(_ string, event wps.WaveEvent) {
	select {
	case c.events <- event:
	default:
	}
}

func subscribePanelTestEvents(t *testing.T) *recordingEventClient {
	t.Helper()
	client := &recordingEventClient{events: make(chan wps.WaveEvent, 128)}
	wps.Broker.SetClient(client)
	t.Cleanup(func() { wps.Broker.SetClient(nil) })
	for _, eventName := range []string{
		wps.Event_AgentStatus,
		wps.Event_AgentConfig,
		wps.Event_AgentUpdate,
		wps.Event_AgentPermission,
		wps.Event_AgentPermissionDone,
	} {
		wps.Broker.Subscribe("panel-test", wps.SubscriptionRequest{
			Event:  eventName,
			Scopes: []string{PanelEventScope},
		})
	}
	t.Cleanup(func() {
		for _, eventName := range []string{
			wps.Event_AgentStatus,
			wps.Event_AgentConfig,
			wps.Event_AgentUpdate,
			wps.Event_AgentPermission,
			wps.Event_AgentPermissionDone,
		} {
			wps.Broker.Unsubscribe("panel-test", eventName)
		}
	})
	return client
}

func waitForEvent(t *testing.T, events <-chan wps.WaveEvent, predicate func(wps.WaveEvent) bool) wps.WaveEvent {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		select {
		case event := <-events:
			if predicate(event) {
				return event
			}
		case <-deadline:
			t.Fatal("timed out waiting for panel event")
		}
	}
}

func TestPanelSessionPromptThroughFakeACP(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("resolve test executable: %v", err)
	}
	t.Setenv("ZETACODE_PATH", executable)
	t.Setenv(fakePanelAgentEnv, "1")

	cwd := t.TempDir()
	events := subscribePanelTestEvents(t)
	previousPanel := agentPanel
	agentPanel = &panelSession{}
	t.Cleanup(func() {
		agentPanel.shutdown()
		agentPanel = previousPanel
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := AgentServiceInstance.PanelStart(ctx, cwd); err != nil {
		t.Fatalf("PanelStart: %v", err)
	}
	status, err := AgentServiceInstance.PanelStatus(ctx)
	if err != nil || status.Status != acp.StatusIdle || status.SessionId != "panel-session" {
		t.Fatalf("unexpected panel status: %#v err=%v", status, err)
	}
	config, err := AgentServiceInstance.PanelConfig(ctx)
	if err != nil {
		t.Fatalf("PanelConfig: %v", err)
	}
	configJSON, _ := json.Marshal(config.ConfigOptions)
	if !strings.Contains(string(configJSON), `"currentValue":"fake/basic"`) {
		t.Fatalf("expected initial model config option, got %s", configJSON)
	}

	if err := AgentServiceInstance.PanelPrompt(ctx, "hello panel"); err != nil {
		t.Fatalf("PanelPrompt: %v", err)
	}

	updateEvent := waitForEvent(t, events.events, func(event wps.WaveEvent) bool {
		if event.Event != wps.Event_AgentUpdate {
			return false
		}
		update, ok := event.Data.(*acp.UpdateData)
		if !ok {
			return false
		}
		raw, _ := json.Marshal(update.Update)
		return strings.Contains(string(raw), "hello from fake acp")
	})
	update, ok := updateEvent.Data.(*acp.UpdateData)
	if !ok || update.SessionId != "panel-session" {
		t.Fatalf("unexpected update event: %#v", updateEvent.Data)
	}

	permissionEvent := waitForEvent(t, events.events, func(event wps.WaveEvent) bool {
		return event.Event == wps.Event_AgentPermission
	})
	permission, ok := permissionEvent.Data.(*acp.PermissionRequestData)
	if !ok || permission.RequestId != "99" || len(permission.Options) != 2 {
		t.Fatalf("unexpected permission event: %#v", permissionEvent.Data)
	}
	pending, err := AgentServiceInstance.PanelPendingPermissions(ctx)
	if err != nil || len(pending) != 1 || pending[0].RequestId != "99" {
		t.Fatalf("unexpected pending permissions: %#v err=%v", pending, err)
	}
	if _, err := AgentServiceInstance.PanelLoadSession(ctx, "older-session"); err == nil ||
		!strings.Contains(err.Error(), "busy") {
		t.Fatalf("expected busy error while a turn is awaiting approval, got %v", err)
	}

	if err := AgentServiceInstance.PanelRespondPermission(ctx, permission.RequestId, "allow_once"); err != nil {
		t.Fatalf("PanelRespondPermission: %v", err)
	}
	waitForEvent(t, events.events, func(event wps.WaveEvent) bool {
		if event.Event != wps.Event_AgentPermissionDone {
			return false
		}
		resolved, ok := event.Data.(*acp.PermissionResolutionData)
		return ok && resolved.RequestId == "99" && resolved.OptionId == "allow_once"
	})
	pending, err = AgentServiceInstance.PanelPendingPermissions(ctx)
	if err != nil || len(pending) != 0 {
		t.Fatalf("expected no pending permissions after answer, got %#v err=%v", pending, err)
	}
	idleEvent := waitForEvent(t, events.events, func(event wps.WaveEvent) bool {
		if event.Event != wps.Event_AgentStatus {
			return false
		}
		data, ok := event.Data.(*acp.StatusData)
		return ok && data.Status == acp.StatusIdle && data.StopReason == "end_turn"
	})
	if idleEvent.Data == nil {
		t.Fatal("expected idle status event")
	}

	if err := AgentServiceInstance.PanelSetModel(ctx, "fake/advanced"); err != nil {
		t.Fatalf("PanelSetModel: %v", err)
	}
	config = mustPanelConfig(t, ctx)
	configJSON, _ = json.Marshal(config.ConfigOptions)
	if !strings.Contains(string(configJSON), `"currentValue":"fake/advanced"`) {
		t.Fatalf("expected updated model config option, got %s", configJSON)
	}

	if err := AgentServiceInstance.PanelSetConfigOption(ctx, "thinking", "high"); err != nil {
		t.Fatalf("PanelSetConfigOption: %v", err)
	}
	config = mustPanelConfig(t, ctx)
	configJSON, _ = json.Marshal(config.ConfigOptions)
	if !strings.Contains(string(configJSON), `"id":"thinking"`) ||
		!strings.Contains(string(configJSON), `"currentValue":"high"`) {
		t.Fatalf("expected updated thinking config option, got %s", configJSON)
	}
	waitForEvent(t, events.events, func(event wps.WaveEvent) bool {
		if event.Event != wps.Event_AgentConfig {
			return false
		}
		data, ok := event.Data.(*acp.ConfigData)
		if !ok {
			return false
		}
		raw, _ := json.Marshal(data.ConfigOptions)
		return strings.Contains(string(raw), `"id":"thinking"`) && strings.Contains(string(raw), `"currentValue":"high"`)
	})
}

func mustPanelConfig(t *testing.T, ctx context.Context) *acp.ConfigData {
	t.Helper()
	config, err := AgentServiceInstance.PanelConfig(ctx)
	if err != nil {
		t.Fatalf("PanelConfig: %v", err)
	}
	return config
}

func TestPanelSessionListAndLoad(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("resolve test executable: %v", err)
	}
	t.Setenv("ZETACODE_PATH", executable)
	t.Setenv(fakePanelAgentEnv, "1")

	cwd := t.TempDir()
	events := subscribePanelTestEvents(t)
	previousPanel := agentPanel
	agentPanel = &panelSession{}
	t.Cleanup(func() {
		agentPanel.shutdown()
		agentPanel = previousPanel
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := AgentServiceInstance.PanelStart(ctx, cwd); err != nil {
		t.Fatalf("PanelStart: %v", err)
	}
	if err := AgentServiceInstance.PanelSetModel(ctx, "fake/advanced"); err != nil {
		t.Fatalf("PanelSetModel: %v", err)
	}
	if err := AgentServiceInstance.PanelSetConfigOption(ctx, "thinking", "high"); err != nil {
		t.Fatalf("PanelSetConfigOption: %v", err)
	}

	list, err := AgentServiceInstance.PanelListSessions(ctx)
	if err != nil {
		t.Fatalf("PanelListSessions: %v", err)
	}
	if len(list.Sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %#v", list.Sessions)
	}
	var older *acp.SessionInfo
	for idx := range list.Sessions {
		if list.Sessions[idx].SessionId == "older-session" {
			older = &list.Sessions[idx]
		}
	}
	if older == nil || older.Title != "Older Chat" {
		t.Fatalf("expected older session with title, got %#v", list.Sessions)
	}
	if count, ok := older.Meta["messageCount"].(float64); !ok || count != 4 {
		t.Fatalf("expected replayed message count meta, got %#v", older.Meta)
	}

	loaded, err := AgentServiceInstance.PanelLoadSession(ctx, "older-session")
	if err != nil {
		t.Fatalf("PanelLoadSession: %v", err)
	}
	if loaded.SessionId != "older-session" || len(loaded.Updates) != 2 {
		t.Fatalf("unexpected load result: %#v", loaded)
	}
	replayJSON, _ := json.Marshal(loaded.Updates)
	if !strings.Contains(string(replayJSON), "old question") || !strings.Contains(string(replayJSON), "old answer") {
		t.Fatalf("expected replayed transcript, got %s", replayJSON)
	}

	config := mustPanelConfig(t, ctx)
	if config.SessionId != "older-session" {
		t.Fatalf("expected switched session id, got %q", config.SessionId)
	}
	configJSON, _ := json.Marshal(config.ConfigOptions)
	if !strings.Contains(string(configJSON), `"currentValue":"fake/advanced"`) ||
		!strings.Contains(string(configJSON), `"currentValue":"high"`) {
		t.Fatalf("expected model/effort preserved across switch, got %s", configJSON)
	}
	status, err := AgentServiceInstance.PanelStatus(ctx)
	if err != nil || status.SessionId != "older-session" || status.Status != acp.StatusIdle {
		t.Fatalf("unexpected status after switch: %#v err=%v", status, err)
	}
	waitForEvent(t, events.events, func(event wps.WaveEvent) bool {
		if event.Event != wps.Event_AgentConfig {
			return false
		}
		data, ok := event.Data.(*acp.ConfigData)
		return ok && data.SessionId == "older-session"
	})

	if _, err := AgentServiceInstance.PanelLoadSession(ctx, "missing-session"); err == nil ||
		!strings.Contains(err.Error(), "ACP session not found") {
		t.Fatalf("expected missing session error, got %v", err)
	}
	config = mustPanelConfig(t, ctx)
	if config.SessionId != "older-session" {
		t.Fatalf("failed switch must keep the active session, got %q", config.SessionId)
	}
	status, err = AgentServiceInstance.PanelStatus(ctx)
	if err != nil || status.SessionId != "older-session" || status.Status != acp.StatusIdle {
		t.Fatalf("failed switch must keep panel state, got %#v err=%v", status, err)
	}
}

func TestPanelSessionRejectsUnknownCommandWrapper(t *testing.T) {
	cwd := t.TempDir()
	t.Setenv("ZETACODE_PATH", "fake.cmd")
	previousPanel := agentPanel
	agentPanel = &panelSession{}
	t.Cleanup(func() {
		agentPanel.shutdown()
		agentPanel = previousPanel
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := AgentServiceInstance.PanelStart(ctx, cwd)
	if err == nil || !strings.Contains(err.Error(), "native zetacode executable") {
		t.Fatalf("expected native executable error, got %v", err)
	}
	status, statusErr := AgentServiceInstance.PanelStatus(ctx)
	if statusErr != nil || status.Status != acp.StatusError {
		t.Fatalf("expected error status, got %#v err=%v", status, statusErr)
	}
}

func TestPanelSessionEmptyPrompt(t *testing.T) {
	previousPanel := agentPanel
	agentPanel = &panelSession{}
	t.Cleanup(func() {
		agentPanel.shutdown()
		agentPanel = previousPanel
	})
	if err := AgentServiceInstance.PanelPrompt(context.Background(), "   "); err == nil {
		t.Fatal("expected empty prompt error")
	}
}

func TestPanelSetConfigOptionValidation(t *testing.T) {
	previousPanel := agentPanel
	agentPanel = &panelSession{}
	t.Cleanup(func() {
		agentPanel.shutdown()
		agentPanel = previousPanel
	})
	ctx := context.Background()
	if err := AgentServiceInstance.PanelSetConfigOption(ctx, "", "high"); err == nil ||
		!strings.Contains(err.Error(), "config id is empty") {
		t.Fatalf("expected empty config id error, got %v", err)
	}
	if err := AgentServiceInstance.PanelSetConfigOption(ctx, "thinking", "  "); err == nil ||
		!strings.Contains(err.Error(), "config value is empty") {
		t.Fatalf("expected empty config value error, got %v", err)
	}
	if err := AgentServiceInstance.PanelSetConfigOption(ctx, "thinking", "high"); err == nil ||
		!strings.Contains(err.Error(), "panel session is not running") {
		t.Fatalf("expected not-running error, got %v", err)
	}
}
