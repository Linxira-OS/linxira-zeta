/**
 * ZetaContextManager unit tests — validate the dual state machine:
 *   State Machine A: Threshold → Memory Write
 *   State Machine B: EndTurn → Compression
 */
import { describe, expect, it } from "bun:test";
import type { Agent } from "@linxiraos/pi-agent-core";
import type { AssistantMessage } from "@linxiraos/pi-ai";
import type { Api, Usage } from "@linxiraos/pi-catalog/types";
import type { Settings } from "@linxiraos/zeta/config/settings";
import type { ContextUsage } from "@linxiraos/zeta/extensibility/extensions/types";
import type { CompactionCheckResult } from "@linxiraos/zeta/session/session-maintenance";
import { ZetaContextManager, type ZetaContextManagerHost } from "@linxiraos/zeta/session/zeta-context-manager";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

interface StoredHook {
	fn: (signal?: AbortSignal) => Promise<void>;
}

function createMockAgent(): Agent & { beforeModelCallHooks: StoredHook[]; beforeDequeueHooks: StoredHook[] } {
	const beforeModelCallHooks: StoredHook[] = [];
	const beforeDequeueHooks: StoredHook[] = [];

	return {
		beforeModelCallHooks,
		beforeDequeueHooks,
		addBeforeModelCallHook(fn: (signal?: AbortSignal) => Promise<void>): () => void {
			const hook: StoredHook = { fn };
			beforeModelCallHooks.push(hook);
			return () => {
				const idx = beforeModelCallHooks.indexOf(hook);
				if (idx >= 0) beforeModelCallHooks.splice(idx, 1);
			};
		},
		addBeforeQueuedMessageDequeueHook(fn: (signal?: AbortSignal) => Promise<void>): () => void {
			const hook: StoredHook = { fn };
			beforeDequeueHooks.push(hook);
			return () => {
				const idx = beforeDequeueHooks.indexOf(hook);
				if (idx >= 0) beforeDequeueHooks.splice(idx, 1);
			};
		},
	} as unknown as Agent & { beforeModelCallHooks: StoredHook[]; beforeDequeueHooks: StoredHook[] };
}

