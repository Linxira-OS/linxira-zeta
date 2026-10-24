/**
 * `zetacode daemon` — background lifecycle for the serve backend.
 *
 * `serve` keeps exactly the meaning it had: a foreground process that owns its
 * ports, prints its URLs, and exits on Ctrl+C. This command supervises that
 * same command instead of reimplementing it:
 *
 * - `daemon start` spawns `zetacode serve …` detached, appends its output to
 *   `<config root>/run/daemon.log`, and records the pid/ports in
 *   `<config root>/run/daemon.json`;
 * - `daemon status`, `stop`, `restart`, and `logs` read those records;
 * - a pid that is no longer alive is *stale*, never something to wait on:
 *   `stop` removes the leftovers and a new `start` replaces them.
 *
 * Only one backend exists per user. `start` serialises concurrent invocations
 * with a short-lived `daemon.start.lock`, records the live backend through the
 * shared instance-lock format (`channels/instance-lock.ts`, `daemon.lock`),
 * and also recognises a `serve` instance registered in `serve.json` so a
 * daemon is never started beside a foreground server.
 *
 * Autostart is a real per-user OS component, installed only by the bundled
 * app (`PI_COMPILED=true`): a systemd user service+timer on Linux, a Task
 * Scheduler task on Windows, both delayed three minutes after boot/login. The
 * global-only `backend.autostart` setting gates the installed component; the
 * npm/source form is refused and writes nothing. macOS is reported as
 * unsupported.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import chalk from "@linxiraos/pi-utils/chalk";
import { Args, CliUsageError, Command, Flags } from "@linxiraos/pi-utils/cli";
import {
	CLI_BIN_NAME,
	getBaseConfigRoot,
	isCompiledBinary,
	VERSION,
	ZETA_GATEWAY_PORT,
	ZETA_STATS_PORT,
	ZETA_WEB_PORT,
} from "@linxiraos/pi-utils";
import { detectInstallForm, type InstallForm } from "../autostart/install-form";
import { readBackendAutostartSetting, writeBackendAutostartSetting } from "../autostart/setting";
import { acquireChannelLock, readChannelLock } from "../channels/instance-lock";
import { daemonHelp } from "../cli/command-help";
import { WebConfig } from "../config/web-config";
import { type ServeAccess, formatAccessUrl, resolveServeAccess } from "../server/serve-access";
import {
	clearServeRegistration,
	isPidAlive,
	readServeRegistration,
	type ServeRegistration,
} from "../server/serve-registry";

export const DAEMON_STATE_FILENAME = "daemon.json";
export const DAEMON_LOG_FILENAME = "daemon.log";
export const DAEMON_LOCK_FILENAME = "daemon.lock";
export const DAEMON_START_LOCK_FILENAME = "daemon.start.lock";

export const DAEMON_DEFAULT_WEB_PORT = ZETA_WEB_PORT;
export const DAEMON_DEFAULT_STATS_PORT = ZETA_STATS_PORT;
export const DAEMON_DEFAULT_GATEWAY_PORT = ZETA_GATEWAY_PORT;

/** A start lock older than this is from a crashed `daemon start`, not a live one. */
const START_LOCK_STALE_MS = 60_000;
/** Poll interval while waiting for a backend to exit. */
const EXIT_POLL_MS = 100;
/** How long a hard kill may take before `stop` reports failure instead of hanging. */
const HARD_KILL_GRACE_MS = 2_000;
/** Default budget for the backend to publish its serve registration. */
const DEFAULT_READY_TIMEOUT_MS = 15_000;

export interface DaemonPaths {
	/** `<config root>/run`; daemon records live beside the serve registry. */
	root: string;
	state: string;
	log: string;
	lock: string;
}

export interface DaemonPorts {
	webPort: number;
	statsPort: number;
	gatewayPort: number;
}

export interface DaemonState extends DaemonPorts {
	version: 1;
	/** Matches the instance lock, so a stop never deletes a successor's records. */
	instanceId: string;
	pid: number;
	startedAt: string;
	cwd: string;
	webUrl: string;
	statsUrl: string;
	gatewayUrl: string;
	logPath: string;
	cliVersion: string;
}

export type DaemonStatusSource = "daemon" | "instance-lock" | "serve-registry";

export interface DaemonAutostartStatus {
	platform: NodeJS.Platform;
	/** This install form may own an OS autostart component (bundled only). */
	supported: boolean;
	/** The unit/task exists according to the OS, not our pid file. */
	installed: boolean;
	/** The OS has the unit/task enabled for boot/login. */
	enabled: boolean;
	/** The backend service/task is running right now according to the OS. */
	active: boolean;
	path: string | null;
	/** Global-only `backend.autostart` decision (`~/.zeta/agent/config.yml`). */
	setting: boolean;
	installForm: InstallForm;
	/** Why the OS query could not answer, when it could not. */
	reason?: string;
}

export interface DaemonStatus {
	running: boolean;
	/** Leftover records whose pid is gone (cleaned by `stop`, replaced by `start`). */
	stale: boolean;
	pid: number | null;
	/** The web port; the primary address users care about. */
	port: number | null;
	webPort: number | null;
	statsPort: number | null;
	gatewayPort: number | null;
	webUrl: string | null;
	statsUrl: string | null;
	gatewayUrl: string | null;
	startedAt: string | null;
	cliVersion: string | null;
	source: DaemonStatusSource | null;
	statePath: string;
	lockPath: string;
	logPath: string;
	autostart: DaemonAutostartStatus;
}

export interface SpawnedBackend {
	pid: number;
	unref(): void;
}

export interface SpawnBackendInput {
	command: string[];
	cwd: string;
	logPath: string;
	env: NodeJS.ProcessEnv;
}

export interface DaemonRuntime {
	isAlive(pid: number): boolean;
	sleep(ms: number): Promise<void>;
	now(): number;
	kill(pid: number, signal: "SIGTERM" | "SIGKILL"): void;
	spawn(input: SpawnBackendInput): Promise<SpawnedBackend> | SpawnedBackend;
	readRegistry(): ServeRegistration | null;
	/** Start the registry probe again after the backend publishes it. */
	platform: NodeJS.Platform;
	/** Query the OS about the installed unit/task (injectable in tests). */
	autostartRunner?: AutostartRunner;
	/** Injectable global setting read; when omitted, the config file is read. */
	autostartSetting?: boolean;
	/** Injectable install-form detection; when omitted, it is detected once. */
	installForm?: InstallForm;
}

export interface DaemonStartResult {
	action: "started" | "already-running" | "failed";
	status: DaemonStatus;
	spawned: boolean;
	cleanedStale: boolean;
	message?: string;
	exitCode: number;
}

export interface DaemonStopResult {
	action: "stopped" | "not-running" | "cleaned-stale" | "failed";
	status: DaemonStatus;
	pid: number | null;
	message?: string;
	exitCode: number;
}

/** Resolve every artifact this command reads or writes. */
export function resolveDaemonPaths(options: { root?: string } = {}): DaemonPaths {
	const root = path.resolve(options.root ?? path.join(getBaseConfigRoot(), "run"));
	return {
		root,
		state: path.join(root, DAEMON_STATE_FILENAME),
		log: path.join(root, DAEMON_LOG_FILENAME),
		lock: path.join(root, DAEMON_LOCK_FILENAME),
	};
}

/**
 * The argv prefix that re-enters this CLI. Compiled binaries are already the
 * executable; a source checkout runs through Bun and the entry script, so the
 * detached backend cannot accidentally execute the binary's subcommand path.
 */
export function resolveCliInvocation(
	options: {
		execPath?: string;
		argv?: readonly string[];
		execArgv?: readonly string[];
		compiled?: boolean;
		exists?: (file: string) => boolean;
	} = {},
): string[] {
	const execPath = options.execPath ?? process.execPath;
	const argv = options.argv ?? process.argv;
	const exists = options.exists ?? existsSync;
	if (options.compiled ?? isCompiledBinary()) return [execPath];
	const script = argv[1];
	if (script && exists(script)) return [execPath, ...(options.execArgv ?? process.execArgv), script];
	// Installed through a shim whose script path is not visible here: fall back
	// to the on-PATH command.
	return [CLI_BIN_NAME];
}

