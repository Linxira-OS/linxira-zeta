/**
 * Gateway open-target contract: which-style PATH probing (Windows PATHEXT
 * semantics included), the Windows terminal chain pwsh → Git Bash →
 * powershell, the POSIX $SHELL → bash chain, detection of the bundled
 * zeta-ide / zeta-editor terminal tools, the process-level probe cache, and
 * the POST /api/open target wiring (desktop capability split included).
 * All PATH/fs-dependent probes run against injected probe contexts; the
 * handler tests use real temp stub executables.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { __resetProjectDirCacheForTests, setProjectDir } from "@linxiraos/pi-utils";
import { whichCommand, type OpenProbeContext } from "../../src/utils/bin-discovery";
import {
	buildTerminalSpawnCommand,
	getOpenOptions,
	handleOpenPost,
	invalidateOpenProbes,
	resolveTerminalPosix,
	resolveTerminalWindows,
} from "../../src/server/web-gateway/open";

const ENV_KEYS = [
	"ZETA_DESKTOP",
	"ZETA_DESKTOP_OPEN_SECRET",
	"PATH",
	"APPDATA",
	"LOCALAPPDATA",
	"USERPROFILE",
] as const;

interface ProbeTree {
	root: string;
	/** Probe context whose PATH lists the layout dirs; exists() is tree-scoped. */
	ctx: (overrides?: Partial<OpenProbeContext>) => OpenProbeContext;
}

/**
 * Layout dirs become PATH entries (in key order) so probes stay tree-scoped:
 * paths outside `root` only exist when listed in `allow`.
 */
function makeProbeTree(platform: NodeJS.Platform, layout: Record<string, string[]>, allow: string[] = []): ProbeTree {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-gw-open-"));
	const dirs: string[] = [];
	for (const [dir, files] of Object.entries(layout)) {
		const dirPath = path.join(root, dir);
		fs.mkdirSync(dirPath, { recursive: true });
		dirs.push(dirPath);
		for (const file of files) fs.writeFileSync(path.join(dirPath, file), "");
	}
	const separator = platform === "win32" ? ";" : ":";
	return {
		root,
		ctx: overrides => ({
			platform,
			env: { PATH: dirs.join(separator) },
			exists: candidate => (candidate.startsWith(root) ? fs.existsSync(candidate) : allow.includes(candidate)),
			now: () => Date.now(),
			...overrides,
		}),
	};
}

