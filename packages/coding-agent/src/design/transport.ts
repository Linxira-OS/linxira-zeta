import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@linxiraos/pi-utils";
import { execCommand, type ExecResult } from "../exec/exec";
import { callTool, connectToServer, disconnectServer, listTools } from "../mcp/client";
import type { MCPStdioServerConfig, MCPToolCallResult, MCPToolDefinition } from "../mcp/types";
import type { DesignMarker } from "./config";

const CONNECT_TIMEOUT_MS = 12_000;
const CLI_TIMEOUT_MS = 120_000;

function keyFor(cwd: string, marker: DesignMarker): string {
	return [cwd, marker.mcpCommand, ...marker.mcpArgs].join("\0");
}

/** Resolve a bare command through PATH, or verify an explicit path. */
export function resolveDesignCommand(command: string): string | undefined {
	const trimmed = command.trim();
	if (!trimmed) return undefined;
	if (path.isAbsolute(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) {
		return fs.existsSync(trimmed) ? trimmed : undefined;
	}
	return Bun.which(trimmed) ?? undefined;
}

export function designMcpConfig(cwd: string, marker: DesignMarker): MCPStdioServerConfig {
	const command = resolveDesignCommand(marker.mcpCommand);
	if (!command) {
		throw new Error(`OpenDesign MCP command not found: ${marker.mcpCommand}. Set mcp.command in .zeta/design.yml.`);
	}
	return {
		type: "stdio",
		command,
		args: marker.mcpArgs,
		cwd,
		timeout: CONNECT_TIMEOUT_MS,
	};
}

interface ConnectionEntry {
	connection?: Awaited<ReturnType<typeof connectToServer>>;
	connecting?: Promise<Awaited<ReturnType<typeof connectToServer>>>;
}

const connections = new Map<string, ConnectionEntry>();

async function getDesignConnection(cwd: string, marker: DesignMarker) {
	const key = keyFor(cwd, marker);
	let entry = connections.get(key);
	if (!entry) {
		entry = {};
		connections.set(key, entry);
	}
	if (entry.connection?.transport.connected) return entry.connection;
	entry.connection = undefined;
	if (entry.connecting) return await entry.connecting;
	const config = designMcpConfig(cwd, marker);
	const connecting = connectToServer("open-design", config, { signal: undefined });
	entry.connecting = connecting;
	try {
		const connection = await connecting;
		entry.connection = connection;
		return connection;
	} catch (error) {
		if (connections.get(key) === entry) connections.delete(key);
		throw error;
	} finally {
		if (entry.connecting === connecting) entry.connecting = undefined;
	}
}

/** One live connection per workspace so collect_brief/confirm_brief share their draft store. */
export async function callDesignMcp(
	cwd: string,
	marker: DesignMarker,
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<MCPToolCallResult> {
	const connection = await getDesignConnection(cwd, marker);
	return callTool(connection, toolName, args, { signal });
}

/** Ephemeral connection for status: never leaves a daemon or child behind. */
export async function probeDesignMcp(
	cwd: string,
	marker: DesignMarker,
	options?: { signal?: AbortSignal },
): Promise<MCPToolDefinition[]> {
	const connection = await connectToServer("open-design", designMcpConfig(cwd, marker), {
		signal: options?.signal,
	});
	try {
		return await listTools(connection, { signal: options?.signal });
	} finally {
		await disconnectServer(connection).catch(error => {
			logger.warn("OpenDesign MCP probe disconnect failed", { error: String(error) });
		});
	}
}

export async function runDesignCli(
	cwd: string,
	marker: DesignMarker,
	args: string[],
	options?: { signal?: AbortSignal; timeout?: number },
): Promise<ExecResult> {
	const command = resolveDesignCommand(marker.cliCommand);
	if (!command) {
		throw new Error(`OpenDesign CLI not found: ${marker.cliCommand}. Set cli.command in .zeta/design.yml.`);
	}
	return execCommand(command, args, cwd, {
		signal: options?.signal,
		timeout: options?.timeout ?? CLI_TIMEOUT_MS,
	});
}

/** Close cached MCP children. Pass `cwd` to close only that workspace; omit on shutdown. */
export async function closeDesignConnections(cwd?: string): Promise<void> {
	const prefix = cwd ? `${cwd}\0` : undefined;
	const entries = [...connections.entries()].filter(([key]) => !prefix || key.startsWith(prefix));
	for (const [key] of entries) connections.delete(key);
	await Promise.all(
		entries.map(async ([, entry]) => {
			if (entry.connecting) {
				await entry.connecting.catch(() => {});
			}
			if (entry.connection) {
				await disconnectServer(entry.connection).catch(error => {
					logger.warn("OpenDesign MCP disconnect failed", { error: String(error) });
				});
			}
		}),
	);
}
