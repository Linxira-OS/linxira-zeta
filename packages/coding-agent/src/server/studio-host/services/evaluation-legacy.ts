import { randomUUID } from "node:crypto";
import { isRecord } from "@linxiraos/pi-utils";
import { ARTIFACT_TEXT_MAX_BYTES } from "../protocol/contracts/artifacts.js";
import type {
	EvaluationRecord,
	EvaluationResultRow,
	EvaluationSpec,
	EvaluationState,
} from "../protocol/contracts/evaluation-workspace.js";
import { EVALUATION_LIMITS, validateEvaluationSpec } from "./evaluation-limits.js";

/** Legacy report kinds still produced by the retired benchmark/judgment families. */
export type LegacyEvaluationKind = "benchmark" | "judgment";

/** One legacy report as exposed by a session-bound artifact source. */
export interface EvaluationLegacyArtifact {
	readonly artifactId: string;
	readonly kind: LegacyEvaluationKind;
	readonly name: string;
	readonly createdAt: string;
	/** Present when the source can prove ownership; must match the binding. */
	readonly sessionId?: string;
	/** Present when the source can prove ownership; must match the binding. */
	readonly workspaceId?: string;
	readonly runId?: string;
}

export interface EvaluationLegacyPage {
	readonly artifacts: readonly EvaluationLegacyArtifact[];
	readonly nextCursor?: string;
}

/**
 * Read-only view over the existing artifact library. The runtime binds this to
 * one live session and workspace; this service never resolves an artifact id
 * or a path on its own.
 */
export interface EvaluationLegacySource {
	list(input: { kind: LegacyEvaluationKind; limit: number; cursor?: string }): Promise<EvaluationLegacyPage>;
	readText(artifactId: string): Promise<{ text: string }>;
}

export interface EvaluationLegacyBinding {
	readonly sessionId: string;
	readonly workspaceId: string;
	readonly source: EvaluationLegacySource;
}

export interface LegacyJudgmentBatch {
	readonly intent?: string;
	readonly total: number;
	readonly done: number;
	readonly failed: number;
	readonly cost: number | null;
}

/** A validated legacy report ready to become, or merge into, one record. */
export interface LegacyEvaluationImport {
	readonly artifactId: string;
	readonly createdAt: string;
	readonly runId?: string;
	readonly record: EvaluationRecord;
	readonly rows: EvaluationResultRow[];
	readonly nativeText: string;
	readonly nativeBatch?: Record<string, unknown>;
	readonly nativeItems: readonly unknown[];
	readonly batch?: LegacyJudgmentBatch;
}

/** One page of `list`; the cursor only walks forward within one import. */
export const LEGACY_EVALUATION_PAGE = EVALUATION_LIMITS.page;
export const LEGACY_EVALUATION_MAX_PAGES = 512;

const EVALUATION_STATES: readonly EvaluationState[] = [
	"preparing",
	"ready",
	"running",
	"cancelling",
	"completed",
	"partial",
	"failed",
	"cancelled",
	"interrupted",
];
const TERMINAL_STATES: Record<string, true> = {
	completed: true,
	partial: true,
	failed: true,
	cancelled: true,
	interrupted: true,
};

function bounded(value: unknown, maximum: number): string | undefined {
	return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : undefined;
}

function count(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= EVALUATION_LIMITS.rows
		? value
		: undefined;
}

function importedState(value: unknown): EvaluationState | undefined {
	if (value === undefined) return "completed";
	if (typeof value !== "string" || !(EVALUATION_STATES as readonly string[]).includes(value)) return undefined;
	const state = value as EvaluationState;
	// An artifact has no native owner anymore; a non-terminal snapshot is view-only.
	return TERMINAL_STATES[state] === true ? state : "interrupted";
}

function bindArtifact(value: unknown, binding: EvaluationLegacyBinding): EvaluationLegacyArtifact | undefined {
	if (!isRecord(value)) return undefined;
	const artifactId = bounded(value.artifactId, 512);
	const name = bounded(value.name, 1024);
	const createdAt =
		typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)) ? value.createdAt : undefined;
	const kind = value.kind === "benchmark" || value.kind === "judgment" ? value.kind : undefined;
	const sessionId = value.sessionId === undefined ? undefined : bounded(value.sessionId, 1024);
	const workspaceId = value.workspaceId === undefined ? undefined : bounded(value.workspaceId, 1024);
	const runId = value.runId === undefined ? undefined : bounded(value.runId, 512);
	if (!artifactId || !name || !createdAt || !kind) return undefined;
	if (value.sessionId !== undefined && sessionId !== binding.sessionId) return undefined;
	if (value.workspaceId !== undefined && workspaceId !== binding.workspaceId) return undefined;
	if (value.runId !== undefined && !runId) return undefined;
	return {
		artifactId,
		kind,
		name,
		createdAt,
		...(sessionId === undefined ? {} : { sessionId }),
		...(workspaceId === undefined ? {} : { workspaceId }),
		...(runId === undefined ? {} : { runId }),
	};
}

