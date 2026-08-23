import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import {
	collectToolResults,
	convertZetaMessage,
	zetaSessionToSession,
	type ZetaMessage,
	type ZetaSessionInfo,
} from "./convert";

/**
 * Zeta gateway adapter owning seam 1 (`opencodeClient`).
 *
 * Every method either speaks the zeta web gateway (`/api/*`, envelope
 * `{success,data}` / `{error}`) or raises NotImplementedError — nothing talks
 * raw opencode HTTP anymore. The wrapped original OpencodeService instance is
 * kept only as an inert fallback for members this file does not override yet
 * (its calls 404 behind the `/api` proxy instead of crashing).
 *
 * Endpoint map: see ./README.md. Wire shapes: ./convert.ts.
 */

export class NotImplementedError extends Error {
	constructor(operation: string) {
		super(`[zeta] ${operation} is not implemented yet`);
		this.name = "NotImplementedError";
	}
}
/** Members of the original OpencodeService this adapter implements. */
interface InterceptedSurface {
	getBaseUrl(): string;
	reconnectToRuntimeBaseUrl(): Promise<boolean>;
	getSdkClient(): OpencodeClient;
	getScopedSdkClient(directory?: string): OpencodeClient;
	setDirectory(directory?: string | null): void;
	getDirectory(): string | undefined | null;
	clearConfigCache(): void;
	checkHealth(): Promise<boolean>;
	getProvidersForConfig(directory?: string): Promise<{ providers: unknown[] }>;
	listAgents(directory?: string): Promise<unknown[]>;
	listCommands(directory?: string | null): Promise<Array<{ name: string; description?: string; agent?: string; model?: string; source?: string }>>;
	listCommandsWithDetails(directory?: string | null): Promise<Array<{ name: string; description?: string; agent?: string; model?: string; source?: string; template?: string }>>;
	getCommandDetails(name: string): Promise<{ name: string; template: string; description?: string; agent?: string; model?: string } | null>;
	listSkillsWithDetails(directory?: string | null): Promise<Array<{ name: string; description?: string; location: string; content?: string }>>;
	listSessions(directory?: string): Promise<unknown[]>;
	getSessionMessages(sessionID: string, directory?: string, limit?: number): Promise<unknown[]>;
	sendMessage(args: Record<string, unknown>): Promise<unknown>;
	sendCommand(args: Record<string, unknown>): Promise<unknown>;
	shellSession(args: Record<string, unknown>): Promise<unknown>;
	abortSession(sessionId: string, directory?: string): Promise<unknown>;
	summarizeSession(sessionId: string, providerId?: string, modelId?: string, directory?: string): Promise<unknown>;
	deleteSession(sessionId: string, directory?: string): Promise<unknown>;
	updateSession(sessionId: string, patch: Record<string, unknown>, directory?: string): Promise<unknown>;
	createSession(parentID?: string, title?: string, directory?: string): Promise<unknown>;
	replyToPermission(args: Record<string, unknown>): Promise<boolean>;
	replyToQuestion(args: Record<string, unknown>): Promise<boolean>;
	rejectQuestion(args: Record<string, unknown>): Promise<boolean>;
	listPendingQuestions(directories: string[]): Promise<unknown[]>;
	listPendingPermissions(directories: string[]): Promise<unknown[]>;
}

// ---------------------------------------------------------------------------
// Gateway plumbing
// ---------------------------------------------------------------------------

type Envelope<T> = { success?: boolean; data?: T; error?: string };

async function gatewayFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		...init,
		headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
	});
	const body = await res.json().catch(() => ({}) as Envelope<T>);
	if (!res.ok || (body as Envelope<T>).error) {
		const message = (body as Envelope<T>).error ?? `HTTP ${res.status}`;
		throw Object.assign(new Error(`[zeta-gateway] ${path}: ${message}`), { status: res.status });
	}
	return ((body as Envelope<T>).data ?? body) as T;
}

const postCommand = <T>(sessionId: string, command: Record<string, unknown>): Promise<T> =>
	gatewayFetch<T>(`/api/agent/${encodeURIComponent(sessionId)}`, {
		method: "POST",
		body: JSON.stringify(command),
	});

