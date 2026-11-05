import { NextRequest } from "next/server";
import { proxyToGateway } from "@/lib/gateway-proxy";

/**
 * Stage the named repository-relative paths (or the whole tree with `all`). Answered by the Web Gateway through the pi-vcs addon, so no `git` process is spawned from the web layer.
 *
 * Proxied at request time (not rewritten) because `/api/git/*` is Next-owned —
 * see `document/web-gateway.md` — and the gateway origin follows the port
 * `zeta serve` actually runs on.
 */
export async function POST(request: NextRequest) {
	return proxyToGateway(request, "/api/git/stage");
}
