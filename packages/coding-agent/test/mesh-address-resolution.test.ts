/**
 * Scenario S2 — addressing. `<workspaceId>/<agentId>`, workspace alias, and
 * directory-name forms all resolve; an ambiguous directory name is an explicit
 * error (never a guess); a bare id stays in-process.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import * as path from "node:path";
import { MeshDirectory } from "../src/mesh/directory";
import { MeshNode } from "../src/mesh/mesh-node";
import { OPEN_MESH_GEARS } from "../src/mesh/gears";
import { meshPaths, workspaceIdFor } from "../src/mesh/paths";
import { parseMeshAddress } from "../src/mesh/envelope";
import type { MeshDirectoryRecord } from "../src/mesh/types";
import { tempDir } from "./mesh/helpers";

describe("mesh address resolution (S2)", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	}, 30_000);

	async function setup() {
		const meshRoot = await tempDir("mesh-s2");
		cleanups.push(() => rm(meshRoot, { recursive: true, force: true }));
		const paths = meshPaths(meshRoot);
		const node = await MeshNode.start({
			workspaceRoot: path.join(meshRoot, "self"),
			meshRoot,
			workspaceAlias: "self",
			localAgents: () => [{ id: "Main", role: "main", status: "idle" }],
			deliver: async () => ({ outcome: "injected" }),
			gears: () => OPEN_MESH_GEARS,
			pidAlive: () => true,
			workspaceAliases: () => [{ alias: "delta", path: "/z/delta" }],
		});
		cleanups.push(() => node.stop());
		const directory = new MeshDirectory({ paths, pidAlive: () => true });
		const record = (
			overrides: Partial<MeshDirectoryRecord> & Pick<MeshDirectoryRecord, "workspaceId" | "workspaceRoot">,
		) => ({
			id: `${overrides.workspaceId}/Main`,
			workspaceAlias: overrides.workspaceId,
			pid: process.pid,
			endpoint: paths.endpoint(overrides.workspaceId),
			role: "main" as const,
			status: "idle" as const,
			updatedAt: Date.now(),
			agents: [{ id: "Main", role: "main" as const, status: "idle" as const }],
			...overrides,
		});
		const betaId = workspaceIdFor(path.resolve("/repos/proj"));
		const gammaId = workspaceIdFor(path.resolve("/other/proj"));
		await directory.write(record({ workspaceId: betaId, workspaceRoot: "/repos/proj", workspaceAlias: "beta" }));
		await directory.write(record({ workspaceId: gammaId, workspaceRoot: "/other/proj", workspaceAlias: "gamma" }));
		return { node, betaId, gammaId, meshRoot };
	}

	test("workspace id, alias, directory name, and agent:// forms resolve", async () => {
		const { node, betaId } = await setup();
		const byId = await node.send({ from: "Main", to: `${betaId}/Main`, body: "one" });
		expect(byId.outcome).not.toBe("failed");
		const byAlias = await node.send({ from: "Main", to: "beta/Main", body: "two" });
		expect(byAlias.outcome).not.toBe("failed");
		const byScheme = await node.send({ from: "Main", to: "agent://beta/Main", body: "three" });
		expect(byScheme.outcome).not.toBe("failed");
		// An alias registered in config resolves even with no live record.
		const offline = await node.send({ from: "Main", to: "delta/Main", body: "four" });
		expect(offline.outcome).toBe("queued");
	});

	test("a directory name shared by two workspaces is ambiguous, not guessed", async () => {
		const { node, betaId, gammaId } = await setup();
		const ambiguous = await node.send({ from: "Main", to: "proj/Main", body: "who?" });
		expect(ambiguous.outcome).toBe("failed");
		expect(ambiguous.error).toMatch(/ambiguous/i);
		expect(ambiguous.error).toContain(betaId);
		expect(ambiguous.error).toContain(gammaId);
	});

	test("unknown workspace reports the available candidates", async () => {
		const { node } = await setup();
		const unknown = await node.send({ from: "Main", to: "nope/Main", body: "hi" });
		expect(unknown.outcome).toBe("failed");
		expect(unknown.error).toMatch(/unknown workspace or agent/i);
		expect(unknown.error).toContain("beta");
	});

	test("unknown agent inside a live workspace reports that workspace's agents", async () => {
		const { node } = await setup();
		const missing = await node.send({ from: "Main", to: "beta/Ghost", body: "hi" });
		expect(missing.outcome).toBe("failed");
		expect(missing.error).toMatch(/unknown agent/i);
		expect(missing.error).toContain("/Main");
	});

	test("unprefixed ids stay in-process and are never treated as mesh addresses", async () => {
		const { node } = await setup();
		expect(parseMeshAddress("Main")).toEqual({ agent: "Main" });
		expect(node.isCrossProcessAddress("Main")).toBe(false);
		expect(node.isCrossProcessAddress("beta/Main")).toBe(true);
		expect(node.stripLocalAddress("self/Main")).toBe("Main");
		expect(node.stripLocalAddress("beta/Main")).toBeUndefined();
	});
});
