/**
 * GET /api/desktop/info — capability probe for desktop-specific renderer UI.
 *
 * The gateway runs inside `zetacode serve`, which the desktop shell spawns with
 * `ZETA_DESKTOP=1`; a plain browser hitting the same gateway over a remote
 * URL sees no such env, so this endpoint distinguishes "embedded in the
 * Electron shell" from "browser/remote" without user-agent sniffing.
 */

import type { SessionClient } from "../../session/session-entries";

/**
 * The client a serve process represents, for the provenance stamp on the
 * sessions it creates: the Electron shell when it spawned us, otherwise an
 * unattended serve host (IM channels, relay work).
 */
export function serveSessionClient(env: NodeJS.ProcessEnv = process.env): SessionClient {
	return env.ZETA_DESKTOP === "1" ? "desktop" : "automation";
}

export function handleDesktopInfoGet(_req: Request): Response {
	return new Response(JSON.stringify({ desktop: process.env.ZETA_DESKTOP === "1" }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
