/**
 * Cross-client provenance contract (Zeta-only): a durable session header names
 * the client that created it, `/new` and both fork shapes keep it, and a header
 * written before the stamp existed still loads (absent = unknown client, never
 * a guess).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "@linxiraos/zeta/cli/args";
import { Settings } from "@linxiraos/zeta/config/settings";
import { createSessionManager } from "@linxiraos/zeta/main";
import { serveSessionClient } from "../../src/server/web-gateway/desktop";
import { SessionManager } from "../../src/session/session-manager";

describe("session client provenance", () => {
	let root: string;
	let cwd: string;

	beforeEach(async () => {
		root = await fsp.mkdtemp(path.join(os.tmpdir(), "zeta-session-client-"));
		cwd = path.join(root, "project");
		fs.mkdirSync(cwd, { recursive: true });
	});

	afterEach(async () => {
		await fsp.rm(root, { recursive: true, force: true });
	});

	const sessionDir = () => path.join(root, "sessions");

	it("stamps the creating client on a new session", () => {
		const manager = SessionManager.create(cwd, sessionDir(), undefined, { client: "web" });

		expect(manager.getHeader()?.client).toBe("web");
	});

	it("creates without a client when the creator does not stamp one", () => {
		const manager = SessionManager.create(cwd, sessionDir());

		expect(manager.getHeader()?.client).toBeUndefined();
	});

	it("keeps the client across /new, and an explicit one wins", async () => {
		const manager = SessionManager.create(cwd, sessionDir(), undefined, { client: "desktop" });

		await manager.newSession();
		expect(manager.getHeader()?.client).toBe("desktop");

		await manager.newSession({ client: "automation" });
		expect(manager.getHeader()?.client).toBe("automation");
	});

	it("keeps the client on a fork and on a persisted copy", async () => {
		const manager = SessionManager.create(cwd, sessionDir(), undefined, { client: "web" });
		await manager.ensureOnDisk();

		const forked = await manager.fork();
		expect(forked).toBeDefined();
		expect(manager.getHeader()?.client).toBe("web");

		const copy = await manager.persistCopy({ sessionDir: path.join(root, "copies") });
		expect(copy.getHeader()?.client).toBe("web");
		await copy.close();
		await manager.close();
	});

	it("keeps the client when forking a transcript file", async () => {
		const source = SessionManager.create(cwd, sessionDir(), undefined, { client: "cli" });
		await source.ensureOnDisk();
		const sourceFile = source.getSessionFile();
		expect(sourceFile).toBeTruthy();
		await source.close();

		const forked = await SessionManager.forkFrom(sourceFile!, cwd, path.join(root, "forks"));
		expect(forked.getHeader()?.client).toBe("cli");
		await forked.close();
	});

	it("reads a session written before the stamp as an unknown client", async () => {
		const manager = SessionManager.create(cwd, sessionDir(), undefined, { client: "web" });
		await manager.ensureOnDisk();
		const file = manager.getSessionFile();
		expect(file).toBeTruthy();
		await manager.close();

		fs.writeFileSync(
			file!,
			`${fs
				.readFileSync(file!, "utf8")
				.trim()
				.split("\n")
				.map(line => {
					const entry = JSON.parse(line) as Record<string, unknown>;
					delete entry.client;
					return JSON.stringify(entry);
				})
				.join("\n")}\n`,
			"utf8",
		);

		const reopened = await SessionManager.open(file!, sessionDir());
		expect(reopened.getHeader()?.client).toBeUndefined();
		expect(reopened.getEntries()).toEqual([]);
		await reopened.close();
	});

	it("stamps the client when the CLI resolves a session from its flags", async () => {
		const parsed = parseArgs(["--session-dir", sessionDir()]);

		const manager = await createSessionManager(parsed, cwd, Settings.isolated());

		expect(manager?.getHeader()?.client).toBe("cli");
		await manager?.close();
	});

	it("names the client a serve process represents", () => {
		expect(serveSessionClient({ ZETA_DESKTOP: "1" })).toBe("desktop");
		expect(serveSessionClient({ ZETA_DESKTOP: "0" })).toBe("automation");
		expect(serveSessionClient({})).toBe("automation");
	});
});
