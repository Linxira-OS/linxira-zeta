import * as os from "node:os";
import * as path from "node:path";
import type { AgentTool, AgentToolResult } from "@linxiraos/pi-agent-core";
import { type } from "@linxiraos/pi-omptype";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { isLocalPathSpec } from "../cli/classify-install-target";
import { PluginManager } from "../extensibility/plugins/manager";
import type { InstalledPlugin } from "../extensibility/plugins/types";
import pluginManagerDescription from "../prompts/tools/plugin-manager.md" with { type: "text" };
import type { ToolSession } from ".";
import {
	assertMainAgentSession,
	PLUGIN_RESTART_REQUIRED,
	type PluginSummary,
	readInstalledPluginDependencies,
	resolvePluginSource,
} from "./plugin-tool-shared";

/** Lifecycle actions the plugin manager exposes to the main agent. */
export type PluginManagerAction = "list" | "install" | "uninstall" | "set_enabled";

const pluginManagerSchema = type({
	action: type('"list" | "install" | "uninstall" | "set_enabled"').describe(
		"list: installed plugins; install/uninstall/set_enabled: mutate one plugin",
	),
	"target?": type("string").describe(
		"Required by install/uninstall/set_enabled: package name, package spec, git spec, or local plugin directory",
	),
	"enabled?": type("boolean").describe("Required by set_enabled: desired enabled state"),
}).narrow(
	(p, ctx) =>
		p.action === "list" ||
		(p.target !== undefined &&
			p.target.trim().length > 0 &&
			(p.action !== "set_enabled" || p.enabled !== undefined)) ||
		ctx.mustBe('used with "target" for install/uninstall, and with "target" and "enabled" for set_enabled'),
);

export type PluginManagerParams = typeof pluginManagerSchema.infer;

export interface PluginManagerDetails {
	action: PluginManagerAction;
	/** Populated by `list`. */
	plugins?: PluginSummary[];
	/** Populated by the mutation actions. */
	plugin?: PluginSummary;
	restartRequired?: boolean;
	note?: string;
}

/** Expand a leading `~` the shell would normally expand before the tool sees a path. */
function expandHome(spec: string): string {
	if (spec === "~") return os.homedir();
	if (spec.startsWith("~/") || spec.startsWith("~\\")) return path.join(os.homedir(), spec.slice(2));
	return spec;
}

function pluginSummary(plugin: InstalledPlugin, source: string): PluginSummary {
	return {
		name: plugin.name,
		version: plugin.version,
		source,
		enabled: plugin.enabled,
		path: plugin.path,
	};
}

/**
 * Main-agent-only plugin lifecycle tool. Every action delegates to the real
 * {@link PluginManager} — validation, build, rollback, and lockfile writes stay
 * exactly where they already live; this tool only formats the result.
 */
export class PluginManagerTool implements AgentTool<typeof pluginManagerSchema, PluginManagerDetails> {
	readonly name = "plugin_manager";
	readonly label = "Plugin Manager";
	readonly summary = "List, install, uninstall, or enable/disable agent plugins";
	readonly description = pluginManagerDescription;
	readonly parameters = pluginManagerSchema;
	readonly strict = true;
	/** `list` reads state; the mutation actions write the plugin lockfile and node_modules. */
	readonly approval = (args: unknown): "read" | "write" => {
		const action = typeof args === "object" && args !== null && "action" in args ? args.action : undefined;
		return action === undefined || action === "list" ? "read" : "write";
	};

	constructor(private readonly session: Pick<ToolSession, "cwd" | "taskDepth">) {}

	static createIf(session: ToolSession): PluginManagerTool {
		return new PluginManagerTool(session);
	}

	async execute(_id: string, params: PluginManagerParams): Promise<AgentToolResult<PluginManagerDetails>> {
		assertMainAgentSession(this.name, this.session.taskDepth);
		const manager = new PluginManager(this.session.cwd);
		switch (params.action) {
			case "list":
				return this.#list(manager);
			case "install":
				return this.#install(manager, params.target!);
			case "uninstall":
				return this.#uninstall(manager, params.target!);
			case "set_enabled":
				return this.#setEnabled(manager, params.target!, params.enabled!);
		}
	}

