/** Team lifecycle behavior on the real journal, registry, task executor boundary, and lifecycle owner. */
import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TempDir } from "@linxiraos/pi-utils";
import type { SingleResult } from "@linxiraos/pi-tui/tools/task";
import { AsyncJobManager } from "@linxiraos/zeta/async/job-manager";
import { Settings } from "@linxiraos/zeta/config/settings";
import { resolveLocalRoot } from "@linxiraos/zeta/internal-urls";
import { AgentLifecycleManager } from "@linxiraos/zeta/registry/agent-lifecycle";
import * as lifecycleModule from "@linxiraos/zeta/registry/agent-lifecycle";
import { AgentRegistry } from "@linxiraos/zeta/registry/agent-registry";
import { getAgentTombstonePath } from "@linxiraos/zeta/registry/agent-tombstone";
import type { AgentSessionHandle } from "@linxiraos/zeta/session/agent-session-handle";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import type { ExecutorOptions } from "@linxiraos/zeta/task/executor";
import * as executorModule from "@linxiraos/zeta/task/executor";
import type { ToolSession } from "@linxiraos/zeta/tools";
import {
	parseLifecycleEvent,
	type VibeLifecycleEvent,
	type VibeSpawnLifecycleEvent,
	VIBE_LIFECYCLE_CUSTOM_TYPE,
	VIBE_LIFECYCLE_VERSION,
} from "@linxiraos/zeta/vibe/lifecycle";
import { VibeSessionRegistry } from "@linxiraos/zeta/vibe/runtime";
import { EventBus } from "@linxiraos/zeta/utils/event-bus";
import { TASK_SUBAGENT_LIFECYCLE_CHANNEL } from "@linxiraos/zeta/task/types";
import { RoomService } from "@linxiraos/zeta/rooms/service";
import { roomRuntime } from "@linxiraos/zeta/rooms/transport";
import { ensureTeam, history, post, resetTeamRoomsForTests } from "@linxiraos/zeta/vibe/team-rooms";
import { IrcBus } from "@linxiraos/zeta/irc/bus";
import type { IrcMessage } from "@linxiraos/pi-tui/tools/irc";

const managers: AsyncJobManager[] = [];
const journals: SessionManager[] = [];
const directories: TempDir[] = [];

function directory(prefix: string): TempDir {
	const temp = TempDir.createSync(prefix);
	directories.push(temp);
	return temp;
}

function parent(journal: SessionManager): ToolSession {
	const manager = new AsyncJobManager({ onJobComplete: () => {} });
	managers.push(manager);
	return {
		cwd: journal.getCwd(),
		settings: Settings.isolated(),
		asyncJobManager: manager,
		sessionManager: journal,
		getAgentId: () => "Main",
		getSessionId: () => journal.getSessionId(),
		getSessionFile: () => journal.getSessionFile(),
		getArtifactsDir: () => journal.getSessionFile()?.slice(0, -6) ?? null,
		taskDepth: 0,
		enableLsp: false,
	} as unknown as ToolSession;
}

async function persistedParent(cwd: string): Promise<SessionManager> {
	const journal = SessionManager.create(cwd, path.join(cwd, "sessions"));
	journals.push(journal);
	journal.appendMessage({ role: "user", content: "Team owner", timestamp: 1 });
	await journal.ensureOnDisk();
	return journal;
}

async function childTranscript(file: string, cwd: string): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const child = await SessionManager.open(file, path.dirname(file), undefined, {
		initialCwd: cwd,
		suppressBreadcrumb: true,
	});
	try {
		child.appendSessionInit({
			systemPrompt: ["worker"],
			task: "module work",
			agent: "sonic",
			tools: ["read", "yield"],
			spawns: "*",
		});
		child.appendMessage({ role: "user", content: "saved worker assignment", timestamp: 2 });
		await child.ensureOnDisk();
	} finally {
		await child.close();
	}
}

