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
	platformFromProbe,
	safeSshToken,
	type RemoteConnectionProfile,
	type RemoteCredentials,
	type RemotePlatform,
} from "./protocol";

const CONNECT_TIMEOUT_SECONDS = 15;
const PROBE_TIMEOUT_MS = 25_000;

export interface ProbeResult {
	readonly platform: RemotePlatform;
	readonly arch: string;
	readonly zetaPath: string | null;
	readonly raw: string;
}

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

function askpass(userData: string, password: string | undefined): { env: NodeJS.ProcessEnv; cleanup(): void } {
	if (!password) return { env: {}, cleanup() {} };
	const helper = path.join(userData, `ssh-askpass-${process.pid}-${Date.now()}.cjs`);
	fs.mkdirSync(userData, { recursive: true, mode: 0o700 });
	fs.writeFileSync(helper, 'process.stdout.write(process.env.ZETA_SSH_ASKPASS_SECRET ?? "");\n', { encoding: "utf8", mode: 0o700 });
	return {
		env: {
			SSH_ASKPASS: helper,
			SSH_ASKPASS_REQUIRE: "force",
			DISPLAY: process.env.DISPLAY || "zeta-desktop",
			ZETA_SSH_ASKPASS_SECRET: password,
		},
		cleanup() {
			try {
				fs.unlinkSync(helper);
			} catch {
				// Already gone.
			}
		},
	};
}

function exitMessage(stderr: string, code: number | null): string {
	const text = stderr.trim();
	if (/Host key verification failed/i.test(text)) {
		return "SSH host key is not trusted yet. Run `ssh <host>` once in a terminal, verify the fingerprint, then retry.";
	}
	if (/Permission denied/i.test(text)) return "SSH authentication failed. Check the configured key or ssh-agent.";
	if (/Connection refused|Could not resolve|timed out|No route to host/i.test(text)) return `SSH connection failed: ${text.split("\n")[0]}`;
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
	return new Promise<string>((resolve, reject) => {
		const child = spawn(sshBinary(), [...commonOptions(profile), ...(auth ? [] : ["-o", "BatchMode=yes"]), "--", target(profile), command], {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
			env: { ...process.env, ...helper.env },
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`SSH command timed out after ${Math.round(timeoutMs / 1000)}s`));
		}, timeoutMs);
		child.stdout?.on("data", chunk => (stdout += chunk.toString()));
		child.stderr?.on("data", chunk => (stderr += chunk.toString()));
		child.once("error", error => {
			clearTimeout(timer);
			helper.cleanup();
			reject(error);
		});
		child.once("exit", code => {
			clearTimeout(timer);
			helper.cleanup();
			if (code === 0) resolve(stdout);
			else reject(new Error(exitMessage(stderr, code)));
		});
	});
}

/** Probe OS/arch and whether a `zeta` binary is reachable on PATH. */
export async function probeRemote(profile: RemoteConnectionProfile, credentials: RemoteCredentials, userData: string): Promise<ProbeResult> {
	const raw = await runRemote(
		profile,
		credentials,
		userData,
		"printf '__ZETA_PROBE__\\n'; uname -s 2>/dev/null || echo unknown; uname -m 2>/dev/null || echo unknown; command -v zeta 2>/dev/null || true",
	);
	const lines = raw
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line !== "");
	const start = lines.indexOf("__ZETA_PROBE__");
	const body = start >= 0 ? lines.slice(start + 1) : lines;
	const system = body[0] ?? "unknown";
	const arch = body[1] ?? "unknown";
	const zetaPath = body.slice(2).find(line => line.includes("/") || line.endsWith("zeta") || line.endsWith("zeta.exe")) ?? null;
	return { platform: platformFromProbe(system), arch, zetaPath, raw };
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
	const child = spawn(
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
	let stderr = "";
	child.stderr?.on("data", chunk => (stderr += chunk.toString()));
	const closed = new Promise<void>(resolve => child.once("exit", () => resolve()));
	try {
		await waitForPort(localPort, child);
	} catch (error) {
		child.kill();
		helper.cleanup();
		throw new Error(stderr.trim() ? exitMessage(stderr, child.exitCode) : error instanceof Error ? error.message : String(error));
	}
	return { localPort, remotePort, child, closed };
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
	const port = normalizePort(profile.port);
	await new Promise<void>((resolve, reject) => {
		// scp resolves only on exit; the helper must outlive the child.
		const child = spawn(
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
		let stderr = "";
		child.stderr?.on("data", chunk => (stderr += chunk.toString()));
		child.once("error", error => {
			helper.cleanup();
			reject(error);
		});
		child.once("exit", code => {
			helper.cleanup();
			if (code === 0) resolve();
			else reject(new Error(exitMessage(stderr, code)));
		});
	});
	const name = path.basename(localFile);
	const expanded = remoteDirectory.replace(/^~(?=\/|$)/, "$HOME").replace(/'/g, `'\\''`);
	await runRemote(profile, credentials, userData, `chmod 700 '${expanded}/${name.replace(/'/g, `'\\''`)}'`);
}
