import { beforeAll, describe, expect, it, vi } from "bun:test";
import type { AgentMessage } from "@linxiraos/pi-agent-core";
import { initTheme } from "@linxiraos/pi-tui/theme";
import { Settings } from "@linxiraos/zeta/config/settings";
import {
	TRANSCRIPT_REPLAY_MAX_MESSAGES,
	UiHelpers,
	windowTranscriptReplay,
} from "@linxiraos/zeta/modes/utils/ui-helpers";
import type { SessionContext } from "@linxiraos/zeta/session/session-context";
import { createInteractiveModeContext } from "./helpers/interactive-mode-context";

beforeAll(async () => {
	await initTheme(false);
	await Settings.init({ inMemory: true });
});

function message(role: "user" | "assistant", text: string): AgentMessage {
	return role === "user"
		? { role, content: [{ type: "text", text }], timestamp: 0 }
		: {
				role,
				content: [{ type: "text", text }],
				api: "mock",
				provider: "mock",
				model: "mock",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 0,
			};
}

function context(messages: AgentMessage[]): SessionContext {
	return {
		messages,
		cacheMissExplainedAt: messages.map(() => false),
		thinkingLevel: "off",
		serviceTier: undefined,
		models: {},
		injectedTtsrRules: [],
		mode: "none",
	};
}

function alternating(count: number, text = "x".repeat(64)): AgentMessage[] {
	return Array.from({ length: count }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", text));
}

describe("windowTranscriptReplay", () => {
	it("leaves a transcript under both caps untouched", () => {
		const source = context(alternating(10));
		const result = windowTranscriptReplay(source, 400, 4 * 1024 * 1024);
		expect(result.hiddenMessages).toBe(0);
		expect(result.context).toBe(source);
	});

	it("keeps only the newest messages when the message cap is exceeded", () => {
		const source = context(alternating(2_000));
		const result = windowTranscriptReplay(source, 100, 4 * 1024 * 1024);
		expect(result.hiddenMessages).toBeGreaterThan(0);
		expect(result.context.messages.length).toBeLessThanOrEqual(100);
		expect(result.context.messages.at(-1)).toBe(source.messages.at(-1));
	});

	it("keeps only the newest messages when the byte cap is exceeded", () => {
		const source = context(alternating(40, "y".repeat(1_024)));
		const result = windowTranscriptReplay(source, 400, 8 * 1_024);
		expect(result.hiddenMessages).toBeGreaterThan(0);
		expect(result.context.messages.length).toBeLessThan(40);
	});

	it("opens the window at a user turn", () => {
		const source = context(alternating(2_000));
		const result = windowTranscriptReplay(source, 101, 4 * 1024 * 1024);
		expect(result.context.messages[0]?.role).toBe("user");
	});

	it("slices the parallel cache-miss markers with the messages", () => {
		const source = context(alternating(2_000));
		const result = windowTranscriptReplay(source, 100, 4 * 1024 * 1024);
		expect(result.context.cacheMissExplainedAt?.length).toBe(result.context.messages.length);
	});

	it("caps the default window well below a large transcript", () => {
		const source = context(alternating(20_000, "z".repeat(256)));
		const result = windowTranscriptReplay(source);
		expect(result.hiddenMessages).toBeGreaterThan(0);
		expect(result.context.messages.length).toBeLessThanOrEqual(TRANSCRIPT_REPLAY_MAX_MESSAGES);
	});

	it("uses the window for a fresh render and reports it in the transcript", async () => {
		const source = context(alternating(2_000));
		const rendered: SessionContext[] = [];
		const ctx = createInteractiveModeContext({
			initialChatRendered: false,
			viewSession: {
				buildTranscriptSessionContext: () => source,
				isStreaming: false,
				sessionManager: { getEntries: () => [] },
			},
			renderSessionContextIncrementally: async (context: SessionContext) => {
				rendered.push(context);
			},
		});

		await new UiHelpers(ctx).renderInitialMessages({ clearTerminalHistory: true });

		expect(rendered).toHaveLength(1);
		expect(rendered[0]!.messages.length).toBeLessThanOrEqual(TRANSCRIPT_REPLAY_MAX_MESSAGES);
		expect(rendered[0]!.messages[0]?.role).toBe("user");
		expect(ctx.chatContainer.children).toHaveLength(1);
	});

	it("keeps the full transcript for a mid-session rebuild", async () => {
		const source = context(alternating(2_000));
		const rendered: SessionContext[] = [];
		const ctx = createInteractiveModeContext({
			initialChatRendered: true,
			viewSession: {
				buildTranscriptSessionContext: () => source,
				isStreaming: false,
				sessionManager: { getEntries: () => [] },
			},
			renderSessionContextIncrementally: async (context: SessionContext) => {
				rendered.push(context);
			},
		});

		await new UiHelpers(ctx).renderInitialMessages();

		expect(rendered).toHaveLength(1);
		expect(rendered[0]!.messages).toHaveLength(source.messages.length);
		expect(ctx.chatContainer.children).toHaveLength(0);
	});
});
