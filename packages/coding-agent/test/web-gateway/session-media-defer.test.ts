/**
 * Tool-result images must reach the web conversation. The gateway's `deferMedia`
 * history loads used to drop every tool-result image behind a
 * "[N tool result images omitted …]" notice, so an agent screenshot could never
 * be shown — only the live SSE frame carried it, and the next refetch replaced
 * it. Persistence externalizes the bytes to the content-addressed blob store, so
 * the block now points at `/api/blobs/<sha256>` instead.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBlobsDir, isRecord, refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { buildWebSessionContext } from "../../src/server/web-gateway/sessions";
import { BlobStore, externalizeImageDataSync } from "../../src/session/blob-store";
import type { SessionEntry } from "../../src/session/session-entries";

const AGENT_DIR_ENV = "ZETA_CODING_AGENT_DIR";
const savedEnv = process.env[AGENT_DIR_ENV];
const cleanups: Array<() => Promise<void>> = [];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Synthetic PNG whose payload size decides whether persistence externalizes it. */
const fakePng = (payloadBytes: number, fill = 0x41) => Buffer.concat([PNG_SIGNATURE, Buffer.alloc(payloadBytes, fill)]);

async function setup(): Promise<void> {
	const agentDir = await mkdtemp(join(tmpdir(), "zeta-media-defer-"));
	cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
	process.env[AGENT_DIR_ENV] = agentDir;
	refreshDirsFromEnv();
}

function toolResultEntry(id: string, parentId: string | null, bytes: Buffer, toolName = "browser"): SessionEntry {
	return {
		id,
		parentId,
		timestamp: new Date().toISOString(),
		type: "message",
		message: {
			role: "toolResult",
			toolCallId: id,
			toolName,
			isError: false,
			timestamp: Date.now(),
			content: [
				{ type: "text", text: `${toolName} output` },
				{ type: "image", data: bytes.toString("base64"), mimeType: "image/png" },
			],
		},
	};
}

/** Image block of each message in a built context, keyed by tool call id. */
function imagesByToolCall(context: unknown): Map<string, Record<string, unknown> | undefined> {
	if (!isRecord(context) || !Array.isArray(context.messages)) throw new Error("context has no messages array");
	const out = new Map<string, Record<string, unknown> | undefined>();
	for (const message of context.messages) {
		if (!isRecord(message) || typeof message.toolCallId !== "string" || !Array.isArray(message.content)) continue;
		let image: Record<string, unknown> | undefined;
		for (const block of message.content) {
			if (isRecord(block) && block.type === "image") {
				image = block;
				break;
			}
		}
		out.set(message.toolCallId, image);
	}
	return out;
}

afterEach(async () => {
	if (savedEnv === undefined) delete process.env[AGENT_DIR_ENV];
	else process.env[AGENT_DIR_ENV] = savedEnv;
	refreshDirsFromEnv();
	await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

describe("deferMedia tool-result images", () => {
	test("points an externalized image at its blob and keeps small or unblobbed payloads inline", async () => {
		await setup();
		const big = fakePng(4096); // above BLOB_EXTERNALIZE_THRESHOLD
		const orphan = fakePng(4096, 0x42); // same size, never externalized
		const small = fakePng(2, 0x43); // below the threshold
		const ref = externalizeImageDataSync(new BlobStore(getBlobsDir()), big.toString("base64"), "image/png");
		const hash = ref.slice("blob:sha256:".length);

		const context = buildWebSessionContext(
			[
				toolResultEntry("big", null, big),
				toolResultEntry("small", "big", small),
				toolResultEntry("orphan", "small", orphan),
			],
			undefined,
			{ deferToolResultImages: true },
		);
		const images = imagesByToolCall(context);

		const bigSource = images.get("big")?.source;
		expect(isRecord(bigSource) && bigSource.type === "url" ? bigSource.url : undefined).toBe(`/api/blobs/${hash}`);
		// No blob on disk → keep the bytes inline rather than emit a URL that 404s.
		expect(images.get("orphan")?.source).toBeUndefined();
		expect(typeof images.get("orphan")?.data).toBe("string");
		expect(images.get("small")?.source).toBeUndefined();
	});

	test("leaves images inline when the client does not ask for deferred media", async () => {
		await setup();
		const big = fakePng(4096);
		externalizeImageDataSync(new BlobStore(getBlobsDir()), big.toString("base64"), "image/png");

		const context = buildWebSessionContext([toolResultEntry("big", null, big)], undefined, {});
		const image = imagesByToolCall(context).get("big");

		expect(image?.source).toBeUndefined();
		expect(image?.data).toBe(big.toString("base64"));
	});
});
