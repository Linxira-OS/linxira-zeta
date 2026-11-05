/**
 * Web Gateway — `/api/files/<path>` file browser and uploads.
 *
 * Port of `web-ui/app/api/files/[...path]/route.ts`. The renderer's file tree,
 * editor, preview panes and drag-and-drop upload all speak these shapes:
 *
 *   GET  ?type=list       → { entries: {name,isDir,size,modified}[], path }
 *   GET  ?type=read       → text { content, language, size } or raw bytes
 *   GET  ?type=download   → raw bytes (attachment)
 *   GET  ?type=meta       → { size, language, mime, previewKind }
 *   GET  ?type=preview    → rendered DOCX HTML page
 *   GET  ?type=watch      → SSE `connected`/`change` events
 *   POST ?type=upload     → { uploaded, skipped, errors } (multipart `files`)
 *   POST ?type=upload-check → { conflicts, nonReplaceable }
 *
 * Every path is confined twice: the requested string must sit inside an
 * allowed root, and the existing target must still sit there after `realpath`,
 * so neither `..` nor a symlink can escape. Session-referenced files (bash
 * output, attachments the session recorded) are readable even outside the
 * roots, exactly as in the legacy route.
 */

import { File as NodeFile } from "node:buffer";
import * as fs from "node:fs";
import * as path from "node:path";
import { convertToHtml } from "@linxiraos/pi-utils/docx";
import { parseSessionContent } from "../../session/session-loader";
import {
	getAllowedFileRoots,
	isExistingFilePathAllowed,
	isFilePathAllowed,
	isWindowsAbsolutePath,
	normalizeSlashes,
} from "./file-roots";
import {
	DOCX_PREVIEW_MAX_BYTES,
	IMAGE_PREVIEW_MAX_BYTES,
	TEXT_PREVIEW_MAX_BYTES,
	documentPreviewKind,
	getAudioMime,
	getDocumentMime,
	getFileExt,
	getImageMime,
} from "./file-types";
import { resolveSessionPath } from "./sessions";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

const IGNORED_NAMES = new Set([
	"node_modules",
	".git",
	".next",
	"dist",
	"build",
	"__pycache__",
	".turbo",
	".cache",
	"coverage",
	".pytest_cache",
	".mypy_cache",
	"target",
	"vendor",
	".DS_Store",
]);

const IGNORED_SUFFIXES = [".pyc"];

const FILE_REQUEST_TYPES = ["list", "read", "download", "meta", "preview", "watch"] as const;
type FileRequestType = (typeof FILE_REQUEST_TYPES)[number];
const FILE_REQUEST_TYPE_SET = new Set<string>(FILE_REQUEST_TYPES);
const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024;
// Multipart boundaries and headers are not file bytes, but must be bounded too.
const MAX_UPLOAD_REQUEST_BYTES = MAX_UPLOAD_TOTAL_BYTES + 1024 * 1024;
const UPLOAD_CONFLICT_STRATEGIES = ["error", "overwrite", "skip"] as const;
type UploadConflictStrategy = (typeof UPLOAD_CONFLICT_STRATEGIES)[number];
const UPLOAD_CONFLICT_STRATEGY_SET = new Set<string>(UPLOAD_CONFLICT_STRATEGIES);

const EXT_TO_LANGUAGE: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	rb: "ruby",
	go: "go",
	rs: "rust",
	java: "java",
	kt: "kotlin",
	swift: "swift",
	c: "c",
	cpp: "cpp",
	h: "c",
	hpp: "cpp",
	cs: "csharp",
	html: "html",
	htm: "html",
	css: "css",
	scss: "css",
	less: "css",
	json: "json",
	jsonl: "json",
	yaml: "yaml",
	yml: "yaml",
	toml: "toml",
	xml: "xml",
	md: "markdown",
	mdx: "markdown",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	fish: "bash",
	sql: "sql",
	graphql: "graphql",
	gql: "graphql",
	dockerfile: "dockerfile",
	tf: "hcl",
	hcl: "hcl",
	env: "bash",
	gitignore: "bash",
	txt: "text",
	pdf: "pdf",
	docx: "word",
};

function getLanguage(filePath: string): string {
	const base = path.basename(filePath).toLowerCase();
	// Special full-name matches
	if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
	if (base === ".env" || base.startsWith(".env.")) return "bash";
	if (base === "makefile" || base === "gnumakefile") return "makefile";
	const ext = base.split(".").pop() ?? "";
	return EXT_TO_LANGUAGE[ext] ?? "text";
}

