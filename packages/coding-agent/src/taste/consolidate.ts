/**
 * Consolidation: turn queued candidates into the stored preference set.
 *
 * One pass per scope, under `withFileLock`, so two sessions on the same
 * repository never interleave. The pass is a pure function of the queue plus the
 * existing store, which is why a crash mid-apply only re-delivers candidates.
 *
 * Lifecycle (all four rules are testable in isolation):
 *
 * - **Inject** when `S_e` clears the floor and no conflict is unresolved.
 * - **Cold-store** otherwise: the line stays in `taste.md`, it just does not
 *   reach a prompt; the next observation of the same topic refreshes the decay
 *   clock and can revive it.
 * - **Protect** at `p ≥ 0.8` with `mentions ≥ 5`: age never deletes it again.
 * - **Delete** only for: a manual forget, a conflict that stayed unresolved for
 *   {@link CONFLICT_TTL_DAYS}, an idle unprotected entry older than
 *   {@link IDLE_TTL_DAYS} whose `p` has fallen below {@link IDLE_MAX_P}, or the
 *   per-category cap. Every deletion leaves a tombstone so the injected block can
 *   retract the line for {@link TOMBSTONE_RENDER_DAYS} — the answer to "the
 *   compacted history still quotes a preference we forgot".
 */
import { withFileLock } from "@linxiraos/pi-utils";

import type { ModelRegistry } from "../config/model-registry";
import type { Settings } from "../config/settings";
import { type TasteJudgment, scoreWithJudge } from "./judge";
import { tasteLockPath } from "./paths";
import { consumeTasteCandidates, listTasteCandidates, type QueuedTasteCandidate } from "./queue";
import { resolveTasteScopes, type TasteScopeContext, type TasteScopeKey } from "./scope";
import { betaPosterior, evidenceCounts, isProtected, repeatWeight, retentionScore } from "./score";
import {
	daysBetween,
	formatTasteFile,
	importCommandCodeTaste,
	readTasteScope,
	readTasteState,
	type TasteEntry,
	type TasteTombstone,
	today,
	topicKey,
	writeTasteScope,
} from "./store";

/** Per-category ceiling; the lowest-retention entries are evicted first. */
export const CATEGORY_CAP = 12;
/** An unresolved conflict deletes the weaker side after this long. */
export const CONFLICT_TTL_DAYS = 30;
/** Unprotected entries idle this long with a low posterior are removed. */
export const IDLE_TTL_DAYS = 365;
/** Posterior below which an idle entry is removable. */
export const IDLE_MAX_P = 0.5;

export interface TasteConsolidationOptions extends TasteScopeContext {
	agentDir: string;
	settings: Settings;
	modelRegistry: ModelRegistry;
	sessionId: string;
	/** Force a pass even when the queue is empty (the scheduler's interval path). */
	force?: boolean;
}

export interface TasteConsolidationResult {
	ran: boolean;
	reason?: "disabled" | "locked" | "empty" | "error";
	scope?: string;
	candidates?: number;
	entries?: number;
	removed?: number;
	error?: string;
}

/** Where new candidates go: the narrowest writable scope of this caller. */
export function tasteWriteScope(ctx: TasteScopeContext, settings: Settings): TasteScopeKey {
	return resolveTasteScopes(ctx, settings)[0] ?? { domain: "global", segments: [] };
}

/**
 * Run one consolidation pass. Never throws: a failure is reported, because the
 * caller is a background tick and a throw there would be invisible.
 */
