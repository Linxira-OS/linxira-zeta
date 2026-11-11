/**
 * Memory-pressure shedding: pull-driven checkpoints plus a Windows push adapter.
 *
 * Memory is normally *sampled*, and `fanout-pressure.ts` is the only sampler.
 * This module hangs a shed off the checkpoints that already sample — the
 * subagent spawn permit (`task/index.ts`), the workpool worker ceiling
 * (`task/workpool.ts`), and a turn-end sample on the session layer — and
 * releases memory by cost, lowest first:
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
 *
 * Bun also documents a `process.on("memoryPressure")` event. The Windows
 * adapter at the end of this module is the only push trigger; it drops derived
 * render caches only, and its OS delivery is not locally verified — tests
 * inject the level and prove the adapter/cache effect, never an OS signal.
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

/**
 * The level Bun's `process.on("memoryPressure")` delivers.
 *
 * Bun's typings document `warning`/`critical` on macOS and always `critical`
 * on Windows. That is the published API contract. This repository does not
 * exercise native OS delivery in tests, so no test or log line below claims a
 * system signal was observed.
 */
export type MemoryPressureEventLevel = "warning" | "critical";

/**
 * Platforms whose memory-pressure event this adapter registers.
 *
 * Only Windows is claimed: the os-error-1455 triage targets Windows and Bun
 * 1.4 types the event for that platform. Registration alone proves nothing —
 * a plain EventEmitter accepts any event name — so callers get `undefined`
 * elsewhere and must not treat a listener as OS support.
 */
export function supportsMemoryPressureEvent(platform: NodeJS.Platform = process.platform): boolean {
	return platform === "win32";
}

/** Map the OS level onto the shed ladder (`warning` is the lower rung). */
export function memoryPressureEventShedLevel(level: MemoryPressureEventLevel): MemoryShedLevel {
	return level === "warning" ? "tight" : "critical";
}

/** The cache effect an event can use — the only process-wide, session-free target. */
export type MemoryPressureEventEffects = Pick<MemoryShedEffects, "clearRenderCaches">;

/**
 * Shed render caches for one memory-pressure event.
 *
 * Only derived memoization is dropped (Markdown L2 and mermaid L1). Every block
 * renders its rows again on the next frame; no transcript or session content is
 * removed. The append-only emission ledger is deliberately untouched: published
 * rows in native scrollback cannot be retracted.
 */
export function handleMemoryPressureEvent(
	level: MemoryPressureEventLevel,
	effects: MemoryPressureEventEffects = DEFAULT_MEMORY_SHED_EFFECTS,
): void {
	effects.clearRenderCaches();
	logger.warn(
		`memory-shed: ${level} memoryPressure event (${memoryPressureEventShedLevel(level)} shed) — ` +
			"released TUI render caches (markdown, mermaid)",
	);
}

/** Anything that can deliver the event: `process`, or a test emitter. */
export interface MemoryPressureEventSource {
	on(event: "memoryPressure", listener: (level: MemoryPressureEventLevel) => void): unknown;
	off(event: "memoryPressure", listener: (level: MemoryPressureEventLevel) => void): unknown;
}

export interface InstallMemoryPressureShedOptions {
	/** Defaults to `process.platform`; tests pass a platform to pin the gate. */
	platform?: NodeJS.Platform;
	/** Defaults to `process`; tests pass an isolated emitter. */
	source?: MemoryPressureEventSource;
	effects?: MemoryPressureEventEffects;
	/** Stable lifecycle identity; repeated installs by the same owner share one lease. */
	owner?: object;
}

interface MemoryPressureRegistration {
	owners: Map<object, { release: () => void; effects: MemoryPressureEventEffects }>;
	listener: (level: MemoryPressureEventLevel) => void;
}

const memoryPressureRegistrations = new Map<MemoryPressureEventSource, MemoryPressureRegistration>();

/** Whether any interactive owner currently holds a memory-pressure listener. */
export function isMemoryPressureShedInstalled(): boolean {
	return memoryPressureRegistrations.size > 0;
}

/**
 * Acquire a Windows memory-pressure subscription for one interactive owner.
 *
 * A source has one listener regardless of its owner count. A stable `owner`
 * makes repeated init idempotent; its release is also idempotent. Stopping one
 * owner leaves the others subscribed, and the last release detaches the
 * listener. A later init acquires a fresh subscription. Without an explicit
 * owner each call acquires an independent lease.
 *
 * Tests inject the source/level: registration is not proof of native OS delivery.
 */
export function installMemoryPressureShed(
	options: InstallMemoryPressureShedOptions = {},
): (() => void) | undefined {
	if (!supportsMemoryPressureEvent(options.platform)) return undefined;
	const source: MemoryPressureEventSource = options.source ?? process;
	const owner = options.owner ?? {};
	let registration = memoryPressureRegistrations.get(source);
	const existing = registration?.owners.get(owner);
	if (existing) return existing.release;
	if (!registration) {
		const owners: MemoryPressureRegistration["owners"] = new Map();
		const listener = (level: MemoryPressureEventLevel): void => {
			const current = owners.values().next().value;
			if (!current) return;
			try {
				// The caches are process-wide: release once, not once per owner.
				handleMemoryPressureEvent(level, current.effects);
			} catch (error) {
				logger.warn("memory-shed: memoryPressure event handler failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		};
		source.on("memoryPressure", listener);
		registration = { owners, listener };
		memoryPressureRegistrations.set(source, registration);
	}
	const ownedRegistration = registration;
	let released = false;
	const release = (): void => {
		if (released) return;
		released = true;
		ownedRegistration.owners.delete(owner);
		if (ownedRegistration.owners.size === 0) {
			source.off("memoryPressure", ownedRegistration.listener);
			memoryPressureRegistrations.delete(source);
		}
	};
	ownedRegistration.owners.set(owner, {
		release,
		effects: options.effects ?? DEFAULT_MEMORY_SHED_EFFECTS,
	});
	return release;
}