function events(journal: SessionManager): VibeLifecycleEvent[] {
	return journal.getEntries().flatMap(entry => {
		if (entry.type !== "custom" || entry.customType !== VIBE_LIFECYCLE_CUSTOM_TYPE) return [];
		const event = parseLifecycleEvent(entry.data);
		return event ? [event] : [];
	});
}

function result(options: Pick<ExecutorOptions, "id" | "agent" | "task">): SingleResult {
	return {
		index: 0,
		id: options.id,
		agent: options.agent.name,
		agentSource: "bundled",
		task: options.task,
		exitCode: 0,
		output: "accepted output",
		stderr: "",
		truncated: false,
		durationMs: 1,
		tokens: 0,
		requests: 0,
	};
}

function sessionHandle(dispose = async () => {}): AgentSessionHandle {
	return {
		dispose,
		sessionManager: { getUsageStatistics: () => ({ cost: 0, subagentCost: 0 }) },
	} as unknown as AgentSessionHandle;
}

function registerIdle(options: ExecutorOptions, live = sessionHandle()) {
	return AgentRegistry.global().register({
		id: options.id,
		displayName: options.id,
		kind: "sub",
		parentId: "Main",
		status: "idle",
		session: live,
		sessionFile: path.join(options.artifactsDir!, `${options.id}.jsonl`),
	});
}

function appendWorker(
	journal: SessionManager,
	id: string,
	options: { ephemeral?: boolean; accepted?: boolean; expiresAt?: number; terminal?: boolean } = {},
): VibeSpawnLifecycleEvent {
	const base = {
		version: VIBE_LIFECYCLE_VERSION,
		id,
		ownerId: "Main",
		parentSessionId: journal.getSessionId(),
	} as const;
	const spawn: VibeSpawnLifecycleEvent = {
		...base,
		action: "spawn",
		cli: "fast",
		agent: "sonic",
		childSessionFile: `${id}.jsonl`,
		createdAt: Date.now(),
		identity: { role: "tests", generation: 3, lifecycle: options.ephemeral ? "ephemeral" : "resident" },
		...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
	};
	journal.appendCustomEntry(VIBE_LIFECYCLE_CUSTOM_TYPE, spawn);
	journal.appendCustomEntry(VIBE_LIFECYCLE_CUSTOM_TYPE, { ...base, action: "turn-started", turn: 1 });
	journal.appendCustomEntry(VIBE_LIFECYCLE_CUSTOM_TYPE, {
		...base,
		action: "turn-settled",
		turn: 1,
		...(options.accepted === undefined ? {} : { accepted: options.accepted }),
	});
	if (options.terminal)
		journal.appendCustomEntry(VIBE_LIFECYCLE_CUSTOM_TYPE, { ...base, action: "tombstone", reason: "mode-exit" });
	return spawn;
}

async function flushAsync(): Promise<void> {
	for (let i = 0; i < 30; i++) await Promise.resolve();
}

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	VibeSessionRegistry.resetGlobalForTests();
	for (const manager of managers.splice(0)) await manager.dispose({ timeoutMs: 100 });
	AgentLifecycleManager.resetGlobalForTests();
	AgentRegistry.resetGlobalForTests();
	for (const journal of journals.splice(0)) await journal.close();
	for (const temp of directories.splice(0)) temp.removeSync();
});

