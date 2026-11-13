/**
 * SSH process transport for the desktop execution-target bridge.
 *
 * This deliberately uses the system OpenSSH client, so `~/.ssh/config`,
 * known_hosts, keys, and ssh-agent keep working exactly as they do for the
 * CLI. There is no in-process SSH server and no password persistence:
 * password auth is handed to OpenSSH through a one-shot askpass helper whose
 * secret exists only in the child environment.
 *
 * Host keys are never auto-accepted. An unknown key fails with OpenSSH's own
 * message and the UI asks the user to verify it once by running `ssh <host>`
 * in a terminal — the same explicit flow the CLI already uses.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import {
	normalizeHost,
	normalizePort,
	safeSshToken,
	type RemoteConnectionProfile,
	type RemoteCredentials,
} from "./protocol";
import { type ProbeResult, parseProbeOutput, REMOTE_PROBE_COMMAND } from "./probe";

const CONNECT_TIMEOUT_SECONDS = 15;
const PROBE_TIMEOUT_MS = 25_000;

export type { ProbeResult } from "./probe";

export interface Tunnel {
	readonly localPort: number;
	readonly remotePort: number;
	readonly child: ChildProcess;
	readonly closed: Promise<void>;
}

function sshBinary(): string {
	return process.env.ZETA_SSH_BINARY?.trim() || "ssh";
}

function scpBinary(): string {
	return process.env.ZETA_SCP_BINARY?.trim() || "scp";
}

function target(profile: RemoteConnectionProfile): string {
	return `${profile.user ? `${safeSshToken(profile.user, "SSH user")}@` : ""}${normalizeHost(profile.host)}`;
}

function commonOptions(profile: RemoteConnectionProfile): string[] {
	const options = [
		"-o",
		`ConnectTimeout=${CONNECT_TIMEOUT_SECONDS}`,
		"-o",
		"ServerAliveInterval=15",
		"-o",
		"ServerAliveCountMax=3",
		// Never accept an unknown host key on the user's behalf.
		"-o",
		"StrictHostKeyChecking=yes",
	];
	const port = normalizePort(profile.port);
	if (port !== undefined) options.push("-p", String(port));
	return options;
}

interface Askpass {
	readonly env: NodeJS.ProcessEnv;
	readonly available: boolean;
	cleanup(): void;
}

/**
 * SSH_ASKPASS is exec'd directly, so the helper must be an executable with a
 * shebang on POSIX. The secret is never written: it arrives through the child
 * environment and the helper only prints it. Windows OpenSSH cannot exec a
 * script helper reliably, so password mode fails closed there and key/agent
 * auth stays the supported path.
 */
