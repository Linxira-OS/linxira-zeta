/**
 * `siyuan://` — SiYuan notes through the local kernel API.
 *
 * SiYuan stores documents as `.sy` block-tree JSON, so reading the workspace
 * files directly would couple us to an internal format. Every read and write
 * here goes through the kernel (default `http://127.0.0.1:6806`) with the
 * user's API token; the kernel renders blocks back to Markdown/Kramdown.
 *
 * URL shapes:
 * - `siyuan://`                          list notebooks
 * - `siyuan://notebook/<id>`             list documents in a notebook
 * - `siyuan://doc/<id>`                  read a document as Markdown
 * - `siyuan://doc/<id>?op=outline`       document outline
 * - `siyuan://search?q=<text>`           full-text search
 * - `siyuan://doc/<id>?op=append`        write tool target (appends Markdown)
 */
import { isSettingsInitialized, settings } from "../config/settings";
import siyuanDoc from "../prompts/internal-urls/siyuan.md" with { type: "text" };
import { cfgSiyuanEnabled, cfgSiyuanToken, cfgSiyuanUrl } from "../tools/settings";
import { parseInternalUrl } from "./parse";
import type {
	InternalResource,
	InternalUrl,
	InternalWriteResult,
	ProtocolHandler,
	ResolveContext,
	WriteContext,
} from "./types";

const DEFAULT_URL = "http://127.0.0.1:6806";
const API_TIMEOUT_MS = 15_000;
const DOC_ID_RE = /^[0-9A-Za-z-]{10,64}$/;
const SNIPPET_LIMIT = 160;

export type ParsedSiyuanUrl =
	| { kind: "notebooks"; url: string; op?: undefined }
	| { kind: "notebook"; url: string; id: string; op?: undefined }
	| { kind: "doc"; url: string; id: string; op?: undefined }
	| { kind: "doc-op"; url: string; id: string; op: "outline" | "append" }
	| { kind: "search"; url: string; op: "search"; query: string };

interface SiyuanEnvelope<T> {
	code: number;
	msg: string;
	data: T;
}

interface SiyuanConfig {
	url: string;
	token: string;
	enabled?: boolean;
}

let configOverrideForTests: Partial<SiyuanConfig> | undefined;
let fetchForTests: typeof fetch | undefined;

/** Test hook: override resolved config without initializing global settings. */
export function setSiyuanConfigForTests(config: Partial<SiyuanConfig> | undefined): void {
	configOverrideForTests = config;
}

/** Test hook: replace the network layer. */
export function setSiyuanFetchForTests(impl: typeof fetch | undefined): void {
	fetchForTests = impl;
}

function readSetting<T>(handle: { get(s: typeof settings): T; default: T }): T {
	if (!isSettingsInitialized()) return handle.default;
	try {
		return handle.get(settings);
	} catch {
		return handle.default;
	}
}

export function isSiyuanEnabled(): boolean {
	if (configOverrideForTests?.enabled !== undefined) return configOverrideForTests.enabled;
	return readSetting(cfgSiyuanEnabled) === true;
}

export function resolveSiyuanConfig(): SiyuanConfig {
	const rawUrl = configOverrideForTests?.url ?? readSetting(cfgSiyuanUrl);
	const envToken = process.env.SIYUAN_TOKEN?.trim();
	const rawToken = configOverrideForTests?.token ?? envToken ?? readSetting(cfgSiyuanToken);
	const url = (typeof rawUrl === "string" && rawUrl.trim() ? rawUrl.trim() : DEFAULT_URL).replace(/\/+$/, "");
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`siyuan.url is not a valid URL: ${url}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`siyuan.url must be http(s)://, got ${parsed.protocol}`);
	}
	return { url, token: typeof rawToken === "string" ? rawToken.trim() : "" };
}

export function hasSiyuan(): boolean {
	if (!isSiyuanEnabled()) return false;
	try {
		return resolveSiyuanConfig().token.length > 0;
	} catch {
		return false;
	}
}

function decodePath(url: InternalUrl): string[] {
	const raw = url.rawPathname ?? url.pathname;
	const trimmed = raw.replace(/^\/+/, "").replace(/\/+$/, "");
	if (!trimmed) return [];
	let decoded: string;
	try {
		decoded = decodeURIComponent(trimmed);
	} catch {
		throw new Error(`Invalid URL encoding in siyuan:// path: ${url.href}`);
	}
	return decoded.split("/").filter(segment => segment.length > 0);
}

function requireDocId(id: string | undefined, url: string): string {
	if (!id || !DOC_ID_RE.test(id)) throw new Error(`siyuan:// document URL needs a valid block id: ${url}`);
	return id;
}

