import { NextResponse } from "next/server";

/**
 * Runtime stats-dashboard URL for the Stats dock pane.
 *
 * `zeta serve` injects `NEXT_PUBLIC_STATS_URL` (the in-process stats
 * dashboard, default http://127.0.0.1:3847) into the web-ui child's
 * environment. Client bundles inline `NEXT_PUBLIC_*` at build time, so a
 * prebuilt production bundle cannot see the serve-injected value; this
 * route re-exposes it per request. `url` is null when no stats URL was
 * injected (standalone `next dev`/`next start` without `zeta serve`) and
 * the pane shows its not-running hint.
 */
export const dynamic = "force-dynamic";

export async function GET() {
	return NextResponse.json({ url: process.env.NEXT_PUBLIC_STATS_URL ?? null });
}
