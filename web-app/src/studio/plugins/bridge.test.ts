/**
 * Protocol tests for the REQ-055 plugin page bridge.
 *
 * No DOM is needed: both sides are pure functions or take a window-like port.
 * `installPageApi` is exercised by the product iframe, not here.
 */
import { describe, expect, test, vi } from "bun:test";
import {
	MAX_NOTIFY_LENGTH,
	PAGE_MESSAGE_MARKER,
	PluginPageBridge,
	clampResizeHeight,
	installPageApi,
	mapPluginToolFailure,
	parsePageMessage,
	pluginPageSrc,
	pluginViewHref,
	runPluginToolCall,
	type HostToPageMessage,
	type PageContext,
	type PluginCallToolClient,
	type PluginToolRequest,
} from "./bridge";

const ORIGIN = "https://studio.test";

function fakeWindow(): { readonly window: Window; readonly posts: Array<{ message: unknown; targetOrigin: string }> } {
	const posts: Array<{ message: unknown; targetOrigin: string }> = [];
	const window = {
		postMessage(message: unknown, targetOrigin: string) {
			posts.push({ message, targetOrigin });
		},
	} as unknown as Window;
	return { window, posts };
}

function messageEvent(source: unknown, origin: string, data: unknown): MessageEvent {
	return { source, origin, data } as unknown as MessageEvent;
}

function pageMessage(type: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
	return { [PAGE_MESSAGE_MARKER]: 1, v: 1, type, ...fields };
}

const CONTEXT: PageContext = { theme: "dark", language: "en", cwd: "/work/zeta", plugin: "board" };

function createBridge(
	overrides: {
		target?: () => Window | null;
		callTool?: (
			request: PluginToolRequest,
		) => Promise<{ ok: true; value: unknown } | { ok: false; code: "CALL_DENIED" | "CALL_FAILED"; message: string }>;
		subscribe?: (events: readonly string[]) => boolean;
		notify?: (level: "info" | "warning" | "error", message: string) => void;
		resize?: (height: number) => void;
		timeoutMs?: number;
	} = {},
) {
	const notifications: Array<{ level: string; message: string }> = [];
	const resizes: number[] = [];
	const bridge = new PluginPageBridge({
		origin: ORIGIN,
		target: overrides.target ?? (() => null),
		plugin: "board",
		page: "ui/board.html",
		context: () => CONTEXT,
		callTool: overrides.callTool ?? (async () => ({ ok: true, value: null })),
		...(overrides.subscribe === undefined ? {} : { subscribe: overrides.subscribe }),
		notify: overrides.notify ?? ((level, message) => notifications.push({ level, message })),
		resize: overrides.resize ?? (height => resizes.push(height)),
		...(overrides.timeoutMs === undefined ? {} : { timeoutMs: overrides.timeoutMs }),
	});
	return { bridge, notifications, resizes };
}

/** Drain the pending promise chain without sleeping on the clock. */
async function flush(): Promise<void> {
	await new Promise<void>(resolve => setImmediate(resolve));
}

describe("origin and source checks", () => {
	test("ignores a message whose source is not the iframe", () => {
		const iframe = fakeWindow();
		const other = fakeWindow();
		const { bridge } = createBridge({ target: () => iframe.window });
		bridge.handleMessage(messageEvent(other.window, ORIGIN, pageMessage("ready", { version: 1 })), iframe.window);
		expect(iframe.posts).toHaveLength(0);
	});

	test("ignores a message from another origin", () => {
		const iframe = fakeWindow();
		const { bridge } = createBridge({ target: () => iframe.window });
		bridge.handleMessage(
			messageEvent(iframe.window, "https://evil.test", pageMessage("ready", { version: 1 })),
			iframe.window,
		);
		expect(iframe.posts).toHaveLength(0);
	});

	test("ignores foreign payloads that carry no protocol marker", () => {
		const iframe = fakeWindow();
		const { bridge } = createBridge({ target: () => iframe.window });
		bridge.handleMessage(messageEvent(iframe.window, ORIGIN, { hello: "world" }), iframe.window);
		expect(iframe.posts).toHaveLength(0);
	});

	test("accepts the iframe source and replies init + context once", () => {
		const iframe = fakeWindow();
		const { bridge } = createBridge({ target: () => iframe.window });
		const event = messageEvent(iframe.window, ORIGIN, pageMessage("ready", { version: 1 }));
		bridge.handleMessage(event, iframe.window);
		bridge.handleMessage(event, iframe.window);
		expect(iframe.posts).toHaveLength(2);
		const [init, context] = iframe.posts.map(post => post.message as HostToPageMessage);
		expect(init).toMatchObject({ type: "init", version: 1, plugin: "board", page: "ui/board.html" });
		expect(context).toMatchObject({ type: "context", ...CONTEXT });
		expect(iframe.posts.every(post => post.targetOrigin === ORIGIN)).toBe(true);
	});
});

