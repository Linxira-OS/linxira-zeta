/**
 * REQ-055 plugin page bridge — protocol v1.
 *
 * A plugin page runs in a same-origin iframe and talks to the Studio host by
 * `postMessage` only. Both directions use one envelope:
 *
 *   { __zetaPage: 1, v: 1, id?: string, type: string, ... }
 *
 * Page → host (exactly six messages):
 *   ready      { version: 1, capabilities?: string[] }
 *   callTool   { id, tool, arguments? }
 *   getContext { id }
 *   subscribe  { events: string[] }
 *   notify     { level: "info" | "warning" | "error", message }
 *   resize     { height }
 *
 * Host → page:
 *   init    { version: 1, plugin, page }        (once, after ready)
 *   context { theme, language, cwd, plugin }    (after ready)
 *   result  { id, value }
 *   error   { id?, code, message }
 *   event   { name, payload }                   (reserved; no subscription ships)
 *
 * The host accepts a message only when `event.source` is the iframe's
 * `contentWindow` and `event.origin` is the host origin. It never forwards an
 * unrecognised key to the client: `callTool` is rebuilt from the validated
 * `plugin` prop plus the bounded `tool`/`arguments` fields.
 *
 * The page-facing API (`window.__zetaPage`) is installed by the host after the
 * iframe document loads — see `installPageApi`. It is the only surface a page
 * gets; it closes over a `postMessage` to `parent` and nothing else from the
 * host realm.
 */

import type { CommandOptions } from "@linxiraos/studio-contract";
import { isRecord } from "../typeGuards";

/** Protocol version for envelopes, the injected API and READY. */
export const PAGE_PROTOCOL_VERSION = 1 as const;
/** Marker key on every bridge envelope (both directions). */
export const PAGE_MESSAGE_MARKER = "__zetaPage" as const;
/** Global the host installs on the page window. */
export const PAGE_API_KEY = "__zetaPage" as const;

export const PAGE_CALL_TIMEOUT_MS = 10_000;
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const MAX_ARGUMENT_BYTES = 128 * 1024;
export const MAX_RESULT_BYTES = 512 * 1024;
export const MAX_TOOL_NAME_LENGTH = 128;
export const MAX_NOTIFY_LENGTH = 500;
export const MAX_ERROR_LENGTH = 500;
export const MAX_EVENT_NAMES = 32;
export const MAX_EVENT_NAME_LENGTH = 64;
export const MAX_CAPABILITIES = 32;
export const MAX_CAPABILITY_LENGTH = 64;
export const MAX_PLUGIN_LENGTH = 128;
export const MAX_PAGE_LENGTH = 256;
export const MAX_RESIZE_HEIGHT = 10_000;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type PageReadyMessage = {
	readonly __zetaPage: 1;
	readonly v: 1;
	readonly type: "ready";
	readonly version: number;
	readonly capabilities?: readonly string[];
};

export type PageCallToolMessage = {
	readonly __zetaPage: 1;
	readonly v: 1;
	readonly type: "callTool";
	readonly id: string;
	readonly tool: string;
	readonly arguments?: JsonValue;
};

export type PageGetContextMessage = {
	readonly __zetaPage: 1;
	readonly v: 1;
	readonly type: "getContext";
	readonly id: string;
};

export type PageSubscribeMessage = {
	readonly __zetaPage: 1;
	readonly v: 1;
	readonly type: "subscribe";
	readonly events: readonly string[];
};

export type PageNotifyMessage = {
	readonly __zetaPage: 1;
	readonly v: 1;
	readonly type: "notify";
	readonly level: "info" | "warning" | "error";
	readonly message: string;
};

export type PageResizeMessage = {
	readonly __zetaPage: 1;
	readonly v: 1;
	readonly type: "resize";
	readonly height: number;
};

export type PageToHostMessage =
	| PageReadyMessage
	| PageCallToolMessage
	| PageGetContextMessage
	| PageSubscribeMessage
	| PageNotifyMessage
	| PageResizeMessage;

