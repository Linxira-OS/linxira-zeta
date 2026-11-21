import { NextRequest } from "next/server";
import { proxyToGateway } from "@/lib/gateway-proxy";

/**
 * Local branch creation at HEAD, answered by the Web Gateway (pi-vcs). Proxied
 * at request time so the target follows the gateway port `zeta serve` actually
 * runs on.
 */
export async function POST(request: NextRequest) {
	return proxyToGateway(request, "/api/git/branch");
}
