/**
 * Web UI 启动工具 — 被 `zetacode serve` 和 `zetacode web` 共用。
 *
 * 按优先级尝试启动 Web UI：
 * 1. 编译后二进制内嵌的 web-ui（PI_COMPILED 模式）
 * 2. 源码仓库中的 web-ui 目录
 * 3. 全局安装的 `@linxiraos/zeta-web` npm 包（bin 名 `zeta-web`，经 npx）
 *
 * 名字的三个角色必须分开，混用即是 404（v1.2.1 事故：npm 安装的 CLI 在
 * 无 web-ui 检出的目录里用裸名 `zeta-web` 做 npx specifier，而发布包是
 * scoped 的 `@linxiraos/zeta-web`，于是 `npm error 404 Not Found - GET
 * https://registry.npmjs.org/zeta-web`，serve 照常监听 30141 但 Web UI 子
 * 进程从未起来，桌面端每次启动都复用这个空壳）：
 * - {@link WEB_UI_PACKAGE} — npm 包名（scoped）
 * - {@link WEB_UI_BIN} — 包提供的 bin 名（**不是**包名，`$which` 探测用）
 * - {@link WEB_UI_NPX_SPECIFIER} — npx 拿到的包说明符（scoped + `@latest`）
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { $which, logger } from "@linxiraos/pi-utils";

/** Published npm package that ships the prebuilt standalone Web UI. */
export const WEB_UI_PACKAGE = "@linxiraos/zeta-web";

/** The `bin` entry that package installs — a bin name, never a package specifier. */
export const WEB_UI_BIN = "zeta-web";

/**
 * npx specifier. `@latest` on purpose: web-ui 走自己的版本线（1.1.5 vs CLI
 * 1.2.1），把 CLI 的版本拼进来只会 404（`@linxiraos/zeta-web@1.2.1` 不存在）。
 * 版本漂移通过启动日志里解析到的实际版本可见（{@link resolveWebUiPackageVersion}）。
 */
export const WEB_UI_NPX_SPECIFIER = `${WEB_UI_PACKAGE}@latest`;

/** What a user must run when no Web UI could be found. */
export const WEB_UI_INSTALL_HINT = `npm install -g ${WEB_UI_PACKAGE}`;

/** How to run the Web UI when it is not installed (scoped specifier, never the bin name). */
export const WEB_UI_NPX_HINT = `npx ${WEB_UI_NPX_SPECIFIER}`;

export interface WebUiChild {
	kill: () => void;
}

/**
 * What a launch falls back to when no local Web UI exists: a resolved `bin`
 * path, or a package *specifier* for npx. Kept as two variants so the two can
 * never be concatenated into one ambiguous string again (the old
 * `"npx:zeta-web"` sentinel did exactly that).
 */
export type WebUiLaunchTarget = { kind: "bin"; file: string } | { kind: "npx"; specifier: string };

/** Resolve the Node-compatible runtime used to host the standalone Web UI. */
export function resolveWebUiRuntime(env: NodeJS.ProcessEnv = process.env): string {
	return env.ZETA_WEB_RUNTIME || "node";
}

function hideWebUiWindow(): boolean {
	return process.env.ZETA_DESKTOP === "1";
}

/**
 * 启动 Web UI 服务器，返回子进程句柄。
 *
 * `statsUrl` / `gatewayUrl` are forwarded as `NEXT_PUBLIC_STATS_URL` /
 * `ZETA_WEB_GATEWAY_URL`: web-ui's Next-side `/api/*` proxies (next.config
 * `beforeFiles` rewrites and route handlers) resolve their targets from these
 * env vars. Both service ports are configurable (`--stats-port` /
 * `--gateway-port`), so the child must be told the real origins — otherwise it
 * falls back to the default ports and the proxies fail with ECONNREFUSED.
 *
 * @param port 监听端口，默认 30141
 */
