/**
 * Deterministic compaction-fidelity extraction.
 *
 * A compaction summary is model-written prose; exact identifiers the next turn
 * needs (paths, IDs, constraints, unfinished work, question/answer pairs) survive
 * it only by luck. This module extracts those facts from the summarized range
 * with no model call, renders a bounded ledger for the summarizer's side request,
 * and returns the same facts as a structured artifact persisted on the compaction
 * entry (`preserveData["zeta.compactionFidelity"]`).
 *
 * Invariants:
 * - pure: no I/O, no session access, no randomness beyond the injected clock;
 * - bounded: every bucket has a hard cap, so a huge transcript cannot inflate the
 *   summarizer request or the durable entry;
 * - honest: an empty bucket stays empty and is rendered as empty — no silent
 *   fallback may pretend the facts were retained;
 * - tracking references exist only when the caller passes them, i.e. only when
 *   `tracking.enabled` is true. When absent, nothing about user files is emitted.
 */

import type { AgentMessage } from "@linxiraos/pi-agent-core";

/** preserveData key holding the structured artifact. */
export const COMPACTION_FIDELITY_PRESERVE_KEY = "zeta.compactionFidelity";

export interface FidelityQaPair {
	question: string;
	answer?: string;
	/** Message timestamps, the only stable identity carried by summarize-range messages. */
	askedAt?: number;
	answeredAt?: number;
}

export interface FidelityTracking {
	/** `<workspace>/.zeta/tracking` — emitted only when tracking is enabled. */
	dir: string;
	index: string;
	status: string;
	summaries: string;
	sessionId?: string;
}

export interface CompactionFidelity {
	version: 1;
	generatedAt: string;
	qa: FidelityQaPair[];
	paths: string[];
	ids: string[];
	constraints: string[];
	unfinished: string[];
	tracking?: FidelityTracking;
}

export interface CompactionFidelityInput {
	/** Messages the summarizer consumes (summarize range + turn prefix). */
	messages: readonly AgentMessage[];
	/** Injected clock for tests; defaults to `Date.now`. */
	now?: () => number;
	/** Present only when project tracking is enabled for this session. */
	tracking?: FidelityTracking;
}

const MAX_QA = 8;
const MAX_PATHS = 24;
const MAX_IDS = 24;
const MAX_CONSTRAINTS = 12;
const MAX_UNFINISHED = 12;
const MAX_QA_QUESTION_CHARS = 280;
const MAX_QA_ANSWER_CHARS = 280;
const MAX_LINE_CHARS = 240;
/** Deterministic per-message scan bound: one huge message cannot turn extraction into a whole-history scan. */
const MAX_SCAN_CHARS = 20_000;

