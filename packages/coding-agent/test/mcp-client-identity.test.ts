/**
 * Outbound identity of the MCP client. ACP clients own the MCP server list a
 * session receives, so `initialize.clientInfo` is visible to those servers (and
 * to hosts that surface connection logs). It must name Zeta, never upstream OMP.
 */
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { connectToServer } from "@linxiraos/zeta/mcp/client";
import type { MCPServerConnection } from "@linxiraos/zeta/mcp/types";

const FIXTURE = path.join(import.meta.dir, "fixtures", "identity-mcp.ts");

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
});

describe("MCP client identity", () => {
	it("sends a Zeta clientInfo during initialize", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-mcp-identity-"));
		cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
		const capture = path.join(root, "initialize.json");

		let connection: MCPServerConnection | undefined;
		try {
			connection = await connectToServer("identity-probe", {
				type: "stdio",
				command: process.execPath,
				args: [FIXTURE, capture],
			});
		} finally {
			await connection?.transport.close();
		}

		const params = (await Bun.file(capture).json()) as {
			clientInfo?: { name?: string; version?: string };
		};
		expect(params.clientInfo).toEqual({ name: "zeta-coding-agent", version: "1.0.0" });
		const wire = JSON.stringify(params);
		expect(wire).not.toMatch(/\bomp\b/i);
		expect(wire).not.toMatch(/oh-my-pi/i);
	});
});
