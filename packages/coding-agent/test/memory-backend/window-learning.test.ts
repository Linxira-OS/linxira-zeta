import { afterEach, describe, expect, it } from "bun:test";
import { TempDir } from "@linxiraos/pi-utils";
import { Settings } from "@linxiraos/zeta/config/settings";
import { admitWindowCandidates, extractTasteWindow } from "@linxiraos/zeta/taste/window-extract";
import { WindowLearningQueue } from "@linxiraos/zeta/memory-backend/window-queue";
import { startWindowLearning } from "@linxiraos/zeta/memory-backend/window-learning";
import type { MemoryLearningWindow } from "@linxiraos/zeta/memory-backend/window-types";
import { runTasteConsolidation } from "@linxiraos/zeta/taste/consolidate";
import { appendTasteCandidate } from "@linxiraos/zeta/taste/queue";
import { resolveTasteScopes } from "@linxiraos/zeta/taste/scope";
import { readTasteScope, readTasteState } from "@linxiraos/zeta/taste/store";

let temp: TempDir | undefined;
afterEach(() => {
	temp?.removeSync();
	temp = undefined;
});

function root(): TempDir {
	temp = TempDir.createSync("@window-learning-");
	return temp;
}

function window(id: string, messages: MemoryLearningWindow["messages"], entryIds: string[]): Omit<Parameters<WindowLearningQueue["capture"]>[0], "memory" | "taste"> {
	return { id, messages, entryIds };
}

describe("durable window journal", () => {
	it("commits one snapshot per entry id and never recaptures a processed entry", async () => {
		const dir = root().path();
		const queue = new WindowLearningQueue(dir, "repo:example", "session-a");
		const first = window("compact-1", [{ role: "user", content: "Use explicit return types" }], ["e1"]);
		await queue.capture({ ...first, memory: true, taste: false });
		await queue.capture({ ...first, memory: true, taste: false });
		expect((await queue.pending()).length).toBe(1);

		let runs = 0;
		await queue.process(async () => {
			runs++;
		});
		expect(runs).toBe(1);
		expect((await queue.pending()).length).toBe(0);

		// A later window containing an already processed entry learns only the new tail.
		let observed: MemoryLearningWindow["messages"] = [];
		await queue.capture({
			...window("compact-2", [{ role: "user", content: "Use explicit return types" }, { role: "user", content: "New rule" }], ["e1", "e2"]),
			memory: true,
			taste: false,
		});
		await queue.process(async item => {
			observed = item.messages;
		});
		expect(observed).toEqual([{ role: "user", content: "New rule" }]);
	});

	it("replays pending work after restart and keeps completed ids completed", async () => {
		const dir = root().path();
		const first = new WindowLearningQueue(dir, "repo:example", "session-a");
		await first.capture({ ...window("compact-1", [{ role: "user", content: "Keep evidence verbatim" }], ["e1"]), memory: true, taste: false });
		await first.capture({ ...window("compact-2", [{ role: "user", content: "Prefer narrow exports" }], ["e2"]), memory: true, taste: false });

		let runs = 0;
		await first.process(async () => {
			runs++;
			throw new Error("provider unavailable");
		}).catch(() => {});
		expect(runs).toBe(1);
		expect((await first.pending()).length).toBe(2);

		const restarted = new WindowLearningQueue(dir, "repo:example", "session-a");
		const ids: string[] = [];
		await restarted.process(async item => {
			ids.push(item.id);
		});
		expect(ids).toEqual(["compact-1", "compact-2"]);
		await restarted.capture({ ...window("compact-1", [{ role: "user", content: "Keep evidence verbatim" }], ["e1"]), memory: true, taste: false });
		expect((await restarted.pending()).length).toBe(0);
	});

	it("isolates journal namespaces and records empty windows without model work", async () => {
		const dir = root().path();
		const project = new WindowLearningQueue(dir, "repo:alpha", "session-a");
		const binding = new WindowLearningQueue(dir, "im:slack:profile:dm", "session-a");
		expect(project.file).not.toBe(binding.file);
		await project.capture({ ...window("empty", [], []), memory: true, taste: true });
		expect((await project.pending()).length).toBe(0);
		expect((await binding.pending()).length).toBe(0);
	});
});

