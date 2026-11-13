/**
 * Opt-in task worker: it reuses queue CAS/lease and the caller's registered
 * session, claims one task, executes, submits for review, and never spawns.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AgentRegistry } from "../../src/registry/agent-registry";
import { engineerRowId, pmRowId, TeamDb } from "../../src/team/db";
import { addPm, initTeam } from "../../src/team/service";
import { createTask, showTask } from "../../src/team/tasks";
import { startTaskWorker } from "../../src/team/task-worker";

let scratch: string;
let teamRoot: string;
let dbPath: string;

beforeAll(async () => {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-team-worker-"));
	teamRoot = path.join(scratch, "acme-team");
	dbPath = path.join(scratch, "team.db");
	await initTeam({ name: "Acme", root: teamRoot, dbPath });
	await addPm({ pm: "core", teamRoot, dbPath });
	const db = new TeamDb(dbPath);
	try {
		db.insertEngineer({
			id: engineerRowId("acme", "core", "alice"),
			teamId: "acme",
			pmId: pmRowId("acme", "core"),
			name: "alice",
			execution: "vibe",
			createdAt: 1,
		});
	} finally {
		db.close();
	}
}, 120_000);

afterAll(() => {
	AgentRegistry.resetGlobalForTests();
	try {
		fs.rmSync(scratch, { recursive: true, force: true });
	} catch {
		// Windows may hold a SQLite handle; the OS temp dir is disposable.
	}
}, 30_000);

describe("team task worker", () => {
	test("claims, executes, renews through the loop, and submits for review", async () => {
		AgentRegistry.installGlobal(new AgentRegistry());
		AgentRegistry.global().register({
			id: "engineer-session",
			displayName: "alice",
			kind: "main",
			session: {} as never,
			status: "idle",
		});
		await createTask({
			taskKey: "T-1",
			title: "Worker task",
			pm: "core",
			assignee: "alice",
			teamRoot,
			dbPath,
		});
		const seen: string[] = [];
		const handle = startTaskWorker({
			teamRoot,
			dbPath,
			engineer: "alice",
			agentId: "engineer-session",
			leaseSeconds: 30,
			renewEveryMs: 10_000,
			pollMs: 10,
			maxTasks: 1,
			execute: async task => {
				seen.push(`${task.taskKey}:${task.status}:${task.ownerAgentId}`);
				return { body: "implemented REQ-1", reqIds: ["REQ-1"] };
			},
		});
		await handle.done;
		expect(handle.running()).toBe(false);
		expect(seen).toEqual(["T-1:claimed:acme:core:alice"]);
		const view = await showTask({ task: "T-1", teamRoot, dbPath });
		expect(view.task.status).toBe("review");
		expect(view.task.reqIds).toEqual(expect.arrayContaining(["REQ-1"]));
		expect(view.events.map(event => event.kind)).toEqual(["created", "claimed", "submitted"]);
	}, 30_000);

	test("does not claim while the engineer session is busy", async () => {
		AgentRegistry.installGlobal(new AgentRegistry());
		AgentRegistry.global().register({
			id: "busy-session",
			displayName: "alice",
			kind: "main",
			session: {} as never,
			status: "idle",
		});
		await createTask({ taskKey: "T-2", title: "Busy task", pm: "core", teamRoot, dbPath });
		const handle = startTaskWorker({
			teamRoot,
			dbPath,
			engineer: "alice",
			agentId: "busy-session",
			canClaim: () => false,
			pollMs: 5,
			execute: async () => {
				throw new Error("must not execute while busy");
			},
		});
		await Bun.sleep(20);
		await handle.stop();
		const view = await showTask({ task: "T-2", teamRoot, dbPath });
		expect(view.task.status).toBe("pending");
		expect(view.events.map(event => event.kind)).toEqual(["created"]);
	}, 30_000);

	test("rejects a worker without a live registered session", async () => {
		const handle = startTaskWorker({
			teamRoot,
			dbPath,
			engineer: "alice",
			agentId: "missing-session",
			execute: async () => ({}),
		});
		await expect(handle.done).rejects.toThrow(/live registered session/);
	}, 30_000);
});
