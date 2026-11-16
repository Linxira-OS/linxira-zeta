import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TempDir } from "@linxiraos/pi-utils";
import { createWorkspaceFileService, FILE_CHUNK_BYTES } from "../../src/server/web-gateway/workspace-files";
import type { WorkspaceId } from "../../src/server/studio-host/contract";

let directory: TempDir;
const workspaceId = "ws-file-test" as WorkspaceId;
let service: ReturnType<typeof createWorkspaceFileService>;
beforeEach(async () => {
	directory = TempDir.createSync("zeta-workspace-files-");
	await mkdir(directory.join("workspace"));
	service = createWorkspaceFileService(async id => {
		if (id !== workspaceId) throw new Error("unknown workspace");
		return directory.join("workspace");
	});
});
afterEach(async () => { await directory.remove(); });

function target(path: string) { return { workspaceId, path }; }

describe("workspace file resources", () => {
	test("canonical links keep one identity, binary chunks retain exact bytes and refuse stale versions", async () => {
		const bytes = Buffer.from([0, 255, 254, 128, 1, 2, 3]);
		const file = directory.join("workspace", "image.png");
		await writeFile(file, bytes);
		const info = await service.inspect(target("image.png"));
		expect(info.mime).toBe("image/png");
		expect(info.size).toBe(7);
		expect((await service.inspect(target(pathToFileURL(file).href))).id).toBe(info.id);
		const chunk = await service.readChunk({ ...target("image.png"), version: info.version, offset: 1, length: 3 });
		expect(chunk.bytes).toBe(3);
		expect(Buffer.from(chunk.data, "base64")).toEqual(bytes.subarray(1, 4));
		expect(await service.readChunk({ ...target("image.png"), version: info.version, offset: 100, length: 2 })).toEqual({ data: "", bytes: 0 });
		await writeFile(file, "changed-size");
		await expect(service.readChunk({ ...target("image.png"), version: info.version, offset: 0, length: 2 })).rejects.toThrow("变化");
		for (const [offset, length] of [[-1, 1], [0, 0], [0, FILE_CHUNK_BYTES + 1], [0.5, 1], [Number.MAX_SAFE_INTEGER + 1, 1]]) {
			await expect(service.readChunk({ ...target("image.png"), version: info.version, offset: offset!, length: length! })).rejects.toThrow("Invalid file range");
		}
	});

	test("workspace attribution rejects traversal and linked directories outside the selected workspace", async () => {
		const outside = resolve(directory.join("outside"));
		await mkdir(outside);
		await writeFile(join(outside, "secret.txt"), "outside-private");
		await symlink(outside, directory.join("workspace", "linked"), process.platform === "win32" ? "junction" : "dir");
		for (const path of ["../outside/secret.txt", join(outside, "secret.txt"), "linked/secret.txt"]) {
			await expect(service.inspect(target(path))).rejects.toThrow("工作区");
		}
		await expect(service.inspect({ workspaceId: "foreign" as WorkspaceId, path: "file.txt" })).rejects.toThrow("unknown workspace");
	});

	test("UTF-16 and CRLF survive editing while stale and concurrent writers cannot overwrite a newer version", async () => {
		const file = directory.join("workspace", "notes.txt");
		const text = "你好\r\nworld\r\n";
		const encoded = Buffer.from(text, "utf16le");
		encoded.swap16();
		await writeFile(file, Buffer.concat([Buffer.from([254, 255]), encoded]));
		const read = await service.readText(target("notes.txt"));
		expect(read).toMatchObject({ text: "你好\nworld\n", encoding: "utf16be", bom: true, lineEnding: "crlf" });
		const input = { ...target("notes.txt"), expectedVersion: read.file.version, encoding: read.encoding, bom: read.bom, lineEnding: read.lineEnding };
		const texts = ["first\n", "second\n"];
		const outcomes = await Promise.all(texts.map(text => service.writeText({ ...input, text })));
		expect(outcomes.filter(result => result.saved)).toHaveLength(1);
		expect(outcomes.find(result => !result.saved)).toMatchObject({ saved: false, conflict: true });
		const winner = texts[outcomes.findIndex(result => result.saved)]!;
		expect(await service.readText(target("notes.txt"))).toMatchObject({ text: winner, encoding: "utf16be", bom: true, lineEnding: "crlf" });
		const saved = Buffer.from(winner.replace(/\n/g, "\r\n"), "utf16le");
		saved.swap16();
		expect(await readFile(file)).toEqual(Buffer.concat([Buffer.from([254, 255]), saved]));
		expect(await readdir(directory.join("workspace"))).toEqual(["notes.txt"]);
	});

	test("text editing rejects binary payloads and files above its 8 MiB boundary", async () => {
		await writeFile(directory.join("workspace", "binary.txt"), Buffer.from([97, 0, 98]));
		await expect(service.readText(target("binary.txt"))).rejects.toThrow("二进制");
		await writeFile(directory.join("workspace", "large.txt"), Buffer.alloc(8 * 1024 * 1024 + 1, 97));
		await expect(service.readText(target("large.txt"))).rejects.toThrow("8 MiB");
	});
});