export async function spawnWebUi(port: number = 30141, statsUrl?: string, gatewayUrl?: string): Promise<WebUiChild> {
	// 1. 编译后二进制：尝试从内嵌资源启动
	if (process.env.PI_COMPILED === "true") {
		return spawnEmbeddedWebUi(port, statsUrl, gatewayUrl);
	}

	// 2. 优先源码仓库中的 web-ui（开发/便携场景，避免依赖全局 npm 包或 npx）
	const webUiDir = findSourceWebUiDir();
	if (webUiDir) {
		return spawnSourceWebUi(webUiDir, port, statsUrl, gatewayUrl);
	}

	// 3. 回退：全局安装的 web-ui 包
	const target = await resolveWebUiLaunchTarget();
	if (target) {
		logger.info("Starting the Web UI from the installed package", {
			target: target.kind === "npx" ? `npx ${target.specifier}` : `bin ${target.file}`,
		});
		return spawnWebUiTarget(target, port, statsUrl, gatewayUrl);
	}

	throw new Error(
		`Web UI not found. Install with: ${WEB_UI_INSTALL_HINT}, run ${WEB_UI_NPX_HINT}, or run from the Zeta repository root.`,
	);
}

/**
 * The npm fallback target: the `zeta-web` **bin** when it is on PATH, else the
 * scoped **package specifier** for npx. The bin probe is name-correct as-is —
 * `zeta-web` is the bin the published package installs — while the npx branch
 * must name the package (`@linxiraos/zeta-web`), because npx resolves a
 * *package*, not a bin: the unscoped name does not exist and 404s.
 */
export async function resolveWebUiLaunchTarget(): Promise<WebUiLaunchTarget | null> {
	const bin = $which(WEB_UI_BIN);
	if (bin) return { kind: "bin", file: bin };

	// npx resolves the package: the specifier is the scoped name, never the bin.
	if ($which("npx")) return { kind: "npx", specifier: WEB_UI_NPX_SPECIFIER };

	return null;
}

/**
 * argv for a resolved target. Pure so the specifier/port/hostname contract can
 * be asserted without spawning (see `test/web-ui-launcher.test.ts`). `npx` stays
 * a bare name on purpose: the resolved `npx.cmd` shim cannot be exec'd directly
 * on Windows (`EINVAL`) and Bun resolves the bare name through PATH.
 */
export function buildWebUiLaunchArgs(target: WebUiLaunchTarget, port: number): string[] {
	const launchArgs = ["--port", String(port), "--hostname", "127.0.0.1"];
	return target.kind === "npx" ? ["npx", "--yes", target.specifier, ...launchArgs] : [target.file, ...launchArgs];
}

/**
 * Version the `@latest` tag resolves to, for the start log — web-ui rides its
 * own version line, so a skew against the CLI version is expected and only
 * visible if the resolved number is printed. Never fatal: offline, an npm
 * failure just means "unknown".
 */
export async function resolveWebUiPackageVersion(specifier: string = WEB_UI_NPX_SPECIFIER): Promise<string | null> {
	try {
		const child = Bun.spawn(["npm", "view", specifier, "version"], { stdout: "pipe", stderr: "ignore" });
		const timer = setTimeout(() => child.kill(), 15_000);
		const stdout = await new Response(child.stdout).text();
		clearTimeout(timer);
		await child.exited;
		return parseNpmViewVersion(stdout);
	} catch {
		return null;
	}
}

/** npm prints a bare version (or `v1.2.3`); anything else means "unknown". */
export function parseNpmViewVersion(stdout: string): string | null {
	const version = stdout.trim().replace(/^v/, "");
	return /^\d+\.\d+\.\d+/.test(version) ? version : null;
}

