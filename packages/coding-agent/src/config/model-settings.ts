/**
 * Settings declared by this domain (see `config/registry.ts`). Declaration order is the
 * settings-panel order; `config/all-settings.ts` registers every domain.
 */
import { register, effect, operatorValue, type SettingValueOf } from "./registry";
import { type AuthAccountPolicies } from "@linxiraos/pi-ai/auth-storage";
import { setUnpausedProviders } from "@linxiraos/pi-ai/oauth";
import { authProviders } from "@linxiraos/pi-catalog/compat/auth";
import { isRecord } from "@linxiraos/pi-utils";
import { cfgDefaultThinkingLevel } from "../session/settings";
import { AUTO_THINKING, parseThinkingLevel } from "../thinking/levels";
import type { ConfiguredThinkingLevel } from "../utils/render-utils";
import { EMPTY_SCOPED_FALLBACK_CHAINS, FALLBACK_SCOPES } from "./fallback-normalize";

/** Display metadata for one model tag. */
export interface ModelTagDef {
	name: string;
	color?: string;
	/** If true, the role is functional but not shown in the model selector UI. */
	hidden?: boolean;
}

/** Model tags keyed by tag id (`modelTags`). */
export type ModelTagsSettings = Record<string, ModelTagDef>;

/**
 * One saved model preset (`modelPresets.<name>`): the role assignments and default thinking level
 * captured by `/modelpreset save` or the model hub, re-applied as a whole by `/modelpreset switch`.
 */
export interface ModelPreset {
	modelRoles: Record<string, string>;
	/** `defaultThinkingLevel` at save time; absent in hand-written presets that leave it alone. */
	defaultThinkingLevel?: SettingValueOf<typeof cfgDefaultThinkingLevel>;
}

/**
 * Model identity one named agent or Vibe/Team target can carry. A string
 * shorthand is just `{ model }`, so the simple shape stays a one-liner.
 */
export interface ModelAgentIdentity {
	/** Primary selector: `provider/id[:thinking]` or a `@role` alias. */
	model?: string;
	/** Overrides the selector's or role's thinking level. */
	thinkingLevel?: ConfiguredThinkingLevel;
	/** Ordered fallback selectors, independent of every other scope's chain. */
	fallback?: readonly string[];
}

export type ModelAgentConfig = string | ModelAgentIdentity;

/** Per-agent identity overrides keyed by agent name or Vibe/Team target. */
export type ModelAgentsSettings = Record<string, ModelAgentConfig>;

/**
 * Egress boundary a scenario tolerates. Ordered from most restrictive to
 * least: `local` stays on this machine, `private` may reach a private network
 * deployment, `public` may reach a vendor API.
 */
export const MODEL_DATA_BOUNDARIES = ["local", "private", "public"] as const;
export type ModelDataBoundary = (typeof MODEL_DATA_BOUNDARIES)[number];

/**
 * One named scenario (`modelScenarios.<name>`). A scenario constrains which
 * agents may run it and how far their selected model may send data.
 *
 * `allowedAgents` is an allowlist; absent or empty means every agent. An agent
 * may appear in at most one scenario, so two constraints never overlap.
 * `failClosed` defaults to `true`: when no candidate fits the boundary the
 * resolver refuses instead of using an out-of-boundary model.
 */
export interface ModelScenario {
	allowedAgents?: readonly string[];
	boundary: ModelDataBoundary;
	failClosed?: boolean;
}

/** Named deployment scenarios (`modelScenarios`). */
export type ModelScenariosSettings = Record<string, ModelScenario>;

const EMPTY_STRING_ARRAY: string[] = [];
const EMPTY_STRING_RECORD: Record<string, string> = {};
const DEFAULT_CYCLE_ORDER: string[] = ["smol", "default", "slow"];
const EMPTY_MODEL_TAGS_RECORD: ModelTagsSettings = {};
const EMPTY_MODEL_PRESETS_RECORD: Record<string, ModelPreset> = {};
const EMPTY_MODEL_AGENTS_RECORD: ModelAgentsSettings = {};
const EMPTY_MODEL_SCENARIOS_RECORD: ModelScenariosSettings = {};
const EMPTY_AUTH_ACCOUNT_POLICIES: AuthAccountPolicies = [];

