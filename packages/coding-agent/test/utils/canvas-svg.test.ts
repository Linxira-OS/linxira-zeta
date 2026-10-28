import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canvasToSvg, isCanvasPath } from "../../src/utils/canvas-svg";
import { loadCanvasImageInput } from "../../src/utils/image-loading";

const OBSIDIAN_CANVAS = JSON.stringify({
	nodes: [
		{ id: "a", type: "text", text: "Start here", x: 0, y: 0, width: 200, height: 60 },
		{ id: "b", type: "file", file: "Notes/Architecture.md", x: 300, y: 0, width: 200, height: 60 },
		{ id: "c", type: "group", label: "Ideas", x: -50, y: -50, width: 600, height: 400 },
	],
	edges: [{ id: "e1", fromNode: "a", toNode: "b", label: "depends on" }],
});

const EXCALIDRAW = JSON.stringify({
	type: "excalidraw",
	elements: [
		{
			id: "r1",
			type: "rectangle",
			x: 0,
			y: 0,
			width: 160,
			height: 80,
			strokeColor: "#1e1e1e",
			backgroundColor: "transparent",
			strokeWidth: 2,
		},
		{
			id: "t1",
			type: "text",
			text: "First",
			x: 20,
			y: 20,
			width: 60,
			height: 20,
			fontSize: 20,
			strokeColor: "#1e1e1e",
		},
		{
			id: "t2",
			type: "text",
			text: "Second",
			x: 240,
			y: 20,
			width: 70,
			height: 20,
			fontSize: 20,
			strokeColor: "#1e1e1e",
		},
		{
			id: "a1",
			type: "arrow",
			x: 160,
			y: 40,
			points: [
				[0, 0],
				[80, 0],
			],
			strokeColor: "#1e1e1e",
			startBinding: { elementId: "r1" },
			endBinding: { elementId: "t2" },
		},
	],
	appState: {},
});

describe("canvasToSvg", () => {
	test("renders Obsidian nodes, files, groups, and edges", () => {
		const svg = canvasToSvg(OBSIDIAN_CANVAS, "/vault/board.canvas");
		expect(svg).toContain("<svg");
		expect(svg).toContain("viewBox=");
		expect(svg).toContain("Start here");
		expect(svg).toContain("Notes/Architecture.md");
		expect(svg).toContain("Ideas");
		expect(svg).toContain("depends on");
		expect(svg).toContain("marker-end=");
	});

	test("renders Excalidraw shapes, text, and arrows", () => {
		const svg = canvasToSvg(EXCALIDRAW, "/vault/diagram.excalidraw");
		expect(svg).toContain("<svg");
		expect(svg).toContain("<rect");
		expect(svg).toContain("First");
		expect(svg).toContain("Second");
		expect(svg).toContain("<polyline");
		expect(svg).toContain("marker-end=");
	});

	test("rejects malformed and unknown documents", () => {
		expect(() => canvasToSvg("{", "/vault/bad.canvas")).toThrow(/Invalid canvas JSON/);
		expect(() => canvasToSvg('{"foo":1}', "/vault/x.canvas")).toThrow(/Unsupported canvas JSON/);
	});

	test("recognizes both canvas extensions", () => {
		expect(isCanvasPath("/a/b.canvas")).toBe(true);
		expect(isCanvasPath("C:\\a\\B.EXCALIDRAW")).toBe(true);
		expect(isCanvasPath("/a/b.svg")).toBe(false);
	});

	test("rasterizes a canvas through the image pipeline", async () => {
		const dir = await mkdtemp(join(tmpdir(), "zeta-canvas-"));
		const file = join(dir, "board.canvas");
		await writeFile(file, OBSIDIAN_CANVAS, "utf-8");
		try {
			const loaded = await loadCanvasImageInput({ path: file, cwd: dir, autoResize: false });
			expect(loaded).not.toBeNull();
			expect(loaded?.mimeType).toBe("image/png");
			expect(loaded?.data.startsWith("iVBORw0KGgo")).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
