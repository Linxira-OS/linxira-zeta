/**
 * Client for a running `zetacode serve` backend.
 *
 * The backend already hosts every live session and the web UI talks to it over
 * the web-gateway RPC surface: `GET /api/sessions` for discovery,
 * `POST /api/agent/new` for a session in a cwd, `POST /api/agent/:id` for
 * commands (prompt/abort/mode…), and `GET /api/agent/:id/events` for the SSE
 * stream. This module is a thin typed client over exactly that protocol — no
 * second transport and no new wire format.
 *
 * Discovery is a hint, never an authority: an explicit URL / `ZETA_GATEWAY_URL`
 * is probed first, then `ZETA_WEB_GATEWAY_PORT`, then the serve registry's
 * published gateway/web URL. The identity endpoint (`/api/server/identity`)
 * proves the port belongs to a healthy Zeta instance.
 */

import * as path from "node:path";
import { isRecord, readLines, ZETA_GATEWAY_PORT } from "@linxiraos/pi-utils";
import {
	identityProbeUrls,
	probeServeIdentity,
	SERVE_REGISTRY_ENV,
	serveRegistryPath,
	readServeRegistration,
} from "../server/serve-registry";
import type { ServeIdentity } from "../server/web-gateway/identity";

/** Standalone web-gateway port used when no env override is set. */
export const DEFAULT_BACKEND_PORT = ZETA_GATEWAY_PORT;

/** Discovery budget: a client launch must not stall on a missing backend. */
export const DEFAULT_BACKEND_PROBE_TIMEOUT_MS = 1500;

/** Where the gateway can be reached, plus the identity that answered. */
export interface BackendTarget {
	baseUrl: string;
	identity: ServeIdentity;
}

/** One row from `GET /api/sessions` (web-ui `SessionInfo` contract). */
export interface BackendSessionInfo {
	path?: string;
	id: string;
	cwd: string;
	name?: string;
	created?: string;
	modified?: string;
	messageCount?: number;
	firstMessage?: string;
	parentSessionId?: string;
	projectRoot?: string;
	/** Branch the session's cwd sat on when the backend listed it. */
	branch?: string;
	/** Branch of a linked worktree; superseded by `branch` for attachment. */
	worktreeBranch?: string;
	temp?: boolean;
	/** Default-space bot session tag ("relay" | "bot" | "draft"); backend-owned. */
	tag?: string;
}

export interface BackendSessionList {
	sessions: BackendSessionInfo[];
	runningSessionIds?: string[];
}

/** A raw shell of the session detail DTO; only fields the client uses are typed. */
export interface BackendSessionDetail {
	sessionId: string;
	filePath?: string;
	info?: BackendSessionInfo | null;
	leafId?: string | null;
	tree?: unknown[];
	context?: {
		messages?: unknown[];
		entryIds?: string[];
		thinkingLevel?: string;
		model?: { provider: string; modelId: string } | null;
	};
}

/** SSE frame from `GET /api/agent/:id/events`. */
export interface BackendEvent {
	type: string;
	[key: string]: unknown;
}

export interface DiscoverBackendOptions {
	/** Explicit backend URL (CLI flag), tried first. */
	url?: string;
	env?: Record<string, string | undefined>;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
	/** Registry file override (tests). */
	registryFile?: string;
}

/** Every URL discovery should try, in priority order. */
export function backendCandidateUrls(options: DiscoverBackendOptions = {}): string[] {
	const env = options.env ?? process.env;
	const candidates: string[] = [];
	const push = (raw: string | undefined): void => {
		if (!raw) return;
		const trimmed = raw.trim();
		if (!trimmed) return;
		let base: string;
		try {
			base = new URL(trimmed).origin;
		} catch {
			return;
		}
		if (!candidates.includes(base)) candidates.push(base);
	};

	push(options.url);
	push(env.ZETA_GATEWAY_URL);
	const port = env.ZETA_WEB_GATEWAY_PORT;
	if (port && /^\d+$/.test(port.trim())) push(`http://127.0.0.1:${port.trim()}`);
	push(`http://127.0.0.1:${DEFAULT_BACKEND_PORT}`);

	try {
		const registration = readServeRegistration(
			options.registryFile ??
				(env[SERVE_REGISTRY_ENV] ? path.resolve(env[SERVE_REGISTRY_ENV]!) : serveRegistryPath()),
		);
		if (registration) {
			if (registration.gatewayUrl) push(registration.gatewayUrl);
			for (const url of identityProbeUrls(registration.webUrl)) push(url);
		}
	} catch {
		// Registry unreadable is "no hint", not a discovery failure.
	}

	return candidates;
}

/**
 * Find a healthy backend. Returns null when nothing answers — the caller then
 * keeps today's in-process behaviour.
 */
export async function discoverBackend(options: DiscoverBackendOptions = {}): Promise<BackendTarget | null> {
	for (const baseUrl of backendCandidateUrls(options)) {
		const identity = await probeServeIdentity(baseUrl, {
			fetchImpl: options.fetchImpl,
			timeoutMs: options.timeoutMs ?? DEFAULT_BACKEND_PROBE_TIMEOUT_MS,
		});
		if (identity) return { baseUrl, identity };
	}
	return null;
}

