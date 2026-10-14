# pi-messenger

`@linxiraos/pi-messenger` ("Messenger") is the first official plugin shipped in this repository (`plugins/official/pi-messenger/`). It gives several agents working in the same folder a shared chat room: join/leave, who-is-online, task claiming, and file reservation.

This page is the activation and usage record for that plugin. Read [`plugins.md`](./plugins.md) first for the general model; this page only states what was actually run and what happened.

> **Status: activates end to end.** `zetacode plugin link` installs it, `zetacode plugin list`/`doctor` show it healthy, its `skills/` loads, and its extension module imports and registers the `pi_messenger` tool plus the `/editor`, `/teamagent`, and `/messenger` commands. The last section records what is *not* verified.

## What it does

- A `pi_messenger` tool that joins a room, lists participants, claims tasks, reserves file paths, and sends messages between agents sharing a project directory.
- A `crew/` sub-agent set (planner / worker / reviewer / `crew-plan-sync`) discovered as task agents, with an orchestrator skill.
- `/editor` — hands the current session to the companion editor (writes the handoff file, spawns the editor).
- `/teamagent` — team/agent orchestration command.

Internals: `plugins/official/pi-messenger/index.ts` registers everything; the crew logic is under `crew/`; the skill is `skills/pi-messenger-crew/SKILL.md`.

## Activating it

The repository copy is not discovered in place — `plugins/official/` is simply where the source lives. It has to be installed into the plugin root first. Either form works from the repository root:

```bash
# link (source edits are live; recommended while developing the plugin)
zetacode plugin link ./plugins/official/pi-messenger

# or, identically, an install of a local path
zetacode plugin install ./plugins/official/pi-messenger
```

```
✔ Linked @linxiraos/pi-messenger from ./plugins/official/pi-messenger
```

That writes `~/.zeta/plugins/zeta-plugins.lock.json` with the plugin enabled and symlinks `~/.zeta/plugins/node_modules/@linxiraos/pi-messenger` at the checkout:

```json
{
  "plugins": {
    "@linxiraos/pi-messenger": {
      "version": "1.2.1",
      "enabledFeatures": null,
      "enabled": true
    }
  },
  "settings": {}
}
```

```bash
zetacode plugin list
```

```
npm Plugins:

● @linxiraos/pi-messenger@1.2.1
```

```bash
zetacode plugin doctor
```

```
Plugin Health Check

✔ plugins_directory: Found at /home/<user>/.zeta/plugins
⚠ package_manifest: Not created yet
✔ node_modules: Found
✔ plugin:@linxiraos/pi-messenger: v1.2.1 - Inter-agent messaging and file reservation system for pi coding agent

Summary: 3 ok, 1 warnings, 0 errors
```

`package_manifest: Not created yet` is expected for a `link`/local install — the plugin root's own `package.json` is only written by npm installs.

Local absolute paths in the captured output above are abbreviated (`/home/<user>/.zeta/plugins`); everything else, including the summary counters, is verbatim.

### Verify from a clean session

```bash
zetacode skills list .
```

```
pi-messenger-crew	Orchestrator reference for pi-messenger Crew planning, task management, configuration, and agent coordination. Crew workers already have the pi_messenger actions they need in crew-worker.md.
```

That single line is the reliable end-to-end signal that the plugin is active: the skill is only discoverable when the plugin is enabled in the lockfile. `zetacode plugin disable @linxiraos/pi-messenger` removes it from the list and `enable` adds it back.

### The marketplace route

The same plugin installed from a marketplace catalog instead of a path lands in
the same runtime surfaces (symlink into the scope's `node_modules`, state in the
same lockfile), and activates the same way:

```bash
# a scratch catalog at <dir>/.omp-plugin/marketplace.json listing `pi-messenger`
zetacode plugin marketplace add <dir>
zetacode plugin install pi-messenger@local-test
zetacode plugin list
```

```
✔ Installed pi-messenger from local-test (1.2.1)
Marketplace Plugins:

  pi-messenger@local-test (1.2.1) (user)
```

The extension entry resolves to the same `…/node_modules/@linxiraos/pi-messenger/index.ts`,
loads with no extension error, and registers `pi_messenger`, `/editor`,
`/teamagent`, and `/messenger`. One caveat seen while doing this: a package name
can only be installed by one route at a time — with the `plugin link` install in
place, `plugin install pi-messenger@local-test` refuses:

```
✘ Failed to install pi-messenger@local-test: Error: Runtime package name "@linxiraos/pi-messenger" conflicts with installed package "@linxiraos/pi-messenger"
```

`zetacode plugin uninstall @linxiraos/pi-messenger` first, then install from the
marketplace.

## The extension module

The plugin's `package.json#pi.extensions` names `./index.ts`, which statically
imports `./editor-command.ts`. Resolving that entry through the loader a session
uses (`getAllPluginExtensionPaths` → `loadExtensions`) currently reports:

```
extension paths: [ "<plugin-root>/node_modules/@linxiraos/pi-messenger/index.ts" ]
extensions loaded: 1
extension errors: []
registered tools:    [ "pi_messenger" ]
registered commands: [ "teamagent", "editor", "messenger" ]
```

Calling the registered tool outside a joined mesh answers from the plugin's own
handler:

```
pi_messenger({ action: "list" })
  → "Not registered. Use pi_messenger({ action: \"join\" }) to join the agent mesh first."
```

