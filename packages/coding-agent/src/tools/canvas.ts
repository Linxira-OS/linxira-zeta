import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
	ToolApprovalDecision,
} from "@linxiraos/pi-agent-core";
import { type } from "@linxiraos/pi-omptype";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { summarizeCanvas } from "../internal-urls/canvas";
import canvasDescription from "../prompts/tools/canvas.md" with { type: "text" };
import type { ToolSession } from ".";
import { throwIfAborted } from "./tool-errors";

const CANVAS_DIR = ".canvas";
const MAX_LISTED = 200;

const canvasNodeSchema = type({
	"id?": type("string").describe("Stable node id; generated when omitted"),
	text: type("string").describe("Text shown in the node"),
	x: type("number").describe("Left position in scene coordinates"),
	y: type("number").describe("Top position in scene coordinates"),
	"width?": type("number").describe("Box width; derived from text when omitted"),
	"height?": type("number").describe("Box height; derived from text when omitted"),
});

const canvasEdgeSchema = type({
	from: type("string").describe("Source node id"),
	to: type("string").describe("Target node id"),
	"label?": type("string").describe("Optional edge label"),
});

const canvasSchema = type({
	op: type("'list' | 'create' | 'write' | 'outline'").describe("Operation to perform"),
	"title?": type("string").describe("Canvas title for create (used as the file name)"),
	"kind?": type("'excalidraw' | 'obsidian'").describe("Canvas format for create; default excalidraw"),
	"path?": type("string").describe("Canvas path for write/outline, relative to .canvas/"),
	"overwrite?": type("boolean").describe("Replace an existing canvas on create"),
	"nodes?": canvasNodeSchema.array().describe("Scene nodes for create/write"),
	"edges?": canvasEdgeSchema.array().describe("Scene edges for create/write"),
});

export type CanvasParams = typeof canvasSchema.infer;

type CanvasNodeParams = typeof canvasNodeSchema.infer;
type CanvasEdgeParams = typeof canvasEdgeSchema.infer;

export interface CanvasToolDetails {
	path?: string;
	files?: string[];
	nodes?: number;
	edges?: number;
}

interface SceneNode {
	id: string;
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

interface SceneEdge {
	id: string;
	from: string;
	to: string;
	label?: string;
}

type CanvasFormat = "excalidraw" | "obsidian";

function slugify(title: string): string {
	const slug = title
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "canvas";
}

function resolveCanvasPath(cwd: string, relative: string): string {
	const normalized = relative.replaceAll("\\", "/");
	const requested = normalized.startsWith(`${CANVAS_DIR}/`) ? normalized : `${CANVAS_DIR}/${normalized}`;
	const root = path.resolve(cwd, CANVAS_DIR);
	const absolute = path.resolve(cwd, requested);
	if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
		throw new ToolError("Canvas path must stay under .canvas/.");
	}
	if (!/\.(?:canvas|excalidraw)$/i.test(absolute)) {
		throw new ToolError("Canvas path must end with .canvas or .excalidraw.");
	}
	return absolute;
}

function formatForPath(file: string): CanvasFormat {
	return /\.canvas$/i.test(file) ? "obsidian" : "excalidraw";
}

function textSize(text: string): { width: number; height: number } {
	const lines = text.split("\n");
	const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
	return { width: Math.max(120, longest * 8), height: Math.max(48, lines.length * 24 + 24) };
}

function normalizeScene(
	nodes: readonly CanvasNodeParams[] | undefined,
	edges: readonly CanvasEdgeParams[] | undefined,
): { nodes: SceneNode[]; edges: SceneEdge[] } {
	const normalized: SceneNode[] = [];
	const ids = new Set<string>();
	for (const [index, node] of (nodes ?? []).entries()) {
		const id = node.id?.trim() || `n${index + 1}`;
		if (ids.has(id)) throw new ToolError(`Duplicate canvas node id: ${id}`);
		ids.add(id);
		const size = textSize(node.text);
		normalized.push({
			id,
			text: node.text,
			x: node.x,
			y: node.y,
			width: node.width ?? size.width,
			height: node.height ?? size.height,
		});
	}
	const normalizedEdges = (edges ?? []).map((edge, index) => {
		if (!ids.has(edge.from)) throw new ToolError(`Canvas edge ${index + 1} references unknown node id: ${edge.from}`);
		if (!ids.has(edge.to)) throw new ToolError(`Canvas edge ${index + 1} references unknown node id: ${edge.to}`);
		return { id: `e${index + 1}`, from: edge.from, to: edge.to, label: edge.label };
	});
	return { nodes: normalized, edges: normalizedEdges };
}

