/**
 * Studio operations — the task-agent definition inventory.
 *
 * Owned operations: `agents.definitions.get`, `agents.definition.configure`.
 *
 * A handler takes the contract input and returns the contract result; it
 * reaches Zeta state only through `../gateway.js` (`gatewayJson`, `unavailable`)
 * plus the runtime's own discovery loader. A name this file does not export is
 * not advertised in the capability manifest, so the Renderer never navigates to
 * a surface this host cannot serve.
 *
 * Operation → Zeta source:
 * - `agents.definitions.get` → `discoverAgents()` (`task/discovery.ts`), the
 *   same disk scan the task tool uses: project `.zeta/agents`, user
 *   `.zeta/agents`, extension/plugin agent roots, then the bundled roster
 *   (first wins by name). This is the configured inventory, not the Runtime's
 *   loaded Agent Hub.
 * - the `task.*` overlay fields (`disabled`, `overrideModel`, `prewalkOverride`,
 *   `advisorOverride`) → `GET /api/settings/values`, which reports registered
 *   settings even when the settings panel hides them; `configure` writes those
 *   same paths through `PUT /api/settings` after validating the discovered name.
 *
 * `editable` / `canDelete` / `canFork` are still `false` for every row: this
 * host writes per-agent overlays only, not definition files. The per-agent model
 * dropdown is an overlay selection, so it does not require definition CRUD.
 *
 * No path leaves this module: `AgentDefinition.filePath` is used only to decide
 * whether a definition is file-backed, and warnings keep only path-free text.
 */
import { getProjectDir, isRecord } from "@linxiraos/pi-utils";
import { MODEL_ROLES } from "../../../config/model-roles.js";
import { discoverAgents } from "../../../task/discovery.js";
import type { AgentDefinition } from "../../../task/types.js";
import { BUILTIN_TOOL_NAMES } from "../../../tools/builtin-names.js";
import type {
	AgentDefinitionRecord,
	AgentDefinitionsReadModel,
	AgentDefinitionSource,
	AgentThinkingLevel,
	CommandInput,
	ConfigWriteResult,
	EmptyInput,
} from "../contract/index.js";
import { gatewayJson, invalid, StudioOpError, unavailable } from "../gateway.js";
import type { StudioFamily } from "../registry.js";
import { AgentLifecycleManager } from "../../../registry/agent-lifecycle.js";
import { AgentRegistry, type AgentRef } from "../../../registry/agent-registry.js";

const SETTINGS_ROUTE = "/api/settings";
const SETTINGS_VALUES_ROUTE = "/api/settings/values";

/** Overlay settings the record carries, in the order the query asks for them. */
const OVERLAY_PATHS = [
	"task.disabledAgents",
	"task.agentModelOverrides",
	"task.agentPrewalk",
	"task.agentAdvisor",
] as const;

const THINKING_LEVELS: Readonly<Record<string, AgentThinkingLevel>> = {
	off: "off",
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
	auto: "auto",
};

/** Safe display label per definition source. */
const SOURCE_LABELS: Readonly<Record<AgentDefinitionSource, string>> = {
	project: "项目",
	user: "用户",
	bundled: "内置",
	plugin: "插件",
};

/** `task.*` overlays, narrowed from the settings values map. */
interface AgentOverlays {
	readonly disabled: ReadonlySet<string>;
	readonly modelOverrides: Readonly<Record<string, unknown>>;
	readonly prewalk: Readonly<Record<string, unknown>>;
	readonly advisor: Readonly<Record<string, unknown>>;
}

/** One registered setting value, or `undefined` when the route omitted the path. */
function valueOf(values: Readonly<Record<string, unknown>>, path: string): unknown {
	return Object.hasOwn(values, path) ? values[path] : undefined;
}

/** A `string[]` overlay, dropping non-string entries instead of coercing them. */
function stringSet(value: unknown): ReadonlySet<string> {
	if (value === undefined) return new Set();
	if (!Array.isArray(value)) throw unavailable("GET /api/settings/values returned malformed task.disabledAgents");
	return new Set(value.filter((entry): entry is string => typeof entry === "string"));
}

