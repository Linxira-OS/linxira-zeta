/**
 * Scenario S7 — transport and path security: loopback-only endpoint, owner-only
 * files (POSIX), handshake authentication, `to` path-fragment rejection, and
 * the 1 MiB / version envelope gates.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as net from "node:net";
import { readFile, rm, stat } from "node:fs/promises";
import * as path from "node:path";
import { MeshNode } from "../src/mesh/mesh-node";
import { OPEN_MESH_GEARS } from "../src/mesh/gears";
import { meshPaths } from "../src/mesh/paths";
import { readMeshToken, sendMeshEnvelope } from "../src/mesh/transport";
import { validateEnvelope } from "../src/mesh/envelope";
import { MESH_MAX_ENVELOPE_BYTES, MESH_PROTOCOL_VERSION } from "../src/mesh/types";
import { tempDir } from "./mesh/helpers";

const POSIX = process.platform !== "win32";

describe("mesh security (S7)", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	}, 30_000);

	async function startNode(meshRoot: string, root: string, id?: string): Promise<MeshNode> {
		const node = await MeshNode.start({
			workspaceRoot: root,
			meshRoot,
			...(id !== undefined && { workspaceId: id }),
			localAgents: () => [{ id: "Main", role: "main", status: "idle" }],
			deliver: async () => ({ outcome: "injected" }),
			gears: () => OPEN_MESH_GEARS,
		});
		cleanups.push(() => node.stop());
		return node;
	}

	test("envelope rejects wrong version, oversized bodies, and path fragments in `to`", () => {
		const base = {
			v: MESH_PROTOCOL_VERSION,
			id: "m1",
			from: "aaaa00000001/Main",
			to: "bbbb00000002/Main",
			kind: "message" as const,
			body: "hi",
			sentAt: 1,
		};
		expect(validateEnvelope(base).body).toBe("hi");

		expect(() => validateEnvelope({ ...base, v: 2 })).toThrow(/version/i);
		expect(() => validateEnvelope({ ...base, to: "../../etc/passwd" })).toThrow(/invalid/i);
		expect(() => validateEnvelope({ ...base, to: "bbbb00000002/../Main" })).toThrow(/invalid/i);
		expect(() => validateEnvelope({ ...base, to: "bbbb00000002/a/b" })).toThrow(/invalid/i);
		expect(() => validateEnvelope({ ...base, to: "bbbb00000002\\Main" })).toThrow(/invalid/i);
		expect(() => validateEnvelope({ ...base, body: "x".repeat(MESH_MAX_ENVELOPE_BYTES + 1) })).toThrow(/byte limit/i);
	});

	test("handshake rejects a missing or wrong token and accepts the owner's", async () => {
		const meshRoot = await tempDir("mesh-sec");
		cleanups.push(() => rm(meshRoot, { recursive: true, force: true }));
		const node = await startNode(meshRoot, path.join(meshRoot, "a"));
		const paths = meshPaths(meshRoot);
		const tokenFile = paths.tokenFile(node.workspaceId);
		const token = await readMeshToken(tokenFile);
		expect(token).toBeTruthy();

		const envelope = {
			v: MESH_PROTOCOL_VERSION,
			id: "sec-1",
			from: "cccc00000003/Main",
			to: node.addressFor("Main"),
			kind: "message" as const,
			body: "hello",
			sentAt: Date.now(),
		};
		const rejected = await sendMeshEnvelope({
			endpoint: node.endpoint,
			token: "not-the-token",
			envelope,
			timeoutMs: 2_000,
		});
		expect(rejected.delivered).toBe(false);
		expect(rejected.error).toMatch(/unauthorized|reject/i);

		const accepted = await sendMeshEnvelope({
			endpoint: node.endpoint,
			token: token!,
			envelope: { ...envelope, id: "sec-2" },
			timeoutMs: 2_000,
		});
		expect(accepted.delivered).toBe(true);
		expect(accepted.payload?.ok).toBe(true);
	});

	test("a raw connection that never authenticates is closed", async () => {
		const meshRoot = await tempDir("mesh-sec-raw");
		cleanups.push(() => rm(meshRoot, { recursive: true, force: true }));
		const node = await startNode(meshRoot, path.join(meshRoot, "a"));
		const outcome = await new Promise<string>(resolve => {
			const socket = net.createConnection(node.endpoint);
			socket.setTimeout(5_000);
			socket.on("connect", () => {
				socket.write('{"t":"hello","v":1,"token":"wrong","from":"evil/Main"}\n');
			});
			socket.on("data", chunk => {
				if (chunk.toString("utf8").includes("unauthorized")) resolve("unauthorized");
			});
			socket.on("close", () => resolve("closed"));
			socket.on("timeout", () => {
				socket.destroy();
				resolve("timeout");
			});
			socket.on("error", () => resolve("error"));
		});
		expect(["unauthorized", "closed", "error"]).toContain(outcome);
	});

	test("socket, token, and directory record are owner-only on POSIX", async () => {
		if (!POSIX) return;
		const meshRoot = await tempDir("mesh-sec-mode");
		cleanups.push(() => rm(meshRoot, { recursive: true, force: true }));
		const node = await startNode(meshRoot, path.join(meshRoot, "a"));
		const paths = meshPaths(meshRoot);
		const socketMode = (await stat(node.endpoint)).mode & 0o777;
		const tokenMode = (await stat(paths.tokenFile(node.workspaceId))).mode & 0o777;
		const recordMode = (await stat(paths.directoryFile(node.workspaceId))).mode & 0o777;
		expect(socketMode).toBe(0o600);
		expect(tokenMode).toBe(0o600);
		expect(recordMode).toBe(0o600);
		// The token never leaks into the directory record.
		const record = await readFile(paths.directoryFile(node.workspaceId), "utf8");
		const token = await readMeshToken(paths.tokenFile(node.workspaceId));
		expect(record).not.toContain(token ?? "unreachable-token");
	});

	test("a second node for the same workspace refuses the live endpoint", async () => {
		const meshRoot = await tempDir("mesh-sec-busy");
		cleanups.push(() => rm(meshRoot, { recursive: true, force: true }));
		const root = path.join(meshRoot, "a");
		await startNode(meshRoot, root);
		await expect(
			MeshNode.start({
				workspaceRoot: root,
				meshRoot,
				localAgents: () => [{ id: "Main", role: "main", status: "idle" }],
				deliver: async () => ({ outcome: "injected" }),
			}),
		).rejects.toThrow(new RegExp(`owned by pid ${process.pid}`));
	});
});