/** Normalize a cwd for cross-platform comparison (Windows is case-insensitive). */
export function normalizeCwdForCompare(cwd: string): string {
	const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Most recently modified session bound to `cwd`, or undefined. Sessions for
 * every repository are considered; only the exact cwd matches (the same rule
 * `zeta serve` uses for project grouping).
 */
export function pickMostRecentSessionForCwd(
	sessions: readonly BackendSessionInfo[],
	cwd: string,
	branch?: string | null,
): BackendSessionInfo | undefined {
	const target = normalizeCwdForCompare(cwd);
	const candidates = sessions.filter(
		// Bot/relay/draft sessions are the backend's own surfaces (IM channel,
		// shared web chat). A terminal that auto-attaches wants a user session;
		// an explicit `--attach-session <id>` can still reach them.
		session => session.cwd !== undefined && normalizeCwdForCompare(session.cwd) === target && !session.tag,
	);
	const newest = (list: readonly BackendSessionInfo[]): BackendSessionInfo | undefined =>
		list.reduce<BackendSessionInfo | undefined>((best, session) => {
			if (!best) return session;
			const a = session.modified ?? session.created ?? "";
			const b = best.modified ?? best.created ?? "";
			return a > b ? session : best;
		}, undefined);

	const wanted = branch?.trim();
	if (!wanted) return newest(candidates);
	const sameBranch = candidates.filter(session => session.branch === wanted);
	if (sameBranch.length > 0) return newest(sameBranch);
	// Sessions written before branch binding carry no branch at all. Adopt the
	// newest such session so an upgrade keeps its transcript; a cwd that has
	// sessions on *other* branches means the user switched branches and wants a
	// fresh session for this one.
	return candidates.length > 0 && candidates.every(session => !session.branch) ? newest(candidates) : undefined;
}

/** Sort newest-first for display (`zetacode attach --list`). */
export function sortSessionsNewestFirst(sessions: readonly BackendSessionInfo[]): BackendSessionInfo[] {
	return [...sessions].sort((a, b) => {
		const left = a.modified ?? a.created ?? "";
		const right = b.modified ?? b.created ?? "";
		if (left === right) return a.id.localeCompare(b.id);
		return left < right ? 1 : -1;
	});
}

export class BackendHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "BackendHttpError";
	}
}

/** Typed HTTP/SSE client over one gateway origin. */
export class BackendClient {
	/** Trailing slashes are stripped so every path concatenation is safe. */
	readonly baseUrl: string;

	constructor(
		baseUrl: string,
		private readonly fetchImpl: typeof fetch = fetch,
	) {
		this.baseUrl = baseUrl.replace(/\/+$/, "");
	}

