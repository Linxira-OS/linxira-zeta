/**
 * Web Gateway — session browsing/mutation handlers.
 *
 * Serves the session read family that the legacy web-ui server provided
 * in-process (list, get, rename, delete, context, state, thinking, export).
 * Read paths use `SessionManager.open` with breadcrumbs suppressed; the
 * single-writer lock is held only briefly per request.
 *
 * DTO contract mirrors `web-ui/lib/types.ts` byte-compatibly.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
// Upstream v18.0.9 deleted src/utils/git.ts — worktree operations now go
// through the pi-vcs native addon (crates/pi-vcs, exposed via pi-natives/vcs).
import * as vcs from "@linxiraos/pi-natives/vcs";
import { getBlobsDir, logger } from "@linxiraos/pi-utils";
import { parseModelString } from "@linxiraos/pi-tui/overlays/model-selector";
import { type BotSessionEntry, WebConfig } from "../../config/web-config";
import { exportFromFile } from "../../export/html";
import type { SessionEntry as RuntimeSessionEntry } from "../../session/session-entries";
import { listAllSessions as listRuntimeSessions } from "../../session/session-listing";
import { normalizeImMessageMetadata, normalizeImSwitchControlMetadata } from "../../session/session-im";
import { parseSessionContent } from "../../session/session-loader";
import { SessionManager } from "../../session/session-manager";
import { BLOB_EXTERNALIZE_THRESHOLD } from "../../session/session-persistence";
import { deleteSessionFiles } from "../../session/session-delete";
import { serializeTitleSlot } from "../../session/session-title-slot";
import { getRpcSession } from "./agents";
import { invalidateProjectCache, type ProjectInfo, resolveProject } from "./projects";
import { getRunningSessionIds, notifyBotSessionDeleted, removeRunningSession } from "./running-sessions";
import type {
	AgentMessage,
	CompactionEntry,
	SessionContext,
	SessionEntry,
	SessionHeader,
	SessionInfo,
	SessionTreeNode,
} from "./types";

const SESSION_LIST_CACHE_TTL_MS = 30_000;
const MAX_PROJECTED_TREE_DEPTH = 200;

// ---------------------------------------------------------------------------
// Session path caches (module-level: the gateway is a long-lived Bun process)
// ---------------------------------------------------------------------------

let sessionListGeneration = 0;
let sessionListCache: { data: SessionInfo[]; ts: number } | null = null;
let sessionListPromise: Promise<SessionInfo[]> | null = null;
let sessionListPromiseGeneration = -1;

const pathCache = new Map<string, string>();
const pathToIdCache = new Map<string, string>();

export function sessionPathKey(filePath: string): string {
	const normalized = process.platform === "win32" ? path.win32.normalize(filePath) : path.posix.normalize(filePath);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Serialized `GET /api/sessions/:id` bodies, keyed by file path and validated
 * by (mtime, size).
 *
 * Every open or switch re-read the whole JSONL, rebuilt the context + tree and
 * re-serialized the response; a 21.6 MiB session costs ~98 MiB of transient
 * heap per read. The renderer keeps only the active conversation mounted, so
 * switching back and forth is exactly the repeated-read case this removes.
 * Live sessions never enter the cache (their owner appends), and write paths
 * clear it. Bounded by count and bytes so a long session cannot pin the heap.
 */
type SessionResponseCacheEntry = { readonly mtimeMs: number; readonly size: number; readonly body: string };
const SESSION_RESPONSE_CACHE_MAX_ENTRIES = 8;
const SESSION_RESPONSE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
/** One response this large must not evict the whole window it belongs to. */
const SESSION_RESPONSE_CACHE_MAX_ENTRY_BYTES = SESSION_RESPONSE_CACHE_MAX_BYTES / 2;
const sessionResponseCache = new Map<string, SessionResponseCacheEntry>();
let sessionResponseCacheBytes = 0;

export function invalidateSessionResponseCache(filePath?: string): void {
	if (filePath === undefined) {
		sessionResponseCache.clear();
		sessionResponseCacheBytes = 0;
		return;
	}
	const key = sessionPathKey(filePath);
	const hit = sessionResponseCache.get(key);
	if (hit !== undefined) {
		sessionResponseCacheBytes -= Buffer.byteLength(hit.body, "utf8");
		sessionResponseCache.delete(key);
	}
}

export function invalidateSessionListCache(): void {
	sessionListGeneration += 1;
	sessionListCache = null;
	invalidateSessionResponseCache();
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
	const normalized = path.normalize(filePath);
	const key = sessionPathKey(normalized);
	const previousPath = pathCache.get(sessionId);
	const previousPathKey = previousPath ? sessionPathKey(previousPath) : undefined;
	const previousSessionId = pathToIdCache.get(key);
	const previousOwnerPath = previousSessionId ? pathCache.get(previousSessionId) : undefined;
	if (previousPathKey && previousPathKey !== key && pathToIdCache.get(previousPathKey) === sessionId) {
		pathToIdCache.delete(previousPathKey);
	}
	if (
		previousSessionId &&
		previousSessionId !== sessionId &&
		previousOwnerPath &&
		sessionPathKey(previousOwnerPath) === key
	) {
		pathCache.delete(previousSessionId);
	}
	pathCache.set(sessionId, normalized);
	pathToIdCache.set(key, sessionId);
}

