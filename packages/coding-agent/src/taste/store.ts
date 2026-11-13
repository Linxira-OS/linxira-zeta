/**
 * Taste store: the visible markdown file, the machine state beside it, and the
 * single-writer rules that keep the two in agreement.
 *
 * The visible format is deliberately identical to Command Code's own store
 * (`.commandcode/taste/taste.md`), so either tool can read what the other wrote:
 *
 *     # Taste
 *
 *     - Prefers an in-process kernel boundary over an ACP process hop. Confidence: 0.62
 *
 * Everything the format cannot express — category, polarity, evidence counts,
 * timestamps, conflicts, protection, tombstones — lives in `state.json` next to
 * it, keyed by {@link topicKey} of the statement. Reading a file without state
 * (Command Code's, or a hand-written one) is valid: confidence is the
 * probability, evidence is empty, category is `other`, polarity is `prefer`.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent, logger } from "@linxiraos/pi-utils";

import { commandCodeTasteFile, tasteFilePath, tasteStatePath } from "./paths";
import type { TasteScopeKey } from "./scope";

/** Buckets a preference can fall into. `other` is the fallback for foreign files. */
export const TASTE_CATEGORIES = ["cli", "typescript", "architecture", "style", "workflow", "other"] as const;
export type TasteCategory = (typeof TASTE_CATEGORIES)[number];

/** Whether the statement asks for something (`prefer`) or against it (`avoid`). */
export type TastePolarity = "prefer" | "avoid";

/** One preference, as the rest of the layer sees it (visible file + machine state merged). */
export interface TasteEntry {
	/** Stable hash of {@link statement}; the key of the machine state. */
	topicKey: string;
	category: TasteCategory;
	statement: string;
	polarity: TastePolarity;
	/** Beta posterior mean; the host computes it, a model never supplies it. */
	confidence: number;
	/** How many independent observations (stated/repeat/applied) corroborated it. */
	mentions: number;
	/** `YYYY-MM-DD` of the last confirming observation. */
	lastConfirmed: string;
	/** `YYYY-MM-DD` of the last time it was used or corroborated; the decay clock. */
	lastUsed: string;
	/** Human-readable evidence tally, e.g. `["stated×2", "applied_ok×3"]`. */
	evidence: string[];
	/** `topicKey` of an unresolved conflicting entry, when one exists. */
	conflict?: string;
	/** `YYYY-MM-DD` the conflict was first observed; ages the conflict-deletion rule. */
	conflictSince?: string;
	/** Set when the entry is old and strong enough that age no longer deletes it. */
	protected?: true;
}

/** Retired entry kept for the retraction block; never injected as a preference. */
export interface TasteTombstone {
	statement: string;
	/** `YYYY-MM-DD` the entry was removed. */
	retiredAt: string;
	/** Why it went (`manual`, `conflict`, `idle`, `cap`). */
	reason: string;
	/** Its `p` at deletion, for the record. */
	lastP: number;
}

/** Persisted machine state; `v` bumps only on an incompatible change. */
export interface TasteState {
	v: 1;
	entries: Record<string, PersistedEntry>;
	tombstones: TasteTombstone[];
	/** Epoch millis of the last consolidation, for the scheduler's interval. */
	lastConsolidatedAt: number;
	/** Durable window observations already counted, including retired topics. */
	processedSources?: string[];
}

/** One entry as stored: everything {@link TasteEntry} carries except the key and statement. */
export interface PersistedEntry {
	category: TasteCategory;
	statement: string;
	polarity: TastePolarity;
	confidence: number;
	mentions: number;
	lastConfirmed: string;
	lastUsed: string;
	evidence: string[];
	conflict?: string;
	conflictSince?: string;
	protected?: true;
}

/** A visible file's bullet, before machine state is merged in. */
export interface TasteBullet {
	statement: string;
	confidence: number;
}

/** Tombstones older than this stop rendering in the retraction block. */
export const TOMBSTONE_RENDER_DAYS = 30;

/** Retained tombstones; the oldest are dropped first. */
export const TOMBSTONE_LIMIT = 200;

const HEADING = "# Taste";

/** `- <statement>. Confidence: <0..1>` */
const BULLET_RE = /^\s*[-*]\s+(.+?)\.\s*Confidence:\s*([01](?:\.\d+)?)\s*$/i;

