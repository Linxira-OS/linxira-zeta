import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	listTrashSessions,
	moveSessionToTrash,
	restoreSessionFromTrash,
	sweepExpiredTrash,
} from "@linxiraos/zeta/session/session-trash";

let tmpRoot: string;
let workspaceDir: string;
let trashDir: string;

beforeEach(async () => {
	tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "zeta-trash-"));
	workspaceDir = path.join(tmpRoot, "workspace", ".zeta", "sessions");
	trashDir = path.join(tmpRoot, "trash", "sessions");
	await fsp.mkdir(workspaceDir, { recursive: true });
});

afterEach(async () => {
	await fsp.rm(tmpRoot, { recursive: true, force: true });
});

const SESSION_ID = "0198abcd-0000-7000-8000-000000000001";

function sessionFile(): string {
	return `${path.join(workspaceDir, "2026-10-06T10-00-00-000Z")}_${SESSION_ID}.jsonl`;
}

function artifactsDir(): string {
	return sessionFile().slice(0, -".jsonl".length);
}

async function seedSession(withArtifacts = true): Promise<void> {
	const file = sessionFile();
	await fsp.writeFile(
		file,
		`${JSON.stringify({ type: "session", version: 1, id: SESSION_ID, title: "Relay planning", timestamp: "2026-10-06T10:00:00.000Z", cwd: workspaceDir })}\n`,
		"utf8",
	);
	if (withArtifacts) {
		await fsp.mkdir(artifactsDir(), { recursive: true });
		await fsp.writeFile(path.join(artifactsDir(), "blob.bin"), "artifact-bytes", "utf8");
	}
}

describe("moveSessionToTrash", () => {
	test("moves transcript, artifacts, and .bak backups into a manifest entry", async () => {
		await seedSession();
		const bak = `${sessionFile()}.123.bak`;
		await fsp.writeFile(bak, "stale", "utf8");

		const result = await moveSessionToTrash(sessionFile(), { trashDir, now: new Date("2026-10-06T12:00:00.000Z") });
		expect(result.moved).toBe(true);

		expect(fs.existsSync(sessionFile())).toBe(false);
		expect(fs.existsSync(artifactsDir())).toBe(false);
		expect(fs.existsSync(bak)).toBe(false);

		const entry = result.entry!;
		expect(path.dirname(entry.dir)).toBe(path.resolve(trashDir));
		expect(path.basename(entry.dir).endsWith(`_${SESSION_ID}`)).toBe(true);
		expect(fs.existsSync(entry.sessionFile)).toBe(true);
		expect(entry.artifactsDir && fs.existsSync(entry.artifactsDir)).toBe(true);

		expect(entry.manifest.originalPath).toBe(path.resolve(sessionFile()));
		expect(entry.manifest.sessionId).toBe(SESSION_ID);
		expect(entry.manifest.title).toBe("Relay planning");
		expect(entry.manifest.artifactsDirName).toBe(path.basename(artifactsDir()));
		expect(entry.manifest.trashedAt).toBe("2026-10-06T12:00:00.000Z");
	});

	test("missing session file is a no-op success", async () => {
		const result = await moveSessionToTrash(path.join(workspaceDir, "gone.jsonl"), { trashDir });
		expect(result.moved).toBe(false);
		expect(result.entry).toBeNull();
	});

	test("same-name entries in one timestamp get -N suffixes", async () => {
		await seedSession();
		const first = await moveSessionToTrash(sessionFile(), { trashDir, now: new Date("2026-10-06T12:00:00.000Z") });
		await seedSession();
		const second = await moveSessionToTrash(sessionFile(), { trashDir, now: new Date("2026-10-06T12:00:00.000Z") });
		expect(first.entry!.dir).not.toBe(second.entry!.dir);
		expect(path.basename(second.entry!.dir).endsWith("-1")).toBe(true);
	});
});