function invalidateSessionPathCache(sessionId: string): void {
	const filePath = pathCache.get(sessionId);
	pathCache.delete(sessionId);
	const key = filePath ? sessionPathKey(filePath) : undefined;
	if (key && pathToIdCache.get(key) === sessionId) {
		pathToIdCache.delete(key);
	}
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
	const cached = pathCache.get(sessionId);
	if (cached) return cached;
	await listAllSessionsWeb();
	return pathCache.get(sessionId) ?? null;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
	const key = sessionPathKey(filePath);
	const cached = pathToIdCache.get(key);
	if (cached) return cached;
	await listAllSessionsWeb();
	return pathToIdCache.get(key);
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export async function listAllSessionsWeb(): Promise<SessionInfo[]> {
	const generation = sessionListGeneration;

	if (sessionListCache && Date.now() - sessionListCache.ts < SESSION_LIST_CACHE_TTL_MS) {
		return sessionListCache.data;
	}

	if (sessionListPromise && sessionListPromiseGeneration === generation) {
		return sessionListPromise;
	}

	const loadPromise = loadAllSessions().then(data => {
		if (sessionListGeneration === generation) {
			sessionListCache = { data, ts: Date.now() };
		}
		return data;
	});
	const tracked = loadPromise.finally(() => {
		if (sessionListPromise === tracked) {
			sessionListPromise = null;
			sessionListPromiseGeneration = -1;
		}
	});

	sessionListPromise = tracked;
	sessionListPromiseGeneration = generation;
	return tracked;
}

/** True when `cwd` sits inside the OS temp dir (scratch sessions, eval harnesses). */
function isTempCwd(cwd: string): boolean {
	const rel = path.relative(os.tmpdir(), cwd);
	// Empty relative path means cwd *is* the tmpdir root — not "inside" it.
	if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return false;
	return true;
}

async function loadAllSessions(): Promise<SessionInfo[]> {
	// The runtime listing scans the full agent sessions dir (title-slot aware)
	// with an mtime/size memoized cache, so no extra fallback scan is needed.
	const runtimeSessions = await listRuntimeSessions();

	const pathToId = new Map<string, string>();
	for (const s of runtimeSessions) {
		pathToId.set(sessionPathKey(s.path), s.id);
	}

	// Default-space bot sessions (relay/bot/draft) carry a tag and an origin so
	// the web UI can keep them out of personal lists; other sessions have neither.
	const webConfig = await WebConfig.load();
	const botByPath = new Map<string, BotSessionEntry>();
	for (const entry of webConfig.getBotSessions()) {
		botByPath.set(sessionPathKey(entry.sessionFile), entry);
	}

	const uniqueCwds = [...new Set(runtimeSessions.map(s => s.cwd).filter(Boolean))];
	const projectByCwd = new Map<string, ProjectInfo>();
	await Promise.all(
		uniqueCwds.map(async cwd => {
			projectByCwd.set(cwd, await resolveProject(cwd));
		}),
	);

	return runtimeSessions.map(s => {
		cacheSessionPath(s.id, s.path);
		const project = s.cwd ? projectByCwd.get(s.cwd) : undefined;
		const botEntry = botByPath.get(sessionPathKey(s.path));
		const tag = botEntry?.tag;
		// The header stamp is authoritative; a transcript written before it
		// existed still reads as IM through its web.yml registry entry.
		const origin =
			s.origin ??
			(botEntry
				? {
						kind: "im" as const,
						botSessionId: botEntry.id,
						...(botEntry.platform ? { channel: botEntry.platform } : {}),
						...(botEntry.chatId ? { chatId: botEntry.chatId } : {}),
						...(botEntry.workspaceAlias ? { workspaceAlias: botEntry.workspaceAlias } : {}),
					}
				: undefined);
		return {
			path: s.path,
			id: s.id,
			cwd: s.cwd,
			name: s.title,
			created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
			modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
			messageCount: s.messageCount,
			firstMessage: s.firstMessage || "(no messages)",
			parentSessionId: s.parentSessionPath ? pathToId.get(sessionPathKey(s.parentSessionPath)) : undefined,
			projectRoot: project?.projectRoot ?? s.cwd,
			// The branch recorded when the session was created wins: after a
			// `git checkout` the cwd's current branch is no longer the one this
			// transcript belongs to. Legacy sessions fall back to the project's.
			...((s.branch ?? project?.branch) ? { branch: s.branch ?? project?.branch ?? undefined } : {}),
			...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
			...(tag ? { tag } : {}),
			...(origin ? { origin } : {}),
			...(s.client ? { client: s.client } : {}),
			...(s.runClient ? { runClient: s.runClient } : {}),
			...(s.cwd && isTempCwd(s.cwd) ? { temp: true } : {}),
		} satisfies SessionInfo;
	});
}

// ---------------------------------------------------------------------------
// Context building (semantic port of pi-web buildContextEntries)
// ---------------------------------------------------------------------------

function buildSessionPath(
	entries: SessionEntry[],
	leafId: string | null | undefined,
	byId: Map<string, SessionEntry>,
): SessionEntry[] {
	if (leafId === null) return [];
	const leaf = leafId ? byId.get(leafId) : undefined;
	const start = leaf ?? entries[entries.length - 1];
	if (!start) return [];

	const walk: SessionEntry[] = [];
	let current: SessionEntry | undefined = start;
	const seen = new Set<string>();
	while (current && !seen.has(current.id)) {
		seen.add(current.id);
		walk.push(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	walk.reverse();
	return walk;
}

/** Compaction-aware active entry list: latest compaction entry, then kept entries. */
function buildContextEntries(pathEntries: SessionEntry[]): SessionEntry[] {
	let compaction: CompactionEntry | null = null;
	for (const entry of pathEntries) {
		if (entry.type === "compaction") compaction = entry;
	}
	if (!compaction) return pathEntries;

	const compactionIdx = pathEntries.findIndex(entry => entry.id === compaction.id);
	if (compactionIdx < 0) return pathEntries;

	const contextEntries: SessionEntry[] = [compaction];
	let foundFirstKept = false;
	for (let i = 0; i < compactionIdx; i++) {
		const entry = pathEntries[i];
		if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
		if (foundFirstKept) contextEntries.push(entry);
	}
	contextEntries.push(...pathEntries.slice(compactionIdx + 1));
	return contextEntries;
}

function sessionSettingsFromPath(pathEntries: SessionEntry[]): {
	thinkingLevel: string;
	model: { provider: string; modelId: string } | null;
} {
	let thinkingLevel = "off";
	let model: { provider: string; modelId: string } | null = null;
	// An explicit default `model_change` wins over model tags on later assistant
	// messages: retry fallbacks and server-side downgrades tag those messages
	// with the wrong id (issue #849).
	let hasExplicitDefaultModel = false;

	for (const entry of pathEntries) {
		if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.thinkingLevel;
		} else if (entry.type === "model_change") {
			// Runtime `model_change` entries store "provider/modelId" in `model`
			// (see session-entries.ts), and `role: "default"` marks the user's
			// pick; fallback/model-role transitions must not become the settings
			// snapshot. The legacy provider/modelId pair is still read for older
			// transcripts.
			const role = (entry as unknown as { role?: unknown }).role;
			if (role === undefined || role === "default") {
				const runtimeModel = (entry as unknown as { model?: unknown }).model;
				if (typeof runtimeModel === "string" && runtimeModel.length > 0) {
					const parsed = parseModelString(runtimeModel);
					if (parsed) {
						model = { provider: parsed.provider, modelId: parsed.id };
						hasExplicitDefaultModel = true;
					}
				} else {
					const legacy = entry as unknown as { provider?: unknown; modelId?: unknown };
					if (typeof legacy.provider === "string" && typeof legacy.modelId === "string") {
						model = { provider: legacy.provider, modelId: legacy.modelId };
						hasExplicitDefaultModel = true;
					}
				}
			}
		} else if (entry.type === "message" && entry.message.role === "assistant" && !hasExplicitDefaultModel) {
			model = { provider: entry.message.provider, modelId: entry.message.model };
		}
	}

	return { thinkingLevel, model };
}

function parseEntryTimestamp(timestamp: string): number | undefined {
	const parsed = Date.parse(timestamp);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isObject(val: unknown): val is Record<string, unknown> {
	return typeof val === "object" && val !== null && !Array.isArray(val);
}

function normalizeToolCalls(msg: AgentMessage): AgentMessage {
	if (msg.role !== "assistant") return msg;
	const content = msg.content;
	if (!Array.isArray(content)) return msg;
	const normalized = content.map(block => {
		if (!isObject(block) || block.type !== "toolCall") return block;
		return {
			type: "toolCall" as const,
			toolCallId:
				typeof block.toolCallId === "string" ? block.toolCallId : typeof block.id === "string" ? block.id : "",
			toolName:
				typeof block.toolName === "string" ? block.toolName : typeof block.name === "string" ? block.name : "",
			input:
				typeof block.input === "object" && block.input !== null && !Array.isArray(block.input)
					? (block.input as Record<string, unknown>)
					: typeof block.arguments === "object" && block.arguments !== null && !Array.isArray(block.arguments)
						? (block.arguments as Record<string, unknown>)
						: {},
		};
	});
	return { ...msg, content: normalized };
}

/** Inline base64 payload of an image block, whichever of the two shapes it uses. */
function inlineImagePayload(block: unknown): { data: string; mime?: string } | null {
	if (!isRecord(block) || block.type !== "image") return null;

	if (typeof block.data === "string" && block.data !== "") {
		return { data: block.data, mime: typeof block.mimeType === "string" ? block.mimeType : undefined };
	}
	if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
		return {
			data: block.source.data,
			mime: typeof block.source.media_type === "string" ? block.source.media_type : undefined,
		};
	}
	return null;
}

/**
 * `deferMedia` history loads have to stay small, but dropping the images meant
 * the web conversation could never show an agent screenshot. Persistence already
 * externalizes any payload of at least {@link BLOB_EXTERNALIZE_THRESHOLD}
 * characters into the content-addressed blob store, so the block is pointed at
 * `GET /api/blobs/<sha256>` — the same bytes, fetched on demand — instead of the
 * base64 it carried. Payloads below the threshold, and any whose blob is not on
 * disk, stay inline: an `<img>` at a 404 is worse than a small inline payload.
 */
function deferToolResultImages(message: AgentMessage): AgentMessage {
	if (message.role !== "toolResult") return message;

	let rewritten = 0;
	const content = message.content.map(block => {
		const image = inlineImagePayload(block);
		if (!image || image.data.length < BLOB_EXTERNALIZE_THRESHOLD) return block;
		const hash = new Bun.SHA256().update(Buffer.from(image.data, "base64")).digest("hex");
		if (!fs.existsSync(path.join(getBlobsDir(), hash))) return block;
		rewritten += 1;
		return {
			type: "image",
			source: {
				type: "url",
				url: `/api/blobs/${hash}`,
				...(image.mime ? { media_type: image.mime } : {}),
			},
		};
	});
	if (rewritten === 0) return message;
	return { ...message, content } as unknown as AgentMessage;
}

/** Convert a session entry on the active branch into a UI message. */
function entryToUiMessage(
	entry: SessionEntry,
	options: { deferThinking?: boolean; deferToolResultImages?: boolean },
): AgentMessage | null {
	switch (entry.type) {
		case "message": {
			const message = options.deferToolResultImages
				? deferToolResultImages(normalizeToolCalls(entry.message))
				: normalizeToolCalls(entry.message);
			if (!options.deferThinking || message.role !== "assistant") return message;
			return {
				...message,
				content: message.content.map(block =>
					block.type === "thinking" && block.thinking.trim() !== ""
						? { ...block, thinking: "", deferred: true }
						: block,
				),
			};
		}
		case "compaction":
			return {
				role: "custom",
				customType: "compaction",
				content: entry.summary,
				display: true,
				details: {
					tokensBefore: entry.tokensBefore,
					firstKeptEntryId: entry.firstKeptEntryId,
				},
				timestamp: parseEntryTimestamp(entry.timestamp),
			};
		case "branch_summary":
			if (!entry.summary) return null;
			return {
				role: "user",
				content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
				timestamp: parseEntryTimestamp(entry.timestamp),
			};
		case "custom_message":
			return {
				role: "custom",
				customType: entry.customType,
				content: entry.content,
				display: entry.display,
				details: entry.details,
				timestamp: parseEntryTimestamp(entry.timestamp),
			};
		default:
			return null;
	}
}

interface SessionBranch {
	readonly contextEntries: readonly SessionEntry[];
	readonly thinkingLevel: string;
	readonly model: { provider: string; modelId: string } | null;
}

/** Active branch of the transcript, before any windowing. */
function sessionBranch(entries: RuntimeSessionEntry[], leafId: string | null | undefined): SessionBranch {
	const webEntries = entries as unknown as SessionEntry[];
	const byId = new Map<string, SessionEntry>();
	for (const entry of webEntries) byId.set(entry.id, entry);
	const pathEntries = buildSessionPath(webEntries, leafId, byId);
	const contextEntries = buildContextEntries(pathEntries);
	const { thinkingLevel, model } = sessionSettingsFromPath(pathEntries);
	return { contextEntries, thinkingLevel, model };
}

function projectContextWindow(
	branch: SessionBranch,
	options: { deferThinking?: boolean; deferToolResultImages?: boolean },
	start: number,
	end: number,
): SessionContext {
	const messages: AgentMessage[] = [];
	const entryIds: string[] = [];
	const messageMetadata: (ReturnType<typeof normalizeImMessageMetadata> | null)[] = [];
	const controlEvents: NonNullable<SessionContext["controlEvents"]> = [];
	for (let index = start; index < end; index += 1) {
		const entry = branch.contextEntries[index];
		if (entry === undefined) continue;
		if (entry.type === "im_control") {
			const metadata = normalizeImSwitchControlMetadata(entry.metadata);
			if (metadata) controlEvents.push({ entryId: entry.id, metadata });
			continue;
		}
		const message = entryToUiMessage(entry, options);
		if (message) {
			messages.push(message);
			entryIds.push(entry.id);
			messageMetadata.push(entry.type === "message" ? (normalizeImMessageMetadata(entry.metadata) ?? null) : null);
		}
	}
	return {
		messages,
		entryIds,
		thinkingLevel: branch.thinkingLevel,
		model: branch.model,
		...(messageMetadata.some(metadata => metadata !== null) ? { messageMetadata } : {}),
		...(controlEvents.length > 0 ? { controlEvents } : {}),
	};
}

/**
 * `info.messageCount` / `info.firstMessage` for a windowed read: the projection
 * itself only runs over the returned slice, so these derive from entry types —
 * the same predicate `entryToUiMessage` uses to drop a record.
 */
function summarizeBranch(branch: SessionBranch): { messageCount: number; firstMessage: string } {
	let count = 0;
	let firstMessage = "";
	for (const entry of branch.contextEntries) {
		const producesMessage =
			entry.type === "message" ||
			entry.type === "compaction" ||
			(entry.type === "branch_summary" && Boolean(entry.summary)) ||
			entry.type === "custom_message";
		if (!producesMessage) continue;
		count += 1;
		if (firstMessage === "" && entry.type === "message" && entry.message.role === "user") {
			const message = entryToUiMessage(entry, {});
			if (message) firstMessage = firstUserMessageText([message]);
		}
	}
	return { messageCount: count, firstMessage };
}

export function buildWebSessionContext(
	entries: RuntimeSessionEntry[],
	leafId: string | null | undefined,
	options: { deferThinking?: boolean; deferToolResultImages?: boolean } = {},
): SessionContext {
	const branch = sessionBranch(entries, leafId);
	return projectContextWindow(branch, options, 0, branch.contextEntries.length);
}

// ---------------------------------------------------------------------------
// Session manager helpers
// ---------------------------------------------------------------------------

async function openSessionManager(filePath: string): Promise<SessionManager> {
	return SessionManager.open(filePath, undefined, undefined, { suppressBreadcrumb: true });
}

/**
 * The manager that already owns a live session, when there is one.
 *
 * `SessionManager.open` claims the file for writing; opening a second manager
 * over a live session therefore makes the live writer fork to a new file on
 * its next append ("open for writing in another zeta process"). Read paths that
 * only need entries/tree/name must reuse the owner instead.
 */
function liveSessionManager(sessionId: string): SessionManager | undefined {
	const wrapper = getRpcSession(sessionId);
	return wrapper?.isAlive() ? wrapper.getSession().sessionManager : undefined;
}

/** Read the session header without opening the manager (no lock). */
export function readSessionHeader(filePath: string): SessionHeader | null {
	try {
		const content = fs.readFileSync(filePath, "utf8");
		const { entries } = parseSessionContent(content);
		const header = entries.find(e => e.type === "session") as SessionHeader | undefined;
		return header ?? null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Tree projection (port of web-ui projectTreeForResponse)
// ---------------------------------------------------------------------------

function projectTreeForResponse<T extends { entry: { id: string }; children: T[]; compressedEntryIds?: string[] }>(
	nodes: T[],
): T[] {
	const keep = new Set<T>();
	const roots = new Set(nodes);
	const seen = new Set<T>();
	const stack = [...nodes];

	while (stack.length > 0) {
		const node = stack.pop()!;
		if (seen.has(node)) continue;
		seen.add(node);

		if (roots.has(node) || node.children.length !== 1) {
			keep.add(node);
		}

		for (const child of node.children) {
			stack.push(child);
		}
	}

	const cloneNode = (node: T, compressedEntryIds?: string[]): T => ({
		...node,
		children: [],
		...(compressedEntryIds?.length ? { compressedEntryIds } : {}),
	});
	const projectedRoots = nodes.map(node => cloneNode(node));
	const tasks = nodes.map((source, index) => ({
		source,
		projected: projectedRoots[index],
		depth: 1,
	}));

	const appendFlattenedKeptDescendants = (source: T, projectedParent: T) => {
		const pending = [{ node: source, compressedEntryIds: [] as string[] }];
		const flattenedSeen = new Set<T>();

		while (pending.length > 0) {
			const { node, compressedEntryIds } = pending.pop()!;
			if (flattenedSeen.has(node)) continue;
			flattenedSeen.add(node);

			if (keep.has(node)) {
				projectedParent.children.push(cloneNode(node, compressedEntryIds));
			}

			for (let i = node.children.length - 1; i >= 0; i--) {
				pending.push({
					node: node.children[i],
					compressedEntryIds: keep.has(node) ? [] : [...compressedEntryIds, node.entry.id],
				});
			}
		}
	};

	while (tasks.length > 0) {
		const { source, projected, depth } = tasks.pop()!;

		for (const sourceChild of source.children) {
			let child = sourceChild;

			if (depth >= MAX_PROJECTED_TREE_DEPTH) {
				appendFlattenedKeptDescendants(child, projected);
				continue;
			}

			const compressedEntryIds: string[] = [];
			while (!keep.has(child) && child.children.length === 1) {
				compressedEntryIds.push(child.entry.id);
				child = child.children[0];
			}

			if (!keep.has(child)) {
				continue;
			}

			const projectedChild = cloneNode(child, compressedEntryIds);
			projected.children.push(projectedChild);
			tasks.push({ source: child, projected: projectedChild, depth: depth + 1 });
		}
	}

	return projectedRoots;
}

function firstUserMessageText(messages: AgentMessage[]): string {
	const msg = messages.find(m => m.role === "user");
	if (!msg) return "(no messages)";
	const content = msg.content;
	if (typeof content === "string") return content || "(no messages)";
	if (Array.isArray(content)) {
		const text = (content.find(b => b.type === "text") as { text: string } | undefined)?.text ?? "";
		return text || "(no messages)";
	}
	return "(no messages)";
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

/** Windowed reads: the bounds the host's `ConversationTranscriptPage` already enforces. */
const SESSION_WINDOW_LIMIT_MIN = 1;
const SESSION_WINDOW_LIMIT_MAX = 100;
const SESSION_WINDOW_LIMIT_DEFAULT = 50;
/** Serialized `messages` + `entryIds` cap for one page. */
const SESSION_WINDOW_MAX_BYTES = 768 * 1024;

function windowError(message: string, code: string, status = 400): Response {
	return json({ error: message, code }, status);
}

/** Informational: `mtimeMs:size:leafId`, changes on every append. */
function transcriptRevision(filePath: string, leafId: string | null): string {
	const stat = statSessionFile(filePath);
	return `${stat?.mtimeMs ?? 0}:${stat?.size ?? 0}:${leafId ?? "empty"}`;
}

function windowedMessageBytes(context: SessionContext): number {
	return Buffer.byteLength(JSON.stringify({ messages: context.messages, entryIds: context.entryIds }), "utf8");
}

export async function handleListSessions(): Promise<Response> {
	try {
		const sessions = await listAllSessionsWeb();
		return json({ sessions, runningSessionIds: getRunningSessionIds() });
	} catch (error) {
		logger.error("web-gateway: list sessions failed", { error: String(error) });
		return json({ error: String(error) }, 500);
	}
}

function statSessionFile(filePath: string): { readonly mtimeMs: number; readonly size: number } | undefined {
	try {
		const stat = fs.statSync(filePath);
		return { mtimeMs: stat.mtimeMs, size: stat.size };
	} catch {
		return undefined;
	}
}

function cachedSessionResponse(filePath: string, stamp: { mtimeMs: number; size: number }): string | undefined {
	const key = sessionPathKey(filePath);
	const hit = sessionResponseCache.get(key);
	if (hit === undefined || hit.mtimeMs !== stamp.mtimeMs || hit.size !== stamp.size) return undefined;
	// LRU touch: the conversation the user keeps coming back to survives eviction.
	sessionResponseCache.delete(key);
	sessionResponseCache.set(key, hit);
	return hit.body;
}

function rememberSessionResponse(filePath: string, stamp: { mtimeMs: number; size: number }, body: string): void {
	const bytes = Buffer.byteLength(body, "utf8");
	if (bytes > SESSION_RESPONSE_CACHE_MAX_ENTRY_BYTES) return;
	const key = sessionPathKey(filePath);
	invalidateSessionResponseCache(filePath);
	while (
		sessionResponseCache.size >= SESSION_RESPONSE_CACHE_MAX_ENTRIES ||
		sessionResponseCacheBytes + bytes > SESSION_RESPONSE_CACHE_MAX_BYTES
	) {
		const oldest = sessionResponseCache.entries().next().value;
		if (oldest === undefined) break;
		sessionResponseCache.delete(oldest[0]);
		sessionResponseCacheBytes -= Buffer.byteLength(oldest[1].body, "utf8");
	}
	sessionResponseCache.set(key, { ...stamp, body });
	sessionResponseCacheBytes += bytes;
}

/** A pre-serialized JSON body; `Response.json` would re-serialize a cached string. */
function cachedJson(body: string): Response {
	return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}

export async function handleGetSession(req: Request, sessionId: string): Promise<Response> {
	try {
		const filePath = await resolveSessionPath(sessionId);
		if (!filePath) {
			return json({ error: "Session not found" }, 404);
		}

		const live = liveSessionManager(sessionId);
		const url = new URL(req.url);
		const searchParams = url.searchParams;
		const deferThinking = searchParams.has("deferThinking");
		const deferToolResultImages = searchParams.has("deferMedia");
		const projection = { deferThinking, deferToolResultImages };
		const windowParam = searchParams.get("window");
		const limitParam = searchParams.get("limit");
		const originParam = searchParams.get("origin");
		const windowed = windowParam !== null || limitParam !== null;

		// The legacy whole-transcript answer is cached (#238); a window is cheap
		// by construction and keyed by a different shape, so it is not cached.
		const liveStamp = live === undefined && !windowed ? statSessionFile(filePath) : undefined;
		if (liveStamp !== undefined) {
			const cached = cachedSessionResponse(filePath, liveStamp);
			if (cached !== undefined) return cachedJson(cached);
		}

		const sm = live ?? (await openSessionManager(filePath));
		const entries = sm.getEntries();
		const leafId = sm.getLeafId();

		// Windowed read (`?window=tail|<int>&limit=<n>&revision=<rev>`): one page
		// of the active branch instead of all of it. `tree` is omitted here on
		// purpose — the branch view has its own route (`/state`).
		if (windowed) {
			let limit = SESSION_WINDOW_LIMIT_DEFAULT;
			if (limitParam !== null) {
				const parsed = Number(limitParam);
				if (!Number.isInteger(parsed) || parsed < SESSION_WINDOW_LIMIT_MIN || parsed > SESSION_WINDOW_LIMIT_MAX) {
					return windowError(
						`limit must be an integer ${SESSION_WINDOW_LIMIT_MIN}..${SESSION_WINDOW_LIMIT_MAX}`,
						"invalid-limit",
					);
				}
				limit = parsed;
			}
			const branch = sessionBranch(entries, leafId);
			// A cursor names the entry its window boundary addressed. Appending keeps
			// that entry where it was; compaction and branch switches move it, which
			// is exactly when the boundary would address different messages.
			const boundary = windowParam !== null && windowParam !== "tail" ? Number(windowParam) : undefined;
			if (originParam !== null && boundary !== undefined && branch.contextEntries[boundary]?.id !== originParam) {
				return windowError("cursor refers to a different transcript position", "cursor-stale", 409);
			}
			const total = branch.contextEntries.length;
			let end = total;
			if (windowParam !== null && windowParam !== "tail") {
				const parsed = Number(windowParam);
				if (!Number.isInteger(parsed) || parsed < 0)
					return windowError('window must be "tail" or a non-negative integer', "invalid-window");
				if (parsed > total) return windowError("window is past the transcript head", "cursor-stale", 409);
				end = parsed;
			}
			let start = Math.max(0, end - limit);
			let context = projectContextWindow(branch, projection, start, end);
			while (start < end - 1 && windowedMessageBytes(context) > SESSION_WINDOW_MAX_BYTES) {
				start += 1;
				context = projectContextWindow(branch, projection, start, end);
			}
			const summary = summarizeBranch(branch);
			const header = sm.getHeader();
			let modified = header?.timestamp ?? new Date().toISOString();
			try {
				modified = fs.statSync(filePath).mtime.toISOString();
			} catch {
				// use header timestamp
			}
			const parentSessionId = header?.parentSession ? await resolveSessionIdByPath(header.parentSession) : undefined;
			const info = header
				? {
						path: filePath,
						id: header.id,
						cwd: header.cwd ?? "",
						name: sm.getSessionName(),
						created: header.timestamp,
						modified,
						messageCount: summary.messageCount,
						firstMessage: summary.firstMessage || "(no messages)",
						parentSessionId,
					}
				: null;
			return json({
				sessionId,
				filePath,
				info,
				leafId,
				context,
				page: {
					origin: branch.contextEntries[start]?.id ?? null,
					transcriptRevision: transcriptRevision(filePath, leafId),
					total,
					windowStart: start,
					windowEnd: end,
					hasMoreBefore: start > 0,
					timestamps: Object.fromEntries(
						branch.contextEntries.slice(start, end).map(entry => [entry.id, entry.timestamp]),
					),
				},
			});
		}

		const tree = projectTreeForResponse(sm.getTree() as unknown as SessionTreeNode[]);
		const context = buildWebSessionContext(entries, leafId, projection);

		const header = sm.getHeader();
		let modified = header?.timestamp ?? new Date().toISOString();
		try {
			modified = fs.statSync(filePath).mtime.toISOString();
		} catch {
			// use header timestamp
		}
		const parentSessionId = header?.parentSession ? await resolveSessionIdByPath(header.parentSession) : undefined;
		const info = header
			? {
					path: filePath,
					id: header.id,
					cwd: header.cwd ?? "",
					name: sm.getSessionName(),
					created: header.timestamp,
					modified,
					messageCount: context.messages.length,
					firstMessage: firstUserMessageText(context.messages),
					parentSessionId,
				}
			: null;

		const body = JSON.stringify({
			sessionId,
			filePath,
			info,
			leafId,
			tree,
			context,
		});
		if (live === undefined) {
			// Stat after the read: a write that landed mid-read then fails the
			// (mtime, size) check instead of caching a stale body under a fresh stamp.
			const stamp = statSessionFile(filePath);
			if (stamp !== undefined) rememberSessionResponse(filePath, stamp, body);
		}
		return cachedJson(body);
	} catch (error) {
		logger.error("web-gateway: get session failed", { sessionId, error: String(error) });
		return json({ error: String(error) }, 500);
	}
}

export async function handleRenameSession(req: Request, sessionId: string): Promise<Response> {
	try {
		const body = (await req.json()) as { name?: string };
		const name = body.name;
		if (typeof name !== "string") {
			return json({ error: "name is required" }, 400);
		}
		const filePath = await resolveSessionPath(sessionId);
		if (!filePath) {
			return json({ error: "Session not found" }, 404);
		}
		const sm = liveSessionManager(sessionId) ?? (await openSessionManager(filePath));
		await sm.setSessionName(name.trim(), "user");
		invalidateSessionListCache();
		return json({ ok: true });
	} catch (error) {
		logger.error("web-gateway: rename session failed", { sessionId, error: String(error) });
		return json({ error: String(error) }, 500);
	}
}

export async function handleDeleteSession(sessionId: string): Promise<Response> {
	try {
		const filePath = await resolveSessionPath(sessionId);
		if (!filePath) {
			return json({ error: "Session not found" }, 404);
		}

		const sessionCwd = readSessionHeader(filePath)?.cwd;

		// Default-space bot sessions are registry-managed: the relay transcript is
		// undeletable, and deleting/archiving a bot/draft session must drop its
		// registry entry + chat pointers so `!session` and the sidebar stay
		// consistent.
		const webConfig = await WebConfig.load();
		const disposed = await disposeSessionRegistryEntry(webConfig, filePath);
		if (disposed === "relay-protected") {
			// `code` lets API clients localize; the message keeps the legacy copy.
			return json({ error: "relay 会话不可删除", code: "relay-protected" }, 400);
		}

		// Read only the bounded header before deleting.
		const parentSessionPath = readSessionHeader(filePath)?.parentSession;

		// Re-attach all direct children to this session's parent (cascade re-parent)
		const targetPathKey = sessionPathKey(filePath);
		const dir = path.dirname(filePath);
		try {
			const files = fs
				.readdirSync(dir)
				.filter(file => file.endsWith(".jsonl") && sessionPathKey(path.join(dir, file)) !== targetPathKey);
			for (const file of files) {
				const childPath = path.join(dir, file);
				try {
					const content = fs.readFileSync(childPath, "utf8");
					const parsed = parseSessionContent(content);
					const sessionIdx = parsed.entries.findIndex(e => e.type === "session");
					if (sessionIdx < 0) continue;
					const header = parsed.entries[sessionIdx] as { parentSession?: string };
					if (header.parentSession && sessionPathKey(header.parentSession) === targetPathKey) {
						header.parentSession = parentSessionPath;
						const body = `${parsed.entries.map(entry => JSON.stringify(entry)).join("\n")}\n`;
						const nextContent = parsed.titleSlot ? `${serializeTitleSlot(parsed.titleSlot)}${body}` : body;
						fs.writeFileSync(childPath, nextContent, "utf8");
					}
				} catch {
					// skip malformed
				}
			}
		} catch {
			// skip if dir unreadable
		}

		removeRunningSession(sessionId);
		// Soft-delete through the same helper the TUI picker uses: the transcript
		// (plus artifacts and stale backups) moves to
		// `~/.zeta/trash/sessions/<timestamp>_<id>/` so `/trash` + `/restore` can
		// recover it until the retention sweeper expires it, and shared hide/pin
		// metadata is dropped in the same step.
		await deleteSessionFiles(filePath, { mode: "trash" });
		invalidateSessionPathCache(sessionId);
		invalidateSessionListCache();
		await maybeRemoveWorktreeAfterSessionDelete(sessionCwd);
		return json({ ok: true });
	} catch (error) {
		logger.error("web-gateway: delete session failed", { sessionId, error: String(error) });
		return json({ error: String(error) }, 500);
	}
}

/** Result of a registry disposal attempt. */
export type DisposeRegistryResult = "disposed" | "relay-protected" | "not-registered";

/**
 * Drop the default-space bot registry entry + chat pointers for a session
 * file, if any. `relay` sessions are protected: callers refuse both delete
 * and archive (the live relay runtime still points at the transcript).
 * Shared by handleDeleteSession and the archive handlers so both paths keep
 * the exact cleanup contract.
 */
export async function disposeSessionRegistryEntry(
	webConfig: WebConfig,
	filePath: string,
): Promise<DisposeRegistryResult> {
	const fileKey = sessionPathKey(filePath);
	const botEntry = webConfig.getBotSessions().find(entry => sessionPathKey(entry.sessionFile) === fileKey);
	if (!botEntry) return "not-registered";
	if (botEntry.tag === "relay") return "relay-protected";
	await webConfig.removeBotSession(botEntry.id);
	await webConfig.clearChatSessionReferences(botEntry.id);
	// Dispose the live runtime session (the router owns the handle); the
	// router's delete path is idempotent for the config/file parts.
	await notifyBotSessionDeleted(botEntry.id);
	return "disposed";
}

function normalizeCwdForCompare(cwd: string): string {
	return cwd.replace(/\\/g, "/").replace(/\/+$/, "");
}

async function maybeRemoveWorktreeAfterSessionDelete(deletedCwd: string | undefined): Promise<void> {
	if (!deletedCwd) return;
	try {
		const project = await resolveProject(deletedCwd);
		if (!project.isWorktree) return;

		const normalizedDeleted = normalizeCwdForCompare(deletedCwd);
		const sessions = await listAllSessionsWeb();
		for (const session of sessions) {
			if (session.cwd && normalizeCwdForCompare(session.cwd) === normalizedDeleted) {
				return;
			}
		}

		// Replaces `git.worktree.tryRemove(root, cwd, { force: true })` from the
		// deleted src/utils/git.ts. The native API takes only the worktree path
		// and prunes the owning repository, so the root is no longer passed.
		const repo = vcs.git(project.projectRoot);
		if (!repo) {
			logger.warn("web-gateway: no git repository for worktree cleanup (non-fatal)", { cwd: deletedCwd });
			return;
		}
		const removed = await repo.worktreeRemove(deletedCwd, true);
		if (!removed) {
			logger.warn("web-gateway: git worktree remove failed (non-fatal)", { cwd: deletedCwd });
			return;
		}
		await repo.worktreePrune();
		invalidateProjectCache();
	} catch (error) {
		logger.warn("web-gateway: worktree cleanup failed (non-fatal)", { cwd: deletedCwd, error: String(error) });
	}
}

// ---------------------------------------------------------------------------
// Usage statistics (aggregate token burn across all sessions)
// ---------------------------------------------------------------------------

interface SessionUsageRow {
	sessionId: string;
	cwd: string;
	title: string;
	totalTokens: number;
	input: number;
	output: number;
	cost: number;
	lastActive: string;
}

let usageCache: {
	data: { totalTokens: number; input: number; output: number; cost: number; sessions: SessionUsageRow[] } | null;
	ts: number;
} = {
	data: null,
	ts: 0,
};
const USAGE_CACHE_TTL_MS = 30_000;

function sessionUsageFromFile(filePath: string, info: SessionInfo): SessionUsageRow {
	let totalTokens = 0;
	let input = 0;
	let output = 0;
	let cost = 0;
	try {
		const parsed = parseSessionContent(fs.readFileSync(filePath, "utf8"));
		for (const entry of parsed.entries) {
			const message = entry.type === "message" ? entry.message : undefined;
			if (message?.role !== "assistant") continue;
			const usage = message.usage;
			if (!usage) continue;
			totalTokens += usage.totalTokens ?? 0;
			input += usage.input ?? 0;
			output += usage.output ?? 0;
			cost += usage.cost?.total ?? 0;
		}
	} catch {
		// malformed/unreadable file: report zeroed row
	}
	return {
		sessionId: info.id,
		cwd: info.cwd ?? "",
		title: info.name ?? "",
		totalTokens,
		input,
		output,
		cost,
		lastActive: info.modified ?? "",
	};
}

export async function handleUsageStats(): Promise<Response> {
	try {
		const now = Date.now();
		if (usageCache.data && now - usageCache.ts < USAGE_CACHE_TTL_MS) {
			return json(usageCache.data);
		}

		const sessions = await listAllSessionsWeb();
		const rows: SessionUsageRow[] = [];
		let totalTokens = 0;
		let input = 0;
		let output = 0;
		let cost = 0;
		for (const info of sessions) {
			const row = sessionUsageFromFile(info.path, info);
			rows.push(row);
			totalTokens += row.totalTokens;
			input += row.input;
			output += row.output;
			cost += row.cost;
		}

		// Newest activity first.
		rows.sort((a, b) => (a.lastActive < b.lastActive ? 1 : -1));
		const data = { totalTokens, input, output, cost, sessions: rows };
		usageCache = { data, ts: now };
		return json(data);
	} catch (error) {
		logger.error("web-gateway: usage stats failed", { error: String(error) });
		return json({ error: String(error) }, 500);
	}
}

/**
 * DELETE /api/projects — cascade-delete every session whose working
 * directory matches the given project path (or, with `tempOnly`, every
 * session under the system temp directory).
 *
 * Body: { path: string } | { tempOnly: boolean }
 * Returns: { deleted: number; sessions: string[] }
 */
export async function handleDeleteProject(req: Request): Promise<Response> {
	try {
		const body = (await req.json().catch(() => ({}))) as { path?: string; tempOnly?: boolean };
		const tempOnly = body.tempOnly === true;
		if (!tempOnly && typeof body.path !== "string") {
			return json({ error: "path is required (or tempOnly: true)" }, 400);
		}

		const sessions = await listAllSessionsWeb();
		const tempPrefix = tempOnly ? normalizeCwdForCompare(os.tmpdir()) : null;
		const target = !tempOnly && body.path ? normalizeCwdForCompare(path.resolve(body.path)) : null;

		const matches = sessions.filter(info => {
			const cwd = normalizeCwdForCompare(info.cwd ?? "");
			if (tempOnly) return cwd === tempPrefix || cwd.startsWith(`${tempPrefix}/`);
			return target !== null && (cwd === target || cwd.startsWith(`${target}/`));
		});

		const deleted: string[] = [];
		for (const info of matches) {
			const res = await handleDeleteSession(info.id);
			if (res.status === 200) deleted.push(info.id);
		}

		invalidateSessionListCache();
		return json({ deleted: deleted.length, sessions: deleted });
	} catch (error) {
		logger.error("web-gateway: delete project failed", { error: String(error) });
		return json({ error: String(error) }, 500);
	}
}

export async function handleSessionContext(req: Request, sessionId: string): Promise<Response> {
	try {
		const filePath = await resolveSessionPath(sessionId);
		if (!filePath) {
			return json({ error: "Session not found" }, 404);
		}
		const url = new URL(req.url);
		const leafId = url.searchParams.get("leafId") ?? undefined;
		const deferThinking = url.searchParams.has("deferThinking");
		const deferToolResultImages = url.searchParams.has("deferMedia");

		const sm = await openSessionManager(filePath);
		const context = buildWebSessionContext(sm.getEntries(), leafId, { deferThinking, deferToolResultImages });

		return json({ context });
	} catch (error) {
		logger.error("web-gateway: session context failed", { sessionId, error: String(error) });
		return json({ error: String(error) }, 500);
	}
}

export async function handleSessionState(sessionId: string): Promise<Response> {
	try {
		// Live agent session: surface the full AgentState (web-ui contract:
		// `{ running: true, state }` while the rpc session is alive).
		const wrapper = getRpcSession(sessionId);
		if (wrapper?.isAlive()) {
			const state = await wrapper.send({ type: "get_state" });
			return json({ running: true, state });
		}

		const filePath = await resolveSessionPath(sessionId);
		if (!filePath) {
			return json({ error: "Session not found" }, 404);
		}

		return json({ running: false });
	} catch (error) {
		logger.error("web-gateway: session state failed", { sessionId, error: String(error) });
		return json({ error: String(error) }, 500);
	}
}

export async function handleThinking(req: Request, sessionId: string, entryId: string): Promise<Response> {
	const blockIndexParam = new URL(req.url).searchParams.get("blockIndex");
	const blockIndex = blockIndexParam === null ? Number.NaN : Number(blockIndexParam);
	if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) {
		return json({ error: "Valid blockIndex is required" }, 400);
	}

	try {
		const filePath = await resolveSessionPath(sessionId);
		if (!filePath) return json({ error: "Session not found" }, 404);

		const sm = await openSessionManager(filePath);
		const entry = sm.getEntries().find(candidate => candidate.id === entryId);
		if (entry?.type !== "message" || entry.message.role !== "assistant") {
			return json({ error: "Assistant message not found" }, 404);
		}

		const block = entry.message.content[blockIndex];
		if (block?.type !== "thinking") {
			return json({ error: "Thinking block not found" }, 404);
		}

		return json({ thinking: block.thinking });
	} catch (error) {
		logger.error("web-gateway: thinking failed", { sessionId, entryId, error: String(error) });
		return json({ error: String(error) }, 500);
	}
}

// ---------------------------------------------------------------------------
// Export (port of web-ui patchExportHtml; the patch targets the legacy pi
// template, so failure here degrades to the unpatched runtime output)
// ---------------------------------------------------------------------------

function encodeHeaderValue(value: string): string {
	return encodeURIComponent(value).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function getContentDisposition(fileName: string, inline: boolean): string {
	const fallback = fileName.replace(/[^\x20-\x7E]|["\\;\r\n]/g, "_") || "session.html";
	const disposition = inline ? "inline" : "attachment";
	return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeHeaderValue(fileName)}`;
}

function patchExportHtml(html: string): string {
	const n = (s: string) => s.replace(/\r\n/g, "\n");
	html = n(html);

	const replaceRequired = (source: string, name: string, search: string, replacement: string) => {
		const normalizedSearch = n(search);
		const normalizedReplacement = n(replacement);
		const matches = source.split(normalizedSearch).length - 1;
		if (matches !== 1) {
			throw new Error(`Failed to patch exported HTML: ${name} expected 1 match, found ${matches}`);
		}
		return source.replace(normalizedSearch, normalizedReplacement);
	};

	html = replaceRequired(
		html,
		"sortChildren",
		`        function sortChildren(node) {
          node.children.sort((a, b) =>
            new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime()
          );
          node.children.forEach(sortChildren);
        }`,
		`        function sortChildren(root) {
          const stack = [root];
          while (stack.length) {
            const node = stack.pop();
            node.children.sort((a, b) =>
              new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime()
            );
            for (let i = node.children.length - 1; i >= 0; i--) {
              stack.push(node.children[i]);
            }
          }
        }`,
	);

	html = replaceRequired(
		html,
		"mapNodes",
		`          function mapNodes(node) {
            treeNodeMap.set(node.entry.id, node);
            node.children.forEach(mapNodes);
          }
          tree.forEach(mapNodes);`,
		`          const stack = [...tree].reverse();
          while (stack.length) {
            const node = stack.pop();
            treeNodeMap.set(node.entry.id, node);
            for (let i = node.children.length - 1; i >= 0; i--) {
              stack.push(node.children[i]);
            }
          }`,
	);

	html = replaceRequired(
		html,
		"markActive",
		`        function markActive(node) {
          let has = activePathIds.has(node.entry.id);
          for (const child of node.children) {
            if (markActive(child)) has = true;
          }
          containsActive.set(node, has);
          return has;
        }`,
		`        function markActive(root) {
          // Post-order traversal using two stacks
          const stack1 = [root];
          const stack2 = [];
          while (stack1.length) {
            const node = stack1.pop();
            stack2.push(node);
            for (const child of node.children) {
              stack1.push(child);
            }
          }
          while (stack2.length) {
            const node = stack2.pop();
            let has = activePathIds.has(node.entry.id);
            for (const child of node.children) {
              if (containsActive.get(child)) has = true;
            }
            containsActive.set(node, has);
          }
        }`,
	);

	return html;
}

export async function handleExportSession(req: Request, sessionId: string): Promise<Response> {
	const url = new URL(req.url);
	const inline = url.searchParams.get("inline") === "1";

	try {
		const filePath = await resolveSessionPath(sessionId);
		if (!filePath) {
			return json({ error: "Session not found" }, 404);
		}
		const tempDir = path.join(os.tmpdir(), "zeta-web-export");
		fs.mkdirSync(tempDir, { recursive: true });

		const sessionBase = path.basename(filePath, ".jsonl");
		const fileName = `pi-session-${sessionBase}.html`;
		const outputPath = path.join(tempDir, `${randomUUID()}.html`);

		try {
			await exportFromFile(filePath, outputPath);

			let html = fs.readFileSync(outputPath, "utf8");
			try {
				html = patchExportHtml(html);
			} catch (patchError) {
				logger.warn("web-gateway: export html patch skipped", {
					error: patchError instanceof Error ? patchError.message : String(patchError),
				});
			}
			return new Response(html, {
				headers: {
					"Content-Type": "text/html; charset=utf-8",
					"Content-Disposition": getContentDisposition(fileName, inline),
					"Cache-Control": "no-cache",
				},
			});
		} finally {
			try {
				fs.rmSync(outputPath, { force: true });
			} catch {
				// best-effort cleanup
			}
		}
	} catch (error) {
		logger.error("web-gateway: export session failed", { sessionId, error: String(error) });
		return json({ error: String(error) }, 500);
	}
}
