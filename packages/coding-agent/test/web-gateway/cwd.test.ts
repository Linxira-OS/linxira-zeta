/**
 * Gateway workspace-picker routes (`default-cwd`, `cwd/browse`, `cwd/validate`,
 * `fs/directories`).
 *
 * The picker intentionally lists any readable directory — that is how a user
 * reaches a project outside the current roots — so the refusal contract here
 * is the missing/invalid path status and the duplicate-folder conflict, which
 * the renderer renders as inline errors.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { webGatewayFetch } from "../../src/server/web-gateway";
import { type FileRouteFixture, createFileRouteFixture, gatewayUrl } from "./file-routes-fixture";

const LOOPBACK = "127.0.0.1";

function postJson(url: string, payload: unknown): Request {
	return new Request(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
}

describe("gateway workspace routes", () => {
	let fixture: FileRouteFixture | null = null;

	afterEach(async () => {
		await fixture?.cleanup();
		fixture = null;
	});

	test("validates a workspace and browses its subdirectories", async () => {
		fixture = await createFileRouteFixture("zeta-gw-cwd-");
		await fs.mkdir(join(fixture.root, "child"), { recursive: true });

		const validate = await webGatewayFetch(
			postJson(gatewayUrl("/api/cwd/validate"), { cwd: fixture.root }),
			LOOPBACK,
		);
		expect(validate.status).toBe(200);
		expect(await validate.json()).toEqual({ success: true, cwd: fixture.root });

		const browse = await webGatewayFetch(
			new Request(gatewayUrl("/api/cwd/browse", { path: fixture.root })),
			LOOPBACK,
		);
		expect(browse.status).toBe(200);
		const browseBody = (await browse.json()) as {
			path: string;
			parentPath: string | null;
			directories: Array<{ name: string; path: string }>;
		};
		expect(browseBody.directories.map(entry => entry.name)).toEqual(["child"]);
		expect(browseBody.path.endsWith("root")).toBe(true);
		expect(browseBody.parentPath).not.toBeNull();

		const directories = await webGatewayFetch(
			new Request(gatewayUrl("/api/fs/directories", { path: fixture.root })),
			LOOPBACK,
		);
		expect(directories.status).toBe(200);
		const directoriesBody = (await directories.json()) as {
			currentPath: string;
			homeDir: string;
			directories: Array<{ name: string; path: string }>;
		};
		expect(directoriesBody.currentPath).toBe(fixture.root);
		expect(directoriesBody.homeDir).toBe(homedir());
		expect(directoriesBody.directories.map(entry => entry.name)).toEqual(["child"]);
	});

	test("creates the default workspace outside the real home", async () => {
		fixture = await createFileRouteFixture("zeta-gw-default-cwd-");

		const response = await webGatewayFetch(new Request(gatewayUrl("/api/default-cwd"), { method: "POST" }), LOOPBACK);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ cwd: fixture.workspace });
		expect(existsSync(fixture.workspace)).toBe(true);
	});

	test("refuses an empty or missing workspace path", async () => {
		fixture = await createFileRouteFixture("zeta-gw-cwd-refuse-");
		const missing = join(fixture.root, "does-not-exist");

		const empty = await webGatewayFetch(postJson(gatewayUrl("/api/cwd/validate"), { cwd: "   " }), LOOPBACK);
		expect(empty.status).toBe(400);
		expect(await empty.json()).toEqual({ error: "Path is required" });

		const absent = await webGatewayFetch(postJson(gatewayUrl("/api/cwd/validate"), { cwd: missing }), LOOPBACK);
		expect(absent.status).toBe(400);
		expect(await absent.json()).toEqual({ error: `Directory does not exist: ${missing}` });

		const browse = await webGatewayFetch(new Request(gatewayUrl("/api/cwd/browse", { path: missing })), LOOPBACK);
		expect(browse.status).toBe(404);
		expect(await browse.json()).toEqual({ error: "Directory does not exist" });

		const directories = await webGatewayFetch(
			new Request(gatewayUrl("/api/fs/directories", { path: missing })),
			LOOPBACK,
		);
		expect(directories.status).toBe(404);
		expect(await directories.json()).toEqual({ error: `Directory does not exist: ${missing}` });
	});

	test("creates a folder and refuses a duplicate", async () => {
		fixture = await createFileRouteFixture("zeta-gw-mkdir-");

		const created = await webGatewayFetch(
			postJson(gatewayUrl("/api/fs/directories"), { parentPath: fixture.root, folderName: "new-folder" }),
			LOOPBACK,
		);
		expect(created.status).toBe(200);
		expect(await created.json()).toEqual({ success: true, path: join(fixture.root, "new-folder") });
		expect(existsSync(join(fixture.root, "new-folder"))).toBe(true);

		const duplicate = await webGatewayFetch(
			postJson(gatewayUrl("/api/fs/directories"), { parentPath: fixture.root, folderName: "new-folder" }),
			LOOPBACK,
		);
		expect(duplicate.status).toBe(409);
		expect(await duplicate.json()).toEqual({
			error: `Folder already exists: ${join(fixture.root, "new-folder")}`,
		});

		const unnamed = await webGatewayFetch(
			postJson(gatewayUrl("/api/fs/directories"), { parentPath: fixture.root, folderName: "   " }),
			LOOPBACK,
		);
		expect(unnamed.status).toBe(400);
		expect(await unnamed.json()).toEqual({ error: "Folder name is required" });
	});
});
