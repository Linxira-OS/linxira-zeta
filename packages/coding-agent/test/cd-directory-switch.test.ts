/**
 * `/cd` persistence: switching directories relocates the session file into the
 * destination's bucket and rewrites the header cwd, so a later launch in the new
 * directory finds the session there and nothing is left dangling in the old one.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir, setAgentDir } from "@linxiraos/pi-utils";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";

let root: string;
let sourceCwd: string;
let targetCwd: string;
let originalAgentDir: string;

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-cd-switch-"));
	sourceCwd = path.join(root, "source");
	targetCwd = path.join(root, "target");
	fs.mkdirSync(sourceCwd, { recursive: true });
	fs.mkdirSync(targetCwd, { recursive: true });
	// Keep session buckets inside the test root instead of the developer's store.
	originalAgentDir = getAgentDir();
	setAgentDir(path.join(root, "agent"));
});

afterAll(() => {
	setAgentDir(originalAgentDir);
	fs.rmSync(root, { recursive: true, force: true });
});

describe("switching the session directory", () => {
	it("moves the session file into the target bucket and rewrites the header cwd", async () => {
		const sourceFile = SessionManager.createEmptySessionFile(sourceCwd);
		expect(await Bun.file(sourceFile).exists()).toBe(true);
		const manager = await SessionManager.open(sourceFile);
		expect(manager.getCwd()).toBe(sourceCwd);

		await manager.moveTo(targetCwd);

		expect(manager.getCwd()).toBe(targetCwd);
		const movedFile = manager.getSessionFile();
		const targetBucket = SessionManager.getDefaultSessionDir(targetCwd);
		expect(targetBucket).not.toBe(SessionManager.getDefaultSessionDir(sourceCwd));
		expect(movedFile).toBe(path.join(targetBucket, path.basename(sourceFile)));
		expect(await Bun.file(movedFile!).exists()).toBe(true);
		// The old bucket no longer holds a copy that points at the old directory.
		expect(await Bun.file(sourceFile).exists()).toBe(false);

		// The journal's first entry may be a title row; the header is its own line.
		const lines = (await Bun.file(movedFile!).text())
			.split("\n")
			.filter(line => line.trim().length > 0)
			.map(line => JSON.parse(line) as { type?: string; cwd?: string });
		expect(lines.find(line => line.type === "session")?.cwd).toBe(targetCwd);
	});
});
