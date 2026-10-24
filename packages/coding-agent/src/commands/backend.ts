/**
 * `zetacode backend` — the machine-wide backend mode switch.
 *
 * This is deliberately a thin control surface over the existing daemon:
 * `on` starts the one hidden backend in the configured default workspace,
 * `off` disables new clients and drains active turns before stopping it.
 * A standalone launch never comes through here and never registers.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import chalk from "@linxiraos/pi-utils/chalk";
import { Args, Command, Flags } from "@linxiraos/pi-utils/cli";
import { backendHelp } from "../cli/command-help";
import { Settings } from "../config/settings";
import { defaultCoordinatorWorkspace } from "../default-workspace";
import { WebConfig } from "../config/web-config";
import {
	readBackendEnabledSetting,
	readBackendWorkspaceSetting,
	writeBackendEnabledSetting,
	writeBackendWorkspaceSetting,
} from "../backend/setting";
import { resolveServeAccess } from "../server/serve-access";
import { isPidAlive, listServeRegistrations } from "../server/serve-registry";
import {
	DAEMON_DEFAULT_GATEWAY_PORT,
	DAEMON_DEFAULT_STATS_PORT,
	DAEMON_DEFAULT_WEB_PORT,
	daemonStatus,
	readDaemonLogTail,
	startDaemon,
	stopDaemon,
	type DaemonStartResult,
	type DaemonStatus,
} from "./daemon";

const ACTIONS = ["status", "on", "off", "logs"] as const;
type BackendAction = (typeof ACTIONS)[number];

function isAction(value: string): value is BackendAction {
	return ACTIONS.includes(value as BackendAction);
}

function printStatus(
	enabled: boolean,
	workspace: string,
	status: DaemonStatus,
	runningSessions: string[],
	liveBackends: number,
	draining: boolean | null,
): void {
	console.log(enabled ? chalk.green("Backend mode: enabled") : chalk.dim("Backend mode: disabled"));
	console.log(`Default workspace: ${workspace || "(not set)"}`);
	if (status.running) {
		console.log(chalk.green(`Backend running (pid ${status.pid})`));
		if (status.webUrl) console.log(`  Web UI:       ${status.webUrl}`);
		if (status.gatewayUrl) console.log(`  Gateway:      ${status.gatewayUrl}`);
		if (status.startedAt) console.log(chalk.dim(`  Started:      ${status.startedAt}`));
		console.log(chalk.dim(`  Running:      ${runningSessions.length} session(s)`));
		if (draining === true) console.log(chalk.yellow("  Draining:     waiting for active turns"));
	} else if (status.stale) {
		console.log(chalk.yellow(`Stale backend record (pid ${status.pid} is not running).`));
	} else {
		console.log(chalk.dim("Backend is not running."));
	}
	console.log(chalk.dim(`  Log:          ${status.logPath}`));
	if (liveBackends > 1) {
		console.log(chalk.red(`Warning: ${liveBackends} live backends are registered; keep exactly one.`));
	}
}

function printStart(result: DaemonStartResult): void {
	if (result.action === "already-running") {
		console.log(chalk.dim(`Backend already running (pid ${result.status.pid}).`));
		return;
	}
	if (result.action === "failed") {
		process.stderr.write(chalk.red(`${result.message ?? "Failed to start the backend."}\n`));
		return;
	}
	console.log(chalk.green(`Started the hidden backend (pid ${result.status.pid}).`));
}

async function setDrainState(gatewayUrl: string, draining: boolean): Promise<void> {
	const response = await fetch(`${gatewayUrl.replace(/\/$/, "")}/api/server/drain`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ draining }),
		signal: AbortSignal.timeout(5_000),
	});
	if (!response.ok) throw new Error(`drain request failed: HTTP ${response.status}`);
}

async function drainState(gatewayUrl: string | null): Promise<boolean | null> {
	if (!gatewayUrl) return null;
	try {
		const response = await fetch(`${gatewayUrl.replace(/\/$/, "")}/api/server/drain`, {
			signal: AbortSignal.timeout(3_000),
		});
		if (!response.ok) return null;
		const body = (await response.json()) as { draining?: unknown };
		return body.draining === true;
	} catch {
		return null;
	}
}

async function runningSessions(gatewayUrl: string | null): Promise<string[]> {
	if (!gatewayUrl) return [];
	try {
		const response = await fetch(`${gatewayUrl.replace(/\/$/, "")}/api/agent/running`, {
			signal: AbortSignal.timeout(3_000),
		});
		if (!response.ok) return [];
		const body = (await response.json()) as { runningSessionIds?: unknown };
		return Array.isArray(body.runningSessionIds)
			? body.runningSessionIds.filter((id): id is string => typeof id === "string")
			: [];
	} catch {
		return [];
	}
}

export default class Backend extends Command {
	static description = backendHelp.description;

	static args = {
		action: Args.string({
			description: "status (default), on, off, or logs",
			required: false,
			options: ACTIONS,
		}),
	};

	static flags = {
		json: Flags.boolean({ description: "Machine-readable JSON on stdout" }),
		workspace: Flags.string({
			description: "Default workspace for the backend (defaults to the stable ~/.zeta/workspace)",
		}),
		timeout: Flags.integer({
			description: "Seconds `off` waits for running turns before giving up; 0 waits forever (default 0)",
		}),
		force: Flags.boolean({ description: "`off`: stop immediately instead of draining running turns" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Backend);
		const action = (args.action ?? "status") as string;
		if (!isAction(action)) {
			process.stderr.write(chalk.red(`Unknown backend action: ${action}\n`));
			process.exitCode = 1;
			return;
		}

		if (action === "logs") {
			const status = await daemonStatus();
			const lines = await readDaemonLogTail(status.logPath);
			process.stdout.write(`${lines.join("\n")}\n`);
			return;
		}

		if (action === "on") {
			const live = listServeRegistrations().filter(entry => isPidAlive(entry.pid));
			if (live.length > 1) {
				process.stderr.write(
					chalk.red(
						`${live.length} backends are already running (${live.map(entry => `pid ${entry.pid}`).join(", ")}); stop all but one before enabling backend mode.\n`,
					),
				);
				process.exitCode = 1;
				return;
			}
			const configured = (flags.workspace ?? "").trim() || (await readBackendWorkspaceSetting());
			const stableDefault = defaultCoordinatorWorkspace();
			const usingStableDefault = configured.length === 0 || path.resolve(configured) === path.resolve(stableDefault);
			const workspace = path.resolve(configured || stableDefault);
			if (usingStableDefault) {
				await fs.mkdir(workspace, { recursive: true, mode: 0o700 }).catch(() => {});
			}
			const stat = await fs.stat(workspace).catch(() => null);
			if (!stat?.isDirectory()) {
				process.stderr.write(chalk.red(`Default workspace is not a directory: ${workspace}\n`));
				process.exitCode = 1;
				return;
			}
			await writeBackendWorkspaceSetting(workspace);
			await writeBackendEnabledSetting(true);
			const current = await daemonStatus();
			if (current.running && current.gatewayUrl) {
				// `on` during a drain cancels it; an older backend without the
				// endpoint is left alone and simply keeps serving.
				await setDrainState(current.gatewayUrl, false).catch(() => {});
			}
			const webConfig = await WebConfig.load();
			const access = resolveServeAccess({
				flags: {},
				config: webConfig.getData(),
				env: process.env,
			});
			if (!access.ok) {
				await writeBackendEnabledSetting(false);
				process.stderr.write(chalk.red(`Refusing to start backend: ${access.error}\n`));
				process.exitCode = 1;
				return;
			}
			const result = await startDaemon({
				access: access.access,
				cwd: workspace,
				webPort: DAEMON_DEFAULT_WEB_PORT,
				statsPort: DAEMON_DEFAULT_STATS_PORT,
				gatewayPort: DAEMON_DEFAULT_GATEWAY_PORT,
			});
			printStart(result);
			if (result.action === "failed") await writeBackendEnabledSetting(false);
			if (result.exitCode !== 0) process.exitCode = result.exitCode;
			return;
		}

		if (action === "off") {
			await writeBackendEnabledSetting(false);
			const current = await daemonStatus();
			if (flags.force !== true && current.running && !current.gatewayUrl) {
				await writeBackendEnabledSetting(true);
				process.stderr.write(
					chalk.red(
						"The backend has no gateway URL, so active turns cannot be drained; use --force to stop it.\n",
					),
				);
				process.exitCode = 1;
				return;
			}
			if (flags.force !== true && current.running && current.gatewayUrl) {
				try {
					await setDrainState(current.gatewayUrl, true);
				} catch (error) {
					await writeBackendEnabledSetting(true);
					process.stderr.write(
						chalk.red(
							`Could not put the backend into drain mode (${error instanceof Error ? error.message : String(error)}); use --force to stop it without draining.\n`,
						),
					);
					process.exitCode = 1;
					return;
				}
			}
			let lastWait = "";
			const result = await stopDaemon({
				drain: flags.force !== true,
				drainTimeoutSeconds: flags.timeout ?? 0,
				onDrainWait: ids => {
					const key = ids.join(",");
					if (flags.json !== true && key !== lastWait) {
						lastWait = key;
						console.log(chalk.dim(`Waiting for ${ids.length} running session(s): ${ids.join(", ")}`));
					}
				},
				shouldCancel: async () => await readBackendEnabledSetting({ settings: await Settings.loadReadOnly() }),
			});
			if (result.action === "drain-cancelled" && current.gatewayUrl) {
				await setDrainState(current.gatewayUrl, false).catch(() => {});
			} else if (result.action === "failed") {
				if (current.gatewayUrl) await setDrainState(current.gatewayUrl, false).catch(() => {});
				await writeBackendEnabledSetting(result.status.running);
			}
			if (flags.json === true) {
				writeJson(result);
				if (result.exitCode !== 0) process.exitCode = result.exitCode;
				return;
			}
			if (result.action === "stopped") console.log(chalk.green(`Stopped the backend (pid ${result.pid}).`));
			else if (result.action === "not-running") console.log(chalk.dim("Backend is not running."));
			else if (result.action === "cleaned-stale") console.log(chalk.dim("Removed a stale backend record."));
			else if (result.action === "drain-cancelled")
				console.log(chalk.dim("Backend mode was re-enabled; draining cancelled and the backend is still running."));
			else process.stderr.write(chalk.red(`${result.message ?? "Failed to stop the backend."}\n`));
			if (result.exitCode !== 0) process.exitCode = result.exitCode;
			return;
		}

		const enabled = await readBackendEnabledSetting();
		const workspace = await readBackendWorkspaceSetting();
		const status = await daemonStatus();
		const ids = await runningSessions(status.gatewayUrl);
		const draining = await drainState(status.gatewayUrl);
		const liveBackends = listServeRegistrations().filter(entry => isPidAlive(entry.pid)).length;
		if (flags.json === true) {
			writeJson({ enabled, workspace, status, runningSessions: ids, liveBackends, draining });
			return;
		}
		printStatus(enabled, workspace, status, ids, liveBackends, draining);
	}
}

function writeJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
