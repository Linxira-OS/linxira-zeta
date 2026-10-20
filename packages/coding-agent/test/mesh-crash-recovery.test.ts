/**
 * Scenario S7 (crash half) — a killed process leaves a stale directory entry
 * that the next enumeration reports `gone` and removes; its mailbox survives
 * the crash and is injected on the next start.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { access, rm } from "node:fs/promises";
import * as path from "node:path";
import { MeshDirectory } from "../src/mesh/directory";
import { MeshMailbox } from "../src/mesh/mailbox";
import { meshPaths } from "../src/mesh/paths";
import { MESH_PROTOCOL_VERSION } from "../src/mesh/types";
import { spawnMeshChild, tempDir } from "./mesh/helpers";

describe("mesh crash recovery (S7)", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	}, 30_000);

	test("a killed process is reported gone and its record cleaned on next enumeration", async () => {
		const meshRoot = await tempDir("mesh-crash");
		cleanups.push(() => rm(meshRoot, { recursive: true, force: true }));
		const paths = meshPaths(meshRoot);
		const child = await spawnMeshChild({ workspaceRoot: path.join(meshRoot, "b"), meshRoot });
		cleanups.push(() => child.stop());

		expect(await exists(paths.directoryFile(child.workspaceId))).toBe(true);
		child.kill();
		await child.proc.exited;

		const directory = new MeshDirectory({ paths });
		const entries = await directory.list();
		const entry = entries.find(candidate => candidate.record.workspaceId === child.workspaceId);
		expect(entry?.state).toBe("gone");
		expect(await exists(paths.directoryFile(child.workspaceId))).toBe(false);
		expect(await exists(paths.tokenFile(child.workspaceId))).toBe(false);
	}, 30_000);

	test("heartbeat older than 60s is `gone` even when the pid is alive", async () => {
		const meshRoot = await tempDir("mesh-crash-heartbeat");
		cleanups.push(() => rm(meshRoot, { recursive: true, force: true }));
		const paths = meshPaths(meshRoot);
		const now = Date.now();
		const directory = new MeshDirectory({ paths, now: () => now, pidAlive: () => true });
		await directory.write({
			id: "dead00000001/Main",
			workspaceId: "dead00000001",
			workspaceRoot: "/tmp/dead",
			pid: process.pid,
			endpoint: paths.endpoint("dead00000001"),
			role: "main",
			status: "idle",
			updatedAt: now - 61_000,
			agents: [{ id: "Main", role: "main", status: "idle" }],
		});
		const entries = await directory.list();
		expect(entries.find(entry => entry.record.workspaceId === "dead00000001")?.state).toBe("gone");
		expect(await exists(paths.directoryFile("dead00000001"))).toBe(false);
	});

	test("mail queued to a crashed process is injected after restart", async () => {
		const meshRoot = await tempDir("mesh-crash-mail");
		cleanups.push(() => rm(meshRoot, { recursive: true, force: true }));
		const rootB = path.join(meshRoot, "b");
		const paths = meshPaths(meshRoot);
		const deliverLog = path.join(meshRoot, "delivered.log");

		const first = await spawnMeshChild({ workspaceRoot: rootB, meshRoot });
		const workspaceId = first.workspaceId;
		first.kill();
		await first.proc.exited;

		const mailbox = new MeshMailbox(paths);
		await mailbox.enqueue(workspaceId, "Main", {
			v: MESH_PROTOCOL_VERSION,
			id: "crash-mail-1",
			from: "aaaa00000001/Main",
			to: `${workspaceId}/Main`,
			kind: "message",
			body: "survived-the-crash",
			sentAt: Date.now(),
		});

		const second = await spawnMeshChild({ workspaceRoot: rootB, meshRoot, deliverLog });
		cleanups.push(() => second.stop());
		const delivered = await second.next<{ body: string }>("DELIVERED");
		expect(delivered.body).toBe("survived-the-crash");
	}, 30_000);
});

async function exists(file: string): Promise<boolean> {
	try {
		await access(file);
		return true;
	} catch {
		return false;
	}
}
