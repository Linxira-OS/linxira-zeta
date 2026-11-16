/**
 * Transient native visualization reads: shell traces and their release.
 *
 * These are queries, not workbench commands: a read returns a presentation and
 * persists nothing in any command ledger. `shell.view.release` only drops the
 * host's per-conversation recorded-trace cache for the addressed command; it
 * never stops a native shell session.
 */
import type { ShellVizPreferences, ShellVizPresentation } from "@linxiraos/pi-wire";

export interface ShellViewSource {
	readonly sessionId: string;
	/** A persisted session whose transcript owns the recorded trace. */
	readonly sourceSessionId?: string;
	/** Agent Hub descendant of `sessionId` whose live/recorded trace is read. */
	readonly agentId?: string;
	readonly toolCallId: string;
}

export interface AgentSpawnOptions {
	/** Whether this Runtime has a native task-file mode; absent here is false, never a preview value. */
	fileEnabled: boolean;
	modelSelection: boolean;
	maxEffort: string;
	models: Array<{ selector: string; name: string; thinkingLevels: readonly string[] }>;
}

export type RuntimeViewOperation =
	| (ShellViewSource & { kind: "shell.view.read"; preferences?: ShellVizPreferences })
	| (ShellViewSource & { kind: "shell.view.release" })
	| { kind: "agent.spawn.options.read"; sessionId: string; definition: string };

export interface RuntimeViewResultMap {
	"shell.view.read": { available: boolean; presentation?: ShellVizPresentation; reason?: string };
	"shell.view.release": { released: true };
	"agent.spawn.options.read": AgentSpawnOptions;
}

export const RUNTIME_VIEW_KINDS = ["shell.view.read", "shell.view.release", "agent.spawn.options.read"] as const;

export function isRuntimeViewKind(kind: string): kind is RuntimeViewOperation["kind"] {
	return (RUNTIME_VIEW_KINDS as readonly string[]).includes(kind);
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Runtime view request");
	const row = value as Record<string, unknown>;
	if (Object.keys(row).some(key => !keys.includes(key))) throw new Error("Unknown Runtime view field");
	return row;
}

function identifier(value: unknown, max = 512): string {
	if (typeof value !== "string" || value.length === 0 || value.length > max || value.includes("\0"))
		throw new Error("Invalid Runtime view identifier");
	return value;
}

function optionalIdentifier(value: unknown, max = 512): string | undefined {
	return value === undefined ? undefined : identifier(value, max);
}

function bool(value: unknown): boolean {
	if (typeof value !== "boolean") throw new Error("Invalid Runtime view preference");
	return value;
}

function preferences(value: unknown): asserts value is ShellVizPreferences {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid shell visualization preferences");
	const row = value as Record<string, unknown>;
	const keys = ["view", "layers", "split", "cursor", "playing", "speed", "selectedNode", "expandedNodes"];
	if (Object.keys(row).some(key => !keys.includes(key))) throw new Error("Unknown shell visualization preference");
	if (row.view !== "raw" && row.view !== "pseudo") throw new Error("Invalid shell visualization mode");
	if (!row.layers || typeof row.layers !== "object" || Array.isArray(row.layers))
		throw new Error("Invalid shell visualization layers");
	const layers = row.layers as Record<string, unknown>;
	const layerKeys = ["color", "inline", "idioms", "effects", "unwrap"];
	if (Object.keys(layers).some(key => !layerKeys.includes(key))) throw new Error("Unknown shell visualization layer");
	for (const key of layerKeys) bool(layers[key]);
	bool(row.split);
	bool(row.playing);
	if (typeof row.speed !== "number" || !Number.isFinite(row.speed) || row.speed < 0.1 || row.speed > 16)
		throw new Error("Invalid shell visualization speed");
	if (row.cursor !== undefined && (!Number.isSafeInteger(row.cursor) || (row.cursor as number) < 0))
		throw new Error("Invalid shell visualization cursor");
	if (row.selectedNode !== undefined) identifier(row.selectedNode, 128);
	if (!Array.isArray(row.expandedNodes) || row.expandedNodes.length > 1000)
		throw new Error("Invalid shell visualization expansion");
	for (const node of row.expandedNodes) identifier(node, 128);
}

export function validateRuntimeViewOperation(value: unknown): asserts value is RuntimeViewOperation {
	const kind = (value as { kind?: unknown } | undefined)?.kind;
	if (kind === "agent.spawn.options.read") {
		const row = record(value, ["kind", "sessionId", "definition"]);
		identifier(row.sessionId);
		identifier(row.definition, 128);
		return;
	}
	if (kind !== "shell.view.read" && kind !== "shell.view.release") throw new Error("Unknown Runtime view operation");
	const row = record(value, [
		"kind",
		"sessionId",
		"sourceSessionId",
		"agentId",
		"toolCallId",
		...(kind === "shell.view.read" ? ["preferences"] : []),
	]);
	identifier(row.sessionId);
	optionalIdentifier(row.sourceSessionId);
	optionalIdentifier(row.agentId);
	identifier(row.toolCallId, 256);
	if (row.preferences !== undefined) {
		if (kind !== "shell.view.read") throw new Error("Release accepts no preferences");
		preferences(row.preferences);
	}
}

export function validateRuntimeViewResult(kind: RuntimeViewOperation["kind"], value: unknown): void {
	if (kind === "agent.spawn.options.read") {
		const row = record(value, ["fileEnabled", "modelSelection", "maxEffort", "models"]);
		bool(row.fileEnabled);
		bool(row.modelSelection);
		identifier(row.maxEffort, 64);
		if (!Array.isArray(row.models) || row.models.length > 1000) throw new Error("Invalid spawn model list");
		for (const item of row.models) {
			const model = record(item, ["selector", "name", "thinkingLevels"]);
			identifier(model.selector, 512);
			identifier(model.name, 512);
			if (!Array.isArray(model.thinkingLevels) || model.thinkingLevels.length > 32)
				throw new Error("Invalid spawn model efforts");
			for (const level of model.thinkingLevels) identifier(level, 64);
		}
		return;
	}
	if (kind === "shell.view.release") {
		const row = record(value, ["released"]);
		if (row.released !== true) throw new Error("Invalid Runtime view release");
		return;
	}
	const row = record(value, ["available", "presentation", "reason"]);
	const available = bool(row.available);
	if (row.reason !== undefined && (typeof row.reason !== "string" || row.reason.length > 4096))
		throw new Error("Invalid Runtime view reason");
	if (available && row.presentation === undefined) throw new Error("Available shell view requires a presentation");
	if (!available && row.presentation !== undefined) throw new Error("Unavailable shell view carries no presentation");
	if (row.presentation !== undefined) {
		if (!row.presentation || typeof row.presentation !== "object" || Array.isArray(row.presentation))
			throw new Error("Invalid shell presentation");
		const presentation = row.presentation as Record<string, unknown>;
		if (!Array.isArray(presentation.rows) || !Array.isArray(presentation.original))
			throw new Error("Invalid shell presentation rows");
		if (typeof presentation.executing !== "boolean") throw new Error("Invalid shell presentation state");
	}
}
