/**
 * Verify a packaged desktop app's embedded Zeta service without opening an
 * Electron window. This exercises the shipped binary, standalone Web UI,
 * Stats dashboard, and proxy-served Next chunks on the current platform.
 */
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { desktopPlatformInfo } from "./platform.mjs";

const platformInfo = desktopPlatformInfo(process.platform, process.arch);
const isWindows = process.platform === "win32";

function appPathFromArgs() {
	const index = process.argv.indexOf("--app");
	const value = index === -1 ? undefined : process.argv[index + 1];
	if (!value) throw new Error("Usage: node scripts/smoke.mjs --app <desktop-app-directory>");
	// Resolve against the desktop package dir, not the process cwd: npm --prefix
	// runs scripts from the package directory, so cwd-relative paths would
	// double up (desktop/temp/desktop/...).
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", value);
}

async function sleep(ms) {
	const deferred = Promise.withResolvers();
	setTimeout(deferred.resolve, ms);
	await deferred.promise;
}

async function freePort() {
	const deferred = Promise.withResolvers();
	const server = net.createServer();
	server.once("error", deferred.reject);
	server.listen(0, "127.0.0.1", () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			deferred.reject(new Error("Could not reserve a loopback port"));
			return;
		}
		server.close((error) => {
			if (error) deferred.reject(error);
			else deferred.resolve(address.port);
		});
	});
	return deferred.promise;
}

async function waitForReady(webUrl, statsUrl, getSpawnError) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const spawnError = getSpawnError();
		if (spawnError) throw spawnError;
		try {
			const [sessions, stats] = await Promise.all([fetch(`${webUrl}/api/sessions`), fetch(statsUrl)]);
			if (sessions.ok && stats.ok) return;
		} catch {
			// Service is still starting.
		}
		await sleep(250);
	}
	throw new Error("Timed out waiting for packaged Zeta service");
}

async function assertSseStaysOpen(webUrl) {
	const controller = new AbortController();
	const response = await fetch(`${webUrl}/api/agent/running/events`, { signal: controller.signal });
	if (!response.ok || !response.body) throw new Error("Packaged Web UI did not expose the running-session SSE stream");
	const reader = response.body.getReader();
	const initial = await reader.read();
	if (initial.done) throw new Error("Packaged running-session SSE stream closed before its initial frame");

	let closed = false;
	const pendingRead = reader.read().then(
		({ done }) => {
			closed = done;
		},
		() => {
			closed = !controller.signal.aborted;
		},
	);
	await sleep(11_000);
	if (closed) throw new Error("Packaged running-session SSE stream closed during the default Bun idle timeout window");
	controller.abort();
	await pendingRead;
}

async function stopService(child) {
	if (child.pid === undefined) return;
	if (isWindows) {
		spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
		return;
	}
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	// A graceful stop can hang: a lingering zeta child keeps its stdio pipes
	// open, which keeps this Node process's event loop alive and the CI step
	// spinning long after "smoke passed" printed. Wait for the child to exit,
	// then force-kill after a short timeout so the pipes close and the smoke
	// process can actually terminate.
	const exited = Promise.withResolvers();
	child.once("exit", () => exited.resolve(true));
	const ok = await Promise.race([exited.promise, sleep(5000).then(() => false)]);
	if (!ok) {
		child.kill("SIGKILL");
		const killed = Promise.withResolvers();
		child.once("exit", killed.resolve);
		await killed.promise;
	}
}

async function main() {
	const appDir = appPathFromArgs();
	// macOS bundles the shell in Zeta.app; extraResources land under
	// Contents/Resources. Other platforms keep resources/ at the app root.
	const serviceDir = process.platform === "darwin"
		? path.join(appDir, "Zeta.app", "Contents", "Resources", "zeta")
		: path.join(appDir, "resources", "zeta");
	const zeta = path.join(serviceDir, platformInfo.zetaBinaryName);
	const runtime = path.join(serviceDir, platformInfo.nodeBinaryName);
	const standaloneServer = path.join(serviceDir, "web-ui", ".next", "standalone", "server.js");
	for (const required of [zeta, runtime, standaloneServer]) {
		if (!fs.existsSync(required)) throw new Error(`Missing packaged resource: ${required}`);
	}

	const webPort = await freePort();
	let statsPort = await freePort();
	while (statsPort === webPort) statsPort = await freePort();
	const webUrl = `http://127.0.0.1:${webPort}`;
	const statsUrl = `http://127.0.0.1:${statsPort}`;
	let spawnError = null;
	let stopping = false;
	const serviceOutput = [];
	const collectOutput = (chunk) => {
		serviceOutput.push(chunk.toString());
		while (serviceOutput.join("").length > 8_000) serviceOutput.shift();
	};
	console.log(`Desktop smoke ports: web=${webPort} stats=${statsPort}`);
	const child = spawn(zeta, ["serve", "--web-port", String(webPort), "--stats-port", String(statsPort)], {
		cwd: serviceDir,
		env: { ...process.env, ZETA_DESKTOP: "1", ZETA_WEB_RUNTIME: runtime },
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: isWindows,
	});
	child.stdout.on("data", collectOutput);
	child.stderr.on("data", collectOutput);
	child.once("error", (error) => {
		spawnError = error;
	});
	child.once("exit", (code, signal) => {
		if (!stopping && spawnError === null) {
			spawnError = new Error(`Packaged Zeta service exited (${code ?? signal ?? "unknown"}): ${serviceOutput.join("")}`);
		}
	});

	try {
		await waitForReady(webUrl, statsUrl, () => spawnError);
		await assertSseStaysOpen(webUrl);
		const defaultWorkspace = await fetch(`${webUrl}/api/default-cwd`, { method: "POST" });
		const defaultWorkspaceData = await defaultWorkspace.json();
		if (!defaultWorkspace.ok || typeof defaultWorkspaceData.cwd !== "string") {
			throw new Error("Packaged Web UI could not create its default workspace");
		}
		const page = await fetch(webUrl);
		const html = await page.text();
		const assets = [...html.matchAll(/(?:src|href)="([^"]*\/_next\/[^"]*)"/g)]
			.map((match) => match[1])
			.filter((asset, index, values) => values.indexOf(asset) === index);
		if (assets.length === 0) throw new Error("Packaged Web UI did not reference any Next assets");
		for (const asset of assets) {
			const response = await fetch(`${webUrl}${asset}`);
			if (!response.ok) throw new Error(`Packaged Next asset failed: ${response.status} ${asset}`);
		}
		console.log(`Desktop smoke passed: default workspace, SSE, ${assets.length} Next assets, Web UI, API, and Stats dashboard.`);
	} finally {
		stopping = true;
		await stopService(child);
	}
}

// Exit explicitly: even after the zeta child is reaped, lingering resources
// (e.g. undici keep-alive connections from the SSE/fetch probes) keep the Node
// event loop alive on Linux/macOS, so the CI step spins forever after "smoke
// passed". We are done — the child is stopped, the verdict is printed — so
// force the process out instead of waiting for the loop to drain.
main().then(
	() => process.exit(0),
	(error) => {
		console.error(error instanceof Error ? error.stack ?? error.message : String(error));
		process.exit(1);
	},
);
