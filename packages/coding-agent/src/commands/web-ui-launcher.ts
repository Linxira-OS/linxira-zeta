/**
 * Web UI 启动工具 — 被 `zeta serve` 和 `zeta web` 共用。
 *
 * 按优先级尝试启动 Web UI：
 * 1. 编译后二进制内嵌的 web-ui（PI_COMPILED 模式）
 * 2. 源码仓库中的 web-ui 目录
 * 3. 全局安装的 zeta-web npm 包
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { $which } from "@linxiraos/pi-utils";

export interface WebUiChild {
	kill: () => void;
}

/** Resolve the Node-compatible runtime used to host the standalone Web UI. */
export function resolveWebUiRuntime(env: NodeJS.ProcessEnv = process.env): string {
	return env.ZETA_WEB_RUNTIME || "node";
}

function hideWebUiWindow(): boolean {
	return process.env.ZETA_DESKTOP === "1";
}

/**
 * 启动 Web UI 服务器，返回子进程句柄。
 * @param port 监听端口，默认 30141
 */
export async function spawnWebUi(port: number = 30141): Promise<WebUiChild> {
	// 1. 编译后二进制：尝试从内嵌资源启动
	if (process.env.PI_COMPILED === "true") {
		return spawnEmbeddedWebUi(port);
	}

	// 2. 优先源码仓库中的 web-ui（开发/便携场景，避免依赖全局 npm 包或 npx）
	const webUiDir = findSourceWebUiDir();
	if (webUiDir) {
		return spawnSourceWebUi(webUiDir, port);
	}

	// 3. 回退：全局安装的 zeta-web
	const zetaWebBin = await findZetaWebBin();
	if (zetaWebBin) {
		return spawnZetaWebBin(zetaWebBin, port);
	}

	throw new Error("Web UI not found. Install with: npm install -g zeta-web, or run from the Zeta repository root.");
}

async function findZetaWebBin(): Promise<string | null> {
	// Try zeta-web binary first
	const bin = $which("zeta-web");
	if (bin) return bin;

	// Try npx zeta-web
	const npx = $which("npx");
	if (npx) return "npx:zeta-web";

	return null;
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

function spawnZetaWebBin(bin: string, port: number): WebUiChild {
	const args =
		bin === "npx:zeta-web"
			? ["npx", "zeta-web", "--port", String(port), "--hostname", "127.0.0.1"]
			: [bin, "--port", String(port), "--hostname", "127.0.0.1"];

	const env = {
		...process.env,
		ZETA_WEB_HOSTNAME: "127.0.0.1",
		ZETA_WEB_PORT: String(port),
		ZETA_WEB_NO_OPEN: "1", // zeta serve handles browser opening
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

function spawnSourceWebUi(webUiDir: string, port: number): WebUiChild {
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
 * 3. 全局安装的 zeta-web npm 包
 */
function spawnEmbeddedWebUi(port: number): WebUiChild {
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
		"Embedded Web UI not found. Place the web-ui build next to the binary, or install zeta-web globally.",
	);
}
