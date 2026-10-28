/**
 * Canvas summaries for Obsidian `.canvas` and Excalidraw `.excalidraw` files.
 *
 * Both formats are JSON scene graphs. The agent rarely needs the full element
 * array (coordinates, styles, embedded files); an outline of the readable
 * content and the connections is enough to answer "what is on this canvas".
 * This module is deliberately free of React and of any filesystem access so the
 * vault protocol can reuse it for any canvas file.
 */

import { isRecord } from "@linxiraos/pi-utils";

const MAX_NODES = 500;
const MAX_TEXT = 120;

interface ObsidianNode {
	id?: string;
	type?: string;
	text?: string;
	file?: string;
	label?: string;
	x?: number;
	y?: number;
}

interface ObsidianEdge {
	fromNode?: string;
	toNode?: string;
	label?: string;
}

interface ExcalidrawElement {
	id?: string;
	type?: string;
	text?: string;
	x?: number;
	y?: number;
	containerId?: string | null;
	startBinding?: { elementId?: string } | null;
	endBinding?: { elementId?: string } | null;
}

function clean(value: string | undefined, limit = MAX_TEXT): string {
	if (!value) return "";
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function basename(filePath: string): string {
	const normalized = filePath.replaceAll("\\", "/");
	return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}

function parseJson(raw: string, filePath: string): unknown {
	try {
		return JSON.parse(raw.replace(/^\uFEFF/, ""));
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(`Invalid canvas JSON in ${filePath}: ${detail}`);
	}
}

function isObsidianCanvas(value: unknown): value is { nodes: ObsidianNode[]; edges?: ObsidianEdge[] } {
	return isRecord(value) && Array.isArray(value.nodes);
}

function isExcalidrawScene(value: unknown): value is { elements: ExcalidrawElement[] } {
	return isRecord(value) && Array.isArray(value.elements);
}

function nodeLabel(node: ObsidianNode): string {
	if (node.type === "file" && node.file) return node.file;
	if (node.type === "group") return `group: ${clean(node.label, MAX_TEXT) || "(unnamed)"}`;
	const text = clean(node.text);
	return text ? `text: ${text}` : `${node.type ?? "node"}${node.id ? ` ${node.id}` : ""}`;
}

function summarizeObsidian(data: { nodes: ObsidianNode[]; edges?: ObsidianEdge[] }, filePath: string): string {
	const nodes = data.nodes.slice(0, MAX_NODES);
	const labels = new Map<string, string>();
	for (const node of nodes) {
		if (node.id) labels.set(node.id, nodeLabel(node));
	}
	const edges = (data.edges ?? []).slice(0, MAX_NODES);
	const lines = [
		`# Canvas ${basename(filePath)}`,
		"",
		`${data.nodes.length} node${data.nodes.length === 1 ? "" : "s"}, ${(data.edges ?? []).length} edge${(data.edges ?? []).length === 1 ? "" : "s"}.`,
		"",
		"## Nodes",
		"",
	];
	if (nodes.length === 0) lines.push("(empty)");
	for (const node of nodes) lines.push(`- ${nodeLabel(node)}`);
	if (data.nodes.length > nodes.length) lines.push(`- … ${data.nodes.length - nodes.length} more`);
	if (edges.length > 0) {
		lines.push("", "## Edges", "");
		for (const edge of edges) {
			const from = labels.get(edge.fromNode ?? "") ?? edge.fromNode ?? "?";
			const to = labels.get(edge.toNode ?? "") ?? edge.toNode ?? "?";
			lines.push(`- ${from} → ${to}${edge.label ? ` (${clean(edge.label)})` : ""}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

function summarizeExcalidraw(data: { elements: ExcalidrawElement[] }, filePath: string): string {
	const elements = data.elements.slice(0, MAX_NODES);
	const textById = new Map<string, string>();
	for (const element of elements) {
		if (element.type === "text" && element.id) textById.set(element.id, clean(element.text));
	}
	const textElements = elements
		.filter(element => element.type === "text")
		.sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
	const lines = [
		`# Excalidraw ${basename(filePath)}`,
		"",
		`${data.elements.length} element${data.elements.length === 1 ? "" : "s"}.`,
		"",
		"## Text",
		"",
	];
	const textLines = textElements.map(element => `- ${clean(element.text) || "(empty text)"}`);
	if (textLines.length === 0) lines.push("(no text elements)");
	else lines.push(...textLines);
	const arrows = elements.filter(element => element.type === "arrow");
	if (arrows.length > 0) {
		lines.push("", "## Arrows", "");
		for (const arrow of arrows) {
			const from = arrow.startBinding?.elementId ? textById.get(arrow.startBinding.elementId) || "?" : "?";
			const to = arrow.endBinding?.elementId ? textById.get(arrow.endBinding.elementId) || "?" : "?";
			lines.push(`- ${from} → ${to}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

/** Render a human/agent-readable outline of a canvas scene. */
export function summarizeCanvas(raw: string, filePath: string): string {
	const data = parseJson(raw, filePath);
	if (isObsidianCanvas(data)) return summarizeObsidian(data, filePath);
	if (isExcalidrawScene(data)) return summarizeExcalidraw(data, filePath);
	throw new Error(
		`Unsupported canvas JSON in ${filePath}: expected an Obsidian .canvas ({nodes,edges}) or Excalidraw (.excalidraw) scene`,
	);
}
