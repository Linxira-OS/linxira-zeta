# plugin_manager

> List, install, uninstall, or enable/disable Zeta plugins from the main agent.

## Source

- Entry: `packages/coding-agent/src/tools/plugin-manager.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/plugin-manager.md`
- Lifecycle backend: `packages/coding-agent/src/extensibility/plugins/manager.ts` (`PluginManager.list/install/link/uninstall/setEnabled`)
- Shared helpers: `packages/coding-agent/src/tools/plugin-tool-shared.ts`
- Install-spec classification: `packages/coding-agent/src/cli/classify-install-target.ts`

## Registration / Visibility

- Built-in name `plugin_manager`; `strict = true`, `loadMode` default (`essential` for built-ins).
- **Main agent only.** `resolveBuiltinToolPlan`'s `isToolAllowed` returns `false` whenever `session.taskDepth > 0`, even when the name is explicitly requested. Each tool instance also re-checks `taskDepth` in `execute` and throws `ToolError`, so a subagent holding a reference cannot run it.
- Approval tier is dynamic: `list` is `read`; `install`, `uninstall`, and `set_enabled` are `write`. The tool adds no confirmation prompt of its own — the host's normal approval gate applies, and `PluginManager` keeps its existing validation/build/rollback behavior.

## Inputs

| Field     | Type                                       | Required | Description |
| --------- | ------------------------------------------ | -------: | ----------- |
| `action`  | `"list" \| "install" \| "uninstall" \| "set_enabled"` | Yes | Lifecycle operation. |
| `target`  | `string`                                   | Mutations | Package name, package spec (`pkg@1.2.3`, `@scope/pkg`), git spec (`github:user/repo#ref`, git URL), or a local plugin directory (`.`, `./path`, absolute, `~/…`). |
| `enabled` | `boolean`                                  | `set_enabled` | Desired state. |

The schema narrows `install`/`uninstall` to require `target`, and `set_enabled` to require both `target` and `enabled`.

## Outputs

Compact text plus `details` JSON:

- `list`: `details = { action: "list", plugins: [{ name, version, source, enabled, path }] }`; text is one `- name@version [enabled|disabled] source=…` line per plugin, or `No plugins installed.`
- mutations: `details = { action, plugin: { name, version, source, enabled }, restartRequired: true, note }`.

`source` is the recorded spec in `plugins/package.json` (`pkg@version`, git URL), or `link:<target>` for a linked/marketplace package. Local directories install through `PluginManager.link` (the same route as `zetacode plugin install <path>`); package/git specs install through `PluginManager.install`.

## Restart semantics

Nothing hot-applies: plugin tools/hooks/extensions are collected when the session starts. Every mutation result carries a `restart-required` note. `/reload-plugins` re-runs only the discovery channels (skills, task agents, slash commands).

## Errors

Thrown as `ToolError`; the agent loop renders the message. `PluginManager` errors (invalid spec, install/build failure, plugin not in runtime config) propagate unchanged.
