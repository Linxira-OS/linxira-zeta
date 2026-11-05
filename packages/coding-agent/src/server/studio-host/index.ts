/**
 * Studio host — the browser-facing semantic contract of `zeta serve`.
 *
 * Zeta serves the Studio renderer (`web-app/`) itself, so the host contract the
 * Renderer was written against is answered here rather than by a separate
 * desktop bridge: `GET /health`, `POST /api/v1/pair`, `POST /api/v1/session/revoke`,
 * `GET /api/v1/bootstrap`, `POST /api/v1/query`, `POST /api/v1/command` and the
 * `/api/v1/events` WebSocket.
 *
 * Split:
 * - `registry.ts` merges the operation families and shapes the envelopes;
 * - `bootstrap.ts` builds the mount payload (identity, runtime, surfaces);
 * - `ops/*.ts` map one Studio domain onto Zeta gateway routes;
 * - `gateway.ts` is the only path from an operation to Zeta state;
 * - `server.ts` owns auth (pairing, cookie, CSRF), routing and the socket.
 */
export {
	StudioHost,
	studioHost,
	setStudioHostForTest,
	isStudioRequest,
	isStudioWsUpgradeRequest,
	STUDIO_EVENTS_PATH,
	STUDIO_SESSION_COOKIE,
	STUDIO_CSRF_HEADER,
} from "./server.js";
export type { StudioWsData, StudioWsServer } from "./server.js";
export { StudioOperations, toClientError } from "./registry.js";
export type { StudioFamily, StudioHostContext, StudioQueryHandler, StudioCommandHandler } from "./registry.js";
export { buildBootstrap, commandManifestHash } from "./bootstrap.js";
export { StudioOpError, callGateway, gatewayJson, gatewayOk, invalid, unavailable } from "./gateway.js";
