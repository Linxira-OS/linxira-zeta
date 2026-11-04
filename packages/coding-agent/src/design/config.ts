import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getProjectAgentDir, isEnoent, isRecord } from "@linxiraos/pi-utils";
import { YAML } from "bun";
import { stringifyYamlConfig } from "@linxiraos/pi-utils/yaml-config";
import { writeFileAtomically } from "../utils/atomic-file";

/** Project-local opt-in file. No user-level equivalent; the switch is per workspace. */
export const DESIGN_MARKER_FILENAME = "design.yml";

export interface DesignMarker {
	enabled: boolean;
	cliCommand: string;
	mcpCommand: string;
	mcpArgs: string[];
}

export interface LoadedDesignMarker {
	path: string;
	exists: boolean;
	config: DesignMarker;
	error?: string;
}

export function defaultDesignMarker(): DesignMarker {
	return {
		enabled: false,
		cliCommand: "od",
		mcpCommand: "od",
		mcpArgs: ["mcp"],
	};
}

export function designMarkerPath(cwd: string): string {
	return path.join(getProjectAgentDir(cwd), DESIGN_MARKER_FILENAME);
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value) || value.some(item => typeof item !== "string")) return undefined;
	return value;
}

/** Read the workspace switch. Invalid content fails closed and reports the parse problem. */
export async function readDesignMarker(cwd: string): Promise<LoadedDesignMarker> {
	const filePath = designMarkerPath(cwd);
	const defaults = defaultDesignMarker();
	let text: string;
	try {
		text = await fs.readFile(filePath, "utf8");
	} catch (error) {
		if (isEnoent(error)) return { path: filePath, exists: false, config: defaults };
		return { path: filePath, exists: false, config: defaults, error: String(error) };
	}

	try {
		const parsed: unknown = YAML.parse(text);
		if (!isRecord(parsed)) {
			return { path: filePath, exists: true, config: defaults, error: "expected a YAML mapping" };
		}
		if (parsed.enabled !== undefined && typeof parsed.enabled !== "boolean") {
			return { path: filePath, exists: true, config: defaults, error: "enabled must be a boolean" };
		}
		const cli = isRecord(parsed.cli) ? parsed.cli : undefined;
		const mcp = isRecord(parsed.mcp) ? parsed.mcp : undefined;
		const cliCommand = cli ? readString(cli.command) : undefined;
		const mcpCommand = mcp ? readString(mcp.command) : undefined;
		const mcpArgs = mcp ? readStringArray(mcp.args) : undefined;
		if (cli && cli.command !== undefined && !cliCommand) {
			return { path: filePath, exists: true, config: defaults, error: "cli.command must be a non-empty string" };
		}
		if (mcp && mcp.command !== undefined && !mcpCommand) {
			return { path: filePath, exists: true, config: defaults, error: "mcp.command must be a non-empty string" };
		}
		if (mcp && mcp.args !== undefined && !mcpArgs) {
			return { path: filePath, exists: true, config: defaults, error: "mcp.args must be an array of strings" };
		}
		return {
			path: filePath,
			exists: true,
			config: {
				enabled: parsed.enabled === true,
				cliCommand: cliCommand ?? defaults.cliCommand,
				mcpCommand: mcpCommand ?? defaults.mcpCommand,
				mcpArgs: mcpArgs ?? defaults.mcpArgs,
			},
		};
	} catch (error) {
		return { path: filePath, exists: true, config: defaults, error: String(error) };
	}
}

export async function isDesignEnabled(cwd: string): Promise<boolean> {
	return (await readDesignMarker(cwd)).config.enabled;
}

export interface DesignMarkerPatch {
	enabled?: boolean;
	cliCommand?: string;
	mcpCommand?: string;
	mcpArgs?: string[];
}

/** Merge only the fields the switch owns; never rewrite unrelated user content. */
export async function writeDesignMarker(cwd: string, patch: DesignMarkerPatch): Promise<LoadedDesignMarker> {
	const current = await readDesignMarker(cwd);
	if (current.error) {
		throw new Error(`Cannot update ${current.path}: ${current.error}`);
	}
	const next: DesignMarker = {
		...current.config,
		enabled: patch.enabled ?? current.config.enabled,
		cliCommand: patch.cliCommand ?? current.config.cliCommand,
		mcpCommand: patch.mcpCommand ?? current.config.mcpCommand,
		mcpArgs: patch.mcpArgs ?? current.config.mcpArgs,
	};
	const serialized = {
		enabled: next.enabled,
		cli: { command: next.cliCommand },
		mcp: { command: next.mcpCommand, args: next.mcpArgs },
	};
	await fs.mkdir(path.dirname(current.path), { recursive: true });
	await writeFileAtomically(current.path, stringifyYamlConfig(serialized), 0o644);
	return { path: current.path, exists: true, config: next };
}
