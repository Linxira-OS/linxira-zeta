/** Real second-process mesh transport and offline mailbox preserve entry provenance. */
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { validateEnvelope } from "../src/mesh/envelope";
import { MeshMailbox } from "../src/mesh/mailbox";
import { meshPathsAt } from "../src/mesh/paths";
import { MESH_PROTOCOL_VERSION } from "../src/mesh/types";
import { spawnMeshChild, tempDir } from "./mesh/helpers";

describe("mesh IM provenance", () => {
	const cleanups: Array<() => Promise<void>> = [];
	afterEach(async () => {
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	}, 30_000);

	test("offline replay in another process retains platform instance sender and route", async () => {
		const root = await tempDir("mesh-im-provenance");
		cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
		const metadata = {
			source: "im",
			platform: "telegram",
			instance: "telegram-personal",
			chatId: "chat-a",
			senderId: "alice",
			senderName: "Alice",
			messageId: "platform-42",
			sentAt: "2026-11-14T00:00:00.000Z",
			route: { agentId: "Main", workspaceAlias: "beta" },
		};
		const first = await spawnMeshChild({ workspaceRoot: path.join(root, "b"), meshRoot: root, alias: "beta" });
		const targetId = first.workspaceId;
		await first.stop();
		const sender = await spawnMeshChild({ workspaceRoot: path.join(root, "a"), meshRoot: root, alias: "alpha" });
		cleanups.push(() => sender.stop());
		await sender.command(
			`send-json ${JSON.stringify({ to: `${targetId}/Main`, body: "real IM user body", metadata })}`,
		);
		expect((await sender.next<{ outcome: string }>("SEND")).outcome).toBe("queued");
		const mailbox = new MeshMailbox(meshPathsAt(root));
		expect((await mailbox.pending(targetId, "Main"))[0]?.metadata).toEqual(metadata);
		const resumed = await spawnMeshChild({ workspaceRoot: path.join(root, "b"), meshRoot: root, alias: "beta" });
		cleanups.push(() => resumed.stop());
		const delivered = await resumed.next<{ body: string; metadata: unknown }>("DELIVERED");
		expect(delivered).toMatchObject({ body: "real IM user body", metadata });
		expect(await mailbox.pending(targetId, "Main")).toEqual([]);
	}, 30_000);

	test("metadata participates in envelope validation and byte limit", () => {
		const envelope = {
			v: MESH_PROTOCOL_VERSION,
			id: "id",
			from: "alpha/Main",
			to: "beta/Main",
			kind: "message",
			body: "body",
			sentAt: 1,
		};
		expect(() => validateEnvelope({ ...envelope, metadata: [] })).toThrow(/metadata/);
		expect(() => validateEnvelope({ ...envelope, metadata: { text: "x".repeat(1024 * 1024) } })).toThrow(
			/byte limit/,
		);
		expect(validateEnvelope({ ...envelope, metadata: { instance: "telegram-personal" } }).metadata).toEqual({
			instance: "telegram-personal",
		});
	});
});
