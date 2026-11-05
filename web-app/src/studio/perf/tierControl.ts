/**
 * Machine performance tier → DOM, for the renderer entry.
 *
 * Lifted from upstream PR #20 (`apps/renderer/src/perf/tierControl.ts`).
 * Upstream's desktop Main grades the machine into L0–L3
 * (`apps/desktop/src/perf-profile.ts`) and publishes the verdict through the
 * read-only preload bridge:
 *
 *   cached      a snapshot read synchronously at preload time, for the first frame
 *   probe()     a promise for a fresh snapshot
 *   onChanged() pushes after a GPU/power change
 *
 * Here that bridge is `globalThis.zetaStudioPerf` (the upstream name was
 * `ompStudioPerf`; the desktop bridge globals were renamed to `zetaStudio*` in
 * this port). It is absent in the WebUI build, which is a supported state: the
 * tier then stays L0 and only the user's "reduce motion" preference applies.
 *
 * The renderer owns exactly two things here: keep the newest machine snapshot,
 * and fold the user's "reduce motion" preference into an effective tier. It
 * does not re-derive the machine class from GPU/CPU/RAM facts — that would be a
 * second grading rule to keep in sync with Main.
 *
 * The bug this replaces: the entry applied `onChanged` snapshots but never kept
 * them, so every later re-render (`prefers-reduced-motion` change, for example)
 * fell back to the *startup cache* and could pull a live L2/L3 back to L0.
 */

import { applyTier, TIER_ATTRIBUTES, type PerfTier } from "./tiers";

/** Main's own motion suggestion for the machine (`off` only on the lowest tier). */
export type MotionPolicy = "full" | "reduced" | "off";

/** One machine verdict as published by Main. `probedAt` orders two snapshots. */
export interface MachinePerfSnapshot {
	readonly tier: PerfTier;
	readonly motion?: MotionPolicy;
	readonly probedAt?: string;
}

/** The read-only surface the preload exposes as `globalThis.zetaStudioPerf`. */
export interface TierControlSource {
	readonly cached: MachinePerfSnapshot | null;
	probe(): Promise<MachinePerfSnapshot>;
	onChanged(listener: (snapshot: MachinePerfSnapshot) => void): () => void;
}

/**
 * The largest effect set the user can ask for is a *floor* they can tighten:
 * "reduce motion" turns L0 into L1 and leaves L1–L3 alone. It never lifts a
 * machine tier, because the reasons those tiers exist (software rasterizer,
 * low-end hardware) are not animations.
 */
export function effectiveTier(machine: PerfTier, motionOff: boolean): PerfTier {
	if (!motionOff) return machine;
	return machine === "L0" ? "L1" : machine;
}

/**
 * Newest snapshot wins, and the startup cache is only the initial value.
 *
 * `probe()` and `onChanged()` can interleave: a probe started at startup may
 * resolve after a newer push has already arrived. Accepting that stale result
 * would visibly rewind the tier, so a snapshot older than the one in hand is
 * dropped.
 */
export class TierState {
	#machine: MachinePerfSnapshot | null;

	/** Seed the state with the startup snapshot, if the shell had one. */
	constructor(initial: MachinePerfSnapshot | null = null) {
		this.#machine = initial;
	}

	/** The snapshot currently in hand, or `null` before the first verdict. */
	get machine(): MachinePerfSnapshot | null {
		return this.#machine;
	}

	/** Returns true when the snapshot became the current one. */
	accept(snapshot: MachinePerfSnapshot | null | undefined): boolean {
		if (snapshot === null || snapshot === undefined) return false;
		const current = this.#machine;
		const currentAt = current?.probedAt;
		const incomingAt = snapshot.probedAt;
		if (currentAt !== undefined && incomingAt !== undefined && incomingAt < currentAt) return false;
		this.#machine = snapshot;
		return true;
	}

	/** The tier and motion state the DOM should carry right now. */
	resolve(motionOff: boolean): { tier: PerfTier; motionOff: boolean } {
		const machine = this.#machine;
		// Main's own verdict (`motion: "off"` on L3) is a floor too.
		const off = motionOff || machine?.motion === "off";
		return { tier: effectiveTier(machine?.tier ?? "L0", off), motionOff: off };
	}
}

/** Everything `startTierControl` reads from its host. */
export interface TierControlEnvironment {
	/** Usually `document.documentElement`; a detached element in tests. */
	readonly root: Element;
	/** `globalThis.zetaStudioPerf`; absent in a browser or a harness without the shell. */
	readonly source: TierControlSource | undefined;
	/** User or OS "reduce motion" preference, read on every apply. */
	motionOff(): boolean;
	/** Subscribe to preference changes; returns a disposer. */
	onMotionPreferenceChange?(listener: () => void): () => void;
}

