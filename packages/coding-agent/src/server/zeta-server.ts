/**
 * ZetaServer — 统一 HTTP 反向代理服务器
 *
 * 使用 Bun.serve 作为主服务器，将 Web UI（Next.js）和 Stats Dashboard
 * 作为内部后端代理。用户只需访问一个端口。
 *
 * 架构：
 *   Browser → :30141 (Bun.serve) ─┬─ /api/stats/* → Stats Dashboard (:3847)
 *                                 ├─ /api/*      → Web Gateway（同进程 Bun 处理器）
 *                                 └─ 其余        → Web UI Next.js (随机内部端口)
 */

import { logger } from "@linxiraos/pi-utils";
import { spawnWebUi } from "../commands/web-ui-launcher";
import { openPath } from "../utils/open";
import { startWebGateway, type WebGatewayInstance, webGatewayFetch } from "./web-gateway";

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
	/** Web Gateway 端口，默认 30142（仅 127.0.0.1） */
	gatewayPort?: number;
}

export interface ZetaServerInstance {
	url: string;
	statsUrl: string;
	/** Web Gateway URL（未启动时为 null） */
	gatewayUrl: string | null;
	/** 关闭服务器和所有子进程 */
	shutdown: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** The classification result for an incoming request path. */
export interface ZetaServerRoute {
	type: "stats" | "gateway" | "webui" | "unavailable";
}

/** `/api/*` prefixes that stay in Next.js (pure Node, no runtime imports). */
const NEXT_OWNED_API_PREFIXES = [
	"/api/fs/",
	"/api/files/",
	"/api/cwd/",
	"/api/git/",
	"/api/home",
	"/api/default-cwd",
	"/api/worktrees",
	"/api/tracking",
	"/api/file-index",
];

/**
 * Classify an incoming request based on its URL path.
 * Extracted as a standalone function so routing logic can be tested without
 * a running Bun.serve server.
 */
export function classifyRequest(req: Request, webUiPort: number, gatewayRunning = false): ZetaServerRoute {
	const path = new URL(req.url).pathname;

	if (path.startsWith("/api/stats") || path === "/api/sync" || path.startsWith("/api/request/")) {
		return { type: "stats" };
	}

	if (path.startsWith("/api/")) {
		const staysInNext = NEXT_OWNED_API_PREFIXES.some(prefix => path.startsWith(prefix));
		if (staysInNext) {
			return webUiPort > 0 ? { type: "webui" } : { type: "unavailable" };
		}
		return gatewayRunning ? { type: "gateway" } : { type: "unavailable" };
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
		// Internal proxy: the browser origin (127.0.0.1:30141) never matches the
		// web-ui child port (random ephemeral). web-ui/proxy.ts would 403 every
		// /api/* call as "cross-origin"; drop the header so the child trusts the
		// proxied request (same-origin from the browser's perspective anyway).
		headers.delete("origin");

		const proxyReq = new Request(targetUrl, {
			method: req.method,
			headers,
			body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
		});

		const res = await fetch(proxyReq);
		return normalizeProxiedResponse(res);
	} catch (err) {
		logger.debug("Proxy request failed", {
			target: targetUrl,
			error: err instanceof Error ? err.message : String(err),
		});
		return new Response("Bad Gateway", { status: 502 });
	}
}

/**
 * Bun transparently decodes compressed fetch responses but retains their
 * Content-Encoding header. Passing that stale header to Chromium makes it try
 * to decode the already-plain Web UI chunks a second time.
 */
export function normalizeProxiedResponse(response: Response): Response {
	if (!response.headers.has("content-encoding")) return response;

	const headers = new Headers(response.headers);
	headers.delete("content-encoding");
	headers.delete("content-length");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

// ---------------------------------------------------------------------------
// ZetaServer
// ---------------------------------------------------------------------------

export class ZetaServer {
	readonly #options: Required<ZetaServerOptions>;
	#server: ReturnType<typeof Bun.serve> | null = null;
	#webUiChild: { kill: () => void } | null = null;
	#statsServer: { stop: () => void } | null = null;
	#gateway: WebGatewayInstance | null = null;
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
			gatewayPort: options.gatewayPort ?? 30142,
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
	 * 任一步骤失败都会关闭已启动的子系统，避免端口泄漏。
	 */
	async start(): Promise<ZetaServerInstance> {
		if (this.#running) {
			throw new Error("ZetaServer is already running");
		}
		this.#running = true;

		try {
			const { statsPort, webOnly, statsOnly } = this.#options;

			// 1. Start Stats Dashboard (if not webOnly)
			if (!webOnly) {
				await this.#startStats(statsPort);
			}

			// 2. Start Web UI on a random internal port (if not statsOnly)
			if (!statsOnly) {
				await this.#startWebUi();
			}

			// 2b. Start the Web Gateway listener (dev-mode Next access). The main
			// proxy dispatches in-process, so a busy port only disables the
			// standalone listener — never the gateway itself.
			if (!statsOnly) {
				await this.#startGateway();
			}

			// 3. Start the main Bun.serve proxy
			this.#server = this.#createMainServer();

			return {
				url: this.url,
				statsUrl: this.statsUrl,
				gatewayUrl: this.#gateway?.url ?? null,
				shutdown: () => this.shutdown(),
			};
		} catch (err) {
			this.#running = false;
			await this.shutdown().catch(() => {});
			throw err;
		}
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

		if (this.#gateway) {
			await this.#gateway.shutdown().catch(() => {});
			this.#gateway = null;
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
			const { startServer } = await import("@linxiraos/pi-stats");
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

	async #startGateway(): Promise<void> {
		try {
			this.#gateway = await startWebGateway(this.#options.gatewayPort);
			logger.info("Web Gateway started", { port: this.#gateway.port });
		} catch (err) {
			// In-process dispatch keeps working; only dev-mode rewrites lose
			// their target.
			logger.warn("Failed to start Web Gateway listener", {
				port: this.#options.gatewayPort,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	#createMainServer(): ReturnType<typeof Bun.serve> {
		const { port, statsPort } = this.#options;
		const webUiPort = this.#webUiPort;
		const webUiInternal = `http://127.0.0.1:${webUiPort}`;
		const statsInternal = `http://127.0.0.1:${statsPort}`;
		// The gateway dispatcher lives in-process; the standalone listener is
		// only for dev-mode Next access.
		const gatewayRunning = !this.#options.statsOnly;

		const server = Bun.serve({
			port,
			hostname: "127.0.0.1",
			// Agent streams are Server-Sent Events and may stay quiet between turns.
			idleTimeout: 0,
			async fetch(req) {
				const route = classifyRequest(req, webUiPort, gatewayRunning);

				switch (route.type) {
					case "stats":
						return proxyRequest(req, statsInternal);
					case "gateway":
						return webGatewayFetch(req);
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