/** Synthetic SDK response object — cursor-less pagination terminator. */
const sdkResponse = () => ({ headers: { get: () => null } });
const okEnvelope = <T>(data: T) => ({ data, error: undefined, response: sdkResponse() });

function normalizeDir(value: string | undefined | null): string {
	if (!value) return "";
	return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Convert wire session infos into opencode Session records for store pages. */
function toSessionRecords(
	infos: ZetaSessionInfo[],
	directory?: string,
	rootsOnly?: boolean,
	limit?: number,
): Record<string, unknown>[] {
	let filtered = infos;
	if (directory) {
		const target = normalizeDir(directory);
		filtered = filtered.filter((info) => normalizeDir(info.cwd) === target);
	}
	if (rootsOnly) filtered = filtered.filter((info) => !info.parentSessionId);
	const records = filtered.map(zetaSessionToSession);
	return limit && limit > 0 ? records.slice(0, limit) : records;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class ZetaGatewayService implements InterceptedSurface {
	#inner: object;
	#directory: string | undefined;
	#sessionsCache: { at: number; sessions: ZetaSessionInfo[] } | null = null;

	constructor(inner: object) {
		this.#inner = inner;
	}

	// -- connection ---------------------------------------------------------

	getBaseUrl(): string {
		return "/api";
	}

	async reconnectToRuntimeBaseUrl(): Promise<boolean> {
		this.#sessionsCache = null;
		return true;
	}

	setDirectory(directory?: string | null): void {
		this.#directory = normalizeDir(directory) || undefined;
	}

	getDirectory(): string | undefined {
		return this.#directory;
	}

	clearConfigCache(): void {
		this.#sessionsCache = null;
	}

	async checkHealth(): Promise<boolean> {
		try {
			const res = await fetch("/api/desktop/info");
			return res.ok;
		} catch {
			return false;
		}
	}

	// -- sessions -----------------------------------------------------------

	async #listSessionInfos(force = false): Promise<ZetaSessionInfo[]> {
		if (!force && this.#sessionsCache && Date.now() - this.#sessionsCache.at < 3_000) {
			return this.#sessionsCache.sessions;
		}
		const data = await gatewayFetch<{ sessions: ZetaSessionInfo[]; runningSessionIds?: string[] }>("/api/sessions");
		const sessions = data?.sessions ?? [];
		this.#sessionsCache = { at: Date.now(), sessions };
		return sessions;
	}

	async listSessions(_directory?: string): Promise<ZetaSessionInfo[]> {
		return this.#listSessionInfos();
	}

	async getSession(sessionID: string): Promise<Record<string, unknown> | undefined> {
		const infos = await this.#listSessionInfos(true);
		const found = infos.find((info) => info.id === sessionID);
		return found ? zetaSessionToSession(found) : undefined;
	}

	async deleteSession(sessionId: string, _directory?: string): Promise<unknown> {
		this.#sessionsCache = null;
		return gatewayFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
	}

	async updateSession(sessionId: string, patch: Record<string, unknown>, _directory?: string): Promise<unknown> {
		if (typeof patch.name !== "string") throw new NotImplementedError("updateSession(non-name)");
		this.#sessionsCache = null;
		return gatewayFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
			method: "PATCH",
			body: JSON.stringify({ name: patch.name }),
		});
	}

	async createSession(_parentID?: string, _title?: string, directory?: string): Promise<unknown> {
		const cwd = normalizeDir(directory ?? this.#directory);
		if (!cwd) throw new Error("[zeta] createSession requires a directory");
		this.#sessionsCache = null;
		const data = await gatewayFetch<{ sessionId: string }>("/api/agent/new", {
			method: "POST",
			body: JSON.stringify({ cwd, type: "ensure_session" }),
		});
		const infos = await this.#listSessionInfos(true).catch(() => []);
		const found = infos.find((info) => info.id === data?.sessionId);
		return found
			? zetaSessionToSession(found)
			: {
				id: data?.sessionId,
				directory: cwd,
				title: "",
				version: "zeta",
				time: { created: Date.now(), updated: Date.now() },
			};
	}

	// -- config / models / agents -------------------------------------------

	async getProvidersForConfig(directory?: string): Promise<{ providers: unknown[] }> {
		const cwd = normalizeDir(directory ?? this.#directory);
		const urls = [
			...(cwd ? [`/api/models?cwd=${encodeURIComponent(cwd)}`] : []),
			"/api/models",
		];
		for (const url of urls) {
			const data = await gatewayFetch<{
				modelList?: Array<{ id: string; name?: string; provider: string; contextWindow?: number }>;
			}>(url).catch(() => null);
			if (!data?.modelList?.length) continue;
			const byProvider = new Map<string, { id: string; name: string; models: Record<string, unknown> }>();
			for (const model of data.modelList) {
				let provider = byProvider.get(model.provider);
				if (!provider) {
					provider = { id: model.provider, name: model.provider, models: {} };
					byProvider.set(model.provider, provider);
				}
				provider.models[model.id] = { id: model.id, name: model.name ?? model.id, contextWindow: model.contextWindow };
			}
			return { providers: [...byProvider.values()] };
		}
		return { providers: [] };
	}

	// -- chat commands ------------------------------------------------------

	async sendMessage(args: Record<string, unknown>): Promise<unknown> {
		const sessionId = String(args.id ?? args.sessionID ?? "");
		const delivery = args.delivery === "steer" ? "steer" : args.delivery === "followUp" ? "follow_up" : undefined;
		return postCommand(sessionId, delivery
			? { type: delivery, text: args.text ?? "" }
			: { type: "prompt", message: args.text ?? "" });
	}

	async sendCommand(args: Record<string, unknown>): Promise<unknown> {
		const sessionId = String(args.id ?? args.sessionID ?? "");
		const command = String(args.command ?? "").replace(/^\//, "");
		const tail = Array.isArray(args.arguments) && args.arguments.length > 0
			? ` ${(args.arguments as unknown[]).join(" ")}`
			: "";
		return postCommand(sessionId, { type: "prompt", message: `/${command}${tail}` });
	}

	async shellSession(args: Record<string, unknown>): Promise<unknown> {
		const sessionId = String(args.id ?? args.sessionID ?? "");
		return postCommand(sessionId, { type: "bash", command: String(args.command ?? "") });
	}

	async abortSession(sessionId: string, _directory?: string): Promise<unknown> {
		return postCommand(sessionId, { type: "abort" });
	}

	async getSessionMessages(sessionID: string, _directory?: string, _limit?: number): Promise<unknown[]> {
		const data = await gatewayFetch<{
			context?: { messages?: ZetaMessage[]; entryIds?: string[] };
		}>(`/api/sessions/${encodeURIComponent(sessionID)}?deferThinking=1&deferMedia=1`);
		const messages = data?.context?.messages ?? [];
		const toolResults = collectToolResults(messages);
		const records: unknown[] = [];
		let lastUserId = "";
		for (const message of messages) {
			if (message.role === "toolResult") continue;
			const converted = convertZetaMessage(message, sessionID, {
				toolResults,
				parentMessageId: message.role === "user" ? undefined : lastUserId || undefined,
				assumeComplete: true,
			});
			if (message.role === "user") {
				lastUserId = String(converted.info.id);
			}
			records.push(converted);
		}
		return records;
	}

	async replyToPermission(args: Record<string, unknown>): Promise<boolean> {
		await gatewayFetch("/api/extension-ui/response", {
			method: "POST",
			body: JSON.stringify({
				id: args.requestID,
				confirmed: args.reply === "once" || args.reply === "always",
				cancelled: args.reply === "reject",
			}),
		});
		return true;
	}

	async replyToQuestion(args: Record<string, unknown>): Promise<boolean> {
		// The gateway select dialog resolves to a single string; upstream passes
		// opencode's answers matrix — first row, first answer is the selection.
		const answers = Array.isArray(args.answers) ? (args.answers as unknown[][]) : [];
		const value = typeof args.value === "string"
			? args.value
			: String(answers[0]?.[0] ?? "");
		await gatewayFetch("/api/extension-ui/response", {
			method: "POST",
			body: JSON.stringify({ id: args.requestID, value }),
		});
		return true;
	}

	async rejectQuestion(args: Record<string, unknown>): Promise<boolean> {
		await gatewayFetch("/api/extension-ui/response", {
			method: "POST",
			body: JSON.stringify({ id: args.requestID, cancelled: true }),
		});
		return true;
	}


	async listPendingQuestions(_directories: string[]): Promise<unknown[]> {
		return [];
	}

	async listPendingPermissions(_directories: string[]): Promise<unknown[]> {
		return [];
	}


	async listAgents(_directory?: string): Promise<unknown[]> {
		return [];
	}

	/** Latest session for a directory — the command channel needs one. */
	async #sessionForDirectory(directory?: string): Promise<string | null> {
		const target = normalizeDir(directory ?? this.#directory);
		const infos = await this.#listSessionInfos().catch(() => [] as ZetaSessionInfo[]);
		const scoped = target ? infos.filter((info) => normalizeDir(info.cwd) === target) : infos;
		if (scoped.length === 0) return null;
		scoped.sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
		return scoped[0]?.id ?? null;
	}

	async #zetaCommands(directory?: string): Promise<Array<{ name: string; description?: string; source?: string; sourceInfo?: unknown }>> {
		const sessionId = await this.#sessionForDirectory(directory);
		if (!sessionId) return [];
		try {
			const data = await postCommand<{ commands?: Array<{ name: string; description?: string; source?: string; sourceInfo?: unknown }> }>(
				sessionId,
				{ type: "get_commands" },
			);
			return data?.commands ?? [];
		} catch {
			return [];
		}
	}

	async #commandRecords(directory?: string): Promise<Array<Record<string, unknown>>> {
		const commands = await this.#zetaCommands(directory);
		return commands.map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
			source: cmd.source,
			template: undefined,
		}));
	}

	async listCommands(directory?: string | null): Promise<Array<{ name: string; description?: string; agent?: string; model?: string; source?: string }>> {
		return (await this.#commandRecords(directory ?? undefined)).map((cmd) => ({
			name: String(cmd.name),
			description: cmd.description as string | undefined,
			source: cmd.source as string | undefined,
		}));
	}

	async listCommandsWithDetails(directory?: string | null): Promise<Array<{ name: string; description?: string; agent?: string; model?: string; source?: string; template?: string }>> {
		return (await this.#commandRecords(directory ?? undefined)).map((cmd) => ({
			name: String(cmd.name),
			description: cmd.description as string | undefined,
			source: cmd.source as string | undefined,
			template: cmd.template as string | undefined,
		}));
	}

	async getCommandDetails(name: string): Promise<{ name: string; template: string; description?: string; agent?: string; model?: string } | null> {
		const all = await this.listCommandsWithDetails();
		const found = all.find((cmd) => cmd.name === name);
		return found ? { ...found, name, template: found.template ?? "" } : null;
	}

	async listSkillsWithDetails(directory?: string | null): Promise<Array<{ name: string; description?: string; location: string; content?: string }>> {
		const cwd = normalizeDir(directory ?? this.#directory);
		const url = cwd ? `/api/skills?cwd=${encodeURIComponent(cwd)}` : "/api/skills";
		try {
			const res = await fetch(url);
			if (!res.ok) return [];
			const data = await res.json() as { skills?: Array<{ name?: string; description?: string; filePath?: string }> };
			return (data.skills ?? [])
				.filter((skill): skill is { name: string; description?: string; filePath?: string } => typeof skill.name === "string" && skill.name.trim().length > 0)
				.map((skill) => ({
					name: skill.name.trim(),
					description: typeof skill.description === "string" ? skill.description : undefined,
					location: skill.filePath ?? "",
				}))
				.filter((skill) => skill.location.length > 0);
		} catch {
			return [];
		}
	}

	// -----------------------------------------------------------------------
	// Fake SDK surface consumed by the sync system (bootstrap/loader/stores).
	// -----------------------------------------------------------------------

	getSdkClient(): OpencodeClient {
		return buildSdkProxy(this) as unknown as OpencodeClient;
	}

	getScopedSdkClient(directory?: string): OpencodeClient {
		return buildSdkProxy(this, normalizeDir(directory)) as unknown as OpencodeClient;
	}
}

