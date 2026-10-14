# pi-messenger

`@linxiraos/pi-messenger` ("Messenger") is the first official plugin shipped in this repository (`plugins/official/pi-messenger/`). It gives several agents working in the same folder a shared chat room: join/leave, who-is-online, task claiming, and file reservation.

This page is the activation and usage record for that plugin. Read [`plugins.md`](./plugins.md) first for the general model; this page only states what was actually run and what happened.

> **Status: cannot be activated today.** The plugin's skill loads, but its extension module — which owns the `pi_messenger` tool and the `/editor`, `/teamagent` commands — fails to import against this tree. Details and the exact blocker are below.

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

That writes `~/.zeta/plugins/omp-plugins.lock.json` with the plugin enabled and symlinks `~/.zeta/plugins/node_modules/@linxiraos/pi-messenger` at the checkout:

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

## What does *not* work: the extension module

Resolving the plugin's extension entry and importing it:

```
extension paths: [ "<plugin-root>/node_modules/@linxiraos/pi-messenger/index.ts" ]
extensions loaded: []
extension errors: [
  {
    "path": "…/node_modules/@linxiraos/pi-messenger/index.ts",
    "error": "Failed to load extension: Export named 'cfgEditorAutoInstall' not found in module '…/packages/coding-agent/src/session/settings.ts'."
  }
]
```

- Import site: `plugins/official/pi-messenger/editor-command.ts:14` imports `cfgEditorAutoInstall` and `cfgEditorHandoffSession` from `@linxiraos/zeta/session/settings`.
- The host module `packages/coding-agent/src/session/settings.ts` no longer exports either handle. They were registered in that file by `f02d7401fa9` (feat(settings): port Zeta keys to the v18.3.1 settings registry); the file's last change is merge `fb4dcded44d` ("Merge upstream OMP v18.9.1 into Zeta"), which is where they were lost. The i18n labels survive at `packages/coding-agent/src/config/settings-zh.ts:383,387`.
- `index.ts:57` imports `./editor-command.ts` statically, so the whole module graph fails; the error string is produced by `packages/coding-agent/src/extensibility/extensions/loader.ts:440`.

Consequences, as observed: `/editor`, `/teamagent`, and the `pi_messenger` tool are never registered, so none of the plugin's agent-coordination functionality is available even though `zetacode plugin list` shows it enabled and the crew skill loads. The failure is route-independent — it reproduces for `plugin link ./plugins/official/pi-messenger` and for a marketplace install (`plugin install pi-messenger@<marketplace> --scope user`), because both feed the same `extensions` entry to the same loader.

A repair belongs in the host (restore the two `editor.*` settings handles in `session/settings.ts`, or make the plugin tolerate their absence); it is not a documentation fix and is not made here.

`install.mjs` (the package's `bin`) is the **upstream pi** installer: it copies the package into `~/.pi/agent/extensions/pi-messenger` and edits `~/.pi/agent/settings.json`. Zeta's native extension discovery is `.zeta`-based (`~/.zeta/agent/extensions`, `<project>/.zeta/extensions` — see [`extension-loading.md`](./extension-loading.md)), so that route installs files Zeta never reads. Running it also produces no effect here: with the real home, `zetacode skills list .` does not list `pi-messenger-crew` even though `~/.pi/agent/extensions/pi-messenger/` exists.

## Troubleshooting: failure modes actually observed

| Symptom | Cause | Fix |
| --- | --- | --- |
| `✘ Failed to enable pi-messenger: Error: Plugin pi-messenger not found in runtime config` | `enable`/`disable` key off the recorded package name, not the short plugin name | use `@linxiraos/pi-messenger` (npm/link) or `name@marketplace`; `zetacode plugin list` prints the exact token |
| `✘ Failed to install plugins/official/pi-messenger: Error: Invalid package name: plugins/official/pi-messenger` | a relative path without `./` is classified as an npm package | `zetacode plugin install ./plugins/official/pi-messenger`, or use `zetacode plugin link plugins/official/pi-messenger` |
| `Warning: --scope is only supported for marketplace installs (name@marketplace). Ignoring …` | `--scope` only applies to `name@marketplace` | project-scope npm/link plugins do not exist; use `<project>/.zeta/plugin-overrides.json` to disable one per project |
| `zetacode plugin list` says `No plugins installed` although the plugin is installed | `zeta-plugins.lock.json` exists instead of `omp-plugins.lock.json` — the loader's migration (`loader.ts:88-108`) renamed the file the CLI reads (`dirs.ts:713`) | see the lockfile note below |
| Plugin is listed and `doctor` is happy, but no skill/tool appears in a session | the plugin's manifest is only under `package.json#zeta` (`loader.ts:253` reads `omp`/`pi`) | ship the manifest under `pi` (as `pi-messenger` does), or under both |

### The lockfile-name trap

If the plugin root contains `zeta-plugins.lock.json` rather than `omp-plugins.lock.json`, every `zetacode plugin …` command reads the wrong file and reports an empty plugin list:

```
$ zetacode plugin list
No plugins installed

Install plugins with: zetacode plugin install <package>
$ zetacode plugin enable @linxiraos/pi-messenger
✘ Failed to enable @linxiraos/pi-messenger: Error: Plugin @linxiraos/pi-messenger not found in runtime config
```

Recovery: rename the file back to `omp-plugins.lock.json` (it is the same JSON shape), or re-link the plugin, which rewrites the legacy-name file. The two names are a real inconsistency in the tree — `packages/utils/src/dirs.ts:713` returns the legacy name while `loader.ts:88-108` migrates to the canonical one; `document/brand-surface-rules.md:99` and `UPDATE-LOG.md:66` record opposite decisions. Do not hand-edit the file expecting it to stick until that is resolved.

### Related: a plugin installed under the wrong manifest key

A plugin directory whose `package.json` carries only a `zeta` block is fully visible to `zetacode plugin list` and `zetacode plugin doctor` but invisible to the session loader (`loader.ts:253` accepts only `omp`/`pi`), so no skill and no extension module load. Reproduced with a scratch plugin; adding the same block under `pi` makes the skill, the extension module, and its registered command appear.

## See also

- [`plugins.md`](./plugins.md) — the plugin model, commands, scopes, and known issues
- [`marketplace.md`](./marketplace.md) — installing `name@marketplace` and marketplace scopes
- [`task-agent-discovery.md`](./task-agent-discovery.md) — how the plugin's `crew/` agents surface
- [`skills.md`](./skills.md) — skill discovery and provider precedence
