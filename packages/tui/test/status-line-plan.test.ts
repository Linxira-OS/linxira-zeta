import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import type { SegmentContext } from "../src/status-line/segments";
import { renderSegment } from "../src/status-line/segments";
import { initTheme, theme } from "../src/theme";

beforeAll(async () => {
	await initTheme();
});

afterEach(() => {
	vi.restoreAllMocks();
});

function createContext(planMode: SegmentContext["planMode"]): SegmentContext {
	return {
		session: {} as SegmentContext["session"],
		width: 120,
		compactThinkingLevel: false,
		options: {},
		planMode,
		loopMode: null,
		prewalk: null,
		goalMode: null,
		vibeMode: null,
		vim: null,
		collab: null,
		stream: null,
		recording: false,
		usageStats: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			orchestrationInput: 0,
			orchestrationOutput: 0,
			orchestrationCacheRead: 0,
			premiumRequests: 0,
			cost: 0,
			tokensPerSecond: null,
		},
		contextPercent: 0,
		contextTokens: 0,
		contextWindow: 0,
		autoCompactEnabled: false,
		compactionSpeculation: "idle",
		speculationBlinkOn: true,
		subagentCount: 0,
		activeMs: 0,
		turnElapsedMs: null,
		activeRepo: null,
		worktree: null,
		git: { branch: null, status: null, pr: null },
		usage: null,
	};
}

function withIcon(icon: string, text: string): string {
	return icon ? `${icon} ${text}` : text;
}

describe("status line plan mode segment", () => {
	it("labels the standard workflows as Plan", () => {
		expect(Bun.stripANSI(renderSegment("mode", createContext({ enabled: true, paused: false })).content)).toBe(
			withIcon(theme.icon.plan, "Plan"),
		);
		expect(
			Bun.stripANSI(
				renderSegment("mode", createContext({ enabled: true, paused: false, workflow: "iterative" })).content,
			),
		).toBe(withIcon(theme.icon.plan, "Plan"));
	});

	it("labels the ultra workflow Plan-Ultra", () => {
		const rendered = renderSegment("mode", createContext({ enabled: true, paused: false, workflow: "ultra" }));

		expect(Bun.stripANSI(rendered.content)).toBe(withIcon(theme.icon.plan, "Plan-Ultra"));
	});

	it("keeps the ultra label while plan mode is paused", () => {
		const pauseSuffix = theme.icon.pause ? ` ${theme.icon.pause}` : " (paused)";
		const rendered = renderSegment("mode", createContext({ enabled: true, paused: true, workflow: "ultra" }));

		expect(Bun.stripANSI(rendered.content)).toBe(withIcon(theme.icon.plan, `Plan-Ultra${pauseSuffix}`));
		expect(rendered.content).toBe(theme.fg("warning", withIcon(theme.icon.plan, `Plan-Ultra${pauseSuffix}`)));
	});

	it("leaves a non-ultra paused plan as Plan (paused)", () => {
		const pauseSuffix = theme.icon.pause ? ` ${theme.icon.pause}` : " (paused)";
		const rendered = renderSegment("mode", createContext({ enabled: true, paused: true }));

		expect(Bun.stripANSI(rendered.content)).toBe(withIcon(theme.icon.plan, `Plan${pauseSuffix}`));
	});
});
