import { NextRequest, NextResponse } from "next/server";
import { resolveGatewayUrl } from "@/lib/proxy-targets";

/**
 * Forward a request to the runtime Web Gateway.
 *
 * The gateway origin is resolved per request (`resolveGatewayUrl`) rather than
 * baked: `zeta serve` picks `--gateway-port` at startup and injects the origin
 * into this process, and the Next-side `beforeFiles` rewrites cannot carry that
 * runtime value because their destination is frozen at build time. Routes that
 * own a path the gateway implements proxy through here instead of relying on a
 * rewrite.
 */
export async function proxyToGateway(request: NextRequest, gatewayPath: string): Promise<Response> {
	const headers: Record<string, string> = {};
	const contentType = request.headers.get("content-type");
	if (contentType) headers["content-type"] = contentType;
	const cwd = request.headers.get("x-zeta-cwd");
	if (cwd) headers["x-zeta-cwd"] = cwd;

	// Route handler bodies are read as text: the gateway routes that proxy here
	// (tracking reads, branch checkout/create) take JSON or no body at all, and
	// a streamed body would need Node's `duplex: "half"`.
	const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();

	try {
		const upstream = await fetch(`${resolveGatewayUrl()}${gatewayPath}${request.nextUrl.search}`, {
			method: request.method,
			headers,
			body,
			cache: "no-store",
		});
		// Pass the body through unbuffered: gateway routes are JSON today, but a
		// streamed response (SSE) must not be accumulated here.
		return new NextResponse(upstream.body, {
			status: upstream.status,
			headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
		});
	} catch (error) {
		return NextResponse.json(
			{ error: `gateway unreachable: ${error instanceof Error ? error.message : String(error)}` },
			{ status: 502 },
		);
	}
}
