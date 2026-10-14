# Plugins

Zeta loads three different things that are all called "plugins". They share the same install roots and several of the same providers, but they have different manifests, different install commands, and different things they can contribute to a session. This page is the overview; [`plugins/pi-messenger.md`](./plugins/pi-messenger.md) is the per-plugin usage page for the official plugin, and [`marketplace.md`](./marketplace.md) covers marketplace catalogs and the source formats.

Everything on this page was verified by running the commands against a source checkout. The exact evidence (including verbatim output) is in the per-plugin page and in each section below.

## The three plugin shapes

| Shape | Identified by | Installed by | Managed by |
| --- | --- | --- | --- |
| **Zeta plugin** (npm, git, local link, or marketplace install) | `package.json` with a `zeta`/`omp`/`pi` manifest block, and an entry in the plugin lockfile | `zetacode plugin install …`, `zetacode plugin link …`, `/marketplace install name@marketplace` | `zetacode plugin …`, `/plugins …` |
| **Agent Plugins package** | a root `plugin.json` whose `$schema` is `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` | dropped into any plugin root by a marketplace or by hand | discovered only; contributes `skills/` and `mcp.json` |
| **Extension package** | a directory named in the `extensions` setting (or `-e`/`--extension`, or the desktop "packages" UI) | `zetacode config set extensions …`, the desktop UI, `-e` | `settings.extensions` / `settings.disabledExtensions` |

Only the first shape has enable/disable state and a lockfile; the other two are pure discovery surfaces.