// Auth broker — credentials proxied through a remote `zetacode auth-broker serve`
// host. Hidden from the UI; populate via env vars or hand-edited config.yml. Env takes
// precedence so per-machine overrides remain trivial. The connection itself is resolved by
// `@linxiraos/pi-ai/auth-broker/discover` from env + global config.yml only (project layers
// never redirect credentials); these definitions own validation, CLI, and `cfg://` display.
export const cfgAuthBrokerUrl = register({
	id: "auth.broker.url",
	type: "string",
	default: undefined,
	env: "ZETA_AUTH_BROKER_URL",
});

export const cfgAuthBrokerToken = register({
	id: "auth.broker.token",
	type: "string",
	default: undefined,
	env: "ZETA_AUTH_BROKER_TOKEN",
	credential: true,
});

export const cfgAuthAccountPolicies = register({
	id: "auth.accountPolicies",
	type: "array",
	default: EMPTY_AUTH_ACCOUNT_POLICIES,
});

/** Providers the auth rules pause (`disabled "<reason>"`), offered as opt-back-in choices. */
const PAUSED_PROVIDER_CHOICES = authProviders()
	.filter(provider => provider.disabled !== undefined)
	.map(provider => ({ value: provider.id, label: provider.name, description: provider.disabled }));

/**
 * Paused providers the user turns back on, accepting the risk their pause reason names. Read
 * through {@link cfgOperatorUnpausedProviders}: a project layer never turns a paused provider on.
 */
export const cfgAuthUnpausedProviders = register({
	id: "auth.unpausedProviders",
	type: "array",
	default: EMPTY_STRING_ARRAY,
	ui: {
		tab: "providers",
		group: "Services",
		label: "Unpaused Providers",
		description:
			"Turn providers we paused back on: login, token refresh and stored credentials work again. Each pause names the account risk you accept. Project settings cannot set this",
		options: PAUSED_PROVIDER_CHOICES,
		// The editor writes the global layer; hide it while a project layer supplies a (disregarded) list.
		condition: "unpausedProvidersNotProject",
	},
});

/** `auth.unpausedProviders` from operator layers only; the value the process applies. */
export const cfgOperatorUnpausedProviders = operatorValue(cfgAuthUnpausedProviders);
effect(cfgOperatorUnpausedProviders, setUnpausedProviders);

export const cfgEnabledModels = register({
	id: "enabledModels",
	type: "array",
	default: EMPTY_STRING_ARRAY,
	pathScoped: { valuesKey: "models" },
});

/**
 * Model selectors excluded from pickers and selectors only. Hidden models stay
 * in the catalog and remain assignable through config (`modelRoles`,
 * `retry.fallbackChains`) and visible in model-config settings.
 *
 * Entries: `provider/model-id`, `provider/*`, `provider/vendor/*`, a bare model
 * id, or `*` (everything). A trailing `:thinking` suffix is ignored.
 */
export const cfgHiddenModels = register({
	id: "hiddenModels",
	type: "array",
	default: EMPTY_STRING_ARRAY,
});

export const cfgEnabledProviders = register({
	id: "enabledProviders",
	type: "array",
	default: EMPTY_STRING_ARRAY,
	pathScoped: { valuesKey: "providers" },
});

export const cfgDisabledProviders = register({
	id: "disabledProviders",
	type: "array",
	default: EMPTY_STRING_ARRAY,
	pathScoped: { valuesKey: "providers" },
});

export const cfgModelRoleStorage = register({
	id: "modelRoleStorage",
	type: "enum",
	values: ["global", "project"] as const,
	default: "global",
	ui: {
		tab: "model",
		group: "Prompt",
		label: "Model Role Storage",
		description: "Where model selector role assignments are saved",
		options: [
			{
				value: "global",
				label: "Global",
				description: "Save role models in the active profile config (current behavior)",
			},
			{
				value: "project",
				label: "Per-project",
				description: "Save project role models in .zeta/config.yml; missing project roles use global defaults",
			},
		],
	},
});

