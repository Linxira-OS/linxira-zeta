/**
 * Convert Obsidian `.canvas` and Excalidraw `.excalidraw` scenes to SVG.
 *
 * The terminal shows raster images only, so a canvas read with `:img` becomes
 * an SVG document first and then goes through the shared `rasterizeSvg`
 * pipeline. The generated document uses `var(--…)` figure tokens so the host
 * can resolve them against the live theme (`prepareSvg`) exactly like an
 * assistant ```svg fence.
 *
 * Fidelity is intentionally structural: boxes, text, and arrows. Excalidraw's
 * hand-drawn roughness (roughjs), embedded images, and freedraw strokes are
 * not reproduced.
 */
import { isRecord } from "@linxiraos/pi-utils";

const PADDING = 40;
const DEFAULT_TEXT_SIZE = 14;
const LINE_HEIGHT = 1.35;
const MARKER_ID = "zeta-canvas-arrow";

const TOKEN = {
	stroke: "var(--border)",
	text: "var(--fg)",
	muted: "var(--muted)",
	accent: "var(--accent)",
	surface: "var(--surface)",
} as const;

interface Point {
	x: number;
	y: number;
}

interface Box extends Point {
	w: number;
	h: number;
}

export function isCanvasPath(filePath: string): boolean {
	const lower = filePath.toLowerCase();
	return lower.endsWith(".canvas") || lower.endsWith(".excalidraw");
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function num(value: unknown, fallback = 0): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function isTransparent(color: string): boolean {
	return color === "" || color === "transparent" || color === "none";
}

function textLines(value: string, limit = 60): string[] {
	return value
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.slice(0, 40)
		.map(line => (line.length > limit ? `${line.slice(0, limit - 1)}…` : line));
}

function textBlock(x: number, y: number, lines: string[], options: { size?: number; fill?: string } = {}): string {
	const size = options.size ?? DEFAULT_TEXT_SIZE;
	const fill = options.fill ?? TOKEN.text;
	const spans = lines
		.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : size * LINE_HEIGHT}">${escapeXml(line)}</tspan>`)
		.join("");
	return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" dominant-baseline="hanging" xml:space="preserve">${spans}</text>`;
}

function arrowDefs(): string {
	return `<defs><marker id="${MARKER_ID}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${TOKEN.muted}"/></marker></defs>`;
}

function svgDocument(box: Box, body: string): string {
	const width = Math.max(1, Math.ceil(box.w));
	const height = Math.max(1, Math.ceil(box.h));
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${width} ${height}" width="${width}" height="${height}" font-family="sans-serif">${arrowDefs()}${body}</svg>`;
}

function boundsOf(points: Point[], boxes: Box[]): Box {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const box of boxes) {
		minX = Math.min(minX, box.x);
		minY = Math.min(minY, box.y);
		maxX = Math.max(maxX, box.x + box.w);
		maxY = Math.max(maxY, box.y + box.h);
	}
	for (const point of points) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
	return { x: minX - PADDING, y: minY - PADDING, w: maxX - minX + PADDING * 2, h: maxY - minY + PADDING * 2 };
}

interface ObsidianNode {
	id?: string;
	type?: string;
	text?: string;
	file?: string;
	label?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
}

interface ObsidianEdge {
	fromNode?: string;
	toNode?: string;
	label?: string;
}

function nodeBox(node: ObsidianNode): Box {
	const w = Math.max(40, num(node.width, 200));
	const h = Math.max(30, num(node.height, 60));
	return { x: num(node.x), y: num(node.y), w, h };
}

function renderObsidian(data: { nodes: ObsidianNode[]; edges?: ObsidianEdge[] }): string {
	const nodes = data.nodes.slice(0, 500);
	const edges = (data.edges ?? []).slice(0, 500);
	const boxes = new Map<string, Box>();
	const body: string[] = [];

	for (const node of nodes) {
		const box = nodeBox(node);
		if (node.id) boxes.set(node.id, box);
		const label = node.type === "file" ? str(node.file) : node.type === "group" ? str(node.label) : str(node.text);
		if (node.type === "group") {
			body.push(
				`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="10" fill="none" stroke="${TOKEN.stroke}" stroke-dasharray="6 6"/>`,
			);
			body.push(textBlock(box.x + 12, box.y + 10, textLines(label || "group", 48), { size: 13, fill: TOKEN.muted }));
			continue;
		}
		body.push(
			`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="8" fill="none" stroke="${TOKEN.stroke}"/>`,
		);
		const lines = textLines(label || (node.type === "file" ? "file" : "text"));
		body.push(textBlock(box.x + 12, box.y + 10, lines));
		if (node.type === "file" && node.file) {
			body.push(
				textBlock(box.x + 12, box.y + 12 + lines.length * DEFAULT_TEXT_SIZE * LINE_HEIGHT + 4, [node.file], {
					size: 11,
					fill: TOKEN.muted,
				}),
			);
		}
	}

	for (const edge of edges) {
		const from = edge.fromNode ? boxes.get(edge.fromNode) : undefined;
		const to = edge.toNode ? boxes.get(edge.toNode) : undefined;
		if (!from || !to) continue;
		const start = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
		const end = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
		body.push(
			`<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${TOKEN.muted}" stroke-width="1.5" marker-end="url(#${MARKER_ID})"/>`,
		);
		if (edge.label) {
			body.push(
				textBlock((start.x + end.x) / 2, (start.y + end.y) / 2 - 16, [edge.label], {
					size: 11,
					fill: TOKEN.muted,
				}),
			);
		}
	}

	const box = boundsOf([], [...boxes.values()]);
	return svgDocument(box, body.join(""));
}