function hashSeed(value: string): number {
	let hash = 2166136261;
	for (const char of value) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return Math.abs(hash) || 1;
}

function textElement(id: string, text: string, x: number, y: number, width: number, height: number) {
	return {
		id,
		type: "text",
		x,
		y,
		width,
		height,
		angle: 0,
		strokeColor: "#1e1e1e",
		backgroundColor: "transparent",
		fillStyle: "solid",
		strokeWidth: 2,
		strokeStyle: "solid",
		roughness: 1,
		opacity: 100,
		groupIds: [],
		frameId: null,
		roundness: null,
		seed: hashSeed(id),
		version: 1,
		versionNonce: hashSeed(`nonce:${id}`),
		isDeleted: false,
		boundElements: [],
		updated: 1,
		link: null,
		locked: false,
		text,
		fontSize: 20,
		fontFamily: 1,
		textAlign: "left",
		verticalAlign: "top",
		containerId: null,
		originalText: text,
		lineHeight: 1.25,
		baseline: 18,
	};
}

function obsidianScene(nodes: readonly SceneNode[], edges: readonly SceneEdge[]) {
	return {
		nodes: nodes.map(node => ({
			id: node.id,
			type: "text",
			text: node.text,
			x: node.x,
			y: node.y,
			width: node.width,
			height: node.height,
		})),
		edges: edges.map(edge => ({
			id: edge.id,
			fromNode: edge.from,
			fromSide: "right",
			toNode: edge.to,
			toSide: "left",
			...(edge.label ? { label: edge.label } : {}),
		})),
	};
}

function excalidrawScene(nodes: readonly SceneNode[], edges: readonly SceneEdge[]) {
	const byId = new Map(nodes.map(node => [node.id, node]));
	const elements: unknown[] = nodes.map(node =>
		textElement(node.id, node.text, node.x, node.y, node.width, node.height),
	);
	for (const edge of edges) {
		const from = byId.get(edge.from);
		const to = byId.get(edge.to);
		if (!from || !to) continue;
		const startX = from.x + from.width / 2;
		const startY = from.y + from.height / 2;
		const endX = to.x + to.width / 2;
		const endY = to.y + to.height / 2;
		const dx = endX - startX;
		const dy = endY - startY;
		elements.push({
			id: edge.id,
			type: "arrow",
			x: startX,
			y: startY,
			width: Math.abs(dx),
			height: Math.abs(dy),
			angle: 0,
			strokeColor: "#1e1e1e",
			backgroundColor: "transparent",
			fillStyle: "solid",
			strokeWidth: 2,
			strokeStyle: "solid",
			roughness: 1,
			opacity: 100,
			groupIds: [],
			frameId: null,
			roundness: { type: 2 },
			seed: hashSeed(edge.id),
			version: 1,
			versionNonce: hashSeed(`nonce:${edge.id}`),
			isDeleted: false,
			boundElements: null,
			updated: 1,
			link: null,
			locked: false,
			points: [
				[0, 0],
				[dx, dy],
			],
			lastCommittedPoint: null,
			startBinding: null,
			endBinding: null,
			startArrowhead: null,
			endArrowhead: "arrow",
		});
		if (edge.label) {
			const labelWidth = Math.max(40, edge.label.length * 8);
			elements.push(
				textElement(
					`${edge.id}-label`,
					edge.label,
					startX + dx / 2 - labelWidth / 2,
					startY + dy / 2 - 12,
					labelWidth,
					24,
				),
			);
		}
	}
	return {
		type: "excalidraw",
		version: 2,
		source: "zeta",
		elements,
		appState: { gridSize: 20, viewBackgroundColor: "#ffffff" },
		files: {},
	};
}