function parseJudgmentBatch(value: Record<string, unknown>): LegacyJudgmentBatch | undefined {
	const total = count(value.total),
		done = count(value.done),
		failed = count(value.failed);
	if (total === undefined || done === undefined || failed === undefined || done > total || failed > done)
		return undefined;
	let cost: number | null;
	if (value.cost === undefined || value.cost === null) cost = null;
	else if (typeof value.cost === "number" && Number.isFinite(value.cost) && value.cost >= 0) cost = value.cost;
	else return undefined;
	const intent = typeof value.intent === "string" && value.intent.trim() ? value.intent.slice(0, 200) : undefined;
	return { ...(intent === undefined ? {} : { intent }), total, done, failed, cost };
}

function legacyItemKey(item: unknown): string | undefined {
	if (!isRecord(item)) return undefined;
	if (typeof item.key === "string" && item.key.length > 0 && item.key.length <= 1024) return item.key;
	if (typeof item.key === "number" && Number.isFinite(item.key)) return String(item.key);
	return undefined;
}

/**
 * Validate one saved benchmark/judgment report and prepare its history entry.
 * Returns `undefined` for malformed, oversized or foreign reports; the report
 * itself stays readable in the artifact library.
 */
export function readLegacyEvaluationReport(
	value: unknown,
	text: string,
	binding: EvaluationLegacyBinding,
): LegacyEvaluationImport | undefined {
	if (typeof binding.sessionId !== "string" || !binding.sessionId) return undefined;
	if (typeof binding.workspaceId !== "string" || !binding.workspaceId) return undefined;
	const artifact = bindArtifact(value, binding);
	if (!artifact) return undefined;
	if (typeof text !== "string" || Buffer.byteLength(text) > ARTIFACT_TEXT_MAX_BYTES) return undefined;

	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isRecord(data)) return undefined;

	const createdAt = new Date(artifact.createdAt).toISOString();
	const originalName = artifact.name;
	const base = {
		artifactId: artifact.artifactId,
		createdAt,
		...(artifact.runId === undefined ? {} : { runId: artifact.runId }),
		nativeText: text,
	};

	if (artifact.kind === "benchmark") {
		const run = isRecord(data.run) ? data.run : undefined;
		if (!run || !isRecord(run.spec)) return undefined;
		const candidate = { ...run.spec, kind: "benchmark" as const };
		let spec: EvaluationSpec;
		try {
			validateEvaluationSpec(candidate);
			spec = candidate;
		} catch {
			return undefined;
		}
		const state = importedState(run.state);
		if (state === undefined) return undefined;
		const models = data.models === undefined ? [] : data.models;
		if (!Array.isArray(models) || models.length > EVALUATION_LIMITS.rows) return undefined;
		const rows: EvaluationResultRow[] = models.map((model, index) => ({ key: String(index), data: model }));
		const record = legacyRecord({
			binding,
			createdAt,
			title: originalName,
			spec,
			state,
			completed: 0,
			total: 0,
			failed: 0,
			cost: null,
			replayable: true,
			detail: {
				legacy: true,
				originalName,
				...(artifact.runId === undefined ? {} : { nativeRunId: artifact.runId }),
			},
			artifactId: artifact.artifactId,
		});
		return { ...base, record, rows, nativeItems: models };
	}

	const rawBatch = isRecord(data.batch) ? data.batch : undefined;
	if (!rawBatch) return undefined;
	const batch = parseJudgmentBatch(rawBatch);
	if (!batch) return undefined;
	const offset = data.offset === undefined ? 0 : count(data.offset);
	if (offset === undefined || offset > EVALUATION_LIMITS.rows) return undefined;
	const items = data.items === undefined ? [] : data.items;
	if (!Array.isArray(items) || offset + items.length > EVALUATION_LIMITS.rows) return undefined;
	const spec: EvaluationSpec = { kind: "judgment", items: [], questions: {} };
	try {
		validateEvaluationSpec(spec);
	} catch {
		return undefined;
	}
	const rows: EvaluationResultRow[] = items.map((item, index) => ({ key: String(offset + index), data: item }));
	const batchId = bounded(rawBatch.id, 512);
	const runId = artifact.runId ?? batchId ?? bounded(data.runId, 512);
	const record = legacyRecord({
		binding,
		createdAt,
		title: (batch.intent ?? originalName).trim().slice(0, 200) || originalName,
		spec,
		state: "completed",
		completed: batch.done,
		total: batch.total,
		failed: batch.failed,
		cost: batch.cost,
		replayable: false,
		detail: {
			legacy: true,
			originalName,
			...(runId === undefined ? {} : { nativeRunId: runId }),
		},
		artifactId: artifact.artifactId,
	});
	return {
		...base,
		...(runId === undefined ? {} : { runId }),
		record,
		rows,
		nativeBatch: rawBatch,
		nativeItems: items,
		batch,
	};
}

