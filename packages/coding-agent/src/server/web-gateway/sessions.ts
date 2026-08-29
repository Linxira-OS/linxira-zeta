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
import { logger } from "@linxiraos/pi-utils";
import { WebConfig } from "../../config/web-config";
import { exportFromFile } from "../../export/html";
import type { SessionEntry as RuntimeSessionEntry } from "../../session/session-entries";
import { listAllSessions as listRuntimeSessions } from "../../session/session-listing";
import { parseSessionContent } from "../../session/session-loader";
import { SessionManager } from "../../session/session-manager";
import { serializeTitleSlot } from "../../session/session-title-slot";
// Upstream v18.0.9 deleted src/utils/git.ts — worktree operations now go
// through the pi-vcs native addon (crates/pi-vcs, exposed via pi-natives/vcs).
import * as vcs from "@linxiraos/pi-natives/vcs";
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

function sessionPathKey(filePath: string): string {
	const normalized = process.platform === "win32" ? path.win32.normalize(filePath) : path.posix.normalize(filePath);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function invalidateSessionListCache(): void {
	sessionListGeneration += 1;
	sessionListCache = null;
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

async function loadAllSessions(): Promise<SessionInfo[]> {
	// The runtime listing scans the full agent sessions dir (title-slot aware)
	// with an mtime/size memoized cache, so no extra fallback scan is needed.
	const runtimeSessions = await listRuntimeSessions();

	const pathToId = new Map<string, string>();
	for (const s of runtimeSessions) {
		pathToId.set(sessionPathKey(s.path), s.id);
	}

	// Default-space bot sessions (relay/bot/draft) carry a tag so the web UI can
	// hide or label them; other sessions have no tag.
	const webConfig = await WebConfig.load();
	const tagByPath = new Map<string, string>();
	for (const entry of webConfig.getBotSessions()) {
		tagByPath.set(sessionPathKey(entry.sessionFile), entry.tag);
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
		const tag = tagByPath.get(sessionPathKey(s.path));
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
			...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
			...(tag ? { tag } : {}),
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

	for (const entry of pathEntries) {
		if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.thinkingLevel;
		} else if (entry.type === "model_change") {
			model = { provider: entry.provider, modelId: entry.modelId };
		} else if (entry.type === "message" && entry.message.role === "assistant") {
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

function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
	if (!isRecord(block) || block.type !== "image") return null;

	let data: string | undefined;
	let mime: string | undefined;
	if (typeof block.data === "string") {
		data = block.data;
		mime = typeof block.mimeType === "string" ? block.mimeType : undefined;
	} else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
		data = block.source.data;
		mime = typeof block.source.media_type === "string" ? block.source.media_type : undefined;
	}
	if (!data) return null;

	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return { bytes: Math.max(0, Math.floor((data.length * 3) / 4) - padding), mime };
}

function omitToolResultBase64Images(message: AgentMessage): AgentMessage {
	if (message.role !== "toolResult") return message;

	let omitted = 0;
	let bytes = 0;
	const mimes = new Set<string>();
	const content = message.content.filter(block => {
		const image = base64ImageInfo(block);
		if (!image) return true;
		omitted += 1;
		bytes += image.bytes;
		if (image.mime) mimes.add(image.mime);
		return false;
	});
	if (omitted === 0) return message;

	const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
	content.push({
		type: "text",
		text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`,
	});
	return { ...message, content };
}

/** Convert a session entry on the active branch into a UI message. */
function entryToUiMessage(
	entry: SessionEntry,
	options: { deferThinking?: boolean; deferToolResultImages?: boolean },
): AgentMessage | null {
	switch (entry.type) {
		case "message": {
			const message = options.deferToolResultImages
				? omitToolResultBase64Images(normalizeToolCalls(entry.message))
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

export function buildWebSessionContext(
	entries: RuntimeSessionEntry[],
	leafId: string | null | undefined,
	options: { deferThinking?: boolean; deferToolResultImages?: boolean } = {},
): SessionContext {
	const webEntries = entries as unknown as SessionEntry[];
	const byId = new Map<string, SessionEntry>();
	for (const entry of webEntries) byId.set(entry.id, entry);

	const pathEntries = buildSessionPath(webEntries, leafId, byId);
	const contextEntries = buildContextEntries(pathEntries);

	const messages: AgentMessage[] = [];
	const entryIds: string[] = [];
	for (const entry of contextEntries) {
		const message = entryToUiMessage(entry, options);
		if (message) {
			messages.push(message);
			entryIds.push(entry.id);
		}
	}

	const { thinkingLevel, model } = sessionSettingsFromPath(pathEntries);
	return { messages, entryIds, thinkingLevel, model };
}

// ---------------------------------------------------------------------------
// Session manager helpers
// ---------------------------------------------------------------------------

async function openSessionManager(filePath: string): Promise<SessionManager> {
	return SessionManager.open(filePath, undefined, undefined, { suppressBreadcrumb: true });
}

/** Read the session header without opening the manager (no lock). */
function readSessionHeader(filePath: string): SessionHeader | null {
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

export async function handleListSessions(): Promise<Response> {
	try {
		const sessions = await listAllSessionsWeb();
		return json({ sessions, runningSessionIds: getRunningSessionIds() });
	} catch (error) {
		logger.error("web-gateway: list sessions failed", { error: String(error) });
		return json({ error: String(error) }, 500);
	}
}

export async function handleGetSession(req: Request, sessionId: string): Promise<Response> {
	try {
		const filePath = await resolveSessionPath(sessionId);
		if (!filePath) {
			return json({ error: "Session not found" }, 404);
		}

		const sm = await openSessionManager(filePath);
		const entries = sm.getEntries();
		const leafId = sm.getLeafId();
		const tree = projectTreeForResponse(sm.getTree() as unknown as SessionTreeNode[]);
		const url = new URL(req.url);
		const searchParams = url.searchParams;
		const deferThinking = searchParams.has("deferThinking");
		const deferToolResultImages = searchParams.has("deferMedia");
		const context = buildWebSessionContext(entries, leafId, { deferThinking, deferToolResultImages });

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

		return json({
			sessionId,
			filePath,
			info,
			leafId,
			tree,
			context,
		});
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
		const sm = await openSessionManager(filePath);
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
		// undeletable, and deleting a bot/draft session must drop its registry
		// entry + chat pointers so `!session` and the sidebar stay consistent.
		const webConfig = await WebConfig.load();
		const fileKey = sessionPathKey(filePath);
		const botEntry = webConfig.getBotSessions().find(entry => sessionPathKey(entry.sessionFile) === fileKey);
		if (botEntry?.tag === "relay") {
			return json({ error: "relay 会话不可删除" }, 400);
		}
		if (botEntry) {
			await webConfig.removeBotSession(botEntry.id);
			await webConfig.clearChatSessionReferences(botEntry.id);
			// Dispose the live runtime session (the router owns the handle); the
			// router's delete path is idempotent for the config/file parts.
			await notifyBotSessionDeleted(botEntry.id);
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
		fs.unlinkSync(filePath);
		invalidateSessionPathCache(sessionId);
		invalidateSessionListCache();
		await maybeRemoveWorktreeAfterSessionDelete(sessionCwd);
		return json({ ok: true });
	} catch (error) {
		logger.error("web-gateway: delete session failed", { sessionId, error: String(error) });
		return json({ error: String(error) }, 500);
	}
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
