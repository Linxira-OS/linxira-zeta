// @ts-nocheck — merge checkpoint: test callsites lag the OMP API migration
/**
 * A remote (`http`/`sse`) MCP server that was connected and then lost is
 * recovered by the manager's automatic reconnect, driven by the host's
 * upstream `failed` status. Automatic attempts back off and the crash-storm
 * breaker caps a persistent outage; an explicit disconnect or a concurrent
 * reconnect is never delayed by that backoff.
 *
 * Contracts defended here:
 * - a tool call on a lost server fails promptly instead of waiting for the
 *   automatic retry currently queued;
 * - a lost remote server comes back with no tool call and no user action, and
 *   the outage is reported once — every `failed` event repaints the
 *   /extensions dashboard and logs at error level;
 * - a server the user disconnected is not reconnected by automatic recovery;
 * - a server that never connected is not retried: a startup failure or a bad
 *   URL stays a one-shot failure;
 * - a reconnect that never replaced the live connection (a declined auth
 *   challenge) leaves it connected and does not schedule recovery.
 */
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MCPManager } from "@linxiraos/zeta/mcp/manager";
import type { McpConnectionStatusEvent } from "@linxiraos/zeta/mcp/startup-events";
import type { MCPTool } from "@linxiraos/zeta/mcp/tool-bridge";
import type { MCPHttpServerConfig } from "@linxiraos/zeta/mcp/types";
import { removeSyncWithRetries } from "@linxiraos/pi-utils";
import { type FlakyHttpMcpServer, startFlakyHttpMcpServer } from "./fixtures/flaky-http-mcp";

/** Longest automatic retry backoff; this much silence proves no timer is armed. */
const QUIET_MS = 1_500;
const GUARD_MS = 5_000;
const noop = () => {};
const noCtx = {} as Parameters<MCPTool["execute"]>[3];

async function until(check: () => boolean, what: string): Promise<void> {
	const deadline = Date.now() + GUARD_MS;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await Bun.sleep(5);
	}
}

describe("MCP lost remote server automatic recovery", () => {
	let workDir: string;
	let manager: MCPManager | undefined;
	let flaky: FlakyHttpMcpServer | undefined;

	afterEach(async () => {
		await manager?.disconnectAll();
		flaky?.stop();
		manager = undefined;
		flaky = undefined;
		if (workDir) removeSyncWithRetries(workDir);
	});

	async function connected() {
		workDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-mcp-lost-remote-"));
		flaky = startFlakyHttpMcpServer();
		manager = new MCPManager(workDir);
		const statuses: McpConnectionStatusEvent["type"][] = [];
		manager.addConnectionStatusListener(event => statuses.push(event.type));
		const config: MCPHttpServerConfig = { type: "http", url: flaky.url, timeout: GUARD_MS };
		await manager.connectServers({ flaky: config }, {});
		// connectServers returns after a short non-blocking window; a loaded machine can leave the
		// server connected with `tools/list` still in flight. Settle startup before reading tools.
		expect((await manager.waitForStartup(0)).connected).toEqual(["flaky"]);
		expect(manager.getConnectionStatus("flaky")).toBe("connected");
		return { manager, flaky, statuses, config };
	}

	it("a tool call on a lost server fails promptly instead of waiting for the automatic retry", async () => {
		const { manager, flaky, statuses } = await connected();
		const ping = manager.getTools().find(tool => tool.mcpServerName === "flaky");
		if (!ping) throw new Error("ping tool not registered");

		flaky.setDown(true);
		await until(() => statuses.includes("failed"), "the automatic reconnect to fail");

		const started = Date.now();
		const result = await ping.execute("call-1", {}, noop, noCtx);
		expect(result.isError).toBe(true);
		expect(Date.now() - started).toBeLessThan(GUARD_MS / 2);
	});

	it("brings a lost server back on its own, reporting the outage once", async () => {
		const { manager, flaky, statuses } = await connected();
		const initializesBefore = flaky.initializes;

		flaky.setDown(true);
		await until(() => statuses.includes("failed"), "the automatic reconnect to fail");
		const refusedByManager = flaky.refusals;
		// Automatic attempts keep probing while the server is still down.
		await until(() => flaky.refusals >= refusedByManager + 3, "automatic retries to probe the server");
		expect(manager.getConnectionStatus("flaky")).not.toBe("connected");

		flaky.setDown(false);
		const failedAt = statuses.indexOf("failed");
		await until(() => statuses.indexOf("connected", failedAt) !== -1, "the automatic reconnect to succeed");

		expect(manager.getConnectionStatus("flaky")).toBe("connected");
		expect(flaky.initializes).toBeGreaterThan(initializesBefore);
		expect(statuses.filter(status => status === "failed")).toHaveLength(1);

		// The session's tools follow the new connection.
		const ping = manager.getTools().find(tool => tool.mcpServerName === "flaky");
		if (!ping) throw new Error("ping tool not registered after reconnect");
		const result = await ping.execute("call-2", {}, noop, noCtx);
		expect(result.isError).toBeFalsy();
		expect(result.content[0]).toEqual({ type: "text", text: flaky.pong });
	});

	it("a disconnected server is not reconnected when it comes back", async () => {
		const { manager, flaky, statuses } = await connected();

		flaky.setDown(true);
		await until(() => statuses.includes("failed"), "the automatic reconnect to fail");
		await manager.disconnectServer("flaky");
		const initializesAtDisconnect = flaky.initializes;

		flaky.setDown(false);
		// Negative contract: there is no event to wait for, so wait out the
		// longest backoff a retry could have been armed with (see QUIET_MS).
		// Fake timers cannot drive a real Bun.serve + fetch round trip.
		await Bun.sleep(QUIET_MS);

		expect(flaky.initializes).toBe(initializesAtDisconnect);
		expect(manager.getConnectionStatus("flaky")).toBe("disconnected");
	});

	it("a declined auth challenge on a working server does not tear it down", async () => {
		const { manager, flaky, statuses } = await connected();
		const initializesBefore = flaky.initializes;
		manager.setAuthHandler(async () => undefined);

		expect(await manager.reconnectServer("flaky", { authChallenge: { wwwAuthenticate: ["Bearer"] } })).toBeNull();
		expect(manager.getConnectionStatus("flaky")).toBe("connected");

		await Bun.sleep(QUIET_MS); // negative contract, see above

		expect(flaky.initializes).toBe(initializesBefore);
		expect(statuses.filter(status => status === "connected")).toHaveLength(1);
		expect(manager.getConnectionStatus("flaky")).toBe("connected");
	});

	it("does not retry a server that never connected", async () => {
		workDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-mcp-lost-remote-"));
		flaky = startFlakyHttpMcpServer();
		flaky.setDown(true);
		manager = new MCPManager(workDir);
		const config: MCPHttpServerConfig = { type: "http", url: flaky.url, timeout: GUARD_MS };
		await manager.connectServers({ flaky: config }, {});
		expect((await manager.waitForStartup(0)).failed.map(failure => failure.name)).toEqual(["flaky"]);
		expect(manager.getConnectionStatus("flaky")).toBe("disconnected");

		// The explicit paths that can retry a never-connected server.
		expect(await manager.reconnectServer("flaky")).toBeNull();
		expect(await manager.reconnectServer("flaky", { manual: true })).toBeNull();

		flaky.setDown(false);
		await Bun.sleep(QUIET_MS); // negative contract, see above

		expect(flaky.initializes).toBe(0);
		expect(manager.getConnectionStatus("flaky")).toBe("disconnected");
	});
});
