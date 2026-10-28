import { afterEach, describe, expect, test } from "bun:test";
import { summarizeCanvas } from "../../src/internal-urls/canvas";

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
		{ id: "t2", type: "text", text: "Second", x: 10, y: 200 },
		{ id: "t1", type: "text", text: "First", x: 10, y: 10 },
		{ id: "a1", type: "arrow", startBinding: { elementId: "t1" }, endBinding: { elementId: "t2" } },
	],
	appState: {},
});

describe("summarizeCanvas", () => {
	test("summarizes Obsidian canvas nodes, files, groups, and edges", () => {
		const summary = summarizeCanvas(OBSIDIAN_CANVAS, "/vault/board.canvas");
		expect(summary).toContain("# Canvas board.canvas");
		expect(summary).toContain("3 nodes, 1 edge");
		expect(summary).toContain("- text: Start here");
		expect(summary).toContain("- Notes/Architecture.md");
		expect(summary).toContain("- group: Ideas");
		expect(summary).toContain("- text: Start here → Notes/Architecture.md (depends on)");
	});

	test("summarizes Excalidraw text in vertical order", () => {
		const summary = summarizeCanvas(EXCALIDRAW, "/vault/diagram.excalidraw");
		expect(summary).toContain("# Excalidraw diagram.excalidraw");
		expect(summary).toContain("3 elements");
		const first = summary.indexOf("- First");
		const second = summary.indexOf("- Second");
		expect(first).toBeGreaterThan(-1);
		expect(second).toBeGreaterThan(first);
		expect(summary).toContain("- First → Second");
	});

	test("rejects malformed JSON with the file name", () => {
		expect(() => summarizeCanvas("{not json", "/vault/bad.canvas")).toThrow(
			/Invalid canvas JSON in \/vault\/bad\.canvas/,
		);
	});

	test("rejects unknown JSON shapes", () => {
		expect(() => summarizeCanvas('{"foo":1}', "/vault/x.canvas")).toThrow(/Unsupported canvas JSON/);
	});
});