function parseDaemonState(raw: unknown): DaemonState | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const record = raw as Record<string, unknown>;
	const port = (value: unknown): value is number =>
		typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < 65536;
	if (
		record.version !== 1 ||
		typeof record.instanceId !== "string" ||
		record.instanceId.length === 0 ||
		!port(record.pid) ||
		!port(record.webPort) ||
		!port(record.statsPort) ||
		!port(record.gatewayPort) ||
		typeof record.startedAt !== "string" ||
		typeof record.cwd !== "string" ||
		typeof record.webUrl !== "string" ||
		typeof record.statsUrl !== "string" ||
		typeof record.gatewayUrl !== "string" ||
		typeof record.logPath !== "string" ||
		typeof record.cliVersion !== "string"
	) {
		return null;
	}
	return {
		version: 1,
		instanceId: record.instanceId,
		pid: record.pid,
		startedAt: record.startedAt,
		cwd: record.cwd,
		webPort: record.webPort,
		statsPort: record.statsPort,
		gatewayPort: record.gatewayPort,
		webUrl: record.webUrl,
		statsUrl: record.statsUrl,
		gatewayUrl: record.gatewayUrl,
		logPath: record.logPath,
		cliVersion: record.cliVersion,
	};
}

/** Read the daemon record without trusting it: absent or malformed means `null`. */
export async function readDaemonState(statePath: string): Promise<DaemonState | null> {
	try {
		return parseDaemonState(JSON.parse(await fs.readFile(statePath, "utf8")));
	} catch {
		return null;
	}
}

/** Publish the record atomically so a concurrent status never sees half a file. */
export async function writeDaemonState(statePath: string, state: DaemonState): Promise<void> {
	await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
	const temp = `${statePath}.${process.pid}.tmp`;
	try {
		await fs.writeFile(temp, `${JSON.stringify(state, null, "\t")}\n`, { encoding: "utf8", mode: 0o600 });
		await fs.rename(temp, statePath);
	} finally {
		await fs.rm(temp, { force: true }).catch(() => {});
	}
}

function portFromUrl(value: string | null | undefined): number | null {
	if (!value) return null;
	try {
		const port = Number(new URL(value).port);
		return Number.isSafeInteger(port) && port > 0 ? port : null;
	} catch {
		return null;
	}
}

function defaultRuntime(overrides: Partial<DaemonRuntime> | undefined): DaemonRuntime {
	const base: DaemonRuntime = {
		isAlive: isPidAlive,
		sleep: ms => Bun.sleep(ms),
		now: () => Date.now(),
		kill: (pid, signal) => {
			if (process.platform === "win32") {
				// Windows cannot deliver a console SIGTERM; terminate the tree so the
				// Web UI/Stats children cannot outlive the backend.
				spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
				return;
			}
			try {
				// Detached backends lead their own process group, so this reaches the
				// Web UI child as well.
				process.kill(-pid, signal);
			} catch {
				try {
					process.kill(pid, signal);
				} catch {
					// Already gone: the caller's liveness poll observes it.
				}
			}
		},
		spawn: spawnBackend,
		readRegistry: () => readServeRegistration(),
		platform: process.platform,
	};
	return { ...base, ...overrides };
}

/**
 * Spawn `serve` fully detached, with both output streams appended to the
 * daemon log. The parent closes its copy of the descriptor after `spawn`;
 * the child keeps writing to the same file.
 */
async function spawnBackend(input: SpawnBackendInput): Promise<SpawnedBackend> {
	await fs.mkdir(path.dirname(input.logPath), { recursive: true, mode: 0o700 });
	const logHandle = await fs.open(input.logPath, "a", 0o600);
	try {
		const child = spawn(input.command[0] as string, input.command.slice(1), {
			cwd: input.cwd,
			env: input.env,
			detached: true,
			stdio: ["ignore", logHandle.fd, logHandle.fd],
			windowsHide: true,
		});
		await new Promise<void>((resolve, reject) => {
			child.once("error", reject);
			child.once("spawn", () => resolve());
		});
		child.unref();
		return { pid: child.pid ?? 0, unref: () => child.unref() };
	} finally {
		await logHandle.close().catch(() => {});
	}
}

export interface DaemonStatusOptions {
	paths?: DaemonPaths;
	runtime?: Partial<DaemonRuntime>;
	autostart?: DaemonAutostartStatus;
	/** Injectable OS probe for `autostart`, when `autostart` is not supplied. */
	autostartRunner?: AutostartRunner;
}

/**
 * Snapshot the backend without mutating anything. Precedence: our record (it
 * carries the ports), then the instance lock (record lost), then `serve.json`
 * (a foreground `serve` or an OS-supervised backend).
 */
export async function daemonStatus(options: DaemonStatusOptions = {}): Promise<DaemonStatus> {
	const paths = options.paths ?? resolveDaemonPaths();
	const runtime = defaultRuntime(options.runtime);
	const state = await readDaemonState(paths.state);
	const lock = await readChannelLock(paths.lock, { isAlive: runtime.isAlive });
	const registry = runtime.readRegistry();
	const autostart =
		options.autostart ??
		(await inspectAutostartStatus({
			platform: runtime.platform,
			runner: options.autostartRunner ?? runtime.autostartRunner,
			setting: runtime.autostartSetting,
			installForm: runtime.installForm,
		}));

	const status: DaemonStatus = {
		running: false,
		stale: false,
		pid: null,
		port: null,
		webPort: null,
		statsPort: null,
		gatewayPort: null,
		webUrl: null,
		statsUrl: null,
		gatewayUrl: null,
		startedAt: null,
		cliVersion: null,
		source: null,
		statePath: paths.state,
		lockPath: paths.lock,
		logPath: state?.logPath ?? paths.log,
		autostart,
	};

	if (state && runtime.isAlive(state.pid)) {
		return {
			...status,
			running: true,
			pid: state.pid,
			port: state.webPort,
			webPort: state.webPort,
			statsPort: state.statsPort,
			gatewayPort: state.gatewayPort,
			webUrl: state.webUrl,
			statsUrl: state.statsUrl,
			gatewayUrl: state.gatewayUrl,
			startedAt: state.startedAt,
			cliVersion: state.cliVersion,
			source: "daemon",
		};
	}

	if (lock?.alive) {
		const registration = registry?.pid === lock.metadata.pid ? registry : null;
		const webPort = portFromUrl(registration?.webUrl);
		const statsPort = portFromUrl(registration?.statsUrl);
		const gatewayPort = portFromUrl(registration?.gatewayUrl);
		return {
			...status,
			running: true,
			pid: lock.metadata.pid,
			port: webPort,
			webPort,
			statsPort,
			gatewayPort,
			webUrl: registration?.webUrl ?? null,
			statsUrl: registration?.statsUrl ?? null,
			gatewayUrl: registration?.gatewayUrl ?? null,
			startedAt: lock.metadata.startedAt || null,
			cliVersion: registration?.version ?? null,
			source: "instance-lock",
		};
	}

	if (registry && runtime.isAlive(registry.pid)) {
		const webPort = portFromUrl(registry.webUrl);
		const statsPort = portFromUrl(registry.statsUrl);
		const gatewayPort = portFromUrl(registry.gatewayUrl);
		return {
			...status,
			running: true,
			pid: registry.pid,
			port: webPort,
			webPort,
			statsPort,
			gatewayPort,
			webUrl: registry.webUrl,
			statsUrl: registry.statsUrl,
			gatewayUrl: registry.gatewayUrl,
			startedAt: registry.startedAt || null,
			cliVersion: registry.version,
			source: "serve-registry",
		};
	}

	const stalePid = state?.pid ?? (lock ? lock.metadata.pid : null);
	return {
		...status,
		stale: stalePid !== null,
		pid: stalePid,
		port: state?.webPort ?? null,
		webPort: state?.webPort ?? null,
		statsPort: state?.statsPort ?? null,
		gatewayPort: state?.gatewayPort ?? null,
		webUrl: state?.webUrl ?? null,
		statsUrl: state?.statsUrl ?? null,
		gatewayUrl: state?.gatewayUrl ?? null,
		startedAt: state?.startedAt ?? null,
		cliVersion: state?.cliVersion ?? null,
	};
}

/**
 * Remove records left by a dead backend. With `pid`, that backend's records
 * are removed even if its pid was reused; dead records are always removed and
 * a live successor's records are never touched.
 */
