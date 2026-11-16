import { describe, expect, spyOn, test } from "bun:test";
import * as path from "node:path";
import type { AssistantMessage } from "@linxiraos/pi-ai";
import { ThinkingLevel } from "@linxiraos/pi-agent-core/thinking";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { TempDir } from "@linxiraos/pi-utils";
import { AgentRegistry, type AgentRef } from "../src/registry/agent-registry";
import type { AgentSession } from "../src/session/agent-session";
import { BtwHistoryStore } from "../src/session/btw-history";
import { SessionManager, type PersistedSessionInit } from "../src/session/session-manager";
import type { BtwImage } from "../src/server/studio-host/protocol/contracts/runtime-upgrade";
import { StudioAgentBtwService } from "../src/server/studio-host/services/agent-btw-service";
import { StudioAgentModelService } from "../src/server/studio-host/services/agent-model-service";
import type { StudioBtwSessionPort } from "../src/server/studio-host/services/btw-service";

/**
 * Drain microtasks until `check()` is true. Uses `Promise.resolve()` (a
 * microtask hop, not a real-time delay), so the wait is bounded by the
 * number of pending continuations and never burns wall-clock seconds.
 */
async function waitFor(check: () => boolean, label: string): Promise<void> {
	for (let index = 0; index < 1000 && !check(); index++) await Promise.resolve();
	if (!check()) throw new Error(`Timed out waiting for: ${label}`);
}

function assistant(text: string, model: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "mock",
		model,
		stopReason: "stop",
		timestamp: 0,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	} as AssistantMessage;
}

interface ChildFixture {
	readonly session: StudioBtwSessionPort;
	readonly calls: Parameters<StudioBtwSessionPort["runEphemeralTurn"]>[0][];
}

function child(id: string, options: { wait?: boolean; ensureOnDisk?: () => Promise<void> } = {}): ChildFixture {
	const calls: Parameters<StudioBtwSessionPort["runEphemeralTurn"]>[0][] = [];
	const session: StudioBtwSessionPort = {
		model: getBundledModel("anthropic", "claude-sonnet-4-5")!,
		isStreaming: false,
		sessionManager: {
			ensureOnDisk: options.ensureOnDisk ?? (async () => {}),
			getSessionId: () => id,
			getLeafId: () => "leaf-" + id,
		},
		branchFromBtw: async () => {
			throw Error("unexpected child branch");
		},
		runEphemeralTurn: async args => {
			calls.push(args);
			if (options.wait) {
				const gate = Promise.withResolvers<void>();
				if (args.signal) args.signal.addEventListener("abort", () => gate.reject(Error("aborted")), { once: true });
				else gate.resolve();
				await gate.promise;
			}
			const replyText = "answer from " + id;
			args.onTextDelta?.(replyText);
			return { replyText, assistantMessage: assistant(replyText, id) };
		},
	};
	return { session, calls };
}

