/**
 * Web Gateway — Bun HTTP entry for runtime-backed web-ui APIs.
 *
 * Route ownership is defined in `document/web-gateway.md`. W1 serves the
 * sessions family (`/api/sessions*`); further families land in later batches
 * and stay 404 (`{ error: "Not implemented" }`) until then.
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

const DEFAULT_GATEWAY_PORT = 30142;

const SESSION_ID_PART = "[A-Za-z0-9-]+";

const SESSION_LIST_RE = /^\/api\/sessions$/;
const SESSION_ID_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})$`);
const SESSION_CONTEXT_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/context$`);
const SESSION_STATE_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/state$`);
const SESSION_THINKING_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/entries/(${SESSION_ID_PART})/thinking$`);
const SESSION_EXPORT_RE = new RegExp(`^/api/sessions/(${SESSION_ID_PART})/export$`);

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