// ---------------------------------------------------------------------------
// SDK proxy — namespaces consumed by bootstrap.ts / loader / stores, backed by
// the service above. Unknown namespaces return rejected envelopes so callers
// fail loudly instead of hanging.
// ---------------------------------------------------------------------------

function buildSdkProxy(service: ZetaGatewayService, scopedDirectory?: string): object {
	const dir = () => scopedDirectory ?? service.getDirectory();

	const sdk = {
		path: {
			get: () => Promise.resolve(okEnvelope({ directory: dir() ?? "/", worktree: dir() ?? "/" })),
		},
		global: {
			config: { get: () => Promise.resolve(okEnvelope({})) },
		},
		project: {
			list: async () => {
				const infos = await service.listSessions();
				const roots = new Set<string>();
				for (const info of infos) roots.add(info.projectRoot || info.cwd);
				return okEnvelope([...roots].map((root) => ({ id: root, worktree: root })));
			},
			current: () => Promise.resolve(okEnvelope({ id: dir() ?? "/" })),
		},
		config: { get: () => Promise.resolve(okEnvelope({})) },
		session: {
			list: async (options?: { directory?: string; limit?: number }) =>
				okEnvelope(toSessionRecords(await service.listSessions(), options?.directory, false, options?.limit)),
			status: async () => {
				const data = await gatewayFetch<{ runningSessionIds?: string[] }>("/api/sessions").catch(() => null);
				const status: Record<string, { type: string }> = {};
				for (const sid of data?.runningSessionIds ?? []) status[sid] = { type: "busy" };
				return okEnvelope(status);
			},
			messages: async (options: { sessionID: string; directory?: string; limit?: number; before?: string }) => {
				const records = await service.getSessionMessages(options.sessionID, options.directory, options.limit);
				return okEnvelope(records);
			},
		},
		experimental: {
			session: {
				list: async (options?: { directory?: string; archived?: boolean; roots?: boolean; limit?: number }) =>
					okEnvelope(toSessionRecords(await service.listSessions(), options?.directory, options?.roots === true, options?.limit)),
			},
		},
		command: {
			list: async () => okEnvelope(await service.listCommands(scopedDirectory)),
		},
		mcp: { status: () => Promise.resolve(okEnvelope({})) },
		lsp: { status: () => Promise.resolve(okEnvelope({})) },
		vcs: { get: () => Promise.resolve(okEnvelope(undefined)) },
		question: {
			list: () => Promise.resolve(okEnvelope([])),
			reply: async (options?: { requestID?: string; answers?: unknown }) =>
				okEnvelope(await service.replyToQuestion({
					requestID: options?.requestID,
					answers: options?.answers,
				})),
			reject: async (options?: { requestID?: string }) =>
				okEnvelope(await service.rejectQuestion({ requestID: options?.requestID })),
		},
		permission: {
			list: () => Promise.resolve(okEnvelope([])),
			reply: async (options?: { requestID?: string; reply?: string }) =>
				okEnvelope(await service.replyToPermission({
					requestID: options?.requestID,
					reply: options?.reply,
				})),
		},
	};

	return new Proxy(sdk, {
		get(target, prop) {
			if (prop in target) return Reflect.get(target, prop, target);
			return () => Promise.resolve({
				data: undefined,
				error: new NotImplementedError(`sdk.${String(prop)}`),
			});
		},
	});
}

/**
 * Build the exported singleton: adapter methods first; every member the
 * adapter does not implement delegates to the wrapped original
 * OpencodeService. Methods bind to the adapter instance so `#private` field
 * access never crosses the proxy.
 */
export function createZetaGatewayClient(inner: object): ZetaGatewayService {
	const service = new ZetaGatewayService(inner);
	return new Proxy(service, {
		get(target, prop) {
			if (prop in target) {
				const value = Reflect.get(target, prop, target);
				return typeof value === "function" ? value.bind(target) : value;
			}
			const innerValue = Reflect.get(inner, prop);
			if (typeof innerValue === "function") {
				return (innerValue as (...args: unknown[]) => unknown).bind(inner);
			}
			return innerValue;
		},
		has(target, prop) {
			return prop in target || prop in inner;
		},
	}) as ZetaGatewayService;
}
