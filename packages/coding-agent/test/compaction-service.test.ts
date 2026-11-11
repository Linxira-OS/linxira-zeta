import { afterAll, beforeAll, describe, expect, it, vi } from "bun:test";
import { Agent, type AgentMessage, type AssistantMessage, type UserMessage } from "@linxiraos/pi-agent-core";
import * as compactionModule from "@linxiraos/pi-agent-core/compaction";
import type { Context, Model } from "@linxiraos/pi-ai";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { CompactionAgent } from "@linxiraos/zeta/session/compaction/agent";
import {
	COMPACTION_FIDELITY_PRESERVE_KEY,
	extractCompactionFidelity,
	readCompactionFidelity,
	withCompactionFidelity,
} from "@linxiraos/zeta/session/compaction/fidelity";
import { CompactionService } from "@linxiraos/zeta/session/compaction/service";
import { SessionMaintenance, type SessionMaintenanceHost } from "@linxiraos/zeta/session/session-maintenance";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";

const CONTEXT_WINDOW = 100_000;

function userMessage(text: string, timestamp = Date.now()): UserMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp };
}

function assistantMessage(text: string, model: Model, timestamp = Date.now()): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason: "stop",
		usage: {
			input: 10_000,
			output: 100,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 10_100,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp,
	};
}

function preparationOf(messages: AgentMessage[]) {
	return {
		firstKeptEntryId: "e-keep",
		messagesToSummarize: messages,
		turnPrefixMessages: [],
		recentMessages: [],
		isSplitTurn: false,
		tokensBefore: 1_000,
		fileOps: { read: new Set<string>(), edited: new Set<string>(), written: new Set<string>() },
		settings: { enabled: true, reserveTokens: 16_384 },
	} as never;
}

describe("compaction fidelity extraction", () => {
	const model = { api: "anthropic", provider: "anthropic", id: "test-model" } as Model;

	it("retains QA pairs, exact paths, ids, constraints and unfinished work", () => {
		const fidelity = extractCompactionFidelity({
			messages: [
				userMessage("Fix packages/coding-agent/src/session/session-maintenance.ts for REQ-051, PR #321", 1),
				assistantMessage(
					"You MUST keep the five methods. TODO: wire the phase consumer at packages/coding-agent/src/modes/controllers/event-controller.ts. Never use shims.",
					model,
					2,
				),
				userMessage("Anything left?", 3),
			],
			now: () => 1_700_000_000_000,
		});

		expect(fidelity.version).toBe(1);
		expect(fidelity.qa).toHaveLength(2);
		expect(fidelity.qa[0]?.question).toContain("REQ-051");
		expect(fidelity.qa[0]?.answer).toContain("five methods");
		expect(fidelity.qa[1]?.answer).toBeUndefined();
		expect(fidelity.paths).toContain("packages/coding-agent/src/session/session-maintenance.ts");
		expect(fidelity.paths).toContain("packages/coding-agent/src/modes/controllers/event-controller.ts");
		expect(fidelity.ids).toContain("REQ-051");
		expect(fidelity.ids).toContain("#321");
		expect(fidelity.constraints.join(" ")).toContain("MUST keep the five methods");
		expect(fidelity.unfinished.join(" ")).toContain("TODO: wire the phase consumer");
		expect(fidelity.tracking).toBeUndefined();
		expect(fidelity.generatedAt).toBe("2023-11-14T22:13:20.000Z");
	});

	it("adds no ledger when the range carries no retainable fact, and never fabricates tracking", () => {
		const agent = new CompactionAgent();
		const context = agent.buildContext(preparationOf([userMessage("hi", 1)]), { extraContext: ["ext"] });
		expect(context.extraContext).toEqual(["ext"]);
		expect(context.fidelity.paths).toEqual([]);
		expect(context.fidelity.tracking).toBeUndefined();
	});

	it("keeps foreign preserveData keys and round-trips the artifact", () => {
		const fidelity = extractCompactionFidelity({ messages: [userMessage("see a/b.ts", 1)] });
		const merged = withCompactionFidelity({ openaiRemoteCompaction: { provider: "x" } }, fidelity);
		expect(merged.openaiRemoteCompaction).toEqual({ provider: "x" });
		expect(readCompactionFidelity(merged)?.paths).toEqual(["a/b.ts"]);
		expect(merged[COMPACTION_FIDELITY_PRESERVE_KEY]).toBeDefined();
	});
});

