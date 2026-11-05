/**
 * Gateway `/api/files` contract: the file tree, editor reads and uploads the
 * renderer used to get from the Next child.
 *
 * The refusal paths are the point of these tests — a path outside every
 * allowed root, a symlinked escape and an oversize text preview must keep the
 * status the legacy route used, because every one of these requests can write
 * to or read from the user's disk.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { allowFileRoot } from "../../src/server/web-gateway/file-roots";
import { webGatewayFetch } from "../../src/server/web-gateway";
import { type FileRouteFixture, createFileRouteFixture, fileRouteUrl, seedSessionForCwd } from "./file-routes-fixture";

const LOOPBACK = "127.0.0.1";

function multipartUpload(fileName: string, content: string): { body: Uint8Array; contentType: string } {
	const boundary = "----zeta-files-test-boundary";
	const body = [
		`--${boundary}`,
		`Content-Disposition: form-data; name="files"; filename="${fileName}"`,
		"Content-Type: text/plain",
		"",
		content,
		`--${boundary}--`,
		"",
	].join("\r\n");
	return {
		body: new TextEncoder().encode(body),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

describe("gateway files route", () => {
	let fixture: FileRouteFixture | null = null;

	afterEach(async () => {
		await fixture?.cleanup();
		fixture = null;
	});

	test("lists, reads and uploads inside an allowed root", async () => {
		fixture = await createFileRouteFixture("zeta-gw-files-");
		allowFileRoot(fixture.root);
		await fs.mkdir(join(fixture.root, "src"), { recursive: true });
		await fs.writeFile(join(fixture.root, "readme.md"), "# hi\n", "utf8");
		await fs.writeFile(join(fixture.root, "src", "note.ts"), "export const x = 1;\n", "utf8");

		const list = await webGatewayFetch(new Request(fileRouteUrl(fixture.root, "?type=list")), LOOPBACK);
		expect(list.status).toBe(200);
		const listBody = (await list.json()) as {
			path: string;
			entries: Array<{ name: string; isDir: boolean; size: number; modified: string }>;
		};
		expect(listBody.path).toBe(fixture.root.replace(/\\/g, "/"));
		expect(listBody.entries).toEqual([
			{ name: "src", isDir: true, size: 0, modified: "" },
			{ name: "readme.md", isDir: false, size: 0, modified: "" },
		]);

		const read = await webGatewayFetch(
			new Request(fileRouteUrl(join(fixture.root, "src", "note.ts"), "?type=read")),
			LOOPBACK,
		);
		expect(read.status).toBe(200);
		expect(await read.json()).toEqual({
			content: "export const x = 1;\n",
			language: "typescript",
			size: Buffer.byteLength("export const x = 1;\n"),
		});

		// Binary files stream instead of being decoded as UTF-8, and `meta`
		// reports what the viewer should use.
		await fs.writeFile(join(fixture.root, "pixel.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
		const image = await webGatewayFetch(
			new Request(fileRouteUrl(join(fixture.root, "pixel.png"), "?type=read")),
			LOOPBACK,
		);
		expect(image.status).toBe(200);
		expect(image.headers.get("content-type")).toBe("image/png");
		expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

		const meta = await webGatewayFetch(
			new Request(fileRouteUrl(join(fixture.root, "pixel.png"), "?type=meta")),
			LOOPBACK,
		);
		expect(await meta.json()).toEqual({
			size: 4,
			language: "text",
			mime: "image/png",
			previewKind: null,
		});

		const upload = multipartUpload("uploaded.txt", "uploaded by the file tree");
		const uploadResponse = await webGatewayFetch(
			new Request(fileRouteUrl(fixture.root, "?type=upload&conflict=error"), {
				method: "POST",
				headers: { "content-type": upload.contentType },
				body: upload.body,
			}),
			LOOPBACK,
		);
		expect(uploadResponse.status).toBe(200);
		expect(await uploadResponse.json()).toEqual({ uploaded: ["uploaded.txt"], skipped: [], errors: [] });
		expect(await fs.readFile(join(fixture.root, "uploaded.txt"), "utf8")).toBe("uploaded by the file tree");
	});

	test("accepts a drive-encoded path with an empty leading segment", async () => {
		fixture = await createFileRouteFixture("zeta-gw-files-segments-");
		allowFileRoot(fixture.root);
		await fs.writeFile(join(fixture.root, "segment.txt"), "segment form", "utf8");

		// The renderer encodes every absolute-path segment individually, so a
		// POSIX root arrives as `/api/files//repo/...` and a Windows drive as
		// `/api/files/C%3A/...`. The empty first segment must be dropped, not
		// treated as a path component of its own.
		const encoded = fixture.root
			.split(/[\\/]+/)
			.filter(Boolean)
			.map(segment => encodeURIComponent(segment))
			.join("/");
		const url = `http://gateway.local/api/files//${encoded}?type=list`;
		expect(new URL(url).pathname.startsWith("/api/files//")).toBe(true);

		const response = await webGatewayFetch(new Request(url), LOOPBACK);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { path: string; entries: Array<{ name: string }> };
		expect(body.path).toBe(fixture.root.replace(/\\/g, "/"));
		expect(body.entries.map(entry => entry.name)).toEqual(["segment.txt"]);
	});

	test("refuses a path outside every allowed root", async () => {
		fixture = await createFileRouteFixture("zeta-gw-files-outside-");
		allowFileRoot(fixture.root);
		await fs.writeFile(join(fixture.outside, "secret.txt"), "not yours", "utf8");

		const list = await webGatewayFetch(new Request(fileRouteUrl(fixture.outside, "?type=list")), LOOPBACK);
		expect(list.status).toBe(403);
		expect(await list.json()).toEqual({ error: "Access denied" });

		const read = await webGatewayFetch(
			new Request(fileRouteUrl(join(fixture.outside, "secret.txt"), "?type=read")),
			LOOPBACK,
		);
		expect(read.status).toBe(403);
		expect(await read.json()).toEqual({ error: "Access denied" });

		// The upload directory goes through the same confinement: a POST must not
		// be able to write into a sibling root.
		const upload = multipartUpload("planted.txt", "planted");
		const uploadResponse = await webGatewayFetch(
			new Request(fileRouteUrl(fixture.outside, "?type=upload&conflict=overwrite"), {
				method: "POST",
				headers: { "content-type": upload.contentType },
				body: upload.body,
			}),
			LOOPBACK,
		);
		expect(uploadResponse.status).toBe(403);
		expect(await uploadResponse.json()).toEqual({ error: "Access denied" });
		await expect(fs.readFile(join(fixture.outside, "planted.txt"))).rejects.toThrow();
	});

	test("refuses a symlinked escape from an allowed root", async () => {
		fixture = await createFileRouteFixture("zeta-gw-files-link-");
		allowFileRoot(fixture.root);
		await fs.writeFile(join(fixture.outside, "secret.txt"), "not yours", "utf8");

		const link = join(fixture.root, "escape");
		const linked = await fs
			.symlink(fixture.outside, link, process.platform === "win32" ? "junction" : "dir")
			.then(() => true)
			.catch(() => false);
		if (!linked) return; // Platform cannot create the escape fixture.

		const response = await webGatewayFetch(new Request(fileRouteUrl(link, "?type=list")), LOOPBACK);
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Access denied" });
	});

	test("refuses an oversize text preview with 413", async () => {
		fixture = await createFileRouteFixture("zeta-gw-files-large-");
		allowFileRoot(fixture.root);
		// 256 KiB limit: one byte over is refused, not truncated.
		await fs.writeFile(join(fixture.root, "big.txt"), "x".repeat(256 * 1024 + 1), "utf8");

		const response = await webGatewayFetch(
			new Request(fileRouteUrl(join(fixture.root, "big.txt"), "?type=read")),
			LOOPBACK,
		);
		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({ error: "File too large for preview (>256KB)" });
	});

	test("refuses an oversize upload body with 413", async () => {
		fixture = await createFileRouteFixture("zeta-gw-files-body-");
		allowFileRoot(fixture.root);

		// Multipart bodies are capped at 100 MiB + 1 MiB of framing. A declared
		// Content-Length over the cap is rejected before the body is read, so the
		// gateway never buffers an attacker-sized payload.
		const response = await webGatewayFetch(
			new Request(fileRouteUrl(fixture.root, "?type=upload&conflict=error"), {
				method: "POST",
				headers: {
					"content-type": "multipart/form-data; boundary=zeta",
					"content-length": String(102 * 1024 * 1024),
				},
				body: new Uint8Array(1),
			}),
			LOOPBACK,
		);
		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({ error: "Uploads must total 100MB or less" });
	});

	test("serves a session cwd discovered from the session list", async () => {
		fixture = await createFileRouteFixture("zeta-gw-files-session-");
		await fs.writeFile(join(fixture.root, "from-session.txt"), "session root", "utf8");
		await seedSessionForCwd(fixture.root);

		const response = await webGatewayFetch(
			new Request(fileRouteUrl(join(fixture.root, "from-session.txt"), "?type=read")),
			LOOPBACK,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			content: "session root",
			language: "text",
			size: Buffer.byteLength("session root"),
		});
	});
});