function findSourceWebUiDir(): string | null {
	// Walk up from the commands dir (src/commands) to the repo root, then web-ui
	let dir = path.join(import.meta.dir, "..", "..", "..", "..", "web-ui");
	if (fs.existsSync(path.join(dir, "package.json"))) {
		return dir;
	}

	// Try relative to cwd
	dir = path.join(process.cwd(), "web-ui");
	if (fs.existsSync(path.join(dir, "package.json"))) {
		return dir;
	}

	return null;
}

function spawnWebUiTarget(target: WebUiLaunchTarget, port: number, statsUrl?: string, gatewayUrl?: string): WebUiChild {
	const args = buildWebUiLaunchArgs(target, port);

	if (target.kind === "npx") {
		// Fire-and-forget: the resolved `@latest` version lands in the log without
		// delaying the child's start.
		void resolveWebUiPackageVersion(target.specifier).then(version => {
			logger.info("Web UI package resolved", { specifier: target.specifier, version: version ?? "unknown" });
		});
	}

	const env = {
		...process.env,
		ZETA_WEB_HOSTNAME: "127.0.0.1",
		ZETA_WEB_PORT: String(port),
		ZETA_WEB_NO_OPEN: "1", // zetacode serve handles browser opening
		...(statsUrl ? { NEXT_PUBLIC_STATS_URL: statsUrl } : {}),
		...(gatewayUrl ? { ZETA_WEB_GATEWAY_URL: gatewayUrl } : {}),
	};

	const child = Bun.spawn(args, {
		env,
		stdout: "inherit",
		stderr: "inherit",
		windowsHide: hideWebUiWindow(),
	});

	return {
		kill: () => {
			child.kill();
		},
	};
}

function spawnSourceWebUi(webUiDir: string, port: number, statsUrl?: string, gatewayUrl?: string): WebUiChild {
	const runtime = resolveWebUiRuntime();
	// Check if web-ui has been built
	const nextDir = path.join(webUiDir, ".next");
	if (!fs.existsSync(nextDir)) {
		throw new Error(
			`Web UI build artifacts not found in ${nextDir}. Run 'cd web-ui && npm install && npm run build' first.`,
		);
	}

	// Use the zeta-web bin script directly
	const binScript = path.join(webUiDir, "bin", "zeta-web.js");
	if (fs.existsSync(binScript)) {
		const child = Bun.spawn([runtime, binScript, "--port", String(port), "--hostname", "127.0.0.1"], {
			cwd: webUiDir,
			env: {
				...process.env,
				ZETA_WEB_HOSTNAME: "127.0.0.1",
				ZETA_WEB_PORT: String(port),
				ZETA_WEB_NO_OPEN: "1",
				...(statsUrl ? { NEXT_PUBLIC_STATS_URL: statsUrl } : {}),
				...(gatewayUrl ? { ZETA_WEB_GATEWAY_URL: gatewayUrl } : {}),
			},
			stdout: "inherit",
			stderr: "inherit",
			windowsHide: hideWebUiWindow(),
		});

		return {
			kill: () => {
				child.kill();
			},
		};
	}

	// Fallback: use the local next binary (no npx dependency)
	const nextBin = path.join(webUiDir, "node_modules", "next", "dist", "bin", "next");
	if (!fs.existsSync(nextBin)) {
		throw new Error(`Web UI runtime not found in ${webUiDir}. Run 'cd web-ui && npm install' first.`);
	}

	const child = Bun.spawn([runtime, nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
		cwd: webUiDir,
		env: {
			...process.env,
			ZETA_WEB_HOSTNAME: "127.0.0.1",
			ZETA_WEB_PORT: String(port),
			ZETA_WEB_NO_OPEN: "1",
			...(statsUrl ? { NEXT_PUBLIC_STATS_URL: statsUrl } : {}),
			...(gatewayUrl ? { ZETA_WEB_GATEWAY_URL: gatewayUrl } : {}),
		},
		stdout: "inherit",
		stderr: "inherit",
		windowsHide: hideWebUiWindow(),
	});

	return {
		kill: () => {
			child.kill();
		},
	};
}

