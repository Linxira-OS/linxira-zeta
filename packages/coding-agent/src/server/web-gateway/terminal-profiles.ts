/**
 * Shell profiles for the embedded terminal (Work Studio browser panes).
 *
 * A profile is a *local* program the gateway is allowed to spawn: the closed
 * set is built here, from PATH and well-known install locations, or from the
 * explicitly configured `ZETA_TERMINAL_CUSTOM_PROFILES`. A client only ever
 * names a profile id; it never supplies an executable path (terminal.ts
 * functions stay the only place a PTY is spawned).
 *
 * Discovery rules, per platform:
 *
 * - win32: PowerShell 7 (`pwsh`), Windows PowerShell (`powershell.exe`),
 *   `cmd.exe`, Git Bash, Nushell (`nu`), then the distros `wsl.exe -l -q`
 *   reports. WSL probes run hidden (`windowsHide`) so opening Work Studio never
 *   flashes a console window.
 * - POSIX: `$SHELL` first (it is the user's default), then bash, zsh, fish and
 *   nu. No WSL profiles: `wsl.exe` is a Windows host concept.
 *
 * Nothing is faked: a shell that is not installed is absent from the catalog,
 * and Azure Cloud Shell is only present when a custom profile names the local
 * client that reaches it (it is a remote session, not a local shell).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { whichCommand, type OpenProbeContext } from "../../utils/bin-discovery";

/** Explicit custom profile configuration: a JSON array, see {@link parseCustomProfiles}. */
export const CUSTOM_PROFILES_ENV = "ZETA_TERMINAL_CUSTOM_PROFILES";

/** Catalog lifetime for the default probe context (avoids respawning `wsl.exe`). */
const CATALOG_TTL_MS = 30_000;

export type ShellProfileKind =
	| "pwsh"
	| "powershell"
	| "cmd"
	| "git-bash"
	| "nu"
	| "wsl"
	| "bash"
	| "zsh"
	| "fish"
	| "sh"
	| "custom";

/** Icon token the renderer maps to its own icon set (never a path). */
export type ShellProfileIcon = "terminal" | "powershell" | "cmd" | "git-bash" | "nu" | "wsl" | "bash" | "zsh" | "fish";

export interface TerminalShellProfile {
	/** Stable id: `pwsh`, `wsl:ubuntu-22.04`, `custom:azure`, … */
	id: string;
	label: string;
	kind: ShellProfileKind;
	/** Absolute executable, discovered on the server. */
	command: string;
	args: string[];
	/** `detected` = found on this machine; `custom` = explicitly configured. */
	source: "detected" | "custom";
	icon: ShellProfileIcon;
	/** Extra detail for the picker (WSL distro, `$SHELL` label), never a secret. */
	detail?: string;
	cwd?: string;
	env?: Record<string, string>;
}

export interface ShellProfileCatalog {
	profiles: TerminalShellProfile[];
	defaultProfileId: string | null;
	platform: NodeJS.Platform;
	/** Configuration problems worth surfacing (never silently swallowed). */
	warnings: string[];
}

/** Injectable process probe: `run` is used only for `wsl.exe -l -q`. */
export interface ShellProbeContext extends OpenProbeContext {
	run?: (command: string, args: string[]) => { ok: boolean; stdout: Buffer } | { ok: false; stdout: Buffer };
}

export function defaultShellProbeContext(): ShellProbeContext {
	return {
		platform: process.platform,
		env: process.env,
		exists: candidate => {
			try {
				return fs.existsSync(candidate);
			} catch {
				return false;
			}
		},
		now: () => Date.now(),
		run: (command, args) => {
			try {
				const result = spawnSync(command, args, {
					timeout: 5_000,
					windowsHide: true,
					encoding: "buffer",
					stdio: ["ignore", "pipe", "ignore"],
				});
				return { ok: result.status === 0, stdout: result.stdout ?? Buffer.alloc(0) };
			} catch {
				return { ok: false, stdout: Buffer.alloc(0) };
			}
		},
	};
}

