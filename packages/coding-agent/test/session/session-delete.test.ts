import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { deleteSessionFiles } from "@linxiraos/zeta/session/session-delete";
import { loadHiddenSessionIds, setSessionHidden } from "@linxiraos/zeta/session/session-visibility";
import { loadPinnedSessionIds, setSessionPinned } from "@linxiraos/zeta/session/session-pins";

describe("shared conversation deletion", () => {
	let root: string;
	let agentDir: string;
	let trashDir: string;
	let sessionFile: string;

	beforeEach(async () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "session-delete-"));
		agentDir = path.join(root, "agent");
		trashDir = path.join(root, "trash");
		fs.mkdirSync(agentDir, { recursive: true });
		sessionFile = path.join(root, "zeta_20260101_sess-1.jsonl");
		fs.writeFileSync(
			sessionFile,
			`${JSON.stringify({ type: "session", id: "sess-1", cwd: root, timestamp: new Date().toISOString() })}\n`,
		);
		await setSessionHidden("sess-1", true, agentDir);
		await setSessionPinned("sess-1", true, agentDir);
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
		delete process.env.ZETA_TRASH_DIR;
	});

	it("uses the same trash path as Work Studio and drops hide/pin metadata", async () => {
		process.env.ZETA_TRASH_DIR = trashDir;
		const result = await deleteSessionFiles(sessionFile, { mode: "trash", agentDir });

		expect(result).toEqual({ deleted: true, sessionId: "sess-1" });
		expect(fs.existsSync(sessionFile)).toBe(false);
		expect(fs.readdirSync(trashDir)).toHaveLength(1);
		expect((await loadHiddenSessionIds(agentDir)).size).toBe(0);
		expect((await loadPinnedSessionIds(agentDir)).size).toBe(0);
	});
});
