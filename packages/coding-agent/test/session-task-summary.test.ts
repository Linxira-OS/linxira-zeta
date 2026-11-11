/**
 * Latest-task projection — durable consumer and precedence.
 *
 * The projection is a deterministic bounded-window read: the latest completed
 * turn gives intent + result, an open turn gives intent without pretending a
 * result, and no messages yield no summary. Names follow the existing
 * short-title rule and never fall back to the raw session id.
 */

import { describe, expect, test } from "bun:test";
import { listSessions, sessionDisplayName } from "@linxiraos/zeta/session/session-listing";
import { MemorySessionStorage } from "@linxiraos/zeta/session/session-storage";
import {
	excerptTaskText,
	normalizeSessionTaskSummary,
	sessionTaskSummaryText,
} from "@linxiraos/zeta/session/session-task-summary";

const DIR = "/sessions/task-summary";
const T1 = "2026-07-01T09:00:00.000Z";
const T2 = "2026-07-01T09:01:00.000Z";

function header(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		type: "session",
		version: 3,
		id: "session-id",
		cwd: "/repo",
		timestamp: T1,
		...overrides,
	};
}

function message(
	id: string,
	role: "user" | "assistant",
	text: string,
	timestamp = T1,
): Record<string, unknown> {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp,
		message: {
			role,
			content: role === "assistant" ? [{ type: "text", text }] : text,
			...(role === "assistant" ? { provider: "p", model: "m" } : {}),
			timestamp: 0,
		},
	};
}

function write(storage: MemorySessionStorage, file: string, entries: readonly Record<string, unknown>[]): void {
	storage.writeTextSync(
		`${DIR}/${file}`,
		[...[JSON.stringify(header()), ...entries.map(entry => JSON.stringify(entry))], ""].join("\n"),
	);
}

describe("latest task summary", () => {
	test("a completed turn yields intent and result", async () => {
		const storage = new MemorySessionStorage();
		write(storage, "completed.jsonl", [
			message("u1", "user", "add the missing route"),
			message("a1", "assistant", "Route added and tests pass."),
		]);

		const [session] = await listSessions(DIR, storage);
		const summary = session?.taskSummary;
		expect(summary?.status).toBe("completed");
		expect(summary?.source).toBe("completed_turn");
		expect(summary?.intent).toBe("add the missing route");
		expect(summary?.result).toBe("Route added and tests pass.");
		expect(summary?.at).toBe(T1);
		expect(sessionTaskSummaryText(summary)).toBe("Route added and tests pass.");
	});

	test("the latest completed turn wins over an earlier one", async () => {
		const storage = new MemorySessionStorage();
		write(storage, "two-turns.jsonl", [
			message("u1", "user", "first task", "2026-07-01T09:00:00.000Z"),
			message("a1", "assistant", "first result", "2026-07-01T09:00:30.000Z"),
			message("u2", "user", "second task", "2026-07-01T09:01:00.000Z"),
			message("a2", "assistant", "second result", "2026-07-01T09:01:30.000Z"),
		]);

		const [session] = await listSessions(DIR, storage);
		expect(session?.taskSummary?.intent).toBe("second task");
		expect(session?.taskSummary?.result).toBe("second result");
	});

	test("an open turn is incomplete and never borrows a result", async () => {
		const storage = new MemorySessionStorage();
		write(storage, "open.jsonl", [message("u1", "user", "still working on this")]);

		const [session] = await listSessions(DIR, storage);
		const summary = session?.taskSummary;
		expect(summary?.status).toBe("incomplete");
		expect(summary?.source).toBe("open_turn");
		expect(summary?.intent).toBe("still working on this");
		expect(summary?.result).toBeUndefined();
		// Display falls back to intent, not a fake completion.
		expect(sessionTaskSummaryText(summary)).toBe("still working on this");
	});

	test("no messages means no summary object at all", async () => {
		const storage = new MemorySessionStorage();
		storage.writeTextSync(`${DIR}/empty.jsonl`, `${JSON.stringify(header())}\n`);

		const [session] = await listSessions(DIR, storage);
		expect(session?.taskSummary).toBeUndefined();
	});

	test("the display name follows the short-title rule without a raw id", () => {
		expect(
			sessionDisplayName({
				path: "/x",
				id: "raw-uuid-must-not-show",
				cwd: "/repo",
				title: "Named session",
				created: new Date(T1),
				modified: new Date(T1),
				messageCount: 1,
				firstMessage: "first prompt",
				allMessagesText: "first prompt",
				size: 1,
			}),
		).toBe("Named session");
		expect(
			sessionDisplayName({
				path: "/x",
				id: "raw-uuid-must-not-show",
				cwd: "/repo",
				created: new Date(T1),
				modified: new Date(T1),
				messageCount: 1,
				firstMessage: "first prompt",
				allMessagesText: "first prompt",
				size: 1,
			}),
		).toBe("first prompt");
	});

	test("excerpts are single-line and bounded", () => {
		expect(excerptTaskText("  a\n\nb\tc  ", 100)).toBe("a b c");
		expect(excerptTaskText("x".repeat(20), 10)).toBe(`${"x".repeat(9)}…`);
		expect(excerptTaskText("   ", 10)).toBeUndefined();
	});

	test("a message-less window reads as no summary (unknown), never the header", async () => {
		const storage = new MemorySessionStorage();
		write(storage, "control-only.jsonl", [
			{ type: "run_init", id: "r1", parentId: null, timestamp: T1, client: "web" },
		]);

		const [session] = await listSessions(DIR, storage);
		// No message in the bounded window → no projection; viewers show “no summary”.
		expect(session?.taskSummary).toBeUndefined();
		// `unknown` is a valid persisted/DTO state for older/partial rows.
		expect(normalizeSessionTaskSummary({ status: "unknown", source: "none" })).toEqual({
			status: "unknown",
			source: "none",
		});
	});

	test("firstMessage is a name fallback, never a completed summary", async () => {
		const storage = new MemorySessionStorage();
		write(storage, "open-first.jsonl", [message("u1", "user", "the only prompt")]);

		const [session] = await listSessions(DIR, storage);
		expect(session?.firstMessage).toBe("the only prompt");
		// The name may use it; the task summary may not claim completion.
		expect(sessionDisplayName(session!)).toBe("the only prompt");
		expect(session?.taskSummary?.status).toBe("incomplete");
		expect(session?.taskSummary?.result).toBeUndefined();
	});

	test("a later append invalidates the cached window and updates the summary", async () => {
		const storage = new MemorySessionStorage();
		write(storage, "growing.jsonl", [message("u1", "user", "finish the change")]);
		const before = (await listSessions(DIR, storage))[0];
		expect(before?.taskSummary?.status).toBe("incomplete");

		// Same file grows: the scan cache is keyed by mtime/size, so a re-list
		// must recompute instead of serving the stale projection.
		write(storage, "growing.jsonl", [
			message("u1", "user", "finish the change"),
			message("a1", "assistant", "Change finished."),
		]);
		const after = (await listSessions(DIR, storage))[0];
		expect(after?.taskSummary?.status).toBe("completed");
		expect(after?.taskSummary?.result).toBe("Change finished.");
	});

	test("a malformed persisted projection reads as absent", () => {
		expect(normalizeSessionTaskSummary({ status: "completed" })).toBeUndefined();
		expect(normalizeSessionTaskSummary({ status: "done", source: "completed_turn" })).toBeUndefined();
		expect(normalizeSessionTaskSummary({ status: "completed", source: "completed_turn", intent: "x", result: "y" })).toEqual({
			status: "completed",
			source: "completed_turn",
			intent: "x",
			result: "y",
		});
	});
});
