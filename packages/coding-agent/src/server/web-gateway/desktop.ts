/**
 * GET /api/desktop/info — capability probe for desktop-specific renderer UI.
 *
 * The gateway runs inside `zeta serve`, which the desktop shell spawns with
 * `ZETA_DESKTOP=1`; a plain browser hitting the same gateway over a remote
 * URL sees no such env, so this endpoint distinguishes "embedded in the
 * Electron shell" from "browser/remote" without user-agent sniffing.
 */

export function handleDesktopInfoGet(_req: Request): Response {
	return new Response(JSON.stringify({ desktop: process.env.ZETA_DESKTOP === "1" }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
