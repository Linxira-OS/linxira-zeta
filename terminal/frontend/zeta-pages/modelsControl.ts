/**
 * Wire contract for `GET /api/models/control`.
 *
 * The page bundle is intentionally independent of `packages/coding-agent`
 * (ADR-0101), so this is a local copy of the gateway DTO. It is type-only
 * duplication of the JSON contract, not a second state source: the page stores
 * one `ModelsControlSnapshot` and both the form and Blueprint render from it.
 */
import { authFetch } from "./client";
import { isRecord } from "./typeGuards";

export type ControlModelKind =
	| "chat"
	| "image"
	| "tts"
	| "stt"
	| "decision"
	| "embedding"
	| "search"
	| "rerank"
	| "video";

/** Egress boundary a model endpoint implies. */
export type ModelDataBoundary = "local" | "private" | "public";

/** Fallback scopes reported by the gateway (runtime + model kinds). */
export type ModelControlFallbackScope =
	| "resume"
	| "retry"
	| "role"
	| "agent"
	| "mode"
	| "chat"
	| "image"
	| "tts"
	| "stt"
	| "decision"
	| "embedding";

export type CatalogModelKind =
	| "chat"
	| "tiny"
	| "image"
	| "tts"
	| "stt"
	| "search"
	| "judge"
	| "embedding"
	| "rerank"
	| "video";

export interface ModelControlProvider {
	readonly id: string;
	readonly name: string;
	readonly state: "visible" | "disabled";
	readonly enabled: boolean;
	readonly configured: boolean;
	readonly modelCount: number;
	readonly capabilities: readonly ControlModelKind[];
	readonly paused: readonly ControlModelKind[];
}

export interface ModelControlModelRef {
	readonly provider: string;
	readonly id: string;
	readonly name: string;
	readonly kind: ControlModelKind;
	readonly catalogKind: CatalogModelKind;
}

export interface ModelControlSectionModel extends ModelControlModelRef {
	readonly available: boolean;
	readonly boundary: ModelDataBoundary;
}

export interface ModelControlKindSection {
	readonly kind: ControlModelKind;
	readonly paused: boolean;
	readonly models: readonly ModelControlSectionModel[];
	/** This kind's own fallback chains; never borrowed from retry/default. */
	readonly fallback: readonly ModelControlChain[];
}

export interface ModelControlDuplicate {
	readonly removed: string;
	readonly kept: string;
}

export interface ModelControlChain {
	readonly key: string;
	readonly chain: readonly string[];
	readonly duplicates: readonly ModelControlDuplicate[];
	readonly sameModelDifferentEffort: readonly {
		readonly modelKey: string;
		readonly thinkingLevels: readonly string[];
	}[];
}

export interface ModelControlScopeChains {
	readonly scope: ModelControlFallbackScope;
	readonly chains: readonly ModelControlChain[];
}

export interface ModelControlRole {
	readonly role: string;
	readonly selector: string | null;
	readonly source: "agent" | "role" | "default";
	readonly resolved?: ModelControlModelRef;
	readonly thinkingLevel?: string;
	readonly warning?: string;
	readonly fallback: readonly string[];
	readonly fallbackSource?: string;
	readonly duplicates: readonly ModelControlDuplicate[];
}

export interface ModelControlTarget {
	readonly target: string;
	readonly kind: "agent" | "team";
	readonly role: string;
	readonly selector: string;
	readonly source: "agent" | "role" | "default";
	readonly resolved?: ModelControlModelRef;
	readonly thinkingLevel?: string;
	readonly warning?: string;
	readonly fallback: readonly string[];
	readonly fallbackSource?: string;
	readonly duplicates: readonly ModelControlDuplicate[];
}

export type ScenarioBoundaryOutcome = "allowed" | "fallback" | "refused" | "advisory" | "unresolved";

export interface ModelControlScenarioSkipped {
	readonly selector: string;
	readonly boundary?: ModelDataBoundary;
	readonly reason: "boundary" | "unresolved";
}

export interface ModelControlScenarioTarget {
	readonly target: string;
	readonly selector: string;
	readonly fallback: readonly string[];
	readonly fallbackSource?: string;
	readonly outcome: ScenarioBoundaryOutcome;
	readonly selected?: ModelControlModelRef;
	readonly selectedBoundary?: ModelDataBoundary;
	readonly skipped: readonly ModelControlScenarioSkipped[];
	readonly reason?: string;
}

export interface ModelControlScenario {
	readonly name: string;
	readonly boundary: ModelDataBoundary;
	readonly failClosed: boolean;
	readonly allowedAgents: readonly string[];
	readonly appliesToAll: boolean;
	readonly targets: readonly ModelControlScenarioTarget[];
}

export interface ModelsControlSnapshot {
	readonly schema: "models-control/1";
	readonly readOnly: true;
	readonly providers: readonly ModelControlProvider[];
	readonly roles: readonly ModelControlRole[];
	readonly fallbackScopes: readonly ModelControlScopeChains[];
	readonly legacyRetry: readonly ModelControlChain[];
	readonly agents: readonly ModelControlTarget[];
	readonly teamTargets: readonly ModelControlTarget[];
	readonly vibeTargets: readonly ModelControlTarget[];
	readonly kinds: readonly ModelControlKindSection[];
	readonly scenarios: readonly ModelControlScenario[];
	readonly catalogKinds: readonly CatalogModelKind[];
	readonly modelError?: string;
	readonly totals: {
		readonly providers: number;
		readonly models: number;
		readonly roles: number;
		readonly agents: number;
		readonly targets: number;
		readonly fallbackChains: number;
		readonly scenarios: number;
	};
}

export type ModelsControlFetcher = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Validate the envelope before it reaches React. A gateway from another
 * version must fail visibly instead of rendering empty tables as if the model
 * state were empty.
 */
export function parseModelsControlSnapshot(value: unknown): ModelsControlSnapshot {
	if (!isRecord(value)) throw new Error("models control: response is not an object");
	if (value.schema !== "models-control/1") throw new Error("models control: unsupported schema");
	if (value.readOnly !== true) throw new Error("models control: expected a read-only snapshot");
	if (
		!Array.isArray(value.providers) ||
		!Array.isArray(value.roles) ||
		!Array.isArray(value.fallbackScopes) ||
		!Array.isArray(value.legacyRetry) ||
		!Array.isArray(value.agents) ||
		!Array.isArray(value.teamTargets) ||
		!Array.isArray(value.vibeTargets) ||
		!Array.isArray(value.kinds) ||
		!Array.isArray(value.scenarios) ||
		!isRecord(value.totals)
	) {
		throw new Error("models control: malformed snapshot");
	}
	if (
		!value.kinds.every(
			section => isRecord(section) && Array.isArray(section.models) && Array.isArray(section.fallback),
		)
	) {
		throw new Error("models control: kind sections must carry their models and fallback chains");
	}
	return value as unknown as ModelsControlSnapshot;
}

export async function fetchModelsControl(fetcher: ModelsControlFetcher = authFetch): Promise<ModelsControlSnapshot> {
	const response = await fetcher("/api/models/control", { cache: "no-store", credentials: "include" });
	if (!response.ok) throw new Error(`models control: HTTP ${response.status}`);
	return parseModelsControlSnapshot(await response.json());
}
