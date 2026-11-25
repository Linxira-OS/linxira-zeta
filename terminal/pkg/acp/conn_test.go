// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"sync"
	"testing"
	"time"
)

type testPeer struct {
	readFile  *os.File
	writeFile *os.File
	reader    *bufio.Reader
}

func newPipeClient(t *testing.T, opts ClientOptions) (*Client, *testPeer) {
	t.Helper()
	clientRead, peerWrite, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	peerRead, clientWrite, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	c := newClient(clientRead, clientWrite, opts)
	c.conn.SetNotificationHandler(c.handleNotification)
	c.conn.Start()
	peer := &testPeer{readFile: peerRead, writeFile: peerWrite, reader: bufio.NewReader(peerRead)}
	t.Cleanup(func() {
		_ = c.conn.Close()
		_ = peer.readFile.Close()
		_ = peer.writeFile.Close()
	})
	return c, peer
}

func newTestPeer(t *testing.T) (*Client, *testPeer) {
	t.Helper()
	return newPipeClient(t, ClientOptions{OnPermission: func(req *PermissionRequestData) {}})
}

func (p *testPeer) readMessage(t *testing.T) wireMessage {
	t.Helper()
	line, err := p.reader.ReadBytes('\n')
	if err != nil {
		t.Fatalf("peer read: %v", err)
	}
	var msg wireMessage
	if err := json.Unmarshal(line, &msg); err != nil {
		t.Fatalf("peer unmarshal %q: %v", line, err)
	}
	return msg
}

func (p *testPeer) write(t *testing.T, format string, args ...any) {
	t.Helper()
	if _, err := fmt.Fprintf(p.writeFile, format+"\n", args...); err != nil {
		t.Fatalf("peer write: %v", err)
	}
}

func (p *testPeer) reply(t *testing.T, id json.RawMessage, result string) {
	t.Helper()
	p.write(t, `{"jsonrpc":"2.0","id":%s,"result":%s}`, string(id), result)
}

func TestConnRequestResponseAndIdMatching(t *testing.T) {
	c, peer := newTestPeer(t)

	type result struct {
		value string
		err   error
	}
	results := make(chan result, 2)
	go func() {
		raw, err := c.conn.Call(context.Background(), "test/first", map[string]any{"n": 1})
		results <- result{string(raw), err}
	}()
	req1 := peer.readMessage(t)
	if req1.Method != "test/first" {
		t.Fatalf("unexpected method %q", req1.Method)
	}

	go func() {
		raw, err := c.conn.Call(context.Background(), "test/second", map[string]any{"n": 2})
		results <- result{string(raw), err}
	}()
	req2 := peer.readMessage(t)

	// Answer in reverse order: each caller must still get its own result.
	peer.reply(t, req2.Id, `{"value":"second"}`)
	peer.reply(t, req1.Id, `{"value":"first"}`)

	got := map[string]string{}
	for i := 0; i < 2; i++ {
		select {
		case res := <-results:
			if res.err != nil {
				t.Fatalf("call error: %v", res.err)
			}
			var parsed struct {
				Value string `json:"value"`
			}
			if err := json.Unmarshal([]byte(res.value), &parsed); err != nil {
				t.Fatalf("unmarshal result: %v", err)
			}
			got[parsed.Value] = res.value
		case <-time.After(5 * time.Second):
			t.Fatal("timed out waiting for calls")
		}
	}
	if len(got) != 2 {
		t.Fatalf("responses were not matched by id: %#v", got)
	}
}

func TestConnFramingAndNotifications(t *testing.T) {
	notifications := make(chan string, 4)
	clientEnd, peerEnd := net.Pipe()
	_ = peerEnd.SetDeadline(time.Now().Add(10 * time.Second))
	c := NewConn(clientEnd, clientEnd, func(id json.RawMessage, method string, params json.RawMessage) (any, *RPCError) {
		return map[string]any{"ok": true}, nil
	})
	c.SetNotificationHandler(func(method string, params json.RawMessage) {
		notifications <- method
	})
	c.Start()
	defer c.Close()
	defer peerEnd.Close()

	// A notification plus a request in one write, CRLF terminated.
	if _, err := fmt.Fprintf(peerEnd,
		"{\"jsonrpc\":\"2.0\",\"method\":\"session/update\",\"params\":{}}\r\n"+
			"{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"ping\",\"params\":{}}\n"); err != nil {
		t.Fatalf("write frames: %v", err)
	}
	select {
	case method := <-notifications:
		if method != "session/update" {
			t.Fatalf("unexpected notification %q", method)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("notification not delivered")
	}
	line, err := bufio.NewReader(peerEnd).ReadBytes('\n')
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	var resp wireMessage
	if err := json.Unmarshal(line, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if string(resp.Id) != "99" || string(resp.Result) != `{"ok":true}` {
		t.Fatalf("unexpected response: %s", line)
	}
}

func TestConnCloseFailsPendingCall(t *testing.T) {
	c, peer := newTestPeer(t)
	errCh := make(chan error, 1)
	go func() {
		_, err := c.conn.Call(context.Background(), "never/answer", nil)
		errCh <- err
	}()
	_ = peer.readMessage(t)
	_ = c.conn.Close()
	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("pending call returned nil error after close")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("pending call did not unblock on close")
	}
}

func TestConnWritesAreSerialized(t *testing.T) {
	c, peer := newTestPeer(t)
	const n = 20
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _ = c.conn.Call(context.Background(), "test/parallel", map[string]any{"i": i})
		}(i)
	}
	for range n {
		msg := peer.readMessage(t)
		if msg.Method != "test/parallel" {
			t.Fatalf("interleaved frame: %q", msg.Method)
		}
		peer.reply(t, msg.Id, `{}`)
	}
	wg.Wait()
}