const images: BtwImage[] = [{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" }];

describe("child agent BTW", () => {
	test("keeps child history separate from main and siblings, forwards images, and aborts only its turn", async () => {
		const mainStore = await BtwHistoryStore.open(undefined);
		await mainStore.upsert({
			id: "main-topic",
			leafId: null,
			question: "main only",
			answer: "main answer",
			status: "complete",
			createdAt: 1,
			updatedAt: 1,
		});
		const a = child("child-a"),
			b = child("child-b"),
			waiting = child("child-wait", { wait: true });
		const targets = new Map<string, StudioBtwSessionPort>([
			["child-a", a.session],
			["child-b", b.session],
			["child-wait", waiting.session],
		]);
		const parent = { sessionId: "parent-session", isDisposed: false };
		const pool = new StudioAgentBtwService(parent, id => targets.get(id));
		const base = { sessionId: parent.sessionId };
		try {
			const aState = await pool.execute({ ...base, kind: "agent.btw.read", agentId: "child-a" });
			const bState = await pool.execute({ ...base, kind: "agent.btw.read", agentId: "child-b" });
			expect(aState.binding).not.toBe(bState.binding);
			expect(aState.targetSessionId).toBe("child-a");
			expect(bState.targetSessionId).toBe("child-b");

			await pool.execute({
				...base,
				kind: "agent.btw.ask",
				agentId: "child-a",
				binding: aState.binding,
				question: "a only",
				images,
			});
			await waitFor(() => !pool.running, "child-a answer");
			const afterAsk = await pool.execute({
				...base,
				kind: "agent.btw.read",
				agentId: "child-a",
				binding: aState.binding,
			});
			expect(afterAsk.snapshot?.text).toBe("answer from child-a");
			expect(a.calls).toHaveLength(1);
			expect(a.calls[0]?.promptImages).toEqual(images);
			expect(b.calls).toHaveLength(0);
			expect(afterAsk.topics.map(topic => topic.topicId)).not.toContain("main-topic");
			expect(
				(await pool.execute({ ...base, kind: "agent.btw.read", agentId: "child-b", binding: bState.binding }))
					.topics,
			).toHaveLength(0);

			const topicId = afterAsk.snapshot!.topicId!;
			await pool.execute({
				...base,
				kind: "agent.btw.ask",
				agentId: "child-a",
				binding: aState.binding,
				topicId,
				question: "follow a",
			});
			await waitFor(() => !pool.running, "child-a follow-up");
			const followed = await pool.execute({
				...base,
				kind: "agent.btw.read",
				agentId: "child-a",
				binding: aState.binding,
				topicId,
			});
			expect(followed.turns).toHaveLength(2);
			expect(followed.turns[0]?.images).toEqual(images);
			expect(JSON.stringify(a.calls[1]?.history?.[0]?.content)).toContain("a only");
			expect(followed.snapshot?.turnIndex).toBe(1);
			expect(afterAsk.snapshot?.title).toBeUndefined();

			await expect(
				pool.execute({
					...base,
					kind: "agent.btw.ask",
					agentId: "child-b",
					binding: aState.binding,
					question: "wrong binding",
				}),
			).rejects.toMatchObject({ code: "INTERACTION_STALE" });

			targets.set("child-a", child("child-a-replaced").session);
			await expect(
				pool.execute({
					...base,
					kind: "agent.btw.ask",
					agentId: "child-a",
					binding: aState.binding,
					question: "stale target",
				}),
			).rejects.toMatchObject({ code: "INTERACTION_STALE" });
			targets.delete("child-b");
			await expect(
				pool.execute({ ...base, kind: "agent.btw.read", agentId: "child-b", binding: bState.binding }),
			).rejects.toMatchObject({ code: "INTERACTION_STALE" });

			const waitingState = await pool.execute({
				...base,
				kind: "agent.btw.read",
				agentId: "child-wait",
			});
			const waitingStart = await pool.execute({
				...base,
				kind: "agent.btw.ask",
				agentId: "child-wait",
				binding: waitingState.binding,
				question: "wait",
			});
			expect(pool.running).toBe(true);
			const aborted = await pool.execute({
				...base,
				kind: "agent.btw.abort",
				agentId: "child-wait",
				binding: waitingState.binding,
				ephemeralId: waitingStart.snapshot!.ephemeralId,
			});
			expect(aborted.snapshot?.status).toBe("aborted");
			expect(waiting.calls[0]?.signal?.aborted).toBe(true);
			expect(a.calls.every(call => call.signal?.aborted === false)).toBe(true);

			expect(mainStore.getRecords().map(record => record.id)).toEqual(["main-topic"]);
		} finally {
			await pool.settle().catch(() => {});
			pool.dispose();
		}
	});

	test("default resolution accepts only registry-proven live descendants", async () => {
		const parent = {
			sessionId: "parent-session",
			isDisposed: false,
			sessionManager: { getSessionId: () => "parent-session" },
		} as unknown as AgentSession;
		const viewChild = (id: string) =>
			({
				sessionId: id,
				isDisposed: false,
				isStreaming: false,
				model: getBundledModel("anthropic", "claude-sonnet-4-5")!,
				sessionManager: { getSessionId: () => id, getLeafId: () => "leaf-" + id },
				activeToolExecutionUpdates: () => [],
				runEphemeralTurn: async () => ({ replyText: "live", assistantMessage: assistant("live", id) }),
			}) as unknown as AgentSession;
		const child = viewChild("child");
		const refs = [
			{ id: "Main", kind: "main", session: parent },
			{ id: "Child", kind: "sub", parentId: "Main", session: child },
			{ id: "Foreign", kind: "sub", parentId: "Other", session: viewChild("foreign") },
			{ id: "Orphan", kind: "sub", parentId: "Missing", session: viewChild("orphan") },
			{ id: "Parked", kind: "sub", parentId: "Main", session: null, sessionFile: "/saved.jsonl" },
		] as unknown as AgentRef[];
		const registry = AgentRegistry.global();
		const list = spyOn(registry, "list").mockReturnValue(refs);
		const get = spyOn(registry, "get").mockImplementation(id => refs.find(ref => ref.id === id));
		const pool = new StudioAgentBtwService(parent);
		try {
			const state = await pool.execute({
				kind: "agent.btw.read",
				sessionId: parent.sessionId,
				agentId: "Child",
			});
			expect(state.targetSessionId).toBe("child");
			for (const agentId of ["Foreign", "Orphan", "Parked", "Main"])
				await expect(
					pool.execute({ kind: "agent.btw.read", sessionId: parent.sessionId, agentId }),
				).rejects.toMatchObject({ code: "INTERACTION_STALE" });
		} finally {
			pool.dispose();
			get.mockRestore();
			list.mockRestore();
		}
	});

	test("fences a revoked view before the native child turn and keeps the pool reusable", async () => {
		const started = Promise.withResolvers<void>();
		const gate = Promise.withResolvers<void>();
		const a = child("child-guard", {
			ensureOnDisk: async () => {
				started.resolve();
				await gate.promise;
			},
		});
		const targets = new Map<string, StudioBtwSessionPort>([["child-guard", a.session]]);
		const parent = { sessionId: "parent-session", isDisposed: false };
		const pool = new StudioAgentBtwService(parent, id => targets.get(id));
		let live = true;
		const assertLive = () => {
			if (!live) throw Error("view revoked");
		};
		try {
			const state = await pool.execute({
				kind: "agent.btw.read",
				sessionId: parent.sessionId,
				agentId: "child-guard",
			});
			const asking = pool.execute(
				{
					kind: "agent.btw.ask",
					sessionId: parent.sessionId,
					agentId: "child-guard",
					binding: state.binding,
					question: "must not reach provider",
				},
				assertLive,
			);
			await started.promise;
			live = false;
			gate.resolve();
			await asking.catch(() => {});
			await waitFor(() => !pool.running, "revoked child turn to settle");
			expect(a.calls).toHaveLength(0);
			expect(
				(
					await pool.execute({
						kind: "agent.btw.read",
						sessionId: parent.sessionId,
						agentId: "child-guard",
						binding: state.binding,
					})
				).snapshot?.status,
			).toBe("failed");

			live = true;
			await pool.execute(
				{
					kind: "agent.btw.ask",
					sessionId: parent.sessionId,
					agentId: "child-guard",
					binding: state.binding,
					question: "after reattach",
				},
				assertLive,
			);
			await waitFor(() => a.calls.length === 1, "child turn after reattach");
			await waitFor(() => !pool.running, "child turn after reattach to settle");
			expect(a.calls).toHaveLength(1);
		} finally {
			await pool.settle().catch(() => {});
			pool.dispose();
		}
	});
});

describe("agent model inspection", () => {
	test("reports live routing and thinking for owned descendants only", async () => {
		const manager = SessionManager.inMemory();
		manager.appendSessionInit({
			systemPrompt: [],
			task: "fixture",
			tools: [],
			retryFallback: { primary: "primary/model:high", chain: ["backup/model:medium"] },
		});
		const parent = {
			sessionId: "parent",
			isDisposed: false,
			sessionManager: { getSessionId: () => "parent" },
		} as unknown as AgentSession;
		const other = {
			sessionId: "other",
			isDisposed: false,
			sessionManager: { getSessionId: () => "other" },
		} as unknown as AgentSession;
		const childModel = getBundledModel("anthropic", "claude-sonnet-4-5")!;
		const child = {
			sessionId: "child",
			isDisposed: false,
			activeToolExecutionUpdates: () => [],
			sessionManager: manager,
			model: childModel,
			servingModel: { selector: "backup/model:medium", modelIdentity: "backup/model", isFallback: true },
			configuredThinkingLevel: () => "auto",
			thinkingLevel: "medium",
		} as unknown as AgentSession;
		const refs = [
			{ id: "Main", kind: "main", session: parent },
			{ id: "Child", kind: "sub", parentId: "Main", session: child },
			{ id: "Other", kind: "main", session: other },
			{ id: "Foreign", kind: "sub", parentId: "Other", session: child },
		] as unknown as AgentRef[];
		const registry = AgentRegistry.global();
		const list = spyOn(registry, "list").mockReturnValue(refs);
		const get = spyOn(registry, "get").mockImplementation(id => refs.find(ref => ref.id === id));
		try {
			const service = new StudioAgentModelService(parent);
			const result = await service.execute({ kind: "agent.model.inspect", sessionId: "parent", agentId: "Child" });
			expect(result).toMatchObject({
				agentId: "Child",
				source: "live",
				selectedModel: childModel.provider + "/" + childModel.id,
				configuredThinking: "auto",
				effectiveThinking: "medium",
				servingModel: "backup/model",
				usingFallback: true,
				candidates: ["primary/model:high", "backup/model:medium"],
				candidatesTruncated: false,
			});
			await expect(
				service.execute({ kind: "agent.model.inspect", sessionId: "parent", agentId: "Foreign" }),
			).rejects.toMatchObject({ code: "UNAVAILABLE" });
			await expect(
				service.execute({ kind: "agent.model.inspect", sessionId: "other", agentId: "Child" }),
			).rejects.toMatchObject({ code: "UNAVAILABLE" });
			await expect(
				service.execute({ kind: "agent.model.inspect", sessionId: "parent", agentId: "Missing" }),
			).rejects.toMatchObject({ code: "UNAVAILABLE" });
		} finally {
			get.mockRestore();
			list.mockRestore();
			await manager.close();
		}
	});

	test("reads parked configuration through the existing loader, never a live session or guessed model", async () => {
		const parent = {
			sessionId: "parent",
			isDisposed: false,
			sessionManager: { getSessionId: () => "parent" },
		} as unknown as AgentSession;
		const parked = {
			id: "Parked",
			kind: "sub",
			parentId: "Main",
			status: "parked",
			session: null,
			sessionFile: "/saved.jsonl",
		} as unknown as AgentRef;
		const bare = {
			id: "Bare",
			kind: "sub",
			parentId: "Main",
			status: "parked",
			session: null,
			sessionFile: "/bare.jsonl",
		} as unknown as AgentRef;
		const refs = [{ id: "Main", kind: "main", session: parent } as unknown as AgentRef, parked, bare];
		const registry = AgentRegistry.global();
		const list = spyOn(registry, "list").mockReturnValue(refs);
		const get = spyOn(registry, "get").mockImplementation(id => refs.find(ref => ref.id === id));
		const peek = spyOn(SessionManager, "peekSessionInit").mockImplementation(async filePath => {
			if (filePath === "/bare.jsonl") return { cwd: "/", init: null };
			const init: PersistedSessionInit = {
				systemPrompt: [],
				task: "",
				tools: [],
				resolvedModel: "saved/model",
				perCallThinkingLevel: ThinkingLevel.High,
				retryFallback: { primary: "primary/model:high", chain: ["backup/model:medium"] },
			};
			return { cwd: "/", init };
		});
		try {
			const service = new StudioAgentModelService(parent);
			expect(await service.execute({ kind: "agent.model.inspect", sessionId: "parent", agentId: "Parked" })).toEqual(
				{
					agentId: "Parked",
					source: "saved",
					selectedModel: "saved/model",
					configuredThinking: "high",
					candidates: ["primary/model:high", "backup/model:medium"],
					candidatesTruncated: false,
				},
			);
			expect(await service.execute({ kind: "agent.model.inspect", sessionId: "parent", agentId: "Bare" })).toEqual({
				agentId: "Bare",
				source: "saved",
			});
			expect(parked.session).toBeNull();
			expect(peek).toHaveBeenCalledTimes(2);

			const pending = Promise.withResolvers<{ cwd: string; init: PersistedSessionInit | null } | null>();
			peek.mockImplementationOnce(() => pending.promise);
			const reading = service.execute({ kind: "agent.model.inspect", sessionId: "parent", agentId: "Parked" });
			parked.parentId = "Unrelated";
			pending.resolve({
				cwd: "/",
				init: {
					systemPrompt: [],
					task: "",
					tools: [],
					resolvedModel: "foreign/model",
				},
			});
			await expect(reading).rejects.toMatchObject({ code: "UNAVAILABLE" });
			parked.parentId = "Parked";
			await expect(
				service.execute({ kind: "agent.model.inspect", sessionId: "parent", agentId: "Parked" }),
			).rejects.toMatchObject({ code: "UNAVAILABLE" });
		} finally {
			peek.mockRestore();
			get.mockRestore();
			list.mockRestore();
		}
	});

	test("projects later active-branch model/thinking changes and old journals, keeping per-call pins exact", async () => {
		using directory = TempDir.createSync("@zeta-studio-agent-model-");
		const timestamp = "2026-11-16T00:00:00.000Z";
		const files = {
			later: path.join(directory.path(), "later.jsonl"),
			old: path.join(directory.path(), "old.jsonl"),
			pinned: path.join(directory.path(), "pinned.jsonl"),
		};
		const header = (id: string) =>
			JSON.stringify({ type: "session", version: 3, id, timestamp, cwd: directory.path() });
		const line = (value: unknown) => JSON.stringify(value);
		await Bun.write(
			files.later,
			[
				header("later"),
				line({
					type: "session_init",
					id: "init",
					parentId: null,
					timestamp,
					systemPrompt: [],
					task: "",
					tools: [],
					resolvedModel: "spawn/model",
				}),
				line({ type: "model_change", id: "m1", parentId: "init", timestamp, model: "default/model" }),
				line({
					type: "thinking_level_change",
					id: "t1",
					parentId: "m1",
					timestamp,
					thinkingLevel: "low",
					configured: "low",
				}),
				line({
					type: "model_change",
					id: "m2",
					parentId: "t1",
					timestamp,
					model: "local/model",
					role: "temporary",
				}),
				line({
					type: "thinking_level_change",
					id: "t2",
					parentId: "m2",
					timestamp,
					thinkingLevel: "high",
					configured: "high",
				}),
			].join("\n") + "\n",
		);
		await Bun.write(
			files.old,
			[
				header("old"),
				line({
					type: "message",
					id: "m1",
					parentId: null,
					timestamp,
					message: {
						role: "assistant",
						provider: "old",
						model: "old-model",
						content: [{ type: "text", text: "legacy answer" }],
						timestamp: Date.parse(timestamp),
					},
				}),
			].join("\n") + "\n",
		);
		await Bun.write(
			files.pinned,
			[
				header("pinned"),
				line({
					type: "session_init",
					id: "init",
					parentId: null,
					timestamp,
					systemPrompt: [],
					task: "",
					tools: [],
					resolvedModel: "spawn/model",
					perCallModel: true,
					perCallModelIdentity: "pinned/model",
					perCallThinkingLevel: "medium",
				}),
				line({
					type: "model_change",
					id: "m1",
					parentId: "init",
					timestamp,
					model: "local/model",
					role: "temporary",
				}),
				line({
					type: "thinking_level_change",
					id: "t1",
					parentId: "m1",
					timestamp,
					thinkingLevel: "high",
					configured: "high",
				}),
			].join("\n") + "\n",
		);
		const parent = {
			sessionId: "parent",
			isDisposed: false,
			sessionManager: { getSessionId: () => "parent" },
		} as unknown as AgentSession;
		const refs = [
			{ id: "Main", kind: "main", session: parent },
			{ id: "Later", kind: "sub", parentId: "Main", session: null, sessionFile: files.later },
			{ id: "Old", kind: "sub", parentId: "Main", session: null, sessionFile: files.old },
			{ id: "Pinned", kind: "sub", parentId: "Main", session: null, sessionFile: files.pinned },
		] as unknown as AgentRef[];
		const registry = AgentRegistry.global();
		const list = spyOn(registry, "list").mockReturnValue(refs);
		const get = spyOn(registry, "get").mockImplementation(id => refs.find(ref => ref.id === id));
		try {
			const service = new StudioAgentModelService(parent);
			expect(await service.execute({ kind: "agent.model.inspect", sessionId: "parent", agentId: "Later" })).toEqual({
				agentId: "Later",
				source: "saved",
				selectedModel: "local/model",
				configuredThinking: "high",
				effectiveThinking: "high",
			});
			expect(await service.execute({ kind: "agent.model.inspect", sessionId: "parent", agentId: "Old" })).toEqual({
				agentId: "Old",
				source: "saved",
				selectedModel: "old/old-model",
			});
			expect(await service.execute({ kind: "agent.model.inspect", sessionId: "parent", agentId: "Pinned" })).toEqual(
				{
					agentId: "Pinned",
					source: "saved",
					selectedModel: "pinned/model",
					configuredThinking: "medium",
				},
			);
		} finally {
			get.mockRestore();
			list.mockRestore();
		}
	});
});
