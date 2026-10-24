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
	type AutostartRunner,
	type DaemonRuntime,
	type DaemonState,
	type DaemonStatus,
	type SpawnBackendInput,
	daemonStatus,
	inspectAutostartStatus,
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
import { detectInstallForm } from "../../src/autostart/install-form";
import { readBackendAutostartSetting, writeBackendAutostartSetting } from "../../src/autostart/setting";
import { Settings } from "../../src/config/settings";
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

/** OS probe stub used by status paths that do not inject a full autostart state. */
const emptyRunner = () => ({ ok: false, status: 1, stdout: "", stderr: "not installed" });

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
		autostartRunner: emptyRunner,
		autostartSetting: false,
		installForm: "bundled",
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
		const autostart = {
			platform: "linux" as NodeJS.Platform,
			supported: true,
			installed: false,
			enabled: false,
			active: false,
			path: "/unit",
			setting: false,
			installForm: "bundled" as const,
		};
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
	const okRunner = { ok: true, status: 0, stdout: "", stderr: "" };

	test("linux writes a user service plus a three-minute timer", () => {
		const plan = planAutostart({
			platform: "linux",
			installForm: "bundled",
			execPath: "/usr/local/bin/zetacode",
			homeDir: "/home/me",
			env: {},
			ports,
			logPath,
		});
		expect(plan.supported).toBe(true);
		expect(plan.path).toBe("/home/me/.config/systemd/user/zetacode-daemon.timer");
		expect(plan.files.map(file => file.path)).toEqual([
			"/home/me/.config/systemd/user/zetacode-daemon.service",
			"/home/me/.config/systemd/user/zetacode-daemon.timer",
		]);
		const service = plan.files[0]!.content;
		expect(service).toContain("[Service]");
		expect(service).toContain("Type=exec");
		expect(service).toContain("ExecCondition=/usr/local/bin/zetacode daemon autostart-enabled");
		expect(service).toContain(
			"ExecStart=/usr/local/bin/zetacode serve --no-browser --stats-port 43147 --web-port 43141 --gateway-port 43143",
		);
		expect(service).toContain("Restart=no");
		expect(service).not.toContain("Restart=on-failure");
		expect(service).toContain(`StandardOutput=append:${logPath}`);
		expect(service).toContain(`StandardError=append:${logPath}`);

		const timer = plan.files[1]!.content;
		expect(timer).toContain("OnBootSec=3min");
		expect(timer).toContain("OnStartupSec=3min");
		expect(timer).toContain("Unit=zetacode-daemon.service");
		expect(timer).toContain("WantedBy=timers.target");
		expect(plan.undo).toContain("systemctl --user disable --now zetacode-daemon.timer");
		expect(plan.undo).toContain("rm -f /home/me/.config/systemd/user/zetacode-daemon.service");
		expect(plan.activate).toEqual([
			{ command: "systemctl", args: ["--user", "daemon-reload"] },
			{ command: "systemctl", args: ["--user", "enable", "--now", "zetacode-daemon.timer"] },
		]);
		expect(plan.notes.join("\n")).toContain("linger");
	});

	test("windows writes a per-user Task Scheduler definition with a three-minute delay", () => {
		const env = {
			LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
			USERDOMAIN: "DESKTOP",
			USERNAME: "me",
			USERPROFILE: "C:\\Users\\me",
		};
		const plan = planAutostart({
			platform: "win32",
			installForm: "bundled",
			execPath: "C:\\Program Files\\Zeta\\zetacode.exe",
			homeDir: "C:\\Users\\me",
			env,
			ports,
			logPath: "C:\\Users\\me\\.zeta\\run\\daemon.log",
		});
		expect(plan.supported).toBe(true);
		expect(plan.path).toBe("C:\\Users\\me\\AppData\\Local\\Zeta\\autostart\\zetacode-backend.xml");
		const xml = plan.content ?? "";
		expect(xml).toContain('<Task version="1.4"');
		expect(xml).toContain("<Delay>PT3M</Delay>");
		expect(xml).toContain("<UserId>DESKTOP\\me</UserId>");
		expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
		expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
		expect(xml).toContain("<Command>C:\\Program Files\\Zeta\\zetacode.exe</Command>");
		expect(xml).toContain("serve --no-browser --stats-port 43147 --web-port 43141 --gateway-port 43143 --autostart");
		expect(xml).not.toContain("RestartOnFailure");
		expect(plan.activate).toHaveLength(1);
		expect(plan.activate[0]!.command).toBe("powershell");
		expect(plan.activate[0]!.args.at(-1)).toContain("Register-ScheduledTask");
		expect(plan.activate[0]!.args.at(-1)).toContain(plan.path!);
		expect(plan.disable[0]!.args.at(-1)).toContain("Unregister-ScheduledTask");
	});

	test("the npm form is refused and writes nothing at all", async () => {
		const home = await tempRoot();
		const result = await installAutostart({
			platform: "linux",
			installForm: "npm",
			execPath: "/usr/bin/bun",
			argv: ["/usr/bin/bun", "/app/node_modules/zeta/dist/cli.js"],
			homeDir: home,
			env: {},
			ports,
			logPath: path.join(home, "run", "daemon.log"),
			run: () => okRunner,
		});
		expect(result.refused).toBe(true);
		expect(result.written).toBe(false);
		expect(result.activation).toEqual([]);
		expect(result.message).toContain("bundled Zeta desktop app");
		// Nothing in the would-be config home, and no commands ran.
		expect(await fs.readdir(home)).toEqual([]);
	});

	test("detects the install form from the marker, with paths only as backup", () => {
		expect(detectInstallForm({ marker: "true" })).toBe("bundled");
		expect(
			detectInstallForm({
				marker: "false",
				execPath: "/usr/bin/bun",
				argv: ["/usr/bin/bun", "/app/node_modules/zeta/dist/cli.js"],
			}),
		).toBe("npm");
		expect(
			detectInstallForm({ marker: undefined, execPath: "C:\\Program Files\\Zeta\\zetacode.exe", argv: [] }),
		).toBe("bundled");
	});

	test("macOS reports unsupported", () => {
		const plan = planAutostart({ platform: "darwin", installForm: "bundled", homeDir: "/Users/me", env: {} });
		expect(plan.supported).toBe(false);
		expect(plan.path).toBeNull();
		expect(plan.content).toBeNull();
		expect(plan.notes.join("\n")).toContain("not supported");
	});

	test("install writes every file and uninstall disables then removes them", async () => {
		const home = await tempRoot();
		const plan = planAutostart({
			platform: "linux",
			installForm: "bundled",
			execPath: "/usr/local/bin/zetacode",
			homeDir: home,
			env: {},
			ports,
			logPath: path.join(home, "run", "daemon.log"),
		});
		const run = () => okRunner;
		const installed = await installAutostart({ plan, run });
		expect(installed.written).toBe(true);
		expect(installed.activation.every(entry => entry.ok)).toBe(true);
		for (const file of plan.files) {
			expect(await fs.readFile(file.path, "utf8")).toBe(file.content);
		}

		const again = await installAutostart({ plan, run });
		expect(again.written).toBe(false);

		const removed = await uninstallAutostart({ plan, run });
		expect(removed.removed).toBe(true);
		expect(removed.deactivation.every(entry => entry.ok)).toBe(true);
		for (const file of plan.files) {
			expect(await fs.stat(file.path).catch(() => null)).toBeNull();
		}
	});
});