export type HostInitMessage = {
	readonly __zetaPage: 1;
	readonly v: 1;
	readonly type: "init";
	readonly version: typeof PAGE_PROTOCOL_VERSION;
	readonly plugin: string;
	readonly page: string;
};

export type PageContext = {
	readonly theme: string;
	readonly language: string;
	readonly cwd: string;
	readonly plugin: string;
};

export type HostContextMessage = { readonly __zetaPage: 1; readonly v: 1; readonly type: "context" } & PageContext;

export type HostResultMessage = {
	readonly __zetaPage: 1;
	readonly v: 1;
	readonly type: "result";
	readonly id: string;
	readonly value: unknown;
};

export type HostErrorMessage = {
	readonly __zetaPage: 1;
	readonly v: 1;
	readonly type: "error";
	readonly id?: string;
	readonly code: string;
	readonly message: string;
};

export type HostEventMessage = {
	readonly __zetaPage: 1;
	readonly v: 1;
	readonly type: "event";
	readonly name: string;
	readonly payload: unknown;
};

export type HostToPageMessage =
	| HostInitMessage
	| HostContextMessage
	| HostResultMessage
	| HostErrorMessage
	| HostEventMessage;

export type BridgeErrorCode =
	| "UNSUPPORTED_VERSION"
	| "UNKNOWN_MESSAGE"
	| "INVALID_MESSAGE"
	| "UNSUPPORTED_SUBSCRIPTION"
	| "CALL_DENIED"
	| "CALL_FAILED";

/** `plugins.callTool` input, mirroring the host contract. */
export interface PluginCallToolInput {
	readonly plugin: string;
	readonly tool: string;
	readonly arguments?: unknown;
	readonly sessionId?: string;
}

/** `plugins.callTool` result, mirroring the host contract. */
export interface PluginCallToolResult {
	readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
	readonly details?: unknown;
}

/**
 * The one client method a page host needs. The contract command map gains
 * `plugins.callTool` in parallel, so the host narrows to this shape at the
 * boundary instead of casting ad hoc at each call site.
 */
export interface PluginCallToolClient {
	command(
		name: "plugins.callTool",
		input: PluginCallToolInput,
		options?: CommandOptions,
	): Promise<{ readonly requestId: string }>;
}

/** A tool call as the host hands it to the client boundary. */
export type PluginToolRequest = {
	readonly tool: string;
	readonly arguments?: JsonValue;
};

/** Outcome the host maps into a page `result`/`error`. */
export type PluginToolOutcome =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly code: "CALL_DENIED" | "CALL_FAILED"; readonly message: string };

export type ParsedPageMessage =
	| { readonly ok: true; readonly message: PageToHostMessage }
	| { readonly ok: false; readonly code: BridgeErrorCode; readonly message: string; readonly id?: string };

function boundedString(value: unknown, max: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > max) return undefined;
	return trimmed;
}

