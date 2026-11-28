/**
 * Web Gateway — agent-authored pages (`/api/agent-pages`).
 *
 * Routes (registered in `../web-gateway.ts`):
 *
 *   GET  /api/agent-pages                              inventory of pages
 *   GET  /api/agent-pages/<id>                         one parsed manifest
 *   GET  /api/agent-pages/<id>/assets/<path>           page-owned static file
 *   POST /api/agent-pages/<id>/workflows/<id>/run      run one DAG workflow
 *
 * The root is never request-selectable: it is `ZETA_AGENT_PAGES_DIR` or
 * `<agent dir>/agent-pages`. Every manifest and asset path is resolved inside
 * its page directory after `realpath`, and the asset route only answers
 * allowlisted static extensions. There is no route that runs a shell command or
 * loads page-provided code into the gateway process; workflow steps are the
 * declarative set documented in `../../agent-pages/executor.ts`.
 *
 * Auth, CSRF, operation scope, and binding checks happen in
 * `webGatewayFetch` before these handlers run, exactly like every other
 * gateway family. The run route is a POST, so a read-only credential is denied
 * by the normal scope gate.
 */

import { stat } from "node:fs/promises";
import { extname } from "node:path";
import {
	AGENT_PAGE_ID_PATTERN,
	AGENT_PAGE_MAX_CONCURRENCY,
	AgentPageError,
	listAgentPages,
	loadAgentPage,
	resolveAgentPageFile,
	resolveAgentPagesRoot,
	runAgentPageWorkflow,
	type AgentPageLocation,
	type AgentPagePermissions,
	type AgentPageWorkflow,
} from "../../agent-pages";

/** Prefix shared by the inventory, manifest, asset, and workflow routes. */
export const AGENT_PAGES_PATH = "/api/agent-pages";

/** Route-parameter pattern; the manifest parser enforces the same shape. */
export const AGENT_PAGE_ID_PART = AGENT_PAGE_ID_PATTERN;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
	".txt": "text/plain; charset=utf-8",
};

const PAGE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
	"cache-control": "no-store",
	"x-content-type-options": "nosniff",
	"referrer-policy": "no-referrer",
	"content-security-policy":
		"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
};

interface AgentPageManifestDto {
	readonly schema: string;
	readonly id: string;
	readonly name: string;
	readonly entry: string;
	readonly entryUrl: string;
	readonly permissions: AgentPagePermissions;
	readonly workflows: readonly AgentPageWorkflow[];
}

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

function pageDto(page: AgentPageLocation): AgentPageManifestDto {
	const encodedEntry = page.manifest.entry
		.split("/")
		.map(segment => encodeURIComponent(segment))
		.join("/");
	return {
		schema: page.manifest.schema,
		id: page.manifest.id,
		name: page.manifest.name,
		entry: page.manifest.entry,
		entryUrl: `${AGENT_PAGES_PATH}/${encodeURIComponent(page.id)}/assets/${encodedEntry}`,
		permissions: page.manifest.permissions,
		workflows: page.manifest.workflows,
	};
}

function failure(error: unknown): Response {
	if (error instanceof AgentPageError) {
		return json(
			{
				error: error.message,
				code: error.code,
				...(error.details === undefined ? {} : { details: error.details }),
			},
			error.status,
		);
	}
	return json({ error: "Agent page request failed", code: "internal" }, 500);
}

function notFound(): Response {
	return json({ error: "Not found", code: "unknown_page" }, 404);
}

/**
 * Decode one URL path segment exactly once. Encoded separators, control
 * characters, drive/UNC markers, and `.`/`..` are rejected before the filesystem
 * sees them.
 */
function decodeSegment(raw: string): string | undefined {
	let decoded: string;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		return undefined;
	}
	if (decoded === "" || decoded === "." || decoded === "..") return undefined;
	if (decoded.includes("\0") || decoded.includes("/") || decoded.includes("\\") || decoded.includes(":")) {
		return undefined;
	}
	// eslint-disable-next-line no-control-regex
	return /[\u0000-\u001f]/.test(decoded) ? undefined : decoded;
}

