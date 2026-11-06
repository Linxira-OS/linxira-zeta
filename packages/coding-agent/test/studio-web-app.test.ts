/**
 * `zeta serve` resolves the Studio renderer from three places, in order:
 * `ZETA_WEB_APP_DIR`, the packaged `<package-root>/dist/web-app`, then the
 * repository's `web-app/dist`. The packaged copy is what an npm install has.
 */
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from "node:zlib";
import { STUDIO_RENDERER_CSP, resolveStudioWebAppDirFrom, serveStudioWebApp } from "../src/server/studio-web-app";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-studio-web-app-"));
	roots.push(root);
	return root;
}

/** Create `<root>/<relative>` holding an `index.html`, the marker the probe needs. */
async function makeBuild(root: string, relative: string): Promise<string> {
	const dir = path.join(root, relative);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, "index.html"), "<!doctype html><title>studio</title>");
	return path.resolve(dir);
}

afterEach(async () => {
	while (roots.length > 0) await fs.rm(roots.pop()!, { recursive: true, force: true });
});

describe("Studio renderer resolution", () => {
	it("finds the packaged build beside a bundled dist/cli.js", async () => {
		const root = await tempRoot();
		const build = await makeBuild(root, "dist/web-app");
		expect(resolveStudioWebAppDirFrom(pathToFileURL(path.join(root, "dist", "cli.js")).href, undefined)).toBe(build);
	});

	it("finds the packaged build beside a source server module", async () => {
		const root = await tempRoot();
		const build = await makeBuild(root, "dist/web-app");
		const source = pathToFileURL(path.join(root, "src", "server", "studio-web-app.ts")).href;
		expect(resolveStudioWebAppDirFrom(source, undefined)).toBe(build);
	});

	it("falls back to the repository build in a checkout", async () => {
		const root = await tempRoot();
		const build = await makeBuild(root, "web-app/dist");
		const source = pathToFileURL(
			path.join(root, "packages", "coding-agent", "src", "server", "studio-web-app.ts"),
		).href;
		expect(resolveStudioWebAppDirFrom(source, undefined)).toBe(build);
	});

	it("prefers the packaged build over the repository build", async () => {
		const root = await tempRoot();
		const packaged = await makeBuild(root, "packages/coding-agent/dist/web-app");
		await makeBuild(root, "web-app/dist");
		const source = pathToFileURL(
			path.join(root, "packages", "coding-agent", "src", "server", "studio-web-app.ts"),
		).href;
		expect(resolveStudioWebAppDirFrom(source, undefined)).toBe(packaged);
	});

	it("treats ZETA_WEB_APP_DIR as authoritative", async () => {
		const root = await tempRoot();
		const custom = await makeBuild(root, "custom-build");
		await makeBuild(root, "dist/web-app");
		const bundled = pathToFileURL(path.join(root, "dist", "cli.js")).href;
		expect(resolveStudioWebAppDirFrom(bundled, custom)).toBe(custom);
		expect(resolveStudioWebAppDirFrom(bundled, path.join(root, "missing"))).toBeNull();
	});

	it("returns null when no build exists, keeping the placeholder path", async () => {
		const root = await tempRoot();
		const bundled = pathToFileURL(path.join(root, "dist", "cli.js")).href;
		expect(resolveStudioWebAppDirFrom(bundled, undefined)).toBeNull();
	});
});

