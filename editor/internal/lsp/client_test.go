package lsp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"testing"
)

func TestClientCallAndResponse(t *testing.T) {
	clientR, serverW := io.Pipe()
	serverR, clientW := io.Pipe()

	c := &Client{
		codec:   NewCodec(clientR, clientW),
		nextID:  1,
		pending: make(map[int]chan Response),
		done:    make(chan struct{}),
	}
	go c.readLoop()

	serverCodec := NewCodec(serverR, serverW)

	go func() {
		resp, err := serverCodec.Receive()
		if err != nil {
			t.Error(err)
			return
		}
		result, _ := json.Marshal(map[string]string{"status": "ok"})
		serverCodec.Send(Request{
			JSONRPC: "2.0",
			ID:      resp.ID,
			Method:  "",
			Params:  json.RawMessage(result),
		})
	}()

	// The server mock above sends back a Request (with ID + Params).
	// But our read loop expects a Response with Result field.
	// Let's use a proper raw response instead.
	clientR2, serverW2 := io.Pipe()
	serverR2, clientW2 := io.Pipe()

	c2 := &Client{
		codec:   NewCodec(clientR2, clientW2),
		nextID:  1,
		pending: make(map[int]chan Response),
		done:    make(chan struct{}),
	}
	go c2.readLoop()

	go func() {
		// Read raw request from client
		sCodec := NewCodec(serverR2, serverW2)
		raw, err := sCodec.Receive()
		if err != nil {
			t.Error(err)
			return
		}
		id := raw.ID
		if id == nil {
			idVal := 0
			// Try to get ID from the request - it's sent as a Request but received as Response
			if raw.Method != "" {
				idVal = 1
			}
			id = &idVal
		}
		respBody := fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"result":{"status":"ok"}}`, *id)
		header := fmt.Sprintf("Content-Length: %d\r\n\r\n%s", len(respBody), respBody)
		serverW2.Write([]byte(header))
	}()

	result, err := c2.call("test/method", map[string]string{"key": "value"})
	if err != nil {
		t.Fatal(err)
	}

	var parsed map[string]string
	if err := json.Unmarshal(result, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["status"] != "ok" {
		t.Fatalf("expected status ok, got %s", parsed["status"])
	}
}

func TestClientNotify(t *testing.T) {
	_, serverW := io.Pipe()
	serverR, clientW := io.Pipe()

	c := &Client{
		codec:   NewCodec(nil, clientW),
		nextID:  1,
		pending: make(map[int]chan Response),
		done:    make(chan struct{}),
	}

	serverCodec := NewCodec(serverR, serverW)

	done := make(chan struct{})
	go func() {
		defer close(done)
		resp, err := serverCodec.Receive()
		if err != nil {
			t.Error(err)
			return
		}
		if resp.ID != nil {
			t.Error("notification should have no id")
		}
		if resp.Method != "textDocument/didOpen" {
			t.Errorf("expected didOpen, got %s", resp.Method)
		}
	}()

	err := c.notify("textDocument/didOpen", map[string]string{"uri": "file:///test.go"})
	if err != nil {
		t.Fatal(err)
	}
	<-done
}

func TestClientConnectionClosed(t *testing.T) {
	clientR, serverW := io.Pipe()
	var buf bytes.Buffer

	c := &Client{
		codec:   NewCodec(clientR, &buf),
		nextID:  1,
		pending: make(map[int]chan Response),
		done:    make(chan struct{}),
	}
	go c.readLoop()

	serverW.Close()

	_, err := c.call("test/method", nil)
	if err == nil {
		t.Fatal("expected error on closed connection")
	}
}

func TestParseDocumentSymbolsHierarchical(t *testing.T) {
	data := json.RawMessage(`[
		{"name": "Server", "kind": 23, "range": {"start": {"line": 4, "character": 0}, "end": {"line": 9, "character": 1}},
		 "selectionRange": {"start": {"line": 4, "character": 5}, "end": {"line": 4, "character": 11}},
		 "children": [
			{"name": "Start", "kind": 6, "range": {"start": {"line": 6, "character": 0}, "end": {"line": 8, "character": 1}},
			 "selectionRange": {"start": {"line": 6, "character": 17}, "end": {"line": 6, "character": 22}}}
		 ]}
	]`)
	symbols, err := parseDocumentSymbols(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(symbols) != 1 {
		t.Fatalf("expected 1 symbol, got %d", len(symbols))
	}
	s := symbols[0]
	if s.Name != "Server" || s.Kind != SKStruct {
		t.Errorf("unexpected root symbol: %+v", s)
	}
	if s.SelectionRange.Start.Line != 4 || s.SelectionRange.Start.Character != 5 {
		t.Errorf("unexpected selectionRange: %+v", s.SelectionRange)
	}
	if len(s.Children) != 1 || s.Children[0].Name != "Start" || s.Children[0].Kind != SKMethod {
		t.Errorf("unexpected children: %+v", s.Children)
	}
}

func TestParseDocumentSymbolsFlat(t *testing.T) {
	data := json.RawMessage(`[
		{"name": "helper", "kind": 12, "containerName": "main",
		 "location": {"uri": "file:///a.go", "range": {"start": {"line": 10, "character": 5}, "end": {"line": 12, "character": 1}}}},
		{"name": "main", "kind": 12,
		 "location": {"uri": "file:///a.go", "range": {"start": {"line": 2, "character": 5}, "end": {"line": 8, "character": 1}}}}
	]`)
	symbols, err := parseDocumentSymbols(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(symbols) != 2 {
		t.Fatalf("expected 2 symbols, got %d", len(symbols))
	}
	if symbols[0].Name != "main" || symbols[1].Name != "helper" {
		t.Errorf("expected document order main, helper; got %s, %s", symbols[0].Name, symbols[1].Name)
	}
	if symbols[0].SelectionRange.Start.Line != 2 {
		t.Errorf("expected selectionRange from location, got %+v", symbols[0].SelectionRange)
	}
}

func TestParseDocumentSymbolsEmpty(t *testing.T) {
	symbols, err := parseDocumentSymbols(json.RawMessage(`[]`))
	if err != nil {
		t.Fatal(err)
	}
	if len(symbols) != 0 {
		t.Fatalf("expected no symbols, got %d", len(symbols))
	}
}