describe("compaction service phases", () => {
	it("orders plan → work → commit and makes commit terminal", async () => {
		const phases: string[] = [];
		const service = new CompactionService(async event => {
			phases.push(event.phase);
		});
		const pass = service.beginPass({ trigger: "manual", reason: "user_requested" });
		await pass.plan({ method: "soft" });
		await pass.enter("summarize");
		await pass.commit({ entryId: "e1" });
		await pass.settle("failed", { errorMessage: "should not appear" });
		expect(phases).toEqual(["plan", "summarize", "commit"]);
	});

	it("classifies settle outcomes and ignores work after a terminal phase", async () => {
		const phases: string[] = [];
		const service = new CompactionService(async event => {
			phases.push(event.phase);
		});
		const cancelled = service.beginPass({ trigger: "auto", reason: "threshold" });
		await cancelled.settle("aborted");
		await cancelled.enter("summarize");
		const failed = service.beginPass({ trigger: "speculation", reason: "threshold" });
		await failed.settle("failed", { errorMessage: "provider 500" });
		expect(phases).toEqual(["aborted", "failed"]);
	});

	it("isolates commit listener errors and notifies each listener once", async () => {
		const service = new CompactionService(async () => {});
		const seen: string[] = [];
		service.onCommit(() => {
			throw new Error("consumer bug");
		});
		service.onCommit(commit => {
			seen.push(commit.entry.id);
		});
		const entry = { id: "e-commit", type: "compaction" } as never;
		await service.notifyCommitted({
			passId: "p1",
			trigger: "manual",
			entry,
			cutPoint: { firstKeptEntryId: "e-keep", discardedEntryIds: ["e1", "e2"] },
			tokensBefore: 10,
		});
		expect(seen).toEqual(["e-commit"]);
	});
});

