import { NextRequest } from "next/server";
import { proxyToGateway } from "@/lib/gateway-proxy";

/**
 * Recent commits (`?cwd=&limit=&skip=`). Gateway-owned, pi-vcs addon.
 *
 * Proxied at request time because `/api/git/*` is Next-owned — see
 * `document/web-gateway.md`.
 */
export async function GET(request: NextRequest) {
	return proxyToGateway(request, "/api/git/log");
}
