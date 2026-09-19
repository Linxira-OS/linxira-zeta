package plugin

import (
	"fmt"
	"testing"
)

type mockNetworkAPI struct {
	getStatus  int
	getBody    string
	getHeaders map[string]string
	getErr     error

	postStatus  int
	postBody    string
	postHeaders map[string]string
	postErr     error

	lastURL     string
	lastHeaders map[string]string
	lastBody    string
}

func (m *mockNetworkAPI) Get(url string, headers map[string]string) (int, string, map[string]string, error) {
	m.lastURL = url
	m.lastHeaders = headers
	return m.getStatus, m.getBody, m.getHeaders, m.getErr
}

func (m *mockNetworkAPI) Post(url string, headers map[string]string, body string) (int, string, map[string]string, error) {
	m.lastURL = url
	m.lastHeaders = headers
	m.lastBody = body
	return m.postStatus, m.postBody, m.postHeaders, m.postErr
}

func setupTestPluginWithNet(perms PermissionSet, net *mockNetworkAPI) (*Plugin, func()) {
	p, cleanup := newTestPluginBase(perms)
	p.Network = net
	return p, cleanup
}

func TestNetGet(t *testing.T) {
	mock := &mockNetworkAPI{
		getStatus:  200,
		getBody:    `{"ok": true}`,
		getHeaders: map[string]string{"Content-Type": "application/json"},
	}
	p, cleanup := setupTestPluginWithNet(PermissionSet{NetworkHTTP: NetworkHTTP{All: true}}, mock)
	defer cleanup()

	err := p.State.DoString(`
		local net = require("ttt.net")
		local resp = net.get("https://api.example.com/data")
		_G.status = resp.status
		_G.body = resp.body
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if p.State.GetGlobal("status").String() != "200" {
		t.Errorf("expected status 200, got %s", p.State.GetGlobal("status").String())
	}
	if p.State.GetGlobal("body").String() != `{"ok": true}` {
		t.Errorf("unexpected body: %q", p.State.GetGlobal("body").String())
	}
	if mock.lastURL != "https://api.example.com/data" {
		t.Errorf("unexpected URL: %q", mock.lastURL)
	}
}

func TestNetGetWithHeaders(t *testing.T) {
	mock := &mockNetworkAPI{getStatus: 200, getBody: "ok"}
	p, cleanup := setupTestPluginWithNet(PermissionSet{NetworkHTTP: NetworkHTTP{All: true}}, mock)
	defer cleanup()

	err := p.State.DoString(`
		local net = require("ttt.net")
		net.get("https://api.example.com", {
			headers = { ["Authorization"] = "Bearer token123" },
		})
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if mock.lastHeaders["Authorization"] != "Bearer token123" {
		t.Errorf("expected auth header, got %v", mock.lastHeaders)
	}
}

func TestNetPost(t *testing.T) {
	mock := &mockNetworkAPI{
		postStatus: 201,
		postBody:   `{"id": 1}`,
	}
	p, cleanup := setupTestPluginWithNet(PermissionSet{NetworkHTTP: NetworkHTTP{All: true}}, mock)
	defer cleanup()

	err := p.State.DoString(`
		local net = require("ttt.net")
		local resp = net.post("https://api.example.com/create", {
			headers = { ["Content-Type"] = "application/json" },
			body = '{"name": "test"}',
		})
		_G.status = resp.status
		_G.body = resp.body
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if p.State.GetGlobal("status").String() != "201" {
		t.Errorf("expected status 201, got %s", p.State.GetGlobal("status").String())
	}
	if mock.lastBody != `{"name": "test"}` {
		t.Errorf("unexpected request body: %q", mock.lastBody)
	}
}

func TestNetGetError(t *testing.T) {
	mock := &mockNetworkAPI{getErr: fmt.Errorf("connection refused")}
	p, cleanup := setupTestPluginWithNet(PermissionSet{NetworkHTTP: NetworkHTTP{All: true}}, mock)
	defer cleanup()

	err := p.State.DoString(`
		local net = require("ttt.net")
		local resp = net.get("https://unreachable.example.com")
		_G.has_error = (resp.error ~= nil)
		_G.status = resp.status
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if p.State.GetGlobal("has_error").String() != "true" {
		t.Error("expected error field in response")
	}
	if p.State.GetGlobal("status").String() != "0" {
		t.Errorf("expected status 0 on error, got %s", p.State.GetGlobal("status").String())
	}
}

func TestNetWithoutPermission(t *testing.T) {
	mock := &mockNetworkAPI{}
	p, cleanup := setupTestPluginWithNet(PermissionSet{}, mock)
	defer cleanup()

	err := p.State.DoString(`
		local net = require("ttt.net")
		net.get("https://api.example.com")
	`)
	if err == nil {
		t.Fatal("expected error when network.http not granted")
	}
}

func TestNetHostAllowlistBlocksDisallowed(t *testing.T) {
	mock := &mockNetworkAPI{getStatus: 200, getBody: "should not reach"}
	p, cleanup := setupTestPluginWithNet(
		PermissionSet{NetworkHTTP: NetworkHTTP{Hosts: []string{"api.github.com"}}}, mock)
	defer cleanup()

	err := p.State.DoString(`
		local net = require("ttt.net")
		local allowed = net.get("https://api.github.com/user")
		_G.allowed_status = allowed.status
		local denied = net.get("https://evil.com/steal")
		_G.denied_status = denied.status
		_G.denied_error = denied.error
	`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if p.State.GetGlobal("allowed_status").String() != "200" {
		t.Errorf("allowed host should reach the network, got status %s",
			p.State.GetGlobal("allowed_status").String())
	}
	if p.State.GetGlobal("denied_status").String() != "0" {
		t.Errorf("denied host should return status 0, got %s",
			p.State.GetGlobal("denied_status").String())
	}
	if p.State.GetGlobal("denied_error").String() == "" {
		t.Error("denied host should carry an error message")
	}
	if mock.lastURL == "https://evil.com/steal" {
		t.Error("denied request must not reach the network API")
	}
}
