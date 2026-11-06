/** Cross-mount estimates, partitioned by actual body width, typography and
 * conversation/panel identity. Measurements remain authoritative. All contexts
 * share one bounded LRU, so a resize never clears an entire measured prefix. */
export const MAX_ROW_HEIGHT_ENTRIES = 8192;
export const ROW_WIDTH_BUCKET_PX = 32;
export const DEFAULT_ROW_ESTIMATE = 132;
export type RowHeightContext = {
	readonly width: number;
	readonly typography: string;
	readonly panel: string;
};

const heights = new Map<string, number>();
function cacheKey(key: string, context?: RowHeightContext): string {
	return JSON.stringify([
		context?.panel ?? "",
		context?.typography ?? "",
		context === undefined ? 0 : Math.round(context.width / ROW_WIDTH_BUCKET_PX),
		key,
	]);
}
export function rememberRowHeight(key: string, height: number, context?: RowHeightContext): void {
	if (!(height > 0) || !Number.isFinite(height)) return;
	const entry = cacheKey(key, context);
	heights.delete(entry);
	heights.set(entry, height);
	if (heights.size > MAX_ROW_HEIGHT_ENTRIES) heights.delete(heights.keys().next().value!);
}
/** The remembered height when this key was measured in this context, or
 *  `undefined` when the caller must measure. Unlike {@link rowHeightEstimate}
 *  it never invents a default, so measurement paths can skip a forced layout
 *  for a row they have already seen. */
export function rememberedRowHeight(key: string | undefined, context?: RowHeightContext): number | undefined {
	if (key === undefined) return undefined;
	const entry = cacheKey(key, context);
	const remembered = heights.get(entry);
	if (remembered === undefined) return undefined;
	heights.delete(entry);
	heights.set(entry, remembered);
	return remembered;
}
export function rowHeightEstimate(key: string | undefined, context?: RowHeightContext): number {
	return rememberedRowHeight(key, context) ?? DEFAULT_ROW_ESTIMATE;
}
/** Explicit typography invalidation or test reset. Width changes do not call it. */
export function resetRowHeightCache(): void {
	heights.clear();
}
