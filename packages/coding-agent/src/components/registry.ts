/**
 * Companion components shipped with the product: the desktop app, the IDE, the
 * terminal workbench, and the agent runtime itself.
 *
 * A backend hosts one session and every surface is a client of it, so a client
 * (an SDK script, the browser, a remote TUI) needs a way to enumerate and open
 * the other components without knowing the install layout. Resolution covers
 * the three layouts that exist:
 *
 * 1. beside the running executable (Windows zip, installer, AppImage, dev tree)
 * 2. `/usr/lib/zetawork` (Arch package and AppImage: companions off PATH)
 * 3. `PATH` / `ZETA_BIN_DIR` / npm global bins (`discoverBin`)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { RpcComponentId, RpcComponentInfo } from "../modes/rpc/rpc-types";
import { discoverBin } from "../utils/bin-discovery";

interface ComponentSpec {
	id: RpcComponentId;
	/** Installed command name, used for every layout. */
	command: string;
	/** Whether a detached GUI process is a meaningful way to "open" it. */
	openable: boolean;
	/** Why `component_open` refuses it; required when `openable` is false. */
	reason?: string;
}

const COMPONENTS: readonly ComponentSpec[] = [
	{
		id: "zetacode",
		command: "zetacode",
		openable: false,
		reason: "The agent runtime itself; the session you are talking to already runs it.",
	},
	{
		id: "zetawork",
		command: "zetawork",
		openable: false,
		reason: "The terminal workbench needs a terminal; launch it from a shell.",
	},
	{ id: "zetawork-gui", command: "zetawork-gui", openable: true },
	{ id: "zetaide", command: "zetaide", openable: true },
];

export interface ComponentProbeOptions {
	/** The executable whose directory anchors layout 1. */
	execPath?: string;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	exists?: (candidate: string) => boolean;
}

function executableName(command: string, platform: NodeJS.Platform): string {
	return platform === "win32" ? `${command}.exe` : command;
}

/** Resolved absolute path for one component, or null when it is not installed. */
export function resolveComponent(id: RpcComponentId, options: ComponentProbeOptions = {}): string | null {
	const spec = COMPONENTS.find(candidate => candidate.id === id);
	if (!spec) return null;
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const exists = options.exists ?? fs.existsSync;
	const name = executableName(spec.command, platform);
	const dirs = [path.dirname(options.execPath ?? process.execPath)];
	// The Linux release layouts keep every companion in one library directory
	// while only the TUI is on PATH.
	if (platform === "linux") dirs.push("/usr/lib/zetawork");
	for (const dir of dirs) {
		const candidate = path.join(dir, name);
		if (exists(candidate)) return candidate;
	}
	return discoverBin([spec.command], { env, platform, exists });
}

/** Every component with its resolution state, in a stable display order. */
export function listComponents(options: ComponentProbeOptions = {}): RpcComponentInfo[] {
	return COMPONENTS.map(spec => {
		const resolved = resolveComponent(spec.id, options);
		const info: RpcComponentInfo = {
			id: spec.id,
			command: spec.command,
			openable: spec.openable,
			...(resolved ? { path: resolved } : {}),
			...(spec.reason ? { reason: spec.reason } : {}),
		};
		return info;
	});
}

/**
 * Launch an openable component detached from this process. The caller gets the
 * pid; the child is not tracked, because a GUI outliving the session is the
 * point (the tray app keeps running, the IDE window stays open).
 */
export function openComponent(id: RpcComponentId, args: readonly string[] = []): { pid: number } {
	const info = listComponents().find(candidate => candidate.id === id);
	if (!info) throw new Error(`Unknown component: ${String(id)}`);
	if (!info.openable) throw new Error(`${id} cannot be opened: ${info.reason ?? "not a GUI component"}`);
	const executable = info.path ?? resolveComponent(id);
	if (!executable) throw new Error(`${id} is not installed`);
	const child = Bun.spawn([executable, ...args], {
		detached: true,
		stdio: ["ignore", "ignore", "ignore"],
		windowsHide: true,
	});
	child.unref();
	return { pid: child.pid };
}
