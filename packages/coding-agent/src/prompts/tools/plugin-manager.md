Manage installed Zeta plugins: list, install, uninstall, enable/disable.

`target`: package spec (`pkg`, `pkg@1.2.3`, `@scope/pkg`, `github:user/repo#ref`, a git URL) or a local plugin directory (`.`, `./path`, an absolute path). Local directories are linked so source edits apply on the next session; package/git specs install through the plugin manager.

- `list` — every installed plugin with version, source, and enabled state.
- `install` — install or link `target`. Existing validation/build behavior applies; no prompt beyond the normal approval gate.
- `uninstall` — remove `target`.
- `set_enabled` — set `enabled` for `target`.

Installing, removing, or toggling a plugin does not hot-apply: the session's plugin surface is fixed at startup. Report the `restart-required` note; a new session loads the change (`/reload-plugins` only refreshes skills, task agents, and slash commands).

Main agent only — subagents do not get this tool.