This was broken until recently, and the way it was broken is worth recording:
the plugin's `editor-command.ts:14` imports the host's
`cfgEditorAutoInstall` / `cfgEditorHandoffSession` settings handles, and those
handles had gone missing from `packages/coding-agent/src/session/settings.ts`
(registered by `f02d7401fa9`, dropped by a merge; the i18n labels survive at
`packages/coding-agent/src/config/settings-zh.ts:383,387`). Because `index.ts`
imports `./editor-command.ts` statically, the whole module graph failed to
import:

```
extensions loaded: []
extension errors: [
  {
    "path": "…/node_modules/@linxiraos/pi-messenger/index.ts",
    "error": "Failed to load extension: Export named 'cfgEditorAutoInstall' not found in module '…/packages/coding-agent/src/session/settings.ts'."
  }
]
```

The consequence was silent from the outside: `zetacode plugin list` showed the
plugin enabled, `plugin doctor` was clean, the crew skill still loaded (skills
come from the `skills/` directory, not from the module), and `/editor`,
`/teamagent`, and `pi_messenger` simply did not exist. The failure was
route-independent — `plugin link`, `plugin install ./path`, and a marketplace
install all feed the same `extensions` entry to the same loader. The handles are
restored, and `packages/coding-agent/test/plugins/pi-messenger-activation.test.ts`
imports this plugin through the real loader so the same loss fails a test
instead of a user's session.

`install.mjs` (the package's `bin`) is the **upstream pi** installer: it copies the package into `~/.pi/agent/extensions/pi-messenger` and edits `~/.pi/agent/settings.json`. Zeta's native extension discovery is `.zeta`-based (`~/.zeta/agent/extensions`, `<project>/.zeta/extensions` — see [`extension-loading.md`](./extension-loading.md)), so that route installs files Zeta never reads. Running it also produces no effect here: with the real home, `zetacode skills list .` does not list `pi-messenger-crew` even though `~/.pi/agent/extensions/pi-messenger/` exists.

## Troubleshooting: failure modes actually observed

| Symptom | Cause | Fix |
| --- | --- | --- |
| `✘ Failed to enable pi-messenger: Error: Plugin pi-messenger not found in runtime config` | `enable`/`disable` key off the recorded package name, not the short plugin name | use `@linxiraos/pi-messenger` (npm/link) or `name@marketplace`; `zetacode plugin list` prints the exact token |
| `✘ Failed to install plugins/official/pi-messenger: Error: Invalid package name: plugins/official/pi-messenger` | a relative path without `./` is classified as an npm package | `zetacode plugin install ./plugins/official/pi-messenger`, or use `zetacode plugin link plugins/official/pi-messenger` |
| `Warning: --scope is only supported for marketplace installs (name@marketplace). Ignoring …` | `--scope` only applies to `name@marketplace` | project-scope npm/link plugins do not exist; use `<project>/.zeta/plugin-overrides.json` to disable one per project |
| Plugin is listed and `doctor` is happy, but no skill/tool appears in a session | the plugin's extension module failed to import (a missing host export, a broken dependency, a syntax error) — the plugin stays listed, and only the extension-error list names the reason | read the extension error for that path; `plugin doctor` checks that entries exist on disk, not that they import |
| `zetacode plugin list` says `No plugins installed` on an install that predates the lockfile rename | fixed: both lockfile spellings are read, and the pre-rename file is migrated on read | none needed; see [the lockfile name](./plugins.md#the-lockfile-name) |

### The lockfile name

The lockfile is `zeta-plugins.lock.json`; `omp-plugins.lock.json` is the
pre-rename spelling that is still *read* and migrated. A plugin root holding
either file lists and loads its plugins, so the earlier "rename the file back by
hand" recovery step no longer applies. `zetacode plugin disable`/`enable` on a
pre-rename root writes the canonical file, and the stale legacy copy is dropped
by the next session's migrating read.

### Related: a plugin installed under a different manifest key

A plugin directory whose `package.json` declares its manifest under `zeta`, `omp`,
or `pi` loads either way: all three keys are read, `zeta` first. This used to be
a real trap — a `zeta`-only package was listed by `zetacode plugin list` and
`doctor` while the session loader read only the upstream keys, so no skill and no
extension module loaded. `packages/coding-agent/test/plugin-extensions-discovery.test.ts`
now installs a `zeta`-only fixture and requires both halves: listed *and* loaded.

## What is not verified

- **Session-bound tool actions.** `pi_messenger({ action: "join" })` and the
  actions behind it call the host's `sendMessage` action and read
  `ctx.sessionManager`, so they need a live session; a scripted harness cannot
  stand in for one. What was observed is the registration path (tool and all
  four commands present) plus one action that answers before touching the
  session: `pi_messenger({ action: "list" })` →
  `Not registered. Use pi_messenger({ action: "join" }) to join the agent mesh first.`
  A two-agent exchange over a real `zetacode` session remains unverified here.
- **`/editor` end to end.** The command is registered; the handoff file write and
  the `zetaeditor` spawn were not exercised.
- **Windows-only run.** Every command above was run on Windows against a source
  checkout. Path handling in the plugin (`~/…` expansion, the editor binary it
  looks for) is not verified on Linux/macOS.

## See also

- [`plugins.md`](./plugins.md) — the plugin model, commands, scopes, and known issues
- [`marketplace.md`](./marketplace.md) — installing `name@marketplace` and marketplace scopes
- [`task-agent-discovery.md`](./task-agent-discovery.md) — how the plugin's `crew/` agents surface
- [`skills.md`](./skills.md) — skill discovery and provider precedence