/**
 * 编译后二进制：从同目录的 Web UI 资源启动。
 *
 * 查找顺序：
 * 1. web-ui/.next/standalone/server.js（standalone 模式）
 * 2. web-ui/.next/BUILD_ID + node_modules/next（普通构建）
 * 3. 全局安装的 `@linxiraos/zeta-web` npm 包
 */
function spawnEmbeddedWebUi(port: number, statsUrl?: string, gatewayUrl?: string): WebUiChild {
	const runtime = resolveWebUiRuntime();
	// PI_COMPILED 模式下，二进制旁边就是 web-ui 目录（便携版布局）
	const candidates = [
		path.join(path.dirname(process.execPath), "web-ui"),
		path.join(process.cwd(), "web-ui"),
		path.join(import.meta.dir, "..", "web-ui"),
		path.join(import.meta.dir, "..", "..", "..", "web-ui"),
	];

	for (const dir of candidates) {
		// 1. Standalone 模式
		const serverJs = path.join(dir, ".next", "standalone", "server.js");
		if (fs.existsSync(serverJs)) {
			const child = Bun.spawn([runtime, "server.js"], {
				cwd: path.join(dir, ".next", "standalone"),
				env: {
					...process.env,
					PORT: String(port),
					HOSTNAME: "127.0.0.1",
					...(statsUrl ? { NEXT_PUBLIC_STATS_URL: statsUrl } : {}),
					...(gatewayUrl ? { ZETA_WEB_GATEWAY_URL: gatewayUrl } : {}),
				},
				stdout: "inherit",
				stderr: "inherit",
				windowsHide: hideWebUiWindow(),
			});

			return {
				kill: () => {
					child.kill();
				},
			};
		}

		// 2. 普通 .next/ 构建 + 同目录 node_modules/next
		const buildId = path.join(dir, ".next", "BUILD_ID");
		const nextBin = path.join(dir, "node_modules", "next", "dist", "bin", "next");
		if (fs.existsSync(buildId) && fs.existsSync(nextBin)) {
			const child = Bun.spawn([runtime, nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
				cwd: dir,
				env: {
					...process.env,
					ZETA_WEB_HOSTNAME: "127.0.0.1",
					ZETA_WEB_PORT: String(port),
					ZETA_WEB_NO_OPEN: "1",
					...(statsUrl ? { NEXT_PUBLIC_STATS_URL: statsUrl } : {}),
					...(gatewayUrl ? { ZETA_WEB_GATEWAY_URL: gatewayUrl } : {}),
				},
				stdout: "inherit",
				stderr: "inherit",
				windowsHide: hideWebUiWindow(),
			});

			return {
				kill: () => {
					child.kill();
				},
			};
		}
	}

	// 3. 尝试 zeta-web bin 脚本
	const binScript = path.join(import.meta.dir, "..", "web-ui", "bin", "zeta-web.js");
	if (fs.existsSync(binScript)) {
		const child = Bun.spawn([runtime, binScript, "--port", String(port), "--hostname", "127.0.0.1", "--no-open"], {
			env: {
				...process.env,
				ZETA_WEB_HOSTNAME: "127.0.0.1",
				ZETA_WEB_PORT: String(port),
				ZETA_WEB_NO_OPEN: "1",
				...(statsUrl ? { NEXT_PUBLIC_STATS_URL: statsUrl } : {}),
				...(gatewayUrl ? { ZETA_WEB_GATEWAY_URL: gatewayUrl } : {}),
			},
			stdout: "inherit",
			stderr: "inherit",
			windowsHide: hideWebUiWindow(),
		});

		return {
			kill: () => {
				child.kill();
			},
		};
	}

	throw new Error(
		`Embedded Web UI not found. Place the web-ui build next to the binary, or install ${WEB_UI_PACKAGE} globally (${WEB_UI_INSTALL_HINT}).`,
	);
}