export function parseSiyuanUrl(input: string | InternalUrl): ParsedSiyuanUrl {
	const url = typeof input === "string" ? parseInternalUrl(input) : input;
	const host = (url.rawHost || url.hostname).toLowerCase();
	const segments = decodePath(url);
	const op = url.searchParams.get("op")?.toLowerCase() ?? undefined;
	const href = url.href;

	if (!host && segments.length === 0 && !op) return { kind: "notebooks", url: href };
	if (host === "notebook") {
		return { kind: "notebook", url: href, id: requireDocId(segments[0], href) };
	}
	if (host === "doc") {
		const id = requireDocId(segments[0], href);
		if (op === "outline" || op === "append") return { kind: "doc-op", url: href, id, op };
		if (op) throw new Error(`Unsupported siyuan:// doc op: ${op}`);
		return { kind: "doc", url: href, id };
	}
	if (host === "search" || op === "search") {
		const query = (url.searchParams.get("q") ?? segments.join(" ")).trim();
		if (!query) throw new Error(`siyuan://search requires a 'q' query parameter: ${href}`);
		return { kind: "search", url: href, op: "search", query };
	}
	throw new Error(`Unsupported siyuan:// URL: ${href}. Use siyuan://, siyuan://notebook/<id>, or siyuan://doc/<id>.`);
}

async function post<T>(
	api: string,
	body: Record<string, unknown>,
	context?: ResolveContext | WriteContext,
): Promise<T> {
	const config = resolveSiyuanConfig();
	if (!config.token) {
		throw new Error(
			"siyuan:// requires an API token. Set `siyuan.token` (Settings → Tools → SiYuan) or SIYUAN_TOKEN.",
		);
	}
	const doFetch = fetchForTests ?? fetch;
	const timeout = AbortSignal.timeout(API_TIMEOUT_MS);
	const signal = context?.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
	let response: Response;
	try {
		response = await doFetch(`${config.url}${api}`, {
			method: "POST",
			headers: { Authorization: `Token ${config.token}`, "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal,
		});
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(`siyuan:// request failed (${api}): ${detail}`);
	}
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`siyuan:// HTTP ${response.status} from ${api}: ${truncate(text, 300)}`);
	}
	let envelope: SiyuanEnvelope<T>;
	try {
		envelope = JSON.parse(text) as SiyuanEnvelope<T>;
	} catch {
		throw new Error(`siyuan:// API returned non-JSON from ${api}: ${truncate(text, 300)}`);
	}
	if (envelope.code !== 0) {
		throw new Error(`siyuan:// API error from ${api}: ${envelope.msg || `code ${envelope.code}`}`);
	}
	return envelope.data;
}

