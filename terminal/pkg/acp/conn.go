// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package acp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
)

// MaxFrameSize bounds a single NDJSON frame. Tool calls can carry large
// file diffs, so this is deliberately much larger than bufio.Scanner's
// default 64 KiB limit.
const MaxFrameSize = 16 * 1024 * 1024

var (
	ErrConnClosed  = errors.New("acp: connection closed")
	ErrFrameTooBig = errors.New("acp: frame exceeds MaxFrameSize")
)

// RequestHandler serves an agent-to-client request. It runs on its own
// goroutine so the read loop keeps processing notifications (notably
// $/cancel_request) while a permission request waits for the user.
type RequestHandler func(id json.RawMessage, method string, params json.RawMessage) (any, *RPCError)

type rpcResponse struct {
	result json.RawMessage
	err    error
}

type wireMessage struct {
	JsonRpc string          `json:"jsonrpc"`
	Id      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

type asyncCall struct {
	done func(result json.RawMessage, err error)
}

// Conn is a correlated JSON-RPC 2.0 connection over an NDJSON byte stream.
type Conn struct {
	reader       io.ReadCloser
	writer       io.WriteCloser
	handler      RequestHandler
	notification func(method string, params json.RawMessage)

	writeMu sync.Mutex
	nextId  atomic.Int64

	pendingMu sync.Mutex
	async     map[int64]asyncCall

	closed    chan struct{}
	closeOnce sync.Once
	closeErr  error
	closeMu   sync.Mutex

	readDone  chan struct{}
	handlerWg sync.WaitGroup
}

// NewConn builds a transport over reader/writer. The caller retains ownership
// of the underlying streams; Close closes both.
func NewConn(reader io.ReadCloser, writer io.WriteCloser, handler RequestHandler) *Conn {
	return &Conn{
		reader:   reader,
		writer:   writer,
		handler:  handler,
		async:    make(map[int64]asyncCall),
		closed:   make(chan struct{}),
		readDone: make(chan struct{}),
	}
}

// Start launches the read loop.
func (c *Conn) Start() {
	go c.readLoop()
}

// SetNotificationHandler registers the callback for JSON-RPC notifications.
// It must be called before Start.
func (c *Conn) SetNotificationHandler(fn func(method string, params json.RawMessage)) {
	c.notification = fn
}

// Closed is closed once the transport has shut down.
func (c *Conn) Closed() <-chan struct{} {
	return c.closed
}

// Err returns the error that closed the connection, if any.
func (c *Conn) Err() error {
	c.closeMu.Lock()
	defer c.closeMu.Unlock()
	if c.closeErr == nil {
		return ErrConnClosed
	}
	return c.closeErr
}

// Close shuts the transport down and waits for the read loop to finish.
func (c *Conn) Close() error {
	c.shutdown(ErrConnClosed)
	<-c.readDone
	c.handlerWg.Wait()
	return nil
}

// shutdown closes the streams and fails every pending call exactly once.
func (c *Conn) shutdown(err error) {
	c.closeOnce.Do(func() {
		c.closeMu.Lock()
		c.closeErr = err
		c.closeMu.Unlock()

		if c.writer != nil {
			_ = c.writer.Close()
		}
		if c.reader != nil {
			_ = c.reader.Close()
		}
		close(c.closed)

		c.pendingMu.Lock()
		async := c.async
		c.async = make(map[int64]asyncCall)
		c.pendingMu.Unlock()

		for _, call := range async {
			if call.done != nil {
				call.done(nil, err)
			}
		}
	})
}

// Call sends a request and waits for its response or ctx cancellation.
func (c *Conn) Call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	ch, id, err := c.beginCall(method, params)
	if err != nil {
		return nil, err
	}
	select {
	case resp := <-ch:
		return resp.result, resp.err
	case <-ctx.Done():
		c.forget(id)
		return nil, ctx.Err()
	case <-c.closed:
		return nil, c.Err()
	}
}

