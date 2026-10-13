/**
 * Web Gateway — memory read surface (`list` / `search` / `item`).
 *
 * Five memory backends are selectable per session (`memory.backend`), and their
 * capabilities are wildly asymmetric: `mnemopi` is addressable and searchable,
 * `local` is a set of rewritable markdown files with no structured search,
 * `sharpshooter` is plain-text project decisions, and `hindsight` keeps content
 * server-side with no local addressing at all. This module therefore:
 *
 * 1. Declares a per-backend {@link MemoryCapabilities} matrix in ONE place
 *    (`MEMORY_CAPABILITIES`) and echoes it in every response, so the web-ui can
 *    decide what to render before calling an operation.
 * 2. Returns an explicit `supported: false` + `message` for operations a
 *    backend cannot answer — never an empty success. (Graceful "unavailable"
 *    semantics follow `memory-backend/runtime.ts`: structured payload, never 5xx.)
 * 3. Implements reads only. Writes (PATCH item / POST maintenance) are reserved
 *    routes that answer 501 with the same explicit "unsupported" envelope; the
 *    capability matrix reports `write`/`archive`/`maintenance` as false for every
 *    backend because - today - no backend can be written through this surface.
 *
 * `mnemopi` reads run through the session's own `MnemopiSessionState` (the same
 * accessor `memory://<id>` uses), so an uninitialised backend reports
 * "not initialised" instead of pretending the store is empty.
 */

import type { Dirent, Stats } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir } from "@linxiraos/pi-utils/dirs";
import { getMemoryRoot } from "../../memories";
import { resolveMemoryBackend } from "../../memory-backend/resolve";
import { createSessionMemoryRuntimeContext } from "../../memory-backend/runtime";
import type {
	MemoryBackendId,
	MemoryBackendOperationContext,
	MemoryBackendStatus,
	MemoryRuntimeContext,
} from "../../memory-backend/types";
import { getMnemopiSessionState, type MnemopiMemoryStore } from "../../mnemopi/state";
import type { AgentSession } from "../../session/agent-session";
import { sharpshooterMemoryFilePath } from "../../sharpshooter/paths";
import { SHARPSHOOTER_MEMORY_FILES } from "../../sharpshooter/types";
import { getRpcSession, startRpcSession } from "./agents";
import { resolveSessionPath } from "./sessions";

// ---------------------------------------------------------------------------
// Capability matrix (single source of truth)
// ---------------------------------------------------------------------------

/**
 * What the HTTP read surface can answer on a given backend.
 *
 * `list` / `search` / `item` describe the routes below. `files` marks the
 * backends whose "items" are project files rather than stored memory rows
 * (only `local`). `write` / `archive` / `maintenance` are declared for every
 * backend and are `false` today: the write surface is deliberately reserved
 * (`501`), so a client can trust the flags rather than probe.
 */
export interface MemoryCapabilities {
	list: boolean;
	search: boolean;
	item: boolean;
	files: boolean;
	write: boolean;
	archive: boolean;
	maintenance: boolean;
}

const NO_CAPABILITIES: MemoryCapabilities = {
	list: false,
	search: false,
	item: false,
	files: false,
	write: false,
	archive: false,
	maintenance: false,
};

/**
 * Per-backend read capabilities. Kept in sync with the capability matrix table
 * in `document/web-gateway.md`; `memory.test.ts` asserts both.
 */