function filePathFromSegments(segments: string[]): string {
	const joined = segments.join("/");
	const slashJoined = normalizeSlashes(joined);
	if (isWindowsAbsolutePath(slashJoined)) return slashJoined;
	return "/" + joined.replace(/^\/+/, "");
}

function parseFileRequestType(value: string): FileRequestType | null {
	return FILE_REQUEST_TYPE_SET.has(value) ? (value as FileRequestType) : null;
}

// ---------------------------------------------------------------------------
// Session path references
// ---------------------------------------------------------------------------

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidSessionId(sessionId: string | null): sessionId is string {
	return !!sessionId && SESSION_ID_RE.test(sessionId);
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function isPathChar(ch: string): boolean {
	return /[A-Za-z0-9._~+%@/\\:-]/.test(ch);
}

function hasReferenceBoundaryAfter(text: string, index: number): boolean {
	if (index >= text.length) return true;
	const ch = text[index];
	if (ch === ":") return /\d/.test(text[index + 1] ?? "");
	return !isPathChar(ch);
}

function containsExactPathReference(text: string, filePath: string): boolean {
	const target = normalizeSlashes(filePath);
	const targets = target.startsWith("/") ? [target, `file://${target}`] : [target];
	const haystacks = new Set([normalizeSlashes(text), normalizeSlashes(safeDecode(text))]);

	for (const haystack of haystacks) {
		for (const candidate of targets) {
			let index = haystack.indexOf(candidate);
			while (index !== -1) {
				const before = index === 0 ? "" : haystack[index - 1];
				const afterIndex = index + candidate.length;
				if ((index === 0 || !isPathChar(before)) && hasReferenceBoundaryAfter(haystack, afterIndex)) {
					return true;
				}
				index = haystack.indexOf(candidate, index + 1);
			}
		}
	}

	return false;
}

function collectStrings(value: unknown, out: string[]): void {
	if (typeof value === "string") {
		out.push(value);
		return;
	}
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value) collectStrings(item, out);
		return;
	}
	for (const item of Object.values(value)) collectStrings(item, out);
}

function isFilePathReferencedByEntries(filePath: string, entries: readonly unknown[]): boolean {
	for (const entry of entries) {
		const strings: string[] = [];
		collectStrings(entry, strings);
		if (strings.some(text => containsExactPathReference(text, filePath))) return true;
	}
	return false;
}

async function isFilePathReferencedBySession(filePath: string, sessionId: string | null): Promise<boolean> {
	if (!isValidSessionId(sessionId)) return false;
	try {
		const sessionPath = await resolveSessionPath(sessionId);
		if (!sessionPath) return false;
		const { entries } = parseSessionContent(fs.readFileSync(sessionPath, "utf8"));
		return isFilePathReferencedByEntries(filePath, entries);
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Upload helpers
// ---------------------------------------------------------------------------

class RequestBodyTooLargeError extends Error {
	constructor() {
		super("Request body exceeds the allowed size");
	}
}

function declaredContentLength(request: Request): number | null {
	const value = request.headers.get("content-length");
	if (!value || !/^\d+$/.test(value)) return null;
	const length = Number(value);
	return Number.isSafeInteger(length) ? length : null;
}

/**
 * The multipart payload type of the platform `Request` implementation. It is
 * derived (not the bare global `FormData`, which bun-types declares with a
 * string-only iterator) because both `request.formData()` and the bounded
 * re-parse below return that exact type.
 */
type MultipartFormData = Awaited<ReturnType<Request["formData"]>>;

/**
 * Parse multipart data only after constraining the complete wire body. This
 * bounds chunked requests too, where Content-Length is unavailable or false.
 */
async function parseFormDataWithinLimit(request: Request, maxBytes: number): Promise<MultipartFormData> {
	const declared = declaredContentLength(request);
	if (declared !== null && declared > maxBytes) {
		throw new RequestBodyTooLargeError();
	}

	const reader = request.body?.getReader();
	if (!reader) return request.formData();

	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (size + value.byteLength > maxBytes) {
				await reader.cancel().catch(() => {});
				throw new RequestBodyTooLargeError();
			}
			size += value.byteLength;
			const chunk = new Uint8Array(value.byteLength);
			chunk.set(value);
			chunks.push(chunk);
		}
	} finally {
		reader.releaseLock();
	}

	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	const contentType = request.headers.get("content-type");
	const headers = contentType ? { "content-type": contentType } : undefined;
	return new Response(body, { headers }).formData();
}