// --- helpers ---

function envValue(env: NodeJS.ProcessEnv, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = env[key];
		if (typeof value === "string" && value.trim().length > 0) return value.trim();
	}
	return undefined;
}

function firstExisting(exists: (candidate: string) => boolean, candidates: Array<string | undefined>): string | null {
	for (const candidate of candidates) {
		if (candidate && exists(candidate)) return candidate;
	}
	return null;
}

// --- WSL ---

/**
 * Decode `wsl.exe -l -q` output. When stdout is not a console, wsl.exe writes
 * UTF-16LE (with NUL bytes); interactive runs write UTF-8. Both are accepted.
 */
export function decodeWslOutput(raw: Buffer | Uint8Array | string): string {
	if (typeof raw === "string") return raw;
	const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
	if (bytes.length === 0) return "";
	let nulOdd = 0;
	let nulEven = 0;
	for (let i = 0; i < bytes.length; i++) {
		if (bytes[i] === 0) {
			if (i % 2 === 0) nulEven++;
			else nulOdd++;
		}
	}
	if (nulOdd > bytes.length / 8 && nulOdd >= nulEven) return Buffer.from(bytes).toString("utf16le");
	return Buffer.from(bytes).toString("utf8");
}

/** Distro names from `wsl.exe -l -q`, without locale-specific warning lines. */
export function parseWslDistros(raw: Buffer | Uint8Array | string): string[] {
	const lines = decodeWslOutput(raw)
		.replace(/^\uFEFF/, "")
		.split(/\r?\n/)
		.map(line => line.replace(/\0/g, "").trim())
		.filter(line => line.length > 0)
		.filter(line => !/[。.]$/.test(line))
		.filter(line => !/(subsystem|子系统|サブシステム|distributions? (?:are|is) not installed)/i.test(line))
		.filter(line => !line.startsWith("wsl:"));
	const seen = new Set<string>();
	const distros: string[] = [];
	for (const line of lines) {
		const key = line.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		distros.push(line);
	}
	return distros;
}

function wslProfileId(distro: string, used: Set<string>): string {
	const slug =
		distro
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "distro";
	let id = `wsl:${slug}`;
	let suffix = 2;
	while (used.has(id)) id = `wsl:${slug}-${suffix++}`;
	return id;
}

// --- custom profiles ---

const CUSTOM_ID_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const SHELL_KINDS: ReadonlySet<string> = new Set([
	"pwsh",
	"powershell",
	"cmd",
	"git-bash",
	"nu",
	"wsl",
	"bash",
	"zsh",
	"fish",
	"sh",
	"custom",
]);
const SHELL_ICONS: ReadonlySet<string> = new Set([
	"terminal",
	"powershell",
	"cmd",
	"git-bash",
	"nu",
	"wsl",
	"bash",
	"zsh",
	"fish",
]);

function asStringRecord(value: unknown): Record<string, string> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const out: Record<string, string> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (typeof item !== "string" || key.length === 0 || key.includes("=") || key.includes("\0")) continue;
		out[key] = item;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Parse `ZETA_TERMINAL_CUSTOM_PROFILES` (JSON array). A custom entry is the
 * only way to expose something that is not discovered above — e.g. the local
 * client of a remote shell. Every field is validated; invalid entries become
 * warnings, never a silently different command.
 */