function boundedText(value: unknown, max: number): string | undefined {
	if (typeof value !== "string") return undefined;
	return value.length > max ? value.slice(0, max) : value;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/** Clamp a page-reported height; `undefined` for anything non-numeric. */
export function clampResizeHeight(value: unknown): number | undefined {
	if (!isFiniteNumber(value)) return undefined;
	return Math.min(MAX_RESIZE_HEIGHT, Math.max(0, Math.floor(value)));
}

function serializedBytes(value: unknown): number {
	try {
		const encoded = JSON.stringify(value);
		return encoded === undefined ? 0 : encoded.length;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

/**
 * Deep-copy a JSON-safe value so the page cannot smuggle a host-realm object
 * (or a function) through the bridge. Returns `undefined` for anything that is
 * not plain JSON, is cyclic, too deep, or too large.
 */
export function cloneJsonValue(value: unknown, depth = 0): JsonValue | undefined {
	if (depth > 32) return undefined;
	if (value === null || typeof value === "boolean" || typeof value === "string") return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (Array.isArray(value)) {
		const out: JsonValue[] = [];
		for (const entry of value) {
			const cloned = cloneJsonValue(entry, depth + 1);
			if (cloned === undefined) return undefined;
			out.push(cloned);
		}
		return out;
	}
	if (typeof value === "object") {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return undefined;
		const out: { [key: string]: JsonValue } = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
			const cloned = cloneJsonValue(entry, depth + 1);
			if (cloned === undefined) return undefined;
			out[key] = cloned;
		}
		return out;
	}
	return undefined;
}

function cloneArguments(value: unknown): JsonValue | undefined {
	const cloned = cloneJsonValue(value);
	if (cloned === undefined) return undefined;
	if (serializedBytes(cloned) > MAX_ARGUMENT_BYTES) return undefined;
	return cloned;
}

/**
 * Validate one raw `postMessage` payload. Foreign messages (no marker) are
 * reported as `undefined` so the caller can ignore them silently; messages
 * that claim the protocol but are invalid get an explicit error code.
 */
export function parsePageMessage(raw: unknown): ParsedPageMessage | undefined {
	if (!isRecord(raw) || raw[PAGE_MESSAGE_MARKER] !== 1) return undefined;
	const id = typeof raw.id === "string" && raw.id.length > 0 && raw.id.length <= 128 ? raw.id : undefined;
	if (serializedBytes(raw) > MAX_MESSAGE_BYTES) {
		return {
			ok: false,
			code: "INVALID_MESSAGE",
			message: "Message is too large",
			...(id === undefined ? {} : { id }),
		};
	}
	if (raw.v !== PAGE_PROTOCOL_VERSION) {
		return {
			ok: false,
			code: "UNSUPPORTED_VERSION",
			message: `Unsupported bridge version: ${String(raw.v)}`,
			...(id === undefined ? {} : { id }),
		};
	}
	const type = raw.type;
	if (typeof type !== "string") {
		return {
			ok: false,
			code: "UNKNOWN_MESSAGE",
			message: "Message type is missing",
			...(id === undefined ? {} : { id }),
		};
	}
	switch (type) {
		case "ready": {
			if (raw.version !== PAGE_PROTOCOL_VERSION) {
				return {
					ok: false,
					code: "UNSUPPORTED_VERSION",
					message: `Unsupported page version: ${String(raw.version)}`,
					...(id === undefined ? {} : { id }),
				};
			}
			let capabilities: readonly string[] | undefined;
			if (raw.capabilities !== undefined) {
				if (!Array.isArray(raw.capabilities) || raw.capabilities.length > MAX_CAPABILITIES) {
					return {
						ok: false,
						code: "INVALID_MESSAGE",
						message: "Invalid capabilities",
						...(id === undefined ? {} : { id }),
					};
				}
				const bounded: string[] = [];
				for (const capability of raw.capabilities) {
					const parsed = boundedString(capability, MAX_CAPABILITY_LENGTH);
					if (parsed === undefined) {
						return {
							ok: false,
							code: "INVALID_MESSAGE",
							message: "Invalid capabilities",
							...(id === undefined ? {} : { id }),
						};
					}
					bounded.push(parsed);
				}
				capabilities = bounded;
			}
			return {
				ok: true,
				message: {
					[PAGE_MESSAGE_MARKER]: 1,
					v: 1,
					type: "ready",
					version: 1,
					...(capabilities === undefined ? {} : { capabilities }),
				},
			};
		}
		case "callTool": {
			if (id === undefined) return { ok: false, code: "INVALID_MESSAGE", message: "callTool requires an id" };
			const tool = boundedString(raw.tool, MAX_TOOL_NAME_LENGTH);
			if (tool === undefined || /[\u0000-\u001f]/.test(tool)) {
				return { ok: false, code: "INVALID_MESSAGE", message: "Invalid tool name", id };
			}
			let args: JsonValue | undefined;
			if (raw.arguments !== undefined) {
				args = cloneArguments(raw.arguments);
				if (args === undefined)
					return { ok: false, code: "INVALID_MESSAGE", message: "Invalid tool arguments", id };
			}
			return {
				ok: true,
				message: {
					[PAGE_MESSAGE_MARKER]: 1,
					v: 1,
					type: "callTool",
					id,
					tool,
					...(args === undefined ? {} : { arguments: args }),
				},
			};
		}
		case "getContext": {
			if (id === undefined) return { ok: false, code: "INVALID_MESSAGE", message: "getContext requires an id" };
			return { ok: true, message: { [PAGE_MESSAGE_MARKER]: 1, v: 1, type: "getContext", id } };
		}
		case "subscribe": {
			if (!Array.isArray(raw.events) || raw.events.length === 0 || raw.events.length > MAX_EVENT_NAMES) {
				return {
					ok: false,
					code: "INVALID_MESSAGE",
					message: "Invalid event list",
					...(id === undefined ? {} : { id }),
				};
			}
			const events: string[] = [];
			for (const event of raw.events) {
				const parsed = boundedString(event, MAX_EVENT_NAME_LENGTH);
				if (parsed === undefined) {
					return {
						ok: false,
						code: "INVALID_MESSAGE",
						message: "Invalid event name",
						...(id === undefined ? {} : { id }),
					};
				}
				events.push(parsed);
			}
			return { ok: true, message: { [PAGE_MESSAGE_MARKER]: 1, v: 1, type: "subscribe", events } };
		}
		case "notify": {
			const level =
				raw.level === "warning" || raw.level === "error" ? raw.level : raw.level === "info" ? "info" : undefined;
			const message = boundedText(raw.message, MAX_NOTIFY_LENGTH);
			if (level === undefined || message === undefined || message.trim().length === 0) {
				return {
					ok: false,
					code: "INVALID_MESSAGE",
					message: "Invalid notify payload",
					...(id === undefined ? {} : { id }),
				};
			}
			return { ok: true, message: { [PAGE_MESSAGE_MARKER]: 1, v: 1, type: "notify", level, message } };
		}
		case "resize": {
			const height = clampResizeHeight(raw.height);
			if (height === undefined) {
				return {
					ok: false,
					code: "INVALID_MESSAGE",
					message: "Invalid resize height",
					...(id === undefined ? {} : { id }),
				};
			}
			return { ok: true, message: { [PAGE_MESSAGE_MARKER]: 1, v: 1, type: "resize", height } };
		}
		default:
			return {
				ok: false,
				code: "UNKNOWN_MESSAGE",
				message: `Unknown message type: ${type}`,
				...(id === undefined ? {} : { id }),
			};
	}
}

/**
 * Map a failed `plugins.callTool` receipt to the page error code.
 *
 * Permission-ish failures (capability unavailable, explicit deny codes, the
 * usual POSIX spellings, or denial wording) become `CALL_DENIED`; everything
 * else is `CALL_FAILED`. The message is always bounded.
 */
export function mapPluginToolFailure(error: unknown): {
	readonly code: "CALL_DENIED" | "CALL_FAILED";
	readonly message: string;
} {
	const record = isRecord(error) ? error : undefined;
	const code = typeof record?.code === "string" ? record.code.toUpperCase() : "";
	const reason = isRecord(record?.reason) ? record.reason : undefined;
	const reasonCode = typeof reason?.code === "string" ? reason.code.toUpperCase() : "";
	const rawMessage =
		typeof record?.message === "string"
			? record.message
			: typeof reason?.message === "string"
				? reason.message
				: typeof error === "string"
					? error
					: error instanceof Error
						? error.message
						: "";
	const message = rawMessage.length > MAX_ERROR_LENGTH ? rawMessage.slice(0, MAX_ERROR_LENGTH) : rawMessage;
	const deniedCodes: Record<string, true> = {
		CALL_DENIED: true,
		PERMISSION_DENIED: true,
		CAPABILITY_UNAVAILABLE: true,
		FORBIDDEN: true,
		UNAUTHORIZED: true,
		EACCES: true,
		EPERM: true,
	};
	if (deniedCodes[code] === true || deniedCodes[reasonCode] === true) {
		return { code: "CALL_DENIED", message: message || "Tool call denied" };
	}
	if (/denied|forbidden|not permitted|permission|unauthorized|not allowed|拒绝|不允许|无权限|未授权/i.test(message)) {
		return { code: "CALL_DENIED", message };
	}
	return { code: "CALL_FAILED", message: message || "Tool call failed" };
}

/**
 * Run `plugins.callTool` for one page request: rebuild the input from the
 * validated fields only, await the terminal receipt, and map failures to the
 * page error codes. `wait` is injected so the caller owns the receipt timeout.
 */
export async function runPluginToolCall(options: {
	readonly client: PluginCallToolClient;
	readonly plugin: string;
	readonly request: PluginToolRequest;
	readonly sessionId?: string;
	readonly wait: (requestId: string) => Promise<unknown>;
}): Promise<PluginToolOutcome> {
	try {
		const handle = await options.client.command("plugins.callTool", {
			plugin: options.plugin,
			tool: options.request.tool,
			...(options.request.arguments === undefined ? {} : { arguments: options.request.arguments }),
			...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
		});
		return { ok: true, value: await options.wait(handle.requestId) };
	} catch (error) {
		return { ok: false, ...mapPluginToolFailure(error) };
	}
}

/**
 * Bound a successful tool result before it crosses the bridge. Oversized or
 * non-serialisable values degrade to a bounded text preview instead of being
 * silently dropped.
 */
export function toPageResult(value: unknown): unknown {
	if (value === undefined) return null;
	try {
		const encoded = JSON.stringify(value);
		if (encoded !== undefined && encoded.length <= MAX_RESULT_BYTES) return value;
	} catch {
		/* fall through to a text preview */
	}
	const preview = typeof value === "string" ? value : String(value);
	return { truncated: true, text: preview.length > 8_000 ? preview.slice(0, 8_000) : preview };
}

/**
 * Encode a plugin/page pair for a URL. Returns `null` for empty, dot, control
 * or separator segments so a crafted route can never escape the asset root.
 */
function encodedPagePath(plugin: string, page: string): string | null {
	const safeSegment = (segment: string): boolean =>
		segment.length > 0 &&
		segment !== "." &&
		segment !== ".." &&
		!segment.includes("/") &&
		!segment.includes("\\") &&
		!segment.includes("\0") &&
		!segment.includes("%");
	if (!safeSegment(plugin) || plugin.length > MAX_PLUGIN_LENGTH) return null;
	if (page.length > MAX_PAGE_LENGTH) return null;
	const segments = page.split("/");
	if (segments.length === 0 || !segments.every(safeSegment)) return null;
	return `${encodeURIComponent(plugin)}/${segments.map(encodeURIComponent).join("/")}`;
}

/** Same-origin asset URL for a plugin page; `null` when a segment is unsafe. */
export function pluginPageSrc(plugin: string, page: string, projectCwd?: string): string | null {
	const path = encodedPagePath(plugin, page);
	if (path === null) return null;
	const base = `/api/plugin-assets/${path}`;
	return projectCwd === undefined || projectCwd === "" ? base : `${base}?cwd=${encodeURIComponent(projectCwd)}`;
}

/** In-app route for a plugin page; `null` when a segment is unsafe. */
export function pluginViewHref(plugin: string, page: string): string | null {
	const path = encodedPagePath(plugin, page);
	return path === null ? null : `/plugins/view/${path}`;
}

export interface PluginPageBridgeOptions {
	/** Host origin. Both `event.origin` and every post target use it. */
	readonly origin: string;
	/** Current iframe `contentWindow`; `null` while unmounted. */
	readonly target: () => Window | null;
	readonly plugin: string;
	readonly page: string;
	readonly context: () => PageContext;
	readonly callTool: (request: PluginToolRequest) => Promise<PluginToolOutcome>;
	/** Return `false` to answer with `UNSUPPORTED_SUBSCRIPTION`. */
	readonly subscribe?: (events: readonly string[]) => boolean;
	readonly notify: (level: "info" | "warning" | "error", message: string) => void;
	readonly resize: (height: number) => void;
	readonly onReady?: () => void;
	readonly timeoutMs?: number;
}

/**
 * Host side of the protocol: validates origin/source, negotiates the version,
 * correlates request ids and bounds every value before it reaches the client.
 */
export class PluginPageBridge {
	private readonly options: PluginPageBridgeOptions;
	private sentInit = false;
	private readonly timers = new Set<ReturnType<typeof setTimeout>>();
	private disposed = false;

	constructor(options: PluginPageBridgeOptions) {
		this.options = options;
	}

	/**
	 * Feed a window `message` event. Ignores foreign messages, mismatched
	 * origins and mismatched sources; everything else is answered on the
	 * bridge channel.
	 */
	handleMessage(event: MessageEvent, source: Window | null): void {
		if (this.disposed) return;
		if (source === null || event.source !== source) return;
		if (event.origin !== this.options.origin) return;
		const parsed = parsePageMessage(event.data);
		if (parsed === undefined) return;
		if (!parsed.ok) {
			this.postError(parsed.code, parsed.message, parsed.id);
			return;
		}
		const message = parsed.message;
		switch (message.type) {
			case "ready":
				if (this.sentInit) return;
				this.sentInit = true;
				this.post({
					[PAGE_MESSAGE_MARKER]: 1,
					v: 1,
					type: "init",
					version: PAGE_PROTOCOL_VERSION,
					plugin: this.options.plugin,
					page: this.options.page,
				});
				this.post({ [PAGE_MESSAGE_MARKER]: 1, v: 1, type: "context", ...this.options.context() });
				this.options.onReady?.();
				return;
			case "callTool":
				this.runCallTool(message);
				return;
			case "getContext":
				this.postResult(message.id, this.options.context());
				return;
			case "subscribe": {
				const accepted = this.options.subscribe?.(message.events) === true;
				if (!accepted) {
					this.postError("UNSUPPORTED_SUBSCRIPTION", "Event subscriptions are not available to plugin pages");
				}
				return;
			}
			case "notify":
				this.options.notify(message.level, message.message);
				return;
			case "resize":
				this.options.resize(message.height);
				return;
		}
	}

	/** Post one host message to the current iframe. */
	post(message: HostToPageMessage): void {
		if (this.disposed) return;
		const target = this.options.target();
		if (target === null) return;
		target.postMessage(message, this.options.origin);
	}

	postResult(id: string, value: unknown): void {
		this.post({ [PAGE_MESSAGE_MARKER]: 1, v: 1, type: "result", id, value });
	}

	postError(code: string, message: string, id?: string): void {
		const bounded = message.length > MAX_ERROR_LENGTH ? message.slice(0, MAX_ERROR_LENGTH) : message;
		this.post({
			[PAGE_MESSAGE_MARKER]: 1,
			v: 1,
			type: "error",
			...(id === undefined ? {} : { id }),
			code,
			message: bounded,
		});
	}

	/** Forget the handshake after a navigation to a fresh document. */
	resetHandshake(): void {
		this.sentInit = false;
	}

	dispose(): void {
		this.disposed = true;
		for (const timer of this.timers) clearTimeout(timer);
		this.timers.clear();
	}

	private runCallTool(message: PageCallToolMessage): void {
		const timeoutMs = this.options.timeoutMs ?? PAGE_CALL_TIMEOUT_MS;
		let settled = false;
		const settle = (action: () => void): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			this.timers.delete(timer);
			action();
		};
		const timer = setTimeout(() => {
			settle(() => this.postError("CALL_FAILED", "Tool call timed out", message.id));
		}, timeoutMs);
		this.timers.add(timer);
		const request: PluginToolRequest =
			message.arguments === undefined
				? { tool: message.tool }
				: { tool: message.tool, arguments: message.arguments };
		void this.options.callTool(request).then(
			outcome => {
				settle(() => {
					if (outcome.ok) this.postResult(message.id, toPageResult(outcome.value));
					else this.postError(outcome.code, outcome.message, message.id);
				});
			},
			(error: unknown) => {
				const mapped = mapPluginToolFailure(error);
				settle(() => this.postError(mapped.code, mapped.message, message.id));
			},
		);
	}
}

/* ------------------------------------------------------------------ */
/* Page side                                                           */
/* ------------------------------------------------------------------ */

export class PageBridgeError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "PageBridgeError";
		this.code = code;
	}
}

