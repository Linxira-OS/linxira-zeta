// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package acp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestAcpHelperProcess is not a real test: when GO_ACP_HELPER=1 it acts as a
// minimal ACP agent over stdin/stdout for the process lifecycle tests. It must
// run before the test framework prints anything, hence os.Exit.
func TestAcpHelperProcess(t *testing.T) {
	if os.Getenv("GO_ACP_HELPER") != "1" {
		return
	}
	if os.Getenv("GO_ACP_HELPER_CRASH") == "1" {
		os.Exit(3)
	}
	dec := json.NewDecoder(os.Stdin)
	enc := json.NewEncoder(os.Stdout)
	stubborn := os.Getenv("GO_ACP_HELPER_STUBBORN") == "1"
	for {
		var msg wireMessage
		if err := dec.Decode(&msg); err != nil {
			if stubborn {
				time.Sleep(time.Hour)
				os.Exit(0)
			}
			os.Exit(0)
		}
		if msg.Method == "" || len(msg.Id) == 0 {
			continue
		}
		var result any
		switch msg.Method {
		case MethodInitialize:
			result = map[string]any{"protocolVersion": 1, "agentInfo": map[string]any{"name": "fake", "version": "0"}}
		case MethodAuthenticate, MethodSetMode, MethodSetConfigOption, MethodCloseSession:
			result = map[string]any{}
		case MethodNewSession, MethodLoadSession:
			var params struct {
				SessionId string `json:"sessionId"`
			}
			_ = json.Unmarshal(msg.Params, &params)
			sessionId := params.SessionId
			if sessionId == "" {
				sessionId = "test-session"
			}
			result = map[string]any{"sessionId": sessionId}
		case MethodPrompt:
			result = map[string]any{"stopReason": "end_turn"}
		default:
			_ = enc.Encode(map[string]any{
				"jsonrpc": "2.0",
				"id":      msg.Id,
				"error":   map[string]any{"code": RpcCodeMethodNotFound, "message": "unsupported"},
			})
			continue
		}
		if err := enc.Encode(map[string]any{"jsonrpc": "2.0", "id": msg.Id, "result": result}); err != nil {
			os.Exit(1)
		}
	}
}

func helperCommandArgs() []string {
	return []string{"-test.run=TestAcpHelperProcess", "--"}
}

func startHelperClient(t *testing.T, crash bool) (*Client, clientEvents) {
	t.Helper()
	events := clientEvents{
		prompts: make(chan PromptDone, 4),
		exits:   make(chan error, 1),
	}
	env := append(os.Environ(), "GO_ACP_HELPER=1")
	if crash {
		env = append(env, "GO_ACP_HELPER_CRASH=1")
	}
	return startHelperClientEnv(t, env, events)
}

func startHelperClientEnv(t *testing.T, env []string, events clientEvents) (*Client, clientEvents) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("locate test executable: %v", err)
	}
	client, err := StartProcess(ClientOptions{
		Command: exe,
		Args:    helperCommandArgs(),
		Dir:     t.TempDir(),
		Env:     env,
		OnPromptDone: func(done PromptDone) {
			events.prompts <- done
		},
		OnExit: func(err error) {
			events.exits <- err
		},
	})
	if err != nil {
		t.Fatalf("start process: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client, events
}

type clientEvents struct {
	prompts chan PromptDone
	exits   chan error
}

func TestProcessLifecycleAndClose(t *testing.T) {
	client, events := startHelperClient(t, false)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := client.Initialize(ctx); err != nil {
		t.Fatalf("initialize: %v", err)
	}
	if err := client.Authenticate(ctx, "agent"); err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	cwd, _ := filepath.Abs(t.TempDir())
	setup, err := client.NewSession(ctx, cwd)
	if err != nil {
		t.Fatalf("new session: %v", err)
	}
	if setup.SessionId != "test-session" {
		t.Fatalf("unexpected session id %q", setup.SessionId)
	}
	if _, err := client.SendPrompt(setup.SessionId, "hello"); err != nil {
		t.Fatalf("send prompt: %v", err)
	}
	select {
	case done := <-events.prompts:
		if done.Err != nil || done.StopReason != "end_turn" {
			t.Fatalf("prompt completion: %#v", done)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("prompt completion timed out")
	}

	closeDone := make(chan struct{})
	go func() {
		_ = client.Close()
		close(closeDone)
	}()
	select {
	case <-closeDone:
	case <-time.After(10 * time.Second):
		t.Fatal("Close hung")
	}
	select {
	case <-client.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("process was not reaped")
	}
	select {
	case err := <-events.exits:
		t.Fatalf("unexpected exit callback during deliberate close: %v", err)
	default:
	}
}

func TestProcessCrashReportsExit(t *testing.T) {
	client, events := startHelperClient(t, true)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = client.Initialize(ctx)
	select {
	case <-events.exits:
	case <-time.After(10 * time.Second):
		t.Fatal("crash exit was not reported")
	}
	closeDone := make(chan struct{})
	go func() {
		_ = client.Close()
		close(closeDone)
	}()
	select {
	case <-closeDone:
	case <-time.After(10 * time.Second):
		t.Fatal("Close hung after crash")
	}
}

func TestProcessStubbornChildIsKilled(t *testing.T) {
	env := append(os.Environ(), "GO_ACP_HELPER=1", "GO_ACP_HELPER_STUBBORN=1")
	events := clientEvents{
		prompts: make(chan PromptDone, 1),
		exits:   make(chan error, 1),
	}
	client, _ := startHelperClientEnv(t, env, events)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := client.Initialize(ctx); err != nil {
		t.Fatalf("initialize: %v", err)
	}
	start := time.Now()
	_ = client.Close()
	if elapsed := time.Since(start); elapsed > 8*time.Second {
		t.Fatalf("Close took %s; process tree was not killed promptly", elapsed)
	}
	select {
	case <-client.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("stubborn child was not reaped")
	}
}