export const MEMORY_CAPABILITIES: Record<MemoryBackendId, MemoryCapabilities> = {
	// No backend at all: nothing is listed, searched, or addressed.
	off: NO_CAPABILITIES,
	// Rollout-summary pipeline: `MEMORY.md` / `memory_summary.md` / `learned.md`
	// (+ skills, rollout summaries) on disk. Addressable as files, no search.
	local: { ...NO_CAPABILITIES, list: true, item: true, files: true },
	// Local SQLite recall/retain: live working rows are listable, recall is
	// searchable, and `memory://<id>` addressing resolves through the session.
	mnemopi: { ...NO_CAPABILITIES, list: true, search: true, item: true },
	// Friction-gated project decision files: line-level list + substring search.
	// Lines carry no addressable id (the list already returns whole lines).
	sharpshooter: { ...NO_CAPABILITIES, list: true, search: true },
	// Content lives in the remote Hindsight service; nothing is local, and the
	// runtime exposes no structured status/search for it.
	hindsight: NO_CAPABILITIES,
};

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/** One row of `GET /api/agent/:id/memory` (list). */
export interface MemoryListItem {
	id?: string;
	content: string;
	source?: string;
	timestamp?: string;
	score?: number;
	/** `content` is a preview clipped to {@link LIST_PREVIEW_CHARS}. */
	truncated?: boolean;
	bytes?: number;
	/** Backend-specific item kind: file kind for `local`, store for `mnemopi`. */
	kind?: string;
	store?: MnemopiMemoryStore;
	bank?: string;
}

/** One row of `GET /api/agent/:id/memory/items/:memId` (full content). */
export interface MemoryItem {
	id: string;
	content: string;
	source?: string;
	timestamp?: string;
	importance?: number;
	veracity?: string;
	createdAt?: string;
	store?: MnemopiMemoryStore;
	bank?: string;
	kind?: string;
	bytes?: number;
	metadata?: unknown;
}

const UNSUPPORTED_WRITE_MESSAGE =
	"Memory writes are not implemented in this release: the gateway memory surface is read-only. " +
	"Editing is reserved for a later batch and is currently available only through the agent's memory tools.";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;
const LIST_PREVIEW_CHARS = 400;
const MAX_ITEM_BYTES = 256 * 1024;
const MAX_LOCAL_FILES = 200;
const LOCAL_WALK_DEPTH = 3;

function clampLimit(raw: string | null | undefined, fallback = DEFAULT_LIST_LIMIT): number {
	// An absent/blank `limit` must keep the fallback: `Number(null)` is 0, which
	// would otherwise clamp every unspecified request down to a single item.
	if (raw === null || raw === undefined || raw.trim() === "") return fallback;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(parsed)));
}

// ---------------------------------------------------------------------------
// Session resolution
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

type ResolvedSession = { session: AgentSession } | { response: Response };

/**
 * Live runtime session for a route key, started on demand from its session
 * file exactly like `GET /api/agent/:id/events` does. Memory reads need a real
 * `AgentSession`: backend selection lives in its settings and mnemopi's store
 * is session-scoped.
 */
async function resolveRuntimeSession(sessionId: string): Promise<ResolvedSession> {
	const live = getRpcSession(sessionId);
	if (live?.isAlive()) return { session: live.getSession() };
	const filePath = await resolveSessionPath(sessionId);
	if (!filePath) return { response: json({ error: "Session not found" }, 404) };
	try {
		const { session } = await startRpcSession(sessionId, filePath);
		return { session: session.getSession() };
	} catch (error) {
		return { response: json({ error: `Failed to start agent: ${String(error)}` }, 500) };
	}
}

function operationContext(session: AgentSession): MemoryBackendOperationContext {
	return { agentDir: getAgentDir(), cwd: session.sessionManager.getCwd(), session };
}
// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** `GET /api/agent/:id/memory` — status + capability matrix + item list. */
export async function handleMemoryList(req: Request, sessionId: string): Promise<Response> {
	const resolved = await resolveRuntimeSession(sessionId);
	if ("response" in resolved) return resolved.response;
	const { session } = resolved;
	const context = operationContext(session);
	try {
		const backend = await resolveMemoryBackend(session.settings);
		const capabilities = MEMORY_CAPABILITIES[backend.id];
		const runtime = createSessionMemoryRuntimeContext(session, context.agentDir, context.cwd);
		const status = await safeStatus(runtime, backend.id);
		const limit = clampLimit(new URL(req.url).searchParams.get("limit"));

		if (!capabilities.list) {
			return json({
				backend: backend.id,
				supported: false,
				available: status.active,
				capabilities,
				status,
				count: 0,
				items: [],
				message: listUnsupportedMessage(backend.id),
			});
		}

		const listed = await listItems(backend.id, context, limit);
		return json({
			backend: backend.id,
			supported: true,
			available: listed.available ?? status.active,
			capabilities,
			status,
			count: listed.items.length,
			items: listed.items,
			message: listed.message,
		});
	} catch (error) {
		return json({ error: String(error) }, 500);
	}
}

