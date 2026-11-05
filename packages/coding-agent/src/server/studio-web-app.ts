/**
 * Static serving for the Studio renderer build.
 *
 * `zeta serve` is the whole product surface: the same origin answers `/api/*`
 * and serves the renderer, so the browser needs no proxy and the Studio host's
 * pairing cookie stays first-party. Anything that is not `/api/*` falls back to
 * `index.html` (client-side routing), while hashed assets are cached
 * immutably and `index.html` never is.
 *
 * The npm package ships the build at `dist/web-app`; a checkout serves
 * `web-app/dist`. An install without either (a checkout before the first
 * build, or a truncated tarball) keeps the `NO_WEB_UI_PAGE` placeholder, and a
 * probe of `/` still proves the backend is alive.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Content-Security-Policy for the served renderer. Must stay in lockstep with
 * `web-app/vite.config.ts` (`PACKAGED_RENDERER_CSP`): the packaged `index.html`
 * carries the same policy as a meta tag, because `file://` loads do not
 * reliably get response headers. `frame-ancestors` is header-only (browsers
 * ignore it in meta CSP), which is why the server is the authority here.
 */
export const STUDIO_RENDERER_CSP =
	"default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; " +
	"connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
	"frame-ancestors 'none'";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
	".wav": "audio/wav",
	".mp3": "audio/mpeg",
	".webm": "video/webm",
	".mp4": "video/mp4",
};

/**
 * Where the renderer build lives, or `null` when this install has none.
 *
 * Resolution order:
 * 1. `ZETA_WEB_APP_DIR` — an explicit override. When set it is authoritative:
 *    a bad path is reported as "no build", never silently replaced by another.
 * 2. the build shipped inside the package (`<package-root>/dist/web-app`).
 *    Both layouts this module can run from are probed, because the relative
 *    path differs between the published bundle (`dist/cli.js`) and TypeScript
 *    source (`src/server/studio-web-app.ts`, a checkout or source install).
 * 3. the repository layout (`<repo>/web-app/dist`), for `bun install` in a
 *    checkout where nobody ran the packaging step.
 *
 * A miss is not an error: the caller serves the placeholder page, which names
 * these same ways to get a build.
 */
export function resolveStudioWebAppDir(): string | null {
	return resolveStudioWebAppDirFrom(import.meta.url, process.env.ZETA_WEB_APP_DIR);
}

/**
 * Testable form of {@link resolveStudioWebAppDir}: resolve relative to an
 * explicit module URL and explicit override instead of this file and the
 * ambient environment.
 */
export function resolveStudioWebAppDirFrom(moduleUrl: string | URL, explicitDir: string | undefined): string | null {
	const candidates = explicitDir
		? [explicitDir]
		: [
				// Published bundle: <package-root>/dist/cli.js.
				fileURLToPath(new URL("../dist/web-app", moduleUrl)),
				// TypeScript source: <package-root>/src/server/studio-web-app.ts.
				fileURLToPath(new URL("../../dist/web-app", moduleUrl)),
				// Repository checkout: <repo>/web-app/dist.
				fileURLToPath(new URL("../../../../web-app/dist", moduleUrl)),
			];
	for (const candidate of candidates) {
		try {
			if (fs.statSync(path.join(candidate, "index.html")).isFile()) return path.resolve(candidate);
		} catch {
			// absent candidate: try the next one
		}
	}
	return null;
}

/** Whether `requestPath` stays inside `root` (no traversal, no absolute escape). */
function resolveFile(root: string, requestPath: string): string | null {
	const decoded = decodeURIComponent(requestPath);
	if (decoded.includes("\0")) return null;
	const relative = path.posix.normalize(decoded).replace(/^\/+/, "");
	if (relative === "" || relative.startsWith("../") || relative.includes("/../")) return null;
	const target = path.resolve(root, relative);
	return target === root || target.startsWith(root + path.sep) ? target : null;
}

function headersFor(extension: string, immutable: boolean): Record<string, string> {
	return {
		"content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
		"content-security-policy": STUDIO_RENDERER_CSP,
		"x-content-type-options": "nosniff",
		"referrer-policy": "no-referrer",
		"cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
	};
}

/**
 * Answer one renderer request from `dir`.
 *
 * Only `GET`/`HEAD` are served. A path that resolves to a real file is served
 * as that file; anything else is the single-page entry (`index.html`) so a
 * deep link such as `/settings` boots the app instead of 404ing. A request
 * that *looks* like an asset (`/assets/…`, or any path with an extension) and
 * is missing is a 404 — a broken bundle reference must not silently become
 * HTML.
 */
export async function serveStudioWebApp(req: Request, dir: string): Promise<Response> {
	if (req.method !== "GET" && req.method !== "HEAD") {
		return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
	}
	const pathname = new URL(req.url).pathname;
	const target = resolveFile(dir, pathname);
	if (target) {
		const extension = path.extname(target).toLowerCase();
		try {
			const stat = fs.statSync(target);
			if (stat.isFile()) {
				const body = req.method === "HEAD" ? null : await Bun.file(target).arrayBuffer();
				return new Response(body, {
					headers: {
						...headersFor(extension, pathname.startsWith("/assets/")),
						"content-length": String(stat.size),
					},
				});
			}
		} catch {
			// missing: fall through to the entry or the 404 below
		}
	}
	const looksLikeAsset = pathname.startsWith("/assets/") || path.extname(pathname) !== "";
	if (looksLikeAsset) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
	const entry = path.join(dir, "index.html");
	const html = req.method === "HEAD" ? null : await Bun.file(entry).arrayBuffer();
	return new Response(html, { headers: headersFor(".html", false) });
}
