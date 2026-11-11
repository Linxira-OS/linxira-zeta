Manage installed Zeta plugins and this session's agent-authored development plugins.

`target`: for installed plugins, a package spec (`pkg`, `pkg@1.2.3`, `@scope/pkg`, `github:user/repo#ref`, a git URL) or a local plugin directory (`.`, `./path`, an absolute path). Local directories are linked so source edits apply on the next session; package/git specs install through the plugin manager. For dev actions, `target` is the dev plugin name (letters, digits, `.`, `_`, `-`).

- `list` — every installed plugin with version, source, and enabled state.
- `install` — install or link `target`. Existing validation/build behavior applies; no prompt beyond the normal approval gate.
- `uninstall` — remove `target`.
- `set_enabled` — set `enabled` for `target`.
- `list_dev` — this session's development plugins under `<agentDir>/plugins-dev/<session>/`, loaded or only scaffolded.
- `scaffold` — create a minimal dev plugin package (`package.json`, `plugin.json`, `index.ts`) with a read-only example tool. Optional `description`.
- `validate` — static check of manifest, contained entries, imports, and page declarations. Read-only.
- `load_dev` — import and bind the plugin into this live session. Its tools/commands join the session immediately; a broken plugin leaves the session untouched.
- `reload` — re-import `target` now. Edits also reload automatically at the end of the next turn; a broken edit keeps the previous version live.
- `discard` — unload `target` and delete its directory. Only inside this session's dev root.

Dev plugins only load in an interactive main session. They never change global settings or the repository. The agent cannot promote or export: only the user can run `zetacode plugin promote <name>` / `export <name> <dir>`; promotion copies into `~/.zeta/agent/plugins/<name>` and needs a restart.

Installing, removing, or toggling an installed plugin does not hot-apply: the session's plugin surface is fixed at startup. Report the `restart-required` note; a new session loads the change (`/reload-plugins` only refreshes skills, task agents, and slash commands).

Main agent only — subagents do not get this tool.