/** `GET /api/agent/:id/memory/search?q=&limit=` */
export async function handleMemorySearch(req: Request, sessionId: string): Promise<Response> {
	const url = new URL(req.url);
	const query = (url.searchParams.get("q") ?? "").trim();
	if (!query) return json({ error: "Query parameter `q` is required" }, 400);

	const resolved = await resolveRuntimeSession(sessionId);
	if ("response" in resolved) return resolved.response;
	const { session } = resolved;
	const context = operationContext(session);
	try {
		const backend = await resolveMemoryBackend(session.settings);
		const capabilities = MEMORY_CAPABILITIES[backend.id];
		const runtime = createSessionMemoryRuntimeContext(session, context.agentDir, context.cwd);
		const limit = clampLimit(url.searchParams.get("limit"), 10);
		const result = await runtime.search(query, { limit });
		return json({
			backend: result.backend,
			supported: capabilities.search,
			capabilities,
			query,
			count: capabilities.search ? result.count : 0,
			items: capabilities.search ? result.items : [],
			// When the backend cannot search at all, the gateway's own message is
			// the explicit "unsupported" text (and points at the supported path);
			// otherwise the backend's message explains an available-but-empty or
			// not-initialised result.
			message: capabilities.search ? result.message : searchUnsupportedMessage(backend.id),
		});
	} catch (error) {
		return json({ error: String(error) }, 500);
	}
}

/** `GET /api/agent/:id/memory/items/:memId` — full content of one item. */
export async function handleMemoryItem(sessionId: string, rawId: string): Promise<Response> {
	let memId: string;
	try {
		memId = decodeURIComponent(rawId);
	} catch {
		return json({ error: "Malformed memory id" }, 400);
	}

	const resolved = await resolveRuntimeSession(sessionId);
	if ("response" in resolved) return resolved.response;
	const { session } = resolved;
	const context = operationContext(session);
	try {
		const backend = await resolveMemoryBackend(session.settings);
		const capabilities = MEMORY_CAPABILITIES[backend.id];
		if (!capabilities.item) {
			return json({
				backend: backend.id,
				supported: false,
				capabilities,
				item: null,
				message: itemUnsupportedMessage(backend.id),
			});
		}
		const item = await readItem(backend.id, context, memId);
		if (!item) {
			return json(
				{ backend: backend.id, supported: true, capabilities, item: null, error: "Memory item not found" },
				404,
			);
		}
		return json({ backend: backend.id, supported: true, capabilities, item });
	} catch (error) {
		return json({ error: String(error) }, 500);
	}
}

/**
 * Reserved write routes (`PATCH /memory/items/:memId`, `POST /memory`).
 * Answering 501 with the explicit envelope keeps the surface honest until the
 * write batch lands; the capability matrix already reports `write: false`.
 */
export function handleMemoryWrite(method: "PATCH" | "POST"): Response {
	return json(
		{
			error: `${method} is not implemented: the gateway memory surface is read-only in this release.`,
			unsupported: true,
			message: UNSUPPORTED_WRITE_MESSAGE,
		},
		501,
	);
}

// ---------------------------------------------------------------------------
// List implementations
// ---------------------------------------------------------------------------

