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

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult } from "@linxiraos/pi-agent-core";
import { logger } from "@linxiraos/pi-utils";
import type { ChannelId, ChatImage } from "../channels";
import {
	type ChannelRuntime,
	getChannelStatus,
	registerChannelStatus,
	registerMainSessionId,
	registerRestartChannels,
	registerWechatReconnect,
	registerWechatUnbind,
	setPendingWechatQr,
	startChannels,
	WeChatChannel,
} from "../channels";
import { type ImControlParams, type ImControlResult, runImControl } from "../channels/im-control";
import { approveRemotePlan, type PlanApproveMode } from "../channels/plan-approval";
import { renderPlanToPng } from "../channels/plan-image";
import { COORDINATOR_ALIAS, SessionRouter } from "../channels/session-router";
import { routeWorkspaceCommand } from "../channels/workspace-router";
import { spawnWebUi } from "../commands/web-ui-launcher";
import { WebConfig } from "../config/web-config";
import { humanizePlanTitle, planFileUrlForSlug, planSlugFromSupplied } from "../plan-mode/approved-plan";
import type { AgentSession } from "../session/agent-session";
import { SessionManager } from "../session/session-manager";
import { openPath } from "../utils/open";
import { authorizedForAccess, startWebGateway, type WebGatewayInstance, webGatewayFetch } from "./web-gateway";
import { startRpcSession } from "./web-gateway/agents";
import { getSharedModelRegistry } from "./web-gateway/auth";
import { setBotSessionDispose } from "./web-gateway/running-sessions";

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
	/**
	 * 启动 IM channels（WeChat/Feishu/Telegram）。默认 false；web.yml 中任一
	 * channel 启用时也会自动开启。CLI TUI 模式永不创建 ZetaServer，因此
	 * 纯 CLI 会话不会加载任何 channel 监听器。
	 */
	channels?: boolean;
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

// ---------------------------------------------------------------------------
// web-ui-next (Vite) static hosting
// ---------------------------------------------------------------------------

const NEXT_STATIC_MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".map": "application/json",
	".txt": "text/plain",
	".webmanifest": "application/manifest+json",
};

function findWebUiNextDist(): string | null {
	// 1. Desktop staging / embedded layout: <runtime>/web-ui-next
	// 2. Source repo layout: <repo>/web-ui-next/dist
	const candidates = [
		path.join(import.meta.dir, "..", "..", "web-ui-next"),
		path.join(import.meta.dir, "..", "..", "..", "..", "web-ui-next", "dist"),
		path.join(process.cwd(), "web-ui-next", "dist"),
	];
	for (const candidate of candidates) {
		try {
			if (fs.existsSync(path.join(candidate, "index.html"))) {
				return candidate;
			}
		} catch {
			// unreadable
		}
	}
	return null;
}

