/**
 * Scenario S3 — the peer's process is not running. `send` must return
 * `queued`, the message must survive in the persistent mailbox, and the next
 * start must inject it exactly once (at-least-once delivery, id dedupe).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import * as path from "node:path";
import { meshPaths } from "../src/mesh/paths";
import { MeshMailbox } from "../src/mesh/mailbox";
import { MESH_PROTOCOL_VERSION } from "../src/mesh/types";
import { spawnMeshChild, tempDir } from "./mesh/helpers";

describe("mesh offline mailbox (S3)", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	}, 30_000);

	test("queued to a stopped workspace, injected once on restart, never again", async () => {
		const meshRoot = await tempDir("mesh-s3");
		cleanups.push(() => rm(meshRoot, { recursive: true, force: true }));
		const rootA = path.join(meshRoot, "workspace-a");
		const rootB = path.join(meshRoot, "workspace-b");
		const deliverLog = path.join(meshRoot, "b-delivered.log");

		// B exists once so the test learns its workspace id, then exits.
		const bFirst = await spawnMeshChild({ workspaceRoot: rootB, meshRoot, alias: "beta" });
		const bId = bFirst.workspaceId;
		await bFirst.stop();

		const a = await spawnMeshChild({ workspaceRoot: rootA, meshRoot, alias: "alpha" });
		cleanups.push(() => a.stop());

		await a.command(`send ${bId}/Main stored-while-offline`);
		const sent = await a.next<{ outcome: string; to: string }>("SEND");
		expect(sent.outcome).toBe("queued");

		// The message is on disk, in the recipient's mailbox, atomically named.
		const paths = meshPaths(meshRoot);
		const mailbox = new MeshMailbox(paths);
		const pendingBefore = await mailbox.pending(bId, "Main");
		expect(pendingBefore).toHaveLength(1);
		expect(pendingBefore[0]?.body).toBe("stored-while-offline");

		// Restart B: startup injection delivers it exactly once.
		const bSecond = await spawnMeshChild({
			workspaceRoot: rootB,
			meshRoot,
			alias: "beta",
			deliverLog,
		});
		const delivered = await bSecond.next<{ body: string; from: string }>("DELIVERED");
		expect(delivered.body).toBe("stored-while-offline");
		expect(delivered.from).toBe(`${a.workspaceId}/Main`);
		const firstLog = await readFile(deliverLog, "utf8");
		expect(firstLog.trim().split("\n")).toHaveLength(1);
		expect(await mailbox.pending(bId, "Main")).toHaveLength(0);

		// A second restart must not re-deliver: the id is in delivered/.
		await bSecond.stop();
		const bThird = await spawnMeshChild({ workspaceRoot: rootB, meshRoot, alias: "beta", deliverLog });
		cleanups.push(() => bThird.stop());
		await Bun.sleep(500);
		const secondLog = await readFile(deliverLog, "utf8");
		expect(secondLog.trim().split("\n")).toHaveLength(1);

		// Re-enqueueing the same envelope id is a no-op (dedupe, not just move).
		const duplicate = await mailbox.enqueue(bId, "Main", {
			v: MESH_PROTOCOL_VERSION,
			id: pendingBefore[0]!.id,
			from: `${a.workspaceId}/Main`,
			to: `${bId}/Main`,
			kind: "message",
			body: "stored-while-offline",
			sentAt: Date.now(),
		});
		expect(duplicate).toBe("duplicate");
	}, 30_000);

	test("delivered order follows sentAt, not filename or arrival order", async () => {
		const meshRoot = await tempDir("mesh-s3-order");
		const paths = meshPaths(meshRoot);
		const mailbox = new MeshMailbox(paths);
		const base = {
			v: MESH_PROTOCOL_VERSION,
			from: "aaaa00000001/Main",
			to: "bbbb00000002/Main",
			kind: "message" as const,
		};
		await mailbox.enqueue("bbbb00000002", "Main", { ...base, id: "third", body: "c", sentAt: 300 });
		await mailbox.enqueue("bbbb00000002", "Main", { ...base, id: "first", body: "a", sentAt: 100 });
		await mailbox.enqueue("bbbb00000002", "Main", { ...base, id: "second", body: "b", sentAt: 200 });
		const pending = await mailbox.pending("bbbb00000002", "Main");
		expect(pending.map(envelope => envelope.body)).toEqual(["a", "b", "c"]);
		cleanups.push(() => rm(meshRoot, { recursive: true, force: true }));
	});
});
