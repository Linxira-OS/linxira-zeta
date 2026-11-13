/**
 * Session-local lifecycle for agent-authored plugins.
 *
 * The runtime owns one session's development directory and keeps its loaded
 * plugins in the live {@link ExtensionRunner}. Loading appends the extension
 * through the runner, so the SDK's `onToolRegistered` subscriber registers and
 * activates its tools exactly like a startup extension; reload suspends the
 * previous extension and removes its tools before the new module joins.
 *
 * It never promotes or exports: those are user actions (`zetacode plugin
 * promote|export`), and the agent tool exposes no path to them.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Extension } from "../../extensions/types";
import { loadExtensions } from "../../extensions/loader";
import type { ExtensionRunner } from "../../extensions/runner";
import {
	SCAFFOLD_FILES,
	type DevPluginValidation,
	type ScaffoldOptions,
	type ScaffoldResult,
	scaffoldDevPlugin,
	validateDevPluginDirectory,
} from "./manifest";
import { devPluginsRoot, listDevPluginNames, removeTreeSafely, resolveDevPluginPath, sessionDevRoot } from "./paths";
import { cleanupExpiredDevPlugins } from "./cleanup";

/** Hooks the owning session must supply; the runtime has no process globals. */
export interface DevPluginHost {
	/** The live session runner, or undefined for a headless session. */
	getRunner(): ExtensionRunner | undefined;
	/**
	 * Remove these tool names from the live registry and active set. Called
	 * before a reload's replacement tools are added. Serialized by the host.
	 */
	uninstallTools(names: readonly string[]): Promise<void>;
	/**
	 * Whether a tool name already exists in the live session registry, built-in
	 * or extension-owned. Registration would overwrite it and removal cannot
	 * restore a built-in, so a dev plugin never joins with a live name.
	 */
	hasTool(name: string): boolean;
}

export interface DevPluginRuntimeOptions {
	readonly agentDir: string;
	readonly sessionId: string;
	readonly cwd: string;
	readonly host: DevPluginHost;
	/** Retention for directories from sessions that are gone; default seven days. */
	readonly retentionMs?: number;
}

export interface LoadedDevPlugin {
	readonly name: string;
	readonly root: string;
	readonly entry: string;
	readonly toolNames: readonly string[];
	readonly commands: readonly string[];
	readonly fingerprint: string;
	readonly extensionPaths: readonly string[];
}

export interface DevPluginLoadResult {
	readonly plugin: LoadedDevPlugin;
	readonly validation: DevPluginValidation;
	readonly warnings: readonly string[];
}

const MAX_FINGERPRINT_BYTES = 4 * 1024 * 1024;
const IGNORED_TREE_NAMES = new Set([".git", "node_modules", ".DS_Store"]);