interface ExcalidrawElement {
	id?: string;
	type?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	text?: string;
	fontSize?: number;
	strokeColor?: string;
	backgroundColor?: string;
	strokeWidth?: number;
	opacity?: number;
	isDeleted?: boolean;
	points?: number[][];
	startBinding?: { elementId?: string } | null;
	endBinding?: { elementId?: string } | null;
}

function elementBox(element: ExcalidrawElement): Box {
	return {
		x: num(element.x),
		y: num(element.y),
		w: Math.max(1, num(element.width)),
		h: Math.max(1, num(element.height)),
	};
}

function elementCenter(element: ExcalidrawElement): Point {
	const box = elementBox(element);
	return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function renderExcalidraw(data: { elements: ExcalidrawElement[] }): string {
	const elements = data.elements.filter(element => !element.isDeleted).slice(0, 800);
	const byId = new Map<string, ExcalidrawElement>();
	for (const element of elements) if (element.id) byId.set(element.id, element);

	const points: Point[] = [];
	const boxes: Box[] = [];
	const body: string[] = [];
	const textElements: ExcalidrawElement[] = [];

	for (const element of elements) {
		const type = element.type ?? "";
		if (type === "text") {
			textElements.push(element);
			continue;
		}
		if (type === "arrow" || type === "line") {
			const origin = { x: num(element.x), y: num(element.y) };
			const rawPoints = Array.isArray(element.points) ? element.points : [];
			const absolute = rawPoints
				.map(point => ({ x: origin.x + num(point[0]), y: origin.y + num(point[1]) }))
				.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
			const from = element.startBinding?.elementId ? byId.get(element.startBinding.elementId) : undefined;
			const to = element.endBinding?.elementId ? byId.get(element.endBinding.elementId) : undefined;
			const line = absolute.length >= 2 ? absolute : from && to ? [elementCenter(from), elementCenter(to)] : [];
			if (line.length < 2) continue;
			points.push(...line);
			const stroke = str(element.strokeColor) || TOKEN.muted;
			body.push(
				`<polyline points="${line.map(point => `${point.x},${point.y}`).join(" ")}" fill="none" stroke="${stroke === "transparent" ? TOKEN.muted : stroke}" stroke-width="${Math.max(1, num(element.strokeWidth, 2))}" marker-end="url(#${MARKER_ID})"/>`,
			);
			continue;
		}
		if (type !== "rectangle" && type !== "ellipse" && type !== "diamond") continue;
		const box = elementBox(element);
		boxes.push(box);
		const stroke = str(element.strokeColor) || TOKEN.stroke;
		const fill = isTransparent(str(element.backgroundColor)) ? "none" : str(element.backgroundColor);
		const opacity = Math.min(1, Math.max(0, num(element.opacity, 1)));
		const attrs = `fill="${fill}" stroke="${stroke === "transparent" ? TOKEN.stroke : stroke}" stroke-width="${Math.max(1, num(element.strokeWidth, 2))}" opacity="${opacity}"`;
		if (type === "rectangle") {
			body.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="6" ${attrs}/>`);
		} else if (type === "ellipse") {
			body.push(
				`<ellipse cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" rx="${box.w / 2}" ry="${box.h / 2}" ${attrs}/>`,
			);
		} else {
			body.push(
				`<polygon points="${box.x + box.w / 2},${box.y} ${box.x + box.w},${box.y + box.h / 2} ${box.x + box.w / 2},${box.y + box.h} ${box.x},${box.y + box.h / 2}" ${attrs}/>`,
			);
		}
	}

	for (const element of textElements) {
		const box = elementBox(element);
		const size = Math.max(8, num(element.fontSize, 20));
		const color = str(element.strokeColor) || TOKEN.text;
		const lines = textLines(str(element.text), 80);
		boxes.push({ ...box, h: Math.max(box.h, lines.length * size * LINE_HEIGHT) });
		body.push(textBlock(box.x, box.y, lines, { size, fill: color === "transparent" ? TOKEN.text : color }));
	}

	const box = boundsOf(points, boxes);
	return svgDocument(box, body.join(""));
}

/** Convert a `.canvas` / `.excalidraw` document to an SVG string (theme tokens unresolved). */
export function canvasToSvg(raw: string, filePath: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid canvas JSON in ${filePath}: ${detail}`);
	}
	if (isRecord(parsed) && Array.isArray(parsed.nodes)) {
		return renderObsidian(parsed as unknown as { nodes: ObsidianNode[]; edges?: ObsidianEdge[] });
	}
	if (isRecord(parsed) && Array.isArray(parsed.elements)) {
		return renderExcalidraw(parsed as unknown as { elements: ExcalidrawElement[] });
	}
	throw new Error(`Unsupported canvas JSON in ${filePath}: expected an Obsidian .canvas or an Excalidraw scene`);
}