function askpass(userData: string, password: string | undefined): Askpass {
	if (!password) return { env: {}, available: true, cleanup() {} };
	if (process.platform === "win32") return { env: {}, available: false, cleanup() {} };
	const helper = path.join(
		userData,
		`ssh-askpass-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
	);
	fs.mkdirSync(userData, { recursive: true, mode: 0o700 });
	fs.writeFileSync(helper, '#!/bin/sh\nprintf %s "$ZETA_SSH_ASKPASS_SECRET"\n', { encoding: "utf8", mode: 0o700 });
	fs.chmodSync(helper, 0o700);
	return {
		env: {
			SSH_ASKPASS: helper,
			SSH_ASKPASS_REQUIRE: "force",
			DISPLAY: process.env.DISPLAY || "zeta-desktop",
			ZETA_SSH_ASKPASS_SECRET: password,
		},
		available: true,
		cleanup() {
			try {
				fs.unlinkSync(helper);
			} catch {
				// Already gone.
			}
		},
	};
}

/** POSIX shell single-quote; used for every remote path we build. */
export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** `~` expands outside quotes; the rest stays literal. */
export function remoteShellPath(directory: string, child?: string): string {
	const suffix = child ? `/${shellQuote(child)}` : "";
	const home = directory.match(/^~(?=\/|$)/);
	if (home) return `"$HOME"${shellQuote(directory.slice(1))}${suffix}`;
	return `${shellQuote(directory)}${suffix}`;
}

function exitMessage(stderr: string, code: number | null): string {
	const text = stderr.trim();
	if (/Host key verification failed/i.test(text)) {
		return "SSH host key is not trusted yet. Run `ssh <host>` once in a terminal, verify the fingerprint, then retry.";
	}
	if (/Permission denied/i.test(text)) return "SSH authentication failed. Check the configured key or ssh-agent.";
	if (/Connection refused|Could not resolve|timed out|No route to host/i.test(text))
		return `SSH connection failed: ${text.split("\n")[0]}`;
	return text || `SSH exited with code ${code ?? "unknown"}`;
}

/** Run one remote command and return stdout. Never logs the password. */
export function runRemote(
	profile: RemoteConnectionProfile,
	credentials: RemoteCredentials,
	userData: string,
	command: string,
	timeoutMs = PROBE_TIMEOUT_MS,
): Promise<string> {
	const auth = profile.authMode === "password" ? credentials.password : undefined;
	const helper = askpass(userData, auth);
	if (!helper.available) throw new Error("密码认证在 Windows 上不可用；请使用 SSH 密钥或 ssh-agent。");
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	let settled = false;
	// eslint-disable-next-line prefer-const -- assigned once after the child exists; finish() can run earlier.
	let timer: NodeJS.Timeout | undefined;
	const finish = (error: Error | null, value = ""): void => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		helper.cleanup();
		if (error) reject(error);
		else resolve(value);
	};
	let child: ChildProcess;
	try {
		child = spawn(
			sshBinary(),
			[...commonOptions(profile), ...(auth ? [] : ["-o", "BatchMode=yes"]), "--", target(profile), command],
			{
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
				env: { ...process.env, ...helper.env },
			},
		);
	} catch (error) {
		finish(error instanceof Error ? error : new Error(String(error)));
		return promise;
	}
	let stdout = "";
	let stderr = "";
	timer = setTimeout(() => {
		child.kill();
		finish(new Error(`SSH command timed out after ${Math.round(timeoutMs / 1000)}s`));
	}, timeoutMs);
	child.stdout?.on("data", chunk => (stdout += chunk.toString()));
	child.stderr?.on("data", chunk => (stderr += chunk.toString()));
	child.once("error", error => finish(error));
	child.once("exit", code => finish(code === 0 ? null : new Error(exitMessage(stderr, code)), stdout));
	return promise;
}

/** Probe OS/arch and whether a `zeta` binary is reachable on PATH. */
export async function probeRemote(
	profile: RemoteConnectionProfile,
	credentials: RemoteCredentials,
	userData: string,
): Promise<ProbeResult> {
	const raw = await runRemote(profile, credentials, userData, REMOTE_PROBE_COMMAND);
	return { ...parseProbeOutput(raw), raw };
}

/** Wait until a loopback port accepts a connection or the child dies. */
export function waitForPort(port: number, child: ChildProcess, timeoutMs = 15_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	return new Promise<void>((resolve, reject) => {
		const attempt = (): void => {
			if (child.exitCode !== null) {
				reject(new Error("SSH tunnel exited before its local port became ready"));
				return;
			}
			const socket = net.connect({ host: "127.0.0.1", port });
			socket.once("connect", () => {
				socket.destroy();
				resolve();
			});
			socket.once("error", () => {
				socket.destroy();
				if (Date.now() >= deadline) reject(new Error("SSH tunnel did not open its local port in time"));
				else setTimeout(attempt, 150);
			});
		};
		attempt();
	});
}

/**
 * Open `ssh -N -L 127.0.0.1:<local>:(remote loopback):<remotePort>`.
 * The remote Studio host stays loopback-only; SSH is the only entry.
 */
export async function openTunnel(
	profile: RemoteConnectionProfile,
	credentials: RemoteCredentials,
	userData: string,
	localPort: number,
	remotePort = 43141,
): Promise<Tunnel> {
	const auth = profile.authMode === "password" ? credentials.password : undefined;
	const helper = askpass(userData, auth);
	if (!helper.available) throw new Error("密码认证在 Windows 上不可用；请使用 SSH 密钥或 ssh-agent。");
	let child: ChildProcess;
	try {
		child = spawn(
			sshBinary(),
			[
				...commonOptions(profile),
				"-o",
				"ExitOnForwardFailure=yes",
				...(auth ? [] : ["-o", "BatchMode=yes"]),
				"-N",
				"-L",
				`127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
				"--",
				target(profile),
			],
			{ stdio: ["ignore", "ignore", "pipe"], windowsHide: true, env: { ...process.env, ...helper.env } },
		);
	} catch (error) {
		helper.cleanup();
		throw error;
	}
	let stderr = "";
	child.stderr?.on("data", chunk => (stderr += chunk.toString()));
	const closed = Promise.withResolvers<void>();
	child.once("exit", () => closed.resolve());
	child.once("error", () => closed.resolve());
	const failed = Promise.withResolvers<void>();
	let spawnError: Error | undefined;
	child.once("error", error => {
		spawnError = error;
		failed.resolve();
	});
	const portWait = waitForPort(localPort, child);
	// If the spawn fails first, `portWait` will reject later; observe it so the
	// race loser cannot surface as an unhandled rejection.
	portWait.catch(() => undefined);
	try {
		await Promise.race([portWait, failed.promise]);
		if (spawnError) throw spawnError;
		// Authentication and forwarding are established; the password helper is
		// no longer needed even though the tunnel stays alive.
		helper.cleanup();
	} catch (error) {
		child.kill();
		helper.cleanup();
		throw new Error(
			stderr.trim() ? exitMessage(stderr, child.exitCode) : error instanceof Error ? error.message : String(error),
		);
	}
	return { localPort, remotePort, child, closed: closed.promise };
}

