/**
 * Agent Hub ↔ Zeta gateway reads.
 *
 * The hub shows what `/api/agent/:id/subagents*` publishes and nothing else:
 *
 *   `GET  /api/agent/:id/subagents`                       roster snapshot
 *   `GET  /api/agent/:id/subagents/events`                roster SSE (snapshots + progress)
 *   `GET  …/subagents/:subId/transcript?fromByte=`        child transcript, forward cursor (byte offset)
 *   `GET  …/subagents/:subId/output`                      published `<id>.md`
 *
 * Both the page (`useSubagentRoster`) and the deck's registered query handlers
 * call these functions, so the DTO mapping exists once.
 */

import type {
	AgentTranscriptMessage,
	AgentTranscriptPage,
	JobId,
	StudioAgentSnapshot,
} from "@/lib/studio-protocol/protocol";

/** The subset of `fetch` this module needs; tests inject their own. */
export type GetJson = <T>(path: string, query?: Record<string, string | number | undefined>) => Promise<T>;

const defaultGet: GetJson = async <T,>(path: string, query?: Record<string, string | number | undefined>) => {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query ?? {})) {
		if (value !== undefined) params.set(key, String(value));
	}
	const suffix = params.size ? `?${params.toString()}` : "";
	const response = await fetch(`${path}${suffix}`, { cache: "no-store" });
	if (!response.ok) {
		const payload = (await response.json().catch(() => ({}))) as { error?: string };
		throw new Error(payload.error ?? `${path}: HTTP ${response.status}`);
	}
	return (await response.json()) as T;
};

/** `SubagentProgressView` — the roster's bounded progress projection. */
export interface RosterProgress {
	lastIntent?: string;
	currentTool?: string;
	toolCount?: number;
	requests?: number;
	tokens?: number;
	contextTokens?: number;
	contextWindow?: number;
	cost?: number;
	durationMs?: number;
	recentOutput?: string[];
}

/** `SubagentRosterEntry` — see `packages/coding-agent/src/server/web-gateway/subagents.ts`. */
export interface RosterEntry {
	id: string;
	displayName: string;
	kind: "sub" | "advisor";
	parentId: string | null;
	depth: number;
	agent?: string;
	status: "running" | "idle" | "parked" | "aborted";
	taskStatus?: "pending" | "running" | "completed" | "failed" | "aborted";
	description?: string;
	task?: string;
	assignment?: string;
	sessionFile: string | null;
	createdAt: number;
	lastActivity: number;
	detached?: boolean;
	activity?: string;
	staleAcceptedRun?: boolean;
	progress?: RosterProgress;
	metrics?: {
		tokens?: number;
		requests?: number;
		tools?: number;
		cost?: number;
		durationMs?: number;
		contextTokens?: number;
		contextWindow?: number;
	};
	outputPath?: string | null;
	patchPath?: string | null;
	branchName?: string | null;
	persisted: boolean;
}

export interface RosterResponse {
	subagents: RosterEntry[];
	maxConcurrency: number;
	generatedAt: number;
}

export interface TranscriptResponse {
	subagentId: string;
	sessionFile: string;
	fromByte: number;
	nextByte: number;
	reset: boolean;
	entries: unknown[];
	messages: unknown[];
}

export interface OutputResponse {
	subagentId: string;
	published: boolean;
	status: string;
	outputPath?: string;
	content?: string;
	size?: number;
	message?: string;
	progress?: RosterProgress;
}

/** Roster row → the Agent Hub snapshot shape the ported presentation consumes. */
export function toAgentSnapshot(entry: RosterEntry): StudioAgentSnapshot {
	const metrics = entry.metrics;
	const progress = entry.progress;
	const tokens = metrics?.tokens ?? progress?.tokens ?? 0;
	const requests = metrics?.requests ?? progress?.requests ?? 0;
	const tools = metrics?.tools ?? progress?.toolCount ?? 0;
	const cost = metrics?.cost ?? progress?.cost ?? 0;
	const durationMs = metrics?.durationMs ?? progress?.durationMs ?? 0;
	const contextTokens = metrics?.contextTokens ?? progress?.contextTokens;
	const contextWindow = metrics?.contextWindow ?? progress?.contextWindow;
	const hasMetrics =
		metrics !== undefined || tokens > 0 || requests > 0 || tools > 0 || cost > 0 || durationMs > 0;
	return {
		agentId: entry.id as StudioAgentSnapshot["agentId"],
		generation: entry.createdAt as StudioAgentSnapshot["generation"],
		...(entry.parentId === null ? {} : { parentAgentId: entry.parentId as StudioAgentSnapshot["agentId"] }),
		kind: entry.kind,
		displayName: entry.displayName,
		status: entry.status,
		...(entry.assignment === undefined ? {} : { assignment: entry.assignment }),
		...(entry.task === undefined ? {} : { summary: entry.task }),
		startedAt: new Date(entry.createdAt).toISOString(),
		updatedAt: new Date(entry.lastActivity).toISOString(),
		hasLiveSession: !entry.persisted,
		hasTranscript: entry.sessionFile !== null,
		unreadCount: 0,
		activeJobIds: [] as JobId[],
		...(progress?.currentTool ? { stage: progress.currentTool } : {}),
		...(hasMetrics
			? {
					usage: {
						tokens,
						requests,
						tools,
						cost,
						durationMs,
						...(contextTokens === undefined ? {} : { contextTokens }),
						...(contextWindow === undefined ? {} : { contextWindow }),
					},
				}
			: {}),
		...(entry.outputPath === null || entry.outputPath === undefined
			? {}
			: { outputPath: entry.outputPath }),
		...(entry.patchPath === null || entry.patchPath === undefined ? {} : { patchPath: entry.patchPath }),
		...(entry.branchName === null || entry.branchName === undefined ? {} : { branchName: entry.branchName }),
		readOnly: entry.kind === "advisor",
	};
}

