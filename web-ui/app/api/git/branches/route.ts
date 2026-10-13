import { NextRequest } from "next/server";
import { proxyToGateway } from "@/lib/gateway-proxy";

/**
 * Local branches of the cwd, answered by the Web Gateway (pi-vcs, no git CLI).
 * Proxied at request time so the target follows the gateway port `zeta serve`
 * actually runs on.
 */
export async function GET(request: NextRequest) {
	return proxyToGateway(request, "/api/git/branches");
}