function legacyRecord(input: {
	binding: EvaluationLegacyBinding;
	createdAt: string;
	title: string;
	spec: EvaluationSpec;
	state: EvaluationState;
	completed: number;
	total: number;
	failed: number;
	cost: number | null;
	replayable: boolean;
	detail: Record<string, unknown>;
	artifactId: string;
}): EvaluationRecord {
	return {
		id: randomUUID(),
		workspaceId: input.binding.workspaceId,
		title: input.title,
		spec: input.spec,
		sessionId: input.binding.sessionId,
		state: input.state,
		completed: input.completed,
		total: input.total,
		failed: input.failed,
		cost: input.cost,
		metrics: [],
		detail: input.detail,
		createdAt: input.createdAt,
		updatedAt: input.createdAt,
		revision: 0,
		replayable: input.replayable,
		legacyArtifactIds: [input.artifactId],
	};
}

/** Merge a later page of the same run without duplicating persisted rows. */
export function mergeLegacyRows(
	current: readonly EvaluationResultRow[],
	incoming: readonly EvaluationResultRow[],
): EvaluationResultRow[] {
	const rows = new Map<string, EvaluationResultRow>();
	for (const row of current) rows.set(row.key, row);
	for (const row of incoming) if (!rows.has(row.key)) rows.set(row.key, row);
	if (rows.size > EVALUATION_LIMITS.rows) throw new Error("Evaluation row limit exceeded");
	return [...rows.values()];
}

/**
 * Merge native items by their stable key, preserving unrelated report fields.
 * Older artifacts without item keys are appended once per distinct artifact.
 */
export function mergeLegacyNativeText(currentText: string, imported: LegacyEvaluationImport): string {
	const parsed: unknown = JSON.parse(currentText);
	if (!isRecord(parsed)) throw new Error("Imported evaluation report is not mergeable");
	const items = Array.isArray(parsed.items) ? [...parsed.items] : [];
	const keys = new Set<string>();
	for (const item of items) {
		const key = legacyItemKey(item);
		if (key !== undefined) keys.add(key);
	}
	for (const item of imported.nativeItems) {
		const key = legacyItemKey(item);
		if (key !== undefined && keys.has(key)) continue;
		if (key !== undefined) keys.add(key);
		items.push(item);
	}
	if (items.length > EVALUATION_LIMITS.rows) throw new Error("Evaluation row limit exceeded");
	const previousBatch = parsed.batch;
	const nextBatch = imported.nativeBatch ?? imported.batch;
	const batch =
		isRecord(previousBatch) &&
		isRecord(nextBatch) &&
		typeof previousBatch.done === "number" &&
		typeof nextBatch.done === "number" &&
		previousBatch.done > nextBatch.done
			? previousBatch
			: nextBatch;
	const next = JSON.stringify({ ...parsed, batch, items });
	if (Buffer.byteLength(next) > EVALUATION_LIMITS.reportBytes)
		throw new Error("Evaluation report exceeds storage limits");
	return next;
}

/** Record-side merge: union artifact ids and monotonic native counters. */
export function mergeLegacyEvaluationRecord(
	existing: EvaluationRecord,
	imported: LegacyEvaluationImport,
): EvaluationRecord {
	const artifactIds = [...(existing.legacyArtifactIds ?? [])];
	if (!artifactIds.includes(imported.artifactId)) artifactIds.push(imported.artifactId);
	const updatedAt =
		Date.parse(imported.createdAt) > Date.parse(existing.updatedAt) ? imported.createdAt : existing.updatedAt;
	const detail: Record<string, unknown> = { ...existing.detail, legacy: true };
	if (typeof detail.nativeRunId !== "string" && imported.runId !== undefined) detail.nativeRunId = imported.runId;
	if (typeof detail.originalName !== "string") detail.originalName = imported.record.detail.originalName;
	const cost =
		existing.cost === null
			? imported.record.cost
			: imported.record.cost === null
				? existing.cost
				: Math.max(existing.cost, imported.record.cost);
	return {
		...existing,
		completed: Math.max(existing.completed, imported.record.completed),
		total: Math.max(existing.total, imported.record.total),
		failed: Math.max(existing.failed, imported.record.failed),
		cost,
		updatedAt,
		detail,
		legacyArtifactIds: artifactIds,
	};
}