export async function fetchRoster(
	sessionId: string,
	get: GetJson = defaultGet,
): Promise<StudioAgentSnapshot[]> {
	const body = await get<RosterResponse>(`/api/agent/${encodeURIComponent(sessionId)}/subagents`);
	return (body.subagents ?? []).map(toAgentSnapshot);
}

/** A runtime message as the session file stores it (only the fields the hub reads). */
interface RuntimeMessageLike {
	role?: string;
	content?: unknown;
	timestamp?: number;
	ts?: number;
}

function textOfContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (typeof block === "string") {
			parts.push(block);
			continue;
		}
		if (!block || typeof block !== "object") continue;
		const record = block as Record<string, unknown>;
		if (typeof record.text === "string") parts.push(record.text);
		else if (typeof record.thinking === "string") parts.push(record.thinking);
	}
	return parts.join("\n").trim();
}

function roleOf(role: string | undefined): AgentTranscriptMessage["role"] {
	if (role === "user" || role === "assistant") return role;
	return "system";
}

/**
 * Zeta's child transcript page → the protocol's `AgentTranscriptPage`.
 *
 * Zeta reads forward from a byte offset, so the page is a *tail*: `cursor` is
 * `fromByte`, `nextCursor` is the byte after the last complete line, and `eof`
 * means "nothing new since this cursor". There is no backward cursor, and no
 * branch/parent tree, so `agent.transcript.read` is served — never
 * `agent.conversation.read`, whose paging and branch semantics Zeta cannot meet.
 */
export function toTranscriptPage(subagentId: string, body: TranscriptResponse): AgentTranscriptPage {
	const messages = Array.isArray(body.messages) ? (body.messages as RuntimeMessageLike[]) : [];
	const rows: AgentTranscriptMessage[] = [];
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index]!;
		const text = textOfContent(message.content);
		if (text.length === 0) continue;
		const at = body.fromByte + index;
		rows.push({
			id: `${body.subagentId}:${at}`,
			role: roleOf(message.role),
			ts: typeof message.timestamp === "number" ? message.timestamp : (message.ts ?? 0),
			text,
		});
	}
	return {
		agentId: subagentId as AgentTranscriptPage["agentId"],
		generation: body.fromByte as AgentTranscriptPage["generation"],
		cursor: String(body.fromByte) as AgentTranscriptPage["cursor"],
		...(body.nextByte === body.fromByte ? {} : { nextCursor: String(body.nextByte) as AgentTranscriptPage["cursor"] }),
		messages: rows,
		eof: body.nextByte === body.fromByte,
	};
}

export async function fetchTranscript(
	sessionId: string,
	subagentId: string,
	fromByte = 0,
	get: GetJson = defaultGet,
): Promise<AgentTranscriptPage> {
	const body = await get<TranscriptResponse>(
		`/api/agent/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(subagentId)}/transcript`,
		{ fromByte },
	);
	return toTranscriptPage(subagentId, body);
}

export async function fetchOutput(
	sessionId: string,
	subagentId: string,
	get: GetJson = defaultGet,
): Promise<OutputResponse> {
	return get<OutputResponse>(
		`/api/agent/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(subagentId)}/output`,
	);
}

/**
 * Subscribe to the roster stream. Frames are `subagent_snapshot` (a whole
 * roster), `subagent_status` (one row) and progress/lifecycle payloads; the
 * callback receives each parsed frame and the caller decides what to refresh.
 */
export function streamRoster(
	sessionId: string,
	onFrame: (frame: { type?: string; subagents?: RosterEntry[]; generatedAt?: number }) => void,
): () => void {
	const controller = new AbortController();
	void (async () => {
		try {
			const response = await fetch(
				`/api/agent/${encodeURIComponent(sessionId)}/subagents/events`,
				{ headers: { accept: "text/event-stream" }, cache: "no-store", signal: controller.signal },
			);
			if (!response.ok || !response.body) return;
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			for (;;) {
				const { value, done } = await reader.read();
				if (done) return;
				buffer += decoder.decode(value, { stream: true });
				let split = buffer.indexOf("\n\n");
				while (split >= 0) {
					const chunk = buffer.slice(0, split);
					buffer = buffer.slice(split + 2);
					const data = chunk
						.split("\n")
						.filter(line => line.startsWith("data:"))
						.map(line => line.slice(5).trim())
						.join("");
					if (data) {
						try {
							onFrame(JSON.parse(data) as { type?: string; subagents?: RosterEntry[] });
						} catch {
							// A malformed frame is dropped; the next snapshot resyncs.
						}
					}
					split = buffer.indexOf("\n\n");
				}
			}
		} catch {
			// Aborted on unmount, or the gateway closed the stream; the caller polls.
		}
	})();
	return () => controller.abort();
}
