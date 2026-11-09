import { beforeAll, describe, expect, it } from "bun:test";
import type { SegmentContext } from "../src/status-line/segments";
import { describeSegment, renderSegment } from "../src/status-line/segments";
import { initTheme } from "../src/theme";

beforeAll(async () => {
	await initTheme();
});

/** The team segment reads only `ctx.team`; other fields are irrelevant here. */
const context = (label?: string): SegmentContext => ({ team: label ? { label } : null }) as unknown as SegmentContext;

describe("team status segment", () => {
	it("stays hidden outside a Team", () => {
		const rendered = renderSegment("team", context());
		expect(rendered.visible).toBe(false);
		expect(rendered.content).toBe("");
		expect(describeSegment("team", context())).toBeNull();
	});

	it("renders the display-only breadcrumb from the host", () => {
		const label = "Acme / core / api / alice / T-101";
		const rendered = renderSegment("team", context(label));
		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain(label);
		const described = describeSegment("team", context(label));
		expect(described?.spans.map(span => span.t).join("")).toContain(label);
	});
});