	private async request(pathname: string, init?: RequestInit): Promise<Response> {
		const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
			...init,
			headers: {
				accept: "application/json",
				...(init?.body ? { "content-type": "application/json" } : {}),
				...init?.headers,
			},
		});
		if (!response.ok) {
			let message = `HTTP ${response.status}`;
			try {
				const body = (await response.json()) as { error?: unknown };
				if (typeof body.error === "string") message = body.error;
			} catch {
				// non-JSON error body: keep the status
			}
			throw new BackendHttpError(response.status, message);
		}
		return response;
	}

	/** Sessions across every repository, optionally including archived ones. */
	async listSessions(options: { archived?: boolean; signal?: AbortSignal } = {}): Promise<BackendSessionList> {
		const pathname = options.archived ? "/api/sessions/archived" : "/api/sessions";
		const response = await this.request(pathname, { signal: options.signal });
		const body = (await response.json()) as BackendSessionList;
		return {
			sessions: Array.isArray(body.sessions) ? body.sessions : [],
			runningSessionIds: Array.isArray(body.runningSessionIds) ? body.runningSessionIds : [],
		};
	}

	/** Newest session bound to `cwd` and, when given, the same branch. */
	async findSessionForCwd(
		cwd: string,
		branch?: string | null,
		signal?: AbortSignal,
	): Promise<BackendSessionInfo | undefined> {
		const { sessions } = await this.listSessions({ signal });
		return pickMostRecentSessionForCwd(sessions, cwd, branch);
	}

	/** Create a session bound to `cwd` and the branch the caller sees (`ensure_session`). */
	async createSession(cwd: string, branch?: string | null, signal?: AbortSignal): Promise<string> {
		const response = await this.request("/api/agent/new", {
			method: "POST",
			body: JSON.stringify({ cwd, type: "ensure_session", ...(branch ? { branch } : {}) }),
			signal,
		});
		const body = (await response.json()) as { sessionId?: unknown; error?: unknown };
		if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
			throw new Error(
				typeof body.error === "string" ? body.error : "Backend did not return a session id for the new session",
			);
		}
		return body.sessionId;
	}

	/** Attach target resolution shared by the TUI and print paths. */
	async resolveSession(
		options: {
			cwd: string;
			/** Branch the client sits on; a session belongs to one (cwd, branch) pair. */
			branch?: string | null;
			sessionId?: string;
			newSession?: boolean;
			signal?: AbortSignal;
		} = { cwd: process.cwd() },
	): Promise<{ sessionId: string; created: boolean }> {
		if (options.sessionId) return { sessionId: options.sessionId, created: false };
		if (!options.newSession) {
			const existing = await this.findSessionForCwd(options.cwd, options.branch, options.signal);
			if (existing) return { sessionId: existing.id, created: false };
		}
		return { sessionId: await this.createSession(options.cwd, options.branch, options.signal), created: true };
	}

	async getSession(sessionId: string, signal?: AbortSignal): Promise<BackendSessionDetail> {
		const response = await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, { signal });
		return (await response.json()) as BackendSessionDetail;
	}

	/** The serve process's shared coordinator session id, when it hosts one. */
	async getCurrentSessionId(signal?: AbortSignal): Promise<string> {
		const response = await this.request("/api/agent/current", { signal });
		const body = (await response.json()) as { sessionId?: unknown; error?: unknown };
		if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
			throw new Error(typeof body.error === "string" ? body.error : "no shared session");
		}
		return body.sessionId;
	}

	/** State snapshot (`{running, state?}`) for a session. */
	async getState(sessionId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
		const response = await this.request(`/api/agent/${encodeURIComponent(sessionId)}`, { signal });
		return (await response.json()) as Record<string, unknown>;
	}

	/** Send one RPC command and return its `data` payload. */
	async send(sessionId: string, command: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
		const response = await this.request(`/api/agent/${encodeURIComponent(sessionId)}`, {
			method: "POST",
			body: JSON.stringify(command),
			signal,
		});
		const body = (await response.json()) as { success?: boolean; data?: unknown; error?: unknown };
		if (body.success !== true || body.error !== undefined) {
			throw new Error(typeof body.error === "string" ? body.error : "Backend command failed");
		}
		return body.data;
	}

	/** Answer an extension-UI dialog by request id (session-less route). */
	async respondExtensionUi(body: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
		await this.request("/api/extension-ui/response", {
			method: "POST",
			body: JSON.stringify(body),
			signal,
		});
	}

	/**
	 * Open the session event stream and yield parsed frames until aborted.
	 * The stream auto-starts a disk session on the backend when needed, exactly
	 * like the web UI's `EventSource`.
	 */
	async *events(
		sessionId: string,
		options: { since?: number; signal?: AbortSignal } = {},
	): AsyncGenerator<BackendEvent> {
		const query = options.since && options.since > 0 ? `?since=${options.since}` : "";
		const response = await this.fetchImpl(
			`${this.baseUrl}/api/agent/${encodeURIComponent(sessionId)}/events${query}`,
			{
				headers: { accept: "text/event-stream" },
				signal: options.signal,
			},
		);
		if (!response.ok || !response.body) {
			throw new BackendHttpError(response.status, `event stream HTTP ${response.status}`);
		}
		for await (const event of readSseEvents(response.body, options.signal)) {
			yield event;
		}
	}

	/**
	 * Open the backend's subagent roster stream (snapshot + lifecycle/progress).
	 * Frames are the gateway's `SubagentEventFrame` union, not session events.
	 */
	async *subagentEvents(
		sessionId: string,
		options: { signal?: AbortSignal } = {},
	): AsyncGenerator<Record<string, unknown>> {
		const response = await this.fetchImpl(
			`${this.baseUrl}/api/agent/${encodeURIComponent(sessionId)}/subagents/events`,
			{
				headers: { accept: "text/event-stream" },
				signal: options.signal,
			},
		);
		if (!response.ok || !response.body) {
			throw new BackendHttpError(response.status, `subagent stream HTTP ${response.status}`);
		}
		for await (const event of readSseEvents(response.body, options.signal)) {
			yield event as unknown as Record<string, unknown>;
		}
	}
}

/** Parse `data:` frames from an SSE byte stream, keeping JSON payloads only. */
export async function* readSseEvents(
	stream: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
): AsyncGenerator<BackendEvent> {
	const decoder = new TextDecoder();
	let dataLines: string[] = [];
	const flush = function* (): Generator<BackendEvent> {
		if (dataLines.length === 0) return;
		const payload = dataLines.join("\n");
		dataLines = [];
		if (!payload.trim()) return;
		try {
			const parsed = JSON.parse(payload) as unknown;
			if (isRecord(parsed) && typeof parsed.type === "string") yield parsed as BackendEvent;
		} catch {
			// Malformed frame: drop it, the stream stays alive.
		}
	};
	for await (const bytes of readLines(stream, signal)) {
		const line = decoder.decode(bytes).replace(/\r$/, "");
		if (line === "") {
			yield* flush();
			continue;
		}
		if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
	}
	yield* flush();
}
