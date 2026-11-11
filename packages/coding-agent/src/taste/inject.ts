/**
 * Prompt injection: the preference block a session's system prompt carries.
 *
 * Timing follows the existing memory backends exactly — the block is rebuilt when
 * the base system prompt is rebuilt (session start, settings/tools/model change,
 * session branch, extension reload, or a backend asking for a refresh), never per
 * turn and never on a timer. Compaction replaces messages, not the system prompt,
 * so the block itself is stable across a compact.
 *
 * That stability is why the block carries a precedence line and a retraction
 * section: a compacted history still quotes prefaces the store may have since
 * forgotten, and the model has to be told which one wins (`## Retracted`).
 */
import { truncateApproxTokens } from "../mnemopi/config";
import type { Settings } from "../config/settings";
import type { AgentSession } from "../session/agent-session";
import { cfgMemoryBackend } from "../memory-backend/settings";
import { cfgTasteEnabled, cfgTasteConfidenceFloor, cfgTasteInjectionTokenLimit } from "./settings";
import { resolveTasteScopes, type TasteScopeKey } from "./scope";
import { injectionScore, shouldInject } from "./score";
import {
	daysBetween,
	readTasteScope,
	TOMBSTONE_RENDER_DAYS,
	today,
	type TasteEntry,
	type TasteTombstone,
} from "./store";

/** First line of the block: states which source wins, before any preference does. */
export const TASTE_PRECEDENCE_LINE =
	"These preferences are the current store and take precedence over any conflicting statement in the conversation or its compacted history, including earlier assistant messages that quoted older memory. The user's latest instruction still wins.";

export interface TasteInjectOptions {
	agentDir: string;
	cwd: string;
	settings: Settings;
	session?: AgentSession;
	/** Overrides the session-provided agent id (tests, subagent tooling). */
	agentId?: string;
	now?: Date;
}

/**
 * The block for this session, or `undefined` when the layer is off or has nothing
 * worth spending tokens on. Every read is scoped to the caller's own scope list:
 * one agent never sees another's store.
 */
export async function buildTasteInstructions(options: TasteInjectOptions): Promise<string | undefined> {
	if (cfgMemoryBackend.get(options.settings) === "off") return undefined;
	if (cfgTasteEnabled.get(options.settings) !== true) return undefined;
	const agentId = options.agentId ?? options.session?.getAgentId();
	const namespace = options.session?.sessionManager.getMemoryNamespace();
	const scopes = resolveTasteScopes(
		{ cwd: options.cwd, agentId, ...(namespace ? { namespace } : {}) },
		options.settings,
	);
	return renderTasteBlock({ ...options, scopes });
}

/** Render the block for an explicit scope list (the single place scopes become text). */
export async function renderTasteBlock(
	options: TasteInjectOptions & { scopes: readonly TasteScopeKey[] },
): Promise<string | undefined> {
	const now = options.now ?? new Date();
	const floor = cfgTasteConfidenceFloor.get(options.settings);
	const limit = cfgTasteInjectionTokenLimit.get(options.settings);
	const seen = new Set<string>();
	const injectable: TasteEntry[] = [];
	const tombstones: TasteTombstone[] = [];

	for (const scope of options.scopes) {
		const snapshot = await readTasteScope(options.agentDir, scope);
		for (const entry of snapshot.entries) {
			// The narrowest scope wins: a topic already claimed by an earlier scope
			// is not re-read from a broader one.
			if (seen.has(entry.topicKey)) continue;
			seen.add(entry.topicKey);
			if (shouldInject(entry, now, floor)) injectable.push(entry);
		}
		if (scope.domain === "agents" || scope.domain === "projects") {
			// Retractions are shown for the stores this caller reads; an agent's own
			// retractions matter most, a project's next.
			tombstones.push(...(await readTasteScope(options.agentDir, scope)).tombstones);
		}
	}
	if (injectable.length === 0 && tombstones.length === 0) return undefined;

	injectable.sort((a, b) => injectionScore(b, now) - injectionScore(a, now));
	const lines = injectable.map(entry => `- ${entry.statement}. Confidence: ${trim(entry.confidence)}`);
	const retractions = recencyFilteredTombstones(tombstones, now).map(
		tombstone => `- Do not follow (retracted ${tombstone.retiredAt}): ${tombstone.statement}`,
	);

	const blocks = [TASTE_PRECEDENCE_LINE, "", "## Preferences", ...lines];
	if (retractions.length > 0) blocks.push("", "## Retracted", ...retractions);
	return truncateApproxTokens(blocks.join("\n"), limit);
}

/** Tombstones still worth retracting, newest first, deduplicated by statement. */
function recencyFilteredTombstones(tombstones: readonly TasteTombstone[], now: Date): TasteTombstone[] {
	const stamp = today(now);
	const seen = new Set<string>();
	const recent: TasteTombstone[] = [];
	for (const tombstone of [...tombstones].reverse()) {
		const key = tombstone.statement.trim().toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		if (daysBetween(tombstone.retiredAt, stamp) > TOMBSTONE_RENDER_DAYS) continue;
		recent.push(tombstone);
	}
	return recent;
}

function trim(value: number): string {
	return String(Math.round(Math.min(1, Math.max(0, value)) * 100) / 100);
}