export function parseCustomProfiles(
	raw: string | undefined,
	exists: (candidate: string) => boolean,
): { profiles: TerminalShellProfile[]; warnings: string[] } {
	const profiles: TerminalShellProfile[] = [];
	const warnings: string[] = [];
	const trimmed = raw?.trim();
	if (!trimmed) return { profiles, warnings };
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (error) {
		warnings.push(
			`${CUSTOM_PROFILES_ENV} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
		return { profiles, warnings };
	}
	if (!Array.isArray(parsed)) {
		warnings.push(`${CUSTOM_PROFILES_ENV} must be a JSON array`);
		return { profiles, warnings };
	}
	const used = new Set<string>();
	for (const [index, entry] of parsed.entries()) {
		const where = `${CUSTOM_PROFILES_ENV}[${index}]`;
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			warnings.push(`${where} is not an object`);
			continue;
		}
		const record = entry as Record<string, unknown>;
		const id = typeof record.id === "string" ? record.id.trim() : "";
		const label = typeof record.label === "string" ? record.label.trim() : "";
		const command = typeof record.command === "string" ? record.command.trim() : "";
		if (!CUSTOM_ID_RE.test(id)) {
			warnings.push(`${where}.id must match ${CUSTOM_ID_RE.source}`);
			continue;
		}
		if (used.has(id)) {
			warnings.push(`${where}.id "${id}" is duplicated`);
			continue;
		}
		if (!label) {
			warnings.push(`${where}.label is required`);
			continue;
		}
		if (!command || command.includes("\0")) {
			warnings.push(`${where}.command is required`);
			continue;
		}
		if (!exists(command)) {
			warnings.push(`${where}.command does not exist: ${command}`);
			continue;
		}
		const args = Array.isArray(record.args)
			? record.args.filter((arg): arg is string => typeof arg === "string" && !arg.includes("\0"))
			: [];
		const kind =
			typeof record.kind === "string" && SHELL_KINDS.has(record.kind) ? (record.kind as ShellProfileKind) : "custom";
		const icon =
			typeof record.icon === "string" && SHELL_ICONS.has(record.icon)
				? (record.icon as ShellProfileIcon)
				: "terminal";
		const cwd = typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : undefined;
		const env = asStringRecord(record.env);
		used.add(id);
		profiles.push({
			id: `custom:${id}`,
			label,
			kind,
			command,
			args,
			source: "custom",
			icon,
			...(cwd ? { cwd } : {}),
			...(env ? { env } : {}),
		});
	}
	return { profiles, warnings };
}

// --- discovery ---

interface ProfileBuilder {
	profiles: TerminalShellProfile[];
	seenIds: Set<string>;
	seenCommands: Set<string>;
}

function addProfile(builder: ProfileBuilder, platform: NodeJS.Platform, profile: TerminalShellProfile): void {
	// `wsl.exe` is one executable for every distro; the argv is what makes two
	// profiles different, so the dedupe key includes it.
	const command = platform === "win32" ? profile.command.toLowerCase() : profile.command;
	const key = `${command}\u0000${profile.args.join("\u0000")}`;
	if (builder.seenIds.has(profile.id) || builder.seenCommands.has(key)) return;
	builder.seenIds.add(profile.id);
	builder.seenCommands.add(key);
	builder.profiles.push(profile);
}

function detectCommand(ctx: ShellProbeContext, names: string[]): string | null {
	for (const name of names) {
		const found = whichCommand(name, ctx);
		if (found) return found;
	}
	return null;
}

function windowsProfiles(ctx: ShellProbeContext, builder: ProfileBuilder): void {
	const env = ctx.env;
	const programFiles = envValue(env, "ProgramW6432", "ProgramFiles");
	const programFilesX86 = envValue(env, "ProgramFiles(x86)");
	const localAppData = envValue(env, "LOCALAPPDATA");
	const systemRoot = envValue(env, "SystemRoot", "windir");

	const pwsh =
		detectCommand(ctx, ["pwsh"]) ??
		firstExisting(ctx.exists, [
			programFiles ? path.win32.join(programFiles, "PowerShell", "7", "pwsh.exe") : undefined,
			programFiles ? path.win32.join(programFiles, "PowerShell", "7-preview", "pwsh.exe") : undefined,
			localAppData ? path.win32.join(localAppData, "Microsoft", "WindowsApps", "pwsh.exe") : undefined,
		]);
	if (pwsh) {
		addProfile(builder, ctx.platform, {
			id: "pwsh",
			label: "PowerShell 7",
			kind: "pwsh",
			command: pwsh,
			args: ["-NoLogo"],
			source: "detected",
			icon: "powershell",
		});
	}

	const powershell =
		firstExisting(ctx.exists, [
			systemRoot
				? path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
				: undefined,
		]) ?? detectCommand(ctx, ["powershell"]);
	if (powershell) {
		addProfile(builder, ctx.platform, {
			id: "powershell",
			label: "Windows PowerShell",
			kind: "powershell",
			command: powershell,
			args: ["-NoLogo"],
			source: "detected",
			icon: "powershell",
		});
	}

	const cmd =
		firstExisting(ctx.exists, [
			envValue(env, "ComSpec", "COMSPEC"),
			systemRoot ? path.win32.join(systemRoot, "System32", "cmd.exe") : undefined,
		]) ?? detectCommand(ctx, ["cmd"]);
	if (cmd) {
		addProfile(builder, ctx.platform, {
			id: "cmd",
			label: "Command Prompt",
			kind: "cmd",
			command: cmd,
			args: [],
			source: "detected",
			icon: "cmd",
		});
	}

	// Git Bash: the install layout first, then PATH. A bare `bash` on Windows
	// is usually the WSL launcher in System32 — not Git Bash — so that path is
	// rejected instead of mislabeling WSL as Git Bash.
	const git = detectCommand(ctx, ["git"]);
	const gitRoot = git
		? path.win32.dirname(path.win32.dirname(git)) // …\Git\cmd\git.exe → …\Git
		: null;
	const bashOnPath = detectCommand(ctx, ["bash"]);
	const usablePathBash =
		bashOnPath && !/(?:windows[\\/]+system32|windowsapps)[\\/]+bash/i.test(bashOnPath) ? bashOnPath : null;
	const gitBash =
		firstExisting(ctx.exists, [
			gitRoot ? path.win32.join(gitRoot, "bin", "bash.exe") : undefined,
			gitRoot ? path.win32.join(gitRoot, "usr", "bin", "bash.exe") : undefined,
			programFiles ? path.win32.join(programFiles, "Git", "bin", "bash.exe") : undefined,
			programFilesX86 ? path.win32.join(programFilesX86, "Git", "bin", "bash.exe") : undefined,
			localAppData ? path.win32.join(localAppData, "Programs", "Git", "bin", "bash.exe") : undefined,
		]) ?? usablePathBash;
	if (gitBash) {
		addProfile(builder, ctx.platform, {
			id: "git-bash",
			label: "Git Bash",
			kind: "git-bash",
			command: gitBash,
			args: ["-l", "-i"],
			source: "detected",
			icon: "git-bash",
		});
	}

	const nu =
		detectCommand(ctx, ["nu"]) ??
		firstExisting(ctx.exists, [
			localAppData ? path.win32.join(localAppData, "Programs", "nu", "bin", "nu.exe") : undefined,
			programFiles ? path.win32.join(programFiles, "nu", "bin", "nu.exe") : undefined,
		]);
	if (nu) {
		addProfile(builder, ctx.platform, {
			id: "nu",
			label: "Nushell",
			kind: "nu",
			command: nu,
			args: [],
			source: "detected",
			icon: "nu",
		});
	}

	const wsl =
		detectCommand(ctx, ["wsl"]) ??
		firstExisting(ctx.exists, [
			systemRoot ? path.win32.join(systemRoot, "System32", "wsl.exe") : undefined,
			localAppData ? path.win32.join(localAppData, "Microsoft", "WindowsApps", "wsl.exe") : undefined,
		]);
	if (!wsl) return;
	const result = ctx.run?.(wsl, ["-l", "-q"]);
	if (!result?.ok) return;
	for (const distro of parseWslDistros(result.stdout)) {
		addProfile(builder, ctx.platform, {
			id: wslProfileId(distro, builder.seenIds),
			label: distro,
			kind: "wsl",
			command: wsl,
			args: ["-d", distro],
			source: "detected",
			icon: "wsl",
			detail: "WSL",
		});
	}
}

function posixProfiles(ctx: ShellProbeContext, builder: ProfileBuilder): void {
	const shell = envValue(ctx.env, "SHELL");
	const shellName = shell ? path.posix.basename(shell) : "";
	if (shell && shell.startsWith("/") && ctx.exists(shell)) {
		const kind: ShellProfileKind =
			shellName === "bash" || shellName === "zsh" || shellName === "fish" || shellName === "sh" || shellName === "nu"
				? (shellName as ShellProfileKind)
				: "sh";
		addProfile(builder, ctx.platform, {
			id: kind === "sh" ? "shell" : kind,
			label: shellName || shell,
			kind,
			command: shell,
			args: [],
			source: "detected",
			icon: (SHELL_ICONS.has(kind) ? kind : "terminal") as ShellProfileIcon,
			detail: "$SHELL",
		});
	}

	const known: Array<{ id: string; name: string; label: string; kind: ShellProfileKind; icon: ShellProfileIcon }> = [
		{ id: "bash", name: "bash", label: "bash", kind: "bash", icon: "bash" },
		{ id: "zsh", name: "zsh", label: "zsh", kind: "zsh", icon: "zsh" },
		{ id: "fish", name: "fish", label: "fish", kind: "fish", icon: "fish" },
		{ id: "nu", name: "nu", label: "Nushell", kind: "nu", icon: "nu" },
	];
	for (const entry of known) {
		const command = detectCommand(ctx, [entry.name]);
		if (!command) continue;
		addProfile(builder, ctx.platform, {
			id: entry.id,
			label: entry.label,
			kind: entry.kind,
			command,
			args: [],
			source: "detected",
			icon: entry.icon,
		});
	}
}

/**
 * Discover the local shell catalog. Pure over the injected probe context, so
 * tests never read the host machine. The gateway's cached entry point is
 * {@link terminalShellCatalog}.
 */
export function discoverShellProfiles(ctx: ShellProbeContext = defaultShellProbeContext()): ShellProfileCatalog {
	const builder: ProfileBuilder = { profiles: [], seenIds: new Set(), seenCommands: new Set() };
	if (ctx.platform === "win32") windowsProfiles(ctx, builder);
	else posixProfiles(ctx, builder);

	const custom = parseCustomProfiles(ctx.env[CUSTOM_PROFILES_ENV], ctx.exists);
	for (const profile of custom.profiles) addProfile(builder, ctx.platform, profile);

	return {
		profiles: builder.profiles,
		defaultProfileId: builder.profiles[0]?.id ?? null,
		platform: ctx.platform,
		warnings: custom.warnings,
	};
}

let cached: { at: number; catalog: ShellProfileCatalog } | null = null;

/** Catalog for the running gateway (cached briefly; WSL probing spawns). */
export function terminalShellCatalog(options: { refresh?: boolean } = {}): ShellProfileCatalog {
	const ctx = defaultShellProbeContext();
	const now = ctx.now();
	if (!options.refresh && cached && now - cached.at < CATALOG_TTL_MS) return cached.catalog;
	const catalog = discoverShellProfiles(ctx);
	cached = { at: now, catalog };
	return catalog;
}

/** Test hook: forget the cached catalog. */
export function resetShellProfileCacheForTests(): void {
	cached = null;
}

/**
 * Resolve a profile id from the current catalog, or null. This is the only
 * gate between a client-supplied id and a spawned executable.
 */
export function findShellProfile(profileId: string, catalog = terminalShellCatalog()): TerminalShellProfile | null {
	return catalog.profiles.find(profile => profile.id === profileId) ?? null;
}

/** Platform default shell executable label, for tests and empty states. */
export function shellProfileLabel(profileId: string | null, catalog = terminalShellCatalog()): string | null {
	if (!profileId) return null;
	return catalog.profiles.find(profile => profile.id === profileId)?.label ?? null;
}

/** Username/home sanity for a profile cwd: expansions stay local to the host. */
export function normalizeProfileCwd(cwd: string | undefined): string | undefined {
	if (!cwd) return undefined;
	if (cwd === "~" || cwd.startsWith("~/") || cwd.startsWith("~\\")) {
		return path.join(os.homedir(), cwd.slice(2));
	}
	return cwd;
}