type IncomingListener = (message: HostToPageMessage) => void;

interface PendingPageRequest {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: PageBridgeError) => void;
	readonly timer: ReturnType<typeof setTimeout>;
}

export interface ZetaPageApi {
	/** Announce the page and negotiate the protocol version. */
	ready(capabilities?: readonly string[]): void;
	callTool(tool: string, args?: JsonValue): Promise<unknown>;
	getContext(): Promise<PageContext>;
	subscribe(events: readonly string[]): void;
	notify(level: "info" | "warning" | "error", message: string): void;
	on(type: HostToPageMessage["type"], listener: IncomingListener): () => void;
	resize(height?: number): void;
}

declare global {
	interface Window {
		__zetaPage?: ZetaPageApi;
	}
}

const INCOMING_TYPES: Record<string, true> = { init: true, context: true, result: true, error: true, event: true };

function pageEnvelope(type: string): Record<string, unknown> {
	return { [PAGE_MESSAGE_MARKER]: 1, v: 1, type };
}

let pageRequestSequence = 0;

function nextPageRequestId(): string {
	pageRequestSequence += 1;
	return `p${pageRequestSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Install `window.__zetaPage` on the page. Must run inside the iframe's own
 * realm (the host calls it on `load`); it posts only to `parent` with
 * `location.origin` as the target origin and never touches the host realm.
 *
 * Returns a disposer that removes the API, the message listener and the
 * ResizeObserver.
 */
export function installPageApi(win: Window): () => void {
	const parent = win.parent;
	const origin = win.location.origin;
	const pending = new Map<string, PendingPageRequest>();
	const listeners = new Map<string, Set<IncomingListener>>();
	let disposed = false;
	let resizeObserver: ResizeObserver | undefined;
	let lastHeight = -1;

	const post = (message: Record<string, unknown>): void => {
		if (disposed) return;
		parent.postMessage(message, origin);
	};
	const emit = (type: string, message: HostToPageMessage): void => {
		const set = listeners.get(type);
		if (set === undefined) return;
		for (const listener of set) {
			try {
				listener(message);
			} catch {
				/* a page listener must not break the bridge */
			}
		}
	};
	const settle = (id: string, action: (entry: PendingPageRequest) => void): void => {
		const entry = pending.get(id);
		if (entry === undefined) return;
		pending.delete(id);
		clearTimeout(entry.timer);
		action(entry);
	};

	const onMessage = (event: MessageEvent): void => {
		if (disposed) return;
		if (event.source !== parent) return;
		if (event.origin !== origin) return;
		const data = event.data;
		if (!isRecord(data) || data[PAGE_MESSAGE_MARKER] !== 1 || data.v !== 1) return;
		const type = data.type;
		if (typeof type !== "string" || INCOMING_TYPES[type] !== true) return;
		if (type === "result") {
			const id = typeof data.id === "string" ? data.id : "";
			settle(id, entry => entry.resolve(data.value));
		} else if (type === "error") {
			const id = typeof data.id === "string" ? data.id : "";
			const code = typeof data.code === "string" ? data.code : "CALL_FAILED";
			const message = typeof data.message === "string" ? data.message : "Plugin page request failed";
			if (id !== "") settle(id, entry => entry.reject(new PageBridgeError(code, message)));
			emit("error", {
				[PAGE_MESSAGE_MARKER]: 1,
				v: 1,
				type: "error",
				code,
				message,
			});
		} else {
			emit(type, data as HostToPageMessage);
		}
	};

	const request = <T>(type: "callTool" | "getContext", payload: Record<string, unknown>): Promise<T> => {
		if (disposed) return Promise.reject(new PageBridgeError("CALL_FAILED", "Plugin page bridge is closed"));
		const { promise, resolve, reject } = Promise.withResolvers<T>();
		const id = nextPageRequestId();
		const timer = setTimeout(() => {
			const entry = pending.get(id);
			if (entry === undefined) return;
			pending.delete(id);
			entry.reject(new PageBridgeError("CALL_FAILED", "Plugin page request timed out"));
		}, PAGE_CALL_TIMEOUT_MS);
		pending.set(id, { resolve: value => resolve(value as T), reject, timer });
		post({ ...pageEnvelope(type), id, ...payload });
		return promise;
	};

	const measureHeight = (): number => {
		const doc = win.document;
		return Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0, 0);
	};

	const api: ZetaPageApi = Object.freeze({
		ready(capabilities?: readonly string[]): void {
			if (capabilities !== undefined) {
				if (!Array.isArray(capabilities) || capabilities.length > MAX_CAPABILITIES) return;
				if (!capabilities.every(item => boundedString(item, MAX_CAPABILITY_LENGTH) !== undefined)) return;
			}
			post({
				...pageEnvelope("ready"),
				version: PAGE_PROTOCOL_VERSION,
				...(capabilities ? { capabilities: [...capabilities] } : {}),
			});
		},
		callTool(tool: string, args?: JsonValue): Promise<unknown> {
			const toolName = boundedString(tool, MAX_TOOL_NAME_LENGTH);
			if (toolName === undefined) return Promise.reject(new PageBridgeError("INVALID_MESSAGE", "Invalid tool name"));
			const payload: Record<string, unknown> = { tool: toolName };
			if (args !== undefined) payload.arguments = args;
			return request<unknown>("callTool", payload);
		},
		getContext(): Promise<PageContext> {
			return request<PageContext>("getContext", {});
		},
		subscribe(events: readonly string[]): void {
			if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENT_NAMES) return;
			if (!events.every(event => boundedString(event, MAX_EVENT_NAME_LENGTH) !== undefined)) return;
			post({ ...pageEnvelope("subscribe"), events: [...events] });
		},
		notify(level: "info" | "warning" | "error", message: string): void {
			const resolved = level === "warning" || level === "error" ? level : "info";
			const text = boundedText(message, MAX_NOTIFY_LENGTH);
			if (text === undefined || text.trim().length === 0) return;
			post({ ...pageEnvelope("notify"), level: resolved, message: text });
		},
		on(type: HostToPageMessage["type"], listener: IncomingListener): () => void {
			if (INCOMING_TYPES[type] !== true || typeof listener !== "function") return () => undefined;
			let set = listeners.get(type);
			if (set === undefined) {
				set = new Set();
				listeners.set(type, set);
			}
			set.add(listener);
			return () => set?.delete(listener);
		},
		resize(height?: number): void {
			const next = clampResizeHeight(height ?? measureHeight());
			if (next === undefined) return;
			post({ ...pageEnvelope("resize"), height: next });
		},
	});

	win.addEventListener("message", onMessage);
	(win as Window & Record<string, unknown>)[PAGE_API_KEY] = api;

	const ResizeObserverCtor = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
	const pushHeight = (): void => {
		const height = clampResizeHeight(measureHeight());
		if (height === undefined || height === lastHeight) return;
		lastHeight = height;
		post({ ...pageEnvelope("resize"), height });
	};
	if (typeof ResizeObserverCtor === "function") {
		resizeObserver = new ResizeObserverCtor(() => pushHeight());
		if (win.document.documentElement) resizeObserver.observe(win.document.documentElement);
		if (win.document.body) resizeObserver.observe(win.document.body);
	}
	pushHeight();

	return () => {
		disposed = true;
		win.removeEventListener("message", onMessage);
		resizeObserver?.disconnect();
		for (const entry of pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(new PageBridgeError("CALL_FAILED", "Plugin page bridge is closed"));
		}
		pending.clear();
		listeners.clear();
		const global = win as Window & Record<string, unknown>;
		if (global[PAGE_API_KEY] === api) delete global[PAGE_API_KEY];
	};
}
