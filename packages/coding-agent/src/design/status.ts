import type { DesignMarker, LoadedDesignMarker } from "./config";
import { readDesignMarker } from "./config";
import { probeDesignMcp, resolveDesignCommand, runDesignCli } from "./transport";

export type DesignStatusLevel = "disabled" | "error" | "cli-missing" | "daemon-down" | "mcp-degraded" | "ready";

export interface DesignStatus {
	level: DesignStatusLevel;
	marker: LoadedDesignMarker;
	cli: {
		command: string;
		found: boolean;
		path?: string;
	};
	daemon: {
		reachable: boolean;
		version?: string;
		error?: string;
	};
	mcp: {
		reachable: boolean;
		tools: number;
		error?: string;
	};
}

function parseDaemonVersion(stdout: string): string | undefined {
	const trimmed = stdout.trim();
	if (!trimmed) return undefined;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (typeof parsed === "string") return parsed;
		if (parsed && typeof parsed === "object") {
			const value = (parsed as Record<string, unknown>).version;
			if (typeof value === "string") return value;
			if (value && typeof value === "object") {
				const nested = (value as Record<string, unknown>).version;
				if (typeof nested === "string") return nested;
			}
		}
	} catch {
		return trimmed.split(/\r?\n/u)[0];
	}
	return undefined;
}

function resolveLevel(
	marker: DesignMarker,
	cliFound: boolean,
	daemonReachable: boolean,
	mcpReachable: boolean,
): DesignStatusLevel {
	if (!marker.enabled) return "disabled";
	if (!cliFound) return "cli-missing";
	if (!daemonReachable) return "daemon-down";
	if (!mcpReachable) return "mcp-degraded";
	return "ready";
}

export async function probeDesignStatus(
	cwd: string,
	options?: { signal?: AbortSignal; includeMcp?: boolean },
): Promise<DesignStatus> {
	const marker = await readDesignMarker(cwd);
	const cliPath = resolveDesignCommand(marker.config.cliCommand);
	const status: DesignStatus = {
		level: "disabled",
		marker,
		cli: { command: marker.config.cliCommand, found: Boolean(cliPath), path: cliPath },
		daemon: { reachable: false },
		mcp: { reachable: false, tools: 0 },
	};
	if (marker.error) {
		status.level = "error";
		return status;
	}
	if (!marker.config.enabled) return status;

	if (cliPath) {
		try {
			const result = await runDesignCli(cwd, marker.config, ["version", "--json"], {
				signal: options?.signal,
				timeout: 15_000,
			});
			if (result.code === 0) {
				status.daemon.reachable = true;
				status.daemon.version = parseDaemonVersion(result.stdout);
			} else {
				status.daemon.error = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
			}
		} catch (error) {
			status.daemon.error = String(error);
		}
	}

	const includeMcp = options?.includeMcp !== false;
	if (includeMcp && status.daemon.reachable) {
		try {
			const tools = await probeDesignMcp(cwd, marker.config, { signal: options?.signal });
			status.mcp.reachable = true;
			status.mcp.tools = tools.length;
		} catch (error) {
			status.mcp.error = String(error);
		}
	} else if (includeMcp) {
		status.mcp.error = "skipped because the daemon is unreachable";
	}

	status.level = resolveLevel(marker.config, status.cli.found, status.daemon.reachable, status.mcp.reachable);
	return status;
}

/** Shared English rendering for tool output; the slash command adds localized framing. */
export function formatDesignStatus(status: DesignStatus): string {
	const lines: string[] = [`OpenDesign: ${status.level}`];
	lines.push(`Config: ${status.marker.path}`);
	if (status.marker.error) lines.push(`Config error: ${status.marker.error}`);
	lines.push(
		status.cli.found
			? `CLI: ${status.cli.command}${status.cli.path && status.cli.path !== status.cli.command ? ` (${status.cli.path})` : ""}`
			: `CLI: ${status.cli.command} (not found)`,
	);
	lines.push(
		status.daemon.reachable
			? `Daemon: ready${status.daemon.version ? ` ${status.daemon.version}` : ""}`
			: `Daemon: unreachable${status.daemon.error ? ` (${status.daemon.error})` : ""}`,
	);
	lines.push(
		status.mcp.reachable
			? `MCP: connected (${status.mcp.tools} tools)`
			: `MCP: unavailable${status.mcp.error ? ` (${status.mcp.error})` : ""}`,
	);
	return lines.join("\n");
}
