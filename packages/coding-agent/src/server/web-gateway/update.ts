/**
 * Update endpoints for the web-ui "Update" button.
 *
 * - GET  /api/update/check    → { current, latest, available }
 * - POST /api/update/download → download the npm tarball to a temp dir
 * - POST /api/update/install  → `npm install -g` the latest release
 *
 * Install is server-initiated but never self-restarts: the desktop/CLI shell
 * is told `requiresRestart` and prompts the user (replacing a running binary
 * from inside the server is unsafe).
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { compareVersions, logger, VERSION } from "@linxiraos/pi-utils";
import { buildNpmInstallArgs, getLatestRelease } from "../../cli/update-cli";

const NPM_REGISTRY = "https://registry.npmjs.org/";

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function resolveTarballUrl(pkg: string, version: string): Promise<string> {
	const response = await fetch(`${NPM_REGISTRY}${pkg}/${version}`);
	if (!response.ok) throw new Error(`Registry lookup failed: HTTP ${response.status}`);
	const manifest = (await response.json()) as { dist?: { tarball?: unknown } };
	if (typeof manifest.dist?.tarball !== "string") throw new Error("Package manifest has no dist.tarball");
	return manifest.dist.tarball;
}

function runNpm(args: string[]): Promise<number> {
	const { promise, resolve, reject } = Promise.withResolvers<number>();
	const child = Bun.spawn(["npm", ...args], {
		stdout: "inherit",
		stderr: "inherit",
		windowsHide: true,
	});
	child.exited.then(code => resolve(code ?? 1)).catch(reject);
	return promise;
}

export async function handleUpdateCheck(req: Request): Promise<Response> {
	if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
	try {
		const release = await getLatestRelease();
		return json({
			current: VERSION,
			latest: release.version,
			available: compareVersions(release.version, VERSION) > 0,
			packages: release.packages,
		});
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}

export async function handleUpdateDownload(req: Request): Promise<Response> {
	if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
	try {
		const release = await getLatestRelease();
		const tarballUrl = await resolveTarballUrl(release.packages.pkg, release.version);
		const response = await fetch(tarballUrl);
		if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
		const buffer = Buffer.from(await response.arrayBuffer());

		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "zeta-update-"));
		const fileName = `${release.packages.pkg.replace("@", "").replace("/", "-")}-${release.version}.tgz`;
		const filePath = path.join(tmpDir, fileName);
		await fs.promises.writeFile(filePath, buffer);

		// ReleaseInfo carries no per-asset digests, so a checksum comparison is
		// not possible here; record the computed SHA-256 for the caller and
		// document that verification was skipped.
		const sha256 = createHash("sha256").update(buffer).digest("hex");
		logger.warn(
			"Update tarball downloaded without checksum verification (release metadata has no SHA256SUMS asset)",
			{ version: release.version, size: buffer.byteLength },
		);
		return json({ downloaded: true, path: filePath, size: buffer.byteLength, sha256 });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}

export async function handleUpdateInstall(req: Request): Promise<Response> {
	if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
	try {
		const release = await getLatestRelease();
		const args = buildNpmInstallArgs(release.version);
		const exitCode = await runNpm(args);
		if (exitCode !== 0) return json({ error: `npm install failed with exit code ${exitCode}` }, 500);
		return json({ installed: true, version: release.version, requiresRestart: true });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}