async function safeStatus(runtime: MemoryRuntimeContext, id: MemoryBackendId): Promise<MemoryBackendStatus> {
	try {
		return await runtime.status();
	} catch (error) {
		return {
			backend: id,
			active: false,
			writable: false,
			searchable: false,
			message: `Memory status unavailable: ${String(error)}`,
		};
	}
}

async function listItems(
	id: MemoryBackendId,
	context: MemoryBackendOperationContext,
	limit: number,
): Promise<{ items: MemoryListItem[]; message?: string; available?: boolean }> {
	switch (id) {
		case "mnemopi":
			return listMnemopi(context, limit);
		case "local":
			return listLocalFiles(context, limit);
		case "sharpshooter":
			return listSharpshooterLines(context, limit);
		default:
			return { items: [], message: listUnsupportedMessage(id) };
	}
}

function listUnsupportedMessage(id: MemoryBackendId): string {
	if (id === "hindsight") {
		return (
			"List is not available for the hindsight backend: memories live in the remote Hindsight service and are not " +
			"addressable locally. Use the agent's `recall` tool to search them."
		);
	}
	if (id === "off") return "Memory backend is off — there is nothing to list.";
	return `Memory list is not available for the ${id} backend.`;
}

function searchUnsupportedMessage(id: MemoryBackendId): string {
	if (id === "hindsight") {
		return (
			"Search is not available for the hindsight backend: recall runs server-side, so use the agent's `recall` tool. " +
			"The gateway cannot search remote memories."
		);
	}
	if (id === "local") {
		return (
			"Search is not available for the local backend: the rollout-summary pipeline keeps markdown files and exposes no " +
			"structured search. List them with `GET /api/agent/:id/memory` instead."
		);
	}
	if (id === "off") return "Memory backend is off — there is nothing to search.";
	return `Memory search is not available for the ${id} backend.`;
}

function itemUnsupportedMessage(id: MemoryBackendId): string {
	if (id === "hindsight") {
		return (
			"Item lookup is not available for the hindsight backend: content lives in the remote service and has no local id. " +
			"Use the agent's `recall` tool."
		);
	}
	if (id === "sharpshooter") {
		return (
			"Item lookup is not available for the sharpshooter backend: decision files are listed line-by-line and those lines " +
			"have no addressable id. Read the listed lines directly."
		);
	}
	if (id === "off") return "Memory backend is off — there is nothing to look up.";
	return `Memory item lookup is not available for the ${id} backend.`;
}

// -- mnemopi ---------------------------------------------------------------

interface MnemopiContextRow {
	id?: unknown;
	content?: unknown;
	source?: unknown;
	timestamp?: unknown;
	importance?: unknown;
	scope?: unknown;
}

/**
 * Live working-memory rows for every bank the session recalls from, newest
 * memories first (`Mnemopi.getContext` filters out invalidated and superseded
 * rows). Episodic rows are not enumerated by the store and surface through
 * search instead.
 */
function listMnemopi(
	context: MemoryBackendOperationContext,
	limit: number,
): { items: MemoryListItem[]; message?: string; available: boolean } {
	const state = getMnemopiSessionState(context.session);
	const primary = state?.aliasOf ?? state;
	if (!primary) {
		return {
			items: [],
			available: false,
			message: "Mnemopi backend is not initialised for this session.",
		};
	}
	const targets = [primary.getScopedRetainTarget(), ...primary.getScopedRecallTargets()];
	const seenBanks = new Set<string>();
	const items: MemoryListItem[] = [];
	const seenIds = new Set<string>();
	for (const target of targets) {
		if (seenBanks.has(target.bank)) continue;
		seenBanks.add(target.bank);
		let rows: unknown[];
		try {
			rows = target.memory.getContext(limit);
		} catch {
			continue;
		}
		for (const raw of rows) {
			const row = raw as MnemopiContextRow;
			const rowId = typeof row.id === "string" ? row.id : undefined;
			if (rowId && seenIds.has(rowId)) continue;
			if (rowId) seenIds.add(rowId);
			const content = typeof row.content === "string" ? row.content : "";
			items.push({
				id: rowId,
				content: content.slice(0, LIST_PREVIEW_CHARS),
				truncated: content.length > LIST_PREVIEW_CHARS,
				bytes: Buffer.byteLength(content, "utf-8"),
				source: typeof row.source === "string" ? row.source : undefined,
				timestamp: typeof row.timestamp === "string" ? row.timestamp : undefined,
				score: typeof row.importance === "number" ? row.importance : undefined,
				store: "working",
				bank: target.bank,
				kind: "working",
			});
			if (items.length >= limit) return { items, available: true };
		}
	}
	return { items, available: true };
}

