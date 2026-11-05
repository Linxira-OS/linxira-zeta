/**
 * Gateway `/api/file-index` contract for the @-mention menu.
 *
 * The index decides which files a prompt may reference, so the confinement
 * checks are the regression that matters: a cwd outside the allowed roots, or
 * a symlink whose real target is outside them, must be refused.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { allowFileRoot } from "../../src/server/web-gateway/file-roots";
import { webGatewayFetch } from "../../src/server/web-gateway";
import { type FileRouteFixture, createFileRouteFixture, gatewayUrl } from "./file-routes-fixture";

const LOOPBACK = "127.0.0.1";

describe("gateway file-index route", () => {
	let fixture: FileRouteFixture | null = null;

	afterEach(async () => {
		await fixture?.cleanup();
		fixture = null;
	});

	test("lists files and ranks a query inside an allowed root", async () => {
		fixture = await createFileRouteFixture("zeta-gw-index-");
		allowFileRoot(fixture.root);
		await fs.mkdir(join(fixture.root, "src"), { recursive: true });
		await fs.writeFile(join(fixture.root, "a.txt"), "a", "utf8");
		await fs.writeFile(join(fixture.root, "src", "beta.ts"), "b", "utf8");
		await fs.mkdir(join(fixture.root, "node_modules"), { recursive: true });
		await fs.writeFile(join(fixture.root, "node_modules", "hidden.js"), "x", "utf8");

		const listed = await webGatewayFetch(new Request(gatewayUrl("/api/file-index", { cwd: fixture.root })), LOOPBACK);
		expect(listed.status).toBe(200);
		const listedBody = (await listed.json()) as { files: string[]; truncated: boolean };
		expect(listedBody.files.sort()).toEqual(["a.txt", "src/beta.ts"]);
		expect(listedBody.truncated).toBe(false);

		const searched = await webGatewayFetch(
			new Request(gatewayUrl("/api/file-index", { cwd: fixture.root, q: "beta" })),
			LOOPBACK,
		);
		expect(searched.status).toBe(200);
		expect(await searched.json()).toEqual({ matches: [{ path: "src/beta.ts", isDir: false }] });
	});

	test("refuses a cwd outside every allowed root", async () => {
		fixture = await createFileRouteFixture("zeta-gw-index-refuse-");
		allowFileRoot(fixture.root);

		const outside = await webGatewayFetch(
			new Request(gatewayUrl("/api/file-index", { cwd: fixture.outside })),
			LOOPBACK,
		);
		expect(outside.status).toBe(403);
		expect(await outside.json()).toEqual({ error: "Access denied" });

		const relative = await webGatewayFetch(
			new Request(gatewayUrl("/api/file-index", { cwd: "relative/path" })),
			LOOPBACK,
		);
		expect(relative.status).toBe(400);
		expect(await relative.json()).toEqual({ error: "cwd must be an absolute path" });
	});

	test("refuses a symlinked cwd that resolves outside the allowed root", async () => {
		fixture = await createFileRouteFixture("zeta-gw-index-link-");
		allowFileRoot(fixture.root);
		const link = join(fixture.root, "escape");
		const linked = await fs
			.symlink(fixture.outside, link, process.platform === "win32" ? "junction" : "dir")
			.then(() => true)
			.catch(() => false);
		if (!linked) return; // Platform cannot create the escape fixture.

		const response = await webGatewayFetch(new Request(gatewayUrl("/api/file-index", { cwd: link })), LOOPBACK);
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Access denied" });
	});
});
