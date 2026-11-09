import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Settings } from "@linxiraos/zeta/config/settings";
import {
	type BoardParams,
	BoardTool,
	type BoardToolDetails,
	BUILTIN_TOOLS,
	boardDir,
	loadBoard,
	resolveBuiltinToolPlan,
	type ToolSession,
} from "@linxiraos/zeta/tools";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";

const roots: string[] = [];

async function project(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "zeta-board-tool-"));
	roots.push(root);
	return root;
}

function session(cwd: string, taskDepth = 0): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
		taskDepth,
	};
}

function firstText(result: { content: readonly { type: string; text?: string }[] }): string {
	const block = result.content[0];
	if (!block || block.type !== "text" || block.text === undefined) throw new Error("expected a text block");
	return block.text;
}

async function run(tool: BoardTool, params: BoardParams) {
	return tool.execute("call", params);
}

afterAll(async () => {
	await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
});

describe("board tool", () => {
	test("create returns the slug id and stores the card in the session project", async () => {
		const root = await project();
		const tool = new BoardTool(session(root));
		const result = await run(tool, {
			action: "create",
			title: "Fix the parser",
			description: "The brief handed to an agent.",
			status: "doing",
			owner: "agent",
			tags: ["rust", "parser"],
			due: "2026-11-01",
		});
		const details = result.details as BoardToolDetails;
		expect(details.action).toBe("create");
		expect(details.cwd).toBe(root);
		expect(details.card).toMatchObject({
			id: "fix-the-parser",
			title: "Fix the parser",
			column: "doing",
			assignee: "agent",
			tags: ["rust", "parser"],
			due: "2026-11-01",
			body: "The brief handed to an agent.",
		});
		expect(firstText(result)).toContain("Created card fix-the-parser in doing.");

		const stored = await loadBoard(root);
		expect(stored.cards).toHaveLength(1);
		expect(stored.cards[0]).toMatchObject({ id: "fix-the-parser", column: "doing" });
	});

	test("list filters by column, owner and tag and reports the project", async () => {
		const root = await project();
		const tool = new BoardTool(session(root));
		await run(tool, { action: "create", title: "Alpha", tags: ["backend"] });
		await run(tool, { action: "create", title: "Beta", status: "doing", owner: "agent" });

		const all = await run(tool, { action: "list" });
		expect((all.details as BoardToolDetails).cards?.map(card => card.id)).toEqual(["alpha", "beta"]);

		const doing = await run(tool, { action: "list", status: "doing" });
		expect((doing.details as BoardToolDetails).cards?.map(card => card.id)).toEqual(["beta"]);

		const tagged = await run(tool, { action: "list", tag: "backend" });
		expect((tagged.details as BoardToolDetails).cards?.map(card => card.id)).toEqual(["alpha"]);

		const owned = await run(tool, { action: "list", owner: "agent" });
		expect((owned.details as BoardToolDetails).cards?.map(card => card.id)).toEqual(["beta"]);
	});

	test("update changes title, description and tags without changing the id", async () => {
		const root = await project();
		const tool = new BoardTool(session(root));
		const created = await run(tool, { action: "create", title: "Draft" });
		const id = (created.details as BoardToolDetails).card!.id;

		const updated = await run(tool, {
			action: "update",
			id,
			title: "Final title",
			body: "New description.",
			tags: ["docs"],
			due: "2026-12-24",
		});
		expect((updated.details as BoardToolDetails).card).toMatchObject({
			id,
			title: "Final title",
			body: "New description.",
			tags: ["docs"],
			due: "2026-12-24",
			column: "todo",
		});
		expect(firstText(updated)).toContain(`Updated card ${id}.`);
	});

	test("move changes the column and rejects an unknown column", async () => {
		const root = await project();
		const tool = new BoardTool(session(root));
		const created = await run(tool, { action: "create", title: "Ship it" });
		const id = (created.details as BoardToolDetails).card!.id;

		const moved = await run(tool, { action: "move", id, status: "done" });
		expect((moved.details as BoardToolDetails).card?.column).toBe("done");

		await expect(run(tool, { action: "move", id, column: "later" as never })).rejects.toThrow(ToolError);
	});

	test("assign sets the owner and update refuses to change the column", async () => {
		const root = await project();
		const tool = new BoardTool(session(root));
		const created = await run(tool, { action: "create", title: "Handoff" });
		const id = (created.details as BoardToolDetails).card!.id;

		const assigned = await run(tool, { action: "assign", id, owner: "agent" });
		expect((assigned.details as BoardToolDetails).card?.assignee).toBe("agent");

		await expect(run(tool, { action: "update", id, column: "doing" })).rejects.toThrow(/use action "move"/);
	});

	test("get returns the brief, and delete removes the card", async () => {
		const root = await project();
		const tool = new BoardTool(session(root));
		const created = await run(tool, { action: "create", title: "Read me", body: "Body text." });
		const id = (created.details as BoardToolDetails).card!.id;

		const got = await run(tool, { action: "get", id });
		expect(firstText(got)).toContain("# Read me");
		expect(firstText(got)).toContain("Body text.");

		const deleted = await run(tool, { action: "delete", id });
		expect(firstText(deleted)).toBe(`Deleted card ${id}.`);
		await expect(run(tool, { action: "get", id })).rejects.toThrow("card not found");
		expect((await loadBoard(root)).cards).toEqual([]);
	});

	test("invalid ids and values surface as tool errors", async () => {
		const root = await project();
		const tool = new BoardTool(session(root));
		await expect(run(tool, { action: "get", id: "../escape" })).rejects.toThrow("invalid card id");
		await expect(run(tool, { action: "get", id: "" })).rejects.toThrow("requires a card id");
		await expect(run(tool, { action: "create", title: "Bad date", due: "2026-02-30" })).rejects.toThrow(
			"not a real date",
		);
		await expect(run(tool, { action: "create", title: "No column", column: "later" as never })).rejects.toThrow(
			ToolError,
		);
	});

	test("list warns about files that are not cards", async () => {
		const root = await project();
		const tool = new BoardTool(session(root));
		await mkdir(boardDir(root), { recursive: true });
		await writeFile(join(boardDir(root), "broken.md"), "not a card\n", "utf8");
		const listed = await run(tool, { action: "list" });
		const warnings = (listed.details as BoardToolDetails).warnings ?? [];
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.file).toBe("broken.md");
	});

	test("cards never cross project roots", async () => {
		const rootA = await project();
		const rootB = await project();
		const toolA = new BoardTool(session(rootA));
		const toolB = new BoardTool(session(rootB));

		const created = await run(toolA, { action: "create", title: "Only here" });
		const id = (created.details as BoardToolDetails).card!.id;

		expect((await run(toolB, { action: "list" })).details?.cards).toEqual([]);
		await expect(run(toolB, { action: "get", id })).rejects.toThrow("card not found");
		expect((await run(toolA, { action: "get", id })).details?.card?.id).toBe(id);
	});
});