A `.claude-plugin/plugin.json` (Claude Code layout) is also read as a manifest, but it is the fallback spelling — `docs`/code precedence is described in [`extension-loading.md`](./extension-loading.md#installed-plugin-extension-entries).

## Where plugins live

User scope (`<config-dir>` is `~/.zeta` by default; see [`config-usage.md`](./config-usage.md)):

```
~/.zeta/plugins/
  package.json                 # dependency manifest of the plugin root ("zeta-plugins")
  omp-plugins.lock.json        # per-plugin runtime state: version, enabled, enabledFeatures, settings
  installed_plugins.json       # marketplace install registry (version 2), user scope
  node_modules/<package>       # npm install, or a symlink for `plugin link` / marketplace runtime
  cache/                       # plugin + marketplace caches (and per-plugin cache tier)
  data/  state/                # host-managed per-plugin storage roots
```

Project scope (created by an explicit `--scope project` marketplace install, or by a project marketplace registry):

```
<project>/.zeta/plugins/
  installed_plugins.json       # marketplace install registry, project scope
  omp-plugins.lock.json        # project runtime state
  node_modules/<package>       # symlink into the shared plugin cache
```

`.zeta` here is the config-dir name, so `ZETA_CONFIG_DIR=<name>` moves the project tree to `<project>/<name>/plugins` as well.

Read [`marketplace.md`](./marketplace.md#on-disk-layout) for the cache layout and the version-keying rules.

### Two manifest spellings, one loader

The CLI reads `package.json`'s `zeta`, `omp`, or `pi` block; the session loader at `packages/coding-agent/src/extensibility/plugins/loader.ts:253` only reads `omp` and `pi`. A plugin whose manifest exists **only** under `zeta` is therefore listed and health-checked by `zetacode plugin …` but never loaded into a session. Until that is fixed, ship plugin manifests under `pi` (the key the official plugin uses), or under both.

The keys the loader consumes are `extensions` (module entry points) and `features`; the runtime also reads `settings` (schema for `zetacode plugin config`). `tools`, `hooks`, and `commands` manifest keys are resolved by `resolvePluginToolPaths`/`resolvePluginHookPaths`/`resolvePluginCommandPaths`, but nothing in the product calls them — a plugin contributes its tools/commands/hooks by registering them from an `extensions` module. `skills` is likewise **not** an implemented manifest key: a plugin's skills are found by directory convention (`<plugin>/skills/<name>/SKILL.md`), which is why the official plugin's `"skills": ["./skills"]` entry is inert but its skill still loads.

## Managing plugins

```bash
zetacode plugin install <source>          # npm, github:user/repo, https://…git, ./path (linked), name@marketplace
zetacode plugin link <path>               # symlink a local directory into the plugin root
zetacode plugin list [--json]
zetacode plugin enable  <plugin>          # <plugin> is the package name, or name@marketplace
zetacode plugin disable <plugin>          # same forms as enable
zetacode plugin features <plugin> [--enable f1,f2] [--disable f] [--set f1,f2]
zetacode plugin config <list|get|set|delete> <plugin> [key] [value]
zetacode plugin config validate
zetacode plugin doctor [--fix]
zetacode plugin uninstall <plugin>
zetacode plugin upgrade [name@marketplace]
zetacode plugin marketplace <add|remove|update|list> [source]
zetacode plugin discover [marketplace]
```

Flags: `--json`, `--dry-run` (install/uninstall/link), `--force` (install), `--scope user|project`, `-l`/`--local`.

`zetacode plugin` with no subcommand lists plugins. `zetacode plugin --help` prints the same summary. Bare words like `marketplace` or `uninstall` are not top-level commands and print a hint pointing at `zetacode plugin …` (see [`cli-reference.md`](./cli-reference.md#subcommands)).

### Local paths: `link` vs `install`

`plugin install` classifies its argument, and a relative path is only recognized as a local directory when it starts with `./` (or `../`, `/`, `~`). `plugin link` takes a plain relative path. So both of these work:

```bash
zetacode plugin link ./plugins/official/pi-messenger
zetacode plugin install ./plugins/official/pi-messenger
```

but a bare relative path is classified as an npm package name and fails:

```
$ zetacode plugin install plugins/official/pi-messenger
✘ Failed to install plugins/official/pi-messenger: Error: Invalid package name: plugins/official/pi-messenger
```

Both forms symlink the directory into `node_modules` (so source edits show up without reinstalling) and record `enabled: true` in `omp-plugins.lock.json`. `--dry-run` prints `[dry-run] Would link ./plugins/official/pi-messenger`.

### Enable, disable, and the name you must use

`enable`/`disable` look the plugin up in the runtime config by its **recorded key**, which for npm/link installs is the package name (`@linxiraos/pi-messenger`) and for marketplace installs is `name@marketplace`. Bare names that are not recorded keys fail:

```
$ zetacode plugin enable pi-messenger
✘ Failed to enable pi-messenger: Error: Plugin pi-messenger not found in runtime config
```

`zetacode plugin list` prints exactly the token to use (`@linxiraos/pi-messenger`, or `pi-messenger@local-test`). Disabling is persisted in `omp-plugins.lock.json` and takes effect on the next discovery pass — the plugin's skills and extension modules stop being discovered:

```
$ zetacode plugin disable @linxiraos/pi-messenger
✔ Disabled @linxiraos/pi-messenger
$ zetacode skills list . | cut -f1
docx pdf pptx semantic-compression system-prompts tool-prompt-optimization xlsx
$ zetacode plugin enable @linxiraos/pi-messenger
✔ Enabled @linxiraos/pi-messenger
$ zetacode skills list . | cut -f1
docx pdf pi-messenger-crew pptx semantic-compression system-prompts tool-prompt-optimization xlsx
```

## Scopes

| Install route | User scope | Project scope |
| --- | --- | --- |
| npm package, `github:`/git URL | always | — |
| local directory (`link`, `install ./path`) | always | — |
| `name@marketplace` | default | `--scope project` |

`--scope` is silently ignored (with a warning) for anything that is not a marketplace install:

```
$ zetacode plugin install --scope project plugins/official/pi-messenger
Warning: --scope is only supported for marketplace installs (name@marketplace). Ignoring for plugins/official/pi-messenger.
```

A project-scope marketplace install lands in `<project>/.zeta/plugins/` and **shadows** a user-scope install of the same plugin; `zetacode plugin list` marks the loser:

```
Marketplace Plugins:

  pi-messenger@local-test (1.2.1) (project)
  pi-messenger@local-test (1.2.1) (user) [shadowed]
```

When a plugin is installed in both scopes, `enable`/`disable`/`uninstall` require `--scope`:

```
$ zetacode plugin disable pi-messenger@local-test
✘ Failed to disable pi-messenger@local-test: Error: Plugin "pi-messenger@local-test" is installed in both user and project scope. Use --scope user or --scope project to specify which to modify.
```

### Project-level overrides for npm/link plugins

npm and linked plugins have no project-scope install, but a project can still disable one or pin its feature set in `<project>/.zeta/plugin-overrides.json`:

```json
{ "disabled": ["@linxiraos/pi-messenger"] }
```

Inside that project the plugin is skipped by discovery (and shown as `⦸` by `zetacode plugin list`); elsewhere it stays enabled. Removing the file restores it.

## `--plugin-dir`

`--plugin-dir <path>` (repeatable) adds a local plugin directory to discovery for **that one invocation** without installing it:

```bash
zetacode --plugin-dir ./plugins/official/pi-messenger skills list .
```

It builds a synthetic root (`<name>@__local__`, origin `plugin-dir`, name read from `.claude-plugin/plugin.json` or the root `plugin.json`) at the highest discovery precedence, so its `skills/` (and other sibling directories that the `claude-plugins` provider handles) are discovered for the session. Two limits, both observed:

- Only a **real session** honors it. The management subcommands do not read the flag: `zetacode --plugin-dir ./plugins/official/pi-messenger skills list .` prints the same skill list as without the flag, and `zetacode plugin list` never sees the directory. Verify it in a session (`zetacode --plugin-dir <path> -p "…"`, or the TUI's `/status`), not with `skills list`.
- A `--plugin-dir` root does **not** contribute `package.json#extensions` modules: installed-plugin extension entries come from `getAllPluginExtensionPaths`, which only walks installed plugins. To get a plugin's tools/commands/hooks, install it (`plugin link` / `plugin install`) instead.

## How enabled plugin content reaches a session

An enabled plugin contributes through two independent channels:

1. **Directory convention.** The plugin's package directory is an extension-package root, so the sibling directories are scanned: `skills/<name>/SKILL.md` (verified end-to-end), and — per `packages/coding-agent/src/discovery/omp-plugins.ts` — `hooks/pre/`, `hooks/post/`, `commands/`, `rules/`, `prompts/`, `tools/`, `.mcp.json`. Skills only load from an immediate child directory; `pi-messenger`'s `skills/pi-messenger-crew/SKILL.md` is what shows up as the `pi-messenger-crew` skill.
2. **`extensions` entry points.** Each `extensions` path is imported as an extension module and its default factory registers tools, slash commands, hooks, renderers, and shortcuts. A failure to import one module does not stop other plugins from loading, but it does mean *none* of that plugin's registered surface exists.

The provider that serves channel 1 for installed plugins is `zeta-plugins` (priority 90, formerly `omp-plugins`); `--plugin-dir` and marketplace-registry roots are served by `claude-plugins` (70); a root `plugin.json` with the Agent Plugins `$schema` hands `skills/` and `mcp.json` to `agent-plugins` (75). See [`skills.md`](./skills.md#built-in-skill-providers-and-precedence) for the full skill precedence table.

Refresh behavior after a change: `/reload-plugins` re-runs discovery for skills, task agents, and slash commands in a live TUI session; a newly installed extension module's tools/hooks need a session restart. Same rule as marketplace installs — see [`marketplace.md`](./marketplace.md).

### Verifying what a session loaded

- `zetacode skills list .` — the skills a session started in `.` resolves, with warnings. This is the quickest end-to-end check that a plugin is actually active.
- `zetacode plugin list` / `zetacode plugin doctor` — install state and manifest/entry health (doctor checks that each `extensions` entry exists on disk).
- `zetacode plugin list --json` — the resolved plugin records including `storage.dataDir`/`cacheDir`/`stateDir`.
- In-session `/status` shows the contributing providers for each capability.

## Desktop and web UI

The desktop shell and web UI reach plugins over the gateway's `/api/plugins` route (`packages/coding-agent/src/server/web-gateway/plugins.ts`; the bundled Next.js UI in the installed app fetches `GET /api/plugins?cwd=…` and posts actions to the same path). Verified against a running instance:

```
$ curl -s "http://127.0.0.1:30142/api/plugins?cwd=$PWD"
{"packages":[],"totals":{"extensions":0,"skills":0,"prompts":0,"themes":0},"diagnostics":[]}
```

This surface is **the extension-package model, not the Zeta-plugin model**: `GET` lists the paths in `settings.extensions` plus runtime extension packages, and `POST` accepts `{ action: install | remove | update | disable | enable, source, scope, cwd }`, which writes `settings.extensions` / `settings.disabledExtensions`. There is no gateway surface for npm plugins, the plugin lockfile, marketplace installs, or `name@marketplace` — those are CLI-only. Consequences observed while exercising it:

- A configured package is reported with `status: "installed"`/`"loaded"` and resource counts. `DefaultPackageManager.resolve()` (`packages/coding-agent/src/extensibility/legacy-pi-coding-agent-shim.ts:857`) returns `skills: []`, `prompts: []`, `themes: []` unconditionally, so only **extension modules** can ever be counted.
- Configuring a plugin **directory** reports `counts` all zero and `resources: []`, because resource keys are matched against the configured path exactly. Configuring the module **file** (`…/pi-messenger/index.ts`) reports `extensions: 1`. Practical upshot: point the desktop at an extension module, not a package directory, if you want the count to be non-zero.

`settings.extensions` is read by discovery in a *separate* process, so a package installed from the desktop UI shows up in the next `zetacode` session (a fresh process), not necessarily in the desktop's own process.

## Known issues

Verified against this tree; each is reported rather than worked around here.

1. **The plugin lockfile has two names.** `packages/utils/src/dirs.ts:713` (`getPluginsLockfile`) returns the legacy `omp-plugins.lock.json`, and that is what `packages/coding-agent/src/extensibility/plugins/manager.ts:173,185` and the marketplace manager read and write. `packages/coding-agent/src/extensibility/plugins/loader.ts:88-108` treats `zeta-plugins.lock.json` as canonical and migrates the legacy file to it, deleting the legacy file. After that migration every `zetacode plugin …` command reads the (now absent) legacy file and reports nothing:

   ```
   $ zetacode plugin list
   No plugins installed

   Install plugins with: zetacode plugin install <package>
   $ zetacode plugin enable @linxiraos/pi-messenger
   ✘ Failed to enable @linxiraos/pi-messenger: Error: Plugin @linxiraos/pi-messenger not found in runtime config
   ```

   Reproduced by linking a plugin, calling the loader's migrating reader, then re-running `plugin list`. `document/brand-surface-rules.md:99` records write-new as the canonical name; `UPDATE-LOG.md:66` records the opposite decision. See the per-plugin page for the recovery step.

2. **`zeta`-only manifests never load** (`loader.ts:253` vs `manager.ts:661`). Verified with a plugin declaring only `package.json#zeta`: `plugin list` and `plugin doctor` accept it, `getEnabledPlugins` returns `[]`, no skill and no extension load. Switching the same directory to the `pi` key makes all three appear.

3. **The plugin's `skills` manifest key is not implemented**, so `"skills": ["./skills"]` in `pi-messenger`'s `package.json` is decorative; the skill loads from the `skills/` directory convention instead.

4. **A lockfile entry without a `package.json` dependency and without a symlink is skipped** as stale (`loader.ts:228-231`), so an npm-installed plugin whose dependency entry was removed silently stays unloaded while `omp-plugins.lock.json` still records it.

## See also

- [`plugins/pi-messenger.md`](./plugins/pi-messenger.md) — activating the official plugin today, and the blocker that stops it
- [`marketplace.md`](./marketplace.md) — catalogs, `name@marketplace`, scopes, upgrade rules
- [`extension-loading.md`](./extension-loading.md) — extension-module discovery and resolution order
- [`extensions.md`](./extensions.md) — writing an extension module (`registerTool`/`registerCommand`)
- [`skills.md`](./skills.md) — skill providers and precedence
- [`hooks.md`](./hooks.md) — hook discovery layout
