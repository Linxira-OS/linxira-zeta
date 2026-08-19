/**
 * Web Gateway — Bun HTTP entry for runtime-backed web-ui APIs.
 *
 * Route ownership is defined in `document/web-gateway.md`. W1 serves the
 * sessions family, W2 the agent family, W3 the auth + models families, W4
 * the skills + plugins families; unclaimed `/api/*` stays 404
 * (`{ error: "Not implemented" }`).
 *
 * Two access paths share one handler:
 * - `zeta serve` → ZetaServer dispatches `webGatewayFetch` in-process for
 *   `/api/*` before proxying to Next.
 * - `next dev` / `next start` standalone → next.config `beforeFiles` rewrites
 *   forward the gateway-owned families to the standalone listener started by
 *   `startWebGateway()` on 127.0.0.1 (`ZETA_WEB_GATEWAY_PORT`, default 30142).
 */

import * as os from "node:os";
import * as path from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { getPendingWechatQr, triggerWechatReconnect } from "../channels";
import {
	handleAgentCommand,
	handleAgentEvents,
	handleAgentNew,
	handleAgentState,
	handleRunningEvents,
} from "./web-gateway/agents";
import {
	handleAllProviders,
	handleApiKeyDelete,
	handleApiKeyGet,
	handleApiKeyPost,
	handleLoginGet,
	handleLoginPost,
	handleLogout,
	handleOAuthProviders,
} from "./web-gateway/auth";
import {
	handleModels,
	handleModelsConfigGet,
	handleModelsConfigPut,
	handleModelsConfigTest,
	handleModelsDefaultPut,
	handleModelsImport,
} from "./web-gateway/models";
import { handleOpenGet, handleOpenPost } from "./web-gateway/open";
import { handlePluginsGet, handlePluginsPost } from "./web-gateway/plugins";
import {
	handleDeleteSession,
	handleExportSession,
	handleGetSession,
	handleListSessions,
	handleRenameSession,
	handleSessionContext,
	handleSessionState,
	handleThinking,
} from "./web-gateway/sessions";
import { handleSettingsGet, handleSettingsPut, handleSettingsReload } from "./web-gateway/settings";
import {
	handleSkillsCheck,
	handleSkillsGet,
	handleSkillsInstall,
	handleSkillsPatch,
	handleSkillsSearch,
	handleSkillsUpdate,
} from "./web-gateway/skills";
import { handleUpdateCheck, handleUpdateDownload, handleUpdateInstall } from "./web-gateway/update";
import { handleWebConfigGet, handleWebConfigPut } from "./web-gateway/web-config";

const DEFAULT_GATEWAY_PORT = 30142;

const SESSION_ID_PART = "[A-Za-z0-9-]+";
const PROVIDER_PART = "[A-Za-z0-9_.-]+";

