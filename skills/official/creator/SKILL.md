---
name: creator
description: "Create and manage Zeta plugins from the main agent: list installed plugins, inspect a manifest, install or link a package, enable or disable it, and report the restart that applies the change. Use when asked to add, remove, audit, or debug an agent plugin."
---

# Zeta plugin creator workflow

Two main-agent tools drive this: `plugin_manager` (lifecycle) and `plugin_inspect` (one plugin's manifest). Subagents never receive either tool — do not delegate plugin installs or enable/disable decisions.

## 1. Discover

`plugin_manager` `action: "list"` prints every installed plugin as `name@version [enabled|disabled] source=…`. Start here instead of guessing a package name; `plugin_inspect` needs the installed name.

Plugins live in the user plugin root (`~/.zeta/plugins` by default). Project-scoped installs resolve through `<project>/.zeta/plugins`.

## 2. Inspect before changing anything

`plugin_inspect` `name: "<package>"` returns identity, enabled state, source, declared entry paths with the file each resolves to, features (and which are on), capabilities, dependencies, a settings-schema summary, and static validation errors.

- Missing entry: fix the plugin's `package.json` manifest or the file path before installing/enabling.
- Malformed `ui`/`locales` or unknown setting types: the plugin will load partially or not at all.
- `plugin_inspect` never imports plugin code. If it reports no errors but the plugin still misbehaves, the failure is in the extension module at load time — check the session's extension errors after a restart.

## 3. Install or link

`plugin_manager` `action: "install"` with `target`:

- Local directory (`.`, `./plugins/foo`, absolute path) → linked; source edits appear on the next session.
- npm spec (`pkg`, `pkg@1.2.3`, `@scope/pkg`) or git spec (`github:user/repo#ref`, full git URL) → installed through the plugin manager. Validation, build, and rollback are the manager's existing behavior; do not reimplement or skip them.

Use `action: "uninstall"` with `target` to remove one. Use `action: "set_enabled"` with `target` and `enabled` to toggle it without removing files.

## 4. Restart-required

Installing, removing, or toggling a plugin does not hot-apply. The plugin surface (tools, hooks, extensions) is collected at session startup, so report that a restart is required. `/reload-plugins` only refreshes skills, task agents, and slash commands in a live TUI session.

Verify after the restart with `plugin_manager` `action: "list"` and `plugin_inspect`; the enabled flag changes immediately, while the contributed tools/hooks appear only in the new session.