describe("Vibe lifecycle classes", () => {
	it("delivers startup-pending Team rounds once the exact child attaches, without another post", async () => {
		const temp = directory("@team-startup-delivery-");
		const journal = await persistedParent(temp.path());
		const bus = new EventBus();
		const owner = { ...parent(journal), eventBus: bus };
		const rooms = new RoomService(path.join(temp.path(), "startup-rooms.db"));
		resetTeamRoomsForTests();
		IrcBus.resetGlobalForTests();
		roomRuntime(() => rooms);
		const registry = VibeSessionRegistry.global();
		const scope = registry.ownerScope(owner);
		const main = { ...sessionHandle(), sessionManager: journal } as unknown as AgentSessionHandle;
		AgentRegistry.global().register({
			id: "Main",
			displayName: "Main",
			kind: "main",
			status: "idle",
			session: main,
			sessionFile: journal.getSessionFile(),
		});
		ensureTeam(scope);
		registry.activateScope(scope, true);
		const startup = Promise.withResolvers<ExecutorOptions>();
		const attach = Promise.withResolvers<void>();
		const finish = Promise.withResolvers<void>();
		const delivered = Promise.withResolvers<void>();
		const received: IrcMessage[] = [];
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			startup.resolve(options);
			await attach.promise;
			const live = {
				...sessionHandle(),
				deliverIrcMessage: async (message: IrcMessage) => {
					received.push(message);
					delivered.resolve();
					return "injected";
				},
			} as unknown as AgentSessionHandle;
			registerIdle(options, live);
			const frame = {
				id: options.id,
				status: "started",
				sessionFile: path.join(options.artifactsDir!, `${options.id}.jsonl`),
			};
			bus.emit(TASK_SUBAGENT_LIFECYCLE_CHANNEL, frame);
			bus.emit(TASK_SUBAGENT_LIFECYCLE_CHANNEL, frame);
			await finish.promise;
			return result(options);
		});
		try {
			const spawned = await registry.spawn(owner, { cli: "fast", role: "api", prompt: "startup work" });
			const options = await startup.promise;
			const posted = await post(scope, "Main", "first pending message");
			const roundId = rooms.log.getEvent(history(scope).roomId, posted.event.seq)?.roundId;
			if (!roundId) throw new Error("Expected a durable room delivery round");
			expect(posted.deliveries.find(row => row.agentId === spawned.id)?.accepted).toBe(false);
			expect(rooms.log.listRoundTargets(roundId).find(row => row.memberId === spawned.id)?.status).toBe("pending");
			bus.emit(TASK_SUBAGENT_LIFECYCLE_CHANNEL, {
				id: spawned.id,
				status: "started",
				sessionFile: path.join(options.artifactsDir!, "other.jsonl"),
			});
			expect(received).toEqual([]);
			attach.resolve();
			await delivered.promise;
			await flushAsync();
			expect(received.map(message => message.body)).toEqual([expect.stringContaining(`:${posted.event.seq}]`)]);
			expect(rooms.log.listRoundTargets(roundId).find(row => row.memberId === spawned.id)?.status).toBe("delivered");
			expect(history(scope).lastSeq).toBe(posted.event.seq);
			expect(bus.hasListeners(TASK_SUBAGENT_LIFECYCLE_CHANNEL)).toBe(false);
		} finally {
			attach.resolve();
			finish.resolve();
			await owner.asyncJobManager?.waitForAll();
			registry.deactivateTeamScope(scope);
			rooms.close();
			resetTeamRoomsForTests();
			IrcBus.resetGlobalForTests();
		}
	});

	it("persists accepted ephemeral completion before releasing its session and removes only worker scratch", async () => {
		const temp = directory("@vibe-ephemeral-completion-");
		const journal = await persistedParent(temp.path());
		const owner = parent(journal);
		let scratch = "";
		let output = "";
		const disposed = vi.fn(async () => {
			const reopened = await SessionManager.open(journal.getSessionFile()!, undefined, undefined, {
				throwIfMissing: true,
			});
			try {
				expect(events(reopened)).toContainEqual(
					expect.objectContaining({ action: "tombstone", reason: "completed" }),
				);
			} finally {
				await reopened.close();
			}
		});
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			await childTranscript(path.join(options.artifactsDir!, `${options.id}.jsonl`), temp.path());
			const local = resolveLocalRoot({
				getArtifactsDir: () => options.artifactsDir!,
				getSessionId: () => journal.getSessionId(),
			});
			scratch = path.join(local, "agents", options.id);
			await fs.mkdir(scratch, { recursive: true });
			await fs.writeFile(path.join(scratch, "notes.txt"), "temporary");
			await fs.mkdir(path.join(local, "shared"), { recursive: true });
			await fs.writeFile(path.join(local, "shared", "owner.txt"), "retained");
			output = path.join(options.artifactsDir!, `${options.id}.md`);
			await fs.writeFile(output, "final output");
			registerIdle(options, sessionHandle(disposed));
			return { ...result(options), outputPath: output };
		});
		const registry = VibeSessionRegistry.global();
		const spawned = await registry.spawn(owner, {
			cli: "fast",
			role: "tests",
			lifecycle: "ephemeral",
			prompt: "one task",
		});
		await owner.asyncJobManager!.getJob(spawned.jobId)!.promise;
		expect(owner.asyncJobManager!.getJob(spawned.jobId)!.status).toBe("completed");
		expect(disposed).toHaveBeenCalledTimes(1);
		expect(registry.listIds(owner)).toEqual([]);
		expect(registry.view(registry.ownerScope(owner))[0]).toMatchObject({
			state: "dead",
			identity: { lifecycle: "ephemeral" },
		});
		expect(AgentRegistry.global().get(spawned.id)).toMatchObject({ status: "aborted", session: null });
		expect(
			await fs.access(scratch).then(
				() => true,
				() => false,
			),
		).toBe(false);
		expect(await fs.readFile(output, "utf8")).toBe("final output");
		expect(await fs.readFile(path.resolve(scratch, "..", "..", "shared", "owner.txt"), "utf8")).toBe("retained");
		expect(events(journal)).toContainEqual(expect.objectContaining({ action: "turn-settled", accepted: true }));
		await expect(registry.send(owner, { session: spawned.id, message: "revive" })).rejects.toThrow("dead");
	});

	it("drains queued directives before accepting an ephemeral's terminal completion", async () => {
		const temp = directory("@vibe-ephemeral-queue-");
		const journal = await persistedParent(temp.path());
		const owner = parent(journal);
		const started = Promise.withResolvers<void>();
		const finishFirst = Promise.withResolvers<void>();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			started.resolve();
			await finishFirst.promise;
			registerIdle(options);
			return result(options);
		});
		const followUp = vi
			.spyOn(executorModule, "runSubagentFollowUpTurn")
			.mockImplementation(async options => result({ id: options.id, agent: options.agent, task: options.message }));
		const registry = VibeSessionRegistry.global();
		const spawned = await registry.spawn(owner, {
			cli: "fast",
			role: "tests",
			lifecycle: "ephemeral",
			prompt: "first",
		});
		await started.promise;
		expect(await registry.send(owner, { session: spawned.id, message: "finish this too" })).toMatchObject({
			mode: "queued",
		});
		finishFirst.resolve();
		await owner.asyncJobManager!.getJob(spawned.jobId)!.promise;
		const next = owner.asyncJobManager!.getAllJobs({ ownerId: "Main" }).find(job => job.id !== spawned.jobId)!;
		await next.promise;
		expect(followUp).toHaveBeenCalledTimes(1);
		expect(followUp.mock.calls[0][0].message).toBe("finish this too");
		expect(events(journal).filter(event => event.action === "turn-settled")).toEqual([
			expect.objectContaining({ turn: 1, accepted: false }),
			expect.objectContaining({ turn: 2, accepted: true }),
		]);
		expect(events(journal).filter(event => event.action === "tombstone")).toEqual([
			expect.objectContaining({ reason: "completed" }),
		]);
	});

	it("cancels a running ephemeral at its bounded TTL through the existing job manager", async () => {
		const temp = directory("@vibe-ephemeral-ttl-");
		const journal = SessionManager.inMemory(temp.path());
		journals.push(journal);
		const owner = parent(journal);
		const started = Promise.withResolvers<void>();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			started.resolve();
			const stopped = Promise.withResolvers<void>();
			if (options.signal?.aborted) stopped.resolve();
			else options.signal?.addEventListener("abort", () => stopped.resolve(), { once: true });
			await stopped.promise;
			return { ...result(options), exitCode: 1, aborted: true };
		});
		const registry = VibeSessionRegistry.global();
		registry.setEphemeralTtlForTesting(20);
		vi.useFakeTimers();
		const spawned = await registry.spawn(owner, {
			cli: "fast",
			role: "tests",
			lifecycle: "ephemeral",
			prompt: "bounded task",
		});
		await started.promise;
		vi.advanceTimersByTime(20);
		await flushAsync();
		await owner.asyncJobManager!.getJob(spawned.jobId)!.promise;
		await registry.killAll(owner);
		expect(owner.asyncJobManager!.getJob(spawned.jobId)!.status).toBe("cancelled");
		expect(registry.screens(owner)[0]).toMatchObject({ state: "dead", killed: false, queued: 0 });
	});

	it("keeps resident context through idle TTL parking and owner follow-up revival", async () => {
		const temp = directory("@vibe-resident-revival-");
		const journal = await persistedParent(temp.path());
		const owner = parent(journal);
		const revived = sessionHandle();
		const revive = vi.fn(async () => revived);
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			const ref = registerIdle(options);
			AgentLifecycleManager.global().adopt(options.id, { idleTtlMs: 20, revive }, ref);
			return result(options);
		});
		const registry = VibeSessionRegistry.global();
		vi.useFakeTimers();
		const spawned = await registry.spawn(owner, { cli: "fast", role: "tests", prompt: "resident task" });
		await owner.asyncJobManager!.getJob(spawned.jobId)!.promise;
		vi.advanceTimersByTime(20);
		await flushAsync();
		expect(AgentRegistry.global().get(spawned.id)).toMatchObject({ status: "parked", session: null });
		vi.useRealTimers();
		vi.spyOn(executorModule, "runSubagentFollowUpTurn").mockImplementation(async options => {
			expect(await AgentLifecycleManager.global().ensureLive(options.id)).toBe(revived);
			return result({ id: options.id, agent: options.agent, task: options.message });
		});
		const follow = await registry.send(owner, { session: spawned.id, message: "next assignment" });
		await owner.asyncJobManager!.getJob(follow.jobId!)!.promise;
		expect(revive).toHaveBeenCalledTimes(1);
		expect(registry.screens(owner)[0]).toMatchObject({ state: "idle", turns: 2 });
		expect(events(journal).some(event => event.action === "tombstone")).toBe(false);
	});
});