/** A `Record<string, string | boolean>` overlay, or none when unset. */
function overlayMap(value: unknown, path: string): Readonly<Record<string, unknown>> {
	if (value === undefined) return {};
	if (!isRecord(value)) throw unavailable(`GET /api/settings/values returned malformed ${path}`);
	return value;
}

/** `GET /api/settings/values` for the four task-agent overlays. */
async function readOverlays(): Promise<AgentOverlays> {
	const query = OVERLAY_PATHS.map(path => `path=${encodeURIComponent(path)}`).join("&");
	const body = await gatewayJson<unknown>(SETTINGS_VALUES_ROUTE, { query });
	if (!isRecord(body) || !isRecord(body["values"])) {
		throw unavailable("GET /api/settings/values returned no value map");
	}
	const values = body["values"];
	return {
		disabled: stringSet(valueOf(values, "task.disabledAgents")),
		modelOverrides: overlayMap(valueOf(values, "task.agentModelOverrides"), "task.agentModelOverrides"),
		prewalk: overlayMap(valueOf(values, "task.agentPrewalk"), "task.agentPrewalk"),
		advisor: overlayMap(valueOf(values, "task.agentAdvisor"), "task.agentAdvisor"),
	};
}

/** A contract thinking level, or `undefined` when the file said something else (`inherit`). */
function thinkingLevelOf(value: AgentDefinition["thinkingLevel"]): AgentThinkingLevel | undefined {
	if (typeof value !== "string") return undefined;
	return Object.hasOwn(THINKING_LEVELS, value) ? THINKING_LEVELS[value] : undefined;
}

/** A `string | boolean` override as the contract spells it (`on`/`off`/pattern). */
function overrideText(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "boolean") return value ? "on" : "off";
	return undefined;
}

/** Project one discovered definition. */
function toRecord(agent: AgentDefinition, overlays: AgentOverlays): AgentDefinitionRecord {
	const thinkingLevel = thinkingLevelOf(agent.thinkingLevel);
	const overrideModel = overrideText(overlays.modelOverrides[agent.name]);
	const prewalkOverride = overrideText(overlays.prewalk[agent.name]);
	const advisorOverride = overrideText(overlays.advisor[agent.name]);
	const promptPacked = agent.source === "bundled" && agent.systemPrompt.trim() === "";
	return {
		name: agent.name,
		description: agent.description,
		systemPrompt: agent.systemPrompt,
		...(agent.tools === undefined ? {} : { tools: [...agent.tools] }),
		...(agent.spawns === undefined ? {} : { spawns: agent.spawns }),
		...(agent.model === undefined ? {} : { model: [...agent.model] }),
		...(thinkingLevel === undefined ? {} : { thinkingLevel }),
		...(agent.output === undefined ? {} : { output: agent.output }),
		...(agent.blocking === undefined ? {} : { blocking: agent.blocking }),
		...(agent.structured === undefined ? {} : { structured: agent.structured }),
		...(agent.autoloadSkills === undefined ? {} : { autoloadSkills: [...agent.autoloadSkills] }),
		...(agent.readSummarize === undefined ? {} : { readSummarize: agent.readSummarize }),
		...(agent.prewalk === undefined ? {} : { prewalk: agent.prewalk }),
		...(agent.advisor === undefined ? {} : { advisor: agent.advisor }),
		source: agent.source,
		sourceLabel: SOURCE_LABELS[agent.source],
		editable: false,
		canDelete: false,
		canFork: false,
		disabled: overlays.disabled.has(agent.name),
		...(overrideModel === undefined ? {} : { overrideModel }),
		...(prewalkOverride === undefined ? {} : { prewalkOverride }),
		...(advisorOverride === undefined ? {} : { advisorOverride }),
		...(promptPacked ? { promptPacked: true } : {}),
	};
}

/**
 * `agents.definitions.get` → the configured task-agent roster.
 *
 * `projectScopeAvailable` is whether discovery found a configured project agent
 * root: without one the Renderer disables project-scope authoring instead of
 * pointing at a directory that does not exist. `roleAliases` are the builtin
 * model roles the `model` field accepts; custom roles are `modelTags` entries
 * this host does not read here.
 */
