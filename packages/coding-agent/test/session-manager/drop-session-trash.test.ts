import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { listTrashSessions } from "@linxiraos/zeta/session/session-trash";

let tmpRoot: string;
let trashDir: string;
let originalTrashEnv: string | undefined;

beforeEach(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-drop-trash-"));
	trashDir = path.join(tmpRoot, "trash", "sessions");
	originalTrashEnv = process.env.ZETA_TRASH_DIR;
	process.env.ZETA_TRASH_DIR = trashDir;
});

afterEach(() => {
	if (originalTrashEnv === undefined) delete process.env.ZETA_TRASH_DIR;
	else process.env.ZETA_TRASH_DIR = originalTrashEnv;
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("SessionManager.dropSession soft-delete", () => {
	it("moves the transcript and artifacts into the trash instead of deleting", async () => {
		const cwd = path.join(tmpRoot, "project");
		fs.mkdirSync(cwd, { recursive: true });
		const sessionDir = path.join(cwd, ".zeta", "sessions");
		const sm = SessionManager.create(cwd, sessionDir);
		const sessionFile = await sm.newSession();
		expect(sessionFile).toBeTruthy();

		// Artifacts directory shares the transcript stem.
		const artifactsDir = sessionFile!.slice(0, -".jsonl".length);
		fs.mkdirSync(artifactsDir, { recursive: true });
		fs.writeFileSync(path.join(artifactsDir, "artifact.txt"), "x");

		await sm.dropSession(sessionFile!);

		expect(fs.existsSync(sessionFile!)).toBe(false);
		expect(fs.existsSync(artifactsDir)).toBe(false);

		const entries = await listTrashSessions({ trashDir });
		expect(entries).toHaveLength(1);
		expect(entries[0].manifest.originalPath).toBe(path.resolve(sessionFile!));
		expect(fs.existsSync(entries[0].sessionFile)).toBe(true);
		expect(entries[0].artifactsDir && fs.existsSync(entries[0].artifactsDir)).toBe(true);
		await sm.close();
	});

	it("treats a missing session file as success", async () => {
		const cwd = path.join(tmpRoot, "project");
		fs.mkdirSync(cwd, { recursive: true });
		const sm = SessionManager.create(cwd);
		await expect(sm.dropSession(path.join(tmpRoot, "nope.jsonl"))).resolves.toBeUndefined();
		await sm.close();
	});
});
