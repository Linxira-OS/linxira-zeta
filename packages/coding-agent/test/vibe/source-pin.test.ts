/**
 * A /resume navigation pins Vibe workers to their source transcript instead of
 * cancelling them. Queued follow-ups, in-flight turn jobs, and the source write
 * serializer must all survive the pin/reattach cycle.
 */
import { afterEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Snowflake, TempDir } from "@linxiraos/pi-utils";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AsyncJobManager } from "@linxiraos/zeta/async/job-manager";
import { AgentRegistry } from "@linxiraos/zeta/registry/agent-registry";
import type { AgentSessionHandle } from "@linxiraos/zeta/session/agent-session-handle";
import * as executorModule from "@linxiraos/zeta/task/executor";
import type { FollowUpTurnOptions } from "@linxiraos/zeta/task/executor";
import { parseLifecycleEvent, VIBE_LIFECYCLE_CUSTOM_TYPE } from "@linxiraos/zeta/vibe/lifecycle";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import type { ToolSession } from "@linxiraos/zeta/tools";
import { VibeSessionRegistry } from "@linxiraos/zeta/vibe/runtime";

describe("Vibe source pinning across /resume", () => {
	afterEach(() => {
		VibeSessionRegistry.resetGlobalForTests();
		vi.restoreAllMocks();
		AgentRegistry.resetGlobalForTests();
	});

	it("keeps a queued follow-up and the in-flight turn across pin and reattach", async () => {
		using tempDir = TempDir.createSync("@pi-vibe-source-pin-");
		const source = SessionManager.create(tempDir.path(), tempDir.path());
		source.appendMessage({ role: "user", content: "director session", timestamp: 1 });
		await source.ensureOnDisk();
		const sourceId = source.getSessionId();
		const rawSourceFile = source.getSessionFile();
		if (!rawSourceFile) throw new Error("Expected a persisted source session");
		const sourceFile = path.resolve(rawSourceFile);

		const registry = VibeSessionRegistry.global();
		const toolSession = {
			cwd: tempDir.path(),
			hasUI: false,
			getAgentId: () => "Main",
			getSessionId: () => sourceId,
			getSessionFile: () => sourceFile,
			sessionManager: source,
			settings: Settings.isolated(),
		} as unknown as ToolSession;
		const workerId = `source-pin-${Snowflake.next()}`;
		registry.registerRecordForTests({
			id: workerId,
			ownerId: "Main",
			parentSessionId: sourceId,
			parentSessionFile: sourceFile,
			childSessionFile: `${workerId}.jsonl`,
			jobId: `${workerId}-t1`,
		});

		expect(await registry.send(toolSession, { session: workerId, message: "queued while streaming" })).toMatchObject({
			mode: "queued",
		});
		expect(registry.screens(toolSession, [workerId])[0]?.queued).toBe(1);

		const scope = registry.ownerScope(toolSession);
		registry.pinScopeToSource(scope, {
			parentSessionId: sourceId,
			parentSessionFile: sourceFile,
			leafId: source.getLeafId(),
			sessionManager: source,
		});

		// Pinning does not clear the queue or the in-flight turn.
		expect(registry.hasPendingWorkForTranscript(sourceId, sourceFile)).toBe(true);
		expect(await registry.send(toolSession, { session: workerId, message: "queued after pin" })).toMatchObject({
			mode: "queued",
		});
		expect(registry.screens(toolSession, [workerId])[0]?.queued).toBe(2);

		// Returning to the source reattaches the same live record; nothing was
		// tombstoned and the queued directives remain for the next turn.
		const reattached = registry.reattachScopeToLive(sourceId, sourceFile);
		expect(reattached).toBe(1);
		expect(registry.listIds(toolSession)).toContain(workerId);
		expect(registry.screens(toolSession, [workerId])[0]?.queued).toBe(2);
		expect(registry.hasPendingWorkForTranscript(sourceId, sourceFile)).toBe(true);
		await source.close();
	});

	it("runs a queued follow-up against the pinned source artifacts and journal after navigation", async () => {
		using temp = TempDir.createSync("@vibe-queued-source-artifacts-");
		const source = SessionManager.create(temp.path(), temp.path());
		const target = SessionManager.create(temp.path(), temp.path());
		source.appendMessage({ role: "user", content: "source", timestamp: 1 });
		target.appendMessage({ role: "user", content: "target", timestamp: 2 });
		await source.ensureOnDisk();
		await target.ensureOnDisk();
		const sourceFile = path.resolve(source.getSessionFile()!);
		const sourceId = source.getSessionId();
		const targetFile = path.resolve(target.getSessionFile()!);
		let active = source;
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		const owner = {
			cwd: temp.path(),
			settings: Settings.isolated(),
			asyncJobManager: manager,
			get sessionManager() {
				return active;
			},
			getAgentId: () => "Main",
			getSessionId: () => active.getSessionId(),
			getSessionFile: () => active.getSessionFile(),
			getArtifactsDir: () => active.getSessionFile()?.slice(0, -6),
			taskDepth: 0,
			enableLsp: false,
		} as unknown as ToolSession;
		const firstStarted = Promise.withResolvers<void>();
		const finishFirst = Promise.withResolvers<void>();
		const finishFollowUp = Promise.withResolvers<void>();
		const followUpStarted = Promise.withResolvers<FollowUpTurnOptions>();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			firstStarted.resolve();
			await finishFirst.promise;
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				parentId: "Main",
				status: "idle",
				session: { dispose: async () => {} } as unknown as AgentSessionHandle,
				sessionFile: path.join(sourceFile.slice(0, -6), `${options.id}.jsonl`),
			});
			return {
				index: 0,
				id: options.id,
				agent: options.agent.name,
				agentSource: "bundled",
				task: options.task,
				exitCode: 0,
				output: "first result",
				stderr: "",
				truncated: false,
				durationMs: 1,
				tokens: 0,
				requests: 0,
			};
		});
		vi.spyOn(executorModule, "runSubagentFollowUpTurn").mockImplementation(async options => {
			followUpStarted.resolve(options);
			await finishFollowUp.promise;
			const outputPath = path.join(options.artifactsDir!, `${options.id}.md`);
			await fs.writeFile(outputPath, "QUEUED SOURCE RESULT");
			return {
				index: 0,
				id: options.id,
				agent: options.agent.name,
				agentSource: "bundled",
				task: options.message,
				exitCode: 0,
				output: "QUEUED SOURCE RESULT",
				outputPath,
				stderr: "",
				truncated: false,
				durationMs: 1,
				tokens: 0,
				requests: 0,
			};
		});
		try {
			const registry = VibeSessionRegistry.global();
			const spawned = await registry.spawn(owner, { cli: "fast", role: "tests", prompt: "first task" });
			await firstStarted.promise;
			expect(await registry.send(owner, { session: spawned.id, message: "queued directive" })).toMatchObject({
				mode: "queued",
			});
			const scope = registry.ownerScope(owner);
			registry.pinScopeToSource(scope, {
				parentSessionId: sourceId,
				parentSessionFile: sourceFile,
				sessionManager: source,
			});
			active = target;
			finishFirst.resolve();
			const followUp = await followUpStarted.promise;
			expect(followUp.artifactsDir).toBe(sourceFile.slice(0, -6));
			expect(followUp.message).toBe("queued directive");
			expect(registry.ownerScopes()).toContainEqual(scope);
			expect(registry.view(scope)[0]).toMatchObject({ id: spawned.id, turns: 2, createdAt: expect.any(Number) });
			const job = manager.getRunningJobs({ ownerId: "Main" }).find(entry => entry.id !== spawned.jobId)!;
			expect(job.origin).toEqual({ sessionId: sourceId, sessionFile: sourceFile });
			finishFollowUp.resolve();
			await manager.waitForAll();
			expect(job.status).toBe("completed");
			expect(await fs.readFile(path.join(sourceFile.slice(0, -6), `${spawned.id}.md`), "utf8")).toBe(
				"QUEUED SOURCE RESULT",
			);
			expect(
				await fs.access(path.join(targetFile.slice(0, -6), `${spawned.id}.md`)).then(
					() => true,
					() => false,
				),
			).toBe(false);
			const persisted = await SessionManager.open(sourceFile, undefined, undefined, { throwIfMissing: true });
			try {
				const settled = persisted.getEntries().flatMap(entry => {
					if (entry.type !== "custom" || entry.customType !== VIBE_LIFECYCLE_CUSTOM_TYPE) return [];
					const event = parseLifecycleEvent(entry.data);
					return event?.action === "turn-settled" ? [event.turn] : [];
				});
				expect(settled).toEqual([1, 2]);
			} finally {
				await persisted.close();
			}
			expect(
				target
					.getEntries()
					.some(entry => entry.type === "custom" && entry.customType === VIBE_LIFECYCLE_CUSTOM_TYPE),
			).toBe(false);
		} finally {
			finishFirst.resolve();
			finishFollowUp.resolve();
			await manager.dispose({ timeoutMs: 100 });
			await source.close();
			await target.close();
		}
	});

	it("does not pin records whose parent transcript is different", async () => {
		using tempDir = TempDir.createSync("@pi-vibe-source-scope-");
		const registry = VibeSessionRegistry.global();
		const workerId = `source-miss-${Snowflake.next()}`;
		registry.registerRecordForTests({
			id: workerId,
			ownerId: "Main",
			parentSessionId: "source-a",
			parentSessionFile: tempDir.join("a.jsonl"),
			jobId: `${workerId}-t1`,
		});
		const scope = { ownerId: "Main", parentSessionId: "source-b", parentSessionFile: tempDir.join("b.jsonl") };
		expect(
			registry.pinScopeToSource(scope, {
				parentSessionId: "source-b",
				parentSessionFile: tempDir.join("b.jsonl"),
				sessionManager: SessionManager.inMemory(tempDir.path()),
			}),
		).toBe(0);
		expect(registry.reattachScopeToLive("source-b", tempDir.join("b.jsonl"))).toBe(0);
		expect(registry.hasPendingWorkForTranscript("source-a", tempDir.join("a.jsonl"))).toBe(true);
	});
});
