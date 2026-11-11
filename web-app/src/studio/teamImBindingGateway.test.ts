/**
 * IM switch client tests: real gateway routes and bodies only. These pin the
 * source of a pending switch (the IM router) and the fail-closed error path;
 * they do not assert copy.
 */
import { describe, expect, test } from "bun:test";
import type { GatewayFetch } from "./settings/gatewayRequest";
import {
  cancelImChatSwitch,
  confirmImChatSwitch,
  loadImChatBindings,
  loadImChatSwitch,
  type ImChatBindingRef,
} from "./teamImBindingGateway";

type Call = { url: string; init?: RequestInit };

function response(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function fetcher(payloads: unknown[], calls: Call[] = []): GatewayFetch {
	return (input: string, init?: RequestInit) => {
		calls.push({ url: input, ...(init === undefined ? {} : { init }) });
		return Promise.resolve(response(payloads.shift()));
	};
}

async function rejectsWith(promise: Promise<unknown>, message: string): Promise<void> {
	try {
		await promise;
	} catch (error) {
		expect(String(error instanceof Error ? error.message : error)).toContain(message);
		return;
	}
	throw new Error(`expected rejection containing ${message}`);
}

const BINDING: ImChatBindingRef = {
	id: "bind-1",
	instanceId: "inst-1",
	chatId: "chat-1",
	threadId: "thread-1",
	userId: "user-1",
};

describe("IM bindings", () => {
	test("reads the identity fields a switch call needs and skips malformed rows", async () => {
		const calls: Call[] = [];
		const rows = await loadImChatBindings(
			fetcher([{ bindings: [{ id: "bind-1", instanceId: "inst-1", chatId: "chat-1", threadId: "t", userId: "u" }, { id: "x" }] }], calls),
		);
		expect(calls[0]?.url).toBe("/api/im/bindings");
		expect(rows).toEqual([{ id: "bind-1", instanceId: "inst-1", chatId: "chat-1", threadId: "t", userId: "u" }]);
	});

	test("a malformed bindings response is an error, not an empty binding list", async () => {
		await rejectsWith(loadImChatBindings(fetcher([{ bindings: "nope" }])), "IM bindings response is malformed");
	});
});

describe("IM switch handshake", () => {
	test("GET /api/im/switch carries the chat identity and parses the pending request", async () => {
		const calls: Call[] = [];
		const state = await loadImChatSwitch(
			BINDING,
			fetcher(
				[
					{
						current: { workspaceAlias: "core", agentId: "pm-core", bindingId: "bind-1", targetKey: "workspace:core" },
						pending: {
							requestId: "req-1",
							operation: "target",
							from: { workspaceAlias: "core", agentId: "pm-core" },
							to: { workspaceAlias: "ops", agentId: "eng-ops" },
							requestedAt: "2026-11-12T01:00:00.000Z",
							controlRecord: { id: "entry-1", metadata: { action: "switch_request" } },
						},
					},
				],
				calls,
			),
		);
		expect(calls[0]?.url).toBe(
			"/api/im/switch?instanceId=inst-1&chatId=chat-1&threadId=thread-1&userId=user-1",
		);
		expect(state.current).toEqual({ workspaceAlias: "core", agentId: "pm-core", bindingId: "bind-1", targetKey: "workspace:core" });
		expect(state.pending).toEqual({
			requestId: "req-1",
			operation: "target",
			from: { workspaceAlias: "core", agentId: "pm-core" },
			to: { workspaceAlias: "ops", agentId: "eng-ops" },
			requestedAt: "2026-11-12T01:00:00.000Z",
			controlRecord: "entry-1",
		});
	});

	test("confirm and cancel post the same identity plus the router's requestId", async () => {
		const calls: Call[] = [];
		const route = fetcher([{ ok: true, target: { workspaceAlias: "ops" } }, { ok: true }], calls);
		await confirmImChatSwitch(BINDING, "req-1", route);
		await cancelImChatSwitch(BINDING, "req-1", route);
		expect(calls.map(call => call.url)).toEqual(["/api/im/switch/confirm", "/api/im/switch/cancel"]);
		const bodies = calls.map(call => JSON.parse(String(call.init?.body)));
		expect(bodies).toEqual([
			{ instanceId: "inst-1", chatId: "chat-1", threadId: "thread-1", userId: "user-1", requestId: "req-1" },
			{ instanceId: "inst-1", chatId: "chat-1", threadId: "thread-1", userId: "user-1", requestId: "req-1" },
		]);
		expect(calls.every(call => call.init?.method === "POST")).toBe(true);
	});

	test("a router refusal is surfaced instead of treated as success", async () => {
		await rejectsWith(
			confirmImChatSwitch(BINDING, "req-1", fetcher([{ ok: false, error: "The pending workspace change expired" }])),
			"The pending workspace change expired",
		);
	});
});
