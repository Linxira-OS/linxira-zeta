/**
 * Pull-driven memory-pressure shedding.
 *
 * There is no push-style memory-pressure event in this codebase: memory is
 * *sampled*, and `fanout-pressure.ts` is the only sampler. This module hangs a
 * shed off the checkpoints that already sample — the subagent spawn permit
 * (`task/index.ts`), the workpool worker ceiling (`task/workpool.ts`), and a
 * turn-end sample on the session layer — and releases memory by cost, lowest
 * first:
 *
 *   TIGHT    -> (1) TUI render caches, (2) idle owned browser tabs
 *   CRITICAL -> TIGHT, plus (3) the mnemopi embedding worker and
 *               (4) this session's idle one-shot broker daemons
 *
 * Every target goes through an existing API; nothing here kills live work: the
 * browser sweep reuses `isIdleCloseCandidate`, so a tab with an in-flight run
 * stays. A shed logs one line (level, released object, reason) and writes no
 * tracking — the fan-out notice already says the machine is short; a tracking
 * entry per checkpoint would just be noise.
 */

import { logger } from "@linxiraos/pi-utils";
import { clearRenderCache } from "@linxiraos/pi-tui";
import { clearMermaidCache } from "@linxiraos/pi-tui/theme/mermaid-cache";
import { TERMINAL_STATES } from "@linxiraos/pi-tui/apps/ps-data";
import type { ToolSession } from "../tools";
import { listServices, stopService } from "../launch/services";
import { mnemopiEmbedClient } from "../mnemopi/embed-client";
import { releaseIdleTabsForOwner } from "../tools/browser/tab-supervisor";
import type { MemoryPressureLevel, MemorySample } from "./fanout-pressure";

/** A level that actually sheds (`fanout-pressure.ts`'s third value, `ok`, does not). */
export type MemoryShedLevel = Exclude<MemoryPressureLevel, "ok">;

/**
 * The subset of {@link ToolSession} the broker step needs. The turn-end
 * checkpoint lives on the session layer, which owns no `ToolSession` handle, so
 * it satisfies this structurally; `listServices` / `stopService` only read
 * `cwd` and the owner accessors (everything else they touch is optional).
 */
export type MemoryShedSession = Pick<ToolSession, "cwd" | "getSessionId" | "getAgentId">;

/** Where and why a sample was taken; recorded on the shed log line. */
export interface MemoryShedContext {
	/** Session whose owned browser tabs / broker services may be shed. */
	session?: MemoryShedSession;
	/** Checkpoint that took the sample, e.g. "spawn permit". */
	source: string;
	/**
	 * Re-run the shed even when this owner already shed at this level. The
	 * turn-end checkpoint sets it: idle resources accumulate between turns, and
	 * a turn boundary is where they are cheap to collect. Spawn/workpool
	 * checkpoints leave it unset so a sustained level is shed once, not per
	 * acquire.
	 */
	force?: boolean;
}

/** One shed's outcome: the level and what was released, in shed order. */
export interface MemoryShedResult {
	level: MemoryShedLevel;
	released: string[];
}

/** The side effects a shed performs — injectable so the level mapping is testable. */
export interface MemoryShedEffects {
	clearRenderCaches(): void;
	releaseIdleTabs(ownerId: string): Promise<number>;
	terminateMnemopiWorker(): Promise<void>;
	/** Stop this session's idle one-shot daemons; returns the names stopped. */
	stopIdleBrokerDaemons(session: MemoryShedSession | undefined, ownerId: string | null): Promise<string[]>;
}

/** Last level shed for an owner, so one pressure episode logs one line. */
const lastShedLevel = new Map<string, MemoryPressureLevel>();

/** Clear episode state — the seam tests use to isolate cases. */
export function resetMemoryShedState(): void {
	lastShedLevel.clear();
}

function describeReason(level: MemoryShedLevel, sample: MemorySample): string {
	const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
	return (
		`memory pressure (${level}): rss ${gib(sample.rssBytes)} GiB, ` +
		`system free ${gib(sample.systemFreeBytes)} of ${gib(sample.systemTotalBytes)} GiB`
	);
}