describe("autostart OS status", () => {
	const runner =
		(stdout: string, ok = true): AutostartRunner =>
		() => ({
			ok,
			status: ok ? 0 : 1,
			stdout,
			stderr: ok ? "" : "not installed",
		});

	test("parses an enabled and running systemd user timer/service", async () => {
		const status = await inspectAutostartStatus({
			platform: "linux",
			homeDir: "/home/me",
			env: {},
			setting: true,
			installForm: "bundled",
			runner: runner(
				[
					"Id=zetacode-daemon.timer",
					"LoadState=loaded",
					"UnitFileState=enabled",
					"ActiveState=active",
					"",
					"Id=zetacode-daemon.service",
					"LoadState=loaded",
					"UnitFileState=static",
					"ActiveState=active",
					"",
				].join("\n"),
			),
		});
		expect(status.installed).toBe(true);
		expect(status.enabled).toBe(true);
		expect(status.active).toBe(true);
		expect(status.setting).toBe(true);
		expect(status.supported).toBe(true);
		expect(status.path).toBe("/home/me/.config/systemd/user/zetacode-daemon.timer");
	});

	test("reports a disabled timer and stopped service instead of assuming they are on", async () => {
		const status = await inspectAutostartStatus({
			platform: "linux",
			homeDir: "/home/me",
			setting: false,
			installForm: "bundled",
			runner: runner(
				[
					"Id=zetacode-daemon.timer",
					"LoadState=loaded",
					"UnitFileState=disabled",
					"ActiveState=inactive",
					"",
					"Id=zetacode-daemon.service",
					"LoadState=loaded",
					"UnitFileState=static",
					"ActiveState=inactive",
					"",
				].join("\n"),
			),
		});
		expect(status.installed).toBe(true);
		expect(status.enabled).toBe(false);
		expect(status.active).toBe(false);
		expect(status.setting).toBe(false);
	});

	test("reports a missing systemd unit as not installed", async () => {
		const status = await inspectAutostartStatus({
			platform: "linux",
			installForm: "bundled",
			runner: runner(
				["Id=zetacode-daemon.timer", "LoadState=not-found", "UnitFileState=", "ActiveState=inactive", ""].join(
					"\n",
				),
			),
		});
		expect(status.installed).toBe(false);
		expect(status.enabled).toBe(false);
		expect(status.active).toBe(false);
	});

	test("parses the Windows task state from Task Scheduler", async () => {
		const status = await inspectAutostartStatus({
			platform: "win32",
			setting: true,
			installForm: "bundled",
			env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
			runner: runner('{"installed":true,"enabled":false,"state":"Ready"}\n'),
		});
		expect(status.installed).toBe(true);
		expect(status.enabled).toBe(false);
		expect(status.active).toBe(false);
	});

	test("the npm form is never supported even when the platform is", async () => {
		const status = await inspectAutostartStatus({
			platform: "linux",
			installForm: "npm",
			runner: runner(""),
		});
		expect(status.supported).toBe(false);
		expect(status.reason).toContain("bundled Zeta desktop app");
	});

	test("daemon start never enables or installs autostart", async () => {
		const root = await tempRoot();
		const paths = resolveDaemonPaths({ root });
		const calls: Array<{ command: string; args: readonly string[] }> = [];
		const runtime = makeRuntime({
			alive: new Set<number>(),
			autostartRunner: (command, args) => {
				calls.push({ command, args });
				return {
					ok: true,
					status: 0,
					stdout: [
						"Id=zetacode-daemon.timer",
						"LoadState=loaded",
						"UnitFileState=disabled",
						"ActiveState=inactive",
						"",
						"Id=zetacode-daemon.service",
						"LoadState=loaded",
						"UnitFileState=static",
						"ActiveState=inactive",
					].join("\n"),
					stderr: "",
				};
			},
			spawn: () => ({ pid: 4242, unref: () => {} }),
		});
		const result = await startDaemon({
			paths,
			runtime,
			access,
			webPort: DAEMON_DEFAULT_WEB_PORT,
			statsPort: DAEMON_DEFAULT_STATS_PORT,
			gatewayPort: DAEMON_DEFAULT_GATEWAY_PORT,
			cliInvocation: ["zetacode"],
			waitReady: async () => "timeout" as const,
		});
		expect(result.action).toBe("started");
		expect(result.status.autostart.enabled).toBe(false);
		// Only the read-only `systemctl show` probe ran: no enable, no install.
		expect(calls.every(call => call.command === "systemctl" && call.args.includes("show"))).toBe(true);
		expect(calls.some(call => call.args.includes("enable"))).toBe(false);
	});
});