/** Upload a runtime artifact, then mark it executable. */
export async function uploadRuntime(
	profile: RemoteConnectionProfile,
	credentials: RemoteCredentials,
	userData: string,
	localFile: string,
	remoteDirectory: string,
): Promise<void> {
	if (!fs.existsSync(localFile)) throw new Error(`Remote runtime artifact not found: ${localFile}`);
	const auth = profile.authMode === "password" ? credentials.password : undefined;
	const helper = askpass(userData, auth);
	if (!helper.available) throw new Error("密码认证在 Windows 上不可用；请使用 SSH 密钥或 ssh-agent。");
	const port = normalizePort(profile.port);
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	let settled = false;
	// eslint-disable-next-line prefer-const -- assigned once after the child exists; finish() can run earlier.
	let timer: NodeJS.Timeout | undefined;
	const finish = (error?: Error): void => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		helper.cleanup();
		if (error) reject(error);
		else resolve();
	};
	let child: ChildProcess;
	try {
		child = spawn(
			scpBinary(),
			[
				"-o",
				`ConnectTimeout=${CONNECT_TIMEOUT_SECONDS}`,
				"-o",
				"StrictHostKeyChecking=yes",
				...(port !== undefined ? ["-P", String(port)] : []),
				...(auth ? [] : ["-o", "BatchMode=yes"]),
				"--",
				localFile,
				`${target(profile)}:${remoteDirectory.replace(/\/$/, "")}/`,
			],
			{ stdio: ["ignore", "ignore", "pipe"], windowsHide: true, env: { ...process.env, ...helper.env } },
		);
	} catch (error) {
		finish(error instanceof Error ? error : new Error(String(error)));
		return promise;
	}
	let stderr = "";
	child.stderr?.on("data", chunk => (stderr += chunk.toString()));
	timer = setTimeout(() => {
		child.kill();
		finish(new Error("Runtime upload timed out after 120s"));
	}, 120_000);
	child.once("error", error => finish(error));
	child.once("exit", code => finish(code === 0 ? undefined : new Error(exitMessage(stderr, code))));
	await promise;
	await runRemote(
		profile,
		credentials,
		userData,
		`chmod 700 ${remoteShellPath(remoteDirectory, path.basename(localFile))}`,
	);
}
