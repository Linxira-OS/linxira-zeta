package plugin

import (
	lua "github.com/yuin/gopher-lua"
)

// severityByName maps the Lua severity strings to the integer severities used
// by the diagnostics pipeline (mirrors LSP: 1=error .. 4=hint).
var severityByName = map[string]int{
	"error":   1,
	"warning": 2,
	"info":    3,
	"hint":    4,
}

func setupDiagnosticsModule(L *lua.LState, p *Plugin) {
	loader := func(L *lua.LState) int {
		mod := L.NewTable()

		if p.Granted.Check("editor.diagnostics") == nil {
			L.SetField(mod, "publish", L.NewFunction(diagnosticsPublish(p)))
			L.SetField(mod, "clear", L.NewFunction(diagnosticsClear(p)))
		}

		L.Push(mod)
		return 1
	}

	L.PreloadModule("ttt.diagnostics", loader)
}

func diagnosticsPublish(p *Plugin) lua.LGFunction {
	return func(L *lua.LState) int {
		path := L.CheckString(1)
		itemsTbl := L.CheckTable(2)

		var items []DiagnosticItem
		itemsTbl.ForEach(func(_, v lua.LValue) {
			tbl, ok := v.(*lua.LTable)
			if !ok {
				return
			}
			items = append(items, luaTableToDiagnosticItem(L, tbl))
		})

		if p.PublishDiagnostics != nil {
			p.PublishDiagnostics(path, items)
		}
		return 0
	}
}

func diagnosticsClear(p *Plugin) lua.LGFunction {
	return func(L *lua.LState) int {
		path := ""
		if L.GetTop() >= 1 {
			if s, ok := L.Get(1).(lua.LString); ok {
				path = string(s)
			}
		}
		if p.ClearDiagnostics != nil {
			p.ClearDiagnostics(path)
		}
		return 0
	}
}

func luaTableToDiagnosticItem(L *lua.LState, tbl *lua.LTable) DiagnosticItem {
	item := DiagnosticItem{Severity: 2} // default: warning

	line := luaFieldInt(L, tbl, "line", 1)
	col := luaFieldInt(L, tbl, "col", 1)
	endLine := luaFieldInt(L, tbl, "end_line", line)
	endCol := luaFieldInt(L, tbl, "end_col", col+1)

	// Convert 1-based Lua coordinates to 0-based internal coordinates.
	item.StartLine = line - 1
	item.StartCol = col - 1
	item.EndLine = endLine - 1
	item.EndCol = endCol - 1

	if v := L.GetField(tbl, "severity"); v != lua.LNil {
		if sev, ok := severityByName[v.String()]; ok {
			item.Severity = sev
		}
	}
	if v := L.GetField(tbl, "style"); v != lua.LNil {
		if style, ok := StyleByName(v.String()); ok {
			item.Style = style
		}
	}
	if v := L.GetField(tbl, "message"); v != lua.LNil {
		item.Message = v.String()
	}
	if v := L.GetField(tbl, "source"); v != lua.LNil {
		item.Source = v.String()
	}

	return item
}

func luaFieldInt(L *lua.LState, tbl *lua.LTable, name string, def int) int {
	v := L.GetField(tbl, name)
	if n, ok := v.(lua.LNumber); ok {
		return int(n)
	}
	return def
}
