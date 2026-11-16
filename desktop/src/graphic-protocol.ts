const MIME: Record<string, string> = {
	"html": "text/html; charset=utf-8", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css",
	"wasm": "application/wasm", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "svg": "image/svg+xml",
	"woff": "font/woff", "woff2": "font/woff2", "ttf": "font/ttf", "bin": "application/octet-stream",
};

/** Serve the Host's bundled graphic viewer at an isolated, path-limited origin. */
export async function graphicAssetResponse(request: Request, options: { base: string; fetch: typeof fetch }): Promise<Response> {
	const url = new URL(request.url);
	if (url.protocol !== "zeta-graphics:" || url.hostname !== "viewer" || url.port || url.username || url.password || url.search || url.hash || !["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 400 });
	try {
		const name = decodeURIComponent(url.pathname.slice(1));
		const extension = name.split(".").pop() ?? "", mime = MIME[extension.toLowerCase()];
		if (!mime || name.split("/").some(part => part === "." || part === "..") || !(name === "graphic-preview.html" || /^assets\/[\w.-]+\.(?:js|css)$/.test(name) || /^graphics-xite\/(?:[\w.-]+\/)*[\w.-]+$/.test(name))) return new Response(null, { status: 404 });
		const target = new URL(`/${name}`, options.base);
		const upstream = await options.fetch(target.href, { method: request.method, credentials: "include", redirect: "error", signal: request.signal });
		if (!upstream.ok) { await upstream.body?.cancel(); return new Response(null, { status: upstream.status === 404 ? 404 : 502 }); }
		return new Response(request.method === "HEAD" ? null : upstream.body, { headers: {
			"Content-Type": mime, "Access-Control-Allow-Origin": "null", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff",
			...(name === "graphic-preview.html" ? { "Content-Security-Policy": "default-src 'none'; sandbox allow-scripts; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" } : {}),
		} });
	} catch { return new Response(null, { status: 404 }); }
}
