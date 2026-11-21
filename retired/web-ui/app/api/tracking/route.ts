import { NextRequest } from "next/server";
import { proxyToGateway } from "@/lib/gateway-proxy";

/**
 * Thin proxy to the gateway's tracking read endpoint. All tracking logic
 * (file layout, watcher, SSE push) lives in the runtime gateway
 * (`packages/coding-agent/src/server/web-gateway/tracking.ts`); this route
 * only forwards so the browser can stay same-origin. When the gateway
 * listener is unreachable (standalone `next dev` without `zeta serve`) the
 * proxy surfaces a 502 with the gateway error.
 */
export async function GET(request: NextRequest) {
	return proxyToGateway(request, "/api/tracking");
}
