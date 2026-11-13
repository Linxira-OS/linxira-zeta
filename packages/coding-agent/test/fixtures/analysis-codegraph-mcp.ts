#!/usr/bin/env bun
/**
 * Test fixture: a real stdio MCP analysis server with two tools and a
 * server-initiated `notifications/tools/list_changed` after initialization.
 *
 * Used by the analysis-MCP smoke to prove list/change/filter against a
 * process, not a mocked echo. No package install and no network.
 */
import * as readline from "node:readline";

type JsonRpcRequest = {
	jsonrpc: "2.0";
	id?: string | number;
	method: string;
	params?: Record<string, unknown>;
};

const TOOLS = [
	{
		name: "codegraph_explore",
		description: "Explore the local code graph",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "codegraph_status",
		description: "Report code-graph sync status",
		inputSchema: { type: "object", properties: {} },
	},
];

function resultFor(method: string): Record<string, unknown> {
	switch (method) {
		case "initialize":
			return {
				protocolVersion: "2025-11-25",
				serverInfo: { name: "analysis-codegraph-fixture", version: "1.0.0" },
				capabilities: { tools: { listChanged: true } },
			};
		case "tools/list":
			return { tools: TOOLS };
		case "tools/call":
			return {
				content: [{ type: "text", text: '{"nodes":[],"edges":[]}' }],
				isError: false,
			};
		default:
			return {};
	}
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => {
	const trimmed = line.trim();
	if (trimmed.length === 0) return;
	let message: JsonRpcRequest;
	try {
		message = JSON.parse(trimmed) as JsonRpcRequest;
	} catch {
		return;
	}
	if (message.method === "notifications/initialized") {
		process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\n`);
		return;
	}
	if (message.id === undefined || message.id === null) return;
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: resultFor(message.method) })}\n`);
});
rl.on("close", () => process.exit(0));