async function readAgentDefinitions(_input: EmptyInput): Promise<AgentDefinitionsReadModel> {
	const overlays = await readOverlays();
	const discovered = await discoverAgents(getProjectDir());
	return {
		agents: discovered.agents.map(agent => toRecord(agent, overlays)),
		// Discovery resolves name collisions first-wins rather than reporting
		// them, and parse warnings go to the process log; this host has nothing
		// path-free to add, so the list stays empty instead of inventing notes.
		warnings: [],
		builtinToolNames: [...BUILTIN_TOOL_NAMES],
		roleAliases: Object.keys(MODEL_ROLES),
		projectScopeAvailable: discovered.projectAgentsDir !== null,
		generatedAt: new Date().toISOString(),
	};
}

/**
 * Resolve the generation-fenced live ref an `agent.*` command was issued for.
 * A stale generation is rejected instead of acting on a newer same-id agent.
 */
function mutationRef(input: unknown): AgentRef {
	const record = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
	const agentId = typeof record.agentId === "string" && record.agentId !== "" ? record.agentId : undefined;
	if (!agentId) throw invalid("agentId must be a non-empty string");
	if (typeof record.expectedGeneration !== "number" || !Number.isSafeInteger(record.expectedGeneration)) {
		throw invalid("expectedGeneration must be an integer");
	}
	const ref = AgentRegistry.global().get(agentId);
	if (!ref) throw invalid(`Unknown agent "${agentId}"`);
	if (ref.generation !== record.expectedGeneration) {
		throw new StudioOpError("STATE_VERSION_CONFLICT", `Agent "${agentId}" changed generation`);
	}
	return ref;
}

async function liveHandle(ref: AgentRef) {
	if (ref.status === "parked" || ref.status === "aborted") {
		const handle = await AgentLifecycleManager.global().ensureLive(ref.id, {});
		return handle;
	}
	if (!ref.session) throw unavailable(`Agent "${ref.id}" has no live session`);
	return ref.session;
}

/**
 * Agents family: the task-agent definition inventory plus the real control
 * commands Agent Hub already advertises. Each handler acts on the live
 * registry/lifecycle; there is no second control path.
 */


/** `PUT /api/settings` for one registered path. */
async function putSetting(path: string, value: unknown): Promise<void> {
	const body = await gatewayJson<unknown>(SETTINGS_ROUTE, { method: "PUT", body: { path, value } });
	if (!isRecord(body) || body.ok !== true) throw unavailable(`PUT /api/settings did not apply ${path}`);
}

/** Current values of registered settings, keyed by path. */
async function readSettingValues(paths: readonly string[]): Promise<Readonly<Record<string, unknown>>> {
	const query = paths.map(path => `path=${encodeURIComponent(path)}`).join("&");
	const body = await gatewayJson<unknown>(SETTINGS_VALUES_ROUTE, { query });
	if (!isRecord(body) || !isRecord(body.values)) {
		throw unavailable("GET /api/settings/values returned no value map");
	}
	return body.values;
}

function overlay(value: unknown, path: string): Record<string, unknown> {
	if (value === null || value === undefined) return {};
	if (!isRecord(value)) throw unavailable(`GET /api/settings/values returned malformed ${path}`);
	return { ...value };
}

function requiredName(input: CommandInput<"agents.definition.configure">): string {
	if (typeof input.name !== "string" || input.name.trim() === "") {
		throw invalid("name must be a non-empty string");
	}
	return input.name.trim();
}

function overrideValue(value: unknown, field: string): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "string") throw invalid(`${field} must be a string or null`);
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
}

/**
 * `agents.definition.configure` → the four `task.*` overlays in config.yml.
 *
 * This is the real write behind the per-agent model dropdown: the agent
 * definition file is not rewritten (that remains the dedicated definition
 * editor), only its persisted per-agent selection/disable/prewalk/advisor layer.
 * A stale or unknown agent name is refused against the same discovery roster
 * `agents.definitions.get` reports.
 */