describe("Vibe persisted lifecycle recovery", () => {
	it("rebuilds a resident from a closed and reopened parent journal and an actual child transcript", async () => {
		const temp = directory("@vibe-persisted-rehydrate-");
		const original = await persistedParent(temp.path());
		const sourceFile = original.getSessionFile()!;
		const child = path.join(sourceFile.slice(0, -6), "tests-3.jsonl");
		await childTranscript(child, temp.path());
		appendWorker(original, "tests-3");
		await original.flush();
		await original.close();
		const reopened = await SessionManager.open(sourceFile, undefined, undefined, { throwIfMissing: true });
		journals.push(reopened);
		const owner = parent(reopened);
		const registry = VibeSessionRegistry.global();
		expect(await registry.rehydrate(owner)).toBe(1);
		expect(await registry.rehydrate(owner)).toBe(0);
		expect(AgentRegistry.global().get("tests-3")).toMatchObject({
			parentId: "Main",
			status: "parked",
			session: null,
			sessionFile: child,
		});
		expect(registry.screens(owner)[0]).toMatchObject({
			id: "tests-3",
			turns: 1,
			identity: { role: "tests", generation: 3, lifecycle: "resident" },
		});
	});

	it("finishes accepted or expired ephemeral retirement after a restart without restoring live workers", async () => {
		const temp = directory("@vibe-ephemeral-rehydrate-");
		const original = await persistedParent(temp.path());
		const sourceFile = original.getSessionFile()!;
		for (const id of ["accepted-3", "expired-3"])
			await childTranscript(path.join(sourceFile.slice(0, -6), `${id}.jsonl`), temp.path());
		appendWorker(original, "accepted-3", { ephemeral: true, accepted: true, expiresAt: Date.now() + 60_000 });
		appendWorker(original, "expired-3", { ephemeral: true, expiresAt: Date.now() - 1 });
		await original.flush();
		await original.close();
		const reopened = await SessionManager.open(sourceFile, undefined, undefined, { throwIfMissing: true });
		journals.push(reopened);
		const owner = parent(reopened);
		expect(await VibeSessionRegistry.global().rehydrate(owner)).toBe(0);
		expect(events(reopened)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "accepted-3", action: "tombstone", reason: "completed" }),
				expect.objectContaining({ id: "expired-3", action: "tombstone", reason: "ttl-exceeded" }),
			]),
		);
		for (const id of ["accepted-3", "expired-3"]) expect(AgentRegistry.global().get(id)?.status).toBe("aborted");
	});

	it("recursively tombstones offline descendants before release and never crosses another root", async () => {
		const temp = directory("@vibe-recursive-terminal-");
		const journal = await persistedParent(temp.path());
		const owner = parent(journal);
		const workerFile = path.join(journal.getSessionFile()!.slice(0, -6), "tests-3.jsonl");
		const childFile = path.join(workerFile.slice(0, -6), "child.jsonl");
		const grandchildFile = path.join(childFile.slice(0, -6), "grandchild.jsonl");
		for (const file of [workerFile, childFile, grandchildFile]) await childTranscript(file, temp.path());
		appendWorker(journal, "tests-3", { terminal: true });
		await journal.flush();
		const foreignDispose = vi.fn(async () => {});
		const foreignFile = temp.join("other-root", "foreign.jsonl");
		await childTranscript(foreignFile, temp.path());
		const parkedFile = temp.join("other-root", "collision.jsonl");
		const sourceCollision = path.join(workerFile.slice(0, -6), "collision.jsonl");
		const collisionChild = path.join(sourceCollision.slice(0, -6), "collision-child.jsonl");
		for (const file of [parkedFile, sourceCollision, collisionChild]) await childTranscript(file, temp.path());
		const foreignParked = AgentRegistry.global().register({
			id: "collision",
			displayName: "collision",
			kind: "sub",
			parentId: "OtherMain",
			session: null,
			sessionFile: parkedFile,
			status: "parked",
		});
		const foreign = AgentRegistry.global().register({
			id: "foreign",
			displayName: "foreign",
			kind: "sub",
			parentId: "tests-3",
			session: sessionHandle(foreignDispose),
			sessionFile: foreignFile,
			status: "idle",
		});
		const release = AgentLifecycleManager.global().release.bind(AgentLifecycleManager.global());
		const releaseOrder: string[] = [];
		vi.spyOn(AgentLifecycleManager.global(), "release").mockImplementation(async (id, expected, options) => {
			for (const file of [workerFile, childFile, grandchildFile])
				expect(await fs.readFile(getAgentTombstonePath(file), "utf8")).toBe("");
			releaseOrder.push(id);
			return release(id, expected, options);
		});
		expect(await VibeSessionRegistry.global().rehydrate(owner)).toBe(0);
		expect(releaseOrder.indexOf("grandchild")).toBeLessThan(releaseOrder.indexOf("child"));
		expect(AgentRegistry.global().get("child")).toMatchObject({
			parentId: "tests-3",
			status: "aborted",
			session: null,
		});
		expect(AgentRegistry.global().get("grandchild")).toMatchObject({
			parentId: "child",
			status: "aborted",
			session: null,
		});
		expect(AgentRegistry.global().get("foreign")).toBe(foreign);
		expect(foreignDispose).not.toHaveBeenCalled();
		expect(
			await fs.access(getAgentTombstonePath(foreignFile)).then(
				() => true,
				() => false,
			),
		).toBe(false);
		expect(AgentRegistry.global().get("collision")).toBe(foreignParked);
		expect(AgentRegistry.global().get("collision-child")?.status).toBe("aborted");
		expect(await fs.readFile(getAgentTombstonePath(sourceCollision), "utf8")).toBe("");
		expect(
			await fs.access(getAgentTombstonePath(parkedFile)).then(
				() => true,
				() => false,
			),
		).toBe(false);
	});

	it("persists the whole mode-exit tree before release and retries a failed descendant intent", async () => {
		const temp = directory("@vibe-mode-exit-intent-");
		const journal = await persistedParent(temp.path());
		const owner = parent(journal);
		journal.appendModeChange("team");
		const files = ["alpha-3", "beta-3"].map(id => path.join(journal.getSessionFile()!.slice(0, -6), `${id}.jsonl`));
		for (const file of files) {
			await childTranscript(file, temp.path());
			await childTranscript(
				path.join(file.slice(0, -6), `${path.basename(file, ".jsonl")}-child.jsonl`),
				temp.path(),
			);
			appendWorker(journal, path.basename(file, ".jsonl"));
		}
		await journal.flush();
		const registry = VibeSessionRegistry.global();
		expect(await registry.rehydrate(owner)).toBe(2);
		const persist = lifecycleModule.persistAgentTombstone;
		const release = vi.spyOn(AgentLifecycleManager.global(), "release");
		vi.spyOn(lifecycleModule, "persistAgentTombstone").mockImplementation(async file => {
			if (file === files[1]) throw new Error("second tree intent failed");
			await persist(file);
		});
		await expect(registry.killAll(owner)).rejects.toThrow("second tree intent failed");
		expect(release).not.toHaveBeenCalled();
		expect(
			events(journal).filter(event => event.action === "tombstone" && event.reason === "mode-exit"),
		).toHaveLength(2);
		expect(
			journal
				.getBranch()
				.filter(entry => entry.type === "mode_change")
				.at(-1),
		).toMatchObject({ mode: "none" });
		vi.restoreAllMocks();
		expect(await registry.killAll(owner)).toBe(2);
		for (const id of ["alpha-3-child", "beta-3-child"])
			expect(AgentRegistry.global().get(id)?.status).toBe("aborted");
	});

	it("does not release any descendant when durable recursive intent fails", async () => {
		const temp = directory("@vibe-terminal-intent-failure-");
		const journal = await persistedParent(temp.path());
		const owner = parent(journal);
		const workerFile = path.join(journal.getSessionFile()!.slice(0, -6), "tests-3.jsonl");
		const childFile = path.join(workerFile.slice(0, -6), "child.jsonl");
		for (const file of [workerFile, childFile]) await childTranscript(file, temp.path());
		appendWorker(journal, "tests-3", { terminal: true });
		const release = vi.spyOn(AgentLifecycleManager.global(), "release");
		vi.spyOn(lifecycleModule, "persistAgentTombstone").mockRejectedValue(new Error("intent write failed"));
		await expect(VibeSessionRegistry.global().rehydrate(owner)).rejects.toThrow("intent write failed");
		expect(release).not.toHaveBeenCalled();
		expect(AgentRegistry.global().get("child")?.status).toBe("parked");
		vi.restoreAllMocks();
		expect(await VibeSessionRegistry.global().rehydrate(owner)).toBe(0);
		expect(AgentRegistry.global().get("child")?.status).toBe("aborted");
	});
});
