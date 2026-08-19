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

import type { AgentToolResult } from "@linxiraos/pi-agent-core";
import { logger } from "@linxiraos/pi-utils";
import { type ChannelRuntime, registerWechatReconnect, setPendingWechatQr, startChannels } from "../channels";
import type { ChannelId, ChatImage } from "../channels/channel";
import { approveRemotePlan, type PlanApproveMode } from "../channels/plan-approval";
import { renderPlanToPng } from "../channels/plan-image";
import { SessionRouter } from "../channels/session-router";
import { WeChatChannel } from "../channels/wechat";
import { routeWorkspaceCommand } from "../channels/workspace-router";
import { spawnWebUi } from "../commands/web-ui-launcher";
import { WebConfig } from "../config/web-config";
import { humanizePlanTitle, planFileUrlForSlug, planSlugFromSupplied } from "../plan-mode/approved-plan";
import type { AgentSession } from "../session/agent-session";
import { openPath } from "../utils/open";
import { startWebGateway, type WebGatewayInstance, webGatewayFetch } from "./web-gateway";
import { startRpcSession } from "./web-gateway/agents";

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
	#router: SessionRouter | null = null;
	/** Remote plan-approval pending state, keyed by `${channelId}:${peer}`. */
	#pendingPlanApproval = new Map<string, { planFilePath: string }>();
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

			// 2c. Start IM channels when requested or any web.yml channel is enabled.
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
			setPendingWechatQr(null);
			registerWechatReconnect(null);
		}

		if (this.#router) {
			await this.#router.stopAll().catch(() => {});
			this.#router = null;
		}

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
	 * Start IM channels when the `channels` option is set or web.yml enables
	 * any channel. The coordinator session (created through the same RPC
	 * registry the web-ui uses) receives every inbound channel message, so
	 * bot and web-ui see one shared conversation.
	 */
	async #maybeStartChannels(): Promise<void> {
		const webConfig = await WebConfig.load();
		const data = webConfig.getData();
		const anyEnabled = data.channels.wechat.enabled || data.channels.feishu.enabled || data.channels.telegram.enabled;
		if (!this.#options.channels && !anyEnabled) return;

		try {
			// Deferred sink: the channel runtime resolves after startChannels.
			let runtimeRef: ChannelRuntime | null = null;
			const { session } = await startRpcSession("__zeta_serve_coordinator__", "", process.cwd(), undefined, {
				channelSend: async opts => {
					const runtime = runtimeRef;
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
			});

			const coordinator = session.getSession();
			this.#router = new SessionRouter({
				coordinator,
				webConfig,
				getLastInbound: () => runtimeRef?.host.lastInbound ?? null,
				sendText: (channelId, to, text) => {
					const runtime = runtimeRef;
					if (!runtime) throw new Error("IM channels are not started");
					return runtime.sendText(channelId, to, text);
				},
			});

			this.#channelRuntime = await startChannels(
				coordinator,
				webConfig,
				(channelId, peer, body) => {
					const runtime = runtimeRef;
					if (!runtime) return;

					// Remote plan-approval replies: while a plan is awaiting
					// approval on this peer, an exact "1"-"4" reply resolves it
					// instead of reaching the session.
					const pendingKey = `${channelId}:${peer}`;
					const pendingPlan = this.#pendingPlanApproval.get(pendingKey);
					if (pendingPlan) {
						const mode = parsePlanApprovalReply(body);
						if (mode) {
							this.#pendingPlanApproval.delete(pendingKey);
							void this.#executePendingPlanApproval(
								channelId,
								peer,
								pendingPlan.planFilePath,
								mode,
								runtime,
								coordinator,
							);
							return;
						}
					}

					void routeWorkspaceCommand(body, peer, {
						listWorkspaces: () => this.#router?.list() ?? [],
						registerWorkspace: () => {},
						unregisterWorkspace: () => {},
						openWorkspaceSession: async dir => {
							await this.#router?.open(dir);
						},
						closeWorkspaceSession: async name => {
							await this.#router?.close(name);
						},
						sendText: text => runtime.sendText(channelId, peer, text),
						planRequest: title => this.#startRemotePlanRequest(channelId, peer, title, coordinator, runtime),
						fallback: (fallbackBody, fromPeer) =>
							runtime.host.deliver(channelId, fromPeer, fallbackBody).catch(error => {
								logger.warn("Channel message injection failed", {
									channel: channelId,
									error: error instanceof Error ? error.message : String(error),
								});
							}),
					});
				},
				payload => setPendingWechatQr(payload),
			);

			const wechatChannel = this.#channelRuntime.channels.get("wechat");
			registerWechatReconnect(wechatChannel instanceof WeChatChannel ? () => wechatChannel.reconnect() : null);

			runtimeRef = this.#channelRuntime;
			logger.info("IM channels started", { count: this.#channelRuntime.channels.size });
		} catch (error) {
			logger.warn("Failed to start IM channels", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Start a remote plan-mode request (`@plan <title>`): enable plan mode on
	 * the coordinator, install the plan-proposal handler that delivers the
	 * finished plan to the user, then prompt for the plan.
	 */
	async #startRemotePlanRequest(
		channelId: ChannelId,
		peer: string,
		title: string,
		coordinator: AgentSession,
		runtime: ChannelRuntime,
	): Promise<void> {
		// planFilePath follows the existing plan-file rule
		// (`local://<slug>-plan.md` via planFileUrlForSlug). The agent may still
		// choose its own slug; resolveApprovedPlan re-locates the actual file
		// when the plan is submitted, and the handler below syncs state.
		const slug = planSlugFromSupplied(title) ?? "plan";
		coordinator.setPlanModeState({ enabled: true, planFilePath: planFileUrlForSlug(slug), workflow: "parallel" });
		coordinator.setPlanProposalHandler(proposedTitle =>
			this.#handleRemotePlanProposal(channelId, peer, proposedTitle, coordinator, runtime),
		);
		await coordinator.prompt(`制定计划: ${title}…`);
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
		coordinator: AgentSession,
		runtime: ChannelRuntime,
	): Promise<AgentToolResult<unknown>> {
		const result = await coordinator.preparePlanForReview(proposedTitle);
		const state = coordinator.getPlanModeState();
		const planFilePath = result.details?.planFilePath ?? state?.planFilePath ?? "local://PLAN.md";
		const title = result.details?.title ?? proposedTitle;
		if (state) {
			coordinator.setPlanModeState({ ...state, planFilePath });
		}
		this.#pendingPlanApproval.set(`${channelId}:${peer}`, { planFilePath });

		const content = await coordinator.getPlanFileContent(planFilePath);
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

	/** Execute a remote plan-approval decision and report the outcome. */
	async #executePendingPlanApproval(
		channelId: ChannelId,
		peer: string,
		planFilePath: string,
		mode: PlanApproveMode,
		runtime: ChannelRuntime,
		coordinator: AgentSession,
	): Promise<void> {
		try {
			const result = await approveRemotePlan(
				coordinator,
				{ planFilePath, mode },
				{
					getArtifactsDir: () => coordinator.sessionManager.getArtifactsDir(),
					getSessionId: () => coordinator.sessionManager.getSessionId(),
				},
			);
			if (result.approved) {
				const text = coordinator.getLastAssistantText()?.trim() ?? "";
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
