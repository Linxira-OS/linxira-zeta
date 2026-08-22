import { beforeAll, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import type { AssistantMessage } from "@linxiraos/pi-ai";
import { renderSegment } from "@linxiraos/zeta/modes/components/status-line/segments";
import { extractLastTurnStats, formatTurnStats } from "@linxiraos/zeta/modes/components/status-line/turn-stats";
import type { SegmentContext } from "@linxiraos/zeta/modes/components/status-line/types";
import { initTheme } from "@linxiraos/zeta/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

function assistantMessage(overrides?: Partial<AssistantMessage>): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4.5",
		usage: {
			input: 100,
			output: 567,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 667,
			cost: { input: 0.01, output: 0.07, cacheRead: 0, cacheWrite: 0, total: 0.08 },
		},
		stopReason: "stop",
		timestamp: 1_000,
		duration: 29_700,
		ttft: 1_200,
		...overrides,
	};
}

function ctxWithMessages(messages: unknown[]): SegmentContext {
	return { session: { state: { messages } } } as unknown as SegmentContext;
}

describe("turn_stats status-line segment", () => {
	it("renders TPS/TTFT/duration/tokens/cost from the trailing assistant message", () => {
		const rendered = renderSegment("turn_stats", ctxWithMessages([assistantMessage()]));
		const content = stripVTControlCharacters(rendered.content);

		expect(rendered.visible).toBe(true);
		// 567 tokens over 29.7s → 19.1 tok/s
		expect(content).toContain("19.1/s");
		expect(content).toContain("⇄1.2s");
		expect(content).toContain("29.7s");
		expect(content).toContain("567");
		expect(content).toContain("$0.08");
	});

	it("hides when the tail is not a billed assistant turn", () => {
		expect(renderSegment("turn_stats", ctxWithMessages([])).visible).toBe(false);
		expect(renderSegment("turn_stats", ctxWithMessages([{ role: "user", content: "hi" }])).visible).toBe(false);
		expect(
			renderSegment(
				"turn_stats",
				ctxWithMessages([assistantMessage({ usage: { ...assistantMessage().usage, output: 0 } })]),
			).visible,
		).toBe(false);
	});

	it("skips trailing tool results and stops at the turn-opening user message", () => {
		const stats = extractLastTurnStats([
			{ role: "user", content: "earlier", timestamp: 0, attribution: "user" },
			assistantMessage(),
			{ role: "toolResult", toolCallId: "t1", toolName: "bash", isError: false, content: [], timestamp: 1 },
		]);
		expect(stats).not.toBeNull();
		expect(
			extractLastTurnStats([
				assistantMessage(),
				{ role: "user", content: "newest turn", timestamp: 2, attribution: "user" },
			]),
		).toBeNull();
	});
});

describe("formatTurnStats", () => {
	it("formats durations in seconds with one decimal and abbreviates tokens", () => {
		const stats = extractLastTurnStats([assistantMessage()])!;
		const line = stripVTControlCharacters(formatTurnStats(stats));
		expect(line).toContain("⇄1.2s");
		expect(line).toContain("29.7s");
		// 1200 input tokens abbreviate through formatNumber
		const kStats = extractLastTurnStats([assistantMessage({ usage: { ...assistantMessage().usage, input: 1200 } })])!;
		expect(stripVTControlCharacters(formatTurnStats(kStats))).toContain("1.2K");
	});
});
