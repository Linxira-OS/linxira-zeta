/**
 * RPC-over-WebSocket contract: the gateway hosts the same protocol the stdio
 * mode speaks, the client correlates responses, dialog frames reach every
 * attached surface, and closing the socket detaches instead of ending the
 * session.
 *
 * Runs a real gateway and a real session — the seam under test (upgrade auth,
 * hosted runRpcMode, dialog fan-out) lives in the listener, so a fake socket
 * would prove nothing.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThinkingLevel } from "@linxiraos/pi-agent-core/thinking";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { RpcSocketClient } from "../../src/backend/rpc-socket";
import { startWebGateway, type WebGatewayInstance } from "../../src/server/web-gateway";
import { startRpcSession, type AgentSessionWrapper } from "../../src/server/web-gateway/agents";

let work: string;
let gateway: WebGatewayInstance;
let wrapper: AgentSessionWrapper;
let sessionId: string;

beforeAll(async () => {
	work = await mkdtemp(join(tmpdir(), "zeta-rpc-socket-"));
	process.env.ZETA_CONFIG_DIR = `.zeta-rpc-socket-${process.pid}`;
	process.env.ZETA_CODING_AGENT_DIR = join(work, "agent");
	refreshDirsFromEnv();

	// A port the OS just handed out; the gateway refuses 0 (bind-all semantics
	// belong to the operator, not a test).
	const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
	const port = probe.port ?? 0;
	probe.stop(true);

	gateway = await startWebGateway(port);
	const started = await startRpcSession(join(work, "proj"), "", join(work, "proj"));
	wrapper = started.session;
	sessionId = started.realSessionId;
}, 120_000);

afterAll(async () => {
	await gateway?.shutdown();
	// The session still holds its transcript/agent files on Windows; scratch
	// dirs are disposable and removal is best-effort, never a test failure.
	const scratch = [work, join(process.env.HOME ?? process.env.USERPROFILE ?? "", process.env.ZETA_CONFIG_DIR ?? "")];
	for (const dir of scratch) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	delete process.env.ZETA_CONFIG_DIR;
});

function socketUrl(id = sessionId): string {
	return `ws://127.0.0.1:${gateway.port}/api/rpc/ws?sessionId=${id}`;
}

describe("rpc over websocket", () => {
	test("negotiates v2 and correlates get_state with the live session", async () => {
		const client = await RpcSocketClient.connect({ url: socketUrl() });
		try {
			expect(client.ready.protocolVersion).toBe(1);
			expect(client.ready.supportedProtocolVersions).toContain(2);
			const negotiated = await client.call<{ protocolVersion: number }>("negotiate_protocol", {
				protocolVersion: 2,
			});
			expect(negotiated.protocolVersion).toBe(2);
			const state = await client.call<{ sessionId: string }>("get_state");
			expect(state.sessionId).toBe(sessionId);
		} finally {
			client.close();
		}
	}, 30_000);

	test("a dialog reaches the attached client and its answer settles the request", async () => {
		const client = await RpcSocketClient.connect({ url: socketUrl() });
		const seen: Record<string, unknown>[] = [];
		const answered = Promise.withResolvers<Record<string, unknown>>();
		client.onEvent(frame => {
			seen.push(frame);
			if (frame.type === "extension_ui_request" && frame.id === "dialog-1") {
				client.notify({ type: "extension_ui_response", id: "dialog-1", confirmed: true });
			}
		});
		wrapper.registerUiRequest("dialog-1", answered.resolve, () => answered.resolve({ cancelled: true }));
		try {
			wrapper.dispatchUiRequest({
				type: "extension_ui_request",
				id: "dialog-1",
				method: "confirm",
				title: "proceed?",
				message: "continue the run?",
			});
			expect(await answered.promise).toEqual({ confirmed: true });
			const request = seen.find(frame => frame.type === "extension_ui_request");
			expect(request?.title).toBe("proceed?");
		} finally {
			client.close();
		}
	}, 30_000);

	test("state-changing commands land in the live session, not a copy", async () => {
		const client = await RpcSocketClient.connect({ url: socketUrl() });
		try {
			const before = await client.call<{ active: string[] }>("get_tools");
			await client.call("set_thinking_level", { level: ThinkingLevel.Low });
			expect(wrapper.getSession().thinkingLevel).toBe(ThinkingLevel.Low);
			const state = await client.call<{ thinkingLevel?: ThinkingLevel }>("get_state");
			expect(state.thinkingLevel).toBe(ThinkingLevel.Low);

			expect(wrapper.getSession().getPlanModeState()?.enabled).toBeUndefined();
			await client.call("mode_enter", { mode: "plan" });
			expect(wrapper.getSession().getPlanModeState()?.enabled).toBe(true);
			await client.call("mode_exit", { mode: "plan" });
			expect(wrapper.getSession().getPlanModeState()?.enabled).toBeUndefined();

			await client.call("set_tools", { toolNames: [] });
			const cleared = await client.call<{ active: string[] }>("get_tools");
			expect(cleared.active).toEqual([]);
			await client.call("set_tools", { toolNames: before.active });
			const restored = await client.call<{ active: string[] }>("get_tools");
			expect(restored.active).toEqual(before.active);
		} finally {
			client.close();
		}
	}, 30_000);

	test("closing the socket detaches but leaves the session alive", async () => {
		const first = await RpcSocketClient.connect({ url: socketUrl() });
		first.close();
		expect(first.closed).toBe(true);
		expect(wrapper.isAlive()).toBe(true);

		const second = await RpcSocketClient.connect({ url: socketUrl() });
		try {
			const state = await second.call<{ sessionId: string }>("get_state");
			expect(state.sessionId).toBe(sessionId);
		} finally {
			second.close();
		}
	}, 30_000);

	test("unknown sessions are refused before the upgrade", async () => {
		await expect(
			RpcSocketClient.connect({ url: socketUrl("no-such-session"), readyTimeoutMs: 2_000 }),
		).rejects.toThrow();
	}, 10_000);
});
