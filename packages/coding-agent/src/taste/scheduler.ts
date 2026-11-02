/**
 * Consolidation scheduler — one interval per scope, shared by every session that
 * uses it.
 *
 * Same shape as the sharpshooter scheduler: a 60 s tick that runs consolidation
 * when candidates are waiting or the configured interval has elapsed, ref-counted
 * per scope so a session disposing does not stop the tick for its siblings.
 * `unref()` keeps the timer out of the event-loop's exit condition, so a
 * short-lived CLI run does not hang waiting for a tick that will never matter.
 */
import { logger } from "@linxiraos/pi-utils";

import type { ModelRegistry } from "../config/model-registry";
import type { Settings } from "../config/settings";
import { runTasteConsolidation } from "./consolidate";
import { tasteScopeId } from "./paths";
import { tasteQueueDepth } from "./queue";
import { resolveTasteScopes, type TasteScopeContext, type TasteScopeKey } from "./scope";
import { cfgTasteIntervalMinutes } from "./settings";
import { readTasteState } from "./store";

const TICK_MS = 60_000;

interface SchedulerEntry {
	timer: NodeJS.Timeout;
	refCount: number;
}

const schedulers = new Map<string, SchedulerEntry>();

export interface TasteSchedulerOptions extends TasteScopeContext {
	agentDir: string;
	settings: Settings;
	modelRegistry: ModelRegistry;
	sessionId: string;
}

/** Start (or join) the scheduler for every scope this caller reads; returns a disposer. */
export function startTasteScheduler(options: TasteSchedulerOptions): () => void {
	const disposers = resolveTasteScopes(options, options.settings).map(scope => startScopeScheduler(options, scope));
	return () => {
		for (const dispose of disposers) dispose();
	};
}

function startScopeScheduler(options: TasteSchedulerOptions, scope: TasteScopeKey): () => void {
	const id = tasteScopeId(scope);
	const existing = schedulers.get(id);
	if (existing) {
		existing.refCount += 1;
		return createDisposer(id, existing);
	}

	const tick = async (): Promise<void> => {
		try {
			const [depth, state] = await Promise.all([
				tasteQueueDepth(options.agentDir, scope),
				readTasteState(options.agentDir, scope),
			]);
			const intervalMs = cfgTasteIntervalMinutes.get(options.settings) * 60_000;
			const due = Date.now() - state.lastConsolidatedAt >= intervalMs;
			if (depth === 0 && !due) return;
			await runTasteConsolidation({ ...options, force: depth === 0 });
		} catch (error) {
			logger.debug("taste: scheduler tick failed", {
				scope: id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};
	const timer = setInterval(() => void tick(), TICK_MS);
	timer.unref();
	const entry: SchedulerEntry = { timer, refCount: 1 };
	schedulers.set(id, entry);
	void tick();
	return createDisposer(id, entry);
}

function createDisposer(id: string, entry: SchedulerEntry): () => void {
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		const current = schedulers.get(id);
		if (current !== entry) return;
		current.refCount -= 1;
		if (current.refCount > 0) return;
		clearInterval(current.timer);
		schedulers.delete(id);
	};
}
