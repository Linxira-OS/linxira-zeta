import { NextRequest } from "next/server";
import { proxyToGateway } from "@/lib/gateway-proxy";

/**
 * Branch switch for the sidebar project switcher, answered by the Web Gateway
 * (refuses a dirty tree with 409). Proxied at request time so the target
 * follows the gateway port `zeta serve` actually runs on.
 */
export async function POST(request: NextRequest) {
	return proxyToGateway(request, "/api/git/checkout");
}
