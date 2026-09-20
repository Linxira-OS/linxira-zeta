package plugin

import (
	lua "github.com/yuin/gopher-lua"
)

func setupFsModule(L *lua.LState, p *Plugin) {
	loader := func(L *lua.LState) int {
		mod := L.NewTable()

		hasRead := p.Granted.Check("fs.read") == nil
		hasWrite := p.Granted.Check("fs.write") == nil

		if hasRead {
			L.SetField(mod, "read", L.NewFunction(fsRead(p)))
			L.SetField(mod, "exists", L.NewFunction(fsExists(p)))
			L.SetField(mod, "list", L.NewFunction(fsList(p)))
		}

		if hasWrite {
			L.SetField(mod, "write", L.NewFunction(fsWrite(p)))
		}

		L.Push(mod)
		return 1
	}

	L.PreloadModule("ttt.fs", loader)
}

func fsRead(p *Plugin) lua.LGFunction {
	return func(L *lua.LState) int {
		if p.Filesystem == nil {
			L.Push(lua.LNil)
			L.Push(lua.LString("filesystem API not available"))
			return 2
		}
		path := L.CheckString(1)
		content, err := p.Filesystem.ReadFile(path)
		if err != nil {
			L.Push(lua.LNil)
			L.Push(lua.LString(err.Error()))
			return 2
		}
		L.Push(lua.LString(content))
		return 1
	}
}

func fsWrite(p *Plugin) lua.LGFunction {
	return func(L *lua.LState) int {
		if p.Filesystem == nil {
			L.Push(lua.LNil)
			L.Push(lua.LString("filesystem API not available"))
			return 2
		}
		path := L.CheckString(1)
		content := L.CheckString(2)
		err := p.Filesystem.WriteFile(path, content)
		if err != nil {
			L.Push(lua.LNil)
			L.Push(lua.LString(err.Error()))
			return 2
		}
		L.Push(lua.LTrue)
		return 1
	}
}

func fsExists(p *Plugin) lua.LGFunction {
	return func(L *lua.LState) int {
		if p.Filesystem == nil {
			L.Push(lua.LFalse)
			return 1
		}
		path := L.CheckString(1)
		L.Push(lua.LBool(p.Filesystem.FileExists(path)))
		return 1
	}
}

func fsList(p *Plugin) lua.LGFunction {
	return func(L *lua.LState) int {
		if p.Filesystem == nil {
			L.Push(lua.LNil)
			L.Push(lua.LString("filesystem API not available"))
			return 2
		}
		path := L.CheckString(1)
		entries, err := p.Filesystem.ListDir(path)
		if err != nil {
			L.Push(lua.LNil)
			L.Push(lua.LString(err.Error()))
			return 2
		}
		tbl := L.NewTable()
		for _, e := range entries {
			entry := L.NewTable()
			L.SetField(entry, "name", lua.LString(e.Name))
			L.SetField(entry, "is_dir", lua.LBool(e.IsDir))
			tbl.Append(entry)
		}
		L.Push(tbl)
		return 1
	}
}
