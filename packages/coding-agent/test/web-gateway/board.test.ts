/**
 * The user board API — `.zeta/board/` cards through the gateway.
 *
 * The contract under test is the one the panel and an editor share: the file
 * is the truth (a hand edit must show up in the next read), ids are file stems
 * that can never name a path outside the directory, and `handoff` returns a
 * brief without starting a session.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import {
	handleBoardCreate,
	handleBoardDelete,
	handleBoardGet,
	handleBoardHandoff,
	handleBoardList,
	handleBoardMove,
	handleBoardUpdate,
	isValidId,
	parseCard,
} from "../../src/server/web-gateway/board";
import { webGatewayFetch } from "../../src/server/web-gateway";

const cleanups: Array<() => Promise<void>> = [];
const savedEnv = process.env.ZETA_CODING_AGENT_DIR;
let agentDir = "";

async function project(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "zeta-board-project-"));
	cleanups.push(() => rm(root, { recursive: true, force: true }));
	return root;
}

function request(path: string, method = "GET", body?: unknown): Request {
	const init: RequestInit = { method };
	if (body !== undefined) {
		init.headers = { "content-type": "application/json" };
		init.body = JSON.stringify(body);
	}
	return new Request(`http://127.0.0.1${path}`, init);
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

beforeEach(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "zeta-board-agent-"));
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	refreshDirsFromEnv();
});

afterEach(async () => {
	if (savedEnv === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = savedEnv;
	refreshDirsFromEnv();
	await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

afterAll(() => {
	rm(agentDir, { recursive: true, force: true }).catch(() => {});
});

describe("board CRUD", () => {
	test("create, list, update, move and delete through the handlers", async () => {
		const root = await project();
		const created = await handleBoardCreate(
			request("/api/board", "POST", {
				cwd: root,
				title: "Fix the parser",
				tags: ["rust", "parser"],
				due: "2026-11-01",
				body: "The brief.",
			}),
		);
		expect(created.status).toBe(201);
		const { card } = (await jsonBody(created)) as {
			card: { id: string; column: string; assignee: string; tags: string[]; due: string; body: string };
		};
		expect(card.id).toBe("fix-the-parser");
		expect(card.column).toBe("todo");
		expect(card.assignee).toBe("user");
		expect(card.tags).toEqual(["rust", "parser"]);
		expect(card.due).toBe("2026-11-01");
		expect(card.body).toBe("The brief.");

		const file = join(root, ".zeta", "board", "fix-the-parser.md");
		const text = await readFile(file, "utf8");
		expect(text).toContain("---\ntitle: Fix the parser\ncolumn: todo\n");
		expect(text).toContain("tags: [rust, parser]");
		expect(text).toContain("\nThe brief.\n");

		const listed = await handleBoardList(request(`/api/board?cwd=${encodeURIComponent(root)}`));
		expect(listed.status).toBe(200);
		const list = (await jsonBody(listed)) as { cards: Array<{ id: string }>; warnings: unknown[] };
		expect(list.cards.map(entry => entry.id)).toEqual(["fix-the-parser"]);
		expect(list.warnings).toEqual([]);

		const updated = await handleBoardUpdate(
			request("/api/board/fix-the-parser", "PATCH", {
				cwd: root,
				title: "Fix the parser properly",
				assignee: "agent",
				body: "A longer brief.",
			}),
			"fix-the-parser",
		);
		expect(updated.status).toBe(200);
		const { card: patched } = (await jsonBody(updated)) as {
			card: { title: string; assignee: string; body: string };
		};
		expect(patched.title).toBe("Fix the parser properly");
		expect(patched.assignee).toBe("agent");
		expect(await readFile(file, "utf8")).toContain("title: Fix the parser properly");

		const moved = await handleBoardMove(
			request("/api/board/fix-the-parser/move", "POST", { cwd: root, column: "doing" }),
			"fix-the-parser",
		);
		expect(moved.status).toBe(200);
		expect(await readFile(file, "utf8")).toContain("column: doing");

		const got = await handleBoardGet(
			request(`/api/board/fix-the-parser?cwd=${encodeURIComponent(root)}`),
			"fix-the-parser",
		);
		const { card: single } = (await jsonBody(got)) as { card: { column: string } };
		expect(single.column).toBe("doing");

		const deleted = await handleBoardDelete(
			request(`/api/board/fix-the-parser?cwd=${encodeURIComponent(root)}`, "DELETE"),
			"fix-the-parser",
		);
		expect(deleted.status).toBe(200);
		await expect(readFile(file, "utf8")).rejects.toThrow();
		const again = await handleBoardDelete(
			request(`/api/board/fix-the-parser?cwd=${encodeURIComponent(root)}`, "DELETE"),
			"fix-the-parser",
		);
		expect(again.status).toBe(404);
	});

	test("a hand edit on disk is what the next list returns", async () => {
		const root = await project();
		await handleBoardCreate(request("/api/board", "POST", { cwd: root, title: "First draft" }));
		const file = join(root, ".zeta", "board", "first-draft.md");
		await writeFile(
			file,
			"---\ntitle: Hand edited\ncolumn: done\ntags: [manual]\nassignee: user\ndue: 2026-12-24\n---\n\nEdited in an editor.\n",
			"utf8",
		);
		const listed = (await (await handleBoardList(request(`/api/board?cwd=${encodeURIComponent(root)}`))).json()) as {
			cards: Array<Record<string, unknown>>;
		};
		expect(listed.cards).toHaveLength(1);
		expect(listed.cards[0]).toMatchObject({
			id: "first-draft",
			title: "Hand edited",
			column: "done",
			tags: ["manual"],
			due: "2026-12-24",
			body: "Edited in an editor.",
		});
	});

	test("two cards with the same title get distinct ids", async () => {
		const root = await project();
		const first = (await (
			await handleBoardCreate(request("/api/board", "POST", { cwd: root, title: "Same" }))
		).json()) as { card: { id: string } };
		const second = (await (
			await handleBoardCreate(request("/api/board", "POST", { cwd: root, title: "Same" }))
		).json()) as { card: { id: string } };
		expect(first.card.id).toBe("same");
		expect(second.card.id).toBe("same-2");
	});
});

describe("handoff", () => {
	test("returns the body as a brief and starts nothing", async () => {
		const root = await project();
		await handleBoardCreate(
			request("/api/board", "POST", {
				cwd: root,
				title: "Fix it",
				tags: ["rust"],
				body: "Do the thing.",
			}),
		);
		const response = await handleBoardHandoff(request("/api/board/fix-it/handoff", "POST", { cwd: root }), "fix-it");
		expect(response.status).toBe(200);
		const payload = (await response.json()) as { card: { assignee: string }; brief: string };
		expect(payload.brief).toContain("# Fix it");
		expect(payload.brief).toContain("- tags: rust");
		expect(payload.brief).toContain("Do the thing.");
		expect(payload.card.assignee).toBe("user");
		expect(Object.keys(payload).sort()).toEqual(["brief", "card", "cwd"]);
	});

	test("assign: true records the agent as the owner", async () => {
		const root = await project();
		await handleBoardCreate(request("/api/board", "POST", { cwd: root, title: "Owned" }));
		const response = await handleBoardHandoff(
			request("/api/board/owned/handoff", "POST", { cwd: root, assign: true }),
			"owned",
		);
		const payload = (await response.json()) as { card: { assignee: string } };
		expect(payload.card.assignee).toBe("agent");
		expect(await readFile(join(root, ".zeta", "board", "owned.md"), "utf8")).toContain("assignee: agent");
	});
});

describe("malformed and foreign files", () => {
	test("a foreign file is reported, not listed, and does not hide the board", async () => {
		const root = await project();
		const directory = join(root, ".zeta", "board");
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, "README.md"), "# Notes\n\nNot a card.\n", "utf8");
		await writeFile(join(directory, "broken.md"), "---\ntitle: Broken\n", "utf8");
		await writeFile(join(directory, "notes.txt"), "ignored\n", "utf8");
		await handleBoardCreate(request("/api/board", "POST", { cwd: root, title: "Real card" }));

		const listed = (await (await handleBoardList(request(`/api/board?cwd=${encodeURIComponent(root)}`))).json()) as {
			cards: Array<{ id: string }>;
			warnings: Array<{ file: string; reason: string }>;
		};
		expect(listed.cards.map(card => card.id)).toEqual(["real-card"]);
		expect(listed.warnings.map(warning => warning.file)).toEqual(["README.md", "broken.md"]);
		expect(listed.warnings.find(warning => warning.file === "README.md")?.reason).toBe("missing front matter");
		expect(listed.warnings.find(warning => warning.file === "broken.md")?.reason).toContain("closed");
	});

	test("reading or updating a malformed card is a 422, not a crash", async () => {
		const root = await project();
		const directory = join(root, ".zeta", "board");
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, "broken.md"), "---\ntitle: Broken\n", "utf8");
		const got = await handleBoardGet(request(`/api/board/broken?cwd=${encodeURIComponent(root)}`), "broken");
		expect(got.status).toBe(422);
		expect(await jsonBody(got)).toMatchObject({ error: "not a card" });
		const patched = await handleBoardUpdate(
			request("/api/board/broken", "PATCH", { cwd: root, title: "Fixed" }),
			"broken",
		);
		expect(patched.status).toBe(422);
	});

	test("parseCard rejects a missing title and an unknown column", () => {
		expect(() => parseCard("a", "---\ncolumn: todo\n---\n")).toThrow("no title");
		expect(() => parseCard("a", "---\ntitle: A\ncolumn: someday\n---\n")).toThrow("unknown column");
	});
});

describe("path traversal", () => {
	test("ids that could leave the board are refused before the filesystem", async () => {
		for (const id of ["", ".", "..", "../escape", "a/b", "a\\b", ".hidden"]) {
			expect(isValidId(id)).toBe(false);
		}
		const response = await handleBoardGet(request("/api/board/%2E%2E%2Fescape"), "%2E%2E%2Fescape");
		expect(response.status).toBe(400);
		expect(await jsonBody(response)).toEqual({ error: "invalid card id" });
		const deleted = await handleBoardDelete(request("/api/board/%2E%2E%2Fescape", "DELETE"), "%2E%2E%2Fescape");
		expect(deleted.status).toBe(400);
	});

	test("a traversal-shaped URL is not routed at all", async () => {
		const response = await webGatewayFetch(new Request("http://127.0.0.1/api/board/..%2F..%2Fsecret"), "127.0.0.1");
		expect(response.status).toBe(404);
		expect(await jsonBody(response)).toEqual({ error: "Not implemented" });
	});
});

describe("input validation", () => {
	test("column, assignee, due and tags are checked", async () => {
		const root = await project();
		const cases: Array<Record<string, unknown>> = [
			{ title: "A", column: "someday" },
			{ title: "A", assignee: "robot" },
			{ title: "A", due: "tomorrow" },
			{ title: "A", due: "2026-02-31" },
			{ title: "A", tags: "rust" },
			{ title: "A", tags: ["a,b"] },
			{ title: "   " },
		];
		for (const body of cases) {
			const response = await handleBoardCreate(request("/api/board", "POST", { cwd: root, ...body }));
			expect(response.status, JSON.stringify(body)).toBe(400);
		}
	});
});

describe("route registration", () => {
	test("webGatewayFetch dispatches the board family", async () => {
		const root = await project();
		const created = await webGatewayFetch(
			new Request("http://127.0.0.1/api/board", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ cwd: root, title: "Through the gateway" }),
			}),
			"127.0.0.1",
		);
		expect(created.status).toBe(201);
		const listed = await webGatewayFetch(
			new Request(`http://127.0.0.1/api/board?cwd=${encodeURIComponent(root)}`),
			"127.0.0.1",
		);
		expect(listed.status).toBe(200);
		const payload = (await listed.json()) as { cards: Array<{ title: string }> };
		expect(payload.cards.map(card => card.title)).toEqual(["Through the gateway"]);

		const wrongMethod = await webGatewayFetch(
			new Request(`http://127.0.0.1/api/board?cwd=${encodeURIComponent(root)}`, { method: "PUT" }),
			"127.0.0.1",
		);
		expect(wrongMethod.status).toBe(405);
	});
});
