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
 * Autostart installers write a per-user logon entry (systemd user unit on
 * Linux, Startup-folder script on Windows). They never install silently: the
 * caller prints the exact file and its content, plus the command that removes
 * it. macOS is reported as unsupported.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import chalk from "@linxiraos/pi-utils/chalk";
import { Args, CliUsageError, Command, Flags } from "@linxiraos/pi-utils/cli";
import { CLI_BIN_NAME, getBaseConfigRoot, isCompiledBinary, VERSION } from "@linxiraos/pi-utils";
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

export const DAEMON_DEFAULT_WEB_PORT = 30141;
export const DAEMON_DEFAULT_STATS_PORT = 3847;
export const DAEMON_DEFAULT_GATEWAY_PORT = 30142;

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
	supported: boolean;
	installed: boolean;
	path: string | null;
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

function autostartPlanForStatus(platform: NodeJS.Platform): DaemonAutostartStatus {
	const plan = planAutostart({ platform });
	return {
		platform,
		supported: plan.supported,
		installed: plan.path !== null && existsSync(plan.path),
		path: plan.path,
	};
}

export interface DaemonStatusOptions {
	paths?: DaemonPaths;
	runtime?: Partial<DaemonRuntime>;
	autostart?: DaemonAutostartStatus;
}

/**
 * Snapshot the backend without mutating anything. Precedence: our record (it
 * carries the ports), then the instance lock (record lost), then `serve.json`
 * (a foreground `serve` or an autostart-supervised backend).
 */
