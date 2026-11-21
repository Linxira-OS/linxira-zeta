import { NextResponse, type NextRequest } from "next/server";
import { isApiRequestOriginAllowed, shouldCheckApiRequestOrigin } from "@/lib/request-security";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // Bypass SSE streams and long-polling event connections to prevent Next.js proxy/middleware from buffering or timing out
  if (pathname.endsWith("/events")) {
    return NextResponse.next();
  }
  if (shouldCheckApiRequestOrigin(request) && !isApiRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Cross-origin API requests are not allowed" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
