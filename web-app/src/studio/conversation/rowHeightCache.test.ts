import { describe, expect, test } from "bun:test";
import {
	DEFAULT_ROW_ESTIMATE,
	ROW_WIDTH_BUCKET_PX,
	rememberRowHeight,
	rememberedRowHeight,
	resetRowHeightCache,
	rowHeightEstimate,
	type RowHeightContext,
} from "./rowHeightCache";

const context = (width = 800): RowHeightContext => ({ width, panel: "workbench", typography: "16/24" });

describe("rowHeightCache", () => {
	test("a key that was never measured is reported as unknown, not as the default", () => {
		resetRowHeightCache();
		expect(rememberedRowHeight("row-1", context())).toBeUndefined();
		// The estimate keeps its historical contract for callers that need a number.
		expect(rowHeightEstimate("row-1", context())).toBe(DEFAULT_ROW_ESTIMATE);
	});

	test("a measured row is remembered per width bucket and panel", () => {
		resetRowHeightCache();
		rememberRowHeight("row-1", 140, context(800));
		expect(rememberedRowHeight("row-1", context(800))).toBe(140);
		// A different width bucket is a different measurement.
		const otherBucket = context(800 + ROW_WIDTH_BUCKET_PX);
		expect(rememberedRowHeight("row-1", otherBucket)).toBeUndefined();
		expect(rememberedRowHeight("row-1", { ...context(800), panel: "preview" })).toBeUndefined();
	});

	test("non-positive or non-finite heights are ignored", () => {
		resetRowHeightCache();
		rememberRowHeight("row-1", 0, context());
		rememberRowHeight("row-1", Number.NaN, context());
		expect(rememberedRowHeight("row-1", context())).toBeUndefined();
	});

	test("the new lookup does not evict entries the estimate needs", () => {
		resetRowHeightCache();
		rememberRowHeight("row-1", 140, context());
		expect(rememberedRowHeight("row-1", context())).toBe(140);
		expect(rowHeightEstimate("row-1", context())).toBe(140);
	});
});
