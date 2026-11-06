/**
 * `GET /api/sessions/:id` cache contract: an unchanged file is answered from
 * the serialized body (no re-read, no re-parse, no re-projection), and any
 * write that moves (mtime, size) is served fresh.
 *
 * The renderer mounts one conversation at a time, so switching back to an open
 * conversation used to re-read and re-parse the entire JSONL; this is the
 * regression test for that path.
 */
import { afterEach, describe, expect, test, vi } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import {
	cacheSessionPath,
	handleGetSession,
	invalidateSessionListCache,
	invalidateSessionResponseCache,
	sessionPathKey,
} from "../../src/server/web-gateway/sessions";
import { SessionManager } from "../../src/session/session-manager";

const ENV_KEY = "ZETA_CODING_AGENT_DIR";

function sessionFileContent(id: string, cwd: string, messageText: string): string {
	const header = { type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd };
	const message = {
		type: "message",
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		message: { role: "user", content: [{ type: "text", text: messageText }] },
	};
	return `${JSON.stringify(header)}\n${JSON.stringify(message)}\n`;
}

describe("gateway session response cache", () => {
	const cleanups: Array<() => Promise<void>> = [];
	const savedEnv = new Map<string, string | undefined>();
	let pinnedMtime = new Date(0);

	afterEach(async () => {
		vi.restoreAllMocks();
		invalidateSessionResponseCache();
		invalidateSessionListCache();
		const saved = savedEnv.get(ENV_KEY);
		if (saved === undefined) delete process.env[ENV_KEY];
		else process.env[ENV_KEY] = saved;
		refreshDirsFromEnv();
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	});

	async function setup(): Promise<{ file: string; id: string }> {
		const agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-cache-"));
		cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
		savedEnv.set(ENV_KEY, process.env[ENV_KEY]);
		process.env[ENV_KEY] = agentDir;
		refreshDirsFromEnv();
		invalidateSessionListCache();

		const cwd = await mkdtemp(join(tmpdir(), "zeta-gw-cache-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));
		const dir = SessionManager.getDefaultSessionDir(cwd);
		await fs.promises.mkdir(dir, { recursive: true });
		const id = randomUUID();
		const file = join(dir, "cached-session.jsonl");
		// Both texts are the same byte length: the rewrite below must not change
		// the size, so only the mtime can invalidate the entry.
		await writeFile(file, sessionFileContent(id, cwd, "same-length-alpha"), "utf8");
		// Pin the mtime to whole seconds: `utimesSync` takes a `Date`, so a value
		// captured from `stat` (sub-millisecond) cannot be restored exactly on
		// Windows and the second write would look like a change on its own.
		pinnedMtime = new Date(Math.floor(Date.now() / 1000) * 1000);
		fs.utimesSync(file, pinnedMtime, pinnedMtime);
		cacheSessionPath(id, file);
		return { file, id };
	}

	async function bodyFor(id: string): Promise<string> {
		const response = await handleGetSession(new Request(`http://127.0.0.1/api/sessions/${id}`), id);
		expect(response.status).toBe(200);
		return response.text();
	}

	test("an unchanged file is answered without re-reading it", async () => {
		const { file, id } = await setup();
		const first = await bodyFor(id);
		expect(first).toContain("same-length-alpha");

		// Same size, same pinned mtime: only a cache hit can still return the old text.
		const rewritten = sessionFileContent(id, JSON.parse(first).info.cwd, "same-length-omega");
		await writeFile(file, rewritten, "utf8");
		fs.utimesSync(file, pinnedMtime, pinnedMtime);
		const stat = fs.statSync(file);
		expect(stat.mtimeMs).toBe(pinnedMtime.getTime());
		const after = await bodyFor(id);
		expect(after).toBe(first);
	});

	test("a write that changes (mtime, size) is served fresh", async () => {
		const { file, id } = await setup();
		const first = await bodyFor(id);
		expect(first).toContain("same-length-alpha");

		const cwd = JSON.parse(first).info.cwd as string;
		await writeFile(file, sessionFileContent(id, cwd, "a longer, different message"), "utf8");
		const future = new Date(Date.now() + 5000);
		fs.utimesSync(file, future, future);

		const after = await bodyFor(id);
		expect(after).not.toBe(first);
		expect(after).toContain("a longer, different message");
	});

	test("the cache is keyed per file, not per response", async () => {
		const first = await setup();
		const secondId = randomUUID();
		const secondFile = first.file.replace("cached-session.jsonl", "other-session.jsonl");
		await writeFile(
			secondFile,
			sessionFileContent(secondId, JSON.parse(await bodyFor(first.id)).info.cwd, "second-alpha"),
			"utf8",
		);
		cacheSessionPath(secondId, secondFile);

		expect(await bodyFor(first.id)).toContain("same-length-alpha");
		expect(await bodyFor(secondId)).toContain("second-alpha");
		expect(sessionPathKey(secondFile)).not.toBe(sessionPathKey(first.file));
	});
});
