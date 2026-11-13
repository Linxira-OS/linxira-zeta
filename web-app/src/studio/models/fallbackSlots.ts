/**
 * Web mirror of `packages/coding-agent/src/config/fallback-slots.ts`.
 *
 * Fixed level 3 fallback slots over `retry.fallbackChains.<role>`: primary +
 * Fallback 1 + Fallback 2. Entries past Fallback 2 are preserved unless the
 * caller explicitly clears them, so an existing longer chain is never silently
 * truncated by the slot editor.
 */

export interface FallbackSlotView {
	readonly fallback1?: string;
	readonly fallback2?: string;
	readonly extras: ReadonlyArray<string>;
}

export function readFallbackSlots(chain: ReadonlyArray<string> | undefined): FallbackSlotView {
	const entries = (chain ?? []).filter(selector => typeof selector === "string" && selector.trim() !== "");
	return {
		...(entries[0] === undefined ? {} : { fallback1: entries[0] }),
		...(entries[1] === undefined ? {} : { fallback2: entries[1] }),
		extras: entries.slice(2),
	};
}

export type FallbackSlotComposeError = "fallback2-without-fallback1" | "extras-with-empty-slots";

export type FallbackSlotComposeResult =
	| { readonly ok: true; readonly chain: string[] }
	| { readonly ok: false; readonly reason: FallbackSlotComposeError };

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
