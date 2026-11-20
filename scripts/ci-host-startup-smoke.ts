/**
 * Host startup smoke: one profile, two ensureHost calls, a stale/mismatched
 * instance, and an isolated temp home. This is the CLI/Desktop coexistence
 * contract at the shared `serve.json` registry.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ensureHost } from "../packages/coding-agent/src/backend/ensure-host";

type FakeHost = { port: number; stop: (closeActiveConnections?: boolean) => Promise<void> };

const repoRoot = path.resolve(import.meta.dir, "..");
const home = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-host-smoke-"));
const event = new AbortController();
let hostPid: number | undefined;
let fake: FakeHost | undefined;
try {
	const env = {
		...process.env,
		HOME: home,
		USERPROFILE: home,
		ZETA_CODING_AGENT_DIR: path.join(home, ".zeta", "agent"),
		ZETA_SERVE_REGISTRY: path.join(home, ".zeta", "serve.json"),
		ZETA_SERVE_INSTANCE_DIR: path.join(home, ".zeta", "serve"),
	};
	Object.assign(process.env, env);
	const options = {
		webPort: 43371,
		statsPort: 43372,
		gatewayPort: 43373,
		cwd: home,
		channels: false,
		cliInvocation: [process.execPath, path.join(repoRoot, "packages/coding-agent/src/cli.ts")],
	};
	const first = await ensureHost(options);
	hostPid = first.pid;
	let identity: { app?: string; version?: string; pid?: number } | undefined;
	for (let attempt = 0; attempt < 40 && identity === undefined; attempt++) {
		try {
			identity = await fetch(`${first.webUrl}/api/server/identity`, { signal: event.signal }).then(r => r.json());
		} catch {
			await Bun.sleep(250);
		}
	}
	if (identity?.app !== "zeta" || identity.version === undefined || identity.pid !== first.pid) {
		throw new Error(`Host identity did not settle: ${JSON.stringify(identity)}`);
	}
	const second = await ensureHost(options);
	if (second.action !== "reused" || second.pid !== first.pid) {
		throw new Error(`Second ensureHost did not reuse: ${JSON.stringify(second)}`);
	}
	console.log(`host smoke: started ${first.pid}, reused ${second.pid}, version ${identity.version}`);

	// A live same-version-independent host with another version must not be
	// killed or silently taken over.
	process.kill(first.pid, "SIGTERM");
	hostPid = undefined;
	await Bun.sleep(500);
	fake = Bun.serve({
		port: 0,
		fetch(request) {
			if (new URL(request.url).pathname === "/api/server/identity") {
				return Response.json({
					app: "zeta",
					version: "0.0.0-smoke",
					pid: process.pid,
					startedAt: new Date().toISOString(),
					webUrl: `http://127.0.0.1:${fake!.port}`,
					statsUrl: "",
					gatewayUrl: null,
				});
			}
			return new Response("not found", { status: 404 });
		},
	});
	const fakeUrl = `http://127.0.0.1:${fake.port}`;
	await Bun.write(
		env.ZETA_SERVE_REGISTRY,
		JSON.stringify({
			pid: process.pid,
			webUrl: fakeUrl,
			statsUrl: "",
			gatewayUrl: null,
			version: "0.0.0-smoke",
			startedAt: new Date().toISOString(),
			cwd: home,
		}),
	);
	let conflict = "";
	try {
		await ensureHost(options);
	} catch (error) {
		conflict = error instanceof Error ? error.message : String(error);
	}
	if (!conflict.includes("different Zeta host")) throw new Error(`Expected host conflict, got: ${conflict}`);
	const stillAlive = await fetch(`${fakeUrl}/api/server/identity`).then(r => r.ok);
	if (!stillAlive) throw new Error("Mismatched host was killed");
	console.log("host smoke: mismatched live host refused takeover");
} finally {
	event.abort();
	if (hostPid !== undefined) {
		try {
			process.kill(hostPid, "SIGTERM");
		} catch {}
	}
	await fake?.stop(true);
	await fs.rm(home, { recursive: true, force: true }).catch(() => {});
}
