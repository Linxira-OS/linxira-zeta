/**
 * GPU / motion performance tiers (L0–L3).
 *
 * Lifted from upstream PR #20 (`apps/renderer/src/perf/tiers.ts`). Upstream's
 * desktop main process probes `app.getGPUFeatureStatus()` and the user can force
 * motion off; those facts reach the renderer as DOM attributes on `<html>`, and
 * the CSS in `./tiers.css` does the degrading:
 *
 *     <html data-gpu="hardware|software" data-motion="on|off" data-perf="normal|low">
 *
 * This module is the *classification* half: one pure function from the three
 * semantic inputs to a tier, plus the smallest DOM helpers needed to write and
 * read that state. It deliberately owns no effects, no listeners and no timers —
 * the attributes must be written by the renderer entry before the first paint, so
 * nothing here may depend on React being mounted.
 *
 * Tier ladder (each tier includes the rules of the one before it):
 *
 *   L0  hardware compositing + normal perf + motion on → full visuals
 *   L1  motion off                                    → reduced motion
 *   L2  software compositing or perf low              → L1 + drop effect layers
 *   L3  software compositing and perf low             → L2 + aggressive containment
 *
 * `motion: "off"` never *raises* the tier: on a software-compositing machine the
 * user still gets the L2 effect cut, which is why L1 is described as a sub-layer
 * rather than a peer.
 *
 * Local adaptation: the document brand check uses `"documentElement" in root`
 * instead of upstream's `root instanceof Document`, because `bun test` runs
 * without DOM globals and the class reference would throw there. The observable
 * behaviour in a browser is identical.
 */

/** How the machine composites pixels. */
export type GpuProfile = "hardware" | "software";

/** Whether motion the user did not ask for is allowed. */
export type MotionProfile = "on" | "off";

/** Machine performance class reported by the shell. */
export type PerfProfile = "normal" | "low";

/** Highest degradation tier that applies to the machine. */
export type PerfTier = "L0" | "L1" | "L2" | "L3";

/** The three semantic inputs, any of which may be unknown. */
export interface TierInput {
	readonly gpu?: GpuProfile | null;
	readonly motion?: MotionProfile | null;
	readonly perf?: PerfProfile | null;
}

/** Attribute names the stylesheet keys off; the only contract between the two. */
export const TIER_ATTRIBUTES = {
	gpu: "data-gpu",
	motion: "data-motion",
	perf: "data-perf",
} as const;

/**
 * Classify the highest degradation tier that applies.
 *
 * Pure: no DOM, no globals. Unknown/absent inputs fall back to the optimistic
 * L0 so a renderer that never got a profile still looks normal instead of
 * silently disabling effects.
 */
export function tierOf({ gpu, motion, perf }: TierInput): PerfTier {
	const software = gpu === "software";
	const lowPerf = perf === "low";
	if (software && lowPerf) return "L3";
	if (software || lowPerf) return "L2";
	if (motion === "off") return "L1";
	return "L0";
}

/** Canonical attribute values for a tier (used by tests and QA fixtures). */
export function attributesForTier(tier: PerfTier): {
	gpu: GpuProfile;
	motion: MotionProfile;
	perf: PerfProfile;
} {
	switch (tier) {
		case "L1":
			return { gpu: "hardware", motion: "off", perf: "normal" };
		case "L2":
			return { gpu: "software", motion: "on", perf: "normal" };
		case "L3":
			return { gpu: "software", motion: "on", perf: "low" };
		case "L0":
		default:
			return { gpu: "hardware", motion: "on", perf: "normal" };
	}
}

/**
 * The element that carries the tier attributes: `root` itself, or the document
 * element when a `Document` was passed.
 */
function tierElement(root: Element | Document | null | undefined): Element | null {
	if (root === null || root === undefined) return null;
	return "documentElement" in root ? root.documentElement : root;
}

/**
 * Write the three attributes for `tier` onto `root` (normally
 * `document.documentElement`).
 *
 * Cheap and idempotent: `setAttribute` with an unchanged value does not
 * invalidate style, so calling this on every profile change costs nothing.
 * A `null` root is tolerated because the renderer entry runs before React and
 * tests mount fragments without a document.
 */
export function applyTier(root: Element | Document | null | undefined, tier: PerfTier): void {
	const element = tierElement(root);
	if (element === null) return;
	const attributes = attributesForTier(tier);
	element.setAttribute(TIER_ATTRIBUTES.gpu, attributes.gpu);
	element.setAttribute(TIER_ATTRIBUTES.motion, attributes.motion);
	element.setAttribute(TIER_ATTRIBUTES.perf, attributes.perf);
}

/** Read the attributes back as tier inputs (inverse of `applyTier`). */
export function readTierInput(root: Element | Document | null | undefined): TierInput {
	const element = tierElement(root);
	if (element === null) return {};
	const gpu = element.getAttribute(TIER_ATTRIBUTES.gpu);
	const motion = element.getAttribute(TIER_ATTRIBUTES.motion);
	const perf = element.getAttribute(TIER_ATTRIBUTES.perf);
	return {
		gpu: gpu === "hardware" || gpu === "software" ? gpu : null,
		motion: motion === "on" || motion === "off" ? motion : null,
		perf: perf === "normal" || perf === "low" ? perf : null,
	};
}

/** Convenience: the tier the current DOM attributes describe. */
export function currentTier(root: Element | Document | null | undefined): PerfTier {
	return tierOf(readTierInput(root));
}