function serveWebUiNext(req: Request, distDir: string): Response {
	const url = new URL(req.url);
	let rel = url.pathname;
	if (rel.startsWith("/next")) {
		rel = rel.slice("/next".length);
	}
	if (rel === "" || rel === "/") {
		rel = "/index.html";
	}
	// Directory → index.html (SPA fallback for client routes).
	if (!path.extname(rel)) {
		rel = `${rel}/index.html`;
	}
	const filePath = path.resolve(distDir, `.${rel}`);
	if (!filePath.startsWith(path.resolve(distDir))) {
		return new Response("Forbidden", { status: 403 });
	}
	try {
		if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
			// SPA fallback: unknown client routes serve the app shell.
			const shell = path.join(distDir, "index.html");
			if (!fs.existsSync(shell)) return new Response("Not found", { status: 404 });
			return new Response(fs.readFileSync(shell), {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		}
		const mime = NEXT_STATIC_MIME[path.extname(filePath)] ?? "application/octet-stream";
		return new Response(fs.readFileSync(filePath), { headers: { "Content-Type": mime } });
	} catch {
		return new Response("Not found", { status: 404 });
	}
}

/** Whether the serve process hosts web-ui-next at the web root (uiVersion=next). */
function webUiNextIsDefault(): boolean {
	return process.env.ZETA_UI_VERSION === "next";
}

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

/** Loopback bind hosts (IPv4/IPv6 literals + localhost). `0.0.0.0` is a
 *  bind-all address, NOT loopback — binding it must trigger the token warning. */
function isLoopbackHostname(hostname: string): boolean {
	const normalized = hostname.trim().toLowerCase();
	if (normalized === "localhost" || normalized === "::1" || normalized === "[::1]") {
		return true;
	}
	return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
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

/** Reply options sent with a delivered plan; a user reply maps to a mode. */
const PLAN_APPROVAL_INSTRUCTIONS = "回复 1 执行 / 2 压缩后执行 / 3 新会话执行 / 4 取消";

/** Map an IM reply to a plan-approval mode: 1=preserve, 2=compact, 3=fresh, 4=cancel. */
export function parsePlanApprovalReply(body: string): PlanApproveMode | null {
	const reply = body.trim();
	if (reply === "1") return "preserve";
	if (reply === "2") return "compact";
	if (reply === "3") return "fresh";
	if (reply === "4") return "cancel";
	return null;
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
	#channelRuntime: ChannelRuntime | null = null;
	/** Live runtime read by the message closures (survives runtime restarts). */
	#channelRuntimeRef: ChannelRuntime | null = null;
	/** Coordinator session shared by the router and every channel runtime. */
	#channelCoordinator: AgentSession | null = null;
	#router: SessionRouter | null = null;
	/** Remote plan-approval pending state, keyed by `${channelId}:${peer}`. The
	 *  plan is approved against the session that produced it (relay coordinator
	 *  or a bot session). */
	#pendingPlanApproval = new Map<string, { planFilePath: string; expiresAt: number; session: AgentSession }>();

	/** Upper bound a remote plan waits for an approval reply before expiring. */
	static readonly PLAN_APPROVAL_TTL_MS = 30 * 60_000;
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
			channels: options.channels ?? false,
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

			// 1. Start Stats Dashboard (always when not statsOnly — zeta web
			//    single-mode also serves it for the Stats iframe tab)
			if (!statsOnly) {
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

			// 2c. Start the shared coordinator session (web-ui default chat and
			// CLI attach target). Always, regardless of channel config — the
			// coordinator is the single shared session all clients consume.
			if (!statsOnly) {
				await this.#ensureMainSession();
			}

			// 2d. Start IM channels when requested or any web.yml channel is enabled.
			if (!statsOnly && !webOnly) {
				await this.#maybeStartChannels();
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

		if (this.#channelRuntime) {
			await this.#channelRuntime.stop().catch(() => {});
			this.#channelRuntime = null;
			this.#channelRuntimeRef = null;
			setPendingWechatQr(null);
			registerWechatReconnect(null);
			registerWechatUnbind(null);
		}
		registerRestartChannels(null);
		registerMainSessionId(null);
		this.#channelCoordinator = null;

		if (this.#router) {
			await this.#router.stopAll().catch(() => {});
			this.#router = null;
		}
		setBotSessionDispose(null);

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
			// NEXT_PUBLIC_STATS_URL lets the web-ui Stats iframe tab target the
			// in-process stats dashboard.
			this.#webUiChild = await spawnWebUi(this.#webUiPort, `http://127.0.0.1:${this.#options.statsPort}`);
			logger.info("Web UI backend started", { internalPort: this.#webUiPort });
		} catch (err) {
			logger.warn("Failed to start Web UI backend", {
				error: err instanceof Error ? err.message : String(err),
			});
			throw err;
		}
	}

	/**
	 * Ensure the shared coordinator session + router exist (always, even when
	 * no channel is enabled): the web-ui default chat and CLI attach target
	 * this session. Idempotent; created once per serve process.
	 */
	async #ensureMainSession(webConfig?: WebConfig): Promise<void> {
		if (this.#channelCoordinator) return;
		const config = webConfig ?? (await WebConfig.load());
		// The coordinator gets a stable, persisted session file in the default
		// workspace's session dir so its conversation shows up in the web UI
		// session list and survives restarts (file-less sessions are invisible).
		const coordinatorFile = path.join(SessionManager.getDefaultSessionDir(process.cwd()), "zeta-bot.jsonl");
		const { session, realSessionId } = await startRpcSession(
			"__zeta_serve_coordinator__",
			coordinatorFile,
			process.cwd(),
			undefined,
			{
				channelSend: async opts => {
					const runtime = this.#channelRuntimeRef;
					const router = this.#router;
					if (!runtime || !router) throw new Error("IM channels are not started");
					const target = router.resolvePush(opts);
					if (!target) throw new Error("No channel or peer bound to this session");
					await runtime.sendText(target.channelId, target.to, opts.text);
				},
				workspaceRun: async opts => {
					const router = this.#router;
					if (!router) throw new Error("Workspace router is not started");
					return router.run(opts.workspace, opts.task);
				},
				imControl: params => this.#imControlHook("coordinator", params),
			},
		);
		this.#channelCoordinator = session.getSession();
		// Give the coordinator a recognizable name in the session list ("Zeta Bot"
		// relay conversation), distinct from user/workspace sessions.
		await this.#channelCoordinator.sessionManager.setSessionName("Zeta Bot (Relay)", "user").catch(() => {});
		registerMainSessionId(realSessionId);
		this.#router = new SessionRouter({
			coordinator: this.#channelCoordinator,
			webConfig: config,
			getLastInbound: () => this.#channelRuntimeRef?.host.lastInbound ?? null,
			sendText: (channelId, to, text) => {
				const runtime = this.#channelRuntimeRef;
				if (!runtime) throw new Error("IM channels are not started");
				return runtime.sendText(channelId, to, text);
			},
			defaultCwd: process.cwd(),
			channelSend: opts => this.#channelSendHook(opts),
			workspaceRun: opts => this.#workspaceRunHook(opts),
			imControl: (sessionKey, params) => this.#imControlHook(sessionKey, params),
			// Bot sessions route through startRpcSession so they register in the
			// web gateway (web-UI plan approval opens them by id) and never spawn
			// a duplicate live session on the same transcript.
			createBotSessionRuntime: async entry => {
				const { session } = await startRpcSession(
					`__zeta_serve_bot__${entry.id}`,
					entry.sessionFile,
					process.cwd(),
					undefined,
					{
						channelSend: opts => this.#channelSendHook(opts),
						workspaceRun: opts => this.#workspaceRunHook(opts),
						imControl: params => this.#imControlHook(entry.id, params),
					},
				);
				return session.getSession();
			},
		});
		// Default-space session registry: the relay entry is the coordinator's
		// transcript and can never be deleted.
		await this.#router.ensureRelaySession(coordinatorFile);
		// Web-UI bot-session deletion reaches the live runtime through this hook.
		setBotSessionDispose(id => this.#router?.deleteBotSession(id));
	}

	/** channel_send tool sink shared by the coordinator and every bot session. */
	#channelSendHook(opts: { text: string; to?: string; channel?: string }): Promise<void> {
		const runtime = this.#channelRuntimeRef;
		const router = this.#router;
		if (!runtime || !router) throw new Error("IM channels are not started");
		const target = router.resolvePush(opts);
		if (!target) throw new Error("No channel or peer bound to this session");
		return runtime.sendText(target.channelId, target.to, opts.text);
	}

	/** workspace_run tool sink shared by the coordinator and every bot session. */
	#workspaceRunHook(opts: { workspace: string; task: string }): Promise<{ reply: string }> {
		const router = this.#router;
		if (!router) throw new Error("Workspace router is not started");
		return router.run(opts.workspace, opts.task);
	}

	/**
	 * im_control tool sink shared by the coordinator and every bot session.
	 * `sessionKey` ("coordinator" or a bot-session id) lets the router resolve
	 * the invoking chat without guessing.
	 */
	#imControlHook(sessionKey: string, params: ImControlParams): Promise<ImControlResult> {
		return runImControl(this.#router, sessionKey, params, {
			listModels: () => this.#listModels(),
			setChatModel: (channelId, peer, provider, modelId) => this.#setChatModel(channelId, peer, provider, modelId),
			getChatModel: (channelId, peer) => this.#getChatModel(channelId, peer),
			getChannelStatus: () => getChannelStatus(),
		});
	}

	/**
	 * Start IM channels when the `channels` option is set or web.yml enables
	 * any channel. The coordinator session (created through the same RPC
	 * registry the web-ui uses) receives every inbound channel message, so
	 * bot and web-ui see one shared conversation.
	 */
	async #maybeStartChannels(): Promise<void> {
		// Register the live restart hook regardless of boot state: toggling a
		// channel in the web UI must take effect immediately (QR login included)
		// even when no channel was enabled at serve start.
		registerRestartChannels(async () => this.#restartChannels());
		try {
			const webConfig = await WebConfig.load();
			await this.#ensureMainSession(webConfig);
			await this.#startChannelRuntime(webConfig);
		} catch (error) {
			logger.warn("Failed to start IM channels", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/** Stop the current channel runtime (if any) and clear its registrations. */
	async #stopChannelRuntime(): Promise<void> {
		if (this.#channelRuntime) {
			await this.#channelRuntime.stop().catch(() => {});
			this.#channelRuntime = null;
		}
		this.#channelRuntimeRef = null;
		setPendingWechatQr(null);
		registerWechatReconnect(null);
		registerWechatUnbind(null);
		registerChannelStatus(null);
	}

	/** Start the channel runtime when any channel is enabled (fresh copy). */
	async #startChannelRuntime(webConfig: WebConfig): Promise<void> {
		const data = webConfig.getData();
		const anyEnabled = data.channels.wechat.enabled || data.channels.feishu.enabled || data.channels.telegram.enabled;
		if (!this.#options.channels && !anyEnabled) {
			await this.#stopChannelRuntime();
			return;
		}
		const coordinator = this.#channelCoordinator;
		if (!coordinator) throw new Error("IM coordinator is not started");
		await this.#stopChannelRuntime();
		this.#channelRuntime = await startChannels(
			coordinator,
			webConfig,
			(channelId, peer, body) => {
				const runtime = this.#channelRuntimeRef;
				if (!runtime) return;

				// Remote plan-approval replies: while a plan is awaiting
				// approval on this peer, an exact "1"-"4" reply resolves it
				// instead of reaching the session.
				const pendingKey = `${channelId}:${peer}`;
				const pendingPlan = this.#pendingPlanApproval.get(pendingKey);
				if (pendingPlan) {
					// Expired approvals no longer intercept replies — the plan
					// may reference a stale file; treat the reply as a message.
					if (Date.now() > pendingPlan.expiresAt) {
						this.#pendingPlanApproval.delete(pendingKey);
					} else {
						const mode = parsePlanApprovalReply(body);
						if (mode) {
							this.#pendingPlanApproval.delete(pendingKey);
							void this.#executePendingPlanApproval(
								channelId,
								peer,
								pendingPlan.planFilePath,
								mode,
								runtime,
								pendingPlan.session,
							);
							return;
						}
					}
				}

				void (async () => {
					try {
						await this.#routeInboundMessage(channelId as ChannelId, peer, body, runtime);
					} catch (error) {
						// Never drop a message silently: log the failure so a broken
						// route (workspace session, bot session, relay) is visible in
						// ~/.zeta/logs instead of the chat going quiet.
						logger.error("Channel message routing failed", {
							channel: channelId,
							peer,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				})();
			},
			payload => setPendingWechatQr(payload),
		);
		this.#channelRuntimeRef = this.#channelRuntime;
		registerChannelStatus(() =>
			["wechat", "feishu", "telegram"].map(id => ({
				id: id as ChannelId,
				running: this.#channelRuntimeRef?.channels.has(id as ChannelId) ?? false,
			})),
		);
		const wechatChannel = this.#channelRuntime.channels.get("wechat");
		registerWechatReconnect(wechatChannel instanceof WeChatChannel ? () => wechatChannel.reconnect() : null);
		registerWechatUnbind(wechatChannel instanceof WeChatChannel ? () => wechatChannel.unbind() : null);
		logger.info("IM channels started", { count: this.#channelRuntime.channels.size });
	}

	/** Live channel config re-apply: stop + re-start per the fresh web.yml. */
	async #restartChannels(): Promise<void> {
		try {
			const webConfig = await WebConfig.load();
			await this.#ensureMainSession(webConfig);
			await this.#startChannelRuntime(webConfig);
		} catch (error) {
			logger.warn("Failed to restart IM channels", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Start a remote plan-mode request (`@plan <title>`): enable plan mode on
	 * the chat's target session (active bot session, else the relay
	 * coordinator), install the plan-proposal handler that delivers the
	 * finished plan to the user, then prompt for the plan.
	 */
	async #startRemotePlanRequest(
		channelId: ChannelId,
		peer: string,
		title: string,
		runtime: ChannelRuntime,
	): Promise<void> {
		const router = this.#router;
		const coordinator = this.#channelCoordinator;
		if (!router || !coordinator) {
			await runtime.sendText(channelId, peer, "会话尚未就绪，请稍后再试。");
			return;
		}
		const target = await router.resolveChatTargetSession(channelId, peer);
		if (!target.ok) {
			await runtime.sendText(channelId, peer, target.error);
			return;
		}
		const session = target.session;
		// planFilePath follows the existing plan-file rule
		// (`local://<slug>-plan.md` via planFileUrlForSlug). The agent may still
		// choose its own slug; resolveApprovedPlan re-locates the actual file
		// when the plan is submitted, and the handler below syncs state.
		const slug = planSlugFromSupplied(title) ?? "plan";
		session.setPlanModeState({ enabled: true, planFilePath: planFileUrlForSlug(slug), workflow: "parallel" });
		session.setPlanProposalHandler(proposedTitle =>
			this.#handleRemotePlanProposal(channelId, peer, proposedTitle, session, runtime),
		);
		await session.prompt(`制定计划: ${title}…`);
	}

	/**
	 * Plan-proposal handler for remote plan mode: resolve the authoritative
	 * plan file, sync plan-mode state to it (so web-ui get_state / plan_approve
	 * target the real file), register the pending IM approval, and deliver the
	 * plan to the user as an image (text fallback).
	 */
	async #handleRemotePlanProposal(
		channelId: ChannelId,
		peer: string,
		proposedTitle: string,
		session: AgentSession,
		runtime: ChannelRuntime,
	): Promise<AgentToolResult<unknown>> {
		const result = await session.preparePlanForReview(proposedTitle);
		const state = session.getPlanModeState();
		const planFilePath = result.details?.planFilePath ?? state?.planFilePath ?? "local://PLAN.md";
		const title = result.details?.title ?? proposedTitle;
		if (state) {
			session.setPlanModeState({ ...state, planFilePath });
		}
		this.#pendingPlanApproval.set(`${channelId}:${peer}`, {
			planFilePath,
			expiresAt: Date.now() + ZetaServer.PLAN_APPROVAL_TTL_MS,
			session,
		});

		const content = await session.getPlanFileContent(planFilePath);
		if (content) {
			const planTitle = humanizePlanTitle(title);
			const { pngData, markdown } = await renderPlanToPng(content);
			if (pngData) {
				const image: ChatImage = { data: pngData, mime: "image/png" };
				await runtime.sendImage(channelId, peer, image, planTitle || undefined);
				await runtime.sendText(channelId, peer, PLAN_APPROVAL_INSTRUCTIONS);
			} else {
				await runtime.sendText(
					channelId,
					peer,
					`计划已就绪${planTitle ? `：${planTitle}` : ""}：\n\n${markdown}\n\n${PLAN_APPROVAL_INSTRUCTIONS}`,
				);
			}
		}
		return result;
	}

	/** Execute a remote plan-approval decision on the session that produced the plan. */
	async #executePendingPlanApproval(
		channelId: ChannelId,
		peer: string,
		planFilePath: string,
		mode: PlanApproveMode,
		runtime: ChannelRuntime,
		session: AgentSession,
	): Promise<void> {
		try {
			const result = await approveRemotePlan(
				session,
				{ planFilePath, mode },
				{
					getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
					getSessionId: () => session.sessionManager.getSessionId(),
				},
			);
			if (result.approved) {
				const text = session.getLastAssistantText()?.trim() ?? "";
				await runtime.sendText(channelId, peer, text ? `计划执行完成：\n\n${text}` : "计划已开始执行。");
			} else if (mode !== "cancel") {
				await runtime.sendText(channelId, peer, `计划未执行：${result.error ?? "未知错误"}`);
			}
		} catch (error) {
			logger.warn("Remote plan approval failed", {
				channel: channelId,
				mode,
				error: error instanceof Error ? error.message : String(error),
			});
			await runtime
				.sendText(channelId, peer, `计划执行失败：${error instanceof Error ? error.message : String(error)}`)
				.catch(() => {});
		}
	}

	/** Route one inbound channel message: commands → workspace direct → active bot
	 *  session → relay coordinator (with the chat's reply-language prefix). */
	async #routeInboundMessage(
		channelId: ChannelId,
		peer: string,
		body: string,
		runtime: ChannelRuntime,
	): Promise<void> {
		const router = this.#router;
		const consumed = await routeWorkspaceCommand(body, peer, {
			router,
			channelId,
			peer,
			sendText: text => runtime.sendText(channelId, peer, text),
			planRequest: title => this.#startRemotePlanRequest(channelId, peer, title, runtime),
			fallback: async () => {},
			channelStatus: () => getChannelStatus(),
			listModels: () => this.#listModels(),
			setChatModel: (provider, modelId) => this.#setChatModel(channelId, peer, provider, modelId),
			getChatModel: () => this.#getChatModel(channelId, peer),
		});
		if (consumed) return;
		// Direct-mode chats are bound to a workspace; everything else goes
		// to the chat's active bot session, then the relay coordinator.
		const binding = router ? await router.bindingFor(channelId, peer) : null;
		if (binding && binding !== COORDINATOR_ALIAS && router) {
			const result = await router.deliverDirect(binding, channelId, peer, body);
			if (!result.ok) {
				logger.warn("Direct-mode injection failed", {
					channel: channelId,
					error: result.error,
				});
				await runtime.host.deliver(channelId, peer, body);
			}
			return;
		}
		if (router) {
			const activeId = await router.activeBotSessionIdFor(channelId, peer);
			if (activeId && activeId !== "relay") {
				const result = await router.deliverToBotSession(activeId, channelId, peer, body);
				if (result.ok) return;
				logger.warn("Bot session injection failed", {
					channel: channelId,
					error: result.error,
				});
			}
		}
		// Relay: prefix the chat's reply language so the shared coordinator
		// session replies in the right language without per-chat system prompts
		// (the prefix stays in the transcript as a one-line hint).
		const lang = router ? await router.languageFor(channelId, peer) : undefined;
		const relayBody = lang ? `[Language: ${lang === "zh" ? "zh-CN" : "en"}] ${body}` : body;
		await runtime.host.deliver(channelId, peer, relayBody);
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

	/** Available models grouped by provider, alphabetical (stable `!model` numbering). */
	async #listModels(): Promise<{ provider: string; models: string[] }[]> {
		const registry = await getSharedModelRegistry();
		const groups = new Map<string, string[]>();
		for (const model of registry.getAvailable()) {
			const list = groups.get(model.provider) ?? [];
			list.push(model.id);
			groups.set(model.provider, list);
		}
		return [...groups.entries()]
			.map(([provider, models]) => ({ provider, models: [...models].sort() }))
			.sort((a, b) => a.provider.localeCompare(b.provider));
	}

	/** `!model <provider> <id>` — switch the chat's target session (bot or relay). */
	async #setChatModel(
		channelId: ChannelId,
		peer: string,
		provider: string,
		modelId: string,
	): Promise<{ ok: true; provider: string; modelId: string } | { ok: false; error: string }> {
		const router = this.#router;
		const target = router ? await router.resolveChatTargetSession(channelId, peer) : null;
		if (!target?.ok) return { ok: false, error: target?.error ?? "No target session" };
		const registry = await getSharedModelRegistry();
		const model = registry.getAvailable().find(m => m.provider === provider && m.id === modelId);
		if (!model) return { ok: false, error: `Model ${provider}/${modelId} is not available` };
		await target.session.setModel(model);
		return { ok: true, provider, modelId };
	}

	/** Current model of the chat's target session (`!status`). */
	async #getChatModel(channelId: ChannelId, peer: string): Promise<{ provider: string; modelId: string } | null> {
		const router = this.#router;
		const target = router ? await router.resolveChatTargetSession(channelId, peer) : null;
		if (!target?.ok) return null;
		const model = target.session.model;
		return model ? { provider: model.provider, modelId: model.id } : null;
	}

	#createMainServer(): ReturnType<typeof Bun.serve> {
		const { port, statsPort } = this.#options;
		const webUiPort = this.#webUiPort;
		const webUiInternal = `http://127.0.0.1:${webUiPort}`;
		const statsInternal = `http://127.0.0.1:${statsPort}`;
		// The gateway dispatcher lives in-process; the standalone listener is
		// only for dev-mode Next access.
		const gatewayRunning = !this.#options.statsOnly;
		// Loopback by default; operators may explicitly expose the server to the
		// LAN (or WAN) via env. A non-loopback bind MUST pair with a configured
		// remote token or every API request is rejected by the access gate.
		const hostname = process.env.ZETA_SERVE_HOSTNAME ?? "127.0.0.1";
		if (!isLoopbackHostname(hostname)) {
			logger.warn("正在非 loopback 地址监听 —— 必须配置 remote.token，否则所有 API 请求将被拒绝", {
				hostname,
			});
		}

		const server = Bun.serve({
			port,
			hostname,
			// Agent streams are Server-Sent Events and may stay quiet between turns.
			idleTimeout: 0,
			async fetch(req, srv) {
				const route = classifyRequest(req, webUiPort, gatewayRunning);
				const remoteAddr = srv?.requestIP(req)?.address;

				// web-ui-next static bundle: explicit /next prefix always served;
				// when uiVersion=next the web root also hosts web-ui-next. Vite's
				// default base "/" puts assets under /assets/, so that prefix is
				// served from the same bundle too.
				const pathname = new URL(req.url).pathname;
				const nextDist = findWebUiNextDist();
				const isNextPath = pathname.startsWith("/next") || pathname.startsWith("/assets");
				if (nextDist && (isNextPath || (webUiNextIsDefault() && !pathname.startsWith("/api/")))) {
					return serveWebUiNext(req, nextDist);
				}

				switch (route.type) {
					case "stats":
						return (await authorizedForAccess(req, remoteAddr))
							? proxyRequest(req, statsInternal)
							: new Response(
									JSON.stringify({ error: "Forbidden: remote access requires the configured remote token" }),
									{
										status: 403,
										headers: { "Content-Type": "application/json" },
									},
								);
					case "gateway":
						return webGatewayFetch(req, remoteAddr);
					case "webui":
						return proxyRequest(req, webUiInternal);
				}
				// Exhaustive above; a fallback keeps the handler's return type `Response`.
				return new Response("Not found", { status: 404 });
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
