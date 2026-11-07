"use client";

/**
 * StudioClient over Zeta's gateway.
 *
 * The ported Studio renderer talks to one interface — `StudioClient`
 * (`bootstrap` / `query` / `command` / `subscribe`) — implemented by 249 named
 * operations. This module is the **single** boundary where those names become
 * Zeta HTTP calls, so:
 *
 * - the renderer keeps its own rendering logic and read models unchanged;
 * - the wire stays Zeta's (`/api/agent/:id`, `/api/sessions`, `/api/git/*`, …),
 *   because every handler here is a plain `fetch`;
 * - an operation with no Zeta endpoint is **declared unsupported** and throws
 *   `UnsupportedStudioOperationError`, which the shell catches to omit that
 *   surface instead of painting fixtures.
 *
 * Handler maps are filled in per module. `query`/`command` look the name up,
 * so adding a module means adding entries, not touching the dispatch.
 */

import type {
	ClientBootstrap,
	ClientEvent,
	CommandHandle,
	CommandInput,
	CommandOptions,
	CommandName,
	QueryInput,
	QueryName,
	QueryResult,
	SubscriptionScope,
	StudioClient,
	Unsubscribe,
} from "@/lib/studio-protocol/contract";
import { CLIENT_CONTRACT_VERSION, type ExtensibilityReadModel } from "@/lib/studio-protocol/contract";

/** Thrown when a surface asks for an operation this build does not map yet. */
export class UnsupportedStudioOperationError extends Error {
	constructor(
		readonly kind: "query" | "command",
		readonly name: string,
	) {
		super(`studio ${kind} not mapped to a Zeta endpoint: ${name}`);
		this.name = "UnsupportedStudioOperationError";
	}
}

/** Thrown for a mapped operation whose HTTP call failed. */
export class StudioClientError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "StudioClientError";
	}
}

export type QueryHandler<K extends QueryName = QueryName> = (
	input: QueryInput<K>,
) => Promise<QueryResult<K>>;

export type CommandHandler<K extends CommandName = CommandName> = (
	input: CommandInput<K>,
	options?: CommandOptions,
) => Promise<CommandHandle<K>>;

export interface StudioClientOptions {
	/** Gateway origin; empty means same-origin (the Next proxies). */
	readonly gatewayUrl?: string;
	readonly fetchImpl?: typeof fetch;
	/** Session id the renderer starts on, from the URL or the shell selection. */
	readonly sessionId?: string | null;
	readonly cwd?: string | null;
}

/** Identity payload the gateway already publishes for `serve` discovery. */
interface ServeIdentity {
	app?: string;
	version?: string;
	pid?: number;
	startedAt?: string;
	webUrl?: string;
	statsUrl?: string;
	gatewayUrl?: string | null;
}

/** `/api/skills` DTO subset the renderer needs (see web-gateway/dto.ts). */
interface SkillsResponse {
	skills: Array<{
		name: string;
		description: string;
		disableModelInvocation: boolean;
		sourceInfo?: { source?: string; scope?: string };
	}>;
}

/** `/api/plugins` DTO subset the renderer needs. */
interface PluginsResponse {
	installed: Array<{
		id: string;
		name: string;
		version: string;
		sourceKind: string;
		scope: string;
		enabled: boolean;
		toolItems: string[];
		commandItems: string[];
		hookItems: string[];
		panels: Array<{ id: string; title: string; kind: "list" | "form" | "chart" | "html" }>;
		error?: string;
	}>;
}

export class StudioClientImpl implements StudioClient {
	readonly #gatewayUrl: string;
	readonly #fetch: typeof fetch;
	readonly #queries = new Map<string, QueryHandler>();
	readonly #commands = new Map<string, CommandHandler>();
	readonly #listeners = new Set<(event: ClientEvent) => void>();
	#subscribed = false;
	#sessionId: string | null;
	#cwd: string | null;