/**
 * The production effects. `stopIdleBrokerDaemons` mirrors the broker's own
 * `#stopUnownedOneShotDaemons` predicate (non-`persist`, non-`detached`,
 * non-terminal) but scoped to *this* session's daemons: a live session cannot
 * recreate the broker's "no client and no project presence" gate, and stopping
 * another session's services would be the wrong shed.
 */
export const DEFAULT_MEMORY_SHED_EFFECTS: MemoryShedEffects = {
	clearRenderCaches: () => {
		clearRenderCache();
		clearMermaidCache();
	},
	releaseIdleTabs: ownerId => releaseIdleTabsForOwner(ownerId, { idleMs: 0 }),
	terminateMnemopiWorker: () => mnemopiEmbedClient.terminate(),
	stopIdleBrokerDaemons: async (session, ownerId) => {
		if (!session || ownerId === null) return [];
		// The narrow `MemoryShedSession` satisfies every field these two read; the
		// casts are type-only (a full session is passed at the tool checkpoints).
		const brokerSession = session as unknown as ToolSession;
		const stopped: string[] = [];
		for (const daemon of await listServices(brokerSession)) {
			if (daemon.persist || daemon.detached || TERMINAL_STATES[daemon.state]) continue;
			if (daemon.owner !== ownerId) continue;
			try {
				await stopService(brokerSession, daemon.name);
				stopped.push(daemon.name);
			} catch (error) {
				logger.warn("memory-shed: failed to stop idle broker daemon", {
					name: daemon.name,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		return stopped;
	},
};

/**
 * Shed at `level`. Callers may invoke this unconditionally: an `ok` level only
 * resets the episode state, and a level already shed for this owner is a no-op
 * unless {@link MemoryShedContext.force} is set. Returns `undefined` when no
 * shedding ran. One log line per episode (plus any shed that released a
 * countable object) keeps a sustained squeeze from flooding the log.
 */
export async function shedUnderMemoryPressure(
	level: MemoryPressureLevel,
	sample: MemorySample,
	context: MemoryShedContext,
	effects: MemoryShedEffects = DEFAULT_MEMORY_SHED_EFFECTS,
): Promise<MemoryShedResult | undefined> {
	const ownerId = context.session?.getSessionId?.() ?? null;
	const key = ownerId ?? context.session?.getAgentId?.() ?? "";
	if (level === "ok") {
		lastShedLevel.delete(key);
		return undefined;
	}
	const previous = lastShedLevel.get(key);
	if (previous === level && context.force !== true) return undefined;
	const enteringEpisode = previous !== level;
	lastShedLevel.set(key, level);
	const released: string[] = [];

	// (1) TUI render caches: cheap, always safe to drop (Markdown L2 + mermaid L1).
	effects.clearRenderCaches();
	if (enteringEpisode) released.push("TUI render caches (markdown, mermaid)");

	// (2) Browser tabs of this session that are idle (no in-flight run).
	if (ownerId) {
		try {
			const closed = await effects.releaseIdleTabs(ownerId);
			if (closed > 0) released.push(`idle browser tabs (\u00d7${closed})`);
		} catch (error) {
			logger.warn("memory-shed: idle browser-tab release failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	if (level === "critical") {
		// (3) mnemopi embedding worker: expensive to respawn, so critical only.
		try {
			await effects.terminateMnemopiWorker();
			if (enteringEpisode) released.push("mnemopi embed worker");
		} catch (error) {
			logger.warn("memory-shed: mnemopi worker termination failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}

		// (4) This session's idle one-shot broker daemons.
		try {
			const stopped = await effects.stopIdleBrokerDaemons(context.session, ownerId);
			if (stopped.length > 0) released.push(`broker daemons (${stopped.join(", ")})`);
		} catch (error) {
			logger.warn("memory-shed: idle broker-daemon sweep failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	if (enteringEpisode || released.length > 0) {
		logger.warn(
			`memory-shed: shed ${level} at ${context.source} — ` +
				`released ${released.length > 0 ? released.join("; ") : "nothing idle"} — ${describeReason(level, sample)}`,
		);
	}
	return { level, released };
}
