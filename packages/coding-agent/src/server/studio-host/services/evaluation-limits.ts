import { isRecord } from "@linxiraos/pi-utils";
import { invalid } from "../errors.js";
import type { EvaluationSpec } from "../protocol/contracts/evaluation-workspace.js";

export const EVALUATION_LIMITS = {
	records: 512,
	active: 8,
	models: 64,
	rows: 20_000,
	page: 200,
	pageBytes: 512_000,
	inputBytes: 2 * 1024 * 1024,
	recordBytes: 4 * 1024 * 1024,
	reportBytes: 64 * 1024 * 1024,
	exports: 64,
	chunkBytes: 48 * 1024,
} as const;

export function evaluationOffset(value: unknown, fallback = 0): number {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw invalid("offset must be a non-negative integer");
	return value;
}
export function evaluationPageLimit(value: unknown): number {
	const limit = evaluationOffset(value, 50);
	if (limit < 1 || limit > EVALUATION_LIMITS.page) throw invalid("limit must be between 1 and 200");
	return limit;
}
function count(value: unknown, maximum: number): void {
	if (
		value !== undefined &&
		(typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum)
	)
		throw invalid(`evaluation count must be between 1 and ${maximum}`);
}
function strings(value: unknown, maximum: number, required = true): asserts value is string[] {
	if (
		!Array.isArray(value) ||
		(required && !value.length) ||
		value.length > maximum ||
		value.some(item => typeof item !== "string" || !item.trim())
	)
		throw invalid("invalid evaluation string list");
}
/** Bound work before native planning; native parsers remain the semantic authority. */
export function validateEvaluationSpec(value: unknown): asserts value is EvaluationSpec {
	if (!isRecord(value) || !["benchmark", "instruction", "judgment", "ratchet"].includes(String(value.kind)))
		throw invalid("unknown evaluation kind");
	if (Buffer.byteLength(JSON.stringify(value)) > EVALUATION_LIMITS.inputBytes)
		throw invalid("evaluation input exceeds 2 MiB");
	if (value.kind === "benchmark" || value.kind === "instruction") {
		strings(value.models, EVALUATION_LIMITS.models);
		count(value.concurrency, 32);
		count(value.maxTokens, 1_000_000);
		if (value.kind === "benchmark") {
			if (!["chat", "prefill", "generation", "mix", "cache", "detailed"].includes(String(value.profile)))
				throw invalid("unknown benchmark profile");
			count(value.runs, 100);
			count(value.prefillBytes, 1024 * 1024);
			count(value.cachePrefixBytes, 1024 * 1024);
		} else {
			count(value.turns, 100);
			count(value.length, 4096);
			count(value.nyaMax, 1000);
		}
	} else if (value.kind === "judgment") {
		if (!Array.isArray(value.items) || value.items.length > EVALUATION_LIMITS.rows || !isRecord(value.questions))
			throw invalid("invalid judgment inputs");
		for (const item of value.items) {
			if (!isRecord(item) || (typeof item.key !== "string" && typeof item.key !== "number"))
				throw invalid("invalid judgment item");
			if (item.images !== undefined) strings(item.images, 32, false);
		}
		if (Object.keys(value.questions).length > 64) throw invalid("too many judgment questions");
		count(value.concurrency, 32);
		count(value.minOk, Math.max(1, value.items.length));
		if (
			value.retries !== undefined &&
			(typeof value.retries !== "number" ||
				!Number.isSafeInteger(value.retries) ||
				value.retries < 0 ||
				value.retries > 10)
		)
			throw invalid("retries must be between 0 and 10");
	} else {
		for (const key of ["cases", "harness", "change", "offLimits"]) strings(value[key], 512, false);
		if (!isRecord(value.cohorts) || typeof value.flow !== "string" || typeof value.objective !== "string")
			throw invalid("invalid Ratchet configuration");
		count(value.roundsLimit, 1000);
		count(value.reps, 100);
		count(value.plateau, 1000);
		if (
			value.costLimit !== undefined &&
			(typeof value.costLimit !== "number" || !Number.isFinite(value.costLimit) || value.costLimit <= 0)
		)
			throw invalid("costLimit must be positive");
	}
}
