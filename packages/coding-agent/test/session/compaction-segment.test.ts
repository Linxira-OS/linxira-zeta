import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SessionManager } from "../../src/session/session-manager";

const dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe("compaction transcript segments", () => {
	it("moves the next segment to a sibling and records continuationOf", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-segment-"));
		dirs.push(dir);
		const manager = SessionManager.create(dir, dir);
		const oldId = manager.getSessionId();
		const oldFile = manager.getSessionFile();
		if (!oldFile) throw new Error("Expected a session file");
		manager.appendMessage({ role: "user", content: "before compaction", timestamp: Date.now() });
		await manager.flush();
		const nextFile = manager.segmentAfterCompaction();
		expect(nextFile).toBeDefined();
		expect(nextFile).not.toBe(oldFile);
		expect(manager.getSessionFile()).not.toBe(oldFile);
		manager.appendMessage({ role: "user", content: "after compaction", timestamp: Date.now() });
		manager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "continued" }],
			stopReason: "stop",
			timestamp: Date.now(),
		} as never);
		manager.flushSync();
		const lines = (await fs.readFile(nextFile!, "utf8"))
			.split("\n")
			.filter(Boolean)
			.map(line => JSON.parse(line));
		const header = lines.find(line => line.type === "session");
		expect(header?.continuationOf).toBe(oldId);
		await manager.close?.();
	});
});
