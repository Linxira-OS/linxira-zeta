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

const canvasSchema = type({
	op: type("'list' | 'create' | 'outline'").describe("Operation to perform"),
	"title?": type("string").describe("Canvas title for create (used as the file name)"),
	"kind?": type("'excalidraw' | 'obsidian'").describe("Canvas format for create; default excalidraw"),
	"path?": type("string").describe("Canvas path for outline, relative to .canvas/"),
	"overwrite?": type("boolean").describe("Replace an existing canvas on create"),
});

export type CanvasParams = typeof canvasSchema.infer;

export interface CanvasToolDetails {
	path?: string;
	files?: string[];
}

const EXCALIDRAW_TEMPLATE = `${JSON.stringify(
	{
		type: "excalidraw",
		version: 2,
		source: "zeta",
		elements: [],
		appState: { gridSize: 20, viewBackgroundColor: "#ffffff" },
		files: {},
	},
	null,
	2,
)}\n`;

const OBSIDIAN_TEMPLATE = `${JSON.stringify({ nodes: [], edges: [] }, null, 2)}\n`;

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

/** Creates, lists, and outlines persistent canvas scenes under `<cwd>/.canvas/`. */
export class CanvasTool implements AgentTool<typeof canvasSchema, CanvasToolDetails> {
	readonly name = "canvas";
	readonly label = "Canvas";
	readonly description = canvasDescription;
	readonly parameters = canvasSchema;
	readonly strict = false;
	readonly loadMode = "essential" as const;
	readonly summary = "Manage repository canvas scenes under .canvas/";
	readonly approval = (args: unknown): ToolApprovalDecision =>
		args !== null && typeof args === "object" && "op" in args && args.op === "create" ? "write" : "read";

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
			await fs.writeFile(absolute, kind === "obsidian" ? OBSIDIAN_TEMPLATE : EXCALIDRAW_TEMPLATE, "utf8");
			return {
				content: [{ type: "text", text: `Created ${relative}` }],
				details: { path: relative },
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
