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
 * - `skills.get`              → `GET /api/skills?cwd=<project>` plus the
 *                               Zeta-native plugin registry carried by
 *                               `GET /api/plugins` (`installed[]`: marketplace
 *                               `installed_plugins.json` + the npm/git/link
 *                               lockfile, the same store the CLI reads)
 * - `skills.setEnabled`       → `PATCH /api/skills` (the gateway's only skill
 *                               mutation: it writes `disable-model-invocation`)
 * - `skills.reveal`           → `POST /api/skills/reveal { cwd, name, scope? }`
 * - `skills.revealRoot`       → `POST /api/skills/reveal { cwd, name, root: true }`
 * - `plugins.setEnabled`      → `GET /api/plugins` (id → registry entry) then
 *                               `POST /api/plugins { action, id, scope, cwd }`,
 *                               which applies the CLI's enable/disable
 *                               precedence (marketplace registry or lockfile)
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
	PluginPanelKind,
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
	native: "Zeta",
	"zeta-official": "Zeta",
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
export function skillSourceLabel(skill: RawSkill, kind: SkillSourceKind): string {
	if (skill.provider !== undefined) {
		return Object.hasOwn(SKILL_SOURCE_LABELS, skill.provider) ? SKILL_SOURCE_LABELS[skill.provider] : skill.provider;
	}
	return kind === "managed" ? "托管" : "Zeta";
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

/** One panel a plugin declares in its manifest. */
interface RawPanel {
	readonly id: string;
	readonly title: string;
	readonly kind: PluginPanelKind;
}

/** One Zeta-native registry plugin, reduced to the facts the read model needs. */
interface RawZetaPlugin {
	/** Addressable registry key: `name@marketplace` or the package name. */
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly sourceKind: PluginSourceKind;
	readonly scope: "user" | "project";
	readonly enabled: boolean;
	readonly toolItems: readonly string[];
	readonly commandItems: readonly string[];
	readonly hookItems: readonly string[];
	readonly panels: readonly RawPanel[];
	readonly error: string | undefined;
}

/** A string array field; non-string entries are dropped rather than coerced. */
function stringList(record: Readonly<Record<string, unknown>>, field: string): string[] {
	return (arrayField(record, field) ?? []).filter((entry): entry is string => typeof entry === "string");
}

/** The three source kinds the gateway reports, defaulting to a local link. */
function pluginSourceKindOf(value: string | undefined): PluginSourceKind {
	if (value === "npm" || value === "marketplace" || value === "link" || value === "git") return value;
	return "link";
}

function panelKindOf(value: string | undefined): PluginPanelKind | undefined {
	if (value === "list" || value === "form" || value === "chart" || value === "html") return value;
	return undefined;
}

/** Read one `GET /api/plugins` `installed` row; `undefined` without an id. */
function readZetaPlugin(raw: unknown): RawZetaPlugin | undefined {
	if (!isRecord(raw)) return undefined;
	const id = stringField(raw, "id");
	if (id === undefined) return undefined;
	const panels: RawPanel[] = [];
	for (const entry of arrayField(raw, "panels") ?? []) {
		if (!isRecord(entry)) continue;
		const panelId = stringField(entry, "id");
		const title = stringField(entry, "title");
		const kind = panelKindOf(stringField(entry, "kind"));
		if (panelId === undefined || title === undefined || kind === undefined) continue;
		panels.push({ id: panelId, title, kind });
	}
	return {
		id,
		name: stringField(raw, "name") ?? id,
		version: stringField(raw, "version") ?? "",
		sourceKind: pluginSourceKindOf(stringField(raw, "sourceKind")),
		scope: raw.scope === "project" ? "project" : "user",
		enabled: raw.enabled !== false,
		toolItems: stringList(raw, "toolItems"),
		commandItems: stringList(raw, "commandItems"),
		hookItems: stringList(raw, "hookItems"),
		panels,
		error: pathFreeMessage(stringField(raw, "error") ?? ""),
	};
}

/** One `PluginRecord` built from a registry row. */
function toPluginRecord(plugin: RawZetaPlugin): PluginRecord {
	const uiItems = plugin.panels.map(panel => panel.title);
	return {
		name: plugin.id,
		title: plugin.name,
		version: plugin.version,
		sourceKind: plugin.sourceKind,
		srcLabel: PLUGIN_SOURCE_LABELS[plugin.sourceKind],
		scope: plugin.scope,
		enabled: plugin.enabled,
		status: plugin.error === undefined ? "configured" : "error",
		tools: plugin.toolItems.length,
		commands: plugin.commandItems.length,
		hooks: plugin.hookItems.length,
		ui: plugin.panels.length > 0,
		toolItems: [...plugin.toolItems],
		commandItems: [...plugin.commandItems],
		hookItems: [...plugin.hookItems],
		uiItems,
		panels: plugin.panels.map(panel => ({ id: panel.id, title: panel.title, kind: panel.kind })),
		...(plugin.error === undefined ? {} : { err: plugin.error }),
	};
}

/** Decoded `GET /api/skills` inventory. */
interface SkillsInventory {
	readonly skills: readonly RawSkill[];
	readonly diagnostics: readonly RawDiagnostic[];
}

/** Decoded `GET /api/plugins` inventory. */
interface PluginsInventory {
	readonly plugins: readonly RawZetaPlugin[];
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
	const rows = arrayField(body, "installed");
	if (rows === undefined) throw unavailable("GET /api/plugins returned no installed array");
	const plugins: RawZetaPlugin[] = [];
	for (const row of rows) {
		const plugin = readZetaPlugin(row);
		if (plugin !== undefined) plugins.push(plugin);
	}
	return { plugins, diagnostics: readDiagnostics(body) };
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
		plugins: plugins.plugins.map(toPluginRecord),
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
 * `plugins.setEnabled` → `GET /api/plugins` then `POST /api/plugins { id }`.
 *
 * The read model names a registry entry by its addressable key
 * (`name@marketplace` or the package name), and the gateway's toggle applies
 * the same precedence the CLI does: marketplace ids go through the installed
 * registry, everything else through the runtime lockfile. `scope` picks the
 * copy when a plugin is installed in both; the CLI requires it in that case
 * too, so an unscoped ambiguous id is refused rather than guessed.
 */
async function setPluginEnabled(input: CommandInput<"plugins.setEnabled">): Promise<ConfigWriteResult> {
	const name = requiredString(input, "name");
	const enabled = requiredBoolean(input, "enabled");
	const scope = optionalScope(input);
	const inventory = await readPluginsInventory();
	const matches = inventory.plugins.filter(plugin => plugin.id === name);
	if (matches.length === 0) throw invalid(`unknown plugin: ${name}`);
	const scoped = scope === undefined ? matches : matches.filter(plugin => plugin.scope === scope);
	if (scoped.length === 0) throw invalid(`Plugin ${name} is not installed in ${scope} scope`);
	if (scope === undefined && new Set(matches.map(plugin => plugin.scope)).size > 1) {
		throw invalid(`Plugin ${name} is installed in both user and project scope. Pass scope: "user" or "project".`);
	}
	const [plugin] = scoped;
	await gatewayOk(PLUGINS_ROUTE, {
		body: {
			action: enabled ? "enable" : "disable",
			id: plugin.id,
			scope: plugin.scope,
			cwd: getProjectDir(),
		},
	});
	return {
		applied: true,
		runtimeEffect: "new-session",
		message: `Plugin ${plugin.name} ${enabled ? "enabled" : "disabled"}`,
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
