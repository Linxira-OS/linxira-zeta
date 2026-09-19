package plugin

import (
	"encoding/json"
	"math"

	lua "github.com/yuin/gopher-lua"
)

func setupJSONModule(L *lua.LState) {
	loader := func(L *lua.LState) int {
		mod := L.NewTable()
		L.SetField(mod, "encode", L.NewFunction(jsonEncode))
		L.SetField(mod, "decode", L.NewFunction(jsonDecode))
		L.Push(mod)
		return 1
	}
	L.PreloadModule("ttt.json", loader)
}

func jsonEncode(L *lua.LState) int {
	v := L.CheckAny(1)
	goVal := luaToGo(v)
	data, err := json.Marshal(goVal)
	if err != nil {
		L.Push(lua.LNil)
		L.Push(lua.LString(err.Error()))
		return 2
	}
	L.Push(lua.LString(string(data)))
	return 1
}

func jsonDecode(L *lua.LState) int {
	str := L.CheckString(1)
	var goVal interface{}
	if err := json.Unmarshal([]byte(str), &goVal); err != nil {
		L.Push(lua.LNil)
		L.Push(lua.LString(err.Error()))
		return 2
	}
	L.Push(goToLua(L, goVal))
	return 1
}

func luaToGo(v lua.LValue) interface{} {
	switch val := v.(type) {
	case *lua.LNilType:
		return nil
	case lua.LBool:
		return bool(val)
	case lua.LNumber:
		f := float64(val)
		if f == math.Trunc(f) && f >= math.MinInt64 && f <= math.MaxInt64 {
			return int64(f)
		}
		return f
	case lua.LString:
		return string(val)
	case *lua.LTable:
		if isArray(val) {
			arr := make([]interface{}, 0, val.Len())
			val.ForEach(func(k, v lua.LValue) {
				if _, ok := k.(lua.LNumber); ok {
					arr = append(arr, luaToGo(v))
				}
			})
			return arr
		}
		obj := make(map[string]interface{})
		val.ForEach(func(k, v lua.LValue) {
			if ks, ok := k.(lua.LString); ok {
				obj[string(ks)] = luaToGo(v)
			}
		})
		return obj
	default:
		return nil
	}
}

func isArray(tbl *lua.LTable) bool {
	if tbl.Len() == 0 {
		hasStringKey := false
		tbl.ForEach(func(k, _ lua.LValue) {
			if _, ok := k.(lua.LString); ok {
				hasStringKey = true
			}
		})
		return !hasStringKey
	}
	return tbl.RawGetInt(1) != lua.LNil
}

func goToLua(L *lua.LState, v interface{}) lua.LValue {
	switch val := v.(type) {
	case nil:
		return lua.LNil
	case bool:
		return lua.LBool(val)
	case float64:
		return lua.LNumber(val)
	case int64:
		return lua.LNumber(val)
	case string:
		return lua.LString(val)
	case []interface{}:
		tbl := L.NewTable()
		for _, item := range val {
			tbl.Append(goToLua(L, item))
		}
		return tbl
	case map[string]interface{}:
		tbl := L.NewTable()
		for k, item := range val {
			L.SetField(tbl, k, goToLua(L, item))
		}
		return tbl
	default:
		return lua.LNil
	}
}
