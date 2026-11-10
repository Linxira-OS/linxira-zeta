#!/usr/bin/env bun
/**
 * Test fixture: a minimal stdio MCP server that records the client's
 * `initialize` params (the outbound `clientInfo` identity) to the file named
 * by argv[2], then answers the handshake.
 *
 * Speaks newline-delimited JSON-RPC 2.0 like `StdioTransport`.
 */
import * as readline from "node:readline";

type JsonRpcRequest = {
	jsonrpc: "2.0";
	id?: string | number;
	method: string;
	params?: Record<string, unknown>;
};

const capturePath = process.argv[2];
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => {
	void (async () => {
		const trimmed = line.trim();
		if (trimmed.length === 0) return;
		let msg: JsonRpcRequest;
		try {
			msg = JSON.parse(trimmed) as JsonRpcRequest;
		} catch {
			return;
		}
		if (msg.id === undefined || msg.id === null) return;
		if (msg.method === "initialize") {
			if (!capturePath) throw new Error("identity-mcp fixture requires a capture path");
			await Bun.write(capturePath, JSON.stringify(msg.params ?? {}));
			const response = {
				jsonrpc: "2.0" as const,
				id: msg.id,
				result: {
					protocolVersion: (msg.params?.protocolVersion as string | undefined) ?? "2025-06-18",
					serverInfo: { name: "identity-mcp-fixture", version: "1.0.0" },
					capabilities: {},
				},
			};
			process.stdout.write(`${JSON.stringify(response)}\n`);
			return;
		}
		process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0" as const, id: msg.id, result: {} })}\n`);
	})();
});
rl.on("close", () => process.exit(0));