describe("version negotiation", () => {
	test("rejects an envelope with another version", () => {
		const iframe = fakeWindow();
		const { bridge } = createBridge({ target: () => iframe.window });
		bridge.handleMessage(
			messageEvent(iframe.window, ORIGIN, { [PAGE_MESSAGE_MARKER]: 1, v: 2, type: "ready", version: 1 }),
			iframe.window,
		);
		expect(iframe.posts[0]?.message).toMatchObject({ type: "error", code: "UNSUPPORTED_VERSION" });
	});

	test("rejects a page that declares another protocol version", () => {
		const iframe = fakeWindow();
		const { bridge } = createBridge({ target: () => iframe.window });
		bridge.handleMessage(messageEvent(iframe.window, ORIGIN, pageMessage("ready", { version: 2 })), iframe.window);
		expect(iframe.posts[0]?.message).toMatchObject({ type: "error", code: "UNSUPPORTED_VERSION" });
	});

	test("answers an unknown message type with UNKNOWN_MESSAGE and the request id", () => {
		const iframe = fakeWindow();
		const { bridge } = createBridge({ target: () => iframe.window });
		bridge.handleMessage(messageEvent(iframe.window, ORIGIN, pageMessage("dance", { id: "req-9" })), iframe.window);
		expect(iframe.posts[0]?.message).toMatchObject({ type: "error", code: "UNKNOWN_MESSAGE", id: "req-9" });
	});
});

describe("request id correlation", () => {
	test("echoes the callTool id with its result", async () => {
		const iframe = fakeWindow();
		const { bridge } = createBridge({
			target: () => iframe.window,
			callTool: async () => ({ ok: true, value: { content: [] } }),
		});
		bridge.handleMessage(
			messageEvent(iframe.window, ORIGIN, pageMessage("callTool", { id: "call-1", tool: "board.read" })),
			iframe.window,
		);
		await flush();
		expect(iframe.posts[0]?.message).toMatchObject({ type: "result", id: "call-1", value: { content: [] } });
	});

	test("echoes the getContext id with a result", () => {
		const iframe = fakeWindow();
		const { bridge } = createBridge({ target: () => iframe.window });
		bridge.handleMessage(
			messageEvent(iframe.window, ORIGIN, pageMessage("getContext", { id: "ctx-1" })),
			iframe.window,
		);
		expect(iframe.posts[0]?.message).toMatchObject({ type: "result", id: "ctx-1", value: CONTEXT });
	});

	test("times out an unanswered call and rejects it with the id", () => {
		vi.useFakeTimers();
		const iframe = fakeWindow();
		const { bridge } = createBridge({
			target: () => iframe.window,
			callTool: () => new Promise(() => undefined),
			timeoutMs: 5,
		});
		try {
			bridge.handleMessage(
				messageEvent(iframe.window, ORIGIN, pageMessage("callTool", { id: "call-slow", tool: "board.read" })),
				iframe.window,
			);
			vi.advanceTimersByTime(10);
			expect(iframe.posts.at(-1)?.message).toMatchObject({ type: "error", code: "CALL_FAILED", id: "call-slow" });
		} finally {
			bridge.dispose();
			vi.useRealTimers();
		}
	});
});

describe("callTool input and denial mapping", () => {
	test("forwards only plugin/tool/arguments/sessionId to the client", async () => {
		const iframe = fakeWindow();
		let captured: unknown;
		const fakeClient: PluginCallToolClient = {
			command: async (name, input) => {
				expect(name).toBe("plugins.callTool");
				captured = input;
				return { requestId: "rid-1" };
			},
		};
		const { bridge } = createBridge({
			target: () => iframe.window,
			callTool: request =>
				runPluginToolCall({
					client: fakeClient,
					plugin: "board",
					request,
					sessionId: "sess-1",
					wait: async requestId => ({ content: [{ type: "text", text: requestId }] }),
				}),
		});
		bridge.handleMessage(
			messageEvent(
				iframe.window,
				ORIGIN,
				pageMessage("callTool", { id: "call-2", tool: "board.read", arguments: { id: 3 }, secret: "host-key" }),
			),
			iframe.window,
		);
		await flush();
		expect(captured).toEqual({ plugin: "board", tool: "board.read", arguments: { id: 3 }, sessionId: "sess-1" });
		expect(iframe.posts[0]?.message).toMatchObject({
			type: "result",
			id: "call-2",
			value: { content: [{ type: "text", text: "rid-1" }] },
		});
	});

	test("a permission failure becomes CALL_DENIED, not a silent success", async () => {
		const iframe = fakeWindow();
		const fakeClient: PluginCallToolClient = {
			command: async () => {
				throw { code: "CAPABILITY_UNAVAILABLE", message: "Plugin tools are disabled" };
			},
		};
		const { bridge } = createBridge({
			target: () => iframe.window,
			callTool: request =>
				runPluginToolCall({ client: fakeClient, plugin: "board", request, wait: async () => undefined }),
		});
		bridge.handleMessage(
			messageEvent(iframe.window, ORIGIN, pageMessage("callTool", { id: "call-3", tool: "board.write" })),
			iframe.window,
		);
		await flush();
		expect(iframe.posts[0]?.message).toMatchObject({ type: "error", id: "call-3", code: "CALL_DENIED" });
	});

	test("maps denial codes and wording, and everything else to CALL_FAILED", () => {
		expect(mapPluginToolFailure({ code: "EACCES" }).code).toBe("CALL_DENIED");
		expect(mapPluginToolFailure({ message: "Permission denied" }).code).toBe("CALL_DENIED");
		expect(mapPluginToolFailure({ code: "INTERNAL_ERROR", message: "boom" }).code).toBe("CALL_FAILED");
		expect(mapPluginToolFailure(new Error("socket closed")).code).toBe("CALL_FAILED");
		expect(mapPluginToolFailure({ message: "x".repeat(2_000) }).message.length).toBe(500);
	});
});

