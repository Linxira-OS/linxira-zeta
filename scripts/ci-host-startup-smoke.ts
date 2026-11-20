/**
 * Host startup smoke: isolated HOME, two separate CLI processes, one daemon,
 * and a live different-version instance that must not be taken over.
 *
 * The child mode (`ensure`) is the same `ensureHost` used by a normal CLI
 * launch; the parent only orchestrates and observes the shared registry.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ensureHost } from "../packages/coding-agent/src/backend/ensure-host";

type FakeHost = { port: number; stop: (closeActiveConnections?: boolean) => Promise<void> };

const repoRoot = path.resolve(import.meta.dir, "..");
const home = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-host-smoke-"));

if (process.argv[2] === "ensure") {
	const result = await ensureHost({
		webPort: 43371,
		statsPort: 43372,
		gatewayPort: 43373,
		cwd: process.env.ZETA_SMOKE_CWD ?? process.cwd(),
		channels: false,
		cliInvocation: [process.execPath, path.join(repoRoot, "packages/coding-agent/src/cli.ts")],
	});
	console.log(JSON.stringify(result));
	process.exit(0);
}

const event = new AbortController();
let hostPid: number | undefined;
let fake: FakeHost | undefined;
try {
	Object.assign(process.env, {
		HOME: home,
		USERPROFILE: home,
		ZETA_CODING_AGENT_DIR: path.join(home, ".zeta", "agent"),
		ZETA_SERVE_REGISTRY: path.join(home, ".zeta", "serve.json"),
		ZETA_SERVE_INSTANCE_DIR: path.join(home, ".zeta", "serve"),
		ZETA_SMOKE_CWD: home,
	});
	const runEnsure = (): { action: string; pid: number; webUrl: string } => {
		const proc = Bun.spawnSync([process.execPath, import.meta.path, "ensure"], {
			env: process.env,
			stdout: "pipe",
			stderr: "pipe",
		});
		if (proc.exitCode !== 0) {
			throw new Error(`ensure child failed (${proc.exitCode}): ${proc.stderr.toString()}`);
		}
		const line = proc.stdout
			.toString()
			.split(/\r?\n/)
			.findLast(candidate => candidate.trimStart().startsWith("{"));
		if (line === undefined) throw new Error(`ensure child printed no result: ${proc.stdout.toString()}`);
		return JSON.parse(line) as { action: string; pid: number; webUrl: string };
	};

	const first = runEnsure();
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
	const second = runEnsure();
	if (second.action !== "reused" || second.pid !== first.pid) {
		throw new Error(`Second CLI did not reuse: ${JSON.stringify(second)}`);
	}
	console.log(
		`host smoke: process 1 started ${first.pid}, process 2 reused ${second.pid}, version ${identity.version}`,
	);

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
		process.env.ZETA_SERVE_REGISTRY!,
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
		await ensureHost({
			webPort: 43371,
			statsPort: 43372,
			gatewayPort: 43373,
			cwd: home,
			channels: false,
		});
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