async function configureAgent(input: CommandInput<"agents.definition.configure">): Promise<ConfigWriteResult> {
	const name = requiredName(input);
	const discovered = await discoverAgents(getProjectDir());
	if (!discovered.agents.some(agent => agent.name === name)) {
		throw invalid(`${name} is not a discovered agent`);
	}
	const has = (key: keyof CommandInput<"agents.definition.configure">): boolean => Object.hasOwn(input, key);
	if (!has("disabled") && !has("overrideModel") && !has("prewalkOverride") && !has("advisorOverride")) {
		throw invalid("configure requires at least one overlay field");
	}

	const values = await readSettingValues(OVERLAY_PATHS);
	const disabledValue = values["task.disabledAgents"];
	const disabled = Array.isArray(disabledValue)
		? disabledValue.filter((entry): entry is string => typeof entry === "string")
		: [];
	const modelOverrides = overlay(values["task.agentModelOverrides"], "task.agentModelOverrides");
	const prewalkOverrides = overlay(values["task.agentPrewalk"], "task.agentPrewalk");
	const advisorOverrides = overlay(values["task.agentAdvisor"], "task.agentAdvisor");
	let wrote = false;

	if (has("disabled")) {
		if (typeof input.disabled !== "boolean") throw invalid("disabled must be a boolean");
		const wasDisabled = disabled.includes(name);
		if (wasDisabled !== input.disabled) {
			const next = new Set(disabled);
			if (input.disabled) next.add(name);
			else next.delete(name);
			await putSetting("task.disabledAgents", [...next].sort((left, right) => left.localeCompare(right)));
			wrote = true;
		}
	}
	const applyOverride = async (
		key: "overrideModel" | "prewalkOverride" | "advisorOverride",
		map: Record<string, unknown>,
		path: string,
	): Promise<void> => {
		if (!has(key)) return;
		const value = overrideValue(input[key], key);
		if (value === null) delete map[name];
		else map[name] = value;
		await putSetting(path, map);
		wrote = true;
	};
	await applyOverride("overrideModel", modelOverrides, "task.agentModelOverrides");
	await applyOverride("prewalkOverride", prewalkOverrides, "task.agentPrewalk");
	await applyOverride("advisorOverride", advisorOverrides, "task.agentAdvisor");

	return {
		applied: true,
		runtimeEffect: "new-session",
		message: wrote ? `Per-agent settings updated for ${name}.` : `Per-agent settings unchanged for ${name}.`,
	};
}

/** Agents family: the task-agent definition inventory. */
export const agentsOps: StudioFamily = {
	id: "agents",
	queries: {
		"agents.definitions.get": readAgentDefinitions,
	},
	commands: {
		"agent.send": async input => {
			const ref = mutationRef(input);
			const record = input as Record<string, unknown>;
			const text = typeof record.text === "string" ? record.text.trim() : "";
			if (!text) throw invalid("text must be a non-empty string");
			const mode = record.mode;
			if (mode !== "prompt" && mode !== "steer" && mode !== "followUp") {
				throw invalid("mode must be prompt, steer, or followUp");
			}
			const session = await liveHandle(ref);
			if (mode === "steer") {
				await session.steer(text);
			} else if (mode === "followUp" || session.isStreaming) {
				await session.prompt(text, { streamingBehavior: "followUp", userInitiated: true });
			} else {
				await session.prompt(text, { userInitiated: true });
			}
			return undefined;
		},
		"agent.kill": async input => {
			const ref = mutationRef(input);
			const released = await AgentLifecycleManager.global().release(ref.id, ref, { tombstone: true });
			if (!released) throw new StudioOpError("STATE_VERSION_CONFLICT", `Agent "${ref.id}" was not released`);
			return undefined;
		},
		"agent.revive": async input => {
			const ref = mutationRef(input);
			await AgentLifecycleManager.global().ensureLive(ref.id, {});
			return undefined;
		},
		"agent.release": async input => {
			const ref = mutationRef(input);
			const released = await AgentLifecycleManager.global().release(ref.id, ref);
			if (!released) throw new StudioOpError("STATE_VERSION_CONFLICT", `Agent "${ref.id}" was not released`);
			return undefined;
		},
		"agents.definition.configure": configureAgent,
	},
};