const SESSION_LIST_RE = /^\/api\/sessions$/;
const SESSION_ID_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})$`);
const SESSION_CONTEXT_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/context$`);
const SESSION_STATE_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/state$`);
const SESSION_THINKING_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/entries/(${SESSION_ID_PART})/thinking$`);
const SESSION_EXPORT_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/export$`);

// Literal agent routes are matched before the generic /api/agent/:id forms.
const AGENT_ID_RE = new RegExp(`^/api/agent/(${SESSION_ID_PART})$`);
const AGENT_EVENTS_RE = new RegExp(`^/api/agent/(${SESSION_ID_PART})/events$`);

const AUTH_ALL_PROVIDERS_RE = /^\/api\/auth\/all-providers$/;
const AUTH_PROVIDERS_RE = /^\/api\/auth\/providers$/;
const AUTH_API_KEY_RE = new RegExp(`^/api/auth/api-key/(${PROVIDER_PART})$`);
const AUTH_LOGIN_RE = new RegExp(`^/api/auth/login/(${PROVIDER_PART})$`);
const AUTH_LOGOUT_RE = new RegExp(`^/api/auth/logout/(${PROVIDER_PART})$`);
const MODELS_RE = /^\/api\/models$/;
const MODELS_IMPORT_RE = /^\/api\/models\/import$/;
const MODELS_DEFAULT_RE = /^\/api\/models\/default$/;
const MODELS_CONFIG_RE = /^\/api\/models-config$/;
const MODELS_CONFIG_TEST_RE = /^\/api\/models-config\/test$/;
const SKILLS_RE = /^\/api\/skills$/;
const SKILLS_INSTALL_RE = /^\/api\/skills\/install$/;
const SKILLS_SEARCH_RE = /^\/api\/skills\/search$/;
const SKILLS_CHECK_RE = /^\/api\/skills\/check$/;
const SKILLS_UPDATE_RE = /^\/api\/skills\/update$/;
const OPEN_RE = /^\/api\/open$/;
const OPEN_OPTIONS_RE = /^\/api\/open\/options$/;
const UPDATE_CHECK_RE = /^\/api\/update\/check$/;
const UPDATE_DOWNLOAD_RE = /^\/api\/update\/download$/;
const UPDATE_INSTALL_RE = /^\/api\/update\/install$/;
const PLUGINS_RE = /^\/api\/plugins$/;
const SETTINGS_RE = /^\/api\/settings$/;
const SETTINGS_RELOAD_RE = /^\/api\/settings\/reload$/;
const WEB_CONFIG_RE = /^\/api\/web-config$/;
const CHANNELS_WECHAT_QR_RE = /^\/api\/channels\/wechat\/qrcode$/;
const CHANNELS_WECHAT_RECONNECT_RE = /^\/api\/channels\/wechat\/reconnect$/;

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

function capture(pathname: string, re: RegExp): string[] | null {
	const match = pathname.match(re);
	return match ? match.slice(1) : null;
}

/**
 * Normalize the agent-dir env like the legacy web-ui server did, then rebuild
 * the dirs resolver so `getAgentDir()` honors the result in this process.
 * `ZETA_CODING_AGENT_DIR` → `OMP_CODING_AGENT_DIR` → `PI_CODING_AGENT_DIR` →
 * `~/.zeta/agent` (the runtime default). Idempotent; safe to call repeatedly.
 */
export function ensureAgentDirEnv(): void {
	const resolved =
		process.env.ZETA_CODING_AGENT_DIR ??
		process.env.OMP_CODING_AGENT_DIR ??
		process.env.PI_CODING_AGENT_DIR ??
		path.join(os.homedir(), ".zeta", "agent");
	process.env.ZETA_CODING_AGENT_DIR ??= resolved;
	process.env.OMP_CODING_AGENT_DIR ??= resolved;
	process.env.PI_CODING_AGENT_DIR ??= resolved;
	refreshDirsFromEnv();
}

/** In-process fetch handler; ZetaServer dispatches to this directly. */
export async function webGatewayFetch(req: Request): Promise<Response> {
	ensureAgentDirEnv();

	const pathname = new URL(req.url).pathname;

	if (SESSION_LIST_RE.test(pathname)) {
		if (req.method === "GET") return handleListSessions();
		return json({ error: "Method not allowed" }, 405);
	}

	const id = capture(pathname, SESSION_ID_RE);
	if (id) {
		const [sessionId] = id;
		if (req.method === "GET") return handleGetSession(req, sessionId);
		if (req.method === "PATCH") return handleRenameSession(req, sessionId);
		if (req.method === "DELETE") return handleDeleteSession(sessionId);
		return json({ error: "Method not allowed" }, 405);
	}

	const context = capture(pathname, SESSION_CONTEXT_RE);
	if (context) {
		if (req.method === "GET") return handleSessionContext(req, context[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	const state = capture(pathname, SESSION_STATE_RE);
	if (state) {
		if (req.method === "GET") return handleSessionState(state[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	const thinking = capture(pathname, SESSION_THINKING_RE);
	if (thinking) {
		if (req.method === "GET") return handleThinking(req, thinking[0], thinking[1]);
		return json({ error: "Method not allowed" }, 405);
	}

	const exp = capture(pathname, SESSION_EXPORT_RE);
	if (exp) {
		if (req.method === "GET") return handleExportSession(req, exp[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/agent/new") {
		if (req.method === "POST") return handleAgentNew(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (pathname === "/api/agent/running/events") {
		if (req.method === "GET") return handleRunningEvents(req);
		return json({ error: "Method not allowed" }, 405);
	}

	const agentEvents = capture(pathname, AGENT_EVENTS_RE);
	if (agentEvents) {
		if (req.method === "GET") return handleAgentEvents(req, agentEvents[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	const agentId = capture(pathname, AGENT_ID_RE);
	if (agentId) {
		if (req.method === "GET") return handleAgentState(agentId[0]);
		if (req.method === "POST") return handleAgentCommand(req, agentId[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	if (AUTH_ALL_PROVIDERS_RE.test(pathname)) {
		if (req.method === "GET") return handleAllProviders();
		return json({ error: "Method not allowed" }, 405);
	}

	if (AUTH_PROVIDERS_RE.test(pathname)) {
		if (req.method === "GET") return handleOAuthProviders();
		return json({ error: "Method not allowed" }, 405);
	}

	const apiKey = capture(pathname, AUTH_API_KEY_RE);
	if (apiKey) {
		if (req.method === "GET") return handleApiKeyGet(apiKey[0]);
		if (req.method === "POST") return handleApiKeyPost(apiKey[0], req);
		if (req.method === "DELETE") return handleApiKeyDelete(apiKey[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	const login = capture(pathname, AUTH_LOGIN_RE);
	if (login) {
		if (req.method === "GET") return handleLoginGet(login[0], req);
		if (req.method === "POST") return handleLoginPost(login[0], req);
		return json({ error: "Method not allowed" }, 405);
	}

	const logout = capture(pathname, AUTH_LOGOUT_RE);
	if (logout) {
		if (req.method === "POST") return handleLogout(logout[0]);
		return json({ error: "Method not allowed" }, 405);
	}

	if (MODELS_RE.test(pathname)) {
		if (req.method === "GET") return handleModels(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (MODELS_IMPORT_RE.test(pathname)) {
		return handleModelsImport(req);
	}

	if (MODELS_DEFAULT_RE.test(pathname)) {
		if (req.method === "PUT") return handleModelsDefaultPut(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (MODELS_CONFIG_TEST_RE.test(pathname)) {
		if (req.method === "POST") return handleModelsConfigTest(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (MODELS_CONFIG_RE.test(pathname)) {
		if (req.method === "GET") return handleModelsConfigGet();
		if (req.method === "PUT") return handleModelsConfigPut(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (SKILLS_RE.test(pathname)) {
		if (req.method === "GET") return handleSkillsGet(req);
		if (req.method === "PATCH") return handleSkillsPatch(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (SKILLS_INSTALL_RE.test(pathname)) {
		if (req.method === "POST") return handleSkillsInstall(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (SKILLS_SEARCH_RE.test(pathname)) {
		if (req.method === "POST") return handleSkillsSearch(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (SKILLS_CHECK_RE.test(pathname)) {
		if (req.method === "POST") return handleSkillsCheck(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (SKILLS_UPDATE_RE.test(pathname)) {
		if (req.method === "POST") return handleSkillsUpdate(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (OPEN_OPTIONS_RE.test(pathname)) {
		if (req.method === "GET") return handleOpenGet(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (OPEN_RE.test(pathname)) {
		if (req.method === "OPTIONS") return new Response("", { status: 204, headers: { Allow: "POST, OPTIONS" } });
		if (req.method === "POST") return handleOpenPost(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (UPDATE_CHECK_RE.test(pathname)) {
		return handleUpdateCheck(req);
	}

	if (UPDATE_DOWNLOAD_RE.test(pathname)) {
		return handleUpdateDownload(req);
	}

	if (UPDATE_INSTALL_RE.test(pathname)) {
		return handleUpdateInstall(req);
	}

	if (PLUGINS_RE.test(pathname)) {
		if (req.method === "GET") return handlePluginsGet(req);
		if (req.method === "POST") return handlePluginsPost(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (SETTINGS_RELOAD_RE.test(pathname)) {
		return handleSettingsReload(req);
	}

	if (SETTINGS_RE.test(pathname)) {
		if (req.method === "GET") return handleSettingsGet(req);
		if (req.method === "PUT") return handleSettingsPut(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (WEB_CONFIG_RE.test(pathname)) {
		if (req.method === "GET") return handleWebConfigGet();
		if (req.method === "PUT") return handleWebConfigPut(req);
		return json({ error: "Method not allowed" }, 405);
	}

	if (CHANNELS_WECHAT_QR_RE.test(pathname)) {
		if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
		const qr = getPendingWechatQr();
		if (!qr) return json({ pending: false });
		return json({ pending: true, qrcodeUrl: qr.qrcodeUrl, status: qr.status });
	}

	if (CHANNELS_WECHAT_RECONNECT_RE.test(pathname)) {
		if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
		const trigger = triggerWechatReconnect();
		if (!trigger) return json({ error: "WeChat channel is not running" }, 404);
		try {
			await trigger;
			return json({ ok: true });
		} catch (error) {
			return json({ error: error instanceof Error ? error.message : String(error) }, 500);
		}
	}

	if (pathname.startsWith("/api/")) {
		return json({ error: "Not implemented" }, 404);
	}

	return json({ error: "Not found" }, 404);
}

export interface WebGatewayInstance {
	port: number;
	url: string;
	shutdown: () => Promise<void>;
}

/**
 * Start the standalone gateway listener for `next dev`/`next start` access.
 * ZetaServer itself dispatches in-process and does not depend on this port;
 * callers should treat a thrown error as non-fatal when the port is busy.
 */
export async function startWebGateway(port?: number): Promise<WebGatewayInstance> {
	ensureAgentDirEnv();

	const gatewayPort = port ?? Number(process.env.ZETA_WEB_GATEWAY_PORT ?? DEFAULT_GATEWAY_PORT);
	if (!Number.isSafeInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65_535) {
		throw new Error(`Invalid ZETA_WEB_GATEWAY_PORT: ${gatewayPort}`);
	}

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: gatewayPort,
		idleTimeout: 0,
		fetch: webGatewayFetch,
	});

	return {
		port: server.port ?? gatewayPort,
		url: `http://127.0.0.1:${server.port ?? gatewayPort}`,
		shutdown: async () => {
			server.stop(true);
		},
	};
}
