# plugin_inspect

> Inspect one installed plugin's manifest, resolved entries, schema, and static validity.

## Source

- Entry: `packages/coding-agent/src/tools/plugin-inspect.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/plugin-inspect.md`
- Manifest/lookup: `PluginManager.getPlugin` (`packages/coding-agent/src/extensibility/plugins/manager.ts`)
- Entry resolution: `resolvePluginManifestEntries` (`packages/coding-agent/src/extensibility/plugins/loader.ts`)
- Manifest validation: `parsePluginLocales` / `parsePluginUi` (`packages/coding-agent/src/extensibility/plugins/parser.ts`), `validateSetting` (`manager.ts`)

## Registration / Visibility

- Built-in name `plugin_inspect`; `strict = true`, read approval.
- **Main agent only.** `resolveBuiltinToolPlan`'s `isToolAllowed` returns `false` when `session.taskDepth > 0` even for an explicit request, and `execute` re-checks `taskDepth` and throws `ToolError`.
- Read-only: it never imports a plugin module, runs a plugin tool, or hot-reloads the session. Folder statistics and `package.json` reads are the only side effects of inspection.

## Inputs

| Field  | Type     | Required | Description |
| ------ | -------- | -------: | ----------- |
| `name` | `string` |      Yes | Installed plugin package name, as shown by `plugin_manager action: "list"`. |
| `path` | `string` |       No | Plugin directory (absolute, or relative to the session cwd) for a package outside the normal lookup roots. |

## Outputs

Text summary plus `details`:

- `name`, `version`, `source`, `path`, `enabled`, `enabledFeatures`
- `identity`: manifest name/version/description
- `background`: enabled, source, path, `enabledFeatures`, `hasUi`
- `features`: one entry per manifest feature (`name`, `description`, `default`, `enabled`, counts of its entries)
- `capabilities`: resolved extension/tool/hook/command paths, plus feature/setting/locale/panel counts
- `entry`: raw declared manifest entries per kind; `entries`: each declared entry paired with `resolvedPath` (or `null` when nothing loadable exists on disk)
- `dependencies` / `peerDependencies` from the plugin's `package.json`
- `settings`: schema summary (`key`, `type`, `default`, `description`, `secret`, `env`, enum `values`, number `min`/`max`)
- `validation`: `{ valid, errors[] }`

## Validation performed

- Every declared `extensions`/`tools`/`hooks`/`commands` entry for the plugin's current feature selection resolves to a file on disk (`resolvedPath === null` is reported).
- `manifest.locales` and `manifest.ui` parse through the loader's own validators.
- Every `manifest.settings` key has a known type; enum settings declare values.
- Current lockfile setting values pass `validateSetting`.

Load errors that only appear when an extension module is imported are intentionally out of scope; they are reported by the session's extension-error list after a restart.