function createMockHost(
	overrides: Partial<{
		enabled: boolean;
		memoryWriteEnabled: boolean;
		endTurnCompactionEnabled: boolean;
		thresholdTokens: number;
		contextTokens: number;
		lastAssistantMessage: AssistantMessage | undefined;
	}> = {},
): ZetaContextManagerHost {
	const settingsGet = (key: string): unknown => {
		switch (key) {
			case "zeta.contextCache.enabled":
				return overrides.enabled ?? true;
			case "zeta.contextCache.memoryWriteEnabled":
				return overrides.memoryWriteEnabled ?? true;
			case "zeta.contextCache.endTurnCompactionEnabled":
				return overrides.endTurnCompactionEnabled ?? true;
			case "zeta.contextCache.thresholdTokens":
				return overrides.thresholdTokens ?? 400_000;
			default:
				return undefined;
		}
	};

	return {
		settings: { get: settingsGet } as unknown as Settings,
		getContextUsage(): ContextUsage | undefined {
			if (overrides.contextTokens === undefined) return undefined;
			return { tokens: overrides.contextTokens } as ContextUsage;
		},
		async runAutoCompaction(): Promise<CompactionCheckResult> {
			return { deferredHandoff: false, continuationScheduled: false };
		},
		findLastAssistantMessage(): AssistantMessage | undefined {
			return overrides.lastAssistantMessage;
		},
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ZetaContextManager", () => {
	describe("registration lifecycle", () => {
		it("registers hooks on the agent", () => {
			const host = createMockHost({ enabled: true });
			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);

			expect(agent.beforeModelCallHooks).toHaveLength(1);
			expect(agent.beforeDequeueHooks).toHaveLength(1);
		});

		it("unregisters hooks and resets state", () => {
			const host = createMockHost({ enabled: true });
			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			manager.unregister();

			expect(agent.beforeModelCallHooks).toHaveLength(0);
			expect(agent.beforeDequeueHooks).toHaveLength(0);
			expect(manager.needsMemoryWrite()).toBe(false);
		});

		it("unregister is idempotent", () => {
			const host = createMockHost({ enabled: true });
			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			manager.unregister();
			expect(() => manager.unregister()).not.toThrow();
		});
	});

	describe("State Machine A: threshold → memory write", () => {
		it("sets needsMemoryWrite when context tokens exceed threshold", async () => {
			const host = createMockHost({ enabled: true, contextTokens: 500_000, thresholdTokens: 400_000 });
			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			expect(agent.beforeModelCallHooks).toHaveLength(1);

			// Trigger the before-model-call hook (simulates the agent calling it)
			await agent.beforeModelCallHooks[0].fn();

			expect(manager.needsMemoryWrite()).toBe(true);
		});

		it("does not set needsMemoryWrite when context tokens are below threshold", async () => {
			const host = createMockHost({ enabled: true, contextTokens: 100_000, thresholdTokens: 400_000 });
			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			await agent.beforeModelCallHooks[0].fn();

			expect(manager.needsMemoryWrite()).toBe(false);
		});

		it("returns a valid SoftToolRequirement when memory write is needed", async () => {
			const host = createMockHost({ enabled: true, contextTokens: 500_000, thresholdTokens: 400_000 });
			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			await agent.beforeModelCallHooks[0].fn();

			const req = manager.getMemoryWriteRequirement();
			expect(req).toBeDefined();
			expect(req!.soft).toBe(true);
			expect(req!.toolName).toBe("memory_edit");
			expect(req!.id).toMatch(/^zeta-memory-/);
			expect(req!.reminder).toHaveLength(1);
		});

		it("returns undefined when no memory write is needed", () => {
			const host = createMockHost({ enabled: true, contextTokens: 100_000, thresholdTokens: 400_000 });
			const manager = new ZetaContextManager(host);

			expect(manager.getMemoryWriteRequirement()).toBeUndefined();
		});

		it("clears the memory write requirement", async () => {
			const host = createMockHost({ enabled: true, contextTokens: 500_000, thresholdTokens: 400_000 });
			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			await agent.beforeModelCallHooks[0].fn();
			expect(manager.needsMemoryWrite()).toBe(true);

			manager.clearMemoryWrite();
			expect(manager.needsMemoryWrite()).toBe(false);
		});

		it("clears the memory write requirement when tokens drop below threshold", async () => {
			// Use a host that reports tokens dynamically
			let reportedTokens = 500_000;
			const host = createMockHost({
				enabled: true,
				contextTokens: 500_000,
				thresholdTokens: 400_000,
			});
			// Override getContextUsage to return dynamic tokens
			host.getContextUsage = () => ({ tokens: reportedTokens }) as ContextUsage;

			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);

			// First call: above threshold
			await agent.beforeModelCallHooks[0].fn();
			expect(manager.needsMemoryWrite()).toBe(true);

			// Second call: below threshold
			reportedTokens = 100_000;
			await agent.beforeModelCallHooks[0].fn();
			expect(manager.needsMemoryWrite()).toBe(false);
		});
	});

	describe("State Machine B: endTurn → compression", () => {
		it("triggers compaction when the last assistant message has endTurn stop reason", async () => {
			let compactionCalled = false;
			const host = createMockHost({
				enabled: true,
				endTurnCompactionEnabled: true,
				lastAssistantMessage: {
					role: "assistant",
					content: [{ type: "text", text: "Done" }],
					stopReason: "stop",
					stopDetails: { type: "end_turn" },
					api: "openai" as Api,
					provider: "openai",
					model: "gpt-4o",
					usage: MOCK_USAGE,
					timestamp: 0,
				} as AssistantMessage,
			});

			// Override runAutoCompaction to track calls
			const originalCompact = host.runAutoCompaction;
			host.runAutoCompaction = async (...args) => {
				compactionCalled = true;
				return originalCompact(...args);
			};

			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			await agent.beforeDequeueHooks[0].fn();

			expect(compactionCalled).toBe(true);
		});

		it("does not trigger compaction when stopReason is not stop", async () => {
			let compactionCalled = false;
			const host = createMockHost({
				enabled: true,
				endTurnCompactionEnabled: true,
				lastAssistantMessage: {
					role: "assistant",
					content: [{ type: "text", text: "Working..." }],
					stopReason: "toolUse",
					api: "openai" as Api,
					provider: "openai",
					model: "gpt-4o",
					usage: MOCK_USAGE,
					timestamp: 0,
				} as AssistantMessage,
			});

			host.runAutoCompaction = async () => {
				compactionCalled = true;
				return { deferredHandoff: false, continuationScheduled: false };
			};

			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			await agent.beforeDequeueHooks[0].fn();

			expect(compactionCalled).toBe(false);
		});

		it("does not trigger compaction when stopDetails.type is not end_turn", async () => {
			let compactionCalled = false;
			const host = createMockHost({
				enabled: true,
				endTurnCompactionEnabled: true,
				lastAssistantMessage: {
					role: "assistant",
					content: [{ type: "text", text: "Done" }],
					stopReason: "stop",
					stopDetails: { type: "max_tokens" },
					api: "openai" as Api,
					provider: "openai",
					model: "gpt-4o",
					usage: MOCK_USAGE,
					timestamp: 0,
				} as AssistantMessage,
			});

			host.runAutoCompaction = async () => {
				compactionCalled = true;
				return { deferredHandoff: false, continuationScheduled: false };
			};

			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			await agent.beforeDequeueHooks[0].fn();

			expect(compactionCalled).toBe(false);
		});

		it("debounces: skips compaction when one is already pending", async () => {
			let compactionCount = 0;
			let resolveCompaction: () => void;
			const compactionDone = new Promise<void>(r => {
				resolveCompaction = r;
			});

			const host = createMockHost({
				enabled: true,
				endTurnCompactionEnabled: true,
				lastAssistantMessage: {
					role: "assistant",
					content: [{ type: "text", text: "Done" }],
					stopReason: "stop",
					stopDetails: { type: "end_turn" },
					api: "openai" as Api,
					provider: "openai",
					model: "gpt-4o",
					usage: MOCK_USAGE,
					timestamp: 0,
				} as AssistantMessage,
			});

			host.runAutoCompaction = async () => {
				compactionCount++;
				await compactionDone; // hold the first compaction open
				return { deferredHandoff: false, continuationScheduled: false };
			};

			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);

			// Fire the first hook (starts compaction but doesn't finish)
			const firstCall = agent.beforeDequeueHooks[0].fn();
			// Fire the second hook while the first is still pending
			await agent.beforeDequeueHooks[0].fn();

			// Release the first compaction
			resolveCompaction!();
			await firstCall;

			// Only the first call should have triggered compaction
			expect(compactionCount).toBe(1);
		});
	});

	describe("settings-based enable/disable", () => {
		it("does nothing when zeta.contextCache.enabled is false", async () => {
			const host = createMockHost({
				enabled: false,
				contextTokens: 500_000,
				thresholdTokens: 400_000,
				lastAssistantMessage: {
					role: "assistant",
					content: [{ type: "text", text: "Done" }],
					stopReason: "stop",
					stopDetails: { type: "end_turn" },
					api: "openai" as Api,
					provider: "openai",
					model: "gpt-4o",
					usage: MOCK_USAGE,
					timestamp: 0,
				} as AssistantMessage,
			});

			let compactionCalled = false;
			host.runAutoCompaction = async () => {
				compactionCalled = true;
				return { deferredHandoff: false, continuationScheduled: false };
			};

			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			await agent.beforeModelCallHooks[0].fn();
			await agent.beforeDequeueHooks[0].fn();

			expect(manager.needsMemoryWrite()).toBe(false);
			expect(compactionCalled).toBe(false);
		});

		it("respects memoryWriteEnabled setting", async () => {
			const host = createMockHost({
				enabled: true,
				memoryWriteEnabled: false,
				contextTokens: 500_000,
				thresholdTokens: 400_000,
			});

			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			await agent.beforeModelCallHooks[0].fn();

			expect(manager.needsMemoryWrite()).toBe(false);
		});

		it("respects endTurnCompactionEnabled setting", async () => {
			let compactionCalled = false;
			const host = createMockHost({
				enabled: true,
				endTurnCompactionEnabled: false,
				lastAssistantMessage: {
					role: "assistant",
					content: [{ type: "text", text: "Done" }],
					stopReason: "stop",
					stopDetails: { type: "end_turn" },
					api: "openai" as Api,
					provider: "openai",
					model: "gpt-4o",
					usage: MOCK_USAGE,
					timestamp: 0,
				} as AssistantMessage,
			});

			host.runAutoCompaction = async () => {
				compactionCalled = true;
				return { deferredHandoff: false, continuationScheduled: false };
			};

			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			await agent.beforeDequeueHooks[0].fn();

			expect(compactionCalled).toBe(false);
		});
	});

	describe("default settings", () => {
		it("is disabled by default and does nothing", async () => {
			// No overrides provided → DEFAULT_ENABLED = false
			const host = createMockHost({});
			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			await agent.beforeModelCallHooks[0].fn();

			expect(manager.needsMemoryWrite()).toBe(false);
		});
	});

	describe("edge cases", () => {
		it("can re-register after unregister", async () => {
			const host = createMockHost({ enabled: true, contextTokens: 500_000, thresholdTokens: 400_000 });
			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			manager.unregister();

			// Re-register on the same agent
			manager.register(agent);
			expect(agent.beforeModelCallHooks).toHaveLength(1);
			expect(agent.beforeDequeueHooks).toHaveLength(1);

			await agent.beforeModelCallHooks[0].fn();
			expect(manager.needsMemoryWrite()).toBe(true);
		});

		it("does nothing when getContextUsage returns undefined", async () => {
			const host = createMockHost({ enabled: true, thresholdTokens: 400_000 });
			// contextTokens is undefined → getContextUsage returns undefined
			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			await agent.beforeModelCallHooks[0].fn();

			expect(manager.needsMemoryWrite()).toBe(false);
		});

		it("clearMemoryWrite is idempotent", async () => {
			const host = createMockHost({ enabled: true, contextTokens: 500_000, thresholdTokens: 400_000 });
			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			await agent.beforeModelCallHooks[0].fn();
			expect(manager.needsMemoryWrite()).toBe(true);

			manager.clearMemoryWrite();
			expect(manager.needsMemoryWrite()).toBe(false);

			// Second clear is safe
			manager.clearMemoryWrite();
			expect(manager.needsMemoryWrite()).toBe(false);
		});

		it("does not trigger compaction when lastAssistantMessage is undefined", async () => {
			const host = createMockHost({
				enabled: true,
				endTurnCompactionEnabled: true,
				lastAssistantMessage: undefined,
			});

			let compactionCalled = false;
			host.runAutoCompaction = async () => {
				compactionCalled = true;
				return { deferredHandoff: false, continuationScheduled: false };
			};

			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			await agent.beforeDequeueHooks[0].fn();

			expect(compactionCalled).toBe(false);
		});

		it("memory write id is stable across multiple threshold checks", async () => {
			const host = createMockHost({ enabled: true, contextTokens: 500_000, thresholdTokens: 400_000 });
			const manager = new ZetaContextManager(host);
			const agent = createMockAgent();

			manager.register(agent);
			await agent.beforeModelCallHooks[0].fn();

			const req1 = manager.getMemoryWriteRequirement();
			expect(req1).toBeDefined();

			// Second call (still above threshold) should keep the same id
			await agent.beforeModelCallHooks[0].fn();
			const req2 = manager.getMemoryWriteRequirement();
			expect(req2!.id).toBe(req1!.id);
		});
	});
});