function truncate(value: string, limit: number): string {
	const clean = value.replace(/\s+/g, " ").trim();
	return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

function sqlString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function renderNotebooks(data: { notebooks?: Array<{ id: string; name: string; closed?: boolean }> }): string {
	const notebooks = data.notebooks ?? [];
	if (notebooks.length === 0) return "# SiYuan Notebooks\n\n(none)\n";
	const lines = notebooks.map(
		notebook => `- [${notebook.name}](siyuan://notebook/${notebook.id})${notebook.closed ? " (closed)" : ""}`,
	);
	return `# SiYuan Notebooks\n\n${notebooks.length} notebook${notebooks.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}\n`;
}

function renderNotebookDocs(
	notebookId: string,
	blocks: Array<{ id: string; content?: string; hpath?: string }>,
): string {
	if (blocks.length === 0) return `# SiYuan Notebook ${notebookId}\n\n(no documents)\n`;
	const lines = blocks.map(block => {
		const title = block.content?.trim() || block.hpath || block.id;
		return `- [${title}](siyuan://doc/${block.id})${block.hpath ? ` — ${block.hpath}` : ""}`;
	});
	return `# SiYuan Notebook ${notebookId}\n\n${blocks.length} document${blocks.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}\n`;
}

function renderSearch(query: string, blocks: Array<{ id: string; content?: string; hPath?: string }>): string {
	if (blocks.length === 0) return `# SiYuan search: ${query}\n\n(no results)\n`;
	const lines = blocks.map(block => {
		const path = block.hPath ?? "";
		const snippet = truncate((block.content ?? "").replace(/<[^>]*>/g, ""), SNIPPET_LIMIT);
		return `- [${path || block.id}](siyuan://doc/${block.id})${snippet ? ` — ${snippet}` : ""}`;
	});
	return `# SiYuan search: ${query}\n\n${blocks.length} result${blocks.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}\n`;
}

function renderOutline(nodes: Array<{ name?: string; id?: string; children?: unknown[] }>, depth = 0): string[] {
	const lines: string[] = [];
	for (const node of nodes) {
		const indent = "  ".repeat(depth);
		lines.push(`${indent}- ${node.name?.trim() || node.id || "(untitled)"}`);
		if (Array.isArray(node.children) && node.children.length > 0) {
			lines.push(
				...renderOutline(node.children as Array<{ name?: string; id?: string; children?: unknown[] }>, depth + 1),
			);
		}
	}
	return lines;
}

export class SiyuanProtocolHandler implements ProtocolHandler {
	readonly scheme = "siyuan";
	readonly spec = {
		backing: "remote",
		selectors: "none",
		immutable: true,
		write: {
			via: "handler",
			payload: "text",
			scope: "workspace",
			tier: () => "write" as const,
		},
	} satisfies ProtocolHandler["spec"];

	promptDoc(): string | undefined {
		return hasSiyuan() ? siyuanDoc.trim() : undefined;
	}

	async resolve(url: InternalUrl, context?: ResolveContext): Promise<InternalResource> {
		if (!isSiyuanEnabled()) {
			throw new Error("siyuan:// is disabled. Enable `siyuan.enabled` (Settings → Tools → SiYuan).");
		}
		const parsed = parseSiyuanUrl(url);
		if (parsed.kind === "notebooks") {
			const data = await post<{ notebooks?: Array<{ id: string; name: string; closed?: boolean }> }>(
				"/api/notebook/lsNotebooks",
				{},
				context,
			);
			const content = renderNotebooks(data);
			return resource(parsed.url, content, "text/markdown");
		}
		if (parsed.kind === "notebook") {
			const data = await post<{ blocks?: Array<{ id: string; content?: string; hpath?: string }> }>(
				"/api/query/sql",
				{
					stmt: `SELECT id, content, hpath FROM blocks WHERE type = 'd' AND box = ${sqlString(parsed.id)} ORDER BY updated DESC LIMIT 100`,
				},
				context,
			);
			const content = renderNotebookDocs(parsed.id, data.blocks ?? []);
			return resource(parsed.url, content, "text/markdown");
		}
		if (parsed.kind === "search") {
			const data = await post<{ blocks?: Array<{ id: string; content?: string; hPath?: string }> }>(
				"/api/search/fullTextSearchBlock",
				{ query: parsed.query, page: 1, pageSize: 20 },
				context,
			);
			const content = renderSearch(parsed.query, data.blocks ?? []);
			return resource(parsed.url, content, "text/markdown");
		}
		if (parsed.kind === "doc-op" && parsed.op === "outline") {
			const data = await post<Array<{ name?: string; id?: string; children?: unknown[] }>>(
				"/api/outline/getDocOutline",
				{ id: parsed.id },
				context,
			);
			const lines = renderOutline(Array.isArray(data) ? data : []);
			const content = `# SiYuan outline: ${parsed.id}\n\n${lines.length > 0 ? lines.join("\n") : "(empty)"}\n`;
			return resource(parsed.url, content, "text/markdown");
		}
		if (parsed.kind === "doc-op") {
			throw new Error("siyuan:// ?op=append is a write target; use the write tool.");
		}
		const data = await post<{ content?: string; hPath?: string }>(
			"/api/export/exportMdContent",
			{ id: parsed.id },
			context,
		);
		let content = data.content ?? "";
		if (!content.trim()) {
			const kramdown = await post<{ kramdown?: string }>("/api/block/getBlockKramdown", { id: parsed.id }, context);
			content = kramdown.kramdown ?? "";
		}
		const heading = data.hPath ? `# ${data.hPath}\n\n` : "";
		return resource(parsed.url, `${heading}${content}`, "text/markdown");
	}

	async write(url: InternalUrl, content: string, context?: WriteContext): Promise<InternalWriteResult> {
		if (!isSiyuanEnabled()) {
			throw new Error("siyuan:// is disabled. Enable `siyuan.enabled` (Settings → Tools → SiYuan).");
		}
		const parsed = parseSiyuanUrl(url);
		if (parsed.kind !== "doc-op" || parsed.op !== "append") {
			throw new Error("siyuan:// writes require `siyuan://doc/<id>?op=append`.");
		}
		await post<{ id?: string } | null>(
			"/api/block/appendBlock",
			{ dataType: "markdown", data: content, parentID: parsed.id },
			context,
		);
		return {
			content: [
				{ type: "text", text: `Appended ${Buffer.byteLength(content, "utf-8")} bytes to SiYuan doc ${parsed.id}.` },
			],
		};
	}
}

function resource(url: string, content: string, contentType: InternalResource["contentType"]): InternalResource {
	return { url, content, contentType, size: Buffer.byteLength(content, "utf-8"), immutable: true };
}