export async function daemonStatus(options: DaemonStatusOptions = {}): Promise<DaemonStatus> {
	const paths = options.paths ?? resolveDaemonPaths();
	const runtime = defaultRuntime(options.runtime);
	const state = await readDaemonState(paths.state);
	const lock = await readChannelLock(paths.lock, { isAlive: runtime.isAlive });
	const registry = runtime.readRegistry();
	const autostart = options.autostart ?? autostartPlanForStatus(runtime.platform);

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

export interface AutostartPlan {
	platform: NodeJS.Platform;
	supported: boolean;
	/** The file the installer writes, or null when the platform is unsupported. */
	path: string | null;
	content: string | null;
	/** Commands the user can run to remove the entry. */
	undo: string | null;
	/** Commands the installer may run to activate the entry. */
	activate: string[];
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
}

function systemdQuote(value: string): string {
	if (/^[A-Za-z0-9_./:@%+-]+$/.test(value)) return value;
	return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

function cmdQuote(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
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

/**
 * Pure description of the per-user logon entry. Nothing here touches the
 * filesystem, so every platform's installer text is testable in CI.
 */
export function planAutostart(options: AutostartPlanOptions = {}): AutostartPlan {
	const platform = options.platform ?? process.platform;
	const homeDir = options.homeDir ?? os.homedir();
	const env = options.env ?? process.env;
	const ports = autostartPorts(options.ports);
	const logPath = options.logPath ?? path.join(getBaseConfigRoot(), "run", DAEMON_LOG_FILENAME);
	const invocation =
		options.execPath !== undefined
			? [options.execPath, ...(options.argv ?? [])]
			: resolveCliInvocation({ exists: options.exists, argv: options.argv });
	const args = serveFlagArgs(ports, options.serveFlags);

	if (platform === "linux") {
		const configHome = env.XDG_CONFIG_HOME?.trim() || path.posix.join(homeDir, ".config");
		const unitPath = path.posix.join(configHome, "systemd", "user", "zetacode-daemon.service");
		const execStart = [...invocation, ...args].map(systemdQuote).join(" ");
		const content = [
			"# Installed by `zetacode daemon install-autostart`.",
			"# Undo: `zetacode daemon uninstall-autostart`.",
			"[Unit]",
			`Description=Zeta background backend (${CLI_BIN_NAME} serve)`,
			"After=network-online.target",
			"Wants=network-online.target",
			"",
			"[Service]",
			"Type=exec",
			"WorkingDirectory=%h",
			`ExecStart=${execStart}`,
			"Restart=on-failure",
			"RestartSec=5",
			`StandardOutput=append:${logPath}`,
			`StandardError=append:${logPath}`,
			"",
			"[Install]",
			"WantedBy=default.target",
			"",
		].join("\n");
		return {
			platform,
			supported: true,
			path: unitPath,
			content,
			undo: [
				"systemctl --user disable --now zetacode-daemon.service",
				`rm -f ${systemdQuote(unitPath)}`,
				"systemctl --user daemon-reload",
			].join("\n"),
			activate: ["systemctl --user daemon-reload", "systemctl --user enable --now zetacode-daemon.service"],
			notes: [`Logs go to the systemd journal: journalctl --user -u zetacode-daemon -f`],
		};
	}

	if (platform === "win32") {
		const appData = env.APPDATA?.trim() || path.win32.join(homeDir, "AppData", "Roaming");
		const scriptPath = path.win32.join(
			appData,
			"Microsoft",
			"Windows",
			"Start Menu",
			"Programs",
			"Startup",
			"zetacode-daemon.cmd",
		);
		const commandLine = [...invocation, ...args].map(cmdQuote).join(" ");
		const content = [
			"@echo off",
			"rem Installed by `zetacode daemon install-autostart`.",
			"rem Undo: `zetacode daemon uninstall-autostart` or delete this file.",
			`start "" /b ${commandLine} >> ${cmdQuote(logPath)} 2>&1`,
			"",
		].join("\r\n");
		return {
			platform,
			supported: true,
			path: scriptPath,
			content,
			undo: `del ${cmdQuote(scriptPath)}`,
			activate: [],
			notes: ["The entry runs at the next sign-in; start it now with `zetacode daemon start`."],
		};
	}

	return {
		platform,
		supported: false,
		path: null,
		content: null,
		undo: null,
		activate: [],
		notes: [
			"macOS autostart is not supported. Run `zetacode daemon start` at login, or add a launchd agent yourself.",
		],
	};
}

export interface AutostartInstallResult {
	plan: AutostartPlan;
	/** False when the entry was already exactly what we would write. */
	written: boolean;
	activation: Array<{ command: string; ok: boolean }>;
}

export interface AutostartOptions extends AutostartPlanOptions {
	plan?: AutostartPlan;
	/** Injectable command runner for activation (systemctl); tests record instead of executing. */
	run?: (command: string, args: string[]) => { ok: boolean };
}

function defaultRun(command: string, args: string[]): { ok: boolean } {
	const result = spawnSync(command, args, { windowsHide: true, stdio: "ignore", timeout: 15_000 });
	return { ok: !result.error && result.status === 0 };
}

/**
 * Write the autostart entry. Idempotent: an identical file is left untouched
 * (`written: false`), but activation commands still run.
 */
export async function installAutostart(options: AutostartOptions = {}): Promise<AutostartInstallResult> {
	const plan = options.plan ?? planAutostart(options);
	if (!plan.supported || !plan.path || plan.content === null) {
		return { plan, written: false, activation: [] };
	}
	const dirname = plan.platform === "win32" ? path.win32.dirname(plan.path) : path.posix.dirname(plan.path);
	await fs.mkdir(dirname, { recursive: true, mode: 0o700 });
	const existing = await fs.readFile(plan.path, "utf8").catch(() => null);
	const written = existing !== plan.content;
	if (written) await fs.writeFile(plan.path, plan.content, { encoding: "utf8", mode: 0o644 });
	const run = options.run ?? defaultRun;
	const activation = plan.activate.map(command => {
		const [binary, ...args] = command.split(" ");
		if (!binary) return { command, ok: false };
		return { command, ok: run(binary, args).ok };
	});
	return { plan, written, activation };
}

export interface AutostartUninstallResult {
	plan: AutostartPlan;
	removed: boolean;
	deactivation: Array<{ command: string; ok: boolean }>;
}

/** Remove the autostart entry (and deactivate it) without touching the daemon. */
export async function uninstallAutostart(options: AutostartOptions = {}): Promise<AutostartUninstallResult> {
	const plan = options.plan ?? planAutostart(options);
	const run = options.run ?? defaultRun;
	const deactivate =
		plan.platform === "linux"
			? ["systemctl --user disable --now zetacode-daemon.service", "systemctl --user daemon-reload"]
			: [];
	const deactivation = deactivate.map(command => {
		const [binary, ...args] = command.split(" ");
		if (!binary) return { command, ok: false };
		return { command, ok: run(binary, args).ok };
	});
	if (!plan.path) return { plan, removed: false, deactivation };
	const existed = await fs
		.rm(plan.path, { force: true })
		.then(() => true)
		.catch(() => false);
	return { plan, removed: existed, deactivation };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const ACTIONS = ["status", "start", "stop", "restart", "logs", "install-autostart", "uninstall-autostart"] as const;
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
	if (status.autostart.supported) {
		const state = status.autostart.installed ? "installed" : "not installed";
		console.log(chalk.dim(`  Autostart:    ${state} (${status.autostart.path})`));
	} else {
		console.log(chalk.dim("  Autostart:    unsupported on this platform"));
	}
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
	if (!plan.supported) {
		process.stderr.write(chalk.yellow(`${plan.notes.join("\n")}\n`));
		return;
	}
	console.log(result.written ? chalk.green(`Wrote ${plan.path}`) : chalk.dim(`${plan.path} was already up to date.`));
	console.log(chalk.dim("\n--- file content ---"));
	process.stdout.write(`${plan.content ?? ""}`);
	console.log(chalk.dim("--- end ---\n"));
	for (const activation of result.activation) {
		console.log(
			activation.ok ? chalk.dim(`$ ${activation.command}`) : chalk.yellow(`$ ${activation.command} (failed)`),
		);
	}
	if (plan.undo) console.log(chalk.dim(`\nUndo:\n${plan.undo}`));
	for (const note of plan.notes) console.log(chalk.dim(`\n${note}`));
}

function printAutostartUninstall(result: AutostartUninstallResult): void {
	const { plan } = result;
	if (!plan.supported) {
		process.stderr.write(chalk.yellow(`${plan.notes.join("\n")}\n`));
		return;
	}
	for (const command of result.deactivation) {
		console.log(command.ok ? chalk.dim(`$ ${command.command}`) : chalk.yellow(`$ ${command.command} (failed)`));
	}
	console.log(result.removed ? chalk.green(`Removed ${plan.path}`) : chalk.dim(`${plan.path} was not installed.`));
}

export default class Daemon extends Command {
	static description = daemonHelp.description;

	static args = {
		action: Args.string({
			description: "status (default), start, stop, restart, logs, install-autostart, or uninstall-autostart",
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
		`# Install a per-user login entry (prints the exact file)\n  ${CLI_BIN_NAME} daemon install-autostart`,
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
				const plan = planAutostart({
					ports,
					serveFlags: daemonServeFlags(flags),
				});
				const result = await installAutostart({ plan });
				if (flags.json) writeJson(result);
				else printAutostartInstall(result);
				process.exitCode = plan.supported ? 0 : 1;
				return;
			}
			case "uninstall-autostart": {
				const plan = planAutostart({ ports });
				const result = await uninstallAutostart({ plan });
				if (flags.json) writeJson(result);
				else printAutostartUninstall(result);
				process.exitCode = plan.supported ? 0 : 1;
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