export const cfgModelRoles = register({ id: "modelRoles", type: "record", default: EMPTY_STRING_RECORD });

function isConfiguredThinkingLevel(value: unknown): value is ConfiguredThinkingLevel {
	return typeof value === "string" && (value === AUTO_THINKING || parseThinkingLevel(value) !== undefined);
}

function validateModelAgents(raw: unknown): void {
	if (raw === undefined || raw === null) return;
	if (!isRecord(raw)) throw new Error("modelAgents must be a mapping of agent names to model identities");
	for (const [agent, value] of Object.entries(raw)) {
		if (agent.trim() === "") throw new Error("modelAgents keys must be non-empty agent names");
		if (typeof value === "string") {
			if (value.trim() === "") throw new Error(`modelAgents.${agent} must be a non-empty selector`);
			continue;
		}
		if (!isRecord(value)) throw new Error(`modelAgents.${agent} must be a selector or an identity object`);
		if (value.model !== undefined && (typeof value.model !== "string" || value.model.trim() === "")) {
			throw new Error(`modelAgents.${agent}.model must be a non-empty selector`);
		}
		if (value.thinkingLevel !== undefined && !isConfiguredThinkingLevel(value.thinkingLevel)) {
			throw new Error(`modelAgents.${agent}.thinkingLevel is not a thinking level`);
		}
		if (
			value.fallback !== undefined &&
			(!Array.isArray(value.fallback) ||
				value.fallback.some(entry => typeof entry !== "string" || entry.trim() === ""))
		) {
			throw new Error(`modelAgents.${agent}.fallback must be an array of non-empty selectors`);
		}
	}
}

function validateFallbackScopes(raw: unknown): void {
	if (raw === undefined || raw === null) return;
	if (!isRecord(raw)) throw new Error("fallbackScopes must be a mapping of scopes to chain maps");
	for (const [scope, chains] of Object.entries(raw)) {
		if (!(FALLBACK_SCOPES as readonly string[]).includes(scope)) {
			throw new Error(`fallbackScopes.${scope} is not a fallback scope (${FALLBACK_SCOPES.join(", ")})`);
		}
		if (!isRecord(chains)) throw new Error(`fallbackScopes.${scope} must be a mapping of keys to selector arrays`);
		for (const [key, chain] of Object.entries(chains)) {
			if (
				key.trim() === "" ||
				!Array.isArray(chain) ||
				chain.some(entry => typeof entry !== "string" || entry.trim() === "")
			) {
				throw new Error(`fallbackScopes.${scope}.${key} must be an array of non-empty selector strings`);
			}
		}
	}
}

function validateModelScenarios(raw: unknown): void {
	if (raw === undefined || raw === null) return;
	if (!isRecord(raw)) throw new Error("modelScenarios must be a mapping of scenario names to constraints");
	const entries = Object.entries(raw);
	const assigned = new Map<string, string>();
	const ambient = entries.filter(([, value]) => {
		if (!isRecord(value)) return false;
		const agents = value.allowedAgents;
		return agents === undefined || (Array.isArray(agents) && agents.length === 0);
	});
	if (ambient.length > 1 || (ambient.length === 1 && entries.length > 1)) {
		throw new Error(
			`modelScenarios.${ambient[0]?.[0] ?? "?"} applies to every agent and cannot be combined with another scenario`,
		);
	}
	for (const [name, value] of entries) {
		if (name.trim() === "") throw new Error("modelScenarios keys must be non-empty scenario names");
		if (!isRecord(value)) throw new Error(`modelScenarios.${name} must be an object`);
		if (!(MODEL_DATA_BOUNDARIES as readonly string[]).includes(String(value.boundary))) {
			throw new Error(`modelScenarios.${name}.boundary must be one of ${MODEL_DATA_BOUNDARIES.join(", ")}`);
		}
		if (value.failClosed !== undefined && typeof value.failClosed !== "boolean") {
			throw new Error(`modelScenarios.${name}.failClosed must be a boolean`);
		}
		const agents = value.allowedAgents;
		if (agents === undefined) continue;
		if (!Array.isArray(agents)) throw new Error(`modelScenarios.${name}.allowedAgents must be an array`);
		for (const agent of agents) {
			if (typeof agent !== "string" || agent.trim() === "") {
				throw new Error(`modelScenarios.${name}.allowedAgents entries must be non-empty agent names`);
			}
			const key = agent.trim().toLowerCase();
			const owner = assigned.get(key);
			if (owner !== undefined && owner !== name) {
				throw new Error(`modelScenarios.${name}.allowedAgents lists ${agent}, already constrained by ${owner}`);
			}
			assigned.set(key, name);
		}
	}
}

