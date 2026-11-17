import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InboundMessage } from "../src/channel";
import { receiveFeishuMessage, type FeishuMessageEvent } from "../src/feishu";
import { inboundBody } from "../src/index";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function inbox(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "zeta-feishu-"));
	directories.push(dir);
	return dir;
}

function event(type: string, content: unknown): FeishuMessageEvent {
	return {
		message: {
			message_id: "om-message-1",
			chat_id: "oc-chat-1",
			chat_type: "group",
			message_type: type,
			content: JSON.stringify(content),
		},
		sender: { sender_id: { open_id: "ou-sender", user_id: "user-fallback" } },
	};
}

function response(...chunks: number[][]): Response {
	return new Response(
		new ReadableStream<Uint8Array>({
			// Separate chunks exercise the streaming cap rather than content-length alone.
			start(controller) {
				for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
				controller.close();
			},
		}),
	);
}

describe("Feishu inbound events", () => {
	test("preserves multiline text and sender attribution while removing bot mention gaps", async () => {
		const received: InboundMessage[] = [];
		await receiveFeishuMessage(event("text", { text: "@_user_1  first line\nsecond line" }), {
			onMessage: message => received.push(message),
			openResource: async () => {
				throw new Error("text must not request media");
			},
		});
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({
			peer: "oc-chat-1",
			chatType: "group",
			senderId: "ou-sender",
			messageId: "om-message-1",
			body: "first line\nsecond line",
		});
		expect(received[0]!.attachments).toBeUndefined();
	});

	test.each([
		["image", { image_key: "img-resource" }, "img-resource", "image"],
		["file", { file_key: "file-resource", file_name: "report.txt" }, "file-resource", "file"],
	] as const)("stores a %s-only message and delivers its readable local path", async (type, content, key, kind) => {
		const dir = await inbox();
		const received: InboundMessage[] = [];
		const requests: unknown[] = [];
		await receiveFeishuMessage(event(type, content), {
			attachmentDir: dir,
			onMessage: message => received.push(message),
			openResource: async (messageId, fileKey, resourceType, signal) => {
				requests.push({ messageId, fileKey, resourceType, aborted: signal.aborted });
				return response([1, 2], [3, 4]);
			},
		});
		expect(requests).toEqual([{ messageId: "om-message-1", fileKey: key, resourceType: type, aborted: false }]);
		expect(received).toHaveLength(1);
		const message = received[0]!;
		expect(message.body).toBe("");
		expect(message.attachments).toHaveLength(1);
		const attachment = message.attachments![0]!;
		expect(attachment).toMatchObject({ kind, size: 4 });
		if (type === "file") expect(attachment.name).toBe("report.txt");
		expect(await readFile(attachment.path!)).toEqual(Buffer.from([1, 2, 3, 4]));
		expect(inboundBody(message)).toContain(attachment.path!);
	});

	test("reports an oversized stream without retaining a partial file", async () => {
		const dir = await inbox();
		const received: InboundMessage[] = [];
		await receiveFeishuMessage(event("file", { file_key: "file-resource", file_name: "large.bin" }), {
			attachmentDir: dir,
			maxAttachmentBytes: 3,
			onMessage: message => received.push(message),
			openResource: async () => response([1, 2], [3, 4]),
		});
		const message = received[0]!;
		expect(message.attachments![0]!.path).toBeUndefined();
		expect(message.attachments![0]!.error).toContain("exceeds 3 bytes");
		expect(await readdir(join(dir, "om-message-1"))).toEqual([]);
		expect(inboundBody(message)).toContain("unavailable:");
	});

	test("preserves failed media delivery as an unavailable attachment", async () => {
		const received: InboundMessage[] = [];
		await receiveFeishuMessage(event("image", { image_key: "img-resource" }), {
			attachmentDir: await inbox(),
			onMessage: message => received.push(message),
			openResource: async () => {
				throw new Error("resource permission denied");
			},
		});
		expect(received[0]!.attachments![0]).toMatchObject({ kind: "image", error: "resource permission denied" });
		expect(inboundBody(received[0]!)).toContain("resource permission denied");
	});

	test("reports missing resource identifiers instead of dropping the message", async () => {
		const received: InboundMessage[] = [];
		await receiveFeishuMessage(event("file", { file_name: "missing.txt" }), {
			onMessage: message => received.push(message),
			openResource: async () => {
				throw new Error("invalid resource must not be requested");
			},
		});
		expect(received[0]!.attachments![0]!.error).toContain("resource key");
	});

	test("reports disabled attachment storage without requesting the protected resource", async () => {
		const received: InboundMessage[] = [];
		await receiveFeishuMessage(event("image", { image_key: "img-resource" }), {
			onMessage: message => received.push(message),
			openResource: async () => {
				throw new Error("disabled storage must not request media");
			},
		});
		expect(received[0]!.attachments![0]!.error).toContain("storage is not configured");
	});

	test("explicitly rejects unsupported event types without treating their JSON as user text", async () => {
		const received: InboundMessage[] = [];
		await receiveFeishuMessage(event("audio", { file_key: "audio-resource" }), {
			onMessage: message => received.push(message),
			openResource: async () => {
				throw new Error("unsupported resource must not be requested");
			},
		});
		expect(received).toEqual([]);
	});
});