function parseUploadConflictStrategy(value: string | null): UploadConflictStrategy | null {
	const candidate = value ?? "error";
	return UPLOAD_CONFLICT_STRATEGY_SET.has(candidate) ? (candidate as UploadConflictStrategy) : null;
}

function validateUploadFileNames(fileNames: string[]): string | null {
	if (fileNames.length === 0) return "No files selected";

	const seen = new Set<string>();
	for (const fileName of fileNames) {
		if (!fileName || fileName === "." || fileName === ".." || fileName.includes("\0")) {
			return `Invalid file name: ${fileName || "(empty)"}`;
		}
		if (fileName.includes("/") || fileName.includes("\\") || path.basename(fileName) !== fileName) {
			return `File names must not contain a path: ${fileName}`;
		}
		if (seen.has(fileName)) return `Duplicate file name in upload: ${fileName}`;
		seen.add(fileName);
	}

	return null;
}

interface UploadTargetInspection {
	conflicts: string[];
	nonReplaceable: string[];
}

function inspectUploadTargets(directory: string, fileNames: string[]): UploadTargetInspection {
	const conflicts: string[] = [];
	const nonReplaceable: string[] = [];

	for (const fileName of fileNames) {
		const destination = path.join(directory, fileName);
		let stat: fs.Stats;
		try {
			stat = fs.lstatSync(destination);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") continue;
			throw error;
		}

		conflicts.push(fileName);
		if (!stat.isFile() || stat.isSymbolicLink()) nonReplaceable.push(fileName);
	}

	return { conflicts, nonReplaceable };
}