/** A handler map for the runtime-owned lifecycle extension, not a plugin. */
function hookExtension(handlers: Extension["handlers"]): Extension {
	return {
		path: "<dev-plugins>",
		resolvedPath: "<dev-plugins>",
		handlers,
		tools: new Map(),
		assistantThinkingRenderers: [],
		assistantTextRenderers: [],
		transcriptPresenters: [],
		linkSchemes: [],
		fileWriteFallbackHandlers: [],
		fileDeleteFallbackHandlers: [],
		messageRenderers: new Map(),
		composerShapes: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
}

export class DevPluginRuntime {
	readonly #options: DevPluginRuntimeOptions;
	readonly #loaded = new Map<string, LoadedDevPlugin>();
	#hooksInstalled = false;

	constructor(options: DevPluginRuntimeOptions) {
		this.#options = options;
	}

	get root(): string {
		return devPluginsRoot(this.#options.agentDir);
	}

	get sessionRoot(): string {
		return sessionDevRoot(this.#options.agentDir, this.#options.sessionId);
	}

	get cwd(): string {
		return this.#options.cwd;
	}

	list(): LoadedDevPlugin[] {
		return [...this.#loaded.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	listAvailable(): string[] {
		return listDevPluginNames(this.#options.agentDir, this.#options.sessionId);
	}

	scaffold(name: string, options: ScaffoldOptions = {}): ScaffoldResult {
		return scaffoldDevPlugin(this.#options.agentDir, this.#options.sessionId, name, options);
	}

	validate(name: string): DevPluginValidation {
		return validateDevPluginDirectory(this.#options.agentDir, this.#options.sessionId, name);
	}

	/** Load a plugin that is not loaded yet; loading an already loaded name reloads it. */
	async loadDev(name: string): Promise<DevPluginLoadResult> {
		if (this.#loaded.has(name)) {
			const reloaded = await this.reload(name);
			if (!reloaded) throw new Error(`Plugin "${name}" could not be reloaded.`);
			return reloaded;
		}
		const runner = this.#requireRunner();
		const validation = this.validate(name);
		if (!validation.ok) throw new Error(validation.errors.join("\n"));
		if (!validation.entry) throw new Error("The plugin declares no extension entry.");

		const extensions = await this.#bind(name, validation, runner, new Set(), new Set());
		await runner.addExtensions(extensions);
		const record = this.#record(name, validation, extensions);
		this.#loaded.set(name, record);
		await this.#installHooks();
		return { plugin: record, validation, warnings: validation.warnings };
	}

	/**
	 * Reload one plugin, or every loaded plugin whose files changed. The new
	 * module is imported and bound before the old extension is suspended, so a
	 * syntax error or missing entry leaves the previous registrations live.
	 */
	async reload(name?: string): Promise<DevPluginLoadResult | undefined> {
		if (name === undefined) {
			await this.reloadChanged();
			return undefined;
		}
		const previous = this.#loaded.get(name);
		if (!previous) return await this.loadDev(name);
		const runner = this.#requireRunner();
		const validation = this.validate(name);
		if (!validation.ok) throw new Error(validation.errors.join("\n"));
		if (!validation.entry) throw new Error("The plugin declares no extension entry.");

		const extensions = await this.#bind(
			name,
			validation,
			runner,
			new Set(previous.extensionPaths),
			new Set(previous.toolNames),
		);
		const removed = runner.removeExtensions(
			extension =>
				extension.resolvedPath === previous.entry || previous.extensionPaths.includes(extension.resolvedPath),
		);
		if (removed.length === 0) {
			throw new Error(`Plugin "${name}" was already replaced; its previous extension could not be removed.`);
		}
		await this.#options.host.uninstallTools(previous.toolNames);
		await runner.addExtensions(extensions);
		const record = this.#record(name, validation, extensions);
		this.#loaded.set(name, record);
		return { plugin: record, validation, warnings: validation.warnings };
	}

	/** Called from the runtime's `turn_end` hook; cheap when nothing changed. */
	async reloadChanged(): Promise<LoadedDevPlugin[]> {
		const changed: LoadedDevPlugin[] = [];
		for (const loaded of this.#loaded.values()) {
			if (this.#fingerprint(loaded.root) === loaded.fingerprint) continue;
			try {
				const result = await this.reload(loaded.name);
				if (result) changed.push(result.plugin);
			} catch {
				// Keep the previous version live; the next turn retries after the user
				// or agent fixes the file. The tool that made the edit still reports
				// its own result.
			}
		}
		return changed;
	}

	/** Delete one session plugin directory. Only inside this session's root. */
	async discard(name: string): Promise<void> {
		const root = resolveDevPluginPath(this.#options.agentDir, this.#options.sessionId, name);
		const loaded = this.#loaded.get(name);
		if (loaded) {
			const runner = this.#requireRunner();
			const removed = runner.removeExtensions(extension => loaded.extensionPaths.includes(extension.resolvedPath));
			if (removed.length === 0) {
				throw new Error(`Plugin "${name}" could not be removed from the session runner.`);
			}
			await this.#options.host.uninstallTools(loaded.toolNames);
			this.#loaded.delete(name);
		}
		removeTreeSafely(root, this.sessionRoot);
	}

	/**
	 * Delete session directories untouched for longer than the retention. This
	 * never runs for the current session and never follows links out of the
	 * development root.
	 */
	cleanupExpired(now = Date.now()): string[] {
		return cleanupExpiredDevPlugins({
			agentDir: this.#options.agentDir,
			keepSessionIds: [this.#options.sessionId],
			now,
			...(this.#options.retentionMs === undefined ? {} : { retentionMs: this.#options.retentionMs }),
		});
	}

	async #bind(
		name: string,
		validation: DevPluginValidation,
		runner: ExtensionRunner,
		allowedExistingPaths: ReadonlySet<string>,
		allowedExistingToolNames: ReadonlySet<string>,
	): Promise<Extension[]> {
		const entry = validation.entry!;
		const result = await loadExtensions([entry], this.cwd, undefined, runner.getRuntime());
		if (result.errors.length > 0) {
			throw new Error(result.errors.map(error => `${error.path}: ${error.error}`).join("\n"));
		}
		if (result.extensions.length === 0) throw new Error(`Plugin "${name}" produced no extension.`);
		// Never shadow an existing tool: removal cannot restore a built-in or another
		// extension's registration, so a collision is refused before anything joins.
		// A reload may reuse the previous version's names; every other live name is
		// off limits, including built-ins that the extension runner does not own.
		for (const extension of result.extensions) {
			for (const toolName of extension.tools.keys()) {
				if (allowedExistingToolNames.has(toolName)) continue;
				if (this.#options.host.hasTool(toolName)) {
					throw new Error(
						`Tool "${toolName}" is already registered in this session; dev plugins cannot shadow it.`,
					);
				}
				const existing = runner.getRegisteredTool(toolName);
				if (!existing) continue;
				if (allowedExistingPaths.has(existing.definition.sourcePath ?? "")) continue;
				throw new Error(
					`Tool "${toolName}" is already registered by ${existing.definition.sourcePath ?? "another extension"}; dev plugins cannot shadow it.`,
				);
			}
		}
		return result.extensions;
	}

	#record(name: string, validation: DevPluginValidation, extensions: readonly Extension[]): LoadedDevPlugin {
		const tools = new Set<string>();
		const commands = new Set<string>();
		for (const extension of extensions) {
			for (const tool of extension.tools.keys()) tools.add(tool);
			for (const command of extension.commands.keys()) commands.add(command);
		}
		return {
			name,
			root: validation.root,
			entry: validation.entry!,
			toolNames: [...tools],
			commands: [...commands],
			fingerprint: this.#fingerprint(validation.root),
			extensionPaths: extensions.map(extension => extension.resolvedPath),
		};
	}

	#requireRunner(): ExtensionRunner {
		const runner = this.#options.host.getRunner();
		if (!runner) throw new Error("Development plugins need a live interactive session.");
		return runner;
	}

	async #installHooks(): Promise<void> {
		if (this.#hooksInstalled) return;
		const runner = this.#requireRunner();
		const handlers: Extension["handlers"] = new Map();
		const turnEnd = async () => {
			await this.reloadChanged();
		};
		const shutdown = async () => {
			// Expired directories from previous sessions only; the current session's
			// files remain for the user to inspect or promote.
			this.cleanupExpired();
		};
		handlers.set("turn_end", [turnEnd]);
		handlers.set("session_shutdown", [shutdown]);
		await runner.addExtensions([hookExtension(handlers)]);
		this.#hooksInstalled = true;
	}

	/** Content-derived fingerprint of a plugin tree, bounded by file count and bytes. */
	#fingerprint(root: string): string {
		const hash = createHash("sha256");
		let budget = MAX_FINGERPRINT_BYTES;
		let files = 0;
		const visit = (dir: string): void => {
			let entries: fs.Dirent[];
			try {
				entries = fs.readdirSync(dir, { withFileTypes: true });
			} catch {
				return;
			}
			entries.sort((a, b) => a.name.localeCompare(b.name));
			for (const entry of entries) {
				if (files >= 512 || budget <= 0) return;
				if (IGNORED_TREE_NAMES.has(entry.name) || entry.name.startsWith(".")) continue;
				const target = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					visit(target);
					continue;
				}
				if (!entry.isFile()) continue;
				let stat: fs.Stats;
				try {
					stat = fs.statSync(target);
				} catch {
					continue;
				}
				files += 1;
				hash.update(path.relative(root, target));
				hash.update("\0");
				if (stat.size <= budget) {
					try {
						hash.update(fs.readFileSync(target));
					} catch {
						hash.update(String(stat.mtimeMs));
					}
					budget -= stat.size;
				} else {
					hash.update(`${stat.mtimeMs}:${stat.size}`);
					budget = 0;
				}
			}
		};
		visit(root);
		return hash.digest("hex");
	}
}

/** Re-exported for tests and the CLI; the three scaffold files are the write surface. */
export { SCAFFOLD_FILES };
