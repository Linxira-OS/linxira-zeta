/**
 * POST /api/open — opens a terminal, file-manager, or editor at a given path.
 * GET /api/open/options — reports every open target with availability, plus
 * the resolved terminal shell for the platform.
 *
 * Body: { target: "terminal"|"explorer"|"editor"|"terminal-ide"|"terminal-editor", path?, editor? }
 *   path defaults to the current project root when omitted and must remain
 *   inside that project. Desktop requests return a signed path capability for
 *   the Electron host (`file-manager` / `editor:*` targets only); browser
 *   requests and the bundled terminal tools launch through the gateway.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getProjectDir, pathIsWithin } from "@linxiraos/pi-utils";
import {
	defaultProbeContext,
	discoverBin,
	pathImpl,
	whichCommand,
	type OpenProbeContext,
} from "../../utils/bin-discovery";

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

const EXPLORER_CMDS: Record<string, string[]> = {
	win32: ["explorer", "{dir}"],
	darwin: ["open", "{dir}"],
	linux: ["xdg-open", "{dir}"],
};

const EDITOR_CLIS: Record<string, string> = {
	vscode: "code",
	cursor: "cursor",
	codium: "codium",
	windsurf: "windsurf",
	zed: "zed",
};

const EDITOR_LABELS: Record<string, string> = {
	vscode: "VS Code",
	cursor: "Cursor",
	codium: "VSCodium",
	windsurf: "Windsurf",
	zed: "Zed",
};

/** PATH probe order mirrors the bins each bundled npm package installs. */
export const ZETA_IDE_BINS = ["zeta-ide", "zetaide", "zeta-i"] as const;
const ZETA_EDITOR_BINS = ["zeta-editor", "zetaeditor", "zeta-e"] as const;

// --- terminal shell resolution ---

export type TerminalKind = "pwsh" | "git-bash" | "powershell" | "shell" | "bash";

export interface ResolvedTerminal {
	kind: TerminalKind;
	/** Menu label: "PowerShell", "Git Bash", or the shell basename. */
	label: string;
	/** Absolute executable to open. */
	command: string;
	/** Extra argv after `command`. */
	args: string[];
}