describe("autostart setting", () => {
	test("reads the global user config only, never a project layer", async () => {
		const home = await tempRoot();
		const agentDir = path.join(home, "agent");
		const project = path.join(home, "project");
		await fs.mkdir(agentDir, { recursive: true });
		await fs.mkdir(path.join(project, ".zeta"), { recursive: true });
		await fs.writeFile(path.join(agentDir, "config.yml"), "backend:\n  autostart: true\n");
		await fs.writeFile(path.join(project, ".zeta", "config.yml"), "backend:\n  autostart: false\n");

		const fromGlobal = await Settings.loadReadOnly({ agentDir, cwd: project });
		expect(await readBackendAutostartSetting({ settings: fromGlobal })).toBe(true);

		await fs.writeFile(path.join(agentDir, "config.yml"), "theme: dark\n");
		const projectOnly = await Settings.loadReadOnly({ agentDir, cwd: project });
		expect(await readBackendAutostartSetting({ settings: projectOnly })).toBe(false);
	});

	test("writes the decision to the global user config", async () => {
		const home = await tempRoot();
		const agentDir = path.join(home, "agent");
		const project = path.join(home, "project");
		await fs.mkdir(agentDir, { recursive: true });
		await fs.mkdir(project, { recursive: true });

		const writable = await Settings.loadIsolated({ agentDir, cwd: project });
		await writeBackendAutostartSetting(true, { settings: writable });
		await fs.mkdir(path.join(project, ".zeta"), { recursive: true });
		await fs.writeFile(path.join(project, ".zeta", "config.yml"), "backend:\n  autostart: false\n");

		const reread = await Settings.loadReadOnly({ agentDir, cwd: project });
		expect(await readBackendAutostartSetting({ settings: reread })).toBe(true);
		const contents = await fs.readFile(path.join(agentDir, "config.yml"), "utf8");
		expect(contents).toContain("autostart: true");
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
