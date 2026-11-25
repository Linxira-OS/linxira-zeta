// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package acp

import (
	"bytes"
	"encoding/json"
	"sync"
	"testing"
)

type flushBuffer struct {
	mu   sync.Mutex
	data bytes.Buffer
}

func (b *flushBuffer) write(data []byte) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.data.Write(data)
	return nil
}

func (b *flushBuffer) items(t *testing.T) []StreamItem {
	t.Helper()
	b.mu.Lock()
	defer b.mu.Unlock()
	var items []StreamItem
	for _, line := range bytes.Split(bytes.TrimSpace(b.data.Bytes()), []byte("\n")) {
		if len(line) == 0 {
			continue
		}
		var item StreamItem
		if err := json.Unmarshal(line, &item); err != nil {
			t.Fatalf("invalid stream line %q: %v", line, err)
		}
		items = append(items, item)
	}
	return items
}

func TestStreamOrderingAndStableIds(t *testing.T) {
	buf := &flushBuffer{}
	stream := NewStream(buf.write)
	stream.AddUpdate("s1", json.RawMessage(`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hel"}}`))
	stream.AddUpdate("s1", json.RawMessage(`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"lo"}}`))
	stream.AddUpdate("s1", json.RawMessage(`{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"think"}}`))
	stream.AddUpdate("s1", json.RawMessage(`{"sessionUpdate":"tool_call","toolCallId":"t1","title":"Run tests"}`))
	stream.AddUpdate("s1", json.RawMessage(`{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"completed"}`))
	stream.AddUpdate("s1", json.RawMessage(`{"sessionUpdate":"plan","entries":[{"content":"step","status":"pending","priority":"high"}]}`))
	stream.AddUpdate("s1", json.RawMessage(`{"sessionUpdate":"usage_update","used":10,"size":100}`))
	stream.Close()

	items := buf.items(t)
	if len(items) != 7 {
		t.Fatalf("expected 7 items, got %d", len(items))
	}
	for idx := range items {
		if idx > 0 && items[idx].Seq <= items[idx-1].Seq {
			t.Fatalf("sequence not strictly increasing: %d then %d", items[idx-1].Seq, items[idx].Seq)
		}
	}
	if items[0].Id != items[1].Id {
		t.Fatalf("consecutive message chunks must share an id: %q vs %q", items[0].Id, items[1].Id)
	}
	if items[2].Id == items[0].Id {
		t.Fatalf("thought chunk must start a new message id, got %q", items[2].Id)
	}
	if items[3].Id != "tool:t1" || items[4].Id != "tool:t1" {
		t.Fatalf("tool call ids not stable: %q %q", items[3].Id, items[4].Id)
	}
	if items[5].Id != "plan" || items[6].Id != "usage" {
		t.Fatalf("unexpected synthetic ids: %q %q", items[5].Id, items[6].Id)
	}
	if items[0].Kind != "agent_message_chunk" || items[3].Kind != "tool_call" {
		t.Fatalf("unexpected kinds: %q %q", items[0].Kind, items[3].Kind)
	}
	var update map[string]any
	if err := json.Unmarshal(items[0].Update, &update); err != nil {
		t.Fatalf("update is not raw ACP JSON: %v", err)
	}
	if update["sessionUpdate"] != "agent_message_chunk" {
		t.Fatalf("update payload not preserved: %#v", update)
	}
}

func TestStreamSyntheticEventsAndClose(t *testing.T) {
	buf := &flushBuffer{}
	stream := NewStream(buf.write)
	stream.AddStatus(&StatusData{BlockId: "b1", Status: StatusIdle, Version: 3})
	stream.AddPermission(&PermissionRequestData{BlockId: "b1", RequestId: "7", SessionId: "s1"})
	stream.AddPermissionResolved(&PermissionResolutionData{BlockId: "b1", RequestId: "7", Cancelled: true})
	stream.AddConfig(&ConfigData{BlockId: "b1", SessionId: "s1", Modes: map[string]any{"currentModeId": "plan"}})
	stream.AddReset("b1")
	stream.Close()

	items := buf.items(t)
	if len(items) != 5 {
		t.Fatalf("expected 5 items, got %d", len(items))
	}
	kinds := []string{"agent_status", "permission_request", "permission_resolved", "agent_config", "agent_reset"}
	for idx, kind := range kinds {
		if items[idx].Kind != kind {
			t.Fatalf("item %d kind = %q, want %q", idx, items[idx].Kind, kind)
		}
	}
	if items[1].Id != "permission:7" {
		t.Fatalf("permission id = %q", items[1].Id)
	}
	// Adding after Close is a no-op rather than a panic.
	stream.AddStatus(&StatusData{BlockId: "b1", Status: StatusIdle})
}