async function writeScene(
	file: string,
	format: CanvasFormat,
	nodes: readonly SceneNode[],
	edges: readonly SceneEdge[],
): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const scene = format === "obsidian" ? obsidianScene(nodes, edges) : excalidrawScene(nodes, edges);
	await fs.writeFile(file, `${JSON.stringify(scene, null, 2)}\n`, "utf8");
}

async function listCanvases(root: string): Promise<string[]> {
	const files: string[] = [];
	const walk = async (current: string): Promise<void> => {
		let entries;
		try {
			entries = await fs.readdir(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (files.length >= MAX_LISTED) return;
			if (entry.isSymbolicLink()) continue;
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
				continue;
			}
			if (/\.(?:canvas|excalidraw)$/i.test(entry.name)) {
				files.push(path.relative(root, full).replaceAll("\\", "/"));
			}
		}
	};
	await walk(root);
	return files;
}

/** Creates, writes, lists, and outlines persistent canvas scenes under `<cwd>/.canvas/`. */
export class CanvasTool implements AgentTool<typeof canvasSchema, CanvasToolDetails> {
	readonly name = "canvas";
	readonly label = "Canvas";
	readonly description = canvasDescription;
	readonly parameters = canvasSchema;
	readonly strict = false;
	readonly loadMode = "essential" as const;
	readonly summary = "Manage repository canvas scenes under .canvas/";
	readonly approval = (args: unknown): ToolApprovalDecision =>
		args !== null && typeof args === "object" && "op" in args && (args.op === "create" || args.op === "write")
			? "write"
			: "read";

	constructor(private readonly session: ToolSession) {}

	async execute(
		_id: string,
		params: CanvasParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<CanvasToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<CanvasToolDetails>> {
		throwIfAborted(signal);
		const dir = path.join(this.session.cwd, CANVAS_DIR);

		if (params.op === "list") {
			const files = await listCanvases(dir);
			return {
				content: [
					{ type: "text", text: files.length > 0 ? files.map(file => `- ${file}`).join("\n") : "(no canvases)" },
				],
				details: { files },
			};
		}

		if (params.op === "create") {
			if (!params.title?.trim()) throw new ToolError("canvas create requires a title.");
			const kind = params.kind ?? "excalidraw";
			const extension = kind === "obsidian" ? ".canvas" : ".excalidraw";
			const absolute = path.join(dir, `${slugify(params.title)}${extension}`);
			const relative = path.relative(this.session.cwd, absolute).replaceAll("\\", "/");
			await fs.mkdir(dir, { recursive: true });
			if (!params.overwrite) {
				const exists = await fs.access(absolute).then(
					() => true,
					() => false,
				);
				if (exists) throw new ToolError(`Canvas already exists: ${relative}. Pass overwrite: true to replace it.`);
			}
			const scene = normalizeScene(params.nodes, params.edges);
			await writeScene(absolute, kind, scene.nodes, scene.edges);
			return {
				content: [{ type: "text", text: `Created ${relative}` }],
				details: { path: relative, nodes: scene.nodes.length, edges: scene.edges.length },
			};
		}

		if (params.op === "write") {
			if (!params.path?.trim()) throw new ToolError("canvas write requires a path.");
			const target = resolveCanvasPath(this.session.cwd, params.path);
			const relative = path.relative(this.session.cwd, target).replaceAll("\\", "/");
			const scene = normalizeScene(params.nodes, params.edges);
			await writeScene(target, formatForPath(target), scene.nodes, scene.edges);
			return {
				content: [
					{
						type: "text",
						text: `Wrote ${relative} (${scene.nodes.length} nodes, ${scene.edges.length} edges)`,
					},
				],
				details: { path: relative, nodes: scene.nodes.length, edges: scene.edges.length },
			};
		}

		if (!params.path?.trim()) throw new ToolError("canvas outline requires a path.");
		const target = resolveCanvasPath(this.session.cwd, params.path);
		const raw = await fs.readFile(target, "utf8");
		const content = summarizeCanvas(raw, target);
		const relative = path.relative(this.session.cwd, target).replaceAll("\\", "/");
		return {
			content: [{ type: "text", text: content }],
			details: { path: relative },
		};
	}
}
