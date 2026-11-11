import * as os from "node:os";
import * as path from "node:path";
import type { AgentTool, AgentToolResult } from "@linxiraos/pi-agent-core";
import { type } from "@linxiraos/zeta-schema";
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
export type PluginManagerAction =
	| "list"
	| "install"
	| "uninstall"
	| "set_enabled"
	| "list_dev"
	| "scaffold"
	| "validate"
	| "load_dev"
	| "reload"
	| "discard";

const pluginManagerSchema = type({
	action: type(
		'"list" | "install" | "uninstall" | "set_enabled" | "list_dev" | "scaffold" | "validate" | "load_dev" | "reload" | "discard"',
	).describe(
		"list/install/uninstall/set_enabled: installed plugins; list_dev/scaffold/validate/load_dev/reload/discard: this session's agent-authored dev plugins",
	),
	"target?": type("string").describe(
		"Required by install/uninstall/set_enabled: package name, package spec, git spec, or local plugin directory; by dev actions: the dev plugin name",
	),
	"enabled?": type("boolean").describe("Required by set_enabled: desired enabled state"),
	"description?": type("string").describe("scaffold: one-line description for the generated plugin"),
}).narrow(
	(p, ctx) =>
		p.action === "list" ||
		p.action === "list_dev" ||
		(p.target !== undefined &&
			p.target.trim().length > 0 &&
			(p.action !== "set_enabled" || p.enabled !== undefined)) ||
		ctx.mustBe(
			'used with "target" for install/uninstall/set_enabled and all dev actions, and with "target" and "enabled" for set_enabled',
		),
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
	/** Populated by the dev actions. */
	devPlugin?: {
		name: string;
		root: string;
		loaded: boolean;
		toolNames: string[];
		commandNames: string[];
	};
	devPlugins?: { name: string; loaded: boolean; toolNames: string[] }[];
	validation?: {
		ok: boolean;
		errors: string[];
		warnings: string[];
		entry?: string;
		pages: { id: string; entry: string }[];
	};
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
		return action === undefined || action === "list" || action === "list_dev" || action === "validate"
			? "read"
			: "write";
	};

	constructor(private readonly session: Pick<ToolSession, "cwd" | "taskDepth" | "hasUI" | "devPlugins">) {}

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
			case "list_dev":
				return this.#listDev();
			case "scaffold":
				return this.#scaffold(params.target!, params.description);
			case "validate":
				return this.#validate(params.target!);
			case "load_dev":
				return this.#loadDev(params.target!);
			case "reload":
				return this.#reload(params.target!);
			case "discard":
				return this.#discard(params.target!);
		}
	}

	/**
	 * Dev-plugin actions need a live interactive main session: the runtime is
	 * wired there. Print/RPC/subagent sessions and headless runs refuse instead
	 * of creating plugin files nothing will load.
	 */
	#devRuntime() {
		if (!this.session.hasUI || this.session.taskDepth !== 0 || !this.session.devPlugins) {
			throw new ToolError(
				"Development plugins need an interactive main session; they are unavailable in this session.",
			);
		}
		return this.session.devPlugins();
	}

	#devSummary(plugin: {
		name: string;
		root: string;
		toolNames: readonly string[];
		commands: readonly string[];
	}): NonNullable<PluginManagerDetails["devPlugin"]> {
		return {
			name: plugin.name,
			root: plugin.root,
			loaded: true,
			toolNames: [...plugin.toolNames],
			commandNames: [...plugin.commands],
		};
	}

	async #listDev(): Promise<AgentToolResult<PluginManagerDetails>> {
		const runtime = this.#devRuntime();
		const loaded = new Map(runtime.list().map(plugin => [plugin.name, plugin]));
		const names = runtime.listAvailable();
		const rows = names.map(name => {
			const plugin = loaded.get(name);
			return { name, loaded: plugin !== undefined, toolNames: plugin ? [...plugin.toolNames] : [] };
		});
		return {
			content: [
				{
					type: "text",
					text:
						rows.length === 0
							? "No development plugins in this session."
							: [
									`Development plugins (${rows.length}, session root ${runtime.sessionRoot}):`,
									...rows.map(
										row =>
											`- ${row.name} [${row.loaded ? "loaded" : "validated"}] tools=${row.toolNames.join(",") || "none"}`,
									),
								].join("\n"),
				},
			],
			details: { action: "list_dev", devPlugins: rows },
		};
	}

	async #scaffold(name: string, description: string | undefined): Promise<AgentToolResult<PluginManagerDetails>> {
		const runtime = this.#devRuntime();
		const result = runtime.scaffold(name, { ...(description === undefined ? {} : { description }) });
		const validation = result.validation;
		return {
			content: [
				{
					type: "text",
					text: [
						`Scaffolded ${name} at ${result.root}.`,
						`Files: ${result.files.join(", ")}.`,
						validation.ok
							? "Validation passed; call load_dev to load it into this session."
							: `Validation failed:\n${validation.errors.join("\n")}`,
					].join("\n"),
				},
			],
			details: {
				action: "scaffold",
				devPlugin: { name, root: result.root, loaded: false, toolNames: [], commandNames: [] },
				validation: {
					ok: validation.ok,
					errors: [...validation.errors],
					warnings: [...validation.warnings],
					...(validation.entry === undefined ? {} : { entry: validation.entry }),
					pages: validation.pages.map(page => ({ ...page })),
				},
			},
		};
	}

	async #validate(name: string): Promise<AgentToolResult<PluginManagerDetails>> {
		const validation = this.#devRuntime().validate(name);
		return {
			content: [
				{
					type: "text",
					text: validation.ok
						? `Validation passed for ${name}. Entry: ${validation.entry ?? "none"}. Pages: ${validation.pages.length}.`
						: `Validation failed for ${name}:\n${validation.errors.join("\n")}`,
				},
			],
			details: {
				action: "validate",
				validation: {
					ok: validation.ok,
					errors: [...validation.errors],
					warnings: [...validation.warnings],
					...(validation.entry === undefined ? {} : { entry: validation.entry }),
					pages: validation.pages.map(page => ({ ...page })),
				},
			},
		};
	}

	async #loadDev(name: string): Promise<AgentToolResult<PluginManagerDetails>> {
		const result = await this.#devRuntime().loadDev(name);
		const tools = result.plugin.toolNames.join(", ") || "none";
		const commands = result.plugin.commands.join(", ") || "none";
		return {
			content: [
				{
					type: "text",
					text: `Loaded ${name} into this session. Tools: ${tools}. Commands: ${commands}. Edits reload at the end of the next turn.`,
				},
			],
			details: {
				action: "load_dev",
				devPlugin: this.#devSummary(result.plugin),
				validation: {
					ok: true,
					errors: [],
					warnings: [...result.warnings],
					...(result.validation.entry === undefined ? {} : { entry: result.validation.entry }),
					pages: result.validation.pages.map(page => ({ ...page })),
				},
			},
		};
	}

	async #reload(name: string): Promise<AgentToolResult<PluginManagerDetails>> {
		const result = await this.#devRuntime().reload(name);
		if (!result) throw new ToolError(`Plugin "${name}" is not loaded.`);
		const tools = result.plugin.toolNames.join(", ") || "none";
		return {
			content: [{ type: "text", text: `Reloaded ${name}. Tools: ${tools}.` }],
			details: { action: "reload", devPlugin: this.#devSummary(result.plugin) },
		};
	}

	async #discard(name: string): Promise<AgentToolResult<PluginManagerDetails>> {
		const runtime = this.#devRuntime();
		await runtime.discard(name);
		return {
			content: [{ type: "text", text: `Discarded development plugin ${name}.` }],
			details: { action: "discard" },
		};
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