const CONSTRAINT_PATTERN =
	/\b(MUST|NEVER|REQUIRED|SHOULD|MAY NOT|ONLY|ALWAYS|DO NOT|DON'T)\b|必须|禁止|不许|不得|只能|务必|不要|绝不/u;
const UNFINISHED_PATTERN =
	/\b(TODO|FIXME|TBD|WIP|remaining|unfinished|follow[- ]?up|next steps?)\b|待办|未完成|尚未|下一步|剩余|未处理/iu;
const UNCHECKED_TASK_PATTERN = /^\s*[-*]\s*\[ \]\s+/;
/** Absolute (drive/root/relative-dot) paths, plus repo-relative paths that carry an extension. */
const PATH_PATTERN =
	/(?:[A-Za-z]:[\\/]|\/|\.{1,2}[\\/])[\w.@+~-]+(?:[\\/][\w.@+~-]+)+|\b[\w.@+~-]+(?:[\\/][\w.@+~-]+)+\.[A-Za-z0-9]{1,10}\b/gu;
const ID_PATTERNS: readonly RegExp[] = [
	/\bREQ-\d+\b/gu,
	/\b[A-Z][A-Z0-9]{1,9}-\d{2,6}\b/gu,
	/(?<![\w&])#\d{2,6}\b/gu,
	/\bv\d+\.\d+\.\d+(?:[-+][\w.]+)?\b/gu,
	/\b[0-9a-f]{7,40}\b/gu,
];
/** Keys whose string value is an exact path in common tool argument shapes. */
const PATH_ARG_KEYS = ["path", "file_path", "filePath", "directory", "cwd", "target", "source", "destination"];
/** A user message made only of ≤2-char tokens ("hi", "ok") carries no durable ask. */
const RETAINABLE_USER_TEXT_PATTERN = /\S{3}/u;

interface TextBlock {
	readonly type: string;
	readonly text?: unknown;
}

function isTextBlock(block: unknown): block is TextBlock {
	return typeof block === "object" && block !== null && "type" in block && block.type === "text";
}

interface ToolCallBlock {
	readonly type: string;
	readonly arguments?: unknown;
}

function isToolCallBlock(block: unknown): block is ToolCallBlock {
	return typeof block === "object" && block !== null && "type" in block && block.type === "toolCall";
}

function textOf(message: AgentMessage): string | undefined {
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return undefined;
	const parts: string[] = [];
	for (const block of message.content) {
		if (isTextBlock(block) && typeof block.text === "string") parts.push(block.text);
	}
	if (parts.length === 0) return undefined;
	const joined = parts.join("\n");
	return joined.length > MAX_SCAN_CHARS ? joined.slice(0, MAX_SCAN_CHARS) : joined;
}

function clip(text: string, max: number): string {
	const collapsed = text.replace(/\s+/gu, " ").trim();
	return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function pushBounded(target: string[], value: string, max: number): void {
	const candidate = value.trim();
	if (candidate.length === 0 || target.includes(candidate) || target.length >= max) return;
	target.push(candidate);
}

function collectPaths(value: unknown, out: string[]): void {
	if (typeof value === "string") {
		for (const match of value.matchAll(PATH_PATTERN)) pushBounded(out, match[0], MAX_PATHS);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectPaths(item, out);
		return;
	}
	if (!value || typeof value !== "object") return;
	for (const [key, nested] of Object.entries(value)) {
		if (PATH_ARG_KEYS.includes(key) && typeof nested === "string") pushBounded(out, nested, MAX_PATHS);
		else collectPaths(nested, out);
	}
}

function collectIds(text: string, out: string[]): void {
	for (const pattern of ID_PATTERNS) {
		for (const match of text.matchAll(pattern)) pushBounded(out, match[0], MAX_IDS);
	}
}

function collectLines(text: string, pattern: RegExp, out: string[], max: number): void {
	for (const rawLine of text.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (line.length === 0 || !pattern.test(line)) continue;
		pushBounded(out, clip(line.replace(/^[-*]\s*/u, ""), MAX_LINE_CHARS), max);
	}
}

/**
 * Extract the durable facts from the exact messages a compaction is about to
 * discard. Deterministic and bounded; returns empty buckets when nothing matches.
 */
export function extractCompactionFidelity(input: CompactionFidelityInput): CompactionFidelity {
	const now = input.now ?? Date.now;
	const qa: FidelityQaPair[] = [];
	const paths: string[] = [];
	const ids: string[] = [];
	const constraints: string[] = [];
	const unfinished: string[] = [];
	const collectTextFacts = (text: string): void => {
		collectPaths(text, paths);
		collectIds(text, ids);
		collectLines(text, CONSTRAINT_PATTERN, constraints, MAX_CONSTRAINTS);
		collectLines(text, UNFINISHED_PATTERN, unfinished, MAX_UNFINISHED);
	};

	let pendingQuestion: FidelityQaPair | undefined;
	for (const message of input.messages) {
		const text = textOf(message);
		if (message.role === "user") {
			// Synthetic/steering messages are harness noise, not user asks.
			if (message.synthetic === true || message.steering === true) continue;
			if (!text) continue;
			// A new ask closes the previous one, even when the new message is small talk.
			if (pendingQuestion && pendingQuestion.answer === undefined) {
				qa.push(pendingQuestion);
				pendingQuestion = undefined;
			}
			// Durable facts live in every message, including the user's own words.
			collectTextFacts(text);
			if (!RETAINABLE_USER_TEXT_PATTERN.test(text)) continue;
			pendingQuestion = { question: clip(text, MAX_QA_QUESTION_CHARS), askedAt: message.timestamp };
			if (qa.length >= MAX_QA) pendingQuestion = undefined;
			continue;
		}
		if (message.role === "assistant") {
			if (pendingQuestion && pendingQuestion.answer === undefined && text) {
				pendingQuestion.answer = clip(text, MAX_QA_ANSWER_CHARS);
				pendingQuestion.answeredAt = message.timestamp;
				qa.push(pendingQuestion);
				pendingQuestion = undefined;
			}
			if (text) collectTextFacts(text);
			for (const block of Array.isArray(message.content) ? message.content : []) {
				if (isToolCallBlock(block)) collectPaths(block.arguments, paths);
			}
			continue;
		}
		if (message.role === "toolResult") {
			if (text) collectTextFacts(text);
			// A result whose tool name says it wrote a file keeps that exact path.
			if ("details" in message && message.details) collectPaths(message.details, paths);
			continue;
		}
		if (text) collectTextFacts(text);
	}
	if (pendingQuestion && pendingQuestion.answer === undefined) qa.push(pendingQuestion);

	// Unchecked task rows are the clearest "not finished" signal; collect them last
	// so explicit TODO lines keep their order ahead of them.
	for (const message of input.messages) {
		const text = textOf(message);
		if (!text) continue;
		collectLines(text, UNCHECKED_TASK_PATTERN, unfinished, MAX_UNFINISHED);
	}

	return {
		version: 1,
		generatedAt: new Date(now()).toISOString(),
		qa: qa.slice(0, MAX_QA),
		paths,
		ids,
		constraints,
		unfinished,
		...(input.tracking ? { tracking: input.tracking } : {}),
	};
}

/** Whether the artifact carries at least one retained fact. */
export function hasFidelityFacts(fidelity: CompactionFidelity): boolean {
	return (
		fidelity.qa.length > 0 ||
		fidelity.paths.length > 0 ||
		fidelity.ids.length > 0 ||
		fidelity.constraints.length > 0 ||
		fidelity.unfinished.length > 0 ||
		fidelity.tracking !== undefined
	);
}

export interface RenderFidelityOptions {
	/** Static prompt section that explains how the summarizer must use the ledger. */
	instructions: string;
}

/**
 * Render the bounded ledger appended to the summarizer's side request. Sections
 * with no facts are rendered as `(none)` so the summarizer cannot mistake an
 * empty extraction for a successful retention.
 */
export function renderFidelityLedger(fidelity: CompactionFidelity, options: RenderFidelityOptions): string {
	const list = (values: readonly string[]): string => (values.length > 0 ? values.map(v => `- ${v}`).join("\n") : "- (none)");
	const qa =
		fidelity.qa.length > 0
			? fidelity.qa
					.map((pair, index) => {
						const answer = pair.answer ? `  A: ${pair.answer}` : "  A: (unanswered)";
						return `Q${index + 1}: ${pair.question}\n${answer}`;
					})
					.join("\n")
			: "(none)";
	const tracking = fidelity.tracking
		? [
				`- tracking dir: ${fidelity.tracking.dir}`,
				`- index: ${fidelity.tracking.index}`,
				`- status: ${fidelity.tracking.status}`,
				`- summaries: ${fidelity.tracking.summaries}`,
				...(fidelity.tracking.sessionId ? [`- session: ${fidelity.tracking.sessionId}`] : []),
			].join("\n")
		: "(tracking disabled)";

	return [
		options.instructions.trim(),
		"",
		"## Retained QA",
		qa,
		"",
		"## Retained paths",
		list(fidelity.paths),
		"",
		"## Retained identifiers",
		list(fidelity.ids),
		"",
		"## Retained constraints",
		list(fidelity.constraints),
		"",
		"## Retained unfinished work",
		list(fidelity.unfinished),
		"",
		"## Tracking references",
		tracking,
	].join("\n");
}

/** Merge the artifact into a compaction entry's preserveData without clobbering other keys. */
export function withCompactionFidelity(
	preserveData: Record<string, unknown> | undefined,
	fidelity: CompactionFidelity,
): Record<string, unknown> {
	return { ...(preserveData ?? {}), [COMPACTION_FIDELITY_PRESERVE_KEY]: fidelity };
}

/** Validated boundary for a persisted artifact: shape checks decide, then the value is trusted. */
function isCompactionFidelity(value: unknown): value is CompactionFidelity {
	if (!value || typeof value !== "object") return false;
	if (!("version" in value) || value.version !== 1) return false;
	for (const bucket of ["qa", "paths", "ids", "constraints", "unfinished"] as const) {
		if (!(bucket in value) || !Array.isArray(value[bucket])) return false;
	}
	return "generatedAt" in value && typeof value.generatedAt === "string";
}

/** Read the artifact previously stored on an entry's preserveData. */
export function readCompactionFidelity(preserveData: Record<string, unknown> | undefined): CompactionFidelity | undefined {
	const value = preserveData?.[COMPACTION_FIDELITY_PRESERVE_KEY];
	return isCompactionFidelity(value) ? value : undefined;
}

/** Counts surfaced on phase events and commit notifications. */
export function fidelityCounts(
	fidelity: CompactionFidelity | undefined,
): { qa: number; paths: number; ids: number; constraints: number; unfinished: number } | undefined {
	if (!fidelity) return undefined;
	return {
		qa: fidelity.qa.length,
		paths: fidelity.paths.length,
		ids: fidelity.ids.length,
		constraints: fidelity.constraints.length,
		unfinished: fidelity.unfinished.length,
	};
}