describe("gateway open targets", () => {
	const savedCwd = process.cwd();
	const cleanups: Array<() => void> = [];
	const savedEnv = new Map<string, string | undefined>();

	afterEach(() => {
		invalidateOpenProbes();
		for (const key of ENV_KEYS) {
			if (savedEnv.has(key)) {
				const saved = savedEnv.get(key);
				if (saved === undefined) delete process.env[key];
				else process.env[key] = saved;
			}
		}
		process.chdir(savedCwd);
		__resetProjectDirCacheForTests();
		for (const fn of cleanups.splice(0)) fn();
	});

	function trackTree(tree: ProbeTree): void {
		cleanups.push(() => fs.rmSync(tree.root, { recursive: true, force: true }));
	}

	function trackTempDir(prefix: string): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
		cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
		return dir;
	}

	// --- which-style probing ---

	test.skipIf(process.platform !== "win32")(
		"windows probe resolves npm-style .cmd shims and native .exe via PATHEXT",
		() => {
			const tree = makeProbeTree("win32", { tools: ["zeta-ide.cmd", "code.exe"] });
			trackTree(tree);
			expect(whichCommand("zeta-ide", tree.ctx())).toBe(path.join(tree.root, "tools", "zeta-ide.cmd"));
			expect(whichCommand("code", tree.ctx())).toBe(path.join(tree.root, "tools", "code.exe"));
			expect(whichCommand("missing", tree.ctx())).toBeNull();
		},
	);

	test.skipIf(process.platform !== "win32")(
		"windows probe prefers the bare name over PATHEXT extensions and honours PATHEXT order",
		() => {
			const tree = makeProbeTree("win32", { tools: ["tool.exe", "tool.cmd"] });
			trackTree(tree);
			expect(whichCommand("tool.exe", tree.ctx())).toBe(path.join(tree.root, "tools", "tool.exe"));
			// .exe sorts before .cmd in the default PATHEXT order.
			expect(whichCommand("tool", tree.ctx())).toBe(path.join(tree.root, "tools", "tool.exe"));
			const cmdFirst = tree.ctx({ env: { PATH: path.join(tree.root, "tools"), PATHEXT: ".cmd;.exe" } });
			expect(whichCommand("tool", cmdFirst)).toBe(path.join(tree.root, "tools", "tool.cmd"));
		},
	);

	test.skipIf(process.platform !== "win32")("windows probe searches every PATH directory in order", () => {
		const tree = makeProbeTree("win32", { first: [], second: ["pwsh.cmd"] });
		trackTree(tree);
		expect(whichCommand("pwsh", tree.ctx())).toBe(path.join(tree.root, "second", "pwsh.cmd"));
	});

	test("posix probe resolves bare names across colon-separated PATH", () => {
		const ctx: OpenProbeContext = {
			platform: "linux",
			env: { PATH: "/usr/bin:/opt/tools" },
			exists: candidate => candidate === "/opt/tools/bash",
			now: () => Date.now(),
		};
		expect(whichCommand("bash", ctx)).toBe("/opt/tools/bash");
		expect(whichCommand("missing", ctx)).toBeNull();
	});

	test("probe rejects names with path separators", () => {
		const tree = makeProbeTree("win32", { tools: ["tool.cmd"] });
		trackTree(tree);
		expect(whichCommand("tools/tool", tree.ctx())).toBeNull();
		expect(whichCommand("tools\\tool", tree.ctx())).toBeNull();
		expect(whichCommand("", tree.ctx())).toBeNull();
	});

	// --- Windows terminal chain ---

	test.skipIf(process.platform !== "win32")("windows chain prefers pwsh when PowerShell 7+ is on PATH", () => {
		const tree = makeProbeTree("win32", {
			pwsh: ["pwsh.exe"],
			git: ["git.exe"],
			ps: ["powershell.exe"],
		});
		trackTree(tree);
		expect(resolveTerminalWindows(tree.ctx())).toEqual({
			kind: "pwsh",
			label: "PowerShell",
			command: path.join(tree.root, "pwsh", "pwsh.exe"),
			args: [],
		});
	});

	test.skipIf(process.platform !== "win32")(
		"windows chain falls back to Git Bash bundled beside git.exe, then to powershell",
		() => {
			const tree = makeProbeTree("win32", {
				git: ["git.exe"],
				gitbin: ["bash.exe"],
				ps: ["powershell.exe"],
			});
			trackTree(tree);
			// git.exe lives in <install>\cmd, bash.exe in <install>\bin.
			fs.renameSync(path.join(tree.root, "gitbin"), path.join(tree.root, "bin"));
			expect(resolveTerminalWindows(tree.ctx())).toEqual({
				kind: "git-bash",
				label: "Git Bash",
				command: path.join(tree.root, "bin", "bash.exe"),
				args: [],
			});

			// Without a bundled bash, the plain powershell.exe is the last resort.
			fs.rmSync(path.join(tree.root, "bin"), { recursive: true, force: true });
			expect(resolveTerminalWindows(tree.ctx())).toEqual({
				kind: "powershell",
				label: "PowerShell",
				command: path.join(tree.root, "ps", "powershell.exe"),
				args: [],
			});
		},
	);

	test("windows chain finds Git Bash via common install paths without git.exe on PATH", () => {
		const tree = makeProbeTree("win32", {});
		trackTree(tree);
		const ctx = tree.ctx({
			exists: candidate => candidate === "C:\\Program Files\\Git\\bin\\bash.exe",
		});
		expect(resolveTerminalWindows(ctx)).toEqual({
			kind: "git-bash",
			label: "Git Bash",
			command: "C:\\Program Files\\Git\\bin\\bash.exe",
			args: [],
		});
	});

	test("windows chain returns null when no known shell exists", () => {
		const tree = makeProbeTree("win32", {});
		trackTree(tree);
		expect(resolveTerminalWindows(tree.ctx())).toBeNull();
	});

	// --- POSIX terminal chain ---

	test("posix chain prefers $SHELL and falls back to bash", () => {
		const zshCtx: OpenProbeContext = {
			platform: "linux",
			env: { SHELL: "/usr/bin/zsh", PATH: "/usr/bin" },
			exists: candidate => candidate === "/usr/bin/zsh",
			now: () => Date.now(),
		};
		expect(resolveTerminalPosix(zshCtx)).toEqual({
			kind: "shell",
			label: "zsh",
			command: "/usr/bin/zsh",
			args: [],
		});

		const bashCtx: OpenProbeContext = {
			platform: "linux",
			env: { PATH: "/usr/bin:/bin" },
			exists: candidate => candidate === "/bin/bash",
			now: () => Date.now(),
		};
		expect(resolveTerminalPosix(bashCtx)).toEqual({
			kind: "bash",
			label: "bash",
			command: "/bin/bash",
			args: [],
		});
		expect(resolveTerminalPosix({ ...bashCtx, exists: () => false })).toBeNull();
	});

	// --- spawn command construction ---

	test("windows terminal opens through start semantics with the resolved shell", () => {
		const resolved = { kind: "pwsh" as const, label: "PowerShell", command: "C:\\apps\\pwsh.exe", args: [] };
		expect(buildTerminalSpawnCommand(resolved, "C:\\ws", "win32")).toEqual([
			"cmd.exe",
			"/d",
			"/s",
			"/c",
			"start",
			"",
			"C:\\apps\\pwsh.exe",
		]);
	});

	test("darwin delegates to Terminal.app and linux prefers the emulator with a shell fallback", () => {
		const resolved = { kind: "shell" as const, label: "zsh", command: "/usr/bin/zsh", args: [] };
		expect(buildTerminalSpawnCommand(resolved, "/ws", "darwin")).toEqual(["open", "-a", "Terminal", "/ws"]);
		expect(buildTerminalSpawnCommand(resolved, "/ws", "linux", "/usr/bin/x-terminal-emulator")).toEqual([
			"/usr/bin/x-terminal-emulator",
			"--working-directory=/ws",
		]);
		expect(buildTerminalSpawnCommand(resolved, "/ws", "linux", null)).toEqual(["/usr/bin/zsh"]);
	});

	// --- options payload ---

	test.skipIf(process.platform !== "win32")(
		"options list every target with availability and mark the first available as default",
		() => {
			const tree = makeProbeTree("win32", { pwsh: ["pwsh.exe"], tools: ["zeta-ide.cmd"] });
			trackTree(tree);
			const body = getOpenOptions(false, tree.ctx());

			expect(body.desktop).toBe(false);
			const byType = Object.fromEntries(body.targets.map(t => [t.type + (t.editor ? `:${t.editor}` : ""), t]));
			expect(byType["terminal"]).toMatchObject({
				type: "terminal",
				label: "PowerShell",
				available: true,
				default: true,
			});
			expect(byType["explorer"]).toMatchObject({ type: "explorer", available: true });
			expect(byType["editor:vscode"]).toMatchObject({ type: "editor", label: "VS Code", available: false });
			expect(byType["terminal-ide"]).toMatchObject({ type: "terminal-ide", label: "Zeta IDE", available: true });
			expect(byType["terminal-editor"]).toMatchObject({
				type: "terminal-editor",
				label: "Zeta Editor",
				available: false,
			});
			// Exactly one default, and it is the first available target.
			expect(body.targets.filter(t => t.default)).toHaveLength(1);
		},
	);

	test.skipIf(process.platform !== "win32")(
		"desktop host hides explorer/editors but keeps the bundled terminal tools",
		() => {
			const tree = makeProbeTree("win32", { tools: ["zeta-editor.cmd"] });
			trackTree(tree);
			const body = getOpenOptions(true, tree.ctx());
			expect(body.desktop).toBe(true);
			const byType = Object.fromEntries(body.targets.map(t => [t.type, t]));
			expect(byType["terminal"].available).toBe(false);
			expect(byType["explorer"].available).toBe(false);
			expect(body.targets.filter(t => t.type === "editor").every(t => !t.available)).toBe(true);
			expect(byType["terminal-editor"].available).toBe(true);
			expect(byType["terminal-ide"].available).toBe(false);
		},
	);

	// --- unified discovery tiers: ① ZETA_BIN_DIR ② PATH ③ npm-form dirs ---

	test.skipIf(process.platform !== "win32")(
		"explicit ZETA_BIN_DIR dir outranks the PATH hit for terminal tools (win32)",
		() => {
			const tree = makeProbeTree("win32", { tools: ["zeta-ide.cmd"] });
			trackTree(tree);
			const overrideDir = path.join(tree.root, "override");
			fs.mkdirSync(overrideDir);
			fs.writeFileSync(path.join(overrideDir, "zeta-ide.cmd"), "");
			const ctx = tree.ctx({ env: { PATH: path.join(tree.root, "tools"), ZETA_BIN_DIR: overrideDir } });
			const body = getOpenOptions(false, ctx);
			const ide = body.targets.find(t => t.type === "terminal-ide");
			expect(ide?.available).toBe(true);
			expect(ide?.detail).toBe(path.join(overrideDir, "zeta-ide.cmd"));
		},
	);

	test.skipIf(process.platform !== "win32")("empty PATH falls back to the npm-form global-bin dirs (win32)", () => {
		const tree = makeProbeTree("win32", { tools: [] });
		trackTree(tree);
		fs.mkdirSync(path.join(tree.root, "npm"));
		fs.writeFileSync(path.join(tree.root, "npm", "zeta-ide.cmd"), "");
		const ctx = tree.ctx({ env: { PATH: path.join(tree.root, "tools"), APPDATA: tree.root } });
		const body = getOpenOptions(false, ctx);
		const ide = body.targets.find(t => t.type === "terminal-ide");
		expect(ide?.available).toBe(true);
		expect(ide?.detail).toBe(path.join(tree.root, "npm", "zeta-ide.cmd"));
	});

	test.skipIf(process.platform === "win32")(
		"explicit ZETA_BIN_DIR dir outranks the PATH hit for terminal tools (posix)",
		() => {
			const tree = makeProbeTree("linux", { tools: ["zeta-ide"] });
			trackTree(tree);
			const overrideDir = path.join(tree.root, "override");
			fs.mkdirSync(overrideDir);
			fs.writeFileSync(path.join(overrideDir, "zeta-ide"), "");
			const ctx = tree.ctx({ env: { PATH: path.join(tree.root, "tools"), ZETA_BIN_DIR: overrideDir } });
			const body = getOpenOptions(false, ctx);
			const ide = body.targets.find(t => t.type === "terminal-ide");
			expect(ide?.available).toBe(true);
			expect(ide?.detail).toBe(path.join(overrideDir, "zeta-ide"));
		},
	);

	test.skipIf(process.platform === "win32")("empty PATH falls back to the npm-form global-bin dirs (posix)", () => {
		const tree = makeProbeTree("linux", { tools: [] });
		trackTree(tree);
		const bunBin = path.join(tree.root, ".bun", "bin");
		fs.mkdirSync(bunBin, { recursive: true });
		fs.writeFileSync(path.join(bunBin, "zeta-ide"), "");
		const ctx = tree.ctx({ env: { PATH: path.join(tree.root, "tools"), HOME: tree.root } });
		const body = getOpenOptions(false, ctx);
		const ide = body.targets.find(t => t.type === "terminal-ide");
		expect(ide?.available).toBe(true);
		expect(ide?.detail).toBe(path.join(bunBin, "zeta-ide"));
	});

	// --- probe cache ---

	test.skipIf(process.platform !== "win32")(
		"probe results are cached within the TTL and re-resolved after expiry or invalidation",
		() => {
			const tree = makeProbeTree("win32", { tools: ["zeta-ide.cmd"] });
			trackTree(tree);
			let clock = 1_000;
			const ctx = tree.ctx({ now: () => clock });

			const first = getOpenOptions(false, ctx);
			expect(first.targets.find(t => t.type === "terminal-ide")?.available).toBe(true);

			fs.rmSync(path.join(tree.root, "tools", "zeta-ide.cmd"), { force: true });
			// Still cached: identical result before TTL expiry.
			const second = getOpenOptions(false, ctx);
			expect(second.targets.find(t => t.type === "terminal-ide")?.available).toBe(true);

			clock += 60_001;
			const third = getOpenOptions(false, ctx);
			expect(third.targets.find(t => t.type === "terminal-ide")?.available).toBe(false);

			// Recomputed results are cached again until explicit invalidation.
			fs.writeFileSync(path.join(tree.root, "tools", "zeta-ide.cmd"), "");
			const fourth = getOpenOptions(false, ctx);
			expect(fourth.targets.find(t => t.type === "terminal-ide")?.available).toBe(false);
			invalidateOpenProbes();
			const fifth = getOpenOptions(false, ctx);
			expect(fifth.targets.find(t => t.type === "terminal-ide")?.available).toBe(true);
		},
	);

	// --- POST wiring against real stub executables ---

	function postRequest(body: Record<string, string>): Request {
		return new Request("http://localhost/api/open", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	function isolatePath(): string {
		const empty = trackTempDir("zeta-gw-open-path-");
		savedEnv.set("PATH", process.env.PATH);
		process.env.PATH = empty;
		// The npm-form fallback tier derives its dirs from these, so the
		// "tool missing" states must neutralize them too — a real
		// %APPDATA%\npm with installed zeta shims would otherwise satisfy
		// the probe through tier ③.
		for (const key of ["APPDATA", "LOCALAPPDATA", "USERPROFILE"] as const) {
			savedEnv.set(key, process.env[key]);
			process.env[key] = empty;
		}
		return empty;
	}

	function installStub(dir: string, bin: string): void {
		if (process.platform === "win32") {
			fs.writeFileSync(path.join(dir, `${bin}.cmd`), "@echo off\r\nexit /b 0\r\n");
		} else {
			const stub = path.join(dir, bin);
			fs.writeFileSync(stub, "#!/bin/sh\nexit 0\n");
			fs.chmodSync(stub, 0o755);
		}
	}

	test("POST terminal-ide reports 404 without the tool and spawns the stub when present", async () => {
		const workspace = trackTempDir("zeta-gw-open-ws-");
		setProjectDir(workspace);
		isolatePath();

		const missing = await handleOpenPost(postRequest({ target: "terminal-ide", path: workspace }));
		expect(missing.status).toBe(404);

		installStub(process.env.PATH!, "zeta-ide");
		invalidateOpenProbes();
		const response = await handleOpenPost(postRequest({ target: "terminal-ide", path: workspace }));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ spawned: true });
	});

	test("POST rejects paths outside the project and unknown desktop targets, but spawns zeta tools under the desktop bridge", async () => {
		const workspace = trackTempDir("zeta-gw-open-ws-");
		setProjectDir(workspace);
		isolatePath();

		const outside = await handleOpenPost(postRequest({ target: "terminal-ide", path: path.dirname(workspace) }));
		expect(outside.status).toBe(403);

		// Desktop capability flow for file-manager stays intact.
		savedEnv.set("ZETA_DESKTOP", process.env.ZETA_DESKTOP);
		savedEnv.set("ZETA_DESKTOP_OPEN_SECRET", process.env.ZETA_DESKTOP_OPEN_SECRET);
		process.env.ZETA_DESKTOP = "1";
		process.env.ZETA_DESKTOP_OPEN_SECRET = "test-secret";
		const capability = await handleOpenPost(postRequest({ target: "explorer", path: workspace }));
		expect(capability.status).toBe(200);
		const payload = (await capability.json()) as { path: string; token: string };
		expect(payload.path).toBe(path.resolve(workspace));
		expect(payload.token).toHaveLength(64);

		// Plain terminal stays desktop-host territory.
		const desktopTerminal = await handleOpenPost(postRequest({ target: "terminal", path: workspace }));
		expect(desktopTerminal.status).toBe(400);

		// zeta tools have no host id: the gateway spawns them directly.
		installStub(process.env.PATH!, "zeta-editor");
		invalidateOpenProbes();
		const spawned = await handleOpenPost(postRequest({ target: "terminal-editor", path: workspace }));
		expect(spawned.status).toBe(200);
		expect(await spawned.json()).toEqual({ spawned: true });
	});
});