function readMnemopiItem(context: MemoryBackendOperationContext, id: string): MemoryItem | null {
	const state = getMnemopiSessionState(context.session);
	const primary = state?.aliasOf ?? state;
	if (!primary) return null;
	const hit = primary.getScopedMemory(id);
	if (!hit) return null;
	const { row, bank, store } = hit;
	return {
		id: row.id,
		content: row.content,
		source: row.source ?? undefined,
		timestamp: row.timestamp ?? undefined,
		importance: row.importance ?? undefined,
		veracity: row.veracity ?? undefined,
		createdAt: row.created_at ?? undefined,
		store,
		bank,
		kind: row.memory_type ?? store,
		bytes: Buffer.byteLength(row.content, "utf-8"),
		metadata: row.metadata ?? undefined,
	};
}

// -- local -----------------------------------------------------------------

interface LocalFileEntry {
	id: string;
	absolutePath: string;
	bytes: number;
	mtime: string;
	kind: string;
}

function classifyLocalFile(relativePath: string): string {
	if (relativePath === "MEMORY.md") return "memory";
	if (relativePath === "memory_summary.md") return "summary";
	if (relativePath === "learned.md") return "learned";
	if (relativePath.startsWith("skills/")) return "skill";
	if (relativePath.startsWith("rollout_summaries/")) return "rollout";
	return "other";
}

/**
 * Files under the session's memory root (`getMemoryRoot(agentDir, cwd)`), the
 * same root `memory://root` reads. Read-only: the consolidation pipeline
 * rewrites this tree wholesale, so the gateway never writes to it.
 */
async function collectLocalFiles(root: string): Promise<LocalFileEntry[]> {
	const entries: LocalFileEntry[] = [];
	const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
		if (depth > LOCAL_WALK_DEPTH || entries.length >= MAX_LOCAL_FILES) return;
		let dirents: Dirent[];
		try {
			dirents = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		dirents.sort((a, b) => a.name.localeCompare(b.name));
		for (const dirent of dirents) {
			if (entries.length >= MAX_LOCAL_FILES) return;
			if (dirent.name.startsWith(".") || dirent.name.endsWith(".db") || dirent.name.endsWith(".db-wal")) continue;
			const absolutePath = path.join(dir, dirent.name);
			const relativePath = prefix ? `${prefix}/${dirent.name}` : dirent.name;
			if (dirent.isDirectory()) {
				await walk(absolutePath, relativePath, depth + 1);
				continue;
			}
			if (!dirent.isFile()) continue;
			try {
				const stat = await fs.stat(absolutePath);
				if (!stat.isFile() || stat.size === 0) continue;
				entries.push({
					id: relativePath,
					absolutePath,
					bytes: stat.size,
					mtime: stat.mtime.toISOString(),
					kind: classifyLocalFile(relativePath),
				});
			} catch {
				continue;
			}
		}
	};
	await walk(root, "", 1);
	return entries;
}

