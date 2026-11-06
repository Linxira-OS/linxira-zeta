/**
 * `GET /api/sessions/:id` window contract: a page returns one window of the
 * active branch instead of the whole transcript; the legacy answer (no
 * `window`/`limit`) keeps the tree and every message.
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
} from "../../src/server/web-gateway/sessions";
import { SessionManager } from "../../src/session/session-manager";

const ENV_KEY = "ZETA_CODING_AGENT_DIR";

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Text of each message in `context.messages` (the first text block). */
function messageTexts(body: Record<string, unknown>): string[] {
	const messages = Array.isArray(record(body.context).messages) ? (record(body.context).messages as unknown[]) : [];
	return messages.map(message => {
		const content = record(message).content;
		if (!Array.isArray(content)) return "";
		const text = content.map(block => record(block).text).find(value => typeof value === "string");
		return typeof text === "string" ? text : "";
	});
}

function sessionFile(id: string, cwd: string, messages: readonly string[]): string {
	const header = { type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd };
	const lines = messages.map((text, index) =>
		JSON.stringify({
			type: "message",
			id: `entry-${index}`,
			parentId: index === 0 ? null : `entry-${index - 1}`,
			timestamp: new Date(Date.UTC(2026, 10, 6, 0, 0, index)).toISOString(),
			message: { role: index % 2 === 0 ? "user" : "assistant", content: [{ type: "text", text }] },
		}),
	);
	return `${JSON.stringify(header)}\n${lines.join("\n")}\n`;
}

describe("gateway session window", () => {
	const cleanups: Array<() => Promise<void>> = [];
	const savedEnv = new Map<string, string | undefined>();

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

	async function setup(count = 5): Promise<{ id: string; file: string }> {
		const agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-window-"));
		cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
		savedEnv.set(ENV_KEY, process.env[ENV_KEY]);
		process.env[ENV_KEY] = agentDir;
		refreshDirsFromEnv();
		invalidateSessionListCache();

		const cwd = await mkdtemp(join(tmpdir(), "zeta-gw-window-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));
		const dir = SessionManager.getDefaultSessionDir(cwd);
		await fs.promises.mkdir(dir, { recursive: true });
		const id = randomUUID();
		const file = join(dir, "window-session.jsonl");
		await writeFile(
			file,
			sessionFile(
				id,
				cwd,
				Array.from({ length: count }, (_, i) => `message-${i}`),
			),
			"utf8",
		);
		cacheSessionPath(id, file);
		return { id, file };
	}

	async function get(id: string, query = ""): Promise<{ status: number; body: Record<string, unknown> }> {
		const response = await handleGetSession(new Request(`http://127.0.0.1/api/sessions/${id}${query}`), id);
		const body: unknown = await response.json();
		return { status: response.status, body: record(body) };
	}

	test("without window/limit the legacy answer keeps the tree and every message", async () => {
		const { id } = await setup(3);
		const { status, body } = await get(id);
		expect(status).toBe(200);
		expect(body.page).toBeUndefined();
		expect(Array.isArray(body.tree)).toBe(true);
		expect(messageTexts(body)).toHaveLength(3);
	});

	test("window=tail returns the newest page and no tree", async () => {
		const { id } = await setup(5);
		const { status, body } = await get(id, "?window=tail&limit=2");
		expect(status).toBe(200);
		expect(body.tree).toBeUndefined();
		expect(messageTexts(body)).toEqual(["message-3", "message-4"]);
		const entryIds = record(body.context).entryIds;
		expect(Array.isArray(entryIds) ? entryIds.filter((id): id is string => typeof id === "string") : []).toEqual([
			"entry-3",
			"entry-4",
		]);
		const page = record(body.page);
		expect(page.total).toBe(5);
		expect(page.windowStart).toBe(3);
		expect(page.windowEnd).toBe(5);
		expect(page.hasMoreBefore).toBe(true);
		expect(record(page.timestamps)["entry-3"]).toBeDefined();
		expect(record(page.timestamps)["entry-0"]).toBeUndefined();
	});

	test("window=<boundary> pages backwards and reports the head", async () => {
		const { id } = await setup(5);
		const firstPage = await get(id, "?window=3&limit=2");
		expect(messageTexts(firstPage.body)).toEqual(["message-1", "message-2"]);
		expect(record(firstPage.body.page).windowStart).toBe(1);
		expect(record(firstPage.body.page).hasMoreBefore).toBe(true);

		const head = await get(id, "?window=1&limit=2");
		expect(messageTexts(head.body)).toEqual(["message-0"]);
		expect(record(head.body.page).hasMoreBefore).toBe(false);
	});

	test("a changed window origin is rejected, an append is not", async () => {
		const { id, file } = await setup(5);
		const first = await get(id, "?window=tail&limit=2");
		const boundaryOrigin = record(first.body.page).origin;
		expect(typeof boundaryOrigin).toBe("string");
		const origin = typeof boundaryOrigin === "string" ? boundaryOrigin : "";
		expect((await get(id, `?window=3&limit=2&origin=${encodeURIComponent(origin)}`)).status).toBe(200);

		// Appending keeps the origin: the older cursor still addresses the same entries.
		const appended = `${fs.readFileSync(file, "utf8")}${JSON.stringify({
			type: "message",
			id: "entry-5",
			parentId: "entry-4",
			timestamp: new Date().toISOString(),
			message: { role: "assistant", content: [{ type: "text", text: "message-5" }] },
		})}\n`;
		await writeFile(file, appended, "utf8");
		expect((await get(id, `?window=3&limit=2&origin=${encodeURIComponent(origin)}`)).status).toBe(200);

		const stale = await get(id, "?window=3&limit=2&origin=entry-0");
		expect(stale.status).toBe(409);
		expect(stale.body.code).toBe("cursor-stale");
	});

	test("invalid window and limit are rejected", async () => {
		const { id } = await setup(2);
		expect((await get(id, "?window=tail&limit=0")).body.code).toBe("invalid-limit");
		expect((await get(id, "?window=tail&limit=101")).body.code).toBe("invalid-limit");
		expect((await get(id, "?window=-1")).body.code).toBe("invalid-window");
		expect((await get(id, "?window=nope")).body.code).toBe("invalid-window");
		expect((await get(id, "?window=99")).body.code).toBe("cursor-stale");
	});
});