function decodeAssetSegments(raw: string): string[] | undefined {
	const segments: string[] = [];
	for (const part of raw.split("/")) {
		const decoded = decodeSegment(part);
		if (decoded === undefined) return undefined;
		segments.push(decoded);
	}
	return segments.length === 0 ? undefined : segments;
}

/** GET /api/agent-pages → `{ pages, warnings }`. Never exposes absolute roots. */
export async function handleAgentPagesList(): Promise<Response> {
	try {
		const { pages, warnings } = await listAgentPages();
		return json({ pages: pages.map(pageDto), warnings });
	} catch (error) {
		return failure(error);
	}
}

/** GET /api/agent-pages/<id> → `{ page }`. */
export async function handleAgentPageGet(pageId: string): Promise<Response> {
	try {
		const page = await loadAgentPage(resolveAgentPagesRoot(), pageId);
		return json({ page: pageDto(page) });
	} catch (error) {
		return failure(error);
	}
}

/**
 * GET|HEAD /api/agent-pages/<id>/assets/<path>. Every refusal is a 404 so the
 * route cannot be used to probe outside the page root.
 */
export async function handleAgentPageAssetGet(req: Request, pageId: string, rawPath: string): Promise<Response> {
	const segments = decodeAssetSegments(rawPath);
	if (segments === undefined) return json({ error: "Invalid asset path", code: "invalid_request" }, 400);
	const fileName = segments[segments.length - 1] ?? "";
	const contentType = CONTENT_TYPES[extname(fileName).toLowerCase()];
	if (contentType === undefined) return notFound();

	let page: AgentPageLocation;
	let target: string;
	let size: number;
	try {
		page = await loadAgentPage(resolveAgentPagesRoot(), pageId);
		target = await resolveAgentPageFile(page.root, segments.join("/"));
		const stats = await stat(target);
		if (!stats.isFile()) return notFound();
		size = stats.size;
	} catch {
		return notFound();
	}

	const headers: Record<string, string> = {
		...PAGE_SECURITY_HEADERS,
		"content-type": contentType,
	};
	if (req.method === "HEAD") {
		return new Response(null, { status: 200, headers: { ...headers, "content-length": String(size) } });
	}
	return new Response(Bun.file(target), { status: 200, headers });
}

/**
 * POST /api/agent-pages/<id>/workflows/<workflowId>/run.
 *
 * The optional body is `{ "concurrency": 1..16 }`. Cancellation is the request's
 * own abort signal; the executor returns `cancelled` rather than a successful
 * partial result.
 */
export async function handleAgentPageWorkflowRun(req: Request, pageId: string, workflowId: string): Promise<Response> {
	let concurrency: number | undefined;
	const rawBody: unknown = await req.json().catch(() => undefined);
	if (rawBody !== undefined && rawBody !== null) {
		if (typeof rawBody !== "object" || Array.isArray(rawBody)) {
			return json({ error: "Body must be a JSON object", code: "invalid_request" }, 400);
		}
		// `typeof` above proves a non-array object; JSON.parse only creates data properties.
		const body = rawBody as Record<string, unknown>;
		if (Object.hasOwn(body, "concurrency") && body.concurrency !== undefined) {
			const requested = body.concurrency;
			if (
				typeof requested !== "number" ||
				!Number.isInteger(requested) ||
				requested < 1 ||
				requested > AGENT_PAGE_MAX_CONCURRENCY
			) {
				return json(
					{
						error: `concurrency must be an integer between 1 and ${AGENT_PAGE_MAX_CONCURRENCY}`,
						code: "invalid_request",
					},
					400,
				);
			}
			concurrency = requested;
		}
	}

	try {
		const page = await loadAgentPage(resolveAgentPagesRoot(), pageId);
		const result = await runAgentPageWorkflow({
			manifest: page.manifest,
			pageRoot: page.root,
			workflowId,
			signal: req.signal,
			...(concurrency === undefined ? {} : { concurrency }),
		});
		return json({
			pageId: result.pageId,
			workflowId: result.workflowId,
			outputs: result.outputs,
			order: result.order,
			durationMs: result.durationMs,
		});
	} catch (error) {
		return failure(error);
	}
}
