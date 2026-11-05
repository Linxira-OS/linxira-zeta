import { NextRequest } from "next/server";
import { proxyToGateway } from "@/lib/gateway-proxy";

/**
 * Push the current branch. Gateway-owned, pi-vcs addon.
 *
 * Proxied at request time (not rewritten) because `/api/git/*` is Next-owned —
 * see `document/web-gateway.md` — and the gateway origin follows the port
 * `zeta serve` actually runs on.
 */
export async function POST(request: NextRequest) {
	return proxyToGateway(request, "/api/git/push");
}
