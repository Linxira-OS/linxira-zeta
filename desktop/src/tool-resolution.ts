/**
 * Tool binary discovery for the desktop shell's topbar launchers.
 *
 * Same ruling as serve-resolution.ts, one face of the product-wide binary
 * discovery order:
 *
 *   ① explicit env — `ZETA_BIN_DIR` (delimiter-separated dirs probed first)
 *   ② PATH — installed launchers (a distro/npm install puts them here)
 *   ③ vendored form — dev repo checkout artifacts (platform leaf packages,
 *      dist binaries), then the Bun source fallback for zetacode
 *
 * Pure node-builtins only: main.ts supplies the Electron/process seams.
 */

import * as path from "node:path";

// Type-only import: erased at runtime, so Node's type-stripping test runner
// never resolves the sibling specifier (which would need a .ts extension).
import type { ToolId } from "./workspace-state";

export const TOOL_BIN_NAMES: Record<ToolId, readonly string[]> = {
	zetacode: ["zetacode", "zeta-c", "zeta-cli"],
	zetaide: ["zetaide", "zeta-ide", "zeta-i"],
	zetaeditor: ["zetaeditor", "zeta-editor", "zeta-e"],
};

export interface ToolResolutionDeps {
	isPackaged: boolean;
	platform: NodeJS.Platform;
	resourcesPath: string;
	env: NodeJS.ProcessEnv;
	exists: (candidate: string) => boolean;
	readTextFile: (candidate: string) => string | null;
	dirname: string;
	cwd: string;
	/** PATH probe for a bare launcher name; resolved absolute path or null. */
	probePath: (name: string) => string | null;
	serviceBinaryName: string;
	webRuntimeName: string;
}

export interface ResolvedTool {
	/** Executable (or interpreter) to spawn. */
	file: string;
	/** Prefix args before the tool's own argv (e.g. `bun cli.ts`). */
	args: string[];
	/** cmd/bat shims on Windows need a shell. */
	needsShell: boolean;
}

function envListSeparator(platform: NodeJS.Platform): string {
	return platform === "win32" ? ";" : ":";
}

function binExtensions(platform: NodeJS.Platform): string[] {
	return platform === "win32" ? ["", ".exe", ".cmd"] : [""];
}

function leafPlatformTag(platform: NodeJS.Platform): string {
	return platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
}

/** Platform leaf binary file name inside `npm/<pkg>-<tag>-x64/bin/`. */
function leafBinaryName(base: string, platform: NodeJS.Platform): string {
	return platform === "win32" ? `${base}.exe` : `${base}-linux-x64`;
}

function needsShell(file: string): boolean {
	return /\.(cmd|bat)$/i.test(file);
}

function findRepoRootIn(deps: ToolResolutionDeps): string | null {
	let dir = deps.dirname;
	for (let i = 0; i < 6; i++) {
		const text = deps.readTextFile(path.join(dir, "package.json"));
		if (text !== null) {
			try {
				const pkg = JSON.parse(text) as { workspaces?: unknown; name?: string };
				if (pkg.workspaces || pkg.name === "zeta" || deps.exists(path.join(dir, "packages", "coding-agent"))) {
					return dir;
				}
			} catch {
				// keep walking
			}
		}
		dir = path.dirname(dir);
	}
	return null;
}

/** Vendored/dev candidates per tool, in priority order. */
function vendoredCandidates(toolId: ToolId, deps: ToolResolutionDeps, repoRoot: string | null): ResolvedTool[] {
	const candidates: ResolvedTool[] = [];
	const pushBinary = (candidate: string): void => {
		if (deps.exists(candidate)) candidates.push({ file: candidate, args: [], needsShell: false });
	};

	if (toolId === "zetacode") {
		if (deps.isPackaged) {
			pushBinary(path.join(deps.resourcesPath, "zeta", deps.serviceBinaryName));
		}
		if (repoRoot) {
			pushBinary(path.join(repoRoot, "packages", "coding-agent", "dist", deps.serviceBinaryName));
			const cli = path.join(repoRoot, "packages", "coding-agent", "src", "cli.ts");
			if (deps.exists(cli)) candidates.push({ file: "bun", args: [cli], needsShell: false });
		}
		return candidates;
	}

	if (!repoRoot) return [];
	const tag = leafPlatformTag(deps.platform);

	if (toolId === "zetaide") {
		pushBinary(path.join(repoRoot, "termide", "npm", `ide-${tag}-x64`, "bin", leafBinaryName("termide", deps.platform)));
		pushBinary(path.join(repoRoot, "termide", "target", "release", deps.platform === "win32" ? "termide.exe" : "termide"));
		return candidates;
	}

	// zetaeditor
	pushBinary(path.join(repoRoot, "editor", "npm", `editor-${tag}-x64`, "bin", leafBinaryName("ttt", deps.platform)));
	pushBinary(path.join(repoRoot, "editor", "bin", deps.platform === "win32" ? "ttt.exe" : "ttt"));
	return candidates;
}

/** The unified discovery order over injected platform seams. */
export function resolveToolIn(toolId: unknown, deps: ToolResolutionDeps): ResolvedTool | null {
	if (typeof toolId !== "string" || !Object.hasOwn(TOOL_BIN_NAMES, toolId)) return null;
	const id = toolId as ToolId;
	const repoRoot = findRepoRootIn(deps);

	// ① explicit directory override, probed like PATH but first.
	const explicitDirs = (deps.env.ZETA_BIN_DIR ?? "")
		.split(envListSeparator(deps.platform))
		.map(dir => dir.trim())
		.filter(dir => dir.length > 0);
	for (const dir of explicitDirs) {
		for (const name of TOOL_BIN_NAMES[id]) {
			for (const ext of binExtensions(deps.platform)) {
				const candidate = path.join(dir, `${name}${ext}`);
				if (deps.exists(candidate)) return { file: candidate, args: [], needsShell: needsShell(candidate) };
			}
		}
	}

	// ② PATH — installed launchers win over anything we vendor ourselves.
	for (const name of TOOL_BIN_NAMES[id]) {
		const resolved = deps.probePath(name);
		if (resolved) return { file: resolved, args: [], needsShell: needsShell(resolved) };
	}

	// ③ vendored: packaged bundle, then the dev repo checkout.
	return vendoredCandidates(id, deps, repoRoot)[0] ?? null;
}