describe("resize, notify and subscribe", () => {
	test("clamps resize heights to 0..10000", () => {
		expect(clampResizeHeight(-5)).toBe(0);
		expect(clampResizeHeight(99_999)).toBe(10_000);
		expect(clampResizeHeight(Number.NaN)).toBeUndefined();
		expect(clampResizeHeight("400")).toBeUndefined();
	});

	test("delivers clamped page resize requests", () => {
		const iframe = fakeWindow();
		const resizes: number[] = [];
		const { bridge } = createBridge({ target: () => iframe.window, resize: height => resizes.push(height) });
		bridge.handleMessage(
			messageEvent(iframe.window, ORIGIN, pageMessage("resize", { height: 250.9 })),
			iframe.window,
		);
		bridge.handleMessage(messageEvent(iframe.window, ORIGIN, pageMessage("resize", { height: 1e9 })), iframe.window);
		expect(resizes).toEqual([250, 10_000]);
	});

	test("bounds notify text and validates the level", () => {
		const iframe = fakeWindow();
		const notifications: Array<{ level: string; message: string }> = [];
		const { bridge } = createBridge({
			target: () => iframe.window,
			notify: (level, message) => notifications.push({ level, message }),
		});
		bridge.handleMessage(
			messageEvent(iframe.window, ORIGIN, pageMessage("notify", { level: "warning", message: "y".repeat(900) })),
			iframe.window,
		);
		bridge.handleMessage(
			messageEvent(iframe.window, ORIGIN, pageMessage("notify", { level: "loud", message: "no" })),
			iframe.window,
		);
		expect(notifications).toHaveLength(1);
		expect(notifications[0]?.message.length).toBe(MAX_NOTIFY_LENGTH);
		expect(iframe.posts.at(-1)?.message).toMatchObject({ type: "error", code: "INVALID_MESSAGE" });
	});

	test("answers subscribe with UNSUPPORTED_SUBSCRIPTION when no projection exists", () => {
		const iframe = fakeWindow();
		const { bridge } = createBridge({ target: () => iframe.window });
		bridge.handleMessage(
			messageEvent(iframe.window, ORIGIN, pageMessage("subscribe", { events: ["runtime"] })),
			iframe.window,
		);
		expect(iframe.posts[0]?.message).toMatchObject({ type: "error", code: "UNSUPPORTED_SUBSCRIPTION" });
	});

	test("rejects malformed callTool arguments without forwarding them", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		const parsed = parsePageMessage(pageMessage("callTool", { id: "call-4", tool: "board.read", arguments: cyclic }));
		expect(parsed).toMatchObject({ ok: false, code: "INVALID_MESSAGE", id: "call-4" });
	});
});

describe("page URLs", () => {
	test("builds asset and route URLs from safe segments", () => {
		expect(pluginPageSrc("board", "ui/board.html")).toBe("/api/plugin-assets/board/ui/board.html");
		expect(pluginPageSrc("board", "ui/a b.html")).toBe("/api/plugin-assets/board/ui/a%20b.html");
		expect(pluginViewHref("board", "ui/board.html")).toBe("/plugins/view/board/ui/board.html");
	});

	test("refuses traversal and encoded separators", () => {
		expect(pluginPageSrc("board", "../secret.html")).toBeNull();
		expect(pluginPageSrc("board", "ui/../../secret.html")).toBeNull();
		expect(pluginPageSrc("../board", "ui/board.html")).toBeNull();
		expect(pluginPageSrc("board", "ui\\board.html")).toBeNull();
		expect(pluginViewHref("board", "ui/%2e%2e/secret.html")).toBeNull();
		expect(pluginViewHref("board", "ui/\0board.html")).toBeNull();
	});
});

describe("page-side installation", () => {
	test("is exported for the iframe load handler", () => {
		expect(typeof installPageApi).toBe("function");
	});
});