/**
 * Stable topic identity for a statement: lowercased, whitespace-collapsed,
 * trailing punctuation dropped. Two sentences that say the same thing map to one
 * topic, which is what makes "repeat" and "contradiction" detectable at all.
 */
export function topicKey(statement: string): string {
	const normalized = statement
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/[.!?,;:\u3002\uff01\uff1f\uff0c\uff1b\uff1a]+$/g, "");
	return Bun.hash(normalized).toString(36);
}

/** Parse the visible file. Only the documented bullet shape counts; everything else is prose. */
export function parseTasteFile(text: string): TasteBullet[] {
	const bullets: TasteBullet[] = [];
	for (const line of text.split(/\r?\n/)) {
		const match = BULLET_RE.exec(line);
		if (!match) continue;
		const statement = match[1]?.trim();
		const confidence = Number.parseFloat(match[2] ?? "");
		if (!statement || !Number.isFinite(confidence)) continue;
		bullets.push({ statement, confidence: clamp01(confidence) });
	}
	return bullets;
}

/** Render the visible file. Symmetric with {@link parseTasteFile}. */
export function formatTasteFile(bullets: readonly TasteBullet[]): string {
	return `${HEADING}\n\n${bullets.map(bullet => `- ${bullet.statement}. Confidence: ${trim(bullet.confidence)}`).join("\n")}\n`;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/** Two decimals is the resolution the format can carry; the state keeps the real number. */
function trim(value: number): string {
	return String(Math.round(clamp01(value) * 100) / 100);
}

/** Empty state, used for a missing or unreadable `state.json`. */
export function emptyTasteState(): TasteState {
	return { v: 1, entries: {}, tombstones: [], lastConsolidatedAt: 0 };
}

/** Read one scope's state. A corrupt file is backed up and treated as empty. */
export async function readTasteState(agentDir: string, key: TasteScopeKey): Promise<TasteState> {
	const file = tasteStatePath(agentDir, key);
	let text: string;
	try {
		text = await Bun.file(file).text();
	} catch (error) {
		if (isEnoent(error)) return emptyTasteState();
		logger.debug("taste: unreadable state.json", { file, error: String(error) });
		return emptyTasteState();
	}
	try {
		const parsed = JSON.parse(text) as Partial<TasteState>;
		if (!parsed || typeof parsed !== "object" || parsed.v !== 1 || typeof parsed.entries !== "object") {
			throw new Error("unexpected shape");
		}
		return {
			v: 1,
			entries: parsed.entries ?? {},
			tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
			lastConsolidatedAt: typeof parsed.lastConsolidatedAt === "number" ? parsed.lastConsolidatedAt : 0,
			processedSources: Array.isArray(parsed.processedSources) ? parsed.processedSources : [],
		};
	} catch (error) {
		// A hand-edited or truncated state must not block a session: keep a copy
		// for inspection and continue from empty (the visible file still loads).
		const backup = `${file}.bak-${Date.now()}`;
		await fs.rename(file, backup).catch(() => {});
		logger.debug("taste: corrupt state.json backed up", { file, backup, error: String(error) });
		return emptyTasteState();
	}
}

/** The entries a scope currently holds: visible bullets merged with machine state. */
export interface TasteScopeSnapshot {
	key: TasteScopeKey;
	path: string;
	entries: TasteEntry[];
	tombstones: TasteTombstone[];
}

/**
 * Read one scope. Missing `taste.md` yields no entries; bullets without state
 * (Command Code's file, or a hand-written one) become `other`/`prefer` entries
 * with empty evidence, exactly as the format implies.
 */
export async function readTasteScope(agentDir: string, key: TasteScopeKey): Promise<TasteScopeSnapshot> {
	const file = tasteFilePath(agentDir, key);
	const [text, state] = await Promise.all([
		Bun.file(file)
			.text()
			.catch(() => ""),
		readTasteState(agentDir, key),
	]);
	const entries: TasteEntry[] = parseTasteFile(text).map(bullet => {
		const topic = topicKey(bullet.statement);
		const stored = state.entries[topic];
		return {
			topicKey: topic,
			category: stored?.category ?? "other",
			statement: bullet.statement,
			polarity: stored?.polarity ?? "prefer",
			confidence: stored?.confidence ?? bullet.confidence,
			mentions: stored?.mentions ?? 0,
			lastConfirmed: stored?.lastConfirmed ?? today(),
			lastUsed: stored?.lastUsed ?? stored?.lastConfirmed ?? today(),
			evidence: stored?.evidence ?? [],
			...(stored?.conflict && { conflict: stored.conflict }),
			...(stored?.conflictSince && { conflictSince: stored.conflictSince }),
			...(stored?.protected && { protected: true as const }),
		};
	});
	// Persisted entries the visible file no longer carries are dropped: the
	// markdown is the record, `state.json` only annotates it.
	return { key, path: file, entries, tombstones: state.tombstones };
}

/** Today as `YYYY-MM-DD` in local time. */
export function today(now: Date = new Date()): string {
	const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 10);
}