describe("board tool visibility", () => {
	test("BUILTIN_TOOLS registers a working board tool", async () => {
		const root = await project();
		const tool = await BUILTIN_TOOLS.board(session(root));
		if (!tool) throw new Error("board tool did not register");
		expect(tool.name).toBe("board");
		const result = await tool.execute("call", { action: "create", title: "Registered" });
		expect((result.details as BoardToolDetails).card?.id).toBe("registered");
	});

	test("top-level sessions get board by default", async () => {
		const plan = await resolveBuiltinToolPlan(session(await project()), []);
		expect(plan.isAllowed("board")).toBe(true);
	});

	test("subagents do not discover board implicitly", async () => {
		const plan = await resolveBuiltinToolPlan(session(await project(), 1), []);
		expect(plan.isAllowed("board")).toBe(false);
	});

	test("a subagent gets board only when its requested tools name it", async () => {
		const child = session(await project(), 1);
		const plan = await resolveBuiltinToolPlan(child, ["read", "board"]);
		expect(plan.names).toContain("board");
	});

	test("channel tools stay unavailable to subagents even when requested", async () => {
		const child: ToolSession = {
			...session(await project(), 1),
			channelSend: async () => {},
		};
		const plan = await resolveBuiltinToolPlan(child, ["read", "channel_send"]);
		expect(plan.names).not.toContain("channel_send");
	});
});
