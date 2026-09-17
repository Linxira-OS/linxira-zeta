import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { syncAllSessions } from "@linxiraos/pi-stats/aggregator";
import { getFileOffset, getMessageCount, initDb, pruneOrphanSessionsInDb, setFileOffset } from "@linxiraos/pi-stats/db";
import { getSessionsDir } from "@linxiraos/pi-utils";
import { installStatsTestIsolation } from "./helpers/temp-agent";

installStatsTestIsolation("@pi-stats-prune-orphans-");
function createMemoryDb(): Database {
	const database = new Database(":memory:");
	database.run(`
		CREATE TABLE messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_file TEXT NOT NULL,
			entry_id TEXT NOT NULL,
			UNIQUE(session_file, entry_id)
		);
		CREATE TABLE user_messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_file TEXT NOT NULL,
			entry_id TEXT NOT NULL,
			UNIQUE(session_file, entry_id)
		);
		CREATE TABLE tool_calls (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_file TEXT NOT NULL,
			tool_call_id TEXT NOT NULL,
			UNIQUE(session_file, tool_call_id)
		);
		CREATE TABLE file_offsets (
			session_file TEXT PRIMARY KEY,
			offset INTEGER NOT NULL,
			last_modified INTEGER NOT NULL
		);
	`);
	return database;
}

function seedSessionRows(database: Database, sessionFile: string): void {
	database
		.prepare("INSERT INTO messages (session_file, entry_id) VALUES (?, ?)")
		.run(sessionFile, `entry-${sessionFile}`);
	database
		.prepare("INSERT INTO user_messages (session_file, entry_id) VALUES (?, ?)")
		.run(sessionFile, `user-${sessionFile}`);
	database
		.prepare("INSERT INTO tool_calls (session_file, tool_call_id) VALUES (?, ?)")
		.run(sessionFile, `call-${sessionFile}`);
	database
		.prepare("INSERT INTO file_offsets (session_file, offset, last_modified) VALUES (?, 10, 20)")
		.run(sessionFile);
}

function storedFiles(database: Database, table: string): string[] {
	return (database.prepare(`SELECT DISTINCT session_file AS f FROM ${table}`).all() as { f: string }[]).map(
		row => row.f,
	);
}

describe("pruneOrphanSessionsInDb", () => {
	it("deletes every row for session files missing from the existing set", () => {
		const database = createMemoryDb();
		seedSessionRows(database, "/live/a.jsonl");
		seedSessionRows(database, "/dead/b.jsonl");

		const result = pruneOrphanSessionsInDb(database, ["/live/a.jsonl"]);

		expect(result).toEqual({ prunedFiles: 1, deletedRows: 4 });
		for (const table of ["messages", "user_messages", "tool_calls", "file_offsets"]) {
			expect(storedFiles(database, table)).toEqual(["/live/a.jsonl"]);
		}
	});

	it("matches stored paths modulo separators and Windows casing", () => {
		const database = createMemoryDb();
		seedSessionRows(database, "C:\\Users\\dev\\Sessions\\live.jsonl");

		const result = pruneOrphanSessionsInDb(database, ["C:/Users/dev/Sessions/live.jsonl"]);

		expect(result).toEqual({ prunedFiles: 0, deletedRows: 0 });
		expect(storedFiles(database, "file_offsets")).toEqual(["C:\\Users\\dev\\Sessions\\live.jsonl"]);
	});
});

describe("syncAllSessions orphan cleanup", () => {
	it("drops temp-project sessions and orphaned offsets end to end", async () => {
		const assistant = {
			type: "message",
			id: "assistant-1",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: {
				role: "assistant",
				content: [{ type: "text", text: "ok" }],
				api: "openai-responses",
				provider: "openai",
				model: "gpt-5.4",
				usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3 },
				stopReason: "stop",
				timestamp: Date.now(),
				duration: 10,
				ttft: 5,
			},
		};
		const writeSession = async (slug: string) => {
			const dir = path.join(getSessionsDir(), slug);
			await fs.mkdir(dir, { recursive: true });
			await Bun.write(path.join(dir, "session.jsonl"), `${JSON.stringify(assistant)}\n`);
		};
		await writeSession("--zeta-fixtures--prune-live");
		await writeSession("-tmp-prune-junk");
		setFileOffset("/ghost/removed.jsonl", 5, 5);

		const synced = await syncAllSessions({ workers: 1 });

		expect(synced.files).toBe(1);
		expect(getFileOffset("/ghost/removed.jsonl")).toBeNull();
	});
});