async function listLocalFiles(
	context: MemoryBackendOperationContext,
	limit: number,
): Promise<{ items: MemoryListItem[]; message?: string; available?: boolean }> {
	const root = getMemoryRoot(context.agentDir, context.cwd);
	const files = await collectLocalFiles(root);
	if (files.length === 0) {
		return {
			items: [],
			message: `No memory files under ${root} yet. Run a session with the local memory backend to produce them.`,
		};
	}
	const items: MemoryListItem[] = [];
	for (const file of files.slice(0, limit)) {
		const preview = await readTextFileCapped(file.absolutePath, LIST_PREVIEW_CHARS * 4);
		const content = preview.text;
		items.push({
			id: file.id,
			content: content.slice(0, LIST_PREVIEW_CHARS),
			truncated: content.length > LIST_PREVIEW_CHARS || preview.truncated,
			bytes: file.bytes,
			source: file.id,
			timestamp: file.mtime,
			kind: file.kind,
		});
	}
	return { items };
}

async function readLocalItem(context: MemoryBackendOperationContext, id: string): Promise<MemoryItem | null> {
	const root = path.resolve(getMemoryRoot(context.agentDir, context.cwd));
	if (id.includes("\0")) return null;
	const absolutePath = path.resolve(root, id);
	const relative = path.relative(root, absolutePath);
	if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
	let stat: Stats;
	try {
		stat = await fs.stat(absolutePath);
	} catch {
		return null;
	}
	if (!stat.isFile()) return null;
	const { text, truncated } = await readTextFileCapped(absolutePath, MAX_ITEM_BYTES);
	return {
		id: relative.split(path.sep).join("/"),
		content: text,
		bytes: stat.size,
		source: relative.split(path.sep).join("/"),
		timestamp: stat.mtime.toISOString(),
		kind: classifyLocalFile(relative.split(path.sep).join("/")),
		metadata: truncated ? { truncated: true, maxBytes: MAX_ITEM_BYTES } : undefined,
	};
}

async function readTextFileCapped(
	absolutePath: string,
	maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
	let handle: fs.FileHandle | undefined;
	try {
		handle = await fs.open(absolutePath, "r");
		const buffer = Buffer.alloc(maxBytes);
		const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
		const truncated = bytesRead === maxBytes;
		return { text: buffer.subarray(0, bytesRead).toString("utf-8"), truncated };
	} catch {
		return { text: "", truncated: false };
	} finally {
		await handle?.close().catch(() => {});
	}
}

// -- sharpshooter ----------------------------------------------------------

async function listSharpshooterLines(
	context: MemoryBackendOperationContext,
	limit: number,
): Promise<{ items: MemoryListItem[]; message?: string; available?: boolean }> {
	const items: MemoryListItem[] = [];
	for (const name of SHARPSHOOTER_MEMORY_FILES) {
		const absolutePath = sharpshooterMemoryFilePath(context.agentDir, context.cwd, name);
		let content: string;
		let mtime: string | undefined;
		try {
			content = await fs.readFile(absolutePath, "utf-8");
			mtime = (await fs.stat(absolutePath)).mtime.toISOString();
		} catch {
			continue;
		}
		const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
		for (let index = 0; index < lines.length; index++) {
			items.push({
				id: `${name}#${index}`,
				content: lines[index].slice(0, LIST_PREVIEW_CHARS),
				source: name,
				timestamp: mtime,
				kind: "decision",
			});
			if (items.length >= limit) return { items };
		}
	}
	if (items.length === 0) {
		return {
			items: [],
			message:
				"No sharpshooter decision lines yet. Project decisions are consolidated into " +
				`${SHARPSHOOTER_MEMORY_FILES.join(", ")} after extraction runs.`,
		};
	}
	return { items };
}

// ---------------------------------------------------------------------------
// Item dispatch
// ---------------------------------------------------------------------------

async function readItem(
	id: MemoryBackendId,
	context: MemoryBackendOperationContext,
	memId: string,
): Promise<MemoryItem | null> {
	switch (id) {
		case "mnemopi":
			return readMnemopiItem(context, memId);
		case "local":
			return readLocalItem(context, memId);
		default:
			return null;
	}
}