describe("Studio renderer compression", () => {
	const assetDir = "assets";
	const assetName = "entry-abc123.js";
	const assetBody = "export const answer = 42;\n".repeat(200);

	/** A build dir with one hashed asset plus optional `.br`/`.gz` sidecars. */
	async function makeCompressedBuild(sidecars: { br?: boolean; gz?: boolean }): Promise<string> {
		const root = await tempRoot();
		const dir = await makeBuild(root, "build");
		const assetPath = path.join(dir, assetDir, assetName);
		await fs.mkdir(path.dirname(assetPath), { recursive: true });
		const raw = Buffer.from(assetBody);
		await fs.writeFile(assetPath, raw);
		if (sidecars.br) await fs.writeFile(`${assetPath}.br`, brotliCompressSync(raw));
		if (sidecars.gz) await fs.writeFile(`${assetPath}.gz`, gzipSync(raw, { level: 9 }));
		return dir;
	}

	function request(pathname: string, acceptEncoding?: string, method = "GET"): Request {
		const headers = new Headers();
		if (acceptEncoding !== undefined) headers.set("accept-encoding", acceptEncoding);
		return new Request(`http://studio.test${pathname}`, { method, headers });
	}

	/** Bun's `Response` hands back the encoded bytes, so decode them like a client would. */
	async function bodyText(response: Response): Promise<string> {
		const bytes = Buffer.from(await response.arrayBuffer());
		const coding = response.headers.get("content-encoding");
		if (coding === "br") return brotliDecompressSync(bytes).toString("utf8");
		if (coding === "gzip") return gunzipSync(bytes).toString("utf8");
		return bytes.toString("utf8");
	}

	it("prefers brotli when both sidecars exist", async () => {
		const dir = await makeCompressedBuild({ br: true, gz: true });
		const response = await serveStudioWebApp(request(`/${assetDir}/${assetName}`, "gzip, deflate, br"), dir);
		expect(response.headers.get("content-encoding")).toBe("br");
		expect(response.headers.get("vary")).toBe("accept-encoding");
		expect(response.headers.get("content-security-policy")).toBe(STUDIO_RENDERER_CSP);
		expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		const body = await bodyText(response);
		expect(body).toBe(assetBody);
		const sidecar = await fs.stat(path.join(dir, assetDir, `${assetName}.br`));
		expect(response.headers.get("content-length")).toBe(String(sidecar.size));
	});

	it("falls back to gzip for a gzip-only client", async () => {
		const dir = await makeCompressedBuild({ br: true, gz: true });
		const response = await serveStudioWebApp(request(`/${assetDir}/${assetName}`, "gzip"), dir);
		expect(response.headers.get("content-encoding")).toBe("gzip");
		const body = Buffer.from(await response.arrayBuffer());
		expect(gunzipSync(body).toString("utf8")).toBe(assetBody);
		const sidecar = await fs.stat(path.join(dir, assetDir, `${assetName}.gz`));
		expect(response.headers.get("content-length")).toBe(String(sidecar.size));
		expect(body.length).toBe(sidecar.size);
	});

	it("honours q-values over the default brotli preference", async () => {
		const dir = await makeCompressedBuild({ br: true, gz: true });
		const response = await serveStudioWebApp(request(`/${assetDir}/${assetName}`, "br;q=0.4, gzip;q=1"), dir);
		expect(response.headers.get("content-encoding")).toBe("gzip");
	});

	it("skips a coding whose sidecar is missing", async () => {
		const dir = await makeCompressedBuild({ gz: true });
		const response = await serveStudioWebApp(request(`/${assetDir}/${assetName}`, "br, gzip"), dir);
		expect(response.headers.get("content-encoding")).toBe("gzip");
	});

	it("serves identity for Accept-Encoding: identity", async () => {
		const dir = await makeCompressedBuild({ br: true, gz: true });
		const response = await serveStudioWebApp(request(`/${assetDir}/${assetName}`, "identity"), dir);
		expect(response.headers.get("content-encoding")).toBeNull();
		expect(response.headers.get("vary")).toBe("accept-encoding");
		expect(await bodyText(response)).toBe(assetBody);
		expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(assetBody)));
	});

	it("serves identity when no Accept-Encoding header is sent", async () => {
		const dir = await makeCompressedBuild({ br: true, gz: true });
		const response = await serveStudioWebApp(request(`/${assetDir}/${assetName}`), dir);
		expect(response.headers.get("content-encoding")).toBeNull();
		expect(await bodyText(response)).toBe(assetBody);
	});

	it("serves identity when the build has no sidecars", async () => {
		const dir = await makeCompressedBuild({});
		const response = await serveStudioWebApp(request(`/${assetDir}/${assetName}`, "br, gzip"), dir);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-encoding")).toBeNull();
		expect(response.headers.get("content-security-policy")).toBe(STUDIO_RENDERER_CSP);
		expect(await bodyText(response)).toBe(assetBody);
	});

	it("skips compression for ranged requests", async () => {
		const dir = await makeCompressedBuild({ br: true, gz: true });
		const headers = new Headers({ "accept-encoding": "br", range: "bytes=0-9" });
		const response = await serveStudioWebApp(
			new Request(`http://studio.test/${assetDir}/${assetName}`, { headers }),
			dir,
		);
		expect(response.headers.get("content-encoding")).toBeNull();
		expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(assetBody)));
	});

	it("compresses the SPA fallback entry while keeping it no-cache", async () => {
		const dir = await makeCompressedBuild({ br: true, gz: true });
		const indexPath = path.join(dir, "index.html");
		const html = "<!doctype html><title>studio</title>";
		await fs.writeFile(indexPath, html);
		await fs.writeFile(`${indexPath}.br`, brotliCompressSync(Buffer.from(html)));
		const response = await serveStudioWebApp(request("/settings/deep", "br"), dir);
		expect(response.headers.get("content-encoding")).toBe("br");
		expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(response.headers.get("cache-control")).toBe("no-cache");
		expect(response.headers.get("content-security-policy")).toBe(STUDIO_RENDERER_CSP);
		expect(await bodyText(response)).toBe(html);
	});

	it("HEAD reports the encoded length without a body", async () => {
		const dir = await makeCompressedBuild({ br: true, gz: true });
		const response = await serveStudioWebApp(request(`/${assetDir}/${assetName}`, "br", "HEAD"), dir);
		expect(response.headers.get("content-encoding")).toBe("br");
		expect(await response.text()).toBe("");
		const sidecar = await fs.stat(path.join(dir, assetDir, `${assetName}.br`));
		expect(response.headers.get("content-length")).toBe(String(sidecar.size));
	});
});
