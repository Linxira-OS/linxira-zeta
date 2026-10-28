import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolSession } from "../../src/tools";
import { CanvasTool } from "../../src/tools/canvas";

let root: string | undefined;

afterEach(async () => {
	if (root) await rm(root, { recursive: true, force: true });
	root = undefined;
});

async function makeTool(): Promise<{ tool: CanvasTool; root: string }> {
	root = await mkdtemp(join(tmpdir(), "zeta-canvas-tool-"));
	// Only `cwd` is read by the tool; the cast is the test seam.
	const session = { cwd: root } as unknown as ToolSession;
	return { tool: new CanvasTool(session), root };
}

describe("CanvasTool", () => {
	test("creates a template under .canvas and lists it", async () => {
		const { tool, root: dir } = await makeTool();
		const created = await tool.execute("1", { op: "create", title: "Architecture Map" });
		expect(created.details.path).toBe(".canvas/architecture-map.excalidraw");
		const body = await readFile(join(dir, ".canvas", "architecture-map.excalidraw"), "utf8");
		expect(JSON.parse(body)).toMatchObject({ type: "excalidraw", elements: [] });

		const listed = await tool.execute("2", { op: "list" });
		expect(listed.details.files).toEqual(["architecture-map.excalidraw"]);
	});

	test("creates an Obsidian canvas template", async () => {
		const { tool, root: dir } = await makeTool();
		const created = await tool.execute("1", { op: "create", title: "Notes", kind: "obsidian" });
		expect(created.details.path).toBe(".canvas/notes.canvas");
		const body = await readFile(join(dir, ".canvas", "notes.canvas"), "utf8");
		expect(JSON.parse(body)).toEqual({ nodes: [], edges: [] });
	});

	test("refuses to overwrite unless asked", async () => {
		const { tool } = await makeTool();
		await tool.execute("1", { op: "create", title: "Board" });
		await expect(tool.execute("2", { op: "create", title: "Board" })).rejects.toThrow(/already exists/);
		await expect(tool.execute("3", { op: "create", title: "Board", overwrite: true })).resolves.toBeDefined();
	});

	test("outlines a local canvas", async () => {
		const { tool } = await makeTool();
		await tool.execute("1", { op: "create", title: "Board" });
		const outlined = await tool.execute("2", { op: "outline", path: "board.excalidraw" });
		const text = outlined.content[0]?.type === "text" ? outlined.content[0].text : "";
		expect(text).toContain("# Excalidraw board.excalidraw");
		expect(text).toContain("0 elements");
	});

	test("keeps paths inside .canvas", async () => {
		const { tool } = await makeTool();
		await expect(tool.execute("1", { op: "outline", path: "../escape.excalidraw" })).rejects.toThrow(/\.canvas\//);
	});
});
