package plugin

import (
	"testing"

	lua "github.com/yuin/gopher-lua"
)

func newTestLState() *lua.LState {
	L := NewSandbox()
	setupJSONModule(L)
	return L
}

func TestJSONEncodeTable(t *testing.T) {
	L := newTestLState()
	defer L.Close()

	err := L.DoString(`
		local json = require("ttt.json")
		result = json.encode({name = "test", value = 42})
	`)
	if err != nil {
		t.Fatal(err)
	}
	got := L.GetGlobal("result").String()
	if got != `{"name":"test","value":42}` {
		t.Errorf("got %q", got)
	}
}

func TestJSONEncodeArray(t *testing.T) {
	L := newTestLState()
	defer L.Close()

	err := L.DoString(`
		local json = require("ttt.json")
		result = json.encode({1, 2, 3})
	`)
	if err != nil {
		t.Fatal(err)
	}
	got := L.GetGlobal("result").String()
	if got != `[1,2,3]` {
		t.Errorf("got %q", got)
	}
}

func TestJSONDecodeObject(t *testing.T) {
	L := newTestLState()
	defer L.Close()

	err := L.DoString(`
		local json = require("ttt.json")
		local obj = json.decode('{"name":"hello","count":5}')
		result_name = obj.name
		result_count = obj.count
	`)
	if err != nil {
		t.Fatal(err)
	}
	if got := L.GetGlobal("result_name").String(); got != "hello" {
		t.Errorf("name = %q", got)
	}
	if got := L.GetGlobal("result_count"); got.String() != "5" {
		t.Errorf("count = %v", got)
	}
}

func TestJSONDecodeArray(t *testing.T) {
	L := newTestLState()
	defer L.Close()

	err := L.DoString(`
		local json = require("ttt.json")
		local arr = json.decode('[1, 2, 3]')
		result_len = #arr
		result_first = arr[1]
	`)
	if err != nil {
		t.Fatal(err)
	}
	if got := L.GetGlobal("result_len").String(); got != "3" {
		t.Errorf("len = %v", got)
	}
	if got := L.GetGlobal("result_first").String(); got != "1" {
		t.Errorf("first = %v", got)
	}
}

func TestJSONRoundTrip(t *testing.T) {
	L := newTestLState()
	defer L.Close()

	err := L.DoString(`
		local json = require("ttt.json")
		local original = {
			{id = "1", text = "hello\nworld", timestamp = "2024-01-01"},
			{id = "2", text = "foo\"bar", timestamp = "2024-01-02"},
		}
		local encoded = json.encode(original)
		local decoded = json.decode(encoded)
		result_len = #decoded
		result_text = decoded[1].text
		result_quote = decoded[2].text
	`)
	if err != nil {
		t.Fatal(err)
	}
	if got := L.GetGlobal("result_len").String(); got != "2" {
		t.Errorf("len = %v", got)
	}
	if got := L.GetGlobal("result_text").String(); got != "hello\nworld" {
		t.Errorf("text = %q", got)
	}
	if got := L.GetGlobal("result_quote").String(); got != `foo"bar` {
		t.Errorf("quote = %q", got)
	}
}

func TestJSONDecodeInvalid(t *testing.T) {
	L := newTestLState()
	defer L.Close()

	err := L.DoString(`
		local json = require("ttt.json")
		local val, err = json.decode("{invalid")
		result_nil = (val == nil)
		result_err = err
	`)
	if err != nil {
		t.Fatal(err)
	}
	if got := L.GetGlobal("result_nil"); got != lua.LTrue {
		t.Errorf("expected nil value, got %v", got)
	}
	if got := L.GetGlobal("result_err").String(); got == "" {
		t.Error("expected error message")
	}
}

func TestJSONEncodeBoolAndNil(t *testing.T) {
	L := newTestLState()
	defer L.Close()

	err := L.DoString(`
		local json = require("ttt.json")
		result_true = json.encode(true)
		result_false = json.encode(false)
		result_str = json.encode("hello")
		result_num = json.encode(3.14)
	`)
	if err != nil {
		t.Fatal(err)
	}
	if got := L.GetGlobal("result_true").String(); got != "true" {
		t.Errorf("true = %q", got)
	}
	if got := L.GetGlobal("result_false").String(); got != "false" {
		t.Errorf("false = %q", got)
	}
	if got := L.GetGlobal("result_str").String(); got != `"hello"` {
		t.Errorf("str = %q", got)
	}
	if got := L.GetGlobal("result_num").String(); got != "3.14" {
		t.Errorf("num = %q", got)
	}
}