export async function runTasteConsolidation(options: TasteConsolidationOptions): Promise<TasteConsolidationResult> {
	const key = tasteWriteScope(options, options.settings);
	let ran = false;
	try {
		const result = await withFileLock(
			tasteLockPath(options.agentDir, key),
			async () => {
				ran = true;
				return consolidateLocked(options, key);
			},
			{ retries: 1, retryDelayMs: 1 },
		);
		return result;
	} catch (error) {
		return {
			ran,
			reason: ran ? "error" : "locked",
			scope: key.domain,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function consolidateLocked(
	options: TasteConsolidationOptions,
	key: TasteScopeKey,
): Promise<TasteConsolidationResult> {
	const now = new Date();
	const stamp = today(now);
	const state = await readTasteState(options.agentDir, key);
	const imported = await importCommandCodeTaste(options.agentDir, key, options.cwd);
	const queued = await listTasteCandidates(options.agentDir, key);
	if (queued.length === 0 && !imported && !options.force) {
		return { ran: false, reason: "empty", scope: key.domain };
	}

	const existing = await readExisting(options.agentDir, key, imported);
	const byTopic = new Map(existing.map(entry => [entry.topicKey, entry]));
	const tombstones = [...state.tombstones];
	let removed = 0;

	// Group by topic so "repeat" counts distinct sessions, not files.
	const groups = new Map<string, QueuedTasteCandidate[]>();
	const processedSources = new Set(state.processedSources ?? []);
	for (const item of queued) {
		if (item.candidate.sourceId && processedSources.has(item.candidate.sourceId)) continue;
		const topic = topicKey(item.candidate.statement);
		const group = groups.get(topic);
		if (group) group.push(item);
		else groups.set(topic, [item]);
	}

	for (const [topic, items] of groups) {
		const first = items[0]!.candidate;
		if (items.some(item => item.candidate.polarity !== first.polarity)) {
			// One pass queued both sides of a topic: the later observation is the
			// current intent, and the conflict rule below records the disagreement.
			items.sort((a, b) => a.candidate.ts - b.candidate.ts);
		}
		const latest = items[items.length - 1]!.candidate;
		const sessions = new Set(items.map(item => item.candidate.sessionId));
		const prior = byTopic.get(topic);
		const judgment = await judgeOnce(latest.statement, latest.evidenceText, options);

		// Evidence: one `stated` per observation, then the repeat bonus for each
		// additional distinct session. `evidenceCounts` reads the tally back, so
		// the stored line and the Beta always agree.
		const tally = prior ? [...prior.evidence] : [];
		tallyFor(tally, "stated", 1);
		if (sessions.size > 1) tallyFor(tally, "repeat", sessions.size - 1);
		const repeats = repeatBonus(sessions.size);
		const positive = positiveWeight(tally) + repeats;
		const negative = negativeWeight(tally);
		const mentions = (prior?.mentions ?? 0) + 1;

		byTopic.set(topic, {
			topicKey: topic,
			category: judgment?.category ?? latest.category,
			statement: prior?.statement ?? latest.statement,
			polarity: judgment?.polarity ?? latest.polarity,
			confidence: betaPosterior(positive, negative, judgment?.posterior),
			mentions,
			lastConfirmed: stamp,
			lastUsed: stamp,
			evidence: tally,
			...(prior?.conflict && { conflict: prior.conflict }),
			...(prior?.conflictSince && { conflictSince: prior.conflictSince }),
		});
		for (const item of items) if (item.candidate.sourceId) processedSources.add(item.candidate.sourceId);
	}

	// Conflicts: same topic family, opposite polarity. Both sides stay stored
	// (the user may resolve them later) but neither is injectable.
	const entries = [...byTopic.values()];
	for (const entry of entries) {
		const rival = entries.find(other => other !== entry && detectRival(entry, other));
		if (!rival) {
			if (entry.conflict && !entries.some(other => other.topicKey === entry.conflict && other.conflict)) {
				delete entry.conflict;
				delete entry.conflictSince;
			}
			continue;
		}
		entry.conflict = rival.topicKey;
		entry.conflictSince ??= stamp;
	}

	// Protection, then deletion.
	for (const entry of entries) {
		if (isProtected(entry)) entry.protected = true;
	}

	const survivors: TasteEntry[] = [];
	for (const entry of entries) {
		const reason = deletionReason(entry, stamp, now);
		if (!reason) {
			survivors.push(entry);
			continue;
		}
		tombstones.push({ statement: entry.statement, retiredAt: stamp, reason, lastP: entry.confidence });
		removed += 1;
	}

	const capped = applyCategoryCap(survivors, now, tombstones);
	removed += survivors.length - capped.length;

	await writeTasteScope(options.agentDir, key, capped, {
		v: 1,
		entries: {},
		tombstones,
		lastConsolidatedAt: now.getTime(),
		processedSources: [...processedSources],
	});
	await consumeTasteCandidates(queued.map(item => item.file));
	return { ran: true, scope: key.domain, candidates: queued.length, entries: capped.length, removed };
}

/** Current entries: the imported foreign store on first read, otherwise the stored set. */
async function readExisting(agentDir: string, key: TasteScopeKey, imported: TasteEntry[] | undefined) {
	if (imported) return imported;
	return (await readTasteScope(agentDir, key)).entries;
}

async function judgeOnce(
	statement: string,
	evidenceText: string,
	options: TasteConsolidationOptions,
): Promise<TasteJudgment | undefined> {
	try {
		return await scoreWithJudge({ statement, evidence: evidenceText }, options);
	} catch {
		return undefined;
	}
}

/** Bump a tally entry (`stated×2`). A zero count is a no-op. */
function tallyFor(tally: string[], kind: string, increment: number): void {
	if (increment <= 0) return;
	const index = tally.findIndex(item => item.startsWith(`${kind}×`));
	if (index === -1) {
		tally.push(`${kind}×${increment}`);
		return;
	}
	const current = Number.parseInt(tally[index]!.split("×")[1] ?? "0", 10) || 0;
	tally[index] = `${kind}×${current + increment}`;
}

/** `Σ_{n=2..sessions} repeatWeight(n)`: what extra distinct sessions are worth. */
function repeatBonus(sessions: number): number {
	let bonus = 0;
	for (let n = 2; n <= sessions; n++) bonus += repeatWeight(n);
	return bonus;
}

function positiveWeight(tally: readonly string[]): number {
	return evidenceCounts({ evidence: [...tally] }).positive;
}

function negativeWeight(tally: readonly string[]): number {
	return evidenceCounts({ evidence: [...tally] }).negative;
}

function detectRival(a: TasteEntry, b: TasteEntry): boolean {
	if (a.polarity === b.polarity) return false;
	const strip = (statement: string) => statement.replace(/^(?:prefers?|avoids?|likes?)\s+/i, "").toLowerCase();
	return strip(a.statement) === strip(b.statement);
}

/** Which deletion rule (if any) applies to an entry. `undefined` = keep. */
function deletionReason(entry: TasteEntry, stamp: string, now: Date): string | undefined {
	if (entry.protected) return undefined;
	if (entry.conflict && entry.conflictSince && daysBetween(entry.conflictSince, stamp) >= CONFLICT_TTL_DAYS) {
		return "conflict";
	}
	// Idle means "the retained belief has faded", not "the posterior is low": an
	// entry nobody contradicts keeps its posterior forever, so only the
	// time-decayed retention can tell a live preference from a dormant one.
	if (daysBetween(entry.lastUsed, stamp) > IDLE_TTL_DAYS && retentionScore(entry, now) < IDLE_MAX_P) {
		return "idle";
	}
	return undefined;
}

/** Keep the {@link CATEGORY_CAP} best-retained entries per category. */
function applyCategoryCap(entries: TasteEntry[], now: Date, tombstones: TasteTombstone[]): TasteEntry[] {
	const byCategory = new Map<string, TasteEntry[]>();
	for (const entry of entries) {
		const bucket = byCategory.get(entry.category);
		if (bucket) bucket.push(entry);
		else byCategory.set(entry.category, [entry]);
	}
	const kept = new Set<TasteEntry>();
	for (const bucket of byCategory.values()) {
		if (bucket.length <= CATEGORY_CAP) {
			for (const entry of bucket) kept.add(entry);
			continue;
		}
		const ranked = [...bucket].sort((a, b) => retentionScore(b, now) - retentionScore(a, now));
		for (const entry of ranked.slice(0, CATEGORY_CAP)) {
			kept.add(entry);
		}
		for (const entry of ranked.slice(CATEGORY_CAP)) {
			tombstones.push({ statement: entry.statement, retiredAt: today(now), reason: "cap", lastP: entry.confidence });
		}
	}
	return entries.filter(entry => kept.has(entry));
}

/** Re-exported for callers that only need the visible render of a set. */
export { formatTasteFile };