describe("listTrashSessions", () => {
	test("lists newest first and skips malformed entries", async () => {
		await seedSession();
		await moveSessionToTrash(sessionFile(), { trashDir, now: new Date("2026-10-06T12:00:00.000Z") });

		const olderFile = sessionFile().replace("10-00-00", "09-00-00");
		await fsp.writeFile(
			olderFile,
			`${JSON.stringify({ type: "session", version: 1, id: `${SESSION_ID.slice(0, -1)}2`, timestamp: "2026-10-06T09:00:00.000Z", cwd: workspaceDir })}\n`,
			"utf8",
		);
		await moveSessionToTrash(olderFile, { trashDir, now: new Date("2026-10-06T11:00:00.000Z") });

		await fsp.mkdir(path.join(trashDir, "garbage-partial"), { recursive: true });

		const entries = await listTrashSessions({ trashDir });
		expect(entries).toHaveLength(2);
		expect(entries[0].manifest.trashedAt).toBe("2026-10-06T12:00:00.000Z");
		expect(entries[1].manifest.trashedAt).toBe("2026-10-06T11:00:00.000Z");
		expect(entries[0].manifest.title).toBe("Relay planning");
	});

	test("missing trash dir lists empty", async () => {
		expect(await listTrashSessions({ trashDir })).toEqual([]);
	});
});

describe("restoreSessionFromTrash", () => {
	test("moves the session back to its original paths and drains the entry", async () => {
		await seedSession();
		const { entry } = await moveSessionToTrash(sessionFile(), { trashDir });

		const restored = await restoreSessionFromTrash(entry!);
		expect(restored.sessionFile).toBe(path.resolve(sessionFile()));
		expect(restored.artifactsDir).toBe(path.resolve(artifactsDir()));
		expect(fs.existsSync(sessionFile())).toBe(true);
		expect(fs.existsSync(path.join(artifactsDir(), "blob.bin"))).toBe(true);
		// Entry fully drained: directory gone.
		expect(fs.existsSync(entry!.dir)).toBe(false);
	});

	test("collides into a .restored-<ts> name when the original path is taken", async () => {
		await seedSession();
		const { entry } = await moveSessionToTrash(sessionFile(), { trashDir });
		await seedSession();

		const restored = await restoreSessionFromTrash(entry!, { now: new Date("2026-10-06T13:00:00.000Z") });
		expect(restored.sessionFile).toContain(".restored-2026-10-06T13-00-00-000Z.jsonl");
		expect(fs.existsSync(sessionFile())).toBe(true);
		expect(fs.existsSync(restored.sessionFile)).toBe(true);
	});
});

describe("sweepExpiredTrash", () => {
	test("removes expired entries, keeps fresh ones, honors retention 0", async () => {
		await seedSession();
		await moveSessionToTrash(sessionFile(), { trashDir, now: new Date("2026-09-01T00:00:00.000Z") });

		const now = Date.parse("2026-10-06T00:00:00.000Z");
		// 30-day retention: Sept 1 entry (35 days old) expires.
		expect(await sweepExpiredTrash({ trashDir, retentionDays: 30, now })).toBe(1);
		expect(await listTrashSessions({ trashDir })).toHaveLength(0);

		// retention 0 = keep forever.
		await seedSession();
		await moveSessionToTrash(sessionFile(), { trashDir, now: new Date("2026-01-01T00:00:00.000Z") });
		expect(await sweepExpiredTrash({ trashDir, retentionDays: 0, now })).toBe(0);
		expect(await listTrashSessions({ trashDir })).toHaveLength(1);
	});

	test("cleans manifest-less directories by mtime", async () => {
		const orphan = path.join(trashDir, "orphan-partial");
		await fsp.mkdir(orphan, { recursive: true });
		// Backdate far past any retention window.
		await fsp.utimes(orphan, new Date(0), new Date(0));
		expect(
			await sweepExpiredTrash({ trashDir, retentionDays: 30, now: Date.parse("2026-10-06T00:00:00.000Z") }),
		).toBe(1);
		expect(fs.existsSync(orphan)).toBe(false);
	});
});