	constructor(options: StudioClientOptions = {}) {
		this.#gatewayUrl = (options.gatewayUrl ?? "").replace(/\/+$/, "");
		// `fetch` is a Window method: stored unbound and called as `this.#fetch(...)`
		// Chrome rejects it with "Illegal invocation". Bind the default so every
		// same-origin request (identity, queries, commands, SSE) reaches the server.
		this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
		this.#sessionId = options.sessionId ?? null;
		this.#cwd = options.cwd ?? null;
		// The renderer's capability surfaces call `skills.get` directly; map it to
		// the gateway's disk scan instead of reporting an unsupported operation.
		this.registerQueries({ "skills.get": () => this.#readExtensibility() });
		this.registerCommands({
			"runtime.settings.get": ((input: unknown) => {
				const { keys } = input as { keys?: ReadonlyArray<string> };
				return this.#readRuntimeSettings(keys);
			}) as unknown as CommandHandler,
			"runtime.settings.set": ((input: unknown) => {
				const value = input as { key: string; value: unknown; persist: boolean };
				return this.#writeRuntimeSetting(value);
			}) as unknown as CommandHandler,
		});
	}

	/** GET /api/settings → the runtime settings snapshot the panel expects. */
	async #readRuntimeSettings(keys?: ReadonlyArray<string>): Promise<{ values: Record<string, unknown> }> {
		const response = await this.#request<{ settings: Array<{ path: string; value: unknown }> }>("GET", "/api/settings");
		const wanted = keys === undefined ? undefined : new Set(keys);
		const values: Record<string, unknown> = {};
		for (const entry of response.settings) {
			if (wanted === undefined || wanted.has(entry.path)) values[entry.path] = entry.value;
		}
		return { values };
	}

	/** PUT /api/settings — the same isolated writer + live reload the CLI uses. */
	async #writeRuntimeSetting(input: { key: string; value: unknown; persist: boolean }): Promise<{ key: string; value: unknown; persisted: boolean; effectiveValue?: unknown }> {
		const response = await this.#request<{ ok?: boolean; value?: unknown; error?: string }>("PUT", "/api/settings", {
			path: input.key,
			value: input.value,
		});
		return { key: input.key, value: response.value ?? input.value, persisted: true, effectiveValue: response.value };
	}

	/** GET /api/skills + GET /api/plugins → the renderer's extensibility model. */
	async #readExtensibility(): Promise<ExtensibilityReadModel> {
		const cwd = this.#cwd ?? (await this.#request<{ cwd: string }>("POST", "/api/default-cwd")).cwd;
		const [skills, plugins] = await Promise.all([
			this.#request<SkillsResponse>("GET", `/api/skills?cwd=${encodeURIComponent(cwd)}`),
			this.#request<PluginsResponse>("GET", `/api/plugins?cwd=${encodeURIComponent(cwd)}`),
		]);
		const pluginKinds = ["npm", "marketplace", "link", "git"] as const;
		return {
			skills: skills.skills.map((skill) => {
				const source = skill.sourceInfo?.source ?? "Zeta";
				return {
					name: skill.name,
					desc: skill.description,
					scope: skill.sourceInfo?.scope === "project"
						? ("workspace" as const)
						: skill.sourceInfo?.scope === "builtin"
							? ("builtin" as const)
							: ("global" as const),
					sourceKind: source.toLowerCase().includes("plugin") ? ("plugin" as const) : ("native" as const),
					sourceLabel: source,
					enabled: true,
					hide: false,
				};
			}),
			plugins: plugins.installed.map((plugin) => {
				const kind = (pluginKinds as readonly string[]).includes(plugin.sourceKind)
					? (plugin.sourceKind as (typeof pluginKinds)[number])
					: "npm";
				return {
					name: plugin.id,
					title: plugin.name,
					version: plugin.version,
					sourceKind: kind,
					srcLabel: kind === "marketplace" ? "Marketplace" : kind,
					scope: plugin.scope === "project" ? ("project" as const) : ("user" as const),
					enabled: plugin.enabled,
					status: plugin.error ? ("error" as const) : ("configured" as const),
					tools: plugin.toolItems.length,
					commands: plugin.commandItems.length,
					hooks: plugin.hookItems.length,
					ui: plugin.panels.length > 0,
					toolItems: plugin.toolItems,
					commandItems: plugin.commandItems,
					hookItems: plugin.hookItems,
					uiItems: plugin.panels.map((panel) => panel.title),
					panels: plugin.panels,
					...(plugin.error ? { err: plugin.error } : {}),
				};
			}),
			warnings: [],
			generatedAt: new Date().toISOString(),
		};
	}

	/** Register one module's query handlers. Later registrations win. */
	registerQueries(handlers: Partial<Record<QueryName, QueryHandler>>): void {
		for (const [name, handler] of Object.entries(handlers)) {
			if (handler) this.#queries.set(name, handler as QueryHandler);
		}
	}

	/** Register one module's command handlers. Later registrations win. */
	registerCommands(handlers: Partial<Record<CommandName, CommandHandler>>): void {
		for (const [name, handler] of Object.entries(handlers)) {
			if (handler) this.#commands.set(name, handler as CommandHandler);
		}
	}

	/** Which operations this build answers — surfaced as the capability manifest. */
	supported(): { queries: string[]; commands: string[] } {
		return { queries: [...this.#queries.keys()].sort(), commands: [...this.#commands.keys()].sort() };
	}

	/** The shell keeps the active session here; handlers read it lazily. */
	setSession(sessionId: string | null, cwd: string | null = this.#cwd): void {
		this.#sessionId = sessionId;
		this.#cwd = cwd;
	}

	get sessionId(): string | null {
		return this.#sessionId;
	}

	get cwd(): string | null {
		return this.#cwd;
	}

	async bootstrap(): Promise<ClientBootstrap> {
		const identity = await this.#request<ServeIdentity>("GET", "/api/server/identity").catch(() => ({} as ServeIdentity));
		const { queries, commands } = this.supported();
		return {
			contractVersion: CLIENT_CONTRACT_VERSION,
			// Zeta has one authority per serve process; its identity endpoint is
			// the published proof that the process answering is a Zeta kernel.
			authority: { authorityId: `zeta:${identity.pid ?? 0}` as never, authorityEpoch: 1 as never },
			runtime: {
				status: identity.app === "zeta" ? "connected" : "unavailable",
				classification: identity.app === "zeta" ? "compatible-system" : "unavailable",
				runtimeId: `zeta:${identity.pid ?? 0}` as never,
				runtimeEpoch: 1 as never,
				...(identity.version === undefined ? {} : { runtimeVersion: identity.version }),
			},
			surface: {
				terminalAttach: true,
				fileReveal: true,
				previewInput: false,
				openExternal: true,
			},
			capabilityManifest: {
				profile: "limited",
				generatedAt: new Date().toISOString(),
				hash: `zeta-${identity.version ?? "unknown"}-${queries.length}q${commands.length}c`,
				capabilities: [
					...queries.map(id => ({ id: `query:${id}`, grade: "stable" as const, version: 1, evidence: "query handler" })),
					...commands.map(id => ({
						id: `command:${id}`,
						grade: "stable" as const,
						version: 1,
						evidence: "command handler",
					})),
				],
			},
			commandManifestHash: "zeta",
			selected: {
				sessionId: (this.#sessionId ?? undefined) as never,
			},
		};
	}

	async query<TName extends QueryName>(name: TName, input: QueryInput<TName>): Promise<QueryResult<TName>> {
		const handler = this.#queries.get(name);
		if (!handler) throw new UnsupportedStudioOperationError("query", name);
		return handler(input) as Promise<QueryResult<TName>>;
	}

	async command<TName extends CommandName>(
		name: TName,
		input: CommandInput<TName>,
		options?: CommandOptions,
	): Promise<CommandHandle<TName>> {
		const handler = this.#commands.get(name);
		if (!handler) throw new UnsupportedStudioOperationError("command", name);
		return handler(input, options) as Promise<CommandHandle<TName>>;
	}

	/**
	 * Event stream. Studio's renderer expects a single ordered stream; Zeta
	 * publishes one SSE stream per session (`/api/agent/:id/events`) plus a
	 * running-sessions stream. Both feed the same listener set.
	 */
	subscribe(scope: SubscriptionScope, listener: (event: ClientEvent) => void): Unsubscribe {
		this.#listeners.add(listener);
		if (!this.#subscribed && scope.scope !== "command") {
			this.#subscribed = true;
			void this.#pump();
		}
		return () => {
			this.#listeners.delete(listener);
		};
	}

	async close(): Promise<void> {
		this.#listeners.clear();
		this.#subscribed = false;
	}

	// --- transport ---------------------------------------------------------

	/** Shared JSON request helper: same-origin by default. */
	readonly requestJson = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
		return this.#request<T>(method, path, body);
	};

	/** `GET` with a query string, for the handler maps. */
	readonly get = <T>(path: string, query?: Record<string, string | number | boolean | null | undefined>): Promise<T> => {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(query ?? {})) {
			if (value !== null && value !== undefined) params.set(key, String(value));
		}
		const suffix = params.size ? `?${params.toString()}` : "";
		return this.#request<T>("GET", `${path}${suffix}`);
	};

	/** `POST` with a JSON body, for the handler maps. */
	readonly post = <T>(path: string, body?: unknown): Promise<T> => this.#request<T>("POST", path, body);

	async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const init: RequestInit = { method, cache: "no-store" };
		if (body !== undefined) {
			init.body = JSON.stringify(body);
			init.headers = { "Content-Type": "application/json" };
		}
		if (this.#cwd) {
			init.headers = { ...(init.headers as Record<string, string> | undefined), "x-zeta-cwd": this.#cwd };
		}
		let response: Response;
		try {
			response = await this.#fetch(`${this.#gatewayUrl}${path}`, init);
		} catch (cause) {
			throw new StudioClientError(cause instanceof Error ? cause.message : String(cause));
		}
		if (!response.ok) {
			const payload = (await response.json().catch(() => ({}))) as { error?: string };
			throw new StudioClientError(payload.error ?? `${method} ${path}: HTTP ${response.status}`, response.status);
		}
		if (response.status === 204) return undefined as T;
		const text = await response.text();
		return (text ? JSON.parse(text) : undefined) as T;
	}

	/** Translate Zeta's per-session SSE frames into the renderer's event shape. */
	async #pump(): Promise<void> {
		while (this.#subscribed) {
			const sessionId = this.#sessionId;
			if (!sessionId) {
				await sleep(500);
				continue;
			}
			try {
				const response = await this.#fetch(
					`${this.#gatewayUrl}/api/agent/${encodeURIComponent(sessionId)}/events`,
					{ headers: { accept: "text/event-stream" }, cache: "no-store" },
				);
				if (!response.ok || !response.body) {
					await sleep(1000);
					continue;
				}
				await readSse(response.body, frame => {
					const event = toClientEvent(frame, sessionId);
					if (!event) return;
					for (const listener of this.#listeners) listener(event);
				});
			} catch {
				await sleep(1000);
			}
		}
	}
}

