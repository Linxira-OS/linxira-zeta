import { NextRequest, NextResponse } from "next/server";

/**
 * Thin proxy to the gateway's tracking read endpoint. All tracking logic
 * (file layout, watcher, SSE push) lives in the runtime gateway
 * (`packages/coding-agent/src/server/web-gateway/tracking.ts`); this route
 * only forwards so the browser can stay same-origin. When the gateway
 * listener is unreachable (standalone `next dev` without `zeta serve`) the
 * proxy surfaces a 502 with the gateway error.
 */
export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.search;
    const headers: Record<string, string> = {};
    const cwd = request.headers.get("x-zeta-cwd");
    if (cwd) headers["x-zeta-cwd"] = cwd;

    const res = await fetch(`http://127.0.0.1:${process.env.ZETA_WEB_GATEWAY_PORT ?? 30142}/api/tracking${search}`, {
      headers,
      cache: "no-store",
    });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: `gateway unreachable: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  }
}
