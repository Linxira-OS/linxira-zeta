import { describe, expect, it, spyOn } from "bun:test";
import { listSessions } from "@linxiraos/zeta/session/session-listing";
import { MemorySessionStorage } from "@linxiraos/zeta/session/session-storage";

const SESSION_DIR = "/sessions/project";

function writeSession(storage: MemorySessionStorage, file: string, firstPrompt: string): void {
	storage.writeTextSync(
		file,
		[
			JSON.stringify({
				type: "session",
				id: "cache-id",
				cwd: "/repo",
				title: "Cached Title",
				timestamp: "2026-06-27T00:00:00.000Z",
			}),
			JSON.stringify({ type: "message", message: { role: "user", content: firstPrompt } }),
			"",
		].join("\n"),
	);
}

function writeParentedSession(
	storage: MemorySessionStorage,
	file: string,
	options: { agent?: string; systemPrompt?: string },
): void {
	const records: Record<string, unknown>[] = [
		{
			type: "session",
			id: `id-${file.split("/").at(-1)}`,
			cwd: "/repo",
			title: "Parented",
			timestamp: "2026-06-27T00:00:00.000Z",
			parentSession: "/sessions/project/parent.jsonl",
		},
	];
	if (options.agent) {
		records.push({
			type: "session_init",
			systemPrompt: options.systemPrompt ?? "system",
			task: "do work",
			tools: [],
			agent: options.agent,
		});
	}
	records.push({ type: "message", message: { role: "user", content: "prompt" } });
	storage.writeTextSync(file, `${records.map(record => JSON.stringify(record)).join("\n")}\n`);
}

describe("session listing subagent marker", () => {
	it("reads session_init.agent for a subagent and leaves a plain fork unmarked", async () => {
		const storage = new MemorySessionStorage();
		writeParentedSession(storage, `${SESSION_DIR}/scout.jsonl`, { agent: "scout" });
		writeParentedSession(storage, `${SESSION_DIR}/fork.jsonl`, {});
		const sessions = await listSessions(SESSION_DIR, storage);
		expect(sessions.find(session => session.path.endsWith("scout.jsonl"))?.agent).toBe("scout");
		expect(sessions.find(session => session.path.endsWith("fork.jsonl"))?.agent).toBeUndefined();
	});

	it("carries the branch recorded in the session header", async () => {
		const storage = new MemorySessionStorage();
		storage.writeTextSync(
			`${SESSION_DIR}/branchy.jsonl`,
			[
				JSON.stringify({
					type: "session",
					id: "branchy",
					cwd: "/repo",
					branch: "feat-a",
					timestamp: "2026-06-27T00:00:00.000Z",
				}),
				JSON.stringify({ type: "message", message: { role: "user", content: "hi" } }),
				"",
			].join("\n"),
		);
		const sessions = await listSessions(SESSION_DIR, storage);
		expect(sessions[0]?.branch).toBe("feat-a");
	});

	it("finds the marker past the listing prefix window", async () => {
		const storage = new MemorySessionStorage();
		writeParentedSession(storage, `${SESSION_DIR}/wide.jsonl`, {
			agent: "task",
			systemPrompt: "x".repeat(10_000),
		});
		const sessions = await listSessions(SESSION_DIR, storage);
		expect(sessions[0]?.agent).toBe("task");
	});
});