describe("short session boundary", () => {
	it("flushes the short session once at stop and delegates the bounded region", async () => {
		const dir = root().path();
		const entry = {
			type: "message" as const,
			id: "e1",
			timestamp: "2026-01-01T00:00:00.000Z",
			message: { role: "user" as const, content: [{ type: "text" as const, text: "Prefer narrow exports" }] },
		};
		const listeners = new Set<(commit: never) => void | Promise<void>>();
		let retained = 0;
		const fakeSession = {
			sessionId: "session-short",
			messages: [],
			sessionManager: {
				getBranch: () => [entry],
				getEntries: () => [entry],
				getEntry: (id: string) => (id === entry.id ? entry : undefined),
				getCwd: () => dir,
			},
			getAgentId: () => "Main",
			getHindsightSessionState: () => ({
				aliasOf: undefined,
				enqueueRetain: async () => {
					retained++;
					return 1;
				},
			}),
			subscribe: () => () => {},
			onCompactionCommit: (listener: (commit: never) => void | Promise<void>) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		};
		const settings = Settings.isolated({
			"memory.backend": "hindsight",
			"memory.extractionMode": "window",
		});
		const handle = await startWindowLearning({
			session: fakeSession as never,
			settings,
			modelRegistry: { getAvailable: () => [] } as never,
			agentDir: dir,
			namespace: "repo:example",
			taskDepth: 0,
		});
		const commit = { entry: { id: "compact-1" }, cutPoint: { discardedEntryIds: ["e1"] } };
		for (const listener of listeners) {
			await listener(commit as never);
			await listener(commit as never);
		}
		const before = new WindowLearningQueue(dir, "repo:example", "session-short");
		expect((await before.pending()).length).toBe(1);
		await handle.stop();
		const queue = new WindowLearningQueue(dir, "repo:example", "session-short");
		expect((await queue.pending()).length).toBe(0);
		expect(retained).toBe(1);
		const journal = (await Bun.file(queue.file).json()) as { processed: string[]; entries: string[] };
		expect(journal.entries).toEqual(["e1"]);
		expect([...journal.processed].sort()).toEqual(["compact-1", "stop:session-short:e1"].sort());

		// A second stop with the same branch is not a new window.
		await handle.stop();
		const after = (await Bun.file(queue.file).json()) as { processed: string[] };
		expect(after.processed.length).toBe(2);
	});
});

describe("window candidate host rules", () => {
	it("accepts only verbatim user evidence and deduplicates a repeated statement", () => {
		const source: MemoryLearningWindow = {
			id: "compact-1",
			messages: [
				{ role: "user", content: "Please avoid barrel files in src" },
				{ role: "assistant", content: "Avoid barrel files in src" },
			],
		};
		const candidates = admitWindowCandidates(
			[
				{ category: "typescript", statement: "Avoids barrel files", polarity: "avoid", evidenceText: "avoid barrel files" },
				{ category: "typescript", statement: "Avoids barrel files", polarity: "avoid", evidenceText: "avoid barrel files" },
				{ category: "typescript", statement: "Avoids barrel files", polarity: "avoid", evidenceText: "barrel files in src" },
			],
			source,
			"session-a",
		);
		expect(candidates.length).toBe(1);
		expect(candidates[0]?.sourceId).toMatch(/^[a-f0-9]{64}$/);
		expect(admitWindowCandidates(
			[{ category: "style", statement: "Avoids barrel files", polarity: "avoid", evidenceText: "barrel files in src" }],
			{ id: "compact-2", messages: [{ role: "assistant", content: "barrel files in src" }] },
			"session-a",
		)).toEqual([]);
	});

	it("does not count the same window source twice after a replay", async () => {
		const dir = root().path();
		const settings = Settings.isolated({ "taste.enabled": true, "taste.extractionMode": "window" });
		const scope = resolveTasteScopes({ cwd: dir }, settings)[0]!;
		const candidate = {
			v: 1 as const,
			ts: Date.now(),
			sessionId: "session-a",
			category: "typescript" as const,
			statement: "Prefers narrow exports",
			polarity: "prefer" as const,
			evidenceText: "prefer narrow exports",
			sourceId: "a".repeat(64),
		};
		const modelRegistry = { getAvailable: () => [], resolver: () => undefined };
		const options = { agentDir: dir, cwd: dir, settings, modelRegistry: modelRegistry as never, sessionId: "session-a", force: true };
		await appendTasteCandidate(dir, scope, candidate);
		await runTasteConsolidation(options);
		const first = await readTasteScope(dir, scope);
		expect(first.entries[0]?.mentions).toBe(1);
		expect((await readTasteState(dir, scope)).processedSources).toContain(candidate.sourceId);
		await appendTasteCandidate(dir, scope, candidate);
		await runTasteConsolidation(options);
		expect((await readTasteScope(dir, scope)).entries[0]?.mentions).toBe(1);
	});

	it("mnemopi llmMode none performs no window extraction request", async () => {
		const settings = Settings.isolated({
			"memory.backend": "mnemopi",
			"mnemopi.llmMode": "none",
			"taste.enabled": true,
			"taste.extractionMode": "window",
		});
		let modelCalls = 0;
		const modelRegistry = {
			getAvailable() {
				modelCalls++;
				return [];
			},
		};
		await extractTasteWindow({
			window: { id: "compact-1", messages: [{ role: "user", content: "Prefer narrow exports" }] },
			settings,
			modelRegistry: modelRegistry as never,
			sessionId: "session-a",
			agentDir: root().path(),
			scope: { domain: "projects", segments: ["example"] },
		});
		expect(modelCalls).toBe(0);
	});
});