/**
 * Per-agent identity overrides. Each named agent (bundled or user) and each
 * Vibe/Team role target (`worker`, `reviewer`, `secretary`, `pm`) can carry its
 * own primary model, thinking level, and fallback chain instead of sharing the
 * `task` selector. Absent fields fall back to the target's model role, so a
 * plain `modelRoles` configuration keeps working with no migration.
 */
export const cfgModelAgents = register({
	id: "modelAgents",
	type: "record",
	default: EMPTY_MODEL_AGENTS_RECORD,
	validate: validateModelAgents,
});

/**
 * Scoped fallback chains. `resume`, `retry`, `role`, `agent` and `mode` are
 * independent, and so are the model-kind scopes `chat`, `image`, `tts`, `stt`,
 * `decision` and `embedding`; a chain configured under one scope is never
 * reused by another. A kind chain in particular never borrows `retry` or the
 * legacy `retry.fallbackChains` default.
 */
export const cfgFallbackScopes = register({
	id: "fallbackScopes",
	type: "record",
	default: EMPTY_SCOPED_FALLBACK_CHAINS,
	validate: validateFallbackScopes,
});

/**
 * Deployment scenarios. Each names the agents allowed to run it and the data
 * boundary their model may send to. Absent scenarios leave every existing
 * configuration untouched (zero migration).
 */
export const cfgModelScenarios = register({
	id: "modelScenarios",
	type: "record",
	default: EMPTY_MODEL_SCENARIOS_RECORD,
	validate: validateModelScenarios,
});

/** Total provider budget for one native judge candidate, including setup and retries. */
export const cfgJudgmentAttemptTimeoutMs = register({
	id: "judgment.attemptTimeoutMs",
	type: "number",
	default: 3_000,
	validate: raw => {
		if (raw === undefined || raw === null) return;
		if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw <= 0) {
			throw new Error("judgment.attemptTimeoutMs must be a positive safe integer");
		}
	},
});

/** Named model presets; no settings-panel UI — managed by `/modelpreset` and the model hub. */
export const cfgModelPresets = register({
	id: "modelPresets",
	type: "record",
	default: EMPTY_MODEL_PRESETS_RECORD,
});

export const cfgModelTags = register({ id: "modelTags", type: "record", default: EMPTY_MODEL_TAGS_RECORD });

export const cfgModelProviderOrder = register({ id: "modelProviderOrder", type: "array", default: EMPTY_STRING_ARRAY });

export const cfgCycleOrder = register({ id: "cycleOrder", type: "array", default: DEFAULT_CYCLE_ORDER });

/**
 * Read the live models.dev catalog host instead of the snapshot bundled into
 * the build.
 *
 * Off by default: every run then uses `catalog-snapshot.json.zst`, so the CLI
 * makes no request to the shared catalog host and model rows cannot change
 * under a user between two runs of the same build. Turning it on restores the
 * pre-existing behaviour — background hydration adds newly published models
 * without waiting for a new release — at the cost of one conditional GET to
 * an upstream service.
 */
export const cfgCatalogRemoteRefresh = register({
	id: "catalog.remoteRefresh",
	type: "boolean",
	default: false,
	ui: {
		tab: "model",
		group: "Catalog",
		label: "Remote Model Refresh",
		description:
			"Fetch the shared models.dev catalog at runtime instead of the snapshot bundled with this build; off keeps every run offline and reproducible",
	},
});
