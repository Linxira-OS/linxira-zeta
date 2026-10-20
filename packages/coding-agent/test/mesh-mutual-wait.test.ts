/**
 * Scenario S6 — two agents wait for each other. Blocking would deadlock both
 * sessions, so each wait returns `peer-waiting-on-you` within the probe window
 * and both agents remain usable afterwards.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import * as path from "node:path";
import { spawnMeshChild, tempDir, type MeshChild } from "./mesh/helpers";

describe("mesh mutual wait (S6)", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	}, 90_000);

	test("two agents waiting on each other get peer-waiting-on-you and keep working", async () => {
		const meshRoot = await tempDir("mesh-s6");
		cleanups.push(() => rm(meshRoot, { recursive: true, force: true }));

		const children: MeshChild[] = [];
		const spawnChild = async (name: string) => {
			const child = await spawnMeshChild({ workspaceRoot: path.join(meshRoot, name), meshRoot });
			children.push(child);
			cleanups.push(() => child.stop());
			return child;
		};
		const a = await spawnChild("a");
		const b = await spawnChild("b");

		// Both block for each other; neither sends anything.
		await a.command(`wait ${b.address} 30000`);
		await b.command(`wait ${a.address} 30000`);

		const [resultA, resultB] = await Promise.all([
			a.next<{ kind: string; status?: string }>("WAIT", 20_000),
			b.next<{ kind: string; status?: string }>("WAIT", 20_000),
		]);
		expect(resultA.kind).toBe("status");
		expect(resultA.status).toBe("peer-waiting-on-you");
		expect(resultB.kind).toBe("status");
		expect(resultB.status).toBe("peer-waiting-on-you");

		// Both sides still answer: the early return did not wedge the session.
		await a.command("ping");
		await b.command("ping");
		expect(await a.next("PONG", 10_000)).toEqual({});
		expect(await b.next("PONG", 10_000)).toEqual({});
	}, 90_000);

	test("a one-sided wait still blocks normally (no false deadlock)", async () => {
		const meshRoot = await tempDir("mesh-s6-one-sided");
		cleanups.push(() => rm(meshRoot, { recursive: true, force: true }));
		const a = await spawnMeshChild({ workspaceRoot: path.join(meshRoot, "a"), meshRoot });
		const b = await spawnMeshChild({ workspaceRoot: path.join(meshRoot, "b"), meshRoot });
		cleanups.push(() => a.stop());
		cleanups.push(() => b.stop());

		await a.command(`wait ${b.address} 800`);
		const result = await a.next<{ kind: string }>("WAIT", 20_000);
		expect(result.kind).toBe("timeout");
	}, 90_000);
});