/** Days between two `YYYY-MM-DD` dates (b − a). */
export function daysBetween(a: string, b: string): number {
	const parse = (value: string): number => {
		const time = Date.parse(`${value}T00:00:00Z`);
		return Number.isFinite(time) ? time : Date.parse(`${today()}T00:00:00Z`);
	};
	return Math.round((parse(b) - parse(a)) / 86_400_000);
}

/** Write a scope atomically: `taste.md` and `state.json` are replaced together. */
export async function writeTasteScope(
	agentDir: string,
	key: TasteScopeKey,
	entries: readonly TasteEntry[],
	state: TasteState,
): Promise<void> {
	const file = tasteFilePath(agentDir, key);
	await fs.mkdir(path.dirname(file), { recursive: true });
	const persistedEntries: Record<string, PersistedEntry> = {};
	for (const entry of entries) {
		persistedEntries[entry.topicKey] = {
			category: entry.category,
			statement: entry.statement,
			polarity: entry.polarity,
			confidence: entry.confidence,
			mentions: entry.mentions,
			lastConfirmed: entry.lastConfirmed,
			lastUsed: entry.lastUsed,
			evidence: entry.evidence,
			...(entry.conflict && { conflict: entry.conflict }),
			...(entry.conflictSince && { conflictSince: entry.conflictSince }),
			...(entry.protected && { protected: true as const }),
		};
	}
	const nextState: TasteState = {
		v: 1,
		entries: persistedEntries,
		tombstones: state.tombstones.slice(-TOMBSTONE_LIMIT),
		lastConsolidatedAt: state.lastConsolidatedAt,
		processedSources: state.processedSources ?? [],
	};
	const markdown = formatTasteFile(
		entries.map(entry => ({ statement: entry.statement, confidence: entry.confidence })),
	);
	await Promise.all([
		atomicWrite(file, markdown),
		atomicWrite(tasteStatePath(agentDir, key), `${JSON.stringify(nextState, null, "\t")}\n`),
	]);
}

/** `write` + rename, so a reader never sees a half-written file. */
async function atomicWrite(file: string, content: string): Promise<void> {
	const temp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
	await Bun.write(temp, content);
	try {
		await fs.rename(temp, file);
	} catch (error) {
		await fs.rm(temp, { force: true }).catch(() => {});
		throw error;
	}
}

/**
 * First read of a project store: when Zeta has no file yet but Command Code wrote
 * one for this repository, import its bullets. The foreign file is left exactly
 * as it is — it is another tool's state, not ours to rewrite.
 */
export async function importCommandCodeTaste(
	agentDir: string,
	key: TasteScopeKey,
	cwd: string,
): Promise<TasteEntry[] | undefined> {
	if (key.domain !== "projects" && key.domain !== "agents") return undefined;
	if (await Bun.file(tasteFilePath(agentDir, key)).exists()) return undefined;
	const foreign = commandCodeTasteFile(cwd);
	const text = await Bun.file(foreign)
		.text()
		.catch(() => undefined);
	if (text === undefined) return undefined;
	const bullets = parseTasteFile(text);
	if (bullets.length === 0) return undefined;
	const stamp = today();
	return bullets.map(bullet => ({
		topicKey: topicKey(bullet.statement),
		category: "other" as const,
		statement: bullet.statement,
		polarity: "prefer" as const,
		confidence: bullet.confidence,
		mentions: 0,
		lastConfirmed: stamp,
		lastUsed: stamp,
		evidence: [] as string[],
	}));
}