/**
 * Write the tier before the first frame and keep it current. Returns a disposer
 * that removes every listener, so an HMR reload or a page unload cannot leave a
 * second wiring behind (a duplicated listener would apply the tier twice and
 * keep the old module reachable).
 */
export function startTierControl(environment: TierControlEnvironment): () => void {
	const { root, source } = environment;
	const state = new TierState(source?.cached ?? null);

	const render = (): void => {
		const resolved = state.resolve(environment.motionOff());
		applyTier(root, resolved.tier);
		// `applyTier` writes the tier's canonical motion value; the user floor and
		// Main's verdict are applied on top. An unchanged `setAttribute` does not
		// invalidate style, so re-applying on every change is free.
		if (resolved.motionOff) root.setAttribute(TIER_ATTRIBUTES.motion, "off");
	};

	render();

	const disposers: Array<() => void> = [];
	if (source !== undefined) {
		disposers.push(source.onChanged(snapshot => {
			if (state.accept(snapshot)) render();
		}));
		if (source.cached === null) {
			// First launch for this profile: no synchronous snapshot yet, so the
			// first frame is optimistic (L0) and the probe refines it without a flash
			// of "fully degraded then normal".
			const pending = source.probe();
			void pending
				.then(snapshot => {
					if (state.accept(snapshot)) render();
				})
				.catch(() => {
					// Keep the last valid state; an unreachable Main is not a reason to
					// change what the user is looking at.
				});
		}
	}
	disposers.push(environment.onMotionPreferenceChange?.(render) ?? (() => {}));

	return () => {
		for (const dispose of disposers.splice(0)) dispose();
	};
}

/** `localStorage` key of the explicit "reduce motion" switch. */
const MOTION_STORAGE_KEY = "zeta.perf.motion";

/**
 * Validate the three members of `TierControlSource` on an untyped bridge object.
 *
 * The bridge crosses the preload boundary, so its shape is not proven by the
 * type system: an older shell may expose a partial object. Anything that does
 * not answer `probe()` and `onChanged()` is treated as "no shell".
 */
function isTierControlSource(value: unknown): value is TierControlSource {
	if (typeof value !== "object" || value === null) return false;
	if (!("cached" in value) || !("probe" in value) || !("onChanged" in value)) return false;
	return typeof value.probe === "function" && typeof value.onChanged === "function";
}

/**
 * The desktop perf bridge, if this entry runs inside the Electron shell.
 *
 * The global is read structurally and validated above because `vite-env.d.ts`
 * (owned elsewhere in this port) does not declare `zetaStudioPerf` yet; the
 * members of `TierControlSource` are the whole contract.
 */
function perfBridge(): TierControlSource | undefined {
	// `Reflect.get` because the global is not declared in `vite-env.d.ts` (owned
	// elsewhere in this port) and `globalThis` has no index signature to narrow.
	const candidate: unknown = Reflect.get(globalThis, "zetaStudioPerf");
	return isTierControlSource(candidate) ? candidate : undefined;
}

/** Explicit `zeta.perf.motion=off`, or the OS preference as the fallback. */
function motionOffNow(reducedMotion: MediaQueryList | undefined): boolean {
	try {
		if (globalThis.localStorage?.getItem(MOTION_STORAGE_KEY) === "off") return true;
	} catch {
		/* storage blocked: fall through to the OS preference */
	}
	return reducedMotion?.matches === true;
}

/**
 * Wire the tier attributes onto `root` for the current browser document.
 *
 * Reads the shell bridge (`globalThis.zetaStudioPerf`), the explicit
 * `zeta.perf.motion` storage switch and `prefers-reduced-motion`, and returns the
 * disposer `startTierControl` produced. Call it once from the renderer entry,
 * before the first paint, and hand the result to `import.meta.hot.dispose` and
 * `pagehide`.
 *
 * The renderer App does not need to change: nothing here goes through React, no
 * component reads the tier, and no App-level hook is required — this function
 * owns the observation of the machine and of the user preference itself.
 */
export function attachTierControl(root: HTMLElement): () => void {
	const reducedMotion = typeof globalThis.matchMedia === "function"
		? globalThis.matchMedia("(prefers-reduced-motion: reduce)")
		: undefined;
	return startTierControl({
		root,
		source: perfBridge(),
		motionOff: () => motionOffNow(reducedMotion),
		onMotionPreferenceChange: listener => {
			reducedMotion?.addEventListener("change", listener);
			return () => reducedMotion?.removeEventListener("change", listener);
		},
	});
}
