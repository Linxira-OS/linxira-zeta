// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package acp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func newPermissionClient(t *testing.T) (*Client, *testPeer, chan *PermissionRequestData, chan string) {
	t.Helper()
	requests := make(chan *PermissionRequestData, 4)
	cancelled := make(chan string, 4)
	c, peer := newPipeClient(t, ClientOptions{
		OnPermission:          func(req *PermissionRequestData) { requests <- req },
		OnPermissionCancelled: func(id string) { cancelled <- id },
	})
	return c, peer, requests, cancelled
}

func writePermissionRequest(t *testing.T, peer *testPeer, id int, optionIds ...string) {
	t.Helper()
	options := make([]string, 0, len(optionIds))
	for _, option := range optionIds {
		options = append(options, fmt.Sprintf(`{"optionId":%q,"name":%q,"kind":"allow_once"}`, option, option))
	}
	payload := fmt.Sprintf(
		`{"sessionId":"s1","toolCall":{"toolCallId":"t1","title":"Run tests"},"options":[%s]}`,
		joinStrings(options, ","),
	)
	peer.write(t, `{"jsonrpc":"2.0","id":%d,"method":"session/request_permission","params":%s}`, id, payload)
}

func joinStrings(values []string, sep string) string {
	return strings.Join(values, sep)
}

func readRPCResponse(t *testing.T, peer *testPeer) wireMessage {
	t.Helper()
	return peer.readMessage(t)
}

func TestPermissionSelectedOption(t *testing.T) {
	c, peer, requests, _ := newPermissionClient(t)
	writePermissionRequest(t, peer, 42, "allow_once", "reject_once")

	var req *PermissionRequestData
	select {
	case req = <-requests:
	case <-time.After(5 * time.Second):
		t.Fatal("permission event not delivered")
	}
	if req.RequestId != "42" || len(req.Options) != 2 || req.ToolCall.ToolCallId != "t1" {
		t.Fatalf("unexpected permission request: %#v", req)
	}
	if applied, err := c.RespondPermission(req.RequestId, "allow_once"); err != nil || applied != "allow_once" {
		t.Fatalf("respond: applied=%q err=%v", applied, err)
	}
	resp := readRPCResponse(t, peer)
	if string(resp.Id) != "42" {
		t.Fatalf("wrong response id: %s", resp.Id)
	}
	var outcome permissionOutcome
	if err := json.Unmarshal(resp.Result, &outcome); err != nil {
		t.Fatalf("unmarshal outcome: %v", err)
	}
	if outcome.Outcome.Outcome != "selected" || outcome.Outcome.OptionId != "allow_once" {
		t.Fatalf("unexpected outcome: %#v", outcome)
	}
}

func TestPermissionUnknownOptionDenies(t *testing.T) {
	c, peer, requests, _ := newPermissionClient(t)
	writePermissionRequest(t, peer, 43, "allow_once")
	req := <-requests
	if applied, err := c.RespondPermission(req.RequestId, "not-an-option"); err != nil || applied != "" {
		t.Fatalf("respond: applied=%q err=%v", applied, err)
	}
	resp := readRPCResponse(t, peer)
	var outcome permissionOutcome
	if err := json.Unmarshal(resp.Result, &outcome); err != nil {
		t.Fatalf("unmarshal outcome: %v", err)
	}
	if outcome.Outcome.Outcome != "cancelled" {
		t.Fatalf("unknown option must deny, got %#v", outcome)
	}
}

func TestPermissionCancelRequest(t *testing.T) {
	_, peer, requests, cancelled := newPermissionClient(t)
	writePermissionRequest(t, peer, 44, "allow_once")
	<-requests
	peer.write(t, `{"jsonrpc":"2.0","method":"$/cancel_request","params":{"requestId":44}}`)

	resp := readRPCResponse(t, peer)
	if resp.Error == nil || resp.Error.Code != RpcCodeRequestCancelled {
		t.Fatalf("expected request-cancelled error, got %#v", resp)
	}
	select {
	case id := <-cancelled:
		if id != "44" {
			t.Fatalf("unexpected cancelled id %q", id)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("permission-cancelled callback not fired")
	}
}

func TestPermissionCloseAnswersCancelled(t *testing.T) {
	c, peer, requests, _ := newPermissionClient(t)
	writePermissionRequest(t, peer, 45, "allow_once")
	<-requests

	closeDone := make(chan error, 1)
	go func() { closeDone <- c.Close() }()
	select {
	case err := <-closeDone:
		if err != nil {
			t.Fatalf("close: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("close did not complete with a pending permission request")
	}
}

func TestSendPromptReturnsAndReportsCompletion(t *testing.T) {
	done := make(chan PromptDone, 1)
	c, peer := newPipeClient(t, ClientOptions{
		OnPromptDone: func(d PromptDone) { done <- d },
	})
	defer c.Close()

	if _, err := c.SendPrompt("s1", "hello"); err != nil {
		t.Fatalf("send prompt: %v", err)
	}
	req := peer.readMessage(t)
	if req.Method != MethodPrompt {
		t.Fatalf("unexpected method %q", req.Method)
	}
	var params struct {
		SessionId string `json:"sessionId"`
		Prompt    []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"prompt"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		t.Fatalf("prompt params: %v", err)
	}
	if params.SessionId != "s1" || len(params.Prompt) != 1 || params.Prompt[0].Text != "hello" {
		t.Fatalf("unexpected prompt params: %#v", params)
	}
	peer.reply(t, req.Id, `{"stopReason":"end_turn"}`)
	select {
	case result := <-done:
		if result.Err != nil || result.StopReason != "end_turn" {
			t.Fatalf("unexpected prompt completion: %#v", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("prompt completion not reported")
	}
}

func TestCancelNotifiesAgent(t *testing.T) {
	c, peer := newTestPeer(t)
	if err := c.Cancel("s1"); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	msg := peer.readMessage(t)
	if msg.Method != MethodCancel || len(msg.Id) != 0 {
		t.Fatalf("unexpected cancel frame: %#v", msg)
	}
}

func TestInitializeParsesResult(t *testing.T) {
	c, peer := newPipeClient(t, ClientOptions{ClientInfo: Implementation{Name: "test"}})
	defer c.Close()

	go func() {
		line, err := peer.reader.ReadBytes('\n')
		if err != nil {
			return
		}
		var req wireMessage
		if err := json.Unmarshal(line, &req); err != nil {
			return
		}
		_, _ = fmt.Fprintf(peer.writeFile, `{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1,"agentInfo":{"name":"zeta","version":"1.2.3"}}}`+"\n", string(req.Id))
	}()
	res, err := c.Initialize(context.Background())
	if err != nil {
		t.Fatalf("initialize: %v", err)
	}
	if res.ProtocolVersion != 1 || res.AgentInfo == nil || res.AgentInfo.Name != "zeta" {
		t.Fatalf("unexpected initialize result: %#v", res)
	}
}