// CallAsync sends a request and invokes done when its response arrives. The
// callback runs on the read loop goroutine and must not block.
func (c *Conn) CallAsync(method string, params any, done func(result json.RawMessage, err error)) (int64, error) {
	id, err := c.beginCallAsync(method, params, done)
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (c *Conn) beginCall(method string, params any) (chan rpcResponse, int64, error) {
	ch := make(chan rpcResponse, 1)
	id, err := c.beginCallAsync(method, params, func(result json.RawMessage, err error) {
		ch <- rpcResponse{result: result, err: err}
	})
	return ch, id, err
}

func (c *Conn) beginCallAsync(method string, params any, done func(json.RawMessage, error)) (int64, error) {
	select {
	case <-c.closed:
		return 0, c.Err()
	default:
	}
	id := c.nextId.Add(1)
	c.pendingMu.Lock()
	c.async[id] = asyncCall{done: done}
	c.pendingMu.Unlock()

	frame := map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
	}
	if params != nil {
		frame["params"] = params
	}
	if err := c.writeFrame(frame); err != nil {
		c.forget(id)
		return 0, err
	}
	return id, nil
}

func (c *Conn) forget(id int64) {
	c.pendingMu.Lock()
	delete(c.async, id)
	c.pendingMu.Unlock()
}

// Notify sends a JSON-RPC notification (no id, no response).
func (c *Conn) Notify(method string, params any) error {
	frame := map[string]any{"jsonrpc": "2.0", "method": method}
	if params != nil {
		frame["params"] = params
	}
	return c.writeFrame(frame)
}

func (c *Conn) writeFrame(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("acp: cannot marshal frame: %w", err)
	}
	if len(data) > MaxFrameSize {
		return ErrFrameTooBig
	}
	data = append(data, '\n')

	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	select {
	case <-c.closed:
		return c.Err()
	default:
	}
	_, err = c.writer.Write(data)
	if err != nil {
		go c.shutdown(fmt.Errorf("acp: write failed: %w", err))
		return err
	}
	return nil
}

func (c *Conn) readLoop() {
	defer close(c.readDone)
	defer c.handlerWg.Wait()
	defer c.shutdown(ErrConnClosed)

	br := bufio.NewReaderSize(c.reader, 64*1024)
	for {
		line, err := readFrame(br)
		if err != nil {
			if !errors.Is(err, io.EOF) && !errors.Is(err, ErrConnClosed) {
				c.shutdown(fmt.Errorf("acp: read failed: %w", err))
			}
			return
		}
		if len(line) == 0 {
			continue
		}
		var msg wireMessage
		if err := json.Unmarshal(line, &msg); err != nil {
			// Non-JSON output on stdout is a protocol violation, but the only
			// safe response is to keep reading; the agent may recover.
			continue
		}
		c.dispatch(msg)
	}
}

func (c *Conn) dispatch(msg wireMessage) {
	hasId := len(msg.Id) > 0 && !bytes.Equal(bytes.TrimSpace(msg.Id), []byte("null"))
	switch {
	case msg.Method == "" && hasId:
		c.handleResponse(msg)
	case msg.Method != "" && hasId:
		c.handleRequest(msg)
	case msg.Method != "":
		if c.notification != nil {
			c.notification(msg.Method, msg.Params)
		}
	default:
		// Malformed; ignore.
	}
}

func (c *Conn) handleResponse(msg wireMessage) {
	var id int64
	if err := json.Unmarshal(msg.Id, &id); err != nil {
		return
	}
	c.pendingMu.Lock()
	call, ok := c.async[id]
	if ok {
		delete(c.async, id)
	}
	c.pendingMu.Unlock()
	if !ok {
		return
	}
	if msg.Error != nil {
		call.done(nil, msg.Error)
		return
	}
	call.done(msg.Result, nil)
}

func (c *Conn) handleRequest(msg wireMessage) {
	c.handlerWg.Add(1)
	go func() {
		defer c.handlerWg.Done()
		var result any
		var rpcErr *RPCError
		if c.handler == nil {
			rpcErr = &RPCError{Code: RpcCodeMethodNotFound, Message: "method not supported: " + msg.Method}
		} else {
			result, rpcErr = c.handler(msg.Id, msg.Method, msg.Params)
		}
		resp := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(msg.Id)}
		if rpcErr != nil {
			resp["error"] = rpcErr
		} else {
			if result == nil {
				result = map[string]any{}
			}
			resp["result"] = result
		}
		_ = c.writeFrame(resp)
	}()
}

// readFrame reads one newline-terminated frame of at most MaxFrameSize bytes.
func readFrame(r *bufio.Reader) ([]byte, error) {
	var buf []byte
	for {
		chunk, err := r.ReadSlice('\n')
		if len(buf)+len(chunk) > MaxFrameSize {
			return nil, ErrFrameTooBig
		}
		buf = append(buf, chunk...)
		if err == nil {
			break
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		return nil, err
	}
	return bytes.TrimRight(buf, "\r\n"), nil
}