describe("session listing scan cache", () => {
	it("serves an unchanged file from cache without re-reading it", async () => {
		const storage = new MemorySessionStorage();
		const file = `${SESSION_DIR}/cached.jsonl`;
		writeSession(storage, file, "first prompt");
		const readSpy = spyOn(storage, "readTextSlices");

		const first = await listSessions(SESSION_DIR, storage);
		expect(first.map(s => s.id)).toEqual(["cache-id"]);
		expect(readSpy).toHaveBeenCalledTimes(1);

		const second = await listSessions(SESSION_DIR, storage);
		expect(readSpy).toHaveBeenCalledTimes(1);
		expect(second).toEqual(first);
	});

	it("invalidates when the file's size changes", async () => {
		const storage = new MemorySessionStorage();
		const file = `${SESSION_DIR}/grows.jsonl`;
		writeSession(storage, file, "short");
		const readSpy = spyOn(storage, "readTextSlices");

		await listSessions(SESSION_DIR, storage);
		expect(readSpy).toHaveBeenCalledTimes(1);

		// Simulate the active session growing during streaming.
		writeSession(storage, file, "a much longer replacement prompt");
		const after = await listSessions(SESSION_DIR, storage);
		expect(readSpy).toHaveBeenCalledTimes(2);
		expect(after[0]?.firstMessage).toBe("a much longer replacement prompt");
	});

	it("invalidates when mtime changes even at identical size", async () => {
		const storage = new MemorySessionStorage();
		const file = `${SESSION_DIR}/retitle.jsonl`;
		writeSession(storage, file, "same-length");
		const readSpy = spyOn(storage, "readTextSlices");

		await listSessions(SESSION_DIR, storage);
		expect(readSpy).toHaveBeenCalledTimes(1);

		// Simulate updateSessionTitle's in-place slot rewrite: same byte length,
		// newer mtime (MemorySessionStorage stamps Date.now on write). Advance
		// the clock deterministically instead of sleeping.
		const nowSpy = spyOn(Date, "now").mockReturnValue(Date.now() + 10);
		try {
			writeSession(storage, file, "SAME-LENGTH");
		} finally {
			nowSpy.mockRestore();
		}
		const after = await listSessions(SESSION_DIR, storage);
		expect(readSpy).toHaveBeenCalledTimes(2);
		expect(after[0]?.firstMessage).toBe("SAME-LENGTH");
	});

	it("caches negative results for unparseable files", async () => {
		const storage = new MemorySessionStorage();
		const file = `${SESSION_DIR}/garbage.jsonl`;
		storage.writeTextSync(file, "not json at all\n");
		const readSpy = spyOn(storage, "readTextSlices");

		expect(await listSessions(SESSION_DIR, storage)).toEqual([]);
		expect(readSpy).toHaveBeenCalledTimes(1);
		expect(await listSessions(SESSION_DIR, storage)).toEqual([]);
		expect(readSpy).toHaveBeenCalledTimes(1);
	});

	it("reports the last persisted model from the prefix and the tail window", async () => {
		const storage = new MemorySessionStorage();
		const header = JSON.stringify({
			type: "session",
			id: "model-id",
			cwd: "/repo",
			timestamp: "2026-06-27T00:00:00.000Z",
		});
		const user = JSON.stringify({ type: "message", message: { role: "user", content: "hello" } });
		const first = `${SESSION_DIR}/modeled.jsonl`;
		storage.writeTextSync(
			first,
			[header, JSON.stringify({ type: "model_change", model: "provider/first" }), user, ""].join("\n"),
		);
		const [info] = await listSessions(SESSION_DIR, storage);
		expect(info?.model).toBe("provider/first");

		// A change deep in the transcript only lands in the suffix window.
		const long = `${SESSION_DIR}/modeled-late.jsonl`;
		const filler = Array.from({ length: 40 }, () =>
			JSON.stringify({ type: "message", message: { role: "assistant", content: "x".repeat(200) } }),
		);
		storage.writeTextSync(
			long,
			[
				JSON.stringify({ type: "session", id: "late-id", cwd: "/repo", timestamp: "2026-06-27T00:00:00.000Z" }),
				JSON.stringify({ type: "model_change", model: "provider/first" }),
				user,
				...filler,
				JSON.stringify({ type: "model_change", model: "provider/late" }),
				"",
			].join("\n"),
		);
		const late = await listSessions(SESSION_DIR, storage);
		expect(late.find(session => session.id === "late-id")?.model).toBe("provider/late");
	});
});
