import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storeAttachments } from "../src/attachments";

async function tempDir(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "zeta-attachments-"));
}

describe("storeAttachments", () => {
	test("streams a download to disk and records its size", async () => {
		const dir = await tempDir();
		const fetchImpl = async (): Promise<Response> =>
			new Response(new Uint8Array([1, 2, 3, 4]), {
				status: 200,
				headers: { "content-length": "4", "content-type": "image/png" },
			});
		const stored = await storeAttachments([{ url: "https://cdn.test/a.png", name: "a.png", kind: "image" }], {
			dir,
			messageKey: "m1",
			fetch: fetchImpl as unknown as typeof globalThis.fetch,
		});
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({ kind: "image", name: "a.png", size: 4 });
		expect(await readFile(stored[0]!.path!)).toEqual(Buffer.from([1, 2, 3, 4]));
		await rm(dir, { recursive: true, force: true });
	});

	test("rejects a declared size above the cap without writing a partial file", async () => {
		const dir = await tempDir();
		const fetchImpl = async (): Promise<Response> =>
			new Response(new Uint8Array([1, 2, 3, 4]), {
				status: 200,
				headers: { "content-length": "4" },
			});
		const stored = await storeAttachments([{ url: "https://cdn.test/big.bin", name: "big.bin", kind: "file" }], {
			dir,
			messageKey: "m2",
			maxBytes: 2,
			fetch: fetchImpl as unknown as typeof globalThis.fetch,
		});
		expect(stored[0]!.path).toBeUndefined();
		expect(stored[0]!.error).toContain("exceeds");
		expect(stored[0]!.url).toBe("https://cdn.test/big.bin");
		await rm(dir, { recursive: true, force: true });
	});

	test("stores at most maxPerMessage attachments", async () => {
		const dir = await tempDir();
		const fetchImpl = async (): Promise<Response> => new Response(new Uint8Array([1]), { status: 200 });
		const stored = await storeAttachments(
			[
				{ url: "https://cdn.test/1.png", name: "1.png" },
				{ url: "https://cdn.test/2.png", name: "2.png" },
			],
			{
				dir,
				messageKey: "m3",
				maxPerMessage: 1,
				fetch: fetchImpl as unknown as typeof globalThis.fetch,
			},
		);
		expect(stored).toHaveLength(1);
		await rm(dir, { recursive: true, force: true });
	});

	test("stores an inline base64 payload (OneBot)", async () => {
		const dir = await tempDir();
		const stored = await storeAttachments(
			[{ base64: Buffer.from("hi").toString("base64"), name: "x.txt", kind: "file" }],
			{ dir, messageKey: "m4" },
		);
		expect(stored[0]!.size).toBe(2);
		expect(await readFile(stored[0]!.path!, "utf8")).toBe("hi");
		await rm(dir, { recursive: true, force: true });
	});
});
