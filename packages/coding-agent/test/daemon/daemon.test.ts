/**
 * `zetacode daemon` lifecycle contracts: idempotent start, the status JSON
 * shape, stale-record cleanup on stop, and the autostart installer text for
 * every platform (asserted, never executed in CI).
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { acquireChannelLock } from "../../src/channels/instance-lock";
import {
	DAEMON_DEFAULT_GATEWAY_PORT,
	DAEMON_DEFAULT_STATS_PORT,
	DAEMON_DEFAULT_WEB_PORT,
	DAEMON_STATE_FILENAME,
	type DaemonRuntime,
	type DaemonState,
	type DaemonStatus,
	type SpawnBackendInput,
	daemonStatus,
	installAutostart,
	planAutostart,
	readDaemonLogTail,
	readDaemonState,
	restartDaemon,
	resolveCliInvocation,
	resolveDaemonPaths,
	startDaemon,
	stopDaemon,
	uninstallAutostart,
	writeDaemonState,
} from "../../src/commands/daemon";
import type { ServeRegistration } from "../../src/server/serve-registry";

const tempDirs: string[] = [];

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

async function tempRoot(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-daemon-"));
	tempDirs.push(dir);
	return dir;
}

const access = {
	host: "127.0.0.1",
	scheme: "http" as const,
	tls: null,
	loopback: true,
	allowPlainHttp: false,
};

function makeRuntime(
	overrides: Partial<DaemonRuntime> & { alive?: Set<number>; killed?: Array<[number, string]> } = {},
): DaemonRuntime {
	const alive = overrides.alive ?? new Set<number>();
	const killed = overrides.killed ?? [];
	return {
		isAlive: pid => alive.has(pid),
		sleep: async () => {},
		now: () => Date.now(),
		kill: (pid, signal) => {
			killed.push([pid, signal]);
			alive.delete(pid);
		},
		spawn: () => ({ pid: 4242, unref: () => {} }),
		readRegistry: () => null,
		platform: "linux",
		...overrides,
	};
}

function stateFor(pid: number, overrides: Partial<DaemonState> = {}): DaemonState {
	return {
		version: 1,
		instanceId: `instance-${pid}`,
		pid,
		startedAt: "2026-10-21T10:00:00.000Z",
		cwd: "C:/work",
		webPort: DAEMON_DEFAULT_WEB_PORT,
		statsPort: DAEMON_DEFAULT_STATS_PORT,
		gatewayPort: DAEMON_DEFAULT_GATEWAY_PORT,
		webUrl: `http://127.0.0.1:${DAEMON_DEFAULT_WEB_PORT}`,
		statsUrl: `http://127.0.0.1:${DAEMON_DEFAULT_STATS_PORT}`,
		gatewayUrl: `http://127.0.0.1:${DAEMON_DEFAULT_GATEWAY_PORT}`,
		logPath: "C:/logs/daemon.log",
		cliVersion: "1.4.0",
		...overrides,
	};
}

describe("daemon start", () => {
	test("starting twice is a no-op that reports the running pid and port", async () => {
		const root = await tempRoot();
		const paths = resolveDaemonPaths({ root });
		const alive = new Set<number>();
		const killed: Array<[number, string]> = [];
		const spawns: SpawnBackendInput[] = [];
		const runtime = makeRuntime({
			alive,
			killed,
			spawn: input => {
				spawns.push(input);
				alive.add(4242);
				return { pid: 4242, unref: () => {} };
			},
		});
		const options = {
			paths,
			runtime,
			access,
			webPort: DAEMON_DEFAULT_WEB_PORT,
			statsPort: DAEMON_DEFAULT_STATS_PORT,
			gatewayPort: DAEMON_DEFAULT_GATEWAY_PORT,
			cliInvocation: ["zetacode"],
			waitReady: async () => "ready" as const,
		};

		const first = await startDaemon(options);
		expect(first.action).toBe("started");
		expect(first.status.running).toBe(true);
		expect(first.status.pid).toBe(4242);
		expect(first.status.port).toBe(DAEMON_DEFAULT_WEB_PORT);
		expect(spawns).toHaveLength(1);
		expect(spawns[0]?.command).toEqual([
			"zetacode",
			"serve",
			"--no-browser",
			"--stats-port",
			String(DAEMON_DEFAULT_STATS_PORT),
			"--web-port",
			String(DAEMON_DEFAULT_WEB_PORT),
			"--gateway-port",
			String(DAEMON_DEFAULT_GATEWAY_PORT),
		]);
		expect((await readDaemonState(paths.state))?.pid).toBe(4242);

		const second = await startDaemon(options);
		expect(second.action).toBe("already-running");
		expect(second.status.pid).toBe(4242);
		expect(second.status.port).toBe(DAEMON_DEFAULT_WEB_PORT);
		expect(second.spawned).toBe(false);
		expect(spawns).toHaveLength(1);
		expect(killed).toEqual([]);
	});

	test("a stale record is replaced instead of blocking the start", async () => {
		const root = await tempRoot();
		const paths = resolveDaemonPaths({ root });
		await fs.mkdir(root, { recursive: true });
		await writeDaemonState(paths.state, stateFor(1111));
		await acquireChannelLock({
			lockPath: paths.lock,
			metadata: { pid: 1111, host: "serve", cwd: "C:/work", channels: [] },
		});

		const alive = new Set<number>();
		const runtime = makeRuntime({
			alive,
			spawn: () => {
				alive.add(2222);
				return { pid: 2222, unref: () => {} };
			},
		});
		const result = await startDaemon({
			paths,
			runtime,
			access,
			webPort: DAEMON_DEFAULT_WEB_PORT,
			statsPort: DAEMON_DEFAULT_STATS_PORT,
			gatewayPort: DAEMON_DEFAULT_GATEWAY_PORT,
			cliInvocation: ["zetacode"],
			waitReady: async () => "ready" as const,
		});
		expect(result.action).toBe("started");
		expect(result.cleanedStale).toBe(true);
		expect(result.status.pid).toBe(2222);
	});

	test("a backend that exits during startup fails with the log tail", async () => {
		const root = await tempRoot();
		const paths = resolveDaemonPaths({ root });
		const runtime = makeRuntime({
			spawn: input => {
				void fs.writeFile(input.logPath, "panic: no display\n");
				return { pid: 3333, unref: () => {} };
			},
		});
		const result = await startDaemon({
			paths,
			runtime,
			access,
			webPort: DAEMON_DEFAULT_WEB_PORT,
			statsPort: DAEMON_DEFAULT_STATS_PORT,
			gatewayPort: DAEMON_DEFAULT_GATEWAY_PORT,
			cliInvocation: ["zetacode"],
			waitReady: async () => "exited" as const,
		});
		expect(result.action).toBe("failed");
		expect(result.exitCode).toBe(1);
		expect(result.message).toContain("exited during startup");
		expect(await readDaemonState(paths.state)).toBeNull();
	});
});

describe("daemon status", () => {
	test("reports the documented JSON shape for a running daemon", async () => {
		const root = await tempRoot();
		const paths = resolveDaemonPaths({ root });
		await writeDaemonState(paths.state, stateFor(4242));
		const autostart = { platform: "linux" as NodeJS.Platform, supported: true, installed: false, path: "/unit" };
		const status = await daemonStatus({
			paths,
			runtime: makeRuntime({ alive: new Set([4242]) }),
			autostart,
		});
		expect(status).toEqual<DaemonStatus>({
			running: true,
			stale: false,
			pid: 4242,
			port: DAEMON_DEFAULT_WEB_PORT,
			webPort: DAEMON_DEFAULT_WEB_PORT,
			statsPort: DAEMON_DEFAULT_STATS_PORT,
			gatewayPort: DAEMON_DEFAULT_GATEWAY_PORT,
			webUrl: `http://127.0.0.1:${DAEMON_DEFAULT_WEB_PORT}`,
			statsUrl: `http://127.0.0.1:${DAEMON_DEFAULT_STATS_PORT}`,
			gatewayUrl: `http://127.0.0.1:${DAEMON_DEFAULT_GATEWAY_PORT}`,
			startedAt: "2026-10-21T10:00:00.000Z",
			cliVersion: "1.4.0",
			source: "daemon",
			statePath: paths.state,
			lockPath: paths.lock,
			logPath: "C:/logs/daemon.log",
			autostart,
		});
	});

	test("reports a dead pid as stale without claiming it runs", async () => {
		const root = await tempRoot();
		const paths = resolveDaemonPaths({ root });
		await writeDaemonState(paths.state, stateFor(1111));
		const status = await daemonStatus({ paths, runtime: makeRuntime() });
		expect(status.running).toBe(false);
		expect(status.stale).toBe(true);
		expect(status.pid).toBe(1111);
		expect(status.source).toBeNull();
	});

	test("recognises a backend registered by a foreground serve", async () => {
		const root = await tempRoot();
		const paths = resolveDaemonPaths({ root });
		const registration: ServeRegistration = {
			pid: 7777,
			webUrl: "http://127.0.0.1:40141",
			statsUrl: "http://127.0.0.1:43847",
			gatewayUrl: "http://127.0.0.1:40142",
			version: "1.4.0",
			startedAt: "2026-10-21T10:00:00.000Z",
			cwd: "C:/work",
		};
		const status = await daemonStatus({
			paths,
			runtime: makeRuntime({ alive: new Set([7777]), readRegistry: () => registration }),
		});
		expect(status.running).toBe(true);
		expect(status.source).toBe("serve-registry");
		expect(status.pid).toBe(7777);
		expect(status.port).toBe(40141);
	});
});

describe("daemon stop", () => {
	test("cleans a stale state and lock instead of waiting", async () => {
		const root = await tempRoot();
		const paths = resolveDaemonPaths({ root });
		await writeDaemonState(paths.state, stateFor(1111));
		await acquireChannelLock({
			lockPath: paths.lock,
			metadata: { pid: 1111, host: "serve", cwd: "C:/work", channels: [] },
		});
		const killed: Array<[number, string]> = [];
		const result = await stopDaemon({ paths, runtime: makeRuntime({ killed }) });

		expect(result.action).toBe("cleaned-stale");
		expect(result.exitCode).toBe(0);
		expect(killed).toEqual([]);
		expect(await readDaemonState(paths.state)).toBeNull();
		expect(await fs.stat(paths.lock).catch(() => null)).toBeNull();
	});

	test("cleans a corrupt state file", async () => {
		const root = await tempRoot();
		const paths = resolveDaemonPaths({ root });
		await fs.mkdir(root, { recursive: true });
		await fs.writeFile(paths.state, "{not json");
		const result = await stopDaemon({ paths, runtime: makeRuntime() });
		expect(result.action).toBe("cleaned-stale");
		expect(await fs.stat(paths.state).catch(() => null)).toBeNull();
	});

	test("terminates a live backend and removes its records", async () => {
		const root = await tempRoot();
		const paths = resolveDaemonPaths({ root });
		await writeDaemonState(paths.state, stateFor(4242));
		await acquireChannelLock({
			lockPath: paths.lock,
			metadata: { pid: 4242, host: "serve", cwd: "C:/work", channels: [] },
		});
		const alive = new Set([4242]);
		const killed: Array<[number, string]> = [];
		const result = await stopDaemon({
			paths,
			runtime: makeRuntime({ alive, killed }),
			timeoutSeconds: 0,
		});
		expect(result.action).toBe("stopped");
		expect(result.pid).toBe(4242);
		expect(killed[0]?.[0]).toBe(4242);
		expect(await readDaemonState(paths.state)).toBeNull();
	});

	test("restart stops the old backend and starts a new one", async () => {
		const root = await tempRoot();
		const paths = resolveDaemonPaths({ root });
		await writeDaemonState(paths.state, stateFor(4242));
		await acquireChannelLock({
			lockPath: paths.lock,
			metadata: { pid: 4242, host: "serve", cwd: "C:/work", channels: [] },
		});
		const alive = new Set([4242]);
		const killed: Array<[number, string]> = [];
		const runtime = makeRuntime({
			alive,
			killed,
			spawn: () => {
				alive.add(5555);
				return { pid: 5555, unref: () => {} };
			},
		});
		const result = await restartDaemon({
			paths,
			runtime,
			access,
			webPort: DAEMON_DEFAULT_WEB_PORT,
			statsPort: DAEMON_DEFAULT_STATS_PORT,
			gatewayPort: DAEMON_DEFAULT_GATEWAY_PORT,
			cliInvocation: ["zetacode"],
			timeoutSeconds: 0,
			waitReady: async () => "ready" as const,
		});
		expect(result.stop.action).toBe("stopped");
		expect(result.start.action).toBe("started");
		expect(result.start.status.pid).toBe(5555);
		expect(killed.map(([pid]) => pid)).toEqual([4242]);
	});
});

describe("daemon logs", () => {
	test("returns the requested tail of the log", async () => {
		const root = await tempRoot();
		const logPath = path.join(root, "daemon.log");
		await fs.writeFile(logPath, "one\ntwo\nthree\n");
		expect(await readDaemonLogTail(logPath, 2)).toEqual(["two", "three"]);
		expect(await readDaemonLogTail(path.join(root, "missing.log"), 2)).toEqual([]);
	});
});

describe("autostart installers", () => {
	const ports = {
		webPort: DAEMON_DEFAULT_WEB_PORT,
		statsPort: DAEMON_DEFAULT_STATS_PORT,
		gatewayPort: DAEMON_DEFAULT_GATEWAY_PORT,
	};
	const logPath = "/home/me/.zeta/run/daemon.log";

	test("linux writes a user systemd unit", () => {
		const plan = planAutostart({
			platform: "linux",
			execPath: "/usr/local/bin/zetacode",
			homeDir: "/home/me",
			env: {},
			ports,
			logPath,
		});
		expect(plan.supported).toBe(true);
		expect(plan.path).toBe("/home/me/.config/systemd/user/zetacode-daemon.service");
		expect(plan.content).toContain("[Unit]");
		expect(plan.content).toContain("[Service]");
		expect(plan.content).toContain("Type=exec");
		expect(plan.content).toContain(
			"ExecStart=/usr/local/bin/zetacode serve --no-browser --stats-port 3847 --web-port 30141 --gateway-port 30142",
		);
		expect(plan.content).toContain(`StandardOutput=append:${logPath}`);
		expect(plan.content).toContain(`StandardError=append:${logPath}`);
		expect(plan.content).toContain("[Install]");
		expect(plan.content).toContain("WantedBy=default.target");
		expect(plan.undo).toContain("systemctl --user disable --now zetacode-daemon.service");
		expect(plan.undo).toContain("rm -f /home/me/.config/systemd/user/zetacode-daemon.service");
		expect(plan.activate).toEqual([
			"systemctl --user daemon-reload",
			"systemctl --user enable --now zetacode-daemon.service",
		]);
	});

	test("windows writes a current-user Startup entry", () => {
		const plan = planAutostart({
			platform: "win32",
			execPath: "C:\\Program Files\\Zeta\\zetacode.exe",
			homeDir: "C:\\Users\\me",
			env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
			ports,
			logPath: "C:\\Users\\me\\.zeta\\run\\daemon.log",
		});
		expect(plan.supported).toBe(true);
		expect(plan.path).toBe(
			// The plan is a Windows path regardless of the host running the test.
			path.win32.join(
				"C:\\Users\\me\\AppData\\Roaming",
				"Microsoft",
				"Windows",
				"Start Menu",
				"Programs",
				"Startup",
				"zetacode-daemon.cmd",
			),
		);
		expect(plan.content?.startsWith("@echo off\r\n")).toBe(true);
		expect(plan.content).toContain('"C:\\Program Files\\Zeta\\zetacode.exe"');
		expect(plan.content).toContain('"serve"');
		expect(plan.content).toContain('"--web-port" "30141"');
		expect(plan.content).toContain('>> "C:\\Users\\me\\.zeta\\run\\daemon.log" 2>&1');
		expect(plan.undo).toContain("del ");
	});

	test("macOS reports unsupported", () => {
		const plan = planAutostart({ platform: "darwin", homeDir: "/Users/me", env: {} });
		expect(plan.supported).toBe(false);
		expect(plan.path).toBeNull();
		expect(plan.content).toBeNull();
		expect(plan.notes.join("\n")).toContain("not supported");
	});

	test("install writes the exact content and uninstall removes it", async () => {
		const home = await tempRoot();
		const plan = planAutostart({
			platform: "linux",
			execPath: "/usr/local/bin/zetacode",
			homeDir: home,
			env: {},
			ports,
			logPath: path.join(home, "run", "daemon.log"),
		});
		const run = () => ({ ok: true });
		const installed = await installAutostart({ plan, run });
		expect(installed.written).toBe(true);
		expect(installed.activation.every(entry => entry.ok)).toBe(true);
		expect(await fs.readFile(plan.path as string, "utf8")).toBe(plan.content as string);

		const again = await installAutostart({ plan, run });
		expect(again.written).toBe(false);

		const removed = await uninstallAutostart({ plan, run });
		expect(removed.removed).toBe(true);
		expect(await fs.stat(plan.path as string).catch(() => null)).toBeNull();
	});
});

describe("cli invocation", () => {
	test("compiled binaries re-enter the executable directly", () => {
		expect(
			resolveCliInvocation({
				execPath: "/opt/zeta/zetacode",
				argv: ["/opt/zeta/zetacode", "daemon"],
				compiled: true,
			}),
		).toEqual(["/opt/zeta/zetacode"]);
	});

	test("source checkouts keep the entry script", () => {
		expect(
			resolveCliInvocation({
				execPath: "/usr/local/bin/bun",
				argv: ["/usr/local/bin/bun", "/src/zeta/cli.ts"],
				execArgv: [],
				compiled: false,
				exists: () => true,
			}),
		).toEqual(["/usr/local/bin/bun", "/src/zeta/cli.ts"]);
	});

	test("falls back to the PATH command when the script is unavailable", () => {
		expect(
			resolveCliInvocation({
				execPath: "/usr/local/bin/bun",
				argv: ["/usr/local/bin/bun"],
				compiled: false,
				exists: () => false,
			}),
		).toEqual(["zetacode"]);
	});
});

test("daemon state filename is stable", () => {
	expect(DAEMON_STATE_FILENAME).toBe("daemon.json");
});
