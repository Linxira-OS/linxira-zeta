Read one installed plugin's manifest and validate it statically. Never imports plugin code and never reloads the session.

`name`: the installed package name (what `plugin_manager list` prints). `path`: optional plugin directory for a package outside the normal lookup roots.

Reports manifest identity (name/version/description), features and which are enabled, capabilities (extensions/tools/hooks/commands/settings/locales/panels), declared entry paths with the file each resolves to, dependencies, a settings-schema summary, enabled state, source, and static validation errors (missing entries, malformed `locales`/`ui`, unknown setting types, invalid current setting values).

Main agent only — subagents do not get this tool.