async function cleanupDaemonRecords(
	paths: DaemonPaths,
	options: { pid?: number; isAlive?: (pid: number) => boolean } = {},
): Promise<boolean> {
	const { pid, isAlive = isPidAlive } = options;
	let cleaned = false;
	const state = await readDaemonState(paths.state);
	if (state && (pid === undefined || state.pid === pid || !isAlive(state.pid))) {
		await fs.rm(paths.state, { force: true }).catch(() => {});
		cleaned = true;
	} else if (!state && pid === undefined) {
		// A corrupt record cannot be attributed to a live backend; `stop` clears it.
		const stat = await fs.stat(paths.state).catch(() => null);
		if (stat) {
			await fs.rm(paths.state, { force: true }).catch(() => {});
			cleaned = true;
		}
	}
	const lock = await readChannelLock(paths.lock);
	if (lock && (lock.malformed || pid === undefined || lock.metadata.pid === pid || !isAlive(lock.metadata.pid))) {
		await fs.rm(paths.lock, { force: true }).catch(() => {});
		cleaned = true;
	}
	if (pid !== undefined) {
		// A backend that stopped cleanly already withdrew its own registration;
		// this clears the one it left behind after a crash.
		clearServeRegistration(pid);
	}
	return cleaned;
}

interface StartLockHandle {
	release(): Promise<void>;
}

/** Serialise `daemon start`. A crashed start's lock expires after a minute. */
async function acquireStartLock(paths: DaemonPaths, runtime: DaemonRuntime): Promise<StartLockHandle | null> {
	await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
	const lockPath = path.join(paths.root, DAEMON_START_LOCK_FILENAME);
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const handle = await fs.open(lockPath, "wx", 0o600);
			try {
				await handle.writeFile(`${process.pid}\n`, "utf8");
			} finally {
				await handle.close();
			}
			return {
				release: async () => {
					await fs.rm(lockPath, { force: true }).catch(() => {});
				},
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const stat = await fs.stat(lockPath).catch(() => null);
			const age = stat ? runtime.now() - stat.mtimeMs : Number.POSITIVE_INFINITY;
			if (stat && age <= START_LOCK_STALE_MS) return null;
			await fs.rm(lockPath, { force: true }).catch(() => {});
		}
	}
	return null;
}

/** Bounded wait for the backend to publish its registration. Never hangs. */
async function waitForReady(
	pid: number,
	paths: DaemonPaths,
	runtime: DaemonRuntime,
	timeoutMs: number,
): Promise<"ready" | "exited" | "timeout"> {
	const deadline = runtime.now() + Math.max(0, timeoutMs);
	for (;;) {
		if (!runtime.isAlive(pid)) return "exited";
		if (runtime.readRegistry()?.pid === pid) return "ready";
		if (runtime.now() >= deadline) return runtime.isAlive(pid) ? "timeout" : "exited";
		await runtime.sleep(150);
	}
}

/** Bounded liveness poll; `true` means the process is gone. */
async function waitForExit(pid: number, runtime: DaemonRuntime, timeoutMs: number): Promise<boolean> {
	const deadline = runtime.now() + Math.max(0, timeoutMs);
	for (;;) {
		if (!runtime.isAlive(pid)) return true;
		if (runtime.now() >= deadline) return !runtime.isAlive(pid);
		await runtime.sleep(EXIT_POLL_MS);
	}
}

function serveArgs(
	ports: DaemonPorts,
	options: {
		host?: string;
		tls?: boolean;
		tlsCert?: string;
		tlsKey?: string;
		allowPlainHttp?: boolean;
		channels?: boolean;
	},
): string[] {
	const args = [
		"serve",
		"--no-browser",
		"--stats-port",
		String(ports.statsPort),
		"--web-port",
		String(ports.webPort),
		"--gateway-port",
		String(ports.gatewayPort),
	];
	if (options.host) args.push("--host", options.host);
	if (options.tls) args.push("--tls");
	if (options.tlsCert) args.push("--tls-cert", options.tlsCert);
	if (options.tlsKey) args.push("--tls-key", options.tlsKey);
	if (options.allowPlainHttp) args.push("--allow-plain-http");
	if (options.channels) args.push("--channels");
	return args;
}

export interface DaemonStartOptions extends DaemonPorts {
	paths?: DaemonPaths;
	runtime?: Partial<DaemonRuntime>;
	access: ServeAccess;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	host?: string;
	tls?: boolean;
	tlsCert?: string;
	tlsKey?: string;
	allowPlainHttp?: boolean;
	channels?: boolean;
	cliInvocation?: string[];
	readyTimeoutMs?: number;
	/** Injectable readiness probe for tests. */
	waitReady?: (pid: number) => Promise<"ready" | "exited" | "timeout">;
}

/**
 * Start the backend, or report the live one. Starting twice is a no-op: the
 * second call returns `already-running` with the pid and port and spawns
 * nothing.
 */
export async function startDaemon(options: DaemonStartOptions): Promise<DaemonStartResult> {
	const paths = options.paths ?? resolveDaemonPaths();
	const runtime = defaultRuntime(options.runtime);
	await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });

	const startLock = await acquireStartLock(paths, runtime);
	if (!startLock) {
		const status = await daemonStatus({ paths, runtime });
		return {
			action: status.running ? "already-running" : "failed",
			status,
			spawned: false,
			cleanedStale: false,
			message: "Another `daemon start` is in progress; wait for it to finish.",
			exitCode: status.running ? 0 : 1,
		};
	}

	try {
		const before = await daemonStatus({ paths, runtime });
		if (before.running) {
			return {
				action: "already-running",
				status: before,
				spawned: false,
				cleanedStale: false,
				exitCode: 0,
			};
		}

		const cleanedStale = before.stale ? await cleanupDaemonRecords(paths, { isAlive: runtime.isAlive }) : false;
		const ports: DaemonPorts = {
			webPort: options.webPort,
			statsPort: options.statsPort,
			gatewayPort: options.gatewayPort,
		};
		const invocation = options.cliInvocation ?? resolveCliInvocation();
		const command = [...invocation, ...serveArgs(ports, options)];
		const cwd = options.cwd ?? process.cwd();
		const env = options.env ?? process.env;

		let spawned: SpawnedBackend;
		try {
			spawned = await runtime.spawn({ command, cwd, logPath: paths.log, env });
		} catch (error) {
			const status = await daemonStatus({ paths, runtime });
			return {
				action: "failed",
				status,
				spawned: false,
				cleanedStale,
				message: `Could not spawn \`${CLI_BIN_NAME} serve\`: ${error instanceof Error ? error.message : String(error)}`,
				exitCode: 1,
			};
		}
		if (!Number.isSafeInteger(spawned.pid) || spawned.pid <= 0) {
			const status = await daemonStatus({ paths, runtime });
			return {
				action: "failed",
				status,
				spawned: false,
				cleanedStale,
				message: "The backend did not report a pid.",
				exitCode: 1,
			};
		}

		const acquired = await acquireChannelLock({
			lockPath: paths.lock,
			metadata: { pid: spawned.pid, host: "serve", cwd, channels: [] },
			isAlive: runtime.isAlive,
		});
		if (!acquired.ok) {
			// Another backend won the race between our status read and spawn.
			runtime.kill(spawned.pid, "SIGKILL");
			const status = await daemonStatus({ paths, runtime });
			return {
				action: "already-running",
				status,
				spawned: false,
				cleanedStale,
				message: acquired.message,
				exitCode: 0,
			};
		}

		const startedAt = new Date(runtime.now()).toISOString();
		const state: DaemonState = {
			version: 1,
			instanceId: acquired.lock.metadata.instanceId,
			pid: spawned.pid,
			startedAt,
			cwd,
			webPort: ports.webPort,
			statsPort: ports.statsPort,
			gatewayPort: ports.gatewayPort,
			webUrl: formatAccessUrl(options.access, ports.webPort),
			statsUrl: formatAccessUrl({ host: options.access.host, scheme: "http" }, ports.statsPort),
			gatewayUrl: `http://127.0.0.1:${ports.gatewayPort}`,
			logPath: paths.log,
			cliVersion: VERSION,
		};
		try {
			await writeDaemonState(paths.state, state);
		} catch (error) {
			runtime.kill(spawned.pid, "SIGKILL");
			await cleanupDaemonRecords(paths, { pid: spawned.pid, isAlive: runtime.isAlive });
			return {
				action: "failed",
				status: await daemonStatus({ paths, runtime }),
				spawned: false,
				cleanedStale,
				message: `Could not write ${paths.state}: ${error instanceof Error ? error.message : String(error)}`,
				exitCode: 1,
			};
		}

		const waitReady =
			options.waitReady ??
			(pid => waitForReady(pid, paths, runtime, options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS));
		const readiness = await waitReady(spawned.pid);
		if (readiness === "exited") {
			const tail = await readDaemonLogTail(paths.log, 8).catch(() => []);
			await cleanupDaemonRecords(paths, { pid: spawned.pid, isAlive: runtime.isAlive });
			const status = await daemonStatus({ paths, runtime });
			const detail = tail.length > 0 ? `\n${tail.join("\n")}` : "";
			return {
				action: "failed",
				status,
				spawned: true,
				cleanedStale,
				message: `The backend exited during startup. See ${paths.log}.${detail}`,
				exitCode: 1,
			};
		}

		return {
			action: "started",
			status: await daemonStatus({ paths, runtime }),
			spawned: true,
			cleanedStale,
			message:
				readiness === "timeout"
					? `The backend is still booting; follow it with \`${CLI_BIN_NAME} daemon logs --follow\`.`
					: undefined,
			exitCode: 0,
		};
	} finally {
		await startLock.release();
	}
}

