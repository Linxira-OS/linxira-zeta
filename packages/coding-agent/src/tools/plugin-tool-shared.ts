/**
 * Helpers shared by the agent-facing plugin tools (`plugin_manager`,
 * `plugin_inspect`).
 *
 * Both tools are main-agent only: they drive the real plugin lifecycle, which
 * belongs to the session the user is talking to, not to subagents whose results
 * feed another model. The plan gate lives in `resolveBuiltinToolPlan`; these
 * helpers add the execute-time half of the same rule.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { getPluginsPackageJson, isEnoent } from "@linxiraos/pi-utils";
import type { InstalledPlugin } from "../extensibility/plugins/types";

/**
 * Appended to every result that changes plugin installation state. The plugin
 * manager writes the lockfile and node_modules, but a running session has
 * already collected its plugin surface: only a new session re-runs the loader.
 * `/reload-plugins` covers the discovery channels (skills, task agents, slash
 * commands), not extension modules.
 */
export const PLUGIN_RESTART_REQUIRED =
	"restart-required: installed, removed, or toggled plugins are applied by the next session; tools/hooks/extensions do not hot-reload (`/reload-plugins` only refreshes skills, task agents, and slash commands).";

/** Reject execution from a subagent session even if a caller somehow exposed the tool. */
export function assertMainAgentSession(toolName: string, taskDepth: number | undefined): void {
	if ((taskDepth ?? 0) > 0) {
		throw new ToolError(`${toolName} is available to the main agent only; subagents cannot manage plugins.`);
	}
}

/** Recorded dependency specs of the user plugin root (`plugins/package.json`). */
export async function readInstalledPluginDependencies(): Promise<Record<string, string>> {
	try {
		const pkg = (await Bun.file(getPluginsPackageJson()).json()) as { dependencies?: Record<string, string> };
		return pkg.dependencies ?? {};
	} catch (err) {
		if (isEnoent(err)) return {};
		throw err;
	}
}

/**
 * Where an installed plugin came from: its recorded dependency spec, or — for
 * linked/marketplace packages that have no dependency record — the symlink
 * target, matching what `zetacode plugin list` shows for the same package.
 */
export async function resolvePluginSource(
	name: string,
	plugin: Pick<InstalledPlugin, "path">,
	dependencies: Record<string, string>,
): Promise<string> {
	const recorded = dependencies[name];
	if (recorded) return recorded;
	try {
		const stat = await fs.lstat(plugin.path);
		if (stat.isSymbolicLink()) {
			const target = await fs.readlink(plugin.path);
			return `link:${path.resolve(path.dirname(plugin.path), target)}`;
		}
	} catch (err) {
		if (!isEnoent(err)) throw err;
	}
	return plugin.path;
}

/** Compact plugin record shared by both tools' `details`. */
export interface PluginSummary {
	name: string;
	version: string;
	source: string;
	enabled: boolean;
	path?: string;
}
