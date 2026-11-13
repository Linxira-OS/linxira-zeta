/**
 * Fixed three-level fallback slots over `retry.fallbackChains.<role>`.
 *
 * Level 1 is `modelRoles.<role>`; level 2 is chain[0] (Fallback 1) and level 3
 * is chain[1] (Fallback 2). Entries beyond index 1 are legacy/extra fallbacks:
 * they are preserved on every slot edit and only removed by an explicit
 * `clearExtras` choice, so a longer existing chain is never silently truncated.
 */

/** The fixed slots plus entries beyond Fallback 2, read from one chain. */
export interface FallbackSlotView {
	readonly fallback1?: string;
	readonly fallback2?: string;
	/** Chain entries from index 2 onward, in configured order. */
	readonly extras: ReadonlyArray<string>;
}

/** Read the fixed slots without dropping or reordering anything. */
export function readFallbackSlots(chain: ReadonlyArray<string> | undefined): FallbackSlotView {
	const entries = (chain ?? []).filter(selector => typeof selector === "string" && selector.trim() !== "");
	return {
		...(entries[0] === undefined ? {} : { fallback1: entries[0] }),
		...(entries[1] === undefined ? {} : { fallback2: entries[1] }),
		extras: entries.slice(2),
	};
}

export type FallbackSlotComposeError = "fallback2-without-fallback1" | "extras-with-empty-slots";

/** Result of composing fixed slots back into one chain. */
export type FallbackSlotComposeResult =
	| { readonly ok: true; readonly chain: string[] }
	| { readonly ok: false; readonly reason: FallbackSlotComposeError };

/**
 * Compose the fixed slots into a chain.
 *
 * - Fallback 2 requires Fallback 1.
 * - Both slots empty means `[]` (explicitly no fallback), but only when the
 *   chain has no extra entries; with extras the caller must either keep the
 *   slots or pass `clearExtras`.
 * - `clearExtras` drops entries beyond Fallback 2 explicitly.
 */
export function composeFallbackSlots(
	fallback1: string | undefined,
	fallback2: string | undefined,
	extras: ReadonlyArray<string>,
	options: { readonly clearExtras?: boolean } = {},
): FallbackSlotComposeResult {
	const first = fallback1?.trim() ?? "";
	const second = fallback2?.trim() ?? "";
	if (second !== "" && first === "") return { ok: false, reason: "fallback2-without-fallback1" };
	const keptExtras = options.clearExtras === true ? [] : extras.filter(selector => selector.trim() !== "");
	if (first === "" && second === "") {
		if (keptExtras.length > 0) return { ok: false, reason: "extras-with-empty-slots" };
		return { ok: true, chain: [] };
	}
	const chain: string[] = [];
	for (const selector of [first, second, ...keptExtras]) {
		if (selector !== "" && !chain.includes(selector)) chain.push(selector);
	}
	return { ok: true, chain };
}