export interface DaemonStopOptions {
	paths?: DaemonPaths;
	runtime?: Partial<DaemonRuntime>;
	/** Grace period before the hard kill, in seconds (default 10). */
	timeoutSeconds?: number;
}

/**
 * Stop the backend. A stale/broken record is removed immediately; a live
 * backend gets a bounded graceful window followed by a hard kill, so `stop`
 * never hangs on a wedged pid.
 */
export async function stopDaemon(options: DaemonStopOptions = {}): Promise<DaemonStopResult> {
	const paths = options.paths ?? resolveDaemonPaths();
	const runtime = defaultRuntime(options.runtime);
	const status = await daemonStatus({ paths, runtime });

	if (!status.running) {
		const cleaned = await cleanupDaemonRecords(paths, { isAlive: runtime.isAlive });
		return {
			action: status.stale || cleaned ? "cleaned-stale" : "not-running",
			status: await daemonStatus({ paths, runtime }),
			pid: null,
			exitCode: 0,
		};
	}

	const pid = status.pid as number;
	runtime.kill(pid, "SIGTERM");
	const gracefulMs = Math.max(0, Math.round((options.timeoutSeconds ?? 10) * 1000));
	let exited = await waitForExit(pid, runtime, gracefulMs);
	if (!exited) {
		runtime.kill(pid, "SIGKILL");
		exited = await waitForExit(pid, runtime, HARD_KILL_GRACE_MS);
	}
	if (!exited) {
		return {
			action: "failed",
			status: await daemonStatus({ paths, runtime }),
			pid,
			message: `pid ${pid} did not exit after SIGKILL; stop it manually.`,
			exitCode: 1,
		};
	}

	await cleanupDaemonRecords(paths, { pid, isAlive: runtime.isAlive });
	return {
		action: "stopped",
		status: await daemonStatus({ paths, runtime }),
		pid,
		exitCode: 0,
	};
}

export interface DaemonRestartResult {
	stop: DaemonStopResult;
	start: DaemonStartResult;
}

/** `stop` (cleaning a stale record if need be) then `start`. */
export async function restartDaemon(options: DaemonStartOptions & DaemonStopOptions): Promise<DaemonRestartResult> {
	const stop = await stopDaemon(options);
	if (stop.exitCode !== 0) {
		const paths = options.paths ?? resolveDaemonPaths();
		return {
			stop,
			start: {
				action: "failed",
				status: await daemonStatus({ paths, runtime: defaultRuntime(options.runtime) }),
				spawned: false,
				cleanedStale: false,
				message: "Not started: the previous daemon did not stop.",
				exitCode: 1,
			},
		};
	}
	return { stop, start: await startDaemon(options) };
}

/** Last `lineCount` lines of the daemon log (empty when it does not exist yet). */
export async function readDaemonLogTail(logPath: string, lineCount = 80): Promise<string[]> {
	const wanted = Math.max(1, Math.min(1000, Math.floor(lineCount)));
	let handle: fs.FileHandle;
	try {
		handle = await fs.open(logPath, "r");
	} catch {
		return [];
	}
	try {
		const stat = await handle.stat();
		// Read at most the last 256 KiB, then keep the tail: daemon logs can grow
		// without bound and `logs` must stay responsive.
		const maxBytes = 256 * 1024;
		const length = Math.min(stat.size, maxBytes);
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
		const lines = buffer.toString("utf8").split(/\r?\n/);
		if (lines.at(-1) === "") lines.pop();
		return lines.slice(-wanted);
	} finally {
		await handle.close().catch(() => {});
	}
}

// ---------------------------------------------------------------------------
// Autostart
// ---------------------------------------------------------------------------

/** One file an installer writes (Linux: service + timer; Windows: task XML). */
export interface AutostartFile {
	path: string;
	content: string;
}

/** A command exactly as the installer/uninstaller runs it (no shell parsing). */
export interface AutostartCommand {
	command: string;
	args: string[];
}

export interface AutostartPlan {
	platform: NodeJS.Platform;
	/** Bundled install form and a supported platform. */
	supported: boolean;
	installForm: InstallForm;
	/** Human-readable refusal/unsupported reason, when `supported` is false. */
	reason?: string;
	/** Every file the installer writes. */
	files: AutostartFile[];
	/** Primary OS artifact (Linux timer unit, Windows task XML), for display. */
	path: string | null;
	content: string | null;
	/** Commands the user can run by hand to remove the component. */
	undo: string | null;
	/** Commands the installer runs to activate the component. */
	activate: AutostartCommand[];
	/** Commands the uninstaller runs to disable and remove it. */
	disable: AutostartCommand[];
	notes: string[];
}

export interface AutostartPlanOptions {
	platform?: NodeJS.Platform;
	execPath?: string;
	argv?: readonly string[];
	compiled?: boolean;
	exists?: (file: string) => boolean;
	homeDir?: string;
	env?: NodeJS.ProcessEnv;
	ports?: Partial<DaemonPorts>;
	logPath?: string;
	/** Extra `serve` flags to bake into the entry (host/TLS/channels). */
	serveFlags?: readonly string[];
	/** Install form; defaults to {@link detectInstallForm}. */
	installForm?: InstallForm;
}

/** The only form allowed to write an OS autostart component. */
export function autostartRefusalMessage(): string {
	return [
		"Autostart is only supported for the bundled Zeta desktop app (the compiled",
		"zetacode binary). This is the npm/source install form, so `daemon",
		"install-autostart` wrote nothing. Install the bundled app, then run it again.",
	].join(" ");
}

