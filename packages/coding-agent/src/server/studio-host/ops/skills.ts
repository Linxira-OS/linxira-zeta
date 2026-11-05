/**
 * Studio operations — skills, plugins, capability and slash-command manifests.
 *
 * Owned operations: `skills.*`, `plugins.setEnabled`, `capabilities.get`,
 * `commands.getManifest`.
 *
 * A handler takes the contract input and returns the contract result; it
 * reaches Zeta state only through `../gateway.js` (`callGateway`,
 * `gatewayJson`, `gatewayOk`, `invalid`, `unavailable`). A name this file does
 * not export is simply not advertised in the capability manifest, so leaving
 * an operation out hides its surface in the Renderer — never answer with made
 * up data.
 *
 * Route map:
 * - `skills.get`              → `GET /api/skills?cwd=<project>`
 * - `skills.setEnabled`       → `PATCH /api/skills` (the gateway's only skill
 *                               mutation: it writes `disable-model-invocation`)
 * - `skills.reveal`           → `POST /api/skills/reveal { cwd, name, scope? }`
 * - `skills.revealRoot`       → `POST /api/skills/reveal { cwd, name, root: true }`
 * - `plugins.setEnabled`      → `GET /api/plugins` (name → source) then
 *                               `POST /api/plugins { action: enable|disable }`
 * - `capabilities.get`        → the manifest already carried in
 *                               `StudioHostContext`, not rebuilt here
 *
 * Deliberately absent:
 * - `commands.getManifest`: the slash-command list only exists inside a live
 *   session's RPC handler (`get_commands`), and there is no REST route or
 *   shared-session accessor to mount it on, so no manifest can be built here.
 */
import { getProjectDir } from "@linxiraos/pi-utils";
import type {
	CommandInput,
	ConfigWriteResult,
	EmptyInput,
	ExtensibilityReadModel,
	PluginRecord,
	PluginSourceKind,
	SkillRecord,
	SkillScope,
	SkillSourceKind,
} from "../contract/index.js";
import {
	callGateway,
	gatewayJson,
	gatewayOk,
	invalid,
	optionalString,
	requiredString,
	segment,
	unavailable,
} from "../gateway.js";
import type { CapabilityManifest } from "../protocol/index.js";
import type { StudioFamily, StudioHostContext } from "../registry.js";

const SKILLS_ROUTE = "/api/skills";
const SKILLS_REVEAL_ROUTE = "/api/skills/reveal";
const PLUGINS_ROUTE = "/api/plugins";

/** Provider carrying the bundled official skill pack; its files are not user-owned. */
const OFFICIAL_SKILL_PROVIDER = "zeta-official";
/** Provider for auto-learned managed skills. */
const MANAGED_SKILL_PROVIDER = "zeta-managed";
/** Providers whose skills arrive through an installed plugin package. */
const PLUGIN_SKILL_PROVIDERS: Readonly<Record<string, true>> = {
	"agent-plugins": true,
	"claude-plugins": true,
	skillshare: true,
	"zeta-plugins": true,
};

/** Safe source labels for the configured skill inventory. */
const SKILL_SOURCE_LABELS: Readonly<Record<string, string>> = {
	native: "OMP",
	"zeta-official": "OMP",
	"zeta-managed": "托管",
	agents: "Agents",
	claude: "Claude",
	cline: "Cline",
	codex: "Codex",
	cursor: "Cursor",
	gemini: "Gemini",
	github: "GitHub",
	opencode: "OpenCode",
	vscode: "VS Code",
	windsurf: "Windsurf",
	custom: "Custom",
	"agent-plugins": "插件",
	"claude-plugins": "插件",
	skillshare: "插件",
	"zeta-plugins": "插件",
};

/** Safe labels for the three plugin source kinds the gateway can distinguish. */
const PLUGIN_SOURCE_LABELS: Readonly<Record<PluginSourceKind, string>> = {
	npm: "npm",
	marketplace: "市场",
	link: "链接",
	git: "git",
};

/**
 * A diagnostic message that must not carry an absolute path (Windows drive or
 * UNC, POSIX root). Path-carrying notes are dropped rather than leaked.
 */