async function getUploadDirectory(segments: string[]): Promise<{ directory: string } | { response: Response }> {
	const directory = filePathFromSegments(segments);
	const allowedRoots = await getAllowedFileRoots();
	if (!isFilePathAllowed(directory, allowedRoots)) {
		return { response: json({ error: "Access denied" }, 403) };
	}

	let stat: fs.Stats;
	try {
		stat = fs.statSync(directory);
	} catch {
		return { response: json({ error: "Upload directory not found" }, 404) };
	}
	if (!stat.isDirectory()) {
		return { response: json({ error: "Upload target is not a directory" }, 400) };
	}

	// A browsable directory can be a symlink. Resolve both sides before writes
	// so a symlink inside an allowed root cannot redirect uploads outside it.
	const realDirectory = fs.realpathSync(directory);
	const realRoots = new Set<string>();
	for (const root of allowedRoots) {
		try {
			realRoots.add(fs.realpathSync(root));
		} catch {
			// Ignore stale session roots that no longer exist.
		}
	}
	if (!isFilePathAllowed(realDirectory, realRoots)) {
		return { response: json({ error: "Access denied" }, 403) };
	}

	return { directory: realDirectory };
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

function createFileBodyStream(filePath: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
	const fileStream = fs.createReadStream(filePath, range);
	let closed = false;

	return new ReadableStream<Uint8Array>({
		start(controller) {
			fileStream.on("data", (chunk: Buffer) => {
				if (closed) return;
				try {
					controller.enqueue(new Uint8Array(chunk));
				} catch {
					closed = true;
					fileStream.destroy();
				}
			});
			fileStream.once("end", () => {
				if (closed) return;
				closed = true;
				try {
					controller.close();
				} catch {
					// The browser may cancel media probes before the file stream ends.
				}
			});
			fileStream.once("error", error => {
				if (closed) return;
				closed = true;
				try {
					controller.error(error);
				} catch {
					// The response was already abandoned by the client.
				}
			});
		},
		cancel() {
			closed = true;
			fileStream.destroy();
		},
	});
}

function encodeHeaderValue(value: string): string {
	return encodeURIComponent(value).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function getContentDisposition(filePath: string, asDownload = false): string {
	const disposition = asDownload ? "attachment" : "inline";
	const fileName = path.basename(filePath);
	const fallback = fileName.replace(/[^\x20-\x7E]|["\\;\r\n]/g, "_") || "download";
	return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeHeaderValue(fileName)}`;
}

function streamFile(
	filePath: string,
	stat: fs.Stats,
	contentType: string,
	rangeHeader: string | null,
	asDownload = false,
): Response {
	const headers = {
		"Content-Type": contentType,
		"Cache-Control": "no-cache",
		"Accept-Ranges": "bytes",
		"Content-Disposition": getContentDisposition(filePath, asDownload),
	};

	if (!rangeHeader) {
		return new Response(createFileBodyStream(filePath), {
			headers: {
				...headers,
				"Content-Length": String(stat.size),
			},
		});
	}

	const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
	if (!match) {
		return new Response(null, {
			status: 416,
			headers: {
				...headers,
				"Content-Range": `bytes */${stat.size}`,
			},
		});
	}

	let start = match[1] ? Number(match[1]) : 0;
	let end = match[2] ? Number(match[2]) : stat.size - 1;
	if (!match[1] && match[2]) {
		const suffixLength = Number(match[2]);
		start = Math.max(stat.size - suffixLength, 0);
		end = stat.size - 1;
	}

	if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
		return new Response(null, {
			status: 416,
			headers: {
				...headers,
				"Content-Range": `bytes */${stat.size}`,
			},
		});
	}

	end = Math.min(end, stat.size - 1);
	const chunkSize = end - start + 1;
	return new Response(createFileBodyStream(filePath, { start, end }), {
		status: 206,
		headers: {
			...headers,
			"Content-Length": String(chunkSize),
			"Content-Range": `bytes ${start}-${end}/${stat.size}`,
		},
	});
}

// ---------------------------------------------------------------------------
// DOCX preview
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function wrapDocxPreviewHtml(bodyHtml: string, fileName: string): string {
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; min-height: 100%; background: #eef1f5; color: #171717; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 28px; }
  main {
    box-sizing: border-box;
    max-width: 840px;
    min-height: calc(100vh - 56px);
    margin: 0 auto;
    padding: 56px 64px;
    background: #fff;
    box-shadow: 0 8px 28px rgba(15, 23, 42, 0.14);
  }
  .file-title {
    margin: 0 0 28px;
    padding-bottom: 10px;
    border-bottom: 1px solid #e5e7eb;
    color: #6b7280;
    font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    word-break: break-word;
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.1em 0 0.45em; color: #111827; }
  p { margin: 0.65em 0; line-height: 1.7; }
  table { border-collapse: collapse; max-width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #d1d5db; padding: 6px 9px; vertical-align: top; }
  img { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  a { color: #2563eb; }
  @media (max-width: 720px) {
    body { padding: 0; background: #fff; }
    main { min-height: 100vh; padding: 28px 22px; box-shadow: none; }
  }
</style>
</head>
<body>
<main>
<div class="file-title">${escapeHtml(fileName)}</div>
${bodyHtml}
</main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleFilesGet(req: Request, segments: string[]): Promise<Response> {
	try {
		const filePath = filePathFromSegments(segments);
		const searchParams = new URL(req.url).searchParams;
		const rawType = searchParams.get("type") ?? "list";
		const type = parseFileRequestType(rawType);
		if (!type) {
			return json({ error: "Invalid file request type" }, 400);
		}
		const sessionId = searchParams.get("sessionId");

		const allowedRoots = await getAllowedFileRoots();
		const allowedByRoot = isFilePathAllowed(filePath, allowedRoots);
		const allowedBySessionReference =
			!allowedByRoot && type !== "list" && (await isFilePathReferencedBySession(filePath, sessionId));
		if (!allowedByRoot && !allowedBySessionReference) {
			return json({ error: "Access denied" }, 403);
		}

		let stat: fs.Stats;
		try {
			stat = fs.statSync(filePath);
		} catch {
			return json({ error: "Not found" }, 404);
		}

		if (!allowedBySessionReference && !isExistingFilePathAllowed(filePath, allowedRoots)) {
			return json({ error: "Access denied" }, 403);
		}

		if (type === "read") {
			if (!stat.isFile()) {
				return json({ error: "Not a file" }, 400);
			}
			const imageMime = getImageMime(filePath);
			if (imageMime) {
				if (stat.size > IMAGE_PREVIEW_MAX_BYTES) {
					return json({ error: "Image too large (>10MB)" }, 413);
				}
				return streamFile(filePath, stat, imageMime, req.headers.get("range"));
			}
			const audioMime = getAudioMime(filePath);
			if (audioMime) {
				return streamFile(filePath, stat, audioMime, req.headers.get("range"));
			}
			const documentMime = getDocumentMime(filePath);
			if (documentMime) {
				return streamFile(filePath, stat, documentMime, req.headers.get("range"));
			}
			if (stat.size > TEXT_PREVIEW_MAX_BYTES) {
				return json({ error: "File too large for preview (>256KB)" }, 413);
			}
			const content = fs.readFileSync(filePath, "utf-8");
			const language = getLanguage(filePath);
			return json({ content, language, size: stat.size });
		}

		if (type === "download") {
			if (!stat.isFile()) {
				return json({ error: "Not a file" }, 400);
			}
			const mime =
				getImageMime(filePath) || getAudioMime(filePath) || getDocumentMime(filePath) || "application/octet-stream";
			return streamFile(filePath, stat, mime, req.headers.get("range"), true);
		}

		if (type === "meta") {
			if (!stat.isFile()) {
				return json({ error: "Not a file" }, 400);
			}
			const imageMime = getImageMime(filePath);
			const audioMime = getAudioMime(filePath);
			const documentMime = getDocumentMime(filePath);
			return json({
				size: stat.size,
				language: getLanguage(filePath),
				mime: imageMime || audioMime || documentMime || "text/plain",
				previewKind: documentPreviewKind(filePath),
			});
		}

		if (type === "preview") {
			if (!stat.isFile()) {
				return json({ error: "Not a file" }, 400);
			}
			if (getFileExt(filePath) !== "docx") {
				return json({ error: "Preview not available for this file type" }, 400);
			}
			if (stat.size > DOCX_PREVIEW_MAX_BYTES) {
				return json({ error: "DOCX too large for preview (>10MB)" }, 413);
			}

			// The pi-utils converter is the mammoth-compatible implementation the
			// agent already ships; its default image converter inlines `data:` URIs
			// and external relationships are never fetched.
			const result = await convertToHtml({ path: filePath });
			const html = wrapDocxPreviewHtml(result.value, path.basename(filePath));
			return new Response(html, {
				headers: {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-cache",
					"Content-Security-Policy":
						"default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
					"Referrer-Policy": "no-referrer",
					"X-Content-Type-Options": "nosniff",
				},
			});
		}

		if (type === "watch") {
			if (!stat.isFile()) {
				return json({ error: "Not a file" }, 400);
			}
			let watcher: fs.FSWatcher | null = null;
			let lastMtimeMs = stat.mtimeMs;
			let lastSize = stat.size;
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					const send = (eventName: string, data: Record<string, unknown>) => {
						const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
						try {
							controller.enqueue(new TextEncoder().encode(payload));
						} catch {
							// client disconnected
						}
					};
					// Send initial ping so client knows connection is live
					send("connected", { filePath });
					try {
						watcher = fs.watch(filePath, () => {
							try {
								const s = fs.statSync(filePath);
								// Some platforms emit watch events for file reads/attribute
								// access. Ignore those or the client's refresh read loops.
								if (s.mtimeMs === lastMtimeMs && s.size === lastSize) return;
								lastMtimeMs = s.mtimeMs;
								lastSize = s.size;
								send("change", { mtime: s.mtime.toISOString(), size: s.size });
							} catch {
								send("change", { mtime: new Date().toISOString(), size: 0 });
							}
						});
						watcher.on("error", () => {
							try {
								controller.close();
							} catch {
								// already closed
							}
						});
					} catch {
						send("error", { message: "Failed to watch file" });
						controller.close();
					}
				},
				cancel() {
					try {
						watcher?.close();
					} catch {
						// already closed
					}
				},
			});
			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache, no-transform",
					Connection: "keep-alive",
					"X-Accel-Buffering": "no",
				},
			});
		}

		// type === "list"
		if (!stat.isDirectory()) {
			return json({ error: "Not a directory" }, 400);
		}

		// Avoid per-entry stat calls for normal files and directories. Symlinks and
		// filesystems without directory type information use the stat fallback.
		const dirents = fs.readdirSync(filePath, { withFileTypes: true });
		const entries = dirents
			.filter(d => !IGNORED_NAMES.has(d.name) && !IGNORED_SUFFIXES.some(s => d.name.endsWith(s)))
			.flatMap(d => {
				const isDir = resolveDirentIsDirectory(d, path.join(filePath, d.name));
				return isDir === null ? [] : [{ name: d.name, isDir, size: 0, modified: "" }];
			})
			.sort((a, b) => {
				// Dirs first, then files, both alphabetically
				if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
				return a.name.localeCompare(b.name);
			});

		return json({ entries, path: filePath });
	} catch (error) {
		return json({ error: String(error) }, 500);
	}
}

function resolveDirentIsDirectory(dirent: fs.Dirent, fullPath: string): boolean | null {
	if (dirent.isDirectory()) return true;
	if (dirent.isFile()) return false;

	try {
		return fs.statSync(fullPath).isDirectory();
	} catch {
		return null;
	}
}

export async function handleFilesPost(req: Request, segments: string[]): Promise<Response> {
	try {
		const uploadDirectory = await getUploadDirectory(segments);
		if ("response" in uploadDirectory) return uploadDirectory.response;
		const { directory } = uploadDirectory;
		const searchParams = new URL(req.url).searchParams;
		const type = searchParams.get("type") ?? "upload";

		if (type === "upload-check") {
			const body = (await req.json().catch(() => null)) as { fileNames?: unknown } | null;
			const rawFileNames = body?.fileNames;
			if (!Array.isArray(rawFileNames) || !rawFileNames.every((item): item is string => typeof item === "string")) {
				return json({ error: "fileNames must be an array of strings" }, 400);
			}
			const validationError = validateUploadFileNames(rawFileNames);
			if (validationError) {
				return json({ error: validationError }, 400);
			}
			return json(inspectUploadTargets(directory, rawFileNames));
		}

		if (type !== "upload") {
			return json({ error: "Invalid upload request type" }, 400);
		}

		const strategy = parseUploadConflictStrategy(searchParams.get("conflict"));
		if (!strategy) {
			return json({ error: "Invalid conflict strategy" }, 400);
		}

		let formData: MultipartFormData;
		try {
			formData = await parseFormDataWithinLimit(req, MAX_UPLOAD_REQUEST_BYTES);
		} catch (error) {
			if (error instanceof RequestBodyTooLargeError) {
				return json({ error: "Uploads must total 100MB or less" }, 413);
			}
			throw error;
		}
		const files = formData.getAll("files").filter((entry): entry is NodeFile => typeof entry !== "string");
		if (files.some(file => file.size > MAX_UPLOAD_FILE_BYTES)) {
			return json({ error: "Each upload must be 25MB or smaller" }, 413);
		}
		if (files.reduce((total, file) => total + file.size, 0) > MAX_UPLOAD_TOTAL_BYTES) {
			return json({ error: "Uploads must total 100MB or less" }, 413);
		}
		const fileNames = files.map(file => file.name);
		const validationError = validateUploadFileNames(fileNames);
		if (validationError) {
			return json({ error: validationError }, 400);
		}

		const inspection = inspectUploadTargets(directory, fileNames);
		if (strategy === "error" && inspection.conflicts.length > 0) {
			return json(
				{
					error: "One or more files already exist",
					conflicts: inspection.conflicts,
					nonReplaceable: inspection.nonReplaceable,
				},
				409,
			);
		}

		const conflictSet = new Set(inspection.conflicts);
		const nonReplaceableSet = new Set(inspection.nonReplaceable);
		const uploaded: string[] = [];
		const skipped: string[] = [];
		const errors: Array<{ name: string; error: string }> = [];

		for (const file of files) {
			const destination = path.join(directory, file.name);
			// Defense-in-depth containment check: file names are already validated
			// by validateUploadFileNames (no separators, no ".."), but the write
			// target must never escape the allow-listed upload directory even if a
			// future validation change regresses.
			const contained = path.relative(directory, destination);
			if (!contained || contained.startsWith("..") || path.isAbsolute(contained)) {
				errors.push({ name: file.name, error: "Resolved upload target escapes the target directory" });
				continue;
			}
			if (conflictSet.has(file.name) && strategy === "skip") {
				skipped.push(file.name);
				continue;
			}
			if (conflictSet.has(file.name) && nonReplaceableSet.has(file.name)) {
				errors.push({ name: file.name, error: "Cannot replace a directory or symbolic link" });
				continue;
			}

			let bytes: Buffer;
			try {
				bytes = Buffer.from(await file.arrayBuffer());
			} catch (error) {
				errors.push({ name: file.name, error: error instanceof Error ? error.message : String(error) });
				continue;
			}

			if (conflictSet.has(file.name)) {
				try {
					fs.unlinkSync(destination);
				} catch (error) {
					errors.push({ name: file.name, error: error instanceof Error ? error.message : String(error) });
					continue;
				}
			}

			try {
				fs.writeFileSync(destination, bytes, { flag: "wx" });
				uploaded.push(file.name);
			} catch (error) {
				errors.push({ name: file.name, error: error instanceof Error ? error.message : String(error) });
			}
		}

		return json({ uploaded, skipped, errors }, errors.length > 0 ? 207 : 200);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}