	async #list(manager: PluginManager): Promise<AgentToolResult<PluginManagerDetails>> {
		const [plugins, dependencies] = await Promise.all([manager.list(), readInstalledPluginDependencies()]);
		const summaries = await Promise.all(
			plugins.map(async plugin =>
				pluginSummary(plugin, await resolvePluginSource(plugin.name, plugin, dependencies)),
			),
		);
		const text =
			summaries.length === 0
				? "No plugins installed."
				: [
						`Installed plugins (${summaries.length}):`,
						...summaries.map(
							plugin =>
								`- ${plugin.name}@${plugin.version} [${plugin.enabled ? "enabled" : "disabled"}] source=${plugin.source}`,
						),
					].join("\n");
		return { content: [{ type: "text", text }], details: { action: "list", plugins: summaries } };
	}

	async #install(manager: PluginManager, target: string): Promise<AgentToolResult<PluginManagerDetails>> {
		const spec = target.trim();
		if (spec.length === 0) throw new ToolError("install requires a non-empty target.");
		// Local directories go through `link()` — the same route `zetacode plugin
		// install <path>` takes. Package and git specs go through `install()`,
		// which owns validation, the bun build, and rollback.
		const plugin = isLocalPathSpec(spec)
			? await manager.link(path.resolve(this.session.cwd, expandHome(spec)))
			: await manager.install(spec);
		const summary = pluginSummary(plugin, spec);
		return {
			content: [
				{
					type: "text",
					text: `Installed ${summary.name}@${summary.version} from ${spec} (${summary.enabled ? "enabled" : "disabled"}).\n${PLUGIN_RESTART_REQUIRED}`,
				},
			],
			details: {
				action: "install",
				plugin: summary,
				restartRequired: true,
				note: PLUGIN_RESTART_REQUIRED,
			},
		};
	}

	async #uninstall(manager: PluginManager, target: string): Promise<AgentToolResult<PluginManagerDetails>> {
		const dependencies = await readInstalledPluginDependencies();
		const existing = await manager.getPlugin(target);
		const source = existing
			? await resolvePluginSource(existing.name, existing, dependencies)
			: (dependencies[target] ?? target);
		await manager.uninstall(target);
		const summary: PluginSummary = {
			name: existing?.name ?? target,
			version: existing?.version ?? "unknown",
			source,
			enabled: false,
		};
		return {
			content: [
				{
					type: "text",
					text: `Uninstalled ${summary.name}${existing ? `@${summary.version}` : ""}.\n${PLUGIN_RESTART_REQUIRED}`,
				},
			],
			details: {
				action: "uninstall",
				plugin: summary,
				restartRequired: true,
				note: PLUGIN_RESTART_REQUIRED,
			},
		};
	}

	async #setEnabled(
		manager: PluginManager,
		target: string,
		enabled: boolean,
	): Promise<AgentToolResult<PluginManagerDetails>> {
		const existing = await manager.getPlugin(target);
		if (!existing) {
			throw new ToolError(
				`Plugin "${target}" is not installed. Use action "list" to see installed plugins; install it first.`,
			);
		}
		await manager.setEnabled(target, enabled);
		const dependencies = await readInstalledPluginDependencies();
		const summary = pluginSummary(
			{ ...existing, enabled },
			await resolvePluginSource(existing.name, existing, dependencies),
		);
		return {
			content: [
				{
					type: "text",
					text: `Plugin ${summary.name}@${summary.version} is now ${enabled ? "enabled" : "disabled"}.\n${PLUGIN_RESTART_REQUIRED}`,
				},
			],
			details: {
				action: "set_enabled",
				plugin: summary,
				restartRequired: true,
				note: PLUGIN_RESTART_REQUIRED,
			},
		};
	}
}