const ABSOLUTE_PATH_RE = /(?:^|[\s("'`=:,])(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'`()]*/;

/** Narrow untrusted JSON to a plain object. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-empty string field, or `undefined`. */
function stringField(record: Readonly<Record<string, unknown>>, field: string): string | undefined {
	const value = record[field];
	return typeof value === "string" && value !== "" ? value : undefined;
}

/** A finite number field, or `undefined`. */
function numberField(record: Readonly<Record<string, unknown>>, field: string): number | undefined {
	const value = record[field];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** An array field, or `undefined` when the gateway did not send one. */
function arrayField(record: Readonly<Record<string, unknown>>, field: string): readonly unknown[] | undefined {
	const value = record[field];
	return Array.isArray(value) ? value : undefined;
}

/** A required boolean field from an op input. */
function requiredBoolean(input: unknown, field: string): boolean {
	const value = isRecord(input) ? input[field] : undefined;
	if (typeof value !== "boolean") throw invalid(`${field} must be a boolean`);
	return value;
}

/** The optional `scope` an inventory mutation accepts. */
function optionalScope(input: unknown): "user" | "project" | undefined {
	const value = optionalString(input, "scope");
	if (value === undefined) return undefined;
	if (value !== "user" && value !== "project") throw invalid('scope must be "user" or "project"');
	return value;
}

/** Keep a diagnostic sentence only when it is path-free. */
function pathFreeMessage(message: string): string | undefined {
	const trimmed = message.trim();
	if (trimmed === "" || ABSOLUTE_PATH_RE.test(trimmed)) return undefined;
	return trimmed;
}

/** One diagnostics entry the gateway reported for an inventory scan. */
interface RawDiagnostic {
	readonly type: string;
	readonly message: string;
	readonly source?: string;
}

/** Read `diagnostics` from a skills/plugins answer. */
function readDiagnostics(body: Readonly<Record<string, unknown>>): RawDiagnostic[] {
	const raw = arrayField(body, "diagnostics") ?? [];
	const out: RawDiagnostic[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) continue;
		const message = stringField(entry, "message");
		if (message === undefined) continue;
		const source = stringField(entry, "source");
		out.push({
			type: stringField(entry, "type") ?? "info",
			message,
			...(source === undefined ? {} : { source }),
		});
	}
	return out;
}

/** Path-free diagnostic sentences for the read model's `warnings`. */
function warningMessages(diagnostics: readonly RawDiagnostic[]): string[] {
	const out: string[] = [];
	for (const diagnostic of diagnostics) {
		if (diagnostic.type === "info") continue;
		const message = pathFreeMessage(diagnostic.message);
		if (message !== undefined) out.push(message);
	}
	return out;
}

/** One configured skill, reduced to the facts the read model needs. */
interface RawSkill {
	readonly name: string;
	readonly description: string;
	readonly filePath: string | undefined;
	/** Gateway `disableModelInvocation`: the skill is loaded but hidden from the model. */
	readonly hiddenFromModel: boolean;
	/** Provider id parsed from the gateway's `provider:level` source string. */
	readonly provider: string | undefined;
	/** `user` | `project` | `native` from the gateway's source info. */
	readonly level: string | undefined;
	readonly hasInstall: boolean;
	readonly installScope: string | undefined;
}

/** Parse the provider id out of `skill.sourceInfo.source` (`provider:level`). */
function providerOf(source: string | undefined): string | undefined {
	if (source === undefined || source.includes("/") || source.includes("\\")) return undefined;
	const separator = source.indexOf(":");
	const provider = (separator === -1 ? source : source.slice(0, separator)).trim();
	return provider === "" ? undefined : provider;
}

/** Read one `GET /api/skills` row; `undefined` when it has no usable name. */
function readSkill(raw: unknown): RawSkill | undefined {
	if (!isRecord(raw)) return undefined;
	const name = stringField(raw, "name");
	if (name === undefined) return undefined;
	const sourceInfo = isRecord(raw.sourceInfo) ? raw.sourceInfo : undefined;
	const install = isRecord(raw.install) ? raw.install : undefined;
	return {
		name,
		description: stringField(raw, "description") ?? "",
		filePath: stringField(raw, "filePath"),
		hiddenFromModel: raw.disableModelInvocation === true,
		provider: providerOf(sourceInfo === undefined ? undefined : stringField(sourceInfo, "source")),
		level: sourceInfo === undefined ? undefined : stringField(sourceInfo, "scope"),
		hasInstall: install !== undefined,
		installScope: install === undefined ? undefined : stringField(install, "scope"),
	};
}

/** Map the gateway's source metadata onto the contract's scope. */
function skillScope(skill: RawSkill): SkillScope {
	if (skill.provider === OFFICIAL_SKILL_PROVIDER) return "builtin";
	if (skill.level === "project" || skill.installScope === "project") return "workspace";
	return "global";
}

/** Map the gateway's source metadata onto the contract's source kind. */
function skillSourceKind(skill: RawSkill): SkillSourceKind {
	if (skill.hasInstall || skill.provider === MANAGED_SKILL_PROVIDER) return "managed";
	if (skill.provider !== undefined && PLUGIN_SKILL_PROVIDERS[skill.provider] === true) return "plugin";
	return "native";
}

/** Safe display label for a skill's winning source. */
function skillSourceLabel(skill: RawSkill, kind: SkillSourceKind): string {
	if (skill.provider !== undefined) {
		return Object.hasOwn(SKILL_SOURCE_LABELS, skill.provider) ? SKILL_SOURCE_LABELS[skill.provider] : skill.provider;
	}
	return kind === "managed" ? "托管" : "OMP";
}

/**
 * One `SkillRecord`. The gateway exposes a single `disableModelInvocation` bit
 * (frontmatter `hide` / `disable-model-invocation`), which the Studio toggle
 * renders as `enabled`; `hide` therefore stays `false` rather than mirroring
 * the same bit twice.
 */
function toSkillRecord(skill: RawSkill): SkillRecord {
	const sourceKind = skillSourceKind(skill);
	return {
		name: skill.name,
		desc: skill.description,
		scope: skillScope(skill),
		sourceKind,
		sourceLabel: skillSourceLabel(skill, sourceKind),
		enabled: !skill.hiddenFromModel,
		hide: false,
	};
}

/** One declared contribution of a plugin package. */
interface RawPluginResource {
	readonly kind: string;
	readonly name: string;
}

/** One configured plugin, reduced to the facts the read model needs. */
interface RawPlugin {
	readonly source: string;
	readonly scope: string;
	readonly packageName: string | undefined;
	readonly version: string | undefined;
	readonly configuredVersion: string | undefined;
	readonly disabled: boolean;
	readonly status: string;
	readonly counts: Readonly<Record<string, unknown>> | undefined;
	readonly resources: readonly RawPluginResource[];
}

/** Read one `GET /api/plugins` package row; `undefined` without a source. */
function readPlugin(raw: unknown): RawPlugin | undefined {
	if (!isRecord(raw)) return undefined;
	const source = stringField(raw, "source");
	if (source === undefined) return undefined;
	const resources: RawPluginResource[] = [];
	for (const entry of arrayField(raw, "resources") ?? []) {
		if (!isRecord(entry)) continue;
		const kind = stringField(entry, "kind");
		const name = stringField(entry, "name");
		if (kind === undefined || name === undefined) continue;
		resources.push({ kind, name });
	}
	return {
		source,
		scope: stringField(raw, "scope") ?? "global",
		packageName: stringField(raw, "packageName"),
		version: stringField(raw, "version"),
		configuredVersion: stringField(raw, "configuredVersion"),
		disabled: raw.disabled === true,
		status: stringField(raw, "status") ?? "",
		counts: isRecord(raw.counts) ? raw.counts : undefined,
		resources,
	};
}

/** A short package label; never an absolute path. */
function pluginName(plugin: RawPlugin): string {
	if (plugin.packageName !== undefined) return plugin.packageName;
	const kind = pluginSourceKind(plugin.source);
	let source = plugin.source.trim().replace(/[\\/]+$/, "");
	if (kind === "npm" && source.startsWith("npm:")) source = source.slice(4);
	if (kind === "npm" && source.startsWith("@") && source.includes("/")) {
		const slash = source.indexOf("/");
		const rest = source.slice(slash + 1).replace(/@[^@/]*$/, "");
		return `${source.slice(0, slash)}/${rest}`;
	}
	const segments = source.split(/[\\/]/);
	let last = segments[segments.length - 1] ?? source;
	if (kind === "git") last = last.replace(/\.git$/i, "");
	if (kind === "npm") last = last.replace(/@[^@]*$/, "");
	return last || source;
}

/** Classify the package source from its syntax, not from an assumed install kind. */
function pluginSourceKind(source: string): PluginSourceKind {
	if (source.startsWith("npm:")) return "npm";
	if (/^git[+@:]|^github:|^ssh:\/\/|^https?:\/\//i.test(source) || /\.git(?:#.*)?$/i.test(source)) return "git";
	if (/^[.~][\\/]/.test(source) || /^[\\/]/.test(source) || /^[A-Za-z]:[\\/]/.test(source) || source.includes("\\")) {
		return "link";
	}
	// The extension config stores filesystem paths; a bare slash-separated
	// entry is a relative path unless it is an npm scope (`@scope/pkg`).
	if (source.includes("/") && !source.startsWith("@")) return "link";
	return "npm";
}

/** Contribution names declared for one resource kind. */
function pluginItems(plugin: RawPlugin, kind: string): string[] {
	return plugin.resources.filter(resource => resource.kind === kind).map(resource => resource.name);
}

/** A declared contribution count; `0` when the gateway reported none. */
function pluginCount(plugin: RawPlugin, field: string): number {
	return plugin.counts === undefined ? 0 : (numberField(plugin.counts, field) ?? 0);
}

/** The first path-free error for this package, when the gateway reported one. */
function pluginError(plugin: RawPlugin, diagnostics: readonly RawDiagnostic[]): string | undefined {
	for (const diagnostic of diagnostics) {
		if (diagnostic.type !== "error" || diagnostic.source !== plugin.source) continue;
		const message = pathFreeMessage(diagnostic.message);
		if (message !== undefined) return message;
	}
	if (plugin.status === "missing") return "Configured package is not installed.";
	return undefined;
}

/** One `PluginRecord` built from the gateway's package inventory. */
function toPluginRecord(plugin: RawPlugin, diagnostics: readonly RawDiagnostic[]): PluginRecord {
	const name = pluginName(plugin);
	const error = pluginError(plugin, diagnostics);
	const sourceKind = pluginSourceKind(plugin.source);
	const toolItems = pluginItems(plugin, "extension");
	const commandItems = pluginItems(plugin, "prompt");
	const uiItems = pluginItems(plugin, "theme");
	return {
		name,
		version: plugin.version ?? plugin.configuredVersion ?? "",
		sourceKind,
		srcLabel: PLUGIN_SOURCE_LABELS[sourceKind],
		enabled: !plugin.disabled,
		status: plugin.status === "missing" ? "error" : "configured",
		tools: pluginCount(plugin, "extensions"),
		commands: pluginCount(plugin, "prompts"),
		// The gateway inventory has no hook resource kind, so no hook
		// contributions are reported.
		hooks: 0,
		ui: uiItems.length > 0,
		toolItems,
		commandItems,
		hookItems: [],
		uiItems,
		...(error === undefined ? {} : { err: error }),
	};
}

/** Decoded `GET /api/skills` inventory. */
interface SkillsInventory {
	readonly skills: readonly RawSkill[];
	readonly diagnostics: readonly RawDiagnostic[];
}

/** Decoded `GET /api/plugins` inventory. */
interface PluginsInventory {
	readonly packages: readonly RawPlugin[];
	readonly diagnostics: readonly RawDiagnostic[];
}

/** The cwd query the skills/plugins scans read for. */
function projectQuery(): string {
	return `cwd=${segment(getProjectDir())}`;
}

/** `GET /api/skills` for the host's project directory. */
async function readSkillsInventory(): Promise<SkillsInventory> {
	const body = await gatewayJson<unknown>(SKILLS_ROUTE, { query: projectQuery() });
	if (!isRecord(body)) throw unavailable("GET /api/skills returned a non-object body");
	const rows = arrayField(body, "skills");
	if (rows === undefined) throw unavailable("GET /api/skills returned no skills array");
	const skills: RawSkill[] = [];
	for (const row of rows) {
		const skill = readSkill(row);
		if (skill !== undefined) skills.push(skill);
	}
	return { skills, diagnostics: readDiagnostics(body) };
}

/** `GET /api/plugins` for the host's project directory. */
async function readPluginsInventory(): Promise<PluginsInventory> {
	const body = await gatewayJson<unknown>(PLUGINS_ROUTE, { query: projectQuery() });
	if (!isRecord(body)) throw unavailable("GET /api/plugins returned a non-object body");
	const rows = arrayField(body, "packages");
	if (rows === undefined) throw unavailable("GET /api/plugins returned no packages array");
	const packages: RawPlugin[] = [];
	for (const row of rows) {
		const plugin = readPlugin(row);
		if (plugin !== undefined) packages.push(plugin);
	}
	return { packages, diagnostics: readDiagnostics(body) };
}

/**
 * `POST /api/skills/reveal`: the gateway resolves the skill (or root) through
 * its own scan and opens the folder, so no path ever crosses this module.
 * Storage-level refusals are surfaced as `UNAVAILABLE`: a missing name or a
 * folder outside the skill roots cannot be retried into success.
 */
async function revealSkillFolder(body: Record<string, unknown>): Promise<void> {
	const reply = await callGateway(SKILLS_REVEAL_ROUTE, { method: "POST", body });
	if (reply.status >= 200 && reply.status < 300) return;
	if (reply.status === 404) throw unavailable("skill not found");
	if (reply.status === 403) throw unavailable("outside the skill roots");
	throw unavailable(`POST ${SKILLS_REVEAL_ROUTE} → ${reply.status}`);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * `skills.get` → `GET /api/skills` + `GET /api/plugins`.
 *
 * Both scans read the host project directory because the operation carries no
 * workspace input; user-level skills and plugins come along in the same scan.
 * Diagnostics are carried only when they contain no absolute path.
 */
async function getSkills(_input: EmptyInput): Promise<ExtensibilityReadModel> {
	const [skills, plugins] = await Promise.all([readSkillsInventory(), readPluginsInventory()]);
	const warnings = [...warningMessages(skills.diagnostics), ...warningMessages(plugins.diagnostics)];
	return {
		skills: skills.skills.map(toSkillRecord),
		plugins: plugins.packages.map(plugin => toPluginRecord(plugin, plugins.diagnostics)),
		warnings: [...new Set(warnings)],
		generatedAt: new Date().toISOString(),
	};
}

/**
 * `capabilities.get` → the manifest already advertised by this host.
 *
 * The registry builds it from the registered handlers; rebuilding or augmenting
 * it here would advertise operations this process cannot answer.
 */
async function getCapabilities(_input: EmptyInput, context: StudioHostContext): Promise<CapabilityManifest> {
	return context.capabilities;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * `skills.setEnabled` → `PATCH /api/skills`.
 *
 * The gateway's only skill mutation writes the SKILL.md
 * `disable-model-invocation` frontmatter key, which is the bit the Studio
 * toggle presents as `enabled`. Bundled official-pack skills are not
 * user-owned and are refused. The skill's path never leaves this module: the
 * renderer supplies a name and the path is resolved from the gateway scan.
 */
async function setSkillEnabled(input: CommandInput<"skills.setEnabled">): Promise<ConfigWriteResult> {
	const name = requiredString(input, "name");
	const enabled = requiredBoolean(input, "enabled");
	const scope = optionalScope(input);
	const inventory = await readSkillsInventory();
	const candidate = inventory.skills.find(skill => skill.name === name);
	if (candidate === undefined) throw invalid(`unknown skill: ${name}`);
	if (candidate.provider === OFFICIAL_SKILL_PROVIDER) throw invalid(`builtin skill cannot be toggled: ${name}`);
	if (scope === "project" && skillScope(candidate) !== "workspace")
		throw invalid(`skill ${name} is not project-scoped`);
	if (scope === "user" && skillScope(candidate) === "workspace") throw invalid(`skill ${name} is not user-scoped`);
	if (candidate.filePath === undefined) throw invalid(`skill ${name} has no file to change`);
	await gatewayOk(SKILLS_ROUTE, {
		method: "PATCH",
		body: { filePath: candidate.filePath, disableModelInvocation: !enabled },
	});
	return {
		applied: true,
		runtimeEffect: "new-session",
		message: `Skill ${name} ${enabled ? "enabled" : "disabled"}`,
	};
}

/**
 * `skills.reveal` → `POST /api/skills/reveal`.
 *
 * Only a name and optional scope cross the boundary; the gateway resolves the
 * skill through the same scan as `skills.get` and refuses any folder outside
 * the project or agent roots. The result carries no message so the Renderer
 * keeps its localized toast.
 */
async function revealSkill(input: CommandInput<"skills.reveal">): Promise<ConfigWriteResult> {
	const name = requiredString(input, "name");
	const scope = optionalScope(input);
	await revealSkillFolder({
		cwd: getProjectDir(),
		name,
		...(scope === undefined ? {} : { scope }),
	});
	return { applied: true, runtimeEffect: "immediate" };
}

/**
 * `skills.revealRoot` → `POST /api/skills/reveal { root: true }`.
 *
 * The route still requires a non-empty `name` even for a root reveal (the
 * gateway ignores it in that branch), so the scanned directory's own name is
 * sent. An omitted scope opens the project root; `user` opens the agent root.
 */
async function revealSkillRoot(input: CommandInput<"skills.revealRoot">): Promise<ConfigWriteResult> {
	const scope = optionalScope(input);
	await revealSkillFolder({
		cwd: getProjectDir(),
		name: "skills",
		root: true,
		...(scope === undefined ? {} : { scope }),
	});
	return { applied: true, runtimeEffect: "immediate" };
}

/**
 * `plugins.setEnabled` → `GET /api/plugins` then `POST /api/plugins`.
 *
 * The mutation addresses a package by its configured source, so the name in
 * the read model is resolved back to the matching package first. `user` maps to
 * the gateway's `global` inventory scope.
 */
async function setPluginEnabled(input: CommandInput<"plugins.setEnabled">): Promise<ConfigWriteResult> {
	const name = requiredString(input, "name");
	const enabled = requiredBoolean(input, "enabled");
	const scope = optionalScope(input);
	const inventory = await readPluginsInventory();
	const matches = inventory.packages.filter(plugin => pluginName(plugin) === name);
	let candidates = matches;
	if (scope !== undefined) {
		candidates = matches.filter(plugin => plugin.scope === (scope === "project" ? "project" : "global"));
	} else {
		const projectScoped = matches.filter(plugin => plugin.scope === "project");
		if (projectScoped.length > 0) candidates = projectScoped;
	}
	if (candidates.length === 0) throw invalid(`unknown plugin: ${name}`);
	if (candidates.length > 1) throw invalid(`ambiguous plugin: ${name}`);
	const [plugin] = candidates;
	await gatewayOk(PLUGINS_ROUTE, {
		body: {
			action: enabled ? "enable" : "disable",
			source: plugin.source,
			scope: plugin.scope === "project" ? "project" : "user",
			cwd: getProjectDir(),
		},
	});
	return {
		applied: true,
		runtimeEffect: "new-session",
		message: `Plugin ${name} ${enabled ? "enabled" : "disabled"}`,
	};
}

/**
 * Skills family: the configured inventory read, the two enable/disable
 * mutations, and the two folder reveals. `commands.getManifest` stays
 * unregistered because the slash-command list has no host-reachable route.
 */
export const skillsOps: StudioFamily = {
	id: "skills",
	queries: {
		"skills.get": getSkills,
		"capabilities.get": getCapabilities,
	},
	commands: {
		"skills.setEnabled": setSkillEnabled,
		"skills.reveal": revealSkill,
		"skills.revealRoot": revealSkillRoot,
		"plugins.setEnabled": setPluginEnabled,
	},
};
