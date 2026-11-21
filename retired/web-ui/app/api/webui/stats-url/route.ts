import { NextResponse } from "next/server";
import { resolveStatsUrl } from "@/lib/proxy-targets";

/**
 * Runtime stats-dashboard URL for the shell's "open the dashboard" action.
 *
 * `zeta serve` injects `NEXT_PUBLIC_STATS_URL` (the in-process stats
 * dashboard, default http://127.0.0.1:3847) into the web-ui child's
 * environment. Client bundles inline `NEXT_PUBLIC_*` at build time, so a
 * prebuilt production bundle cannot see the serve-injected value; this route
 * resolves it per request instead, through the same helper the `/api/stats/*`
 * proxy rewrites use — one source of truth for the origin. `url` is never null:
 * outside `zeta serve` the documented default answers, and whether anything
 * listens there is the client's reachability probe to decide.
 */
export const dynamic = "force-dynamic";

export async function GET() {
	return NextResponse.json({ url: resolveStatsUrl() });
}
