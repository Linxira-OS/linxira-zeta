/**
 * Cross-client session/run provenance, consumer side.
 *
 * The header's `client` is the creator; a later run appends `run_init.client`
 * without rewriting it. These tests exercise only what a durable consumer
 * reads back (creator vs latest run, legacy = unknown, newest run wins), not
 * the writers' wiring or any source assertion.
 */

import { describe, expect, test } from "bun:test";
import { listSessions } from "@linxiraos/zeta/session/session-listing";
import { normalizeSessionClient } from "@linxiraos/zeta/session/session-client";
import { MemorySessionStorage } from "@linxiraos/zeta/session/session-storage";

const DIR = "/sessions/provenance";

function header(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		type: "session",
		version: 3,
		id: "session-id",
		cwd: "/repo",
		timestamp: "2026-06-27T00:00:00.000Z",
		...overrides,
	};
}

function runInit(client: string | undefined, id: string): Record<string, unknown> {
	return {
		type: "run_init",
		id,
		parentId: null,
		timestamp: "2026-06-27T00:00:01.000Z",
		...(client === undefined ? {} : { client }),
	};
}

function writeSession(
	storage: MemorySessionStorage,
	file: string,
	sessionHeader: Record<string, unknown>,
	entries: readonly Record<string, unknown>[],
): void {
	storage.writeTextSync(
		`${DIR}/${file}`,
		[...[JSON.stringify(sessionHeader), ...entries.map(entry => JSON.stringify(entry))], ""].join("\n"),
	);
}

describe("durable session provenance", () => {
	test("reads the creator from the header and the newest run initiator", async () => {
		const storage = new MemorySessionStorage();
		writeSession(storage, "created-by-cli.jsonl", header({ client: "cli" }), [
			runInit("web", "run-1"),
			runInit("desktop", "run-2"),
		]);

		const [session] = await listSessions(DIR, storage);
		expect(session?.client).toBe("cli");
		// The newest durable run wins; the creator stamp is untouched.
		expect(session?.runClient).toBe("desktop");
	});

	test("a run by another client never rewrites the creator stamp", async () => {
		const storage = new MemorySessionStorage();
		writeSession(storage, "resumed-in-web.jsonl", header({ client: "cli" }), [runInit("web", "run-1")]);

		const [session] = await listSessions(DIR, storage);
		expect(session?.client).toBe("cli");
		expect(session?.runClient).toBe("web");
	});

	test("legacy transcripts report unknown rather than guessing a client", async () => {
		const storage = new MemorySessionStorage();
		writeSession(storage, "legacy.jsonl", header(), [
			{ type: "message", id: "m1", parentId: null, timestamp: "2026-06-27T00:00:02.000Z", message: { role: "user", content: "hi" } },
		]);

		const [session] = await listSessions(DIR, storage);
		expect(session?.client).toBeUndefined();
		expect(session?.runClient).toBeUndefined();
	});

	test("an invalid run client is ignored in favour of the last valid one", async () => {
		const storage = new MemorySessionStorage();
		writeSession(storage, "mixed.jsonl", header({ client: "web" }), [
			runInit("automation", "run-1"),
			runInit("admin", "run-2"),
		]);

		const [session] = await listSessions(DIR, storage);
		expect(session?.runClient).toBe("automation");
	});
});

describe("client kind validation", () => {
	test("accepts only the closed client set", () => {
		for (const client of ["cli", "web", "desktop", "automation"] as const) {
			expect(normalizeSessionClient(client)).toBe(client);
		}
		expect(normalizeSessionClient("Web")).toBe("web");
		expect(normalizeSessionClient(" web ")).toBe("web");
	});

	test("does not invent a client from an unknown or missing value", () => {
		for (const value of [undefined, null, "", "unknown", "admin", "cli-admin", 1, {}]) {
			expect(normalizeSessionClient(value)).toBeUndefined();
		}
	});
});
