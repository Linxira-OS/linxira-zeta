package app

import (
	"testing"

	"github.com/eugenioenko/ttt/internal/lsp"
)

const goSrc = `package demo

const answer = 42

var counter, _ int

type Server struct {
	Addr string
	mu   int
}

type Handler interface {
	Serve()
}

func New() *Server { return nil }

func (s *Server) Start() {}
`

func TestGoSymbols(t *testing.T) {
	syms := goSymbols(goSrc)
	names := make([]string, len(syms))
	for i, s := range syms {
		names[i] = s.Name
	}
	want := []string{"answer", "counter", "Server", "Handler", "New", "(*Server).Start"}
	if len(names) != len(want) {
		t.Fatalf("expected %v, got %v", want, names)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Errorf("symbol %d: expected %q, got %q", i, want[i], names[i])
		}
	}

	if syms[0].Kind != lsp.SKConstant || syms[1].Kind != lsp.SKVariable {
		t.Errorf("unexpected const/var kinds: %v, %v", syms[0].Kind, syms[1].Kind)
	}
	server := syms[2]
	if server.Kind != lsp.SKStruct || len(server.Children) != 2 {
		t.Fatalf("expected Server struct with 2 fields, got %+v", server)
	}
	if server.Children[0].Name != "Addr" || server.Children[0].Kind != lsp.SKField {
		t.Errorf("unexpected first field: %+v", server.Children[0])
	}
	handler := syms[3]
	if handler.Kind != lsp.SKInterface || len(handler.Children) != 1 || handler.Children[0].Name != "Serve" {
		t.Errorf("unexpected interface: %+v", handler)
	}
	if syms[4].Kind != lsp.SKFunction || syms[5].Kind != lsp.SKMethod {
		t.Errorf("unexpected func kinds: %v, %v", syms[4].Kind, syms[5].Kind)
	}
	if server.SelectionRange.Start.Line != 6 {
		t.Errorf("expected Server at line 6, got %d", server.SelectionRange.Start.Line)
	}
}

func TestGoSymbolsPartialParse(t *testing.T) {
	src := "package demo\n\nfunc ok() {}\n\nfunc broken( {\n"
	syms := goSymbols(src)
	if len(syms) == 0 {
		t.Fatal("expected symbols from partial AST despite syntax error")
	}
	if syms[0].Name != "ok" {
		t.Errorf("expected 'ok' first, got %q", syms[0].Name)
	}
}