describe("compaction service integration through SessionMaintenance", () => {
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let model: Model;

	beforeAll(async () => {
		authStorage = await AuthStorage.create(":memory:");
		authStorage.keys.setRuntime("anthropic", "test-key");
		modelRegistry = new ModelRegistry(authStorage);
		const bundled = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!bundled) throw new Error("Expected built-in model");
		model = { ...bundled, contextWindow: CONTEXT_WINDOW };
	});

	afterAll(() => {
		authStorage.close();
	});

	function createMaintenance(sessionManager: SessionManager, events: { type: string; phase?: string }[]) {
		const agent = new Agent({ initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] } });
		const settings = Settings.isolated({
			"compaction.enabled": true,
			"compaction.asyncEnabled": false,
			"compaction.methodOrder": ["soft"],
			"compaction.thresholdPercent": 50,
			"compaction.keepRecentTokens": 1,
			"compaction.autoContinue": false,
		});
		const host = {
			agent,
			sessionManager,
			settings,
			modelRegistry,
			extensionRunner: undefined,
			sideStreamFn: async () => {
				throw new Error("side stream unused");
			},
			providerSessionState: new Map(),
			preferWebsockets: () => undefined,
			model: () => model,
			thinkingLevel: () => undefined,
			isDisposed: () => false,
			isStreaming: () => false,
			isGeneratingHandoff: () => false,
			promptGeneration: () => 0,
			hasExperimentalContextRolloverTools: () => false,
			sessionId: () => sessionManager.getSessionId(),
			messages: () => agent.state.messages,
			baseSystemPrompt: () => ["Test"],
			goalModeState: () => undefined,
			planReferencePath: () => "",
			nonMessageTokenSource: () => ({}),
			memoryBackendSession: () => undefined,
			emitSessionEvent: async (event: { type: string; phase?: string }) => {
				events.push(event);
			},
			emitNotice: () => {},
			scheduleAgentContinue: () => {},
			scheduleCompactionContinuation: () => false,
			persistTurnMessagesForMidRunCompaction: async () => false,
			recordTrackingCompaction: async () => {},
			findLastAssistantMessage: () => undefined,
			disconnectFromAgent: () => {},
			reconnectToAgent: () => {},
			drainStrandedQueuedMessages: () => {},
			buildDisplaySessionContext: () => sessionManager.buildSessionContext(),
			replaceMessagesFromSessionContext: (messages: AgentMessage[]) => agent.replaceMessages(messages),
			persistEvalStateContext: () => {},
			convertToLlmForSideRequest: (messages: AgentMessage[]) => messages as never,
			buildLiveProviderContext: async (): Promise<Context> => ({ messages: [] }),
			obfuscateTextForProvider: (text: string | undefined) => text,
			obfuscatePreparationForProvider: <T>(preparation: T) => preparation,
			getPromptCacheKeyForModel: () => undefined,
			closeCodexProviderSessionsForHistoryRewrite: () => {},
			resetCodexProviderAfterCompaction: () => {},
			resetPlanReference: () => {},
			syncTodoPhasesFromBranch: () => {},
			resetAdvisorRuntimes: () => {},
			rebaseAfterCompaction: () => {},
			recordAnchoredHistoryRewrite: () => {},
			getContextBreakdown: () => undefined,
			getContextUsage: () => undefined,
			shake: async () => ({ modified: false, tokensRemoved: 0 }),
			dropImages: async () => ({ removed: 0 }),
			generateHandoffDocument: async () => undefined,
			removeAssistantMessageFromActiveContext: () => {},
			dropPersistedAssistantTurn: async () => undefined,
			runRecoveryCompactionWithRollback: async () => ({ continuationScheduled: false }),
			parseRetryAfterMsFromError: () => undefined,
			setModelTemporary: async () => {},
			abort: async () => {},
			abortHandoff: () => {},
		} as unknown as SessionMaintenanceHost;
		return new SessionMaintenance(host);
	}

	function seedConversation(sessionManager: SessionManager): void {
		const text = "conversation ".repeat(8_000);
		sessionManager.appendMessage(userMessage(text));
		sessionManager.appendMessage(assistantMessage("response ".repeat(8_000), model));
		sessionManager.appendMessage(
			userMessage("Keep packages/coding-agent/src/session/compaction/service.ts exact for REQ-051. MUST NOT rewrite.", Date.now()),
		);
		sessionManager.appendMessage(assistantMessage("TODO: run the narrow test.", model));
	}

	it("runs the real summarizer and emits plan → summarize → commit with retained fidelity", async () => {
		const sessionManager = SessionManager.inMemory();
		seedConversation(sessionManager);
		const events: { type: string; phase?: string }[] = [];
		const maintenance = createMaintenance(sessionManager, events);
		const compactSpy = vi.spyOn(compactionModule, "compact").mockImplementation(async preparation => ({
			summary: "summary text",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
			details: {},
			preserveData: { foreign: { keep: true } },
		}));

		const result = await maintenance.compact();
		expect(compactSpy).toHaveBeenCalledTimes(1);
		expect(result.summary).toBe("summary text");

		const phases = events.filter(event => event.type === "compaction_phase").map(event => event.phase);
		expect(phases).toEqual(["plan", "summarize", "commit"]);

		const entry = sessionManager.getEntries().findLast(item => item.type === "compaction");
		const fidelity = readCompactionFidelity(entry?.type === "compaction" ? entry.preserveData : undefined);
		expect(fidelity?.paths).toContain("packages/coding-agent/src/session/compaction/service.ts");
		expect(fidelity?.ids).toContain("REQ-051");
		expect(fidelity?.constraints.join(" ")).toContain("MUST NOT rewrite");
		expect(entry?.type === "compaction" ? entry.preserveData?.foreign : undefined).toEqual({ keep: true });
	});

	it("reports cancellation as aborted, never failed", async () => {
		const sessionManager = SessionManager.inMemory();
		seedConversation(sessionManager);
		const events: { type: string; phase?: string }[] = [];
		const maintenance = createMaintenance(sessionManager, events);
		vi.spyOn(compactionModule, "compact").mockImplementation(async () => {
			throw new compactionModule.CompactionCancelledError("user cancelled");
		});

		await expect(maintenance.compact()).rejects.toBeInstanceOf(compactionModule.CompactionCancelledError);
		const phases = events.filter(event => event.type === "compaction_phase").map(event => event.phase);
		expect(phases).toEqual(["plan", "summarize", "aborted"]);
		expect(phases).not.toContain("failed");
	});
});