function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

/**
 * SSE reader. `zeta` frames are `data: {...}` JSON objects of shape
 * `{ type, ... }`; the renderer wants `{ type, payload }` with a session tag,
 * so the mapping is explicit rather than a passthrough.
 */
async function readSse(body: ReadableStream<Uint8Array>, onFrame: (payload: Record<string, unknown>) => void): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) return;
		buffer += decoder.decode(value, { stream: true });
		let index = buffer.indexOf("\n\n");
		while (index >= 0) {
			const chunk = buffer.slice(0, index);
			buffer = buffer.slice(index + 2);
			const data = chunk
				.split("\n")
				.filter(line => line.startsWith("data:"))
				.map(line => line.slice(5).trim())
				.join("");
			if (data) {
				try {
					onFrame(JSON.parse(data) as Record<string, unknown>);
				} catch {
					// A malformed frame is dropped rather than killing the stream.
				}
			}
			index = buffer.indexOf("\n\n");
		}
	}
}

/** `{type, ...fields}` (gateway) → `{type, payload, sessionId}` (renderer). */
function toClientEvent(frame: Record<string, unknown>, sessionId: string): ClientEvent | null {
	const type = typeof frame.type === "string" ? frame.type : null;
	if (!type) return null;
	const payload = { ...frame };
	delete payload.type;
	return { type: "snapshot" as never, payload: { ...payload, sessionId, kind: type } } as unknown as ClientEvent;
}
