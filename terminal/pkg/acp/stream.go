// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package acp

import (
	"bytes"
	"encoding/json"
	"sync"
	"time"
)

const (
	streamQueueSize  = 512
	streamBatchDelay = 20 * time.Millisecond
	streamBatchItems = 256
	streamBatchBytes = 64 * 1024
)

// Stream turns ACP session updates and agent UI events into an ordered,
// newline-delimited blockfile stream. Items are appended in call order; the
// writer coalesces bursts so a fast token stream does not produce one
// blockfile append (and WebSocket event) per token.
type Stream struct {
	onFlush func([]byte) error

	mu     sync.RWMutex
	closed bool
	ch     chan StreamItem

	seqMu      sync.Mutex
	seq        int64
	currentMsg string
	currentTyp string

	writerDone chan struct{}
	closeOnce  sync.Once
	flushMu    sync.Mutex
	pending    bytes.Buffer
}

// NewStream creates a stream and starts its writer.
func NewStream(onFlush func([]byte) error) *Stream {
	s := &Stream{
		onFlush:    onFlush,
		ch:         make(chan StreamItem, streamQueueSize),
		writerDone: make(chan struct{}),
	}
	go s.writer()
	return s
}

// Close flushes queued items and stops the writer.
func (s *Stream) Close() {
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.closed = true
		close(s.ch)
		s.mu.Unlock()
		<-s.writerDone
	})
}

// AddUpdate appends one ACP session/update notification.
func (s *Stream) AddUpdate(sessionId string, update json.RawMessage) {
	if len(update) == 0 {
		return
	}
	kind, id := s.identify(update)
	s.enqueue(StreamItem{
		Seq:       s.nextSeq(),
		Id:        id,
		SessionId: sessionId,
		Ts:        time.Now().UnixMilli(),
		Kind:      kind,
		Update:    update,
	})
}

// AddStatus appends an agent lifecycle state change.
func (s *Stream) AddStatus(data *StatusData) {
	s.addSynthetic("agent_status", "status", data.BlockId, data.SessionId, data)
}

// AddConfig appends a mode/model/commands update.
func (s *Stream) AddConfig(data *ConfigData) {
	s.addSynthetic("agent_config", "config", data.BlockId, data.SessionId, data)
}

// AddPermission appends a permission request so a reloaded UI restores the
// dialog.
func (s *Stream) AddPermission(data *PermissionRequestData) {
	s.addSynthetic("permission_request", "permission:"+data.RequestId, data.BlockId, data.SessionId, data)
}

// AddPermissionResolved appends the answer to a permission request.
func (s *Stream) AddPermissionResolved(data *PermissionResolutionData) {
	s.addSynthetic("permission_resolved", "permission-resolved:"+data.RequestId, data.BlockId, "", data)
}

// AddReset appends a marker telling readers to discard state accumulated so
// far. It is used when a failed session/load replay must not leak into the new
// session; using the queue keeps it ordered with surrounding updates.
func (s *Stream) AddReset(blockId string) {
	s.addSynthetic("agent_reset", "reset:"+formatSeq(s.nextSeq()), blockId, "", map[string]string{"blockid": blockId})
}

func (s *Stream) addSynthetic(kind string, id string, blockId string, sessionId string, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return
	}
	s.enqueue(StreamItem{
		Seq:       s.nextSeq(),
		Id:        id,
		SessionId: sessionId,
		Ts:        time.Now().UnixMilli(),
		Kind:      kind,
		Update:    raw,
	})
}

func (s *Stream) enqueue(item StreamItem) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed {
		return
	}
	s.ch <- item
}

func (s *Stream) nextSeq() int64 {
	s.seqMu.Lock()
	defer s.seqMu.Unlock()
	s.seq++
	return s.seq
}

type updateProbe struct {
	SessionUpdate string `json:"sessionUpdate"`
	MessageId     string `json:"messageId"`
	ToolCallId    string `json:"toolCallId"`
}

// identify assigns the stable stream id the frontend uses to merge chunks.
func (s *Stream) identify(update json.RawMessage) (kind string, id string) {
	var probe updateProbe
	if err := json.Unmarshal(update, &probe); err != nil || probe.SessionUpdate == "" {
		return "unknown", "update:" + formatSeq(s.nextSeq())
	}
	kind = probe.SessionUpdate
	switch kind {
	case "agent_message_chunk", "agent_thought_chunk", "user_message_chunk":
		s.seqMu.Lock()
		defer s.seqMu.Unlock()
		if probe.MessageId != "" {
			s.currentMsg = "message:" + probe.MessageId
			s.currentTyp = kind
			return kind, s.currentMsg
		}
		if s.currentMsg == "" || s.currentTyp != kind {
			s.seq++
			s.currentMsg = "message:" + formatSeq(s.seq)
			s.currentTyp = kind
		}
		return kind, s.currentMsg
	case "tool_call", "tool_call_update":
		s.resetMessage()
		if probe.ToolCallId != "" {
			return kind, "tool:" + probe.ToolCallId
		}
		return kind, "tool:" + formatSeq(s.nextSeq())
	case "plan":
		s.resetMessage()
		return kind, "plan"
	case "usage_update":
		return kind, "usage"
	case "current_mode_update":
		return kind, "mode"
	case "config_option_update":
		return kind, "config"
	case "available_commands_update":
		return kind, "commands"
	case "session_info_update":
		return kind, "session"
	default:
		s.resetMessage()
		return kind, "update:" + formatSeq(s.nextSeq())
	}
}

func (s *Stream) resetMessage() {
	s.seqMu.Lock()
	s.currentMsg = ""
	s.currentTyp = ""
	s.seqMu.Unlock()
}

func (s *Stream) writer() {
	defer close(s.writerDone)
	var pending []StreamItem
	total := 0
	for {
		item, ok := <-s.ch
		if !ok {
			s.flush(pending)
			return
		}
		pending = append(pending, item)
		total += estimateSize(item)
		timer := time.NewTimer(streamBatchDelay)
	gather:
		for len(pending) < streamBatchItems && total < streamBatchBytes {
			select {
			case next, ok := <-s.ch:
				if !ok {
					timer.Stop()
					s.flush(pending)
					return
				}
				pending = append(pending, next)
				total += estimateSize(next)
			case <-timer.C:
				break gather
			}
		}
		timer.Stop()
		s.flush(pending)
		pending = pending[:0]
		total = 0
	}
}

func estimateSize(item StreamItem) int {
	return len(item.Update) + len(item.Id) + 64
}

func (s *Stream) flush(items []StreamItem) {
	if len(items) == 0 || s.onFlush == nil {
		return
	}
	s.flushMu.Lock()
	defer s.flushMu.Unlock()
	s.pending.Reset()
	for _, item := range items {
		line, err := json.Marshal(item)
		if err != nil {
			continue
		}
		s.pending.Write(line)
		s.pending.WriteByte('\n')
	}
	if s.pending.Len() == 0 {
		return
	}
	out := make([]byte, s.pending.Len())
	copy(out, s.pending.Bytes())
	_ = s.onFlush(out)
}

// itoa64 is a small dependency-free integer formatter for stream ids.
func formatSeq(v int64) string {
	if v == 0 {
		return "0"
	}
	var buf [24]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	return string(buf[i:])
}
