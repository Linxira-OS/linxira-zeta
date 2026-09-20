package app

import (
	"go/ast"
	"go/parser"
	"go/token"

	"github.com/eugenioenko/ttt/internal/lsp"
)

// goSymbols builds an outline using the stdlib parser; used when gopls is
// unavailable or refuses the file (e.g. vendored or module-less files, for
// which gopls answers "no views"). Parse errors still yield the partial AST,
// so outlines keep working while the file is being edited.
func goSymbols(src string) []lsp.DocumentSymbol {
	fset := token.NewFileSet()
	file, _ := parser.ParseFile(fset, "src.go", src, parser.SkipObjectResolution)
	if file == nil {
		return nil
	}
	var out []lsp.DocumentSymbol
	for _, decl := range file.Decls {
		switch d := decl.(type) {
		case *ast.FuncDecl:
			out = append(out, goFuncSymbol(fset, d))
		case *ast.GenDecl:
			out = append(out, goGenSymbols(fset, d)...)
		}
	}
	return out
}

func goFuncSymbol(fset *token.FileSet, d *ast.FuncDecl) lsp.DocumentSymbol {
	name := d.Name.Name
	kind := lsp.SKFunction
	if d.Recv != nil && len(d.Recv.List) > 0 {
		kind = lsp.SKMethod
		if recv := goExprText(d.Recv.List[0].Type); recv != "" {
			name = "(" + recv + ")." + name
		}
	}
	r := goSymRange(fset, d.Name.Pos())
	return lsp.DocumentSymbol{Name: name, Kind: kind, Range: r, SelectionRange: r}
}

func goGenSymbols(fset *token.FileSet, d *ast.GenDecl) []lsp.DocumentSymbol {
	var out []lsp.DocumentSymbol
	for _, spec := range d.Specs {
		switch s := spec.(type) {
		case *ast.TypeSpec:
			out = append(out, goTypeSymbol(fset, s))
		case *ast.ValueSpec:
			kind := lsp.SKVariable
			if d.Tok == token.CONST {
				kind = lsp.SKConstant
			}
			for _, n := range s.Names {
				if n.Name == "_" {
					continue
				}
				r := goSymRange(fset, n.Pos())
				out = append(out, lsp.DocumentSymbol{Name: n.Name, Kind: kind, Range: r, SelectionRange: r})
			}
		}
	}
	return out
}

func goTypeSymbol(fset *token.FileSet, s *ast.TypeSpec) lsp.DocumentSymbol {
	r := goSymRange(fset, s.Name.Pos())
	sym := lsp.DocumentSymbol{Name: s.Name.Name, Range: r, SelectionRange: r}
	switch t := s.Type.(type) {
	case *ast.StructType:
		sym.Kind = lsp.SKStruct
		for _, f := range t.Fields.List {
			sym.Children = append(sym.Children, goFieldSymbols(fset, f, lsp.SKField)...)
		}
	case *ast.InterfaceType:
		sym.Kind = lsp.SKInterface
		for _, f := range t.Methods.List {
			sym.Children = append(sym.Children, goFieldSymbols(fset, f, lsp.SKMethod)...)
		}
	default:
		sym.Kind = lsp.SKClass
	}
	return sym
}

func goFieldSymbols(fset *token.FileSet, f *ast.Field, kind lsp.SymbolKind) []lsp.DocumentSymbol {
	var out []lsp.DocumentSymbol
	if len(f.Names) == 0 {
		// Embedded field or interface: use the type name.
		if name := goExprText(f.Type); name != "" {
			r := goSymRange(fset, f.Type.Pos())
			out = append(out, lsp.DocumentSymbol{Name: name, Kind: kind, Range: r, SelectionRange: r})
		}
		return out
	}
	for _, n := range f.Names {
		r := goSymRange(fset, n.Pos())
		out = append(out, lsp.DocumentSymbol{Name: n.Name, Kind: kind, Range: r, SelectionRange: r})
	}
	return out
}

func goSymRange(fset *token.FileSet, pos token.Pos) lsp.Range {
	p := fset.Position(pos)
	lp := lsp.Position{Line: p.Line - 1, Character: p.Column - 1}
	return lsp.Range{Start: lp, End: lp}
}

func goExprText(e ast.Expr) string {
	switch t := e.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.StarExpr:
		return "*" + goExprText(t.X)
	case *ast.SelectorExpr:
		return goExprText(t.X) + "." + t.Sel.Name
	case *ast.IndexExpr:
		return goExprText(t.X)
	case *ast.IndexListExpr:
		return goExprText(t.X)
	}
	return ""
}