function systemdQuote(value: string): string {
	if (/^[A-Za-z0-9_./:@%+-]+$/.test(value)) return value;
	return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

function autostartPorts(ports: Partial<DaemonPorts> | undefined): DaemonPorts {
	return {
		webPort: ports?.webPort ?? DAEMON_DEFAULT_WEB_PORT,
		statsPort: ports?.statsPort ?? DAEMON_DEFAULT_STATS_PORT,
		gatewayPort: ports?.gatewayPort ?? DAEMON_DEFAULT_GATEWAY_PORT,
	};
}

function serveFlagArgs(ports: DaemonPorts, extra: readonly string[] | undefined): string[] {
	return [
		"serve",
		"--no-browser",
		"--stats-port",
		String(ports.statsPort),
		"--web-port",
		String(ports.webPort),
		"--gateway-port",
		String(ports.gatewayPort),
		...(extra ?? []),
	];
}

function xmlEscape(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** A single-quoted PowerShell literal; `'` is doubled, never interpolated. */
function psLiteral(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/** Unit names are part of the public surface (`systemctl --user list-timers`). */
export const LINUX_AUTOSTART_SERVICE = "zetacode-daemon.service";
export const LINUX_AUTOSTART_TIMER = "zetacode-daemon.timer";
/** Visible by this name in Task Scheduler / `schtasks /Query`. */
export const WINDOWS_AUTOSTART_TASK = "Zeta Backend Autostart";
/** The delay lives in the unit/task, never in a sleep inside the backend. */
export const AUTOSTART_DELAY_MINUTES = 3;

/**
 * Pure description of the OS autostart component. Nothing here touches the
 * filesystem or runs a command, so every platform's text is testable in CI.
 *
 * The Linux component is a user service plus a timer that fires it three
 * minutes after boot (`OnBootSec`) or login (`OnStartupSec`). The service runs
 * `serve` in the foreground and checks the global setting with
 * `ExecCondition`, so the OS owns the process (SIGTERM reaches it). Windows is
 * a Task Scheduler task with a three-minute logon delay, registered for the
 * current user with `LeastPrivilege`; it runs `serve --autostart`.
 */
export function planAutostart(options: AutostartPlanOptions = {}): AutostartPlan {
	const platform = options.platform ?? process.platform;
	const installForm = options.installForm ?? detectInstallForm();
	const homeDir = options.homeDir ?? os.homedir();
	const env = options.env ?? process.env;
	const ports = autostartPorts(options.ports);
	const logPath = options.logPath ?? path.join(getBaseConfigRoot(), "run", DAEMON_LOG_FILENAME);
	const invocation =
		options.execPath !== undefined
			? [options.execPath, ...(options.argv ?? [])]
			: resolveCliInvocation({ exists: options.exists, argv: options.argv });
	const args = serveFlagArgs(ports, options.serveFlags);
	const bundled = installForm === "bundled";

	if (platform === "linux") {
		const configHome = env.XDG_CONFIG_HOME?.trim() || path.posix.join(homeDir, ".config");
		const unitDir = path.posix.join(configHome, "systemd", "user");
		const servicePath = path.posix.join(unitDir, LINUX_AUTOSTART_SERVICE);
		const timerPath = path.posix.join(unitDir, LINUX_AUTOSTART_TIMER);
		const execStart = [...invocation, ...args].map(systemdQuote).join(" ");
		const execCondition = [...invocation, "daemon", "autostart-enabled"].map(systemdQuote).join(" ");
		const service = [
			"# Installed by `zetacode daemon install-autostart`.",
			"# Undo: `zetacode daemon uninstall-autostart`.",
			"[Unit]",
			`Description=Zeta background backend (${CLI_BIN_NAME} serve)`,
			`Documentation=man:${CLI_BIN_NAME}(1)`,
			"After=network-online.target",
			"Wants=network-online.target",
			"",
			"[Service]",
			"Type=exec",
			"WorkingDirectory=%h",
			// The global `backend.autostart` setting is the decision. A failed
			// condition skips the unit cleanly instead of starting a backend the
			// user turned off.
			`ExecCondition=${execCondition}`,
			`ExecStart=${execStart}`,
			// Respect an OS stop/kill: the backend never respawns itself.
			"Restart=no",
			"KillMode=control-group",
			"TimeoutStopSec=20",
			`StandardOutput=append:${logPath}`,
			`StandardError=append:${logPath}`,
			"",
		].join("\n");
		const timer = [
			"# Installed by `zetacode daemon install-autostart`.",
			"# Undo: `zetacode daemon uninstall-autostart`.",
			"[Unit]",
			`Description=Start the Zeta background backend ${AUTOSTART_DELAY_MINUTES} minutes after boot/login`,
			"",
			"[Timer]",
			`OnBootSec=${AUTOSTART_DELAY_MINUTES}min`,
			`OnStartupSec=${AUTOSTART_DELAY_MINUTES}min`,
			`Unit=${LINUX_AUTOSTART_SERVICE}`,
			"Persistent=false",
			"",
			"[Install]",
			"WantedBy=timers.target",
			"",
		].join("\n");
		return {
			platform,
			installForm,
			supported: bundled,
			reason: bundled ? undefined : autostartRefusalMessage(),
			files: [
				{ path: servicePath, content: service },
				{ path: timerPath, content: timer },
			],
			path: timerPath,
			content: timer,
			undo: [
				`systemctl --user disable --now ${LINUX_AUTOSTART_TIMER}`,
				`systemctl --user stop ${LINUX_AUTOSTART_SERVICE}`,
				`rm -f ${systemdQuote(servicePath)} ${systemdQuote(timerPath)}`,
				"systemctl --user daemon-reload",
			].join("\n"),
			activate: [
				{ command: "systemctl", args: ["--user", "daemon-reload"] },
				{ command: "systemctl", args: ["--user", "enable", "--now", LINUX_AUTOSTART_TIMER] },
			],
			disable: [
				{ command: "systemctl", args: ["--user", "disable", "--now", LINUX_AUTOSTART_TIMER] },
				{ command: "systemctl", args: ["--user", "stop", LINUX_AUTOSTART_SERVICE] },
				{ command: "systemctl", args: ["--user", "daemon-reload"] },
			],
			notes: [
				`Units: ${LINUX_AUTOSTART_TIMER} + ${LINUX_AUTOSTART_SERVICE}; inspect with \`systemctl --user list-timers\` and \`systemctl --user status ${LINUX_AUTOSTART_SERVICE}\`.`,
				"Boot-time start (before anyone logs in) also needs lingering: `loginctl enable-linger $USER` (a privileged, one-time change). Without it the timer fires three minutes after login.",
				`Logs: ${logPath} (the unit appends stdout/stderr there)`,
			],
		};
	}

	if (platform === "win32") {
		const localAppData = env.LOCALAPPDATA?.trim() || path.win32.join(homeDir, "AppData", "Local");
		const xmlPath = path.win32.join(localAppData, "Zeta", "autostart", "zetacode-backend.xml");
		const userName = env.USERDOMAIN && env.USERNAME ? `${env.USERDOMAIN}\\${env.USERNAME}` : (env.USERNAME ?? "");
		const workingDirectory = env.USERPROFILE?.trim() || homeDir;
		const commandLine = [...invocation.slice(1), ...args, "--autostart"];
		const xml = [
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
			"\t<RegistrationInfo>",
			"\t\t<Description>Zeta background backend (zetacode serve), three minutes after sign-in</Description>",
			`\t\t<URI>\\${xmlEscape(WINDOWS_AUTOSTART_TASK)}</URI>`,
			"\t</RegistrationInfo>",
			"\t<Triggers>",
			"\t\t<LogonTrigger>",
			"\t\t\t<Enabled>true</Enabled>",
			...(userName ? [`\t\t\t<UserId>${xmlEscape(userName)}</UserId>`] : []),
			`\t\t\t<Delay>PT${AUTOSTART_DELAY_MINUTES}M</Delay>`,
			"\t\t</LogonTrigger>",
			"\t</Triggers>",
			"\t<Principals>",
			'\t\t<Principal id="Author">',
			...(userName ? [`\t\t\t<UserId>${xmlEscape(userName)}</UserId>`] : []),
			"\t\t\t<LogonType>InteractiveToken</LogonType>",
			"\t\t\t<RunLevel>LeastPrivilege</RunLevel>",
			"\t\t</Principal>",
			"\t</Principals>",
			"\t<Settings>",
			"\t\t<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
			"\t\t<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
			"\t\t<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
			"\t\t<AllowHardTerminate>true</AllowHardTerminate>",
			"\t\t<StartWhenAvailable>false</StartWhenAvailable>",
			"\t\t<RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>",
			"\t\t<IdleSettings>",
			"\t\t\t<StopOnIdleEnd>false</StopOnIdleEnd>",
			"\t\t\t<RestartOnIdle>false</RestartOnIdle>",
			"\t\t</IdleSettings>",
			"\t\t<AllowStartOnDemand>true</AllowStartOnDemand>",
			"\t\t<Enabled>true</Enabled>",
			"\t\t<Hidden>false</Hidden>",
			"\t\t<RunOnlyIfIdle>false</RunOnlyIfIdle>",
			"\t\t<WakeToRun>false</WakeToRun>",
			"\t\t<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
			"\t\t<Priority>7</Priority>",
			"\t</Settings>",
			'\t<Actions Context="Author">',
			"\t\t<Exec>",
			`\t\t\t<Command>${xmlEscape(invocation[0] as string)}</Command>`,
			`\t\t\t<Arguments>${xmlEscape(commandLine.join(" "))}</Arguments>`,
			`\t\t\t<WorkingDirectory>${xmlEscape(workingDirectory)}</WorkingDirectory>`,
			"\t\t</Exec>",
			"\t</Actions>",
			"</Task>",
			"",
		].join("\r\n");
		return {
			platform,
			installForm,
			supported: bundled,
			reason: bundled ? undefined : autostartRefusalMessage(),
			files: [{ path: xmlPath, content: xml }],
			path: xmlPath,
			content: xml,
			undo: `Unregister-ScheduledTask -TaskName ${psLiteral(WINDOWS_AUTOSTART_TASK)} -Confirm:$false\ndel "${xmlPath}"`,
			activate: [
				{
					// `schtasks /Create /SC ONLOGON` demands elevation; registering
					// the XML through the Task Scheduler API creates a task that runs
					// as the current user without it.
					command: "powershell",
					args: [
						"-NoProfile",
						"-NonInteractive",
						"-Command",
						`Register-ScheduledTask -TaskName ${psLiteral(WINDOWS_AUTOSTART_TASK)} -Xml (Get-Content -LiteralPath ${psLiteral(xmlPath)} -Raw) -Force | Out-Null`,
					],
				},
			],
			disable: [
				{
					command: "powershell",
					args: [
						"-NoProfile",
						"-NonInteractive",
						"-Command",
						`Unregister-ScheduledTask -TaskName ${psLiteral(WINDOWS_AUTOSTART_TASK)} -Confirm:$false`,
					],
				},
			],
			notes: [
				`Visible in Task Scheduler as "${WINDOWS_AUTOSTART_TASK}" (Task Scheduler Library, current user). No elevation is required.`,
				`The task starts ${CLI_BIN_NAME} three minutes after sign-in without a stored password. Disable/End it in Task Scheduler, or run \`schtasks /Change /TN "${WINDOWS_AUTOSTART_TASK}" /DISABLE\`.`,
			],
		};
	}

	return {
		platform,
		installForm,
		supported: false,
		reason:
			"macOS autostart is not supported. Run `zetacode daemon start` at login, or add a launchd agent yourself.",
		files: [],
		path: null,
		content: null,
		undo: null,
		activate: [],
		disable: [],
		notes: [
			"macOS autostart is not supported. Run `zetacode daemon start` at login, or add a launchd agent yourself.",
		],
	};
}

export interface AutostartCommandResult {
	ok: boolean;
	status: number;
	stdout: string;
	stderr: string;
}

/** Runs an OS command; injectable so tests never touch the real scheduler. */
export type AutostartRunner = (command: string, args: readonly string[]) => AutostartCommandResult;

function runAutostartCommand(command: string, args: readonly string[]): AutostartCommandResult {
	const result = spawnSync(command, [...args], {
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
		encoding: "utf8",
		timeout: 15_000,
	});
	return {
		ok: !result.error && result.status === 0,
		status: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? (result.error ? String(result.error.message) : ""),
	};
}

export interface AutostartInstallResult {
	plan: AutostartPlan;
	/** False when every file was already exactly what we would write. */
	written: boolean;
	/** True when the install form forbade writing anything. */
	refused: boolean;
	message?: string;
	activation: Array<{ command: string; ok: boolean }>;
}

export interface AutostartOptions extends AutostartPlanOptions {
	plan?: AutostartPlan;
	/** Injectable command runner for activation (systemctl/schtasks). */
	run?: AutostartRunner;
}

function runCommands(
	commands: readonly AutostartCommand[],
	run: AutostartRunner,
): Array<{ command: string; ok: boolean }> {
	return commands.map(entry => {
		const result = run(entry.command, entry.args);
		// The disabled label still names every argument the user could run.
		return { command: [entry.command, ...entry.args].join(" "), ok: result.ok };
	});
}

/**
 * Write every file of the component. Idempotent: identical files are left
 * untouched (`written: false`), but activation commands still run.
 *
 * An npm/source install is refused here as well as in the CLI, so a caller
 * that forgets the check still writes nothing.
 */
export async function installAutostart(options: AutostartOptions = {}): Promise<AutostartInstallResult> {
	const plan = options.plan ?? planAutostart(options);
	if (plan.installForm !== "bundled") {
		return { plan, written: false, refused: true, message: autostartRefusalMessage(), activation: [] };
	}
	if (!plan.supported || plan.files.length === 0) {
		return {
			plan,
			written: false,
			refused: false,
			message: plan.reason,
			activation: [],
		};
	}
	const run = options.run ?? runAutostartCommand;
	let written = false;
	for (const file of plan.files) {
		const dirname = plan.platform === "win32" ? path.win32.dirname(file.path) : path.posix.dirname(file.path);
		await fs.mkdir(dirname, { recursive: true, mode: 0o700 });
		const existing = await fs.readFile(file.path, "utf8").catch(() => null);
		if (existing === file.content) continue;
		await fs.writeFile(file.path, file.content, { encoding: "utf8", mode: 0o644 });
		written = true;
	}
	const activation = runCommands(plan.activate, run);
	return { plan, written, refused: false, activation };
}

export interface AutostartUninstallResult {
	plan: AutostartPlan;
	removed: boolean;
	deactivation: Array<{ command: string; ok: boolean }>;
}

/**
 * Disable the OS component, remove every file, and leave no enabled unit/task
 * behind. It does not touch a backend the daemon did not start this way —
 * `daemon stop` remains the explicit stop.
 */
export async function uninstallAutostart(options: AutostartOptions = {}): Promise<AutostartUninstallResult> {
	const plan = options.plan ?? planAutostart(options);
	const run = options.run ?? runAutostartCommand;
	const deactivation = runCommands(plan.disable, run);
	let removed = false;
	for (const file of plan.files) {
		const existed = await fs.stat(file.path).then(
			() => true,
			() => false,
		);
		if (!existed) continue;
		await fs.rm(file.path, { force: true }).catch(() => {});
		removed = true;
	}
	return { plan, removed, deactivation };
}

export interface InspectAutostartOptions {
	platform?: NodeJS.Platform;
	runner?: AutostartRunner;
	/** Injectable global setting; when omitted the global config is read. */
	setting?: boolean;
	installForm?: InstallForm;
	homeDir?: string;
	env?: NodeJS.ProcessEnv;
	ports?: Partial<DaemonPorts>;
}

function parseSystemdShow(stdout: string): Map<string, Record<string, string>> {
	const units = new Map<string, Record<string, string>>();
	let current: Record<string, string> | null = null;
	for (const rawLine of stdout.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "") {
			if (current && current.Id) units.set(current.Id, current);
			current = null;
			continue;
		}
		const index = line.indexOf("=");
		if (index <= 0) continue;
		const key = line.slice(0, index);
		if (key === "Id" && current?.Id) {
			units.set(current.Id, current);
			current = {};
		}
		current ??= {};
		current[key] = line.slice(index + 1);
	}
	if (current && current.Id) units.set(current.Id, current);
	return units;
}

function firstLine(text: string): string {
	const line = text.split(/\r?\n/).find(value => value.trim() !== "");
	return line?.trim() ?? "";
}

/**
 * Ask the OS whether the component is installed, enabled and active. This is
 * deliberately not derived from `daemon.json`: the clock in our own pid file
 * cannot know that the user disabled the timer or ended the task.
 */
export async function inspectAutostartStatus(options: InspectAutostartOptions = {}): Promise<DaemonAutostartStatus> {
	const platform = options.platform ?? process.platform;
	const installForm = options.installForm ?? detectInstallForm();
	const plan = planAutostart({
		platform,
		installForm,
		homeDir: options.homeDir,
		env: options.env,
		ports: options.ports,
	});
	const setting = options.setting ?? (await readBackendAutostartSetting().catch(() => false));
	const runner = options.runner ?? runAutostartCommand;
	const base: DaemonAutostartStatus = {
		platform,
		supported: plan.supported,
		installed: false,
		enabled: false,
		active: false,
		path: plan.path,
		setting,
		installForm,
		...(plan.reason ? { reason: plan.reason } : {}),
	};

	if (platform === "linux") {
		// The npm form cannot own a component; do not fork a shell just to be
		// told so. `daemon uninstall-autostart` still removes stale files.
		if (installForm !== "bundled") return base;
		const result = runner("systemctl", [
			"--user",
			"show",
			LINUX_AUTOSTART_TIMER,
			LINUX_AUTOSTART_SERVICE,
			"--property=Id,LoadState,UnitFileState,ActiveState",
			"--no-pager",
		]);
		if (!result.ok && result.stdout.trim() === "") {
			return {
				...base,
				reason: firstLine(result.stderr) || "systemctl --user is unavailable",
			};
		}
		const units = parseSystemdShow(result.stdout);
		const timer = units.get(LINUX_AUTOSTART_TIMER);
		const service = units.get(LINUX_AUTOSTART_SERVICE);
		const installed = timer?.LoadState === "loaded" || service?.LoadState === "loaded";
		const enabled = /^enabled/.test(timer?.UnitFileState ?? "");
		const active = service?.ActiveState === "active" || service?.ActiveState === "reloading";
		return {
			...base,
			installed,
			enabled,
			active,
			...(installed || base.reason ? {} : { reason: "systemd does not know zetacode-daemon.timer" }),
		};
	}

	if (platform === "win32") {
		if (installForm !== "bundled") return base;
		const script = [
			`$n='${WINDOWS_AUTOSTART_TASK}';`,
			`$t=Get-ScheduledTask -TaskName $n -ErrorAction Stop;`,
			`[pscustomobject]@{installed=$true;enabled=[bool]$t.Settings.Enabled;state=[string]$t.State}|ConvertTo-Json -Compress`,
		].join(" ");
		const result = runner("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
		if (!result.ok) {
			return {
				...base,
				reason: firstLine(result.stderr) || "Task Scheduler does not know the task",
			};
		}
		try {
			const parsed = JSON.parse(firstLine(result.stdout)) as {
				enabled?: unknown;
				state?: unknown;
			};
			return {
				...base,
				installed: true,
				enabled: parsed.enabled === true,
				active: parsed.state === "Running",
			};
		} catch {
			return { ...base, reason: "could not parse the Task Scheduler response" };
		}
	}

	return base;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const ACTIONS = [
	"status",
	"start",
	"stop",
	"restart",
	"logs",
	"install-autostart",
	"uninstall-autostart",
	"autostart-enabled",
] as const;
type DaemonAction = (typeof ACTIONS)[number];

function isDaemonAction(value: string): value is DaemonAction {
	return ACTIONS.includes(value as DaemonAction);
}

function writeJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printStatus(status: DaemonStatus): void {
	if (status.running) {
		console.log(chalk.green(`Daemon running (pid ${status.pid})`));
		if (status.webUrl) console.log(`  Web UI:       ${status.webUrl}`);
		if (status.statsUrl) console.log(`  Stats:        ${status.statsUrl}`);
		if (status.gatewayUrl) console.log(`  Web Gateway:  ${status.gatewayUrl}`);
		if (status.startedAt) console.log(chalk.dim(`  Started:      ${status.startedAt}`));
		console.log(chalk.dim(`  Source:       ${status.source}`));
	} else if (status.stale) {
		console.log(chalk.yellow(`Stale daemon state (pid ${status.pid} is not running).`));
		console.log(chalk.dim(`  Run \`${CLI_BIN_NAME} daemon stop\` to clean it up.`));
	} else {
		console.log(chalk.dim("Daemon is not running."));
	}
	console.log(chalk.dim(`  Log:          ${status.logPath}`));
	const autostart = status.autostart;
	if (autostart.supported || autostart.installed) {
		const installed = autostart.installed ? "installed" : "not installed";
		const enabled = autostart.enabled ? "enabled" : "disabled";
		const active = autostart.active ? "running" : "stopped";
		console.log(
			chalk.dim(
				`  Autostart:    ${installed}, ${enabled}, ${active}; setting ${autostart.setting ? "on" : "off"} (${autostart.path})`,
			),
		);
	} else if (autostart.installForm === "npm") {
		console.log(chalk.dim("  Autostart:    unavailable in the npm/source install form (bundled app only)"));
	} else {
		console.log(chalk.dim("  Autostart:    unsupported on this platform"));
	}
	if (autostart.reason && autostart.supported) console.log(chalk.dim(`                ${autostart.reason}`));
}

function printStart(result: DaemonStartResult): void {
	if (result.action === "already-running") {
		console.log(
			chalk.dim(
				`Daemon already running (pid ${result.status.pid}${result.status.port ? `, port ${result.status.port}` : ""}); nothing to do.`,
			),
		);
		return;
	}
	if (result.action === "failed") {
		process.stderr.write(chalk.red(`${result.message ?? "Failed to start the daemon."}\n`));
		return;
	}
	if (result.cleanedStale) console.log(chalk.dim("Removed a stale daemon record."));
	console.log(chalk.green(`Started the background backend (pid ${result.status.pid}).`));
	printStatus(result.status);
	if (result.message) console.log(chalk.dim(`  ${result.message}`));
}

function printStop(result: DaemonStopResult): void {
	if (result.action === "stopped") console.log(chalk.green(`Stopped the daemon (pid ${result.pid}).`));
	else if (result.action === "cleaned-stale")
		console.log(chalk.dim("Removed stale daemon state; nothing was running."));
	else if (result.action === "not-running") console.log(chalk.dim("Daemon is not running."));
	else process.stderr.write(chalk.red(`${result.message ?? "Failed to stop the daemon."}\n`));
}

function printAutostartInstall(result: AutostartInstallResult): void {
	const { plan } = result;
	if (result.refused) {
		process.stderr.write(chalk.red(`${result.message ?? autostartRefusalMessage()}\n`));
		return;
	}
	if (!plan.supported) {
		process.stderr.write(chalk.yellow(`${plan.reason ?? plan.notes.join("\n")}\n`));
		return;
	}
	if (!result.written) console.log(chalk.dim("Autostart component was already up to date."));
	for (const file of plan.files) {
		console.log(result.written ? chalk.green(`Wrote ${file.path}`) : chalk.dim(`${file.path} (unchanged)`));
		console.log(chalk.dim("\n--- file content ---"));
		process.stdout.write(`${file.content}\n`);
		console.log(chalk.dim("--- end ---\n"));
	}
	for (const activation of result.activation) {
		console.log(
			activation.ok ? chalk.dim(`$ ${activation.command}`) : chalk.yellow(`$ ${activation.command} (failed)`),
		);
	}
	if (plan.undo) console.log(chalk.dim(`\nUndo:\n${plan.undo}`));
	for (const note of plan.notes) console.log(chalk.dim(`\n${note}`));
	console.log(chalk.dim("\nbackend.autostart was set to true in the global user config."));
}

function printAutostartUninstall(result: AutostartUninstallResult): void {
	const { plan } = result;
	if (!plan.supported && plan.installForm !== "bundled" && plan.files.length === 0) {
		process.stderr.write(chalk.yellow(`${plan.reason ?? plan.notes.join("\n")}\n`));
		return;
	}
	for (const command of result.deactivation) {
		console.log(command.ok ? chalk.dim(`$ ${command.command}`) : chalk.yellow(`$ ${command.command} (failed)`));
	}
	if (result.removed) {
		for (const file of plan.files) console.log(chalk.green(`Removed ${file.path}`));
	} else {
		console.log(chalk.dim("The autostart component was not installed."));
	}
	console.log(chalk.dim("backend.autostart was set to false in the global user config."));
}

export default class Daemon extends Command {
	static description = daemonHelp.description;

	static args = {
		action: Args.string({
			description:
				"status (default), start, stop, restart, logs, install-autostart, uninstall-autostart, or autostart-enabled",
			required: false,
			options: ACTIONS,
		}),
	};

	static flags = {
		json: Flags.boolean({ description: "Machine-readable JSON on stdout" }),
		"web-port": Flags.integer({ description: `Web UI port (default ${DAEMON_DEFAULT_WEB_PORT})` }),
		"stats-port": Flags.integer({ description: `Stats Dashboard port (default ${DAEMON_DEFAULT_STATS_PORT})` }),
		"gateway-port": Flags.integer({ description: `Web Gateway port (default ${DAEMON_DEFAULT_GATEWAY_PORT})` }),
		host: Flags.string({
			description: "Public bind hostname (non-loopback requires remote.token + TLS or --allow-plain-http)",
		}),
		tls: Flags.boolean({ description: "Force the built-in TLS listener (requires --tls-cert and --tls-key)" }),
		"tls-cert": Flags.string({ description: "PEM certificate chain for the built-in TLS listener" }),
		"tls-key": Flags.string({ description: "PEM private key for the built-in TLS listener" }),
		"allow-plain-http": Flags.boolean({
			description: "Allow a plaintext non-loopback bind (default: refused)",
		}),
		channels: Flags.boolean({ description: "Start IM channels in the background backend" }),
		timeout: Flags.integer({ description: "Seconds to wait before a hard kill (stop/restart; default 10)" }),
		lines: Flags.integer({ description: "Log lines to print (logs; default 80, max 1000)" }),
		follow: Flags.boolean({ description: "Keep streaming new log lines (logs)" }),
	};

	static examples = [
		`# Is the background backend running, and on which port?\n  ${CLI_BIN_NAME} daemon status --json`,
		`# Start it detached; repeat calls are no-ops\n  ${CLI_BIN_NAME} daemon start`,
		`# Tail the backend log\n  ${CLI_BIN_NAME} daemon logs --follow`,
		`# Install a per-user OS autostart component (bundled app only; prints every file)\n  ${CLI_BIN_NAME} daemon install-autostart`,
	];

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Daemon);
		const action = args.action ?? "status";
		if (!isDaemonAction(action)) throw new CliUsageError(`Unknown action: ${action}`);

		const paths = resolveDaemonPaths();
		const ports: DaemonPorts = {
			webPort: flags["web-port"] ?? DAEMON_DEFAULT_WEB_PORT,
			statsPort: flags["stats-port"] ?? DAEMON_DEFAULT_STATS_PORT,
			gatewayPort: flags["gateway-port"] ?? DAEMON_DEFAULT_GATEWAY_PORT,
		};

		switch (action) {
			case "status": {
				const status = await daemonStatus({ paths });
				if (flags.json) writeJson(status);
				else printStatus(status);
				return;
			}
			case "start":
			case "restart": {
				if (action === "start") {
					// Idempotency comes before configuration: an already-running
					// backend is reported even if the current config would be refused.
					const existing = await daemonStatus({ paths });
					if (existing.running) {
						const already: DaemonStartResult = {
							action: "already-running",
							status: existing,
							spawned: false,
							cleanedStale: false,
							exitCode: 0,
						};
						if (flags.json) writeJson(already);
						else printStart(already);
						return;
					}
				}
				const webConfig = await WebConfig.load();
				const access = resolveServeAccess({
					flags: {
						host: flags.host,
						tls: flags.tls,
						tlsCert: flags["tls-cert"],
						tlsKey: flags["tls-key"],
						allowPlainHttp: flags["allow-plain-http"],
					},
					config: webConfig.getData(),
					env: process.env,
				});
				if (!access.ok) {
					process.stderr.write(chalk.red(`Refusing to start: ${access.error}\n`));
					process.exitCode = 1;
					return;
				}
				for (const warning of access.warnings) {
					process.stderr.write(chalk.yellow(`Warning: ${warning}\n`));
				}
				const startOptions: DaemonStartOptions & DaemonStopOptions = {
					paths,
					...ports,
					access: access.access,
					cwd: process.cwd(),
					host: flags.host,
					tls: flags.tls,
					tlsCert: flags["tls-cert"],
					tlsKey: flags["tls-key"],
					allowPlainHttp: flags["allow-plain-http"],
					channels: flags.channels,
					timeoutSeconds: flags.timeout,
				};
				if (action === "restart") {
					const result = await restartDaemon(startOptions);
					if (flags.json) {
						writeJson(result);
					} else {
						printStop(result.stop);
						printStart(result.start);
					}
					process.exitCode = Math.max(result.stop.exitCode, result.start.exitCode);
					return;
				}
				const result = await startDaemon(startOptions);
				if (flags.json) writeJson(result);
				else printStart(result);
				process.exitCode = result.exitCode;
				return;
			}
			case "stop": {
				const result = await stopDaemon({ paths, timeoutSeconds: flags.timeout });
				if (flags.json) writeJson(result);
				else printStop(result);
				process.exitCode = result.exitCode;
				return;
			}
			case "logs": {
				const lines = await readDaemonLogTail(paths.log, flags.lines ?? 80);
				if (flags.json) {
					writeJson({ path: paths.log, lines });
					return;
				}
				if (lines.length === 0) {
					console.log(chalk.dim(`No daemon log at ${paths.log} yet; start the daemon first.`));
				} else {
					for (const line of lines) console.log(line);
				}
				if (flags.follow) await followLog(paths.log);
				return;
			}
			case "install-autostart": {
				const installForm = detectInstallForm();
				const plan = planAutostart({
					ports,
					serveFlags: daemonServeFlags(flags),
					installForm,
				});
				// Refuse before writing anything: no unit, no task, no setting.
				if (installForm !== "bundled") {
					const refused: AutostartInstallResult = {
						plan,
						written: false,
						refused: true,
						message: autostartRefusalMessage(),
						activation: [],
					};
					if (flags.json) writeJson(refused);
					else printAutostartInstall(refused);
					process.exitCode = 1;
					return;
				}
				const result = await installAutostart({ plan });
				if (!result.refused && result.plan.supported) {
					try {
						await writeBackendAutostartSetting(true);
					} catch (error) {
						process.stderr.write(
							chalk.yellow(
								`Warning: the component was installed but backend.autostart could not be written: ${
									error instanceof Error ? error.message : String(error)
								}\n`,
							),
						);
					}
				}
				if (flags.json) writeJson(result);
				else printAutostartInstall(result);
				process.exitCode = result.refused || !result.plan.supported ? 1 : 0;
				return;
			}
			case "uninstall-autostart": {
				const plan = planAutostart({ ports, installForm: detectInstallForm() });
				const result = await uninstallAutostart({ plan });
				if (plan.platform === "linux" || plan.platform === "win32") {
					try {
						await writeBackendAutostartSetting(false);
					} catch (error) {
						process.stderr.write(
							chalk.yellow(
								`Warning: the component was removed but backend.autostart could not be written: ${
									error instanceof Error ? error.message : String(error)
								}\n`,
							),
						);
					}
				}
				if (flags.json) writeJson(result);
				else printAutostartUninstall(result);
				process.exitCode = plan.platform === "linux" || plan.platform === "win32" ? 0 : 1;
				return;
			}
			case "autostart-enabled": {
				// systemd `ExecCondition` entry point: 0 only when the global
				// setting says the OS component may start the backend.
				const enabled = await readBackendAutostartSetting().catch(() => false);
				if (flags.json) writeJson({ enabled });
				else if (!enabled) console.log(chalk.dim("backend.autostart is off; skipping the background backend."));
				process.exitCode = enabled ? 0 : 1;
				return;
			}
		}
	}
}

function daemonServeFlags(flags: {
	host?: string;
	tls?: boolean;
	"tls-cert"?: string;
	"tls-key"?: string;
	"allow-plain-http"?: boolean;
	channels?: boolean;
}): string[] {
	const extra: string[] = [];
	if (flags.host) extra.push("--host", flags.host);
	if (flags.tls) extra.push("--tls");
	if (flags["tls-cert"]) extra.push("--tls-cert", flags["tls-cert"]);
	if (flags["tls-key"]) extra.push("--tls-key", flags["tls-key"]);
	if (flags["allow-plain-http"]) extra.push("--allow-plain-http");
	if (flags.channels) extra.push("--channels");
	return extra;
}

/** Append new log lines as they appear; Ctrl+C ends it. */
async function followLog(logPath: string): Promise<void> {
	let position = (await fs.stat(logPath).catch(() => null))?.size ?? 0;
	const stop = Promise.withResolvers<void>();
	const onSignal = () => stop.resolve();
	process.once("SIGINT", onSignal);
	process.once("SIGTERM", onSignal);
	try {
		while (true) {
			const settled = await Promise.race([stop.promise.then(() => true), Bun.sleep(500).then(() => false)]);
			if (settled) return;
			const stat = await fs.stat(logPath).catch(() => null);
			if (!stat || stat.size <= position) {
				if (stat && stat.size < position) position = 0;
				continue;
			}
			const length = stat.size - position;
			const buffer = Buffer.alloc(length);
			const handle = await fs.open(logPath, "r").catch(() => null);
			if (!handle) continue;
			try {
				await handle.read(buffer, 0, length, position);
				process.stdout.write(buffer.toString("utf8"));
				position = stat.size;
			} finally {
				await handle.close().catch(() => {});
			}
		}
	} finally {
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
	}
}
