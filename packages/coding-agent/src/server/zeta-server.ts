/**
 * ZetaServer — 统一 HTTP 反向代理服务器
 *
 * 使用 Bun.serve 作为主服务器，将 Web UI（Next.js）和 Stats Dashboard
 * 作为内部后端代理。用户只需访问一个端口。
 *
 * 架构：
 *   Browser → :30141 (Bun.serve) ─┬─ /api/stats/* → Stats Dashboard (:3847)
 *                                 └─ 其他所有请求 → Web UI Next.js (随机内部端口)
 */

import { logger } from "@zeta/pi-utils";
import { spawnWebUi } from "../commands/web-ui-launcher";
import { openPath } from "../utils/open";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZetaServerOptions {
	/** 主服务器端口，默认 30141 */
	port?: number;
	/** Stats Dashboard 端口，默认 3847 */
	statsPort?: number;
	/** 是否自动打开浏览器 */
	noBrowser?: boolean;
	/** 仅启动 Stats Dashboard */
	statsOnly?: boolean;
	/** 仅启动 Web UI */
	webOnly?: boolean;
}

export interface ZetaServerInstance {
	url: string;
	statsUrl: string;
	/** 关闭服务器和所有子进程 */
	shutdown: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** The classification result for an incoming request path. */
export interface ZetaServerRoute {
	type: "stats" | "webui" | "unavailable";
}

/**
 * Classify an incoming request based on its URL path.
 * Extracted as a standalone function so routing logic can be tested without
 * a running Bun.serve server.
 */
export function classifyRequest(req: Request, webUiPort: number): ZetaServerRoute {
	const path = new URL(req.url).pathname;

	if (path.startsWith("/api/stats") || path === "/api/sync" || path.startsWith("/api/request/")) {
		return { type: "stats" };
	}

	if (webUiPort > 0) {
		return { type: "webui" };
	}

	return { type: "unavailable" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRandomPort(): number {
	// Use a random port in the ephemeral range (49152-65535)
	return Math.floor(Math.random() * 16384) + 49152;
}

/**
 * 向目标 URL 代理转发请求。
 * 将原始请求的 method、headers、body 转发到目标，返回目标响应。
 */
async function proxyRequest(req: Request, targetBase: string): Promise<Response> {
	const url = new URL(req.url);
	const targetUrl = `${targetBase}${url.pathname}${url.search}`;

	try {
		const headers = new Headers(req.headers);
		// Remove hop-by-hop headers
		headers.delete("host");
		headers.delete("connection");
		headers.delete("keep-alive");
		headers.delete("transfer-encoding");
		headers.delete("te");
		headers.delete("trailer");
		headers.delete("upgrade");
		headers.delete("proxy-authorization");
		headers.delete("proxy-authenticate");

		const proxyReq = new Request(targetUrl, {
			method: req.method,
			headers,
			body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
		});

		const res = await fetch(proxyReq);
		return res;
	} catch (err) {
		logger.debug("Proxy request failed", {
			target: targetUrl,
			error: err instanceof Error ? err.message : String(err),
		});
		return new Response("Bad Gateway", { status: 502 });
	}
}

// ---------------------------------------------------------------------------
// ZetaServer
// ---------------------------------------------------------------------------

export class ZetaServer {
	readonly #options: Required<ZetaServerOptions>;
	#server: ReturnType<typeof Bun.serve> | null = null;
	#webUiChild: { kill: () => void } | null = null;
	#statsServer: { stop: () => void } | null = null;
	#webUiPort = 0;
	#running = false;

	constructor(options: ZetaServerOptions = {}) {
		this.#options = {
			port: options.port ?? 30141,
			statsPort: options.statsPort ?? 3847,
			// 默认不打开系统浏览器：服务仅监听端口，由 UI 壳（Electron/web-ui）消费。
			noBrowser: options.noBrowser ?? true,
			statsOnly: options.statsOnly ?? false,
			webOnly: options.webOnly ?? false,
		};
	}

	get url(): string {
		return `http://localhost:${this.#options.port}`;
	}

	get statsUrl(): string {
		return `http://localhost:${this.#options.statsPort}`;
	}

	/**
	 * 启动服务器。
	 * 按需启动 Stats Dashboard 和 Web UI 后端，然后启动 Bun.serve 主代理。
	 */
	async start(): Promise<ZetaServerInstance> {
		if (this.#running) {
			throw new Error("ZetaServer is already running");
		}
		this.#running = true;

		const { statsPort, webOnly, statsOnly } = this.#options;

		// 1. Start Stats Dashboard (if not webOnly)
		if (!webOnly) {
			await this.#startStats(statsPort);
		}

		// 2. Start Web UI on a random internal port (if not statsOnly)
		if (!statsOnly) {
			await this.#startWebUi();
		}

		// 3. Start the main Bun.serve proxy
		this.#server = this.#createMainServer();

		return {
			url: this.url,
			statsUrl: this.statsUrl,
			shutdown: () => this.shutdown(),
		};
	}

	async shutdown(): Promise<void> {
		this.#running = false;

		if (this.#server) {
			this.#server.stop();
			this.#server = null;
		}

		if (this.#webUiChild) {
			this.#webUiChild.kill();
			this.#webUiChild = null;
		}

		if (this.#statsServer) {
			try {
				this.#statsServer.stop();
			} catch {
				// Stats server may already be stopped
			}
			this.#statsServer = null;
		}
	}

	// ------------------------------------------------------------------
	// Internal
	// ------------------------------------------------------------------

	async #startStats(port: number): Promise<void> {
		try {
			const { startServer } = await import("@zeta/omp-stats");
			const server = await startServer(port);
			this.#statsServer = server;
			logger.info("Stats Dashboard started", { port: server.port });
		} catch (err) {
			logger.warn("Failed to start Stats Dashboard", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	async #startWebUi(): Promise<void> {
		this.#webUiPort = getRandomPort();
		try {
			this.#webUiChild = await spawnWebUi(this.#webUiPort);
			logger.info("Web UI backend started", { internalPort: this.#webUiPort });
		} catch (err) {
			logger.warn("Failed to start Web UI backend", {
				error: err instanceof Error ? err.message : String(err),
			});
			throw err;
		}
	}

	#createMainServer(): ReturnType<typeof Bun.serve> {
		const { port, statsPort } = this.#options;
		const webUiPort = this.#webUiPort;
		const webUiInternal = `http://127.0.0.1:${webUiPort}`;
		const statsInternal = `http://127.0.0.1:${statsPort}`;

		const server = Bun.serve({
			port,
			hostname: "127.0.0.1",
			async fetch(req) {
				const route = classifyRequest(req, webUiPort);

				switch (route.type) {
					case "stats":
						return proxyRequest(req, statsInternal);
					case "webui":
						return proxyRequest(req, webUiInternal);
					case "unavailable":
						return new Response("Web UI not available", { status: 503 });
				}
			},
		});

		return server;
	}

	/**
	 * 等待 Web UI 后端就绪（通过轮询健康检查）。
	 */
	async waitForWebUiReady(timeoutMs = 15000): Promise<boolean> {
		if (this.#webUiPort === 0) return false;
		const deadline = Date.now() + timeoutMs;
		const url = `http://127.0.0.1:${this.#webUiPort}`;

		while (Date.now() < deadline) {
			try {
				const res = await fetch(url);
				if (res.ok) return true;
			} catch {
				// Server not ready yet
			}
			await Bun.sleep(500);
		}
		return false;
	}
}

// ---------------------------------------------------------------------------
// Convenience: one-shot start matching the serve command pattern
// ---------------------------------------------------------------------------

export async function startZetaServer(options: ZetaServerOptions = {}): Promise<ZetaServerInstance> {
	const server = new ZetaServer(options);
	const instance = await server.start();

	// Wait for Web UI to be ready, then optionally open browser
	if (!options.statsOnly) {
		await server.waitForWebUiReady();
	}

	if (!options.noBrowser) {
		await Bun.sleep(500);
		if (!options.statsOnly) {
			openPath(instance.url);
		} else if (!options.webOnly) {
			openPath(instance.statsUrl);
		}
	}

	return instance;
}