/** Common Git-for-Windows install locations for `bin\bash.exe`. */
function gitBashInstallPathsWin32(env: NodeJS.ProcessEnv): string[] {
	const candidates = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"];
	if (env.LOCALAPPDATA) candidates.push(path.win32.join(env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"));
	return candidates;
}

/**
 * bash.exe shipped with a detected git.exe: `Git\cmd\git.exe` resolves to
 * `Git\bin\bash.exe` / `Git\usr\bin\bash.exe`.
 */
function gitBashBesideGitWin32(ctx: OpenProbeContext): string | null {
	const git = whichCommand("git", ctx);
	if (!git) return null;
	const cmdDir = path.win32.dirname(git);
	const installRoot = path.win32.dirname(cmdDir);
	const candidates = [
		path.win32.join(installRoot, "bin", "bash.exe"),
		path.win32.join(installRoot, "usr", "bin", "bash.exe"),
		path.win32.join(cmdDir, "bash.exe"),
	];
	return candidates.find(candidate => ctx.exists(candidate)) ?? null;
}

/**
 * Windows terminal preference chain: `pwsh` (PowerShell 7+) → Git Bash →
 * Windows PowerShell (`powershell.exe`, 5.1). A bare `bash` on PATH is
 * deliberately never chosen — on stock Windows that name resolves to the WSL
 * launcher in System32.
 */
export function resolveTerminalWindows(ctx: OpenProbeContext): ResolvedTerminal | null {
	const pwsh = whichCommand("pwsh", ctx);
	if (pwsh) return { kind: "pwsh", label: "PowerShell", command: pwsh, args: [] };
	const gitBash = gitBashBesideGitWin32(ctx) ?? gitBashInstallPathsWin32(ctx.env).find(p => ctx.exists(p)) ?? null;
	if (gitBash) return { kind: "git-bash", label: "Git Bash", command: gitBash, args: [] };
	const powershell = whichCommand("powershell", ctx);
	if (powershell) return { kind: "powershell", label: "PowerShell", command: powershell, args: [] };
	return null;
}

/** POSIX chain: `$SHELL` when it exists on disk, else `bash` from PATH. */
export function resolveTerminalPosix(ctx: OpenProbeContext): ResolvedTerminal | null {
	const shell = ctx.env.SHELL?.trim();
	if (shell && !shell.includes("\0") && ctx.exists(shell)) {
		return { kind: "shell", label: pathImpl(ctx.platform).basename(shell), command: shell, args: [] };
	}
	const bash = whichCommand("bash", ctx);
	if (bash) return { kind: "bash", label: "bash", command: bash, args: [] };
	return null;
}

export function resolveTerminal(ctx: OpenProbeContext): ResolvedTerminal | null {
	return ctx.platform === "win32" ? resolveTerminalWindows(ctx) : resolveTerminalPosix(ctx);
}

/** Terminal emulator candidates probed on Linux before falling back to `$SHELL`. */
const LINUX_TERMINAL_EMULATORS = ["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal"] as const;

function resolveLinuxTerminalEmulator(ctx: OpenProbeContext): string | null {
	for (const emulator of LINUX_TERMINAL_EMULATORS) {
		const found = whichCommand(emulator, ctx);
		if (found) return found;
	}
	return null;
}

/**
 * argv that opens a window running the resolved shell at `dir`. Windows uses
 * `start` semantics (a fresh console owns the shell); macOS hands the
 * directory to Terminal.app; Linux prefers a terminal emulator with
 * `--working-directory` and falls back to spawning the shell detached.
 */
export function buildTerminalSpawnCommand(
	resolved: ResolvedTerminal,
	dir: string,
	platform: NodeJS.Platform,
	linuxEmulator: string | null = null,
): string[] {
	if (platform === "win32") {
		return ["cmd.exe", "/d", "/s", "/c", "start", "", resolved.command, ...resolved.args];
	}
	if (platform === "darwin") {
		return ["open", "-a", "Terminal", dir];
	}
	if (linuxEmulator) return [linuxEmulator, `--working-directory=${dir}`];
	return [resolved.command, ...resolved.args];
}

// --- editor and bundled-terminal-tool resolution ---

function resolveEditors(ctx: OpenProbeContext): string[] {
	return Object.entries(EDITOR_CLIS)
		.filter(([, cli]) => whichCommand(cli, ctx) !== null)
		.map(([id]) => id);
}

/**
 * Bundled terminal-tool lookup (zeta-ide / zeta-editor) across the unified
 * discovery tiers: ① `ZETA_BIN_DIR` ② PATH ③ npm-form global-bin dirs.
 */
function resolveZetaTool(bins: readonly string[], ctx: OpenProbeContext): string | null {
	return discoverBin(bins, { env: ctx.env, platform: ctx.platform, exists: ctx.exists });
}

// --- process-level probe cache (~60s) so menu requests don't rescan PATH ---

const OPEN_PROBE_TTL_MS = 60_000;

interface ProbeCacheEntry {
	value: unknown;
	expiresAt: number;
}

const probeCache = new Map<string, ProbeCacheEntry>();

function cachedProbe<T>(key: string, ctx: OpenProbeContext, compute: () => T): T {
	const hit = probeCache.get(key);
	if (hit && hit.expiresAt > ctx.now()) return hit.value as T;
	const value = compute();
	probeCache.set(key, { value, expiresAt: ctx.now() + OPEN_PROBE_TTL_MS });
	return value;
}

/** Drops every cached probe result (refreshes availability on the next request). */
export function invalidateOpenProbes(): void {
	probeCache.clear();
}

function cachedTerminal(ctx: OpenProbeContext): ResolvedTerminal | null {
	return cachedProbe("terminal", ctx, () => resolveTerminal(ctx));
}

function cachedLinuxEmulator(ctx: OpenProbeContext): string | null {
	return cachedProbe("linux-emulator", ctx, () => resolveLinuxTerminalEmulator(ctx));
}

function cachedEditors(ctx: OpenProbeContext): string[] {
	return cachedProbe("editors", ctx, () => resolveEditors(ctx));
}

function cachedZetaTool(key: string, bins: readonly string[], ctx: OpenProbeContext): string | null {
	return cachedProbe(key, ctx, () => resolveZetaTool(bins, ctx));
}

// --- options payload ---

export type OpenTargetType = "terminal" | "explorer" | "editor" | "terminal-ide" | "terminal-editor";

export interface OpenTargetOption {
	type: OpenTargetType;
	/** Display label: product/editor name or the resolved shell name. */
	label: string;
	available: boolean;
	/** Gateway-suggested default: the first available target in menu order. */
	default?: boolean;
	/** EDITOR_CLIS id; present when type === "editor". */
	editor?: string;
	/** Resolved absolute executable, when the probe found one. */
	detail?: string;
}

export interface OpenOptionsBody {
	desktop: boolean;
	targets: OpenTargetOption[];
}

function isDesktopHost(): boolean {
	return process.env.ZETA_DESKTOP === "1" && Boolean(process.env.ZETA_DESKTOP_OPEN_SECRET);
}

export function getOpenOptions(desktop: boolean, ctx: OpenProbeContext = defaultProbeContext()): OpenOptionsBody {
	const platform = ctx.platform;
	const terminal = cachedTerminal(ctx);
	const linuxEmulator = platform === "linux" ? cachedLinuxEmulator(ctx) : null;
	const zetaIde = cachedZetaTool("zeta-ide", ZETA_IDE_BINS, ctx);
	const zetaEditor = cachedZetaTool("zeta-editor", ZETA_EDITOR_BINS, ctx);

	const terminalAvailable =
		!desktop &&
		(platform === "darwin"
			? true
			: platform === "win32"
				? terminal !== null
				: linuxEmulator !== null || terminal !== null);
	const explorerAvailable = platform in EXPLORER_CMDS && !desktop;

	// Editors are always listed so the client can gray out the missing ones.
	const availableEditors = desktop ? [] : cachedEditors(ctx);
	const targets: OpenTargetOption[] = [
		{
			type: "terminal",
			label: terminal?.label ?? "Terminal",
			available: terminalAvailable,
			detail: terminal?.command,
		},
		{
			type: "explorer",
			label: platform === "darwin" ? "Finder" : "File Manager",
			available: explorerAvailable,
		},
		...Object.keys(EDITOR_CLIS).map(id => ({
			type: "editor" as const,
			editor: id,
			label: EDITOR_LABELS[id] ?? id,
			available: availableEditors.includes(id),
		})),
		{
			type: "terminal-ide",
			label: "Zeta IDE",
			available: zetaIde !== null,
			detail: zetaIde ?? undefined,
		},
		{
			type: "terminal-editor",
			label: "Zeta Editor",
			available: zetaEditor !== null,
			detail: zetaEditor ?? undefined,
		},
	];
	const firstAvailable = targets.find(target => target.available);
	if (firstAvailable) firstAvailable.default = true;
	return { desktop, targets };
}

function desktopOpenPath(targetPath: string): { path: string; token: string } {
	const secret = process.env.ZETA_DESKTOP_OPEN_SECRET;
	if (!secret) throw new Error("Desktop open bridge is unavailable");
	return {
		path: targetPath,
		token: crypto.createHmac("sha256", secret).update(targetPath).digest("hex"),
	};
}

export async function handleOpenGet(_req: Request): Promise<Response> {
	return json(getOpenOptions(isDesktopHost()));
}

export async function handleOpenPost(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as { target?: string; path?: string; editor?: string };
		const target = body.target ?? "terminal";
		const projectPath = path.resolve(getProjectDir());
		const dir = body.path ? path.resolve(body.path) : projectPath;

		if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
			return json({ error: "Directory does not exist" }, 400);
		}
		if (!pathIsWithin(projectPath, dir)) {
			return json({ error: "Path is outside the selected project" }, 403);
		}

		if (isDesktopHost()) {
			const targetId =
				target === "explorer" ? "file-manager" : target === "editor" ? `editor:${body.editor ?? ""}` : null;
			if (targetId !== null) {
				if (targetId !== "file-manager" && !EDITOR_CLIS[targetId.slice("editor:".length)])
					return json({ error: "Unknown desktop target" }, 400);
				return json(desktopOpenPath(dir));
			}
			// terminal-ide / terminal-editor have no host target id; the gateway
			// process spawns them directly, exactly as for browser clients.
			if (target !== "terminal-ide" && target !== "terminal-editor")
				return json({ error: "Unknown desktop target" }, 400);
		}

		const ctx = defaultProbeContext();
		const platform = os.platform();

		let args: string[] | null = null;

		if (target === "terminal") {
			const resolved = cachedTerminal(ctx);
			if (resolved) {
				const emulator = platform === "linux" ? cachedLinuxEmulator(ctx) : null;
				args = buildTerminalSpawnCommand(resolved, dir, platform, emulator);
			}
		} else if (target === "explorer" && platform in EXPLORER_CMDS) {
			args = EXPLORER_CMDS[platform].map(a => a.replace("{dir}", dir));
		} else if (target === "editor") {
			const editors = cachedEditors(ctx);
			if (editors.length === 0) return json({ error: "no_app_found" }, 404);
			const chosen = body.editor ?? editors[0];
			const cli = EDITOR_CLIS[chosen];
			const resolvedPath = cli ? whichCommand(cli, ctx) : null;
			if (!resolvedPath) return json({ error: `unknown editor: ${chosen}` }, 404);
			args = [resolvedPath, dir];
		} else if (target === "terminal-ide" || target === "terminal-editor") {
			const bins = target === "terminal-ide" ? ZETA_IDE_BINS : ZETA_EDITOR_BINS;
			const resolvedPath = cachedZetaTool(target, bins, ctx);
			if (!resolvedPath) return json({ error: "no_app_found" }, 404);
			args = [resolvedPath];
		}

		if (!args) return json({ error: "no_app_found" }, 404);

		Bun.spawn(args, { cwd: dir, detached: true, stdio: ["ignore", "ignore", "ignore"] });
		return json({ spawned: true });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}
